"""A small tool-calling agent loop shared by every ClipHive agent.

The model gets a goal and a list of tools (plain Python functions with JSON-schema
parameters). It calls tools until it calls `finish`, or until the step / time budget runs
out. Every model message and tool call is written to the run's event log, which is what the
activity feed shows.
"""
from __future__ import annotations

import json
import logging
import time
from collections.abc import Callable
from dataclasses import dataclass, field
from typing import Any

from app.config import settings
from app.services.agents import events

logger = logging.getLogger("cliphive.agents")


@dataclass
class Tool:
    name: str
    description: str
    parameters: dict  # JSON schema for the arguments object
    run: Callable[[dict], dict]
    # Optional: turn (args, result) into a short feed line. None = log nothing for this call.
    describe: Callable[[dict, dict], str | None] | None = None
    event_type: str = "tool_call"

    def schema(self) -> dict:
        return {"type": "function", "function": {"name": self.name, "description": self.description, "parameters": self.parameters}}


@dataclass
class AgentResult:
    finished: bool  # the model called finish
    summary: str | None
    steps: int
    stop_reason: str  # finished | step_limit | time_limit | no_tool_call
    tool_calls: list[str] = field(default_factory=list)


def agent_client(provider: str | None = None):
    """(client, model, label) for the configured provider, or (None, None, None)."""
    import openai

    provider = (provider or settings.agent_provider or "auto").lower()
    if provider in ("auto", "openai") and settings.openai_api_key:
        client = openai.OpenAI(api_key=settings.openai_api_key, max_retries=2, timeout=60)
        model = settings.agent_openai_model or settings.openai_model or "gpt-4o-mini"
        return client, model, f"openai:{model}"
    if provider in ("auto", "groq") and settings.groq_api_key:
        from app.services.ai.groq_client import groq_client

        model = settings.agent_groq_model
        return groq_client(timeout_s=60), model, f"groq:{model}"
    return None, None, None


def _short(value: Any, limit: int = 400) -> str:
    text = value if isinstance(value, str) else json.dumps(value, default=str)
    return text if len(text) <= limit else text[: limit - 1] + "…"


def run_agent(
    run_id: int,
    *,
    client,
    model: str,
    system: str,
    user: str,
    tools: list[Tool],
    max_steps: int | None = None,
    max_seconds: float | None = None,
    should_stop: Callable[[], bool] | None = None,
) -> AgentResult:
    """Run the loop. `finish` is added automatically; its `summary` ends the run."""
    max_steps = max_steps or settings.agent_max_steps
    max_seconds = max_seconds or settings.agent_max_seconds
    deadline = time.monotonic() + max_seconds

    finish = Tool(
        name="finish",
        description="Call once when the goal is done (or cannot be done). Give a 1-3 sentence summary for the creator.",
        parameters={"type": "object", "properties": {"summary": {"type": "string"}}, "required": ["summary"]},
        run=lambda args: {"ok": True},
    )
    by_name = {t.name: t for t in [*tools, finish]}
    schemas = [t.schema() for t in by_name.values()]

    messages: list[dict] = [{"role": "system", "content": system}, {"role": "user", "content": user}]
    called: list[str] = []
    nudged = False

    for step in range(1, max_steps + 1):
        if time.monotonic() > deadline:
            return AgentResult(False, None, step - 1, "time_limit", called)
        if should_stop and should_stop():
            return AgentResult(False, None, step - 1, "finished", called)

        response = client.chat.completions.create(
            model=model, messages=messages, tools=schemas, tool_choice="auto", temperature=0.3
        )
        msg = response.choices[0].message
        tool_calls = list(msg.tool_calls or [])

        if msg.content and msg.content.strip():
            events.log(run_id, "thought", _short(msg.content.strip(), 280))

        if not tool_calls:
            if nudged:
                return AgentResult(False, msg.content, step, "no_tool_call", called)
            nudged = True
            messages.append({"role": "assistant", "content": msg.content or ""})
            messages.append({"role": "user", "content": "Continue by calling a tool. Call finish when you are done."})
            continue

        messages.append(
            {
                "role": "assistant",
                "content": msg.content or "",
                "tool_calls": [
                    {"id": c.id, "type": "function", "function": {"name": c.function.name, "arguments": c.function.arguments or "{}"}}
                    for c in tool_calls
                ],
            }
        )

        finished_summary: str | None = None
        for call in tool_calls:
            name = call.function.name
            called.append(name)
            try:
                args = json.loads(call.function.arguments or "{}")
                if not isinstance(args, dict):
                    raise ValueError("arguments must be an object")
            except (json.JSONDecodeError, ValueError) as err:
                result: dict = {"error": f"Bad arguments: {err}"}
                args = {}
            else:
                tool = by_name.get(name)
                if tool is None:
                    result = {"error": f"Unknown tool {name}"}
                else:
                    try:
                        result = tool.run(args)
                    except Exception as err:  # a tool error goes back to the model, it can recover
                        logger.warning("Agent tool %s failed: %s", name, err)
                        result = {"error": str(err)[:300]}
                        events.log(run_id, "thought", "That step didn't work; trying another way.")
                    else:
                        line = tool.describe(args, result) if tool.describe else None
                        if line:
                            events.log(run_id, tool.event_type, line, {"tool": name, "args": args, "result": _short(result, 1500)})
            if name == "finish":
                finished_summary = str(args.get("summary") or "").strip() or "Done."
            messages.append({"role": "tool", "tool_call_id": call.id, "content": _short(result, 6000)})

        if finished_summary is not None:
            return AgentResult(True, finished_summary, step, "finished", called)

    return AgentResult(False, None, max_steps, "step_limit", called)

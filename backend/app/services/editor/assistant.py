"""AI editing chat: the model edits the timeline by calling the same operations a person can do.

Each user message runs a short tool-calling loop. Every tool call is applied to a working copy
of the timeline; a failed edit returns its error to the model so it can correct itself.
The caller saves the final timeline as one revision, so a single Undo in the editor reverts
everything the assistant did for that message.
"""
from __future__ import annotations

import json
import logging
import threading
from collections.abc import Callable
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from app.config import settings
from app.schemas.editor import Timeline
from app.services.editor import effects, ops, sfx

logger = logging.getLogger("cliphive.editor.ai")

MAX_ROUNDS = 8

_NUM = {"type": "number"}
_INT = {"type": "integer"}
_STR = {"type": "string"}
_BOOL = {"type": "boolean"}
_PRESET = {"type": "string", "enum": list(ops.TEXT_PRESETS)}
_EFFECT = {"type": "string", "enum": list(effects.DEFAULT_LENGTH),
           "description": "punch_zoom quick zoom hit, slow_zoom push-in, shake, flash (white), glitch, vignette, color_pop, black_white"}
_TEXT_STYLE = {
    "preset": _PRESET,
    "x": {**_NUM, "description": "centre, 0-1 of frame width"},
    "y": {**_NUM, "description": "centre, 0-1 of frame height (0.15 top, 0.5 middle, 0.75 lower third)"},
    "size": {**_INT, "description": "font size in px on the full-size frame (1080 wide for 9:16)"},
    "font": {"type": "string", "enum": ["Bangers", "Luckiest Guy", "Poppins", "System"]},
    "color": {**_STR, "description": "#RRGGBB"},
    "stroke_color": {**_STR, "description": "#RRGGBB outline, or omit"},
    "stroke_width": _INT,
    "background": {**_STR, "description": "#RRGGBB box behind the text, or omit"},
    "uppercase": _BOOL,
    "animation": {"type": "string", "enum": ["none", "fade", "pop", "slide_up", "typewriter"]},
}


def _tool(name: str, description: str, properties: dict, required: list[str] | None = None) -> dict:
    return {"type": "function", "function": {"name": name, "description": description, "parameters": {
        "type": "object", "properties": properties, "required": required or [], "additionalProperties": False}}}


TOOLS = [
    _tool("add_clip", "Place a video or image asset on a visual track. Omit start to append after the last clip on that track.",
          {"asset_id": _STR, "start": _NUM, "track": {**_INT, "description": "0 main, 1-2 overlays on top"},
           "source_in": {**_NUM, "description": "seconds into the source file"}, "duration": {**_NUM, "description": "timeline seconds; omit for the rest of the file"}},
          ["asset_id"]),
    _tool("update_clip", "Move, trim or restyle a clip: start, track, source_in (trim the head), duration (trim the tail), speed (0.25-4), volume (0-2), muted, fit, look (colour), fades.",
          {"clip_id": _STR, "start": _NUM, "track": _INT, "source_in": _NUM, "duration": _NUM, "speed": _NUM, "volume": _NUM,
           "muted": _BOOL, "fit": {"type": "string", "enum": ["cover", "contain", "blur"], "description": "cover fills the frame, contain shows all, blur shows all over a blurred copy"},
           "look": {"type": "string", "enum": ["none", "vibrant", "warm", "cool", "dramatic"], "description": "colour grade"},
           "fade_in": _NUM, "fade_out": _NUM}, ["clip_id"]),
    _tool("split", "Cut a clip, text or audio track in two at a timeline time.", {"item_id": _STR, "at": _NUM}, ["item_id", "at"]),
    _tool("delete", "Remove clips, texts, audio tracks or effects by id.", {"ids": {"type": "array", "items": _STR}}, ["ids"]),
    _tool("duplicate", "Copy an item; omit start to place the copy right after the original.", {"item_id": _STR, "start": _NUM}, ["item_id"]),
    _tool("close_gaps", "Pack a track's clips back to back from 0, removing empty space.", {"track": _INT}),
    _tool("add_text", "Add a text overlay (titles, labels, call-outs). Prefer a preset.",
          {"text": _STR, "start": _NUM, "duration": _NUM, **_TEXT_STYLE}, ["text", "start"]),
    _tool("update_text", "Change a text overlay's words, timing, position or style.",
          {"text_id": _STR, "text": _STR, "start": _NUM, "duration": _NUM, **_TEXT_STYLE}, ["text_id"]),
    _tool("add_captions", "Transcribe the speech in the timeline's clips and add word-synced captions (replaces existing captions). Slow: tens of seconds.",
          {"preset": _PRESET, "words_per_caption": {**_INT, "description": "1-8, default 3"}, "y": _NUM, "size": _INT}),
    _tool("restyle_captions", "Change the style of every caption at once.", _TEXT_STYLE),
    _tool("add_audio", "Add music or sound from an audio (or video) asset under the edit.",
          {"asset_id": _STR, "start": _NUM, "duration": _NUM, "source_in": _NUM, "volume": _NUM, "fade_in": _NUM, "fade_out": _NUM}, ["asset_id"]),
    _tool("update_audio", "Change an audio track's timing, volume or fades.",
          {"audio_id": _STR, "start": _NUM, "duration": _NUM, "source_in": _NUM, "volume": _NUM, "fade_in": _NUM, "fade_out": _NUM}, ["audio_id"]),
    _tool("auto_effects", "Automatically add visual effects across the whole edit, timed to loud moments, cuts and shouted captions. Replaces earlier auto effects; style none removes them.",
          {"style": {"type": "string", "enum": [*effects.STYLES, "none"], "description": "hype: punch-ins, shakes, flashes, glitches; cinematic: slow push-ins, vignette, soft grade; clean: subtle"},
           "amount": {**_NUM, "description": "0.1-1, how many and how strong (default 0.6)"}}, ["style"]),
    _tool("add_effect", "Add one visual effect to the picture at a time (text is unaffected).",
          {"kind": _EFFECT, "start": _NUM, "duration": {**_NUM, "description": "omit for the effect's natural length"},
           "intensity": {**_NUM, "description": "0.05-1, default 0.6"}}, ["kind", "start"]),
    _tool("update_effect", "Change an effect's kind, timing or intensity.",
          {"effect_id": _STR, "kind": _EFFECT, "start": _NUM, "duration": _NUM, "intensity": _NUM}, ["effect_id"]),
    _tool("auto_sfx", "Sound-design the whole edit: place sound effects on cuts, titles, text pop-ins and loud moments (replaces earlier auto sound effects).",
          {"intensity": {"type": "string", "enum": ["subtle", "normal", "hype"], "description": "default normal"}}),
    _tool("add_sfx", "Add one sound effect whose hit lands at a timeline time.",
          {"name": {"type": "string", "enum": list(sfx.LIBRARY)}, "at": _NUM, "volume": {**_NUM, "description": "0.05-1, default 0.6"}}, ["name", "at"]),
    _tool("set_project", "Change the canvas aspect ratio or background colour.",
          {"aspect": {"type": "string", "enum": ["9:16", "16:9", "1:1", "4:5"]}, "background": _STR}),
    _tool("get_transcript", "Read what's said in a video asset, with source-time timestamps, to find a moment by its words. Slow the first time.",
          {"asset_id": _STR}, ["asset_id"]),
    _tool("find_highlights", "Find the loudest / most energetic moments in a video asset (source times), e.g. to build a highlight reel.",
          {"asset_id": _STR, "count": _INT, "seconds": _INT}, ["asset_id"]),
]

SYSTEM_PROMPT = """You are the editing assistant inside ClipHive's video editor. You edit the user's timeline by calling tools; the user sees every change in the preview and can undo it or keep editing by hand.

How the timeline works:
- Times are seconds. "start"/"duration" are timeline time; "source_in" is where a clip starts inside its file.
- A clip uses duration x speed seconds of its source. Visual tracks: 0 is the main track, 1-2 draw on top.
- Texts are overlays with x/y as fractions of the frame. Captions are texts generated from speech.
- Audio items with is_sfx are sound effects. For "add sound effects" / "sound design this" use auto_sfx; for one specific sound use add_sfx.
- Effects are timed visual effects on the picture (zoom, shake, flash, glitch, grades). For "add effects" / "make it pop" use auto_effects; use add_effect for one specific moment.
- Ids are shown in the state below. Use them exactly. New items get new ids, returned by each tool.

Rules:
- Make the edit the user asked for, then stop. Don't redo work that's already there.
- "Here", "now" or "this point" means the playhead. "This" or "it" means the selected item when there is one.
- If the request is ambiguous in a way that matters, ask one short question instead of guessing.
- When you're done, reply in one or two plain sentences saying what you changed. No lists, no ids unless asked."""


@dataclass
class Result:
    timeline: Timeline
    reply: str
    changes: list[str] = field(default_factory=list)


class AssistantUnavailable(RuntimeError):
    """No model configured; the message says how to turn it on."""


# --- slow read-only helpers, cached per file -----------------------------------------------

_cache: dict[tuple[str, str, float], Any] = {}
_cache_lock = threading.Lock()


def _cached(kind: str, path: Path, compute: Callable[[], Any]) -> Any:
    key = (kind, str(path), path.stat().st_mtime)
    with _cache_lock:
        if key in _cache:
            return _cache[key]
    value = compute()
    with _cache_lock:
        _cache[key] = value
    return value


def transcribe_words(path: Path) -> list[dict]:
    def run() -> list[dict]:
        from app.services.transcribe.whisper_service import transcribe_video

        return [{"word": w.word, "start": float(w.start), "end": float(w.end)} for w in transcribe_video(path)]

    return _cached("transcript", path, run)


def transcribe_range(path: Path, start: float, end: float) -> list[dict]:
    """Words said in [start, end] of a file, in file time. Only that part is decoded and sent,
    so captioning a short clip of a multi-hour upload costs the clip, not the upload."""
    def run() -> list[dict]:
        import subprocess
        import tempfile

        from app.core.media import ffmpeg_bin
        from app.services.transcribe.whisper_service import transcribe_video

        with tempfile.TemporaryDirectory() as tmp:
            part = Path(tmp) / "part.wav"
            subprocess.run([ffmpeg_bin(), "-hide_banner", "-loglevel", "error", "-ss", f"{start:.3f}", "-t", f"{max(0.1, end - start):.3f}",
                            "-i", str(path), "-vn", "-ac", "1", "-ar", "16000", str(part)], check=True, timeout=600)
            return [{"word": w.word, "start": float(w.start) + start, "end": float(w.end) + start} for w in transcribe_video(part)]

    return _cached(f"transcript:{start:.2f}-{end:.2f}", path, run)


def _highlights(path: Path, duration: float, count: int, seconds: int) -> list[dict]:
    from app.services.clip.detector import find_highlights

    moments = _cached(f"highlights:{count}:{seconds}", path, lambda: find_highlights(path, duration, count, seconds))
    return [{"source_in": m.start_s, "source_out": m.end_s, "score": m.score} for m in moments]


# --- tool dispatch --------------------------------------------------------------------------

def _apply(timeline: Timeline, name: str, args: dict[str, Any]) -> tuple[Timeline, str, bool]:
    """Run one tool. Returns (timeline, message for the model, whether the timeline changed)."""
    if name == "get_transcript":
        asset = timeline.asset(args["asset_id"])
        if not asset or asset.kind != "video" or not asset.has_audio:
            raise ops.EditError(f"{args['asset_id']} isn't a video with sound.")
        words = transcribe_words(ops.asset_path(asset))
        lines = " ".join(f"[{w['start']:.1f}] {w['word']}" for w in words)
        return timeline, (lines[:12000] or "No speech found."), False
    if name == "find_highlights":
        asset = timeline.asset(args["asset_id"])
        if not asset or asset.kind != "video" or not asset.duration:
            raise ops.EditError(f"{args['asset_id']} isn't a video.")
        found = _highlights(ops.asset_path(asset), asset.duration, max(1, min(10, args.get("count") or 3)), max(5, min(90, args.get("seconds") or 15)))
        return timeline, json.dumps(found), False
    if name == "auto_sfx":
        result = sfx.auto(timeline, args.get("intensity") or "normal", loudness=sfx.file_loudness)
        return result.timeline, result.summary, True
    if name == "add_sfx":
        try:
            new, msg = sfx.add_one(timeline, args["name"], float(args["at"]), float(args.get("volume") or 0.6))
        except ValueError as err:
            raise ops.EditError(str(err)) from None
        return new, msg, True
    if name == "add_captions":
        words = ops.caption_words(timeline, transcribe_range)
        new, msg = ops.add_captions(timeline, words, **args)
        return new, msg, True

    handlers: dict[str, Callable[..., tuple[Timeline, str]]] = {
        "add_clip": ops.add_clip, "update_clip": ops.update_clip, "split": ops.split, "delete": ops.delete,
        "duplicate": ops.duplicate, "close_gaps": ops.close_gaps, "add_text": ops.add_text, "update_text": ops.update_text,
        "restyle_captions": ops.restyle_captions, "add_audio": ops.add_audio, "update_audio": ops.update_audio,
        "set_project": ops.set_project, "auto_effects": effects.auto_effects, "add_effect": ops.add_effect,
        "update_effect": ops.update_effect,
    }
    if name not in handlers:
        raise ops.EditError(f"Unknown tool {name}.")
    new, msg = handlers[name](timeline, **args)
    return new, msg, True


def _state(timeline: Timeline, playhead: float, selected_id: str | None) -> str:
    """Compact timeline for the model: everything it needs to reference, nothing it doesn't."""
    def round_all(d: dict) -> dict:
        return {k: (round(v, 2) if isinstance(v, float) else v) for k, v in d.items() if v not in (None, False) or k == "muted"}

    state = {
        "aspect": timeline.aspect,
        "duration": timeline.duration,
        "playhead": round(playhead, 2),
        "selected": selected_id,
        "assets": [round_all(a.model_dump(include={"id", "kind", "name", "duration", "has_audio"})) for a in timeline.assets],
        "clips": [round_all(c.model_dump(exclude={"fit"} if c.fit == "cover" else set())) for c in sorted(timeline.clips, key=lambda c: (c.track, c.start))],
        "texts": [round_all(t.model_dump(include={"id", "text", "start", "duration", "x", "y", "size", "font", "color", "animation", "is_caption"}))
                  for t in sorted(timeline.texts, key=lambda t: t.start)][:300],
        "audio": [round_all(a.model_dump()) for a in timeline.audio],
        "effects": [round_all(e.model_dump()) for e in sorted(timeline.effects, key=lambda e: e.start)][:200],
    }
    return json.dumps(state, separators=(",", ":"))


def _client():
    if not settings.openai_api_key:
        raise AssistantUnavailable("The AI editor isn't available right now.")
    import openai

    return openai.OpenAI(api_key=settings.openai_api_key, max_retries=2, timeout=90)


def run(timeline: Timeline, message: str, *, history: list[dict], playhead: float = 0.0,
        selected_id: str | None = None, client=None) -> Result:
    """Apply one chat message to the timeline. `history` is earlier [{"role", "content"}] turns."""
    client = client or _client()
    messages: list[dict] = [{"role": "system", "content": SYSTEM_PROMPT}]
    messages += [{"role": m["role"], "content": m["content"]} for m in history[-10:]]
    messages.append({"role": "user", "content": f"{message}\n\nCurrent editor state (JSON):\n{_state(timeline, playhead, selected_id)}"})

    changes: list[str] = []
    for _ in range(MAX_ROUNDS):
        response = client.chat.completions.create(
            model=settings.openai_model or "gpt-4o-mini", messages=messages, tools=TOOLS, tool_choice="auto", temperature=0.2,
        )
        choice = response.choices[0].message
        calls = choice.tool_calls or []
        messages.append({
            "role": "assistant", "content": choice.content or "",
            **({"tool_calls": [{"id": c.id, "type": "function", "function": {"name": c.function.name, "arguments": c.function.arguments}} for c in calls]} if calls else {}),
        })
        if not calls:
            return Result(timeline, (choice.content or "Done.").strip(), changes)
        for call in calls:
            try:
                args = json.loads(call.function.arguments or "{}")
                timeline, msg, changed = _apply(timeline, call.function.name, args)
                if changed:
                    changes.append(msg)
                content = f"ok: {msg}\nState now: {_state(timeline, playhead, selected_id)}" if changed else msg
            except (ops.EditError, TypeError, json.JSONDecodeError) as err:
                content = f"error: {err}"
            except Exception as err:  # a crashed tool must not lose the edits made so far
                logger.exception("Editor tool %s failed", call.function.name)
                content = f"error: {call.function.name} failed ({type(err).__name__})."
            messages.append({"role": "tool", "tool_call_id": call.id, "content": content})
    return Result(timeline, "I made the changes I could but ran out of steps. Tell me what's still missing.", changes)

"""Write agent runs and their events. Each call uses its own short session, so it is safe
from worker threads and never holds a transaction open while a model or ffmpeg runs."""
from __future__ import annotations

import logging
import threading
from datetime import UTC, datetime

from sqlalchemy import func

from app.db import SessionLocal
from app.models.agent import AgentEvent, AgentRun, Notification

logger = logging.getLogger("cliphive.agents")

_seq_lock = threading.Lock()

EVENT_TYPES = {"thought", "tool_call", "decision", "error", "done"}


def start_run(user_id: int, kind: str, goal: str | None = None, import_job_id: int | None = None, model: str | None = None) -> int:
    with SessionLocal() as db:
        run = AgentRun(user_id=user_id, kind=kind, goal=goal, import_job_id=import_job_id, model=model, status="running")
        db.add(run)
        db.commit()
        return run.id


def set_model(run_id: int, model: str) -> None:
    with SessionLocal() as db:
        run = db.get(AgentRun, run_id)
        if run:
            run.model = model
            db.commit()


def log(run_id: int, type: str, title: str, detail: dict | None = None) -> None:
    """Append one event. Never raises: a logging failure must not break the agent."""
    if type not in EVENT_TYPES:
        type = "thought"
    try:
        with _seq_lock, SessionLocal() as db:
            seq = (db.query(func.max(AgentEvent.seq)).filter(AgentEvent.run_id == run_id).scalar() or 0) + 1
            db.add(AgentEvent(run_id=run_id, seq=seq, type=type, title=title[:300], detail=detail))
            db.commit()
    except Exception:
        logger.exception("Couldn't log agent event for run %s", run_id)


def finish_run(run_id: int, status: str = "done", summary: str | None = None) -> None:
    with SessionLocal() as db:
        run = db.get(AgentRun, run_id)
        if not run:
            return
        run.status = status
        if summary:
            run.summary = summary
        run.finished_at = datetime.now(UTC)
        db.commit()
    log(run_id, "done" if status == "done" else "error", summary or ("Finished" if status == "done" else "Stopped"))


def notify(user_id: int, title: str, body: str | None = None, link: str | None = None) -> None:
    try:
        with SessionLocal() as db:
            db.add(Notification(user_id=user_id, title=title[:200], body=body, link=link))
            db.commit()
    except Exception:
        logger.exception("Couldn't create notification")

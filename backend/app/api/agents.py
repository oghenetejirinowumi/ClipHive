"""Agent runs, the live activity feed, notifications, the creator profile and commands."""
from __future__ import annotations

import asyncio

from fastapi import APIRouter, HTTPException, Query, status

from app.api.deps import DbSession, Owner
from app.models import Clip, ClipStatus, ImportJob, Post, PostStatus, Streamer
from app.models.agent import AgentEvent, AgentRun, Notification
from app.schemas.agent import AgentEventRead, AgentRunRead, AgentStats, CommandRequest, NotificationRead, ProfileRead
from app.schemas.import_job import ImportRead
from app.services.agents import command, learning, scout
from app.services.agents.command import CommandPlan

router = APIRouter(prefix="/agents", tags=["agents"])


# ---------- runs + events (the activity feed) ----------
@router.get("/runs", response_model=list[AgentRunRead])
def list_runs(
    user: Owner,
    db: DbSession,
    import_job_id: int | None = None,
    kind: str | None = Query(default=None, pattern="^(scout|producer|publisher|command)$"),
    limit: int = Query(default=30, ge=1, le=100),
) -> list[AgentRun]:
    q = db.query(AgentRun).filter(AgentRun.user_id == user.id)
    if import_job_id is not None:
        q = q.filter(AgentRun.import_job_id == import_job_id)
    if kind:
        q = q.filter(AgentRun.kind == kind)
    return q.order_by(AgentRun.id.desc()).limit(limit).all()


def _own_run(db, user, run_id: int) -> AgentRun:
    run = db.get(AgentRun, run_id)
    if run is None or run.user_id != user.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Agent run not found.")
    return run


@router.get("/runs/{run_id}", response_model=AgentRunRead)
def get_run(run_id: int, user: Owner, db: DbSession) -> AgentRun:
    return _own_run(db, user, run_id)


@router.get("/runs/{run_id}/events", response_model=list[AgentEventRead])
def run_events(run_id: int, user: Owner, db: DbSession, after: int = Query(default=0, ge=0)) -> list[AgentEvent]:
    """Events with seq > after, oldest first. Poll with the last seq you have."""
    _own_run(db, user, run_id)
    return db.query(AgentEvent).filter(AgentEvent.run_id == run_id, AgentEvent.seq > after).order_by(AgentEvent.seq).limit(500).all()


@router.get("/clips/{clip_id}/decision", response_model=AgentEventRead | None)
def clip_decision(clip_id: int, user: Owner, db: DbSession):
    """The Producer's 'kept' event for a clip: why the agent picked this moment."""
    clip = db.get(Clip, clip_id)
    if clip is None or clip.user_id != user.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Clip not found.")
    job_id = (clip.context_json or {}).get("import_job_id")
    if not job_id:
        return None
    run_ids = [r.id for r in db.query(AgentRun.id).filter(AgentRun.import_job_id == job_id, AgentRun.kind == "producer")]
    if not run_ids:
        return None
    rows = db.query(AgentEvent).filter(AgentEvent.run_id.in_(run_ids), AgentEvent.type == "decision").all()
    return next((e for e in rows if (e.detail or {}).get("clip_id") == clip_id), None)


@router.get("/stats", response_model=AgentStats)
def stats(user: Owner, db: DbSession) -> AgentStats:
    runs = db.query(AgentRun.id).filter(AgentRun.user_id == user.id, AgentRun.kind == "producer")
    run_ids = [r.id for r in runs]
    decisions = (
        db.query(AgentEvent.detail).filter(AgentEvent.run_id.in_(run_ids), AgentEvent.type == "decision").all() if run_ids else []
    )
    verdicts = [(d[0] or {}).get("verdict") for d in decisions]
    return AgentStats(
        producer_runs=len(run_ids),
        clips_kept=verdicts.count("kept"),
        moments_rejected=verdicts.count("rejected"),
        awaiting_review=db.query(Clip).filter(Clip.user_id == user.id, Clip.review_status == "pending", Clip.status != ClipStatus.FAILED).count(),
        posts_scheduled=db.query(Post).join(Clip, Clip.id == Post.clip_id).filter(Clip.user_id == user.id, Post.status.in_([PostStatus.QUEUED, PostStatus.READY])).count(),
        channels_watched=db.query(Streamer).filter(Streamer.user_id == user.id, Streamer.is_active.is_(True)).count(),
    )


# ---------- notifications ----------
@router.get("/notifications", response_model=list[NotificationRead])
def list_notifications(user: Owner, db: DbSession, limit: int = Query(default=20, ge=1, le=100)) -> list[Notification]:
    return db.query(Notification).filter(Notification.user_id == user.id).order_by(Notification.id.desc()).limit(limit).all()


@router.post("/notifications/read-all", status_code=status.HTTP_204_NO_CONTENT)
def read_all(user: Owner, db: DbSession) -> None:
    db.query(Notification).filter(Notification.user_id == user.id, Notification.read.is_(False)).update({"read": True})
    db.commit()


# ---------- scout ----------
@router.post("/scout/run")
async def run_scout_now(user: Owner) -> dict:
    """Check every active channel now. New VODs start imports."""
    results = await asyncio.to_thread(scout.run_scout, user.id, None, False)
    return {"results": [r.__dict__ for r in results]}


# ---------- creator profile (learning from edits) ----------
@router.get("/profile", response_model=ProfileRead)
async def get_profile(user: Owner, db: DbSession) -> ProfileRead:
    profile = await asyncio.to_thread(learning.refresh_profile, user.id)
    if profile is None:
        return ProfileRead(summary="", feedback_count=0, updated_at=None)
    return ProfileRead(summary=profile.summary, feedback_count=profile.feedback_count, updated_at=profile.updated_at)


@router.delete("/profile", status_code=status.HTTP_204_NO_CONTENT)
def reset_profile(user: Owner) -> None:
    learning.reset_profile(user.id)


# ---------- plain-language commands ----------
@router.post("/command", response_model=CommandPlan)
async def plan_command(body: CommandRequest, user: Owner) -> CommandPlan:
    """Parse a request into a plan. Nothing runs until /command/run."""
    return await asyncio.to_thread(command.parse_command, user.id, body.text)


@router.post("/command/run", response_model=ImportRead, status_code=status.HTTP_202_ACCEPTED)
def run_command(plan: CommandPlan, user: Owner) -> ImportJob:
    try:
        return command.start_plan(user.id, plan)
    except ValueError as err:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, str(err)) from err

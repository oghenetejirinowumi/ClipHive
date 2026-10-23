"""Agent runs, their step-by-step events, notifications and creator feedback.

Every agent (Scout, Producer, Publisher, Command) writes an AgentRun and a stream of
AgentEvents. The frontend's activity feed reads those events, so what the agent did and
why is always visible.
"""
from datetime import datetime

from sqlalchemy import JSON, Boolean, DateTime, ForeignKey, Integer, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base


class AgentRun(Base):
    __tablename__ = "agent_runs"

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    kind: Mapped[str] = mapped_column(String(20), index=True)  # scout | producer | publisher | command
    import_job_id: Mapped[int | None] = mapped_column(ForeignKey("import_jobs.id", ondelete="SET NULL"), index=True)
    status: Mapped[str] = mapped_column(String(20), default="running", index=True)  # running | done | failed
    goal: Mapped[str | None] = mapped_column(Text)
    summary: Mapped[str | None] = mapped_column(Text)
    model: Mapped[str | None] = mapped_column(String(100))  # "openai:gpt-4o-mini", "fallback", ...
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class AgentEvent(Base):
    __tablename__ = "agent_events"

    id: Mapped[int] = mapped_column(primary_key=True)
    run_id: Mapped[int] = mapped_column(ForeignKey("agent_runs.id", ondelete="CASCADE"), index=True)
    seq: Mapped[int] = mapped_column(Integer)  # 1, 2, 3... within a run
    # thought | tool_call | decision | error | done
    type: Mapped[str] = mapped_column(String(20))
    title: Mapped[str] = mapped_column(String(300))
    detail: Mapped[dict | None] = mapped_column(JSON)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class Notification(Base):
    __tablename__ = "notifications"

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    title: Mapped[str] = mapped_column(String(200))
    body: Mapped[str | None] = mapped_column(Text)
    link: Mapped[str | None] = mapped_column(String(300))  # app route, e.g. "/inbox"
    read: Mapped[bool] = mapped_column(Boolean, default=False, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class CreatorFeedback(Base):
    """One edit or rejection by the creator. Summarised into a profile the Producer reads."""

    __tablename__ = "creator_feedback"

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    clip_id: Mapped[int | None] = mapped_column(ForeignKey("clips.id", ondelete="SET NULL"))
    kind: Mapped[str] = mapped_column(String(30))  # rejected | approved | style_change | title_edit | hashtag_edit
    before: Mapped[dict | None] = mapped_column(JSON)
    after: Mapped[dict | None] = mapped_column(JSON)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class CreatorProfile(Base):
    """Cached plain-language summary of a creator's feedback."""

    __tablename__ = "creator_profiles"

    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    summary: Mapped[str] = mapped_column(Text, default="")
    feedback_count: Mapped[int] = mapped_column(Integer, default=0)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

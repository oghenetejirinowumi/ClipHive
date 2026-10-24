from datetime import datetime

from sqlalchemy import JSON, DateTime, ForeignKey, Integer, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base


class EditorProject(Base):
    """One video edit: a timeline document (schemas/editor.py), its AI chat, and its last export."""

    __tablename__ = "editor_projects"

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    title: Mapped[str] = mapped_column(String(200), default="Untitled edit")
    timeline: Mapped[dict] = mapped_column(JSON, default=dict)
    revision: Mapped[int] = mapped_column(Integer, default=1)  # bumps on every saved change
    chat: Mapped[list] = mapped_column(JSON, default=list)  # [{"role", "content", "changes", "at"}]
    # Every media file ever added ("storage/..." paths). Saves may only reference these, and
    # undo can drop an asset from the timeline without losing the right to bring it back.
    media: Mapped[list] = mapped_column(JSON, default=list)
    render_status: Mapped[str] = mapped_column(String(20), default="idle")  # idle | rendering | done | failed
    render_progress: Mapped[int] = mapped_column(Integer, default=0)
    render_error: Mapped[str | None] = mapped_column(Text)
    render_path: Mapped[str | None] = mapped_column(String(1024))  # public "storage/..." path
    export_clip_id: Mapped[int | None] = mapped_column(ForeignKey("clips.id", ondelete="SET NULL"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), onupdate=func.now())


class EditorVersion(Base):
    """A snapshot of a project's timeline: one per AI turn, plus your edits in between.

    The agent panel lists these ("v11 → v12"), and any of them can be restored.
    """

    __tablename__ = "editor_versions"

    id: Mapped[int] = mapped_column(primary_key=True)
    project_id: Mapped[int] = mapped_column(ForeignKey("editor_projects.id", ondelete="CASCADE"), index=True)
    number: Mapped[int] = mapped_column(Integer)  # v1, v2, ... per project
    label: Mapped[str] = mapped_column(String(200))
    timeline: Mapped[dict] = mapped_column(JSON)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

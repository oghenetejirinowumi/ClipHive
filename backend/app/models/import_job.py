from datetime import datetime

from sqlalchemy import JSON, DateTime, Enum, Float, ForeignKey, Integer, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base
from app.models.enums import ImportSource, ImportStatus


class ImportJob(Base):
    """One pasted link or uploaded video, cut into several clips (rows in `clips`)."""

    __tablename__ = "import_jobs"

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    source: Mapped[ImportSource] = mapped_column(Enum(ImportSource, native_enum=False))
    url: Mapped[str | None] = mapped_column(String(2048))
    original_filename: Mapped[str | None] = mapped_column(String(255))
    title: Mapped[str | None] = mapped_column(String(255))
    duration_s: Mapped[float | None] = mapped_column(Float)
    thumbnail_path: Mapped[str | None] = mapped_column(String(1024))  # public "storage/..." path
    clip_count: Mapped[int] = mapped_column(Integer, default=5)  # requested
    clip_seconds: Mapped[int] = mapped_column(Integer, default=30)
    layout: Mapped[str] = mapped_column(String(10), default="blur")  # "fill" | "blur" (see services/clip/cutter.py)
    clip_layouts: Mapped[dict] = mapped_column(JSON, default=dict)  # {str(clip_id): layout} for clips cut from this source
    clip_ids: Mapped[list[int]] = mapped_column(JSON, default=list)
    # What the Producer agent should aim for: {"origin": "manual|scout|command", "mood", "platform", "style", ...}
    agent_brief: Mapped[dict | None] = mapped_column(JSON, default=dict)
    status: Mapped[ImportStatus] = mapped_column(Enum(ImportStatus, native_enum=False), default=ImportStatus.QUEUED, index=True)
    progress: Mapped[int] = mapped_column(Integer, default=0)  # 0-100
    detail: Mapped[str | None] = mapped_column(String(255))  # human step text, e.g. "Fetching clip 2 of 5"
    error: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

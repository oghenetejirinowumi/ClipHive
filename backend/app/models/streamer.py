from datetime import datetime

from sqlalchemy import Boolean, DateTime, Enum, ForeignKey, String, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db import Base
from app.models.enums import SourcePlatform, StreamStatus


class Streamer(Base):
    __tablename__ = "streamers"
    __table_args__ = (UniqueConstraint("user_id", "platform", "username", name="uq_streamer_per_user"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    platform: Mapped[SourcePlatform] = mapped_column(Enum(SourcePlatform, native_enum=False))
    username: Mapped[str] = mapped_column(String(100))
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    user: Mapped["User"] = relationship(back_populates="streamers")
    streams: Mapped[list["Stream"]] = relationship(back_populates="streamer", cascade="all, delete-orphan")


class Stream(Base):
    __tablename__ = "streams"

    id: Mapped[int] = mapped_column(primary_key=True)
    streamer_id: Mapped[int] = mapped_column(ForeignKey("streamers.id", ondelete="CASCADE"), index=True)
    platform_stream_id: Mapped[str | None] = mapped_column(String(255))
    recording_path: Mapped[str | None] = mapped_column(String(1024))
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    ended_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    status: Mapped[StreamStatus] = mapped_column(
        Enum(StreamStatus, native_enum=False), default=StreamStatus.LIVE, index=True
    )

    streamer: Mapped[Streamer] = relationship(back_populates="streams")
    clips: Mapped[list["Clip"]] = relationship(back_populates="stream", cascade="all, delete-orphan")

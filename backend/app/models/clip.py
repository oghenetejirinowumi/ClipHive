from datetime import datetime

from sqlalchemy import JSON, DateTime, Enum, Float, ForeignKey, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db import Base
from app.models.enums import CaptionMode, ClipStatus


class Clip(Base):
    __tablename__ = "clips"

    id: Mapped[int] = mapped_column(primary_key=True)
    stream_id: Mapped[int | None] = mapped_column(ForeignKey("streams.id", ondelete="CASCADE"), index=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    start_s: Mapped[float] = mapped_column(Float)
    end_s: Mapped[float] = mapped_column(Float)
    raw_file_path: Mapped[str | None] = mapped_column(String(1024))  # cut + 9:16, no captions (written by C)
    file_path: Mapped[str | None] = mapped_column(String(1024))  # final deliverable (written by A)
    transcript_json: Mapped[list | None] = mapped_column(JSON)  # [{"word", "start", "end"}, ...]
    caption_style_id: Mapped[int | None] = mapped_column(
        ForeignKey("caption_styles.id", ondelete="SET NULL"), index=True
    )
    caption_mode: Mapped[CaptionMode] = mapped_column(
        Enum(CaptionMode, native_enum=False), default=CaptionMode.BURNED
    )
    highlight_score: Mapped[float | None] = mapped_column(Float)
    title: Mapped[str | None] = mapped_column(String(255))
    hashtags: Mapped[list[str]] = mapped_column(JSON, default=list)
    context_json: Mapped[dict | None] = mapped_column(JSON, default=dict)
    status: Mapped[ClipStatus] = mapped_column(
        Enum(ClipStatus, native_enum=False), default=ClipStatus.PROCESSING, index=True
    )
    error: Mapped[str | None] = mapped_column(Text)
    # Creator's decision in the inbox: pending | approved | rejected
    review_status: Mapped[str] = mapped_column(String(20), default="pending", server_default="pending", index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    stream: Mapped["Stream | None"] = relationship(back_populates="clips")
    user: Mapped["User"] = relationship(back_populates="clips")
    caption_style: Mapped["CaptionStyle | None"] = relationship()
    posts: Mapped[list["Post"]] = relationship(back_populates="clip", cascade="all, delete-orphan")

    @property
    def duration_s(self) -> float:
        return self.end_s - self.start_s

from datetime import datetime

from sqlalchemy import DateTime, Enum, ForeignKey, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db import Base
from app.models.enums import PostPlatform, PostStatus


class Post(Base):
    __tablename__ = "posts"

    id: Mapped[int] = mapped_column(primary_key=True)
    clip_id: Mapped[int] = mapped_column(ForeignKey("clips.id", ondelete="CASCADE"), index=True)
    platform: Mapped[PostPlatform] = mapped_column(Enum(PostPlatform, native_enum=False))
    status: Mapped[PostStatus] = mapped_column(
        Enum(PostStatus, native_enum=False), default=PostStatus.QUEUED, index=True
    )
    platform_post_id: Mapped[str | None] = mapped_column(String(255))
    posted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    error: Mapped[str | None] = mapped_column(Text)
    # Set by the Publisher agent
    scheduled_for: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), index=True)
    caption_text: Mapped[str | None] = mapped_column(Text)
    schedule_reason: Mapped[str | None] = mapped_column(String(300))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    clip: Mapped["Clip"] = relationship(back_populates="posts")

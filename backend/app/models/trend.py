from datetime import datetime

from sqlalchemy import DateTime, Enum, Float, String, func
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base
from app.models.enums import PostPlatform


class Trend(Base):
    __tablename__ = "trends"

    id: Mapped[int] = mapped_column(primary_key=True)
    platform: Mapped[PostPlatform] = mapped_column(Enum(PostPlatform, native_enum=False), index=True)
    topic: Mapped[str | None] = mapped_column(String(255))
    hashtag: Mapped[str] = mapped_column(String(255))
    score: Mapped[float] = mapped_column(Float, default=0.0)
    fetched_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), index=True)

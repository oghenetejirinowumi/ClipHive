from datetime import datetime, timezone

from app.db import Base
from sqlalchemy import (
    JSON,
    DateTime,
    Float,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


class TrendVideo(Base):
    __tablename__ = "trend_videos"
    __table_args__ = (
        UniqueConstraint(
            "platform", "external_id", name="uq_trend_video_platform_external"
        ),
        Index("ix_trend_videos_platform_external_id", "platform", "external_id"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    platform: Mapped[str] = mapped_column(String(32), nullable=False)
    external_id: Mapped[str] = mapped_column(String(128), nullable=False)
    url: Mapped[str] = mapped_column(String(512), nullable=False)
    title: Mapped[str] = mapped_column(String(512), nullable=False)
    description: Mapped[str] = mapped_column(Text, default="")
    channel_id: Mapped[str | None] = mapped_column(String(128))
    published_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    duration_s: Mapped[float | None] = mapped_column(Float)
    region: Mapped[str] = mapped_column(String(8), nullable=False)
    short_confidence: Mapped[float] = mapped_column(Float, default=0.0)
    source: Mapped[str] = mapped_column(String(32), default="youtube_data_api")
    thumbnail_url: Mapped[str | None] = mapped_column(String(1024))
    first_seen_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utc_now
    )
    last_collected_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utc_now
    )


class VideoMetricSnapshot(Base):
    __tablename__ = "video_metric_snapshots"
    __table_args__ = (
        Index("ix_video_metric_snapshots_video_collected", "video_id", "collected_at"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    video_id: Mapped[int] = mapped_column(
        ForeignKey("trend_videos.id", ondelete="CASCADE"), index=True
    )
    views: Mapped[int | None] = mapped_column(Integer)
    likes: Mapped[int | None] = mapped_column(Integer)
    comments: Mapped[int | None] = mapped_column(Integer)
    engagement_rate: Mapped[float | None] = mapped_column(Float)
    engagement_metrics: Mapped[list[str]] = mapped_column(JSON, default=list)
    source: Mapped[str] = mapped_column(String(32), default="youtube_data_api")
    collected_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utc_now
    )


class Hashtag(Base):
    __tablename__ = "hashtags"

    id: Mapped[int] = mapped_column(primary_key=True)
    normalized: Mapped[str] = mapped_column(
        String(255), unique=True, nullable=False, index=True
    )
    display: Mapped[str] = mapped_column(String(255), nullable=False)


class VideoHashtag(Base):
    __tablename__ = "video_hashtags"
    __table_args__ = (
        UniqueConstraint("video_id", "hashtag_id", name="uq_video_hashtag"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    video_id: Mapped[int] = mapped_column(
        ForeignKey("trend_videos.id", ondelete="CASCADE"), index=True
    )
    hashtag_id: Mapped[int] = mapped_column(
        ForeignKey("hashtags.id", ondelete="CASCADE"), index=True
    )


class TrendScore(Base):
    __tablename__ = "trend_scores"
    __table_args__ = (
        Index("ix_trend_scores_hashtag_calculated", "hashtag_id", "calculated_at"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    hashtag_id: Mapped[int] = mapped_column(
        ForeignKey("hashtags.id", ondelete="CASCADE"), index=True
    )
    platform: Mapped[str] = mapped_column(String(32), nullable=False, index=True)
    region: Mapped[str] = mapped_column(String(8), nullable=False, index=True)
    score: Mapped[float | None] = mapped_column(Float)
    velocity: Mapped[float | None] = mapped_column(Float)
    acceleration: Mapped[float | None] = mapped_column(Float)
    engagement: Mapped[float | None] = mapped_column(Float)
    recency: Mapped[float | None] = mapped_column(Float)
    usage_growth: Mapped[float | None] = mapped_column(Float)
    sample_size: Mapped[int] = mapped_column(Integer, default=0)
    distinct_channels: Mapped[int] = mapped_column(Integer, default=0)
    stage: Mapped[str] = mapped_column(String(32), nullable=False)
    source: Mapped[str] = mapped_column(String(32), default="youtube_data_api")
    reasons: Mapped[list[str]] = mapped_column(JSON, default=list)
    calculated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utc_now, index=True
    )


class CollectionJob(Base):
    __tablename__ = "collection_jobs"

    id: Mapped[int] = mapped_column(primary_key=True)
    provider: Mapped[str] = mapped_column(String(32), nullable=False, index=True)
    kind: Mapped[str] = mapped_column(String(32), nullable=False)
    region: Mapped[str | None] = mapped_column(String(8))
    started_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utc_now, index=True
    )
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    status: Mapped[str] = mapped_column(String(24), default="running", nullable=False)
    discovered: Mapped[int] = mapped_column(Integer, default=0)
    updated: Mapped[int] = mapped_column(Integer, default=0)
    error: Mapped[str | None] = mapped_column(Text)
    quota_used: Mapped[int] = mapped_column(Integer, default=0)

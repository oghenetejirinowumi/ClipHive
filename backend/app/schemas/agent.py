from datetime import UTC, datetime

from pydantic import BaseModel, Field, field_validator

from app.models.enums import PostPlatform, PostStatus
from app.schemas.common import ORMModel


class UTCModel(ORMModel):
    """SQLite hands back naive datetimes that are really UTC; mark them so browsers convert right."""

    @field_validator("*", mode="after")
    @classmethod
    def _utc(cls, v):
        if isinstance(v, datetime) and v.tzinfo is None:
            return v.replace(tzinfo=UTC)
        return v


class AgentRunRead(UTCModel):
    id: int
    kind: str
    import_job_id: int | None
    status: str
    goal: str | None
    summary: str | None
    model: str | None
    started_at: datetime
    finished_at: datetime | None


class AgentEventRead(UTCModel):
    id: int
    run_id: int
    seq: int
    type: str
    title: str
    detail: dict | None
    created_at: datetime


class NotificationRead(UTCModel):
    id: int
    title: str
    body: str | None
    link: str | None
    read: bool
    created_at: datetime


class ProfileRead(BaseModel):
    summary: str
    feedback_count: int
    updated_at: datetime | None


class AgentStats(BaseModel):
    producer_runs: int
    clips_kept: int
    moments_rejected: int
    awaiting_review: int
    posts_scheduled: int
    channels_watched: int


class CommandRequest(BaseModel):
    text: str = Field(min_length=3, max_length=500)


class InboxClip(UTCModel):
    id: int
    title: str | None
    hashtags: list[str]
    file_path: str | None
    duration_s: float
    start_s: float
    end_s: float
    status: str
    review_status: str
    highlight_score: float | None
    caption_style_id: int | None
    context_json: dict | None
    created_at: datetime
    reason: str | None = None
    source_title: str | None = None
    import_job_id: int | None = None


class ApproveRequest(BaseModel):
    platforms: list[PostPlatform] | None = None
    tz_offset_minutes: int = Field(default=0, ge=-14 * 60, le=14 * 60)


class RejectRequest(BaseModel):
    reason: str | None = Field(default=None, max_length=200)


class ScheduledPost(UTCModel):
    id: int
    clip_id: int
    platform: PostPlatform
    status: PostStatus
    scheduled_for: datetime | None
    caption_text: str | None
    schedule_reason: str | None
    posted_at: datetime | None
    created_at: datetime
    clip_title: str | None = None
    clip_file_path: str | None = None
    clip_status: str | None = None


class PostUpdate(BaseModel):
    scheduled_for: datetime | None = None
    caption_text: str | None = Field(default=None, max_length=2200)

from datetime import UTC, datetime

from pydantic import BaseModel, Field, field_validator

from app.models.enums import SourcePlatform, StreamStatus
from app.schemas.common import ORMModel


# POST /streamers
class StreamerCreate(BaseModel):
    platform: SourcePlatform
    username: str = Field(min_length=1, max_length=100)


class StreamerUpdate(BaseModel):
    is_active: bool | None = None


class StreamerRead(ORMModel):
    id: int
    user_id: int
    platform: SourcePlatform
    username: str
    is_active: bool
    created_at: datetime
    # Scout agent state
    last_checked_at: datetime | None = None
    last_seen_video_title: str | None = None
    last_seen_video_url: str | None = None
    last_check_error: str | None = None

    @field_validator("created_at", "last_checked_at", mode="after")
    @classmethod
    def _utc(cls, v):
        return v.replace(tzinfo=UTC) if isinstance(v, datetime) and v.tzinfo is None else v


class CheckResultRead(BaseModel):
    streamer_id: int
    status: str  # new_vod | no_change | first_seen | error
    message: str
    import_job_id: int | None = None


class StreamCreate(BaseModel):
    streamer_id: int
    platform_stream_id: str | None = None
    recording_path: str | None = None
    started_at: datetime | None = None
    status: StreamStatus = StreamStatus.LIVE


class StreamUpdate(BaseModel):
    recording_path: str | None = None
    ended_at: datetime | None = None
    status: StreamStatus | None = None


class StreamRead(ORMModel):
    id: int
    streamer_id: int
    platform_stream_id: str | None
    recording_path: str | None
    started_at: datetime | None
    ended_at: datetime | None
    status: StreamStatus

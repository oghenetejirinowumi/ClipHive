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
    # Live status from the stream monitor (in memory; None/False until the first check).
    is_live: bool = False
    live_title: str | None = None
    live_checked_at: datetime | None = None
    live_error: str | None = None
    recording: bool = False
    channel_url: str = ""

    @field_validator("created_at", "last_checked_at", mode="after")
    @classmethod
    def _utc(cls, v):
        return v.replace(tzinfo=UTC) if isinstance(v, datetime) and v.tzinfo is None else v


class ChannelHitRead(BaseModel):
    """A channel suggestion for the Add a channel box."""

    username: str  # what to save (Twitch login, Kick slug, YouTube @handle without the @)
    display_name: str
    avatar_url: str | None = None
    followers: int | None = None
    followers_text: str | None = None  # the platform's own wording, when it gives no number
    live: bool | None = None
    viewers: int | None = None


class CheckResultRead(BaseModel):
    streamer_id: int
    status: str  # new_vod | no_change | first_seen | error
    message: str
    import_job_id: int | None = None


# POST /streamers/{id}/latest-vod
class LatestVodRequest(BaseModel):
    clip_count: int = Field(default=5, ge=1, le=30)
    clip_seconds: int = Field(default=30, ge=10, le=90)


# GET /streamers/{id}/videos
class ChannelVideoRead(BaseModel):
    id: str
    url: str
    title: str
    thumbnail: str | None = None
    duration_s: float | None = None
    published_at: datetime | None = None


# POST /streamers/{id}/clip-video
class ClipVideoRequest(LatestVodRequest):
    url: str = Field(min_length=10, max_length=500)
    title: str | None = Field(default=None, max_length=300)


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
    clip_ids: list[int] = Field(default_factory=list)

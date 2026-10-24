from datetime import datetime

from pydantic import BaseModel, Field

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
    # Live status from the stream monitor (in memory; None/False until the first check).
    is_live: bool = False
    live_title: str | None = None
    last_checked_at: datetime | None = None
    check_error: str | None = None
    recording: bool = False
    channel_url: str = ""


# POST /streamers/{id}/latest-vod
class LatestVodRequest(BaseModel):
    clip_count: int = Field(default=5, ge=1, le=30)
    clip_seconds: int = Field(default=30, ge=10, le=90)


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

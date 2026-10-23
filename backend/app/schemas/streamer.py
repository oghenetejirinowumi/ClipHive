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

from datetime import datetime

from pydantic import BaseModel, Field

from app.models.enums import PostPlatform
from app.schemas.common import ORMModel


class TrendCreate(BaseModel):
    platform: PostPlatform
    topic: str | None = Field(default=None, max_length=255)
    hashtag: str = Field(min_length=1, max_length=255)
    score: float = 0.0


class TrendRead(ORMModel):
    id: int
    platform: PostPlatform
    topic: str | None
    hashtag: str
    score: float
    fetched_at: datetime


# Body for "use in caption": inject trending hashtags into a clip's metadata.
class ApplyTrendsRequest(BaseModel):
    clip_id: int
    hashtags: list[str] = Field(min_length=1)

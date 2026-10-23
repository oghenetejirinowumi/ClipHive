from datetime import datetime
from typing import Annotated

from app.models.enums import PostPlatform
from app.schemas.common import ORMModel
from pydantic import BaseModel, Field


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
    score: float | None
    fetched_at: datetime
    stage: str | None = None
    source: str | None = None
    sample_size: int | None = None
    reasons: list[str] = Field(default_factory=list)
    calculated_at: datetime | None = None
    region: str | None = None
    velocity: float | None = None
    acceleration: float | None = None
    engagement: float | None = None
    usage_growth: float | None = None


class HashtagPage(BaseModel):
    items: list[dict]
    page: int
    page_size: int
    total: int


class TrendImportRequest(BaseModel):
    csv_text: str = Field(min_length=1, max_length=100_000)
    region: str = Field(default="NG", pattern="^(NG|US)$")


class TrendJobRequest(BaseModel):
    regions: list[Annotated[str, Field(pattern="^(NG|US)$")]] | None = Field(
        default=None, max_length=2
    )


# Body for "use in caption": inject trending hashtags into a clip's metadata.
class ApplyTrendsRequest(BaseModel):
    clip_id: int
    hashtags: list[str] = Field(min_length=1)

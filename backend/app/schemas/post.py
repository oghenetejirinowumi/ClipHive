from datetime import datetime

from pydantic import BaseModel, Field

from app.models.enums import PostPlatform, PostStatus
from app.schemas.clip import ClipRead
from app.schemas.common import ORMModel


# POST /hub/clips/{id}/post
class PostRequest(BaseModel):
    platforms: list[PostPlatform] = Field(min_length=1)
    caption: str | None = Field(default=None, max_length=2200)  # TikTok's title limit
    hashtags: list[str] | None = None  # overrides the clip's hashtags if given
    schedule_at: datetime | None = None  # None means post now


class PostRead(ORMModel):
    id: int
    clip_id: int
    platform: PostPlatform
    status: PostStatus
    platform_post_id: str | None
    posted_at: datetime | None
    error: str | None
    created_at: datetime


class PostResponse(BaseModel):
    clip_id: int
    posts: list[PostRead]


# GET /hub/clips item: a ready clip plus its posting history
class HubClip(ClipRead):
    posts: list[PostRead] = Field(default_factory=list)
    download_url: str | None = None

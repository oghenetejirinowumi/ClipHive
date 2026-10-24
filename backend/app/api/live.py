"""GET /api/streamers/status: real live status for every monitored channel."""
from __future__ import annotations

from fastapi import APIRouter, Query
from pydantic import BaseModel

from app.api.deps import DbSession, Owner
from app.models.streamer import Streamer
from app.services.ingest import avatars, live

router = APIRouter(prefix="/streamers", tags=["streamers"])


class StreamerStatus(BaseModel):
    streamer_id: int
    live: bool | None  # None = couldn't tell (shown as "couldn't check", never guessed)
    url: str
    title: str | None
    viewers: int | None
    started_at: str | None
    category: str | None
    error: str | None
    source: str
    checked_at: str


@router.get("/status", response_model=list[StreamerStatus])
def streamer_status(user: Owner, db: DbSession, refresh: bool = Query(False, description="Bypass the cache")) -> list[StreamerStatus]:
    streamers = db.query(Streamer).filter(Streamer.user_id == user.id).order_by(Streamer.id).all()
    results = live.check_many([(s.platform, s.username) for s in streamers], refresh=refresh)
    return [StreamerStatus(streamer_id=s.id, **r.as_dict()) for s, r in zip(streamers, results)]


class StreamerAvatar(BaseModel):
    streamer_id: int
    avatar_url: str | None  # None = not found; the UI shows the channel's initial instead


@router.get("/avatars", response_model=list[StreamerAvatar])
def streamer_avatars(user: Owner, db: DbSession) -> list[StreamerAvatar]:
    """Profile pictures for every monitored channel, pulled from the platform (cached a day)."""
    streamers = db.query(Streamer).filter(Streamer.user_id == user.id).order_by(Streamer.id).all()
    urls = avatars.avatar_urls([(s.platform, s.username) for s in streamers])
    return [StreamerAvatar(streamer_id=s.id, avatar_url=u) for s, u in zip(streamers, urls)]

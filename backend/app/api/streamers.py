"""Monitored streamers: add a channel, see if it's live, record it now, clip its latest VOD, or pick one of its videos."""
from __future__ import annotations

import asyncio
from typing import Literal
from urllib.parse import urlparse

from fastapi import APIRouter, BackgroundTasks, HTTPException, Query, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.api.deps import DbSession, Owner
from app.models import Clip, ImportJob, ImportSource, Stream, Streamer, User
from app.models.enums import SourcePlatform
from app.schemas.import_job import ImportRead
from app.schemas.streamer import (
    ChannelHitRead,
    ChannelVideoRead,
    CheckResultRead,
    ClipVideoRequest,
    LatestVodRequest,
    StreamerCreate,
    StreamerRead,
    StreamerUpdate,
    StreamRead,
)
from app.services.agents import scout
from app.services.ingest import channel_search, monitor, pipeline
from app.workers import ingest_worker

router = APIRouter(prefix="/streamers", tags=["streamers"])

SAMPLE_STREAMERS = [
    {"platform": SourcePlatform.TWITCH, "username": "shroud"},
    {"platform": SourcePlatform.KICK, "username": "adinross"},
    {"platform": SourcePlatform.YOUTUBE, "username": "MrBeast"},
]


def seed_sample_streamers(db: Session, user_id: int):
    """Seeds initial sample streamers for testing/demo if none exist."""
    count = db.query(Streamer).filter(Streamer.user_id == user_id).count()
    if count == 0:
        for s in SAMPLE_STREAMERS:
            db.add(Streamer(user_id=user_id, platform=s["platform"], username=s["username"], is_active=True))
        db.commit()


def _read(s: Streamer) -> StreamerRead:
    live = monitor.cached(s.id)
    return StreamerRead.model_validate(s).model_copy(update={
        "is_live": bool(live and live.is_live),
        "live_title": live.title if live else None,
        "live_checked_at": live.checked_at if live else None,
        "live_error": live.error if live else None,
        "recording": ingest_worker.is_recording(s.id),
        "channel_url": monitor.channel_url(s.platform, s.username),
    })


def _owned(db: Session, streamer_id: int, user: User) -> Streamer:
    streamer = db.get(Streamer, streamer_id)
    if streamer is None or streamer.user_id != user.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Streamer not found.")
    return streamer


@router.get("", response_model=list[StreamerRead])
def list_streamers(user: Owner, db: DbSession) -> list[StreamerRead]:
    rows = db.scalars(select(Streamer).where(Streamer.user_id == user.id).order_by(Streamer.id))
    return [_read(s) for s in rows]


@router.get("/search", response_model=list[ChannelHitRead])
def search_channels(user: Owner, platform: SourcePlatform, q: str = Query(min_length=1, max_length=60)) -> list[dict]:
    """Channel suggestions as you type a name (no API keys needed)."""
    try:
        return channel_search.search(platform, q)
    except channel_search.SearchError as err:
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, str(err)) from err


@router.post("", response_model=StreamerRead, status_code=status.HTTP_201_CREATED)
def add_streamer(payload: StreamerCreate, user: Owner, db: DbSession, background: BackgroundTasks) -> StreamerRead:
    username = monitor.clean_username(payload.username)
    if not username:
        raise HTTPException(422, "Enter a channel username.")
    # Channel names are case-insensitive on Twitch, Kick and YouTube.
    existing = db.scalar(select(Streamer).where(
        Streamer.user_id == user.id, Streamer.platform == payload.platform, func.lower(Streamer.username) == username.lower(),
    ))
    if existing:
        return _read(existing)

    streamer = Streamer(user_id=user.id, platform=payload.platform, username=username, is_active=True)
    db.add(streamer)
    db.commit()
    db.refresh(streamer)
    # First live check right away, so the list shows a real status without waiting for the poll.
    background.add_task(monitor.check, streamer.id, streamer.platform, streamer.username)
    return _read(streamer)


@router.patch("/{streamer_id}", response_model=StreamerRead)
def update_streamer(streamer_id: int, payload: StreamerUpdate, user: Owner, db: DbSession) -> StreamerRead:
    streamer = _owned(db, streamer_id, user)
    if payload.is_active is not None:
        streamer.is_active = payload.is_active
        if not payload.is_active:
            ingest_worker.stop_recording(streamer.id)
    db.commit()
    db.refresh(streamer)
    return _read(streamer)


@router.delete("/{streamer_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_streamer(streamer_id: int, user: Owner, db: DbSession) -> None:
    streamer = _owned(db, streamer_id, user)
    ingest_worker.stop_recording(streamer.id)
    db.delete(streamer)
    db.commit()
    monitor.forget(streamer_id)


@router.post("/{streamer_id}/check", response_model=StreamerRead)
def check_streamer(streamer_id: int, user: Owner, db: DbSession) -> StreamerRead:
    """Check live status now instead of waiting for the next poll."""
    streamer = _owned(db, streamer_id, user)
    monitor.check(streamer.id, streamer.platform, streamer.username)
    return _read(streamer)


@router.post("/{streamer_id}/record", response_model=StreamRead, status_code=status.HTTP_202_ACCEPTED)
def record_now(streamer_id: int, user: Owner, db: DbSession) -> StreamRead:
    """Start recording the live broadcast now, even one that was stopped earlier."""
    streamer = _owned(db, streamer_id, user)
    if ingest_worker.is_recording(streamer.id):
        raise HTTPException(status.HTTP_409_CONFLICT, "Already recording this channel.")
    live = monitor.check(streamer.id, streamer.platform, streamer.username)
    if not live.is_live:
        raise HTTPException(status.HTTP_409_CONFLICT, live.error or f"{streamer.username} isn't live right now. Clip their latest VOD instead.")
    row = ingest_worker.start_recording(streamer.id, live, force=True)
    if row is None:
        raise HTTPException(status.HTTP_409_CONFLICT, "Already recording this channel.")
    return StreamRead.model_validate(row)


@router.post("/{streamer_id}/stop", response_model=StreamerRead)
def stop_now(streamer_id: int, user: Owner, db: DbSession) -> StreamerRead:
    """Stop recording. The part already recorded is still clipped; it won't restart by itself."""
    streamer = _owned(db, streamer_id, user)
    if not ingest_worker.stop_recording(streamer.id):
        raise HTTPException(status.HTTP_409_CONFLICT, "This channel isn't being recorded.")
    return _read(streamer)


@router.post("/{streamer_id}/latest-vod", response_model=ImportRead, status_code=status.HTTP_202_ACCEPTED)
def clip_latest_vod(streamer_id: int, user: Owner, db: DbSession, payload: LatestVodRequest | None = None) -> ImportJob:
    """Find the channel's most recent past broadcast and run it through the import pipeline."""
    streamer = _owned(db, streamer_id, user)
    payload = payload or LatestVodRequest()
    try:
        url = monitor.latest_vod_url(streamer.platform, streamer.username)
    except monitor.NoVodError as err:
        raise HTTPException(status.HTTP_404_NOT_FOUND, str(err)) from err
    job = ImportJob(
        user_id=user.id, source=ImportSource(streamer.platform.value), url=url,
        title=f"{streamer.username} · latest VOD", clip_count=payload.clip_count, clip_seconds=payload.clip_seconds,
    )
    db.add(job)
    db.commit()
    db.refresh(job)
    pipeline.submit(job.id)
    return job


# Hosts a picked video may come from, per platform (the picker only offers the channel's own).
_VIDEO_HOSTS = {
    SourcePlatform.TWITCH: ("twitch.tv",),
    SourcePlatform.KICK: ("kick.com",),
    SourcePlatform.YOUTUBE: ("youtube.com", "youtu.be"),
}


@router.get("/{streamer_id}/videos", response_model=list[ChannelVideoRead])
def list_channel_videos(
    streamer_id: int, user: Owner, db: DbSession,
    tab: Literal["streams", "videos"] | None = None, limit: int = Query(default=24, ge=1, le=50),
) -> list[ChannelVideoRead]:
    """The channel's recent videos, newest first, so the user can choose which one to clip.
    `tab` is YouTube only: past streams or uploads."""
    streamer = _owned(db, streamer_id, user)
    platform, username = streamer.platform, streamer.username
    db.close()  # don't hold the session during the network call
    try:
        videos = scout.list_latest(platform, username, limit=limit, tab=tab if platform == SourcePlatform.YOUTUBE else None)
    except RuntimeError as err:
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, str(err)) from err
    return [ChannelVideoRead(**v.__dict__) for v in videos]


@router.post("/{streamer_id}/clip-video", response_model=ImportRead, status_code=status.HTTP_202_ACCEPTED)
def clip_video(streamer_id: int, payload: ClipVideoRequest, user: Owner, db: DbSession) -> ImportJob:
    """Clip one video the user picked from the channel's list (instead of only the newest)."""
    streamer = _owned(db, streamer_id, user)
    host = (urlparse(payload.url).hostname or "").lower()
    if urlparse(payload.url).scheme not in ("http", "https") or not any(host == h or host.endswith(f".{h}") for h in _VIDEO_HOSTS[streamer.platform]):
        raise HTTPException(422, f"That isn't a {streamer.platform.value.title()} video link.")
    job = ImportJob(
        user_id=user.id, source=ImportSource(streamer.platform.value), url=payload.url,
        title=(payload.title or f"{streamer.username} · video")[:200],
        clip_count=payload.clip_count, clip_seconds=payload.clip_seconds, layout="fill",
        agent_brief={"origin": "picked", "streamer": streamer.username, "platform_source": streamer.platform.value},
    )
    db.add(job)
    db.commit()
    db.refresh(job)
    pipeline.submit(job.id)
    return job


@router.get("/{streamer_id}/streams", response_model=list[StreamRead])
def list_streams(streamer_id: int, user: Owner, db: DbSession) -> list[StreamRead]:
    """Recorded segments for this channel, newest first, with the clips each produced."""
    _owned(db, streamer_id, user)
    rows = list(db.scalars(select(Stream).where(Stream.streamer_id == streamer_id).order_by(Stream.id.desc()).limit(50)))
    clip_ids: dict[int, list[int]] = {}
    for clip_id, stream_id in db.execute(select(Clip.id, Clip.stream_id).where(Clip.stream_id.in_([r.id for r in rows]))):
        clip_ids.setdefault(stream_id, []).append(clip_id)
    return [StreamRead.model_validate(r).model_copy(update={"clip_ids": clip_ids.get(r.id, [])}) for r in rows]


@router.post("/{streamer_id}/check-now", response_model=CheckResultRead)
async def check_now(streamer_id: int, user: Owner, db: DbSession):
    """Scout this channel right now. If it has a VOD we haven't clipped, start clipping it
    (on a channel's first check, its newest VOD)."""
    streamer = _owned(db, streamer_id, user)
    user_id = streamer.user_id
    db.close()  # don't hold the request's session open during the network check
    results = await asyncio.to_thread(scout.run_scout, user_id, [streamer_id], True)
    if not results:
        raise HTTPException(status_code=409, detail="That channel is paused. Resume it first.")
    return results[0].__dict__

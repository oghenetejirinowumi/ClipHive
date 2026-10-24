"""Scout agent: watches monitored channels for new VODs and starts imports by itself.

VOD-first, like the rest of ClipHive: we never record live streams. yt-dlp lists a
channel's newest videos without downloading anything; a video we haven't seen becomes an
ImportJob that the Producer agent then clips.

The background loop records the newest video the first time it sees a channel (so adding a
big channel doesn't import its back catalogue). "Check now" imports the newest VOD right away.
"""
from __future__ import annotations

import asyncio
import logging
import threading
from dataclasses import dataclass
from datetime import UTC, datetime

from yt_dlp import YoutubeDL

from app.config import settings
from app.db import SessionLocal
from app.models import ImportJob, ImportSource, SourcePlatform, Streamer
from app.services.agents import events

logger = logging.getLogger("cliphive.agents.scout")

_check_lock = threading.Lock()


@dataclass
class LatestVideo:
    id: str
    url: str
    title: str
    thumbnail: str | None = None
    duration_s: float | None = None
    published_at: datetime | None = None


# YouTube channel tabs a user can browse when picking a video by hand.
YOUTUBE_TABS = ("streams", "videos")


def channel_url(platform: SourcePlatform | str, username: str, tab: str = "streams") -> str:
    name = username.strip().lstrip("@")
    platform = SourcePlatform(platform)
    if platform == SourcePlatform.TWITCH:
        return f"https://www.twitch.tv/{name}/videos?filter=archives&sort=time"
    if platform == SourcePlatform.YOUTUBE:
        from app.services.ingest import monitor

        return f"{monitor.channel_url(platform, name)}/{tab}"
    return f"https://kick.com/{name}/videos"


def _youtube_videos_url(username: str) -> str:
    return channel_url(SourcePlatform.YOUTUBE, username, "videos")


def _thumbnail(entry: dict) -> str | None:
    if entry.get("thumbnail"):
        return entry["thumbnail"]
    thumbs = [t for t in entry.get("thumbnails") or [] if t.get("url")]
    # Flat YouTube entries list small to large; the largest is still a light JPEG.
    return thumbs[-1]["url"] if thumbs else None


def _published(entry: dict) -> datetime | None:
    if entry.get("timestamp"):
        return datetime.fromtimestamp(entry["timestamp"], UTC)
    if entry.get("upload_date"):
        try:
            return datetime.strptime(entry["upload_date"], "%Y%m%d").replace(tzinfo=UTC)
        except ValueError:
            return None
    return None


def _kick_videos(username: str, limit: int) -> list[LatestVideo]:
    """Kick's own channel API: yt-dlp can fetch a Kick VOD but can't list a channel's."""
    import requests

    from app.services.ingest import monitor

    name = monitor.clean_username(username)
    try:
        resp = requests.get(f"https://kick.com/api/v2/channels/{name}/videos", headers=monitor._UA, timeout=15)
        resp.raise_for_status()
        items = resp.json()
    except (requests.RequestException, ValueError) as err:
        raise RuntimeError("Kick didn't return this channel's videos (it sometimes blocks servers). Paste a VOD link on the Create page instead.") from err
    videos = []
    for item in items if isinstance(items, list) else []:
        uuid = (item.get("video") or {}).get("uuid")
        if not uuid or item.get("is_live"):
            continue
        started = item.get("start_time") or item.get("created_at")
        try:
            published = datetime.fromisoformat(started.replace("Z", "+00:00")) if started else None
        except ValueError:
            published = None
        if published and published.tzinfo is None:
            published = published.replace(tzinfo=UTC)
        videos.append(LatestVideo(
            id=str(uuid), url=f"https://kick.com/video/{uuid}", title=(item.get("session_title") or "Untitled")[:300],
            thumbnail=(item.get("thumbnail") or {}).get("src"),
            duration_s=(item.get("duration") or 0) / 1000 or None,  # Kick reports milliseconds
            published_at=published,
        ))
    if not videos:
        raise RuntimeError(f"{name} has no past broadcasts on Kick.")
    return videos[:limit]


def _entry_url(entry: dict, platform: SourcePlatform) -> str | None:
    url = entry.get("url") or entry.get("webpage_url")
    if url and url.startswith("http"):
        return url
    vid = entry.get("id")
    if not vid:
        return None
    if platform == SourcePlatform.YOUTUBE:
        return f"https://www.youtube.com/watch?v={vid}"
    if platform == SourcePlatform.TWITCH:
        return f"https://www.twitch.tv/videos/{str(vid).lstrip('v')}"
    return None


def list_latest(platform: SourcePlatform | str, username: str, limit: int = 3, tab: str | None = None) -> list[LatestVideo]:
    """Newest videos on a channel, newest first. Raises RuntimeError with a readable message.

    `tab` picks one YouTube tab ("streams" or "videos"); without it, past streams are tried
    first and uploads after, for channels that never stream. With a tab, a tab that's empty or
    doesn't exist on the channel is an empty list, not an error (the picker just shows none)."""
    platform = SourcePlatform(platform)
    if platform == SourcePlatform.KICK:
        return _kick_videos(username, limit)
    opts = {"quiet": True, "no_warnings": True, "extract_flat": "in_playlist", "playlistend": limit, "skip_download": True}
    from app.services.ingest import youtube_guard

    opts.update(youtube_guard.opts())  # polite retries, optional proxy and cookies
    if platform == SourcePlatform.YOUTUBE and tab:
        urls = [channel_url(platform, username, tab)]
    else:
        urls = [channel_url(platform, username)]
        if platform == SourcePlatform.YOUTUBE:
            urls.append(_youtube_videos_url(username))  # channels without past streams

    last_error = "No videos found on that channel."
    for url in urls:
        try:
            if youtube_guard.is_youtube(url):
                youtube_guard.pace()
            with YoutubeDL(opts) as ydl:
                info = ydl.extract_info(url, download=False)
        except youtube_guard.YouTubeCoolingDown as err:
            raise RuntimeError(str(err)) from err
        except Exception as err:
            youtube_guard.report(err)
            logger.info("Channel listing %s failed: %s", url, err)
            text = str(err).lower()
            if tab and "does not have a" in text and "tab" in text:
                return []  # e.g. a channel that has never streamed has no Past streams tab
            if youtube_guard.is_rate_limit(text) or "sign in to confirm" in text:
                name = {"youtube": "YouTube"}.get(platform.value, platform.value.title())
                last_error = (f"{name} is blocking ClipHive's requests right now (it asks us to confirm "
                              "we're not a bot). Try again in an hour, or download the video and upload it on the Create page.")
            elif "unsupported url" in text:
                last_error = f"{platform.value.title()} channel listing isn't supported yet."
            elif "does not exist" in text or "404" in text or "not found" in text:
                last_error = "Channel not found."
            else:
                last_error = "Couldn't reach the channel."
            continue
        videos = []
        for entry in (info or {}).get("entries") or []:
            if not entry or entry.get("live_status") in ("is_live", "is_upcoming"):
                continue
            link = _entry_url(entry, platform)
            if link and entry.get("id"):
                videos.append(LatestVideo(
                    id=str(entry["id"]), url=link, title=(entry.get("title") or "Untitled")[:300],
                    thumbnail=_thumbnail(entry), duration_s=entry.get("duration"), published_at=_published(entry),
                ))
        if videos or tab:
            return videos[:limit]
    raise RuntimeError(last_error)


def _source_for(platform: SourcePlatform) -> ImportSource:
    return {SourcePlatform.TWITCH: ImportSource.TWITCH, SourcePlatform.KICK: ImportSource.KICK}.get(platform, ImportSource.YOUTUBE)


@dataclass
class CheckResult:
    streamer_id: int
    status: str  # new_vod | no_change | first_seen | error
    message: str
    import_job_id: int | None = None


def check_streamer(streamer_id: int, run_id: int, import_if_first: bool) -> CheckResult:
    """Check one channel; start an import if there's a new VOD."""
    from app.services.ingest import pipeline

    with SessionLocal() as db:
        s = db.get(Streamer, streamer_id)
        if s is None:
            return CheckResult(streamer_id, "error", "Channel was removed.")
        platform, username, user_id, seen = s.platform, s.username, s.user_id, s.last_seen_video_id
    label = f"{platform.value}/{username}"

    try:
        videos = list_latest(platform, username)
    except RuntimeError as err:
        with SessionLocal() as db:
            s = db.get(Streamer, streamer_id)
            if s:
                s.last_checked_at, s.last_check_error = datetime.now(UTC), str(err)[:300]
                db.commit()
        events.log(run_id, "error", f"{label}: {err}")
        return CheckResult(streamer_id, "error", str(err))

    newest = videos[0]
    is_new = newest.id != seen
    first_time = seen is None
    start_import = is_new and (not first_time or import_if_first)

    job_id = None
    with SessionLocal() as db:
        s = db.get(Streamer, streamer_id)
        if s is None:
            return CheckResult(streamer_id, "error", "Channel was removed.")
        s.last_checked_at, s.last_check_error = datetime.now(UTC), None
        s.last_seen_video_id, s.last_seen_video_url, s.last_seen_video_title = newest.id, newest.url, newest.title
        if start_import:
            job = ImportJob(
                user_id=user_id,
                source=_source_for(platform),
                url=newest.url,
                title=newest.title[:200],
                clip_count=5,
                clip_seconds=30,
                layout="blur",
                agent_brief={"origin": "scout", "streamer": username, "platform_source": platform.value},
            )
            db.add(job)
        db.commit()
        if start_import:
            job_id = job.id

    if start_import:
        pipeline.submit(job_id)
        events.log(run_id, "decision", f'New VOD on {label}: "{newest.title}". Started an import.', {"verdict": "kept", "import_job_id": job_id, "url": newest.url})
        events.notify(user_id, f"New stream from {username}", f'Clipping "{newest.title}" now.', "/create")
        return CheckResult(streamer_id, "new_vod", f'Found "{newest.title}" and started clipping it.', job_id)
    if first_time:
        events.log(run_id, "thought", f'{label}: now watching. Latest is "{newest.title}"; I\'ll clip the next one.')
        return CheckResult(streamer_id, "first_seen", f'Now watching. Latest video is "{newest.title}"; the next new one will be clipped.')
    events.log(run_id, "thought", f"{label}: no new videos")
    return CheckResult(streamer_id, "no_change", "No new videos since the last check.")


def run_scout(user_id: int | None = None, streamer_ids: list[int] | None = None, import_if_first: bool = False) -> list[CheckResult]:
    """One Scout pass over active channels (optionally only some). Logs a Scout run per user."""
    with _check_lock:
        with SessionLocal() as db:
            q = db.query(Streamer).filter(Streamer.is_active.is_(True))
            if user_id is not None:
                q = q.filter(Streamer.user_id == user_id)
            if streamer_ids:
                q = q.filter(Streamer.id.in_(streamer_ids))
            by_user: dict[int, list[int]] = {}
            for s in q.order_by(Streamer.id):
                by_user.setdefault(s.user_id, []).append(s.id)

        results: list[CheckResult] = []
        for uid, ids in by_user.items():
            run_id = events.start_run(uid, "scout", goal=f"Check {len(ids)} channel{'s' if len(ids) != 1 else ''} for new VODs", model="built-in")
            user_results = [check_streamer(sid, run_id, import_if_first) for sid in ids]
            results += user_results
            found = sum(r.status == "new_vod" for r in user_results)
            summary = f"Checked {len(ids)} channel{'s' if len(ids) != 1 else ''}: " + (
                f"{found} new VOD{'s' if found != 1 else ''}, clipping now." if found else "nothing new."
            )
            events.finish_run(run_id, "done", summary)
        return results


async def scout_loop() -> None:
    interval = max(1, settings.scout_interval_minutes) * 60
    await asyncio.sleep(30)  # let startup finish first
    while True:
        try:
            await asyncio.to_thread(run_scout)
        except Exception:
            logger.exception("Scout pass failed")
        await asyncio.sleep(interval)

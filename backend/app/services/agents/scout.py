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


def channel_url(platform: SourcePlatform | str, username: str) -> str:
    name = username.strip().lstrip("@")
    platform = SourcePlatform(platform)
    if platform == SourcePlatform.TWITCH:
        return f"https://www.twitch.tv/{name}/videos?filter=archives&sort=time"
    if platform == SourcePlatform.YOUTUBE:
        return f"https://www.youtube.com/@{name}/streams"
    return f"https://kick.com/{name}/videos"


def _youtube_videos_url(username: str) -> str:
    return f"https://www.youtube.com/@{username.strip().lstrip('@')}/videos"


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


def list_latest(platform: SourcePlatform | str, username: str, limit: int = 3) -> list[LatestVideo]:
    """Newest videos on a channel, newest first. Raises RuntimeError with a readable message."""
    platform = SourcePlatform(platform)
    opts = {"quiet": True, "no_warnings": True, "extract_flat": "in_playlist", "playlistend": limit, "skip_download": True}
    from app.services.ingest import youtube_guard

    opts.update(youtube_guard.opts())  # polite retries, optional proxy and cookies
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
            text = str(err).lower()
            if "unsupported url" in text:
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
                videos.append(LatestVideo(id=str(entry["id"]), url=link, title=(entry.get("title") or "Untitled")[:300]))
        if videos:
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
            run_id = events.start_run(uid, "scout", goal=f"Check {len(ids)} channel{'s' if len(ids) != 1 else ''} for new VODs", model="yt-dlp")
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

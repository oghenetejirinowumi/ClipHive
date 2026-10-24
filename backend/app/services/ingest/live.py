"""Real live status for monitored channels: is this Twitch / Kick / YouTube channel live right now?

Twitch uses the official Helix API when TWITCH_CLIENT_ID/SECRET are set (fast, with title and
viewers), else yt-dlp. Kick uses its public channel API, falling back to yt-dlp. YouTube uses
yt-dlp on the channel's /live page. A failed check is reported as unknown, never guessed.
Results are cached for settings.live_poll_interval_s.
"""
from __future__ import annotations

import threading
import time
from concurrent.futures import ThreadPoolExecutor
from dataclasses import asdict, dataclass, field
from datetime import UTC, datetime

import requests
from yt_dlp import YoutubeDL

from app.services.ingest import youtube_guard
from yt_dlp.utils import DownloadError

from app.config import settings
from app.models.enums import SourcePlatform

BROWSER_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36"


@dataclass
class LiveStatus:
    live: bool | None  # None = couldn't tell
    url: str
    title: str | None = None
    viewers: int | None = None
    started_at: str | None = None
    category: str | None = None
    error: str | None = None
    source: str = ""  # which check answered: helix / kick-api / yt-dlp
    checked_at: str = field(default_factory=lambda: datetime.now(UTC).isoformat())

    def as_dict(self) -> dict:
        return asdict(self)


_cache: dict[tuple[str, str], tuple[float, LiveStatus]] = {}
_lock = threading.Lock()
_helix_token: dict[str, float | str] = {}


def channel_url(platform: SourcePlatform, username: str) -> str:
    name = username.strip().lstrip("@")
    if platform == SourcePlatform.TWITCH:
        return f"https://www.twitch.tv/{name}"
    if platform == SourcePlatform.KICK:
        return f"https://kick.com/{name}"
    if name.startswith("UC") and len(name) == 24:  # a YouTube channel id
        return f"https://www.youtube.com/channel/{name}/live"
    return f"https://www.youtube.com/@{name}/live"


# ------------------------------------------------------------------ per-platform checks


def _ytdlp(url: str) -> LiveStatus:
    from app.services.ingest.downloader import _base_opts

    youtube = youtube_guard.is_youtube(url)
    if youtube:
        try:
            youtube_guard.pace()
        except youtube_guard.YouTubeCoolingDown as err:
            return LiveStatus(live=None, url=url, source="yt-dlp", error=str(err))
    try:
        with YoutubeDL({**_base_opts(), "skip_download": True}) as ydl:
            info = ydl.extract_info(url, download=False, process=False)
    except DownloadError as err:
        if youtube:
            youtube_guard.report(err)
        text = str(err).lower()
        if "not currently live" in text or "is offline" in text or "will begin" in text or "premieres in" in text:
            return LiveStatus(live=False, url=url, source="yt-dlp")
        if "not a bot" in text or "429" in text or "too many requests" in text:
            return LiveStatus(live=None, url=url, source="yt-dlp", error="Rate-limited by the platform. Try again in a while.")
        if "does not exist" in text or "404" in text or "not found" in text:
            return LiveStatus(live=None, url=url, source="yt-dlp", error="Channel not found. Check the username.")
        return LiveStatus(live=None, url=url, source="yt-dlp", error="Couldn't reach the platform.")
    live = bool(info.get("is_live")) or info.get("live_status") == "is_live"
    return LiveStatus(
        live=live, url=url, source="yt-dlp",
        title=info.get("description") or None if live else None,
        viewers=info.get("concurrent_view_count"),
        started_at=datetime.fromtimestamp(info["release_timestamp"], UTC).isoformat() if info.get("release_timestamp") else None,
    )


def _helix_headers() -> dict[str, str] | None:
    if not (settings.twitch_client_id and settings.twitch_client_secret):
        return None
    if not _helix_token or float(_helix_token.get("expires", 0)) < time.time() + 60:
        resp = requests.post(
            "https://id.twitch.tv/oauth2/token",
            params={"client_id": settings.twitch_client_id, "client_secret": settings.twitch_client_secret, "grant_type": "client_credentials"},
            timeout=15,
        )
        resp.raise_for_status()
        data = resp.json()
        _helix_token.update(token=data["access_token"], expires=time.time() + data.get("expires_in", 3600))
    return {"Client-Id": settings.twitch_client_id, "Authorization": f"Bearer {_helix_token['token']}"}


def _twitch(username: str) -> LiveStatus:
    url = channel_url(SourcePlatform.TWITCH, username)
    try:
        headers = _helix_headers()
    except requests.RequestException:
        headers = None
    if headers:
        try:
            resp = requests.get("https://api.twitch.tv/helix/streams", params={"user_login": username}, headers=headers, timeout=15)
            resp.raise_for_status()
            streams = resp.json().get("data") or []
            if not streams:
                return LiveStatus(live=False, url=url, source="helix")
            s = streams[0]
            return LiveStatus(live=True, url=url, source="helix", title=s.get("title"), viewers=s.get("viewer_count"), started_at=s.get("started_at"), category=s.get("game_name"))
        except requests.RequestException:
            pass  # fall through to yt-dlp
    return _ytdlp(url)


def _kick(username: str) -> LiveStatus:
    url = channel_url(SourcePlatform.KICK, username)
    try:
        resp = requests.get(f"https://kick.com/api/v2/channels/{username}", headers={"User-Agent": BROWSER_UA, "Accept": "application/json"}, timeout=15)
        if resp.status_code == 404:
            return LiveStatus(live=None, url=url, source="kick-api", error="Channel not found. Check the username.")
        if resp.ok:
            stream = resp.json().get("livestream")
            if not stream:
                return LiveStatus(live=False, url=url, source="kick-api")
            categories = stream.get("categories") or []
            return LiveStatus(
                live=True, url=url, source="kick-api", title=stream.get("session_title"), viewers=stream.get("viewer_count"),
                started_at=stream.get("start_time") or stream.get("created_at"), category=(categories[0] or {}).get("name") if categories else None,
            )
    except (requests.RequestException, ValueError):
        pass  # Kick sometimes blocks API calls behind Cloudflare; yt-dlp knows how to get through
    return _ytdlp(url)


def _check_uncached(platform: SourcePlatform, username: str) -> LiveStatus:
    if platform == SourcePlatform.TWITCH:
        return _twitch(username)
    if platform == SourcePlatform.KICK:
        return _kick(username)
    return _ytdlp(channel_url(platform, username))


# ------------------------------------------------------------------ public API


def check(platform: SourcePlatform, username: str, *, refresh: bool = False) -> LiveStatus:
    key = (str(platform), username.lower())
    with _lock:
        hit = _cache.get(key)
    max_age = settings.youtube_live_poll_s if platform == SourcePlatform.YOUTUBE else settings.live_poll_interval_s
    if refresh:  # a manual refresh still won't re-ask YouTube within a minute
        max_age = 60 if platform == SourcePlatform.YOUTUBE else 0
    if hit and time.time() - hit[0] < max_age:
        return hit[1]
    status = _check_uncached(platform, username)
    with _lock:
        _cache[key] = (time.time(), status)
    return status


def check_many(channels: list[tuple[SourcePlatform, str]], *, refresh: bool = False) -> list[LiveStatus]:
    """Check several channels in parallel (each check is a few network round-trips)."""
    if not channels:
        return []
    with ThreadPoolExecutor(max_workers=min(6, len(channels))) as pool:
        return list(pool.map(lambda c: check(c[0], c[1], refresh=refresh), channels))

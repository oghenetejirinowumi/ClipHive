"""Is a streamer live right now, and where is their latest VOD?

Twitch uses the official Helix API when TWITCH_CLIENT_ID/SECRET are set; Kick uses its public
channel endpoint. Anything else (or either of those failing) falls back to yt-dlp, which needs
no keys. Results are cached in memory so the API can show live status without re-checking.
"""
from __future__ import annotations

import logging
import threading
import time
from dataclasses import dataclass, field
from datetime import UTC, datetime

import requests
from yt_dlp import YoutubeDL
from yt_dlp.utils import DownloadError

from app.config import settings
from app.models.enums import SourcePlatform

logger = logging.getLogger("cliphive.monitor")

_UA = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36"}
_TIMEOUT = 15


@dataclass
class LiveStatus:
    is_live: bool
    stream_id: str | None = None  # the platform's id for this broadcast
    title: str | None = None
    error: str | None = None  # set when the check itself failed (we don't know)
    checked_at: datetime = field(default_factory=lambda: datetime.now(UTC))


def clean_username(username: str) -> str:
    name = username.strip().removeprefix("https://").removeprefix("www.")
    for prefix in ("twitch.tv/", "kick.com/", "youtube.com/"):
        name = name.removeprefix(prefix)
    return name.split("/")[0].split("?")[0].lstrip("@")


def channel_url(platform: SourcePlatform, username: str) -> str:
    name = clean_username(username)
    if platform == SourcePlatform.TWITCH:
        return f"https://www.twitch.tv/{name}"
    if platform == SourcePlatform.KICK:
        return f"https://kick.com/{name}"
    # YouTube channel IDs (UC...) and @handles live at different paths.
    if name.startswith("UC") and len(name) == 24:
        return f"https://www.youtube.com/channel/{name}"
    return f"https://www.youtube.com/@{name}"


def live_url(platform: SourcePlatform, username: str) -> str:
    url = channel_url(platform, username)
    return f"{url}/live" if platform == SourcePlatform.YOUTUBE else url


# --- yt-dlp (works for all three, no keys) -----------------------------------------------

class SilentLogger:
    """yt-dlp prints 'ERROR: not currently live' even when quiet; offline is normal here."""

    def debug(self, msg: str) -> None: ...
    def warning(self, msg: str) -> None: ...
    def error(self, msg: str) -> None: ...


def _ydl_opts(**extra) -> dict:
    opts = {"quiet": True, "no_warnings": True, "noprogress": True, "skip_download": True, "logger": SilentLogger(), **extra}
    if settings.ytdlp_cookies_file:
        opts["cookiefile"] = settings.ytdlp_cookies_file
    return opts


_OFFLINE_HINTS = ("not currently live", "is offline", "not live", "will begin", "premieres in", "no video formats", "this live event will begin")


def _check_ytdlp(platform: SourcePlatform, username: str) -> LiveStatus:
    try:
        with YoutubeDL(_ydl_opts()) as ydl:
            info = ydl.extract_info(live_url(platform, username), download=False)
    except DownloadError as err:
        text = str(err).lower()
        if any(hint in text for hint in _OFFLINE_HINTS):
            return LiveStatus(is_live=False)
        if "does not exist" in text or "404" in text or "not found" in text:
            return LiveStatus(is_live=False, error="Channel not found.")
        return LiveStatus(is_live=False, error="Couldn't reach the platform to check live status.")
    if info.get("_type") == "playlist":  # YouTube /live with nothing live can resolve to the channel
        return LiveStatus(is_live=False)
    live = bool(info.get("is_live")) or info.get("live_status") == "is_live"
    return LiveStatus(is_live=live, stream_id=str(info.get("id")) if live else None, title=info.get("title") if live else None)


# --- Twitch Helix -------------------------------------------------------------------------

_twitch_token: tuple[str, float] | None = None
_twitch_lock = threading.Lock()


def _twitch_app_token() -> str:
    global _twitch_token
    with _twitch_lock:
        if _twitch_token and _twitch_token[1] > time.time() + 60:
            return _twitch_token[0]
        resp = requests.post(
            "https://id.twitch.tv/oauth2/token",
            params={"client_id": settings.twitch_client_id, "client_secret": settings.twitch_client_secret, "grant_type": "client_credentials"},
            timeout=_TIMEOUT,
        )
        resp.raise_for_status()
        data = resp.json()
        _twitch_token = (data["access_token"], time.time() + data.get("expires_in", 3600))
        return _twitch_token[0]


def _check_twitch_helix(username: str) -> LiveStatus:
    resp = requests.get(
        "https://api.twitch.tv/helix/streams",
        params={"user_login": clean_username(username)},
        headers={"Client-Id": settings.twitch_client_id, "Authorization": f"Bearer {_twitch_app_token()}"},
        timeout=_TIMEOUT,
    )
    resp.raise_for_status()
    data = resp.json().get("data") or []
    if not data:
        return LiveStatus(is_live=False)
    return LiveStatus(is_live=True, stream_id=str(data[0]["id"]), title=data[0].get("title"))


# --- Kick (unofficial public endpoint; Cloudflare sometimes blocks it) --------------------

def _kick_channel(username: str) -> dict:
    resp = requests.get(f"https://kick.com/api/v2/channels/{clean_username(username)}", headers=_UA, timeout=_TIMEOUT)
    resp.raise_for_status()
    return resp.json()


def _check_kick_api(username: str) -> LiveStatus:
    live = _kick_channel(username).get("livestream")
    if not live:
        return LiveStatus(is_live=False)
    return LiveStatus(is_live=True, stream_id=str(live.get("id")), title=live.get("session_title"))


# --- Public API ---------------------------------------------------------------------------

_cache: dict[int, LiveStatus] = {}
_cache_lock = threading.Lock()


def check(streamer_id: int, platform: SourcePlatform, username: str) -> LiveStatus:
    """Check live status now (a few seconds of network) and cache it under streamer_id."""
    status: LiveStatus | None = None
    try:
        if platform == SourcePlatform.TWITCH and settings.twitch_client_id and settings.twitch_client_secret:
            status = _check_twitch_helix(username)
        elif platform == SourcePlatform.KICK:
            status = _check_kick_api(username)
    except (requests.RequestException, KeyError, ValueError) as err:
        logger.info("Native live check failed for %s/%s (%s); falling back to yt-dlp", platform, username, err)
    if status is None:
        status = _check_ytdlp(platform, username)
    with _cache_lock:
        _cache[streamer_id] = status
    return status


def cached(streamer_id: int) -> LiveStatus | None:
    with _cache_lock:
        return _cache.get(streamer_id)


def forget(streamer_id: int) -> None:
    with _cache_lock:
        _cache.pop(streamer_id, None)


class NoVodError(RuntimeError):
    """No past broadcast found; the message is safe to show to the user."""


def latest_vod_url(platform: SourcePlatform, username: str) -> str:
    """URL of the streamer's most recent past broadcast, ready for the import pipeline."""
    name = clean_username(username)
    if platform == SourcePlatform.KICK:
        try:
            resp = requests.get(f"https://kick.com/api/v2/channels/{name}/videos", headers=_UA, timeout=_TIMEOUT)
            resp.raise_for_status()
            videos = resp.json()
        except (requests.RequestException, ValueError) as err:
            raise NoVodError("Kick didn't return this channel's videos (it sometimes blocks servers). Paste a VOD link on the Create page instead.") from err
        uuid = next((v.get("video", {}).get("uuid") for v in videos if v.get("video", {}).get("uuid")), None)
        if not uuid:
            raise NoVodError(f"{name} has no past broadcasts on Kick.")
        return f"https://kick.com/video/{uuid}"

    if platform == SourcePlatform.TWITCH:
        listings = [f"https://www.twitch.tv/{name}/videos?filter=archives&sort=time"]
    else:
        listings = [f"{channel_url(platform, username)}/streams", f"{channel_url(platform, username)}/videos"]

    for listing in [url for url in listings for _ in range(2)]:  # each listing gets one retry
        try:
            with YoutubeDL(_ydl_opts(extract_flat="in_playlist", playlistend=5)) as ydl:
                info = ydl.extract_info(listing, download=False)
        except DownloadError as err:
            logger.info("VOD listing %s failed: %s", listing, err)
            continue
        for entry in info.get("entries") or []:
            if entry and entry.get("live_status") not in ("is_live", "is_upcoming"):
                url = entry.get("url") or entry.get("webpage_url")
                if url:
                    return url if url.startswith("http") else f"https://www.youtube.com/watch?v={entry['id']}"
    raise NoVodError(f"Couldn't find a past broadcast for {name}.")

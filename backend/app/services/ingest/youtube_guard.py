"""Keep ClipHive on YouTube's good side.

YouTube flags an IP that makes too many anonymous requests ("Sign in to confirm you're not a
bot"), and every request made while flagged extends the block. So every yt-dlp call that can
touch YouTube goes through here:

* pace()   spaces YouTube page/API requests at least MIN_GAP_S apart, process-wide.
* blocked  is set the moment any caller sees a bot/429 response (report()). While it's set,
           callers fail fast with a clear message instead of asking again. The first cooldown is
           30 min and doubles for a repeat within a day (max 4 h). It's saved under storage/, so
           a server restart doesn't forget it and go knocking straight away.
* opts()   yt-dlp options every caller should merge in: polite retries/sleeps, the optional
           YTDLP_PROXY (route only downloads through a proxy/VPN), and YTDLP_COOKIES_FILE.
"""
from __future__ import annotations

import json
import logging
import threading
import time
from datetime import datetime

from app.config import settings
from app.core.media import storage_root

logger = logging.getLogger("cliphive.youtube")

MIN_GAP_S = 1.0
FIRST_COOLDOWN_S = 30 * 60
MAX_COOLDOWN_S = 4 * 3600
REPEAT_WINDOW_S = 24 * 3600

_lock = threading.Lock()
_last_request = 0.0


class YouTubeCoolingDown(RuntimeError):
    """YouTube flagged us recently; we're deliberately not asking again yet."""


def is_youtube(url: str | None) -> bool:
    u = (url or "").lower()
    return "youtube.com" in u or "youtu.be" in u


def is_rate_limit(text: str) -> bool:
    t = text.lower()
    return "not a bot" in t or "too many requests" in t or "http error 429" in t or " 429" in t


def _state_file():
    return storage_root() / "youtube_cooldown.json"


def _state() -> dict:
    try:
        return json.loads(_state_file().read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}


def blocked_until() -> float:
    """Unix time the cooldown ends, or 0 if YouTube can be asked now."""
    until = float(_state().get("until", 0))
    return until if until > time.time() else 0.0


def cooldown_message() -> str:
    until = blocked_until()
    when = datetime.fromtimestamp(until).strftime("%H:%M") if until else "a little while"
    return (f"YouTube imports are paused until about {when}. Please try again then, or upload the video file "
            "instead. Twitch and Kick links still work.")


def check() -> None:
    """Raise YouTubeCoolingDown if we're in a cooldown."""
    if blocked_until():
        raise YouTubeCoolingDown(cooldown_message())


def pace() -> None:
    """Fail fast during a cooldown, otherwise wait so YouTube requests stay MIN_GAP_S apart."""
    global _last_request
    check()
    with _lock:
        wait = _last_request + MIN_GAP_S - time.monotonic()
        if wait > 0:
            time.sleep(wait)
        _last_request = time.monotonic()


def report(err: BaseException | str) -> None:
    """Call with any yt-dlp error from a YouTube request; starts a cooldown if it was a bot/429 flag."""
    if not is_rate_limit(str(err)):
        return
    with _lock:
        state = _state()
        now = time.time()
        if float(state.get("until", 0)) > now:
            return  # already cooling down
        repeat = now - float(state.get("last_flag", 0)) < REPEAT_WINDOW_S
        seconds = min(MAX_COOLDOWN_S, int(state.get("seconds", FIRST_COOLDOWN_S)) * 2) if repeat else FIRST_COOLDOWN_S
        state = {"until": now + seconds, "seconds": seconds, "last_flag": now}
        try:
            _state_file().parent.mkdir(parents=True, exist_ok=True)
            _state_file().write_text(json.dumps(state), encoding="utf-8")
        except OSError:
            pass
    logger.warning("YouTube flagged this server; pausing YouTube requests for %d min", seconds // 60)


def opts() -> dict:
    """yt-dlp options that keep request volume and retries polite."""
    o: dict = {
        "retries": 3,
        "extractor_retries": 1,  # don't hammer the page when it refuses
        "sleep_interval_requests": 0.5,  # gap between the page/API requests of one extraction
    }
    if settings.ytdlp_proxy:
        o["proxy"] = settings.ytdlp_proxy
    if settings.ytdlp_cookies_file:
        o["cookiefile"] = settings.ytdlp_cookies_file
    return o

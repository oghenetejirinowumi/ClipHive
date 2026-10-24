"""Channel profile pictures for monitored streamers (Twitch, Kick, YouTube).

No API keys needed: every channel page carries its avatar in the `og:image` meta tag. Kick's
public channel API is tried first (cheaper), and Twitch Helix when its keys are set. Only URLs on
the platforms' own image hosts are returned. Results are cached in memory: hits for a day,
misses for an hour so a typo'd channel isn't re-fetched on every page load.
"""
from __future__ import annotations

import html
import logging
import re
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from urllib.parse import urlparse

import requests

from app.config import settings
from app.models.enums import SourcePlatform
from app.services.ingest import monitor

logger = logging.getLogger("cliphive.avatars")

_UA = {
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36",
    "Accept-Language": "en",
}
_TIMEOUT = 10
_HIT_TTL = 24 * 3600
_MISS_TTL = 3600

# Image hosts each platform serves avatars from. Anything else is ignored.
_HOSTS: dict[SourcePlatform, tuple[str, ...]] = {
    SourcePlatform.TWITCH: ("static-cdn.jtvnw.net",),
    SourcePlatform.KICK: ("files.kick.com", "kick.com"),
    SourcePlatform.YOUTUBE: ("yt3.googleusercontent.com", "yt3.ggpht.com", "lh3.googleusercontent.com"),
}

# Any <meta> tag, then its attributes; sites put `property` and `content` in either order.
_META = re.compile(r"<meta\b[^>]*>", re.IGNORECASE)
_ATTR = re.compile(r'([a-zA-Z:-]+)\s*=\s*"([^"]*)"')

_cache: dict[tuple[str, str], tuple[float, str | None]] = {}
_lock = threading.Lock()


def _allowed(platform: SourcePlatform, url: str | None) -> str | None:
    if not url:
        return None
    parsed = urlparse(url)
    host = (parsed.hostname or "").lower()
    if parsed.scheme != "https" or not any(host == h or host.endswith(f".{h}") for h in _HOSTS.get(platform, ())):
        return None
    return url


# Skips YouTube's cookie-consent interstitial, which has no og:image.
_CONSENT = {"SOCS": "CAI", "CONSENT": "YES+cb"}


def _og_image(page_url: str) -> str | None:
    resp = requests.get(page_url, headers=_UA, cookies=_CONSENT, timeout=_TIMEOUT)
    resp.raise_for_status()
    for tag in _META.findall(resp.text):
        attrs = {k.lower(): v for k, v in _ATTR.findall(tag)}
        if (attrs.get("property") or attrs.get("name")) == "og:image" and attrs.get("content"):
            return html.unescape(attrs["content"])
    return None


def _twitch(username: str) -> str | None:
    if settings.twitch_client_id and settings.twitch_client_secret:
        try:
            resp = requests.get(
                "https://api.twitch.tv/helix/users",
                params={"login": username},
                headers={"Client-Id": settings.twitch_client_id, "Authorization": f"Bearer {monitor._twitch_app_token()}"},
                timeout=_TIMEOUT,
            )
            resp.raise_for_status()
            users = resp.json().get("data") or []
            if users:
                return users[0].get("profile_image_url")
        except (requests.RequestException, KeyError, ValueError):
            pass  # fall back to the channel page
    url = _og_image(monitor.channel_url(SourcePlatform.TWITCH, username))
    # Twitch serves a generic share image for channels that don't exist.
    return url if url and "profile_image" in url else None


def _kick(username: str) -> str | None:
    try:
        user = monitor._kick_channel(username).get("user") or {}
        if user.get("profile_pic"):
            return user["profile_pic"]
    except (requests.RequestException, ValueError):
        pass  # Cloudflare sometimes blocks the API; the page usually still works
    return _og_image(monitor.channel_url(SourcePlatform.KICK, username))


def _fetch(platform: SourcePlatform, username: str) -> str | None:
    name = monitor.clean_username(username)
    try:
        if platform == SourcePlatform.TWITCH:
            url = _twitch(name)
        elif platform == SourcePlatform.KICK:
            url = _kick(name)
        else:
            url = _og_image(monitor.channel_url(SourcePlatform.YOUTUBE, name))
    except requests.RequestException as err:
        logger.info("Avatar lookup failed for %s/%s: %s", platform, name, err)
        url = None
    return _allowed(platform, url)


def avatar_url(platform: SourcePlatform, username: str) -> str | None:
    """The channel's profile picture URL, or None if it couldn't be found."""
    key = (str(platform), monitor.clean_username(username).lower())
    with _lock:
        hit = _cache.get(key)
    if hit and time.time() < hit[0]:
        return hit[1]
    url = _fetch(platform, username)
    with _lock:
        _cache[key] = (time.time() + (_HIT_TTL if url else _MISS_TTL), url)
    return url


def avatar_urls(channels: list[tuple[SourcePlatform, str]]) -> list[str | None]:
    """Look up several channels in parallel."""
    if not channels:
        return []
    with ThreadPoolExecutor(max_workers=min(6, len(channels))) as pool:
        return list(pool.map(lambda c: avatar_url(*c), channels))

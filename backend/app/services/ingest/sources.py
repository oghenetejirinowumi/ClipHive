"""Recognise which platform a pasted link belongs to."""
from __future__ import annotations

from urllib.parse import urlparse

from app.models.enums import ImportSource

_HOSTS: dict[str, ImportSource] = {
    "twitch.tv": ImportSource.TWITCH,
    "kick.com": ImportSource.KICK,
    "youtube.com": ImportSource.YOUTUBE,
    "youtu.be": ImportSource.YOUTUBE,
}
_INSTAGRAM_HOSTS = ("instagram.com", "instagr.am")


def _host(url: str) -> str:
    parsed = urlparse(url.strip() if "://" in url else f"https://{url.strip()}")
    if parsed.scheme not in ("http", "https"):
        return ""
    host = (parsed.hostname or "").lower()
    return host[4:] if host.startswith("www.") else host.removeprefix("m.")


def _matches(host: str, domain: str) -> bool:
    return host == domain or host.endswith("." + domain)


def detect_source(url: str) -> ImportSource | None:
    host = _host(url)
    return next((src for domain, src in _HOSTS.items() if _matches(host, domain)), None)


def is_instagram(url: str) -> bool:
    host = _host(url)
    return any(_matches(host, d) for d in _INSTAGRAM_HOSTS)


def normalise(url: str) -> str:
    url = url.strip()
    return url if "://" in url else f"https://{url}"

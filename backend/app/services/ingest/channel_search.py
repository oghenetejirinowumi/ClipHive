"""Channel search for the "Add a channel" box: suggestions as you type a Twitch, Kick or YouTube name.

No API keys needed. Twitch answers through Helix when its keys are set, else the public GraphQL
endpoint twitch.tv itself uses; Kick through its public search API; YouTube by reading its
channel-filtered results page. Each returns the name to save (login / slug / @handle), a display
name, picture, follower count and live state when the platform says. Results are cached briefly:
typing "kai", "kaic", "kai" again shouldn't hit the platform three times.
"""
from __future__ import annotations

import json
import logging
import re
import threading
import time
from dataclasses import asdict, dataclass

import requests

from app.config import settings
from app.models.enums import SourcePlatform
from app.services.ingest import avatars, monitor

logger = logging.getLogger("cliphive.channel_search")

_UA = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36",
    "Accept-Language": "en",
}
_TIMEOUT = 8
_TTL = 600
TWITCH_WEB_CLIENT_ID = "kimne78kx3ncx6brgo4mv6wki5h1ko"  # the public client id twitch.tv's own pages use
_TWITCH_QUERY = (
    "query($q: String!, $n: Int!) { searchFor(userQuery: $q, platform: \"web\", options: {targets: [{index: CHANNEL, limit: $n}]}) "
    "{ channels { items { login displayName profileImageURL(width: 70) followers { totalCount } stream { viewersCount } } } } }"
)
_YT_CHANNELS = "EgIQAg=="  # YouTube's "type: channel" search filter

_cache: dict[tuple[str, str], tuple[float, list[dict]]] = {}
_lock = threading.Lock()


class SearchError(RuntimeError):
    """The platform didn't answer; the message is safe to show."""


@dataclass
class ChannelHit:
    username: str  # what to save as the streamer's username
    display_name: str
    avatar_url: str | None = None
    followers: int | None = None
    followers_text: str | None = None  # the platform's own wording ("21.4M subscribers")
    live: bool | None = None
    viewers: int | None = None


def search(platform: SourcePlatform, query: str, limit: int = 8) -> list[dict]:
    q = monitor.clean_username(query).strip()
    if len(q) < 2:
        return []
    key = (platform.value, q.lower())
    with _lock:
        hit = _cache.get(key)
        if hit and time.time() - hit[0] < _TTL:
            return hit[1][:limit]
    try:
        if platform == SourcePlatform.TWITCH:
            found = _twitch(q, limit)
        elif platform == SourcePlatform.KICK:
            found = _kick(q, limit)
        else:
            found = _youtube(q, limit)
    except (requests.RequestException, ValueError, KeyError, TypeError) as err:
        logger.info("Channel search failed for %s %r: %s", platform, q, err)
        raise SearchError(f"Couldn't search {platform.value.title()} right now.") from err
    rows = [{**asdict(h), "avatar_url": avatars._allowed(platform, h.avatar_url)} for h in found]
    with _lock:
        _cache[key] = (time.time(), rows)
        if len(_cache) > 2000:  # keep memory bounded
            for old in sorted(_cache, key=lambda k: _cache[k][0])[:500]:
                _cache.pop(old, None)
    return rows[:limit]


def _twitch(q: str, limit: int) -> list[ChannelHit]:
    if settings.twitch_client_id and settings.twitch_client_secret:
        try:
            resp = requests.get(
                "https://api.twitch.tv/helix/search/channels",
                params={"query": q, "first": limit},
                headers={"Client-Id": settings.twitch_client_id, "Authorization": f"Bearer {monitor._twitch_app_token()}"},
                timeout=_TIMEOUT,
            )
            resp.raise_for_status()
            return [ChannelHit(username=c["broadcaster_login"], display_name=c.get("display_name") or c["broadcaster_login"],
                               avatar_url=c.get("thumbnail_url"), live=bool(c.get("is_live")))
                    for c in resp.json().get("data") or []]
        except (requests.RequestException, KeyError, ValueError):
            pass  # fall back to the public endpoint
    resp = requests.post(
        "https://gql.twitch.tv/gql",
        json={"query": _TWITCH_QUERY, "variables": {"q": q, "n": limit}},
        headers={**_UA, "Client-Id": TWITCH_WEB_CLIENT_ID},
        timeout=_TIMEOUT,
    )
    resp.raise_for_status()
    items = ((((resp.json().get("data") or {}).get("searchFor") or {}).get("channels") or {}).get("items")) or []
    return [
        ChannelHit(
            username=c["login"], display_name=c.get("displayName") or c["login"], avatar_url=c.get("profileImageURL"),
            followers=(c.get("followers") or {}).get("totalCount"), live=c.get("stream") is not None,
            viewers=(c.get("stream") or {}).get("viewersCount"),
        )
        for c in items if c and c.get("login")
    ]


def _kick(q: str, limit: int) -> list[ChannelHit]:
    resp = requests.get("https://kick.com/api/search", params={"searched_word": q}, headers={**_UA, "Accept": "application/json"}, timeout=_TIMEOUT)
    resp.raise_for_status()
    out = []
    for c in (resp.json().get("channels") or [])[:limit]:
        user = c.get("user") or {}
        if not c.get("slug"):
            continue
        out.append(ChannelHit(
            username=c["slug"], display_name=user.get("username") or c["slug"],
            avatar_url=user.get("profile_pic") or user.get("profilePic"),
            followers=c.get("followers_count") or c.get("followersCount"), live=c.get("isLive") if c.get("isLive") is not None else c.get("is_live"),
        ))
    return out


def _walk(node, key: str):
    if isinstance(node, dict):
        if key in node:
            yield node[key]
        for value in node.values():
            yield from _walk(value, key)
    elif isinstance(node, list):
        for value in node:
            yield from _walk(value, key)


def _yt_text(field: dict | None) -> str | None:
    if not field:
        return None
    return field.get("simpleText") or "".join(r.get("text", "") for r in field.get("runs") or []) or None


def _youtube(q: str, limit: int) -> list[ChannelHit]:
    resp = requests.get("https://www.youtube.com/results", params={"search_query": q, "sp": _YT_CHANNELS},
                        headers=_UA, cookies=avatars._CONSENT, timeout=_TIMEOUT)
    resp.raise_for_status()
    match = re.search(r"var ytInitialData = (\{.*?\});</script>", resp.text)
    if not match:
        raise ValueError("YouTube's results page changed shape")
    out = []
    for c in _walk(json.loads(match.group(1)), "channelRenderer"):
        path = ((c.get("navigationEndpoint") or {}).get("browseEndpoint") or {}).get("canonicalBaseUrl") or ""
        handle = path.removeprefix("/").removeprefix("@") if path.startswith("/@") else None
        if not handle:
            continue  # only channels with an @handle can be watched by name
        # YouTube now puts the @handle where the subscriber count was, and the count under videoCountText.
        counts = [t for t in (_yt_text(c.get("subscriberCountText")), _yt_text(c.get("videoCountText"))) if t and "subscriber" in t]
        thumbs = (c.get("thumbnail") or {}).get("thumbnails") or []
        avatar = thumbs[-1]["url"] if thumbs else None
        out.append(ChannelHit(
            username=handle, display_name=_yt_text(c.get("title")) or handle,
            avatar_url=f"https:{avatar}" if avatar and avatar.startswith("//") else avatar,
            followers_text=counts[0] if counts else None,
        ))
        if len(out) >= limit:
            break
    return out

"""Clip Radar: what clippers are posting right now on Kick and Twitch.

Sources (all read-only, no scraping of pages):
- Kick's public web API: live viewers per category, and the most-viewed clips of the last
  24 hours overall and per top category. Unofficial; Kick can block it, then Kick is skipped.
- Twitch Helix (official) when TWITCH_CLIENT_ID/SECRET are set: live viewers per game from the
  top streams, and the most-viewed clips of the last 24 hours in the top games.

From those it builds hot topics (categories ranked by clip views today and live viewers, with
change since a few hours ago), creators whose clips are doing best, the top clips, and simple
patterns of what's working (clip length, title style). Gambling and "sleeping" categories are
left out: the short-form platforms restrict them and they aren't useful to clip.

YouTube is deliberately not used here; see the trends collection gate in the README.
Results are cached in memory for a few minutes; category viewer counts are kept in a small
JSON file so "rising" survives a restart.
"""
from __future__ import annotations

import json
import logging
import re
import statistics
import threading
import time
from collections import Counter, defaultdict
from concurrent.futures import ThreadPoolExecutor
from dataclasses import asdict, dataclass, field
from datetime import UTC, datetime, timedelta

import requests

from app.config import settings
from app.core.media import storage_root

logger = logging.getLogger("cliphive.radar")

_UA = {
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36",
    "Accept": "application/json",
}
_TIMEOUT = 15
CACHE_S = 10 * 60
MIN_REFRESH_S = 60
TOP_CATEGORIES = 8  # per platform, for per-category clips
HISTORY_EVERY_S = 30 * 60
HISTORY_KEEP_S = 48 * 3600
RISING_LOOKBACK_S = 3 * 3600

# Not worth clipping, or restricted on TikTok / Shorts / Reels.
_SKIP_NAMES = re.compile(r"slots|casino|gambl|poker|sleep|asmr", re.IGNORECASE)
_SKIP_TAGS = {"gambling", "sleeping"}


@dataclass
class RadarClip:
    id: str
    platform: str
    title: str
    url: str
    thumbnail_url: str | None
    views: int
    duration_s: float | None
    category: str | None
    creator: str
    creator_url: str
    creator_avatar: str | None
    created_at: str | None


@dataclass
class Topic:
    key: str
    name: str
    platforms: list[str]
    live_viewers: int = 0
    clip_count: int = 0
    clip_views: int = 0
    rising_pct: float | None = None  # live viewers vs ~3 hours ago
    score: float = 0.0
    top_clip: RadarClip | None = None
    tags: list[str] = field(default_factory=list)


@dataclass
class Creator:
    name: str
    platform: str
    url: str
    avatar: str | None
    clip_count: int
    clip_views: int
    top_category: str | None


@dataclass
class Source:
    name: str
    ok: bool
    note: str


@dataclass
class Radar:
    generated_at: str
    sources: list[Source]
    topics: list[Topic]
    creators: list[Creator]
    clips: list[RadarClip]
    insights: dict

    def as_dict(self) -> dict:
        return asdict(self)


# ------------------------------------------------------------------ helpers


def topic_key(name: str) -> str:
    """'Grand Theft Auto V (GTA)' and 'Grand Theft Auto V' are the same topic."""
    name = re.sub(r"\(.*?\)", "", name or "")
    return re.sub(r"[^a-z0-9]+", "", name.casefold())


def _skip(name: str | None, tags: list[str] | None = None) -> bool:
    if not name or _SKIP_NAMES.search(name):
        return True
    return any(str(t).casefold() in _SKIP_TAGS for t in tags or [])


def _get(url: str, **kw) -> dict | list:
    resp = requests.get(url, headers={**_UA, **kw.pop("headers", {})}, timeout=_TIMEOUT, **kw)
    resp.raise_for_status()
    return resp.json()


# ------------------------------------------------------------------ Kick


def _kick_clip(c: dict) -> RadarClip | None:
    if c.get("is_mature") or c.get("privacy") not in (None, "public"):
        return None
    channel = c.get("channel") or {}
    slug = channel.get("slug")
    if not slug or not c.get("id"):
        return None
    return RadarClip(
        id=f"kick:{c['id']}",
        platform="kick",
        title=(c.get("title") or "").strip(),
        url=f"https://kick.com/{slug}/clips/{c['id']}",
        thumbnail_url=c.get("thumbnail_url"),
        views=int(c.get("views") or c.get("view_count") or 0),
        duration_s=c.get("duration"),
        category=(c.get("category") or {}).get("name"),
        creator=channel.get("username") or slug,
        creator_url=f"https://kick.com/{slug}",
        creator_avatar=channel.get("profile_picture"),
        created_at=c.get("created_at"),
    )


def _kick() -> tuple[dict[str, tuple[str, int, list[str]]], list[RadarClip]]:
    """({topic_key: (name, live viewers, tags)}, clips)."""
    cats = _get("https://kick.com/api/v1/subcategories", params={"limit": 40})
    categories: dict[str, tuple[str, int, list[str]]] = {}
    slugs: list[str] = []
    for c in cats.get("data", []) if isinstance(cats, dict) else []:
        if _skip(c.get("name"), c.get("tags")):
            continue
        categories[topic_key(c["name"])] = (c["name"], int(c.get("viewers") or 0), list(c.get("tags") or []))
        if len(slugs) < TOP_CATEGORIES and c.get("slug"):
            slugs.append(c["slug"])

    urls = ["https://kick.com/api/v2/clips"] + [f"https://kick.com/api/v2/categories/{s}/clips" for s in slugs]

    def fetch(url: str) -> list[dict]:
        try:
            data = _get(url, params={"sort": "view", "time": "day"})
            return data.get("clips", []) if isinstance(data, dict) else []
        except (requests.RequestException, ValueError) as err:
            logger.info("Kick clips failed for %s: %s", url, err)
            return []

    clips: dict[str, RadarClip] = {}
    with ThreadPoolExecutor(max_workers=5) as pool:
        for batch in pool.map(fetch, urls):
            for raw in batch:
                clip = _kick_clip(raw)
                if clip and not _skip(clip.category):
                    clips[clip.id] = clip
    return categories, list(clips.values())


# ------------------------------------------------------------------ Twitch (Helix)


def twitch_configured() -> bool:
    return bool(settings.twitch_client_id and settings.twitch_client_secret)


def _twitch() -> tuple[dict[str, tuple[str, int, list[str]]], list[RadarClip]]:
    from app.services.ingest.monitor import _twitch_app_token

    headers = {"Client-Id": settings.twitch_client_id, "Authorization": f"Bearer {_twitch_app_token()}"}
    streams = _get("https://api.twitch.tv/helix/streams", params={"first": 100}, headers=headers).get("data", [])
    viewers: Counter[str] = Counter()
    names: dict[str, str] = {}
    game_ids: dict[str, str] = {}
    for s in streams:
        name = s.get("game_name")
        if _skip(name):
            continue
        key = topic_key(name)
        viewers[key] += int(s.get("viewer_count") or 0)
        names[key] = name
        game_ids[key] = s.get("game_id")
    categories = {k: (names[k], v, []) for k, v in viewers.items()}

    since = (datetime.now(UTC) - timedelta(hours=24)).strftime("%Y-%m-%dT%H:%M:%SZ")
    top = [game_ids[k] for k, _ in viewers.most_common(TOP_CATEGORIES) if game_ids.get(k)]

    def fetch(game_id: str) -> list[dict]:
        try:
            return _get("https://api.twitch.tv/helix/clips", params={"game_id": game_id, "started_at": since, "first": 20}, headers=headers).get("data", [])
        except (requests.RequestException, ValueError) as err:
            logger.info("Twitch clips failed for game %s: %s", game_id, err)
            return []

    with ThreadPoolExecutor(max_workers=4) as pool:
        raw = [c for batch in pool.map(fetch, top) for c in batch]

    # Avatars for the broadcasters, 100 per call.
    avatars: dict[str, str] = {}
    ids = list({c["broadcaster_id"] for c in raw if c.get("broadcaster_id")})
    for i in range(0, len(ids), 100):
        try:
            users = _get("https://api.twitch.tv/helix/users", params=[("id", x) for x in ids[i : i + 100]], headers=headers).get("data", [])
            avatars.update({u["id"]: u.get("profile_image_url") for u in users})
        except (requests.RequestException, ValueError):
            break

    game_names = {gid: names[k] for k, gid in game_ids.items()}
    clips = []
    for c in raw:
        login = (c.get("broadcaster_name") or "").lower().replace(" ", "")
        clips.append(RadarClip(
            id=f"twitch:{c['id']}",
            platform="twitch",
            title=(c.get("title") or "").strip(),
            url=c.get("url") or f"https://clips.twitch.tv/{c['id']}",
            thumbnail_url=c.get("thumbnail_url"),
            views=int(c.get("view_count") or 0),
            duration_s=c.get("duration"),
            category=game_names.get(c.get("game_id")),
            creator=c.get("broadcaster_name") or login,
            creator_url=f"https://www.twitch.tv/{login}",
            creator_avatar=avatars.get(c.get("broadcaster_id")),
            created_at=c.get("created_at"),
        ))
    return categories, clips


# ------------------------------------------------------------------ history (for "rising")

_history_lock = threading.Lock()


def _history_path():
    path = storage_root() / "trends" / "radar_history.json"
    path.parent.mkdir(parents=True, exist_ok=True)
    return path


def _load_history() -> list[dict]:
    try:
        return json.loads(_history_path().read_text())
    except (OSError, ValueError):
        return []


def _rising(viewers: dict[str, int]) -> dict[str, float]:
    """Percent change in live viewers per topic vs the snapshot nearest 3 hours ago (≥45 min old).
    Also records this snapshot (at most every 30 minutes)."""
    now = time.time()
    with _history_lock:
        history = [h for h in _load_history() if now - h.get("at", 0) < HISTORY_KEEP_S]
        old = [h for h in history if now - h["at"] >= 45 * 60]
        ref = min(old, key=lambda h: abs((now - h["at"]) - RISING_LOOKBACK_S)) if old else None
        if not history or now - history[-1]["at"] >= HISTORY_EVERY_S:
            history.append({"at": now, "viewers": viewers})
            try:
                _history_path().write_text(json.dumps(history))
            except OSError as err:
                logger.info("Couldn't save radar history: %s", err)
    if not ref:
        return {}
    out = {}
    for key, v in viewers.items():
        before = ref["viewers"].get(key)
        if before and before >= 500:  # tiny categories swing wildly
            out[key] = round((v - before) / before * 100, 1)
    return out


# ------------------------------------------------------------------ insights

_EMOJI = re.compile("[\U0001F300-\U0001FAFF☀-➿]")
_STOP = set("the a an and or of to in on for is it i my me you your this that with at be was are he she they we".split())


def _insights(clips: list[RadarClip]) -> dict:
    durations = [c.duration_s for c in clips if c.duration_s]
    titles = [c.title for c in clips if c.title]
    words = Counter()
    for t in titles:
        for w in re.findall(r"[a-zA-Z']{3,}", t.lower()):
            if w not in _STOP and w != "clip":
                words[w] += 1

    def pct(pred) -> int:
        return round(100 * sum(1 for t in titles if pred(t)) / len(titles)) if titles else 0

    return {
        "sample_size": len(clips),
        "median_duration_s": round(statistics.median(durations)) if durations else None,
        "under_60s_pct": round(100 * sum(1 for d in durations if d <= 60) / len(durations)) if durations else None,
        "caps_title_pct": pct(lambda t: sum(ch.isupper() for ch in t) >= max(4, 0.5 * sum(ch.isalpha() for ch in t))),
        "emoji_title_pct": pct(lambda t: bool(_EMOJI.search(t))),
        "median_title_words": round(statistics.median(len(t.split()) for t in titles)) if titles else None,
        "common_words": [w for w, n in words.most_common(10) if n >= 2],
    }


# ------------------------------------------------------------------ build

_cache: tuple[float, Radar] | None = None
_lock = threading.Lock()


def _build() -> Radar:
    sources: list[Source] = []
    categories: dict[str, dict[str, tuple[str, int, list[str]]]] = {}
    clips: list[RadarClip] = []

    try:
        categories["kick"], kick_clips = _kick()
        clips += kick_clips
        sources.append(Source("Kick", True, f"{len(kick_clips)} clips from the last 24 hours, live viewers per category"))
    except (requests.RequestException, ValueError, KeyError) as err:
        logger.info("Kick radar failed: %s", err)
        sources.append(Source("Kick", False, "Kick didn't answer (it sometimes blocks servers). Try again later."))

    if twitch_configured():
        try:
            categories["twitch"], twitch_clips = _twitch()
            clips += twitch_clips
            sources.append(Source("Twitch", True, f"{len(twitch_clips)} clips from the last 24 hours, live viewers in the top streams"))
        except (requests.RequestException, ValueError, KeyError) as err:
            logger.info("Twitch radar failed: %s", err)
            sources.append(Source("Twitch", False, "Twitch didn't answer. Check TWITCH_CLIENT_ID / TWITCH_CLIENT_SECRET."))
    else:
        sources.append(Source("Twitch", False, "Add TWITCH_CLIENT_ID and TWITCH_CLIENT_SECRET (free at dev.twitch.tv) to include Twitch."))

    # Topics: merge categories across platforms.
    topics: dict[str, Topic] = {}
    for platform, cats in categories.items():
        for key, (name, viewers, tags) in cats.items():
            t = topics.setdefault(key, Topic(key=key, name=name, platforms=[], tags=tags))
            t.live_viewers += viewers
            if platform not in t.platforms:
                t.platforms.append(platform)
    for c in clips:
        if not c.category:
            continue
        key = topic_key(c.category)
        t = topics.setdefault(key, Topic(key=key, name=c.category, platforms=[]))
        if c.platform not in t.platforms:
            t.platforms.append(c.platform)
        t.clip_count += 1
        t.clip_views += c.views
        if t.top_clip is None or c.views > t.top_clip.views:
            t.top_clip = c

    rising = _rising({k: t.live_viewers for k, t in topics.items() if t.live_viewers})
    max_views = max((t.clip_views for t in topics.values()), default=0) or 1
    max_live = max((t.live_viewers for t in topics.values()), default=0) or 1
    for key, t in topics.items():
        t.rising_pct = rising.get(key)
        boost = max(-0.15, min(0.25, (t.rising_pct or 0) / 200))
        t.score = round(100 * (0.6 * t.clip_views / max_views + 0.4 * t.live_viewers / max_live + boost), 1)
    ranked = sorted((t for t in topics.values() if t.clip_count or t.live_viewers >= 1000), key=lambda t: t.score, reverse=True)

    # Creators whose clips are doing best today.
    by_creator: dict[tuple[str, str], list[RadarClip]] = defaultdict(list)
    for c in clips:
        by_creator[(c.platform, c.creator.lower())].append(c)
    creators = []
    for (platform, _), cs in by_creator.items():
        top = max(cs, key=lambda c: c.views)
        cats = Counter(c.category for c in cs if c.category)
        creators.append(Creator(
            name=top.creator, platform=platform, url=top.creator_url, avatar=top.creator_avatar,
            clip_count=len(cs), clip_views=sum(c.views for c in cs), top_category=cats.most_common(1)[0][0] if cats else None,
        ))
    creators.sort(key=lambda c: c.clip_views, reverse=True)

    # Top clips, at most 3 per creator so one channel can't fill the list.
    per_creator: Counter[str] = Counter()
    top_clips = []
    for c in sorted(clips, key=lambda c: c.views, reverse=True):
        k = f"{c.platform}:{c.creator.lower()}"
        if per_creator[k] < 3:
            per_creator[k] += 1
            top_clips.append(c)
        if len(top_clips) >= 24:
            break

    return Radar(
        generated_at=datetime.now(UTC).isoformat(),
        sources=sources,
        topics=ranked[:20],
        creators=creators[:12],
        clips=top_clips,
        insights=_insights(clips),
    )


def get_radar(*, refresh: bool = False) -> Radar:
    global _cache
    with _lock:
        if _cache:
            age = time.time() - _cache[0]
            if age < (MIN_REFRESH_S if refresh else CACHE_S):
                return _cache[1]
        radar = _build()
        _cache = (time.time(), radar)
        return radar

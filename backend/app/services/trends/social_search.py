"""Per-clip social search: find what similar short videos are using right now.

Builds searches from a clip's extracted context (game/topic, moment type,
creator) and pulls matching YouTube Shorts with yt-dlp (no API key):

- "#valorant" style queries read that hashtag's Shorts feed
  (youtube.com/hashtag/<tag>/shorts), which YouTube orders by popularity
- other queries are a keyword search

Videos that only mention the topic in their hashtags (feed spam) are dropped,
then titles, descriptions and tags are mined for:

- popular hashtags, weighted by the views of the videos that use them
- caption (title) patterns: emoji use, all-caps hooks, length, common hook words
- caption suggestions for this clip built from those patterns

The most-viewed videos are opened individually (no download) for their full
description and creator tags, within a small time budget. YouTube sometimes
answers that with a bot check; then this step pauses and the listings alone are
used. Everything is cached in memory for `settings.trends_cache_ttl_s`.
"""

from __future__ import annotations

import logging
import math
import re
import time
from collections import Counter
from concurrent.futures import ThreadPoolExecutor, wait
from datetime import datetime, timezone
from threading import Lock
from typing import Callable, Iterable

from pydantic import BaseModel, Field

from app.config import settings
from app.services.trends.trend_engine import extract_hashtags

logger = logging.getLogger(__name__)

SOURCE = "youtube_shorts_search"
SHORT_FORM_MAX_S = 180
RESULTS_PER_QUERY = 20
SEARCH_BUDGET_S = 20
ENRICH_TOP_N = 8
ENRICH_BUDGET_S = 6
BLOCKED_PAUSE_S = 15 * 60
MIN_ON_TOPIC = 5

# Discovery tags that say nothing about the clip itself.
BROAD_TAGS = {
    "shorts", "short", "youtubeshorts", "ytshorts", "shortsfeed", "shortvideo", "shortsvideo",
    "viral", "viralvideo", "viralshorts", "viralclips", "trending", "trend", "fyp", "foryou",
    "foryoupage", "fy", "explore", "explorepage", "subscribe", "clips", "clip", "gaming",
    "gamer", "games", "game", "gamingshorts", "funny", "memes", "meme", "edit", "highlights",
    "new", "tiktok", "reels", "reel",
}

EVENT_SEARCH_TERMS = {
    "clutch": "clutch",
    "ace": "ace",
    "funny_fail": "funny moments",
    "fail": "fail",
    "rage_quit": "rage",
    "reaction": "reaction",
    "tutorial_tip": "tips",
    "tip": "tips",
    "chill_story": "story",
    "discussion": "podcast",
    "rant": "rant",
    "win": "win",
}

# Event type -> hashtag suffix, e.g. #valorant + clutch = #valorantclutch.
EVENT_TAG_SUFFIX = {
    "clutch": "clutch",
    "ace": "ace",
    "funny_fail": "funny",
    "fail": "fail",
    "rage_quit": "rage",
    "reaction": "reaction",
    "tutorial_tip": "tips",
    "tip": "tips",
    "chill_story": "story",
    "win": "win",
}

# How the moment reads inside a caption.
EVENT_PHRASES = {
    "clutch": "clutch",
    "ace": "ace",
    "funny_fail": "fail",
    "fail": "fail",
    "rage_quit": "rage quit",
    "reaction": "reaction",
    "tutorial_tip": "trick",
    "tip": "trick",
    "chill_story": "story",
    "win": "win",
    "rant": "rant",
}

# Short names for topics that are long or don't squash into a hashtag well.
TOPIC_SHORT = {
    "call of duty: warzone": "Warzone",
    "counter-strike 2": "CS2",
    "grand theft auto v": "GTA",
    "league of legends": "League",
    "podcast & discussion": "podcast",
    "tech & coding": "coding",
}
TOPIC_TAGS = {
    "call of duty: warzone": "warzone",
    "counter-strike 2": "cs2",
    "grand theft auto v": "gta5",
    "podcast & discussion": "podcast",
    "tech & coding": "coding",
}

GENERIC_TOPICS = {"general gaming", "gaming", ""}

STOPWORDS = {
    "the", "a", "an", "and", "or", "of", "to", "in", "on", "for", "with", "this", "that", "is",
    "it", "my", "i", "you", "your", "me", "we", "he", "she", "they", "his", "her", "at", "by",
    "from", "but", "be", "was", "are", "so", "just", "when", "how", "what", "who", "all", "vs",
    "shorts", "short", "video", "clip", "clips", "new", "best", "get", "got", "did", "do", "can",
    "stream", "live", "part", "highlights", "highlight",
}

# Attention words creators lead titles with. Hook words only come from this list,
# so topic words like map names don't end up as the "hook".
ADJECTIVE_HOOKS = {
    "insane", "impossible", "crazy", "unreal", "craziest", "cleanest", "best", "worst",
    "biggest", "fastest", "perfect", "clean", "epic", "legendary", "godlike", "nasty",
    "filthy", "ridiculous", "unbelievable", "unstoppable", "broken", "cracked", "wild",
    "shocking", "hilarious", "funniest", "untouchable", "unexpected", "ultimate", "smartest",
}
SUPERLATIVES = {
    "crazy": "craziest", "clean": "cleanest", "wild": "wildest", "nasty": "nastiest",
    "filthy": "filthiest", "insane": "most insane", "impossible": "most impossible",
}
HOOK_VOCAB = ADJECTIVE_HOOKS | {
    "never", "only", "first", "last", "secret", "nobody", "everyone", "actually", "really",
    "literally", "omg", "bro", "wait", "watch", "speechless", "pro", "god",
}

EMOJI_PATTERN = re.compile(
    "[\U0001F300-\U0001FAFF\U00002600-\U000027BF\U0001F1E6-\U0001F1FF]", re.UNICODE
)
WORD_PATTERN = re.compile(r"[A-Za-z][A-Za-z']+")
HASHTAG_TEXT = re.compile(r"#\S+")


# --------------------------------------------------------------------------- models


class ScrapedVideo(BaseModel):
    id: str
    title: str
    description: str = ""
    url: str | None = None
    channel: str | None = None
    view_count: int | None = None
    duration_s: float | None = None
    tags: list[str] = Field(default_factory=list)


class PopularHashtag(BaseModel):
    tag: str
    uses: int
    total_views: int
    score: float
    kind: str = Field(description="niche (about the clip's topic) or broad (discovery)")
    relevant: bool = Field(description="Contains a word from the clip's context")


class CaptionSuggestion(BaseModel):
    text: str
    reason: str


class CaptionPatterns(BaseModel):
    sample_size: int = 0
    emoji_percent: int = 0
    all_caps_percent: int = 0
    hashtag_in_title_percent: int = 0
    avg_words: float = 0.0
    top_emojis: list[str] = Field(default_factory=list)
    hook_words: list[str] = Field(default_factory=list)


class ExampleVideo(BaseModel):
    title: str
    url: str | None
    channel: str | None
    view_count: int | None


class SocialTrendsResult(BaseModel):
    source: str = SOURCE
    platform: str
    fetched_at: str
    queries: list[str]
    videos_scanned: int
    hashtags: list[PopularHashtag]
    recommended_hashtags: list[str]
    captions: list[CaptionSuggestion]
    patterns: CaptionPatterns
    examples: list[ExampleVideo]
    warnings: list[str] = Field(default_factory=list)


class SocialSearchUnavailable(RuntimeError):
    """Every search query failed (offline, blocked, or yt-dlp broke)."""


# --------------------------------------------------------------------------- yt-dlp

SearchFn = Callable[[str, int], list[ScrapedVideo]]
# Returns (full description, creator tags) for one video.
DetailFn = Callable[[ScrapedVideo], tuple[str, list[str]]]


class _QuietLogger:
    """yt-dlp prints errors to stderr even when quiet; we report failures ourselves."""

    def debug(self, msg: str) -> None: ...

    def warning(self, msg: str) -> None: ...

    def error(self, msg: str) -> None:
        logger.debug("yt-dlp: %s", msg)


def _ytdlp_opts(**extra) -> dict:
    opts = {
        "quiet": True,
        "no_warnings": True,
        "skip_download": True,
        "socket_timeout": 10,
        "logger": _QuietLogger(),
    }
    from app.services.ingest import youtube_guard

    if cookies := youtube_guard.cookies_file():
        opts["cookiefile"] = cookies
    opts.update(extra)
    return opts


def ytdlp_search(query: str, limit: int = RESULTS_PER_QUERY) -> list[ScrapedVideo]:
    """Flat YouTube listing via yt-dlp: titles, snippets and view counts, no downloads.

    "#tag" reads the hashtag's Shorts feed; anything else is a keyword search.
    """
    from urllib.parse import quote

    from yt_dlp import YoutubeDL

    if query.startswith("#") and " " not in query:
        target = f"https://www.youtube.com/hashtag/{quote(query[1:])}/shorts"
    else:
        target = f"ytsearch{limit}:{query}"

    from app.services.ingest import youtube_guard

    youtube_guard.pace()  # spaced out, and refused outright while YouTube has us flagged
    try:
        with YoutubeDL({**_ytdlp_opts(extract_flat="in_playlist", playlistend=limit), **youtube_guard.opts()}) as ydl:
            info = ydl.extract_info(target, download=False) or {}
    except Exception as err:
        youtube_guard.report(err)
        raise

    videos = []
    for entry in list(info.get("entries") or [])[:limit]:
        if not entry or not entry.get("id") or not entry.get("title"):
            continue
        videos.append(
            ScrapedVideo(
                id=str(entry["id"]),
                title=str(entry["title"]),
                description=str(entry.get("description") or ""),
                url=entry.get("url") or f"https://www.youtube.com/watch?v={entry['id']}",
                channel=entry.get("channel") or entry.get("uploader"),
                view_count=entry.get("view_count"),
                duration_s=entry.get("duration"),
            )
        )
    return videos


def ytdlp_details(video: ScrapedVideo) -> tuple[str, list[str]]:
    """Full description and tags for one video, without resolving formats."""
    from yt_dlp import YoutubeDL

    from app.services.ingest import youtube_guard

    youtube_guard.pace()
    try:
        with YoutubeDL({**_ytdlp_opts(), **youtube_guard.opts()}) as ydl:
            info = ydl.extract_info(video.url, download=False, process=False) or {}
    except Exception as err:
        youtube_guard.report(err)
        raise
    return str(info.get("description") or ""), [str(t) for t in info.get("tags") or []]


# --------------------------------------------------------------------------- caching

_cache: dict[str, tuple[float, object]] = {}
_cache_lock = Lock()
_details_paused_until = 0.0


def _cached(key: str, refresh: bool, compute: Callable[[], object]):
    now = time.monotonic()
    with _cache_lock:
        hit = _cache.get(key)
    if hit and not refresh and now - hit[0] < settings.trends_cache_ttl_s:
        return hit[1]
    value = compute()
    with _cache_lock:
        _cache[key] = (now, value)
    return value


def clear_cache() -> None:
    global _details_paused_until
    with _cache_lock:
        _cache.clear()
    _details_paused_until = 0.0


def _cached_search(query: str, search_fn: SearchFn, refresh: bool) -> list[ScrapedVideo]:
    return _cached(f"q:{query.casefold()}", refresh, lambda: search_fn(query, RESULTS_PER_QUERY))


def _enrich(video: ScrapedVideo, detail_fn: DetailFn) -> ScrapedVideo:
    global _details_paused_until
    if time.monotonic() < _details_paused_until:
        return video
    try:
        # Details don't go stale within the TTL, so a refresh doesn't refetch them.
        description, tags = _cached(f"v:{video.id}", False, lambda: detail_fn(video))
    except Exception as exc:
        text = str(exc)
        if "confirm you" in text or "429" in text:
            _details_paused_until = time.monotonic() + BLOCKED_PAUSE_S
            logger.warning("YouTube bot check hit; pausing video detail lookups for 15 minutes")
        else:
            logger.info("Couldn't read details for %s: %s", video.id, text[:200])
        return video
    return video.model_copy(update={"description": description or video.description, "tags": tags})


def _run_all(fn: Callable, items: list, budget_s: float) -> list:
    """Run fn over items in parallel; return results (or exceptions) that finish in time."""
    if not items:
        return []
    pool = ThreadPoolExecutor(max_workers=min(8, len(items)))
    futures = [pool.submit(fn, item) for item in items]
    wait(futures, timeout=budget_s)
    pool.shutdown(wait=False, cancel_futures=True)
    out = []
    for future in futures:
        if not future.done() or future.cancelled():
            out.append(TimeoutError("timed out"))
        elif future.exception() is not None:
            out.append(future.exception())
        else:
            out.append(future.result())
    return out


# --------------------------------------------------------------------------- queries


def _clean_topic(topic: str | None, clip_title: str | None) -> str:
    topic = (topic or "").strip()
    if topic.casefold() in GENERIC_TOPICS:
        return _topic_from_title(clip_title) or "gaming"
    return topic


def _topic_from_title(title: str | None) -> str:
    """First content word of a clip title like 'Fortnite ranked grind · Clip 3'."""
    if not title:
        return ""
    base = re.split(r"\s+·\s+", title)[0]
    words = [w for w in WORD_PATTERN.findall(base) if w.casefold() not in STOPWORDS]
    return words[0] if words else ""


def topic_label(topic: str) -> str:
    return TOPIC_SHORT.get(topic.casefold(), topic)


def topic_hashtag(topic: str) -> str:
    """'League of Legends' -> 'leagueoflegends'; awkward names use TOPIC_TAGS."""
    known = TOPIC_TAGS.get(topic.casefold())
    if known:
        return known
    return re.sub(r"[^\w]", "", topic, flags=re.UNICODE).casefold() or "gaming"


def build_queries(
    game_or_topic: str | None,
    event_type: str | None,
    creator: str | None,
    clip_title: str | None = None,
) -> list[str]:
    """Up to four searches: two hashtag feeds, a keyword search, and the creator."""
    topic = _clean_topic(game_or_topic, clip_title)
    event = (event_type or "").casefold()
    tag = topic_hashtag(topic)

    queries = [f"#{tag}"]
    if event in EVENT_TAG_SUFFIX:
        queries.append(f"#{tag}{EVENT_TAG_SUFFIX[event]}")
    queries.append(f"{topic_label(topic)} {EVENT_SEARCH_TERMS.get(event, 'highlights')} #shorts")
    if creator and creator.strip():
        queries.append(f"{creator.strip()} {topic_label(topic)} #shorts")
    return list(dict.fromkeys(q.strip() for q in queries))[:4]


# --------------------------------------------------------------------------- analysis


def _view_weight(views: int | None) -> float:
    return math.log10((views or 0) + 10)


def _terms(texts: Iterable[str | None]) -> set[str]:
    terms: set[str] = set()
    for text in texts:
        for word in re.split(r"[^\w]+", (text or "").casefold()):
            if len(word) >= 3 and word not in STOPWORDS:
                terms.add(word)
    return terms


def is_on_topic(video: ScrapedVideo, topic_terms: set[str]) -> bool:
    """True when the topic shows up in the video's words, not just in its hashtags.

    Hashtag feeds are full of unrelated videos that add popular tags for reach.
    """
    if not topic_terms:
        return True
    text = HASHTAG_TEXT.sub(" ", f"{video.title} {video.description}").casefold()
    words = set(re.split(r"[^\w]+", text)) | {t.casefold() for t in video.tags}
    return any(term in words for term in topic_terms)


def _tags_as_hashtags(tags: list[str]) -> list[str]:
    """Creator keyword tags ("valorant clips") as hashtag text ("#valorantclips")."""
    out = []
    for tag in tags:
        words = tag.lstrip("#").split()
        if 1 <= len(words) <= 2:
            out.append("#" + "".join(words))
    return out


def rank_hashtags(videos: list[ScrapedVideo], context_terms: set[str]) -> list[PopularHashtag]:
    stats: dict[str, dict] = {}
    for video in videos:
        texts = [video.title, video.description, " ".join(_tags_as_hashtags(video.tags))]
        for normalized, _display in extract_hashtags(texts):
            if len(normalized) < 2 or normalized.isdigit():
                continue
            row = stats.setdefault(normalized, {"uses": 0, "views": 0, "score": 0.0})
            row["uses"] += 1
            row["views"] += video.view_count or 0
            row["score"] += _view_weight(video.view_count)

    ranked = []
    for normalized, row in stats.items():
        relevant = any(term in normalized for term in context_terms)
        # A tag on a single video is usually noise (channel names, typos).
        if row["uses"] < 2 and not relevant:
            continue
        ranked.append(
            PopularHashtag(
                tag=f"#{normalized}",
                uses=row["uses"],
                total_views=row["views"],
                score=round(row["score"] * (1.5 if relevant else 1.0), 2),
                kind="broad" if normalized in BROAD_TAGS else "niche",
                relevant=relevant,
            )
        )
    ranked.sort(key=lambda h: (h.score, h.uses), reverse=True)
    return ranked[:20]


def recommend_hashtags(ranked: list[PopularHashtag], platform: str, limit: int = 8) -> list[str]:
    """Tags about the clip first, then related niche tags, then a couple of discovery tags."""
    on_topic = [h.tag for h in ranked if h.kind == "niche" and h.relevant]
    related = [h.tag for h in ranked if h.kind == "niche" and not h.relevant and h.uses >= 2]
    broad = [h.tag for h in ranked if h.kind == "broad"]
    platform_tag = "#shorts" if platform == "youtube" else "#fyp"

    picks = (on_topic[:4] + related)[:5] + broad[:2]
    if platform_tag not in picks:
        picks.append(platform_tag)
    return list(dict.fromkeys(picks))[:limit]


def analyze_patterns(videos: list[ScrapedVideo], context_terms: set[str]) -> CaptionPatterns:
    if not videos:
        return CaptionPatterns()
    n = len(videos)
    emojis: Counter[str] = Counter()
    hooks: Counter[str] = Counter()
    with_emoji = all_caps = with_tag = word_total = 0

    for video in videos:
        title = video.title
        found = [e for e in EMOJI_PATTERN.findall(title) if e not in "\u2640\u2642"]
        if found:
            with_emoji += 1
            emojis.update(found)
        plain = HASHTAG_TEXT.sub(" ", title)
        words = WORD_PATTERN.findall(plain)
        word_total += len(plain.split())
        if sum(1 for w in words if len(w) >= 3 and w.isupper()) >= 2:
            all_caps += 1
        if "#" in title:
            with_tag += 1
        for word in {w.casefold() for w in words}:
            if word in HOOK_VOCAB and word not in context_terms:
                hooks[word] += 1

    return CaptionPatterns(
        sample_size=n,
        emoji_percent=round(100 * with_emoji / n),
        all_caps_percent=round(100 * all_caps / n),
        hashtag_in_title_percent=round(100 * with_tag / n),
        avg_words=round(word_total / n, 1),
        top_emojis=[e for e, _ in emojis.most_common(4)],
        hook_words=[w for w, _ in hooks.most_common(6)],
    )


def suggest_captions(
    patterns: CaptionPatterns,
    topic: str,
    event_type: str | None,
    creator: str | None,
    existing_title: str | None,
) -> list[CaptionSuggestion]:
    loud = patterns.all_caps_percent >= 30
    use_emoji = bool(patterns.top_emojis) and patterns.emoji_percent >= 25
    emoji = "".join(patterns.top_emojis[:2]) if use_emoji else ""
    one_emoji = patterns.top_emojis[0] if use_emoji else ""
    seen_hook = next((w for w in patterns.hook_words if w in ADJECTIVE_HOOKS), None)
    hook = seen_hook or "insane"
    if hook in SUPERLATIVES:
        superlative = SUPERLATIVES[hook]
    elif hook.endswith("est") or hook in ("best", "worst"):
        superlative = hook
    else:
        superlative = f"most {hook}"
    event = EVENT_PHRASES.get((event_type or "").casefold(), "moment")
    label = topic_label(topic) if topic.casefold() not in GENERIC_TOPICS else "this"

    def style(text: str, mark: str) -> str:
        text = re.sub(r"\s+", " ", text).strip()
        text = text.upper() if loud else text[:1].upper() + text[1:]
        return f"{text} {mark}".strip()

    if patterns.sample_size:
        case_note = (
            f"{patterns.all_caps_percent}% of the top {patterns.sample_size} similar titles use all-caps"
            if loud
            else f"most of the top {patterns.sample_size} similar titles use sentence case"
        )
        emoji_note = f" and {patterns.emoji_percent}% use emoji" if use_emoji else ""
        hook_note = (
            f"'{hook}' shows up in similar top titles; " if seen_hook else ""
        )
    else:
        case_note, emoji_note, hook_note = "no similar titles found", "", ""

    out: list[CaptionSuggestion] = []
    if existing_title and not re.search(r"·\s*Clip \d+$", existing_title):
        out.append(CaptionSuggestion(text=existing_title, reason="From the clip's AI context analysis."))
    out.append(
        CaptionSuggestion(
            text=style(f"the {superlative} {label} {event} you'll see today", emoji),
            reason=f"{hook_note}{case_note}{emoji_note}.",
        )
    )
    out.append(
        CaptionSuggestion(
            text=style(f"wait for the end of this {label} {event}", one_emoji),
            reason="A watch-to-the-end hook keeps viewers on the clip longer.",
        )
    )
    if creator:
        out.append(
            CaptionSuggestion(
                text=style(f"{creator} really pulled off this {event}", one_emoji),
                reason="Naming the creator helps their fans find the clip.",
            )
        )

    seen: set[str] = set()
    unique = []
    for caption in out:
        key = caption.text.casefold()
        if key not in seen and len(caption.text) <= 255:
            seen.add(key)
            unique.append(caption)
    return unique[:4]


# --------------------------------------------------------------------------- entry point


def find_social_trends(
    *,
    game_or_topic: str | None,
    event_type: str | None,
    creator: str | None,
    summary: str | None = None,
    clip_title: str | None = None,
    suggested_title: str | None = None,
    topic_keywords: Iterable[str] = (),
    platform: str = "tiktok",
    refresh: bool = False,
    search_fn: SearchFn = ytdlp_search,
    detail_fn: DetailFn | None = ytdlp_details,
) -> SocialTrendsResult:
    """Search similar short videos and summarise their hashtags and title patterns.

    `topic_keywords` are extra words that identify the topic (e.g. agent names for
    Valorant); they decide which feed videos count as on-topic.
    """
    platform = "youtube" if platform.lower() == "youtube" else "tiktok"
    topic = _clean_topic(game_or_topic, clip_title)
    queries = build_queries(game_or_topic, event_type, creator, clip_title)

    warnings: list[str] = []
    by_id: dict[str, ScrapedVideo] = {}
    succeeded = 0
    results = _run_all(lambda q: _cached_search(q, search_fn, refresh), queries, SEARCH_BUDGET_S)
    for query, result in zip(queries, results):
        if isinstance(result, Exception):
            logger.warning("Social search failed for %r: %s", query, result)
            warnings.append(f"Search '{query}' failed.")
            continue
        succeeded += 1
        for video in result:
            by_id.setdefault(video.id, video)
    if not succeeded:
        raise SocialSearchUnavailable(
            "We couldn't look up popular hashtags right now. Please try again."
        )

    videos = [v for v in by_id.values() if v.duration_s is None or v.duration_s <= SHORT_FORM_MAX_S]
    videos.sort(key=lambda v: v.view_count or 0, reverse=True)

    if detail_fn is not None and videos and time.monotonic() >= _details_paused_until:
        top = videos[:ENRICH_TOP_N]
        enriched = _run_all(lambda v: _enrich(v, detail_fn), top, ENRICH_BUDGET_S)
        videos = [
            new if isinstance(new, ScrapedVideo) else old for old, new in zip(top, enriched)
        ] + videos[ENRICH_TOP_N:]

    topic_terms = _terms([topic, topic_label(topic), topic_hashtag(topic), *topic_keywords])
    on_topic = [v for v in videos if is_on_topic(v, topic_terms)]
    if len(on_topic) >= MIN_ON_TOPIC:
        videos = on_topic
    elif videos:
        warnings.append("Few videos matched this clip's topic closely, so results are broader.")
    if not videos:
        warnings.append("No short-form videos matched this clip's topic.")

    event_term = EVENT_SEARCH_TERMS.get((event_type or "").casefold())
    hashtag_terms = topic_terms | _terms([creator, event_term])
    ranked = rank_hashtags(videos, hashtag_terms)
    patterns = analyze_patterns(videos, hashtag_terms | _terms([summary]))

    return SocialTrendsResult(
        platform=platform,
        fetched_at=datetime.now(timezone.utc).isoformat(),
        queries=queries,
        videos_scanned=len(videos),
        hashtags=ranked,
        recommended_hashtags=recommend_hashtags(ranked, platform),
        captions=suggest_captions(patterns, topic, event_type, creator, suggested_title),
        patterns=patterns,
        examples=[
            ExampleVideo(title=v.title, url=v.url, channel=v.channel, view_count=v.view_count)
            for v in videos[:6]
        ],
        warnings=warnings,
    )

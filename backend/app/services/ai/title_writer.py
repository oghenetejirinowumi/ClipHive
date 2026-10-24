"""Title writing: when to name the streamer, what they're doing, and keeping the model honest.

A title that names a big streamer ("Kai Cenat can't believe what chat did") gets clicks; the
same move for an unknown channel, or a pure gameplay play, just wastes words. And a set of clips
from one video that all start with the same name reads like spam. So every clip gets a brief:

1. Who's on screen, and how sure we are. A Twitch/Kick VOD's owner is the streamer. A YouTube
   uploader is too, unless the channel looks like a clips channel ("... Clips", "Highlights").
   A channel the user watches whose name appears in the source title settles it.
2. Whether this title should name them: confidence x how known they are (followers) x whether
   the moment is about the person (a reaction, a rant, a story) or about the play, compared with
   how many of the video's other clips already named them. The decision and its reason are
   saved on the clip (context_json.title_plan) so it can be audited.
3. Facts for the model: what happens (the context engine's summary, the producer's reason),
   the game, the clip's best lines, and the titles its sibling clips already use.

After the model answers, `check` reorders the titles so ones that follow the plan and don't
invent outcomes (numbers, "1v5", "ace" the transcript never mentions) come first.
"""
from __future__ import annotations

import re
from collections.abc import Sequence
from dataclasses import dataclass, field

from sqlalchemy.orm import Session

from app.models.clip import Clip

# Uploader names that are clip/fan channels, not the person on screen.
CLIPS_CHANNEL = re.compile(r"\b(clips?|highlights?|moments?|daily|best ?of|fan(s|page)?|compilations?|shorts|vods?|archive|tv)\b", re.I)
PERSONAL_EVENTS = {"reaction", "rant", "discussion", "story", "tip", "funny", "fail"}
PERSONAL_GENRES = {"reaction", "comedy", "story", "irl", "podcast", "just chatting"}
OUTCOME_WORDS = re.compile(r"\b(\d+v\d+|ace[ds]?|clutch(?:es|ed)?|wins?|won|victory|dub|kills?|killed|record|world first|\d{2,})\b", re.I)
MAX_SHARE = 0.75  # even a megastar's clips shouldn't all lead with the name


@dataclass
class TitleBrief:
    streamer: str | None
    confidence: str  # high | medium | low | none
    name_streamer: bool
    why: str
    game: str | None = None
    followers: int | None = None
    summary: str | None = None
    reason: str | None = None
    quotes: list[str] = field(default_factory=list)
    siblings: list[str] = field(default_factory=list)
    source_title: str | None = None
    platform: str | None = None

    def facts(self) -> str:
        lines = []
        if self.streamer:
            sure = {"high": "", "medium": " (probably)", "low": " (uncertain: may be a clips channel)"}.get(self.confidence, "")
            fans = f", {_compact(self.followers)} followers" if self.followers else ""
            lines.append(f"Streamer: {self.streamer}{sure}{fans}" + (f" on {self.platform}" if self.platform else ""))
        else:
            lines.append("Streamer: unknown")
        if self.game:
            lines.append(f"Game / topic: {self.game}")
        if self.summary:
            lines.append(f"What happens in the clip: {self.summary}")
        if self.reason:
            lines.append(f"Why the editor picked it: {self.reason}")
        if self.quotes:
            lines.append("Best lines said: " + " | ".join(f'"{q}"' for q in self.quotes))
        if self.source_title:
            lines.append(f'Source video title (context only, don\'t copy it): "{self.source_title}"')
        if self.siblings:
            lines.append("Titles other clips from this video already use (don't repeat their wording or pattern): "
                         + " | ".join(f'"{s}"' for s in self.siblings[:8]))
        return "\n".join(lines)

    def instructions(self) -> str:
        if self.name_streamer and self.streamer:
            return (
                f"Title plan: name the streamer as {self.streamer!r} in at least two of the three titles, and say what they "
                "are doing in this moment (reacting to, raging at, trying, losing to, explaining...), based only on the facts."
            )
        unknown = "" if self.streamer else " We don't know who is on screen."
        return ("Title plan: don't name the streamer or anyone else. Lead with the moment itself: the situation, "
                f"the best line, or what happens.{unknown}")


RULES = (
    "Title rules: describe only what the transcript and summary support. Never invent outcomes (wins, kills, aces, "
    "scores, numbers) or names. If what happens is unclear, quote or paraphrase the best line instead. Each under 70 "
    "characters, natural wording (not ALL CAPS; one word in caps is fine), at most one emoji and only if it fits, "
    "no hashtags. Make the three titles different from each other in angle."
)


def _compact(n: int | None) -> str:
    if not n:
        return ""
    for div, unit in ((1_000_000, "M"), (1_000, "K")):
        if n >= div:
            return f"{n / div:.1f}".rstrip("0").rstrip(".") + unit
    return str(n)


def _fame(followers: int | None) -> float:
    if not followers:
        return 0.6  # unknown: neither push nor block
    if followers >= 1_000_000:
        return 1.0
    if followers >= 100_000:
        return 0.85
    if followers >= 10_000:
        return 0.6
    return 0.35


def _norm(name: str) -> str:
    return re.sub(r"[^a-z0-9]", "", name.lower())


def identify_streamer(clip: Clip, ctx: dict, watched: Sequence[str] = ()) -> tuple[str | None, str]:
    """(name to use, confidence)."""
    if clip.stream is not None and clip.stream.streamer is not None:
        return clip.stream.streamer.username, "high"  # recorded live from a channel we watch
    source = str(ctx.get("source") or "").lower()
    creator = (ctx.get("creator") or "").strip() or None
    title = f"{ctx.get('source_title') or ''} {ctx.get('original_filename') or ''}"
    # A channel the user watches, named in the source title (or as the uploader), is the strongest hint.
    for name in watched:
        key = _norm(name)
        if len(key) >= 3 and (key in _norm(title) or (creator and key == _norm(creator))):
            return (creator if creator and key == _norm(creator) else name), "high"
    if not creator:
        return None, "none"
    if source in ("twitch", "kick"):
        return creator, "high"  # the VOD's owner is who's streaming
    if CLIPS_CHANNEL.search(creator):
        return creator, "low"
    return creator, "medium"


def _personal(ctx: dict) -> bool:
    event = str(ctx.get("event_type") or "").lower()
    genre = str(ctx.get("genre") or "").lower()
    mood = str(ctx.get("mood") or "").lower()
    return event in PERSONAL_EVENTS or genre in PERSONAL_GENRES or mood == "funny"


def best_quotes(words: Sequence[dict], limit: int = 2) -> list[str]:
    """The clip's most quotable sentences: ones with laughter/disbelief/hype cues first, then the
    longest. Short enough to read in a title."""
    from app.schemas.clip import TranscriptWord
    from app.services.clip.moments import _cues, _sentence_edges

    ws = [TranscriptWord(word=str(w.get("word", "")), start=float(w.get("start", 0)), end=float(w.get("end", 0))) for w in words if str(w.get("word", "")).strip()]
    if not ws:
        return []
    starts, _ = _sentence_edges(ws)
    sentences: list[list[TranscriptWord]] = []
    for w in ws:
        if not sentences or w.start in starts:
            sentences.append([])
        sentences[-1].append(w)
    cue_times = [c.t for c in _cues(ws)]
    scored = []
    for s in sentences:
        text = " ".join(w.word for w in s).strip(" ,")
        if len(text) < 8:
            continue
        cues = sum(1 for t in cue_times if s[0].start - 0.01 <= t <= s[-1].end + 0.01)
        scored.append((cues, min(len(text), 70), text if len(text) <= 80 else text[:77].rsplit(" ", 1)[0] + "..."))
    scored.sort(key=lambda x: (-x[0], -x[1]))
    return [t for _, _, t in scored[:limit]]


def brief_for(clip: Clip, db: Session | None = None, ctx: dict | None = None) -> TitleBrief:
    ctx = {**(clip.context_json or {}), **(ctx or {})}
    watched: list[str] = []
    siblings: list[Clip] = []
    if db is not None:
        from app.models.streamer import Streamer

        watched = [s.username for s in db.query(Streamer).filter(Streamer.user_id == clip.user_id)]
        job_id = ctx.get("import_job_id")
        if job_id:
            from app.models.import_job import ImportJob

            job = db.get(ImportJob, job_id)
            ids = [i for i in (job.clip_ids or []) if i != clip.id] if job else []
            siblings = db.query(Clip).filter(Clip.id.in_(ids)).all() if ids else []
    name, confidence = identify_streamer(clip, ctx, watched)
    followers = ctx.get("creator_followers") if isinstance(ctx.get("creator_followers"), int) else None
    done = [s for s in siblings if (s.context_json or {}).get("title_plan")]
    named_before = sum(1 for s in done if (s.context_json or {})["title_plan"].get("name_streamer"))

    confidence_weight = {"high": 1.0, "medium": 0.6}.get(confidence, 0.0)
    personal = _personal(ctx)
    share = MAX_SHARE * confidence_weight * _fame(followers) * (1.0 if personal else 0.65)
    if confidence_weight == 0:
        name_it = False
        why = "streamer unknown" if confidence == "none" else f"{name} looks like a clips channel, not the streamer"
    elif not done:
        name_it = share >= 0.35
        why = f"first clip of this video; naming share for {name} is {share:.0%}"
    else:
        name_it = named_before / len(done) < share
        why = f"{named_before} of {len(done)} earlier titles named {name}; target {share:.0%}"
    why += f" ({'personal moment' if personal else 'gameplay moment'}" + (f", {_compact(followers)} followers)" if followers else ")")

    game = ctx.get("game_or_topic") or next(iter(ctx.get("source_categories") or []), None)
    return TitleBrief(
        streamer=name if confidence != "none" else None, confidence=confidence, name_streamer=name_it, why=why,
        game=game if game and str(game).lower() not in ("general gaming", "gaming") else None, followers=followers,
        summary=ctx.get("summary"), reason=ctx.get("agent_reason") or ctx.get("highlight_reason"),
        quotes=best_quotes(clip.transcript_json or []), siblings=[s.title for s in siblings if s.title][:8],
        source_title=ctx.get("source_title"), platform=(ctx.get("source") or None) if ctx.get("source") != "upload" else None,
    )


def _mentions(title: str, name: str) -> bool:
    key = _norm(name)
    return bool(key) and (key in _norm(title) or any(len(p) >= 3 and p.lower() in title.lower() for p in re.split(r"[\s_]+", name)))


def check(titles: Sequence[str], brief: TitleBrief) -> list[str]:
    """Clean titles and put the ones that follow the brief first."""
    facts = " ".join(filter(None, [brief.summary, brief.reason, " ".join(brief.quotes), brief.game])).lower()
    cleaned = []
    for t in titles:
        t = re.sub(r"\s*#\w+", "", str(t)).strip().strip('"').strip()
        if t and t.lower() not in (c.lower() for c in cleaned):
            cleaned.append(t[:100])

    def penalty(t: str) -> int:
        p = 0
        if brief.streamer:
            named = _mentions(t, brief.streamer)
            if brief.name_streamer and not named:
                p += 1
            if not brief.name_streamer and named:
                p += 2
        invented = [m.group(0).lower() for m in OUTCOME_WORDS.finditer(t) if m.group(0).lower() not in facts]
        p += 3 * len(invented)
        if t.isupper() and len(t) > 12:
            p += 1
        return p

    return sorted(cleaned, key=penalty)  # stable: the model's order breaks ties


def fallback_titles(brief: TitleBrief) -> list[str]:
    """Titles from the facts alone, for when no model is configured: the best line, who said it
    (when the plan names them) and the game."""
    quote = brief.quotes[0] if brief.quotes else None
    who = brief.streamer if brief.name_streamer and brief.streamer else None
    options: list[str] = []
    if quote:
        short = quote if len(quote) <= 60 else quote[:57].rsplit(" ", 1)[0] + "..."
        options.append(f'{who}: "{short}"' if who else f'"{short}"')
        if brief.game:
            options.append(f'"{short}" ({brief.game})')
    if brief.summary:
        first = re.split(r"(?<=[.!?])\s", brief.summary.strip())[0].rstrip(".")
        options.append(first[:90])
    if who and brief.game:
        options.append(f"{who} playing {brief.game}")
    if not options:
        base = brief.source_title or brief.game or "Stream highlight"
        options.append(base[:90])
    return list(dict.fromkeys(options))[:3]

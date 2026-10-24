"""Context Extraction & Virality Matching Engine for ClipHive.
Extracts multimodal context (speech transcript, acoustic energy, source metadata,
and game/topic entities) from generated clips and matches:
1. Proper Caption Aesthetic (Punch, Neon, Clean) + kinetic hype words
2. Contextual Hashtags (blending game niche, creator, moment archetype, and live platform trends)
3. High-CTR Viral Titles
"""

from __future__ import annotations

import json
import logging
import re
from pathlib import Path
from typing import Sequence

from app.config import settings
from app.models.caption_style import CaptionStyle
from app.models.clip import Clip
from app.schemas.clip import TranscriptWord
from app.services.ai.proofreader import proofread_transcript
from app.services.caption.styles import seed_preset_styles
from app.services.transcribe.whisper_service import transcribe_video
from app.services.trends.queries import latest_scores_query, observed_patterns
from app.services.trends.trend_engine import normalize_hashtag
from pydantic import BaseModel, Field, field_validator
from sqlalchemy.orm import Session

logger = logging.getLogger(__name__)

# Game & topic signatures for accurate context classification
GAME_SIGNATURES: dict[str, list[str]] = {
    "Valorant": [
        "valorant",
        "vandal",
        "phantom",
        "spike",
        "jett",
        "reyna",
        "omen",
        "sage",
        "radiant",
        "defuse",
        "sova",
        "raze",
        "viper",
        "cypher",
        "vct",
        "sentinels",
        "tenz",
        "tarik",
    ],
    "Minecraft": [
        "minecraft",
        "creeper",
        "diamond",
        "nether",
        "ender",
        "pickaxe",
        "speedrun",
        "redstone",
        "steve",
        "herobrine",
        "piglin",
        "elytra",
        "bedrock",
    ],
    "Call of Duty: Warzone": [
        "warzone",
        "gulag",
        "loadout",
        "cod",
        "call of duty",
        "rebirth",
        "urzikstan",
        "verdansk",
        "snipers",
        "slide cancel",
        "mw3",
        "mw2",
    ],
    "Counter-Strike 2": [
        "cs2",
        "cs:go",
        "counter-strike",
        "counter strike",
        "awp",
        "defuse",
        "rush b",
        "mirage",
        "dust2",
        "inferno",
        "s1mple",
        "zywoo",
        "major",
        "bomb has been planted",
    ],
    "Fortnite": [
        "fortnite",
        "victory royale",
        "chug jug",
        "crank",
        "90s",
        "battle bus",
        "tilted towers",
        "epic games",
        "siphon",
        "pump shotgun",
    ],
    "League of Legends": [
        "league of legends",
        "league",
        "lol",
        "gank",
        "baron",
        "dragon",
        "mid diff",
        "bot diff",
        "faker",
        "yasuo",
        "riot games",
        "summoner's rift",
        "jungler",
    ],
    "Apex Legends": [
        "apex legends",
        "apex",
        "wraith",
        "champion",
        "shield battery",
        "r99",
        "peacekeeper",
        "respawn beacon",
        "octane",
        "pathfinder",
    ],
    "Grand Theft Auto V": [
        "gta",
        "gta v",
        "gta 5",
        "grand theft auto",
        "rp",
        "fivem",
        "nopixel",
        "los santos",
        "cops",
    ],
    "Rocket League": [
        "rocket league",
        "aerial",
        "flip reset",
        "octane",
        "dominus",
        "grand champ",
        "soccar",
    ],
    "Podcast & Discussion": [
        "podcast",
        "interview",
        "episode",
        "discussion",
        "talk show",
        "debate",
        "deep dive",
        "guest",
    ],
    "Tech & Coding": [
        "coding",
        "programming",
        "developer",
        "software",
        "python",
        "javascript",
        "react",
        "ai",
        "tutorial",
        "saas",
        "tech",
        "github",
    ],
}

EVENT_KEYWORDS: dict[str, list[str]] = {
    "clutch": [
        "clutch",
        "1v1",
        "1v2",
        "1v3",
        "1v4",
        "1v5",
        "last alive",
        "defuse",
        "impossible round",
    ],
    "ace": ["ace", "team wipe", "all five", "killed all", "penta kill", "pentakill"],
    "funny_fail": [
        "fell",
        "missed",
        "died to",
        "troll",
        "fail",
        "threw",
        "accident",
        "hilarious",
        "kekw",
        "bruh",
        "what was that",
    ],
    "rage_quit": [
        "rage",
        "quitting",
        "uninstall",
        "slammed",
        "broken",
        "screaming",
        "hacker",
        "cheater",
    ],
    "reaction": [
        "reacts to",
        "reacting",
        "watching",
        "holy",
        "insane",
        "unreal",
        "omg",
        "shocked",
        "speechless",
    ],
    "tutorial_tip": [
        "how to",
        "secret trick",
        "best setting",
        "pro tip",
        "guide",
        "you need to know",
    ],
    "chill_story": [
        "storytime",
        "so basically",
        "let me explain",
        "remember when",
        "back in",
        "actually",
    ],
}


class ClipContext(BaseModel):
    """Rich multidimensional context for a generated clip."""

    summary: str = Field(
        description="1-2 sentence description of what occurs in the clip"
    )
    game_or_topic: str = Field(
        description="Detected game (e.g. Valorant, Minecraft) or general topic (e.g. Podcast, Tech)"
    )
    genre: str = Field(
        default="Gaming",
        description="Gaming, Reaction, Comedy, Tutorial, Story, or IRL",
    )
    mood: str = Field(
        default="hype", description="hype, funny, suspense, chill, or educational"
    )
    event_type: str = Field(
        default="clutch",
        description="clutch, ace, fail, win, reaction, rant, tip, or discussion",
    )
    creator: str | None = Field(default=None, description="Streamer or channel name")
    energy_score: float = Field(
        default=85.0, ge=0.0, le=100.0, description="0-100 energy and hook rating"
    )
    suggested_style: str = Field(
        default="Punch", description="Matched caption style: Punch, Neon, or Clean"
    )
    style_rationale: str = Field(
        default="High-energy action with dramatic word pop",
        description="Why this aesthetic was selected",
    )
    hype_words: list[str] = Field(
        default_factory=list,
        description="Specific words from transcript to animate with pop scale",
    )
    matched_hashtags: list[str] = Field(
        default_factory=list, description="Platform and niche-tailored hashtags"
    )
    hashtag_sources: list[dict[str, str]] = Field(default_factory=list)
    ai_generated: bool = False
    viral_title: str = Field(description="Punchy, high-CTR title with 1 relevant emoji")

    @field_validator("hype_words", "matched_hashtags", mode="before")
    @classmethod
    def parse_str_list(cls, v):
        if isinstance(v, str):
            return [x.strip() for x in v.split(",") if x.strip()]
        if isinstance(v, list):
            return [str(x).strip() for x in v if str(x).strip()]
        return []


def _detect_game_and_event(text_corpus: str) -> tuple[str, str]:
    """Heuristically detects game and event type from text."""
    lower = text_corpus.lower()

    # Game detection
    detected_game = "General Gaming"
    for game, keywords in GAME_SIGNATURES.items():
        if any(re.search(r"\b" + re.escape(kw) + r"\b", lower) for kw in keywords):
            detected_game = game
            break

    # Event detection
    detected_event = "highlight"
    for event, keywords in EVENT_KEYWORDS.items():
        if any(re.search(r"\b" + re.escape(kw) + r"\b", lower) for kw in keywords):
            detected_event = event
            break

    return detected_game, detected_event


def _pick_caption_style(
    event_type: str, mood: str, energy_score: float
) -> tuple[str, str]:
    """Matches the optimal subtitle aesthetic based on clip dynamics."""
    if event_type in ("clutch", "ace") or energy_score >= 82.0 or mood == "hype":
        return (
            "Punch",
            "High-energy gameplay action matches Bangers bold font with kinetic word-pop scale.",
        )
    if event_type in ("funny_fail", "reaction", "rage_quit") or mood in (
        "funny",
        "chaotic",
    ):
        return (
            "Neon",
            "Comedic reaction or meme moment matches Luckiest Guy cyan/magenta glowing pop aesthetic.",
        )
    return (
        "Clean",
        "Talking, tutorial, or storytelling matches Poppins clean subtitle bar with smooth line pacing.",
    )


def _build_contextual_hashtags(
    game_or_topic: str,
    event_type: str,
    creator: str | None,
    platform: str,
    trending_tags: list[str],
) -> list[str]:
    """Builds a high-converting mix of niche tags, creator tag, event tag, and trending discovery tags."""
    tags: list[str] = []

    # 1. Game tag
    game_clean = re.sub(r"[^\w]", "", game_or_topic).lower()
    if game_clean and game_clean != "generalgaming":
        tags.append(f"#{game_clean}")
        tags.append(f"#{game_clean}clips")
    else:
        tags.append("#gaming")

    # 2. Event tag
    event_tag_map = {
        "clutch": "#clutch",
        "ace": "#ace",
        "funny_fail": "#funnygaming",
        "reaction": "#reaction",
        "rage_quit": "#ragequit",
        "tutorial_tip": "#gamingtips",
        "chill_story": "#storytime",
    }
    if event_type in event_tag_map:
        tags.append(event_tag_map[event_type])

    # 3. Creator tag
    if creator:
        creator_clean = re.sub(r"[^\w]", "", creator).lower()
        if creator_clean:
            tags.append(f"#{creator_clean}")

    # 4. Target platform format tags
    is_yt = platform.lower() == "youtube"
    if is_yt:
        tags.append("#Shorts")
        tags.append("#GamingShorts")
    else:
        tags.append("#fyp")
        tags.append("#viralclips")

    # 5. Inject relevant live trends from DB
    for t in trending_tags:
        clean = t if t.startswith("#") else f"#{t}"
        if clean.lower() not in [x.lower() for x in tags] and len(tags) < 6:
            tags.append(clean)

    # De-duplicate while preserving order
    seen = set()
    result = []
    for tag in tags:
        lower_t = tag.lower()
        if lower_t not in seen:
            seen.add(lower_t)
            result.append(tag)
    return result[:6]


def _heuristic_extract_context(
    clip: Clip,
    source_info: dict,
    transcript_words: Sequence[TranscriptWord | dict],
    platform: str = "tiktok",
    trending_tags: list[str] | None = None,
    trend_sources: dict[str, str] | None = None,
    pattern_summary: str | None = None,
) -> ClipContext:
    """Intelligent fallback context extraction when LLM is unavailable."""
    words = [
        TranscriptWord(**w) if isinstance(w, dict) else w for w in transcript_words
    ]
    full_text = " ".join(w.word for w in words).strip()

    source_title = source_info.get("source_title") or clip.title or ""
    creator = source_info.get("creator") or source_info.get("uploader")
    tags_corpus = " ".join(source_info.get("source_tags") or [])

    combined_corpus = f"{source_title} {tags_corpus} {full_text}"
    game, event = _detect_game_and_event(combined_corpus)

    # Calculate energy score
    duration = clip.duration_s if clip.duration_s > 0 else 15.0
    wps = len(words) / max(1.0, duration)
    acoustic_score = clip.highlight_score or 75.0
    energy_score = round(min(98.0, max(60.0, acoustic_score * 0.6 + wps * 8.0)), 1)

    mood = (
        "hype" if energy_score > 80 else ("funny" if event == "funny_fail" else "chill")
    )
    style, rationale = _pick_caption_style(event, mood, energy_score)

    # High-CTR title
    if event == "clutch":
        viral_title = f"THE MOST INSANE {game.upper()} 1v4 CLUTCH 🎯"
    elif event == "ace":
        viral_title = f"HE JUST ACED THE ENTIRE TEAM! 💀"
    elif event == "funny_fail":
        viral_title = f"BRO REALLY THOUGHT HE SURVIVED 😂"
    elif words:
        opening = " ".join(w.word for w in words[:5])
        viral_title = f"{opening[:35].strip()} 🔥"
    elif source_title:
        viral_title = f"{source_title[:40].strip()} 🔥"
    else:
        viral_title = f"UNREAL {game.upper()} HIGHLIGHT 🔥"

    hype_words = ["CLUTCH", "ACE", "NO", "WAY", "BRO", "INSANE", "OMG", "DEAD", "WHAT"]
    for tag in trending_tags or []:
        term = normalize_hashtag(tag)
        if term and re.search(
            r"\b" + re.escape(term) + r"\b", full_text, re.IGNORECASE
        ):
            hype_words.append(term.upper())
    matched_tags = _build_contextual_hashtags(
        game, event, creator, platform, trending_tags or []
    )
    source_map = trend_sources or {}
    hashtag_sources = [
        {
            "hashtag": tag,
            "source": source_map.get(normalize_hashtag(tag), "heuristic_generated"),
        }
        for tag in matched_tags
    ]

    if pattern_summary and "all-caps titles" in pattern_summary and energy_score >= 75:
        style = "Punch"
        rationale = f"Punch fits this high-energy clip; {pattern_summary}."
    elif event in ("chill_story", "tutorial_tip"):
        style = "Clean"
        rationale = f"Clean supports a story or explanation; {pattern_summary or 'no pattern sample yet'}."

    summary = f"{creator or 'Creator'} in {game} during a {event.replace('_', ' ')} moment ({round(duration)}s)."

    return ClipContext(
        summary=summary,
        game_or_topic=game,
        genre=(
            "Gaming" if "Gaming" in game or game in GAME_SIGNATURES else "Entertainment"
        ),
        mood=mood,
        event_type=event,
        creator=creator,
        energy_score=energy_score,
        suggested_style=style,
        style_rationale=rationale,
        hype_words=hype_words,
        matched_hashtags=matched_tags,
        hashtag_sources=hashtag_sources,
        ai_generated=False,
        viral_title=viral_title,
    )


def _relevant_trends(
    db: Session, platform: str, region: str, clip_text: str
) -> list[dict]:
    platform_name = "youtube" if platform.lower() == "youtube" else "tiktok"
    try:
        rows = latest_scores_query(db, platform_name, region).all()
    except Exception as err:
        logger.warning(f"Could not query latest trend scores: {err}")
        return []
    matches = []
    corpus = clip_text.casefold()
    for score, hashtag in rows:
        terms = [
            term for term in re.split(r"[^\w]+", hashtag.normalized) if len(term) >= 3
        ]
        occurrences = sum(
            len(re.findall(rf"(?<!\w){re.escape(term)}(?!\w)", corpus))
            for term in terms
        )
        if occurrences:
            matches.append(
                {
                    "hashtag": hashtag.display,
                    "stage": score.stage,
                    "score": score.score,
                    "source": score.source,
                    "occurrences": occurrences,
                }
            )
    matches.sort(
        key=lambda item: (item["occurrences"], item["score"] or 0), reverse=True
    )
    return matches[:8]


def extract_clip_context(
    clip: Clip,
    db: Session,
    platform: str = "tiktok",
    source_hint: dict | None = None,
) -> ClipContext:
    """
    Extracts deep multimodal context for a clip and matches:
    - Optimal Caption Style & hype words
    - Context-matched hashtags blending niche, creator, and live platform trends
    - High-CTR viral title
    """
    # 1. Gather Source Information
    source_info: dict = dict(clip.context_json or {})
    if source_hint:
        source_info.update(source_hint)

    if not source_info.get("creator") and clip.stream and clip.stream.streamer:
        source_info["creator"] = clip.stream.streamer.username

    # 2. Ensure Audio Transcript is available
    words: list[TranscriptWord] = []
    if clip.transcript_json:
        words = [
            TranscriptWord(**w) if isinstance(w, dict) else w
            for w in clip.transcript_json
        ]
    elif clip.raw_file_path and Path(clip.raw_file_path).exists():
        try:
            logger.info(
                f"Transcribing raw clip {clip.id} for context extraction: {clip.raw_file_path}"
            )
            raw_words = transcribe_video(clip.raw_file_path)
            words = proofread_transcript(raw_words)
            clip.transcript_json = [w.model_dump() for w in words]
            db.commit()
        except Exception as e:
            logger.warning(f"Whisper transcription failed for clip {clip.id}: {e}")

    full_transcript = " ".join(w.word for w in words).strip()
    opening_hook = " ".join(w.word for w in words[:6]).strip()

    # 3. Match collected trends to this clip rather than injecting unrelated popular tags.
    region = settings.trends_region_list[0] if settings.trends_region_list else "NG"
    trend_rows = _relevant_trends(
        db, platform, region, f"{clip.title or ''} {full_transcript}"
    )
    trending_tag_list = [row["hashtag"] for row in trend_rows]
    trend_sources = {
        normalize_hashtag(row["hashtag"]): row["source"] for row in trend_rows
    }
    try:
        pattern_data = observed_patterns(db, region)
    except Exception as err:
        logger.warning(f"Could not query observed patterns: {err}")
        pattern_data = {}
    pattern_summary = None
    if pattern_data.get("sample_size"):
        all_caps = next(
            (
                row["percent"]
                for row in pattern_data["patterns"]
                if row["name"] == "all_caps_title"
            ),
            0,
        )
        pattern_summary = f"{all_caps}% of {pattern_data['sample_size']} fast-risers use all-caps titles"

    # 4. Use LLM if OpenAI API key is configured
    if not settings.openai_api_key:
        return _heuristic_extract_context(
            clip,
            source_info,
            words,
            platform=platform,
            trending_tags=trending_tag_list,
            trend_sources=trend_sources,
            pattern_summary=pattern_summary,
        )

    try:
        import openai

        client = openai.OpenAI(api_key=settings.openai_api_key, max_retries=2)
        platform_name = "YouTube Shorts" if platform.lower() == "youtube" else "TikTok"
        creator_name = source_info.get("creator") or "Creator"
        source_title = (
            source_info.get("source_title") or clip.title or "Stream Highlight"
        )
        source_tags = source_info.get("source_tags") or []

        system_prompt = (
            f"You are an AI video producer and virality strategist for {platform_name}.\n"
            "Given this clip's spoken transcript, stream/video metadata, and live platform trends, extract the exact context and produce high-converting packaging.\n\n"
            "Produce JSON matching these exact keys:\n"
            "- summary: 1-2 sentence description of what happens.\n"
            "- game_or_topic: Specific game title (e.g. 'Valorant', 'Minecraft', 'Warzone') or topic (e.g. 'Podcast', 'Tech').\n"
            "- genre: 'Gaming', 'Reaction', 'Comedy', 'Tutorial', or 'Story'.\n"
            "- mood: 'hype', 'funny', 'suspense', 'chill', or 'educational'.\n"
            "- event_type: 'clutch', 'ace', 'fail', 'reaction', 'rant', 'tip', or 'discussion'.\n"
            "- creator: Creator or streamer name.\n"
            "- energy_score: 0-100 rating based on speech pace, hook intensity, and acoustic excitement.\n"
            "- suggested_style: Choose 'Punch' (high energy/gaming clutch/shouting), 'Neon' (funny/fails/streamer chaos), or 'Clean' (talking/story/tutorial).\n"
            "- style_rationale: 1 short sentence explaining why this caption style fits.\n"
            "- hype_words: 3-6 words from transcript that deserve maximum animated visual pop.\n"
            "- matched_hashtags: 5-6 high-performing tags blending specific game/niche (#valorant, #vct), moment archetype (#clutch), creator, and 1-2 matching trends from the provided list.\n"
            "- viral_title: Punchy 3-6 word high-CTR title with 1 relevant emoji (e.g. 'HOW HE HIT THIS 1v4 🎯')."
        )

        user_content = (
            f"Target Platform: {platform_name}\n"
            f"Creator: {creator_name}\n"
            f'Source Video Title: "{source_title}"\n'
            f"Source Tags: {source_tags}\n"
            f"Clip Duration: {round(clip.duration_s)}s (Acoustic Score: {clip.highlight_score or 80.0})\n"
            f'Opening 3 seconds: "{opening_hook}"\n'
            f"Full Spoken Transcript: \"{full_transcript or '[No speech, gameplay audio]'}\"\n"
            f"Live Trending Hashtags Available on {platform_name}: {trending_tag_list}\n"
            f"Collected trend details (hashtag, stage, score, source): {trend_rows}\n"
            f"Observed fast-riser title patterns in {region}: {pattern_summary or 'insufficient sample'}"
        )

        response = client.chat.completions.create(
            model=settings.openai_model or "gpt-4o-mini",
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_content},
            ],
            response_format={"type": "json_object"},
            temperature=0.7,
            max_tokens=700,
            timeout=10,
        )

        raw_json = response.choices[0].message.content
        data = json.loads(raw_json)

        generated_tags = data.get("matched_hashtags", ["#gaming", "#fyp", "#viral"])
        hashtag_sources = [
            {
                "hashtag": tag,
                "source": trend_sources.get(normalize_hashtag(tag), "ai_generated"),
            }
            for tag in generated_tags
        ]
        hype_words = data.get("hype_words", [])
        for tag in trending_tag_list:
            term = normalize_hashtag(tag)
            if term and re.search(
                r"\b" + re.escape(term) + r"\b", full_transcript, re.IGNORECASE
            ):
                hype_words.append(term.upper())
        return ClipContext(
            summary=data.get("summary", f"{creator_name} highlight"),
            game_or_topic=data.get("game_or_topic", "General Gaming"),
            genre=data.get("genre", "Gaming"),
            mood=data.get("mood", "hype"),
            event_type=data.get("event_type", "clutch"),
            creator=creator_name,
            energy_score=float(data.get("energy_score", 85.0)),
            suggested_style=data.get("suggested_style", "Punch"),
            style_rationale=data.get("style_rationale", "High-energy gameplay action"),
            hype_words=list(dict.fromkeys(hype_words)),
            matched_hashtags=generated_tags,
            hashtag_sources=hashtag_sources,
            ai_generated=True,
            viral_title=data.get("viral_title", f"{source_title[:35]} 🔥"),
        )

    except Exception as e:
        logger.warning(
            f"OpenAI context extraction failed ({e}), falling back to heuristic engine"
        )
        return _heuristic_extract_context(
            clip, source_info, words, platform=platform, trending_tags=trending_tag_list
        )


def apply_context_to_clip(
    clip: Clip,
    db: Session,
    context: ClipContext,
) -> Clip:
    """Applies the extracted context, title, caption style, and matched hashtags directly to the database."""
    clip.title = context.viral_title
    clip.hashtags = context.matched_hashtags
    clip.highlight_score = context.energy_score

    # Auto-match caption style preset if available
    seed_preset_styles(db)
    style = (
        db.query(CaptionStyle)
        .filter(CaptionStyle.name.ilike(context.suggested_style))
        .first()
    )
    if style:
        clip.caption_style_id = style.id

    # Persist context JSON
    clip.context_json = context.model_dump()
    db.commit()
    db.refresh(clip)
    return clip

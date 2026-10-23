"""AI Viral Studio for ClipHive.
Generates high-CTR titles, hook scores (0-100), platform hashtags,
style recommendations, and hype word detection from clip transcripts.
"""
from __future__ import annotations

import json
import logging
from typing import Sequence

from pydantic import BaseModel, Field

from app.config import settings
from app.schemas.clip import TranscriptWord

logger = logging.getLogger(__name__)


class ViralMetadata(BaseModel):
    title: str = Field(description="Punchy 3-6 word high-CTR viral title with emoji")
    hook_score: float = Field(default=85.0, ge=0.0, le=100.0, description="Hook rating of the first 3 seconds")
    hashtags: list[str] = Field(default_factory=list, description="5 platform-optimized hashtags")
    suggested_style: str = Field(default="Punch", description="Recommended caption style (Punch, Clean, or Neon)")
    hype_words: list[str] = Field(default_factory=list, description="Key words to pop with extra scale")


def _normalize_words(words: Sequence[TranscriptWord | dict]) -> list[TranscriptWord]:
    normalized: list[TranscriptWord] = []
    for w in words:
        if isinstance(w, dict):
            normalized.append(
                TranscriptWord(
                    word=str(w.get("word", "")),
                    start=float(w.get("start", 0.0)),
                    end=float(w.get("end", 0.0)),
                    confidence=float(w.get("confidence", 0.9)),
                )
            )
        else:
            normalized.append(w)
    return normalized


def _heuristic_viral_metadata(raw_words: Sequence[TranscriptWord | dict], platform: str = "tiktok") -> ViralMetadata:
    """Instant offline fallback when LLM is unavailable."""
    words = _normalize_words(raw_words)
    text = " ".join(w.word for w in words[:8]) if words else "Epic Highlight"
    title = f"{text[:35].strip()} 🔥" if text else "Unreal Stream Moment 🔥"
    
    # Calculate a pseudo hook score based on speed and energy
    duration = (words[-1].end - words[0].start) if len(words) > 1 else 5.0
    wps = len(words) / max(1.0, duration)
    score = min(98.0, max(75.0, round(70.0 + wps * 6.5, 1)))

    if platform.lower() == "youtube":
        tags = ["#Shorts", "#GamingShorts", "#Gameplay", "#EpicClutch"]
    else:
        tags = ["#fyp", "#gaming", "#viralclips", "#twitchstreamer", "#foryoupage"]

    return ViralMetadata(
        title=title,
        hook_score=score,
        hashtags=tags,
        suggested_style="Punch" if score > 85 else "Clean",
        hype_words=["UNREAL", "BRO", "NO", "WAY", "CLUTCH", "OMG"],
    )


def generate_viral_metadata(
    raw_words: Sequence[TranscriptWord | dict],
    streamer_name: str | None = None,
    platform: str = "tiktok",
) -> ViralMetadata:
    """
    Generates viral short metadata tailored to TikTok or YouTube Shorts using gpt-4o-mini,
    falling back seamlessly to heuristic generation if offline.
    """
    words = _normalize_words(raw_words)
    if not words:
        return _heuristic_viral_metadata([], platform=platform)

    full_transcript = " ".join(w.word for w in words)
    opening_hook = " ".join(w.word for w in words[:6])

    if not settings.openai_api_key:
        return _heuristic_viral_metadata(words, platform=platform)

    try:
        import openai

        client = openai.OpenAI(api_key=settings.openai_api_key, max_retries=2)
        
        is_yt = platform.lower() == "youtube"
        platform_name = "YouTube Shorts" if is_yt else "TikTok"
        title_instruction = (
            "1. title: High-intent search-friendly title with 1 relevant emoji (e.g. 'HOW TO 1v4 CLUTCH IN VALORANT 🎯').\n"
            "3. hashtags: 3 to 4 specific gaming tags including #Shorts (e.g. ['#Shorts', '#GamingShorts', '#ClutchPlay']).\n"
            if is_yt
            else "1. title: Shock, curiosity gap, or funny quote with 1 relevant emoji (e.g. 'HE REALLY THOUGHT! 💀' or 'NO WAY HE HIT THIS 🔥').\n"
            "3. hashtags: 5 viral discovery tags (e.g. ['#fyp', '#gaming', '#foryoupage', '#twitchclips', '#viral']).\n"
        )

        system_prompt = (
            f"You are a short-form video virality expert specifically optimizing for {platform_name}.\n"
            "Analyze this clip's spoken transcript and produce high-converting packaging:\n"
            f"{title_instruction}"
            "2. hook_score: 0-100 score rating how engaging the first 3 seconds are.\n"
            "4. suggested_style: Choose 'Punch' (high energy/gaming), 'Neon' (hype/funny), or 'Clean' (talking/story).\n"
            "5. hype_words: 3-6 words from transcript that deserve maximum animated visual pop.\n"
            "Output JSON with these exact keys."
        )

        user_content = (
            f"Target Platform: {platform_name}\n"
            f"Streamer: {streamer_name or 'Creator'}\n"
            f"Opening 3 seconds: \"{opening_hook}\"\n"
            f"Full transcript: \"{full_transcript}\""
        )

        response = client.chat.completions.create(
            model=settings.openai_model or "gpt-4o-mini",
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_content},
            ],
            response_format={"type": "json_object"},
            temperature=0.7,
            max_tokens=600,
            timeout=8,
        )

        raw_json = response.choices[0].message.content
        data = json.loads(raw_json)

        return ViralMetadata(
            title=data.get("title", f"{opening_hook[:30]} 🔥"),
            hook_score=float(data.get("hook_score", 88.0)),
            hashtags=data.get("hashtags", ["#gaming", "#fyp", "#viral"]),
            suggested_style=data.get("suggested_style", "Punch"),
            hype_words=data.get("hype_words", []),
        )

    except Exception as e:
        logger.warning(f"AI Viral Studio generation failed ({e}), using heuristic fallback")
        return _heuristic_viral_metadata(words, platform=platform)

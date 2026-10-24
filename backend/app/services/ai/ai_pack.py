"""AI Packaging Service for ClipHive.

Reads clip audio transcripts and generates multi-option viral packaging:
- 3 high-CTR titles (max 100 characters each)
- 2 social media descriptions
- 15-20 hashtags starting with #

Handles JSON prompting, single retry on invalid JSON, Pydantic validation,
and automatic background execution when clips reach READY status.
"""
from __future__ import annotations

import json
import logging
import re
from pathlib import Path
from typing import Any

from sqlalchemy.orm import Session

from app.config import settings
from app.models.clip import Clip
from app.schemas.clip import AIPackResponse

logger = logging.getLogger("cliphive.ai_pack")

# Supplemental discovery hashtags to ensure 15-20 count without duplicates
DEFAULT_HASHTAGS = [
    "#gaming",
    "#fyp",
    "#viral",
    "#shorts",
    "#gamingclips",
    "#twitch",
    "#streamer",
    "#kick",
    "#clutch",
    "#highlight",
    "#trending",
    "#foryou",
    "#gameplay",
    "#funny",
    "#esports",
    "#videogames",
    "#gamer",
    "#contentcreator",
    "#viralclips",
    "#bestclips",
]


def get_clip_transcript(clip: Clip, db: Session) -> str:
    """Reads speech transcript from clip, transcribing raw video if needed."""
    if clip.transcript_json:
        words = []
        for w in clip.transcript_json:
            if isinstance(w, dict):
                words.append(str(w.get("word", "")).strip())
            else:
                words.append(str(getattr(w, "word", "")).strip())
        text = " ".join(w for w in words if w).strip()
        if text:
            return text

    if clip.raw_file_path and Path(clip.raw_file_path).exists():
        try:
            from app.services.ai.proofreader import proofread_transcript
            from app.services.transcribe.whisper_service import transcribe_video

            logger.info("Transcribing clip %d for AI packaging: %s", clip.id, clip.raw_file_path)
            raw_words = transcribe_video(clip.raw_file_path)
            proofed = proofread_transcript(raw_words)
            clip.transcript_json = [w.model_dump() for w in proofed]
            db.commit()
            return " ".join(w.word for w in proofed).strip()
        except Exception as exc:
            logger.warning("Transcription attempt failed for clip %d: %s", clip.id, exc)

    return ""


def get_ai_client() -> tuple[Any, str]:
    """Resolves the configured LLM client and model name."""
    from app.services.agents.runtime import agent_client

    client, model, _ = agent_client()
    if client is not None and model is not None:
        return client, model

    import openai

    if settings.openai_api_key:
        return (
            openai.OpenAI(api_key=settings.openai_api_key, max_retries=2, timeout=30),
            settings.openai_model or "gpt-4o-mini",
        )
    if settings.groq_api_key:
        from app.services.ai.groq_client import groq_client

        g_client = groq_client(timeout_s=30)
        if g_client:
            return g_client, settings.groq_chat_model or "openai/gpt-oss-20b"

    raise RuntimeError("AI titles and hashtags aren't available right now.")


def _clean_json_text(text: str) -> str:
    """Extracts JSON substring, stripping markdown code fences."""
    cleaned = text.strip()
    if "```" in cleaned:
        match = re.search(r"```(?:json)?\s*([\s\S]*?)\s*```", cleaned)
        if match:
            return match.group(1).strip()
        return cleaned.replace("```json", "").replace("```", "").strip()
    return cleaned


def call_llm_for_pack(client: Any, model: str, prompt_text: str) -> dict:
    """Queries the LLM for JSON only, with exactly one retry on invalid JSON."""
    system_prompt = (
        "You are an expert social media video producer and virality strategist.\n"
        "Analyze the provided video transcript and metadata to generate high-converting packaging.\n"
        "You MUST respond with valid JSON ONLY. Do not output markdown backticks (no ```json), commentary, or extra prose.\n\n"
        "Exact JSON schema required:\n"
        "{\n"
        '  "titles": ["title 1", "title 2", "title 3"],\n'
        '  "descriptions": ["description 1", "description 2"],\n'
        '  "hashtags": ["#tag1", "#tag2", ...]\n'
        "}\n\n"
        "Requirements:\n"
        "- titles: exactly 3 punchy, high-CTR viral titles. Every title must be 100 characters or less.\n"
        "- descriptions: exactly 2 engaging social media descriptions (1-3 sentences with hook and call to action).\n"
        "- hashtags: 15 to 20 relevant tags blending niche topics, moment type, and viral discovery. Every hashtag must start with '#'."
    )

    last_error: Exception | None = None
    raw_content: str = ""

    for attempt in range(2):
        messages = [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": prompt_text},
        ]
        if attempt == 1:
            messages.append({"role": "assistant", "content": raw_content or "{}"})
            messages.append({
                "role": "user",
                "content": (
                    "Your previous response was not valid JSON. "
                    "Output strictly valid JSON with exact keys: 'titles' (3 strings), "
                    "'descriptions' (2 strings), and 'hashtags' (15-20 strings starting with '#'). "
                    "No markdown backticks, no prose."
                ),
            })

        try:
            try:
                response = client.chat.completions.create(
                    model=model,
                    messages=messages,
                    response_format={"type": "json_object"},
                    temperature=0.7,
                    max_tokens=900,
                    timeout=30,
                )
            except Exception:
                response = client.chat.completions.create(
                    model=model,
                    messages=messages,
                    temperature=0.7,
                    max_tokens=900,
                    timeout=30,
                )

            raw_content = response.choices[0].message.content or ""
            clean_str = _clean_json_text(raw_content)
            parsed = json.loads(clean_str)
            if isinstance(parsed, dict):
                return parsed
            last_error = ValueError("AI output was not a JSON dictionary")
        except Exception as exc:
            last_error = exc
            logger.warning("AI packaging JSON attempt %d failed: %s", attempt + 1, exc)

    raise ValueError(f"AI model did not return valid JSON after retry: {last_error}")


def sanitize_and_validate_pack(data: dict, clip: Clip) -> AIPackResponse:
    """Strips duplicates, forces '#' on hashtags, caps titles at 100 characters,
    ensures required counts, and validates with Pydantic."""
    raw_titles = data.get("titles") or []
    raw_descriptions = data.get("descriptions") or []
    raw_hashtags = data.get("hashtags") or []

    if not isinstance(raw_titles, list):
        raw_titles = [str(raw_titles)] if raw_titles else []
    if not isinstance(raw_descriptions, list):
        raw_descriptions = [str(raw_descriptions)] if raw_descriptions else []
    if not isinstance(raw_hashtags, list):
        raw_hashtags = [str(raw_hashtags)] if raw_hashtags else []

    # 1. Titles: cap at 100 characters, strip duplicates
    seen_titles = set()
    cleaned_titles: list[str] = []
    for t in raw_titles:
        title = str(t).strip()[:100]
        if title and title.lower() not in seen_titles:
            seen_titles.add(title.lower())
            cleaned_titles.append(title)

    fallback_base = (clip.title or "Epic Highlight")[:85]
    while len(cleaned_titles) < 3:
        cand = f"{fallback_base} · Part {len(cleaned_titles) + 1}"[:100]
        if cand.lower() not in seen_titles:
            seen_titles.add(cand.lower())
            cleaned_titles.append(cand)
        else:
            cleaned_titles.append(f"{fallback_base} #{len(cleaned_titles) + 1}"[:100])
    cleaned_titles = cleaned_titles[:3]

    # 2. Descriptions: strip duplicates, ensure exactly 2
    seen_desc = set()
    cleaned_descriptions: list[str] = []
    for d in raw_descriptions:
        desc = str(d).strip()
        if desc and desc.lower() not in seen_desc:
            seen_desc.add(desc.lower())
            cleaned_descriptions.append(desc)

    fallback_descriptions = [
        f"Watch this insane moment from {clip.title or 'the stream'}! Like and follow for more.",
        "Unreal highlight you don't want to miss! Subscribe and drop your thoughts in the comments.",
    ]
    for fd in fallback_descriptions:
        if len(cleaned_descriptions) >= 2:
            break
        if fd.lower() not in seen_desc:
            seen_desc.add(fd.lower())
            cleaned_descriptions.append(fd)
    cleaned_descriptions = cleaned_descriptions[:2]

    # 3. Hashtags: force '#', strip duplicates (case-insensitive), ensure 15 to 20
    seen_tags = set()
    cleaned_hashtags: list[str] = []
    for h in raw_hashtags:
        tag_str = str(h).strip()
        if not tag_str:
            continue
        tag = tag_str if tag_str.startswith("#") else f"#{tag_str}"
        tag_clean = "#" + re.sub(r"[^\w]", "", tag[1:])
        if len(tag_clean) > 1 and tag_clean.lower() not in seen_tags:
            seen_tags.add(tag_clean.lower())
            cleaned_hashtags.append(tag_clean)

    for st in DEFAULT_HASHTAGS:
        if len(cleaned_hashtags) >= 15:
            break
        if st.lower() not in seen_tags:
            seen_tags.add(st.lower())
            cleaned_hashtags.append(st)

    if len(cleaned_hashtags) > 20:
        cleaned_hashtags = cleaned_hashtags[:20]

    return AIPackResponse(
        titles=cleaned_titles,
        descriptions=cleaned_descriptions,
        hashtags=cleaned_hashtags,
        title=cleaned_titles[0],
        description=cleaned_descriptions[0],
        id=clip.id,
        context_json=clip.context_json,
    )


def generate_ai_pack_data(clip: Clip, db: Session, platform: str = "tiktok") -> AIPackResponse:
    """Extracts transcript, calls LLM, sanitizes, and returns validated AIPackResponse."""
    transcript = get_clip_transcript(clip, db)
    display_transcript = transcript if transcript else "[No spoken dialogue detected in audio]"

    creator = None
    if clip.stream and clip.stream.streamer:
        creator = clip.stream.streamer.username
    elif clip.context_json and clip.context_json.get("creator"):
        creator = clip.context_json.get("creator")

    game = (clip.context_json or {}).get("game_or_topic") or "Gaming"

    prompt_text = (
        f"Target Platform: {platform}\n"
        f"Clip Title: {clip.title or 'Stream Highlight'}\n"
        f"Creator: {creator or 'Streamer'}\n"
        f"Game/Topic: {game}\n"
        f"Duration: {round(clip.duration_s, 1)}s\n"
        f"Spoken Transcript:\n\"{display_transcript}\"\n\n"
        "Generate 3 viral titles (<=100 chars each), 2 descriptions, and 15-20 hashtags (starting with '#') in the required JSON format."
    )

    client, model = get_ai_client()
    raw_data = call_llm_for_pack(client, model, prompt_text)
    return sanitize_and_validate_pack(raw_data, clip)


def apply_ai_pack_to_clip(clip: Clip, db: Session, pack: AIPackResponse) -> None:
    """Saves titles[0], descriptions[0] and hashtags onto the clip."""
    clip.title = pack.titles[0]
    clip.description = pack.descriptions[0]
    clip.hashtags = pack.hashtags

    ctx = dict(clip.context_json or {})
    ctx["ai_pack_done"] = True
    ctx["ai_titles"] = pack.titles
    ctx["ai_descriptions"] = pack.descriptions
    clip.context_json = ctx

    db.commit()
    db.refresh(clip)


def auto_run_ai_pack(clip: Clip, db: Session) -> None:
    """Runs ai-pack automatically once when a clip becomes 'ready'.

    Saves titles[0], descriptions[0], and hashtags onto the clip.
    If it fails, logs it and leaves the clip ready. Never blocks or fails the pipeline.
    """
    try:
        ctx = dict(clip.context_json or {})
        if ctx.get("ai_pack_done") or (clip.description and clip.hashtags and len(clip.hashtags) >= 15):
            return

        pack = generate_ai_pack_data(clip, db)
        apply_ai_pack_to_clip(clip, db, pack)
        logger.info("Auto AI packaging successfully applied for clip %d", clip.id)
    except Exception as exc:
        logger.error("Auto AI packaging failed for clip %d: %s", clip.id, exc)
        try:
            db.rollback()
        except Exception:
            pass

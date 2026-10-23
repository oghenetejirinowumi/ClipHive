"""Context-aware AI caption proofreader for ClipHive.
Corrects phonetic ASR errors over stream music/game audio while preserving
speaker slang, style, and millisecond-accurate subtitle synchronization.
"""
from __future__ import annotations

import json
import logging
from typing import Sequence

from app.config import settings
from app.schemas.clip import TranscriptWord

logger = logging.getLogger(__name__)

LOW_CONFIDENCE_THRESHOLD = 0.65


def proofread_transcript(words: Sequence[TranscriptWord]) -> list[TranscriptWord]:
    """
    Proofreads transcript words using an LLM (gpt-4o-mini) when available.
    Only uncertain words are touched, and corrected words preserve original time spans.
    """
    if not words:
        return []

    word_list = [w if isinstance(w, TranscriptWord) else TranscriptWord(**w) for w in words]
    low_conf_words = [w for w in word_list if w.confidence < LOW_CONFIDENCE_THRESHOLD]

    # If no uncertain words or no OpenAI key, return as is
    if not low_conf_words or not settings.openai_api_key:
        return word_list

    try:
        import openai

        client = openai.OpenAI(api_key=settings.openai_api_key, max_retries=2)
        full_text = " ".join(w.word for w in word_list)
        flagged_summary = [f"word #{idx}: '{w.word}' (confidence {w.confidence:.2f})" for idx, w in enumerate(word_list) if w.confidence < LOW_CONFIDENCE_THRESHOLD]

        system_prompt = (
            "You are a subtitle proofreader for short-form gaming and livestream clips.\n"
            "Speech recognition often mishears words over loud game sounds or background music.\n"
            "Rules:\n"
            "- Only propose corrections for uncertain words that clearly sound similar to what was actually said in context.\n"
            "- NEVER change slang (e.g., clutch, diff, bro, gg, pog, cap, rizz).\n"
            "- NEVER censor, formalize, or rewrite sentences.\n"
            "- If a word is correct or you are unsure, leave it alone.\n"
            "Output JSON: {\"corrections\": [{\"index\": int, \"original\": str, \"replacement\": str}]}"
        )

        user_content = (
            f"Full Transcript:\n\"{full_text}\"\n\n"
            f"Uncertain words:\n" + "\n".join(flagged_summary[:15])
        )

        response = client.chat.completions.create(
            model=settings.openai_model or "gpt-4o-mini",
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_content},
            ],
            response_format={"type": "json_object"},
            temperature=0.2,
            max_tokens=1000,
            timeout=8,
        )

        raw_json = response.choices[0].message.content
        data = json.loads(raw_json)
        corrections = data.get("corrections", [])

        # Apply corrections right-to-left so multi-word expansions keep earlier indices valid
        valid_corrections = [
            c for c in corrections
            if c.get("index") is not None
            and 0 <= c["index"] < len(word_list)
            and c.get("replacement", "").strip()
        ]
        sorted_corrections = sorted(valid_corrections, key=lambda c: c["index"], reverse=True)

        corrected_words = list(word_list)
        for c in sorted_corrections:
            idx = c["index"]
            replacement = c["replacement"].strip()
            orig = corrected_words[idx]
            if orig.word.lower() != replacement.lower():
                tokens = replacement.split()
                logger.info(f"AI Proofread: word #{idx} '{orig.word}' -> '{replacement}' ({len(tokens)} tokens)")
                if len(tokens) == 1:
                    corrected_words[idx] = TranscriptWord(
                        word=tokens[0],
                        start=orig.start,
                        end=orig.end,
                        confidence=0.85,
                    )
                else:
                    duration = max(0.05, orig.end - orig.start)
                    step = duration / len(tokens)
                    sub_words = [
                        TranscriptWord(
                            word=t,
                            start=round(orig.start + i * step, 3),
                            end=round(orig.start + (i + 1) * step, 3),
                            confidence=0.85,
                        )
                        for i, t in enumerate(tokens)
                    ]
                    corrected_words[idx : idx + 1] = sub_words

        return corrected_words

    except Exception as e:
        logger.warning(f"AI Caption Proofreading skipped due to error: {e}")
        return word_list

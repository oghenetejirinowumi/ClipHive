"""Speech transcription service for ClipHive.
Supports faster-whisper (local, fast, free) and AssemblyAI (cloud high-accuracy)
with gaming vocabulary prompt steering and confidence tracking.
"""
from __future__ import annotations

import logging
import os
from pathlib import Path
from typing import Sequence

import requests

from app.config import settings
from app.schemas.clip import TranscriptWord

logger = logging.getLogger(__name__)

# Gaming and streaming vocabulary dictionary used to steer the speech model
GAMING_VOCABULARY = [
    "clutch",
    "ace",
    "headshot",
    "360",
    "no scope",
    "diff",
    "nerf",
    "buff",
    "mid",
    "inting",
    "tilted",
    "Pog",
    "KEKW",
    "GG",
    "clip that",
    "streamer",
    "Twitch",
    "Kick",
    "YouTube",
    "esports",
    "FPS",
    "aimbot",
    "one tap",
    "respawn",
    "meta",
    "grind",
]

_whisper_instance = None


def get_whisper_model(model_size: str | None = None, device: str = "cpu", compute_type: str = "int8"):
    """Lazily load and cache the faster-whisper model."""
    global _whisper_instance
    target_size = model_size or settings.whisper_model_size or "base"
    if _whisper_instance is None:
        from faster_whisper import WhisperModel

        logger.info(f"Loading faster-whisper model: size={target_size}, device={device}, compute_type={compute_type}")
        _whisper_instance = WhisperModel(target_size, device=device, compute_type=compute_type)
    return _whisper_instance


def transcribe_with_faster_whisper(
    file_path: str | Path,
    language: str | None = "en",
    model_size: str | None = None,
    vocabulary: Sequence[str] = GAMING_VOCABULARY,
) -> list[TranscriptWord]:
    """Transcribes audio using faster-whisper with domain vocabulary and word confidence."""
    path_str = str(file_path)
    if not Path(path_str).exists():
        raise FileNotFoundError(f"Media file not found: {path_str}")

    model = get_whisper_model(model_size=model_size)
    initial_prompt = " ".join(vocabulary) if vocabulary else None

    segments, info = model.transcribe(
        path_str,
        language=language,
        word_timestamps=True,
        vad_filter=True,
        vad_parameters=dict(min_silence_duration_ms=400),
        initial_prompt=initial_prompt,
    )

    words: list[TranscriptWord] = []
    for segment in segments:
        if not segment.words:
            continue
        for w in segment.words:
            clean = w.word.strip()
            if clean:
                confidence = round(float(getattr(w, "probability", 0.9)), 2)
                words.append(
                    TranscriptWord(
                        word=clean,
                        start=round(float(w.start), 3),
                        end=round(float(w.end), 3),
                        confidence=confidence,
                    )
                )

    return words


def transcribe_with_assemblyai(
    file_path: str | Path,
    api_key: str | None = None,
    vocabulary: Sequence[str] = GAMING_VOCABULARY,
) -> list[TranscriptWord]:
    """Transcribes using AssemblyAI API (Universal-3.5 Pro) with word-level confidence."""
    key = api_key or settings.assemblyai_api_key
    if not key:
        raise ValueError("ASSEMBLYAI_API_KEY is not configured")

    headers = {"authorization": key}
    path = Path(file_path)

    # 1. Upload audio file
    logger.info(f"Uploading {path.name} to AssemblyAI...")
    with open(path, "rb") as f:
        upload_resp = requests.post(
            "https://api.assemblyai.com/v2/upload",
            headers=headers,
            data=f,
            timeout=60,
        )
    if upload_resp.status_code != 200:
        raise RuntimeError(f"AssemblyAI upload failed: {upload_resp.text}")

    audio_url = upload_resp.json()["upload_url"]

    # 2. Submit transcription job
    payload = {
        "audio_url": audio_url,
        "punctuate": True,
        "format_text": True,
        "keyterms_prompt": list(vocabulary)[:50],
    }
    tx_resp = requests.post(
        "https://api.assemblyai.com/v2/transcript",
        headers=headers,
        json=payload,
        timeout=15,
    )
    if tx_resp.status_code != 200:
        raise RuntimeError(f"AssemblyAI job creation failed: {tx_resp.text}")

    transcript_id = tx_resp.json()["id"]

    # 3. Poll for completion
    import time
    logger.info(f"Polling AssemblyAI transcript {transcript_id}...")
    for _ in range(60):  # max 3 minutes
        status_resp = requests.get(
            f"https://api.assemblyai.com/v2/transcript/{transcript_id}",
            headers=headers,
            timeout=10,
        )
        data = status_resp.json()
        status = data.get("status")
        if status == "completed":
            words: list[TranscriptWord] = []
            for item in data.get("words", []):
                words.append(
                    TranscriptWord(
                        word=item["text"],
                        start=round(item["start"] / 1000.0, 3),
                        end=round(item["end"] / 1000.0, 3),
                        confidence=round(float(item.get("confidence", 0.9)), 2),
                    )
                )
            return words
        elif status == "error":
            raise RuntimeError(f"AssemblyAI error: {data.get('error')}")
        time.sleep(3)

    raise TimeoutError("AssemblyAI transcription timed out")


def transcribe_video(
    file_path: str | Path,
    provider: str = "faster-whisper",
    language: str | None = "en",
) -> list[TranscriptWord]:
    """
    Main transcription entrypoint.
    Prefers faster-whisper by default for instant local execution,
    or AssemblyAI if requested and configured.
    """
    if provider == "assemblyai" and settings.assemblyai_api_key:
        try:
            return transcribe_with_assemblyai(file_path)
        except Exception as e:
            logger.warning(f"AssemblyAI failed ({e}), falling back to faster-whisper")

    return transcribe_with_faster_whisper(file_path, language=language)

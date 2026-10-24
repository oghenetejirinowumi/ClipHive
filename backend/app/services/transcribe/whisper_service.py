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


def _decode_audio(path: str, sample_rate: int = 16000):
    """Mono float32 audio at 16 kHz, decoded with the app's ffmpeg.

    faster-whisper's own decoder goes through PyAV, and current PyAV releases reject an
    argument faster-whisper 1.2.x still passes (metadata_errors), so we hand it the samples.
    """
    import subprocess

    import numpy as np

    from app.core.media import ffmpeg_bin

    cmd = [ffmpeg_bin(), "-hide_banner", "-loglevel", "error", "-i", path, "-vn", "-ac", "1", "-ar", str(sample_rate), "-f", "s16le", "-"]
    result = subprocess.run(cmd, capture_output=True, timeout=1800)
    if result.returncode != 0:
        raise RuntimeError("Couldn't read the audio track for transcription.")
    return np.frombuffer(result.stdout, dtype=np.int16).astype(np.float32) / 32768.0


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
        _decode_audio(path_str),
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


def extract_speech_audio(
    file_path: str | Path,
    out_path: Path,
    start_s: float = 0.0,
    max_seconds: float | None = None,
) -> Path:
    """Mono 16 kHz 32 kbps mp3: about 14 MB per hour, well under Groq's 25 MB upload cap."""
    import subprocess

    from app.core.media import ffmpeg_bin

    cmd = [ffmpeg_bin(), "-hide_banner", "-loglevel", "error", "-y"]
    if start_s > 0:
        cmd += ["-ss", f"{start_s:.2f}"]
    cmd += ["-i", str(file_path)]
    if max_seconds:
        cmd += ["-t", f"{max_seconds:.2f}"]
    cmd += ["-vn", "-ac", "1", "-ar", "16000", "-b:a", "32k", str(out_path)]
    result = subprocess.run(cmd, capture_output=True, timeout=1800)
    if result.returncode != 0 or not out_path.exists():
        raise RuntimeError("Couldn't extract audio for transcription.")
    return out_path


def _segment_confidence(segments: list[dict], start: float) -> float:
    """Groq gives no per-word probability, so use the enclosing segment's average log-prob."""
    import math

    for seg in segments:
        if seg.get("start", 0) <= start <= seg.get("end", 0) + 0.05:
            logprob = seg.get("avg_logprob")
            if logprob is not None:
                return round(min(1.0, max(0.0, math.exp(float(logprob)))), 2)
    return 0.9


def transcribe_with_groq(
    file_path: str | Path,
    language: str | None = "en",
    vocabulary: Sequence[str] = GAMING_VOCABULARY,
    start_s: float = 0.0,
    max_seconds: float | None = None,
) -> list[TranscriptWord]:
    """Transcribe with Groq-hosted Whisper. Word times are in the source file's timeline
    (offset by `start_s` when only part of the file is sent)."""
    import tempfile

    from app.services.ai.groq_client import groq_client

    client = groq_client(timeout_s=120)
    if client is None:
        raise ValueError("GROQ_API_KEY is not configured")
    if not Path(file_path).exists():
        raise FileNotFoundError(f"Media file not found: {file_path}")

    with tempfile.TemporaryDirectory() as tmp:
        audio = extract_speech_audio(file_path, Path(tmp) / "speech.mp3", start_s, max_seconds)
        with open(audio, "rb") as f:
            resp = client.audio.transcriptions.create(
                file=("speech.mp3", f),
                model=settings.groq_transcribe_model,
                language=language or None,
                prompt=" ".join(vocabulary)[:800] if vocabulary else None,
                response_format="verbose_json",
                timestamp_granularities=["word", "segment"],
                temperature=0.0,
            )

    data = resp.model_dump() if hasattr(resp, "model_dump") else dict(resp)
    segments = data.get("segments") or []
    words: list[TranscriptWord] = []
    for w in data.get("words") or []:
        clean = (w.get("word") or "").strip()
        if not clean:
            continue
        start = float(w.get("start", 0))
        words.append(
            TranscriptWord(
                word=clean,
                start=round(start + start_s, 3),
                end=round(float(w.get("end", start)) + start_s, 3),
                confidence=_segment_confidence(segments, start),
            )
        )
    return words


OPENAI_CHUNK_S = 30 * 60  # 32 kbps mono: ~7 MB per chunk, well under OpenAI's 25 MB upload cap


def transcribe_with_openai(
    file_path: str | Path,
    language: str | None = "en",
    vocabulary: Sequence[str] = GAMING_VOCABULARY,
    start_s: float = 0.0,
    max_seconds: float | None = None,
) -> list[TranscriptWord]:
    """Transcribe with OpenAI Whisper (OPENAI_TRANSCRIBE_MODEL, word timestamps). Long audio is
    sent in 30-minute chunks. Word times are in the source file's timeline."""
    import tempfile

    import openai

    if not settings.openai_api_key:
        raise ValueError("OPENAI_API_KEY is not configured")
    if not Path(file_path).exists():
        raise FileNotFoundError(f"Media file not found: {file_path}")
    from app.core.media import probe

    total = max_seconds or probe(Path(file_path))[0] or OPENAI_CHUNK_S
    client = openai.OpenAI(api_key=settings.openai_api_key, max_retries=2, timeout=300)
    words: list[TranscriptWord] = []
    with tempfile.TemporaryDirectory() as tmp:
        offset = 0.0
        while offset < total - 0.5:
            length = min(OPENAI_CHUNK_S, total - offset)
            audio = extract_speech_audio(file_path, Path(tmp) / f"part{int(offset)}.mp3", start_s + offset, length)
            with open(audio, "rb") as f:
                resp = client.audio.transcriptions.create(
                    file=(audio.name, f),
                    model=settings.openai_transcribe_model or "whisper-1",
                    language=language or None,
                    prompt=" ".join(vocabulary)[:800] if vocabulary else None,
                    response_format="verbose_json",
                    timestamp_granularities=["word", "segment"],
                    temperature=0.0,
                )
            data = resp.model_dump() if hasattr(resp, "model_dump") else dict(resp)
            segments = data.get("segments") or []
            for w in data.get("words") or []:
                clean = (w.get("word") or "").strip()
                if not clean:
                    continue
                t = float(w.get("start", 0))
                words.append(TranscriptWord(
                    word=clean,
                    start=round(t + start_s + offset, 3),
                    end=round(float(w.get("end", t)) + start_s + offset, 3),
                    confidence=_segment_confidence(segments, t),
                ))
            offset += length
    return words


def transcribe_full(file_path: str | Path, max_seconds: float | None = None) -> list[TranscriptWord] | None:
    """One transcript of a whole source (for finding moments by what's said): Groq when its key
    is set, else OpenAI. None when neither is configured (local Whisper is too slow for hours of
    audio) or the source is longer than FULL_TRANSCRIPT_MAX_MINUTES."""
    limit = settings.full_transcript_max_minutes * 60
    if limit <= 0 or (max_seconds or 0) > limit:
        return None
    if settings.groq_api_key:
        try:
            return transcribe_with_groq(file_path, max_seconds=max_seconds)
        except Exception as e:
            logger.warning(f"Groq full transcript failed ({e}), trying OpenAI")
    if settings.openai_api_key:
        return transcribe_with_openai(file_path, max_seconds=max_seconds)
    return None


def transcribe_video(
    file_path: str | Path,
    provider: str = "auto",
    language: str | None = "en",
) -> list[TranscriptWord]:
    """
    Main transcription entrypoint.
    "auto" uses Groq when GROQ_API_KEY is set (fast, large-v3 accuracy), then OpenAI Whisper
    when OPENAI_API_KEY is set, otherwise local faster-whisper. "assemblyai" uses AssemblyAI if configured. Every cloud path falls back
    to faster-whisper on error.
    """
    if provider == "assemblyai" and settings.assemblyai_api_key:
        try:
            return transcribe_with_assemblyai(file_path)
        except Exception as e:
            logger.warning(f"AssemblyAI failed ({e}), falling back to faster-whisper")
    elif provider in ("auto", "groq") and settings.groq_api_key:
        try:
            return transcribe_with_groq(file_path, language=language)
        except Exception as e:
            logger.warning(f"Groq transcription failed ({e}), falling back to faster-whisper")
    if provider in ("auto", "openai") and settings.openai_api_key:
        try:
            return transcribe_with_openai(file_path, language=language)
        except Exception as e:
            logger.warning(f"OpenAI transcription failed ({e}), falling back to faster-whisper")

    return transcribe_with_faster_whisper(file_path, language=language)

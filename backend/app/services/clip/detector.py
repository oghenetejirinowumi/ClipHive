"""Find the most energetic moments in a video from its audio loudness.

Loud reactions, shouting, hype and laughter are the most reliable single signal for stream
highlights and need no GPU: decode the audio once, measure loudness per half-second, and rank
windows by how far they spike above the video's own baseline.
"""
from __future__ import annotations

import subprocess
from dataclasses import dataclass
from pathlib import Path

import numpy as np

from app.core.media import MediaError, ffmpeg_bin

SAMPLE_RATE = 8000
HOP_S = 0.5


@dataclass
class Highlight:
    start_s: float
    end_s: float
    score: float  # 0-100, relative to the rest of this video
    reason: str | None = None  # set when an AI model ranked this moment


def _loudness_db(path: Path, max_seconds: float) -> np.ndarray:
    """Loudness (dBFS) for every HOP_S of audio."""
    cmd = [ffmpeg_bin(), "-hide_banner", "-loglevel", "error", "-t", f"{max_seconds:.2f}", "-i", str(path),
           "-vn", "-ac", "1", "-ar", str(SAMPLE_RATE), "-f", "s16le", "-"]
    result = subprocess.run(cmd, capture_output=True, timeout=1800)
    if result.returncode != 0:
        raise MediaError("Couldn't read the audio track of that video.")
    samples = np.frombuffer(result.stdout, dtype=np.int16).astype(np.float32) / 32768.0
    hop = int(SAMPLE_RATE * HOP_S)
    frames = len(samples) // hop
    if frames == 0:
        return np.zeros(0)
    rms = np.sqrt(np.mean(samples[: frames * hop].reshape(frames, hop) ** 2, axis=1))
    return 20 * np.log10(rms + 1e-6)


def find_highlights(path: Path, duration_s: float, count: int, clip_seconds: int) -> list[Highlight]:
    """Up to `count` non-overlapping windows of `clip_seconds`, best first then sorted by time."""
    if duration_s <= clip_seconds + 1:
        return [Highlight(0.0, duration_s, 100.0)]

    db = _loudness_db(path, duration_s)
    silent = db.size == 0 or float(db.max()) < -55  # no usable audio: fall back to even spacing
    win = max(1, int(clip_seconds / HOP_S))

    if silent or db.size <= win:
        step = (duration_s - clip_seconds) / max(1, count - 1) if count > 1 else 0
        return [Highlight(i * step, i * step + clip_seconds, 50.0) for i in range(count)]

    # Spikes relative to this video's own baseline (robust z-score).
    median = np.median(db)
    mad = np.median(np.abs(db - median)) * 1.4826 + 1e-6
    z = np.clip((db - median) / mad, -3, 6)

    # Window score: average of its loudest third, so a burst counts more than steady noise,
    # plus a centre-weighted term so the moment lands mid-clip with lead-in, not at an edge.
    k = max(1, win // 3)
    windows = np.lib.stride_tricks.sliding_window_view(z, win)
    centre = np.hanning(win + 2)[1:-1]
    scores = np.sort(windows, axis=1)[:, -k:].mean(axis=1) + 0.25 * (windows @ centre) / centre.sum()

    picked: list[int] = []
    for i in np.argsort(scores)[::-1]:
        if all(abs(int(i) - j) >= win for j in picked):
            picked.append(int(i))
        if len(picked) == count:
            break

    lo, hi = float(scores.min()), float(scores.max())
    span = (hi - lo) or 1.0
    highlights = [
        Highlight(
            start_s=round(i * HOP_S, 2),
            end_s=round(min(duration_s, i * HOP_S + clip_seconds), 2),
            score=round(40 + 60 * (float(scores[i]) - lo) / span, 1),
        )
        for i in picked
    ]
    return sorted(highlights, key=lambda h: h.start_s)


def energy_curve(path: Path, duration_s: float, buckets: int = 600) -> list[float]:
    """Loudness over time scaled to 0-1 (peak per bucket), for drawing a timeline."""
    db = _loudness_db(path, duration_s)
    if db.size == 0:
        return []
    edges = np.linspace(0, db.size, min(buckets, db.size) + 1).astype(int)
    peaks = np.array([db[a:b].max() for a, b in zip(edges[:-1], edges[1:]) if b > a])
    lo, hi = np.percentile(peaks, 5), peaks.max()
    return [round(float(v), 3) for v in np.clip((peaks - lo) / ((hi - lo) or 1.0), 0, 1)]

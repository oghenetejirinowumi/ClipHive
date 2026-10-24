"""Find the most energetic moments in a video from its audio loudness and scene cuts.

Loud reactions, shouting, hype and laughter are the most reliable single signal for stream
highlights and need no GPU: decode the audio once, measure loudness per half-second, and rank
windows by how far they spike above the video's own baseline. Each chosen clip's start then
snaps to a scene cut within a couple of seconds (checked only around that point, so a long VOD
costs the same as a short one), so a clip opens on a clean frame instead of mid-transition.
"""
from __future__ import annotations

import re
import subprocess
from dataclasses import dataclass
from pathlib import Path

import numpy as np

from app.core.media import MediaError, ffmpeg_bin

SAMPLE_RATE = 8000
HOP_S = 0.5
SCENE_THRESHOLD = 0.3  # ffmpeg scene score (0-1) between consecutive frames
SNAP_S = 2.0  # move a clip's start to a scene cut at most this far away

_PTS = re.compile(r"pts_time:(\d+(?:\.\d+)?)")


@dataclass
class Highlight:
    start_s: float
    end_s: float
    score: float  # 0-100, relative to the rest of this video


def _loudness_db(path: Path, max_seconds: float) -> np.ndarray:
    """Loudness (dBFS) for every HOP_S of audio.

    Audio is read in one-minute blocks, so a multi-hour VOD needs a few MB, not gigabytes.
    """
    cmd = [ffmpeg_bin(), "-hide_banner", "-loglevel", "error", "-t", f"{max_seconds:.2f}", "-i", str(path),
           "-vn", "-ac", "1", "-ar", str(SAMPLE_RATE), "-f", "s16le", "-"]
    hop_bytes = int(SAMPLE_RATE * HOP_S) * 2
    block = hop_bytes * int(60 / HOP_S)
    rms: list[np.ndarray] = []
    leftover = b""
    proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
    assert proc.stdout is not None
    while chunk := proc.stdout.read(block):
        data = leftover + chunk
        usable = len(data) - len(data) % hop_bytes
        leftover = data[usable:]
        if usable:
            samples = np.frombuffer(data[:usable], dtype=np.int16).astype(np.float32) / 32768.0
            rms.append(np.sqrt(np.mean(samples.reshape(-1, hop_bytes // 2) ** 2, axis=1)))
    if proc.wait() != 0:
        raise MediaError("Couldn't read the audio track of that video.")
    if not rms:
        return np.zeros(0)
    return 20 * np.log10(np.concatenate(rms) + 1e-6)


def _scene_cuts(path: Path, start: float, length: float) -> np.ndarray:
    """Timestamps (s, in the video) of hard scene changes in [start, start + length].

    Seeks straight there and decodes only those few seconds, so it's fast at any video length.
    Best effort: any failure returns no cuts and the clip keeps its loudness-based start.
    """
    start = max(0.0, start)
    cmd = [ffmpeg_bin(), "-hide_banner", "-loglevel", "info", "-ss", f"{start:.2f}", "-t", f"{length:.2f}",
           "-i", str(path), "-an", "-vf", f"scale=160:-2,select='gt(scene,{SCENE_THRESHOLD})',showinfo", "-f", "null", "-"]
    try:
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=60)
    except subprocess.TimeoutExpired:
        return np.zeros(0)
    if result.returncode != 0:
        return np.zeros(0)
    return np.array([start + float(t) for t in _PTS.findall(result.stderr)])


def _snap_start(start: float, cuts: np.ndarray, lo: float, hi: float) -> float:
    """Nearest cut within SNAP_S of start, kept inside [lo, hi] (so neighbours never overlap)."""
    near = cuts[(np.abs(cuts - start) <= SNAP_S) & (cuts >= lo) & (cuts <= hi)] if cuts.size else cuts
    return float(near[np.argmin(np.abs(near - start))]) if near.size else start


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
    highlights: list[Highlight] = []
    prev_end = 0.0
    order = sorted(picked)
    for n, i in enumerate(order):
        # A snapped start may not reach back into the previous clip or push this one into the next.
        next_start = order[n + 1] * HOP_S if n + 1 < len(order) else duration_s
        latest = min(next_start, duration_s) - clip_seconds
        cuts = _scene_cuts(path, i * HOP_S - SNAP_S, 2 * SNAP_S)
        start = _snap_start(i * HOP_S, cuts, lo=prev_end, hi=max(prev_end, latest))
        end = min(duration_s, start + clip_seconds)
        highlights.append(Highlight(start_s=round(start, 2), end_s=round(end, 2), score=round(40 + 60 * (float(scores[i]) - lo) / span, 1)))
        prev_end = end
    return highlights


def energy_curve(path: Path, duration_s: float, buckets: int = 600) -> list[float]:
    """Loudness over time scaled to 0-1 (peak per bucket), for drawing a timeline."""
    db = _loudness_db(path, duration_s)
    if db.size == 0:
        return []
    edges = np.linspace(0, db.size, min(buckets, db.size) + 1).astype(int)
    peaks = np.array([db[a:b].max() for a, b in zip(edges[:-1], edges[1:]) if b > a])
    lo, hi = np.percentile(peaks, 5), peaks.max()
    return [round(float(v), 3) for v in np.clip((peaks - lo) / ((hi - lo) or 1.0), 0, 1)]

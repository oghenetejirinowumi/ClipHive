"""Find the most energetic moments in a video from its audio loudness and scene cuts.

Loud reactions, shouting, hype and laughter are the most reliable single signal for stream
highlights and need no GPU: decode the audio once, measure loudness per half-second, and rank
windows by how far they spike above the video's own baseline. Each chosen clip's start then
snaps to a scene cut within a couple of seconds (checked only around that point, so a long VOD
costs the same as a short one), so a clip opens on a clean frame instead of mid-transition.

Each picked moment also carries a small feature vector describing its shape (peak, sustained
level, build-up, ...). Clips a user stars teach a "taste" direction in that space, and later
picks are nudged toward it (see app/services/clip/taste.py).
"""
from __future__ import annotations

import re
import subprocess
from collections.abc import Sequence
from dataclasses import dataclass, field
from pathlib import Path

import numpy as np

from app.core.media import MediaError, ffmpeg_bin

SAMPLE_RATE = 8000
HOP_S = 0.5
SCENE_THRESHOLD = 0.3  # ffmpeg scene score (0-1) between consecutive frames
SNAP_S = 2.0  # move a clip's start to a scene cut at most this far away

_PTS = re.compile(r"pts_time:(\d+(?:\.\d+)?)")
FEATURES = ("peak", "level", "focus", "build", "swing")  # see _features
TASTE_WEIGHT = 0.75  # how far a full-strength taste can move a window's score (z units)


@dataclass
class Highlight:
    start_s: float
    end_s: float
    score: float  # 0-100, relative to the rest of this video
    features: list[float] = field(default_factory=list)  # standardised within this video
    reason: str | None = None  # set when an AI model ranked this moment


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


def _overlaps(a0: float, a1: float, ranges: Sequence[tuple[float, float]]) -> bool:
    return any(a0 < b1 and b0 < a1 for b0, b1 in ranges)


def _features(windows: np.ndarray, centre: np.ndarray, k: int) -> np.ndarray:
    """Shape of each window: loudest-third peak, overall level, centre focus, build-up from
    first to last third, and how much it swings. Standardised across this video's windows."""
    third = max(1, windows.shape[1] // 3)
    feats = np.stack([
        np.sort(windows, axis=1)[:, -k:].mean(axis=1),
        windows.mean(axis=1),
        (windows @ centre) / centre.sum(),
        windows[:, -third:].mean(axis=1) - windows[:, :third].mean(axis=1),
        windows.std(axis=1),
    ], axis=1)
    return (feats - feats.mean(axis=0)) / (feats.std(axis=0) + 1e-6)


def find_highlights(
    path: Path,
    duration_s: float,
    count: int,
    clip_seconds: int,
    exclude: Sequence[tuple[float, float]] = (),
    taste: np.ndarray | None = None,
) -> list[Highlight]:
    """Up to `count` non-overlapping windows of `clip_seconds`, best first then sorted by time.

    `exclude` ranges (clips already made) are never overlapped, so asking again yields new
    moments. `taste` is a unit vector over FEATURES scaled by confidence (0-1)."""
    if count <= 0:
        return []
    if duration_s <= clip_seconds + 1:
        return [] if exclude else [Highlight(0.0, duration_s, 100.0)]

    db = _loudness_db(path, duration_s)
    silent = db.size == 0 or float(db.max()) < -55  # no usable audio: fall back to even spacing
    win = max(1, int(clip_seconds / HOP_S))

    if silent or db.size <= win:
        starts = np.arange(0, duration_s - clip_seconds + 1e-6, clip_seconds)
        free = [float(a) for a in starts if not _overlaps(a, a + clip_seconds, exclude)]
        if not free:
            return []
        idx = np.unique(np.linspace(0, len(free) - 1, min(count, len(free))).round().astype(int))
        return [Highlight(free[i], free[i] + clip_seconds, 50.0) for i in idx]

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
    feats = _features(windows, centre, k)
    if taste is not None and taste.shape == (len(FEATURES),):
        scores = scores + TASTE_WEIGHT * (feats @ taste)

    # Clips already made are off limits (their windows and anything overlapping them).
    blocked = [(max(0, int(a / HOP_S) - win + 1), int(np.ceil(b / HOP_S))) for a, b in exclude]

    picked: list[int] = []
    for i in np.argsort(scores)[::-1]:
        i = int(i)
        if any(lo <= i < hi for lo, hi in blocked):
            continue
        if all(abs(i - j) >= win for j in picked):
            picked.append(i)
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
        highlights.append(Highlight(
            start_s=round(start, 2),
            end_s=round(end, 2),
            score=round(40 + 60 * (float(scores[i]) - lo) / span, 1),
            features=[round(float(v), 3) for v in feats[i]],
        ))
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

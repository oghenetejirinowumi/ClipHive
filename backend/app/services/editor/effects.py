"""Auto effects: place punch-ins, shakes, flashes, glitches and grades where the edit calls for them.

Three signals decide where, all cheap and GPU-free:
- beats: loudness spikes in the clips' own audio (shouts, laughs, hits), mapped to timeline time;
- cuts: where one main-track clip hands over to the next;
- emphasis: captions and titles that shout ("!" or ALL CAPS words).

A style turns those moments into effects (hype = punchy, cinematic = slow and graded, clean =
subtle), and `amount` scales how many and how strong. Auto effects carry auto=True, so running
it again replaces them without touching effects placed or edited by hand.

`plan()` is pure (timeline + beats in, effects out) so it's testable without media; `beats()`
does the audio analysis. services/editor/compose.py draws the effects.
"""
from __future__ import annotations

import logging
import threading
from dataclasses import dataclass
from pathlib import Path

import numpy as np

from app.schemas.editor import Effect, Timeline
from app.services.editor import ops

logger = logging.getLogger("cliphive.editor.effects")

STYLES = ("hype", "cinematic", "clean")

# Length used when an effect is added without one (seconds).
DEFAULT_LENGTH = {
    "punch_zoom": 0.6, "slow_zoom": 4.0, "shake": 0.45, "flash": 0.3, "glitch": 0.3,
    "vignette": 3.0, "color_pop": 3.0, "black_white": 3.0,
}

BEAT_Z = 2.2  # loudness spike (robust z-score over the file) that counts as a beat
MAX_AUTO = 300


@dataclass
class Beat:
    t: float  # timeline seconds
    strength: float  # 0-1, relative to the loudest beat in the edit


# --- analysis -----------------------------------------------------------------------------

_cache: dict[tuple[str, float], np.ndarray] = {}
_cache_lock = threading.Lock()


def _loudness(path: Path, duration: float) -> np.ndarray:
    """Per-HOP_S loudness z-scores for a whole file, cached by file + mtime."""
    from app.services.clip.detector import _loudness_db

    key = (str(path), path.stat().st_mtime)
    with _cache_lock:
        if key in _cache:
            return _cache[key]
    db = _loudness_db(path, duration)
    if db.size:
        median = np.median(db)
        mad = np.median(np.abs(db - median)) * 1.4826 + 1e-6
        z = np.clip((db - median) / mad, -3, 6) if db.max() > -55 else np.zeros_like(db)
    else:
        z = db
    with _cache_lock:
        _cache[key] = z
    return z


def beats(timeline: Timeline) -> list[Beat]:
    """Loudness spikes in the audible video clips, in timeline time. Best effort: a file that
    can't be read just contributes no beats."""
    from app.services.clip.detector import HOP_S

    found: list[tuple[float, float]] = []
    for clip in timeline.clips:
        asset = timeline.asset(clip.asset_id)
        if not asset or asset.kind != "video" or not asset.has_audio or clip.muted or not asset.duration:
            continue
        try:
            z = _loudness(ops.asset_path(asset), asset.duration)
        except Exception:  # missing file, ffmpeg error: skip this clip's audio
            logger.warning("Couldn't analyse audio of %s for auto effects", asset.name, exc_info=True)
            continue
        lo, hi = int(clip.source_in / HOP_S), int((clip.source_in + clip.duration * clip.speed) / HOP_S)
        for i in range(max(lo, 1), min(hi, z.size - 1)):
            if z[i] >= BEAT_Z and z[i] >= z[i - 1] and z[i] > z[i + 1]:  # local peak
                t = clip.start + (i * HOP_S - clip.source_in) / clip.speed
                if clip.start <= t < clip.end - 0.2:
                    found.append((t, float(z[i])))
    if not found:
        return []
    top = max(s for _, s in found)
    return sorted((Beat(round(t, 3), min(1.0, s / top)) for t, s in found), key=lambda b: b.t)


def cuts(timeline: Timeline) -> list[float]:
    """Times where a main-track clip starts right as (or after) another one ends."""
    main = sorted((c for c in timeline.clips if c.track == 0), key=lambda c: c.start)
    return [round(b.start, 3) for a, b in zip(main, main[1:]) if b.start > 0.2 and b.start >= a.end - 0.05]


def emphasis(timeline: Timeline) -> list[float]:
    """Start times of texts that shout: ending in "!" or with an ALL CAPS word of 3+ letters."""
    out = []
    for text in timeline.texts:
        # The raw words, not the rendered ones: an uppercase style doesn't make every caption shout.
        words = [w.strip(".,!?\"'") for w in text.text.split()]
        if text.text.rstrip().endswith("!") or any(len(w) >= 3 and w.isupper() for w in words):
            out.append(round(text.start, 3))
    return sorted(set(out))


# --- planning -----------------------------------------------------------------------------

class _Plan:
    """Collects effects, refusing ones that would fight an effect on the same layer."""

    # Kinds that animate the same layer and so mustn't overlap each other.
    LAYER = {"punch_zoom": "zoom", "shake": "shake", "glitch": "glitch", "flash": "flash", "slow_zoom": "push",
             "vignette": "vignette", "color_pop": "pop", "black_white": "bw"}

    def __init__(self, end: float):
        self.end = end
        self.items: list[dict] = []

    def add(self, kind: str, start: float, duration: float, intensity: float, gap: float = 0.0) -> bool:
        start = max(0.0, start)
        duration = min(duration, self.end - start)
        if duration < 0.1:
            return False
        layer = self.LAYER[kind]
        for e in self.items:
            if self.LAYER[e["kind"]] == layer and start < e["start"] + e["duration"] + gap and e["start"] < start + duration + gap:
                return False
        self.items.append({"kind": kind, "start": round(start, 3), "duration": round(duration, 3),
                           "intensity": round(min(1.0, max(0.05, intensity)), 2)})
        return True


def plan(timeline: Timeline, style: str, amount: float, beat_list: list[Beat]) -> list[Effect]:
    """The auto effects for a timeline. Pure: no media access."""
    if style not in STYLES:
        raise ops.EditError(f"Unknown effect style {style!r}. Use one of {', '.join(STYLES)}.")
    end = timeline.duration
    if end < 0.5 or not timeline.clips:
        raise ops.EditError("Add some clips to the timeline first.")
    amount = min(1.0, max(0.1, amount))
    p = _Plan(end)
    cut_times = cuts(timeline)
    shouts = emphasis(timeline)
    # Strongest beats first, capped by how busy the style should be (beats per 10 seconds).
    per_10s = {"hype": 4.0, "cinematic": 0.0, "clean": 1.5}[style] * amount
    ranked = sorted(beat_list, key=lambda b: -b.strength)[: int(round(per_10s * end / 10)) + 1 if per_10s else 0]
    gap = 1.6 - amount  # minimum breathing room between two hits on the same layer

    # Still images otherwise sit dead on screen: slow push-in across each one, in every style.
    for clip in timeline.clips:
        asset = timeline.asset(clip.asset_id)
        if asset and asset.kind == "image" and clip.track == 0:
            p.add("slow_zoom", clip.start, clip.duration, 0.35 + 0.3 * amount)

    if style == "hype":
        p.add("flash", 0, 0.3, 0.6 + 0.3 * amount)  # open on a hit
        for n, t in enumerate(cut_times):
            if n % 2 == 0:
                p.add("flash", t - 0.02, 0.28, 0.5 + 0.4 * amount)
            else:
                p.add("glitch", t - 0.1, 0.3, 0.4 + 0.5 * amount)
        for t in shouts:
            p.add("punch_zoom", t, 0.55, 0.6 + 0.4 * amount, gap)
        for b in ranked:
            if p.add("punch_zoom", b.t - 0.05, 0.5, 0.35 + 0.6 * amount * b.strength, gap) and b.strength > 0.75:
                p.add("shake", b.t - 0.05, 0.35 + 0.2 * amount, 0.3 + 0.6 * amount * b.strength)
        p.add("color_pop", 0, end, 0.25 + 0.35 * amount)

    elif style == "cinematic":
        for clip in sorted((c for c in timeline.clips if c.track == 0), key=lambda c: c.start):
            if clip.duration >= 2:
                p.add("slow_zoom", clip.start, clip.duration, 0.2 + 0.3 * amount)
        for t in cut_times:
            p.add("flash", t - 0.05, 0.45, 0.15 + 0.2 * amount)
        p.add("vignette", 0, end, 0.4 + 0.4 * amount)
        p.add("color_pop", 0, end, 0.1 + 0.15 * amount)

    else:  # clean
        for t in cut_times:
            p.add("flash", t - 0.02, 0.22, 0.2 + 0.25 * amount)
        for t in shouts:
            p.add("punch_zoom", t, 0.5, 0.25 + 0.3 * amount, gap)
        for b in ranked:
            p.add("punch_zoom", b.t - 0.05, 0.5, 0.2 + 0.3 * amount * b.strength, gap)

    existing = {e.id for e in timeline.effects if not e.auto}  # auto ones are about to be replaced
    effects = []
    for n, item in enumerate(sorted(p.items, key=lambda e: e["start"])[:MAX_AUTO]):
        effect_id = f"fx{style[0]}{n}"
        while effect_id in existing:  # a hand-made effect kept that id
            effect_id += "x"
        effects.append(Effect(id=effect_id, auto=True, **item))
    return effects


def auto_effects(timeline: Timeline, style: str = "hype", amount: float = 0.6, *, analyse=beats) -> tuple[Timeline, str]:
    """Replace the timeline's auto effects with a fresh set. style "none" just removes them."""
    if style == "none":
        removed = sum(1 for e in timeline.effects if e.auto)
        return ops.set_effects(timeline, []), f"Removed {removed} auto effects."
    effects = plan(timeline, style, amount, analyse(timeline))
    counts: dict[str, int] = {}
    for e in effects:
        counts[e.kind] = counts.get(e.kind, 0) + 1
    summary = ", ".join(f"{n} {k.replace('_', ' ')}" for k, n in sorted(counts.items(), key=lambda kv: -kv[1]))
    return ops.set_effects(timeline, effects), f"Added {len(effects)} {style} effects ({summary or 'nothing to add'})."

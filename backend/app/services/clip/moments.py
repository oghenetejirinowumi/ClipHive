"""Moments from what's said, and cuts that land on sentence boundaries.

Loudness finds shouting, but plenty of the best stream moments aren't loud: a deadpan line, a
story with a punchline, a whole room laughing quietly, "wait... what?". `speech_candidates`
scores every window of a transcript by the cues an editor listens for (laughter, disbelief,
swearing, repeated words, a sudden burst of fast talk) and proposes the best non-overlapping
ones, each with a reason the producer can read.

`refine_bounds` keeps cuts out of the middle of speech: a start inside a sentence moves back to
where it begins, an end inside one moves on to where it finishes. So clips stop opening mid-word
("-ause I") or ending before the punchline, while a start in a pause keeps its lead-in.
"""
from __future__ import annotations

import re
from collections.abc import Sequence
from dataclasses import dataclass

import numpy as np

from app.schemas.clip import TranscriptWord
from app.services.clip.detector import Highlight

HOP_S = 1.0
PAUSE_S = 0.45  # a gap this long between words ends a sentence
LEAD_S = 0.25  # start a little before the first word
TAIL_S = 0.45  # and let the last word ring out

# (label, pattern, weight). Patterns match lower-cased text; phrases are matched across words.
CUES: list[tuple[str, re.Pattern[str], float]] = [
    ("laughter", re.compile(r"\b(?:ha(?:ha)+|he(?:he)+|lmf?ao+|lol+|i'?m (?:crying|dead|weak)|bro i can'?t)\b"), 3.0),
    ("disbelief", re.compile(r"\b(?:no way|what the|oh my (?:god|gosh)|omg|are you (?:serious|kidding)|you'?re joking|how did|what just happened|wait what)\b"), 2.5),
    ("hype", re.compile(r"\b(?:let'?s go+|let'?s gooo*|yes+ ?yes+|holy|insane|crazy|clutch|goated|clip (?:that|it))\b"), 2.0),
    ("rage", re.compile(r"\b(?:are you kidding me|i hate|why (?:would|did) (?:you|he|she|they)|this game|i'?m done|unbelievable)\b"), 2.0),
    ("swearing", re.compile(r"\b(?:fuck\w*|shit\w*|damn|bitch\w*|hell no)\b"), 1.2),
    ("reaction", re.compile(r"\b(?:bro+|yo+|nah+|wait+|dude|oh no+|oh my|chat)\b"), 0.8),
]
REPEAT_WEIGHT = 2.0  # "no no no", "go go go"
BURST_WEIGHT = 2.0  # talking much faster than usual
MIN_RAW = 2.0  # below this a window is ordinary talk, not a moment (one "bro" or "chat" isn't enough)


@dataclass
class _Cue:
    t: float
    label: str
    text: str
    weight: float


def _cues(words: Sequence[TranscriptWord]) -> list[_Cue]:
    """Every cue in the transcript, timed at the word it starts on."""
    found: list[_Cue] = []
    lowered = [re.sub(r"[^\w' ]+", "", w.word.lower()).strip() for w in words]
    # Match phrases over a small sliding window of words.
    for i in range(len(words)):
        phrase = " ".join(x for x in lowered[i:i + 4] if x)
        for label, pattern, weight in CUES:
            m = pattern.match(phrase)
            if m:
                found.append(_Cue(words[i].start, label, m.group(0), weight))
                break
        if i >= 2 and lowered[i] and lowered[i] == lowered[i - 1] == lowered[i - 2]:
            found.append(_Cue(words[i - 2].start, "repetition", f"{lowered[i]} {lowered[i]} {lowered[i]}", REPEAT_WEIGHT))
    return found


def speech_candidates(
    words: Sequence[TranscriptWord],
    duration: float,
    clip_seconds: float,
    count: int,
    exclude: Sequence[tuple[float, float]] = (),
    avoid: Sequence[tuple[float, float]] = (),
) -> list[Highlight]:
    """Up to `count` non-overlapping windows that sound like moments, best first.

    `exclude`: never overlap these (clips already made). `avoid`: skip windows whose cues mostly
    fall inside these (candidates loudness already proposed): that's the same moment, found twice."""
    if count <= 0 or not words or duration <= clip_seconds:
        return []
    cues = _cues(words)
    n = int((duration - clip_seconds) / HOP_S) + 1
    if n <= 0:
        return []
    starts = np.arange(n) * HOP_S
    score = np.zeros(n)
    labels: list[dict[str, list[str]]] = [dict() for _ in range(n)]
    cue_times: list[list[float]] = [[] for _ in range(n)]
    # Cues count fully in the middle of the window and half near its edges (setup / tail).
    for c in cues:
        lo = int(max(0, np.ceil((c.t - clip_seconds) / HOP_S)))
        hi = int(min(n - 1, np.floor(c.t / HOP_S)))
        for j in range(lo, hi + 1):
            rel = (c.t - starts[j]) / clip_seconds
            weight = c.weight * (1.0 if 0.15 <= rel <= 0.85 else 0.5)
            score[j] += weight
            labels[j].setdefault(c.label, []).append(c.text)
            cue_times[j].append(c.t)
    # Fast talk relative to this video's own pace.
    times = np.array([w.start for w in words])
    rate = np.array([np.count_nonzero((times >= s) & (times < s + clip_seconds)) for s in starts]) / clip_seconds
    talking = rate[rate > 0]
    if talking.size:
        baseline, spread = float(np.median(talking)), float(np.std(talking)) + 1e-6
        burst = np.clip((rate - baseline) / spread, 0, 3) / 3
        score += BURST_WEIGHT * burst
        for j in np.nonzero(burst > 0.66)[0]:
            labels[j].setdefault("fast talk", []).append("")
    if not np.any(score > 0):
        return []

    def overlaps(a0: float, a1: float, ranges: Sequence[tuple[float, float]], share: float) -> bool:
        return any(min(a1, b1) - max(a0, b0) > share * (a1 - a0) for b0, b1 in ranges)

    picked: list[int] = []
    for j in np.argsort(score)[::-1]:
        if score[j] < MIN_RAW or len(picked) >= count:
            break
        s0, s1 = float(starts[j]), float(starts[j] + clip_seconds)
        if overlaps(s0, s1, exclude, 0.0):
            continue
        inside = sum(1 for t in cue_times[j] if any(a <= t <= b for a, b in avoid))
        if cue_times[j] and inside * 2 >= len(cue_times[j]):
            continue
        if all(abs(starts[j] - starts[k]) >= clip_seconds for k in picked):
            picked.append(int(j))
    out = []
    for j in picked:
        parts = sorted(labels[j].items(), key=lambda kv: -len(kv[1]))[:2]
        reason = ", ".join(f'{label} ("{texts[0]}")' if texts and texts[0] else label for label, texts in parts)
        out.append(Highlight(start_s=round(float(starts[j]), 2), end_s=round(float(starts[j] + clip_seconds), 2),
                             score=speech_score(float(score[j])), reason=f"said: {reason}"))
    return out


def speech_score(raw: float) -> float:
    """0-100 on a fixed scale, comparable to loudness scores: laughter plus a "no way" is ~90,
    one swear is below the bar. Not relative to the video, so a dull video's best talk stays low."""
    return round(min(100.0, 35.0 + 10.0 * raw), 1)


def _sentence_edges(words: Sequence[TranscriptWord], before: TranscriptWord | None = None,
                    after: TranscriptWord | None = None) -> tuple[list[float], list[float]]:
    """Times where sentences start and end: after a pause or a full stop. `before`/`after` are
    the words just outside `words` when it's a slice of a longer transcript, so the slice's own
    first and last words aren't mistaken for the start and end of speech."""
    starts, ends = [], []
    for i, w in enumerate(words):
        prev = words[i - 1] if i else before
        nxt = words[i + 1] if i + 1 < len(words) else after
        if prev is None or w.start - prev.end >= PAUSE_S or prev.word.rstrip().endswith((".", "?", "!")):
            starts.append(w.start)
        if nxt is None or nxt.start - w.end >= PAUSE_S or w.word.rstrip().endswith((".", "?", "!")):
            ends.append(w.end)
    return starts, ends


def refine_bounds(
    start: float,
    end: float,
    words: Sequence[TranscriptWord],
    *,
    min_len: float,
    max_len: float,
    duration: float | None = None,
) -> tuple[float, float]:
    """Keep a cut from landing in the middle of speech.

    A start that falls inside a sentence moves back to where that sentence begins (up to 4s),
    or, failing that, forward to the next one (up to 2.5s). An end inside a sentence moves on
    to where it finishes (up to 4s), or back to the previous finish (up to 3s). A cut that's
    already in a pause or in gameplay stays put: the second before a reaction is usually what
    caused it. Each side keeps its time if the length would leave [min_len, max_len]."""
    inside = [i for i, w in enumerate(words) if start - 6 <= w.start <= end + 6]
    if not inside:
        return start, end
    i0, i1 = inside[0], inside[-1]
    near = list(words[i0:i1 + 1])
    s_edges, e_edges = _sentence_edges(near, words[i0 - 1] if i0 else None, words[i1 + 1] if i1 + 1 < len(words) else None)

    def speaking(t: float) -> bool:
        return any(w.start - PAUSE_S / 2 < t < w.end + PAUSE_S / 2 for w in near)

    # Gaps between consecutive words: (end of the word before, start of the word after, size).
    # In non-stop talk there may be no full pause, but the biggest breath nearby is still the
    # place a sentence most likely turns (word timestamps often carry no punctuation).
    gaps = [(a.end, b.start, b.start - a.end) for a, b in zip(near, near[1:]) if b.start - a.end >= 0.15]

    new_start, new_end = start, end
    if speaking(start):
        before = [s for s in s_edges if start - 4.0 <= s <= start]
        after = [s for s in s_edges if start < s <= start + 2.5]
        breaths = [g for g in gaps if start - 4.0 <= g[1] <= start + 2.5]
        if before:
            new_start = max(0.0, max(before) - LEAD_S)
        elif after:
            new_start = max(0.0, min(after) - LEAD_S)
        elif breaths:
            _, nxt, size = max(breaths, key=lambda g: g[2])
            new_start = max(0.0, nxt - min(LEAD_S, size / 2))
    if speaking(end):
        later = [e for e in e_edges if end <= e <= end + 4.0]
        earlier = [e for e in e_edges if end - 3.0 <= e < end]
        breaths = [g for g in gaps if end - 3.0 <= g[0] <= end + 4.0]
        if later:
            new_end = min(later) + TAIL_S
        elif earlier:
            new_end = max(earlier) + TAIL_S
        elif breaths:
            prev, _, size = max(breaths, key=lambda g: g[2])
            new_end = prev + min(TAIL_S, size / 2)
    if duration is not None:
        new_end = min(new_end, duration)

    if not min_len <= new_end - new_start <= max_len:  # keep whichever side still fits
        if min_len <= end - new_start <= max_len:
            return round(new_start, 2), end
        if min_len <= new_end - start <= max_len:
            return start, round(new_end, 2)
        return start, end
    return round(new_start, 2), round(new_end, 2)


def clip_words(words: Sequence[TranscriptWord], start: float, end: float) -> list[dict]:
    """The words inside [start, end], in clip time (0 = the clip's first frame)."""
    return [
        {"word": w.word, "start": round(max(0.0, w.start - start), 3), "end": round(min(end, w.end) - start, 3), "confidence": w.confidence}
        for w in words if w.start >= start - 0.05 and w.end <= end + 0.3 and w.start < end
    ]

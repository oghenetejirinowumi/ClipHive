"""Auto sound effects: a built-in SFX library and an AI that places it on the edit.

The library is synthesised here with numpy (no licensing, no downloads) and written once to
storage/sfx/. Placing effects is two steps:

1. `find_cues` lists the moments an editor would put a sound on: cuts between clips, overlays
   appearing, titles popping in, loud spikes in the clips' own audio, and caption words.
2. `plan` asks the configured model (OpenAI, else Groq) to choose which cues get which effect,
   given the intensity the user picked. Without a model key a rule-based plan is used, so the
   button always works.

`apply` writes the result as audio tracks marked is_sfx, replacing earlier auto effects, so
running it again re-does the sound design instead of stacking it.
"""
from __future__ import annotations

import json
import logging
import re
import threading
import wave
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Literal

import numpy as np

from app.core.media import storage_root
from app.schemas.editor import Asset, AudioTrack, Timeline

logger = logging.getLogger("cliphive.editor.sfx")

RATE = 44100
Intensity = Literal["subtle", "normal", "hype"]
MIN_GAP_S = 0.35  # two effects closer than this blur together
MAX_PER_INTENSITY = {"subtle": 6, "normal": 14, "hype": 30}
PER_MINUTE = {"subtle": 6, "normal": 14, "hype": 28}  # scale the cap down on short edits
VOLUME = {"subtle": 0.35, "normal": 0.55, "hype": 0.75}


@dataclass(frozen=True)
class Effect:
    name: str
    label: str
    description: str  # what it's for; the model reads this
    lead: float  # seconds before the cue the sound starts, so its hit lands on the cue


def _rng(seed: int) -> np.random.Generator:
    return np.random.default_rng(seed)


def _t(seconds: float) -> np.ndarray:
    return np.arange(int(RATE * seconds)) / RATE


def _band(noise: np.ndarray, lo: float, hi: float) -> np.ndarray:
    """Band-limit noise in the frequency domain (fast and dependency-free)."""
    spec = np.fft.rfft(noise)
    freqs = np.fft.rfftfreq(noise.size, 1 / RATE)
    spec[(freqs < lo) | (freqs > hi)] = 0
    return np.fft.irfft(spec, noise.size)


def _norm(x: np.ndarray, peak: float = 0.9) -> np.ndarray:
    m = float(np.max(np.abs(x))) or 1.0
    return x * (peak / m)


def _fade(x: np.ndarray, out_s: float = 0.02) -> np.ndarray:
    n = min(x.size, int(RATE * out_s))
    x = x.copy()
    x[-n:] *= np.linspace(1, 0, n)
    x[: min(64, x.size)] *= np.linspace(0, 1, min(64, x.size))
    return x


def _sweep(f0: float, f1: float, seconds: float, curve: str = "exp") -> np.ndarray:
    t = _t(seconds)
    f = f0 * (f1 / f0) ** (t / seconds) if curve == "exp" else np.linspace(f0, f1, t.size)
    return np.sin(2 * np.pi * np.cumsum(f) / RATE)


def _whoosh(seconds: float, seed: int) -> np.ndarray:
    t = _t(seconds)
    noise = _rng(seed).standard_normal(t.size)
    low, high = _band(noise, 150, 1200), _band(noise, 1200, 7000)
    peak = 0.6  # the loudest point, as a fraction of the sound (the cut lands here)
    env = np.where(t < seconds * peak, (t / (seconds * peak)) ** 2, np.exp(-(t - seconds * peak) / (seconds * 0.12)))
    tilt = np.clip(t / (seconds * peak), 0, 1)  # brighter as it rushes past
    return env * (low * (1 - 0.6 * tilt) + high * (0.3 + 0.7 * tilt))


def _pop() -> np.ndarray:
    t = _t(0.14)
    f = 1000 * np.exp(-t * 28) + 180
    return np.sin(2 * np.pi * np.cumsum(f) / RATE) * np.exp(-t * 30)


def _boom() -> np.ndarray:
    t = _t(1.6)
    body = np.sin(2 * np.pi * np.cumsum(55 * np.exp(-t * 0.9) + 30) / RATE) * np.exp(-t * 2.2)
    click = _band(_rng(3).standard_normal(t.size), 80, 3000) * np.exp(-t * 60) * 0.5
    return np.tanh(2.2 * (body + click))  # saturate it so it reads on phone speakers


def _impact() -> np.ndarray:
    t = _t(0.7)
    thump = np.sin(2 * np.pi * np.cumsum(90 * np.exp(-t * 6) + 40) / RATE) * np.exp(-t * 7)
    crack = _band(_rng(4).standard_normal(t.size), 400, 9000) * np.exp(-t * 25)
    return np.tanh(1.8 * (thump + 0.6 * crack))


def _ding() -> np.ndarray:
    t = _t(1.4)
    base = 1318.5  # E6
    tone = sum(a * np.sin(2 * np.pi * base * r * t) * np.exp(-t * d) for r, a, d in ((1, 1, 2.5), (2.76, 0.45, 4.5), (5.4, 0.25, 7)))
    return tone * (1 - np.exp(-t * 400))


def _riser() -> np.ndarray:
    t = _t(2.0)
    noise = _band(_rng(5).standard_normal(t.size), 800, 9000)
    tone = _sweep(180, 1800, 2.0)
    env = (t / 2.0) ** 2.2
    return env * (0.6 * noise + 0.5 * tone)


def _click() -> np.ndarray:
    t = _t(0.05)
    return _band(_rng(6).standard_normal(t.size), 1500, 9000) * np.exp(-t * 160)


def _glitch() -> np.ndarray:
    rng = _rng(7)
    parts = []
    for _ in range(9):
        n = int(RATE * rng.uniform(0.02, 0.06))
        f = rng.uniform(200, 2400)
        sq = np.sign(np.sin(2 * np.pi * f * np.arange(n) / RATE))
        parts.append(sq * rng.uniform(0.3, 1.0) if rng.random() > 0.2 else np.zeros(n))
    x = np.concatenate(parts)
    return np.round(x * 4) / 4  # bit-crush


def _bass_drop() -> np.ndarray:
    t = _t(1.8)
    return np.tanh(2 * _sweep(140, 32, 1.8) * np.exp(-t * 1.2) * (1 - np.exp(-t * 80)))


def _sparkle() -> np.ndarray:
    out = np.zeros(int(RATE * 0.9))
    for i, f in enumerate((1568, 1976, 2349, 2794, 3136, 3951)):
        t = _t(0.35)
        blip = np.sin(2 * np.pi * f * t) * np.exp(-t * 14)
        at = int(RATE * i * 0.07)
        out[at:at + t.size] += blip[: out.size - at]
    return out


def _scratch() -> np.ndarray:
    t = _t(0.55)
    rate = 1 + 0.9 * np.sin(2 * np.pi * 7 * t)  # the record wobbling back and forth
    noise = _band(_rng(8).standard_normal(t.size), 300, 5000)
    tone = np.sin(2 * np.pi * np.cumsum(600 * rate) / RATE)
    return (0.5 * noise + 0.5 * tone) * np.abs(rate) * np.exp(-t * 2.5)


def _swoosh() -> np.ndarray:
    return _whoosh(0.35, seed=2)


# name → (effect, synth)
LIBRARY: dict[str, tuple[Effect, Any]] = {
    e.name: (e, synth) for e, synth in (
        (Effect("whoosh", "Whoosh", "Air rushing past. Transitions between clips, things flying in.", 0.36), lambda: _whoosh(0.6, seed=1)),
        (Effect("swoosh", "Swoosh", "Short fast swish. Quick cuts, text sliding in, swipes.", 0.21), _swoosh),
        (Effect("pop", "Pop", "Bubbly pop. Text, stickers or emoji popping onto the screen.", 0.0), _pop),
        (Effect("boom", "Boom", "Deep meme boom. Punchlines, reveals, 'no way' moments, dramatic pauses.", 0.0), _boom),
        (Effect("impact", "Impact", "Hard hit. Big titles slamming in, loud reactions, emphasis.", 0.0), _impact),
        (Effect("ding", "Ding", "Bright bell. Correct answers, money, ideas, achievements, a good point.", 0.0), _ding),
        (Effect("riser", "Riser", "Two-second build-up that ends on the cue. Before a big moment or reveal.", 2.0), _riser),
        (Effect("click", "Click", "Tiny tick. Typewriter text, UI taps, counting.", 0.0), _click),
        (Effect("glitch", "Glitch", "Digital stutter. Glitchy transitions, errors, tech moments, chaos.", 0.0), _glitch),
        (Effect("bass_drop", "Bass drop", "Falling sub bass. The hype moment after a build, a big reveal.", 0.0), _bass_drop),
        (Effect("sparkle", "Sparkle", "Rising chimes. Something cute, magic, new, or looking clean.", 0.0), _sparkle),
        (Effect("record_scratch", "Record scratch", "Comedy stop. 'Wait, what?', sudden fails, awkward moments.", 0.0), _scratch),
    )
}

_build_lock = threading.Lock()


def sfx_dir() -> Path:
    return storage_root() / "sfx"


def public_src(name: str) -> str:
    return f"storage/sfx/{name}.wav"


def _write_wav(path: Path, samples: np.ndarray) -> None:
    pcm = (np.clip(_fade(_norm(samples)), -1, 1) * 32767).astype("<i2")
    tmp = path.with_suffix(".tmp")
    with wave.open(str(tmp), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(RATE)
        w.writeframes(pcm.tobytes())
    tmp.replace(path)


def ensure_library() -> dict[str, float]:
    """Write any missing effect to storage/sfx/. Returns name → duration in seconds."""
    durations: dict[str, float] = {}
    with _build_lock:
        sfx_dir().mkdir(parents=True, exist_ok=True)
        for name, (_, synth) in LIBRARY.items():
            path = sfx_dir() / f"{name}.wav"
            if not path.exists():
                _write_wav(path, synth())
            with wave.open(str(path), "rb") as w:
                durations[name] = round(w.getnframes() / w.getframerate(), 3)
    return durations


def library() -> list[dict]:
    durations = ensure_library()
    return [{"name": e.name, "label": e.label, "description": e.description, "lead": e.lead,
             "duration": durations[e.name], "src": public_src(e.name)} for e, _ in LIBRARY.values()]


def is_library_src(src: str) -> bool:
    return any(src == public_src(name) for name in LIBRARY)


def asset_for(name: str, duration: float) -> Asset:
    effect = LIBRARY[name][0]
    return Asset(id=f"sfx_{name}", kind="audio", name=f"SFX · {effect.label}", src=public_src(name), duration=duration)


# --- 1. cues --------------------------------------------------------------------------------

@dataclass
class Cue:
    id: str
    at: float
    kind: Literal["start", "cut", "overlay", "title", "text", "peak", "word", "end"]
    detail: str
    strength: float = 1.0  # 0-1, how strongly an editor would mark it


def _peaks(timeline: Timeline, loudness) -> list[tuple[float, float]]:
    """Loud spikes in the clips' own audio, in timeline time: (time, strength 0-1)."""
    found: list[tuple[float, float]] = []
    for clip in timeline.clips:
        asset = timeline.asset(clip.asset_id)
        if not asset or asset.kind != "video" or not asset.has_audio or clip.muted or clip.volume == 0:
            continue
        try:
            db, hop = loudness(asset, clip.source_in + clip.duration * clip.speed)
        except Exception as err:  # noqa: BLE001 - best effort: no peaks for this clip
            logger.info("No loudness for %s: %s", asset.name, err)
            continue
        lo, hi = int(clip.source_in / hop), int((clip.source_in + clip.duration * clip.speed) / hop)
        seg = db[lo:hi]
        if seg.size < 4:
            continue
        median = float(np.median(seg))
        mad = float(np.median(np.abs(seg - median))) * 1.4826 + 1e-6
        z = (seg - median) / mad
        # Onsets: where loudness jumps well above this clip's baseline, at most one per second.
        last = -1e9
        for i in np.argsort(z)[::-1][:40]:
            if z[i] < 2.5:
                break
            t = clip.start + (i * hop) / clip.speed
            if all(abs(t - p) >= 1.0 for p, _ in found) and abs(t - last) >= 1.0:
                found.append((round(t, 2), float(min(1.0, z[i] / 6))))
                last = t
    return sorted(found)


def file_loudness(asset: Asset, seconds: float) -> tuple[np.ndarray, float]:
    """Loudness per HOP_S of an asset's file, cached per file (the default `loudness` source)."""
    from app.services.clip.detector import HOP_S, _loudness_db
    from app.services.editor.assistant import _cached
    from app.services.editor.ops import asset_path

    path = asset_path(asset)
    return _cached("loudness", path, lambda: _loudness_db(path, asset.duration or seconds)), HOP_S


def find_cues(timeline: Timeline, loudness=None) -> list[Cue]:
    cues: list[Cue] = []
    end = timeline.duration

    def add(at: float, kind: str, detail: str, strength: float = 1.0) -> None:
        if 0 <= at <= end:
            cues.append(Cue(id=f"c{len(cues) + 1}", at=round(at, 2), kind=kind, detail=detail[:120], strength=round(strength, 2)))  # type: ignore[arg-type]

    main = sorted((c for c in timeline.clips if c.track == 0), key=lambda c: c.start)
    if main:
        add(main[0].start, "start", "the edit begins", 0.6)
    for prev, clip in zip(main, main[1:]):
        if clip.start - prev.end < 0.5:  # back to back (or nearly): a cut
            add(clip.start, "cut", f"cut from {_name(timeline, prev.asset_id)} to {_name(timeline, clip.asset_id)}")
    for clip in timeline.clips:
        if clip.track > 0:
            add(clip.start, "overlay", f"{_name(timeline, clip.asset_id)} appears on top", 0.8)
    for text in timeline.texts:
        if text.is_caption:
            continue
        big = text.size >= 100 or (text.uppercase and len(text.text) <= 24)
        add(text.start, "title" if big else "text", f'"{text.text[:60]}" ({text.animation} animation)', 1.0 if big else 0.7)
    if loudness is not None:
        for at, strength in _peaks(timeline, loudness):
            add(at, "peak", "loud spike in the clip's audio (shout, laugh, bang)", strength)
    for text in timeline.texts:
        if text.is_caption:
            add(text.start, "word", f'caption "{text.text[:60]}"', 0.3)
    if main:
        add(max(c.end for c in main), "end", "the edit ends", 0.4)
    return sorted(cues, key=lambda c: c.at)


def _name(timeline: Timeline, asset_id: str) -> str:
    asset = timeline.asset(asset_id)
    return asset.name if asset else "media"


# --- 2. plan --------------------------------------------------------------------------------

@dataclass
class Placement:
    effect: str
    at: float  # when the sound's hit lands (the cue); the track starts `lead` earlier
    volume: float
    reason: str = ""


WORD_EFFECTS = [  # rule-based plan: caption words that call for a sound
    (re.compile(r"\b(boom|bang|explod\w*|crash\w*|bomb)\b", re.I), "boom"),
    (re.compile(r"\b(money|cash|dollars?|paid|rich|\$\d+)", re.I), "ding"),
    (re.compile(r"\b(wait|what|huh|bruh|nah|wtf)\b", re.I), "record_scratch"),
    (re.compile(r"\b(no way|insane|crazy|oh my god|omg)\b", re.I), "impact"),
    (re.compile(r"\b(magic|beautiful|perfect|clean|new)\b", re.I), "sparkle"),
]

_TEXT_EFFECT = {"pop": "pop", "slide_up": "swoosh", "typewriter": "click", "fade": "sparkle", "none": "pop"}


def rule_plan(cues: list[Cue], intensity: Intensity) -> list[Placement]:
    vol = VOLUME[intensity]
    out: list[Placement] = []
    cuts = 0
    for cue in cues:
        if cue.kind == "cut":
            cuts += 1
            out.append(Placement("whoosh" if cuts % 2 else "swoosh", cue.at, vol * 0.9, "transition"))
        elif cue.kind == "title":
            out.append(Placement("impact", cue.at, vol, "title slams in"))
        elif cue.kind == "text":
            anim = re.search(r"\((\w+) animation\)", cue.detail)
            out.append(Placement(_TEXT_EFFECT.get(anim.group(1) if anim else "pop", "pop"), cue.at, vol * 0.8, "text appears"))
        elif cue.kind == "overlay" and intensity != "subtle":
            out.append(Placement("swoosh", cue.at, vol * 0.8, "overlay flies in"))
        elif cue.kind == "peak" and intensity != "subtle" and cue.strength >= (0.5 if intensity == "normal" else 0.35):
            out.append(Placement("boom" if intensity == "hype" else "impact", cue.at, vol * 0.8, "loud reaction"))
        elif cue.kind == "word" and intensity == "hype":
            effect = next((e for pattern, e in WORD_EFFECTS if pattern.search(cue.detail)), None)
            if effect:
                out.append(Placement(effect, cue.at, vol * 0.8, "word cue"))
        elif cue.kind == "start" and intensity == "hype":
            out.append(Placement("whoosh", cue.at + 0.36, vol * 0.7, "intro"))
    if intensity == "hype":  # build into the biggest moment
        peaks = [c for c in cues if c.kind == "peak" and c.at >= 2.5]
        if peaks:
            top = max(peaks, key=lambda c: c.strength)
            out.append(Placement("riser", top.at, vol * 0.6, "build-up to the biggest moment"))
    return out


PLAN_PROMPT = """You are a sound designer for short-form vertical videos (TikTok, Reels, Shorts). You add sound effects that make an edit feel punchy and professional, never cluttered.

You get the edit's cues (moments where a sound could go) and a library of effects. Pick which cues get an effect and which one.

Style for intensity "{intensity}":
- subtle: only transitions and titles; quiet; under {cap} effects.
- normal: transitions, text and overlays appearing, the strongest reactions; under {cap} effects.
- hype: meme-style energy, also punchlines and word cues from captions, a riser into the biggest moment; under {cap} effects.

Rules:
- Match the effect to what happens on screen. Vary effects so the same one doesn't repeat back to back.
- Don't put two effects within {gap}s of each other. Leave most caption words silent.
- volume is 0.1-1.0 (0.4 is a normal level; quieter for frequent small sounds, louder for big hits).
- Answer with JSON only: {{"placements": [{{"cue": "<cue id>", "effect": "<effect name>", "volume": 0.5, "reason": "<few words>"}}]}}"""


def _llm():
    from app.services.ai.ai_pack import get_ai_client

    try:
        return get_ai_client()
    except RuntimeError:
        return None, None


def ai_plan(cues: list[Cue], intensity: Intensity, duration: float, client=None, model: str | None = None) -> list[Placement]:
    """Ask the model for a plan. Raises on any failure; the caller falls back to rule_plan."""
    if client is None:
        client, model = _llm()
        if client is None:
            raise RuntimeError("no model configured")
    cap = cap_for(intensity, duration)
    library_text = "\n".join(f"- {e.name}: {e.description}" for e, _ in LIBRARY.values())
    cue_text = json.dumps([{"cue": c.id, "t": c.at, "kind": c.kind, "what": c.detail, "strength": c.strength} for c in cues[:400]], separators=(",", ":"))
    response = client.chat.completions.create(
        model=model,
        temperature=0.4,
        response_format={"type": "json_object"},
        messages=[
            {"role": "system", "content": PLAN_PROMPT.format(intensity=intensity, cap=cap, gap=MIN_GAP_S)},
            {"role": "user", "content": f"Intensity: {intensity}\nEdit length: {duration:.1f}s\n\nEffects:\n{library_text}\n\nCues:\n{cue_text}"},
        ],
    )
    text = response.choices[0].message.content or "{}"
    match = re.search(r"\{[\s\S]*\}", text)
    data = json.loads(match.group(0) if match else text)
    by_id = {c.id: c for c in cues}
    out: list[Placement] = []
    for p in data.get("placements", []):
        cue, effect = by_id.get(str(p.get("cue"))), str(p.get("effect", ""))
        if cue is None or effect not in LIBRARY:
            continue
        try:
            volume = float(p.get("volume", VOLUME[intensity]))
        except (TypeError, ValueError):
            volume = VOLUME[intensity]
        out.append(Placement(effect, cue.at, min(1.0, max(0.1, volume)), str(p.get("reason", ""))[:80]))
    return out


def cap_for(intensity: Intensity, duration: float) -> int:
    return max(2, min(MAX_PER_INTENSITY[intensity], round(PER_MINUTE[intensity] * max(duration, 15) / 60)))


def tidy(placements: list[Placement], intensity: Intensity, duration: float) -> list[Placement]:
    """Enforce spacing and the cap whatever the planner returned: keep louder hits first."""
    kept: list[Placement] = []
    for p in sorted(placements, key=lambda p: -p.volume):
        if len(kept) >= cap_for(intensity, duration):
            break
        if 0 <= p.at <= duration + 0.01 and all(abs(p.at - k.at) >= MIN_GAP_S for k in kept):
            kept.append(p)
    return sorted(kept, key=lambda p: p.at)


# --- 3. apply -------------------------------------------------------------------------------

def apply(timeline: Timeline, placements: list[Placement], *, replace: bool = True) -> Timeline:
    durations = ensure_library()
    data = timeline.model_dump()
    if replace:
        data["audio"] = [a for a in data["audio"] if not a.get("is_sfx")]
    have = {a["id"] for a in data["assets"]}
    taken = {x["id"] for kind in ("assets", "clips", "texts", "audio", "effects") for x in data.get(kind, [])}
    n = 0
    for p in placements:
        effect = LIBRARY[p.effect][0]
        asset = asset_for(p.effect, durations[p.effect])
        if asset.id not in have:
            data["assets"].append(asset.model_dump())
            have.add(asset.id)
            taken.add(asset.id)
        start = max(0.0, p.at - effect.lead)
        source_in = max(0.0, effect.lead - p.at) if p.at < effect.lead else 0.0  # near 0: skip the lead-in
        length = round(durations[p.effect] - source_in, 3)
        if length < 0.05:
            continue
        while f"sfx{n}" in taken:
            n += 1
        taken.add(f"sfx{n}")
        data["audio"].append(AudioTrack(id=f"sfx{n}", asset_id=asset.id, start=round(start, 3), duration=length,
                                        source_in=round(source_in, 3), volume=round(p.volume, 2), is_sfx=True).model_dump())
    # Drop library assets nothing uses any more (e.g. after replacing the effects).
    used = {a["asset_id"] for a in data["audio"]} | {c["asset_id"] for c in data["clips"]}
    data["assets"] = [a for a in data["assets"] if not (is_library_src(a["src"]) and a["id"] not in used)]
    return Timeline.model_validate(data)


@dataclass
class AutoResult:
    timeline: Timeline
    placements: list[Placement]
    used_ai: bool
    summary: str


def auto(timeline: Timeline, intensity: Intensity = "normal", *, replace: bool = True, loudness=None, client=None, model=None) -> AutoResult:
    """The whole thing: find cues, plan (AI, else rules), and write the effects."""
    duration = timeline.duration
    if duration <= 0:
        raise ValueError("Add something to the timeline first.")
    cues = find_cues(timeline, loudness)
    used_ai = True
    try:
        placements = ai_plan(cues, intensity, duration, client=client, model=model)
        if not placements and cues:
            raise RuntimeError("the model placed nothing")
    except Exception as err:  # noqa: BLE001 - no key, network, bad JSON: the rules still work
        logger.info("SFX plan falling back to rules: %s", err)
        placements, used_ai = rule_plan(cues, intensity), False
    placements = tidy(placements, intensity, duration)
    new = apply(timeline, placements, replace=replace)
    counts: dict[str, int] = {}
    for p in placements:
        counts[LIBRARY[p.effect][0].label.lower()] = counts.get(LIBRARY[p.effect][0].label.lower(), 0) + 1
    detail = ", ".join(f"{n} {name}" for name, n in sorted(counts.items(), key=lambda kv: -kv[1]))
    summary = f"Added {len(placements)} sound effect{'s' if len(placements) != 1 else ''} ({intensity})" + (f": {detail}" if detail else "")
    return AutoResult(new, placements, used_ai, summary)


def add_one(timeline: Timeline, name: str, at: float, volume: float = 0.6) -> tuple[Timeline, str]:
    """Place one library effect so its hit lands at `at` (the assistant's add_sfx tool)."""
    if name not in LIBRARY:
        raise ValueError(f"Unknown sound effect {name!r}. Choose one of: {', '.join(LIBRARY)}.")
    new = apply(timeline, [Placement(name, max(0.0, at), min(1.0, max(0.05, volume)))], replace=False)
    return new, f"Added a {LIBRARY[name][0].label.lower()} at {at:.1f}s"

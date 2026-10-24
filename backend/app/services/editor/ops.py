"""Edit operations on a timeline. These are the AI assistant's tools.

Every operation takes a Timeline, returns a new validated Timeline plus a one-line description
of what changed, and raises EditError (a message safe to show the user or feed back to the
model) when it can't be done. The browser implements the same edits for hand editing in
frontend/lib/editor.ts; the server always re-validates whatever it saves.

Source math (HyperFrames): a clip consumes duration x speed seconds of its file, starting at
source_in. Splitting at timeline time t keeps both halves on the same source clock.
"""
from __future__ import annotations

import secrets
from pathlib import Path
from typing import Any

from pydantic import ValidationError

from app.core.media import storage_root
from app.schemas.editor import ASPECTS, Asset, AudioTrack, Clip, Effect, Timeline

MIN_LEN = 0.1

# Text looks shared by the AI, the "add captions" action and the editor's style picker.
TEXT_PRESETS: dict[str, dict[str, Any]] = {
    "punch": {"font": "Bangers", "color": "#FFE600", "stroke_color": "#000000", "stroke_width": 6, "uppercase": True, "animation": "pop", "background": None},
    "clean": {"font": "Poppins", "color": "#FFFFFF", "stroke_color": None, "stroke_width": 0, "uppercase": False, "animation": "fade", "background": "#111111"},
    "neon": {"font": "Luckiest Guy", "color": "#00E5FF", "stroke_color": "#FF00C8", "stroke_width": 5, "uppercase": True, "animation": "pop", "background": None},
    "title": {"font": "Bangers", "color": "#FFFFFF", "stroke_color": "#000000", "stroke_width": 8, "uppercase": True, "animation": "slide_up", "background": None, "size": 120},
    "subtle": {"font": "System", "color": "#FFFFFF", "stroke_color": "#000000", "stroke_width": 3, "uppercase": False, "animation": "fade", "background": None, "size": 56},
}


class EditError(ValueError):
    """The edit can't be applied; the message says why."""


def new_id(timeline: Timeline, prefix: str) -> str:
    taken = {x.id for x in (*timeline.assets, *timeline.clips, *timeline.texts, *timeline.audio, *timeline.effects)}
    while True:
        candidate = f"{prefix}{secrets.token_hex(3)}"
        if candidate not in taken:
            return candidate


def asset_path(asset: Asset) -> Path:
    """Local file for an asset ("storage/..." public path → file under the storage root)."""
    path = (storage_root() / asset.src.removeprefix("storage/")).resolve()
    if storage_root() not in path.parents:
        raise EditError("That media file is outside storage.")
    return path


def _validated(data: dict) -> Timeline:
    try:
        return Timeline.model_validate(data)
    except ValidationError as err:
        first = err.errors()[0]
        where = ".".join(str(p) for p in first.get("loc", ()))
        raise EditError(f"{first['msg']}" + (f" ({where})" if where else "")) from None


def _find(timeline: Timeline, item_id: str) -> tuple[str, int]:
    for kind in ("clips", "texts", "audio", "effects"):
        for index, item in enumerate(getattr(timeline, kind)):
            if item.id == item_id:
                return kind, index
    raise EditError(f"There's no clip, text, audio or effect with id {item_id!r}.")


def _remaining(asset: Asset, source_in: float, speed: float = 1.0) -> float | None:
    """Longest timeline duration a clip can have from source_in (None = unlimited, e.g. images)."""
    if asset.kind == "image" or asset.duration is None:
        return None
    return max(0.0, (asset.duration - source_in) / speed)


def _track_end(timeline: Timeline, track: int) -> float:
    return max((c.end for c in timeline.clips if c.track == track), default=0.0)


def _fmt(t: float) -> str:
    return f"{t:.2f}s"


# --- clips --------------------------------------------------------------------------------

def add_clip(timeline: Timeline, asset_id: str, start: float | None = None, track: int = 0,
             source_in: float = 0.0, duration: float | None = None) -> tuple[Timeline, str]:
    asset = timeline.asset(asset_id)
    if not asset or asset.kind not in ("video", "image"):
        raise EditError(f"No video or image asset {asset_id!r}.")
    start = _track_end(timeline, track) if start is None else start
    limit = _remaining(asset, source_in)
    if limit is not None and limit < MIN_LEN:
        raise EditError(f"source_in is past the end of {asset.name}.")
    duration = duration or (limit if limit is not None else 3.0)
    if limit is not None:
        duration = min(duration, limit)
    clip = Clip(id=new_id(timeline, "c"), asset_id=asset_id, track=track, start=start, duration=duration, source_in=source_in)
    data = timeline.model_dump()
    data["clips"].append(clip.model_dump())
    return _validated(data), f"Added {asset.name} on track {track + 1} at {_fmt(start)} ({_fmt(duration)})."


def update_clip(timeline: Timeline, clip_id: str, **changes: Any) -> tuple[Timeline, str]:
    kind, index = _find(timeline, clip_id)
    if kind != "clips":
        raise EditError(f"{clip_id} isn't a video/image clip.")
    data = timeline.model_dump()
    clip = data["clips"][index]
    clip.update({k: v for k, v in changes.items() if v is not None})
    asset = timeline.asset(clip["asset_id"])
    # Speeding up or moving source_in can run past the file's end: shorten instead of failing.
    limit = _remaining(asset, clip["source_in"], clip["speed"]) if asset else None
    if limit is not None and clip["duration"] > limit:
        clip["duration"] = round(limit, 3)
    described = ", ".join(f"{k}={v}" for k, v in changes.items() if v is not None)
    return _validated(data), f"Updated clip {clip_id}: {described}."


def split(timeline: Timeline, item_id: str, at: float) -> tuple[Timeline, str]:
    kind, index = _find(timeline, item_id)
    data = timeline.model_dump()
    item = data[kind][index]
    start, end = item["start"], item["start"] + item["duration"]
    if not (start + MIN_LEN <= at <= end - MIN_LEN):
        raise EditError(f"{_fmt(at)} isn't inside {item_id} ({_fmt(start)}–{_fmt(end)}).")
    left, right = dict(item), dict(item)
    left["duration"] = round(at - start, 3)
    right.update(id=new_id(timeline, item_id[0]), start=round(at, 3), duration=round(end - at, 3))
    if kind in ("clips", "audio"):
        rate = item.get("speed", 1.0)
        right["source_in"] = round(item["source_in"] + (at - start) * rate, 3)
        left["fade_out"], right["fade_in"] = 0, 0
    data[kind][index:index + 1] = [left, right]
    return _validated(data), f"Split {item_id} at {_fmt(at)} (new piece {right['id']})."


def delete(timeline: Timeline, ids: list[str]) -> tuple[Timeline, str]:
    for item_id in ids:
        _find(timeline, item_id)
    data = timeline.model_dump()
    for kind in ("clips", "texts", "audio", "effects"):
        data[kind] = [x for x in data[kind] if x["id"] not in ids]
    return _validated(data), f"Deleted {', '.join(ids)}."


def duplicate(timeline: Timeline, item_id: str, start: float | None = None) -> tuple[Timeline, str]:
    kind, index = _find(timeline, item_id)
    data = timeline.model_dump()
    item = dict(data[kind][index])
    item["id"] = new_id(timeline, item_id[0])
    item["start"] = item["start"] + item["duration"] if start is None else start
    data[kind].insert(index + 1, item)
    return _validated(data), f"Duplicated {item_id} as {item['id']} at {_fmt(item['start'])}."


def close_gaps(timeline: Timeline, track: int = 0) -> tuple[Timeline, str]:
    """Slide a track's clips left so they play back to back from 0."""
    data = timeline.model_dump()
    on_track = sorted((c for c in data["clips"] if c["track"] == track), key=lambda c: c["start"])
    cursor = 0.0
    for clip in on_track:
        clip["start"] = round(cursor, 3)
        cursor += clip["duration"]
    return _validated(data), f"Closed the gaps on track {track + 1}."


# --- text ---------------------------------------------------------------------------------

def _styled(fields: dict[str, Any]) -> dict[str, Any]:
    preset = fields.pop("preset", None)
    if preset and preset not in TEXT_PRESETS:
        raise EditError(f"Unknown text preset {preset!r}. Use one of {', '.join(TEXT_PRESETS)}.")
    base = dict(TEXT_PRESETS.get(preset, {})) if preset else {}
    base.update({k: v for k, v in fields.items() if v is not None})
    return base


def add_text(timeline: Timeline, text: str, start: float, duration: float = 3.0, **style: Any) -> tuple[Timeline, str]:
    item = {"id": new_id(timeline, "t"), "text": text, "start": start, "duration": duration, **_styled(style)}
    data = timeline.model_dump()
    data["texts"].append(item)
    return _validated(data), f"Added text “{text[:40]}” at {_fmt(start)} for {_fmt(duration)}."


def update_text(timeline: Timeline, text_id: str, **changes: Any) -> tuple[Timeline, str]:
    kind, index = _find(timeline, text_id)
    if kind != "texts":
        raise EditError(f"{text_id} isn't a text.")
    data = timeline.model_dump()
    data["texts"][index].update(_styled(dict(changes)))
    described = ", ".join(f"{k}={v}" for k, v in changes.items() if v is not None)
    return _validated(data), f"Updated text {text_id}: {described}."


def restyle_captions(timeline: Timeline, **style: Any) -> tuple[Timeline, str]:
    data = timeline.model_dump()
    styled = _styled(dict(style))
    count = 0
    for text in data["texts"]:
        if text.get("is_caption"):
            text.update(styled)
            count += 1
    if not count:
        raise EditError("There are no captions yet. Add them first.")
    return _validated(data), f"Restyled {count} captions."


# --- audio --------------------------------------------------------------------------------

def add_audio(timeline: Timeline, asset_id: str, start: float = 0.0, duration: float | None = None,
              source_in: float = 0.0, volume: float = 0.6, fade_in: float = 0.0, fade_out: float = 0.0) -> tuple[Timeline, str]:
    asset = timeline.asset(asset_id)
    if not asset or asset.kind not in ("audio", "video"):
        raise EditError(f"No audio asset {asset_id!r}.")
    limit = _remaining(asset, source_in)
    # Default: run under the whole edit, but never past the end of the file.
    duration = duration or max(timeline.duration - start, 1.0)
    if limit is not None:
        duration = min(duration, limit)
    track = AudioTrack(id=new_id(timeline, "a"), asset_id=asset_id, start=start, duration=duration, source_in=source_in,
                       volume=volume, fade_in=fade_in, fade_out=fade_out)
    data = timeline.model_dump()
    data["audio"].append(track.model_dump())
    return _validated(data), f"Added {asset.name} as audio at {_fmt(start)} ({_fmt(duration)}, volume {volume})."


def update_audio(timeline: Timeline, audio_id: str, **changes: Any) -> tuple[Timeline, str]:
    kind, index = _find(timeline, audio_id)
    if kind != "audio":
        raise EditError(f"{audio_id} isn't an audio track.")
    data = timeline.model_dump()
    data["audio"][index].update({k: v for k, v in changes.items() if v is not None})
    described = ", ".join(f"{k}={v}" for k, v in changes.items() if v is not None)
    return _validated(data), f"Updated audio {audio_id}: {described}."


# --- effects ------------------------------------------------------------------------------

def add_effect(timeline: Timeline, kind: str, start: float, duration: float | None = None,
               intensity: float = 0.6) -> tuple[Timeline, str]:
    from app.services.editor.effects import DEFAULT_LENGTH  # effects imports ops

    duration = duration or DEFAULT_LENGTH.get(kind, 1.0)
    effect = {"id": new_id(timeline, "fx"), "kind": kind, "start": start, "duration": duration, "intensity": intensity}
    data = timeline.model_dump()
    data["effects"].append(effect)
    return _validated(data), f"Added a {kind.replace('_', ' ')} effect at {_fmt(start)} ({_fmt(duration)})."


def update_effect(timeline: Timeline, effect_id: str, **changes: Any) -> tuple[Timeline, str]:
    kind, index = _find(timeline, effect_id)
    if kind != "effects":
        raise EditError(f"{effect_id} isn't an effect.")
    data = timeline.model_dump()
    # Touching an auto effect makes it yours, so the next auto run leaves it alone.
    data["effects"][index].update({k: v for k, v in changes.items() if v is not None}, auto=False)
    described = ", ".join(f"{k}={v}" for k, v in changes.items() if v is not None)
    return _validated(data), f"Updated effect {effect_id}: {described}."


def set_effects(timeline: Timeline, effects: list[Effect]) -> Timeline:
    """Replace every auto effect with `effects` (hand-placed effects are kept)."""
    data = timeline.model_dump()
    data["effects"] = [e for e in data["effects"] if not e["auto"]] + [e.model_dump() for e in effects]
    return _validated(data)


# --- project ------------------------------------------------------------------------------

def set_project(timeline: Timeline, aspect: str | None = None, background: str | None = None) -> tuple[Timeline, str]:
    if aspect and aspect not in ASPECTS:
        raise EditError(f"Aspect must be one of {', '.join(ASPECTS)}.")
    data = timeline.model_dump()
    if aspect:
        data["aspect"] = aspect
    if background:
        data["background"] = background
    return _validated(data), "Changed project settings: " + ", ".join(
        f"{k}={v}" for k, v in (("aspect", aspect), ("background", background)) if v
    ) + "."


# --- captions from speech -----------------------------------------------------------------

def caption_words(timeline: Timeline, transcribe) -> list[dict]:
    """Words spoken in the edit, in timeline time.

    transcribe(path, start, end) -> [{word, start, end}] said in that part of the file, in file time."""
    words: list[dict] = []
    for clip in sorted(timeline.clips, key=lambda c: c.start):
        asset = timeline.asset(clip.asset_id)
        if not asset or asset.kind != "video" or not asset.has_audio or clip.muted or clip.volume == 0:
            continue
        lo, hi = clip.source_in, clip.source_in + clip.duration * clip.speed
        for w in transcribe(asset_path(asset), lo, hi):
            if w["end"] <= lo or w["start"] >= hi:
                continue
            start = clip.start + (max(w["start"], lo) - lo) / clip.speed
            end = clip.start + (min(w["end"], hi) - lo) / clip.speed
            if end - start > 0.02 and w["word"].strip():
                words.append({"word": w["word"].strip(), "start": start, "end": end})
    return sorted(words, key=lambda w: w["start"])


def add_captions(timeline: Timeline, words: list[dict], preset: str = "punch", words_per_caption: int = 3,
                 y: float = 0.72, size: int | None = None) -> tuple[Timeline, str]:
    """Replace existing captions with phrase-by-phrase captions from timed words."""
    if not words:
        raise EditError("No speech found in the clips on the timeline.")
    words_per_caption = max(1, min(8, words_per_caption))
    style = _styled({"preset": preset, "size": size})
    data = timeline.model_dump()
    data["texts"] = [t for t in data["texts"] if not t.get("is_caption")]
    groups: list[list[dict]] = []
    for word in words:
        # Start a new phrase on the size limit, on a pause, or after sentence punctuation.
        if (not groups or len(groups[-1]) >= words_per_caption or word["start"] - groups[-1][-1]["end"] > 0.6
                or groups[-1][-1]["word"][-1:] in ".?!"):
            groups.append([])
        groups[-1].append(word)
    prefix = new_id(timeline, "cap")  # unique run prefix; each caption adds its index
    for n, group in enumerate(groups):
        start = group[0]["start"]
        next_start = groups[n + 1][0]["start"] if n + 1 < len(groups) else group[-1]["end"] + 0.3
        end = min(max(group[-1]["end"], start + 0.35), next_start)
        data["texts"].append({
            "id": f"{prefix}-{n}", "text": " ".join(w["word"] for w in group), "start": round(start, 3),
            "duration": round(max(end - start, MIN_LEN), 3), "y": y, "is_caption": True, **style,
        })
    return _validated(data), f"Added {len(groups)} captions ({preset} style)."

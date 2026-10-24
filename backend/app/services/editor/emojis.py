"""Auto emoji for the editor: emoji text items next to the captions that call for one.

The picking (which phrases, which emoji, which motion) is shared with burned captions in
services/caption/emoji.py. Here each pick becomes a Text item marked is_emoji, placed above
or beside its caption and animated with one of the emoji motions in compose.py, so it can be
moved, retimed or deleted like any text. Running it again replaces the earlier auto emoji.
"""
from __future__ import annotations

from dataclasses import dataclass

from app.schemas.editor import Text, Timeline
from app.services.caption import emoji as emo

# Editor animation for each emoji motion ("slide" is "slide_in" here; plain "slide_up" exists).
ANIMATION = {"pop": "pop", "bounce": "bounce", "float": "float", "spin": "spin", "wiggle": "wiggle",
             "slide": "slide_in", "stamp": "stamp", "burst": "burst"}
SIZE_1080 = 120  # emoji size at 1080 px wide


@dataclass
class AutoResult:
    timeline: Timeline
    count: int
    used_ai: bool
    summary: str


def _phrases(captions: list[Text]) -> list[emo.Phrase]:
    """Caption items as phrases; word times are spread evenly over each caption."""
    out = []
    for cap in captions:
        words = cap.text.split()
        step = cap.duration / max(1, len(words))
        out.append(emo.Phrase([emo.Word(w, cap.start + i * step, cap.start + (i + 1) * step, w.isupper() and len(w) > 2)
                               for i, w in enumerate(words)]))
    return out


def _place(cap: Text, placement: str, size: float, width: int, height: int) -> tuple[float, float]:
    """Centre (x, y fractions) for an emoji next to a caption, kept on screen."""
    max_w = cap.width * width
    text_w = min(max_w, len(cap.text) * cap.size * 0.55)
    lines = max(1, -(-len(cap.text) * cap.size * 0.55 // max_w))
    block_h = lines * cap.size * 1.12
    cx, cy = cap.x * width, cap.y * height
    if placement == "right" and cx + text_w / 2 + size * 1.3 < width:
        return (cx + text_w / 2 + size * 0.8) / width, cap.y
    if placement == "left" and cx - text_w / 2 - size * 1.3 > 0:
        return (cx - text_w / 2 - size * 0.8) / width, cap.y
    y = cy - block_h / 2 - size * 0.75
    if y < size:  # no room above: go under
        y = cy + block_h / 2 + size * 0.75
    return cap.x, min(0.97, max(0.03, y / height))


def auto(timeline: Timeline, amount: str = "normal", motion: str = "mix", placement: str = "mix", *,
         use_ai: bool = True, client=None, model=None) -> AutoResult:
    data = timeline.model_dump()
    data["texts"] = [t for t in data["texts"] if not t.get("is_emoji")]
    if amount == "none":
        new = Timeline.model_validate(data)
        removed = len(timeline.texts) - len(new.texts)
        return AutoResult(new, 0, False, f"Removed {removed} auto emoji")

    captions = sorted((t for t in timeline.texts if t.is_caption and not t.is_emoji), key=lambda t: t.start)
    if not captions:
        raise ValueError("Add captions first: emoji are placed next to them.")
    phrases = _phrases(captions)
    cues, used_ai = emo.plan(phrases, emo.EmojiSettings(amount, motion, placement), use_ai=use_ai, client=client, model=model)

    width, height = timeline.size
    size = round(SIZE_1080 * width / 1080)
    taken = {x["id"] for kind in ("assets", "clips", "texts", "audio", "effects") for x in data[kind]}
    n = 0
    for cue in cues:
        cap = captions[cue.phrase]
        x, y = _place(cap, cue.placement, size, width, height)
        while f"emo{n}" in taken:
            n += 1
        taken.add(f"emo{n}")
        data["texts"].append(Text(
            id=f"emo{n}", text=cue.emoji, start=round(cue.start, 3), duration=round(max(0.3, cue.end - cue.start), 3),
            x=round(x, 4), y=round(y, 4), width=min(1.0, max(0.1, size * 1.6 / width)), size=size, font="System",
            color="#FFFFFF", stroke_color=None, stroke_width=0, background=None, uppercase=False,
            animation=ANIMATION[cue.motion], is_emoji=True,
        ).model_dump())
    new = Timeline.model_validate(data)
    shown = " ".join(c.emoji for c in cues[:8]) + (" …" if len(cues) > 8 else "")
    summary = f"Added {len(cues)} emoji ({amount})" + (f": {shown}" if cues else "; no caption called for one")
    return AutoResult(new, len(cues), used_ai, summary)

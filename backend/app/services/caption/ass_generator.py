"""ASS subtitle generator with our own word layout.

libass can enlarge a word inline, but it can't draw a neat box behind one word, keep lines
from jumping, or tell us where each word landed. So we lay captions out ourselves: every
word is measured with the real font's metrics (exactly as libass sizes text) and placed
with \\pos. That gives:

  - no overlap: an enlarged active word takes its full width, and its neighbours move
    apart ("reflow") or the room is reserved in advance so nothing moves ("stable");
  - line pitch that leaves room for the enlarged word above and below;
  - rounded highlight boxes and line boxes that hug the text;
  - six modes: word_pop, highlight_box, karaoke, reveal, single_word, line.
"""
from __future__ import annotations

import re
from collections.abc import Sequence
from dataclasses import dataclass
from pathlib import Path

from app.models.enums import AnimationType
from app.schemas.caption_style import CaptionOptions, options_from_legacy
from app.schemas.clip import TranscriptWord
from app.services.caption.fonts import FontInfo, ensure_font

CANVAS_W, CANVAS_H = 1080, 1920
PAUSE_BREAK_S = 0.5
GROUP_HOLD_S = 0.35
_SENTENCE_END = re.compile(r"[.!?…]$")
_DESCENDERS = set("gjpqyQ,;")


def seconds_to_ass_time(seconds: float) -> str:
    """Converts seconds (e.g. 12.34) to ASS timestamp H:MM:SS.cc."""
    total_centis = int(round(max(0.0, seconds) * 100))
    centis = total_centis % 100
    total_secs = total_centis // 100
    secs = total_secs % 60
    total_mins = total_secs // 60
    return f"{total_mins // 60}:{total_mins % 60:02d}:{secs:02d}.{centis:02d}"


def sanitize_ass_text(text: str) -> str:
    """Remove characters that would start ASS override tags or line breaks."""
    return text.replace("{", "(").replace("}", ")").replace("\\", "/").strip()


def ass_colour(hex_colour: str) -> str:
    """'#RRGGBB' -> '&HBBGGRR&'."""
    h = hex_colour.lstrip("#")
    return f"&H{h[4:6]}{h[2:4]}{h[0:2]}&".upper()


def ass_alpha(opacity: float) -> str:
    """Opacity 0-100 -> '&HAA&' (00 = opaque)."""
    return f"&H{round(255 * (1 - max(0.0, min(100.0, opacity)) / 100)):02X}&"


def _style_colour(hex_colour: str, opacity: float = 100) -> str:
    """'#RRGGBB' -> '&HAABBGGRR' for a Style line."""
    h = hex_colour.lstrip("#")
    return f"&H{round(255 * (1 - opacity / 100)):02X}{h[4:6]}{h[2:4]}{h[0:2]}".upper()


# ---------- style ----------
@dataclass
class StyleSpec:
    font_name: str
    font_size: int
    uppercase: bool
    animation: str
    options: CaptionOptions

    @classmethod
    def of(cls, style) -> "StyleSpec":
        """From a CaptionStyle row or a CaptionStyleBase schema."""
        animation = getattr(style.animation_type, "value", style.animation_type) or "word_pop"
        raw = getattr(style, "options", None)
        if raw is None:
            raw = getattr(style, "options_json", None)
        if isinstance(raw, CaptionOptions):
            options = raw
        elif raw:
            options = CaptionOptions(**raw)
        else:
            colors = style.colors_json if isinstance(style.colors_json, dict) else style.colors_json.model_dump()
            options = options_from_legacy(colors, animation)
        return cls(style.font_name, int(style.font_size), bool(style.uppercase), str(animation), options)


class _ApproxFont:
    """Used when the font file isn't available: average glyph widths, typical metrics."""

    def __init__(self, name: str):
        self.name = name
        self.em_ratio = 0.8

    def text_width(self, text: str, size: float, scale: float = 1.0, spacing: float = 0.0) -> float:
        em = size * self.em_ratio
        units = sum(0.33 if ch == " " else 0.62 if ch.isupper() else 0.54 for ch in text)
        return (units * em + spacing * len(text)) * scale

    def ratios(self) -> dict[str, float]:
        return {"ascent": 0.75, "descent": 0.25, "cap": 0.57}


# ---------- layout ----------
@dataclass
class Placed:
    index: int  # word index within the group
    text: str
    x: float  # left edge
    cx: float  # centre x (for \pos with \an5)
    cy: float  # line centre y
    width: float
    scale: float  # %


class Layout:
    def __init__(self, spec: StyleSpec, font: FontInfo | _ApproxFont):
        self.spec = spec
        self.o = spec.options
        self.font = font
        r = font.ratios()
        self.asc, self.desc, self.cap = r["ascent"], r["descent"], r["cap"]
        self.max_w = CANVAS_W * self.o.max_width / 100

    def word_scale(self, word: str, active: bool, hype: bool) -> float:
        if not active or self.spec.animation in (AnimationType.KARAOKE.value, AnimationType.LINE.value):
            return 100.0
        return float(self.o.hype_scale if hype else self.o.active_scale)

    def max_word_scale(self, hype: bool) -> float:
        if self.spec.animation in (AnimationType.KARAOKE.value, AnimationType.LINE.value):
            return 100.0
        return float(max(self.o.active_scale, self.o.hype_scale if hype else 0))

    def width(self, text: str, size: float, scale: float) -> float:
        return self.font.text_width(text, size, scale / 100, self.o.letter_spacing)

    def space(self, size: float) -> float:
        gap = self.font.text_width(" ", size, 1.0, self.o.letter_spacing)
        if self.spec.animation == AnimationType.HIGHLIGHT_BOX.value:
            gap += self.o.box_padding  # the box mustn't touch the next word
        return gap

    def break_lines(self, words: list[str], hype: list[bool], size: float) -> list[list[int]]:
        """Greedy lines, sized for each word at its largest so lines never change mid-phrase."""
        lines: list[list[int]] = []
        current: list[int] = []
        current_w = 0.0
        for i, w in enumerate(words):
            ww = self.width(w, size, self.max_word_scale(hype[i]))
            extra = ww if not current else self.space(size) + ww
            if current and (len(current) >= self.o.words_per_line or current_w + extra > self.max_w):
                lines.append(current)
                current, current_w = [i], ww
            else:
                current.append(i)
                current_w += extra
        if current:
            lines.append(current)
        return lines

    def fit_size(self, words: list[str], hype: list[bool]) -> float:
        """Shrink the font for a phrase whose longest word can't fit the width."""
        size = float(self.spec.font_size)
        widest = max((self.width(w, size, self.max_word_scale(h)) for w, h in zip(words, hype)), default=0)
        return size * min(1.0, self.max_w / widest) if widest else size

    def line_pitch(self, size: float) -> float:
        # Room for an enlarged word to grow above and below its line without touching the next.
        grow = max(self.o.active_scale, self.o.hype_scale) / 100 if self.spec.animation not in ("karaoke", "line") else 1.0
        return size * (self.asc + self.desc) * (1 + grow) / 2 * self.o.line_spacing / 100

    def place(self, words: list[str], hype: list[bool], lines: list[list[int]], size: float, active: int | None) -> list[Placed]:
        pitch = self.line_pitch(size)
        block_cy = CANVAS_H * self.o.position_y / 100
        top_cy = block_cy - pitch * (len(lines) - 1) / 2
        stable = self.o.spacing_mode == "stable"
        placed: list[Placed] = []
        gap = self.space(size)
        for li, line in enumerate(lines):
            cy = top_cy + li * pitch
            scales = [self.word_scale(words[i], i == active, hype[i]) for i in line]
            slots = [
                self.width(words[i], size, self.max_word_scale(hype[i]) if stable else s) for i, s in zip(line, scales)
            ]
            total = sum(slots) + gap * (len(line) - 1)
            x = CANVAS_W / 2 - total / 2
            for i, s, slot in zip(line, scales, slots):
                w = self.width(words[i], size, s)
                cx = x + slot / 2
                placed.append(Placed(i, words[i], cx - w / 2, cx, cy, w, s))
                x += slot + gap
        return placed

    def text_box(self, p: Placed, size: float, pad: float) -> tuple[float, float, float, float]:
        """Box hugging a word's visible glyphs (x0, y0, x1, y1)."""
        s = p.scale / 100
        baseline = p.cy + s * size * (self.asc - self.desc) / 2
        top = baseline - s * size * self.cap * (1.0 if self.spec.uppercase or p.text.isupper() else 1.12)
        bottom = baseline + (s * size * self.desc * 0.7 if set(p.text) & _DESCENDERS else s * size * 0.04)
        return p.x - pad, top - pad, p.x + p.width + pad, bottom + pad


def _rounded_rect(x0: float, y0: float, x1: float, y1: float, r: float) -> str:
    r = max(0.0, min(r, (x1 - x0) / 2, (y1 - y0) / 2))
    k = r * 0.4477  # bezier handle for a quarter circle
    f = lambda v: f"{v:.1f}".rstrip("0").rstrip(".")  # noqa: E731
    return (
        f"m {f(x0 + r)} {f(y0)} l {f(x1 - r)} {f(y0)} "
        f"b {f(x1 - k)} {f(y0)} {f(x1)} {f(y0 + k)} {f(x1)} {f(y0 + r)} "
        f"l {f(x1)} {f(y1 - r)} "
        f"b {f(x1)} {f(y1 - k)} {f(x1 - k)} {f(y1)} {f(x1 - r)} {f(y1)} "
        f"l {f(x0 + r)} {f(y1)} "
        f"b {f(x0 + k)} {f(y1)} {f(x0)} {f(y1 - k)} {f(x0)} {f(y1 - r)} "
        f"l {f(x0)} {f(y0 + r)} "
        f"b {f(x0)} {f(y0 + k)} {f(x0 + k)} {f(y0)} {f(x0 + r)} {f(y0)}"
    )


# ---------- generator ----------
@dataclass
class _Word:
    text: str
    start: float
    end: float
    hype: bool


class ASSGenerator:
    """Generates styled ASS subtitle files for 1080x1920 vertical video."""

    def __init__(self, canvas_width: int = CANVAS_W, canvas_height: int = CANVAS_H):
        self.canvas_width = canvas_width
        self.canvas_height = canvas_height

    def generate(
        self,
        words: Sequence[TranscriptWord | dict],
        style,
        clip_start_s: float = 0.0,
        clip_end_s: float | None = None,
        words_per_group: int | None = None,  # kept for old callers; the style's options decide
        output_file: str | Path | None = None,
        hype_words: Sequence[str] = (),
    ) -> str:
        spec = style if isinstance(style, StyleSpec) else StyleSpec.of(style)
        font = ensure_font(spec.font_name) or _ApproxFont(spec.font_name)
        layout = Layout(spec, font)
        hype_set = {h.upper().strip("!?,.") for h in hype_words if h}

        clip_words = self._clip_words(words, spec, clip_start_s, clip_end_s, hype_set)
        events: list[str] = []
        groups = self._groups(clip_words, spec, layout)
        for gi, group in enumerate(groups):
            # Nothing may still be on screen when the next phrase starts, or the two overlap.
            next_start = groups[gi + 1][0].start if gi + 1 < len(groups) else None
            events += self._group_events(group, spec, layout, next_start)

        content = self._header(spec) + "\n".join(events) + ("\n" if events else "")
        if output_file:
            p = Path(output_file)
            p.parent.mkdir(parents=True, exist_ok=True)
            p.write_text(content, encoding="utf-8")
        return content

    # --- words & groups ---
    @staticmethod
    def _clip_words(words, spec: StyleSpec, start: float, end: float | None, hype_set: set[str]) -> list[_Word]:
        out: list[_Word] = []
        for w in words:
            text = str(w["word"] if isinstance(w, dict) else w.word)
            ws = float(w["start"] if isinstance(w, dict) else w.start)
            we = float(w["end"] if isinstance(w, dict) else w.end)
            if (end is not None and ws >= end) or we <= start:
                continue
            text = sanitize_ass_text(text)
            if not text:
                continue
            if spec.uppercase:
                text = text.upper()
            rel_end = (we - start) if end is None else min(end - start, we - start)
            out.append(_Word(text, max(0.0, ws - start), max(0.0, rel_end), text.upper().strip("!?,.") in hype_set))
        return out

    @staticmethod
    def _groups(words: list[_Word], spec: StyleSpec, layout: Layout) -> list[list[_Word]]:
        o = spec.options
        cap = 1 if spec.animation == AnimationType.SINGLE_WORD.value else o.words_per_line * o.max_lines
        groups: list[list[_Word]] = []
        cur: list[_Word] = []
        for w in words:
            if cur and (len(cur) >= cap or w.start - cur[-1].end > PAUSE_BREAK_S or _SENTENCE_END.search(cur[-1].text)):
                groups.append(cur)
                cur = []
            cur.append(w)
        if cur:
            groups.append(cur)

        # A phrase that needs more lines than allowed (long words) is split at a line break.
        final: list[list[_Word]] = []
        for g in groups:
            texts, hype = [w.text for w in g], [w.hype for w in g]
            size = layout.fit_size(texts, hype)
            lines = layout.break_lines(texts, hype, size)
            for k in range(0, len(lines), o.max_lines):
                idx = [i for line in lines[k : k + o.max_lines] for i in line]
                final.append([g[i] for i in idx])
        return final

    # --- events ---
    def _group_events(self, group: list[_Word], spec: StyleSpec, layout: Layout, next_start: float | None = None) -> list[str]:
        o = spec.options
        texts, hype = [w.text for w in group], [w.hype for w in group]
        size = layout.fit_size(texts, hype)
        lines = layout.break_lines(texts, hype, size)
        anim = spec.animation
        out: list[str] = []

        def hold(t: float) -> float:
            return min(t + GROUP_HOLD_S, next_start) if next_start is not None else t + GROUP_HOLD_S

        if anim == AnimationType.LINE.value:
            start, end = group[0].start, hold(group[-1].end)
            placed = layout.place(texts, hype, lines, size, None)
            out += self._frame(placed, None, spec, layout, size, start, end, visible=None)
            return out

        for a, w in enumerate(group):
            start = w.start
            end = group[a + 1].start if a + 1 < len(group) else hold(w.end)
            if end - start < 0.05:
                end = start + 0.05
            if next_start is not None:
                end = min(end, max(next_start, start + 0.01))
            if anim == AnimationType.SINGLE_WORD.value:
                one = layout.place([w.text], [w.hype], [[0]], size, 0)
                out += self._frame(one, 0, spec, layout, size, start, end, visible=None)
                continue
            placed = layout.place(texts, hype, lines, size, a)
            visible = set(range(a + 1)) if anim == AnimationType.REVEAL.value else None
            out += self._frame(placed, a, spec, layout, size, start, end, visible)
        return out

    def _frame(self, placed: list[Placed], active: int | None, spec: StyleSpec, layout: Layout, size: float, start: float, end: float, visible: set[int] | None) -> list[str]:
        """All events for one moment: line boxes, highlight box, glow, then the words."""
        o = spec.options
        t0, t1 = seconds_to_ass_time(start), seconds_to_ass_time(end)
        dur_ms = int((end - start) * 1000)
        shown = [p for p in placed if visible is None or p.index in visible]
        ev: list[str] = []

        def dialogue(layer: int, text: str) -> None:
            ev.append(f"Dialogue: {layer},{t0},{t1},Default,,0,0,0,,{text}")

        def drawing(layer: int, shape: str, colour: str, opacity: float, blur: float = 0) -> None:
            tags = f"\\an7\\pos(0,0)\\bord0\\shad0\\1c{ass_colour(colour)}\\1a{ass_alpha(opacity)}" + (f"\\blur{blur:g}" if blur else "")
            dialogue(layer, f"{{{tags}\\p1}}{shape}{{\\p0}}")

        # Line boxes (classic subtitle bar), one per line, hugging that line's words.
        if o.line_box and shown:
            for cy in sorted({p.cy for p in shown}):
                row = [p for p in shown if p.cy == cy]
                boxes = [layout.text_box(p, size, o.box_padding) for p in row]
                x0, y0 = min(b[0] for b in boxes), min(b[1] for b in boxes)
                x1, y1 = max(b[2] for b in boxes), max(b[3] for b in boxes)
                drawing(0, _rounded_rect(x0, y0, x1, y1, o.box_radius), o.line_box_color, o.line_box_opacity)

        is_box = spec.animation == AnimationType.HIGHLIGHT_BOX.value
        if is_box and active is not None:
            p = next((p for p in shown if p.index == active), None)
            if p:
                drawing(1, _rounded_rect(*layout.text_box(p, size, o.box_padding), o.box_radius), o.box_color, o.box_opacity)

        for p in shown:
            is_active = p.index == active
            lit = is_active or (spec.animation == AnimationType.KARAOKE.value and active is not None and p.index < active)
            colour = o.active_text_color if (is_box and is_active) else (o.active_color if lit and not is_box else o.text_color)
            tags = [f"\\an5\\pos({p.cx:.1f},{p.cy:.1f})"]
            if size != spec.font_size:
                tags.append(f"\\fs{size:.1f}")
            if colour != o.text_color:
                tags.append(f"\\1c{ass_colour(colour)}")
            if is_box and is_active:
                tags.append("\\bord0\\shad0")  # text on a box reads cleaner without an outline
            if active is not None and not is_active and not lit and o.inactive_opacity < 100:
                tags.append(f"\\alpha{ass_alpha(o.inactive_opacity)}")
            if o.blur:
                tags.append(f"\\blur{o.blur:g}")
            if p.scale != 100 or (is_active and o.pop_in):
                if is_active and o.pop_in and spec.animation != AnimationType.KARAOKE.value:
                    from_s = max(60.0, p.scale * 0.78)
                    tags.append(f"\\fscx{from_s:.0f}\\fscy{from_s:.0f}\\t(0,{min(110, dur_ms)},\\fscx{p.scale:.0f}\\fscy{p.scale:.0f})")
                else:
                    tags.append(f"\\fscx{p.scale:.0f}\\fscy{p.scale:.0f}")
            body = "".join(tags)
            if o.glow_strength > 0:
                glow = f"\\bord{o.glow_strength:g}\\blur{o.glow_strength * 0.6:g}\\3c{ass_colour(o.glow_color)}\\1a&HFF&\\shad0"
                dialogue(2, f"{{{body}{glow}}}{p.text}")
            dialogue(3, f"{{{body}}}{p.text}")
        return ev

    def _header(self, spec: StyleSpec) -> str:
        o = spec.options
        primary = _style_colour(o.text_color)
        outline = _style_colour(o.outline_color)
        back = _style_colour(o.shadow_color, o.shadow_opacity)
        bold = -1 if o.bold else 0
        italic = -1 if o.italic else 0
        return f"""[Script Info]
Title: ClipHive Subtitles
ScriptType: v4.00+
PlayResX: {self.canvas_width}
PlayResY: {self.canvas_height}
WrapStyle: 2
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,{spec.font_name},{spec.font_size},{primary},&H000000FF,{outline},{back},{bold},{italic},0,0,100,100,{o.letter_spacing:g},0,1,{o.outline_width:g},{o.shadow_depth:g},5,0,0,0,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
"""

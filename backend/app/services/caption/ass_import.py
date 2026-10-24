"""Import caption styles from .ass/.ssa subtitle files (Aegisub, Subtitle Edit, Premiere and
most subtitle tools export this format), mapped onto CaptionOptions."""
from __future__ import annotations

import re

from app.models.enums import AnimationType
from app.schemas.caption_style import CaptionOptions, CaptionStyleCreate, ass_to_hex
from app.services.caption.fonts import get_font, install_google_font


class AssImportError(ValueError):
    pass


def _sections(text: str) -> dict[str, list[str]]:
    sections: dict[str, list[str]] = {}
    current = ""
    for raw in text.splitlines():
        line = raw.strip().lstrip("﻿")
        if line.startswith("[") and line.endswith("]"):
            current = line[1:-1].strip().lower()
            sections.setdefault(current, [])
        elif line and not line.startswith(";"):
            sections.setdefault(current, []).append(line)
    return sections


def _num(value: str, default: float = 0.0) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return default


def _resolve_font(name: str, bold: bool) -> str:
    """Use the font if we have it; else try Google Fonts; else keep the name (upload it later)."""
    if get_font(name):
        return name
    for weight in ([700, 800, 400] if bold else [400, 500, 700]):
        try:
            return install_google_font(name, weight).name
        except Exception:
            continue
    return name


def parse_ass_styles(text: str, max_styles: int = 20) -> list[CaptionStyleCreate]:
    sections = _sections(text)
    info = {}
    for line in sections.get("script info", []):
        if ":" in line:
            k, v = line.split(":", 1)
            info[k.strip().lower()] = v.strip()
    play_x = _num(info.get("playresx"), 0) or 0
    play_y = _num(info.get("playresy"), 0) or (play_x * 16 / 9 if play_x else 288)
    k = 1920 / play_y  # scale sizes to our 1080x1920 canvas

    style_lines = sections.get("v4+ styles") or sections.get("v4 styles") or []
    fmt = next((l.split(":", 1)[1] for l in style_lines if l.lower().startswith("format:")), None)
    if not fmt:
        raise AssImportError("No [V4+ Styles] section with a Format line was found.")
    cols = [c.strip().lower() for c in fmt.split(",")]

    events = "\n".join(sections.get("events", []))
    karaoke_styles = set(re.findall(r"^Dialogue:[^,]*,[^,]*,[^,]*,([^,]*),.*\\[kK][fo]?\d", events, flags=re.M))

    out: list[CaptionStyleCreate] = []
    for line in style_lines:
        if not line.lower().startswith("style:"):
            continue
        values = [v.strip() for v in line.split(":", 1)[1].split(",", len(cols) - 1)]
        row = dict(zip(cols, values))
        name = (row.get("name") or "Imported").strip()[:80]
        bold = row.get("bold", "0") not in ("0", "")
        size = max(8, min(300, round(_num(row.get("fontsize"), 48) * k)))

        text_hex, text_op = ass_to_hex(row.get("primarycolour"), "#FFFFFF")
        second_hex, _ = ass_to_hex(row.get("secondarycolour"), "#FFE600")
        outline_hex, outline_op = ass_to_hex(row.get("outlinecolour"), "#000000")
        back_hex, back_op = ass_to_hex(row.get("backcolour"), "#000000")
        border_style = int(_num(row.get("borderstyle"), 1))
        align = int(_num(row.get("alignment"), 2))
        margin_v = _num(row.get("marginv"), 20) * k
        if align in (1, 2, 3):
            pos = 100 - (margin_v + size * 0.6) / 1920 * 100
        elif align in (7, 8, 9):
            pos = (margin_v + size * 0.6) / 1920 * 100
        else:
            pos = 50
        karaoke = name in karaoke_styles

        options = CaptionOptions(
            # In ASS karaoke, text starts in SecondaryColour and turns PrimaryColour when sung.
            text_color=second_hex if karaoke else text_hex,
            active_color=text_hex if karaoke else "#FFE600",
            outline_color=outline_hex,
            outline_width=0 if border_style == 3 else max(0, min(24, _num(row.get("outline"), 2) * k)),
            shadow_color=back_hex,
            shadow_opacity=back_op,
            shadow_depth=0 if border_style == 3 else max(0, min(24, _num(row.get("shadow"), 0) * k)),
            letter_spacing=max(-5, min(30, _num(row.get("spacing"), 0) * k)),
            italic=row.get("italic", "0") not in ("0", ""),
            line_box=border_style == 3,
            line_box_color=outline_hex,
            line_box_opacity=outline_op,
            position_y=int(max(8, min(92, pos))),
            words_per_line=6,
            max_lines=2,
        )
        out.append(
            CaptionStyleCreate(
                name=name,
                font_name=_resolve_font(row.get("fontname") or "Arial", bold),
                font_size=size,
                uppercase=False,
                animation_type=AnimationType.KARAOKE if karaoke else AnimationType.LINE,
                options=options,
                category="Imported",
                description=f"Imported from an .ass file (style {name}).",
            )
        )
        if len(out) >= max_styles:
            break
    if not out:
        raise AssImportError("The file has a styles section but no Style lines.")
    return out


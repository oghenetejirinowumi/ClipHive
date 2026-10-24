import re
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field, field_validator

from app.models.enums import AnimationType
from app.schemas.common import ORMModel

# ASS colour literal: &HAABBGGRR or &HBBGGRR (note: BGR order, not RGB)
ASS_COLOUR = re.compile(r"^&H[0-9A-F]{6}([0-9A-F]{2})?$", re.IGNORECASE)
HEX_COLOUR = re.compile(r"^#[0-9A-F]{6}$", re.IGNORECASE)


class CaptionColors(BaseModel):
    """Legacy colour set (still accepted; `options` holds the full style)."""

    primary: str = "&H00FFFFFF"
    outline: str = "&H00000000"
    highlight: str = "&H0000FFFF"  # active word in word_pop / karaoke
    back: str = "&H80000000"  # box / shadow

    @field_validator("primary", "outline", "highlight", "back")
    @classmethod
    def check_ass_colour(cls, v: str) -> str:
        if not ASS_COLOUR.match(v):
            raise ValueError("must be an ASS colour like &H00FFFFFF (BGR)")
        return "&H" + v[2:].upper()


Hex = str


class CaptionOptions(BaseModel):
    """Everything about how a caption looks and moves. Colours are web hex (#RRGGBB)."""

    # Text
    text_color: Hex = "#FFFFFF"
    letter_spacing: float = Field(default=0, ge=-5, le=30)  # px at 1080 wide
    line_spacing: int = Field(default=100, ge=70, le=180)  # % of the font's line height
    bold: bool = False  # synthetic bold; prefer a heavy font weight
    italic: bool = False
    # Active word
    active_color: Hex = "#FFE600"
    active_text_color: Hex = "#FFFFFF"  # text colour on the highlight box
    active_scale: int = Field(default=118, ge=100, le=180)  # %
    hype_scale: int = Field(default=135, ge=100, le=200)  # % for hype words
    pop_in: bool = True  # active word springs in
    inactive_opacity: int = Field(default=100, ge=15, le=100)  # dim the other words
    # Outline, shadow, glow
    outline_color: Hex = "#000000"
    outline_width: float = Field(default=6, ge=0, le=24)
    shadow_color: Hex = "#000000"
    shadow_opacity: int = Field(default=60, ge=0, le=100)
    shadow_depth: float = Field(default=3, ge=0, le=24)
    blur: float = Field(default=0, ge=0, le=10)  # softens outline + shadow edges
    glow_color: Hex = "#FFFFFF"
    glow_strength: float = Field(default=0, ge=0, le=40)
    # Boxes
    box_color: Hex = "#7C3AED"  # highlight-box mode
    box_opacity: int = Field(default=100, ge=0, le=100)
    box_padding: float = Field(default=14, ge=0, le=60)
    box_radius: float = Field(default=16, ge=0, le=60)
    line_box: bool = False  # a box behind each whole line (classic subtitle look)
    line_box_color: Hex = "#000000"
    line_box_opacity: int = Field(default=65, ge=0, le=100)
    # Layout
    words_per_line: int = Field(default=3, ge=1, le=8)
    max_lines: int = Field(default=2, ge=1, le=3)
    position_y: int = Field(default=68, ge=8, le=92)  # centre of the caption block, % from top
    max_width: int = Field(default=86, ge=40, le=100)  # % of frame width
    spacing_mode: Literal["reflow", "stable"] = "reflow"  # reflow: neighbours move apart; stable: room is reserved

    @field_validator(
        "text_color", "active_color", "active_text_color", "outline_color", "shadow_color", "glow_color", "box_color", "line_box_color"
    )
    @classmethod
    def check_hex(cls, v: str) -> str:
        if not HEX_COLOUR.match(v):
            raise ValueError("must be a colour like #FFE600")
        return v.upper()


def ass_to_hex(ass: str | None, default: str) -> tuple[str, int]:
    """'&H80000000' -> ('#000000', 50) (hex, opacity %)."""
    m = re.match(r"^&H([0-9A-F]{2})?([0-9A-F]{2})([0-9A-F]{2})([0-9A-F]{2})$", (ass or "").upper())
    if not m:
        return default, 100
    a, b, g, r = m.groups()
    opacity = round(100 * (1 - int(a or "00", 16) / 255))
    return f"#{r}{g}{b}", opacity


def options_from_legacy(colors: dict | None, animation: str | None = None) -> CaptionOptions:
    """Build options for a style saved before `options` existed."""
    colors = colors or {}
    text, _ = ass_to_hex(colors.get("primary"), "#FFFFFF")
    outline, _ = ass_to_hex(colors.get("outline"), "#000000")
    active, _ = ass_to_hex(colors.get("highlight"), "#FFE600")
    back, back_opacity = ass_to_hex(colors.get("back"), "#000000")
    return CaptionOptions(
        text_color=text,
        outline_color=outline,
        active_color=active,
        shadow_color=back,
        shadow_opacity=back_opacity,
        line_box=animation == AnimationType.LINE.value,
        line_box_color=back,
        line_box_opacity=back_opacity,
    )


class CaptionStyleBase(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    font_name: str = Field(min_length=1, max_length=100)
    font_size: int = Field(default=72, ge=8, le=300)
    colors_json: CaptionColors = Field(default_factory=CaptionColors)
    animation_type: AnimationType = AnimationType.WORD_POP
    uppercase: bool = False
    options: CaptionOptions | None = None


class CaptionStyleCreate(CaptionStyleBase):
    category: str | None = Field(default=None, max_length=40)
    description: str | None = Field(default=None, max_length=200)


class CaptionStyleUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=100)
    font_name: str | None = Field(default=None, min_length=1, max_length=100)
    font_size: int | None = Field(default=None, ge=8, le=300)
    colors_json: CaptionColors | None = None
    animation_type: AnimationType | None = None
    uppercase: bool | None = None
    options: CaptionOptions | None = None
    category: str | None = Field(default=None, max_length=40)
    description: str | None = Field(default=None, max_length=200)


class CaptionStyleRead(ORMModel):
    id: int
    user_id: int | None
    name: str
    font_name: str
    font_size: int
    colors_json: dict
    animation_type: AnimationType
    uppercase: bool
    options: CaptionOptions
    category: str | None = None
    description: str | None = None
    font_file: str | None
    is_preset: bool
    created_at: datetime
    # For the browser preview: where to load the font, and how libass sizes it.
    font_url: str | None = None
    font_em_ratio: float = 1.0
    font_available: bool = False


class RenderPreviewRequest(BaseModel):
    style: CaptionStyleBase
    text: str = Field(default="Bro you cannot miss that shot, that was insane", max_length=200)
    clip_id: int | None = None  # use a frame of this clip as the background


class GoogleFontInstall(BaseModel):
    family: str = Field(min_length=2, max_length=60)
    weight: int = Field(default=700, ge=100, le=900)

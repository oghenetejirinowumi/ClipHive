"""The caption style library: presets modelled on the looks used across short-form video.

Each preset is a full CaptionOptions spec. Fonts are either bundled (backend/assets/fonts)
or Google Fonts ("Family weight"), downloaded the first time they're needed. Presets are
read-only; creators duplicate one to customise it. Punch, Clean and Neon keep their names
because the agents and older clips refer to them.
"""
from __future__ import annotations

from sqlalchemy.orm import Session

from app.models.caption_style import CaptionStyle
from app.models.enums import AnimationType
from app.schemas.caption_style import CaptionOptions

A = AnimationType

PRESET_STYLES: list[dict] = [
    {
        "name": "Punch",
        "category": "Gaming",
        "description": "Comic-book caps, thick outline, yellow pop on the word being said.",
        "font_name": "Bangers",
        "font_size": 128,
        "uppercase": True,
        "animation_type": A.WORD_POP,
        "options": dict(text_color="#FFFFFF", active_color="#FFE600", active_scale=128, hype_scale=148, outline_width=8, shadow_depth=5, shadow_opacity=70, words_per_line=3, position_y=66),
    },
    {
        "name": "Clean",
        "category": "Minimal",
        "description": "Calm sentence case; the spoken word is bright, the rest are dimmed.",
        "font_name": "Poppins SemiBold",
        "font_size": 96,
        "uppercase": False,
        "animation_type": A.WORD_POP,
        "options": dict(text_color="#FFFFFF", active_color="#FFFFFF", active_scale=104, hype_scale=110, inactive_opacity=55, outline_width=0, shadow_depth=3, shadow_opacity=55, blur=1.5, words_per_line=4, position_y=70),
    },
    {
        "name": "Neon",
        "category": "Fun",
        "description": "Rounded display caps in cyan with a magenta glow.",
        "font_name": "Luckiest Guy",
        "font_size": 92,
        "uppercase": True,
        "animation_type": A.WORD_POP,
        "options": dict(text_color="#3DF5FF", active_color="#FFE600", active_scale=124, hype_scale=145, outline_color="#2B0040", outline_width=6, shadow_depth=0, glow_color="#FF2BD6", glow_strength=12, words_per_line=3, position_y=66),
    },
    {
        "name": "Podcast Bold",
        "category": "Podcast",
        "description": "Heavy white caps with a black outline and a yellow active word: the business-podcast look.",
        "font_name": "Montserrat 900",
        "font_size": 96,
        "uppercase": True,
        "animation_type": A.WORD_POP,
        "options": dict(text_color="#FFFFFF", active_color="#FFE600", active_scale=116, hype_scale=132, outline_width=8, shadow_depth=6, shadow_opacity=80, words_per_line=3, max_lines=2, position_y=68),
    },
    {
        "name": "Podcast Green",
        "category": "Podcast",
        "description": "Same heavy caps, with a green active word.",
        "font_name": "Montserrat 900",
        "font_size": 96,
        "uppercase": True,
        "animation_type": A.WORD_POP,
        "options": dict(text_color="#FFFFFF", active_color="#39FF14", active_scale=116, hype_scale=132, outline_width=8, shadow_depth=6, shadow_opacity=80, words_per_line=3, position_y=68),
    },
    {
        "name": "Highlight Box",
        "category": "Viral",
        "description": "The spoken word sits on a rounded purple box. The look of most caption apps.",
        "font_name": "Montserrat 800",
        "font_size": 90,
        "uppercase": True,
        "animation_type": A.HIGHLIGHT_BOX,
        "options": dict(text_color="#FFFFFF", active_text_color="#FFFFFF", box_color="#7C3AED", box_padding=14, box_radius=18, active_scale=106, hype_scale=112, outline_width=0, shadow_depth=4, shadow_opacity=50, blur=1, words_per_line=3, position_y=68),
    },
    {
        "name": "Green Box",
        "category": "Viral",
        "description": "Bold caps on a lime highlight box with dark text.",
        "font_name": "Montserrat 900",
        "font_size": 90,
        "uppercase": True,
        "animation_type": A.HIGHLIGHT_BOX,
        "options": dict(text_color="#FFFFFF", active_text_color="#0B0B0B", box_color="#B6FF3B", box_padding=12, box_radius=10, active_scale=106, hype_scale=112, outline_width=5, shadow_depth=0, words_per_line=3, position_y=68),
    },
    {
        "name": "One Word",
        "category": "Viral",
        "description": "One huge condensed word at a time, springing in. Fast and punchy.",
        "font_name": "Anton 400",
        "font_size": 170,
        "uppercase": True,
        "animation_type": A.SINGLE_WORD,
        "options": dict(text_color="#FFFFFF", active_color="#FFFFFF", active_scale=100, hype_scale=118, outline_width=9, shadow_depth=6, shadow_opacity=75, position_y=58),
    },
    {
        "name": "Bold Pop",
        "category": "Fun",
        "description": "Chunky rounded type, very thick outline, cyan pop. Big-creator energy.",
        "font_name": "Lilita One 400",
        "font_size": 118,
        "uppercase": True,
        "animation_type": A.WORD_POP,
        "options": dict(text_color="#FFFFFF", active_color="#00E0FF", active_scale=130, hype_scale=150, outline_width=10, shadow_depth=7, shadow_opacity=85, words_per_line=2, position_y=64),
    },
    {
        "name": "Karaoke",
        "category": "Music",
        "description": "Words fill with colour as they're sung or said.",
        "font_name": "Rubik 800",
        "font_size": 92,
        "uppercase": True,
        "animation_type": A.KARAOKE,
        "options": dict(text_color="#FFFFFF", active_color="#FFD400", outline_width=6, shadow_depth=4, words_per_line=3, position_y=68),
    },
    {
        "name": "Typewriter",
        "category": "Story",
        "description": "Words appear as they're spoken, building the sentence.",
        "font_name": "Inter 700",
        "font_size": 88,
        "uppercase": False,
        "animation_type": A.REVEAL,
        "options": dict(text_color="#FFFFFF", active_color="#FFFFFF", active_scale=108, outline_width=0, shadow_depth=4, shadow_opacity=65, blur=1.5, words_per_line=4, position_y=70),
    },
    {
        "name": "Subtitle Bar",
        "category": "Broadcast",
        "description": "Classic TV/YouTube subtitles: sentence case on a dark bar.",
        "font_name": "Roboto 500",
        "font_size": 72,
        "uppercase": False,
        "animation_type": A.LINE,
        "options": dict(text_color="#FFFFFF", outline_width=0, shadow_depth=0, line_box=True, line_box_color="#000000", line_box_opacity=70, box_padding=12, box_radius=8, words_per_line=6, max_lines=2, position_y=80),
    },
    {
        "name": "Documentary",
        "category": "Story",
        "description": "Elegant serif, soft shadow, low on the screen.",
        "font_name": "Lora 700",
        "font_size": 84,
        "uppercase": False,
        "animation_type": A.LINE,
        "options": dict(text_color="#FFFFFF", outline_width=0, shadow_depth=3, shadow_opacity=70, blur=2, words_per_line=5, max_lines=2, position_y=80),
    },
    {
        "name": "Neon Glow",
        "category": "Fun",
        "description": "Tall pink caps with a bright glow, white pop.",
        "font_name": "Bebas Neue 400",
        "font_size": 140,
        "uppercase": True,
        "animation_type": A.WORD_POP,
        "options": dict(text_color="#FF4FD8", active_color="#FFFFFF", active_scale=118, hype_scale=135, outline_color="#3A0030", outline_width=3, shadow_depth=0, glow_color="#FF4FD8", glow_strength=16, words_per_line=3, position_y=66),
    },
]

PRESET_FONTS = sorted({p["font_name"] for p in PRESET_STYLES})


def legacy_colors(options: CaptionOptions) -> dict:
    """colors_json kept in step with options for older readers."""
    from app.services.caption.ass_generator import _style_colour

    return {
        "primary": _style_colour(options.text_color),
        "outline": _style_colour(options.outline_color),
        "highlight": _style_colour(options.active_color),
        "back": _style_colour(options.shadow_color, options.shadow_opacity),
    }


def seed_preset_styles(db: Session) -> list[CaptionStyle]:
    """Create the library presets, and keep existing preset rows in step with this file."""
    changed = False
    for spec in PRESET_STYLES:
        options = CaptionOptions(**spec["options"])
        values = {
            "font_name": spec["font_name"],
            "font_size": spec["font_size"],
            "uppercase": spec["uppercase"],
            "animation_type": spec["animation_type"],
            "options_json": options.model_dump(),
            "colors_json": legacy_colors(options),
            "category": spec["category"],
            "description": spec["description"],
            "font_file": None,
        }
        style = db.query(CaptionStyle).filter(CaptionStyle.name == spec["name"], CaptionStyle.is_preset.is_(True)).first()
        if style is None:
            db.add(CaptionStyle(user_id=None, name=spec["name"], is_preset=True, **values))
            changed = True
            continue
        for key, value in values.items():
            current = getattr(style, key)
            if getattr(current, "value", current) != getattr(value, "value", value):
                setattr(style, key, value)
                changed = True
    if changed:
        db.commit()
    order = {p["name"]: i for i, p in enumerate(PRESET_STYLES)}
    presets = db.query(CaptionStyle).filter(CaptionStyle.is_preset.is_(True)).all()
    return sorted(presets, key=lambda s: order.get(s.name, 999))

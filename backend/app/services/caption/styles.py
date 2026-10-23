"""Preset caption styles and seed utilities for ClipHive."""
from __future__ import annotations

from sqlalchemy.orm import Session

from app.models.caption_style import CaptionStyle
from app.models.enums import AnimationType

PRESET_STYLES = [
    {
        "name": "Punch",
        "font_name": "Bangers",
        "font_file": "backend/assets/fonts/Bangers-Regular.ttf",
        "font_size": 84,
        "colors_json": {
            "primary": "&H0000FFFF",  # Yellow in BGR
            "outline": "&H00000000",  # Black
            "highlight": "&H0000FFFF",
            "back": "&H80000000",
        },
        "animation_type": AnimationType.WORD_POP,
        "uppercase": True,
        "is_preset": True,
    },
    {
        "name": "Clean",
        "font_name": "Poppins",
        "font_file": "backend/assets/fonts/Poppins-SemiBold.ttf",
        "font_size": 68,
        "colors_json": {
            "primary": "&H00FFFFFF",  # White
            "outline": "&H00202020",  # Dark grey
            "highlight": "&H0000FFFF",
            "back": "&H90000000",
        },
        "animation_type": AnimationType.LINE,
        "uppercase": False,
        "is_preset": True,
    },
    {
        "name": "Neon",
        "font_name": "Luckiest Guy",
        "font_file": "backend/assets/fonts/LuckiestGuy-Regular.ttf",
        "font_size": 78,
        "colors_json": {
            "primary": "&H00FFFF00",  # Cyan in BGR
            "outline": "&H00FF00FF",  # Magenta in BGR
            "highlight": "&H0000FFFF",  # Yellow
            "back": "&H80000000",
        },
        "animation_type": AnimationType.WORD_POP,
        "uppercase": True,
        "is_preset": True,
    },
]


def seed_preset_styles(db: Session) -> list[CaptionStyle]:
    """Ensures built-in preset styles exist in the database."""
    created = []
    for spec in PRESET_STYLES:
        existing = db.query(CaptionStyle).filter(CaptionStyle.name == spec["name"], CaptionStyle.is_preset.is_(True)).first()
        if not existing:
            style = CaptionStyle(
                user_id=None,
                name=spec["name"],
                font_file=spec["font_file"],
                font_name=spec["font_name"],
                font_size=spec["font_size"],
                colors_json=spec["colors_json"],
                animation_type=spec["animation_type"],
                uppercase=spec["uppercase"],
                is_preset=True,
            )
            db.add(style)
            created.append(style)
    if created:
        db.commit()
    return db.query(CaptionStyle).filter(CaptionStyle.is_preset.is_(True)).all()

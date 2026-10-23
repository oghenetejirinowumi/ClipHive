import re
from datetime import datetime

from pydantic import BaseModel, Field, field_validator

from app.models.enums import AnimationType
from app.schemas.common import ORMModel

# ASS colour literal: &HAABBGGRR or &HBBGGRR (note: BGR order, not RGB)
ASS_COLOUR = re.compile(r"^&H[0-9A-F]{6}([0-9A-F]{2})?$", re.IGNORECASE)


class CaptionColors(BaseModel):
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


class CaptionStyleBase(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    font_name: str = Field(min_length=1, max_length=100)
    font_size: int = Field(default=72, ge=8, le=300)
    colors_json: CaptionColors = Field(default_factory=CaptionColors)
    animation_type: AnimationType = AnimationType.WORD_POP
    uppercase: bool = False


# POST /styles  (font file, if any, is uploaded separately and sets font_file)
class CaptionStyleCreate(CaptionStyleBase):
    pass


class CaptionStyleUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=100)
    font_name: str | None = Field(default=None, min_length=1, max_length=100)
    font_size: int | None = Field(default=None, ge=8, le=300)
    colors_json: CaptionColors | None = None
    animation_type: AnimationType | None = None
    uppercase: bool | None = None


class CaptionStyleRead(ORMModel, CaptionStyleBase):
    id: int
    user_id: int | None
    font_file: str | None
    is_preset: bool
    created_at: datetime

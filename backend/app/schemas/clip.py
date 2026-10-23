from datetime import datetime

from pydantic import BaseModel, Field, model_validator

from app.models.enums import CaptionMode, ClipStatus
from app.schemas.common import ORMModel


class TranscriptWord(BaseModel):
    """One word from faster-whisper (word_timestamps=True) or WhisperX alignment."""

    word: str
    start: float = Field(ge=0)
    end: float = Field(ge=0)
    confidence: float = 0.9



# Written by ingestion (C) when a raw clip has been cut.
class ClipCreate(BaseModel):
    stream_id: int | None = None
    start_s: float = Field(ge=0)
    end_s: float = Field(gt=0)
    raw_file_path: str
    highlight_score: float | None = None
    title: str | None = Field(default=None, max_length=255)
    hashtags: list[str] = Field(default_factory=list)

    @model_validator(mode="after")
    def check_range(self) -> "ClipCreate":
        if self.end_s <= self.start_s:
            raise ValueError("end_s must be greater than start_s")
        return self


class ClipUpdate(BaseModel):
    title: str | None = Field(default=None, max_length=255)
    hashtags: list[str] | None = None
    caption_style_id: int | None = None
    caption_mode: CaptionMode | None = None
    context_json: dict | None = None


# POST /clips/{id}/caption and POST /clips/{id}/regenerate-captions
class CaptionRequest(BaseModel):
    style_id: int
    caption_mode: CaptionMode = CaptionMode.BURNED


class ClipRead(ORMModel):
    id: int
    stream_id: int | None
    user_id: int
    start_s: float
    end_s: float
    duration_s: float
    file_path: str | None
    caption_style_id: int | None
    caption_mode: CaptionMode
    highlight_score: float | None
    title: str | None
    hashtags: list[str]
    context_json: dict | None = None
    status: ClipStatus
    error: str | None
    created_at: datetime


class ClipDetail(ClipRead):
    raw_file_path: str | None
    transcript_json: list[TranscriptWord] | None

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field, model_validator

from app.models.enums import ImportSource, ImportStatus
from app.schemas.common import ORMModel


# POST /api/imports/link  (uploads send the same two numbers as form fields)
class ImportLinkRequest(BaseModel):
    url: str = Field(min_length=8, max_length=2048)
    clip_count: int = Field(default=5, ge=1, le=30)
    clip_seconds: int = Field(default=30, ge=10, le=90)
    layout: Literal["fill", "blur"] = "fill"


class ImportRead(ORMModel):
    id: int
    source: ImportSource
    url: str | None
    original_filename: str | None
    title: str | None
    duration_s: float | None
    thumbnail_path: str | None
    clip_count: int
    clip_seconds: int
    clip_ids: list[int]
    layout: str = "fill"
    status: ImportStatus
    progress: int
    detail: str | None = None
    error: str | None
    created_at: datetime
    finished_at: datetime | None


# POST /api/imports/{id}/more
class MoreClipsRequest(BaseModel):
    count: int = Field(default=5, ge=1, le=10)
    clip_seconds: int | None = Field(default=None, ge=10, le=90)  # None keeps the project's length


# POST /api/downloads/instagram
class InstagramDownloadRequest(BaseModel):
    url: str = Field(min_length=8, max_length=2048)


class DownloadRead(BaseModel):
    id: str
    title: str
    uploader: str | None
    duration_s: float | None
    size_bytes: int
    preview_path: str  # public "storage/..." path for <video src>
    download_url: str  # API path that forces a file download


Layout = Literal["fill", "blur"]


# POST /api/studio/imports/{id}/clips
class StudioClipRequest(BaseModel):
    start_s: float = Field(ge=0)
    end_s: float = Field(gt=0)
    layout: Layout = "fill"

    @model_validator(mode="after")
    def check_range(self) -> "StudioClipRequest":
        length = self.end_s - self.start_s
        if length < 3 or length > 180:
            raise ValueError("A clip must be between 3 seconds and 3 minutes long")
        return self


# POST /api/studio/clips/{id}/layout
class LayoutRequest(BaseModel):
    layout: Layout


class StudioClip(BaseModel):
    id: int
    title: str | None
    start_s: float
    end_s: float
    status: str
    file_path: str | None  # what plays / downloads now (captioned or clean)
    clean_path: str | None  # the uncaptioned cut
    captioned: bool
    caption_style_id: int | None
    layout: str
    highlight_score: float | None
    starred: bool = False
    error: str | None = None  # e.g. why burning captions failed (the clean cut is still ready)


# POST /api/studio/clips/{id}/star
class StarRequest(BaseModel):
    starred: bool


class StarResult(BaseModel):
    id: int
    starred: bool
    starred_total: int  # how many clips this user has starred: the taste's evidence


class Moment(BaseModel):
    start_s: float
    end_s: float
    score: float
    reason: str | None = None  # set when an AI model ranked it


class PreviewState(BaseModel):
    status: str  # "none" | "fetching" | "ready" | "failed"
    progress: int = 0
    error: str | None = None


class StudioProject(BaseModel):
    job: ImportRead
    # Video to scrub: the upload itself, or a link's low-res preview once fetched (else None).
    source_path: str | None
    preview: PreviewState
    energy: list[float]  # 0-1 loudness, evenly spaced over the duration
    moments: list[Moment]  # auto-detected highlights
    clips: list[StudioClip]

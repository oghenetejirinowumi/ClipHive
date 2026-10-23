from datetime import datetime

from pydantic import BaseModel, Field

from app.models.enums import ImportSource, ImportStatus
from app.schemas.common import ORMModel


# POST /api/imports/link  (uploads send the same two numbers as form fields)
class ImportLinkRequest(BaseModel):
    url: str = Field(min_length=8, max_length=2048)
    clip_count: int = Field(default=5, ge=1, le=10)
    clip_seconds: int = Field(default=30, ge=10, le=90)


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
    status: ImportStatus
    progress: int
    error: str | None
    created_at: datetime
    finished_at: datetime | None


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

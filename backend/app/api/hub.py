"""API endpoints for the Distribution Hub."""
from __future__ import annotations

import logging
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session, selectinload

from app.api.deps import Owner
from app.core.media import local_media, storage_root
from app.db import get_db
from app.models.clip import Clip
from app.models.enums import ClipStatus
from app.schemas.post import HubClip

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/hub", tags=["hub"])


def _resolve_clip_file(file_str: str | None) -> Path | None:
    """Finds the actual video file on disk for a stored clip or raw file path."""
    if not file_str:
        return None

    path = Path(file_str)
    if path.is_file():
        return path.resolve()

    clean = file_str.replace("\\", "/").lstrip("/")

    if clean.startswith("storage/"):
        rel_to_storage = clean[len("storage/"):]
        candidates = [
            storage_root() / rel_to_storage,
            Path("storage") / rel_to_storage,
            Path("backend/storage") / rel_to_storage,
        ]
        for candidate in candidates:
            if candidate.is_file():
                return candidate.resolve()

    candidates = [
        Path(clean),
        Path("backend") / clean,
        storage_root() / clean,
        storage_root() / "clips" / Path(clean).name,
    ]
    for candidate in candidates:
        if candidate.is_file():
            return candidate.resolve()

    return None


@router.get("/clips", response_model=list[HubClip])
@router.get("/clips/", response_model=list[HubClip], include_in_schema=False)
def list_ready_clips(
    user: Owner,
    db: Session = Depends(get_db),
) -> list[HubClip]:
    """Returns ready clips for the signed-in user, newest first, including posts history."""
    clips = (
        db.query(Clip)
        .options(selectinload(Clip.posts))
        .filter(Clip.user_id == user.id, Clip.status == ClipStatus.READY)
        .order_by(Clip.created_at.desc(), Clip.id.desc())
        .all()
    )

    results: list[HubClip] = []
    for clip in clips:
        item = HubClip.model_validate(clip)
        item.download_url = f"/api/hub/clips/{clip.id}/download"
        results.append(item)
    return results


@router.get("/clips/{clip_id}/download")
@router.get("/clips/{clip_id}/download/", include_in_schema=False)
def download_clip(
    clip_id: int,
    user: Owner,
    db: Session = Depends(get_db),
) -> FileResponse:
    """Returns the clip's video file as an attachment download.
    
    Falls back from file_path to raw_file_path if needed.
    Returns 404 if the clip does not belong to the user or the file is missing on disk.
    """
    clip = db.query(Clip).filter(Clip.id == clip_id).first()
    if clip is None or clip.user_id != user.id:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Clip not found",
        )

    file_to_serve = _resolve_clip_file(clip.file_path) or _resolve_clip_file(clip.raw_file_path)
    if file_to_serve is None:  # not on this instance's disk: fetch it from S3
        for stored in (clip.file_path, clip.raw_file_path):
            if stored and (fetched := local_media(stored)).is_file():
                file_to_serve = fetched
                break
    if file_to_serve is None or not file_to_serve.is_file():
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Clip video file not found",
        )

    return FileResponse(
        path=file_to_serve,
        media_type="video/mp4",
        filename=f"clip_{clip.id}.mp4",
        content_disposition_type="attachment",
    )

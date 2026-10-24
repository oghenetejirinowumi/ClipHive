"""Paste a link (Twitch / Kick / YouTube) or upload a video → several 9:16 clips."""
from __future__ import annotations

from fastapi import APIRouter, File, Form, HTTPException, UploadFile, status
from sqlalchemy import select

from app.api.deps import DbSession, Owner
from app.models import ImportJob, ImportSource
from app.schemas.import_job import ImportLinkRequest, ImportRead
from app.services.ingest import pipeline
from app.services.ingest.downloader import IngestError
from app.services.ingest.sources import detect_source, is_instagram, normalise

router = APIRouter(prefix="/imports", tags=["imports"])

VIDEO_TYPES = {"video/mp4", "video/quicktime", "video/webm", "video/x-matroska", "video/x-m4v"}
VIDEO_EXTS = {".mp4", ".mov", ".webm", ".mkv", ".m4v"}


@router.post("/link", response_model=ImportRead, status_code=status.HTTP_202_ACCEPTED)
def import_link(body: ImportLinkRequest, user: Owner, db: DbSession) -> ImportJob:
    url = normalise(body.url)
    source = detect_source(url)
    if source is None:
        hint = " Use the Instagram downloader for Instagram posts." if is_instagram(url) else ""
        raise HTTPException(422, f"Paste a Twitch, Kick or YouTube video link.{hint}")
    job = ImportJob(
        user_id=user.id, source=source, url=url, clip_count=body.clip_count, clip_seconds=body.clip_seconds, layout=body.layout
    )
    db.add(job)
    db.commit()
    db.refresh(job)
    pipeline.submit(job.id)
    return job


@router.post("/upload", response_model=ImportRead, status_code=status.HTTP_202_ACCEPTED)
def import_upload(
    user: Owner,
    db: DbSession,
    file: UploadFile = File(...),
    clip_count: int = Form(5, ge=1, le=30),
    clip_seconds: int = Form(30, ge=10, le=90),
    layout: str = Form("fill", pattern="^(fill|blur)$"),
) -> ImportJob:
    name = file.filename or "video.mp4"
    ext = "." + name.rsplit(".", 1)[-1].lower() if "." in name else ""
    if (file.content_type or "") not in VIDEO_TYPES and ext not in VIDEO_EXTS:
        raise HTTPException(status.HTTP_415_UNSUPPORTED_MEDIA_TYPE, "Upload an MP4, MOV or WEBM video.")

    job = ImportJob(
        user_id=user.id, source=ImportSource.UPLOAD, original_filename=name[:255],
        title=name.rsplit(".", 1)[0][:200], clip_count=clip_count, clip_seconds=clip_seconds, layout=layout,
    )
    db.add(job)
    db.commit()
    db.refresh(job)
    try:
        pipeline.save_upload(job.id, file.file, name)
    except IngestError as err:
        db.delete(job)
        db.commit()
        raise HTTPException(status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, str(err)) from err
    pipeline.submit(job.id)
    return job


@router.get("", response_model=list[ImportRead])
def list_imports(user: Owner, db: DbSession) -> list[ImportJob]:
    return list(db.scalars(select(ImportJob).where(ImportJob.user_id == user.id).order_by(ImportJob.id.desc()).limit(50)))


@router.get("/{job_id}", response_model=ImportRead)
def get_import(job_id: int, user: Owner, db: DbSession) -> ImportJob:
    job = db.get(ImportJob, job_id)
    if job is None or job.user_id != user.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Import not found.")
    return job

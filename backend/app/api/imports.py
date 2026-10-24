"""Paste a link (Twitch / Kick / YouTube) or upload a video → several 9:16 clips."""
from __future__ import annotations

from pathlib import Path

from fastapi import APIRouter, File, Form, HTTPException, Query, Response, UploadFile, status
from sqlalchemy import select

from app.api.deps import DbSession, Owner
from app.core.media import from_public, storage_root
from app.models import Clip, ImportJob, ImportSource, ImportStatus
from app.schemas.import_job import ImportLinkRequest, ImportRead, MoreClipsRequest
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


@router.post("/{job_id}/retry", response_model=ImportRead, status_code=status.HTTP_202_ACCEPTED)
def retry_import(job_id: int, user: Owner, db: DbSession) -> ImportJob:
    """Re-run a failed project in place. Whatever its last attempt finished (audio, sections,
    clips) is reused, so a retry continues rather than starting over."""
    job = db.get(ImportJob, job_id)
    if job is None or job.user_id != user.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Import not found.")
    if job.status != ImportStatus.FAILED:
        raise HTTPException(status.HTTP_409_CONFLICT, "Only a failed project can be retried.")
    job.status, job.error, job.detail = ImportStatus.QUEUED, None, "Retrying"
    db.commit()
    db.refresh(job)
    pipeline.submit(job.id)
    return job


@router.post("/{job_id}/more", response_model=ImportRead, status_code=status.HTTP_202_ACCEPTED)
def more_clips(job_id: int, body: MoreClipsRequest, user: Owner, db: DbSession) -> ImportJob:
    """Cut `count` more clips from a finished project. Moments its existing clips cover are
    excluded, so every new clip is different, and picks lean toward clips the user starred."""
    job = db.get(ImportJob, job_id)
    if job is None or job.user_id != user.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Import not found.")
    if job.status != ImportStatus.DONE:
        raise HTTPException(status.HTTP_409_CONFLICT, "This project is still processing.")
    if pipeline.analysis_media(job) is None:
        raise HTTPException(status.HTTP_410_GONE, "This project's audio is no longer on disk, so it can't find new moments.")
    existing = db.query(Clip).filter(Clip.id.in_(job.clip_ids or [])).count()
    job.clip_count = existing + body.count
    if body.clip_seconds:
        job.clip_seconds = body.clip_seconds
    job.status, job.error, job.progress, job.detail = ImportStatus.QUEUED, None, 37, f"Finding {body.count} new moments"
    db.commit()
    db.refresh(job)
    pipeline.submit(job.id)
    return job


@router.delete("/{job_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_import(job_id: int, user: Owner, db: DbSession, clips: bool = Query(False, description="Also delete the clips cut from it")) -> Response:
    """Delete a project (cancelling it first if it's still running). Its clips stay in the Hub
    unless clips=true."""
    job = db.get(ImportJob, job_id)
    if job is None or job.user_id != user.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Import not found.")
    pipeline.cancel(job_id)

    clip_files: list[Path] = []
    if clips:
        root = storage_root() / "clips"
        for clip in db.query(Clip).filter(Clip.id.in_(job.clip_ids or []), Clip.user_id == user.id):
            for p in {clip.raw_file_path, clip.file_path}:
                if p:
                    path = from_public(p)
                    if path.resolve().is_relative_to(root):  # never touch files outside storage/clips
                        clip_files.append(path)
            db.delete(clip)
    db.delete(job)
    db.commit()
    pipeline.remove_files(job_id, clip_files)
    return Response(status_code=status.HTTP_204_NO_CONTENT)

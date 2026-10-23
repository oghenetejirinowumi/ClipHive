"""Import jobs: one link or upload → several vertical clips.

Runs on a small worker pool (settings.import_workers), never inside the request. This is the
VOD-first design: nothing is recorded continuously; a file is fetched once, analysed offline,
and only the chosen moments are cut. Each clip is written as a `clips` row with
status='processing' (the C1 → C2 handoff in docs/CONTRACT.md); its raw cut is also set as
file_path so the Hub can preview it before captions are burned.
"""
from __future__ import annotations

import logging
import shutil
from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime
from pathlib import Path

from app.config import settings
from app.core.media import MediaError, probe, public_path, storage_root, thumbnail
from app.db import SessionLocal
from app.models import Clip, ClipStatus, ImportJob, ImportSource, ImportStatus
from app.services.clip.cutter import cut_vertical
from app.services.clip.detector import find_highlights
from app.services.ingest.downloader import IngestError, download

logger = logging.getLogger("cliphive.imports")

_executor = ThreadPoolExecutor(max_workers=settings.import_workers, thread_name_prefix="import")


def job_dir(job_id: int) -> Path:
    return storage_root() / "imports" / str(job_id)


def submit(job_id: int) -> None:
    _executor.submit(_run_safely, job_id)


def recover_interrupted() -> None:
    """Jobs that were mid-flight when the server stopped can't resume; mark them failed."""
    with SessionLocal() as db:
        stuck = db.query(ImportJob).filter(ImportJob.status.notin_([ImportStatus.DONE, ImportStatus.FAILED])).all()
        for job in stuck:
            job.status, job.error = ImportStatus.FAILED, "Interrupted by a server restart. Please try again."
        if stuck:
            db.commit()


def _update(job_id: int, **fields) -> None:
    with SessionLocal() as db:
        job = db.get(ImportJob, job_id)
        if job:
            for key, value in fields.items():
                setattr(job, key, value)
            db.commit()


def _run_safely(job_id: int) -> None:
    try:
        _run(job_id)
    except (IngestError, MediaError) as err:
        _update(job_id, status=ImportStatus.FAILED, error=str(err), finished_at=datetime.now(UTC))
    except Exception:  # never let a worker die silently
        logger.exception("Import %s crashed", job_id)
        _update(job_id, status=ImportStatus.FAILED, error="Something went wrong while processing this video.", finished_at=datetime.now(UTC))


def _run(job_id: int) -> None:
    with SessionLocal() as db:
        job = db.get(ImportJob, job_id)
        if not job:
            return
        source, url, user_id = job.source, job.url, job.user_id
        count, seconds, title = job.clip_count, job.clip_seconds, job.title

    work = job_dir(job_id)
    max_seconds = settings.max_import_minutes * 60

    # 1. Get the video file
    if source == ImportSource.UPLOAD:
        src = next(iter(sorted(work.glob("source.*"))), None)
        if not src:
            raise IngestError("The uploaded file is missing.")
    else:
        _update(job_id, status=ImportStatus.DOWNLOADING, progress=2)
        src, info = download(
            url,
            work,
            max_seconds=max_seconds,
            on_progress=lambda f: _update(job_id, progress=2 + int(f * 48)),
        )
        title = (info.get("title") or title or "Imported video")[:200]

    duration, has_video = probe(src)
    if not has_video:
        raise MediaError("That file has no video track.")
    duration = min(duration, max_seconds)

    thumb = work / "thumb.jpg"
    try:
        thumbnail(src, thumb, at_s=duration * 0.1)
        thumb_public = public_path(thumb)
    except MediaError:
        thumb_public = None
    _update(job_id, status=ImportStatus.ANALYZING, progress=52, title=title, duration_s=duration, thumbnail_path=thumb_public)

    # 2. Score the moments
    moments = find_highlights(src, duration, count, seconds)

    # 3. Cut each one as a 9:16 clip and hand it to the caption pipeline
    _update(job_id, status=ImportStatus.CUTTING, progress=60)
    clips_dir = storage_root() / "clips"
    clip_ids: list[int] = []
    for n, moment in enumerate(moments, start=1):
        out = cut_vertical(src, moment.start_s, moment.end_s, clips_dir / f"import_{job_id}_{n}.mp4")
        with SessionLocal() as db:
            clip = Clip(
                user_id=user_id,
                start_s=moment.start_s,
                end_s=moment.end_s,
                raw_file_path=str(out),
                file_path=public_path(out),
                highlight_score=moment.score,
                title=f"{title} · Clip {n}",
                hashtags=[],
                status=ClipStatus.PROCESSING,
            )
            db.add(clip)
            db.commit()
            clip_ids.append(clip.id)
        _update(job_id, clip_ids=list(clip_ids), progress=60 + int(39 * n / len(moments)))

    _update(job_id, status=ImportStatus.DONE, progress=100, finished_at=datetime.now(UTC))
    logger.info("Import %s produced %d clips", job_id, len(clip_ids))


def save_upload(job_id: int, fileobj, filename: str) -> Path:
    """Stream an upload to disk, enforcing settings.max_upload_mb."""
    work = job_dir(job_id)
    work.mkdir(parents=True, exist_ok=True)
    suffix = Path(filename).suffix.lower() or ".mp4"
    dst = work / f"source{suffix}"
    limit = settings.max_upload_mb * 1024 * 1024
    written = 0
    with dst.open("wb") as out:
        while chunk := fileobj.read(1024 * 1024):
            written += len(chunk)
            if written > limit:
                out.close()
                shutil.rmtree(work, ignore_errors=True)
                raise IngestError(f"That file is over the {settings.max_upload_mb} MB limit.")
            out.write(chunk)
    return dst

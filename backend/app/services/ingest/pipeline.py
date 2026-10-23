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
from sqlalchemy import inspect, text

from app.db import SessionLocal, engine
from app.models import ImportJob, ImportSource, ImportStatus
from app.services.agents import events
from app.services.agents.producer import ProducerJob, run_producer
from app.services.ingest.downloader import IngestError, download

logger = logging.getLogger("cliphive.imports")

_executor = ThreadPoolExecutor(max_workers=settings.import_workers, thread_name_prefix="import")


def job_dir(job_id: int) -> Path:
    return storage_root() / "imports" / str(job_id)


def submit(job_id: int) -> None:
    _executor.submit(_run_safely, job_id)


# Columns added after import_jobs first shipped. create_all() never alters an existing table,
# so add any that are missing (SQLite and Postgres both accept this ALTER).
_ADDED_COLUMNS = {
    "layout": "VARCHAR(10) DEFAULT 'fill'",
    "clip_layouts": "JSON",
}


def ensure_columns() -> None:
    existing = {c["name"] for c in inspect(engine).get_columns("import_jobs")}
    with engine.begin() as conn:
        for name, ddl in _ADDED_COLUMNS.items():
            if name not in existing:
                conn.execute(text(f"ALTER TABLE import_jobs ADD COLUMN {name} {ddl}"))


def source_file(job_id: int) -> Path | None:
    """The full downloaded / uploaded video for a job, if it's still on disk."""
    return next((p for p in sorted(job_dir(job_id).glob("source.*")) if p.suffix != ".part"), None)


def recover_interrupted() -> None:
    """Jobs that were mid-flight when the server stopped can't resume; mark them failed."""
    ensure_columns()
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
        layout = job.layout or "fill"
        brief = dict(job.agent_brief or {})

    work = job_dir(job_id)
    max_seconds = settings.max_import_minutes * 60

    # 1. Get the video file
    info: dict = {}
    if source == ImportSource.UPLOAD:
        src = source_file(job_id)
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

    # 2-3. The Producer agent picks the moments, cuts each as 9:16 and packages it
    # (falls back to the fixed loudness pipeline without a model key). See services/agents.
    _update(job_id, progress=55)
    source_context_base = {
        "source": source.value if hasattr(source, "value") else str(source),
        "source_title": title,
        "creator": (info.get("uploader") or info.get("channel")) if info else None,
        "source_tags": (info.get("tags") or [])[:20] if info else [],
        "source_categories": (info.get("categories") or []) if info else [],
        "source_description": (info.get("description") or "")[:300] if info else None,
        "source_url": url,
        "import_job_id": job_id,
    }

    clip_ids: list[int] = []
    layouts: dict[str, str] = {}

    def on_clip(clip_id: int) -> None:
        clip_ids.append(clip_id)
        layouts[str(clip_id)] = layout
        _update(job_id, status=ImportStatus.CUTTING, clip_ids=list(clip_ids), clip_layouts=dict(layouts), progress=min(99, 60 + int(39 * len(clip_ids) / max(1, count))))

    run_producer(
        ProducerJob(
            job_id=job_id,
            user_id=user_id,
            src=src,
            duration=duration,
            count=count,
            clip_seconds=seconds,
            layout=layout,
            title=title or "Imported video",
            source_ctx=source_context_base,
            brief=brief,
            on_clip=on_clip,
        )
    )

    _update(job_id, status=ImportStatus.DONE, progress=100, finished_at=datetime.now(UTC))
    logger.info("Import %s produced %d clips", job_id, len(clip_ids))
    if clip_ids:
        n = len(clip_ids)
        events.notify(
            user_id,
            f"{n} clip{'s' if n != 1 else ''} ready for review",
            f'From "{title}". Approve them in your inbox.',
            "/inbox",
        )


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

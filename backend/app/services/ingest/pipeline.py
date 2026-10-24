"""Import jobs: one link or upload → several clips.

Runs on a small worker pool (settings.import_workers), never inside a request.

Links are bandwidth-first: we never pull the whole VOD. We take the audio of the first
`max_import_minutes` (tiny), find the moments in it, then fetch only those sections in HD and
cut them. The studio gets a low-res preview on demand. Uploads are already local, so they're
analysed and cut straight from the file.

Each clip is a normal `clips` row, ready to post as soon as it's cut (clean, for the
platform's own captions). Burning captions is an optional extra step (C2), and file_path points
at the captioned version once one exists. Asking a finished project for more clips re-runs it
with the clips it already has excluded, so every new clip is a moment it hasn't used yet.
"""
from __future__ import annotations

import json
import logging
import shutil
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime
from pathlib import Path

import requests
from sqlalchemy import inspect, text

from app.config import settings
from app.core.media import MediaError, probe, public_path, storage_root, thumbnail
from app.db import SessionLocal, engine
from app.models import CaptionMode, Clip, ClipStatus, ImportJob, ImportSource, ImportStatus
from app.services.clip.cutter import cut_vertical
from app.services.clip.taste import user_taste
from app.services.agents import events
from app.services.agents.producer import ProducerJob, run_producer
from app.services.ingest.downloader import Cancelled, IngestError, fetch_audio, fetch_preview, fetch_section, probe_url

logger = logging.getLogger("cliphive.imports")

_executor = ThreadPoolExecutor(max_workers=settings.import_workers, thread_name_prefix="import")
_cancels: dict[int, threading.Event] = {}
INFO_MAX_AGE_S = 3 * 3600  # platform media URLs expire; re-probe older info


# ---------------------------------------------------------------- paths & schema


def job_dir(job_id: int) -> Path:
    return storage_root() / "imports" / str(job_id)


def source_file(job_id: int) -> Path | None:
    """The full uploaded video for a job (uploads only; links never download the full VOD)."""
    return next((p for p in sorted(job_dir(job_id).glob("source.*")) if p.suffix not in (".part", ".ytdl")), None)


def audio_file(job_id: int) -> Path | None:
    return next((p for p in sorted(job_dir(job_id).glob("audio.*")) if p.suffix not in (".part", ".ytdl")), None)


def analysis_media(job: ImportJob) -> Path | None:
    """What to measure loudness on: the upload itself, or a link's downloaded audio."""
    return source_file(job.id) if job.source == ImportSource.UPLOAD else audio_file(job.id)


def section_file(job_id: int, clip_id: int) -> Path:
    return job_dir(job_id) / "sections" / f"clip_{clip_id}.mp4"


# Columns added after these tables first shipped. create_all() never alters an existing table,
# so add any that are missing (SQLite and Postgres both accept this ALTER).
_ADDED_COLUMNS = {
    "import_jobs": {
        "layout": "VARCHAR(10) DEFAULT 'fill'",
        "clip_layouts": "JSON",
        "detail": "VARCHAR(255)",
    },
    "clips": {
        "starred": "BOOLEAN DEFAULT 0 NOT NULL",
        "moment_features": "JSON",
        "description": "TEXT",
    },
}


def ensure_columns() -> None:
    with engine.begin() as conn:
        for table, columns in _ADDED_COLUMNS.items():
            existing = {c["name"] for c in inspect(conn).get_columns(table)}
            for name, ddl in columns.items():
                if name not in existing:
                    conn.execute(text(f"ALTER TABLE {table} ADD COLUMN {name} {ddl}"))


def repair_clip_states() -> None:
    """Clips used to wait in 'processing' until someone burned captions, and a failed burn
    marked a perfectly good cut as failed. A clip whose clean cut exists is ready to post."""
    with SessionLocal() as db:
        fixed = 0
        for clip in db.query(Clip).filter(Clip.status.in_([ClipStatus.PROCESSING, ClipStatus.FAILED])):
            if clip.raw_file_path and Path(clip.raw_file_path).exists():
                if clip.status == ClipStatus.PROCESSING:
                    clip.caption_mode = CaptionMode.PLATFORM_NATIVE
                elif not (clip.error or "").startswith("Captions failed"):
                    clip.error = "Captions failed: the video encoder ran out of memory, try again"
                clip.status = ClipStatus.READY
                fixed += 1
        if fixed:
            db.commit()
            logger.info("Marked %d finished clips ready", fixed)


def recover_interrupted() -> None:
    """Re-queue jobs that were mid-flight when the server stopped. _run picks up where they left
    off: downloaded audio, fetched sections and already-cut clips are reused, not redone."""
    ensure_columns()
    repair_clip_states()
    # A preview that was downloading died with the server; let the studio start it again.
    for state_file in (storage_root() / "imports").glob("*/preview.json"):
        try:
            if json.loads(state_file.read_text(encoding="utf-8")).get("status") == "fetching":
                state_file.unlink()
        except (OSError, ValueError):
            pass
    with SessionLocal() as db:
        stuck = db.query(ImportJob).filter(ImportJob.status.notin_([ImportStatus.DONE, ImportStatus.FAILED])).all()
        for job in stuck:
            job.status, job.error, job.detail = ImportStatus.QUEUED, None, "Resuming after a server restart"
        ids = [job.id for job in stuck]
        if stuck:
            db.commit()
    for job_id in ids:
        logger.info("Resuming import %s after restart", job_id)
        submit(job_id)


# ---------------------------------------------------------------- queue, cancel, delete


def submit(job_id: int) -> None:
    _cancels[job_id] = threading.Event()
    _executor.submit(_run_safely, job_id)


def cancel(job_id: int) -> None:
    """Stop a running job: its watcher kills the job's ffmpeg within ~2s."""
    event = _cancels.get(job_id)
    if event:
        event.set()


def remove_files(job_id: int, extra: list[Path] | None = None) -> None:
    """Delete a job's folder (and given clip files). Retries briefly: a just-killed ffmpeg
    can hold a file open on Windows for a moment."""

    def work() -> None:
        for _ in range(10):
            for path in extra or []:
                try:
                    path.unlink(missing_ok=True)
                except OSError:
                    pass
            shutil.rmtree(job_dir(job_id), ignore_errors=True)
            if not job_dir(job_id).exists():
                return
            time.sleep(1)

    threading.Thread(target=work, daemon=True).start()


def _check(job_id: int) -> None:
    """Abort between steps if the job was cancelled or deleted."""
    event = _cancels.get(job_id)
    if event is not None and event.is_set():
        raise Cancelled()
    with SessionLocal() as db:
        if db.get(ImportJob, job_id) is None:
            raise Cancelled()


def _update(job_id: int, **fields) -> None:
    with SessionLocal() as db:
        job = db.get(ImportJob, job_id)
        if job:
            for key, value in fields.items():
                setattr(job, key, value)
            db.commit()


def _fail(job_id: int, message: str) -> None:
    """A project that already has clips stays usable (done, with a note on why it stopped
    early); only a project with nothing to show is marked failed."""
    with SessionLocal() as db:
        job = db.get(ImportJob, job_id)
        if job is None:
            return
        kept = db.query(Clip).filter(Clip.id.in_(job.clip_ids or [])).count() if job.clip_ids else 0
        if kept:
            job.status, job.clip_count = ImportStatus.DONE, kept
            job.error = f"Stopped early, kept {kept} clip{'s' if kept != 1 else ''}: {message}"
        else:
            job.status, job.error = ImportStatus.FAILED, message
        job.progress = 100 if kept else job.progress
        job.detail, job.finished_at = None, datetime.now(UTC)
        db.commit()


def _run_safely(job_id: int) -> None:
    try:
        _run(job_id)
    except Cancelled:
        _fail(job_id, "Cancelled.")
    except (IngestError, MediaError) as err:
        _fail(job_id, str(err))
    except Exception:  # never let a worker die silently
        logger.exception("Import %s crashed", job_id)
        _fail(job_id, "Something went wrong while processing this video.")
    finally:
        _cancels.pop(job_id, None)


# ---------------------------------------------------------------- link metadata


def load_info(job: ImportJob) -> dict:
    """Probed yt-dlp info for a link job, cached on disk and refreshed when media URLs may have expired."""
    path = job_dir(job.id) / "info.json"
    if path.exists() and time.time() - path.stat().st_mtime < INFO_MAX_AGE_S:
        return json.loads(path.read_text(encoding="utf-8"))
    info = probe_url(job.url or "")
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(info, default=str), encoding="utf-8")
    return info


def _save_thumbnail(info: dict, dst: Path) -> str | None:
    url = info.get("thumbnail")
    if not url:
        return None
    try:
        resp = requests.get(url, timeout=20)
        resp.raise_for_status()
        dst.write_bytes(resp.content)
        return public_path(dst)
    except requests.RequestException:
        return None


# ---------------------------------------------------------------- the job


def _run(job_id: int) -> None:
    with SessionLocal() as db:
        job = db.get(ImportJob, job_id)
        if not job:
            return
        source, url, user_id = job.source, job.url, job.user_id
        brief = dict(job.agent_brief or {})
        count, seconds, title = job.clip_count, job.clip_seconds, job.title
        layout = job.layout or "fill"
        # Clips this project already has (an interrupted run, or an earlier batch when asking
        # for more) are kept, and their moments are off limits for the new ones.
        done_ids = list(job.clip_ids or [])
        done_layouts = dict(job.clip_layouts or {})
        existing = db.query(Clip).filter(Clip.id.in_(done_ids)).all() if done_ids else []
        used = [(c.start_s, c.end_s) for c in existing]
        done_ids = [cid for cid in done_ids if any(c.id == cid for c in existing)]  # drop clips deleted since
        taste = user_taste(db, user_id)
    cancel_event = _cancels.get(job_id)
    work = job_dir(job_id)
    work.mkdir(parents=True, exist_ok=True)
    max_seconds = settings.max_import_minutes * 60
    info: dict | None = None

    # 1. Media to analyse
    if source == ImportSource.UPLOAD:
        media = source_file(job_id)
        if not media:
            raise IngestError("The uploaded file is missing.")
        duration, has_video = probe(media)
        if not has_video:
            raise MediaError("That file has no video track.")
        duration = min(duration, max_seconds)
        thumb = work / "thumb.jpg"
        try:
            thumbnail(media, thumb, at_s=duration * 0.1)
            thumb_public = public_path(thumb)
        except MediaError:
            thumb_public = None
    else:
        _update(job_id, status=ImportStatus.DOWNLOADING, progress=1, detail="Reading video info")
        with SessionLocal() as db:
            info = load_info(db.get(ImportJob, job_id))
        title = (info.get("title") or title or "Imported video")[:200]
        duration = min(float(info.get("duration") or max_seconds), max_seconds)
        thumb_public = _save_thumbnail(info, work / "thumb.jpg")
        _update(job_id, title=title, duration_s=duration, thumbnail_path=thumb_public, progress=3, detail="Downloading audio")
        _check(job_id)

        def audio_progress(f: float) -> None:
            _update(job_id, progress=3 + int(f * 32), detail=f"Downloading audio {int(f * 100)}%")

        media = audio_file(job_id)  # already downloaded by an interrupted run?
        if media is None:
            media = fetch_audio(info, work, duration, on_progress=audio_progress, cancel=cancel_event)
        # Not every platform reports a duration (and estimates can be off): trust the file.
        measured, _ = probe(media)
        duration = min(measured, max_seconds) if measured > 0 else duration

    _check(job_id)
    _update(job_id, status=ImportStatus.ANALYZING, progress=37, title=title, duration_s=duration, thumbnail_path=thumb_public, detail="Finding the best moments")

    # 2-3. The Producer agent picks the moments, cuts each as 9:16 and packages it (it falls
    # back to the fixed loudness pipeline without a model key; see services/agents). It reads
    # the audio we downloaded; a link's cuts fetch just their range in HD.
    _update(job_id, progress=40, detail="Agent is reviewing the moments")
    source_ctx = {
        "source": source.value if hasattr(source, "value") else str(source),
        "source_title": title,
        "creator": (info.get("uploader") or info.get("channel")) if info else None,
        "source_tags": (info.get("tags") or [])[:20] if info else [],
        "source_categories": (info.get("categories") or []) if info else [],
        "source_description": (info.get("description") or "")[:300] if info else None,
        "source_url": url,
        "import_job_id": job_id,
    }
    clip_ids: list[int] = done_ids
    layouts: dict[str, str] = done_layouts
    wanted = max(0, count - len(done_ids))
    last_section: list[Path] = []  # the section the latest cut used, moved next to its clip

    def cut(start_s: float, end_s: float, out: Path) -> None:
        _check(job_id)
        if info is None:  # uploads: cut straight from the file
            cut_vertical(media, start_s, end_s, out, layout)
            return
        stem = _section_stem(start_s, end_s)
        section = work / "sections" / f"{stem}.mp4"  # fetched by an interrupted run?
        if not section.exists():
            _update(job_id, status=ImportStatus.CUTTING, detail=f"Fetching clip {len(clip_ids) + 1} in HD")
            section = fetch_section(info, work / "sections", stem, start_s, end_s, cancel=cancel_event)
        _update(job_id, detail=f"Cutting clip {len(clip_ids) + 1}")
        cut_vertical(section, 0, end_s - start_s, out, layout)
        last_section[:] = [section]

    def on_clip(clip_id: int) -> None:
        clip_ids.append(clip_id)
        layouts[str(clip_id)] = layout
        if last_section:  # keep the HD section so a layout switch needs no re-download
            last_section.pop().replace(section_file(job_id, clip_id))
        made = len(clip_ids) - len(done_ids)
        _update(job_id, status=ImportStatus.CUTTING, clip_ids=list(clip_ids), clip_layouts=dict(layouts),
                progress=min(99, 45 + int(54 * made / max(1, wanted))))

    if wanted:
        run_producer(ProducerJob(
            job_id=job_id, user_id=user_id, src=media, duration=duration, count=wanted, clip_seconds=seconds,
            layout=layout, title=title or "Imported video", source_ctx=source_ctx, brief=brief, on_clip=on_clip,
            cut=cut, exclude=used, taste=taste, first_number=len(done_ids) + 1,
        ))

    # Fewer clips than asked means the video has run out of fresh moments: record what it has.
    made = len(clip_ids) - len(done_ids)
    _update(job_id, status=ImportStatus.DONE, progress=100, detail=None, error=None, clip_count=len(clip_ids), finished_at=datetime.now(UTC))
    logger.info("Import %s has %d clips (%d new)", job_id, len(clip_ids), made)
    if made:
        events.notify(user_id, f"{made} clip{'s' if made != 1 else ''} ready for review", f'From "{title}". Approve them in your inbox.', "/inbox")
    if info is not None:  # warm the studio's scrubbing preview so it's ready when they open it
        start_preview(job_id)


def _section_stem(start_s: float, end_s: float) -> str:
    """Named by time range so a resumed run finds a section it already fetched."""
    return f"moment_{int(start_s * 10)}_{int(end_s * 10)}"


# ---------------------------------------------------------------- studio support


def _preview_state_path(job_id: int) -> Path:
    return job_dir(job_id) / "preview.json"


def preview_state(job_id: int) -> dict:
    path = _preview_state_path(job_id)
    if path.exists():
        return json.loads(path.read_text(encoding="utf-8"))
    return {"status": "none", "progress": 0, "error": None}


def preview_file(job_id: int) -> Path | None:
    return next((p for p in sorted(job_dir(job_id).glob("preview.*")) if p.suffix in (".mp4", ".webm", ".mkv")), None)


def _write_preview_state(job_id: int, **state) -> None:
    _preview_state_path(job_id).write_text(json.dumps({**preview_state(job_id), **state}), encoding="utf-8")


def start_preview(job_id: int) -> dict:
    """Fetch a low-res scrubbing copy of a link job in the background (idempotent)."""
    state = preview_state(job_id)
    if state["status"] == "fetching" or (state["status"] == "ready" and preview_file(job_id)):
        return state
    _write_preview_state(job_id, status="fetching", progress=0, error=None)

    def work() -> None:
        try:
            with SessionLocal() as db:
                job = db.get(ImportJob, job_id)
                info = load_info(job)
                seconds = job.duration_s or settings.max_import_minutes * 60
            fetch_preview(info, job_dir(job_id), seconds, on_progress=lambda f: _write_preview_state(job_id, progress=int(f * 100)))
            _write_preview_state(job_id, status="ready", progress=100)
        except Exception as err:  # noqa: BLE001 - surfaced to the studio as text
            logger.warning("Preview for %s failed: %s", job_id, err)
            _write_preview_state(job_id, status="failed", error=str(err) if isinstance(err, IngestError) else "Couldn't fetch a preview.")

    threading.Thread(target=work, name=f"preview-{job_id}", daemon=True).start()  # keeps import workers free
    return preview_state(job_id)


def cut_range_for_link(job: ImportJob, start_s: float, end_s: float, out: Path, layout: str, stem: str) -> Path:
    """Studio cut on a link job: fetch just [start, end] in HD, then cut it. Returns the section file."""
    info = load_info(job)
    section = fetch_section(info, job_dir(job.id) / "sections", stem, start_s, end_s)
    cut_vertical(section, 0, end_s - start_s, out, layout)
    return section


# ---------------------------------------------------------------- uploads


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

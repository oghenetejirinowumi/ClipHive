"""Clipping Studio: scrub a project's video, pick any range, and cut it as a clip.

Uploads scrub the uploaded file itself. Link projects never download the full VOD: the studio
scrubs a low-res preview (fetched on request), and creating a clip fetches only that range in
HD. Any imported clip can also switch layout (re-cut from its saved HD section or the upload)
or drop its burned captions (back to the clean cut). Burning captions stays with C2: the
frontend calls POST /api/clips/{id}/caption.
"""
from __future__ import annotations

import json
import time
from pathlib import Path

from fastapi import APIRouter, HTTPException, status

from app.api.deps import DbSession, Owner
from app.core.media import media_path, public_path, remove_media, storage_root
from app.models import CaptionMode, Clip, ClipStatus, ImportJob, ImportSource, ImportStatus
from app.schemas.import_job import (
    ClipEditRequest, ImportRead, LayoutRequest, Moment, PreviewState, StarRequest, StarResult, StudioClip, StudioClipRequest, StudioProject,
)
from app.services.clip.cutter import cut_vertical
from app.services.clip.ai_rank import pick_highlights
from app.services.clip.detector import energy_curve
from app.services.clip.taste import starred_count, user_taste
from app.services.ingest import pipeline
from app.services.ingest.downloader import IngestError

router = APIRouter(prefix="/studio", tags=["studio"])


def _job_for(db: DbSession, job_id: int, user_id: int) -> ImportJob:
    job = db.get(ImportJob, job_id)
    if job is None or job.user_id != user_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Project not found.")
    # A project generating more clips stays open: its existing clips are usable meanwhile.
    if job.status != ImportStatus.DONE and not job.clip_ids:
        raise HTTPException(status.HTTP_409_CONFLICT, "This project is still processing.")
    return job


def _public_or_none(path: str | None) -> str | None:
    if not path:
        return None
    if path.startswith("storage/"):
        return path
    try:
        return public_path(Path(path))
    except ValueError:  # outside storage (e.g. a teammate's fixture)
        return None


def _studio_clip(clip: Clip, job: ImportJob) -> StudioClip:
    clean = _public_or_none(clip.raw_file_path)
    current = _public_or_none(clip.file_path) or clean
    ctx = clip.context_json or {}
    return StudioClip(
        id=clip.id,
        title=clip.title,
        start_s=clip.start_s,
        end_s=clip.end_s,
        status=str(clip.status),
        file_path=current,
        clean_path=clean,
        captioned=bool(current and clean and current != clean),
        caption_style_id=clip.caption_style_id,
        layout=(job.clip_layouts or {}).get(str(clip.id), job.layout or "fill"),
        speed=float(ctx.get("speed", 1.0)),
        volume=float(ctx.get("volume", 1.0)),
        color_filter=str(ctx.get("color_filter", "none")),
        caption_position_y=ctx.get("caption_position_y"),
        highlight_score=clip.highlight_score,
        starred=bool(clip.starred),
        error=clip.error,
    )


def _owning_job(db: DbSession, clip_id: int, user_id: int) -> ImportJob | None:
    for job in db.query(ImportJob).filter(ImportJob.user_id == user_id).order_by(ImportJob.id.desc()):
        if clip_id in (job.clip_ids or []):
            return job
    return None


def _analysis(job: ImportJob, db: DbSession) -> dict:
    """Energy curve + suggested moments, cached in the job folder (decoding audio is the slow bit)."""
    cache = pipeline.job_dir(job.id) / "analysis.json"
    if cache.exists():
        return json.loads(cache.read_text(encoding="utf-8"))
    media = pipeline.analysis_media(job) or pipeline.source_file(job.id)
    if media is None:
        raise HTTPException(status.HTTP_410_GONE, "This project's audio is no longer on disk.")
    duration = job.duration_s or 0
    moments = pick_highlights(media, duration, count=8, clip_seconds=job.clip_seconds or 30, taste=user_taste(db, job.user_id))
    data = {
        "energy": energy_curve(media, duration),
        "moments": [
            {"start_s": m.start_s, "end_s": m.end_s, "score": m.score, "reason": m.reason} for m in moments
        ],
    }
    cache.write_text(json.dumps(data), encoding="utf-8")
    return data


def _scrub_video(job: ImportJob) -> tuple[str | None, PreviewState]:
    """The upload itself, or a link's preview (older link projects may still have a full source)."""
    full = pipeline.source_file(job.id)
    if full is not None:
        return public_path(full), PreviewState(status="ready", progress=100)
    preview = pipeline.preview_file(job.id)
    state = pipeline.preview_state(job.id)
    if preview is not None and state.get("status") == "ready":
        return public_path(preview), PreviewState(**state)
    return None, PreviewState(**state)


def _cut_from_local(
    job: ImportJob,
    clip: Clip | None,
    start_s: float,
    end_s: float,
    out: Path,
    layout: str,
    speed: float = 1.0,
    volume: float = 1.0,
    color_filter: str = "none",
) -> bool:
    """Cut from material already on disk: a saved HD section for this clip, or the full source."""
    if clip is not None:
        section = pipeline.section_file(job.id, clip.id)
        if section.exists():
            cut_vertical(
                section,
                0,
                end_s - start_s,
                out,
                layout,
                speed=speed,
                volume=volume,
                color_filter=color_filter,
            )
            return True
    full = pipeline.source_file(job.id)
    if full is not None:
        cut_vertical(
            full,
            start_s,
            end_s,
            out,
            layout,
            speed=speed,
            volume=volume,
            color_filter=color_filter,
        )
        return True
    return False


@router.get("/imports/{job_id}", response_model=StudioProject)
def open_project(job_id: int, user: Owner, db: DbSession) -> StudioProject:
    job = _job_for(db, job_id, user.id)
    analysis = _analysis(job, db)
    source_path, preview = _scrub_video(job)
    clips = [c for cid in (job.clip_ids or []) if (c := db.get(Clip, cid)) is not None]
    return StudioProject(
        job=ImportRead.model_validate(job),
        source_path=source_path,
        preview=preview,
        energy=analysis["energy"],
        moments=[Moment(**m) for m in analysis["moments"]],
        clips=[_studio_clip(c, job) for c in clips],
    )


@router.post("/imports/{job_id}/preview", response_model=PreviewState)
def prepare_preview(job_id: int, user: Owner, db: DbSession) -> PreviewState:
    """Start fetching a link project's low-res scrubbing preview (safe to call repeatedly)."""
    job = _job_for(db, job_id, user.id)
    if job.source == ImportSource.UPLOAD or pipeline.source_file(job.id) is not None:
        return PreviewState(status="ready", progress=100)
    return PreviewState(**pipeline.start_preview(job.id))


@router.post("/imports/{job_id}/clips", response_model=StudioClip, status_code=status.HTTP_201_CREATED)
def create_clip(job_id: int, body: StudioClipRequest, user: Owner, db: DbSession) -> StudioClip:
    """Cut a hand-picked range. Link projects fetch just that range in HD first (can take a minute)."""
    job = _job_for(db, job_id, user.id)
    end = min(body.end_s, job.duration_s or body.end_s)
    if end - body.start_s < 3:
        raise HTTPException(422, "Pick at least 3 seconds inside the video.")

    stamp = int(time.time() * 1000)
    out = storage_root() / "clips" / f"studio_{job.id}_{stamp}.mp4"
    section: Path | None = None
    if not _cut_from_local(
        job,
        None,
        body.start_s,
        end,
        out,
        body.layout,
        speed=body.speed,
        volume=body.volume,
        color_filter=body.color_filter,
    ):
        try:
            section = pipeline.cut_range_for_link(
                job,
                body.start_s,
                end,
                out,
                body.layout,
                f"studio_{stamp}",
                speed=body.speed,
                volume=body.volume,
                color_filter=body.color_filter,
            )
        except IngestError as err:
            raise HTTPException(status.HTTP_502_BAD_GATEWAY, str(err)) from err

    n = len(job.clip_ids or []) + 1
    ctx = {
        "speed": body.speed,
        "volume": body.volume,
        "color_filter": body.color_filter,
    }
    if body.caption_position_y is not None:
        ctx["caption_position_y"] = body.caption_position_y

    clip = Clip(
        user_id=user.id,
        start_s=body.start_s,
        end_s=end,
        raw_file_path=str(out),
        file_path=public_path(out),
        title=f"{job.title or 'Clip'} · Clip {n}",
        hashtags=[],
        status=ClipStatus.READY,
        caption_mode=CaptionMode.PLATFORM_NATIVE,
        context_json=ctx,
    )
    db.add(clip)
    db.flush()
    if section is not None:  # keep it so a layout switch needs no re-download
        section.replace(pipeline.section_file(job.id, clip.id))
    # Reassign (not mutate) so SQLAlchemy sees the JSON columns change.
    job.clip_ids = [*(job.clip_ids or []), clip.id]
    job.clip_layouts = {**(job.clip_layouts or {}), str(clip.id): body.layout}
    db.commit()
    db.refresh(clip)
    try:
        from app.services.ai.ai_pack import auto_run_ai_pack

        auto_run_ai_pack(clip, db)
    except Exception as err:
        logger.warning("Auto AI packaging skipped for studio clip %s: %s", clip.id, err)
    return _studio_clip(clip, job)


@router.post("/clips/{clip_id}/edit", response_model=StudioClip)
def edit_clip(clip_id: int, body: ClipEditRequest, user: Owner, db: DbSession) -> StudioClip:
    """Recut a clip with custom speed, volume, color filter, layout, trim range, and caption position."""
    clip = db.get(Clip, clip_id)
    job = _owning_job(db, clip_id, user.id) if clip else None
    if clip is None or job is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "This clip wasn't cut from one of your projects.")

    ctx = dict(clip.context_json or {})
    layout = body.layout or (job.clip_layouts or {}).get(str(clip.id), job.layout or "fill")
    speed = body.speed if body.speed is not None else float(ctx.get("speed", 1.0))
    volume = body.volume if body.volume is not None else float(ctx.get("volume", 1.0))
    color_filter = body.color_filter if body.color_filter is not None else str(ctx.get("color_filter", "none"))
    start_s = body.start_s if body.start_s is not None else clip.start_s
    end_s = body.end_s if body.end_s is not None else clip.end_s
    caption_pos = body.caption_position_y if body.caption_position_y is not None else ctx.get("caption_position_y")

    end = min(end_s, job.duration_s or end_s)
    if end - start_s < 3:
        raise HTTPException(422, "Pick at least 3 seconds inside the video.")

    stamp = int(time.time() * 1000)
    out = storage_root() / "clips" / f"studio_{job.id}_{clip.id}_{layout}_{stamp}.mp4"

    range_changed = abs(start_s - clip.start_s) > 0.05 or abs(end - clip.end_s) > 0.05
    re_cut_local = not range_changed and _cut_from_local(
        job, clip, start_s, end, out, layout, speed=speed, volume=volume, color_filter=color_filter
    )
    if not re_cut_local:
        if pipeline.source_file(job.id) is not None:
            _cut_from_local(
                job, None, start_s, end, out, layout, speed=speed, volume=volume, color_filter=color_filter
            )
        else:
            try:
                section = pipeline.cut_range_for_link(
                    job, start_s, end, out, layout, f"studio_{stamp}", speed=speed, volume=volume, color_filter=color_filter
                )
                section.replace(pipeline.section_file(job.id, clip.id))
            except IngestError as err:
                raise HTTPException(status.HTTP_502_BAD_GATEWAY, str(err)) from err

    old_raw = media_path(clip.raw_file_path) if clip.raw_file_path else None
    old_file = media_path(clip.file_path) if clip.file_path else None
    clip.raw_file_path, clip.file_path = str(out), public_path(out)
    clip.start_s, clip.end_s = start_s, end

    ctx["speed"] = speed
    ctx["volume"] = volume
    ctx["color_filter"] = color_filter
    if caption_pos is not None:
        ctx["caption_position_y"] = caption_pos
    clip.context_json = ctx

    # Reset transcription if timing changed so subtitles re-align to new speed/range
    if range_changed or abs(speed - float(clip.context_json.get("speed", 1.0))) > 0.01:
        clip.transcript_json = None

    job.clip_layouts = {**(job.clip_layouts or {}), str(clip.id): layout}
    db.commit()

    # Re-burn captions if active or requested
    target_style = body.style_id or clip.caption_style_id
    if (clip.caption_mode == CaptionMode.BURNED or body.style_id) and target_style:
        from app.api.clips import process_clip_captioning
        process_clip_captioning(clip.id, target_style, CaptionMode.BURNED, position_y=caption_pos)
        db.refresh(clip)
    else:
        clip.caption_mode = CaptionMode.PLATFORM_NATIVE
        clip.status = ClipStatus.READY
        db.commit()

    for old in (old_raw, old_file):  # also from S3; a local copy may already have been evicted
        if old and old.resolve() != out.resolve() and old.resolve().is_relative_to(storage_root() / "clips"):
            remove_media(old)

    db.refresh(clip)
    return _studio_clip(clip, job)


@router.post("/clips/{clip_id}/layout", response_model=StudioClip)
def change_layout(clip_id: int, body: LayoutRequest, user: Owner, db: DbSession) -> StudioClip:
    """Re-cut in the other layout. Burned captions are dropped (re-burn after)."""
    clip = db.get(Clip, clip_id)
    job = _owning_job(db, clip_id, user.id) if clip else None
    if clip is None or job is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "This clip wasn't cut from one of your projects.")
    stamp = int(time.time() * 1000)
    out = storage_root() / "clips" / f"studio_{job.id}_{clip.id}_{body.layout}_{stamp}.mp4"
    if not _cut_from_local(job, clip, clip.start_s, clip.end_s, out, body.layout):
        try:  # nothing on disk (older link clip): fetch its range again
            section = pipeline.cut_range_for_link(job, clip.start_s, clip.end_s, out, body.layout, f"studio_{stamp}")
            section.replace(pipeline.section_file(job.id, clip.id))
        except IngestError as err:
            raise HTTPException(status.HTTP_502_BAD_GATEWAY, str(err)) from err

    old = media_path(clip.raw_file_path) if clip.raw_file_path else None
    clip.raw_file_path, clip.file_path = str(out), public_path(out)
    # The new cut is clean and ready to post; burn captions again to add them.
    clip.caption_mode, clip.status, clip.error = CaptionMode.PLATFORM_NATIVE, ClipStatus.READY, None
    job.clip_layouts = {**(job.clip_layouts or {}), str(clip.id): body.layout}
    db.commit()
    if old and old.resolve().is_relative_to(storage_root() / "clips"):
        remove_media(old)
    return _studio_clip(clip, job)


@router.post("/clips/{clip_id}/remove-captions", response_model=StudioClip)
def remove_captions(clip_id: int, user: Owner, db: DbSession) -> StudioClip:
    """Serve the clean cut again, marked for platform-native captions, and ready to post."""
    clip = db.get(Clip, clip_id)
    job = _owning_job(db, clip_id, user.id) if clip else None
    if clip is None or job is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "This clip wasn't cut from one of your projects.")
    clean = _public_or_none(clip.raw_file_path)
    if clean is None:
        raise HTTPException(status.HTTP_410_GONE, "The clean version of this clip is missing.")
    clip.file_path = clean
    clip.caption_mode = CaptionMode.PLATFORM_NATIVE
    clip.status, clip.error = ClipStatus.READY, None
    db.commit()
    return _studio_clip(clip, job)


@router.post("/clips/{clip_id}/star", response_model=StarResult)
def star_clip(clip_id: int, body: StarRequest, user: Owner, db: DbSession) -> StarResult:
    """Star (or unstar) a clip. Stars teach the moment picker what this user likes."""
    clip = db.get(Clip, clip_id)
    if clip is None or clip.user_id != user.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Clip not found.")
    clip.starred = body.starred
    db.commit()
    return StarResult(id=clip.id, starred=clip.starred, starred_total=starred_count(db, user.id))


@router.get("/taste")
def taste_summary(user: Owner, db: DbSession) -> dict[str, int | bool]:
    """How much the picker has to go on: stars so far, and whether it's leaning on them yet."""
    return {"starred": starred_count(db, user.id), "learning": user_taste(db, user.id) is not None}


@router.get("/clips/{clip_id}/project")
def project_for_clip(clip_id: int, user: Owner, db: DbSession) -> dict[str, int]:
    """Which project a clip came from, so the Hub can open it in the studio."""
    job = _owning_job(db, clip_id, user.id)
    if job is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "This clip wasn't cut from one of your projects.")
    return {"job_id": job.id}

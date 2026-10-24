"""Video editor: projects, media, AI chat, HyperFrames preview and MP4 export."""
from __future__ import annotations

import logging
import threading
from datetime import UTC, datetime
from pathlib import Path
from typing import get_args

from fastapi import APIRouter, File, Form, HTTPException, Request, UploadFile, status
from sqlalchemy import select

from app.api.deps import DbSession, Owner
from app.config import settings
from app.core.media import MediaError, storage_root
from app.models import CaptionStyle, Clip, EditorProject, EditorVersion, ImportJob, User
from app.schemas.editor import (
    AddClipAsset, AutoEffectsRequest, AutoEmojiRequest, AutoSfxRequest, CaptionsRequest, ChatRequest, ChatResponse, MomentRequest,
    OpenRequest, Look, ProjectCreate, ProjectRead, ProjectSummary, ProjectUpdate, SfxRead, TextAnimation, Timeline, VersionRead,
)
from app.services.editor import assistant, effects, emojis, ops, render, sfx
from app.services.editor.compose import compose
from app.services.editor.media import UPLOAD_EXTS, probe_asset, project_dir, public_media_path
from app.services.ingest.pipeline import section_file, source_file

router = APIRouter(prefix="/editor", tags=["editor"])


def _owned(db: DbSession, project_id: int, user: User) -> EditorProject:
    project = db.get(EditorProject, project_id)
    if project is None or project.user_id != user.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Project not found.")
    return project


def _latest_version(db: DbSession, project_id: int) -> EditorVersion | None:
    return db.scalar(select(EditorVersion).where(EditorVersion.project_id == project_id).order_by(EditorVersion.number.desc()).limit(1))


def _snapshot(db: DbSession, project: EditorProject, label: str, *, only_if_changed: bool = False) -> int:
    """Save the project's current timeline as the next version. Returns its number.

    only_if_changed: reuse the latest version when the timeline is identical to it (so a turn
    that follows another turn doesn't add an empty "Your edits" version).
    """
    latest = _latest_version(db, project.id)
    if only_if_changed and latest and latest.timeline == project.timeline:
        return latest.number
    number = (latest.number if latest else 0) + 1
    db.add(EditorVersion(project_id=project.id, number=number, label=label[:200], timeline=project.timeline))
    db.flush()
    return number


def _read(db: DbSession, project: EditorProject) -> ProjectRead:
    latest = _latest_version(db, project.id)
    return ProjectRead.model_validate(project).model_copy(update={"version": latest.number if latest else 1})


def _save(db: DbSession, project: EditorProject, timeline: Timeline) -> None:
    known = set(project.media or [])
    new = [a.src for a in timeline.assets if a.src not in known]
    if new:
        project.media = [*(project.media or []), *new]
    project.timeline = timeline.model_dump(mode="json")
    project.revision += 1
    db.commit()
    db.refresh(project)


def _asset_from_storage(timeline: Timeline, public: str, name: str) -> tuple[Timeline, str]:
    """Add a file that's already in storage as an asset (reusing one with the same file)."""
    existing = next((a for a in timeline.assets if a.src == public), None)
    if existing:
        return timeline, existing.id
    asset_id = ops.new_id(timeline, "m")
    try:
        asset = probe_asset(storage_root() / public.removeprefix("storage/"), asset_id, name)
    except MediaError as err:
        raise HTTPException(422, str(err)) from err
    return Timeline.model_validate({**timeline.model_dump(), "assets": [*timeline.model_dump()["assets"], asset.model_dump()]}), asset_id


def _library_source(db: DbSession, user: User, clip_id: int | None, import_id: int | None) -> tuple[str, str]:
    """(public path, display name) for one of the user's clips or import sources."""
    if clip_id is not None:
        clip = db.get(Clip, clip_id)
        if clip is None or clip.user_id != user.id:
            raise HTTPException(404, "Clip not found.")
        # The clean cut: in the editor captions are editable text on top, never burned in.
        public = public_media_path(clip.raw_file_path) or public_media_path(clip.file_path)
        name = clip.title or f"Clip {clip.id}"
    elif import_id is not None:
        job = db.get(ImportJob, import_id)
        if job is None or job.user_id != user.id:
            raise HTTPException(404, "Import not found.")
        src = source_file(job.id)
        public = public_media_path(str(src)) if src else None
        name = job.title or job.original_filename or f"Import {job.id}"
    else:
        raise HTTPException(422, "Pick a clip or an import.")
    if not public:
        raise HTTPException(410, "That video is no longer on disk.")
    return public, name


def _place(timeline: Timeline, asset_id: str) -> Timeline:
    asset = timeline.asset(asset_id)
    if asset and asset.kind == "audio":
        return ops.add_audio(timeline, asset_id)[0]
    return ops.add_clip(timeline, asset_id)[0]


# --- projects -----------------------------------------------------------------------------

@router.get("/projects", response_model=list[ProjectSummary])
def list_projects(user: Owner, db: DbSession) -> list[ProjectSummary]:
    projects = db.scalars(select(EditorProject).where(EditorProject.user_id == user.id).order_by(EditorProject.id.desc()).limit(100))
    return [_summary(p) for p in projects]


def _summary(project: EditorProject) -> ProjectSummary:
    """The list card: shape, length, a cover frame and layer counts, read from the stored timeline."""
    tl = project.timeline if isinstance(project.timeline, dict) else {}
    assets = {a.get("id"): a for a in tl.get("assets") or [] if isinstance(a, dict)}
    clips = [c for c in tl.get("clips") or [] if isinstance(c, dict)]
    items = clips + [i for key in ("texts", "audio", "effects") for i in tl.get(key) or [] if isinstance(i, dict)]
    end = max((float(i.get("start") or 0) + float(i.get("duration") or 0) for i in items), default=0.0)
    placed = [assets.get(c.get("asset_id")) for c in sorted(clips, key=lambda c: float(c.get("start") or 0))]
    visual = [a for a in placed + list(assets.values()) if a and a.get("kind") in ("video", "image")]
    cover = visual[0] if visual else None
    return ProjectSummary(
        id=project.id,
        title=project.title,
        revision=project.revision,
        render_status=project.render_status,
        updated_at=project.updated_at,
        created_at=project.created_at,
        aspect=str(tl.get("aspect") or "9:16"),
        duration=round(end, 2),
        cover=cover.get("src") if cover else None,
        cover_kind=cover.get("kind") if cover else None,
        clips=len(clips),
        texts=len(tl.get("texts") or []),
        render_path=project.render_path if project.render_status == "done" else None,
    )


@router.post("/projects", response_model=ProjectRead, status_code=status.HTTP_201_CREATED)
def create_project(body: ProjectCreate, user: Owner, db: DbSession) -> ProjectRead:
    timeline = Timeline(aspect=body.aspect)
    if body.clip_id is not None or body.import_id is not None:
        public, name = _library_source(db, user, body.clip_id, body.import_id)
        timeline, asset_id = _asset_from_storage(timeline, public, name)
        timeline = _place(timeline, asset_id)
    project = EditorProject(user_id=user.id, title=body.title, timeline=timeline.model_dump(mode="json"), chat=[],
                            media=[a.src for a in timeline.assets])
    db.add(project)
    db.flush()
    _snapshot(db, project, "Start")
    db.commit()
    db.refresh(project)
    return _read(db, project)


def _job_of(db: DbSession, user: User, clip: Clip) -> ImportJob | None:
    return next((j for j in db.scalars(select(ImportJob).where(ImportJob.user_id == user.id).order_by(ImportJob.id.desc()))
                 if clip.id in (j.clip_ids or [])), None)


def _wide_source(job: ImportJob, clip: Clip) -> tuple[str, float] | None:
    """The clip's moment in its original (wide) framing: its saved HD section (t=0 is the clip's
    start) or the uploaded video. (public path, where the moment starts in it)"""
    section = section_file(job.id, clip.id)
    if section.is_file() and (public := public_media_path(str(section))):
        return public, 0.0
    src = source_file(job.id)
    if src is not None and (public := public_media_path(str(src))):
        return public, float(clip.start_s)
    return None


def _place_clip(db: DbSession, user: User, timeline: Timeline, clip: Clip, *, job: ImportJob | None = None,
                at: float | None = None) -> Timeline:
    """Put one of the user's clips on the main track.

    From its wide source when there is one, so Fill / Blur / Fit is a live setting (Properties >
    Layout) instead of baked into the file; it starts in the layout it was cut with, at the speed,
    volume and colour the Studio gave it. Otherwise its 9:16 cut, as it is."""
    job = job or _job_of(db, user, clip)
    wide = _wide_source(job, clip) if job else None
    if wide is None:
        public, name = _library_source(db, user, clip.id, None)
        timeline, asset_id = _asset_from_storage(timeline, public, name)
        return ops.add_clip(timeline, asset_id, start=at)[0]
    public, source_in = wide
    ctx = clip.context_json or {}
    speed = min(4.0, max(0.25, float(ctx.get("speed") or 1.0)))
    name = (job.title or job.original_filename or "Video") if source_in else (clip.title or f"Clip {clip.id}")
    timeline, asset_id = _asset_from_storage(timeline, public, name)
    timeline, _ = ops.add_clip(timeline, asset_id, start=at, source_in=source_in, duration=max(0.1, (clip.end_s - clip.start_s) / speed))
    layout = (job.clip_layouts or {}).get(str(clip.id), job.layout or "fill")
    volume = min(2.0, max(0.0, float(ctx["volume"]) if ctx.get("volume") is not None else 1.0))
    changes = {"fit": "blur" if layout == "blur" else "cover", "speed": speed, "volume": volume,
               "look": look if (look := str(ctx.get("color_filter", "none"))) in get_args(Look) else "none"}
    return ops.update_clip(timeline, timeline.clips[-1].id, **changes)[0]


def _caption_style(db: DbSession, clip: Clip) -> dict:
    """Editor text style matching the caption style the clip was burned with (or punch)."""
    style = db.get(CaptionStyle, clip.caption_style_id) if clip.caption_style_id else None
    if style is None:
        return {"preset": "punch"}
    from app.services.caption.ass_generator import StyleSpec

    o = StyleSpec.of(style).options
    animation = getattr(style.animation_type, "value", style.animation_type) or "pop"
    position_y = (clip.context_json or {}).get("caption_position_y") or o.position_y  # the burn used this
    return {
        "font": style.font_name, "size": max(16, min(400, int(style.font_size or 84))), "color": o.text_color.upper(),
        "stroke_color": o.outline_color.upper(), "stroke_width": int(min(30, o.outline_width)), "background": None,
        "uppercase": bool(style.uppercase), "y": round(min(92, max(8, float(position_y))) / 100, 3), "x": 0.5,
        "animation": animation if animation in get_args(TextAnimation) else "pop",
    }


def _clip_captions(db: DbSession, timeline: Timeline, clip: Clip) -> Timeline:
    """Editable captions for a clip just placed at 0 on an empty timeline, from its transcript.

    The clip's words are in clip time and the clip starts at 0, so they line up as they are."""
    words = [w for w in (clip.transcript_json or []) if str(w.get("word", "")).strip()]
    if not words:
        return timeline
    style = _caption_style(db, clip)
    try:
        timed = [{"word": str(w["word"]).strip(), "start": float(w["start"]), "end": float(w["end"])} for w in words]
        timeline, _ = ops.add_captions(timeline, timed, preset=style.pop("preset", "punch"))
        if style:
            timeline, _ = ops.restyle_captions(timeline, **style)
    except (ops.EditError, KeyError, TypeError, ValueError):
        pass  # captions are a bonus here; the clip itself is what matters
    return timeline


_open_lock = threading.Lock()  # two "Edit" clicks at once must not start two edits


@router.post("/open", response_model=ProjectRead)
def open_in_editor(body: OpenRequest, user: Owner, db: DbSession) -> ProjectRead:
    with _open_lock:
        return _open_in_editor(body, user, db)


def _open_in_editor(body: OpenRequest, user: User, db: DbSession) -> ProjectRead:
    """Edit a clip or an imported video: reopen the edit made from it before, or start one.

    A clip opens on its clean cut with its captions as editable text (from its transcript, in
    the style it was burned with). A video opens with its best clip on the timeline, and the
    Moments tab picks more from it."""
    if body.clip_id is None and body.import_id is None:
        raise HTTPException(422, "Pick a clip or a video.")
    clip: Clip | None = None
    job: ImportJob | None = None
    if body.clip_id is not None:
        clip = db.get(Clip, body.clip_id)
        if clip is None or clip.user_id != user.id:
            raise HTTPException(404, "Clip not found.")
        job = _job_of(db, user, clip)
        existing = db.scalar(select(EditorProject).where(EditorProject.user_id == user.id, EditorProject.source_clip_id == clip.id)
                             .order_by(EditorProject.id.desc()).limit(1))
    else:
        job = db.get(ImportJob, body.import_id)
        if job is None or job.user_id != user.id:
            raise HTTPException(404, "Video not found.")
        existing = db.scalar(select(EditorProject).where(
            EditorProject.user_id == user.id, EditorProject.import_id == job.id, EditorProject.source_clip_id.is_(None),
        ).order_by(EditorProject.id.desc()).limit(1))
    if existing is not None:
        return _read(db, existing)

    timeline = Timeline(aspect=body.aspect or "9:16")
    start_clip = clip
    if start_clip is None and job is not None:  # start from the video's best clip, if it has one
        clips = [c for cid in (job.clip_ids or []) if (c := db.get(Clip, cid)) is not None and c.raw_file_path]
        start_clip = max(clips, key=lambda c: c.highlight_score or 0, default=None)
    if start_clip is not None:
        try:
            timeline = _clip_captions(db, _place_clip(db, user, timeline, start_clip, job=job), start_clip)
        except HTTPException:
            if clip is not None:
                raise  # the clip they asked for is gone
    title = body.title or (clip.title if clip else None) or (job.title if job else None) or "Untitled edit"
    project = EditorProject(user_id=user.id, title=title[:200], timeline=timeline.model_dump(mode="json"), chat=[],
                            media=[a.src for a in timeline.assets], import_id=job.id if job else None,
                            source_clip_id=clip.id if clip else None)
    db.add(project)
    db.flush()
    _snapshot(db, project, "Start")
    db.commit()
    db.refresh(project)
    return _read(db, project)


def _clock(seconds: float) -> str:
    s = int(seconds)
    return f"{s // 3600}:{s // 60 % 60:02d}:{s % 60:02d}" if s >= 3600 else f"{s // 60}:{s % 60:02d}"


@router.post("/projects/{project_id}/moments", response_model=ProjectRead)
def add_moment(project_id: int, body: MomentRequest, user: Owner, db: DbSession) -> ProjectRead:
    """Cut a range of the project's video as a 9:16 clip (it's saved in the Hub too) and place it.

    Link videos fetch just that range in HD, which can take a minute."""
    from app.api import studio
    from app.schemas.import_job import StudioClipRequest

    project = _owned(db, project_id, user)
    if project.import_id is None:
        raise HTTPException(422, "This edit wasn't opened from an imported video.")
    try:
        request = StudioClipRequest(start_s=body.start_s, end_s=body.end_s, layout=body.layout)
    except ValueError as err:
        raise HTTPException(422, str(err)) from err
    made = studio.create_clip(project.import_id, request, user, db)
    db.refresh(project)
    try:
        timeline = _place_clip(db, user, Timeline.model_validate(project.timeline), db.get(Clip, made.id),
                               job=db.get(ImportJob, project.import_id), at=body.at)
    except ops.EditError as err:
        raise HTTPException(422, str(err)) from err
    span = f"{_clock(made.start_s)}–{_clock(made.end_s)}"
    _snapshot(db, project, "Your edits", only_if_changed=True)
    _save(db, project, timeline)
    _snapshot(db, project, f"Added moment {span}")
    db.commit()
    db.refresh(project)
    return _read(db, project).model_copy(update={"notice": f"Added {span} to the timeline. It's saved in your Hub too."})


@router.post("/projects/{project_id}/captions", response_model=ProjectRead)
def generate_captions(project_id: int, body: CaptionsRequest, user: Owner, db: DbSession) -> ProjectRead:
    """Transcribe the clips on the timeline and add editable captions (replaces existing ones)."""
    project = _owned(db, project_id, user)
    timeline = Timeline.model_validate(project.timeline)
    try:
        words = ops.caption_words(timeline, assistant.transcribe_range)
        timeline, summary = ops.add_captions(timeline, words, preset=body.preset, words_per_caption=body.words_per_caption)
    except ops.EditError as err:
        raise HTTPException(422, str(err)) from err
    _snapshot(db, project, "Your edits", only_if_changed=True)
    _save(db, project, timeline)
    _snapshot(db, project, "Captions")
    db.commit()
    db.refresh(project)
    return _read(db, project).model_copy(update={"notice": f"{summary} Click any line to fix a word."})


@router.get("/projects/{project_id}", response_model=ProjectRead)
def get_project(project_id: int, user: Owner, db: DbSession) -> ProjectRead:
    return _read(db, _owned(db, project_id, user))


@router.patch("/projects/{project_id}", response_model=ProjectRead)
def update_project(project_id: int, body: ProjectUpdate, user: Owner, db: DbSession) -> ProjectRead:
    """Save the timeline the browser edited. Send `revision` to refuse overwriting a newer save."""
    project = _owned(db, project_id, user)
    if body.revision is not None and body.revision != project.revision:
        raise HTTPException(status.HTTP_409_CONFLICT, "This project changed somewhere else. Reload to get the latest version.")
    if body.title is not None:
        project.title = body.title
    if body.timeline is not None:
        known = set(project.media or [])
        if any(a.src not in known and not sfx.is_library_src(a.src) for a in body.timeline.assets):
            raise HTTPException(422, "Add media through the upload or library endpoints.")
        _save(db, project, body.timeline)
    else:
        db.commit()
        db.refresh(project)
    return _read(db, project)


@router.delete("/projects/{project_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_project(project_id: int, user: Owner, db: DbSession) -> None:
    db.delete(_owned(db, project_id, user))
    db.commit()


# --- media --------------------------------------------------------------------------------

@router.post("/projects/{project_id}/assets", response_model=ProjectRead, status_code=status.HTTP_201_CREATED)
def upload_asset(project_id: int, user: Owner, db: DbSession, file: UploadFile = File(...), place: bool = Form(True)) -> ProjectRead:
    """Upload a video, image or audio file into the project (and put it on the timeline)."""
    project = _owned(db, project_id, user)
    name = file.filename or "media"
    ext = Path(name).suffix.lower()
    if ext not in UPLOAD_EXTS:
        raise HTTPException(status.HTTP_415_UNSUPPORTED_MEDIA_TYPE, "Upload a video (MP4, MOV, WEBM), image (PNG, JPG, WEBP, GIF) or audio (MP3, WAV, M4A).")
    timeline = Timeline.model_validate(project.timeline)
    asset_id = ops.new_id(timeline, "m")
    dst = project_dir(project.id) / "assets" / f"{asset_id}{ext}"
    dst.parent.mkdir(parents=True, exist_ok=True)
    limit, written = settings.max_upload_mb * 1024 * 1024, 0
    with dst.open("wb") as out:
        while chunk := file.file.read(1024 * 1024):
            written += len(chunk)
            if written > limit:
                out.close()
                dst.unlink(missing_ok=True)
                raise HTTPException(status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, f"That file is over the {settings.max_upload_mb} MB limit.")
            out.write(chunk)
    try:
        asset = probe_asset(dst, asset_id, Path(name).stem)
    except MediaError as err:
        dst.unlink(missing_ok=True)
        raise HTTPException(422, str(err)) from err
    timeline = Timeline.model_validate({**timeline.model_dump(), "assets": [*timeline.model_dump()["assets"], asset.model_dump()]})
    _save(db, project, _place(timeline, asset_id) if place else timeline)
    return _read(db, project)


@router.post("/projects/{project_id}/assets/library", response_model=ProjectRead, status_code=status.HTTP_201_CREATED)
def add_library_asset(project_id: int, body: AddClipAsset, user: Owner, db: DbSession) -> ProjectRead:
    """Bring one of your clips, or an import's full source video, into the project."""
    project = _owned(db, project_id, user)
    timeline = Timeline.model_validate(project.timeline)
    if body.clip_id is not None and body.place:  # on the timeline: from its wide source when there is one
        clip = db.get(Clip, body.clip_id)
        if clip is None or clip.user_id != user.id:
            raise HTTPException(404, "Clip not found.")
        _save(db, project, _place_clip(db, user, timeline, clip))
        return _read(db, project)
    public, name = _library_source(db, user, body.clip_id, body.import_id)
    timeline, asset_id = _asset_from_storage(timeline, public, name)
    _save(db, project, _place(timeline, asset_id) if body.place else timeline)
    return _read(db, project)


# --- preview, chat, export ----------------------------------------------------------------

@router.get("/projects/{project_id}/composition")
def composition(project_id: int, request: Request, user: Owner, db: DbSession) -> dict:
    """The HyperFrames composition for the browser preview (<hyperframes-player srcdoc>)."""
    project = _owned(db, project_id, user)
    base = str(request.base_url).rstrip("/")
    html = compose(Timeline.model_validate(project.timeline), media_url=lambda a: f"{base}/{a.src}",
                   font_url=lambda f: f"{base}/editor-fonts/{f}", title=project.title)
    return {"revision": project.revision, "html": html}


@router.post("/projects/{project_id}/chat", response_model=ChatResponse)
def chat(project_id: int, body: ChatRequest, user: Owner, db: DbSession) -> ChatResponse:
    """Ask the AI to edit. The whole reply is one saved revision, so one Undo reverts it."""
    project = _owned(db, project_id, user)
    timeline = Timeline.model_validate(project.timeline)
    history = [{"role": m["role"], "content": m["content"]} for m in project.chat or []]
    try:
        result = assistant.run(timeline, body.message, history=history, playhead=body.playhead, selected_id=body.selected_id)
    except assistant.AssistantUnavailable as err:
        logging.getLogger("cliphive.editor").warning("AI editor unavailable: %s", err)
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, "The AI editor isn't available right now.") from err
    except Exception as err:  # network / model errors: keep the project as it was
        logging.getLogger("cliphive.editor").exception("AI editor failed")
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, "The AI editor didn't respond. Please try again.") from err

    now = datetime.now(UTC).isoformat()
    version_from = version_to = None
    if result.changes:
        version_from = _snapshot(db, project, "Your edits", only_if_changed=True)
        _save(db, project, result.timeline)
        version_to = _snapshot(db, project, body.message)
    project.chat = [*(project.chat or []), {"role": "user", "content": body.message, "changes": [], "at": now},
                    {"role": "assistant", "content": result.reply, "changes": result.changes, "at": now,
                     "version_from": version_from, "version_to": version_to}][-100:]
    db.commit()
    db.refresh(project)
    return ChatResponse(reply=result.reply, changes=result.changes, project=_read(db, project))


@router.post("/projects/{project_id}/auto-effects", response_model=ProjectRead)
def auto_effects(project_id: int, body: AutoEffectsRequest, user: Owner, db: DbSession) -> ProjectRead:
    """Place visual effects automatically (from the audio, cuts and captions), as one version."""
    project = _owned(db, project_id, user)
    try:
        timeline, summary = effects.auto_effects(Timeline.model_validate(project.timeline), body.style, body.amount)
    except ops.EditError as err:
        raise HTTPException(422, str(err)) from err
    _snapshot(db, project, "Your edits", only_if_changed=True)
    _save(db, project, timeline)
    _snapshot(db, project, "Removed auto effects" if body.style == "none" else f"Auto effects ({body.style})")
    db.commit()
    db.refresh(project)
    return _read(db, project).model_copy(update={"notice": summary})


@router.get("/sfx", response_model=list[SfxRead])
def sfx_library(user: Owner) -> list[dict]:
    """The built-in sound effects (generated on first use)."""
    return sfx.library()


@router.post("/projects/{project_id}/auto-sfx", response_model=ProjectRead)
def auto_sfx(project_id: int, body: AutoSfxRequest, user: Owner, db: DbSession) -> ProjectRead:
    """AI sound design: effects on cuts, titles, text pop-ins and loud moments, as one version."""
    project = _owned(db, project_id, user)
    try:
        result = sfx.auto(Timeline.model_validate(project.timeline), body.intensity, replace=body.replace, loudness=sfx.file_loudness)
    except ValueError as err:
        raise HTTPException(422, str(err)) from err
    _snapshot(db, project, "Your edits", only_if_changed=True)
    _save(db, project, result.timeline)
    _snapshot(db, project, f"Auto SFX ({body.intensity})")
    db.commit()
    db.refresh(project)
    how = "picked by AI" if result.used_ai else "placed automatically"
    return _read(db, project).model_copy(update={"notice": f"{result.summary}, {how}."})


@router.post("/projects/{project_id}/auto-emoji", response_model=ProjectRead)
def auto_emoji(project_id: int, body: AutoEmojiRequest, user: Owner, db: DbSession) -> ProjectRead:
    """Emoji next to the captions that call for one, each with its own motion, as one version."""
    project = _owned(db, project_id, user)
    try:
        result = emojis.auto(Timeline.model_validate(project.timeline), body.amount, body.motion, body.placement)
    except ValueError as err:
        raise HTTPException(422, str(err)) from err
    _snapshot(db, project, "Your edits", only_if_changed=True)
    _save(db, project, result.timeline)
    _snapshot(db, project, "Removed auto emoji" if body.amount == "none" else f"Auto emoji ({body.amount})")
    db.commit()
    db.refresh(project)
    how = "" if body.amount == "none" or not result.count else (", picked by AI" if result.used_ai else ", picked by the built-in rules")
    return _read(db, project).model_copy(update={"notice": f"{result.summary}{how}."})


@router.get("/projects/{project_id}/versions", response_model=list[VersionRead])
def list_versions(project_id: int, user: Owner, db: DbSession) -> list[EditorVersion]:
    """Version history, newest first."""
    _owned(db, project_id, user)
    return list(db.scalars(select(EditorVersion).where(EditorVersion.project_id == project_id).order_by(EditorVersion.number.desc()).limit(200)))


@router.post("/projects/{project_id}/versions/{number}/restore", response_model=ProjectRead)
def restore_version(project_id: int, number: int, user: Owner, db: DbSession) -> ProjectRead:
    """Go back to a version. Your current state is kept as a version first, so this is undoable too."""
    project = _owned(db, project_id, user)
    version = db.scalar(select(EditorVersion).where(EditorVersion.project_id == project_id, EditorVersion.number == number))
    if version is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, f"There's no v{number}.")
    _snapshot(db, project, "Your edits", only_if_changed=True)
    _save(db, project, Timeline.model_validate(version.timeline))
    _snapshot(db, project, f"Restored v{number}")
    db.commit()
    db.refresh(project)
    return _read(db, project)


@router.post("/projects/{project_id}/render", response_model=ProjectRead, status_code=status.HTTP_202_ACCEPTED)
def export(project_id: int, user: Owner, db: DbSession) -> ProjectRead:
    """Render the timeline to MP4 in the background; the result lands in the Hub as a ready clip."""
    project = _owned(db, project_id, user)
    if project.render_status == "rendering":
        raise HTTPException(status.HTTP_409_CONFLICT, "Already exporting this project.")
    timeline = Timeline.model_validate(project.timeline)
    if not timeline.clips and not timeline.texts:
        raise HTTPException(422, "Add something to the timeline first.")
    project.render_status, project.render_progress, project.render_error = "rendering", 0, None
    db.commit()
    db.refresh(project)
    render.submit(project.id)
    return _read(db, project)


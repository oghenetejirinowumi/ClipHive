"""Export an editor project to MP4 with the HyperFrames CLI, then add it to the Hub.

The render folder is a self-contained HyperFrames project: the compiled index.html plus every
asset it uses (hard-linked, so no copy for big files) under assets/. `hyperframes render`
prints `@hf-progress {json}` lines, which become the project's render_progress.
"""
from __future__ import annotations

import json
import logging
import shutil
import subprocess
from collections import deque
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from app.config import settings
from app.core.media import public_path, storage_root
from sqlalchemy import inspect, text

from app.db import SessionLocal, engine
from app.models import Clip, ClipStatus, EditorProject
from app.schemas.editor import Timeline
from app.services.editor.compose import compose, font_file
from app.services.editor.media import link_or_copy, project_dir
from app.services.editor.ops import asset_path

logger = logging.getLogger("cliphive.editor")

FONTS_DIR = Path(__file__).resolve().parents[3] / "assets" / "fonts"

_executor = ThreadPoolExecutor(max_workers=1, thread_name_prefix="editor-render")  # renders are CPU-heavy


class RenderError(RuntimeError):
    """Export failed; the message is safe to show to the user."""


def submit(project_id: int) -> None:
    _executor.submit(_render_safely, project_id)


# Columns added after editor_projects first shipped. create_all() never alters an existing
# table, so add any that are missing (SQLite and Postgres both accept this ALTER).
_ADDED_COLUMNS = {"media": "JSON", "import_id": "INTEGER", "source_clip_id": "INTEGER"}


def ensure_columns() -> None:
    existing = {c["name"] for c in inspect(engine).get_columns("editor_projects")}
    with engine.begin() as conn:
        for name, ddl in _ADDED_COLUMNS.items():
            if name not in existing:
                conn.execute(text(f"ALTER TABLE editor_projects ADD COLUMN {name} {ddl}"))


def recover_interrupted() -> None:
    ensure_columns()
    with SessionLocal() as db:
        stuck = db.query(EditorProject).filter(EditorProject.render_status == "rendering").all()
        for project in stuck:
            project.render_status, project.render_error = "failed", "Interrupted by a server restart. Export again."
        if stuck:
            db.commit()


def _update(project_id: int, **fields) -> None:
    with SessionLocal() as db:
        project = db.get(EditorProject, project_id)
        if project:
            for key, value in fields.items():
                setattr(project, key, value)
            db.commit()


def _render_safely(project_id: int) -> None:
    try:
        _render(project_id)
    except RenderError as err:
        _update(project_id, render_status="failed", render_error=str(err))
    except Exception:
        logger.exception("Export of editor project %s crashed", project_id)
        _update(project_id, render_status="failed", render_error="Something went wrong while exporting.")


def build_render_folder(timeline: Timeline, work: Path, title: str) -> Path:
    """Write a standalone HyperFrames project for this timeline into work/. Returns index.html."""
    shutil.rmtree(work, ignore_errors=True)
    (work / "assets").mkdir(parents=True)
    names: dict[str, str] = {}
    used = {c.asset_id for c in timeline.clips} | {a.asset_id for a in timeline.audio}
    for asset in timeline.assets:
        if asset.id not in used:
            continue
        src = asset_path(asset)
        if not src.is_file():
            raise RenderError(f"{asset.name} is no longer on disk. Remove it from the timeline and export again.")
        names[asset.id] = f"assets/{asset.id}{src.suffix.lower()}"
        link_or_copy(src, work / names[asset.id])
    for font in {t.font for t in timeline.texts}:
        source = font_file(font)  # the built-in three, or any caption font (Montserrat 900, ...)
        if source is not None:
            link_or_copy(source, work / "assets" / "fonts" / source.name)
    html = compose(timeline, media_url=lambda a: names[a.id], font_url=lambda f: f"assets/fonts/{f}", title=title)
    index = work / "index.html"
    index.write_text(html, encoding="utf-8")
    return index


def _npx() -> str:
    npx = shutil.which("npx")
    if not npx:
        raise RenderError("Exporting needs Node.js 22+ (npx) on the server.")
    return npx


def _render(project_id: int) -> None:
    with SessionLocal() as db:
        project = db.get(EditorProject, project_id)
        if not project:
            return
        timeline = Timeline.model_validate(project.timeline)
        title, user_id, revision = project.title, project.user_id, project.revision

    if not timeline.clips and not timeline.texts:
        raise RenderError("The timeline is empty.")
    base = project_dir(project_id)
    work = base / "render"
    build_render_folder(timeline, work, title)
    out = base / f"export_r{revision}.mp4"

    cmd = [_npx(), "-y", f"hyperframes@{settings.hyperframes_version}", "render", str(work), "--output", str(out),
           "--quality", settings.editor_render_quality, "--fps", "30"]
    logger.info("Exporting editor project %s (%.1fs)", project_id, timeline.duration)
    tail: deque[str] = deque(maxlen=12)
    proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, encoding="utf-8", errors="replace")
    assert proc.stdout is not None
    last = -1
    for line in proc.stdout:
        line = line.strip()
        if line.startswith("@hf-progress "):
            try:
                pct = int(json.loads(line.removeprefix("@hf-progress ")).get("pct", 0))
            except (ValueError, TypeError):
                continue
            if pct != last:
                last = pct
                _update(project_id, render_progress=min(99, max(1, pct)))
        elif line:
            tail.append(line)
    if proc.wait() != 0 or not out.is_file():
        logger.warning("hyperframes render failed for project %s:\n%s", project_id, "\n".join(tail))
        raise RenderError("The export failed. " + (tail[-1][:300] if tail else "No output from the renderer."))

    with SessionLocal() as db:
        clip = Clip(
            user_id=user_id, start_s=0.0, end_s=timeline.duration, raw_file_path=str(out), file_path=public_path(out),
            title=title[:255], hashtags=[], status=ClipStatus.READY,
        )
        db.add(clip)
        db.commit()
        clip_id = clip.id
    _update(project_id, render_status="done", render_progress=100, render_error=None, render_path=public_path(out), export_clip_id=clip_id)
    logger.info("Exported editor project %s → clip %s", project_id, clip_id)

"""ClipHive FastAPI application entrypoint."""

from __future__ import annotations

import asyncio
import json
import logging
import subprocess
from contextlib import asynccontextmanager
from pathlib import Path

from app.api import auth
from app.api.agents import router as agents_router
from app.api.inbox import router as inbox_router
from app.api.clips import router as clips_router
from app.api.downloads import router as downloads_router
from app.api.editor import router as editor_router
from app.api.hub import router as hub_router
from app.api.imports import router as imports_router
from app.api.live import router as live_router
from app.api.streamers import router as streamers_router
from app.api.studio import router as studio_router
from app.api.styles import router as styles_router
from app.api.trends import router as trends_router
from app.config import settings
from app.core.demo import ensure_demo_account
from app.core.media import ffmpeg_bin
from app.db import SessionLocal, init_db
from app.models.clip import Clip
from app.models.enums import CaptionMode, ClipStatus
from app.models.user import User
from app.services.caption.styles import seed_preset_styles
from app.services.editor import render as editor_render
from app.services.editor.render import FONTS_DIR as EDITOR_FONTS_DIR
from app.services.ingest.pipeline import recover_interrupted
from app.workers import ingest_worker
from app.services.agents.publisher import publisher_loop
from app.services.agents.scout import scout_loop
from app.services.trends.scheduler import trend_scheduler
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import RedirectResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

from app.core import object_store
from app.core.static_cache import CachedStaticFiles

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("cliphive")


@asynccontextmanager
async def lifespan(app: FastAPI):
    if settings.jwt_secret == "change-me":
        logger.warning(
            "JWT_SECRET is the default 'change-me'. Anyone can forge sessions; set a real one in backend/.env."
        )

    # Startup: Initialize DB and seeds
    logger.info("Initializing database...")
    init_db()
    recover_interrupted()
    ingest_worker.recover_interrupted()
    editor_render.recover_interrupted()
    # Resolve ffmpeg once (bundled fallback goes on PATH for the caption burner and yt-dlp).
    logger.info("ffmpeg: %s", ffmpeg_bin())

    with SessionLocal() as db:
        # Seed default styles
        styles = seed_preset_styles(db)
        logger.info(f"Seeded {len(styles)} caption styles.")

        # Demo account, only usable when DEMO_LOGIN_ENABLED=true (locked otherwise)
        ensure_demo_account(db)
        demo_user = db.query(User).order_by(User.id).first()

        # Seed a sample clip for the local demo account only (never in production)
        sample_video = Path("tests/fixtures/sample_raw.mp4")
        if settings.demo_login_enabled and demo_user is not None and sample_video.exists():
            existing_clip = db.query(Clip).first()
            if not existing_clip:
                punch_style = next(
                    (s for s in styles if s.name == "Punch"),
                    styles[0] if styles else None,
                )
                sample_clip = Clip(
                    user_id=demo_user.id,
                    start_s=0.0,
                    end_s=10.0,
                    raw_file_path=str(sample_video.resolve()),
                    caption_style_id=punch_style.id if punch_style else None,
                    caption_mode=CaptionMode.BURNED,
                    highlight_score=94.5,
                    title="Epic Clutch Stream Moment",
                    hashtags=["#gaming", "#clutch", "#streamer"],
                    status=ClipStatus.PROCESSING,
                )
                db.add(sample_clip)
                db.commit()
                logger.info("Seeded initial fixture clip for testing.")

    ingest_worker.start()
    background = [asyncio.create_task(publisher_loop())]
    if settings.trends_scheduler_enabled:
        background.append(asyncio.create_task(trend_scheduler()))
    if settings.scout_enabled:
        logger.info("Scout agent: checking channels every %d min", settings.scout_interval_minutes)
        background.append(asyncio.create_task(scout_loop()))
    if object_store.enabled():
        logger.info("Media storage: s3://%s/%s", settings.s3_bucket, settings.s3_prefix.strip("/"))
        object_store.resume_pending()  # uploads a crash or redeploy interrupted
        background.append(asyncio.create_task(object_store.evict_loop()))
    try:
        yield
    finally:
        ingest_worker.stop()
        for task in background:
            task.cancel()
            try:
                await task
            except asyncio.CancelledError:
                pass


# Ensure tables exist at startup
init_db()

app = FastAPI(
    title="ClipHive API",
    description="Backend API for ClipHive AI Stream Clipping & Caption Studio",
    version="0.1.0",
    lifespan=lifespan,
)

# Enable CORS for frontend development
app.add_middleware(
    CORSMiddleware,
    # Bearer tokens, not cookies, so no credentials mode is needed.
    allow_origins=[o.strip() for o in settings.cors_origins.split(",") if o.strip()] or ["*"],
    # Local dev from any port, as localhost or 127.0.0.1 (pages on someone's own machine only).
    allow_origin_regex=r"https?://(localhost|127\.0\.0\.1)(:\d+)?",
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

class MediaFiles(CachedStaticFiles):
    """/storage: the local file (with cache headers) when this instance has it, else a redirect
    to its S3 copy."""

    async def get_response(self, path, scope):
        try:
            return await super().get_response(path, scope)
        except StarletteHTTPException as err:
            if err.status_code != 404 or not object_store.enabled():
                raise
            key = object_store.key_for(Path(self.directory) / path)
            if key is None or not await asyncio.to_thread(object_store.remote_has, key):
                raise
            return RedirectResponse(await asyncio.to_thread(object_store.url_for, key), status_code=307)


# Mount local storage directory for preview and download
storage_dir = Path(settings.storage_dir)  # same folder the import pipeline writes to
storage_dir.mkdir(parents=True, exist_ok=True)
app.mount("/storage", MediaFiles(directory=str(storage_dir)), name="storage")
# Caption fonts for the video editor preview (the composition loads them by URL).
app.mount("/editor-fonts", CachedStaticFiles(directory=str(EDITOR_FONTS_DIR), max_age=86400), name="editor-fonts")

# Include routers (paths per docs/CONTRACT.md: everything under /api).
app.include_router(auth.router, prefix="/api")
app.include_router(live_router, prefix="/api")  # GET /api/streamers/status
app.include_router(streamers_router, prefix="/api")
app.include_router(styles_router, prefix="/api")
app.include_router(clips_router, prefix="/api")
app.include_router(trends_router, prefix="/api")
app.include_router(imports_router, prefix="/api")
app.include_router(downloads_router, prefix="/api")
app.include_router(hub_router, prefix="/api")
app.include_router(studio_router, prefix="/api")
app.include_router(editor_router, prefix="/api")
app.include_router(agents_router, prefix="/api")
app.include_router(inbox_router, prefix="/api")


@app.api_route("/", methods=["GET", "HEAD"])
def root():
    return RedirectResponse(url="/docs")


def _code_version() -> str:
    """The deployed commit (short hash), so you can tell which code is live."""
    try:
        out = subprocess.run(["git", "-C", str(Path(__file__).resolve().parents[2]), "rev-parse", "--short=7", "HEAD"],
                             capture_output=True, text=True, timeout=5)
        return out.stdout.strip() or "unknown"
    except (OSError, subprocess.SubprocessError):
        return "unknown"


CODE_VERSION = _code_version()


# Written by deploy/oracle/update.sh on the server: a push that was blocked (tests failed, or it
# didn't start and was rolled back) shows here until a newer push deploys.
DEPLOY_STATUS = Path(settings.storage_dir).resolve().parent / "deploy-status.json"


@app.api_route("/health", methods=["GET", "HEAD"])
def health():
    body: dict = {"status": "ok", "app": "ClipHive", "version": CODE_VERSION}
    try:
        deploy = json.loads(DEPLOY_STATUS.read_text(encoding="utf-8"))
        if deploy.get("state") in ("blocked", "down") and deploy.get("commit") != CODE_VERSION:
            body["blocked"] = {k: deploy.get(k) for k in ("commit", "reason", "at")}
    except (OSError, ValueError):
        pass
    return body

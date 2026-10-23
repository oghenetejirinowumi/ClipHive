"""ClipHive FastAPI application entrypoint."""
from __future__ import annotations

import logging
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import RedirectResponse
from fastapi.staticfiles import StaticFiles

from app.api import auth
from app.api.clips import router as clips_router
from app.api.downloads import router as downloads_router
from app.api.imports import router as imports_router
from app.api.streamers import router as streamers_router
from app.api.styles import router as styles_router
from app.api.trends import router as trends_router
from app.config import settings
from app.core.media import ffmpeg_bin
from app.db import SessionLocal, init_db
from app.models.clip import Clip
from app.models.enums import CaptionMode, ClipStatus
from app.models.user import User
from app.services.caption.styles import seed_preset_styles
from app.services.ingest.pipeline import recover_interrupted

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("cliphive")


@asynccontextmanager
async def lifespan(app: FastAPI):
    if settings.jwt_secret == "change-me":
        logger.warning("JWT_SECRET is the default 'change-me'. Anyone can forge sessions; set a real one in backend/.env.")

    # Startup: Initialize DB and seeds
    logger.info("Initializing database...")
    init_db()
    recover_interrupted()
    # Resolve ffmpeg once (bundled fallback goes on PATH for the caption burner and yt-dlp).
    logger.info("ffmpeg: %s", ffmpeg_bin())

    with SessionLocal() as db:
        # Seed default styles
        styles = seed_preset_styles(db)
        logger.info(f"Seeded {len(styles)} caption styles.")

        # Seed demo user if none exists
        demo_user = db.query(User).first()
        if not demo_user:
            demo_user = User(email="demo@cliphive.local", password_hash="not_needed_for_demo")
            db.add(demo_user)
            db.commit()
            db.refresh(demo_user)

        # Seed sample clip row if none exists
        sample_video = Path("tests/fixtures/sample_raw.mp4")
        if sample_video.exists():
            existing_clip = db.query(Clip).first()
            if not existing_clip:
                punch_style = next((s for s in styles if s.name == "Punch"), styles[0] if styles else None)
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

    yield


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
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Mount local storage directory for preview and download
storage_dir = Path(settings.storage_dir)  # same folder the import pipeline writes to
storage_dir.mkdir(parents=True, exist_ok=True)
app.mount("/storage", StaticFiles(directory=str(storage_dir)), name="storage")

# Include routers (paths per docs/CONTRACT.md: everything under /api).
app.include_router(auth.router, prefix="/api")
app.include_router(streamers_router, prefix="/api")
app.include_router(styles_router, prefix="/api")
app.include_router(clips_router, prefix="/api")
app.include_router(trends_router, prefix="/api")
app.include_router(imports_router, prefix="/api")
app.include_router(downloads_router, prefix="/api")


@app.api_route("/", methods=["GET", "HEAD"])
def root():
    return RedirectResponse(url="/docs")


@app.api_route("/health", methods=["GET", "HEAD"])
def health():
    return {"status": "ok", "app": "ClipHive"}

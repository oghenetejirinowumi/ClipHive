"""API endpoints for Clips and Caption processing."""
from __future__ import annotations

import logging
from pathlib import Path

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from app.db import SessionLocal, get_db
from app.models.caption_style import CaptionStyle
from app.models.clip import Clip
from app.models.enums import CaptionMode, ClipStatus
from app.schemas.clip import CaptionRequest, ClipRead, ClipUpdate
from app.services.ai.proofreader import proofread_transcript
from app.services.ai.viral_studio import generate_viral_metadata
from app.services.caption.ass_generator import ASSGenerator
from app.services.caption.burner import burn_subtitles
from app.services.transcribe.whisper_service import transcribe_video

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/clips", tags=["clips"])

STORAGE_DIR = Path("storage")
STORAGE_CLIPS_DIR = STORAGE_DIR / "clips"
STORAGE_SUBS_DIR = STORAGE_DIR / "subtitles"

STORAGE_CLIPS_DIR.mkdir(parents=True, exist_ok=True)
STORAGE_SUBS_DIR.mkdir(parents=True, exist_ok=True)


@router.get("", response_model=list[ClipRead])
def list_clips(status: ClipStatus | None = None, db: Session = Depends(get_db)):
    """Lists clips, optionally filtered by status (e.g. ?status=ready)."""
    query = db.query(Clip)
    if status:
        query = query.filter(Clip.status == status)
    return query.order_by(Clip.created_at.desc()).all()


@router.get("/{clip_id}", response_model=ClipRead)
def get_clip(clip_id: int, db: Session = Depends(get_db)):
    """Returns a single clip by ID."""
    clip = db.query(Clip).filter(Clip.id == clip_id).first()
    if not clip:
        raise HTTPException(status_code=404, detail="Clip not found")
    return clip


@router.patch("/{clip_id}", response_model=ClipRead)
def update_clip(clip_id: int, payload: ClipUpdate, db: Session = Depends(get_db)):
    """Updates clip metadata like title and hashtags."""
    clip = db.query(Clip).filter(Clip.id == clip_id).first()
    if not clip:
        raise HTTPException(status_code=404, detail="Clip not found")

    if payload.title is not None:
        clip.title = payload.title
    if payload.hashtags is not None:
        clip.hashtags = payload.hashtags
    if payload.caption_style_id is not None:
        clip.caption_style_id = payload.caption_style_id
    if payload.caption_mode is not None:
        clip.caption_mode = payload.caption_mode

    db.commit()
    db.refresh(clip)
    return clip


@router.post("/{clip_id}/ai-pack", response_model=ClipRead)
def generate_ai_metadata(
    clip_id: int,
    platform: str = "tiktok",
    db: Session = Depends(get_db),
):
    """Runs AI Viral Studio on the clip: generates high-CTR title, hook score, and hashtags tailored to platform."""
    clip = db.query(Clip).filter(Clip.id == clip_id).first()
    if not clip:
        raise HTTPException(status_code=404, detail="Clip not found")

    if not clip.transcript_json:
        if not clip.raw_file_path or not Path(clip.raw_file_path).exists():
            raise HTTPException(status_code=400, detail="Raw video file not found")
        raw_words = transcribe_video(clip.raw_file_path)
        words = proofread_transcript(raw_words)
        clip.transcript_json = [w.model_dump() for w in words]

    viral = generate_viral_metadata(clip.transcript_json, platform=platform)
    clip.title = viral.title
    clip.highlight_score = viral.hook_score
    clip.hashtags = viral.hashtags

    db.commit()
    db.refresh(clip)
    return clip


def process_clip_captioning(clip_id: int, style_id: int, caption_mode: CaptionMode) -> bool:
    """Worker routine to transcribe, AI package, and burn video for a clip. Returns False if it failed."""
    with SessionLocal() as db:
        clip = db.query(Clip).filter(Clip.id == clip_id).first()
        style = db.query(CaptionStyle).filter(CaptionStyle.id == style_id).first()
        if not clip or not style or not clip.raw_file_path:
            return False

        try:
            # 1. Transcribe with domain vocabulary + AI proofread
            if not clip.transcript_json:
                clip.status = ClipStatus.CAPTIONING
                db.commit()

                logger.info(f"Transcribing clip {clip.id}: {clip.raw_file_path}")
                raw_words = transcribe_video(clip.raw_file_path)
                proofread_words = proofread_transcript(raw_words)
                clip.transcript_json = [w.model_dump() for w in proofread_words]
                db.commit()

            # 2. AI Virality Studio Packaging
            viral = generate_viral_metadata(clip.transcript_json)
            if not clip.title:
                clip.title = viral.title
            if not clip.highlight_score:
                clip.highlight_score = viral.hook_score
            if not clip.hashtags:
                clip.hashtags = viral.hashtags

            # 3. Clean platform-native vs Burned
            if caption_mode == CaptionMode.PLATFORM_NATIVE:
                clip.file_path = clip.raw_file_path
                clip.caption_mode = CaptionMode.PLATFORM_NATIVE
                clip.caption_style_id = style.id
                clip.status = ClipStatus.READY
                clip.error = None
                db.commit()
                return True

            # 4. Burn kinetic captions
            clip.status = ClipStatus.CAPTIONING
            db.commit()

            generator = ASSGenerator()
            ass_path = STORAGE_SUBS_DIR / f"clip_{clip.id}_{style.name.lower()}.ass"
            generator.generate(
                words=clip.transcript_json,
                style=style,
                clip_start_s=0.0,
                clip_end_s=clip.duration_s if clip.duration_s > 0 else None,
                output_file=ass_path,
                hype_words=viral.hype_words,
            )

            final_mp4 = STORAGE_CLIPS_DIR / f"clip_{clip.id}_{style.name.lower()}.mp4"
            burn_subtitles(
                raw_video_path=clip.raw_file_path,
                ass_subtitle_path=ass_path,
                output_video_path=final_mp4,
                fonts_dir="backend/assets/fonts",
            )

            clip.file_path = str(final_mp4)
            clip.caption_style_id = style.id
            clip.caption_mode = CaptionMode.BURNED
            clip.status = ClipStatus.READY
            clip.error = None
            db.commit()
            return True

        except Exception as e:
            logger.exception(f"Captioning worker failed for clip {clip_id}: {e}")
            db.rollback()
            # The clean cut is still a finished clip: keep it postable and record why captions failed.
            usable = bool(clip.file_path or clip.raw_file_path) and Path(clip.raw_file_path).exists()
            clip.status = ClipStatus.READY if usable else ClipStatus.FAILED
            reason = "the video encoder ran out of memory, try again" if "FFmpeg" in str(e) else str(e)
            clip.error = f"Captions failed: {reason}"[:500]
            db.commit()
            return False


@router.post("/{clip_id}/caption", response_model=ClipRead)
@router.post("/{clip_id}/regenerate-captions", response_model=ClipRead)
def caption_clip(
    clip_id: int,
    payload: CaptionRequest,
    background_tasks: BackgroundTasks,
    async_burn: bool = Query(default=False, description="Run caption burn in background worker"),
    db: Session = Depends(get_db),
):
    """
    Core C2 Deliverable:
    Transcribes (with gaming vocabulary), proofreads with AI, generates viral title & hashtags,
    styles ASS subtitles with karaoke word-pop and hype animations, burns into 9:16 portrait video.
    """
    clip = db.query(Clip).filter(Clip.id == clip_id).first()
    if not clip:
        raise HTTPException(status_code=404, detail="Clip not found")

    style = db.query(CaptionStyle).filter(CaptionStyle.id == payload.style_id).first()
    if not style:
        raise HTTPException(status_code=404, detail="Caption style not found")

    if not clip.raw_file_path or not Path(clip.raw_file_path).exists():
        raise HTTPException(status_code=400, detail="Raw video file not found on disk")

    if async_burn:
        clip.status = ClipStatus.CAPTIONING
        db.commit()
        db.refresh(clip)
        background_tasks.add_task(process_clip_captioning, clip_id, payload.style_id, payload.caption_mode)
        return clip

    # Synchronous execution
    ok = process_clip_captioning(clip_id, payload.style_id, payload.caption_mode)
    db.refresh(clip)
    if not ok:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=clip.error or "Caption generation failed.",
        )
    return clip

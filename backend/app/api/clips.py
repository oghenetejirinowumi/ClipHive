"""API endpoints for Clips and Caption processing."""

from __future__ import annotations

import logging
from pathlib import Path

from app.config import settings
from app.api.deps import Owner
from app.core.media import public_path, storage_root
from app.db import SessionLocal, get_db
from app.models.caption_style import CaptionStyle
from app.models.clip import Clip
from app.models.enums import CaptionMode, ClipStatus, PostPlatform
from app.schemas.clip import AIPackResponse, CaptionRequest, ClipRead, ClipUpdate
from app.services.ai.context_engine import (
    GAME_SIGNATURES,
    ClipContext,
    apply_context_to_clip,
    extract_clip_context,
)
from app.services.agents.learning import record_feedback
from app.services.ai.proofreader import proofread_transcript
from app.services.ai.viral_studio import generate_viral_metadata
from app.services.caption.ass_generator import ASSGenerator
from app.services.caption.burner import burn_subtitles
from app.services.transcribe.whisper_service import transcribe_video
from app.services.trends.queries import match_clip_to_trends
from app.services.trends.social_search import SocialSearchUnavailable, find_social_trends
from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/clips", tags=["clips"])

# Under STORAGE_DIR (served at /storage), so it lands on the persistent disk in production.
STORAGE_DIR = storage_root()
STORAGE_CLIPS_DIR = STORAGE_DIR / "clips"
STORAGE_SUBS_DIR = STORAGE_DIR / "subtitles"

STORAGE_CLIPS_DIR.mkdir(parents=True, exist_ok=True)
STORAGE_SUBS_DIR.mkdir(parents=True, exist_ok=True)


@router.get("", response_model=list[ClipRead])
def list_clips(user: Owner, status: ClipStatus | None = None, db: Session = Depends(get_db)):
    """Lists clips, optionally filtered by status (e.g. ?status=ready)."""
    query = db.query(Clip).filter(Clip.user_id == user.id)
    if status:
        query = query.filter(Clip.status == status)
    return query.order_by(Clip.created_at.desc()).all()


@router.get("/{clip_id}", response_model=ClipRead)
def get_clip(clip_id: int, user: Owner, db: Session = Depends(get_db)):
    """Returns a single clip by ID."""
    clip = db.query(Clip).filter(Clip.id == clip_id, Clip.user_id == user.id).first()
    if not clip:
        raise HTTPException(status_code=404, detail="Clip not found")
    return clip


@router.get("/{clip_id}/trend-match")
def get_clip_trend_matches(
    user: Owner,
    clip_id: int,
    platform: PostPlatform = Query(default=PostPlatform.YOUTUBE),
    region: str = Query(default="NG", pattern="^(NG|US)$"),
    db: Session = Depends(get_db),
):
    clip = db.query(Clip).filter(Clip.id == clip_id, Clip.user_id == user.id).first()
    if not clip:
        raise HTTPException(status_code=404, detail="Clip not found")
    return {
        "clip_id": clip.id,
        "region": region.upper(),
        "platform": platform.value,
        "matches": match_clip_to_trends(db, clip, platform.value, region.upper()),
    }


@router.patch("/{clip_id}", response_model=ClipRead)
def update_clip(clip_id: int, payload: ClipUpdate, user: Owner, db: Session = Depends(get_db)):
    """Updates clip metadata like title and hashtags."""
    clip = db.query(Clip).filter(Clip.id == clip_id, Clip.user_id == user.id).first()
    if not clip:
        raise HTTPException(status_code=404, detail="Clip not found")

    # Log edits so the agents learn this creator's taste (services/agents/learning.py).
    feedback: list[tuple[str, dict, dict]] = []
    if payload.title is not None and payload.title != clip.title:
        feedback.append(("title_edit", {"title": clip.title}, {"title": payload.title}))
    if payload.description is not None and payload.description != clip.description:
        feedback.append(("description_edit", {"description": clip.description}, {"description": payload.description}))
    if payload.hashtags is not None and list(payload.hashtags) != list(clip.hashtags or []):
        feedback.append(("hashtag_edit", {"hashtags": clip.hashtags or []}, {"hashtags": payload.hashtags}))
    if payload.caption_style_id is not None and payload.caption_style_id != clip.caption_style_id:
        feedback.append(_style_feedback(db, clip.caption_style_id, payload.caption_style_id))

    if payload.title is not None:
        clip.title = payload.title
    if payload.description is not None:
        clip.description = payload.description
    if payload.hashtags is not None:
        clip.hashtags = payload.hashtags
    if payload.caption_style_id is not None:
        clip.caption_style_id = payload.caption_style_id
    if payload.caption_mode is not None:
        clip.caption_mode = payload.caption_mode

    db.commit()
    db.refresh(clip)
    for kind, before, after in feedback:
        record_feedback(db, clip.user_id, clip, kind, before, after)
    return clip


def _style_feedback(db: Session, old_id: int | None, new_id: int) -> tuple[str, dict, dict]:
    old = db.get(CaptionStyle, old_id) if old_id else None
    new = db.get(CaptionStyle, new_id)
    return ("style_change", {"style": old.name if old else None}, {"style": new.name if new else None})


@router.get("/{clip_id}/context")
def get_clip_context_endpoint(
    user: Owner,
    clip_id: int,
    platform: str = "tiktok",
    db: Session = Depends(get_db),
):
    """Returns the extracted context (game/topic, mood, event type, rationale, matched hashtags)."""
    clip = db.query(Clip).filter(Clip.id == clip_id, Clip.user_id == user.id).first()
    if not clip:
        raise HTTPException(status_code=404, detail="Clip not found")

    if clip.context_json and clip.context_json.get("summary"):
        return clip.context_json

    context = extract_clip_context(clip, db, platform=platform)
    apply_context_to_clip(clip, db, context)
    return clip.context_json


@router.get("/{clip_id}/social-trends")
def get_clip_social_trends(
    user: Owner,
    clip_id: int,
    platform: str = Query(default="tiktok", pattern="^(tiktok|youtube)$"),
    refresh: bool = False,
    db: Session = Depends(get_db),
):
    """Popular hashtags and caption ideas from short videos similar to this clip.

    Reads the clip's context (transcribing it first if needed), searches YouTube
    Shorts for matching videos, and returns hashtags ranked by how much the videos
    using them were watched. Does not change the clip; save picks with PATCH.
    """
    if not settings.social_search_enabled:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Similar-video search is off. It scrapes YouTube search, so it is a research prototype; set SOCIAL_SEARCH_ENABLED=true to try it.",
        )
    clip = db.query(Clip).filter(Clip.id == clip_id, Clip.user_id == user.id).first()
    if not clip:
        raise HTTPException(status_code=404, detail="Clip not found")

    saved = dict(clip.context_json or {})
    cached = saved.get("social_trends")
    if cached and not refresh and cached.get("platform") == platform:
        return _social_response(clip, saved, cached)

    if saved.get("summary"):
        context = ClipContext(**saved)
    else:
        context = extract_clip_context(clip, db, platform=platform)
        saved.update(context.model_dump())

    try:
        result = find_social_trends(
            game_or_topic=context.game_or_topic,
            event_type=context.event_type,
            creator=context.creator,
            summary=context.summary,
            clip_title=clip.title,
            suggested_title=context.viral_title,
            topic_keywords=GAME_SIGNATURES.get(context.game_or_topic, []),
            platform=platform,
            refresh=refresh,
        )
    except SocialSearchUnavailable as exc:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(exc))

    saved["social_trends"] = result.model_dump()
    clip.context_json = saved  # reassign so SQLAlchemy sees the JSON change
    db.commit()
    db.refresh(clip)
    return _social_response(clip, saved, saved["social_trends"])


def _social_response(clip: Clip, context: dict, trends: dict) -> dict:
    return {
        "clip_id": clip.id,
        "current_title": clip.title,
        "current_hashtags": clip.hashtags or [],
        "context": {
            key: context.get(key)
            for key in ("summary", "game_or_topic", "event_type", "mood", "creator")
        },
        **trends,
    }


@router.post("/{clip_id}/ai-pack", response_model=AIPackResponse)
@router.post("/{clip_id}/analyze-context", response_model=AIPackResponse)
def generate_ai_metadata(
    user: Owner,
    clip_id: int,
    platform: str = "tiktok",
    db: Session = Depends(get_db),
):
    """
    Reads clip transcript and generates viral packaging (titles, descriptions, hashtags),
    saving titles[0], descriptions[0], and hashtags onto the clip.
    """
    clip = db.query(Clip).filter(Clip.id == clip_id, Clip.user_id == user.id).first()
    if not clip:
        raise HTTPException(status_code=404, detail="Clip not found")

    try:
        from app.services.ai.ai_pack import apply_ai_pack_to_clip, generate_ai_pack_data

        pack = generate_ai_pack_data(clip, db, platform=platform)
        apply_ai_pack_to_clip(clip, db, pack)
        return pack
    except HTTPException:
        raise
    except Exception as exc:
        logger.error(f"AI packaging failed for clip {clip_id}: {exc}", exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"AI packaging failed: {str(exc)}",
        )


def process_clip_captioning(clip_id: int, style_id: int, caption_mode: CaptionMode) -> bool:
    """Worker routine to transcribe, AI package, and burn video for a clip. Returns False if it failed."""
    with SessionLocal() as db:
        clip = db.query(Clip).filter(Clip.id == clip_id).first()
        style = db.query(CaptionStyle).filter(CaptionStyle.id == style_id).first()
        if not clip or not clip.raw_file_path:
            return False
        if not style and clip.caption_style_id:
            style = (
                db.query(CaptionStyle)
                .filter(CaptionStyle.id == clip.caption_style_id)
                .first()
            )
        if not style:
            style = db.query(CaptionStyle).first()
        if not style:
            return False

        try:
            # 1. Transcribe & extract context if not already done
            context = None
            if (
                not clip.transcript_json
                or not clip.context_json
                or not clip.context_json.get("summary")
            ):
                clip.status = ClipStatus.CAPTIONING
                db.commit()
                context = extract_clip_context(clip, db, platform="tiktok")
                apply_context_to_clip(clip, db, context)
            else:
                try:
                    from app.services.ai.context_engine import ClipContext

                    context = ClipContext(**clip.context_json)
                except Exception:
                    context = extract_clip_context(clip, db, platform="tiktok")
                    apply_context_to_clip(clip, db, context)

            hype_words = (
                context.hype_words
                if context and context.hype_words
                else ["CLUTCH", "OMG", "NO WAY"]
            )

            # 3. Clean platform-native vs Burned
            if caption_mode == CaptionMode.PLATFORM_NATIVE:
                clip.file_path = public_path(Path(clip.raw_file_path))
                clip.caption_mode = CaptionMode.PLATFORM_NATIVE
                clip.caption_style_id = style.id
                clip.status = ClipStatus.READY
                clip.error = None
                db.commit()
                from app.services.ai.ai_pack import auto_run_ai_pack
                auto_run_ai_pack(clip, db)
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
                hype_words=hype_words,
            )

            final_mp4 = STORAGE_CLIPS_DIR / f"clip_{clip.id}_{style.name.lower()}.mp4"
            burn_subtitles(
                raw_video_path=clip.raw_file_path,
                ass_subtitle_path=ass_path,
                output_video_path=final_mp4,
                fonts_dir="backend/assets/fonts",
            )

            clip.file_path = public_path(final_mp4)
            clip.caption_style_id = style.id
            clip.caption_mode = CaptionMode.BURNED
            clip.status = ClipStatus.READY
            clip.error = None
            db.commit()
            from app.services.ai.ai_pack import auto_run_ai_pack
            auto_run_ai_pack(clip, db)
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
            if clip.status == ClipStatus.READY:
                from app.services.ai.ai_pack import auto_run_ai_pack
                auto_run_ai_pack(clip, db)
            return False


@router.post("/{clip_id}/caption", response_model=ClipRead)
@router.post("/{clip_id}/regenerate-captions", response_model=ClipRead)
def caption_clip(
    user: Owner,
    clip_id: int,
    payload: CaptionRequest,
    background_tasks: BackgroundTasks,
    async_burn: bool = Query(
        default=False, description="Run caption burn in background worker"
    ),
    db: Session = Depends(get_db),
):
    """
    Core C2 Deliverable:
    Transcribes (with gaming vocabulary), proofreads with AI, generates viral title & hashtags,
    styles ASS subtitles with karaoke word-pop and hype animations, burns into 9:16 portrait video.
    """
    clip = db.query(Clip).filter(Clip.id == clip_id, Clip.user_id == user.id).first()
    if not clip:
        raise HTTPException(status_code=404, detail="Clip not found")

    style = db.query(CaptionStyle).filter(CaptionStyle.id == payload.style_id).first()
    if not style:
        raise HTTPException(status_code=404, detail="Caption style not found")

    if not clip.raw_file_path or not Path(clip.raw_file_path).exists():
        raise HTTPException(status_code=400, detail="Raw video file not found on disk")

    if clip.caption_style_id and clip.caption_style_id != style.id:
        record_feedback(db, clip.user_id, clip, *_style_feedback(db, clip.caption_style_id, style.id))

    if async_burn:
        clip.status = ClipStatus.CAPTIONING
        db.commit()
        db.refresh(clip)
        background_tasks.add_task(
            process_clip_captioning, clip_id, payload.style_id, payload.caption_mode
        )
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

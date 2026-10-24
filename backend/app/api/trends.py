"""API endpoints for Trending Hashtags and metadata injection."""

from __future__ import annotations

from app.api.deps import CurrentUser
from app.config import settings
from app.db import get_db
from app.models.clip import Clip
from app.models.enums import PostPlatform
from app.models.trend_data import TrendScore
from app.schemas.clip import ClipRead
from app.schemas.trend import (
    ApplyTrendsRequest,
    HashtagPage,
    TrendImportRequest,
    TrendJobRequest,
    TrendRead,
)
from app.services.trends.collection import (
    RUN_LOCK,
    provider_status,
    refresh_tracked_videos,
    run_collection,
)
from app.services.trends.queries import (
    fastest_videos,
    hashtag_detail,
    import_tiktok_csv,
    latest_scores_query,
    list_hashtags,
    observed_patterns,
    score_item,
)
from app.services.trends import radar as clip_radar
from app.services.trends.scheduler import scheduler_status
from app.services.trends.suggest import suggestions_for
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

router = APIRouter(prefix="/trends", tags=["trends"])


@router.get("", response_model=list[TrendRead])
def get_trends(
    platform: PostPlatform = Query(default=PostPlatform.TIKTOK),
    region: str = Query(default="NG", pattern="^(NG|US)$"),
    db: Session = Depends(get_db),
):
    """Returns the latest collected score snapshot; unavailable data stays empty."""
    query = latest_scores_query(db, platform.value, region.upper())
    rows = query.order_by(TrendScore.score.desc().nullslast()).limit(10).all()
    return [score_item(score, hashtag) for score, hashtag in rows]


@router.get("/radar")
def get_radar(user: CurrentUser, refresh: bool = Query(default=False)):
    """What clippers are posting right now: hot topics, top clips and clippers (Kick, Twitch)."""
    return clip_radar.get_radar(refresh=refresh).as_dict()


@router.get("/radar/suggestions")
def get_radar_suggestions(user: CurrentUser, db: Session = Depends(get_db)):
    """What this creator should clip next, from the radar plus their channels and taste."""
    return suggestions_for(db, user.id, clip_radar.get_radar()).as_dict()


@router.get("/hashtags", response_model=HashtagPage)
def get_hashtags(
    platform: PostPlatform = Query(default=PostPlatform.YOUTUBE),
    region: str = Query(default="NG", pattern="^(NG|US)$"),
    stage: str | None = Query(
        default=None,
        pattern="^(emerging|accelerating|established|peaking|declining|insufficient_data)$",
    ),
    min_score: float = Query(default=0, ge=0, le=100),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=20, ge=1, le=50),
    db: Session = Depends(get_db),
):
    return list_hashtags(
        db, platform.value, region.upper(), stage, min_score, page, page_size
    )


@router.get("/hashtags/{name}")
def get_hashtag_detail(
    name: str,
    platform: PostPlatform = Query(default=PostPlatform.YOUTUBE),
    region: str = Query(default="NG", pattern="^(NG|US)$"),
    db: Session = Depends(get_db),
):
    result = hashtag_detail(db, name, platform.value, region.upper())
    if result is None:
        raise HTTPException(status_code=404, detail="Hashtag not found")
    return result


@router.get("/videos")
def get_fastest_videos(
    region: str = Query(default="NG", pattern="^(NG|US)$"),
    sort: str = Query(default="velocity", pattern="^velocity$"),
    limit: int = Query(default=20, ge=1, le=50),
    db: Session = Depends(get_db),
):
    return fastest_videos(db, region.upper(), limit=limit)


@router.get("/patterns")
def get_patterns(
    region: str = Query(default="NG", pattern="^(NG|US)$"),
    db: Session = Depends(get_db),
):
    return observed_patterns(db, region.upper())


@router.get("/status")
def get_status(db: Session = Depends(get_db)):
    return {
        "scheduler_enabled": settings.trends_scheduler_enabled,
        "scheduler": scheduler_status(),
        "default_regions": settings.trends_region_list,
        "providers": provider_status(db),
    }


@router.post("/jobs/run")
def run_jobs(
    user: CurrentUser,
    payload: TrendJobRequest | None = None,
    db: Session = Depends(get_db),
):
    if not RUN_LOCK.acquire(blocking=False):
        raise HTTPException(
            status_code=409, detail="A trend collection job is already running"
        )
    try:
        regions = (
            [region.upper() for region in payload.regions]
            if payload and payload.regions
            else None
        )
        return run_collection(db, regions)
    finally:
        RUN_LOCK.release()


@router.post("/import")
def import_trends(
    payload: TrendImportRequest, user: CurrentUser, db: Session = Depends(get_db)
):
    try:
        return import_tiktok_csv(db, payload.csv_text, payload.region.upper())
    except ValueError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error


@router.post("/apply", response_model=ClipRead)
def apply_trends(payload: ApplyTrendsRequest, user: CurrentUser, db: Session = Depends(get_db)):
    """Applies trending hashtags to a clip's metadata."""
    clip = db.query(Clip).filter(Clip.id == payload.clip_id, Clip.user_id == user.id).first()
    if not clip:
        raise HTTPException(status_code=404, detail="Clip not found")

    current_tags = list(clip.hashtags or [])
    for tag in payload.hashtags:
        clean_tag = tag.strip()
        if not clean_tag.startswith("#"):
            clean_tag = f"#{clean_tag}"
        if clean_tag not in current_tags:
            current_tags.append(clean_tag)

    clip.hashtags = current_tags
    db.commit()
    db.refresh(clip)
    return clip

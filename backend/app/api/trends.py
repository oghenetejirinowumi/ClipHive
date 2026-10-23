"""API endpoints for Trending Hashtags and metadata injection."""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.db import get_db
from app.models.clip import Clip
from app.models.enums import PostPlatform
from app.schemas.clip import ClipRead
from app.schemas.trend import ApplyTrendsRequest, TrendRead
from app.services.trends.trend_client import get_or_refresh_trends

router = APIRouter(prefix="/trends", tags=["trends"])


@router.get("", response_model=list[TrendRead])
def get_trends(
    platform: PostPlatform = Query(default=PostPlatform.TIKTOK),
    db: Session = Depends(get_db),
):
    """Returns top trending topics and hashtags for the specified platform."""
    return get_or_refresh_trends(db, platform)


@router.post("/apply", response_model=ClipRead)
def apply_trends(payload: ApplyTrendsRequest, db: Session = Depends(get_db)):
    """Applies trending hashtags to a clip's metadata."""
    clip = db.query(Clip).filter(Clip.id == payload.clip_id).first()
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

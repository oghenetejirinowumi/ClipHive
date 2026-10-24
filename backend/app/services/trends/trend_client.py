"""Trend fetching client for ClipHive (YouTube, TikTok, and cached evergreen fallbacks)."""

from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Sequence

import requests
from app.config import settings
from app.models.enums import PostPlatform
from app.models.trend import Trend
from sqlalchemy.orm import Session

logger = logging.getLogger(__name__)


def fetch_youtube_trends(api_key: str | None = None) -> list[dict]:
    """Fetches popular gaming shorts/videos from YouTube Data API v3, or returns empty list on failure."""
    key = api_key or settings.youtube_api_key
    if not key:
        return []

    try:
        url = "https://www.googleapis.com/youtube/v3/videos"
        params = {
            "part": "snippet",
            "chart": "mostPopular",
            "regionCode": "US",
            "videoCategoryId": "20",  # 20 = Gaming
            "maxResults": "10",
            "key": key,
        }
        resp = requests.get(url, params=params, timeout=5)
        if resp.status_code != 200:
            logger.warning(f"YouTube Trends API returned {resp.status_code}")
            return []

        data = resp.json()
        results = []
        for idx, item in enumerate(data.get("items", [])):
            title = item["snippet"]["title"]
            tags = item["snippet"].get("tags", [])
            tag = f"#{tags[0].replace(' ', '')}" if tags else "#Gaming"
            score = round(100.0 - idx * 2.5, 1)
            results.append({"hashtag": tag, "topic": title[:50], "score": score})
        return results
    except Exception as e:
        logger.warning(f"Error fetching YouTube trends: {e}")
        return []


def get_or_refresh_trends(db: Session, platform: PostPlatform) -> list[Trend]:
    """
    Returns persisted trends and refreshes stale YouTube data when configured.
    Missing providers never produce synthetic trend rows.
    """
    existing = (
        db.query(Trend)
        .filter(Trend.platform == platform)
        .order_by(Trend.score.desc())
        .all()
    )
    newest = max(
        (trend.fetched_at for trend in existing if trend.fetched_at), default=None
    )
    now = datetime.now(timezone.utc)

    if newest:
        if newest.tzinfo is None:
            newest = newest.replace(tzinfo=timezone.utc)
        if (now - newest).total_seconds() < settings.trends_cache_ttl_s:
            return existing

    if platform != PostPlatform.YOUTUBE or not settings.youtube_api_key:
        return existing

    trends_data = fetch_youtube_trends(settings.youtube_api_key)
    if not trends_data:
        return existing

    # Update database
    db.query(Trend).filter(Trend.platform == platform).delete()
    for item in trends_data:
        t = Trend(
            platform=platform,
            topic=item.get("topic"),
            hashtag=item["hashtag"],
            score=item["score"],
        )
        db.add(t)

    db.commit()

    return (
        db.query(Trend)
        .filter(Trend.platform == platform)
        .order_by(Trend.score.desc())
        .all()
    )

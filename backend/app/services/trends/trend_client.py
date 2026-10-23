"""Trend fetching client for ClipHive (YouTube, TikTok, and cached evergreen fallbacks)."""
from __future__ import annotations

import logging
import os
import time
from typing import Sequence

import requests
from sqlalchemy.orm import Session

from app.models.enums import PostPlatform
from app.models.trend import Trend

logger = logging.getLogger(__name__)

EVERGREEN_TRENDS: dict[PostPlatform, list[dict]] = {
    PostPlatform.TIKTOK: [
        {"hashtag": "#fyp", "topic": "For You Page", "score": 99.5},
        {"hashtag": "#gaming", "topic": "Gaming Community", "score": 95.2},
        {"hashtag": "#twitchstreamer", "topic": "Stream Highlights", "score": 92.0},
        {"hashtag": "#viralclips", "topic": "Viral Moments", "score": 89.4},
        {"hashtag": "#clutch", "topic": "Pro Gameplay", "score": 87.1},
        {"hashtag": "#streamerhighlights", "topic": "Twitch & Kick", "score": 85.0},
        {"hashtag": "#gamingontiktok", "topic": "TikTok Gaming", "score": 83.2},
        {"hashtag": "#funnygaming", "topic": "Comedy Moments", "score": 80.5},
        {"hashtag": "#esports", "topic": "Competitive", "score": 78.0},
        {"hashtag": "#epicmoment", "topic": "Highlights", "score": 75.3},
    ],
    PostPlatform.YOUTUBE: [
        {"hashtag": "#Shorts", "topic": "YouTube Shorts", "score": 98.8},
        {"hashtag": "#Gaming", "topic": "Gaming", "score": 94.6},
        {"hashtag": "#Livestream", "topic": "Live Highlights", "score": 91.2},
        {"hashtag": "#TwitchClips", "topic": "Best Stream Moments", "score": 88.5},
        {"hashtag": "#GamerMoments", "topic": "Gameplay Clips", "score": 86.0},
        {"hashtag": "#FunnyClips", "topic": "Fails & Wins", "score": 84.1},
        {"hashtag": "#ShortsGaming", "topic": "Short Form Gaming", "score": 82.0},
        {"hashtag": "#ProPlay", "topic": "Esports Plays", "score": 79.5},
    ],
}

_CACHE_EXPIRY_SECONDS = 3600  # 1 hour
_LAST_FETCH_TIME: dict[PostPlatform, float] = {}


def fetch_youtube_trends(api_key: str | None = None) -> list[dict]:
    """Fetches popular gaming shorts/videos from YouTube Data API v3, or returns empty list on failure."""
    key = api_key or os.getenv("YOUTUBE_API_KEY")
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
    Returns the latest trends for a platform from DB or seeds them with evergreen fallbacks.
    Refreshes if older than 1 hour.
    """
    now = time.time()
    last_fetched = _LAST_FETCH_TIME.get(platform, 0)

    existing = db.query(Trend).filter(Trend.platform == platform).order_by(Trend.score.desc()).all()

    if existing and (now - last_fetched < _CACHE_EXPIRY_SECONDS):
        return existing

    # Try live fetch for YouTube
    trends_data = []
    if platform == PostPlatform.YOUTUBE:
        trends_data = fetch_youtube_trends()

    # Fallback if no live data
    if not trends_data:
        trends_data = EVERGREEN_TRENDS.get(platform, EVERGREEN_TRENDS[PostPlatform.TIKTOK])

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
    _LAST_FETCH_TIME[platform] = now

    return db.query(Trend).filter(Trend.platform == platform).order_by(Trend.score.desc()).all()

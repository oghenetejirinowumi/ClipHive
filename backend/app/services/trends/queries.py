from __future__ import annotations

import csv
import io
import re
from datetime import datetime, timezone

from app.models.clip import Clip
from app.models.trend_data import (
    Hashtag,
    TrendScore,
    TrendVideo,
    VideoHashtag,
    VideoMetricSnapshot,
)
from app.services.trends.trend_engine import normalize_hashtag, view_velocity
from sqlalchemy import func
from sqlalchemy.orm import Session


def latest_scores_query(db: Session, platform: str, region: str):
    latest_ids = (
        db.query(func.max(TrendScore.id).label("id"))
        .filter(TrendScore.platform == platform, TrendScore.region == region)
        .group_by(TrendScore.hashtag_id)
        .subquery()
    )
    return (
        db.query(TrendScore, Hashtag)
        .join(latest_ids, TrendScore.id == latest_ids.c.id)
        .join(Hashtag, Hashtag.id == TrendScore.hashtag_id)
    )


def score_item(score: TrendScore, hashtag: Hashtag) -> dict:
    return {
        "id": score.id,
        "platform": score.platform,
        "topic": None,
        "hashtag": hashtag.display,
        "score": score.score,
        "fetched_at": score.calculated_at,
        "calculated_at": score.calculated_at,
        "stage": score.stage,
        "source": score.source,
        "sample_size": score.sample_size,
        "reasons": score.reasons or [],
        "region": score.region,
        "velocity": score.velocity,
        "acceleration": score.acceleration,
        "engagement": score.engagement,
        "usage_growth": score.usage_growth,
        "distinct_channels": score.distinct_channels,
    }


def list_hashtags(
    db: Session,
    platform: str,
    region: str,
    stage: str | None,
    min_score: float,
    page: int,
    page_size: int,
) -> dict:
    query = latest_scores_query(db, platform, region)
    if stage:
        query = query.filter(TrendScore.stage == stage)
    if min_score > 0:
        query = query.filter(TrendScore.score >= min_score)
    total = query.count()
    items = (
        query.order_by(
            TrendScore.score.desc().nullslast(),
            TrendScore.usage_growth.desc().nullslast(),
        )
        .offset((page - 1) * page_size)
        .limit(page_size)
        .all()
    )
    return {
        "items": [score_item(score, hashtag) for score, hashtag in items],
        "page": page,
        "page_size": page_size,
        "total": total,
    }


def hashtag_detail(db: Session, name: str, platform: str, region: str) -> dict | None:
    normalized = normalize_hashtag(name)
    hashtag = db.query(Hashtag).filter_by(normalized=normalized).one_or_none()
    if hashtag is None:
        return None
    history = (
        db.query(TrendScore)
        .filter_by(hashtag_id=hashtag.id, platform=platform, region=region)
        .order_by(TrendScore.calculated_at.desc())
        .limit(40)
        .all()
    )
    video_ids = [
        row.video_id
        for row in db.query(VideoHashtag.video_id)
        .filter_by(hashtag_id=hashtag.id)
        .all()
    ]
    videos = (
        (
            db.query(TrendVideo)
            .filter(TrendVideo.id.in_(video_ids), TrendVideo.region == region)
            .order_by(TrendVideo.last_collected_at.desc())
            .limit(12)
            .all()
        )
        if video_ids
        else []
    )
    samples = []
    for video in videos:
        snapshot = (
            db.query(VideoMetricSnapshot)
            .filter_by(video_id=video.id)
            .order_by(VideoMetricSnapshot.collected_at.desc())
            .first()
        )
        samples.append(
            {
                "title": video.title,
                "url": video.url,
                "thumbnail_url": video.thumbnail_url,
                "views": snapshot.views if snapshot else None,
                "published_at": video.published_at,
                "short_confidence": video.short_confidence,
                "source": video.source,
            }
        )
    related_ids = set()
    if video_ids:
        related_ids = {
            association.hashtag_id
            for association in db.query(VideoHashtag)
            .filter(VideoHashtag.video_id.in_(video_ids))
            .all()
            if association.hashtag_id != hashtag.id
        }
    related = (
        db.query(Hashtag).filter(Hashtag.id.in_(related_ids)).limit(12).all()
        if related_ids
        else []
    )
    return {
        "hashtag": hashtag.display,
        "platform": platform,
        "region": region,
        "history": [
            {
                "score": row.score,
                "stage": row.stage,
                "velocity": row.velocity,
                "usage_growth": row.usage_growth,
                "reasons": row.reasons or [],
                "calculated_at": row.calculated_at,
            }
            for row in reversed(history)
        ],
        "reasons": history[0].reasons if history else [],
        "videos": samples,
        "related_hashtags": [tag.display for tag in related],
    }


def fastest_videos(db: Session, region: str, limit: int = 20) -> list[dict]:
    videos = (
        db.query(TrendVideo)
        .filter(
            TrendVideo.platform == "youtube",
            TrendVideo.region == region,
            TrendVideo.short_confidence >= 0.5,
        )
        .order_by(TrendVideo.last_collected_at.desc())
        .limit(200)
        .all()
    )
    ranked = []
    for video in videos:
        snapshots = (
            db.query(VideoMetricSnapshot)
            .filter_by(video_id=video.id)
            .order_by(VideoMetricSnapshot.collected_at.desc())
            .limit(2)
            .all()
        )
        if len(snapshots) < 2:
            continue
        velocity = view_velocity(snapshots[1], snapshots[0])
        if velocity is not None:
            ranked.append((velocity, video, snapshots[0]))
    ranked.sort(key=lambda entry: entry[0], reverse=True)
    return [
        {
            "external_id": video.external_id,
            "title": video.title,
            "url": video.url,
            "thumbnail_url": video.thumbnail_url,
            "velocity": velocity,
            "views": snapshot.views,
            "short_confidence": video.short_confidence,
            "source": video.source,
        }
        for velocity, video, snapshot in ranked[:limit]
    ]


def observed_patterns(db: Session, region: str) -> dict:
    fast_videos = fastest_videos(db, region, limit=50)
    ids = [video["external_id"] for video in fast_videos]
    rows = (
        db.query(TrendVideo).filter(TrendVideo.external_id.in_(ids)).all()
        if ids
        else []
    )
    titles = [video.title for video in rows]
    total = len(titles)
    if not total:
        return {
            "region": region,
            "sample_size": 0,
            "source": "observed_video_metadata",
            "patterns": [],
        }
    checks = {
        "question_title": lambda text: "?" in text,
        "pov_or_when_opener": lambda text: bool(
            re.match(r"\s*(pov\b|when\b)", text, re.IGNORECASE)
        ),
        "number_or_list": lambda text: bool(
            re.search(
                r"\b(?:top\s+\d+|\d+\s+(?:ways|tips|things)|\d+v\d+)\b", text, re.I
            )
        ),
        "all_caps_title": lambda text: bool(text)
        and sum(char.isalpha() for char in text) > 0
        and sum(char.isupper() for char in text if char.isalpha())
        / sum(char.isalpha() for char in text)
        >= 0.6,
        "emoji_title": lambda text: any(ord(char) > 0xFFFF for char in text),
        "hashtags_at_title_end": lambda text: bool(
            re.search(
                r"(?:\s|^)#[\w\u0080-\uffff]+(?:\s+#[\w\u0080-\uffff]+)*\s*$", text
            )
        ),
    }
    pattern_rows = [
        {
            "name": name,
            "percent": round(sum(check(title) for title in titles) / total * 100),
            "count": sum(check(title) for title in titles),
        }
        for name, check in checks.items()
    ]
    word_lengths = [len(title.split()) for title in titles]
    median_words = sorted(word_lengths)[len(word_lengths) // 2]
    hashtag_counts = [
        len(re.findall(r"#[\w\u0080-\uffff]+", title)) for title in titles
    ]
    median_hashtags = sorted(hashtag_counts)[len(hashtag_counts) // 2]
    return {
        "region": region,
        "sample_size": total,
        "source": "observed_video_metadata",
        "disclaimer": f"Observed in {total} fast-rising videos; these patterns are not evidence of cause.",
        "median_title_words": median_words,
        "median_hashtag_count": median_hashtags,
        "patterns": pattern_rows,
    }


def match_clip_to_trends(
    db: Session, clip: Clip, platform: str, region: str
) -> list[dict]:
    words = clip.transcript_json or []
    transcript = " ".join(
        str(word.get("word", "")) for word in words if isinstance(word, dict)
    )
    text = f"{clip.title or ''} {transcript}".casefold()
    scores = latest_scores_query(db, platform, region).all()
    matches = []
    for score, hashtag in scores:
        terms = [
            term for term in re.split(r"[^\w]+", hashtag.normalized) if len(term) >= 3
        ]
        occurrences = sum(
            len(re.findall(rf"(?<!\w){re.escape(term)}(?!\w)", text)) for term in terms
        )
        if occurrences:
            stage = score.stage
            matches.append(
                {
                    "hashtag": hashtag.display,
                    "stage": stage,
                    "score": score.score,
                    "source": score.source,
                    "region": region,
                    "occurrences": occurrences,
                    "reason": f"{hashtag.display} is {stage.replace('_', ' ')} in {region}; the clip mentions a matching term {occurrences} time{'s' if occurrences != 1 else ''}.",
                }
            )
    matches.sort(key=lambda row: (row["occurrences"], row["score"] or 0), reverse=True)
    return matches[:10]


def import_tiktok_csv(db: Session, csv_text: str, region: str) -> dict:
    reader = csv.DictReader(io.StringIO(csv_text))
    if not reader.fieldnames or "hashtag" not in {
        field.strip().lower() for field in reader.fieldnames
    }:
        raise ValueError("CSV must include a hashtag column")
    hashtag_field = next(
        field for field in reader.fieldnames if field.strip().lower() == "hashtag"
    )
    imported = 0
    now = datetime.now(timezone.utc)
    for row in reader:
        display = (row.get(hashtag_field) or "").strip()
        normalized = normalize_hashtag(display)
        if not normalized:
            continue
        hashtag = db.query(Hashtag).filter_by(normalized=normalized).one_or_none()
        if hashtag is None:
            hashtag = Hashtag(normalized=normalized, display=f"#{normalized}")
            db.add(hashtag)
            db.flush()
        db.add(
            TrendScore(
                hashtag_id=hashtag.id,
                platform="tiktok",
                region=region,
                score=None,
                sample_size=0,
                distinct_channels=0,
                stage="insufficient_data",
                source="manual_import",
                reasons=[
                    "Manually transcribed from TikTok Creative Center; no official API feed or metrics."
                ],
                calculated_at=now,
            )
        )
        imported += 1
    db.commit()
    return {
        "imported": imported,
        "platform": "tiktok",
        "region": region,
        "source": "manual_import",
    }

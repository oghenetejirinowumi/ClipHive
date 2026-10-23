from __future__ import annotations

from datetime import datetime, timedelta, timezone
from math import ceil
from threading import Lock

from app.config import settings
from app.models.trend_data import (
    CollectionJob,
    Hashtag,
    TrendScore,
    TrendVideo,
    VideoHashtag,
    VideoMetricSnapshot,
)
from app.services.trends.providers import DiscoveryQuery, YouTubeProvider
from app.services.trends.providers.base import RawVideo
from app.services.trends.providers.tiktok import TikTokProvider
from app.services.trends.trend_engine import (
    classify_stage,
    engagement_rate,
    extract_hashtags,
    median_or_none,
    recency_score,
    score_sample_rows,
    view_acceleration,
    view_velocity,
)
from sqlalchemy import func
from sqlalchemy.orm import Session

RUN_LOCK = Lock()


def short_confidence(video: RawVideo) -> float:
    text = f"{video.title} {video.description} {' '.join(video.tags)}".casefold()
    score = 0.0
    if video.duration_s is not None and video.duration_s <= 180:
        score += 0.4
    if video.duration_s is not None and video.duration_s <= 60:
        score += 0.1
    if "#shorts" in text:
        score += 0.5
    return min(1.0, score)


def prune_expired_api_data(db: Session) -> int:
    cutoff = datetime.now(timezone.utc) - timedelta(days=30)
    expired_video_ids = [
        row[0]
        for row in db.query(TrendVideo.id).filter(TrendVideo.last_collected_at < cutoff).all()
    ]
    if expired_video_ids:
        hashtag_ids = {
            row[0]
            for row in db.query(VideoHashtag.hashtag_id)
            .filter(VideoHashtag.video_id.in_(expired_video_ids))
            .all()
        }
        db.query(VideoMetricSnapshot).filter(
            VideoMetricSnapshot.video_id.in_(expired_video_ids)
        ).delete(synchronize_session=False)
        db.query(VideoHashtag).filter(
            VideoHashtag.video_id.in_(expired_video_ids)
        ).delete(synchronize_session=False)
        db.query(TrendVideo).filter(TrendVideo.id.in_(expired_video_ids)).delete(
            synchronize_session=False
        )
        if hashtag_ids:
            db.query(TrendScore).filter(
                TrendScore.hashtag_id.in_(hashtag_ids),
                TrendScore.source == "youtube_data_api",
                TrendScore.calculated_at < cutoff,
            ).delete(synchronize_session=False)
    db.query(VideoMetricSnapshot).filter(
        VideoMetricSnapshot.collected_at < cutoff
    ).delete(synchronize_session=False)
    db.query(TrendScore).filter(
        TrendScore.source == "youtube_data_api", TrendScore.calculated_at < cutoff
    ).delete(synchronize_session=False)
    db.commit()
    return len(expired_video_ids)


def _upsert_video(db: Session, raw: RawVideo, region: str) -> TrendVideo:
    video = (
        db.query(TrendVideo)
        .filter_by(platform="youtube", external_id=raw.external_id)
        .one_or_none()
    )
    now = datetime.now(timezone.utc)
    if video is None:
        video = TrendVideo(
            platform="youtube",
            external_id=raw.external_id,
            url=f"https://www.youtube.com/watch?v={raw.external_id}",
            title=raw.title,
            region=region,
            first_seen_at=now,
        )
        db.add(video)
    video.title = raw.title
    video.description = raw.description
    video.channel_id = raw.channel_id
    video.published_at = raw.published_at
    video.duration_s = raw.duration_s
    video.short_confidence = short_confidence(raw)
    video.thumbnail_url = raw.thumbnail_url
    video.source = raw.source
    video.last_collected_at = now
    db.flush()

    for normalized, display in extract_hashtags(
        [raw.title, raw.description, *raw.tags]
    ):
        hashtag = db.query(Hashtag).filter_by(normalized=normalized).one_or_none()
        if hashtag is None:
            hashtag = Hashtag(normalized=normalized, display=f"#{display}")
            db.add(hashtag)
            db.flush()
        association = (
            db.query(VideoHashtag)
            .filter_by(video_id=video.id, hashtag_id=hashtag.id)
            .one_or_none()
        )
        if association is None:
            db.add(VideoHashtag(video_id=video.id, hashtag_id=hashtag.id))
    return video


def _append_snapshot(db: Session, video: TrendVideo, raw: RawVideo) -> None:
    collected_at = datetime.now(timezone.utc)
    engagement, metrics = engagement_rate(raw)
    db.add(
        VideoMetricSnapshot(
            video_id=video.id,
            views=raw.views,
            likes=raw.likes,
            comments=raw.comments,
            engagement_rate=engagement,
            engagement_metrics=metrics,
            source=raw.source,
            collected_at=collected_at,
        )
    )


def _score_region(db: Session, region: str, now: datetime) -> int:
    videos = (
        db.query(TrendVideo)
        .filter(TrendVideo.platform == "youtube", TrendVideo.region == region)
        .order_by(TrendVideo.last_collected_at.desc())
        .limit(max(settings.trends_max_videos_per_run * 4, 200))
        .all()
    )
    video_ids = [video.id for video in videos]
    if not video_ids:
        return 0
    associations = (
        db.query(VideoHashtag).filter(VideoHashtag.video_id.in_(video_ids)).all()
    )
    hashtag_video_ids: dict[int, set[int]] = {}
    for association in associations:
        hashtag_video_ids.setdefault(association.hashtag_id, set()).add(
            association.video_id
        )
    all_snapshots = (
        db.query(VideoMetricSnapshot)
        .filter(VideoMetricSnapshot.video_id.in_(video_ids))
        .order_by(VideoMetricSnapshot.collected_at.asc())
        .all()
    )
    snapshots_by_video: dict[int, list[VideoMetricSnapshot]] = {}
    for snapshot in all_snapshots:
        snapshots_by_video.setdefault(snapshot.video_id, []).append(snapshot)
    videos_by_id = {video.id: video for video in videos}
    hashtag_ids = list(hashtag_video_ids)
    hashtag_rows = db.query(Hashtag).filter(Hashtag.id.in_(hashtag_ids)).all()
    hashtag_by_id = {item.id: item for item in hashtag_rows}
    raw_rows: list[dict] = []
    for hashtag_id, tagged_video_ids in hashtag_video_ids.items():
        tagged_videos = [
            videos_by_id[video_id]
            for video_id in tagged_video_ids
            if video_id in videos_by_id
        ]
        velocities: list[float | None] = []
        accelerations: list[float | None] = []
        engagements: list[float | None] = []
        recent_count = 0
        prior_count = 0
        recencies: list[float | None] = []
        snapshot_counts = []
        for video in tagged_videos:
            snapshots = snapshots_by_video.get(video.id, [])
            snapshot_counts.append(len(snapshots))
            if len(snapshots) >= 2:
                velocities.append(view_velocity(snapshots[-2], snapshots[-1]))
            if len(snapshots) >= 3:
                accelerations.append(view_acceleration(snapshots))
            if snapshots:
                engagements.append(snapshots[-1].engagement_rate)
            if video.first_seen_at:
                age = (now - video.first_seen_at).total_seconds()
                if 0 <= age <= 86400:
                    recent_count += 1
                elif 86400 < age <= 172800:
                    prior_count += 1
            recencies.append(
                recency_score(
                    video.published_at, now, settings.trends_recency_half_life_days
                )
            )
        usage_growth = ((recent_count - prior_count) / max(prior_count, 1)) * 100
        raw_rows.append(
            {
                "hashtag_id": hashtag_id,
                "display": hashtag_by_id[hashtag_id].display,
                "sample_size": len(tagged_videos),
                "distinct_channels": len(
                    {video.channel_id for video in tagged_videos if video.channel_id}
                ),
                "velocity": median_or_none(velocities),
                "acceleration": median_or_none(accelerations),
                "usage_growth": usage_growth,
                "engagement": median_or_none(engagements),
                "recency": median_or_none(recencies),
                "snapshots_per_video": snapshot_counts,
            }
        )
    scored = score_sample_rows(raw_rows)
    saved = 0
    for row in scored:
        stage = classify_stage(
            row["sample_size"],
            row["snapshots_per_video"],
            row["velocity"],
            row["acceleration"],
            row["usage_growth"],
        )
        db.add(
            TrendScore(
                hashtag_id=row["hashtag_id"],
                platform="youtube",
                region=region,
                score=row["score"],
                velocity=row["velocity"],
                acceleration=row["acceleration"],
                engagement=row["engagement"],
                recency=row["recency"],
                usage_growth=row["usage_growth"],
                sample_size=row["sample_size"],
                distinct_channels=row["distinct_channels"],
                stage=stage,
                reasons=row["reasons"],
                calculated_at=now,
            )
        )
        saved += 1
    return saved


def run_collection(db: Session, regions: list[str] | None = None) -> dict:
    provider = YouTubeProvider()
    regions = regions or settings.trends_region_list
    if not provider.is_configured():
        return {
            "provider": "youtube",
            "status": "not_configured",
            "detail": "YouTube not configured: add YOUTUBE_API_KEY",
        }
    if not settings.trends_youtube_derived_metrics_approved:
        return {
            "provider": "youtube",
            "status": "approval_required",
            "detail": "YouTube collection is disabled until the team has explicit approval for cross-channel aggregation and derived metrics.",
        }
    prune_expired_api_data(db)
    started = datetime.now(timezone.utc)
    max_per_region = max(
        1, ceil(settings.trends_max_videos_per_run / max(len(regions), 1))
    )
    results = []
    for region in regions:
        quota_before = provider.usage.quota_units
        job = CollectionJob(
            provider="youtube",
            kind="refresh",
            region=region,
            started_at=started,
            status="running",
        )
        db.add(job)
        db.commit()
        discovered: dict[str, RawVideo] = {}
        try:
            published_after = started - timedelta(hours=72)
            for keyword in settings.trends_keyword_list[:6]:
                remaining = max_per_region - len(discovered)
                if remaining <= 0:
                    break
                candidates = provider.discover_videos(
                    DiscoveryQuery(
                        keyword, region, published_after, max_results=min(10, remaining)
                    )
                )
                for candidate in candidates:
                    discovered.setdefault(candidate.external_id, candidate)
            discovered = dict(list(discovered.items())[:max_per_region])
            videos = provider.video_details(list(discovered))
            for external_id, candidate in discovered.items():
                detailed = videos.get(external_id, candidate)
                video = _upsert_video(db, detailed, region)
                _append_snapshot(db, video, detailed)
            db.flush()
            scores = _score_region(db, region, datetime.now(timezone.utc))
            job.status = "success"
            job.discovered = len(discovered)
            job.updated = len(discovered)
            job.quota_used = provider.usage.quota_units - quota_before
            db.commit()
            results.append(
                {
                    "region": region,
                    "status": "success",
                    "videos": len(discovered),
                    "scores": scores,
                }
            )
        except Exception as error:
            db.rollback()
            job = db.query(CollectionJob).filter(CollectionJob.id == job.id).one()
            job.status = "failed"
            job.error = str(error)[:1000]
            job.quota_used = provider.usage.quota_units - quota_before
            job.finished_at = datetime.now(timezone.utc)
            db.commit()
            results.append(
                {"region": region, "status": "failed", "error": str(error)[:200]}
            )
        job.finished_at = datetime.now(timezone.utc)
        db.commit()
    return {
        "provider": "youtube",
        "status": (
            "success"
            if all(item["status"] == "success" for item in results)
            else "partial_failure"
        ),
        "quota_used": provider.usage.quota_units,
        "results": results,
    }


def refresh_tracked_videos(db: Session, regions: list[str] | None = None) -> dict:
    provider = YouTubeProvider()
    regions = regions or settings.trends_region_list
    if not provider.is_configured():
        return {
            "provider": "youtube",
            "status": "not_configured",
            "detail": "YouTube not configured: add YOUTUBE_API_KEY",
        }
    if not settings.trends_youtube_derived_metrics_approved:
        return {
            "provider": "youtube",
            "status": "approval_required",
            "detail": "YouTube collection is disabled until the team has explicit approval for cross-channel aggregation and derived metrics.",
        }
    prune_expired_api_data(db)
    cutoff = datetime.now(timezone.utc) - timedelta(hours=72)
    total_updated = 0
    results = []
    for region in regions:
        quota_before = provider.usage.quota_units
        started = datetime.now(timezone.utc)
        job = CollectionJob(
            provider="youtube",
            kind="stats_refresh",
            region=region,
            started_at=started,
            status="running",
        )
        db.add(job)
        db.commit()
        try:
            videos = (
                db.query(TrendVideo)
                .filter(
                    TrendVideo.region == region, TrendVideo.last_collected_at >= cutoff
                )
                .order_by(TrendVideo.last_collected_at.desc())
                .limit(settings.trends_max_videos_per_run)
                .all()
            )
            details = provider.video_details([video.external_id for video in videos])
            for video in videos:
                raw = details.get(video.external_id)
                if raw is None:
                    continue
                _upsert_video(db, raw, region)
                _append_snapshot(db, video, raw)
            scores = _score_region(db, region, datetime.now(timezone.utc))
            job.status = "success"
            job.updated = len(details)
            job.quota_used = provider.usage.quota_units - quota_before
            job.finished_at = datetime.now(timezone.utc)
            db.commit()
            total_updated += len(details)
            results.append(
                {
                    "region": region,
                    "status": "success",
                    "updated": len(details),
                    "scores": scores,
                }
            )
        except Exception as error:
            db.rollback()
            failed = db.query(CollectionJob).filter(CollectionJob.id == job.id).one()
            failed.status = "failed"
            failed.error = str(error)[:1000]
            failed.quota_used = provider.usage.quota_units - quota_before
            failed.finished_at = datetime.now(timezone.utc)
            db.commit()
            results.append(
                {"region": region, "status": "failed", "error": str(error)[:200]}
            )
    return {
        "provider": "youtube",
        "status": (
            "success"
            if all(item["status"] == "success" for item in results)
            else "partial_failure"
        ),
        "quota_used": provider.usage.quota_units,
        "updated": total_updated,
        "results": results,
    }


def provider_status(db: Session) -> list[dict]:
    youtube = YouTubeProvider()
    tiktok = TikTokProvider()
    status_rows = []
    for provider in (youtube, tiktok):
        last_job = (
            db.query(CollectionJob)
            .filter(CollectionJob.provider == provider.name)
            .order_by(CollectionJob.started_at.desc())
            .first()
        )
        today = datetime.now(timezone.utc).replace(
            hour=0, minute=0, second=0, microsecond=0
        )
        quota = (
            db.query(func.coalesce(func.sum(CollectionJob.quota_used), 0))
            .filter(
                CollectionJob.provider == provider.name,
                CollectionJob.started_at >= today,
            )
            .scalar()
        )
        status_rows.append(
            {
                "provider": provider.name,
                "configured": provider.is_configured(),
                "collection_allowed": provider.name == "youtube" and settings.trends_youtube_derived_metrics_approved,
                "tracked_video_count": (
                    int(
                        db.query(func.count(TrendVideo.id))
                        .filter(TrendVideo.platform == "youtube")
                        .scalar()
                        or 0
                    )
                    if provider.name == "youtube"
                    else 0
                ),
                "healthy": last_job.status == "success" if last_job else None,
                "last_success": (
                    last_job.finished_at.isoformat()
                    if last_job
                    and last_job.status == "success"
                    and last_job.finished_at
                    else None
                ),
                "last_error": (
                    last_job.error
                    if last_job
                    else (
                        "YouTube collection is disabled pending explicit approval for cross-channel aggregation and derived metrics."
                        if provider.name == "youtube" and not settings.trends_youtube_derived_metrics_approved
                        else "YouTube not configured: add YOUTUBE_API_KEY"
                        if provider.name == "youtube" and not provider.is_configured()
                        else "No permitted official trends API is available"
                    )
                ),
                "quota_used_today": int(quota or 0),
                "capabilities": provider.capabilities().__dict__,
            }
        )
    return status_rows

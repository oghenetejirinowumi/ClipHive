from __future__ import annotations

import logging
import re
import time
from datetime import datetime, timezone
from typing import Any

import requests
from app.config import settings
from app.services.trends.providers.base import (
    DiscoveryQuery,
    ProviderCapabilities,
    ProviderUsage,
    RawStats,
    RawVideo,
)

logger = logging.getLogger(__name__)
API_ROOT = "https://www.googleapis.com/youtube/v3"


class ProviderRequestError(RuntimeError):
    pass


def parse_duration(value: str | None) -> float | None:
    if not value:
        return None
    match = re.fullmatch(r"PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?", value)
    if not match:
        return None
    hours, minutes, seconds = match.groups()
    return int(hours or 0) * 3600 + int(minutes or 0) * 60 + float(seconds or 0)


def parse_datetime(value: str | None) -> datetime | None:
    if not value:
        return None
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None


class YouTubeProvider:
    name = "youtube"

    def __init__(self, api_key: str | None = None, timeout_s: float = 10.0):
        self.api_key = api_key if api_key is not None else settings.youtube_api_key
        self.timeout_s = timeout_s
        self.usage = ProviderUsage()

    def capabilities(self) -> ProviderCapabilities:
        return ProviderCapabilities(
            regions=("NG", "US"),
            video_discovery=True,
            video_statistics=True,
            fields=(
                "title",
                "description",
                "tags",
                "published_at",
                "duration",
                "views",
                "likes",
                "comments",
            ),
        )

    def is_configured(self) -> bool:
        return bool(self.api_key)

    def _get(self, endpoint: str, params: dict[str, Any]) -> dict[str, Any]:
        if not self.is_configured():
            raise ProviderRequestError("YouTube trends aren't available yet.")
        request_params = {**params, "key": self.api_key}
        last_error = "unknown provider error"
        for attempt in range(3):
            # search.list costs 100 units per call; videos.list costs 1.
            self.usage.quota_units += 100 if endpoint == "search" else 1
            if endpoint == "search":
                self.usage.search_calls += 1
            try:
                response = requests.get(
                    f"{API_ROOT}/{endpoint}",
                    params=request_params,
                    timeout=self.timeout_s,
                )
                if response.status_code < 500 and response.status_code != 429:
                    if response.status_code >= 400:
                        error_data = response.json() if response.content else {}
                        reason = (
                            error_data.get("error", {})
                            .get("errors", [{}])[0]
                            .get("reason", "request_failed")
                        )
                        last_error = f"YouTube API {response.status_code}: {reason}"
                        raise ProviderRequestError(last_error)
                    return response.json()
                last_error = f"YouTube API {response.status_code}"
            except ProviderRequestError:
                raise
            except (requests.RequestException, ValueError) as error:
                last_error = type(error).__name__
            if attempt < 2:
                time.sleep(0.25 * (2**attempt))
        raise ProviderRequestError(last_error)

    def discover_videos(self, query: DiscoveryQuery) -> list[RawVideo]:
        data = self._get(
            "search",
            {
                "part": "snippet",
                "type": "video",
                "q": query.keyword,
                "regionCode": query.region,
                "publishedAfter": query.published_after.astimezone(timezone.utc)
                .isoformat()
                .replace("+00:00", "Z"),
                "videoDuration": "short",
                "order": "date",
                "maxResults": min(50, max(1, query.max_results)),
            },
        )
        videos: list[RawVideo] = []
        for item in data.get("items", []):
            video_id = item.get("id", {}).get("videoId")
            snippet = item.get("snippet", {})
            if not video_id:
                continue
            thumbnails = snippet.get("thumbnails", {})
            thumbnail = (
                thumbnails.get("high")
                or thumbnails.get("medium")
                or thumbnails.get("default")
                or {}
            )
            videos.append(
                RawVideo(
                    external_id=video_id,
                    title=snippet.get("title", ""),
                    description=snippet.get("description", ""),
                    channel_id=snippet.get("channelId"),
                    published_at=parse_datetime(snippet.get("publishedAt")),
                    thumbnail_url=thumbnail.get("url"),
                )
            )
        return videos

    def refresh_stats(self, external_ids: list[str]) -> list[RawStats]:
        stats: list[RawStats] = []
        for offset in range(0, len(external_ids), 50):
            ids = external_ids[offset : offset + 50]
            if not ids:
                continue
            data = self._get(
                "videos",
                {
                    "part": "snippet,statistics,contentDetails",
                    "id": ",".join(ids),
                    "maxResults": 50,
                },
            )
            by_id = {
                item["id"]: item for item in data.get("items", []) if item.get("id")
            }
            for external_id in ids:
                item = by_id.get(external_id)
                if not item:
                    continue
                snippet = item.get("snippet", {})
                statistics = item.get("statistics", {})
                details = item.get("contentDetails", {})
                stats.append(
                    RawStats(
                        external_id=external_id,
                        views=_int_or_none(statistics.get("viewCount")),
                        likes=_int_or_none(statistics.get("likeCount")),
                        comments=_int_or_none(statistics.get("commentCount")),
                        collected_at=datetime.now(timezone.utc),
                    )
                )
        return stats

    def video_details(self, external_ids: list[str]) -> dict[str, RawVideo]:
        videos: dict[str, RawVideo] = {}
        for offset in range(0, len(external_ids), 50):
            ids = external_ids[offset : offset + 50]
            if not ids:
                continue
            data = self._get(
                "videos",
                {
                    "part": "snippet,contentDetails,statistics",
                    "id": ",".join(ids),
                    "maxResults": 50,
                },
            )
            for item in data.get("items", []):
                snippet = item.get("snippet", {})
                details = item.get("contentDetails", {})
                thumbnails = snippet.get("thumbnails", {})
                thumbnail = (
                    thumbnails.get("high")
                    or thumbnails.get("medium")
                    or thumbnails.get("default")
                    or {}
                )
                statistics = item.get("statistics", {})
                videos[item["id"]] = RawVideo(
                    external_id=item["id"],
                    title=snippet.get("title", ""),
                    description=snippet.get("description", ""),
                    channel_id=snippet.get("channelId"),
                    published_at=parse_datetime(snippet.get("publishedAt")),
                    duration_s=parse_duration(details.get("duration")),
                    tags=tuple(snippet.get("tags") or []),
                    thumbnail_url=thumbnail.get("url"),
                    views=_int_or_none(statistics.get("viewCount")),
                    likes=_int_or_none(statistics.get("likeCount")),
                    comments=_int_or_none(statistics.get("commentCount")),
                )
        return videos

    def official_trends(self, region: str) -> list:
        return []


def _int_or_none(value: Any) -> int | None:
    try:
        return int(value) if value is not None else None
    except (TypeError, ValueError):
        return None

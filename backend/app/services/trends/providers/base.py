from dataclasses import dataclass, field
from datetime import datetime
from typing import Protocol


@dataclass(frozen=True)
class ProviderCapabilities:
    regions: tuple[str, ...] = ()
    video_discovery: bool = False
    video_statistics: bool = False
    official_trends: bool = False
    fields: tuple[str, ...] = ()


@dataclass(frozen=True)
class DiscoveryQuery:
    keyword: str
    region: str
    published_after: datetime
    max_results: int = 10


@dataclass(frozen=True)
class RawVideo:
    external_id: str
    title: str
    description: str = ""
    channel_id: str | None = None
    published_at: datetime | None = None
    duration_s: float | None = None
    tags: tuple[str, ...] = ()
    thumbnail_url: str | None = None
    views: int | None = None
    likes: int | None = None
    comments: int | None = None
    source: str = "youtube_data_api"


@dataclass(frozen=True)
class RawStats:
    external_id: str
    views: int | None = None
    likes: int | None = None
    comments: int | None = None
    collected_at: datetime | None = None
    source: str = "youtube_data_api"


@dataclass(frozen=True)
class RawTrend:
    hashtag: str
    region: str
    score: float | None = None
    source: str = ""


class TrendProvider(Protocol):
    name: str

    def capabilities(self) -> ProviderCapabilities: ...

    def is_configured(self) -> bool: ...

    def discover_videos(self, query: DiscoveryQuery) -> list[RawVideo]: ...

    def refresh_stats(self, external_ids: list[str]) -> list[RawStats]: ...

    def official_trends(self, region: str) -> list[RawTrend]: ...


@dataclass
class ProviderUsage:
    quota_units: int = 0
    search_calls: int = 0
    errors: list[str] = field(default_factory=list)

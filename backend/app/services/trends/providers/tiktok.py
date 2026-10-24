from app.services.trends.providers.base import DiscoveryQuery, ProviderCapabilities


class TikTokProvider:
    name = "tiktok"

    def capabilities(self) -> ProviderCapabilities:
        return ProviderCapabilities()

    def is_configured(self) -> bool:
        return False

    def discover_videos(self, query: DiscoveryQuery) -> list:
        return []

    def refresh_stats(self, external_ids: list[str]) -> list:
        return []

    def official_trends(self, region: str) -> list:
        return []

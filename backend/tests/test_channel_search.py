"""Channel search suggestions: parsing each platform's answer, caching and failures (no network)."""
import json

import pytest
import requests

from app.config import settings
from app.models.enums import SourcePlatform
from app.services.ingest import channel_search


class _Resp:
    def __init__(self, payload=None, text=None, status=200):
        self._payload, self.text, self.status_code = payload, text or "", status

    def raise_for_status(self):
        if self.status_code >= 400:
            raise requests.HTTPError(str(self.status_code))

    def json(self):
        return self._payload


@pytest.fixture(autouse=True)
def fresh(monkeypatch):
    channel_search._cache.clear()
    monkeypatch.setattr(settings, "twitch_client_id", "")
    monkeypatch.setattr(settings, "twitch_client_secret", "")


def test_twitch_uses_the_public_endpoint_without_keys(monkeypatch):
    calls = []

    def post(url, json=None, headers=None, timeout=None):
        calls.append((url, json["variables"], headers["Client-Id"]))
        return _Resp({"data": {"searchFor": {"channels": {"items": [
            {"login": "kaicenat", "displayName": "KaiCenat", "profileImageURL": "https://static-cdn.jtvnw.net/p.png",
             "followers": {"totalCount": 21_000_000}, "stream": None},
            {"login": "kai", "displayName": "Kai", "profileImageURL": "https://evil.example/x.png", "followers": {"totalCount": 5},
             "stream": {"viewersCount": 12}},
        ]}}}})

    monkeypatch.setattr(channel_search.requests, "post", post)
    rows = channel_search.search(SourcePlatform.TWITCH, "Kai")
    assert calls == [("https://gql.twitch.tv/gql", {"q": "Kai", "n": 8}, channel_search.TWITCH_WEB_CLIENT_ID)]
    assert rows[0] == {"username": "kaicenat", "display_name": "KaiCenat", "avatar_url": "https://static-cdn.jtvnw.net/p.png",
                       "followers": 21_000_000, "followers_text": None, "live": False, "viewers": None}
    assert rows[1]["live"] is True and rows[1]["viewers"] == 12
    assert rows[1]["avatar_url"] is None  # only the platform's own image hosts are passed through


def test_kick_parses_slugs_and_followers(monkeypatch):
    monkeypatch.setattr(channel_search.requests, "get", lambda *a, **k: _Resp({"channels": [
        {"slug": "adinross", "followers_count": 2_697_942, "isLive": False, "user": {"username": "AdinRoss", "profile_pic": "https://files.kick.com/a.webp"}},
        {"slug": "", "user": {}},  # no slug: skipped
    ]}))
    rows = channel_search.search(SourcePlatform.KICK, "adin")
    assert [(r["username"], r["display_name"], r["followers"], r["live"]) for r in rows] == [("adinross", "AdinRoss", 2_697_942, False)]


def test_youtube_reads_handles_from_the_results_page(monkeypatch):
    data = {"contents": [{"channelRenderer": {
        "title": {"simpleText": "Marques Brownlee"},
        "subscriberCountText": {"simpleText": "@mkbhd"},
        "videoCountText": {"simpleText": "21.4M subscribers"},
        "thumbnail": {"thumbnails": [{"url": "//yt3.ggpht.com/abc=s88"}]},
        "navigationEndpoint": {"browseEndpoint": {"canonicalBaseUrl": "/@mkbhd"}},
    }}, {"channelRenderer": {"title": {"simpleText": "Old channel"}, "navigationEndpoint": {"browseEndpoint": {"canonicalBaseUrl": "/channel/UC123"}}}}]}
    page = f"<script>var ytInitialData = {json.dumps(data)};</script>"
    monkeypatch.setattr(channel_search.requests, "get", lambda *a, **k: _Resp(text=page))
    rows = channel_search.search(SourcePlatform.YOUTUBE, "@mkbhd")
    assert rows == [{"username": "mkbhd", "display_name": "Marques Brownlee", "avatar_url": "https://yt3.ggpht.com/abc=s88",
                     "followers": None, "followers_text": "21.4M subscribers", "live": None, "viewers": None}]


def test_short_queries_skip_the_network_and_repeats_are_cached(monkeypatch):
    hits = []
    monkeypatch.setattr(channel_search.requests, "get", lambda *a, **k: hits.append(1) or _Resp({"channels": []}))
    assert channel_search.search(SourcePlatform.KICK, "a") == []
    channel_search.search(SourcePlatform.KICK, "abc")
    channel_search.search(SourcePlatform.KICK, "ABC")
    assert len(hits) == 1


def test_platform_failure_is_a_search_error(monkeypatch):
    monkeypatch.setattr(channel_search.requests, "get", lambda *a, **k: _Resp(status=503))
    with pytest.raises(channel_search.SearchError):
        channel_search.search(SourcePlatform.KICK, "abc")

"""Per-clip social search. Uses a fake search function, so no network calls."""

from __future__ import annotations

import app.models  # noqa: F401  (registers all tables)
import pytest
from app.api import clips as clips_api
from app.api.deps import get_owner
from app.config import settings
from app.db import Base, get_db
from app.models.clip import Clip
from app.models.user import User
from app.services.trends import social_search
from app.services.trends.social_search import (
    ScrapedVideo,
    SocialSearchUnavailable,
    build_queries,
    find_social_trends,
    is_on_topic,
)
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool


def video(i: int, title: str, views: int, description: str = "", duration: float | None = 30):
    return ScrapedVideo(
        id=f"v{i}", title=title, description=description, view_count=views, duration_s=duration,
        url=f"https://www.youtube.com/shorts/v{i}",
    )


VALORANT_FEED = [
    video(1, "IMPOSSIBLE 1v4 Jett clutch 🔥🥶 #valorant #valorantclips #shorts", 900_000),
    video(2, "INSANE Sova lineup clutch 😱 #valorant #sova #clutch", 400_000),
    video(3, "Reyna ACE on Ascent 🔥 #valorant #valorantclips #fyp", 250_000),
    video(4, "This Valorant clutch is UNREAL #valorant #clutch #shorts", 120_000),
    video(5, "Valorant 1v5 ace 💀 #valorant #vct", 80_000, description="#valorantclips #vct"),
    # Feed spam: only mentions the topic in hashtags.
    video(6, "she left me 💔 #breakup #single #valorant #viral", 5_000_000),
    video(7, "guitar cover #couple #single #valorant", 3_000_000),
    # Long video: not short-form.
    video(8, "Valorant clutch compilation #valorant", 2_000_000, duration=900),
]


def fake_search(results: dict[str, list[ScrapedVideo]]):
    calls: list[str] = []

    def search(query: str, limit: int) -> list[ScrapedVideo]:
        calls.append(query)
        if query not in results:
            raise RuntimeError("network down")
        return results[query]

    search.calls = calls  # type: ignore[attr-defined]
    return search


@pytest.fixture(autouse=True)
def fresh_cache():
    social_search.clear_cache()
    yield
    social_search.clear_cache()


def test_queries_use_hashtag_feeds_keyword_search_and_creator():
    assert build_queries("Valorant", "clutch", "TenZ") == [
        "#valorant",
        "#valorantclutch",
        "Valorant clutch #shorts",
        "TenZ Valorant #shorts",
    ]
    assert build_queries("Call of Duty: Warzone", "rage_quit", None)[:2] == ["#warzone", "#warzonerage"]
    # Generic context falls back to the clip title's first content word.
    assert build_queries("General Gaming", "highlight", None, "Fortnite ranked · Clip 2") == [
        "#fortnite",
        "Fortnite highlights #shorts",
    ]


def test_feed_spam_is_not_on_topic():
    terms = {"valorant", "jett", "sova"}
    assert is_on_topic(VALORANT_FEED[0], terms)
    assert not is_on_topic(VALORANT_FEED[5], terms)


def test_ranks_relevant_hashtags_and_suggests_captions():
    search = fake_search({"#valorant": VALORANT_FEED, "#valorantclutch": VALORANT_FEED[:3]})
    result = find_social_trends(
        game_or_topic="Valorant",
        event_type="clutch",
        creator="TenZ",
        topic_keywords=["jett", "sova", "reyna"],
        platform="tiktok",
        search_fn=search,
        detail_fn=None,
    )
    tags = [h.tag for h in result.hashtags]
    assert tags[0] == "#valorant"
    assert "#valorantclips" in tags and "#clutch" in tags
    # Spam and long-video tags are excluded.
    assert "#breakup" not in tags and "#single" not in tags
    assert result.videos_scanned == 5
    assert result.recommended_hashtags[0] == "#valorant"
    assert "#fyp" in result.recommended_hashtags
    # Two searches failed but the rest succeeded.
    assert len(result.warnings) == 2

    assert result.patterns.emoji_percent >= 50
    assert "impossible" in result.patterns.hook_words
    texts = [c.text for c in result.captions]
    assert any("Valorant clutch" in t or "VALORANT CLUTCH" in t for t in texts)
    assert any("TenZ" in t or "TENZ" in t for t in texts)
    assert result.examples[0].view_count == 900_000


def test_details_add_full_description_tags():
    search = fake_search({"#minecraft": [video(1, "Minecraft creeper fail 😂 #minecraft", 1000)] * 1})

    def details(v: ScrapedVideo):
        return "full text #minecraftfunny #minecraft", ["minecraft memes", "creeper"]

    result = find_social_trends(
        game_or_topic="Minecraft", event_type=None, creator=None,
        search_fn=search, detail_fn=details,
    )
    tags = {h.tag for h in result.hashtags}
    assert {"#minecraft", "#minecraftfunny", "#minecraftmemes"} <= tags


def test_results_are_cached_until_refresh():
    search = fake_search({"#valorant": VALORANT_FEED})
    kwargs = dict(game_or_topic="Valorant", event_type=None, creator=None, search_fn=search, detail_fn=None)
    feed_calls = lambda: search.calls.count("#valorant")  # noqa: E731
    find_social_trends(**kwargs)
    assert feed_calls() == 1
    find_social_trends(**kwargs)
    assert feed_calls() == 1  # served from cache
    find_social_trends(refresh=True, **kwargs)
    assert feed_calls() == 2
    # Failed searches aren't cached, so they're retried next time.
    assert search.calls.count("Valorant highlights #shorts") == 3


def test_all_searches_failing_raises():
    with pytest.raises(SocialSearchUnavailable):
        find_social_trends(
            game_or_topic="Valorant", event_type="clutch", creator=None,
            search_fn=fake_search({}), detail_fn=None,
        )


def test_endpoint_returns_and_caches_trends_without_changing_clip(monkeypatch):
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(engine)
    factory = sessionmaker(bind=engine, expire_on_commit=False)
    monkeypatch.setattr(settings, "openai_api_key", "")
    monkeypatch.setattr(settings, "social_search_enabled", True)  # off by default (scrapes YouTube)

    with factory() as db:
        clip = Clip(
            user_id=1, start_s=0, end_s=12, title="Ranked night · Clip 1",
            transcript_json=[{"word": "valorant", "start": 0, "end": 0.5}, {"word": "clutch", "start": 0.5, "end": 1}],
            hashtags=["#old"],
        )
        db.add(clip)
        db.commit()
        clip_id = clip.id

    calls = []

    def fake_find(**kwargs):
        calls.append(kwargs)
        return find_social_trends(
            **{**kwargs, "search_fn": fake_search({"#valorant": VALORANT_FEED}), "detail_fn": None}
        )

    monkeypatch.setattr(clips_api, "find_social_trends", fake_find)

    app = FastAPI()
    app.include_router(clips_api.router, prefix="/api")

    def override_db():
        with factory() as db:
            yield db

    app.dependency_overrides[get_db] = override_db
    app.dependency_overrides[get_owner] = lambda: User(id=1, email="test@cliphive.ai", password_hash="x")
    client = TestClient(app)

    res = client.get(f"/api/clips/{clip_id}/social-trends")
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["context"]["game_or_topic"] == "Valorant"
    assert body["recommended_hashtags"][0] == "#valorant"
    assert body["current_title"] == "Ranked night · Clip 1"
    assert body["current_hashtags"] == ["#old"]
    assert calls[0]["topic_keywords"]  # Valorant signature words passed through

    # Second call is served from the clip's saved result.
    assert client.get(f"/api/clips/{clip_id}/social-trends").status_code == 200
    assert len(calls) == 1
    client.get(f"/api/clips/{clip_id}/social-trends?refresh=true")
    assert len(calls) == 2

    assert client.get("/api/clips/9999/social-trends").status_code == 404
    engine.dispose()

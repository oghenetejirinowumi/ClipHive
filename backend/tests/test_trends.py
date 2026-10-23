from __future__ import annotations

import json
from datetime import datetime, timedelta, timezone
from pathlib import Path
from types import SimpleNamespace

import app.models
import pytest
from app.config import settings
from app.db import Base
from app.models.clip import Clip
from app.models.trend_data import Hashtag, TrendScore, TrendVideo, VideoMetricSnapshot
from app.services.ai.context_engine import extract_clip_context
from app.services.ai.viral_studio import generate_viral_metadata
from app.services.trends.collection import (
    _append_snapshot,
    _upsert_video,
    run_collection,
)
from app.services.trends.providers import DiscoveryQuery, YouTubeProvider
from app.services.trends.providers.base import RawVideo
from app.services.trends.providers.youtube import ProviderRequestError
from app.services.trends.queries import match_clip_to_trends
from app.services.trends.trend_engine import (
    ScoreWeights,
    classify_stage,
    engagement_rate,
    extract_hashtags,
    normalize_hashtag,
    score_sample_rows,
    view_acceleration,
    view_velocity,
)
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

FIXTURES = Path(__file__).parent / "fixtures"


@pytest.fixture
def db() -> Session:
    engine = create_engine(
        "sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool
    )
    Base.metadata.create_all(engine)
    factory = sessionmaker(bind=engine, expire_on_commit=False)
    session = factory()
    try:
        yield session
    finally:
        session.close()
        Base.metadata.drop_all(engine)
        engine.dispose()


def fixture_json(name: str) -> dict:
    return json.loads((FIXTURES / name).read_text(encoding="utf-8"))


class FakeResponse:
    def __init__(self, status_code: int, data: dict):
        self.status_code = status_code
        self.data = data
        self.content = json.dumps(data).encode()

    def json(self) -> dict:
        return self.data


def test_hashtag_extraction_normalizes_case_unicode_and_duplicates():
    tags = extract_hashtags(["#Caf\u00e9, #CAF\u00c9! #valorant", "again #cafe\u0301."])
    assert tags == [("caf\u00e9", "Caf\u00e9"), ("valorant", "valorant")]
    assert normalize_hashtag("  ##Valorant!!! ") == "valorant"


def test_velocity_rejects_missing_zero_elapsed_and_decreasing_views():
    now = datetime.now(timezone.utc)
    before = SimpleNamespace(views=100, collected_at=now)
    after = SimpleNamespace(views=300, collected_at=now + timedelta(hours=2))
    assert view_velocity(before, after) == 100
    assert view_velocity(before, SimpleNamespace(views=300, collected_at=now)) is None
    assert (
        view_velocity(
            before, SimpleNamespace(views=80, collected_at=now + timedelta(hours=1))
        )
        is None
    )
    assert view_velocity(SimpleNamespace(views=None, collected_at=now), after) is None


def test_engagement_uses_only_available_metrics_and_acceleration_requires_three():
    now = datetime.now(timezone.utc)
    assert engagement_rate(SimpleNamespace(views=100, likes=5, comments=None)) == (
        5.0,
        ["likes"],
    )
    assert engagement_rate(SimpleNamespace(views=0, likes=5, comments=2)) == (None, [])
    snapshots = [
        SimpleNamespace(views=100, collected_at=now),
        SimpleNamespace(views=200, collected_at=now + timedelta(hours=1)),
        SimpleNamespace(views=500, collected_at=now + timedelta(hours=2)),
    ]
    assert view_acceleration(snapshots) == 200
    assert view_acceleration(snapshots[:2]) is None


def test_score_normalization_weights_and_stage_rules():
    rows = [
        {
            "sample_size": 4,
            "velocity": 10.0,
            "acceleration": 1.0,
            "usage_growth": 10.0,
            "engagement": 2.0,
            "recency": 0.2,
            "snapshots_per_video": [2, 2, 2, 2],
        },
        {
            "sample_size": 7,
            "velocity": 30.0,
            "acceleration": 3.0,
            "usage_growth": 40.0,
            "engagement": 8.0,
            "recency": 0.8,
            "snapshots_per_video": [2, 2, 2, 2, 2, 2, 2],
        },
    ]
    scored = score_sample_rows(rows, ScoreWeights())
    assert scored[0]["score"] == 0
    assert scored[1]["score"] == 100
    assert 1 <= len(scored[0]["reasons"]) <= 3
    assert classify_stage(3, [2, 2, 2], 20, 0, 40) == "emerging"
    assert classify_stage(7, [2] * 7, 20, 3, 10) == "accelerating"
    assert classify_stage(2, [2, 2], 20, 3, 10) == "insufficient_data"


def test_youtube_provider_parses_recorded_search_and_details(monkeypatch):
    responses = [
        FakeResponse(200, fixture_json("youtube_search.json")),
        FakeResponse(200, fixture_json("youtube_video_details.json")),
    ]
    requests_seen = []

    def fake_get(url, params, timeout):
        requests_seen.append((url, params, timeout))
        return responses.pop(0)

    monkeypatch.setattr("app.services.trends.providers.youtube.requests.get", fake_get)
    provider = YouTubeProvider(api_key="fixture-key")
    query = DiscoveryQuery(
        "Valorant", "NG", datetime(2026, 10, 20, tzinfo=timezone.utc), max_results=5
    )
    candidates = provider.discover_videos(query)
    details = provider.video_details([candidates[0].external_id])
    video = details["yt_fixture_01"]
    assert candidates[0].external_id == "yt_fixture_01"
    assert requests_seen[0][1]["regionCode"] == "NG"
    assert requests_seen[0][1]["videoDuration"] == "short"
    assert video.duration_s == 58
    assert video.views == 12000 and video.likes == 900 and video.comments == 42
    assert provider.usage.search_calls == 1
    assert provider.usage.quota_units == 101


def test_youtube_provider_quota_and_server_errors(monkeypatch):
    quota = FakeResponse(403, fixture_json("youtube_quota_exceeded.json"))
    monkeypatch.setattr(
        "app.services.trends.providers.youtube.requests.get",
        lambda *args, **kwargs: quota,
    )
    provider = YouTubeProvider(api_key="fixture-key")
    with pytest.raises(ProviderRequestError, match="quotaExceeded"):
        provider.discover_videos(
            DiscoveryQuery("games", "NG", datetime.now(timezone.utc))
        )
    assert provider.usage.quota_units == 100

    attempts = []
    failure = FakeResponse(503, fixture_json("youtube_server_error.json"))
    monkeypatch.setattr(
        "app.services.trends.providers.youtube.requests.get",
        lambda *args, **kwargs: attempts.append(1) or failure,
    )
    monkeypatch.setattr(
        "app.services.trends.providers.youtube.time.sleep", lambda _: None
    )
    provider = YouTubeProvider(api_key="fixture-key")
    with pytest.raises(ProviderRequestError, match="503"):
        provider.discover_videos(
            DiscoveryQuery("games", "US", datetime.now(timezone.utc))
        )
    assert len(attempts) == 3
    assert provider.usage.quota_units == 300


def test_unconfigured_and_unapproved_collection_never_call_network(
    db: Session, monkeypatch
):
    monkeypatch.setattr(settings, "youtube_api_key", "")
    monkeypatch.setattr(settings, "trends_youtube_derived_metrics_approved", False)
    monkeypatch.setattr(
        "app.services.trends.providers.youtube.requests.get",
        lambda *args, **kwargs: pytest.fail("network should not be called"),
    )
    assert run_collection(db)["status"] == "not_configured"
    monkeypatch.setattr(settings, "youtube_api_key", "fixture-key")
    result = run_collection(db)
    assert result["status"] == "approval_required"
    assert db.query(TrendVideo).count() == 0


def test_upsert_is_idempotent_and_each_refresh_appends_snapshot(db: Session):
    raw = RawVideo(
        external_id="stable_id",
        title="Valorant clutch #Shorts",
        description="#Gaming",
        channel_id="creator",
        published_at=datetime.now(timezone.utc),
        duration_s=45,
        views=100,
        likes=10,
        comments=2,
    )
    first = _upsert_video(db, raw, "NG")
    _append_snapshot(db, first, raw)
    db.commit()
    second = _upsert_video(db, raw, "NG")
    _append_snapshot(db, second, raw)
    db.commit()
    assert db.query(TrendVideo).count() == 1
    assert db.query(VideoMetricSnapshot).filter_by(video_id=first.id).count() == 2


def test_trend_match_uses_sample_transcript_fixture(db: Session):
    fixture_path = (
        Path(__file__).resolve().parents[2] / "tests/fixtures/sample_transcript.json"
    )
    transcript = json.loads(fixture_path.read_text(encoding="utf-8"))
    hashtag = Hashtag(normalized="house", display="#house")
    db.add(hashtag)
    db.flush()
    db.add(
        TrendScore(
            hashtag_id=hashtag.id,
            platform="youtube",
            region="NG",
            score=72,
            sample_size=4,
            distinct_channels=3,
            stage="accelerating",
            reasons=["Usage is up"],
            source="youtube_data_api",
        )
    )
    db.commit()
    clip = SimpleNamespace(id=12, title="A stream story", transcript_json=transcript)
    matches = match_clip_to_trends(db, clip, "youtube", "NG")
    assert matches[0]["hashtag"] == "#house"
    assert "mentions a matching term" in matches[0]["reason"]


def test_context_and_viral_studio_work_without_keys_or_trends(db: Session, monkeypatch):
    monkeypatch.setattr(settings, "openai_api_key", "")
    fixture_path = (
        Path(__file__).resolve().parents[2] / "tests/fixtures/sample_transcript.json"
    )
    transcript = json.loads(fixture_path.read_text(encoding="utf-8"))
    clip = Clip(
        user_id=1,
        start_s=0,
        end_s=10,
        raw_file_path=None,
        title="Stream story",
        transcript_json=transcript,
    )
    context = extract_clip_context(clip, db, platform="youtube")
    metadata = generate_viral_metadata(transcript, platform="youtube")
    assert context.matched_hashtags
    assert context.ai_generated is False
    assert context.hashtag_sources
    assert metadata.title and metadata.hashtags

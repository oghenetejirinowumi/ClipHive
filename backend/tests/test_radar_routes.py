from __future__ import annotations

import pytest
from app.api.deps import get_current_user
from app.db import Base, get_db
from app.main import app
from app.models.user import User
from app.services.trends import radar as clip_radar
from app.services.trends.radar import Radar
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool


@pytest.fixture
def test_db():
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(engine)
    factory = sessionmaker(bind=engine, expire_on_commit=False)
    session = factory()
    user = User(id=1, email="radar@example.com", password_hash="pw", name="Radar Tester")
    session.add(user)
    session.commit()
    try:
        yield session
    finally:
        session.close()
        Base.metadata.drop_all(engine)
        engine.dispose()


@pytest.fixture
def client(test_db: Session, monkeypatch):
    test_user = test_db.query(User).filter(User.id == 1).first()
    app.dependency_overrides[get_db] = lambda: test_db
    app.dependency_overrides[get_current_user] = lambda: test_user
    empty_radar = Radar(
        generated_at="2026-10-24T10:00:00Z",
        sources=[],
        topics=[],
        creators=[],
        clips=[],
        insights={"sample_size": 0, "median_duration_s": None, "under_60s_pct": None, "caps_title_pct": 0, "emoji_title_pct": 0, "median_title_words": None, "common_words": []},
    )
    monkeypatch.setattr(clip_radar, "get_radar", lambda *args, **kwargs: empty_radar)
    with TestClient(app) as c:
        yield c
    app.dependency_overrides.clear()


def test_api_trends_radar(client: TestClient):
    res = client.get("/api/trends/radar")
    assert res.status_code == 200
    assert "generated_at" in res.json()


def test_api_trends_radar_suggestions(client: TestClient):
    res = client.get("/api/trends/radar/suggestions")
    assert res.status_code == 200
    assert "items" in res.json()


def test_api_radar_alias(client: TestClient):
    res = client.get("/api/radar")
    assert res.status_code == 200
    assert "generated_at" in res.json()


def test_api_radar_suggestions_alias(client: TestClient):
    res = client.get("/api/radar/suggestions")
    assert res.status_code == 200
    assert "items" in res.json()


def test_root_radar_redirect(client: TestClient):
    res = client.get("/radar", follow_redirects=False)
    assert res.status_code == 307
    assert res.headers["location"] == "/api/trends/radar"

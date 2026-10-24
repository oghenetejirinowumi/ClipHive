from __future__ import annotations

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

import app.models  # noqa: F401
from app.api import clips as clips_api
from app.api.deps import get_owner
from app.db import Base, get_db
from app.models.clip import Clip
from app.models.enums import CaptionMode, ClipStatus
from app.models.user import User


@pytest.fixture
def db_session():
    engine = create_engine(
        "sqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(bind=engine)
    Session = sessionmaker(bind=engine)
    session = Session()
    try:
        yield session
    finally:
        session.close()


@pytest.fixture
def test_setup(db_session):
    user = User(
        email="transcriber@test.local",
        password_hash="mock",
    )
    db_session.add(user)
    db_session.commit()
    db_session.refresh(user)

    test_app = FastAPI()
    test_app.include_router(clips_api.router, prefix="/api")
    test_app.dependency_overrides[get_owner] = lambda: user
    test_app.dependency_overrides[get_db] = lambda: db_session
    client = TestClient(test_app)
    return client, user, db_session


def test_clip_transcript_crud(test_setup):
    client, user, db_session = test_setup

    words = [
        {"word": "Hello", "start": 0.0, "end": 0.5, "confidence": 0.95},
        {"word": "World", "start": 0.5, "end": 1.0, "confidence": 0.98},
    ]

    clip = Clip(
        user_id=user.id,
        start_s=0.0,
        end_s=1.0,
        title="Test Clip",
        status=ClipStatus.READY,
        caption_mode=CaptionMode.PLATFORM_NATIVE,
        transcript_json=words,
    )
    db_session.add(clip)
    db_session.commit()
    db_session.refresh(clip)

    # 1. Fetch transcript
    res = client.get(f"/api/clips/{clip.id}/transcript")
    assert res.status_code == 200
    data = res.json()
    assert data["clip_id"] == clip.id
    assert data["text"] == "Hello World"
    assert len(data["words"]) == 2

    # 2. Update transcript words
    new_words = [
        {"word": "Hello", "start": 0.0, "end": 0.5, "confidence": 0.99},
        {"word": "Everyone", "start": 0.5, "end": 1.2, "confidence": 0.99},
    ]
    patch_res = client.patch(f"/api/clips/{clip.id}/transcript", json={"words": new_words})
    assert patch_res.status_code == 200
    updated_data = patch_res.json()
    assert updated_data["text"] == "Hello Everyone"
    assert updated_data["count"] == 2

    # 3. Update transcript text only (re-splits words)
    text_res = client.patch(f"/api/clips/{clip.id}/transcript", json={"text": "Quick brown fox"})
    assert text_res.status_code == 200
    text_data = text_res.json()
    assert text_data["text"] == "Quick brown fox"
    assert text_data["count"] == 3


def test_auto_transcription_on_empty(test_setup, monkeypatch, tmp_path):
    client, user, db_session = test_setup

    # Create dummy raw file
    fake_video = tmp_path / "raw.mp4"
    fake_video.write_bytes(b"dummy video data")

    from app.schemas.clip import TranscriptWord
    fake_words = [
        TranscriptWord(word="Automatic", start=0.0, end=0.6, confidence=0.9),
        TranscriptWord(word="Whisper", start=0.6, end=1.2, confidence=0.9),
    ]

    monkeypatch.setattr("app.api.clips.transcribe_video", lambda p: fake_words)

    clip = Clip(
        user_id=user.id,
        start_s=0.0,
        end_s=1.2,
        title="Untranscribed Clip",
        status=ClipStatus.READY,
        caption_mode=CaptionMode.PLATFORM_NATIVE,
        raw_file_path=str(fake_video),
        transcript_json=None,
    )
    db_session.add(clip)
    db_session.commit()
    db_session.refresh(clip)

    res = client.get(f"/api/clips/{clip.id}/transcript")
    assert res.status_code == 200
    data = res.json()
    assert data["text"] == "Automatic Whisper"
    assert data["count"] == 2

    # Check that it's persisted in DB
    db_session.refresh(clip)
    assert clip.transcript_json is not None
    assert len(clip.transcript_json) == 2

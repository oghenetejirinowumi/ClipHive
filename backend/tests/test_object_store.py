"""S3 media storage (app.core.object_store) against moto's in-memory S3."""
from __future__ import annotations

import os
import time
from pathlib import Path

import pytest

pytest.importorskip("moto")
from moto import mock_aws  # noqa: E402

from app.config import settings  # noqa: E402
from app.core import media, object_store  # noqa: E402

BUCKET = "cliphive-test"


@pytest.fixture
def s3(tmp_path, monkeypatch):
    monkeypatch.setenv("AWS_ACCESS_KEY_ID", "test")
    monkeypatch.setenv("AWS_SECRET_ACCESS_KEY", "test")
    monkeypatch.setattr(settings, "storage_dir", str(tmp_path / "storage"))
    monkeypatch.setattr(settings, "s3_bucket", BUCKET)
    monkeypatch.setattr(settings, "s3_region", "us-east-1")
    monkeypatch.setattr(settings, "s3_prefix", "storage")
    monkeypatch.setattr(settings, "s3_endpoint_url", "")
    monkeypatch.setattr(settings, "s3_public_base_url", "")
    monkeypatch.setattr(object_store, "SETTLE_S", 0.0)
    for cache in (object_store._synced, object_store._missing, object_store._last_used, object_store._queued):
        cache.clear()
    with mock_aws():
        object_store._client = None
        object_store.client().create_bucket(Bucket=BUCKET)
        yield object_store.client()
    object_store._client = None


def _write(rel: str, data: bytes = b"video bytes") -> Path:
    path = media.storage_root() / rel
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(data)
    old = time.time() - 60  # settled, so the uploader doesn't wait
    os.utime(path, (old, old))
    return path


def _wait_uploaded(key: str, timeout: float = 10) -> None:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if key in object_store._synced and key not in object_store._queued:
            return
        time.sleep(0.05)
    raise AssertionError(f"{key} was never uploaded")


def _keys(client) -> list[str]:
    return [o["Key"] for o in client.list_objects_v2(Bucket=BUCKET).get("Contents") or []]


def test_public_path_uploads_once_and_reuploads_changes(s3):
    path = _write("clips/clip_1.mp4")
    assert media.public_path(path) == "storage/clips/clip_1.mp4"
    _wait_uploaded("storage/clips/clip_1.mp4")
    head = s3.head_object(Bucket=BUCKET, Key="storage/clips/clip_1.mp4")
    assert head["ContentType"] == "video/mp4"
    assert not list((media.storage_root() / object_store.PENDING_DIR).glob("*"))  # marker cleared

    first = head["LastModified"]
    time.sleep(1.1)
    media.public_path(path)  # unchanged: skipped without a new upload
    time.sleep(0.3)
    assert s3.head_object(Bucket=BUCKET, Key="storage/clips/clip_1.mp4")["LastModified"] == first

    path.write_bytes(b"a different, longer cut")
    media.public_path(path)
    deadline = time.monotonic() + 10
    while s3.head_object(Bucket=BUCKET, Key="storage/clips/clip_1.mp4")["ContentLength"] != path.stat().st_size:
        assert time.monotonic() < deadline, "changed file was not re-uploaded"
        time.sleep(0.05)


def test_missing_local_file_is_fetched_with_its_mtime(s3):
    path = _write("thumbnails/t.jpg", b"jpeg")
    media.public_path(path)
    _wait_uploaded("storage/thumbnails/t.jpg")
    mtime = int(path.stat().st_mtime)
    path.unlink()

    assert media.media_exists("storage/thumbnails/t.jpg")
    fetched = media.local_media("storage/thumbnails/t.jpg")
    assert fetched.read_bytes() == b"jpeg"
    assert int(fetched.stat().st_mtime) == mtime  # so it isn't treated as changed and re-uploaded
    assert media.local_media(str(fetched)) == fetched  # absolute paths (raw_file_path) work too


def test_unknown_files_are_neither_local_nor_remote(s3):
    assert not media.media_exists("storage/clips/nope.mp4")
    assert not media.local_media("storage/clips/nope.mp4").is_file()
    assert not media.media_exists(None)


def test_evict_drops_only_old_synced_copies(s3, monkeypatch):
    old = _write("clips/old.mp4")
    fresh = _write("clips/fresh.mp4")
    scratch = _write("imports/1/audio.m4a")  # never registered: never uploaded, never evicted
    for p in (old, fresh):
        media.public_path(p)
    _wait_uploaded("storage/clips/old.mp4")
    _wait_uploaded("storage/clips/fresh.mp4")
    object_store._last_used["storage/clips/fresh.mp4"] = time.time()

    monkeypatch.setattr(settings, "s3_keep_local_hours", 0.001)  # ~4 s; the files are 60 s old
    assert object_store.evict() > 0
    assert not old.exists() and fresh.exists() and scratch.exists()
    assert media.local_media(old).is_file()  # and it comes back on demand


def test_delete_removes_both_copies(s3):
    clip = _write("clips/gone.mp4")
    job_file = _write("imports/7/thumb.jpg")
    media.public_path(clip)
    media.public_path(job_file)
    _wait_uploaded("storage/clips/gone.mp4")
    _wait_uploaded("storage/imports/7/thumb.jpg")

    media.remove_media("storage/clips/gone.mp4")
    object_store.delete_tree(media.storage_root() / "imports" / "7")
    assert not clip.exists() and not (media.storage_root() / "imports" / "7").exists()
    assert _keys(s3) == []


def test_storage_route_redirects_to_s3_when_not_on_disk(s3):
    from fastapi import FastAPI
    from fastapi.testclient import TestClient

    from app.main import MediaFiles

    path = _write("clips/remote.mp4")
    media.public_path(path)
    _wait_uploaded("storage/clips/remote.mp4")

    app = FastAPI()
    app.mount("/storage", MediaFiles(directory=str(media.storage_root())), name="storage")
    client = TestClient(app)
    assert client.get("/storage/clips/remote.mp4").status_code == 200  # local copy served directly

    path.unlink()
    resp = client.get("/storage/clips/remote.mp4", follow_redirects=False)
    assert resp.status_code == 307
    assert "storage/clips/remote.mp4" in resp.headers["location"] and "Signature" in resp.headers["location"]
    assert client.get("/storage/clips/never.mp4", follow_redirects=False).status_code == 404


def test_disabled_without_a_bucket(tmp_path, monkeypatch):
    monkeypatch.setattr(settings, "storage_dir", str(tmp_path / "storage"))
    monkeypatch.setattr(settings, "s3_bucket", "")
    path = _write("clips/local.mp4")
    assert media.public_path(path) == "storage/clips/local.mp4"
    assert media.local_media("storage/clips/local.mp4") == path
    assert not (media.storage_root() / object_store.PENDING_DIR).exists()

"""Finished media on S3 (or any S3-compatible store: R2, B2, MinIO), local disk as a working cache.

ffmpeg, yt-dlp and the editor all need real files, so everything is still made on local disk
under storage_root(). What changes with S3_BUCKET set:

* push(path)        Called when a file is registered as public (media.public_path). Uploaded in
                    the background; a marker file under .s3-pending/ survives a crash or redeploy
                    and the upload is retried at startup. Each object carries the local file's
                    size and mtime, so an unchanged file is never re-sent and an overwritten one is.
* ensure_local()    A file that isn't on disk (new instance, or evicted) is downloaded on first use.
* exists()          Local file or a matching object.
* url_for(key)      /storage/... requests for files no longer on disk redirect here (a presigned
                    link, or S3_PUBLIC_BASE_URL for a public bucket / CDN).
* delete()/delete_tree()  Remove both copies.
* evict()           Drops local copies that are safely on S3 and unused for S3_KEEP_LOCAL_HOURS.

Keys are paths relative to storage_root() (plus S3_PREFIX), the same "storage/..." layout the
database already stores, so nothing in the database changes.
"""
from __future__ import annotations

import hashlib
import logging
import os
import shutil
import threading
import time
from pathlib import Path

from app.config import settings
from app.core.daemon_pool import DaemonPool

logger = logging.getLogger("cliphive.s3")

PENDING_DIR = ".s3-pending"
# A file still being written (an export, a preview) is uploaded once it stops changing.
SETTLE_S = 3.0
SETTLE_MAX_S = 120.0
MISSING_TTL_S = 30.0  # how long "not on S3" is remembered before asking again

_client = None
_client_lock = threading.Lock()
_uploads = DaemonPool(2, "s3-upload")
_queued: set[str] = set()
_synced: dict[str, tuple[int, int]] = {}  # key -> (size, mtime) known to be on S3
_missing: dict[str, float] = {}  # key -> when S3 last said it doesn't have it
_last_used: dict[str, float] = {}  # key -> last local read (eviction must not drop busy files)
_state_lock = threading.Lock()
_download_locks: dict[str, threading.Lock] = {}


def enabled() -> bool:
    return bool(settings.s3_bucket)


def _root() -> Path:
    root = Path(settings.storage_dir).resolve()
    root.mkdir(parents=True, exist_ok=True)
    return root


def client():
    global _client
    with _client_lock:
        if _client is None:
            import boto3
            from botocore.config import Config

            _client = boto3.client(
                "s3",
                region_name=settings.s3_region or None,
                endpoint_url=settings.s3_endpoint_url or None,
                aws_access_key_id=settings.s3_access_key_id or None,  # empty: boto3's usual env/role lookup
                aws_secret_access_key=settings.s3_secret_access_key or None,
                config=Config(retries={"max_attempts": 5, "mode": "standard"}, signature_version="s3v4"),
            )
        return _client


def key_for(path: Path) -> str | None:
    """Object key for a file under storage_root(), or None for anything outside it."""
    try:
        rel = path.resolve().relative_to(_root()).as_posix()
    except ValueError:
        return None
    if rel.startswith(PENDING_DIR):
        return None
    prefix = settings.s3_prefix.strip("/")
    return f"{prefix}/{rel}" if prefix else rel


def _path_for(key: str) -> Path:
    prefix = settings.s3_prefix.strip("/")
    rel = key[len(prefix) + 1:] if prefix and key.startswith(prefix + "/") else key
    return _root() / rel


def _stamp(path: Path) -> tuple[int, int]:
    st = path.stat()
    return st.st_size, int(st.st_mtime)


def _marker(key: str) -> Path:
    return _root() / PENDING_DIR / hashlib.sha1(key.encode()).hexdigest()


def _remote_stamp(key: str) -> tuple[int, int] | None:
    """(size, mtime) of the object as uploaded, or None if S3 doesn't have it."""
    from botocore.exceptions import ClientError

    try:
        head = client().head_object(Bucket=settings.s3_bucket, Key=key)
    except ClientError as err:
        if err.response.get("Error", {}).get("Code") in ("404", "NoSuchKey", "NotFound"):
            return None
        raise
    meta = head.get("Metadata") or {}
    try:
        return int(meta.get("local-size", head["ContentLength"])), int(meta.get("local-mtime", 0))
    except (TypeError, ValueError):
        return int(head["ContentLength"]), 0


def remote_has(key: str) -> bool:
    if key in _synced:
        return True
    seen = _missing.get(key)
    if seen and time.time() - seen < MISSING_TTL_S:
        return False
    try:
        stamp = _remote_stamp(key)
    except Exception:
        logger.warning("S3 lookup failed for %s", key, exc_info=True)
        return False
    with _state_lock:
        if stamp:
            _synced[key] = stamp
            _missing.pop(key, None)
        else:
            _missing[key] = time.time()
    return stamp is not None


# ---------------------------------------------------------------- upload


def push(path: Path) -> None:
    """Queue a finished file for upload (cheap to call repeatedly: unchanged files are skipped)."""
    if not enabled():
        return
    key = key_for(path)
    if key is None or not path.is_file():
        return
    try:
        stamp = _stamp(path)
    except OSError:
        return
    with _state_lock:
        if _synced.get(key) == stamp or key in _queued:
            return
        _queued.add(key)
    try:
        marker = _marker(key)
        marker.parent.mkdir(parents=True, exist_ok=True)
        marker.write_text(key, encoding="utf-8")
    except OSError:
        pass
    _uploads.submit(_upload, key)


def _upload(key: str) -> None:
    path = _path_for(key)
    try:
        deadline = time.monotonic() + SETTLE_MAX_S
        while path.is_file() and time.time() - path.stat().st_mtime < SETTLE_S and time.monotonic() < deadline:
            time.sleep(SETTLE_S)
        if not path.is_file():
            _marker(key).unlink(missing_ok=True)  # deleted before we got to it
            return
        stamp = _stamp(path)
        if _remote_stamp(key) == stamp:
            pass  # already there (an earlier run uploaded it)
        else:
            import mimetypes

            content_type = mimetypes.guess_type(path.name)[0] or "application/octet-stream"
            client().upload_file(
                str(path), settings.s3_bucket, key,
                ExtraArgs={"ContentType": content_type, "Metadata": {"local-size": str(stamp[0]), "local-mtime": str(stamp[1])}},
            )
            logger.info("Uploaded %s (%.1f MB)", key, stamp[0] / 1e6)
        with _state_lock:
            _synced[key] = stamp
            _missing.pop(key, None)
        _marker(key).unlink(missing_ok=True)
    except Exception:
        logger.warning("S3 upload failed for %s; it will be retried at the next startup", key, exc_info=True)
    finally:
        with _state_lock:
            _queued.discard(key)


def resume_pending() -> None:
    """Startup: retry uploads a crash or redeploy interrupted."""
    if not enabled():
        return
    pending = _root() / PENDING_DIR
    for marker in pending.glob("*") if pending.is_dir() else []:
        try:
            key = marker.read_text(encoding="utf-8").strip()
        except OSError:
            continue
        path = _path_for(key)
        if path.is_file():
            push(path)
        else:
            marker.unlink(missing_ok=True)


# ---------------------------------------------------------------- download / exists


def ensure_local(path: Path) -> Path:
    """The file on local disk, downloading it from S3 first if only S3 has it."""
    key = key_for(path) if enabled() else None
    if key is not None:
        _last_used[key] = time.time()
    if path.is_file() or key is None or not remote_has(key):
        return path
    lock = _download_locks.setdefault(key, threading.Lock())
    with lock:
        if path.is_file():
            return path
        path.parent.mkdir(parents=True, exist_ok=True)
        tmp = path.with_name(f".{path.name}.s3tmp")
        try:
            client().download_file(settings.s3_bucket, key, str(tmp))
            stamp = _synced.get(key)
            if stamp and stamp[1]:
                os.utime(tmp, (stamp[1], stamp[1]))  # keep the uploaded mtime, so it isn't re-uploaded
            tmp.replace(path)
            logger.info("Fetched %s from S3", key)
        except Exception:
            tmp.unlink(missing_ok=True)
            logger.warning("S3 download failed for %s", key, exc_info=True)
    return path


def exists(path: Path) -> bool:
    if path.is_file():
        return True
    key = key_for(path) if enabled() else None
    return key is not None and remote_has(key)


def url_for(key: str) -> str:
    if settings.s3_public_base_url:
        return f"{settings.s3_public_base_url.rstrip('/')}/{key}"
    return client().generate_presigned_url(
        "get_object", Params={"Bucket": settings.s3_bucket, "Key": key}, ExpiresIn=settings.s3_url_expiry_s,
    )


# ---------------------------------------------------------------- delete


def delete(path: Path) -> None:
    """Remove a file locally and from S3."""
    delete_remote(path)
    try:
        path.unlink(missing_ok=True)
    except OSError:
        logger.warning("Couldn't delete local %s", path, exc_info=True)


def delete_remote(path: Path) -> None:
    key = key_for(path) if enabled() else None
    if key is None:
        return
    with _state_lock:
        _synced.pop(key, None)
        _last_used.pop(key, None)
    _marker(key).unlink(missing_ok=True)
    try:
        client().delete_object(Bucket=settings.s3_bucket, Key=key)
    except Exception:
        logger.warning("S3 delete failed for %s", key, exc_info=True)


def delete_tree(folder: Path) -> None:
    """Remove a folder locally and every object under it on S3."""
    delete_remote_tree(folder)
    shutil.rmtree(folder, ignore_errors=True)


def delete_remote_tree(folder: Path) -> None:
    prefix = key_for(folder) if enabled() else None
    if not prefix:
        return
    prefix = prefix.rstrip("/") + "/"
    with _state_lock:
        for key in [k for k in _synced if k.startswith(prefix)]:
            _synced.pop(key, None)
    try:
        for page in client().get_paginator("list_objects_v2").paginate(Bucket=settings.s3_bucket, Prefix=prefix):
            objects = [{"Key": o["Key"]} for o in page.get("Contents") or []]
            if objects:
                client().delete_objects(Bucket=settings.s3_bucket, Delete={"Objects": objects, "Quiet": True})
    except Exception:
        logger.warning("S3 delete failed under %s", prefix, exc_info=True)


# ---------------------------------------------------------------- local cache


def evict() -> int:
    """Delete local copies that S3 holds unchanged and nobody used for S3_KEEP_LOCAL_HOURS."""
    if not enabled() or settings.s3_keep_local_hours <= 0:
        return 0
    cutoff = time.time() - settings.s3_keep_local_hours * 3600
    freed = 0
    for key, stamp in list(_synced.items()):
        path = _path_for(key)
        try:
            if not path.is_file() or _stamp(path) != stamp:
                continue
            if max(path.stat().st_mtime, _last_used.get(key, 0)) > cutoff:
                continue
            if _remote_stamp(key) != stamp:  # double-check before deleting the only local copy
                continue
            size = stamp[0]
            path.unlink()
            freed += size
        except Exception:
            logger.warning("Couldn't evict %s", key, exc_info=True)
    if freed:
        logger.info("Freed %.1f MB of local copies already on S3", freed / 1e6)
    return freed


async def evict_loop() -> None:
    import asyncio

    while True:
        await asyncio.sleep(3600)
        try:
            await asyncio.to_thread(evict)
        except Exception:
            logger.exception("S3 eviction pass failed")

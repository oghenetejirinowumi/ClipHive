"""Stream monitor: the background loop of the Clip Factory.

Every LIVE_POLL_INTERVAL_S it checks each active streamer. When one goes live it records the
whole broadcast (one `streams` row) as gapless SEGMENT_MINUTES segments. Each segment is scored
and cut as soon as it completes, so clips reach the caption pipeline (`clips` rows with
status='processing') while the stream is still going. Recording ends when the stream ends, the
user stops it, or MAX_STREAM_HOURS passes.
"""
from __future__ import annotations

import logging
import threading
import time
from concurrent.futures import Future, ThreadPoolExecutor, wait
from datetime import UTC, datetime

from app.config import settings
from app.core.media import MediaError, probe, storage_root
from app.db import SessionLocal
from app.models import Clip, Stream, Streamer, StreamStatus
from app.services.clip.detector import find_highlights
from app.services.ingest import monitor
from app.services.ingest.downloader import IngestError
from app.services.ingest.pipeline import cut_and_handoff
from app.services.ingest.recorder import Segment, record_broadcast

logger = logging.getLogger("cliphive.monitor")

RETRY_AFTER_FAILED_OPEN_S = 300  # platforms report "live" for a minute or two after a stream ends

_stop = threading.Event()
_thread: threading.Thread | None = None
_recorders = ThreadPoolExecutor(max_workers=settings.recording_workers, thread_name_prefix="record")
_cutter = ThreadPoolExecutor(max_workers=1, thread_name_prefix="segment")  # CPU-bound: one at a time
_recording: dict[int, threading.Event] = {}  # streamer id -> its stop signal
_done: set[tuple[int, str]] = set()  # broadcasts stopped by the user or the time cap: don't restart
_cooldown: dict[tuple[int, str], float] = {}  # broadcasts that failed to open: retry after this time
_lock = threading.Lock()


def start() -> None:
    global _thread
    if not settings.stream_monitor_enabled:
        logger.info("Stream monitor disabled (STREAM_MONITOR_ENABLED=false).")
        return
    if _thread and _thread.is_alive():
        return
    _stop.clear()
    _thread = threading.Thread(target=_loop, name="stream-monitor", daemon=True)
    _thread.start()
    logger.info("Stream monitor polling every %ss.", settings.live_poll_interval_s)


def stop() -> None:
    _stop.set()
    with _lock:
        for signal in _recording.values():
            signal.set()


def is_recording(streamer_id: int) -> bool:
    with _lock:
        return streamer_id in _recording


def stop_recording(streamer_id: int) -> bool:
    """Ask a running recording to finish (its last segment is still clipped). False if none."""
    with _lock:
        signal = _recording.get(streamer_id)
    if signal:
        signal.set()
    return signal is not None


def recover_interrupted() -> None:
    """Recordings cut short by a server restart can't resume; mark them failed."""
    with SessionLocal() as db:
        stuck = db.query(Stream).filter(Stream.status.in_([StreamStatus.LIVE, StreamStatus.RECORDING, StreamStatus.ENDED])).all()
        for row in stuck:
            row.status = StreamStatus.FAILED
        if stuck:
            db.commit()


def _loop() -> None:
    while not _stop.is_set():
        try:
            poll_once()
        except Exception:  # keep polling whatever happens
            logger.exception("Stream monitor poll failed")
        _stop.wait(settings.live_poll_interval_s)


def poll_once() -> None:
    with SessionLocal() as db:
        streamers = [(s.id, s.platform, s.username) for s in db.query(Streamer).filter(Streamer.is_active.is_(True))]
    for streamer_id, platform, username in streamers:
        if _stop.is_set():
            return
        if is_recording(streamer_id):
            continue
        status = monitor.check(streamer_id, platform, username)
        if status.is_live:
            start_recording(streamer_id, status)


def _broadcast_key(status: monitor.LiveStatus) -> str:
    # Without a platform id, treat each UTC day as one broadcast.
    return status.stream_id or f"live-{datetime.now(UTC):%Y%m%d}"


def start_recording(streamer_id: int, status: monitor.LiveStatus, *, force: bool = False) -> Stream | None:
    """Create a `streams` row and start recording the broadcast. None if already recording, or
    (unless force) the user stopped this broadcast or it recently failed to open."""
    key = (streamer_id, _broadcast_key(status))
    with _lock:
        if streamer_id in _recording:
            return None
        if force:
            _done.discard(key)
            _cooldown.pop(key, None)
        elif key in _done or _cooldown.get(key, 0) > time.time():
            return None
        with SessionLocal() as db:
            row = Stream(streamer_id=streamer_id, platform_stream_id=key[1], started_at=datetime.now(UTC), status=StreamStatus.RECORDING)
            db.add(row)
            db.commit()
            db.refresh(row)
        signal = threading.Event()
        _recording[streamer_id] = signal
    _recorders.submit(_record_safely, streamer_id, row.id, key, status.title, signal)
    return row


def _set_status(stream_row_id: int, status: StreamStatus, **fields) -> None:
    with SessionLocal() as db:
        row = db.get(Stream, stream_row_id)
        if row:
            row.status = status
            for key, value in fields.items():
                setattr(row, key, value)
            db.commit()


def _record_safely(streamer_id: int, stream_row_id: int, key: tuple[int, str], live_title: str | None, signal: threading.Event) -> None:
    try:
        _record(streamer_id, stream_row_id, key, live_title, signal)
    except (IngestError, MediaError) as err:
        logger.warning("Recording %s failed: %s", stream_row_id, err)
        _set_status(stream_row_id, StreamStatus.FAILED, ended_at=datetime.now(UTC))
        with _lock:
            _cooldown[key] = time.time() + RETRY_AFTER_FAILED_OPEN_S
    except Exception:
        logger.exception("Recording %s crashed", stream_row_id)
        _set_status(stream_row_id, StreamStatus.FAILED, ended_at=datetime.now(UTC))
    finally:
        with _lock:
            _recording.pop(streamer_id, None)


def _record(streamer_id: int, stream_row_id: int, key: tuple[int, str], live_title: str | None, signal: threading.Event) -> None:
    with SessionLocal() as db:
        streamer = db.get(Streamer, streamer_id)
        if not streamer:
            _set_status(stream_row_id, StreamStatus.FAILED)
            return
        platform, username, user_id = streamer.platform, streamer.username, streamer.user_id

    out_dir = storage_root() / "streams" / str(stream_row_id)
    _set_status(stream_row_id, StreamStatus.RECORDING, recording_path=str(out_dir))
    title = f"{username} · {live_title}" if live_title else username
    max_seconds = settings.max_stream_hours * 3600 or None
    pending: list[Future] = []

    def on_segment(segment: Segment) -> None:
        pending.append(_cutter.submit(_cut_segment, stream_row_id, user_id, title, segment))

    logger.info("Recording %s/%s (stream %s) in %s-minute segments", platform, username, stream_row_id, settings.segment_minutes)
    started = time.monotonic()
    count = record_broadcast(
        monitor.live_url(platform, username), out_dir,
        segment_seconds=settings.segment_minutes * 60, max_seconds=max_seconds, stop=signal, on_segment=on_segment,
    )
    if signal.is_set() or (max_seconds and time.monotonic() - started >= max_seconds - 5):
        with _lock:
            _done.add(key)  # stopped on purpose: don't start it again on the next poll
    _set_status(stream_row_id, StreamStatus.ENDED, ended_at=datetime.now(UTC))
    logger.info("Stream %s ended after %d segments; finishing clips", stream_row_id, count)

    wait(pending)
    _set_status(stream_row_id, StreamStatus.PROCESSED if count else StreamStatus.FAILED)


def _cut_segment(stream_row_id: int, user_id: int, title: str, segment: Segment) -> None:
    try:
        duration, has_video = probe(segment.path)
        if not has_video or duration < 5:
            return
        moments = find_highlights(segment.path, duration, settings.segment_clip_count, settings.segment_clip_seconds)
        with SessionLocal() as db:
            already = db.query(Clip).filter(Clip.stream_id == stream_row_id).count()
        clip_ids = cut_and_handoff(
            segment.path, moments, user_id=user_id, title=title, name=f"stream_{stream_row_id}",
            stream_id=stream_row_id, offset_s=segment.start_s, first_number=already + 1,
        )
        logger.info("Stream %s segment %d → %d clips", stream_row_id, segment.index + 1, len(clip_ids))
    except Exception:
        logger.exception("Cutting stream %s segment %d failed", stream_row_id, segment.index + 1)
    finally:
        if not settings.keep_recordings:
            segment.path.unlink(missing_ok=True)

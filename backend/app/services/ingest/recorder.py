"""Record a live broadcast start to finish, split into gapless segment files.

One recorder runs per broadcast. streamlink (filters Twitch ads, handles HLS quirks) pipes the
stream into ffmpeg's segment muxer, which cuts a new .ts file every `segment_seconds` without
dropping a frame in between. If streamlink isn't installed or can't open the stream, yt-dlp
resolves the live HLS URL(s) and ffmpeg reads them directly into the same muxer.

ffmpeg writes a CSV line for every finished segment (name, start, end), which is how we know
a segment is complete and where it sits in the broadcast.
"""
from __future__ import annotations

import csv
import importlib.util
import logging
import subprocess
import sys
import threading
import time
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path

from yt_dlp import YoutubeDL
from yt_dlp.utils import DownloadError

from app.core.media import MediaError, ffmpeg_bin, probe
from app.services.ingest import youtube_guard
from app.services.ingest.downloader import IngestError
from app.services.ingest.monitor import SilentLogger

logger = logging.getLogger("cliphive.recorder")

# A segment smaller than this is a failed capture (stream ended, ad wall, etc.) and is skipped.
MIN_BYTES = 256 * 1024
POLL_S = 3


@dataclass
class Segment:
    index: int  # 0-based
    path: Path
    start_s: float  # position in the broadcast
    end_s: float


def _segment_args(out_dir: Path, segment_seconds: int, max_seconds: float | None) -> list[str]:
    limit = ["-t", f"{max_seconds:.0f}"] if max_seconds else []
    return [
        *limit, "-c", "copy",
        "-f", "segment", "-segment_time", str(segment_seconds), "-segment_format", "mpegts",
        "-reset_timestamps", "1", "-segment_list", str(out_dir / "segments.csv"), "-segment_list_type", "csv",
        str(out_dir / "seg_%05d.ts"),
    ]


def _log(out_dir: Path, name: str):
    # Logs go to files, never to an unread pipe that would stall a recorder hours into a stream.
    return (out_dir / f"{name}.log").open("ab")


def _ffmpeg(out_dir: Path, inputs: list[str], maps: list[str], tail: list[str], stdin=subprocess.PIPE) -> subprocess.Popen:
    cmd = [ffmpeg_bin(), "-hide_banner", "-loglevel", "error", "-y", *inputs, *maps, *tail]
    with _log(out_dir, "ffmpeg") as log:
        return subprocess.Popen(cmd, stdin=stdin, stdout=subprocess.DEVNULL, stderr=log)


def _start_streamlink(url: str, out_dir: Path, tail: list[str]) -> list[subprocess.Popen] | None:
    if importlib.util.find_spec("streamlink") is None:
        return None
    with _log(out_dir, "streamlink") as log:
        source = subprocess.Popen(
            [sys.executable, "-m", "streamlink", "--retry-open", "3", "--loglevel", "error", "--stdout", url, "best"],
            stdout=subprocess.PIPE, stderr=log,
        )
    sink = _ffmpeg(out_dir, ["-i", "pipe:0"], [], tail, stdin=source.stdout)
    assert source.stdout is not None
    source.stdout.close()  # ffmpeg owns the read end now
    return [source, sink]


def _start_ytdlp(url: str, out_dir: Path, tail: list[str]) -> list[subprocess.Popen] | None:
    # YouTube without a JS runtime only offers separate video and audio streams, so accept a pair.
    opts = {"quiet": True, "no_warnings": True, "logger": SilentLogger(), "format": "b[height<=1080]/bv*[height<=1080]+ba/b"}
    if cookies := youtube_guard.cookies_file():
        opts["cookiefile"] = cookies
    try:
        with YoutubeDL(opts) as ydl:
            info = ydl.extract_info(url, download=False)
    except DownloadError as err:
        logger.info("yt-dlp couldn't resolve live URL for %s: %s", url, err)
        return None
    formats = info.get("requested_formats") or [info]
    inputs: list[str] = []
    for fmt in formats:
        if not fmt.get("url"):
            return None
        headers = "".join(f"{k}: {v}\r\n" for k, v in (fmt.get("http_headers") or {}).items())
        inputs += [*(["-headers", headers] if headers else []), "-i", fmt["url"]]
    maps = [arg for n in range(len(formats)) for arg in ("-map", str(n))]
    return [_ffmpeg(out_dir, inputs, maps, tail)]


def _finished(out_dir: Path) -> list[tuple[str, float, float]]:
    try:
        with (out_dir / "segments.csv").open(newline="", encoding="utf-8") as f:
            return [(row[0], float(row[1]), float(row[2])) for row in csv.reader(f) if len(row) >= 3]
    except (OSError, ValueError):
        return []


def _stop(procs: list[subprocess.Popen]) -> None:
    """End the recording so ffmpeg still closes the last segment and its CSV line.

    With streamlink, stopping the source gives ffmpeg end-of-stream. When ffmpeg reads the
    stream itself, it's asked to quit with "q" (Windows has no SIGINT for child processes).
    """
    *sources, sink = procs
    for proc in sources:
        if proc.poll() is None:
            proc.terminate()
    if not sources and sink.poll() is None and sink.stdin:
        try:
            sink.stdin.write(b"q")
            sink.stdin.flush()
        except OSError:
            pass
    for proc in procs:
        try:
            proc.wait(timeout=20)
        except subprocess.TimeoutExpired:
            proc.kill()
            proc.wait()


def record_broadcast(
    url: str,
    out_dir: Path,
    *,
    segment_seconds: int,
    max_seconds: float | None,
    stop: threading.Event,
    on_segment: Callable[[Segment], None],
) -> int:
    """Record until the stream ends, `stop` is set, or max_seconds passes.

    on_segment is called (on this thread) as each segment completes. Returns how many usable
    segments were recorded; raises IngestError if the stream couldn't be opened at all.
    """
    out_dir.mkdir(parents=True, exist_ok=True)
    tail = _segment_args(out_dir, segment_seconds, max_seconds)
    reported: set[str] = set()
    count = 0
    last_end = 0.0

    def emit(name: str, start: float, end: float) -> None:
        nonlocal count, last_end
        reported.add(name)
        last_end = max(last_end, end)
        path = out_dir / name
        if path.is_file() and path.stat().st_size >= MIN_BYTES:
            on_segment(Segment(index=count, path=path, start_s=start, end_s=end))
            count += 1

    def report(final: bool = False) -> None:
        for name, start, end in _finished(out_dir):
            if name not in reported:
                emit(name, start, end)
        if final:  # a segment ffmpeg was killed in the middle of has no CSV line; keep it anyway
            for path in sorted(out_dir.glob("seg_*.ts")):
                if path.name not in reported:
                    try:
                        length = probe(path)[0]
                    except MediaError:
                        reported.add(path.name)
                        continue
                    emit(path.name, last_end, last_end + length)

    for starter in (_start_streamlink, _start_ytdlp):
        procs = starter(url, out_dir, tail)
        if not procs:
            continue
        sink = procs[-1]
        started = time.monotonic()
        while sink.poll() is None:
            if stop.wait(POLL_S):
                _stop(procs)
                break
            report()
        _stop(procs)  # if ffmpeg exited first (stream ended), reap the source too
        report(final=True)
        if count or reported or stop.is_set() or time.monotonic() - started > 120:
            return count
        # Opened nothing: the recorder died almost immediately. Try the next one.
        logger.info("%s couldn't record %s (see %s)", starter.__name__, url, out_dir)

    raise IngestError("Couldn't record the stream. It may have just ended, or the platform blocked the request.")

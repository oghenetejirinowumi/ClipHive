"""yt-dlp wrapper: fetch only what we need from Twitch / Kick / YouTube / Instagram.

Link imports never pull a whole VOD. They take the audio first (to find moments), then only the
chosen sections in HD, plus an optional low-res preview for the studio. Every download reports
progress (from the hook, or by watching the growing file when ffmpeg does the fetching), can be
cancelled, and fails cleanly if the file stops growing.

YouTube often answers "Sign in to confirm you're not a bot", especially on shared or
mobile networks. We get past that in two steps:
1. No login: try several YouTube player clients (web_embedded and mweb usually work) with
   a JavaScript runtime (Deno or Node) so yt-dlp can solve YouTube's stream challenges.
2. Only if the probe is still blocked: retry once with a signed-in browser session from
   YTDLP_COOKIES_FROM_BROWSER, and use it for that video's downloads too.
"""
from __future__ import annotations

import copy
import logging
import shutil
import sys
import threading
import time
from collections.abc import Callable
from pathlib import Path

from yt_dlp import YoutubeDL
from yt_dlp.utils import DownloadError, download_range_func

from app.core.media import ffmpeg_bin
from app.services.ingest import youtube_guard

# ≤1080p, H.264 + AAC first so cuts are a cheap decode; anything else as a fallback.
HD_VIDEO = "bv*[height<=1080][vcodec^=avc1]+ba[ext=m4a]/bv*[height<=1080]+ba/b[height<=1080]/b"
# Sections are stream-copied, not re-encoded (see fetch_section), so taking 1080p costs only
# bandwidth: the one real encode is the vertical cut, and Fill's crop keeps its sharpness.
SECTION_VIDEO = HD_VIDEO
# The last fallback is "w" (smallest stream with video), never "b": when YouTube offers no
# audio-only streams, "b" picked a 1080p stream and an "audio" fetch became a full HD download
# (470 MB and 9 minutes for a 19-minute video, against 13 MB and 10 s for real audio).
AUDIO = "ba[ext=m4a]/ba/w"
# Loudness analysis doesn't need quality: the smallest audio-only stream is plenty.
ANALYSIS_AUDIO = "wa[ext=m4a][abr>=32]/ba[ext=m4a][abr<=72]/wa/ba/w"
# Probes retried when YouTube returns no audio-only streams (it varies call to call).
AUDIO_PROBE_RETRIES = 2
LONG_VOD_SECONDS = 4 * 3600
PREVIEW = "bv*[height<=240][vcodec^=avc1]+ba[ext=m4a][abr<=72]/bv*[height<=240]+wa/w[height>=144]/w"
STALL_SECONDS = 120
# Marks a probed info dict that needed browser cookies, so its downloads use them too.
BROWSER_COOKIES_KEY = "_cliphive_browser_cookies"

logger = logging.getLogger(__name__)


class IngestError(RuntimeError):
    """Download failed; the message is safe to show to the user."""


class Cancelled(IngestError):
    def __init__(self) -> None:
        super().__init__("Cancelled.")


def _is_bot_wall(text: str) -> bool:
    text = text.lower()
    return "not a bot" in text or "sign in to confirm" in text or "page needs to be reloaded" in text


def _friendly(err: Exception) -> str:
    text = str(err).lower()
    if "malloc" in text or "out of memory" in text or "cannot allocate memory" in text:
        return "The video download ran out of processing memory. Retry the import; ClipHive will use a lower-memory clip path."
    if _is_bot_wall(text) or "too many requests" in text or "429" in text:
        return ("The platform is blocking downloads from this network (\"confirm you're not a bot\"). Wait 30–60 minutes "
                "and retry, try another network, upload the video file instead, or set YTDLP_COOKIES_FILE or "
                "YTDLP_COOKIES_FROM_BROWSER on the server.")
    if "private" in text or "login" in text or "cookies" in text or "empty media response" in text:
        return "That video is private, or the platform needs a signed-in session to fetch it (set YTDLP_COOKIES_FILE on the server)."
    if "unsupported url" in text:
        return "We couldn't find a video at that link."
    if "404" in text or "not found" in text or "does not exist" in text:
        return "That video doesn't exist or was removed."
    if "geo" in text or "not available in your country" in text:
        return "That video isn't available in this region."
    return "We couldn't download that video. Check the link and try again."


def _deno() -> str | None:
    found = shutil.which("deno")
    if found:
        return found
    venv = Path(sys.executable).parent / ("deno.exe" if sys.platform == "win32" else "deno")
    return str(venv) if venv.exists() else None


def _js_runtimes() -> dict:
    """Runtimes yt-dlp may use for YouTube's challenges (needs the yt-dlp-ejs package)."""
    runtimes: dict = {}
    deno = _deno()
    if deno:
        runtimes["deno"] = {"path": deno}
    node = shutil.which("node")
    if node:
        runtimes["node"] = {"path": node}
    return runtimes


def _browser_cookie_opts() -> dict:
    browser, _, profile = settings.ytdlp_cookies_from_browser.partition(":")
    return {"cookiesfrombrowser": (browser.strip().lower(), profile.strip() or None, None, None)}


def _base_opts(*, browser_cookies: bool = False) -> dict:
    opts: dict = {
        "quiet": True,
        "no_warnings": True,
        "noprogress": True,
        "noplaylist": True,
        "ffmpeg_location": ffmpeg_bin(),
        "http_chunk_size": 10 * 1024 * 1024,  # chunked requests dodge per-connection throttling
    }
    clients = [c.strip() for c in settings.ytdlp_youtube_clients.split(",") if c.strip()]
    if clients:
        opts["extractor_args"] = {"youtube": {"player_client": clients}}
    runtimes = _js_runtimes()
    if runtimes:  # YouTube's signature challenge needs a JS runtime, or downloads crawl / fail
        opts["js_runtimes"] = runtimes
    opts.update(youtube_guard.opts())  # polite retries, optional proxy and cookies
    # A cookies file is cheap and explicit, so use it from the start. Browser cookies are
    # only a fallback: they need a Keychain prompt and tie downloads to that account.
    if settings.ytdlp_cookies_file:
        opts["cookiefile"] = settings.ytdlp_cookies_file
    elif browser_cookies and settings.ytdlp_cookies_from_browser and not opts.get("cookiefile"):
        opts.update(_browser_cookie_opts())
    return opts


def _extract(url: str, opts: dict) -> dict:
    with YoutubeDL(opts) as ydl:
        # process=False: keep the raw format list. A processed result carries the default
        # format selection, which would leak into later audio-only / section downloads.
        info = ydl.extract_info(url, download=False, process=False)
        for _ in range(3):  # follow redirect-style results to the actual video
            if info.get("_type") not in ("url", "url_transparent"):
                break
            info = ydl.extract_info(info["url"], download=False, process=False)
    return info


def has_audio_only(info: dict) -> bool:
    """True if the probe found a stream with audio and no video (cheap to analyse)."""
    return any(
        f.get("vcodec") == "none" and f.get("acodec") not in (None, "none")
        for f in info.get("formats") or []
    )


def _is_youtube(info: dict) -> bool:
    return str(info.get("extractor_key") or info.get("extractor") or "").lower().startswith("youtube")


def _guard(url: str | None) -> None:
    """Before touching YouTube: fail fast during a cooldown, else keep requests spaced out."""
    if youtube_guard.is_youtube(url):
        try:
            youtube_guard.pace()
        except youtube_guard.YouTubeCoolingDown as err:
            raise IngestError(str(err)) from err


def _info_url(info: dict) -> str | None:
    return info.get("webpage_url") or info.get("original_url") or info.get("url")


def probe_url(url: str) -> dict:
    """Metadata only (title, duration, formats). Refuses playlists and live streams."""
    _guard(url)
    info = _probe(url)
    # On a bot-walled network YouTube sometimes answers with only combined video streams.
    # Without an audio-only stream, the analysis download is a whole video, so ask again.
    for _ in range(AUDIO_PROBE_RETRIES):
        if not _is_youtube(info) or has_audio_only(info):
            break
        logger.info("YouTube returned no audio-only streams for %s; probing again", url)
        try:
            retry = _probe(url, browser_cookies=bool(info.get(BROWSER_COOKIES_KEY)))
        except IngestError:
            break
        if has_audio_only(retry) or len(retry.get("formats") or []) > len(info.get("formats") or []):
            info = retry
    return info


def _probe(url: str, *, browser_cookies: bool = False) -> dict:
    try:
        info = _extract(url, _base_opts(browser_cookies=browser_cookies))
    except DownloadError as err:
        youtube_guard.report(err)
        text = str(err).lower()
        needs_login = _is_bot_wall(text) or "login" in text or "cookies" in text
        if not (needs_login and settings.ytdlp_cookies_from_browser and not settings.ytdlp_cookies_file):
            raise IngestError(_friendly(err)) from err
        logger.info("Probe needs a signed-in session; retrying with browser cookies")
        try:
            info = _extract(url, _base_opts(browser_cookies=True))
        except DownloadError as retry_err:
            youtube_guard.report(retry_err)
            raise IngestError(_friendly(retry_err)) from retry_err
        info[BROWSER_COOKIES_KEY] = True
    if info.get("_type") == "playlist":
        raise IngestError("That's a playlist or channel link. Paste a link to a single video or VOD.")
    if info.get("is_live") or info.get("live_status") == "is_live":
        raise IngestError("That stream is live right now. Paste the VOD link once it ends and we'll clip it.")
    if not info.get("thumbnail") and info.get("thumbnails"):
        info["thumbnail"] = info["thumbnails"][-1].get("url")
    return info


def estimate_bytes(info: dict, seconds: float, *, video: bool) -> int:
    """Rough size of `seconds` of the chosen streams, for progress when ffmpeg downloads."""
    fmts = info.get("formats") or []
    audio_kbps = max((f.get("abr") or 0 for f in fmts if f.get("vcodec") == "none"), default=128) or 128
    video_kbps = 0
    if video:
        video_kbps = max((f.get("vbr") or f.get("tbr") or 0 for f in fmts if (f.get("height") or 0) <= 1080 and f.get("vcodec") not in (None, "none")), default=2500) or 2500
    return int((audio_kbps + video_kbps) * 125 * seconds)


class _Watch:
    """Background watcher: progress from file growth, cancellation, and stall detection."""

    def __init__(self, out_dir: Path, stem: str, expected: int, on_progress, cancel: threading.Event | None):
        self.out_dir, self.stem, self.expected = out_dir, stem, max(1, expected)
        self.on_progress, self.cancel = on_progress, cancel
        self.reason: str | None = None
        self._stop = threading.Event()
        self._thread = threading.Thread(target=self._run, daemon=True)

    def _size(self) -> int:
        return sum(p.stat().st_size for p in self.out_dir.glob(f"{self.stem}*") if p.is_file())

    def _kill_ffmpeg(self) -> None:
        """Stop only the ffmpeg processes writing into this job's folder."""
        try:
            import psutil

            for child in psutil.Process().children(recursive=True):
                try:
                    if "ffmpeg" in child.name().lower() and str(self.out_dir) in " ".join(child.cmdline()):
                        child.kill()
                except (psutil.NoSuchProcess, psutil.AccessDenied):
                    pass
        except ImportError:
            pass

    def _run(self) -> None:
        last_size, last_growth = 0, time.monotonic()
        while not self._stop.wait(2):
            size = self._size()
            if size > last_size:
                last_size, last_growth = size, time.monotonic()
                if self.on_progress:
                    self.on_progress(min(0.99, size / self.expected))
            if self.cancel is not None and self.cancel.is_set():
                self.reason = "cancelled"
            elif time.monotonic() - last_growth > STALL_SECONDS:
                self.reason = "stalled"
            if self.reason:
                self._kill_ffmpeg()
                return

    def __enter__(self):
        self._thread.start()
        return self

    def __exit__(self, *exc):
        self._stop.set()
        self._thread.join(timeout=5)

    def check(self) -> None:
        """Called from yt-dlp's progress hook (native downloads) to abort promptly."""
        if self.reason or (self.cancel is not None and self.cancel.is_set()):
            raise DownloadError(self.reason or "cancelled")


def _fetch(
    info: dict,
    out_dir: Path,
    stem: str,
    fmt: str,
    *,
    sections: list[tuple[float, float]] | None = None,
    exact: bool = False,
    expected_bytes: int = 0,
    max_bytes: int | None = None,
    on_progress: Callable[[float], None] | None = None,
    cancel: threading.Event | None = None,
) -> Path:
    out_dir.mkdir(parents=True, exist_ok=True)
    watch = _Watch(out_dir, stem, expected_bytes, on_progress, cancel)

    def hook(d: dict) -> None:
        watch.check()
        total = d.get("total_bytes") or d.get("total_bytes_estimate")
        if on_progress and d.get("status") == "downloading" and total:
            on_progress(min(0.99, d.get("downloaded_bytes", 0) / total))

    info = copy.deepcopy(info)
    browser_cookies = bool(info.pop(BROWSER_COOKIES_KEY, False))
    opts = {**_base_opts(browser_cookies=browser_cookies), "outtmpl": str(out_dir / f"{stem}.%(ext)s"), "format": fmt, "merge_output_format": "mp4", "progress_hooks": [hook]}
    if sections:
        opts["download_ranges"] = download_range_func(None, sections)
        # Exact cuts re-encode the edges; without them a section starts at the previous keyframe.
        opts["force_keyframes_at_cuts"] = exact
    if max_bytes:
        opts["max_filesize"] = max_bytes

    _guard(_info_url(info))
    try:
        with watch, YoutubeDL(opts) as ydl:
            # Reuse the probed info: no second extraction round-trip per download.
            result = ydl.process_ie_result(info, download=True)
    except DownloadError as err:
        if watch.reason == "stalled":
            raise IngestError("The download stalled (no data for 2 minutes). Check your connection and retry.") from err
        if watch.reason == "cancelled" or (cancel is not None and cancel.is_set()):
            raise Cancelled() from err
        youtube_guard.report(err)
        raise IngestError(_friendly(err)) from err
    if cancel is not None and cancel.is_set():
        raise Cancelled()

    files = [Path(d["filepath"]) for d in result.get("requested_downloads", []) if d.get("filepath")]
    path = next((f for f in files if f.exists()), None) or next((p for p in sorted(out_dir.glob(f"{stem}.*")) if p.suffix not in (".part", ".ytdl")), None)
    if not path or not path.exists():
        raise IngestError("The download finished but no file was produced.")
    if on_progress:
        on_progress(1.0)
    return path


def fetch_audio(info: dict, out_dir: Path, seconds: float, **kw) -> Path:
    """Low-bitrate audio for finding moments.

    Takes the whole track through yt-dlp's native (chunked) downloader: a 48 kbps track of a
    multi-hour VOD is a few dozen MB, and native requests aren't throttled the way ffmpeg's
    ranged requests are. Only very long VODs fall back to a ranged fetch of the first `seconds`.
    """
    duration = info.get("duration") or 0
    if duration and duration > LONG_VOD_SECONDS:
        return _fetch(info, out_dir, "audio", AUDIO, sections=[(0, seconds)], expected_bytes=estimate_bytes(info, seconds, video=False), **kw)
    return _fetch(info, out_dir, "audio", ANALYSIS_AUDIO, expected_bytes=int(64 * 125 * (duration or seconds)), **kw)


def fetch_section(info: dict, out_dir: Path, stem: str, start_s: float, end_s: float, **kw) -> Path:
    """One HD section of the video (a moment).

    Stream-copied rather than re-encoded ("exact" cuts made yt-dlp run a full default-preset
    x264 pass per section, the slowest and most memory-hungry step of an import). The copy
    starts at the keyframe before start_s, but ffmpeg writes an MP4 edit list so the file's
    t=0 is still exactly start_s, and the vertical cut decodes from there frame-accurately."""
    return _fetch(info, out_dir, stem, SECTION_VIDEO, sections=[(start_s, end_s)], exact=False, expected_bytes=estimate_bytes(info, end_s - start_s, video=True), **kw)


def fetch_preview(info: dict, out_dir: Path, seconds: float, **kw) -> Path:
    """Low-res copy of the first `seconds` for scrubbing in the studio."""
    full = (info.get("duration") or 0) <= seconds
    return _fetch(info, out_dir, "preview", PREVIEW, sections=None if full else [(0, seconds)], expected_bytes=int(350 * 125 * seconds), **kw)


def download(url: str, out_dir: Path, *, max_bytes: int | None = None, on_progress: Callable[[float], None] | None = None) -> tuple[Path, dict]:
    """Whole video in one go (Instagram posts are short). Returns (file, info)."""
    info = probe_url(url)
    return _fetch(info, out_dir, "source", HD_VIDEO, max_bytes=max_bytes, on_progress=on_progress), info

"""yt-dlp wrapper for VODs (Twitch, Kick, YouTube) and Instagram posts."""
from __future__ import annotations

from collections.abc import Callable
from pathlib import Path

from yt_dlp import YoutubeDL
from yt_dlp.utils import DownloadError, download_range_func

from app.config import settings
from app.core.media import ffmpeg_bin


class IngestError(RuntimeError):
    """Download failed; the message is safe to show to the user."""


def _friendly(err: Exception) -> str:
    text = str(err).lower()
    if "private" in text or "login" in text or "cookies" in text or "empty media response" in text:
        return "That video is private, or the platform needs a signed-in session to fetch it (set YTDLP_COOKIES_FILE on the server)."
    if "unsupported url" in text:
        return "We couldn't find a video at that link."
    if "404" in text or "not found" in text or "does not exist" in text:
        return "That video doesn't exist or was removed."
    if "geo" in text or "not available in your country" in text:
        return "That video isn't available in this region."
    return "We couldn't download that video. Check the link and try again."


def download(
    url: str,
    out_dir: Path,
    *,
    max_seconds: int | None = None,
    max_bytes: int | None = None,
    on_progress: Callable[[float], None] | None = None,
) -> tuple[Path, dict]:
    """Download one video as MP4 into out_dir. Returns (file path, yt-dlp info dict).

    max_seconds keeps only the start of long VODs (we analyse at most that much).
    Live streams are refused: process the VOD once the stream ends.
    """
    out_dir.mkdir(parents=True, exist_ok=True)

    def hook(d: dict) -> None:
        if on_progress and d.get("status") == "downloading":
            total = d.get("total_bytes") or d.get("total_bytes_estimate")
            if total:
                on_progress(min(1.0, d.get("downloaded_bytes", 0) / total))

    opts: dict = {
        "outtmpl": str(out_dir / "source.%(ext)s"),
        # ≤1080p, prefer MP4/M4A so merging is a remux, not a re-encode.
        "format": "bv*[height<=1080][ext=mp4]+ba[ext=m4a]/bv*[height<=1080]+ba/b[height<=1080]/b",
        "merge_output_format": "mp4",
        "noplaylist": True,
        "quiet": True,
        "no_warnings": True,
        "noprogress": True,
        "ffmpeg_location": ffmpeg_bin(),
        "progress_hooks": [hook],
    }
    if settings.ytdlp_cookies_file:
        opts["cookiefile"] = settings.ytdlp_cookies_file
    if max_seconds:
        opts["download_ranges"] = download_range_func(None, [(0, max_seconds)])
    if max_bytes:
        opts["max_filesize"] = max_bytes

    try:
        with YoutubeDL(opts) as ydl:
            info = ydl.extract_info(url, download=False)
            if info.get("_type") == "playlist":
                raise IngestError("That's a playlist or channel link. Paste a link to a single video or VOD.")
            if info.get("is_live"):
                raise IngestError("That stream is live right now. Paste the VOD link once it ends and we'll clip it.")
            info = ydl.process_ie_result(info, download=True)
    except DownloadError as err:
        raise IngestError(_friendly(err)) from err

    files = [Path(d["filepath"]) for d in info.get("requested_downloads", []) if d.get("filepath")]
    path = next((f for f in files if f.exists()), None) or next(iter(sorted(out_dir.glob("source.*"))), None)
    if not path or not path.exists():
        raise IngestError("The download finished but no video file was produced.")
    return path, info

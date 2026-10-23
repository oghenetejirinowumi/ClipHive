"""Shared ffmpeg helpers. One place to find the binary, so nobody has to install ffmpeg by hand."""
from __future__ import annotations

import os
import re
import shutil
import subprocess
from functools import lru_cache
from pathlib import Path

from app.config import settings


def storage_root() -> Path:
    root = Path(settings.storage_dir).resolve()
    root.mkdir(parents=True, exist_ok=True)
    return root


def public_path(path: Path) -> str:
    """'storage/clips/x.mp4' style path the frontend appends to the API URL (served at /storage)."""
    return "storage/" + path.resolve().relative_to(storage_root()).as_posix()


@lru_cache(maxsize=1)
def ffmpeg_bin() -> str:
    """FFMPEG_PATH setting → system ffmpeg → the binary bundled with imageio-ffmpeg.

    yt-dlp only accepts a binary literally named ffmpeg(.exe), so the bundled one is copied
    to storage/bin/ under that name.
    """
    if settings.ffmpeg_path:
        return settings.ffmpeg_path
    system = shutil.which("ffmpeg")
    if system:
        return system

    import imageio_ffmpeg

    bundled = Path(imageio_ffmpeg.get_ffmpeg_exe())
    target = storage_root() / "bin" / ("ffmpeg.exe" if bundled.suffix == ".exe" else "ffmpeg")
    if not target.exists():
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(bundled, target)
    # Some callers only look on PATH (yt-dlp's partial-download path, the caption burner's
    # plain "ffmpeg"), so make the bundled copy findable there too.
    os.environ["PATH"] = str(target.parent) + os.pathsep + os.environ.get("PATH", "")
    return str(target)


class MediaError(RuntimeError):
    """ffmpeg failed; the message is safe to show to the user."""


def run_ffmpeg(args: list[str], timeout: int = 1800) -> None:
    result = subprocess.run([ffmpeg_bin(), "-hide_banner", "-loglevel", "error", "-y", *args], capture_output=True, text=True, timeout=timeout)
    if result.returncode != 0:
        tail = (result.stderr or "").strip().splitlines()[-3:]
        raise MediaError("Video processing failed: " + (" ".join(tail) or "unknown ffmpeg error"))


_DURATION = re.compile(r"Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)")
_VIDEO = re.compile(r"Stream #.*Video:")


def probe(path: Path) -> tuple[float, bool]:
    """(duration in seconds, has a video stream). Uses `ffmpeg -i` so no ffprobe is needed."""
    result = subprocess.run([ffmpeg_bin(), "-hide_banner", "-i", str(path)], capture_output=True, text=True, timeout=120)
    match = _DURATION.search(result.stderr)
    if not match:
        raise MediaError("That file doesn't look like a playable video.")
    h, m, s = match.groups()
    return int(h) * 3600 + int(m) * 60 + float(s), bool(_VIDEO.search(result.stderr))


def thumbnail(src: Path, dst: Path, at_s: float) -> None:
    run_ffmpeg(["-ss", f"{max(0.0, at_s):.2f}", "-i", str(src), "-frames:v", "1", "-vf", "scale=640:-2", str(dst)], timeout=120)

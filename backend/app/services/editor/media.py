"""Bring media into an editor project: probe files and describe them as timeline assets."""
from __future__ import annotations

import re
import shutil
import subprocess
from pathlib import Path

from app.core import object_store
from app.core.media import MediaError, ffmpeg_bin, public_path, storage_root
from app.schemas.editor import Asset

IMAGE_EXTS = {".png", ".jpg", ".jpeg", ".webp", ".gif"}
AUDIO_EXTS = {".mp3", ".wav", ".m4a", ".aac", ".ogg", ".flac"}
VIDEO_EXTS = {".mp4", ".mov", ".webm", ".mkv", ".m4v"}
UPLOAD_EXTS = IMAGE_EXTS | AUDIO_EXTS | VIDEO_EXTS

_DURATION = re.compile(r"Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)")
_VIDEO = re.compile(r"Stream #[^\n]*Video:[^\n]*?\b(\d{2,5})x(\d{2,5})\b")
_AUDIO = re.compile(r"Stream #[^\n]*Audio:")


def project_dir(project_id: int) -> Path:
    return storage_root() / "editor" / str(project_id)


def probe_asset(path: Path, asset_id: str, name: str) -> Asset:
    """Describe a media file (kind, length, size, whether it has sound) with `ffmpeg -i`."""
    result = subprocess.run([ffmpeg_bin(), "-hide_banner", "-i", str(path)], capture_output=True, text=True, timeout=120)
    info = result.stderr
    video, audio = _VIDEO.search(info), bool(_AUDIO.search(info))
    match = _DURATION.search(info)
    duration = int(match[1]) * 3600 + int(match[2]) * 60 + float(match[3]) if match else None
    ext = path.suffix.lower()
    if ext in IMAGE_EXTS and video:
        kind, duration = "image", None
    elif video:
        kind = "video"
    elif audio:
        kind = "audio"
    else:
        raise MediaError("That file doesn't look like a video, image or audio file.")
    if kind != "image" and not duration:
        raise MediaError("Couldn't read how long that file is.")
    return Asset(
        id=asset_id, kind=kind, name=name[:200], src=public_path(path), duration=round(duration, 3) if duration else None,
        width=int(video[1]) if video else None, height=int(video[2]) if video else None, has_audio=audio and kind != "image",
    )


def public_media_path(stored: str | None) -> str | None:
    """A clip's stored path (absolute, relative, or already "storage/...") as a public path, if it's in storage."""
    if not stored:
        return None
    if stored.startswith("storage/"):
        path = storage_root() / stored.removeprefix("storage/")
    else:
        path = Path(stored)
        if not path.is_absolute():
            path = Path.cwd() / path
    try:
        return public_path(path) if object_store.exists(path) else None
    except ValueError:  # outside storage (e.g. a test fixture)
        return None


def link_or_copy(src: Path, dst: Path) -> None:
    """Hard-link when possible (instant, no extra disk); copy across drives."""
    dst.parent.mkdir(parents=True, exist_ok=True)
    dst.unlink(missing_ok=True)
    try:
        dst.hardlink_to(src)
    except OSError:
        shutil.copy2(src, dst)

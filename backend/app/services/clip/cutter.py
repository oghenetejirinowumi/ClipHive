"""Cut a moment out of a source video as a 1080×1920 vertical clip."""
from __future__ import annotations

from pathlib import Path

from app.core.media import run_ffmpeg

# Centre-crop landscape to 9:16 (speaker tracking is a later upgrade); portrait sources are
# fitted and padded instead of being cropped further.
VERTICAL_FILTER = (
    "crop='min(iw,ih*9/16)':'min(ih,iw*16/9)',"
    "scale=1080:1920:force_original_aspect_ratio=decrease,"
    "pad=1080:1920:(ow-iw)/2:(oh-ih)/2,setsar=1"
)


def cut_vertical(src: Path, start_s: float, end_s: float, dst: Path) -> Path:
    dst.parent.mkdir(parents=True, exist_ok=True)
    run_ffmpeg([
        "-ss", f"{start_s:.2f}", "-i", str(src), "-t", f"{end_s - start_s:.2f}",
        "-vf", VERTICAL_FILTER,
        "-c:v", "libx264", "-preset", "veryfast", "-crf", "22", "-pix_fmt", "yuv420p",
        "-c:a", "aac", "-b:a", "160k", "-movflags", "+faststart",
        str(dst),
    ])
    return dst

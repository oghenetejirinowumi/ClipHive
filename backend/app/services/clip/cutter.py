"""Cut a moment out of a source video as a 1080×1920 vertical clip, in one of two layouts.

fill  Centre-crop to 9:16 so the frame fills the screen (zoomed in). Speaker tracking is a
      later upgrade. Portrait sources are fitted and padded instead of cropped further.
blur  Keep the whole frame: the original sits centred at full width, and a blurred, darkened
      copy of itself fills the space above and below. Nothing is cropped away.
"""
from __future__ import annotations

from pathlib import Path

from app.core.media import run_ffmpeg

LAYOUTS = ("fill", "blur")

FILL_FILTER = (
    "crop='min(iw,ih*9/16)':'min(ih,iw*16/9)',"
    "scale=1080:1920:force_original_aspect_ratio=decrease,"
    "pad=1080:1920:(ow-iw)/2:(oh-ih)/2,setsar=1"
)

# The background is blurred at quarter size (much cheaper than blurring 1080×1920) then scaled up.
BLUR_FILTER = (
    "split=2[bg][fg];"
    "[bg]scale=270:480:force_original_aspect_ratio=increase,crop=270:480,boxblur=12:3,"
    "scale=1080:1920,eq=brightness=-0.12:saturation=1.15[bgb];"
    "[fg]scale=1080:1920:force_original_aspect_ratio=decrease[fgs];"
    "[bgb][fgs]overlay=(W-w)/2:(H-h)/2,setsar=1"
)


def cut_vertical(src: Path, start_s: float, end_s: float, dst: Path, layout: str = "fill") -> Path:
    dst.parent.mkdir(parents=True, exist_ok=True)
    run_ffmpeg([
        "-ss", f"{start_s:.2f}", "-i", str(src), "-t", f"{end_s - start_s:.2f}",
        "-vf", BLUR_FILTER if layout == "blur" else FILL_FILTER,
        "-c:v", "libx264", "-preset", "veryfast", "-crf", "22", "-pix_fmt", "yuv420p",
        "-c:a", "aac", "-b:a", "160k", "-movflags", "+faststart",
        str(dst),
    ])
    return dst

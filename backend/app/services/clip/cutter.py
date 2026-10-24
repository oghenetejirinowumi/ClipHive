"""Cut a moment out of a source video as a 1080×1920 vertical clip, in one of two layouts,
with creative controls for playback speed, audio volume, and color styling.

fill  Centre-crop to 9:16 so the frame fills the screen (zoomed in). Speaker tracking is a
      later upgrade. Portrait sources are fitted and padded instead of cropped further.
blur  Keep the whole frame: the original sits centred at full width, and a blurred, darkened
      copy of itself fills the space above and below. Nothing is cropped away.
"""
from __future__ import annotations

from pathlib import Path

from app.core.media import encode

LAYOUTS = ("fill", "blur")

COLOR_FILTERS: dict[str, str] = {
    "none": "",
    "vibrant": "eq=contrast=1.15:saturation=1.35:brightness=0.02",
    "warm": "colorbalance=rs=0.08:gs=0.03:bs=-0.08,eq=saturation=1.1",
    "cool": "colorbalance=rs=-0.06:gs=0.0:bs=0.12,eq=saturation=1.05",
    "dramatic": "hue=s=0,eq=contrast=1.25:brightness=-0.04",
}

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


def build_vf(layout: str = "fill", speed: float = 1.0, color_filter: str = "none") -> str:
    """Combines vertical framing, color filter, and time-scale PTS manipulation."""
    base = BLUR_FILTER if layout == "blur" else FILL_FILTER
    parts = [base]
    col = COLOR_FILTERS.get(color_filter or "none", "")
    if col:
        parts.append(col)
    if abs(speed - 1.0) > 0.01:
        parts.append(f"setpts=(1/{speed:.4f})*PTS")
    return ",".join(parts)


def build_af(speed: float = 1.0, volume: float = 1.0) -> list[str]:
    """Builds audio filter args for tempo and volume scaling."""
    parts = []
    if abs(volume - 1.0) > 0.01:
        parts.append(f"volume={max(0.0, volume):.2f}")
    if abs(speed - 1.0) > 0.01:
        # atempo accepts 0.5 to 2.0
        clamped = max(0.5, min(2.0, speed))
        parts.append(f"atempo={clamped:.4f}")
    return ["-af", ",".join(parts)] if parts else []


def cut_vertical(
    src: Path,
    start_s: float,
    end_s: float,
    dst: Path,
    layout: str = "fill",
    speed: float = 1.0,
    volume: float = 1.0,
    color_filter: str = "none",
) -> Path:
    dst.parent.mkdir(parents=True, exist_ok=True)
    vf = build_vf(layout=layout, speed=speed, color_filter=color_filter)
    af_args = build_af(speed=speed, volume=volume)

    encode([
        "-ss", f"{start_s:.2f}", "-i", str(src), "-t", f"{end_s - start_s:.2f}",
        "-vf", vf,
        *af_args,
        "-c:v", "libx264", "-preset", "veryfast", "-crf", "22", "-pix_fmt", "yuv420p",
        "-c:a", "aac", "-b:a", "160k", "-movflags", "+faststart",
        str(dst),
    ])
    return dst

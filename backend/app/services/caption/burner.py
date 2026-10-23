"""Burns ASS subtitles into video using FFmpeg with libass."""
from __future__ import annotations

import logging
import subprocess
from pathlib import Path

logger = logging.getLogger(__name__)


def escape_ffmpeg_filter_path(path: str | Path) -> str:
    """Escapes path string for safe inclusion in FFmpeg filter syntax."""
    p = str(Path(path).resolve()).replace("\\", "/")
    # Colons in Windows or Unix need escaping in filter parameters
    p = p.replace(":", "\\:").replace("'", "\\'")
    return p


def burn_subtitles(
    raw_video_path: str | Path,
    ass_subtitle_path: str | Path,
    output_video_path: str | Path,
    fonts_dir: str | Path | None = None,
    ffmpeg_bin: str = "ffmpeg",
) -> Path:
    """
    Burns an ASS subtitle file into a vertical MP4 video using FFmpeg libass.
    Returns the resolved output Path.
    """
    raw_path = Path(raw_video_path).resolve()
    ass_path = Path(ass_subtitle_path).resolve()
    out_path = Path(output_video_path).resolve()

    if not raw_path.exists():
        raise FileNotFoundError(f"Raw video not found: {raw_path}")
    if not ass_path.exists():
        raise FileNotFoundError(f"ASS subtitle file not found: {ass_path}")

    out_path.parent.mkdir(parents=True, exist_ok=True)

    escaped_ass = escape_ffmpeg_filter_path(ass_path)
    
    if fonts_dir:
        fonts_path = Path(fonts_dir).resolve()
        escaped_fonts = escape_ffmpeg_filter_path(fonts_path)
        vf_arg = f"ass='{escaped_ass}':fontsdir='{escaped_fonts}'"
    else:
        vf_arg = f"ass='{escaped_ass}'"

    cmd = [
        ffmpeg_bin,
        "-y",
        "-i", str(raw_path),
        "-vf", vf_arg,
        "-c:v", "libx264",
        "-preset", "fast",
        "-crf", "20",
        "-c:a", "aac",
        "-b:a", "128k",
        "-movflags", "+faststart",
        str(out_path),
    ]

    logger.info(f"Running FFmpeg subtitle burn: {' '.join(cmd)}")
    result = subprocess.run(cmd, capture_output=True, text=True)

    if result.returncode != 0:
        logger.error(f"FFmpeg burning failed (exit {result.returncode}):\n{result.stderr}")
        raise RuntimeError(f"FFmpeg burn failed: {result.stderr[-500:]}")

    if not out_path.exists() or out_path.stat().st_size == 0:
        raise RuntimeError(f"Output file was not created or is empty: {out_path}")

    return out_path

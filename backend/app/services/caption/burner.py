"""Burns ASS subtitles into video using FFmpeg with libass."""
from __future__ import annotations

import logging
import platform
import subprocess
import time
from pathlib import Path

from app.core.media import ENCODE_SLOTS, ffmpeg_bin as bundled_ffmpeg

logger = logging.getLogger(__name__)

_has_videotoolbox: bool | None = None


def is_videotoolbox_supported(ffmpeg_bin: str = "ffmpeg") -> bool:
    """Checks whether h264_videotoolbox hardware encoding is available on this system."""
    global _has_videotoolbox
    if _has_videotoolbox is not None:
        return _has_videotoolbox

    if platform.system() != "Darwin":
        _has_videotoolbox = False
        return False

    try:
        res = subprocess.run([ffmpeg_bin, "-encoders"], capture_output=True, text=True)
        _has_videotoolbox = "h264_videotoolbox" in res.stdout
    except Exception:
        _has_videotoolbox = False

    return _has_videotoolbox


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
    ffmpeg_bin: str | None = None,
    emojis: list | None = None,
) -> Path:
    """
    Burns an ASS subtitle file into a vertical MP4 video using FFmpeg libass.
    `emojis` (PlacedEmoji from the ASS generator) are drawn under the captions as animated
    overlays. Returns the resolved output Path.
    """
    ffmpeg_bin = ffmpeg_bin or bundled_ffmpeg()
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

    if is_videotoolbox_supported(ffmpeg_bin):
        vcodec_args = ["-c:v", "h264_videotoolbox", "-b:v", "3500k"]
    else:
        vcodec_args = ["-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-pix_fmt", "yuv420p"]

    overlays = []
    if emojis:
        from app.services.caption import emoji_render

        overlays = emoji_render.render_all(emojis, out_path.parent / f".{out_path.stem}_emoji")
    if overlays:
        from app.services.caption import emoji_render

        extra, chain, label = emoji_render.ffmpeg_parts(overlays, 1, "0:v")
        graph = ";".join([*chain, f"[{label}]{vf_arg}[vout]"])
        video_args = [*extra, "-filter_complex", graph, "-map", "[vout]", "-map", "0:a?"]
    else:
        video_args = ["-vf", vf_arg]

    cmd = [
        ffmpeg_bin,
        "-y",
        "-i", str(raw_path),
        *video_args,
        *vcodec_args,
        "-c:a", "aac",
        "-b:a", "128k",
        "-movflags", "+faststart",
        str(out_path),
    ]

    logger.info(f"Running FFmpeg subtitle burn: {' '.join(cmd)}")
    # Shares the encode slots with clip cutting; a transient encoder failure (memory pressure)
    # gets one retry.
    with ENCODE_SLOTS:
        result = subprocess.run(cmd, capture_output=True, text=True)
        if result.returncode != 0:
            time.sleep(2)
            result = subprocess.run(cmd, capture_output=True, text=True)

    if overlays:
        import shutil

        shutil.rmtree(out_path.parent / f".{out_path.stem}_emoji", ignore_errors=True)

    if result.returncode != 0:
        logger.error(f"FFmpeg burning failed (exit {result.returncode}):\n{result.stderr}")
        raise RuntimeError(f"FFmpeg burn failed: {result.stderr[-500:]}")

    if not out_path.exists() or out_path.stat().st_size == 0:
        raise RuntimeError(f"Output file was not created or is empty: {out_path}")

    return out_path

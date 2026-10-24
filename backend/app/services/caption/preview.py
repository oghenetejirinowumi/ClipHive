"""Exact caption previews: a few seconds of sample text burned by the same generator and
libass as real clips, so creators see precisely what they'll get."""
from __future__ import annotations

import hashlib
import json
from pathlib import Path

from app.core.media import ENCODE_SLOTS, public_path, run_ffmpeg, storage_root
from app.services.caption.ass_generator import ASSGenerator, StyleSpec
from app.services.caption.burner import escape_ffmpeg_filter_path
from app.services.caption.fonts import FONTS_DIR

WORD_S = 0.38
HYPE = {"INSANE", "CLUTCH", "NO", "WAY", "OMG"}


def sample_words(text: str) -> list[dict]:
    words = [w for w in text.split() if w][:24]
    return [{"word": w, "start": 0.25 + i * WORD_S, "end": 0.25 + i * WORD_S + WORD_S * 0.9} for i, w in enumerate(words)]


def render_preview(spec: StyleSpec, text: str, background: Path | None = None, at_s: float | None = None) -> str:
    """Render a short 540x960 MP4 of `text` in `spec`; returns its public storage path (cached)."""
    words = sample_words(text)
    duration = (words[-1]["end"] + 0.8) if words else 2.0
    key = hashlib.sha1(
        json.dumps(
            [spec.font_name, spec.font_size, spec.uppercase, spec.animation, spec.options.model_dump(), text, str(background), at_s],
            sort_keys=True,
        ).encode()
    ).hexdigest()[:16]
    out_dir = storage_root() / "caption_previews"
    out_dir.mkdir(parents=True, exist_ok=True)
    out = out_dir / f"{key}.mp4"
    if out.exists():
        return public_path(out)

    ass = out_dir / f"{key}.ass"
    ASSGenerator().generate(words, spec, output_file=ass, hype_words=[w for w in text.upper().split() if w.strip("!?,.") in HYPE])
    subs = f"ass='{escape_ffmpeg_filter_path(ass)}':fontsdir='{escape_ffmpeg_filter_path(FONTS_DIR)}'"

    if background and background.exists():
        inputs = ["-ss", f"{at_s or 0:.2f}", "-i", str(background)]
        base = "[0:v]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,setsar=1"
    else:
        inputs = ["-f", "lavfi", "-i", f"gradients=s=1080x1920:c0=0x1b1830:c1=0x3a2f6b:x0=0:y0=0:x1=1080:y1=1920:d={duration:.2f}"]
        base = "[0:v]setsar=1"
    vf = f"{base},{subs},scale=540:960,fps=30[v]"
    with ENCODE_SLOTS:
        run_ffmpeg(
            [*inputs, "-t", f"{duration:.2f}", "-filter_complex", vf, "-map", "[v]", "-an",
             "-c:v", "libx264", "-preset", "veryfast", "-crf", "24", "-pix_fmt", "yuv420p", "-movflags", "+faststart", str(out)],
            timeout=120,
        )
    ass.unlink(missing_ok=True)
    return public_path(out)

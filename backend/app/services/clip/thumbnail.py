"""Thumbnail generator: the clip's best frame with a big, readable hook on it.

1. Frames. A dozen frames across the clip are scored: sharp (variance of the Laplacian, so no
   motion blur), well exposed, contrasty and colourful, with a bonus near the clip's best line
   (where the reaction usually is) and a penalty for near-duplicates of a better frame. The top
   three are offered; the best is used unless the user picks another.
2. Text. 2-4 words: the AI pack's thumbnail_text when there is one, else the punchiest words of
   the clip's best line, else the title. Uppercase, auto-sized to fill the width in up to three
   lines, white with a heavy outline, the strongest word in the accent colour.
3. Layout. The text sits in the upper third over a soft dark gradient (the bottom is where the
   platform's own UI goes); a small @streamer tag is added when we're sure who it is.

Output is a 1080x1920 JPEG in storage/thumbnails, recorded on clip.context_json["thumbnail"].
"""
from __future__ import annotations

import io
import re
import subprocess
import time
from dataclasses import dataclass
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont

from app.core.media import (
    MediaError,
    ffmpeg_bin,
    local_media,
    probe,
    public_path,
    remove_media,
    storage_root,
)

W, H = 1080, 1920
FONTS = Path(__file__).resolve().parents[3] / "assets" / "fonts"
FONT_FILE = "google-Anton-400.ttf"  # condensed and heavy: the thumbnail standard
ACCENT = (255, 230, 0)  # design-check: thumbnails are images, not app UI
WHITE, BLACK = (255, 255, 255), (0, 0, 0)
SAMPLES = 12
STRONG = re.compile(r"\b(no|way|what|why|insane|crazy|lost|won|never|again|bro|dead|help|stop|real|actually|cooked|done)\b", re.I)


@dataclass
class Frame:
    t: float
    score: float
    preview: bytes  # small JPEG, for the picker


def _grab(src: Path, t: float, width: int) -> Image.Image:
    cmd = [ffmpeg_bin(), "-hide_banner", "-loglevel", "error", "-ss", f"{max(0.0, t):.3f}", "-i", str(src),
           "-frames:v", "1", "-vf", f"scale={width}:-2", "-f", "image2pipe", "-vcodec", "png", "-"]
    result = subprocess.run(cmd, capture_output=True, timeout=60)
    if result.returncode != 0 or not result.stdout:
        raise MediaError("Couldn't read a frame from the clip.")
    return Image.open(io.BytesIO(result.stdout)).convert("RGB")


def _quality(img: Image.Image) -> tuple[float, np.ndarray]:
    a = np.asarray(img, dtype=np.float32) / 255.0
    gray = a @ np.array([0.299, 0.587, 0.114], dtype=np.float32)
    lap = (-4 * gray[1:-1, 1:-1] + gray[:-2, 1:-1] + gray[2:, 1:-1] + gray[1:-1, :-2] + gray[1:-1, 2:])
    sharp = float(np.log1p(lap.var() * 1e4))  # ~0-6
    exposure = 1.0 - min(1.0, abs(float(gray.mean()) - 0.45) / 0.45)  # 1 = well exposed
    contrast = min(1.0, float(gray.std()) / 0.25)
    rg, yb = a[..., 0] - a[..., 1], 0.5 * (a[..., 0] + a[..., 1]) - a[..., 2]
    colour = min(1.0, float(np.sqrt(rg.std() ** 2 + yb.std() ** 2) + 0.3 * np.sqrt(rg.mean() ** 2 + yb.mean() ** 2)) / 0.35)
    score = 1.0 * sharp + 2.0 * exposure + 1.5 * contrast + 1.0 * colour
    tiny = np.asarray(img.resize((16, 28)).convert("L"), dtype=np.float32) / 255.0
    return score, tiny


def candidate_frames(src: Path, duration: float | None = None, focus_s: float | None = None, keep: int = 3) -> list[Frame]:
    """The `keep` best distinct frames of a clip file, best first."""
    duration = duration or probe(src)[0]
    if duration <= 0:
        raise MediaError("The clip has no video.")
    times = np.linspace(duration * 0.06, duration * 0.94, SAMPLES)
    scored = []
    for t in times:
        try:
            img = _grab(src, float(t), 270)
        except MediaError:
            continue
        score, tiny = _quality(img)
        if focus_s is not None:  # the moment the best line is said, give or take
            score += 1.5 * max(0.0, 1.0 - abs(float(t) - focus_s) / 3.0)
        buf = io.BytesIO()
        img.save(buf, "JPEG", quality=80)
        scored.append((score, float(t), tiny, buf.getvalue()))
    scored.sort(key=lambda s: -s[0])
    picked: list[tuple[float, float, np.ndarray, bytes]] = []
    for s in scored:
        if all(float(np.abs(s[2] - p[2]).mean()) > 0.04 for p in picked):  # skip near-duplicates
            picked.append(s)
        if len(picked) == keep:
            break
    return [Frame(t=round(t, 2), score=round(score, 2), preview=preview) for score, t, _, preview in picked]


def hook_text(ctx: dict, quotes: list[str], title: str | None) -> str:
    """2-4 words for the thumbnail."""
    if ctx.get("thumbnail_text"):
        return str(ctx["thumbnail_text"])
    for quote in quotes:
        words = re.findall(r"[\w'?!]+", quote)
        if not words:
            continue
        hits = [i for i, w in enumerate(words) if STRONG.search(w)]
        i = hits[0] if hits else 0
        return " ".join(words[max(0, i - 1): max(0, i - 1) + 4])
    words = re.findall(r"[\w'?!]+", re.sub(r"[^\w\s'?!]", " ", title or ""))
    return " ".join(words[:4]) or "WATCH THIS"


def _font(size: int) -> ImageFont.FreeTypeFont:
    return ImageFont.truetype(str(FONTS / FONT_FILE), size)


def _layout(text: str, max_w: int, max_lines: int = 3) -> tuple[ImageFont.FreeTypeFont, list[str]]:
    """Largest font size at which the words fit in max_lines lines of max_w pixels."""
    words = text.upper().split()
    for size in range(200, 70, -6):
        font = _font(size)
        lines: list[str] = []
        for w in words:
            trial = f"{lines[-1]} {w}" if lines else w
            if lines and font.getlength(trial) <= max_w:
                lines[-1] = trial
            else:
                lines.append(w)
        if len(lines) <= max_lines and all(font.getlength(l) <= max_w for l in lines):
            return font, lines
    font = _font(72)
    return font, [" ".join(words)]


def _accent_word(words: list[str]) -> str | None:
    strong = [w for w in words if STRONG.search(w)]
    return (strong or sorted(words, key=len, reverse=True) or [None])[0]


def render(src: Path, t: float, text: str, out: Path, streamer: str | None = None) -> Path:
    base = _grab(src, t, W)
    if base.size != (W, H):  # not a 9:16 clip: cover-crop to it
        scale = max(W / base.width, H / base.height)
        base = base.resize((int(base.width * scale + 0.5), int(base.height * scale + 0.5)), Image.LANCZOS)
        left, top = (base.width - W) // 2, (base.height - H) // 2
        base = base.crop((left, top, left + W, top + H))
    base = base.filter(ImageFilter.UnsharpMask(radius=2, percent=60, threshold=2))

    # Soft dark gradient behind the text so it reads on any frame.
    shade = Image.new("L", (W, H), 0)
    grad = np.clip(1.0 - np.linspace(0, 1, int(H * 0.55)) ** 1.6, 0, 1) * 170
    shade.paste(Image.fromarray(np.repeat(grad[:, None], W, axis=1).astype(np.uint8)), (0, 0))
    base = Image.composite(Image.new("RGB", (W, H), BLACK), base, shade)

    draw = ImageDraw.Draw(base)
    font, lines = _layout(text, int(W * 0.88))
    accent = _accent_word(" ".join(lines).split())
    line_h = int(font.size * 1.05)
    y = int(H * 0.21) - (line_h * len(lines)) // 2
    stroke = max(6, font.size // 11)
    for line in lines:
        words = line.split()
        widths = [font.getlength(w) for w in words]
        gap = font.getlength(" ")
        x = (W - (sum(widths) + gap * (len(words) - 1))) / 2
        for w, width in zip(words, widths):
            colour = ACCENT if w == accent else WHITE
            draw.text((x, y), w, font=font, fill=colour, stroke_width=stroke, stroke_fill=BLACK)
            x += width + gap
        y += line_h

    if streamer:
        tag = f"@{streamer.lstrip('@')}"
        tag_font = _font(64)
        tw = int(tag_font.getlength(tag))
        pad, th = 28, 92
        x0, y0 = (W - tw) // 2 - pad, int(H * 0.21) + (line_h * len(lines)) // 2 + 36
        draw.rounded_rectangle((x0, y0, x0 + tw + 2 * pad, y0 + th), radius=th // 2, fill=ACCENT)
        draw.text((x0 + pad, y0 + (th - 64) // 2 - 6), tag, font=tag_font, fill=BLACK)

    out.parent.mkdir(parents=True, exist_ok=True)
    base.save(out, "JPEG", quality=90, optimize=True, progressive=True)
    return out


def make_for_clip(clip, *, t: float | None = None, text: str | None = None) -> dict:
    """Make (or remake) a clip's thumbnail. Returns what's saved on context_json["thumbnail"]."""
    from app.services.ai.title_writer import best_quotes, identify_streamer

    src = local_media(clip.raw_file_path)
    if not clip.raw_file_path or not src.is_file():
        raise MediaError("The clip's video is no longer on disk.")
    ctx = dict(clip.context_json or {})
    words = clip.transcript_json or []
    quotes = best_quotes(words)
    focus = None
    if quotes and words:  # time of the best line inside the clip
        first = quotes[0].split()[0].lower().strip(",.!?")
        focus = next((float(w["start"]) for w in words if str(w.get("word", "")).lower().strip(",.!?") == first), None)
    if t is None:
        frames = candidate_frames(src, focus_s=focus, keep=1)
        t = frames[0].t if frames else 0.5
    name, confidence = identify_streamer(clip, ctx)
    text = (text or hook_text(ctx, quotes, clip.title)).strip()[:60]
    out = storage_root() / "thumbnails" / f"clip_{clip.id}_{int(time.time() * 1000)}.jpg"
    render(src, t, text, out, streamer=name if confidence == "high" else None)
    old = (ctx.get("thumbnail") or {}).get("path")
    if old and old.startswith("storage/thumbnails/"):
        remove_media(old)
    return {"path": public_path(out), "text": text, "frame_s": round(t, 2), "streamer_tag": name if confidence == "high" else None}

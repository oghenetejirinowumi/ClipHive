"""Draw caption emoji as animated overlays for burned clips.

libass can't draw colour emoji, so each emoji is rendered with Pillow from the system's colour
emoji font (Apple Color Emoji, Noto Color Emoji or Segoe UI Emoji; Twemoji PNGs from a CDN
as a last resort), animated frame by frame into a short PNG sequence, and laid over the video
by ffmpeg at its time and place. A frame sequence (rather than ffmpeg scale/rotate
expressions) lets every motion squash, spin, fade and throw particles exactly the same way
in every render.
"""
from __future__ import annotations

import logging
import math
import random
import shutil
import threading
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path

logger = logging.getLogger("cliphive.captions.emoji")

FPS = 30
IN_S = {"pop": 0.32, "bounce": 0.6, "float": 0.5, "spin": 0.5, "wiggle": 0.25, "slide": 0.42, "stamp": 0.2, "burst": 0.32}
OUT_S = 0.18
CANVAS = 4.0  # frame side, in emoji sizes: room to slide in, drop, grow and burst

_FONTS = (
    ("/System/Library/Fonts/Apple Color Emoji.ttc", 160),
    ("/usr/share/fonts/truetype/noto/NotoColorEmoji.ttf", 109),
    ("/usr/share/fonts/noto/NotoColorEmoji.ttf", 109),
    ("/usr/share/fonts/google-noto-emoji/NotoColorEmoji.ttf", 109),
    ("/usr/share/fonts/noto-emoji/NotoColorEmoji.ttf", 109),
    ("C:/Windows/Fonts/seguiemj.ttf", 160),
)
TWEMOJI_URL = "https://cdn.jsdelivr.net/gh/jdecked/twemoji@15.1.0/assets/72x72/{}.png"
_lock = threading.Lock()


def available() -> bool:
    try:
        import PIL  # noqa: F401
    except ImportError:
        return False
    return True


@dataclass
class PlacedEmoji:
    """One emoji on the 1080x1920 canvas: centre, size in px, and how it moves."""

    emoji: str
    start: float
    end: float
    motion: str
    cx: float
    cy: float
    size: float
    side: int = 1  # slide in from the right (1) or left (-1)
    seed: int = 0


@dataclass
class Overlay:
    pattern: Path  # printf-style PNG sequence
    start: float
    x: int  # top-left on the video
    y: int


# --- glyphs -------------------------------------------------------------------------------

@lru_cache(maxsize=1)
def _font():
    from PIL import ImageFont

    for path, size in _FONTS:
        if Path(path).is_file():
            try:
                return ImageFont.truetype(path, size), size
            except OSError:
                continue
    return None, 0


def _twemoji_name(emoji: str) -> str:
    points = [f"{ord(c):x}" for c in emoji]
    if "200d" not in points:  # Twemoji file names drop the variation selector outside ZWJ sequences
        points = [p for p in points if p != "fe0f"]
    return "-".join(points)


def _twemoji(emoji: str):
    from PIL import Image

    from app.core.media import storage_root

    cache = storage_root() / "emoji_glyphs"
    cache.mkdir(parents=True, exist_ok=True)
    name = _twemoji_name(emoji)
    path = cache / f"{name}.png"
    if not path.is_file():
        import requests

        resp = requests.get(TWEMOJI_URL.format(name), timeout=8)
        if resp.status_code != 200:
            return None
        path.write_bytes(resp.content)
    return Image.open(path).convert("RGBA")


@lru_cache(maxsize=128)
def glyph(emoji: str):
    """The emoji as a tight RGBA image (as large as the font draws it), or None."""
    from PIL import Image, ImageDraw

    font, size = _font()
    img = None
    if font is not None:
        canvas = Image.new("RGBA", (int(size * 1.6), int(size * 1.6)), (0, 0, 0, 0))
        try:
            ImageDraw.Draw(canvas).text((size * 0.1, size * 0.1), emoji, font=font, embedded_color=True)
            box = canvas.getbbox()
            # A colour font that lacks the emoji draws nothing, or a flat monochrome box.
            if box and len(set(canvas.crop(box).convert("RGB").getdata())) > 4:
                img = canvas.crop(box)
        except (OSError, ValueError):
            img = None
    if img is None:
        try:
            img = _twemoji(emoji)
        except Exception as err:  # noqa: BLE001 - offline: the emoji is skipped
            logger.info("No glyph for %r: %s", emoji, err)
            return None
    if img is None:
        return None
    side = max(img.size)
    square = Image.new("RGBA", (side, side), (0, 0, 0, 0))
    square.paste(img, ((side - img.width) // 2, (side - img.height) // 2))
    return square


def _with_shadow(img, size: int):
    """Scale to `size` and add a soft drop shadow so it reads on any background."""
    from PIL import Image, ImageFilter

    pad = max(4, size // 8)
    base = img.resize((size, size), Image.LANCZOS)
    out = Image.new("RGBA", (size + pad * 2, size + pad * 2), (0, 0, 0, 0))
    shadow = Image.new("RGBA", out.size, (0, 0, 0, 0))
    alpha = base.getchannel("A").point(lambda a: a * 0.45)
    shadow.paste((0, 0, 0, 255), (pad, pad + max(2, size // 28)), alpha)
    out.alpha_composite(shadow.filter(ImageFilter.GaussianBlur(max(2, size / 24))))
    out.alpha_composite(base, (pad, pad))
    return out


# --- motion -------------------------------------------------------------------------------

def _back_out(p: float, k: float = 2.4) -> float:
    p -= 1
    return 1 + (k + 1) * p ** 3 + k * p ** 2


def _ease_out(p: float) -> float:
    return 1 - (1 - p) ** 3


def _bounce_out(p: float) -> float:
    n, d = 7.5625, 2.75
    if p < 1 / d:
        return n * p * p
    if p < 2 / d:
        p -= 1.5 / d
        return n * p * p + 0.75
    if p < 2.5 / d:
        p -= 2.25 / d
        return n * p * p + 0.9375
    p -= 2.625 / d
    return n * p * p + 0.984375


@dataclass
class Pose:
    dx: float = 0.0  # offset, in emoji sizes
    dy: float = 0.0
    sx: float = 1.0  # scale
    sy: float = 1.0
    rot: float = 0.0  # degrees, counter-clockwise
    alpha: float = 1.0


def pose(motion: str, t: float, duration: float, side: int = 1) -> Pose:
    """Where the emoji is `t` seconds after it appears."""
    p = min(1.0, t / IN_S.get(motion, 0.3))
    bob = 0.035 * math.sin(2 * math.pi * 1.4 * t)  # gentle idle motion once it has landed
    if motion == "pop":
        s = max(0.0, _back_out(p))
        pz = Pose(sx=s, sy=s, dy=bob * (p >= 1), alpha=min(1.0, p * 3))
    elif motion == "bounce":
        drop = 1 - _bounce_out(p)
        squash = 0.12 * math.sin(math.pi * min(1.0, max(0.0, (t - IN_S["bounce"] * 0.36) / 0.12))) if p < 1 else 0
        pz = Pose(dy=-1.3 * drop, sx=1 + squash, sy=1 - squash, alpha=min(1.0, p * 4))
    elif motion == "float":
        rise = _ease_out(p)
        pz = Pose(dy=0.6 * (1 - rise) - 0.12 * max(0.0, t - IN_S["float"]), rot=6 * math.sin(2 * math.pi * 0.9 * t),
                  sx=0.7 + 0.3 * rise, sy=0.7 + 0.3 * rise, alpha=rise)
    elif motion == "spin":
        e = _ease_out(p)
        s = _back_out(p, 1.6)
        pz = Pose(rot=360 * (1 - e) * side, sx=max(0.0, s), sy=max(0.0, s), dy=bob * (p >= 1), alpha=min(1.0, p * 3))
    elif motion == "wiggle":
        s = max(0.0, _back_out(p, 2.0))
        pz = Pose(sx=s, sy=s, rot=14 * math.sin(2 * math.pi * 3.2 * t) * (0.55 + 0.45 * math.cos(math.pi * t)), alpha=min(1.0, p * 3))
    elif motion == "slide":
        e = _back_out(p, 1.7)
        pz = Pose(dx=1.4 * side * (1 - e), rot=-18 * side * (1 - _ease_out(p)), dy=bob * (p >= 1), alpha=min(1.0, p * 2.5))
    elif motion == "stamp":
        if p < 1:
            s = 2.4 - 1.5 * p * p  # slams down from big
            pz = Pose(sx=s, sy=s, rot=-10, alpha=min(1.0, p * 2))
        else:
            k = t - IN_S["stamp"]
            thud = 0.12 * math.exp(-k * 14) * math.sin(k * 60)  # recoil and a little shake
            pz = Pose(sx=0.9 + thud, sy=0.9 - thud, rot=-10 + 4 * thud, dx=0.5 * thud)
    elif motion == "burst":
        s = max(0.0, _back_out(p, 2.8))
        pz = Pose(sx=s, sy=s, dy=bob * (p >= 1), alpha=min(1.0, p * 3))
    else:
        pz = Pose()
    # Exit: shrink and fade over the last moment.
    left = duration - t
    if left < OUT_S:
        k = max(0.0, left / OUT_S)
        pz.alpha *= k
        pz.sx *= 0.6 + 0.4 * k
        pz.sy *= 0.6 + 0.4 * k
    return pz


def particles(t: float, seed: int, count: int = 7) -> list[tuple[float, float, float, float]]:
    """Burst sparks: (dx, dy, scale, alpha) per particle, in emoji sizes."""
    rng = random.Random(seed)
    life = 0.75
    out = []
    for n in range(count):
        angle = (n / count) * 2 * math.pi + rng.uniform(-0.3, 0.3)
        dist = rng.uniform(1.0, 1.6)
        k = min(1.0, t / life)
        if k >= 1:
            continue
        e = _ease_out(k)
        out.append((math.cos(angle) * dist * e, math.sin(angle) * dist * e + 0.4 * k * k, 0.32 * (1 - 0.5 * k), 1 - k))
    return out


# --- frames -------------------------------------------------------------------------------

def render_frames(item: PlacedEmoji, folder: Path) -> Overlay | None:
    """Write the PNG sequence for one emoji. Returns where it goes, or None without a glyph."""
    from PIL import Image

    base = glyph(item.emoji)
    if base is None:
        return None
    size = int(round(item.size))
    sprite = _with_shadow(base, max(8, int(size * 1.2)))  # drawn a bit large: scaling down stays crisp
    side_px = int(size * CANVAS)
    duration = max(0.3, item.end - item.start)
    frames = max(2, int(round(duration * FPS)))
    folder.mkdir(parents=True, exist_ok=True)
    scale_k = 1 / 1.2  # the sprite is drawn 1.2x large
    cache: dict[tuple, Image.Image] = {}

    def draw(frame: Image.Image, sx: float, sy: float, rot: float, alpha: float, cx: float, cy: float) -> None:
        if alpha <= 0.01 or sx <= 0.02 or sy <= 0.02:
            return
        w = max(1, int(sprite.width * sx * scale_k))
        h = max(1, int(sprite.height * sy * scale_k))
        key = (w, h, round(rot, 1), round(alpha, 2))
        img = cache.get(key)
        if img is None:
            img = sprite.resize((w, h), Image.BICUBIC)
            if abs(rot) > 0.2:
                img = img.rotate(rot, resample=Image.BICUBIC, expand=True)
            if alpha < 0.999:
                img.putalpha(img.getchannel("A").point(lambda a: int(a * alpha)))
            if len(cache) < 400:
                cache[key] = img
        frame.alpha_composite(img, (int(cx - img.width / 2), int(cy - img.height / 2)))

    centre = side_px / 2
    for n in range(frames):
        t = n / FPS
        frame = Image.new("RGBA", (side_px, side_px), (0, 0, 0, 0))
        if item.motion == "burst":
            for dx, dy, s, a in particles(t, item.seed):
                draw(frame, s, s, 0, a, centre + dx * size, centre + dy * size)
        pz = pose(item.motion, t, duration, item.side)
        draw(frame, pz.sx, pz.sy, pz.rot, pz.alpha, centre + pz.dx * size, centre + pz.dy * size)
        frame.save(folder / f"{n:04d}.png", compress_level=1)
    return Overlay(folder / "%04d.png", item.start, int(round(item.cx - centre)), int(round(item.cy - centre)))


def render_all(items: list[PlacedEmoji], work: Path) -> list[Overlay]:
    """Frames for every emoji under work/ (cleared first). Emoji without a glyph are skipped."""
    if not items or not available():
        return []
    shutil.rmtree(work, ignore_errors=True)
    out: list[Overlay] = []
    with _lock:  # glyph cache + font object aren't thread-safe
        for i, item in enumerate(items):
            try:
                ov = render_frames(item, work / f"e{i:02d}")
            except Exception:  # noqa: BLE001 - one bad emoji never fails the burn
                logger.exception("Couldn't draw emoji %r", item.emoji)
                ov = None
            if ov:
                out.append(ov)
    return out


def ffmpeg_parts(overlays: list[Overlay], first_input: int, source: str) -> tuple[list[str], list[str], str]:
    """Inputs and filter chain laying the overlays on `source` (a filter label like "0:v").

    Returns (input args, filter statements, output label). Each sequence is shifted to its start
    time and drops off when it ends (eof_action=pass), so the video plays through untouched.
    """
    inputs: list[str] = []
    chain: list[str] = []
    label = source
    for n, ov in enumerate(overlays):
        idx = first_input + n
        inputs += ["-framerate", str(FPS), "-i", str(ov.pattern)]
        chain.append(f"[{idx}:v]format=rgba,setpts=PTS-STARTPTS+{ov.start:.3f}/TB[em{n}]")
        out = f"emv{n}"
        chain.append(f"[{label}][em{n}]overlay=x={ov.x}:y={ov.y}:eof_action=pass:format=auto[{out}]")
        label = out
    return inputs, chain, label

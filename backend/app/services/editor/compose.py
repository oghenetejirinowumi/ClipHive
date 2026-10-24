"""Compile an editor timeline into a HyperFrames composition (one standalone index.html).

The same compiler feeds both the browser preview (<hyperframes-player srcdoc>, media loaded
from the API's /storage URLs) and the server render (`hyperframes render`, media copied next
to the file), so what the user previews is what gets exported.

Conventions follow the HyperFrames core contract: timing lives on the media/text element
itself (`data-start`, `data-duration`, `data-media-start`, `data-playback-rate`), never on a
timed ancestor; fades animate an untimed wrapper; text animations tween an inner span, so no
GSAP tween ever touches a `.clip` element or fights a CSS transform.

Effects animate a chain of untimed wrappers around the visual tracks (one wrapper per effect
layer, so a punch-in and a shake can run at once without fighting over `transform`), plus two
overlays (flash, vignette) between the picture and the text. Text is never moved by effects.
"""
from __future__ import annotations

import json
import random
from collections.abc import Callable
from html import escape
from pathlib import Path

from app.schemas.editor import Asset, AudioTrack, Clip, Effect, Text, Timeline

GSAP_URL = "https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js"

# Fonts shipped in backend/assets/fonts. "System" uses the generic sans-serif stack.
FONT_FILES = {
    "Bangers": "Bangers-Regular.ttf",
    "Luckiest Guy": "LuckiestGuy-Regular.ttf",
    "Poppins": "Poppins-SemiBold.ttf",
}
FONT_STACK = {"Bangers": "'Bangers'", "Luckiest Guy": "'Luckiest Guy'", "Poppins": "'Poppins'", "System": "system-ui"}


def _font_filename(font_name: str) -> str | None:
    if font_name in FONT_FILES:
        return FONT_FILES[font_name]
    try:
        from app.services.caption import fonts
        info = fonts.get_font(font_name)
        if info:
            return info.file.name
    except Exception:
        pass
    return None

def font_file(font_name: str) -> Path | None:
    """The file behind a font name (the one _font_filename names), for copying into a render."""
    name = _font_filename(font_name)
    if not name:
        return None
    path = Path(__file__).resolve().parents[3] / "assets" / "fonts" / name
    if path.is_file():
        return path
    try:
        from app.services.caption import fonts

        info = fonts.get_font(font_name)
        return Path(info.file) if info and Path(info.file).is_file() else None
    except Exception:
        return None


TEXT_IN_S = 0.3
TEXT_OUT_S = 0.2


def _n(value: float) -> str:
    return f"{value:.3f}".rstrip("0").rstrip(".") or "0"


def _attr(value: str) -> str:
    return escape(value, quote=True)


def _volume_lane(volume: float, duration: float, fade_in: float, fade_out: float) -> str | None:
    """A data-automation volume lane for fades, in clip-local seconds. None when there's no fade."""
    fade_in, fade_out = min(fade_in, duration / 2), min(fade_out, duration / 2)
    if not fade_in and not fade_out:
        return None
    points = [{"t": 0, "v": 0 if fade_in else volume}]
    if fade_in:
        points.append({"t": round(fade_in, 3), "v": volume})
    if fade_out:
        points.append({"t": round(duration - fade_out, 3), "v": volume})
        points.append({"t": round(duration, 3), "v": 0})
    else:
        points.append({"t": round(duration, 3), "v": volume})
    return json.dumps({"version": 1, "lanes": [{"target": "volume", "points": points}]}, separators=(",", ":"))


def _sound_attrs(volume: float, duration: float, fade_in: float, fade_out: float) -> str:
    lane = _volume_lane(volume, duration, fade_in, fade_out)
    # With a lane, the lane carries the level; data-volume would be ignored or doubled.
    return f" data-automation='{lane}'" if lane else f' data-volume="{_n(volume)}"'


# CSS versions of the Studio's ffmpeg colour filters (services/clip/cutter.py COLOR_FILTERS).
LOOKS = {
    "vibrant": "contrast(1.15) saturate(1.35) brightness(1.02)",
    "warm": "sepia(0.2) saturate(1.15) hue-rotate(-6deg)",
    "cool": "saturate(1.05) hue-rotate(12deg) brightness(1.02)",
    "dramatic": "grayscale(1) contrast(1.25) brightness(0.96)",
}
BLUR_BACKDROP = "blur(36px) brightness(0.82) saturate(1.15)"
BACKDROP_TRACK = 1000  # blur backdrop copies: track indexes no clip or audio track uses (audio is 10 + index)


def _clip_html(clip: Clip, asset: Asset, url: str, z: int) -> str:
    wrap = f"w-{clip.id}"
    timing = f'data-start="{_n(clip.start)}" data-duration="{_n(clip.duration)}" data-track-index="{clip.track}"'
    look = LOOKS.get(clip.look, "")
    style = f"object-fit: {'contain' if clip.fit == 'blur' else clip.fit}" + (f"; filter: {look}" if look else "")
    backdrop = ""
    if clip.fit == "blur":  # a muted, blurred copy fills the frame behind the whole picture
        back_timing = timing.replace(f'data-track-index="{clip.track}"', f'data-track-index="{BACKDROP_TRACK + clip.track}"')
        back_style = f"object-fit: cover; filter: {BLUR_BACKDROP}{' ' + look if look else ''}; transform: scale(1.12)"
        if asset.kind == "image":
            backdrop = f'<img id="b-{clip.id}" class="clip media" src="{_attr(url)}" {back_timing} style="{back_style}" alt="" />'
        else:
            rate = f' data-playback-rate="{_n(clip.speed)}"' if clip.speed != 1 else ""
            backdrop = (
                f'<video id="b-{clip.id}" class="clip media" src="{_attr(url)}" {back_timing} '
                f'data-media-start="{_n(clip.source_in)}"{rate} muted playsinline style="{back_style}"></video>'
            )
    if asset.kind == "image":
        media = f'<img id="m-{clip.id}" class="clip media" src="{_attr(url)}" {timing} style="{style}" alt="" />'
    else:
        audible = asset.has_audio and not clip.muted and clip.volume > 0
        sound = f' data-has-audio="true"{_sound_attrs(clip.volume, clip.duration, clip.fade_in, clip.fade_out)}' if audible else " muted"
        rate = f' data-playback-rate="{_n(clip.speed)}"' if clip.speed != 1 else ""
        media = (
            f'<video id="m-{clip.id}" class="clip media" src="{_attr(url)}" {timing} '
            f'data-media-start="{_n(clip.source_in)}"{rate}{sound} playsinline style="{style}"></video>'
        )
    return f'<div id="{wrap}" class="layer" style="z-index: {z}">{backdrop}{media}</div>'


def _clip_tweens(clip: Clip) -> list[str]:
    sel = json.dumps(f"#w-{clip.id}")
    fade_in, fade_out = min(clip.fade_in, clip.duration / 2), min(clip.fade_out, clip.duration / 2)
    out = []
    if fade_in:
        out.append(f"tl.fromTo({sel}, {{opacity: 0}}, {{opacity: 1, duration: {_n(fade_in)}, ease: 'none'}}, {_n(clip.start)});")
    if fade_out:
        out.append(f"tl.fromTo({sel}, {{opacity: 1}}, {{opacity: 0, duration: {_n(fade_out)}, ease: 'none', immediateRender: false}}, {_n(clip.end - fade_out)});")
    return out


def _text_html(text: Text, width: int, height: int, z: int) -> str:
    content = text.text.upper() if text.uppercase else text.text
    stroke = (
        f"-webkit-text-stroke: {text.stroke_width * 2}px {text.stroke_color}; paint-order: stroke fill;"
        if text.stroke_color and text.stroke_width
        else ""
    )
    box = f"background: {text.background}; padding: 0.12em 0.35em; border-radius: 0.2em;" if text.background else ""
    outer = (
        f"left: {_n(text.x * width)}px; top: {_n(text.y * height)}px; width: {_n(text.width * width)}px; z-index: {z}"
    )
    font_fam = FONT_STACK.get(text.font, f"'{text.font}'" if text.font != "System" else "system-ui")
    inner = f"font-family: {font_fam}, system-ui, sans-serif; font-size: {text.size}px; color: {text.color}; {stroke} {box}"
    return (
        f'<div id="t-{text.id}" class="clip text" data-start="{_n(text.start)}" data-duration="{_n(text.duration)}" '
        f'data-track-index="5" style="{outer}"><span id="ts-{text.id}" class="text-inner" style="{inner}">{escape(content)}</span></div>'
    )


def _text_tweens(text: Text) -> list[str]:
    sel = json.dumps(f"#ts-{text.id}")
    start, dur = text.start, text.duration
    in_s = min(TEXT_IN_S, dur / 3)
    out_s = min(TEXT_OUT_S, dur / 4)
    tweens = {
        "fade": f"tl.fromTo({sel}, {{opacity: 0}}, {{opacity: 1, duration: {_n(in_s)}, ease: 'power1.out'}}, {_n(start)});",
        "line": f"tl.fromTo({sel}, {{opacity: 0, y: 15}}, {{opacity: 1, y: 0, duration: {_n(in_s)}, ease: 'power1.out'}}, {_n(start)});",
        "pop": f"tl.fromTo({sel}, {{opacity: 0, scale: 0.6}}, {{opacity: 1, scale: 1, duration: {_n(in_s)}, ease: 'back.out(2.2)'}}, {_n(start)});\n      tl.to({sel}, {{scale: 1.08, duration: 0.12, yoyo: true, repeat: 1}}, {_n(start + in_s)});",
        "word_pop": f"tl.fromTo({sel}, {{opacity: 0, scale: 0.6}}, {{opacity: 1, scale: 1, duration: {_n(in_s)}, ease: 'back.out(2.2)'}}, {_n(start)});\n      tl.to({sel}, {{scale: 1.12, duration: 0.12, yoyo: true, repeat: 1}}, {_n(start + in_s)});",
        "single_word": f"tl.fromTo({sel}, {{opacity: 0, scale: 0.4}}, {{opacity: 1, scale: 1, duration: {_n(in_s)}, ease: 'back.out(2.5)'}}, {_n(start)});",
        "highlight_box": f"tl.fromTo({sel}, {{opacity: 0, scale: 0.85}}, {{opacity: 1, scale: 1, duration: {_n(in_s)}, ease: 'back.out(1.8)'}}, {_n(start)});",
        "karaoke": f"tl.fromTo({sel}, {{opacity: 0, scale: 0.9}}, {{opacity: 1, scale: 1, duration: {_n(in_s)}, ease: 'power2.out'}}, {_n(start)});\n      tl.to({sel}, {{filter: 'drop-shadow(0 0 10px gold)', duration: 0.2}}, {_n(start + 0.1)});",
        "slide_up": f"tl.fromTo({sel}, {{opacity: 0, yPercent: 60}}, {{opacity: 1, yPercent: 0, duration: {_n(in_s)}, ease: 'power3.out'}}, {_n(start)});",
        "typewriter": (
            f"tl.fromTo({sel}, {{clipPath: 'inset(0 100% 0 0)'}}, {{clipPath: 'inset(0 0% 0 0)', "
            f"duration: {_n(min(1.2, dur * 0.6))}, ease: 'steps({max(2, min(40, len(text.text)))})'}}, {_n(start)});"
        ),
        "reveal": (
            f"tl.fromTo({sel}, {{clipPath: 'inset(0 100% 0 0)'}}, {{clipPath: 'inset(0 0% 0 0)', "
            f"duration: {_n(min(1.2, dur * 0.6))}, ease: 'steps({max(2, min(40, len(text.text)))})'}}, {_n(start)});"
        ),
    }
    # "none" adds no entry tween: the runtime hides the clip before its start. (Zero-length
    # opacity sets at 0 combined with the end kill below left the text hidden in renders.)
    out = [tweens[text.animation]] if text.animation in tweens else []
    # Everything but "none" eases out too; captions cut hard so the next phrase can land.
    if text.animation != "none" and not text.is_caption and dur > 1:
        out.append(f"tl.to({sel}, {{opacity: 0, duration: {_n(out_s)}, ease: 'power1.in'}}, {_n(start + dur - out_s)});")
    # Hard kill on the inner span at the end. The runtime hides the timed .clip too, but parallel
    # video renders were seen leaving a caption on screen past its window; this makes it certain.
    out.append(f"tl.set({sel}, {{opacity: 0}}, {_n(start + dur)});")
    return out


# Effect layers, outermost first. Each is an untimed full-frame div wrapping the next.
FX_WRAPPERS = ("fx-push", "fx-zoom", "fx-shake", "fx-glitch", "fx-pop", "fx-bw")
FX_LAYER = {"slow_zoom": "fx-push", "punch_zoom": "fx-zoom", "shake": "fx-shake", "glitch": "fx-glitch",
            "color_pop": "fx-pop", "black_white": "fx-bw", "flash": "fx-flash", "vignette": "fx-vignette"}


def _from_to(sel: str, start: dict, end: dict, duration: float, at: float, ease: str = "none") -> str:
    """A seek-safe fromTo that only takes effect from its own start time."""
    to = {**end, "duration": round(max(duration, 0.001), 3), "ease": ease, "immediateRender": False}
    return f"tl.fromTo({sel}, {json.dumps(start)}, {json.dumps(to)}, {_n(at)});"


def _jitter(sel: str, effect: Effect, frame: Callable[[random.Random, float], dict], rest: dict, step: float) -> list[str]:
    """Random steps (same every render: seeded by the effect id) that decay back to `rest`."""
    rng = random.Random(effect.id)
    count = max(2, int(effect.duration / step))
    dt = effect.duration / count
    points = [rest] + [frame(rng, 1 - n / count) for n in range(1, count)] + [rest]
    return [_from_to(sel, a, b, dt, effect.start + n * dt) for n, (a, b) in enumerate(zip(points, points[1:]))]


def _ramp(sel: str, effect: Effect, off: dict, on: dict) -> list[str]:
    """Ease into a look, hold it, ease back out."""
    ramp = min(0.3, effect.duration / 3)
    return [
        _from_to(sel, off, on, ramp, effect.start, "power1.out"),
        _from_to(sel, on, off, ramp, effect.end - ramp, "power1.in"),
    ]


def _effect_tweens(effect: Effect) -> list[str]:
    sel = json.dumps(f"#{FX_LAYER[effect.kind]}")
    i, start, dur = effect.intensity, effect.start, effect.duration
    if effect.kind == "punch_zoom":
        peak = round(1.05 + 0.2 * i, 3)
        attack = min(0.12, dur / 3)
        return [_from_to(sel, {"scale": 1}, {"scale": peak}, attack, start, "power3.out"),
                _from_to(sel, {"scale": peak}, {"scale": 1}, dur - attack, start + attack, "power2.inOut")]
    if effect.kind == "slow_zoom":
        return [_from_to(sel, {"scale": 1}, {"scale": round(1 + 0.15 * i, 3)}, dur, start, "sine.inOut"),
                f"tl.set({sel}, {{scale: 1}}, {_n(effect.end)});"]
    if effect.kind == "shake":
        amp, turn = 8 + 40 * i, 0.4 + 1.6 * i
        return _jitter(sel, effect, lambda r, k: {"x": round(r.uniform(-amp, amp) * k, 1), "y": round(r.uniform(-amp, amp) * k, 1),
                                                   "rotation": round(r.uniform(-turn, turn) * k, 2)}, {"x": 0, "y": 0, "rotation": 0}, 0.05)
    if effect.kind == "glitch":
        shift, skew, hue = 12 + 60 * i, 2 + 10 * i, 40 + 140 * i
        return _jitter(sel, effect, lambda r, k: {"x": round(r.choice((-1, 1)) * r.uniform(0.4, 1) * shift, 1),
                                                   "skewX": round(r.uniform(-skew, skew), 1),
                                                   "filter": f"hue-rotate({round(r.uniform(-hue, hue))}deg) saturate({round(1 + 2 * i, 2)})"},
                       {"x": 0, "skewX": 0, "filter": "hue-rotate(0deg) saturate(1)"}, 0.04)
    if effect.kind == "flash":
        return [_from_to(sel, {"opacity": round(0.4 + 0.55 * i, 2)}, {"opacity": 0}, dur, start, "power2.out")]
    if effect.kind == "vignette":
        return _ramp(sel, effect, {"opacity": 0}, {"opacity": round(0.3 + 0.7 * i, 2)})
    if effect.kind == "color_pop":
        return _ramp(sel, effect, {"filter": "saturate(1) contrast(1)"}, {"filter": f"saturate({round(1 + 0.9 * i, 2)}) contrast({round(1 + 0.25 * i, 2)})"})
    if effect.kind == "black_white":
        return _ramp(sel, effect, {"filter": "grayscale(0) contrast(1)"}, {"filter": f"grayscale({round(i, 2)}) contrast({round(1 + 0.2 * i, 2)})"})
    return []


def _audio_html(track: AudioTrack, url: str, index: int) -> str:
    return (
        f'<audio id="a-{track.id}" src="{_attr(url)}" data-start="{_n(track.start)}" data-duration="{_n(track.duration)}" '
        f'data-media-start="{_n(track.source_in)}" data-track-index="{10 + index}"'
        f"{_sound_attrs(track.volume, track.duration, track.fade_in, track.fade_out)}></audio>"
    )


def compose(timeline: Timeline, *, media_url: Callable[[Asset], str], font_url: Callable[[str], str], title: str = "ClipHive edit") -> str:
    width, height = timeline.size
    duration = max(timeline.duration, 0.5)

    used_fonts = sorted({t.font for t in timeline.texts if t.font != "System"})
    faces = []
    for name in used_fonts:
        fname = _font_filename(name)
        if fname:
            faces.append(f"      @font-face {{ font-family: '{name}'; src: url('{_attr(font_url(fname))}'); font-display: block; }}")
    font_faces = "\n".join(faces)

    body: list[str] = []
    picture: list[str] = []
    tweens: list[str] = []
    # Visual tracks stack bottom-up; within a track later clips draw over earlier ones.
    for z, clip in enumerate(sorted(timeline.clips, key=lambda c: (c.track, c.start)), start=1):
        asset = timeline.asset(clip.asset_id)
        if asset:
            picture.append(_clip_html(clip, asset, media_url(asset), z))
            tweens += _clip_tweens(clip)
    # The picture sits inside the effect wrappers (their own stacking context, under the text).
    opening = "".join(f'<div id="{w}" class="fx">' for w in FX_WRAPPERS)
    body.append(f'<div id="stage" class="fx">{opening}' + "".join(picture) + "</div>" * len(FX_WRAPPERS) + "</div>")
    kinds = {e.kind for e in timeline.effects}
    if "vignette" in kinds:
        body.append('<div id="fx-vignette" class="fx overlay vignette"></div>')
    if "flash" in kinds:
        body.append('<div id="fx-flash" class="fx overlay flash"></div>')
    for effect in sorted(timeline.effects, key=lambda e: e.start):
        tweens += _effect_tweens(effect)
    for z, text in enumerate(sorted(timeline.texts, key=lambda t: t.start), start=1000):
        body.append(_text_html(text, width, height, z))
        tweens += _text_tweens(text)
    for index, track in enumerate(timeline.audio):
        asset = timeline.asset(track.asset_id)
        if asset:
            body.append(_audio_html(track, media_url(asset), index))

    indent = "\n      "
    return f"""<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width={width}, height={height}" />
    <title>{escape(title)}</title>
    <script src="{GSAP_URL}"></script>
    <style>
{font_faces}
      html, body {{ margin: 0; background: {timeline.background}; }}
      #root {{ position: relative; width: 100%; height: 100%; overflow: hidden; background: {timeline.background}; }}
      .layer {{ position: absolute; inset: 0; }}
      .fx {{ position: absolute; inset: 0; transform-origin: 50% 50%; }}
      #stage {{ z-index: 1; overflow: hidden; }}
      .overlay {{ pointer-events: none; opacity: 0; }}
      .vignette {{ z-index: 900; background: radial-gradient(ellipse at center, rgba(0,0,0,0) 45%, rgba(0,0,0,0.85) 100%); }}
      .flash {{ z-index: 901; background: #FFFFFF; }}
      .media {{ position: absolute; left: 0; top: 0; width: {width}px; height: {height}px; }}
      .text {{ position: absolute; transform: translate(-50%, -50%); text-align: center; line-height: 1.12; white-space: pre-line; }}
      .text-inner {{ display: inline-block; font-weight: 700; }}
    </style>
  </head>
  <body>
    <div id="root" data-composition-id="main" data-start="0" data-width="{width}" data-height="{height}" data-duration="{_n(duration)}">
      {indent.join(body)}
    </div>
    <script>
      window.__timelines = window.__timelines || {{}};
      const tl = gsap.timeline({{ paused: true }});
      {indent.join(tweens)}
      window.__timelines["main"] = tl;
    </script>
  </body>
</html>
"""

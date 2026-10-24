"""Video editor: the timeline document and the API payloads around it.

A project's timeline is one JSON document. The browser edits it directly (drag, trim, split),
the AI assistant edits it through the operations in services/editor/ops.py, and
services/editor/compose.py turns it into a HyperFrames composition for preview and render.
All times are seconds on the edit timeline unless a field says "source".
"""
from __future__ import annotations

import re
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field, field_validator, model_validator

from app.schemas.common import ORMModel

HEX = re.compile(r"^#[0-9A-Fa-f]{6}$")
ID_PATTERN = r"^[A-Za-z0-9_-]{1,40}$"  # ids become HTML ids in the composition
MAX_SECONDS = 4 * 3600

AssetKind = Literal["video", "image", "audio"]
Fit = Literal["cover", "contain", "blur"]  # blur: the whole frame, over a blurred copy filling the rest
Look = Literal["none", "vibrant", "warm", "cool", "dramatic"]  # colour grade, same names as the Studio used
TextAnimation = Literal[
    "none",
    "fade",
    "pop",
    "slide_up",
    "typewriter",
    "highlight_box",
    "karaoke",
    "reveal",
    "line",
    "single_word",
    "word_pop",
]
Font = str
# Visual effects on the picture (video/image tracks; text stays steady). See services/editor/effects.py.
EffectKind = Literal["punch_zoom", "slow_zoom", "shake", "flash", "glitch", "vignette", "color_pop", "black_white"]

ASPECTS: dict[str, tuple[int, int]] = {"9:16": (1080, 1920), "16:9": (1920, 1080), "1:1": (1080, 1080), "4:5": (1080, 1350)}


def _hex(value: str | None) -> str | None:
    if value is not None and not HEX.match(value):
        raise ValueError("must be a #RRGGBB colour")
    return value.upper() if value else value


class Asset(BaseModel):
    """A media file the project can use. src is a public "storage/..." path."""

    id: str = Field(pattern=ID_PATTERN)
    kind: AssetKind
    name: str = Field(max_length=200)
    src: str = Field(pattern=r"^storage/[^\s]+$", max_length=1024)
    duration: float | None = Field(default=None, ge=0)  # None for images
    width: int | None = None
    height: int | None = None
    has_audio: bool = False


class Clip(BaseModel):
    """A video or image placed on a visual track. Higher tracks draw on top."""

    id: str = Field(pattern=ID_PATTERN)
    asset_id: str
    track: int = Field(default=0, ge=0, le=2)
    start: float = Field(ge=0, le=MAX_SECONDS)
    duration: float = Field(gt=0, le=MAX_SECONDS)
    source_in: float = Field(default=0, ge=0)  # where in the source file this clip starts
    speed: float = Field(default=1, ge=0.25, le=4)
    volume: float = Field(default=1, ge=0, le=2)
    muted: bool = False
    fit: Fit = "cover"
    look: Look = "none"
    fade_in: float = Field(default=0, ge=0, le=10)
    fade_out: float = Field(default=0, ge=0, le=10)

    @property
    def end(self) -> float:
        return self.start + self.duration


class Text(BaseModel):
    """A text overlay. x/y are the centre of the text box as fractions of the frame."""

    id: str = Field(pattern=ID_PATTERN)
    text: str = Field(min_length=1, max_length=500)
    start: float = Field(ge=0, le=MAX_SECONDS)
    duration: float = Field(gt=0, le=MAX_SECONDS)
    x: float = Field(default=0.5, ge=0, le=1)
    y: float = Field(default=0.2, ge=0, le=1)
    width: float = Field(default=0.86, ge=0.1, le=1)  # max line width, fraction of frame width
    size: int = Field(default=84, ge=16, le=400)
    font: Font = "Bangers"
    color: str = "#FFFFFF"
    stroke_color: str | None = "#000000"
    stroke_width: int = Field(default=6, ge=0, le=30)
    background: str | None = None  # a box behind the text
    uppercase: bool = False
    animation: TextAnimation = "pop"
    is_caption: bool = False  # generated from speech by "add captions"

    @field_validator("color", "stroke_color", "background")
    @classmethod
    def check_colour(cls, v: str | None) -> str | None:
        return _hex(v)

    @property
    def end(self) -> float:
        return self.start + self.duration


class AudioTrack(BaseModel):
    """Music, voice-over or any extra sound, independent of the video clips' own audio."""

    id: str = Field(pattern=ID_PATTERN)
    asset_id: str
    start: float = Field(ge=0, le=MAX_SECONDS)
    duration: float = Field(gt=0, le=MAX_SECONDS)
    source_in: float = Field(default=0, ge=0)
    volume: float = Field(default=0.6, ge=0, le=2)
    fade_in: float = Field(default=0, ge=0, le=10)
    fade_out: float = Field(default=0, ge=0, le=10)
    is_sfx: bool = False  # placed by "auto SFX"; running it again replaces these

    @property
    def end(self) -> float:
        return self.start + self.duration


class Effect(BaseModel):
    """A timed visual effect on the whole picture. auto=True marks ones "Auto effects" placed,
    which the next auto run replaces; effects you add or edit by hand are kept."""

    id: str = Field(pattern=ID_PATTERN)
    kind: EffectKind
    start: float = Field(ge=0, le=MAX_SECONDS)
    duration: float = Field(gt=0, le=MAX_SECONDS)
    intensity: float = Field(default=0.6, ge=0.05, le=1)
    auto: bool = False

    @property
    def end(self) -> float:
        return self.start + self.duration


class Timeline(BaseModel):
    version: Literal[1] = 1
    aspect: Literal["9:16", "16:9", "1:1", "4:5"] = "9:16"
    background: str = "#000000"
    assets: list[Asset] = Field(default_factory=list, max_length=200)
    clips: list[Clip] = Field(default_factory=list, max_length=500)
    texts: list[Text] = Field(default_factory=list, max_length=2000)
    audio: list[AudioTrack] = Field(default_factory=list, max_length=300)
    effects: list[Effect] = Field(default_factory=list, max_length=500)

    @field_validator("background")
    @classmethod
    def check_background(cls, v: str) -> str:
        return _hex(v) or v

    @property
    def size(self) -> tuple[int, int]:
        return ASPECTS[self.aspect]

    @property
    def duration(self) -> float:
        ends = [c.end for c in self.clips] + [t.end for t in self.texts] + [a.end for a in self.audio]
        return round(max(ends, default=0.0), 3)

    def asset(self, asset_id: str) -> Asset | None:
        return next((a for a in self.assets if a.id == asset_id), None)

    @model_validator(mode="after")
    def check_refs(self) -> Timeline:
        ids = [x.id for x in (*self.assets, *self.clips, *self.texts, *self.audio, *self.effects)]
        dupes = {i for i in ids if ids.count(i) > 1}
        if dupes:
            raise ValueError(f"duplicate ids: {sorted(dupes)}")
        kinds = {a.id: a.kind for a in self.assets}
        for clip in self.clips:
            if kinds.get(clip.asset_id) not in ("video", "image"):
                raise ValueError(f"clip {clip.id} needs a video or image asset")
            self._check_source(clip.id, clip.asset_id, clip.source_in, clip.duration * clip.speed)
        for track in self.audio:
            if kinds.get(track.asset_id) not in ("audio", "video"):
                raise ValueError(f"audio {track.id} needs an audio or video asset")
            self._check_source(track.id, track.asset_id, track.source_in, track.duration)
        return self

    def _check_source(self, item_id: str, asset_id: str, source_in: float, used: float) -> None:
        """A clip can't play past the end of its file (consumed source = duration x speed)."""
        asset = self.asset(asset_id)
        if asset and asset.kind != "image" and asset.duration is not None and source_in + used > asset.duration + 0.05:
            raise ValueError(f"{item_id} runs past the end of {asset.name} ({asset.duration:.2f}s)")


# --- API payloads ---------------------------------------------------------------------------

class ProjectCreate(BaseModel):
    title: str = Field(default="Untitled edit", min_length=1, max_length=200)
    aspect: Literal["9:16", "16:9", "1:1", "4:5"] = "9:16"
    clip_id: int | None = None  # start from one of the user's clips
    import_id: int | None = None  # or from an import's full source video


class ProjectUpdate(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=200)
    timeline: Timeline | None = None
    revision: int | None = None  # the revision this edit was based on; 409 if it's stale


class ChatMessage(BaseModel):
    role: Literal["user", "assistant"]
    content: str
    changes: list[str] = Field(default_factory=list)  # what the assistant did, one line each
    at: datetime
    version_from: int | None = None  # the version this turn started from ("v11 → v12")
    version_to: int | None = None  # the version it produced


class ProjectRead(ORMModel):
    id: int
    title: str
    timeline: Timeline
    revision: int
    chat: list[ChatMessage]
    render_status: Literal["idle", "rendering", "done", "failed"]
    render_progress: int
    render_error: str | None
    render_path: str | None  # public "storage/..." path of the last export
    export_clip_id: int | None
    version: int = 1  # latest version number, shown as "Saved · v12"
    notice: str | None = None  # one-off summary of a server edit ("Added 12 hype effects ...")
    import_id: int | None = None  # opened from this imported video: the Moments tab picks from it
    source_clip_id: int | None = None
    created_at: datetime
    updated_at: datetime | None


class VersionRead(ORMModel):
    number: int
    label: str
    created_at: datetime


class ProjectSummary(ORMModel):
    id: int
    title: str
    revision: int
    render_status: str
    updated_at: datetime | None
    created_at: datetime


class ChatRequest(BaseModel):
    message: str = Field(min_length=1, max_length=2000)
    playhead: float = Field(default=0, ge=0)  # so "here" / "at this point" means something
    selected_id: str | None = None  # so "this clip" means something


class ChatResponse(BaseModel):
    reply: str
    changes: list[str]
    project: ProjectRead


class AddClipAsset(BaseModel):
    clip_id: int | None = None
    import_id: int | None = None
    place: bool = True  # also put it on the timeline (at the end of track 0)


class AutoEffectsRequest(BaseModel):
    style: Literal["hype", "cinematic", "clean", "none"] = "hype"  # "none" removes the auto effects
    amount: float = Field(default=0.6, ge=0.1, le=1)  # how many effects, and how strong


class OpenRequest(BaseModel):
    """Open a clip or an imported video in the editor (reuses the edit made from it before)."""

    clip_id: int | None = None
    import_id: int | None = None
    # Only used when this starts a new edit (an existing one reopens as it is).
    title: str | None = Field(default=None, min_length=1, max_length=200)
    aspect: Literal["9:16", "16:9", "1:1", "4:5"] | None = None


class MomentRequest(BaseModel):
    """Cut a range of the project's imported video and put it on the timeline."""

    start_s: float = Field(ge=0)
    end_s: float = Field(gt=0)
    layout: Literal["fill", "blur"] = "fill"
    at: float | None = Field(default=None, ge=0)  # timeline time; None = after the last clip


class CaptionsRequest(BaseModel):
    preset: str = "punch"
    words_per_caption: int = Field(default=3, ge=1, le=8)


class AutoSfxRequest(BaseModel):
    intensity: Literal["subtle", "normal", "hype"] = "normal"
    replace: bool = True  # remove the effects a previous run added


class SfxRead(BaseModel):
    name: str
    label: str
    description: str
    lead: float  # seconds before the cue the sound starts
    duration: float
    src: str

"""Caption styles: the preset library, custom styles, fonts and exact previews."""
from __future__ import annotations

import asyncio
import re
from pathlib import Path
from urllib.parse import quote

from fastapi import APIRouter, Depends, HTTPException, UploadFile, status
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session

from app.api.deps import Owner, get_owner
from app.core.media import MediaError, from_public
from app.db import get_db
from app.models.caption_style import CaptionStyle
from app.models.clip import Clip
from app.models.user import User
from app.schemas.caption_style import (
    CaptionStyleCreate,
    CaptionStyleRead,
    CaptionStyleUpdate,
    EmojiPlanRequest,
    GoogleFontInstall,
    RenderPreviewRequest,
)
from app.services.caption import emoji as emoji_picker
from app.services.caption import fonts
from app.services.caption.ass_generator import StyleSpec
from app.services.caption.ass_import import AssImportError, parse_ass_styles
from app.services.caption.preview import render_preview
from app.services.caption.styles import PRESET_FONTS, legacy_colors, seed_preset_styles

router = APIRouter(prefix="/styles", tags=["styles"])

_fonts_queued = False


def _font_url(name: str) -> str:
    return f"/api/styles/fonts/file/{quote(name)}"


def to_read(style: CaptionStyle) -> CaptionStyleRead:
    spec = StyleSpec.of(style)
    info = fonts.get_font(style.font_name)
    return CaptionStyleRead(
        id=style.id,
        user_id=style.user_id,
        name=style.name,
        font_name=style.font_name,
        font_size=style.font_size,
        colors_json=style.colors_json or {},
        animation_type=style.animation_type,
        uppercase=style.uppercase,
        options=spec.options,
        category=style.category,
        description=style.description,
        font_file=style.font_file,
        is_preset=style.is_preset,
        created_at=style.created_at,
        font_url=_font_url(info.name) if info else None,
        font_em_ratio=round(info.em_ratio, 4) if info else 0.8,
        font_available=info is not None,
    )


def _font_payload(info: fonts.FontInfo) -> dict:
    return {"name": info.name, "source": info.source, "url": _font_url(info.name), "em_ratio": round(info.em_ratio, 4)}


# ---------- fonts (declared before /{style_id}) ----------
@router.get("/fonts")
def list_fonts():
    """Installed fonts (usable now) and popular Google Fonts (installed on first use)."""
    return {
        "installed": [_font_payload(f) for f in fonts.installed_fonts()],
        "google": fonts.POPULAR_GOOGLE_FONTS,
    }


@router.post("/fonts/google")
async def install_google(body: GoogleFontInstall):
    try:
        info = await asyncio.to_thread(fonts.install_google_font, body.family, body.weight)
    except fonts.FontInstallError as err:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, str(err)) from err
    return _font_payload(info)


@router.get("/fonts/file/{font_name}")
def font_file(font_name: str):
    info = fonts.get_font(font_name)
    if info is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Font not installed")
    media = "font/otf" if info.file.suffix.lower() == ".otf" else "font/ttf"
    return FileResponse(info.file, media_type=media, headers={"Cache-Control": "public, max-age=86400"})


@router.post("/upload-font")
async def upload_font(file: UploadFile):
    """Add the creator's own .ttf/.otf font."""
    name = Path(file.filename or "").name
    if not name.lower().endswith((".ttf", ".otf")):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Only .ttf and .otf font files are supported")
    data = await file.read()
    if len(data) > 15 * 1024 * 1024:
        raise HTTPException(status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, "Font files must be under 15 MB")
    safe = re.sub(r"[^A-Za-z0-9._-]", "_", name)
    target = fonts.FONTS_DIR / f"{fonts.UPLOAD_PREFIX}{safe}"
    target.write_bytes(data)
    try:
        from fontTools.ttLib import TTFont

        TTFont(str(target), lazy=True).close()
    except Exception as err:
        target.unlink(missing_ok=True)
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "That file isn't a readable font.") from err
    info = next((f for f in fonts.installed_fonts() if f.file == target), None)
    if info is None:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "That file isn't a readable font.")
    return {**_font_payload(info), "font_name": info.name, "font_file": str(target), "filename": target.name}


# ---------- library ----------
@router.get("", response_model=list[CaptionStyleRead])
def list_styles(user: Owner, db: Session = Depends(get_db)):
    """Presets (library order) then custom styles, newest first."""
    global _fonts_queued
    presets = seed_preset_styles(db)
    if not _fonts_queued:
        _fonts_queued = True
        fonts.install_in_background(PRESET_FONTS)
    custom = (
        db.query(CaptionStyle)
        .filter(CaptionStyle.is_preset.is_(False), (CaptionStyle.user_id.is_(None)) | (CaptionStyle.user_id == user.id))
        .order_by(CaptionStyle.id.desc())
        .all()
    )
    return [to_read(s) for s in [*presets, *custom]]


@router.post("/render-preview")
async def preview(body: RenderPreviewRequest, db: Session = Depends(get_db)):
    """Burn a few seconds of sample text with this exact style (unsaved changes included)."""
    spec = StyleSpec.of(body.style)
    background, at = None, None
    if body.clip_id:
        clip = db.get(Clip, body.clip_id)
        if clip and clip.raw_file_path:
            background = from_public(clip.raw_file_path)
            at = 0.0
    try:
        path = await asyncio.to_thread(render_preview, spec, body.text, background, at)
    except MediaError as err:
        raise HTTPException(status.HTTP_500_INTERNAL_SERVER_ERROR, str(err)) from err
    return {"url": path, "font_found": fonts.get_font(spec.font_name) is not None}


@router.post("/emoji-plan")
def emoji_plan(body: EmojiPlanRequest):
    """Emoji for sample text: [{index, until, emoji, motion, placement}] in word indexes."""
    words = [w for w in body.text.split() if w][:60]
    timed = [emoji_picker.Word(w, i * body.word_s, (i + 0.9) * body.word_s, w.isupper() and len(w) > 1) for i, w in enumerate(words)]
    size = body.words_per_group
    phrases = [emoji_picker.Phrase(timed[i : i + size]) for i in range(0, len(timed), size)]
    settings = emoji_picker.EmojiSettings(body.amount, body.motion, body.placement)
    cues, _ = emoji_picker.plan(phrases, settings, use_ai=False)
    out = []
    for c in cues:
        index = c.phrase * size + c.word
        until = next((i for i, w in enumerate(timed) if w.start >= c.end - 1e-6), len(timed))
        out.append({"index": index, "until": max(index + 1, until), "emoji": c.emoji, "motion": c.motion, "placement": c.placement})
    return out


@router.post("/import-ass", response_model=list[CaptionStyleRead], status_code=status.HTTP_201_CREATED)
async def import_ass(file: UploadFile, user: Owner, db: Session = Depends(get_db)):
    """Create styles from an .ass/.ssa subtitle file."""
    if not (file.filename or "").lower().endswith((".ass", ".ssa")):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Upload an .ass or .ssa subtitle file.")
    raw = await file.read()
    if len(raw) > 5 * 1024 * 1024:
        raise HTTPException(status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, "Subtitle files must be under 5 MB.")
    text = raw.decode("utf-8-sig", errors="replace")
    try:
        drafts = await asyncio.to_thread(parse_ass_styles, text)
    except AssImportError as err:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, str(err)) from err
    created = [_create(db, d, user) for d in drafts]
    return [to_read(s) for s in created]


def _create(db: Session, payload: CaptionStyleCreate, user: User | None) -> CaptionStyle:
    spec = StyleSpec.of(payload)
    style = CaptionStyle(
        user_id=user.id if user else None,
        name=payload.name,
        font_name=payload.font_name,
        font_size=payload.font_size,
        colors_json=legacy_colors(spec.options),
        options_json=spec.options.model_dump(),
        animation_type=payload.animation_type,
        uppercase=payload.uppercase,
        category=payload.category,
        description=payload.description,
        is_preset=False,
    )
    db.add(style)
    db.commit()
    db.refresh(style)
    return style


@router.post("", response_model=CaptionStyleRead, status_code=status.HTTP_201_CREATED)
def create_style(payload: CaptionStyleCreate, user: Owner, db: Session = Depends(get_db)):
    return to_read(_create(db, payload, user))


def _style_or_404(db: Session, style_id: int) -> CaptionStyle:
    style = db.get(CaptionStyle, style_id)
    if style is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Caption style not found")
    return style


@router.get("/{style_id}", response_model=CaptionStyleRead)
def get_style(style_id: int, db: Session = Depends(get_db)):
    return to_read(_style_or_404(db, style_id))


@router.patch("/{style_id}", response_model=CaptionStyleRead)
def update_style(style_id: int, payload: CaptionStyleUpdate, db: Session = Depends(get_db)):
    style = _style_or_404(db, style_id)
    if style.is_preset:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Presets can't be changed. Duplicate it to customise.")
    data = payload.model_dump(exclude_unset=True)
    options = data.pop("options", None)
    data.pop("colors_json", None)
    for key, value in data.items():
        setattr(style, key, value)
    if options is not None:
        style.options_json = options
        style.colors_json = legacy_colors(StyleSpec.of(style).options)
    db.commit()
    db.refresh(style)
    return to_read(style)


@router.post("/{style_id}/duplicate", response_model=CaptionStyleRead, status_code=status.HTTP_201_CREATED)
def duplicate_style(style_id: int, db: Session = Depends(get_db), user: User = Depends(get_owner)):
    src = _style_or_404(db, style_id)
    spec = StyleSpec.of(src)
    copy = CaptionStyleCreate(
        name=f"{src.name} (my version)"[:100],
        font_name=src.font_name,
        font_size=src.font_size,
        animation_type=src.animation_type,
        uppercase=src.uppercase,
        options=spec.options,
        category="Custom",
        description=f"Based on {src.name}.",
    )
    return to_read(_create(db, copy, user))


@router.delete("/{style_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_style(style_id: int, db: Session = Depends(get_db)):
    style = _style_or_404(db, style_id)
    if style.is_preset:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Presets can't be deleted.")
    db.query(Clip).filter(Clip.caption_style_id == style.id).update({"caption_style_id": None})
    db.delete(style)
    db.commit()

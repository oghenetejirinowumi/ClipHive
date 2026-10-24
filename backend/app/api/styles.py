"""API endpoints for Caption Styles and custom font uploads."""
from __future__ import annotations

import shutil
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, UploadFile, status
from sqlalchemy.orm import Session

from app.api.deps import Owner
from app.db import get_db
from app.models.caption_style import CaptionStyle
from app.schemas.caption_style import CaptionStyleCreate, CaptionStyleRead
from app.services.caption.font_inspector import extract_font_family_name
from app.services.caption.styles import seed_preset_styles

router = APIRouter(prefix="/styles", tags=["styles"])

FONTS_DIR = Path("backend/assets/fonts")
FONTS_DIR.mkdir(parents=True, exist_ok=True)


@router.get("", response_model=list[CaptionStyleRead])
def list_styles(user: Owner, db: Session = Depends(get_db)):
    """The presets plus your own custom styles."""
    seed_preset_styles(db)  # ensure presets exist
    return db.query(CaptionStyle).filter((CaptionStyle.user_id.is_(None)) | (CaptionStyle.user_id == user.id)).all()


@router.get("/{style_id}", response_model=CaptionStyleRead)
def get_style(style_id: int, user: Owner, db: Session = Depends(get_db)):
    """Returns a single caption style by ID (a preset or one of yours)."""
    style = db.query(CaptionStyle).filter(CaptionStyle.id == style_id, (CaptionStyle.user_id.is_(None)) | (CaptionStyle.user_id == user.id)).first()
    if not style:
        raise HTTPException(status_code=404, detail="Caption style not found")
    return style


@router.post("", response_model=CaptionStyleRead, status_code=status.HTTP_201_CREATED)
def create_style(payload: CaptionStyleCreate, user: Owner, db: Session = Depends(get_db)):
    """Creates a new custom caption style (yours only)."""
    colors = payload.colors_json.model_dump() if payload.colors_json else {}
    style = CaptionStyle(
        user_id=user.id,
        name=payload.name,
        font_name=payload.font_name,
        font_size=payload.font_size,
        colors_json=colors,
        animation_type=payload.animation_type,
        uppercase=payload.uppercase,
        is_preset=False,
    )
    db.add(style)
    db.commit()
    db.refresh(style)
    return style


@router.post("/upload-font")
async def upload_font(file: UploadFile, user: Owner):
    """Uploads a custom .ttf or .otf font file to backend/assets/fonts/."""
    if not file.filename or not (file.filename.lower().endswith(".ttf") or file.filename.lower().endswith(".otf")):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Only .ttf and .otf font files are supported",
        )

    clean_filename = Path(file.filename).name
    target_path = FONTS_DIR / clean_filename

    with open(target_path, "wb") as buffer:
        shutil.copyfileobj(file.file, buffer)

    # Extract true internal font family name from TrueType header tables
    font_name = extract_font_family_name(target_path) or Path(clean_filename).stem.replace("-", " ")

    return {
        "font_name": font_name,
        "font_file": str(target_path),
        "filename": clean_filename,
    }

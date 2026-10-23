"""API endpoints for Caption Styles and custom font uploads."""
from __future__ import annotations

import shutil
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, UploadFile, status
from sqlalchemy.orm import Session

from app.db import get_db
from app.models.caption_style import CaptionStyle
from app.schemas.caption_style import CaptionStyleCreate, CaptionStyleRead
from app.services.caption.styles import seed_preset_styles

router = APIRouter(prefix="/styles", tags=["styles"])

FONTS_DIR = Path("backend/assets/fonts")
FONTS_DIR.mkdir(parents=True, exist_ok=True)


@router.get("", response_model=list[CaptionStyleRead])
def list_styles(db: Session = Depends(get_db)):
    """Returns all available caption styles (presets and custom)."""
    # Ensure preset styles exist
    seed_preset_styles(db)
    return db.query(CaptionStyle).all()


@router.get("/{style_id}", response_model=CaptionStyleRead)
def get_style(style_id: int, db: Session = Depends(get_db)):
    """Returns a single caption style by ID."""
    style = db.query(CaptionStyle).filter(CaptionStyle.id == style_id).first()
    if not style:
        raise HTTPException(status_code=404, detail="Caption style not found")
    return style


@router.post("", response_model=CaptionStyleRead, status_code=status.HTTP_201_CREATED)
def create_style(payload: CaptionStyleCreate, db: Session = Depends(get_db)):
    """Creates a new custom caption style."""
    colors = payload.colors_json.model_dump() if payload.colors_json else {}
    style = CaptionStyle(
        user_id=None,
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
async def upload_font(file: UploadFile):
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

    font_name = Path(clean_filename).stem.replace("-", " ")

    return {
        "font_name": font_name,
        "font_file": str(target_path),
        "filename": clean_filename,
    }

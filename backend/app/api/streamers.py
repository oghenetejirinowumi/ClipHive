"""API endpoints for Monitored Streamers and Channels."""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.db import get_db
from app.models.enums import SourcePlatform
from app.models.streamer import Streamer
from app.models.user import User
from app.schemas.streamer import StreamerCreate, StreamerRead

router = APIRouter(prefix="/streamers", tags=["streamers"])

SAMPLE_STREAMERS = [
    {"platform": SourcePlatform.TWITCH, "username": "shroud"},
    {"platform": SourcePlatform.KICK, "username": "adinross"},
    {"platform": SourcePlatform.YOUTUBE, "username": "MrBeast"},
]


def seed_sample_streamers(db: Session, user_id: int):
    """Seeds initial sample streamers for testing/demo if none exist."""
    count = db.query(Streamer).filter(Streamer.user_id == user_id).count()
    if count == 0:
        for s in SAMPLE_STREAMERS:
            st = Streamer(
                user_id=user_id,
                platform=s["platform"],
                username=s["username"],
                is_active=True,
            )
            db.add(st)
        db.commit()


@router.get("", response_model=list[StreamerRead])
def list_streamers(db: Session = Depends(get_db)):
    """Lists all monitored channels."""
    user = db.query(User).first()
    if user:
        seed_sample_streamers(db, user.id)
    return db.query(Streamer).all()


@router.post("", response_model=StreamerRead, status_code=status.HTTP_201_CREATED)
def add_streamer(payload: StreamerCreate, db: Session = Depends(get_db)):
    """Adds a new channel to monitor."""
    user = db.query(User).first()
    user_id = user.id if user else 1

    existing = db.query(Streamer).filter(
        Streamer.user_id == user_id,
        Streamer.platform == payload.platform,
        Streamer.username == payload.username,
    ).first()

    if existing:
        return existing

    streamer = Streamer(
        user_id=user_id,
        platform=payload.platform,
        username=payload.username.strip(),
        is_active=True,
    )
    db.add(streamer)
    db.commit()
    db.refresh(streamer)
    return streamer


@router.delete("/{streamer_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_streamer(streamer_id: int, db: Session = Depends(get_db)):
    """Removes a channel from monitoring."""
    streamer = db.query(Streamer).filter(Streamer.id == streamer_id).first()
    if not streamer:
        raise HTTPException(status_code=404, detail="Streamer not found")
    db.delete(streamer)
    db.commit()
    return None

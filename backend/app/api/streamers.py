"""API endpoints for Monitored Streamers and Channels."""
from __future__ import annotations

import asyncio

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.db import get_db
from app.models.enums import SourcePlatform
from app.models.streamer import Streamer
from app.models.user import User
from app.schemas.streamer import CheckResultRead, StreamerCreate, StreamerRead, StreamerUpdate
from app.services.agents import scout

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
    return db.query(Streamer).order_by(Streamer.id).all()


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


@router.patch("/{streamer_id}", response_model=StreamerRead)
def update_streamer(streamer_id: int, payload: StreamerUpdate, db: Session = Depends(get_db)):
    """Pause or resume watching a channel."""
    streamer = db.query(Streamer).filter(Streamer.id == streamer_id).first()
    if not streamer:
        raise HTTPException(status_code=404, detail="Streamer not found")
    if payload.is_active is not None:
        streamer.is_active = payload.is_active
    db.commit()
    db.refresh(streamer)
    return streamer


@router.post("/{streamer_id}/check-now", response_model=CheckResultRead)
async def check_now(streamer_id: int, db: Session = Depends(get_db)):
    """Scout this channel right now. If it has a VOD we haven't clipped, start clipping it
    (on a channel's first check, its newest VOD)."""
    streamer = db.query(Streamer).filter(Streamer.id == streamer_id).first()
    if not streamer:
        raise HTTPException(status_code=404, detail="Streamer not found")
    user_id = streamer.user_id
    db.close()  # don't hold the request's session open during the network check
    results = await asyncio.to_thread(scout.run_scout, user_id, [streamer_id], True)
    if not results:
        raise HTTPException(status_code=409, detail="That channel is paused. Resume it first.")
    return results[0].__dict__

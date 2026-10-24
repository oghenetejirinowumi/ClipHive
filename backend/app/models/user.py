from datetime import datetime

from sqlalchemy import DateTime, String, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db import Base


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(primary_key=True)
    email: Mapped[str] = mapped_column(String(320), unique=True, index=True)
    password_hash: Mapped[str] = mapped_column(String(255))  # "" for Google-only accounts (never matches)
    google_sub: Mapped[str | None] = mapped_column(String(255), unique=True, index=True)  # Google account id
    name: Mapped[str | None] = mapped_column(String(255))
    avatar_url: Mapped[str | None] = mapped_column(String(1024))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    streamers: Mapped[list["Streamer"]] = relationship(back_populates="user", cascade="all, delete-orphan")
    clips: Mapped[list["Clip"]] = relationship(back_populates="user", cascade="all, delete-orphan")
    caption_styles: Mapped[list["CaptionStyle"]] = relationship(
        back_populates="user", cascade="all, delete-orphan"
    )

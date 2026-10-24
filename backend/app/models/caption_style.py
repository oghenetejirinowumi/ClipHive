from datetime import datetime

from sqlalchemy import JSON, Boolean, DateTime, Enum, ForeignKey, Integer, String, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db import Base
from app.models.enums import AnimationType


class CaptionStyle(Base):
    __tablename__ = "caption_styles"

    id: Mapped[int] = mapped_column(primary_key=True)
    # NULL user_id means a built-in preset (Punch / Clean / Neon) visible to everyone.
    user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    name: Mapped[str] = mapped_column(String(100))
    font_file: Mapped[str | None] = mapped_column(String(1024))  # path to uploaded .ttf/.otf
    font_name: Mapped[str] = mapped_column(String(100))  # name referenced in the ASS Style line
    font_size: Mapped[int] = mapped_column(Integer, default=72)
    # ASS colours (&HAABBGGRR): {"primary", "outline", "highlight", "back"}
    colors_json: Mapped[dict] = mapped_column(JSON, default=dict)
    animation_type: Mapped[AnimationType] = mapped_column(
        Enum(AnimationType, native_enum=False), default=AnimationType.WORD_POP
    )
    uppercase: Mapped[bool] = mapped_column(Boolean, default=False)
    # Full look & motion (schemas.caption_style.CaptionOptions). Empty = derive from colors_json.
    options_json: Mapped[dict | None] = mapped_column(JSON, default=dict)
    category: Mapped[str | None] = mapped_column(String(40))  # library grouping, e.g. "Podcast"
    description: Mapped[str | None] = mapped_column(String(200))
    is_preset: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    user: Mapped["User | None"] = relationship(back_populates="caption_styles")

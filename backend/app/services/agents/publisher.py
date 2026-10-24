"""Publisher agent: runs when the creator approves a clip in the inbox.

1. Burns captions in the style the Producer chose (unless the clip is already captioned).
2. Picks a posting slot per platform and queues a Post row with a ready-to-paste caption.
3. A small loop flips due posts to "ready" and notifies the creator to export and post.

Posting slots are a rule of thumb (evening for TikTok, late afternoon for Shorts, midday for
Reels), one post per platform per day, in the creator's local time. They are suggestions the
creator can change, not measured audience data. Direct posting needs approved platform apps,
so the last step is a one-click export.
"""
from __future__ import annotations

import asyncio
import logging
import threading
from datetime import UTC, datetime, timedelta

from app.config import settings
from app.db import SessionLocal
from app.models import CaptionMode, CaptionStyle, Clip, ClipStatus, Post, PostPlatform, PostStatus
from app.services.agents import events

logger = logging.getLogger("cliphive.agents.publisher")

# Local hour of the suggested slot, and the reason shown to the creator.
SLOTS: dict[str, tuple[int, str]] = {
    "tiktok": (19, "TikTok evening slot (7pm), a common rule of thumb"),
    "youtube": (17, "Shorts late-afternoon slot (5pm), a common rule of thumb"),
    "instagram": (12, "Reels lunchtime slot (12pm), a common rule of thumb"),
    "x": (13, "X early-afternoon slot (1pm), a common rule of thumb"),
}
PLATFORM_LABEL = {"tiktok": "TikTok", "youtube": "YouTube Shorts", "instagram": "Instagram Reels", "x": "X"}
MIN_LEAD = timedelta(minutes=30)


def default_platforms() -> list[str]:
    return [p.strip() for p in settings.publisher_platforms.split(",") if p.strip() in SLOTS] or ["tiktok"]


def _aware(dt: datetime | None) -> datetime | None:
    if dt is None:
        return None
    return dt if dt.tzinfo else dt.replace(tzinfo=UTC)


def next_slot(platform: str, taken_days: set, now_utc: datetime, tz_offset_minutes: int) -> datetime:
    """Next free daily slot for the platform, in UTC. tz_offset_minutes = minutes east of UTC."""
    hour, _ = SLOTS.get(platform, (18, ""))
    offset = timedelta(minutes=tz_offset_minutes)
    local_now = now_utc + offset
    day = local_now.date()
    for _ in range(60):
        local_slot = datetime(day.year, day.month, day.day, hour, tzinfo=UTC)  # "local" wall time held as UTC
        slot_utc = local_slot - offset
        if slot_utc >= now_utc + MIN_LEAD and day not in taken_days:
            return slot_utc
        day += timedelta(days=1)
    return now_utc + timedelta(days=1)


def caption_text(clip: Clip) -> str:
    tags = " ".join(clip.hashtags or [])
    return f"{clip.title or ''}\n\n{tags}".strip()


def _taken_days(db, user_id: int, platform: str, tz_offset_minutes: int) -> set:
    offset = timedelta(minutes=tz_offset_minutes)
    rows = (
        db.query(Post.scheduled_for)
        .join(Clip, Clip.id == Post.clip_id)
        .filter(Clip.user_id == user_id, Post.platform == PostPlatform(platform), Post.scheduled_for.isnot(None))
        .filter(Post.status.in_([PostStatus.QUEUED, PostStatus.READY]))
        .all()
    )
    return {(_aware(r[0]) + offset).date() for r in rows if r[0]}


def _burn(clip_id: int, style_id: int, run_id: int, style_name: str) -> None:
    from app.api.clips import process_clip_captioning

    process_clip_captioning(clip_id, style_id, CaptionMode.BURNED)
    with SessionLocal() as db:
        clip = db.get(Clip, clip_id)
        if clip and clip.status == ClipStatus.READY:
            events.log(run_id, "tool_call", f"Burned {style_name} captions into the clip")
            events.finish_run(run_id, "done", f'"{clip.title}" is captioned and scheduled.')
        else:
            events.log(run_id, "error", f"Caption burn failed: {(clip.error if clip else 'clip missing') or 'unknown error'}")
            events.finish_run(run_id, "failed", "Scheduled, but captions failed. Retry from the studio.")


def publish_approved(clip_id: int, user_id: int, platforms: list[str] | None = None, tz_offset_minutes: int = 0, burn_async: bool = True) -> list[Post]:
    """Schedule an approved clip on each platform and start its caption burn."""
    platforms = [p for p in (platforms or default_platforms()) if p in SLOTS] or default_platforms()
    now = datetime.now(UTC)
    with SessionLocal() as db:
        clip = db.get(Clip, clip_id)
        if clip is None:
            raise ValueError("Clip not found")
        run_id = events.start_run(user_id, "publisher", goal=f'Caption and schedule "{clip.title}"', model="rules")

        created: list[Post] = []
        for platform in platforms:
            existing = (
                db.query(Post)
                .filter(Post.clip_id == clip.id, Post.platform == PostPlatform(platform), Post.status.in_([PostStatus.QUEUED, PostStatus.READY]))
                .first()
            )
            if existing:
                created.append(existing)
                continue
            slot = next_slot(platform, _taken_days(db, user_id, platform, tz_offset_minutes), now, tz_offset_minutes)
            reason = SLOTS[platform][1]
            post = Post(
                clip_id=clip.id,
                platform=PostPlatform(platform),
                status=PostStatus.QUEUED,
                scheduled_for=slot,
                caption_text=caption_text(clip),
                schedule_reason=reason,
            )
            db.add(post)
            db.commit()
            db.refresh(post)
            created.append(post)
            local = slot + timedelta(minutes=tz_offset_minutes)
            events.log(
                run_id,
                "decision",
                f"Scheduled {PLATFORM_LABEL[platform]} for {local.strftime('%a %d %b, %H:%M')} ({reason})",
                {"verdict": "kept", "post_id": post.id, "platform": platform, "scheduled_for": slot.isoformat()},
            )

        needs_burn = clip.status != ClipStatus.READY and clip.caption_mode != CaptionMode.PLATFORM_NATIVE
        style = db.get(CaptionStyle, clip.caption_style_id) if clip.caption_style_id else None
        style = style or db.query(CaptionStyle).filter(CaptionStyle.is_preset.is_(True)).first()

    if needs_burn and style is not None:
        events.log(run_id, "thought", f"Burning {style.name} captions (the style the Producer picked)")
        if burn_async:
            threading.Thread(target=_burn, args=(clip_id, style.id, run_id, style.name), daemon=True, name=f"burn-{clip_id}").start()
        else:
            _burn(clip_id, style.id, run_id, style.name)
    else:
        events.finish_run(run_id, "done", f"Scheduled on {len(created)} platform{'s' if len(created) != 1 else ''}.")
    return created


def release_due_posts() -> int:
    """Flip queued posts whose time has come to READY and notify. Returns how many."""
    now = datetime.now(UTC)
    with SessionLocal() as db:
        due = (
            db.query(Post, Clip)
            .join(Clip, Clip.id == Post.clip_id)
            .filter(Post.status == PostStatus.QUEUED, Post.scheduled_for.isnot(None), Post.scheduled_for <= now)
            .all()
        )
        for post, clip in due:
            post.status = PostStatus.READY
            events.notify(
                clip.user_id,
                f"Time to post on {PLATFORM_LABEL.get(post.platform.value, post.platform.value)}",
                f'"{clip.title}" is ready: download it and paste the caption.',
                "/hub",
            )
        db.commit()
        return len(due)


async def publisher_loop() -> None:
    while True:
        try:
            await asyncio.to_thread(release_due_posts)
        except Exception:
            logger.exception("Publisher pass failed")
        await asyncio.sleep(60)

"""Approval inbox (clips the agents made, waiting for the creator) and the posting queue."""
from __future__ import annotations

from datetime import UTC, datetime

from fastapi import APIRouter, HTTPException, status

from app.api.deps import DbSession, Owner
from app.models import Clip, ClipStatus, ImportJob, Post, PostStatus
from app.schemas.agent import ApproveRequest, InboxClip, PostUpdate, RejectRequest, ScheduledPost
from app.services.agents import publisher
from app.services.agents.learning import record_feedback

router = APIRouter(tags=["inbox"])


def _own_clip(db, user, clip_id: int) -> Clip:
    clip = db.get(Clip, clip_id)
    if clip is None or clip.user_id != user.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Clip not found.")
    return clip


def _inbox_item(clip: Clip, jobs: dict[int, ImportJob]) -> InboxClip:
    ctx = clip.context_json or {}
    job_id = ctx.get("import_job_id")
    job = jobs.get(job_id) if job_id else None
    item = InboxClip.model_validate(clip)
    item.reason = ctx.get("agent_reason") or ctx.get("highlight_reason") or ctx.get("style_rationale")
    item.import_job_id = job_id
    item.source_title = job.title if job else ctx.get("source_title")
    if job:
        item.layout = (job.clip_layouts or {}).get(str(clip.id), job.layout or "fill")
    return item


@router.get("/inbox", response_model=list[InboxClip])
def inbox(user: Owner, db: DbSession) -> list[InboxClip]:
    clips = (
        db.query(Clip)
        .filter(Clip.user_id == user.id, Clip.review_status == "pending", Clip.status != ClipStatus.FAILED)
        .order_by(Clip.id.desc())
        .limit(60)
        .all()
    )
    job_ids = {(c.context_json or {}).get("import_job_id") for c in clips} - {None}
    jobs = {j.id: j for j in db.query(ImportJob).filter(ImportJob.id.in_(job_ids), ImportJob.user_id == user.id)} if job_ids else {}
    return [_inbox_item(c, jobs) for c in clips]


@router.post("/inbox/{clip_id}/approve", response_model=list[ScheduledPost])
def approve(clip_id: int, body: ApproveRequest, user: Owner, db: DbSession) -> list[ScheduledPost]:
    clip = _own_clip(db, user, clip_id)
    clip.review_status = "approved"
    db.commit()
    record_feedback(db, user.id, clip, "approved", None, None)
    platforms = [p.value for p in body.platforms] if body.platforms else None
    posts = publisher.publish_approved(clip.id, user.id, platforms, body.tz_offset_minutes)
    return [_post_item(p, clip) for p in posts]


@router.post("/inbox/{clip_id}/reject", status_code=status.HTTP_204_NO_CONTENT)
def reject(clip_id: int, body: RejectRequest, user: Owner, db: DbSession) -> None:
    clip = _own_clip(db, user, clip_id)
    clip.review_status = "rejected"
    db.commit()
    record_feedback(db, user.id, clip, "rejected", {"title": clip.title}, {"reason": (body.reason or "").strip() or None})


@router.post("/inbox/{clip_id}/restore", status_code=status.HTTP_204_NO_CONTENT)
def restore(clip_id: int, user: Owner, db: DbSession) -> None:
    """Undo an approve/reject: back to the inbox (scheduled posts are cancelled)."""
    clip = _own_clip(db, user, clip_id)
    clip.review_status = "pending"
    db.query(Post).filter(Post.clip_id == clip.id, Post.status.in_([PostStatus.QUEUED, PostStatus.READY])).delete()
    db.commit()


# ---------- posting queue ----------
def _post_item(post: Post, clip: Clip) -> ScheduledPost:
    item = ScheduledPost.model_validate(post)
    item.clip_title, item.clip_file_path, item.clip_status = clip.title, clip.file_path, clip.status.value
    return item


def _own_post(db, user, post_id: int) -> tuple[Post, Clip]:
    row = db.query(Post, Clip).join(Clip, Clip.id == Post.clip_id).filter(Post.id == post_id).first()
    if row is None or row[1].user_id != user.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Post not found.")
    return row


@router.get("/posts", response_model=list[ScheduledPost])
def list_posts(user: Owner, db: DbSession, clip_id: int | None = None) -> list[ScheduledPost]:
    q = db.query(Post, Clip).join(Clip, Clip.id == Post.clip_id).filter(Clip.user_id == user.id)
    if clip_id is not None:
        q = q.filter(Post.clip_id == clip_id)
    rows = q.order_by(Post.scheduled_for.is_(None), Post.scheduled_for, Post.id).limit(200).all()
    return [_post_item(p, c) for p, c in rows]


@router.patch("/posts/{post_id}", response_model=ScheduledPost)
def update_post(post_id: int, body: PostUpdate, user: Owner, db: DbSession) -> ScheduledPost:
    post, clip = _own_post(db, user, post_id)
    if body.scheduled_for is not None:
        when = body.scheduled_for if body.scheduled_for.tzinfo else body.scheduled_for.replace(tzinfo=UTC)
        post.scheduled_for = when.astimezone(UTC)
        post.schedule_reason = "Set by you"
        if post.status == PostStatus.READY and post.scheduled_for > datetime.now(UTC):
            post.status = PostStatus.QUEUED
    if body.caption_text is not None:
        post.caption_text = body.caption_text
    db.commit()
    db.refresh(post)
    return _post_item(post, clip)


@router.post("/posts/{post_id}/mark-posted", response_model=ScheduledPost)
def mark_posted(post_id: int, user: Owner, db: DbSession) -> ScheduledPost:
    post, clip = _own_post(db, user, post_id)
    post.status = PostStatus.POSTED
    post.posted_at = datetime.now(UTC)
    db.commit()
    db.refresh(post)
    return _post_item(post, clip)


@router.delete("/posts/{post_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_post(post_id: int, user: Owner, db: DbSession) -> None:
    post, _ = _own_post(db, user, post_id)
    db.delete(post)
    db.commit()

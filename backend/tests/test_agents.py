"""Agent tests: scripted fake model, patched media/network, in-memory SQLite. No network calls."""
from __future__ import annotations

import json
from datetime import UTC, datetime, timedelta
from pathlib import Path
from types import SimpleNamespace

import app.models  # noqa: F401
import pytest
from app.db import Base
from app.models import Clip, ImportJob, ImportSource, Post, PostStatus, SourcePlatform, Streamer, User
from app.models.agent import AgentEvent, AgentRun, CreatorFeedback
from app.models.caption_style import CaptionStyle
from app.services.agents import command, events, learning, producer, publisher, runtime, scout
from app.services.clip.detector import Highlight
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

MODULES_USING_SESSION = [events, producer, publisher, learning, scout, command]


@pytest.fixture
def Session(monkeypatch):
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(engine)
    factory = sessionmaker(bind=engine, expire_on_commit=False)
    for module in MODULES_USING_SESSION:
        monkeypatch.setattr(module, "SessionLocal", factory)
    with factory() as db:
        db.add(User(id=1, email="demo@example.com", password_hash="x"))
        for name in ("Punch", "Clean", "Neon"):
            db.add(CaptionStyle(name=name, is_preset=True, font_name="Poppins"))
        db.commit()
    yield factory
    engine.dispose()


# ---------- a scripted fake chat model ----------
def call(name: str, args: dict, cid: str | None = None):
    return SimpleNamespace(id=cid or f"call_{name}", type="function", function=SimpleNamespace(name=name, arguments=json.dumps(args)))


class FakeClient:
    """Returns one scripted assistant message per create() call and records what it was sent."""

    def __init__(self, script: list[dict]):
        self.script = list(script)
        self.requests: list[dict] = []
        self.chat = SimpleNamespace(completions=SimpleNamespace(create=self._create))

    def _create(self, **kwargs):
        self.requests.append(kwargs)
        step = self.script.pop(0) if self.script else {"content": "done", "tool_calls": [call("finish", {"summary": "Out of script."})]}
        msg = SimpleNamespace(content=step.get("content"), tool_calls=step.get("tool_calls"))
        return SimpleNamespace(choices=[SimpleNamespace(message=msg)])


def event_titles(Session, run_id=None):
    with Session() as db:
        q = db.query(AgentEvent).order_by(AgentEvent.run_id, AgentEvent.seq)
        if run_id:
            q = q.filter(AgentEvent.run_id == run_id)
        return [(e.type, e.title) for e in q]


# ---------- runtime ----------
def test_runtime_runs_tools_until_finish_and_logs(Session):
    run_id = events.start_run(1, "producer")
    seen = []
    tool = runtime.Tool(
        name="echo",
        description="echo",
        parameters={"type": "object", "properties": {"x": {"type": "integer"}}},
        run=lambda a: seen.append(a["x"]) or {"x": a["x"]},
        describe=lambda a, r: f"echoed {r['x']}",
    )
    client = FakeClient(
        [
            {"content": "Thinking about it", "tool_calls": [call("echo", {"x": 1}, "a"), call("echo", {"x": 2}, "b")]},
            {"tool_calls": [call("nope", {}, "c")]},
            {"tool_calls": [call("finish", {"summary": "All done"}, "d")]},
        ]
    )
    result = runtime.run_agent(run_id, client=client, model="fake", system="s", user="u", tools=[tool])

    assert result.finished and result.summary == "All done" and result.steps == 3
    assert seen == [1, 2]
    titles = event_titles(Session, run_id)
    assert ("thought", "Thinking about it") in titles
    assert ("tool_call", "echoed 1") in titles and ("tool_call", "echoed 2") in titles
    # the unknown tool's error went back to the model as a tool message
    last_messages = client.requests[-1]["messages"]
    assert any(m["role"] == "tool" and "Unknown tool" in m["content"] for m in last_messages)


def test_runtime_stops_at_step_limit(Session):
    run_id = events.start_run(1, "producer")
    tool = runtime.Tool("noop", "noop", {"type": "object", "properties": {}}, lambda a: {})
    client = FakeClient([{"tool_calls": [call("noop", {}, f"n{i}")]} for i in range(10)])
    result = runtime.run_agent(run_id, client=client, model="fake", system="s", user="u", tools=[tool], max_steps=3)
    assert not result.finished and result.stop_reason == "step_limit" and result.steps == 3


# ---------- producer ----------
@pytest.fixture
def media(monkeypatch, tmp_path):
    """Fake detector, transcript, cutter and packaging so the Producer runs without ffmpeg or models."""
    candidates = [Highlight(10, 40, 90), Highlight(100, 130, 80), Highlight(200, 230, 70), Highlight(300, 330, 60)]
    monkeypatch.setattr(producer, "find_highlights", lambda path, duration, count, secs, **kw: candidates)
    monkeypatch.setattr(producer.ProducerSession, "_full_transcript", lambda self: [
        producer.TranscriptWord(word=w, start=t, end=t + 0.4) for t, w in [(12, "no"), (13, "way"), (105, "reading"), (106, "chat")]
    ])
    monkeypatch.setattr(producer, "storage_root", lambda: tmp_path)
    monkeypatch.setattr(producer, "public_path", lambda p: f"storage/{Path(p).name}")
    monkeypatch.setattr(producer, "cut_vertical", lambda src, a, b, dst, layout: dst)

    def fake_extract(clip, db, platform="tiktok", source_hint=None):
        return SimpleNamespace(viral_title=f"Title {clip.id}", matched_hashtags=["#gaming"], suggested_style="Neon")

    def fake_apply(clip, db, ctx):
        clip.title, clip.hashtags = ctx.viral_title, ctx.matched_hashtags
        clip.caption_style_id = db.query(CaptionStyle).filter(CaptionStyle.name == ctx.suggested_style).first().id
        clip.context_json = {"game_or_topic": "Valorant"}
        db.commit()

    monkeypatch.setattr(producer, "extract_clip_context", fake_extract)
    monkeypatch.setattr(producer, "apply_context_to_clip", fake_apply)
    return candidates


def make_job(Session, count=2, brief=None):
    with Session() as db:
        job = ImportJob(user_id=1, source=ImportSource.UPLOAD, title="Stream", clip_count=count, agent_brief=brief or {})
        db.add(job)
        db.commit()
        job_id = job.id
    got = []
    return producer.ProducerJob(
        job_id=job_id, user_id=1, src=Path("/tmp/src.mp4"), duration=600, count=count, clip_seconds=30,
        layout="fill", title="Stream", source_ctx={"import_job_id": job_id}, brief=brief or {}, on_clip=got.append,
    ), got


def test_producer_agent_rejects_with_reasons_and_moves_cut_points(Session, media, monkeypatch):
    client = FakeClient(
        [
            {"tool_calls": [call("list_candidates", {}, "1")]},
            {"tool_calls": [call("read_transcripts", {"ids": [0, 1, 2, 3]}, "2")]},
            {"tool_calls": [call("reject_moments", {"rejections": [{"id": 1, "reason": "reading chat"}, {"id": 3, "reason": "loud but nothing happens"}]}, "3")]},
            {"tool_calls": [
                call("cut_clip", {"candidate_id": 0, "start_s": 8, "end_s": 33, "reason": "No-way reaction with a payoff"}, "4"),
                call("cut_clip", {"candidate_id": 2, "start_s": 198, "end_s": 226, "reason": "Clutch round"}, "5"),
                call("cut_clip", {"candidate_id": 2, "start_s": 200, "end_s": 230, "reason": "over the cap"}, "6"),
            ]},
            {"tool_calls": [call("finish", {"summary": "Kept 2 strong moments, skipped chat reading."}, "7")]},
        ]
    )
    monkeypatch.setattr(producer, "agent_client", lambda: (client, "fake", "fake:model"))
    job, got = make_job(Session, count=2)

    ids = producer.run_producer(job)

    assert len(ids) == 2 and got == ids
    with Session() as db:
        first = db.get(Clip, ids[0])
        assert (first.start_s, first.end_s) == (8, 33)  # agent moved the window (detector said 10-40)
        assert first.review_status == "pending"
        assert first.context_json["agent_reason"] == "No-way reaction with a payoff"
        assert db.get(CaptionStyle, first.caption_style_id).name == "Neon"
        run = db.query(AgentRun).filter(AgentRun.kind == "producer").one()
        assert run.status == "done" and run.summary.startswith("Kept 2 strong moments")
    titles = [t for _, t in event_titles(Session)]
    assert "Rejected 1:40: reading chat" in titles
    assert any(t.startswith("Kept 0:08-0:33: No-way reaction") for t in titles)
    # the transcript tool gave the model timestamped lines
    tool_msgs = [m["content"] for m in client.requests[-1]["messages"] if m["role"] == "tool"]
    assert any("[12.0s] no way" in c for c in tool_msgs)


def test_producer_brief_and_profile_reach_the_prompt_and_style(Session, media, monkeypatch):
    with Session() as db:
        db.add(learning.CreatorProfile(user_id=1, summary="Prefers Clean captions for Valorant.", feedback_count=0))
        db.commit()
    monkeypatch.setattr(learning, "refresh_profile", lambda user_id, force=False: None)
    client = FakeClient(
        [
            {"tool_calls": [call("list_candidates", {}, "1")]},
            {"tool_calls": [call("cut_clip", {"candidate_id": 0, "start_s": 10, "end_s": 40, "reason": "funny"}, "2")]},
            {"tool_calls": [call("finish", {"summary": "ok"}, "3")]},
        ]
    )
    monkeypatch.setattr(producer, "agent_client", lambda: (client, "fake", "fake:model"))
    job, _ = make_job(Session, count=1, brief={"mood": "funny", "style": "Punch", "platform": "youtube"})

    [clip_id] = producer.run_producer(job)

    system = client.requests[0]["messages"][0]["content"]
    assert "funny" in system and "Prefers Clean captions for Valorant." in system
    with Session() as db:
        assert db.get(CaptionStyle, db.get(Clip, clip_id).caption_style_id).name == "Punch"  # the brief wins


def test_producer_falls_back_to_fixed_pipeline(Session, media, monkeypatch):
    monkeypatch.setattr(producer, "agent_client", lambda: (None, None, None))
    monkeypatch.setattr(producer, "pick_highlights", lambda *a, **k: [Highlight(10, 40, 90, reason="big reaction"), Highlight(200, 230, 70)])
    job, _ = make_job(Session, count=2)

    ids = producer.run_producer(job)

    assert len(ids) == 2
    titles = [t for _, t in event_titles(Session)]
    assert any("fixed pipeline because" in t for t in titles)
    assert any(t.startswith("Kept 0:10-0:40: big reaction") for t in titles)
    with Session() as db:
        assert db.query(AgentRun).one().model == "fallback"


def test_producer_falls_back_when_agent_cuts_nothing(Session, media, monkeypatch):
    client = FakeClient([{"tool_calls": [call("finish", {"summary": "nothing good"}, "1")]}])
    monkeypatch.setattr(producer, "agent_client", lambda: (client, "fake", "fake:model"))
    monkeypatch.setattr(producer, "pick_highlights", lambda *a, **k: [Highlight(10, 40, 90)])
    job, _ = make_job(Session, count=1)

    assert len(producer.run_producer(job)) == 1
    assert any("Switching to the fixed pipeline" in t for _, t in event_titles(Session))


# ---------- scout ----------
def test_scout_watches_then_imports_new_vods_once(Session, monkeypatch):
    with Session() as db:
        db.add(Streamer(id=7, user_id=1, platform=SourcePlatform.TWITCH, username="mychannel", is_active=True))
        db.commit()
    latest = [scout.LatestVideo("v1", "https://www.twitch.tv/videos/1", "Old stream")]
    monkeypatch.setattr(scout, "list_latest", lambda platform, username, limit=3: latest)
    submitted = []
    from app.services.ingest import pipeline

    monkeypatch.setattr(pipeline, "submit", submitted.append)

    [first] = scout.run_scout()  # background pass: just remember the newest
    assert first.status == "first_seen" and submitted == []

    [same] = scout.run_scout()
    assert same.status == "no_change"

    latest[0] = scout.LatestVideo("v2", "https://www.twitch.tv/videos/2", "Big new stream")
    [found] = scout.run_scout()
    assert found.status == "new_vod" and submitted == [found.import_job_id]
    [again] = scout.run_scout()
    assert again.status == "no_change" and len(submitted) == 1  # never imported twice

    with Session() as db:
        job = db.get(ImportJob, found.import_job_id)
        assert job.url == "https://www.twitch.tv/videos/2" and job.agent_brief["origin"] == "scout"
        assert db.query(AgentRun).filter(AgentRun.kind == "scout").count() == 4


def test_scout_check_now_imports_newest_on_first_check(Session, monkeypatch):
    with Session() as db:
        db.add(Streamer(id=8, user_id=1, platform=SourcePlatform.YOUTUBE, username="me", is_active=True))
        db.commit()
    monkeypatch.setattr(scout, "list_latest", lambda *a, **k: [scout.LatestVideo("abc", "https://www.youtube.com/watch?v=abc", "Latest")])
    from app.services.ingest import pipeline

    monkeypatch.setattr(pipeline, "submit", lambda job_id: None)
    [result] = scout.run_scout(1, [8], import_if_first=True)
    assert result.status == "new_vod"


def test_scout_records_channel_errors(Session, monkeypatch):
    with Session() as db:
        db.add(Streamer(id=9, user_id=1, platform=SourcePlatform.KICK, username="x", is_active=True))
        db.commit()

    def boom(*a, **k):
        raise RuntimeError("Kick channel listing isn't supported yet.")

    monkeypatch.setattr(scout, "list_latest", boom)
    [result] = scout.run_scout()
    assert result.status == "error"
    with Session() as db:
        assert db.get(Streamer, 9).last_check_error == "Kick channel listing isn't supported yet."


# ---------- publisher ----------
def test_next_slot_respects_lead_time_and_taken_days():
    now = datetime(2026, 10, 23, 18, 45, tzinfo=UTC)  # 18:45 UTC
    # 7pm UTC today is only 15 min away (< 30 min lead) -> tomorrow
    assert publisher.next_slot("tiktok", set(), now, 0) == datetime(2026, 10, 24, 19, tzinfo=UTC)
    # In Lagos (UTC+1) it's 19:45 local: next 7pm local is tomorrow 18:00 UTC
    assert publisher.next_slot("tiktok", set(), now, 60) == datetime(2026, 10, 24, 18, tzinfo=UTC)
    taken = {datetime(2026, 10, 24).date()}
    assert publisher.next_slot("tiktok", taken, now, 0) == datetime(2026, 10, 25, 19, tzinfo=UTC)


def test_publish_approved_schedules_one_post_per_platform_per_day(Session, monkeypatch):
    monkeypatch.setattr(publisher, "_burn", lambda *a: None)
    with Session() as db:
        for i in (1, 2):
            db.add(Clip(id=i, user_id=1, start_s=0, end_s=20, title=f"Clip {i}", hashtags=["#fyp"], review_status="approved"))
        db.commit()
    first = publisher.publish_approved(1, 1, ["tiktok", "youtube"], 0, burn_async=False)
    second = publisher.publish_approved(2, 1, ["tiktok"], 0, burn_async=False)
    again = publisher.publish_approved(1, 1, ["tiktok"], 0, burn_async=False)

    assert {p.platform.value for p in first} == {"tiktok", "youtube"}
    tiktok_1 = next(p for p in first if p.platform.value == "tiktok")
    assert second[0].scheduled_for.date() != tiktok_1.scheduled_for.date()  # one TikTok per day
    assert again[0].id == tiktok_1.id  # approving twice doesn't double-post
    assert tiktok_1.caption_text == "Clip 1\n\n#fyp"


def test_release_due_posts_marks_ready_and_notifies(Session):
    from app.models.agent import Notification

    with Session() as db:
        db.add(Clip(id=1, user_id=1, start_s=0, end_s=20, title="Due"))
        db.add(Post(clip_id=1, platform="tiktok", status=PostStatus.QUEUED, scheduled_for=datetime.now(UTC) - timedelta(minutes=1)))
        db.add(Post(clip_id=1, platform="youtube", status=PostStatus.QUEUED, scheduled_for=datetime.now(UTC) + timedelta(hours=3)))
        db.commit()
    assert publisher.release_due_posts() == 1
    with Session() as db:
        assert sorted(p.status.value for p in db.query(Post)) == ["queued", "ready"]
        assert db.query(Notification).one().title == "Time to post on TikTok"


# ---------- learning ----------
def test_profile_learns_style_preference_after_two_changes(Session, monkeypatch):
    monkeypatch.setattr(learning, "_llm_profile", lambda rows: None)
    with Session() as db:
        clip = Clip(id=1, user_id=1, start_s=0, end_s=25, context_json={"game_or_topic": "Minecraft", "event_type": "fail"})
        db.add(clip)
        db.commit()
        learning.record_feedback(db, 1, clip, "style_change", {"style": "Punch"}, {"style": "Clean"})
        assert "Prefers Clean" not in (learning.refresh_profile(1).summary)
        learning.record_feedback(db, 1, clip, "style_change", {"style": "Neon"}, {"style": "Clean"})
        learning.record_feedback(db, 1, clip, "rejected", {}, {"reason": "no payoff"})
    profile = learning.refresh_profile(1)
    assert "Prefers Clean captions for Minecraft." in profile.summary
    assert "no payoff" in profile.summary and profile.feedback_count == 3
    learning.reset_profile(1)
    with Session() as db:
        assert db.query(CreatorFeedback).count() == 0


# ---------- commands ----------
def test_command_plans_from_latest_stream_without_a_model(Session, monkeypatch):
    monkeypatch.setattr(command, "agent_client", lambda: (None, None, None))
    with Session() as db:
        db.add(Streamer(user_id=1, platform=SourcePlatform.TWITCH, username="me", is_active=True,
                        last_seen_video_url="https://www.twitch.tv/videos/99", last_seen_video_title="Friday stream"))
        db.commit()
    plan = command.parse_command(1, "Make 3 funny clips from my last stream for YouTube Shorts")
    assert (plan.clip_count, plan.mood, plan.platform, plan.url) == (3, "funny", "youtube", "https://www.twitch.tv/videos/99")
    assert plan.error is None and "Friday stream" in plan.summary

    from app.services.ingest import pipeline

    monkeypatch.setattr(pipeline, "submit", lambda job_id: None)
    job = command.start_plan(1, plan)
    assert job.agent_brief["mood"] == "funny" and job.agent_brief["origin"] == "command" and job.clip_count == 3


def test_command_reports_missing_stream(Session, monkeypatch):
    monkeypatch.setattr(command, "agent_client", lambda: (None, None, None))
    plan = command.parse_command(1, "clip my last stream")
    assert plan.url is None and plan.error


def test_producer_cannot_cut_a_moment_it_rejected(Session, media, monkeypatch):
    client = FakeClient(
        [
            {"tool_calls": [call("list_candidates", {}, "1")]},
            {"tool_calls": [call("reject_moments", {"rejections": [{"id": 1, "reason": "reading chat"}]}, "2")]},
            {"tool_calls": [call("cut_clip", {"candidate_id": 1, "start_s": 100, "end_s": 130, "reason": "thanks chat"}, "3")]},
            {"tool_calls": [call("cut_clip", {"candidate_id": 0, "start_s": 10, "end_s": 40, "reason": "reaction"}, "4")]},
            {"tool_calls": [call("finish", {"summary": "ok"}, "5")]},
        ]
    )
    monkeypatch.setattr(producer, "agent_client", lambda: (client, "fake", "fake:model"))
    job, _ = make_job(Session, count=2)

    ids = producer.run_producer(job)

    assert len(ids) == 1
    with Session() as db:
        assert db.get(Clip, ids[0]).start_s == 10
    tool_msgs = [m["content"] for m in client.requests[-1]["messages"] if m["role"] == "tool"]
    assert any("which you rejected (reading chat)" in c for c in tool_msgs)

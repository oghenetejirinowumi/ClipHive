"""Groq transcription + AI highlight ranking, with a fake client (no key, no network)."""
from __future__ import annotations

from pathlib import Path
from types import SimpleNamespace

from app.config import settings
from app.schemas.clip import TranscriptWord
from app.services.clip import ai_rank
from app.services.clip.detector import Highlight
from app.services.transcribe import whisper_service

CANDIDATES = [
    Highlight(0.0, 30.0, 90.0),   # loud, boring
    Highlight(40.0, 70.0, 60.0),  # quieter, great line
    Highlight(80.0, 110.0, 70.0),
    Highlight(120.0, 150.0, 50.0),
]
WORDS = [
    TranscriptWord(word="reading", start=1.0, end=1.5, confidence=0.9),
    TranscriptWord(word="chat", start=1.6, end=2.0, confidence=0.9),
    TranscriptWord(word="NO", start=45.0, end=45.3, confidence=0.9),
    TranscriptWord(word="WAY", start=45.4, end=45.8, confidence=0.9),
]


class FakeChat:
    def __init__(self, content: str):
        self.content = content
        self.prompts: list[str] = []

    def create(self, **kwargs):
        self.prompts.append(kwargs["messages"][1]["content"])
        message = SimpleNamespace(content=self.content)
        return SimpleNamespace(choices=[SimpleNamespace(message=message)])


def fake_client(content: str):
    chat = FakeChat(content)
    return SimpleNamespace(chat=SimpleNamespace(completions=chat)), chat


def _enable(monkeypatch, candidates=CANDIDATES):
    monkeypatch.setattr(settings, "groq_api_key", "test-key")
    monkeypatch.setattr(settings, "ai_highlights_enabled", True)
    monkeypatch.setattr(ai_rank, "find_highlights", lambda *a, **k: list(candidates))


def test_without_key_uses_loudness_detector(monkeypatch):
    monkeypatch.setattr(settings, "groq_api_key", "")
    calls = []
    monkeypatch.setattr(ai_rank, "find_highlights", lambda p, d, c, s, **kw: calls.append(c) or CANDIDATES[:c])
    result = ai_rank.pick_highlights(Path("x.mp4"), 200, 2, 30)
    assert calls == [2]  # asked for exactly `count`, no extra candidates
    assert len(result) == 2


def test_ai_scores_change_which_moments_win(monkeypatch):
    _enable(monkeypatch)
    client, chat = fake_client(
        '{"ratings": [{"id": 0, "score": 5, "reason": "reading chat"},'
        ' {"id": 1, "score": 98, "reason": "huge reaction"},'
        ' {"id": 2, "score": 40, "reason": "ok"}, {"id": 3, "score": 10, "reason": "filler"}]}'
    )
    monkeypatch.setattr(ai_rank, "groq_client", lambda **k: client)
    result = ai_rank.pick_highlights(Path("x.mp4"), 200, 2, 30, words=WORDS)

    assert [h.start_s for h in result] == [40.0, 80.0]  # loud-but-boring 0s window dropped
    assert result[0].reason == "huge reaction"
    assert result[0].score == round(0.4 * 60 + 0.6 * 98, 1)
    assert "NO WAY" in chat.prompts[0] and "(no speech)" in chat.prompts[0]


def test_bad_llm_reply_falls_back_to_loudness(monkeypatch):
    _enable(monkeypatch)
    client, _ = fake_client("sorry, I can't do that")
    monkeypatch.setattr(ai_rank, "groq_client", lambda **k: client)
    result = ai_rank.pick_highlights(Path("x.mp4"), 200, 2, 30, words=WORDS)
    assert [h.start_s for h in result] == [0.0, 80.0]  # the two loudest
    assert all(h.reason is None for h in result)


def test_transcription_error_falls_back_to_loudness(monkeypatch):
    _enable(monkeypatch)

    def boom(*a, **k):
        raise RuntimeError("network down")

    monkeypatch.setattr(whisper_service, "transcribe_with_groq", boom)
    result = ai_rank.pick_highlights(Path("x.mp4"), 200, 2, 30)
    assert [h.start_s for h in result] == [0.0, 80.0]


def test_overlapping_candidates_are_not_both_picked(monkeypatch):
    overlapping = [Highlight(0.0, 30.0, 80.0), Highlight(10.0, 40.0, 79.0), Highlight(50.0, 80.0, 50.0)]
    _enable(monkeypatch, overlapping)
    client, _ = fake_client('{"ratings": []}')
    monkeypatch.setattr(ai_rank, "groq_client", lambda **k: client)
    result = ai_rank.pick_highlights(Path("x.mp4"), 100, 2, 30, words=[])
    assert [h.start_s for h in result] == [0.0, 50.0]


def test_groq_transcription_maps_words_and_confidence(monkeypatch, tmp_path):
    media = tmp_path / "clip.mp4"
    media.write_bytes(b"fake")
    def fake_extract(src, out, *args):
        out.write_bytes(b"mp3")
        return out

    monkeypatch.setattr(whisper_service, "extract_speech_audio", fake_extract)
    sent = {}

    class FakeTranscriptions:
        def create(self, **kwargs):
            sent.update(kwargs)
            return SimpleNamespace(model_dump=lambda: {
                "segments": [{"start": 0.0, "end": 2.0, "avg_logprob": -0.1},
                             {"start": 2.0, "end": 4.0, "avg_logprob": -2.0}],
                "words": [{"word": " clutch", "start": 0.5, "end": 0.9},
                          {"word": "", "start": 1.0, "end": 1.1},
                          {"word": "ace", "start": 2.5, "end": 2.9}],
            })

    client = SimpleNamespace(audio=SimpleNamespace(transcriptions=FakeTranscriptions()))
    monkeypatch.setattr("app.services.ai.groq_client.groq_client", lambda **k: client)

    words = whisper_service.transcribe_with_groq(media, start_s=10.0)

    assert sent["timestamp_granularities"] == ["word", "segment"]
    assert sent["response_format"] == "verbose_json"
    assert [w.word for w in words] == ["clutch", "ace"]
    assert words[0].start == 10.5  # shifted into the source timeline
    assert words[0].confidence == 0.9  # exp(-0.1)
    assert words[1].confidence == 0.14  # exp(-2.0): low, so the proofreader will look at it


def test_transcribe_video_auto_falls_back_without_key(monkeypatch):
    monkeypatch.setattr(settings, "groq_api_key", "")
    monkeypatch.setattr(whisper_service, "transcribe_with_faster_whisper", lambda *a, **k: ["local"])
    assert whisper_service.transcribe_video("x.mp4") == ["local"]


def test_transcribe_video_auto_falls_back_on_groq_error(monkeypatch):
    monkeypatch.setattr(settings, "groq_api_key", "test-key")

    def boom(*a, **k):
        raise RuntimeError("rate limited")

    monkeypatch.setattr(whisper_service, "transcribe_with_groq", boom)
    monkeypatch.setattr(whisper_service, "transcribe_with_faster_whisper", lambda *a, **k: ["local"])
    assert whisper_service.transcribe_video("x.mp4") == ["local"]

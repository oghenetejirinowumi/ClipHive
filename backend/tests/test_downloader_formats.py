"""Format selection and probe retries for link imports. No network calls."""

from __future__ import annotations

import pytest
from app.services.ingest import downloader as d

AUDIO_FMT = {"format_id": "249", "vcodec": "none", "acodec": "opus", "abr": 50}
COMBINED = {"format_id": "96", "vcodec": "avc1", "acodec": "mp4a", "height": 1080}


def yt(formats):
    return {"extractor_key": "Youtube", "formats": formats, "title": "t"}


def test_has_audio_only():
    assert d.has_audio_only(yt([COMBINED, AUDIO_FMT]))
    assert not d.has_audio_only(yt([COMBINED]))


def test_fallbacks_never_pick_best_quality_video():
    for fmt in (d.AUDIO, d.ANALYSIS_AUDIO):
        assert fmt.split("/")[-1] == "w"


def test_probe_retries_until_audio_only_streams_appear(monkeypatch):
    answers = [yt([COMBINED]), yt([COMBINED, AUDIO_FMT])]
    calls = []

    def fake(url, *, browser_cookies=False):
        calls.append(url)
        return answers[len(calls) - 1]

    monkeypatch.setattr(d, "_probe", fake)
    info = d.probe_url("https://youtu.be/x")
    assert d.has_audio_only(info) and len(calls) == 2


@pytest.mark.parametrize("info", [yt([COMBINED, AUDIO_FMT]), {"extractor_key": "Twitch", "formats": [COMBINED]}])
def test_probe_does_not_retry_when_not_needed(monkeypatch, info):
    calls = []
    monkeypatch.setattr(d, "_probe", lambda url, **kw: calls.append(url) or info)
    d.probe_url("https://example.com/v")
    assert len(calls) == 1


def test_probe_gives_up_after_retries(monkeypatch):
    calls = []
    monkeypatch.setattr(d, "_probe", lambda url, **kw: calls.append(url) or yt([COMBINED]))
    info = d.probe_url("https://youtu.be/x")
    assert not d.has_audio_only(info)
    assert len(calls) == 1 + d.AUDIO_PROBE_RETRIES

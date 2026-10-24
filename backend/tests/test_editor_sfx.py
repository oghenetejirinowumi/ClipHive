"""Auto SFX: the built-in library, finding cues, AI and rule plans, and writing audio tracks."""
import json
import wave
from types import SimpleNamespace

import numpy as np
import pytest

from app.config import settings
from app.schemas.editor import Timeline
from app.services.editor import sfx
from app.services.editor.compose import compose


@pytest.fixture(autouse=True)
def storage(tmp_path, monkeypatch):
    monkeypatch.setattr(settings, "storage_dir", str(tmp_path))
    return tmp_path


def _timeline(**extra) -> Timeline:
    return Timeline.model_validate({
        "assets": [
            {"id": "m1", "kind": "video", "name": "a", "src": "storage/a.mp4", "duration": 20, "has_audio": True},
            {"id": "m2", "kind": "video", "name": "b", "src": "storage/b.mp4", "duration": 20, "has_audio": True},
            {"id": "mus", "kind": "audio", "name": "song", "src": "storage/song.mp3", "duration": 60},
        ],
        "clips": [
            {"id": "c1", "asset_id": "m1", "start": 0, "duration": 6},
            {"id": "c2", "asset_id": "m2", "start": 6, "duration": 6},
        ],
        "texts": [
            {"id": "t1", "text": "WAIT FOR IT", "start": 1, "duration": 2, "size": 120, "uppercase": True},
            {"id": "t2", "text": "small label", "start": 8, "duration": 2, "size": 60, "animation": "slide_up"},
            {"id": "t3", "text": "so much money", "start": 9.5, "duration": 1, "is_caption": True},
        ],
        "audio": [{"id": "a1", "asset_id": "mus", "start": 0, "duration": 12, "volume": 0.3}],
        **extra,
    })


def _loudness(asset, seconds):
    """Quiet everywhere with one spike 3s into clip c2's file (timeline 9s)."""
    db = np.full(int(seconds / 0.5), -30.0)
    if asset.id == "m2":
        db[6] = -5.0
    return db, 0.5


def test_library_is_generated_once_as_valid_wavs(storage):
    items = sfx.library()
    assert {i["name"] for i in items} == set(sfx.LIBRARY)
    for item in items:
        path = storage / "sfx" / f"{item['name']}.wav"
        with wave.open(str(path), "rb") as w:
            assert w.getframerate() == sfx.RATE and w.getnchannels() == 1
            pcm = np.frombuffer(w.readframes(w.getnframes()), dtype="<i2")
        assert 0.04 < item["duration"] < 2.5
        assert np.abs(pcm).max() > 20000  # normalised, not silent
    before = (storage / "sfx" / "boom.wav").stat().st_mtime_ns
    sfx.ensure_library()
    assert (storage / "sfx" / "boom.wav").stat().st_mtime_ns == before


def test_cues_cover_cuts_titles_text_peaks_and_words():
    cues = sfx.find_cues(_timeline(), _loudness)
    kinds = {(c.kind, c.at) for c in cues}
    assert ("cut", 6.0) in kinds
    assert ("title", 1.0) in kinds
    assert ("text", 8.0) in kinds
    assert ("peak", 9.0) in kinds
    assert ("word", 9.5) in kinds


def _client(placements):
    reply = SimpleNamespace(choices=[SimpleNamespace(message=SimpleNamespace(content=json.dumps({"placements": placements})))])
    calls = []

    def create(**kwargs):
        calls.append(kwargs)
        return reply

    return SimpleNamespace(chat=SimpleNamespace(completions=SimpleNamespace(create=create))), calls


def test_ai_plan_is_used_and_validated():
    tl = _timeline()
    cues = {c.kind: c for c in sfx.find_cues(tl, _loudness)}
    client, calls = _client([
        {"cue": cues["cut"].id, "effect": "whoosh", "volume": 0.5, "reason": "transition"},
        {"cue": cues["title"].id, "effect": "impact", "volume": 9},  # clamped to 1
        {"cue": cues["peak"].id, "effect": "not_a_sound"},  # dropped
        {"cue": "nope", "effect": "pop"},  # dropped
    ])
    result = sfx.auto(tl, "normal", loudness=_loudness, client=client, model="m")
    assert result.used_ai and len(calls) == 1
    fx = [a for a in result.timeline.audio if a.is_sfx]
    assert len(fx) == 2
    whoosh = next(a for a in fx if a.asset_id == "sfx_whoosh")
    assert whoosh.start == pytest.approx(6.0 - sfx.LIBRARY["whoosh"][0].lead)  # the hit lands on the cut
    assert next(a for a in fx if a.asset_id == "sfx_impact").volume == 1.0
    assert result.timeline.audio[0].id == "a1"  # the music is untouched


def test_falls_back_to_rules_without_a_model(monkeypatch):
    monkeypatch.setattr(sfx, "_llm", lambda: (None, None))
    result = sfx.auto(_timeline(), "hype", loudness=_loudness)
    assert not result.used_ai
    used = {a.asset_id for a in result.timeline.audio if a.is_sfx}
    assert {"sfx_whoosh", "sfx_impact", "sfx_swoosh", "sfx_boom", "sfx_ding"} <= used
    assert len([a for a in result.timeline.audio if a.is_sfx]) <= sfx.cap_for("hype", 12)  # quietest dropped past the cap
    starts = sorted(a.start + sfx.LIBRARY[a.asset_id.removeprefix("sfx_")][0].lead for a in result.timeline.audio if a.is_sfx)
    assert all(b - a >= sfx.MIN_GAP_S - 1e-6 for a, b in zip(starts, starts[1:]))
    # Every effect asset is registered once and plays inside its file.
    assert len({a.id for a in result.timeline.assets}) == len(result.timeline.assets)


def test_running_again_replaces_and_subtle_is_quieter(monkeypatch):
    monkeypatch.setattr(sfx, "_llm", lambda: (None, None))
    hype = sfx.auto(_timeline(), "hype", loudness=_loudness).timeline
    subtle = sfx.auto(hype, "subtle", loudness=_loudness).timeline
    fx = [a for a in subtle.audio if a.is_sfx]
    assert 0 < len(fx) < len([a for a in hype.audio if a.is_sfx])
    assert all(a.volume <= sfx.VOLUME["subtle"] for a in fx)
    # Library assets nothing uses any more are dropped.
    used = {a.asset_id for a in subtle.audio}
    assert all(a.id in used for a in subtle.assets if sfx.is_library_src(a.src))


def test_effect_near_the_start_skips_its_lead_in():
    tl, _ = sfx.add_one(_timeline(), "riser", 0.5)
    riser = next(a for a in tl.audio if a.is_sfx)
    assert riser.start == 0 and riser.source_in == pytest.approx(1.5)


def test_unknown_effect_and_empty_edit_are_errors():
    with pytest.raises(ValueError):
        sfx.add_one(_timeline(), "kazoo", 1)
    with pytest.raises(ValueError):
        sfx.auto(Timeline(), "normal")


def test_sfx_compose_as_audio():
    tl, _ = sfx.add_one(_timeline(), "pop", 2)
    html = compose(tl, media_url=lambda a: a.src, font_url=lambda f: f)
    assert 'src="storage/sfx/pop.wav"' in html


def test_real_loudness_finds_a_spike_in_a_file(storage, monkeypatch):
    """file_loudness reads the actual media (ffmpeg), so the API path is covered end to end."""
    import subprocess

    from app.core.media import ffmpeg_bin

    # 6s of quiet tone with a loud burst at 4s.
    subprocess.run([ffmpeg_bin(), "-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "sine=f=220:d=6",
                    "-f", "lavfi", "-i", "color=c=black:s=64x64:d=6", "-filter_complex",
                    "[0]volume='if(between(t,4,4.5),1,0.03)':eval=frame[a]", "-map", "1", "-map", "[a]",
                    "-shortest", str(storage / "a.mp4")], check=True)
    monkeypatch.setattr(sfx, "_llm", lambda: (None, None))
    tl = Timeline.model_validate({
        "assets": [{"id": "m1", "kind": "video", "name": "a", "src": "storage/a.mp4", "duration": 6, "has_audio": True}],
        "clips": [{"id": "c1", "asset_id": "m1", "start": 0, "duration": 6}],
    })
    peaks = [c for c in sfx.find_cues(tl, sfx.file_loudness) if c.kind == "peak"]
    assert peaks and abs(peaks[0].at - 4.0) <= 0.5
    assert sfx.auto(tl, "normal", loudness=sfx.file_loudness).placements

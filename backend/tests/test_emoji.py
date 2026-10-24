"""Caption emoji: picking, spacing, motions, burned overlays and the editor's Auto emoji. No network."""
from __future__ import annotations

import json
from types import SimpleNamespace

import pytest

from app.schemas.caption_style import CaptionOptions
from app.schemas.editor import Text, Timeline
from app.services.caption import emoji as emo
from app.services.caption.ass_generator import ASSGenerator, StyleSpec
from app.services.caption.emoji_render import FPS, Overlay, ffmpeg_parts, pose
from app.services.editor import emojis
from app.services.editor.compose import compose


def phrases(*texts: str, word_s: float = 0.4, gap_s: float = 0.0) -> list[emo.Phrase]:
    out, t = [], 0.0
    for text in texts:
        words = []
        for w in text.split():
            words.append(emo.Word(w, t, t + word_s * 0.9, w.isupper() and len(w) > 2))
            t += word_s
        out.append(emo.Phrase(words))
        t += gap_s
    return out


def test_matches_feelings_not_filler():
    assert emo.match_word("LOL").emoji == "😂"
    assert emo.match_word("laughing").emoji == "😂"
    assert emo.match_word("headshot!").emoji == "🎯"
    assert emo.match_word("the") is None
    assert emo.match_word("and") is None


def test_phrases_like_no_way_win_over_single_words():
    cues = emo.rule_cues(phrases("NO WAY he did that"))
    best = max(cues, key=lambda c: c.score)
    assert best.emoji == "🤯" and best.word == 1  # reacts on "WAY", the end of the phrase


def test_neutral_speech_gets_no_emoji():
    cues, used_ai = emo.plan(phrases("so then we went over there", "and he said the thing"), use_ai=False)
    assert cues == [] and not used_ai


def test_spacing_and_amount():
    # A long clip full of emoji words: "few" < "normal" < "lots", all spaced by their gap.
    texts = ["that was insane lol", "we won the game", "omg no way", "rip my rank", "pizza time now", "so funny bro"] * 6
    ps = phrases(*texts, gap_s=0.6)
    counts = {}
    for amount in ("few", "normal", "lots"):
        cues, _ = emo.plan(ps, emo.EmojiSettings(amount=amount), use_ai=False)
        counts[amount] = len(cues)
        starts = [c.start for c in cues]
        assert all(b - a >= emo.MIN_GAP_S[amount] - 1e-6 for a, b in zip(starts, starts[1:]))
        assert all(c.end > c.start for c in cues)
    assert 0 < counts["few"] < counts["normal"] < counts["lots"]


def test_mix_gives_varied_motions_and_placements():
    texts = ["that was insane", "lol so funny", "we won", "omg", "rip", "money money", "so cold clutch", "big brain play"] * 3
    cues, _ = emo.plan(phrases(*texts, gap_s=2.0), emo.EmojiSettings(amount="lots"), use_ai=False)
    assert len({c.motion for c in cues}) >= 4
    assert all(a.motion != b.motion for a, b in zip(cues, cues[1:]))  # never the same twice in a row
    assert {"above", "left", "right"} <= {c.placement for c in cues}


def test_pinned_motion_and_placement():
    cues, _ = emo.plan(phrases("insane", "lol", "won", gap_s=4), emo.EmojiSettings("lots", "spin", "above"), use_ai=False)
    assert cues and all(c.motion == "spin" and c.placement == "above" for c in cues)


def test_ai_picks_are_validated():
    reply = {"emojis": [{"phrase": 0, "word": 2, "emoji": "🔥"}, {"phrase": 9, "word": 0, "emoji": "😂"}, {"phrase": 1, "word": 0, "emoji": "lol"}]}
    client = SimpleNamespace(chat=SimpleNamespace(completions=SimpleNamespace(
        create=lambda **_: SimpleNamespace(choices=[SimpleNamespace(message=SimpleNamespace(content=json.dumps(reply)))]))))
    cues, used_ai = emo.plan(phrases("bro that's crazy", "ok then"), client=client, model="x")
    assert used_ai and [(c.emoji, c.phrase, c.word) for c in cues] == [("🔥", 0, 2)]


def test_ai_failure_falls_back_to_rules():
    def boom(**_):
        raise RuntimeError("offline")

    client = SimpleNamespace(chat=SimpleNamespace(completions=SimpleNamespace(create=boom)))
    cues, used_ai = emo.plan(phrases("that was INSANE"), client=client, model="x")
    assert not used_ai and cues[0].emoji == "🔥"


@pytest.mark.parametrize("motion", emo.MOTIONS)
def test_every_motion_lands_and_leaves(motion):
    duration = 1.5
    start, settled, end = pose(motion, 0, duration), pose(motion, 0.9, duration), pose(motion, duration - 0.001, duration)
    assert start.alpha < 0.5 or start.sx > 1.5 or start.sx < 0.5  # it enters
    assert settled.alpha > 0.95 and 0.8 < settled.sx < 1.2 and abs(settled.dx) < 0.2  # it rests in place
    assert end.alpha < 0.05  # and fades out


def test_burned_captions_place_emoji_by_the_phrase():
    words = [{"word": w, "start": i * 0.4, "end": i * 0.4 + 0.35} for i, w in enumerate("bro that was INSANE lol".split())]
    for placement in ("above", "beside"):
        s = StyleSpec("Bangers", 110, True, "word_pop", CaptionOptions(emojis=True, emoji_placement=placement, emoji_amount="lots"))
        g = ASSGenerator()
        g.generate(words, s)
        assert g.emojis and g.emojis[0].emoji in ("🔥", "😂")
        e = g.emojis[0]
        assert 0 < e.cx < 1080 and 0 < e.cy < 1920
        if placement == "above":
            assert e.cy < 1920 * 0.68 and abs(e.cx - 540) < 60
        else:
            assert abs(e.cx - 540) > 150


def test_emoji_off_by_default():
    g = ASSGenerator()
    g.generate([{"word": "INSANE", "start": 0, "end": 0.4}], StyleSpec("Bangers", 110, True, "word_pop", CaptionOptions()))
    assert g.emojis == []


def test_ffmpeg_overlays_chain_onto_the_video():
    ovs = [Overlay("/tmp/a/%04d.png", 1.5, 10, 20), Overlay("/tmp/b/%04d.png", 3.0, -5, 40)]
    inputs, chain, label = ffmpeg_parts(ovs, 1, "0:v")
    assert inputs.count("-i") == 2 and inputs[1] == str(FPS)
    assert "setpts=PTS-STARTPTS+1.500/TB" in chain[0] and "[0:v][em0]overlay=x=10:y=20:eof_action=pass" in chain[1]
    assert chain[3].startswith("[emv0][em1]") and label == "emv1"


def _captioned() -> Timeline:
    texts = ["bro that was INSANE", "we won the game", "so then we left", "lol that was funny", "omg no way"]
    return Timeline(texts=[Text(id=f"c{i}", text=t, start=i * 4.0, duration=1.6, y=0.7, size=90, is_caption=True) for i, t in enumerate(texts)])


def test_editor_auto_emoji_adds_and_replaces():
    result = emojis.auto(_captioned(), "normal", use_ai=False)
    added = [t for t in result.timeline.texts if t.is_emoji]
    assert result.count == len(added) == emo.cap_for("normal", 17.6)  # capped per minute of speech
    assert all(not t.is_caption and t.stroke_width == 0 and emo.is_emoji(t.text) for t in added)
    assert "so then" not in " ".join(t.text for t in added)
    again = emojis.auto(result.timeline, "few", use_ai=False)
    assert len([t for t in again.timeline.texts if t.is_emoji]) == again.count  # replaced, not stacked
    cleared = emojis.auto(again.timeline, "none")
    assert not any(t.is_emoji for t in cleared.timeline.texts) and len(cleared.timeline.texts) == 5


def test_editor_auto_emoji_needs_captions():
    with pytest.raises(ValueError):
        emojis.auto(Timeline(), "normal", use_ai=False)


@pytest.mark.parametrize("motion", sorted(emojis.ANIMATION))
def test_compose_draws_every_emoji_motion(motion):
    tl = emojis.auto(_captioned(), "lots", motion, use_ai=False).timeline
    html = compose(tl, media_url=lambda a: "", font_url=lambda f: f)
    ids = [t.id for t in tl.texts if t.is_emoji]
    assert ids and all(f'id="ts-{i}"' in html and f'"#ts-{i}"' in html for i in ids)
    if motion == "burst":
        assert html.count('class="burst-spark"') == 7 * len(ids)

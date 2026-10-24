"""Finding moments by what's said, sentence-safe cuts, and the title writer's naming logic."""
from types import SimpleNamespace

from app.schemas.clip import TranscriptWord
from app.services.ai import title_writer as tw
from app.services.clip.moments import clip_words, refine_bounds, speech_candidates


def _say(*parts: tuple[float, str]) -> list[TranscriptWord]:
    """Words from (start time, "a sentence"): each word 0.3s apart."""
    words = []
    for t, sentence in parts:
        for i, w in enumerate(sentence.split()):
            words.append(TranscriptWord(word=w, start=round(t + i * 0.3, 2), end=round(t + i * 0.3 + 0.25, 2)))
    return words


# ---------- speech candidates ----------
def test_quiet_laughter_and_disbelief_make_a_candidate_ordinary_talk_does_not():
    words = _say(
        (5, "so today we are going to play some ranked games"),
        (60, "we just keep walking around the map looking for loot"),
        (120, "no way no way bro"), (122, "hahaha i'm crying"), (125, "what just happened"),
        (200, "okay back to the game"),
    )
    found = speech_candidates(words, duration=300, clip_seconds=30, count=3)
    assert len(found) == 1
    c = found[0]
    assert c.start_s <= 120 and c.end_s >= 125
    assert "laughter" in c.reason or "disbelief" in c.reason
    assert c.score >= 80  # fixed scale: a strong moment scores high however dull the rest is


def test_speech_candidates_skip_made_clips_and_loudness_picks():
    words = _say((120, "no way no way bro"), (122, "hahaha i'm crying"))
    assert speech_candidates(words, 300, 30, 3, exclude=[(110, 140)]) == []
    assert speech_candidates(words, 300, 30, 3, avoid=[(105, 135)]) == []


# ---------- sentence-safe cuts ----------
def test_a_start_mid_sentence_moves_back_to_where_it_begins():
    words = _say((10, "you will not believe what happened to me yesterday"))
    start, end = refine_bounds(11.0, 40.0, words, min_len=6, max_len=90)
    assert start == 9.75  # just before "you"
    assert end == 40.0  # in silence: untouched


def test_an_end_mid_sentence_waits_for_it_to_finish():
    words = _say((38, "and then he just fell off the map"))
    _, end = refine_bounds(10.0, 39.0, words, min_len=6, max_len=90)
    assert end == round(38 + 7 * 0.3 + 0.25 + 0.45, 2)  # after "map" plus a short tail


def test_a_start_in_a_pause_keeps_its_lead_in():
    words = _say((12, "no way"))
    assert refine_bounds(10.0, 40.0, words, min_len=6, max_len=90) == (10.0, 40.0)


def test_refining_never_breaks_the_length_limits():
    words = _say((38, "and then he just fell off the map and kept talking for a very long time about it"))
    start, end = refine_bounds(10.0, 39.0, words, min_len=6, max_len=30)
    assert end - start <= 30


def test_clip_words_are_in_clip_time():
    words = _say((12, "no way"))
    assert clip_words(words, 10, 20)[0] == {"word": "no", "start": 2.0, "end": 2.25, "confidence": 0.9}


# ---------- title writer ----------
def _clip(ctx, words=None, stream=None):
    return SimpleNamespace(id=1, user_id=1, stream=stream, context_json=ctx, transcript_json=words or [], title=None)


def test_streamer_identity_and_confidence():
    assert tw.identify_streamer(_clip({}), {"source": "twitch", "creator": "KaiCenat"}) == ("KaiCenat", "high")
    assert tw.identify_streamer(_clip({}), {"source": "youtube", "creator": "Kai Cenat Clips"})[1] == "low"
    assert tw.identify_streamer(_clip({}), {"source": "youtube", "creator": "Marques Brownlee"})[1] == "medium"
    # A watched channel named in the title of a clips channel's upload settles it.
    ctx = {"source": "youtube", "creator": "Daily Stream Clips", "source_title": "kaicenat loses it at 3am"}
    assert tw.identify_streamer(_clip({}), ctx, watched=["kaicenat"]) == ("kaicenat", "high")
    live = SimpleNamespace(streamer=SimpleNamespace(username="xqc"))
    assert tw.identify_streamer(_clip({}, stream=live), {}) == ("xqc", "high")


def test_big_streamer_reaction_gets_named_on_the_first_clip():
    b = tw.brief_for(_clip({"source": "twitch", "creator": "KaiCenat", "creator_followers": 21_000_000, "event_type": "reaction"}))
    assert b.name_streamer and "KaiCenat" in b.instructions()


def test_unknown_or_clips_channel_is_never_named():
    assert not tw.brief_for(_clip({"source": "upload"})).name_streamer
    b = tw.brief_for(_clip({"source": "youtube", "creator": "Best Twitch Clips", "event_type": "reaction"}))
    assert not b.name_streamer and "clips channel" in b.why
    assert "don't name" in b.instructions()


def test_small_streamer_gameplay_moment_leads_with_the_play():
    b = tw.brief_for(_clip({"source": "twitch", "creator": "tinystreamer", "creator_followers": 800, "event_type": "clutch"}))
    assert not b.name_streamer


def test_naming_rotates_across_a_videos_clips(monkeypatch):
    """With 2 of 2 earlier titles naming the streamer, the next one leads with the moment."""
    named = [SimpleNamespace(title=f"KaiCenat t{i}", context_json={"title_plan": {"name_streamer": True}}) for i in range(2)]

    class _Q:
        def __init__(self, rows):
            self.rows = rows

        def filter(self, *a, **k):
            return self

        def all(self):
            return self.rows

        def __iter__(self):
            return iter(self.rows)

    class _Db:
        def query(self, model):
            return _Q(named if model.__name__ == "Clip" else [])

        def get(self, model, _id):
            return SimpleNamespace(clip_ids=[2, 3])

    ctx = {"source": "twitch", "creator": "KaiCenat", "creator_followers": 21_000_000, "event_type": "reaction", "import_job_id": 9}
    b = tw.brief_for(_clip(ctx), _Db())
    assert not b.name_streamer and "2 of 2" in b.why
    assert b.siblings == ["KaiCenat t0", "KaiCenat t1"]


def test_check_prefers_titles_that_follow_the_plan_and_invent_nothing():
    b = tw.TitleBrief(streamer="KaiCenat", confidence="high", name_streamer=True, why="", summary="He reacts to chat trolling him")
    titles = ["INSANE 1v5 ACE", "Chat trolls him mid-stream", "KaiCenat can't believe what chat did #fyp"]
    assert tw.check(titles, b) == ["KaiCenat can't believe what chat did", "Chat trolls him mid-stream", "INSANE 1v5 ACE"]


def test_fallback_titles_come_from_the_facts():
    words = [{"word": w, "start": i * 0.3, "end": i * 0.3 + 0.25} for i, w in enumerate("bro no way he actually did that".split())]
    b = tw.brief_for(_clip({"source": "twitch", "creator": "KaiCenat", "creator_followers": 21_000_000, "event_type": "reaction",
                            "game_or_topic": "Fortnite"}, words))
    options = tw.fallback_titles(b)
    assert options[0] == 'KaiCenat: "bro no way he actually did that"'
    assert any("Fortnite" in o for o in options)


def test_non_stop_talk_ends_at_the_biggest_breath():
    """No full pause anywhere (word timestamps without punctuation): end at the longest gap nearby."""
    words = []
    t = 30.0
    for i in range(80):  # keeps talking well past the cut
        words.append(TranscriptWord(word=f"w{i}", start=round(t, 2), end=round(t + 0.25, 2)))
        t += 0.55 if i == 25 else 0.3  # one 0.3s breath after w25 (at ~37.8s), otherwise 0.05s gaps
    _, end = refine_bounds(10.0, 38.6, words, min_len=6, max_len=90)
    breath_end = next(w.end for w in words if w.word == "w25")
    assert end == round(breath_end + 0.15, 2)


def test_a_slice_of_a_longer_transcript_has_no_fake_edges():
    """Speech that continues past the words we look at isn't a sentence end at the slice edge."""
    words = _say((30, " ".join(f"w{i}" for i in range(100))))  # 30s of talk with no pauses at all
    assert refine_bounds(10.0, 40.0, words, min_len=6, max_len=90) == (10.0, 40.0)

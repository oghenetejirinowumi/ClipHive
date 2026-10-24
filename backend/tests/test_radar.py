from app.services.trends import radar, suggest
from app.services.trends.radar import RadarClip, Radar, Topic


def _clip(i, views, category="Grand Theft Auto V (GTA)", creator="kaysan", title="LMAOOO", duration=30):
    return RadarClip(
        id=f"kick:{i}", platform="kick", title=title, url="https://kick.com/x", thumbnail_url=None, views=views,
        duration_s=duration, category=category, creator=creator, creator_url="https://kick.com/x", creator_avatar=None, created_at=None,
    )


def test_topic_key_merges_platform_names():
    assert radar.topic_key("Grand Theft Auto V (GTA)") == radar.topic_key("Grand Theft Auto V")


def test_skips_gambling_and_sleeping():
    assert radar._skip("Slots & Casino")
    assert radar._skip("Just Sleeping")
    assert radar._skip("Something", ["Gambling"])
    assert not radar._skip("VALORANT", ["Shooter"])


def test_kick_clip_drops_mature_and_builds_links():
    raw = {"id": "clip_1", "title": "hi", "views": 5, "duration": 20, "channel": {"slug": "saab", "username": "Saab"}, "category": {"name": "IRL"}}
    clip = radar._kick_clip(raw)
    assert clip.url == "https://kick.com/saab/clips/clip_1" and clip.creator == "Saab"
    assert radar._kick_clip({**raw, "is_mature": True}) is None


def test_insights():
    ins = radar._insights([_clip(1, 10, duration=20), _clip(2, 10, duration=40, title="HUGE PLAY"), _clip(3, 10, duration=90)])
    assert ins["median_duration_s"] == 40
    assert ins["under_60s_pct"] == 67
    assert ins["caps_title_pct"] == 100  # "LMAOOO" and "HUGE PLAY"


def test_topic_hashtags():
    assert suggest.topic_hashtags("Grand Theft Auto V (GTA)", ["kick"]) == ["#GrandTheftAutoV", "#GTA", "#KickClips"]


def test_rules_suggest_hot_topic_and_unwatched_creator():
    top = _clip(1, 6000)
    r = Radar(
        generated_at="now", sources=[],
        topics=[Topic(key="grandtheftautov", name="Grand Theft Auto V (GTA)", platforms=["kick"], live_viewers=90000, clip_count=16, clip_views=28000, top_clip=top)],
        creators=[radar.Creator(name="Kaysan", platform="kick", url="u", avatar=None, clip_count=3, clip_views=13000, top_category="GTA")],
        clips=[top], insights=radar._insights([top]),
    )
    ctx = {"channels": [], "recent_topics": [], "recent_clip_titles": [], "taste_profile": ""}
    kinds = [s.kind for s in suggest._rules(r, ctx)]
    assert kinds[0] == "clip_topic" and "watch_creator" in kinds
    ctx["channels"] = [{"platform": "kick", "username": "kaysan"}]
    assert "watch_creator" not in [s.kind for s in suggest._rules(r, ctx)]

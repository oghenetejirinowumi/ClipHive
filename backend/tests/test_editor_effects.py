"""Auto effects: planning from beats/cuts/captions, keeping hand-made effects, and composing."""
import pytest

from app.schemas.editor import Timeline
from app.services.editor import effects, ops
from app.services.editor.compose import compose


def _timeline(**extra) -> Timeline:
    return Timeline.model_validate({
        "assets": [
            {"id": "m1", "kind": "video", "name": "a", "src": "storage/a.mp4", "duration": 20, "has_audio": True},
            {"id": "m2", "kind": "image", "name": "b", "src": "storage/b.png"},
        ],
        "clips": [
            {"id": "c1", "asset_id": "m1", "start": 0, "duration": 10},
            {"id": "c2", "asset_id": "m2", "start": 10, "duration": 4},
        ],
        "texts": [
            {"id": "t1", "text": "no way!", "start": 3.5, "duration": 1, "is_caption": True},
            {"id": "t2", "text": "calm words", "start": 6, "duration": 1, "is_caption": True},
        ],
        **extra,
    })


BEATS = [effects.Beat(2.0, 1.0), effects.Beat(5.0, 0.5), effects.Beat(8.0, 0.9)]


def _run(timeline: Timeline, style: str, amount: float = 0.6) -> Timeline:
    return effects.auto_effects(timeline, style, amount, analyse=lambda _: BEATS)[0]


def test_signals():
    tl = _timeline()
    assert effects.cuts(tl) == [10.0]
    assert effects.emphasis(tl) == [3.5]


@pytest.mark.parametrize("style", effects.STYLES)
def test_every_style_plans_valid_non_fighting_effects(style):
    tl = _run(_timeline(), style)
    assert tl.effects and all(e.auto for e in tl.effects)
    assert all(e.end <= tl.duration + 1e-6 for e in tl.effects)
    # The still image always gets a push-in.
    assert any(e.kind == "slow_zoom" and e.start == 10 for e in tl.effects)
    for a in tl.effects:
        for b in tl.effects:
            if a is not b and effects._Plan.LAYER[a.kind] == effects._Plan.LAYER[b.kind]:
                assert a.end <= b.start or b.end <= a.start, (a, b)


def test_hype_hits_beats_cuts_and_shouts():
    tl = _run(_timeline(), "hype", 1.0)
    zooms = {e.start for e in tl.effects if e.kind == "punch_zoom"}
    assert 3.5 in zooms and 1.95 in zooms  # the shouted caption and the loudest beat
    assert any(e.kind == "shake" for e in tl.effects)
    assert any(e.kind in ("flash", "glitch") and abs(e.start - 10) < 0.2 for e in tl.effects)


def test_rerun_replaces_auto_but_keeps_hand_made():
    tl, _ = ops.add_effect(_timeline(), "black_white", 1.0, 2.0)
    tl = _run(_run(tl, "hype"), "clean")
    assert sum(1 for e in tl.effects if not e.auto) == 1
    assert all(e.id.startswith("fxc") for e in tl.effects if e.auto)
    tl, _ = effects.auto_effects(tl, "none")
    assert [e.kind for e in tl.effects] == ["black_white"]


def test_editing_an_auto_effect_makes_it_yours():
    tl = _run(_timeline(), "hype")
    first = tl.effects[0].id
    tl, _ = ops.update_effect(tl, first, intensity=0.2)
    tl = _run(tl, "hype")
    assert any(e.id == first and not e.auto for e in tl.effects)


def test_empty_timeline_is_refused():
    with pytest.raises(ops.EditError):
        effects.auto_effects(Timeline(), "hype", analyse=lambda _: [])


def test_compose_draws_effects_deterministically():
    tl = _run(_timeline(), "hype", 1.0)
    html = compose(tl, media_url=lambda a: a.src, font_url=lambda f: f)
    assert html == compose(tl, media_url=lambda a: a.src, font_url=lambda f: f)
    for layer in ("stage", "fx-zoom", "fx-shake", "fx-flash"):
        assert f'id="{layer}"' in html
    assert '"#fx-zoom"' in html and '"#fx-shake"' in html
    # Text stays outside the effect wrappers.
    assert html.index('id="t-t1"') > html.index('id="stage"') and html.index('id="t-t1"') > html.rindex("</div></div></div></div></div></div></div>")


def test_compose_without_effects_has_no_overlays():
    html = compose(_timeline(), media_url=lambda a: a.src, font_url=lambda f: f)
    assert 'id="fx-flash"' not in html and 'id="fx-vignette"' not in html

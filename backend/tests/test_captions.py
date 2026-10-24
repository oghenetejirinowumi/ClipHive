"""Caption layout + generator tests. Uses the bundled fonts; no network."""
from __future__ import annotations

import re
from types import SimpleNamespace

import pytest
from app.schemas.caption_style import CaptionOptions, CaptionStyleBase, ass_to_hex
from app.services.caption.ass_generator import ASSGenerator, Layout, StyleSpec, ass_colour, ass_alpha
from app.services.caption.ass_import import parse_ass_styles
from app.services.caption.fonts import get_font

TEXT = "BRO you CANNOT miss THAT shot that was absolutely INSANE right"
WORDS = [{"word": w, "start": i * 0.4, "end": i * 0.4 + 0.35} for i, w in enumerate(TEXT.split())]
MODES = ["word_pop", "highlight_box", "karaoke", "reveal", "single_word", "line"]


def spec(mode="word_pop", font="Bangers", size=110, **opts) -> StyleSpec:
    return StyleSpec(font, size, True, mode, CaptionOptions(**opts))


def layout_for(s: StyleSpec) -> Layout:
    font = get_font(s.font_name)
    assert font is not None, f"bundled font {s.font_name} missing"
    return Layout(s, font)


def placements(s: StyleSpec, words: list[str], active: int | None):
    lay = layout_for(s)
    hype = [w == "INSANE" for w in words]
    size = lay.fit_size(words, hype)
    lines = lay.break_lines(words, hype, size)
    return lay, size, lay.place(words, hype, lines, size, active)


@pytest.mark.parametrize("mode", ["word_pop", "highlight_box", "reveal"])
@pytest.mark.parametrize("spacing", ["reflow", "stable"])
def test_enlarged_active_word_never_overlaps_its_neighbours(mode, spacing):
    s = spec(mode, active_scale=160, hype_scale=190, spacing_mode=spacing, words_per_line=4)
    words = TEXT.upper().split()[:8]
    for active in range(len(words)):
        _, _, placed = placements(s, words, active)
        for line_y in {p.cy for p in placed}:
            row = sorted((p for p in placed if p.cy == line_y), key=lambda p: p.x)
            for left, right in zip(row, row[1:]):
                assert left.x + left.width < right.x, f"{left.text} overlaps {right.text} (active={words[active]})"


def test_reflow_pushes_neighbours_apart_and_stable_keeps_them_still():
    words = ["BRO", "YOU", "CANNOT"]
    _, _, calm = placements(spec(active_scale=100), words, None)
    _, _, popped = placements(spec(active_scale=150), words, 1)
    # reflow: the line got wider, so the outer words moved outwards
    assert popped[0].x < calm[0].x and popped[2].x > calm[2].x

    stable = spec(active_scale=150, spacing_mode="stable")
    xs = [[p.x for p in placements(stable, words, a)[2] if p.index != a] for a in range(3)]
    _, _, first = placements(stable, words, 0)
    _, _, last = placements(stable, words, 2)
    assert first[1].x == last[1].x  # the middle word doesn't move when others pop
    assert all(xs)


def test_lines_leave_room_for_the_enlarged_word():
    s = spec(active_scale=170, words_per_line=2, max_lines=3)
    words = ["ABSOLUTELY", "INSANE", "CLUTCH", "PLAY"]
    lay, size, placed = placements(s, words, 1)  # active on the first line
    top_line = [p for p in placed if p.cy == min(q.cy for q in placed)]
    next_line = [p for p in placed if p.cy != top_line[0].cy]
    lowest_top = max(lay.text_box(p, size, 0)[3] for p in top_line)
    highest_next = min(lay.text_box(p, size, 0)[1] for p in next_line)
    assert lowest_top < highest_next


def test_long_word_shrinks_to_fit_the_frame():
    s = spec(size=220, max_width=60)
    lay, size, placed = placements(s, ["SUPERCALIFRAGILISTIC"], 0)
    assert size < 220
    assert placed[0].x >= 1080 * 0.2 - 1 and placed[0].x + placed[0].width <= 1080 * 0.8 + 1


@pytest.mark.parametrize("mode", MODES)
def test_every_mode_generates_positioned_events(mode):
    ass = ASSGenerator().generate(WORDS, spec(mode, glow_strength=8 if mode == "word_pop" else 0, line_box=mode == "line"), hype_words=["INSANE"])
    dialogue = [l for l in ass.splitlines() if l.startswith("Dialogue:")]
    assert dialogue
    assert "Style: Default,Bangers,110," in ass
    texts = [l for l in dialogue if "\\p1" not in l]
    assert all("\\pos(" in l for l in texts)
    if mode == "single_word":
        assert all(len(re.sub(r"\{[^}]*\}", "", l.split(",", 9)[9]).split()) == 1 for l in texts)
    if mode == "highlight_box":
        assert any("\\p1" in l for l in dialogue)  # the rounded box is drawn
    if mode == "line":
        assert any("\\p1" in l for l in dialogue)  # line box
        assert not any("\\fscx" in l for l in texts)


def test_reveal_only_shows_words_said_so_far():
    ass = ASSGenerator().generate(WORDS[:3], spec("reveal", words_per_line=3))
    events = [l for l in ass.splitlines() if l.startswith("Dialogue: 3,")]
    first_moment = [l for l in events if l.split(",")[1] == "0:00:00.00"]
    assert len(first_moment) == 1 and first_moment[0].endswith("BRO")


def test_karaoke_fills_words_already_said():
    ass = ASSGenerator().generate(WORDS[:3], spec("karaoke", active_color="#00FF00"))
    third = [l for l in ass.splitlines() if l.startswith("Dialogue: 3,0:00:00.80")]
    lit = [l for l in third if ass_colour("#00FF00") in l]
    assert len(lit) == 3  # BRO, YOU and CANNOT are all filled


def test_groups_break_on_sentence_end_and_capacity():
    words = [{"word": w, "start": i * 0.3, "end": i * 0.3 + 0.25} for i, w in enumerate("one two three. four five six seven eight nine ten".split())]
    ass = ASSGenerator().generate(words, spec(words_per_line=2, max_lines=2))
    # 'four' starts a new phrase after the full stop, so it is never on screen with 'three.'
    four_events = [l for l in ass.splitlines() if l.startswith("Dialogue: 3,0:00:00.90")]
    assert four_events and not any("THREE." in l for l in four_events)


def test_legacy_style_without_options_still_renders():
    legacy = SimpleNamespace(
        font_name="Poppins SemiBold", font_size=68, uppercase=False, animation_type="line",
        colors_json={"primary": "&H0000FFFF", "outline": "&H00000000", "highlight": "&H0000FFFF", "back": "&H80000000"},
        options_json={},
    )
    s = StyleSpec.of(legacy)
    assert s.options.text_color == "#FFFF00" and s.options.line_box
    assert "Dialogue:" in ASSGenerator().generate(WORDS, legacy)


def test_schema_style_converts_and_colours_round_trip():
    s = StyleSpec.of(CaptionStyleBase(name="x", font_name="Bangers", options=CaptionOptions(text_color="#12ABEF")))
    assert s.options.text_color == "#12ABEF"
    assert ass_colour("#12ABEF") == "&HEFAB12&"
    assert ass_alpha(100) == "&H00&" and ass_alpha(0) == "&HFF&"
    assert ass_to_hex("&H80EFAB12", "#000000") == ("#12ABEF", 50)


ASS_FILE = """[Script Info]
ScriptType: v4.00+
PlayResX: 1920
PlayResY: 1080

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Main,Bangers,60,&H00FFFFFF,&H0000FFFF,&H00000000,&H64000000,-1,0,0,0,100,100,0,0,1,3,2,2,10,10,40,1
Style: Boxed,Bangers,48,&H00FFFFFF,&H000000FF,&H99000000,&H00000000,0,1,0,0,100,100,2,0,3,1,0,8,10,10,30,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
Dialogue: 0,0:00:00.00,0:00:02.00,Main,,0,0,0,,{\\k20}Sing {\\k30}along
"""


def test_ass_import_maps_styles():
    main, boxed = parse_ass_styles(ASS_FILE)
    assert main.name == "Main" and main.font_name == "Bangers"
    assert main.font_size == round(60 * 1920 / 1080)
    assert main.animation_type == "karaoke"  # it has \\k tags
    assert main.options.text_color == "#FFFF00" and main.options.active_color == "#FFFFFF"  # secondary -> primary
    assert main.options.position_y > 80  # bottom aligned
    assert boxed.options.line_box and boxed.options.line_box_opacity == 40 and boxed.options.italic
    assert boxed.options.position_y < 20  # top aligned


def _t(ts: str) -> float:
    h, m, s = ts.split(":")
    return int(h) * 3600 + int(m) * 60 + float(s)


@pytest.mark.parametrize("mode", MODES)
def test_no_two_words_overlap_at_any_moment(mode):
    """Sample the timeline: words on screen together must never collide (incl. across phrases)."""
    s = spec(mode, active_scale=150, words_per_line=3, max_lines=2)
    ass = ASSGenerator().generate(WORDS, s, hype_words=["INSANE"])
    lay = layout_for(s)
    events = []
    for line in ass.splitlines():
        if not line.startswith("Dialogue: 3,"):
            continue
        _, start, end, *_rest = line.split(",", 3)
        x, y = map(float, re.search(r"\\pos\(([\d.]+),([\d.]+)\)", line).group(1, 2))
        scale = float(m.group(1)) if (m := re.findall(r"\\fscx(\d+)", line)) and (m := re.match(r"(\d+)", m[-1])) else 100.0
        size = float(fs.group(1)) if (fs := re.search(r"\\fs([\d.]+)", line)) else s.font_size
        word = re.sub(r"\{[^}]*\}", "", line.split(",", 9)[9])
        w = lay.width(word, size, scale)
        events.append((_t(start), _t(end), x - w / 2, x + w / 2, y, word))
    for t in [i * 0.05 for i in range(int(max(e[1] for e in events) / 0.05) + 1)]:
        on = [e for e in events if e[0] <= t < e[1]]
        for i, a in enumerate(on):
            for b in on[i + 1 :]:
                same_line = abs(a[4] - b[4]) < 1
                assert not (same_line and a[2] < b[3] and b[2] < a[3]), f"{a[5]} and {b[5]} overlap at {t:.2f}s"


def test_preview_and_emoji_request_accept_long_transcripts():
    from app.schemas.caption_style import EmojiPlanRequest, RenderPreviewRequest

    long_transcript = "This is a real stream dialogue " * 30  # ~900 chars
    req = RenderPreviewRequest(
        style=CaptionStyleBase(
            name="Test",
            font_name="Bangers",
            font_size=72,
        ),
        text=long_transcript,
    )
    assert req.text == long_transcript

    emoji_req = EmojiPlanRequest(text=long_transcript)
    assert emoji_req.text == long_transcript

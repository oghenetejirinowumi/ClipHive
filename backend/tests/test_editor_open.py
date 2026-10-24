"""Opening a clip in the editor: its transcript becomes editable captions in its burned style."""
from types import SimpleNamespace

from app.api import editor as editor_api
from app.schemas.editor import Timeline
from app.services.editor.compose import font_file


def _timeline() -> Timeline:
    return Timeline.model_validate({
        "assets": [{"id": "m1", "kind": "video", "name": "clip", "src": "storage/c.mp4", "duration": 15, "has_audio": True}],
        "clips": [{"id": "c1", "asset_id": "m1", "start": 0, "duration": 15}],
    })


WORDS = [{"word": w, "start": i * 0.5, "end": i * 0.5 + 0.4} for i, w in enumerate("this is the best play ever".split())]


class _Db:
    def __init__(self, style=None):
        self.style = style

    def get(self, _model, _id):
        return self.style


def test_transcript_becomes_captions_with_a_default_style():
    clip = SimpleNamespace(transcript_json=WORDS, caption_style_id=None, context_json=None)
    tl = editor_api._clip_captions(_Db(), _timeline(), clip)
    caps = [t for t in tl.texts if t.is_caption]
    assert [c.text for c in caps] == ["this is the", "best play ever"]
    assert caps[0].start == 0 and caps[1].start == 1.5


def test_captions_take_the_style_the_clip_was_burned_with():
    style = SimpleNamespace(font_name="Montserrat 900", font_size=96, uppercase=True, animation_type="karaoke",
                            options_json={"text_color": "#ffee00", "outline_color": "#111111", "outline_width": 4, "position_y": 30},
                            colors_json={})
    clip = SimpleNamespace(transcript_json=WORDS, caption_style_id=7, context_json={})
    caps = [t for t in editor_api._clip_captions(_Db(style), _timeline(), clip).texts if t.is_caption]
    c = caps[0]
    assert (c.font, c.size, c.uppercase, c.animation) == ("Montserrat 900", 96, True, "karaoke")
    assert (c.color, c.stroke_color, c.stroke_width, c.y) == ("#FFEE00", "#111111", 4, 0.3)


def test_no_transcript_leaves_the_timeline_alone():
    clip = SimpleNamespace(transcript_json=None, caption_style_id=None, context_json=None)
    assert editor_api._clip_captions(_Db(), _timeline(), clip).texts == []


def test_exports_find_caption_fonts():
    assert font_file("Bangers").name == "Bangers-Regular.ttf"
    assert font_file("Montserrat 900").name == "google-Montserrat-900.ttf"
    assert font_file("System") is None


def test_blur_fit_and_looks_compose():
    from app.services.editor.compose import compose

    tl = _timeline().model_copy(deep=True)
    tl = Timeline.model_validate({**tl.model_dump(), "clips": [{**tl.clips[0].model_dump(), "fit": "blur", "look": "dramatic"}]})
    html = compose(tl, media_url=lambda a: a.src, font_url=lambda f: f)
    assert 'id="b-c1"' in html and "blur(36px)" in html  # the blurred backdrop copy
    main = html[html.index('id="m-c1"'):]
    assert "object-fit: contain" in main[:600] and "grayscale(1)" in main[:600]
    plain = compose(_timeline(), media_url=lambda a: a.src, font_url=lambda f: f)
    assert 'id="b-c1"' not in plain and "filter:" not in plain[plain.index('id="m-c1"'):][:400]


def test_the_clips_own_caption_height_wins():
    style = SimpleNamespace(font_name="Bangers", font_size=84, uppercase=False, animation_type="line",
                            options_json={"position_y": 68}, colors_json={})
    clip = SimpleNamespace(transcript_json=WORDS, caption_style_id=7, context_json={"caption_position_y": 20})
    caps = [t for t in editor_api._clip_captions(_Db(style), _timeline(), clip).texts if t.is_caption]
    assert caps[0].y == 0.2


def test_captions_transcribe_only_the_part_on_the_timeline():
    from app.services.editor import ops

    tl = Timeline.model_validate({
        "assets": [{"id": "m1", "kind": "video", "name": "stream", "src": "storage/s.mp4", "duration": 10800, "has_audio": True}],
        "clips": [{"id": "c1", "asset_id": "m1", "start": 0, "duration": 30, "source_in": 5000}],
    })
    asked = []

    def transcribe(path, start, end):
        asked.append((start, end))
        return [{"word": "hello", "start": 5001.0, "end": 5001.5}]

    words = ops.caption_words(tl, transcribe)
    assert asked == [(5000, 5030)]
    assert words == [{"word": "hello", "start": 1.0, "end": 1.5}]

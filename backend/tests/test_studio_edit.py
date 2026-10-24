"""Unit tests for Studio editing: speed, volume, color filters, and caption repositioning."""
import pytest
from pydantic import ValidationError

from app.schemas.import_job import ClipEditRequest, StudioClipRequest


def test_clip_edit_request_valid():
    req = ClipEditRequest(
        speed=1.5,
        volume=1.2,
        color_filter="vibrant",
        caption_position_y=25,
        style_id=2,
    )
    assert req.speed == 1.5
    assert req.volume == 1.2
    assert req.color_filter == "vibrant"
    assert req.caption_position_y == 25
    assert req.style_id == 2


def test_clip_edit_request_bounds():
    # Speed must be between 0.5 and 2.0
    with pytest.raises(ValidationError):
        ClipEditRequest(speed=0.2)
    with pytest.raises(ValidationError):
        ClipEditRequest(speed=2.5)

    # Volume must be between 0.0 and 3.0
    with pytest.raises(ValidationError):
        ClipEditRequest(volume=-0.5)
    with pytest.raises(ValidationError):
        ClipEditRequest(volume=3.5)

    # Caption position Y must be between 8 and 92
    with pytest.raises(ValidationError):
        ClipEditRequest(caption_position_y=5)
    with pytest.raises(ValidationError):
        ClipEditRequest(caption_position_y=95)

    # Invalid color filter
    with pytest.raises(ValidationError):
        ClipEditRequest(color_filter="rainbow_glitch")


def test_studio_clip_request_with_editing_options():
    req = StudioClipRequest(
        start_s=5.0,
        end_s=15.0,
        title="Test Speed Clip",
        speed=1.25,
        volume=0.8,
        color_filter="dramatic",
        caption_position_y=50,
    )
    assert req.speed == 1.25
    assert req.volume == 0.8
    assert req.color_filter == "dramatic"
    assert req.caption_position_y == 50

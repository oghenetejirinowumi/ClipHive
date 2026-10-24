"""Tests for video cutting, speed manipulation, audio levels, and color grading."""
from __future__ import annotations

from app.services.clip.cutter import build_af, build_vf, COLOR_FILTERS


def test_build_vf_default():
    vf = build_vf("fill", speed=1.0, color_filter="none")
    assert "setsar=1" in vf
    assert "setpts" not in vf


def test_build_vf_speed_and_filter():
    vf = build_vf("blur", speed=1.5, color_filter="vibrant")
    assert "setsar=1" in vf
    assert "setpts=(1/1.5000)*PTS" in vf
    assert COLOR_FILTERS["vibrant"] in vf


def test_build_af_tempo_and_volume():
    af = build_af(speed=1.25, volume=1.5)
    assert af == ["-af", "volume=1.50,atempo=1.2500"]


def test_build_af_mute():
    af = build_af(speed=1.0, volume=0.0)
    assert af == ["-af", "volume=0.00"]


def test_build_af_defaults_empty():
    af = build_af(speed=1.0, volume=1.0)
    assert af == []

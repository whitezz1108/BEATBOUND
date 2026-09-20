"""Downbeat / bar-phase tests (prompt sections 6 and 25)."""

from __future__ import annotations

import numpy as np

from fakes import make_rhythm

from beatbound_audio.downbeat import analyze_downbeats


def _rhythm_with_phase_strengths(phase: int, n: int = 64, bpb: int = 4):
    """Beats whose strengths peak on ``phase`` beats of the grid bar."""
    rhythm = make_rhythm([], [], duration=n * 0.5)
    for i, beat in enumerate(rhythm.beats):
        beat["strength"] = 0.9 if (i - phase) % bpb == 0 else 0.3
    return rhythm


def test_correct_phase_is_detected():
    rhythm = _rhythm_with_phase_strengths(2)
    result = analyze_downbeats(rhythm)
    assert result.offset_beats == 2
    assert result.confidence is not None and result.confidence > 0.5
    assert len(result.downbeats) == rhythm.n_bars
    # The first downbeat sits 2 beats into bar 1.
    assert abs(result.downbeats[0]["time"] - 2 * rhythm.beat_len) < 1e-6
    assert all(d["confidence"] == result.confidence for d in result.downbeats)


def test_phase_zero_is_detected_when_grid_is_true():
    rhythm = _rhythm_with_phase_strengths(0)
    result = analyze_downbeats(rhythm)
    assert result.offset_beats == 0
    assert result.confidence > 0.5


def test_no_contrast_reports_zero_confidence_not_a_guess():
    """Uniform beat strengths: no metric information, no fabricated phase."""
    rhythm = make_rhythm([], [], duration=32.0)
    for beat in rhythm.beats:
        beat["strength"] = 0.5
    result = analyze_downbeats(rhythm)
    assert result.offset_beats is None
    assert result.confidence == 0.0
    assert result.downbeats == []
    assert any("contrast" in w for w in result.warnings)


def test_too_few_beats_is_an_honest_null():
    rhythm = make_rhythm([], [], duration=8.0)   # 16 beats at 120 bpm
    result = analyze_downbeats(rhythm)
    assert result.offset_beats is None
    assert result.confidence is None
    assert result.method == "none"


def test_declared_meter_wins_over_beat_pattern():
    """A 3/4 grid keeps grouping by 3 even if strengths suggest 4 (override priority).

    The prompt requires manual meter/bar overrides to win. The declared time
    signature *is* the override here: the phase estimate is made modulo 3.
    """
    rhythm = _rhythm_with_phase_strengths(0, n=66, bpb=3)
    rhythm.time_signature = (3, 4)
    result = analyze_downbeats(rhythm)
    assert result.offset_beats is not None
    assert 0 <= result.offset_beats < 3


def test_silent_rhythm_has_no_downbeats():
    rhythm = make_rhythm([], [], duration=4.0)
    rhythm.bpm = None
    rhythm.beat_len = None
    result = analyze_downbeats(rhythm)
    assert result.offset_beats is None
    assert result.confidence is None
    assert result.downbeats == []

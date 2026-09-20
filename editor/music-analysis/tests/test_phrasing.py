"""Phrase hierarchy tests (prompt section 25).

Two layers: unit tests of the DP segmentation over hand-set boundary scores,
and pipeline tests (via ``run_v2``) checking the real phrases stay bar-aligned
and inside their sections.
"""

from __future__ import annotations

import numpy as np

from conftest import run_v2

from beatbound_audio.phrasing import _segment


def _score(bars, highs=()):
    return {b: (0.9 if b in highs else 0.05) for b in bars}


def test_dp_prefers_evidenced_four_bar_split():
    """A strong line at bar 5 splits 8 bars into 4+4, not 8."""
    bars = list(range(1, 9))
    pieces = _segment(bars, _score(bars, highs={5}))
    assert pieces == [[1, 4], [5, 8]]


def test_dp_keeps_one_phrase_without_evidence():
    """No interior evidence at all: one 8-bar phrase (fit cost 0)."""
    bars = list(range(1, 9))
    pieces = _segment(bars, _score(bars))
    assert pieces == [[1, 8]]


def test_dp_splits_a_strong_eight_bar_phrase():
    bars = list(range(1, 17))
    pieces = _segment(bars, _score(bars, highs={9}))
    assert pieces == [[1, 8], [9, 16]]


def test_dp_respects_min_length():
    """Never produces a phrase shorter than the configured minimum."""
    bars = list(range(1, 13))
    pieces = _segment(bars, _score(bars, highs={3, 5, 7, 9, 11}))
    for a, b in pieces:
        assert b - a + 1 >= 2


def test_dp_pieces_cover_and_stay_ordered():
    bars = list(range(1, 25))
    pieces = _segment(bars, _score(bars, highs={5, 9, 13, 21}))
    assert pieces[0][0] == bars[0]
    assert pieces[-1][1] == bars[-1]
    for (_a, b), (a2, _b2) in zip(pieces, pieces[1:]):
        assert a2 == b + 1, "phrases must be contiguous"


# ---------------------------------------------------------------------------
# Pipeline-level guarantees
# ---------------------------------------------------------------------------

def test_phrases_align_to_the_bar_grid(click_wav, tmp_path, stub_full_backends):
    doc, _legacy, _out = run_v2(
        click_wav, str(tmp_path), mode="full", cache_dir=str(tmp_path / "cache")
    )
    layers = doc["layers"]
    phrases = layers["phrasing"]["phrases"]
    assert phrases, "a 12 s click track should still produce at least one phrase"
    n_bars = layers["rhythm"]["barCount"]

    sections_by_id = {s["id"]: s for s in doc["sections"]}
    for ph in phrases:
        assert isinstance(ph["start_bar"], int) and ph["start_bar"] >= 1
        assert isinstance(ph["end_bar"], int) and ph["end_bar"] <= n_bars
        assert ph["end_bar"] >= ph["start_bar"]
        assert ph["bar_count"] == ph["end_bar"] - ph["start_bar"] + 1

        # The phrase's time span is exactly the grid bars it claims.
        bar_bounds = [0.0] + [
            (layers["rhythm"]["beatLengthSec"] * layers["rhythm"]["timeSignature"][0]) * b
            for b in range(1, n_bars + 1)
        ]
        assert abs(ph["start"] - bar_bounds[ph["start_bar"] - 1]) < 0.01
        assert ph["end"] <= bar_bounds[ph["end_bar"]] + 0.01

        # Never outside its own section.
        sec = sections_by_id[ph["section_id"]]
        assert sec["startBar"] <= ph["start_bar"]
        assert ph["end_bar"] <= sec["endBar"]


def test_phrases_are_contiguous_within_sections(click_wav, tmp_path, stub_full_backends):
    doc, _legacy, _out = run_v2(
        click_wav, str(tmp_path), mode="full", cache_dir=str(tmp_path / "cache")
    )
    phrases = doc["layers"]["phrasing"]["phrases"]
    by_section: dict = {}
    for ph in phrases:
        by_section.setdefault(ph["section_id"], []).append(ph)
    for group in by_section.values():
        spans = [(p["start_bar"], p["end_bar"]) for p in group]
        assert spans == sorted(spans), "phrases must be time-ordered"
        for (_a, b), (a2, _b2) in zip(spans, spans[1:]):
            assert a2 == b + 1, "phrases inside a section must not overlap or gap"


def test_short_song_falls_back_gracefully(short_wav, tmp_path, stub_missing_backends):
    doc, _legacy, _out = run_v2(
        short_wav, str(tmp_path), mode="full", cache_dir=str(tmp_path / "cache")
    )
    phrases = doc["layers"]["phrasing"]["phrases"]
    # 0.4 s is shorter than a bar: there is nothing honest to phrase.
    for ph in phrases:
        assert ph["bar_count"] >= 1
        assert ph["confidence"] is not None


def test_silence_produces_no_phrases(silent_wav, tmp_path, stub_missing_backends):
    doc, _legacy, _out = run_v2(
        silent_wav, str(tmp_path), mode="full", cache_dir=str(tmp_path / "cache")
    )
    assert doc["layers"]["phrasing"]["phrases"] == []
    assert doc["layers"]["phrasing"]["method"] == "none"


def test_position_labels_follow_the_rules(click_wav, tmp_path, stub_full_backends):
    doc, _legacy, _out = run_v2(
        click_wav, str(tmp_path), mode="full", cache_dir=str(tmp_path / "cache")
    )
    by_section: dict = {}
    for ph in doc["layers"]["phrasing"]["phrases"]:
        by_section.setdefault(ph["section_id"], []).append(ph)
    for group in by_section.values():
        labels = [p["position_label"] for p in group]
        assert labels[0] == "opening"
        for lab in labels:
            assert lab in ("opening", "development", "peak")

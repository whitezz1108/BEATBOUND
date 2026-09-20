"""End-to-end integration test for the V2 pipeline (prompt section 20).

These tests run the whole chain against real audio -- decode, rhythm, energy,
tonal, structure, events, aggregation, both documents -- and then assert the
things that would actually break the editor if they regressed:

* the V1 projection is loadable by the director's own consumers, with the
  fields ``levelDirector.js`` and ``editor.js`` read present and well typed;
* the constant-tempo grid identity holds (analysis bars == runtime bars);
* ``source.sourceHash`` matches what v1 wrote, so ``level.analysisSource`` stays
  comparable across the upgrade;
* the unified window timeline is genuinely fixed-rate and every window field is
  either null or in 0..1.

The heavy ML backends are stubbed, so this suite runs in seconds.
"""

from __future__ import annotations

import json
import os

import numpy as np
import pytest

from conftest import run_v2


# ---------------------------------------------------------------------------
# Consumers of the v1 projection
# ---------------------------------------------------------------------------

def test_legacy_projection_feeds_the_level_director(click_wav, tmp_path, stub_full_backends):
    """Exactly the fields editor/generator/levelDirector.js reads."""
    _doc, legacy, _out = run_v2(
        click_wav, str(tmp_path), mode="full", cache_dir=str(tmp_path / "cache")
    )

    # music.bars[].{energy, rhythmDensity, novelty, bar}
    assert legacy["bars"], "the director needs at least one bar"
    for bar in legacy["bars"]:
        assert isinstance(bar["bar"], int) and bar["bar"] >= 1
        for field in ("energy", "rhythmDensity", "novelty"):
            assert 0.0 <= bar[field] <= 1.0, f"bar.{field} out of range: {bar[field]}"

    # music.sections[].{id, startBar, endBar}
    for section in legacy["sections"]:
        assert section["id"]
        assert section["startBar"] <= section["endBar"]

    # music.tempo.{bpm, timeSignature[0]}
    assert legacy["tempo"]["bpm"] > 0
    assert legacy["tempo"]["timeSignature"][0] >= 1

    # music.song.id -- what analysisSource falls back to.
    assert legacy["song"]["id"]


def test_legacy_projection_feeds_the_editor_ui(click_wav, tmp_path, stub_full_backends):
    """Exactly the fields editor/ui/editor.js reads."""
    _doc, legacy, _out = run_v2(
        click_wav, str(tmp_path), mode="full", cache_dir=str(tmp_path / "cache")
    )
    assert legacy["beats"], "the UI draws beats"
    for beat in legacy["beats"]:
        for field in ("time", "index", "bar", "beat", "strength"):
            assert field in beat

    assert legacy["onsets"], "the UI draws onsets"
    assert legacy["waveformEnvelope"]["times"], "the UI draws the waveform"
    assert len(legacy["waveformEnvelope"]["times"]) == len(legacy["waveformEnvelope"]["values"])
    assert legacy["song"]["durationSec"] > 0
    assert legacy["tempo"]["bpm"] > 0


def test_projection_source_hash_is_byte_stable(click_wav, tmp_path, stub_missing_backends):
    """level.json's editor.analysisSource is a 16-hex hash of the audio bytes.

    If the V2 upgrade changed the hash scheme, every existing level.json would
    silently stop matching its song. It must stay sha256(audio)[:16].
    """
    import hashlib

    doc, legacy, _out = run_v2(
        click_wav, str(tmp_path), mode="full", cache_dir=str(tmp_path / "cache")
    )
    with open(click_wav, "rb") as fh:
        expected = hashlib.sha256(fh.read()).hexdigest()[:16]
    assert legacy["song"]["sourceHash"] == expected
    assert doc["source"]["sourceHash"] == expected
    assert doc["source"]["audioHash"] == hashlib.sha256(open(click_wav, "rb").read()).hexdigest()


# ---------------------------------------------------------------------------
# The grid identity
# ---------------------------------------------------------------------------

def test_analysis_bars_equal_runtime_bars(click_wav, tmp_path, stub_missing_backends):
    """The whole reason v1 used a constant grid: analysis bars == runtime bars.

    ConstantTempoMap anchors at 0 with beat_len = 60/bpm and bpb beats per bar.
    Reproduce that arithmetic here and check the analyzer agrees exactly.
    """
    doc, legacy, _out = run_v2(
        click_wav, str(tmp_path), mode="full", cache_dir=str(tmp_path / "cache")
    )
    bpm = legacy["tempo"]["bpm"]
    bpb = legacy["tempo"]["timeSignature"][0]
    beat_len = 60.0 / bpm
    duration = legacy["song"]["durationSec"]

    expected_beats = int(duration // beat_len)
    expected_bars = max(1, expected_beats // bpb)
    assert doc["layers"]["rhythm"]["beatCount"] == expected_beats
    assert doc["layers"]["rhythm"]["barCount"] == expected_bars
    assert len(legacy["beats"]) == expected_beats
    assert len(legacy["bars"]) == expected_bars

    # Every beat must sit exactly on k * beat_len.
    for i, beat in enumerate(legacy["beats"]):
        assert abs(beat["time"] - i * beat_len) < 1e-6, f"beat {i} is off the grid"

    # Bar 1 must start at 0 and bar n+1 at n * bpb * beat_len.
    for i, bar in enumerate(legacy["bars"]):
        assert abs(bar["startTime"] - i * bpb * beat_len) < 1e-6


def test_beats_are_numbered_consistently(click_wav, tmp_path, stub_missing_backends):
    _doc, legacy, _out = run_v2(
        click_wav, str(tmp_path), mode="full", cache_dir=str(tmp_path / "cache")
    )
    bpb = legacy["tempo"]["timeSignature"][0]
    for i, beat in enumerate(legacy["beats"]):
        assert beat["index"] == i
        assert beat["bar"] == i // bpb + 1
        assert beat["beat"] == i % bpb + 1


# ---------------------------------------------------------------------------
# The unified window timeline
# ---------------------------------------------------------------------------

def test_window_timeline_is_fixed_rate(click_wav, tmp_path, stub_missing_backends):
    doc, _legacy, _out = run_v2(
        click_wav, str(tmp_path), mode="full", cache_dir=str(tmp_path / "cache")
    )
    timeline = doc["timeline"]
    step = timeline["hopSec"]
    assert step > 0
    times = [w["time"] for w in timeline["windows"]]
    assert len(times) >= 2
    for i, t in enumerate(times):
        assert abs(t - i * step) < 1e-6, f"window {i} is off the fixed grid"


def test_every_window_field_is_null_or_normalised(click_wav, tmp_path, stub_full_backends):
    """Normalisation policy: a published window value is either null or 0..1."""
    doc, _legacy, _out = run_v2(
        click_wav, str(tmp_path), mode="full", cache_dir=str(tmp_path / "cache")
    )
    fields = (
        "energy",
        "drumActivity",
        "bassActivity",
        "vocalActivity",
        "melodicActivity",
        "pitchNormalized",
        "brightness",
    )
    for window in doc["timeline"]["windows"]:
        for field in fields:
            value = window.get(field)
            assert value is None or 0.0 <= value <= 1.0, (
                f"window field {field}={value} is neither null nor in 0..1"
            )


def test_window_count_matches_duration(click_wav, tmp_path, stub_missing_backends):
    doc, _legacy, _out = run_v2(
        click_wav, str(tmp_path), mode="full", cache_dir=str(tmp_path / "cache")
    )
    duration = doc["source"]["durationSec"]
    step = doc["timeline"]["hopSec"]
    expected = int(duration / step) + 1
    assert len(doc["timeline"]["windows"]) == expected


# ---------------------------------------------------------------------------
# Events
# ---------------------------------------------------------------------------

def test_events_are_time_sorted(click_wav, tmp_path, stub_full_backends):
    doc, _legacy, _out = run_v2(
        click_wav, str(tmp_path), mode="full", cache_dir=str(tmp_path / "cache")
    )
    times = [e["time"] for e in doc["events"]]
    assert times == sorted(times), "events must be time-ordered for a timeline consumer"


def test_event_strengths_are_normalised(click_wav, tmp_path, stub_full_backends):
    doc, _legacy, _out = run_v2(
        click_wav, str(tmp_path), mode="full", cache_dir=str(tmp_path / "cache")
    )
    for event in doc["events"]:
        strength = event["strength"]
        assert strength is None or 0.0 <= strength <= 1.0


def test_event_counts_match_the_event_list(click_wav, tmp_path, stub_full_backends):
    doc, _legacy, _out = run_v2(
        click_wav, str(tmp_path), mode="full", cache_dir=str(tmp_path / "cache")
    )
    counted: dict = {}
    for event in doc["events"]:
        counted[event["type"]] = counted.get(event["type"], 0) + 1
    assert doc["layers"]["eventCounts"] == dict(sorted(counted.items()))


def test_every_beat_has_a_beat_event(click_wav, tmp_path, stub_missing_backends):
    """The pulse is the floor of the event layer -- it must never be dropped."""
    doc, _legacy, _out = run_v2(
        click_wav, str(tmp_path), mode="full", cache_dir=str(tmp_path / "cache")
    )
    beat_events = [e for e in doc["events"] if e["type"] == "beat"]
    assert len(beat_events) == doc["layers"]["rhythm"]["beatCount"]


# ---------------------------------------------------------------------------
# Cache behaviour
# ---------------------------------------------------------------------------

def test_cache_is_written_and_reused(click_wav, tmp_path, stub_full_backends):
    """The cache is a *run-time* optimisation, not part of the artifact.

    ``analysisMeta`` must stay identical whether or not the cache was warm --
    cache state is run-state, and it is reported in the CLI's debug report
    instead. What is asserted here is both halves: the second run reads the
    cached stems back rather than re-separating them, *and* the document is
    unchanged by that.
    """
    cache = str(tmp_path / "cache")
    doc1, _l1, report1 = run_v2(click_wav, str(tmp_path / "run1"), mode="full", cache_dir=cache)
    doc2, _l2, report2 = run_v2(click_wav, str(tmp_path / "run2"), mode="full", cache_dir=cache)

    assert report1["cache"]["used"] is False, "first run has nothing to reuse"
    assert report2["cache"]["used"] is True, "second run must reuse the cache"
    assert "stems" in report2["cache"]["sections"]

    # A warm cache must not change the artifact at all.
    assert doc1 == doc2, "cache state leaked into the document"


def test_force_bypasses_the_cache(click_wav, tmp_path, stub_full_backends):
    cache = str(tmp_path / "cache")
    run_v2(click_wav, str(tmp_path / "run1"), mode="full", cache_dir=cache)
    _doc, _legacy, report = run_v2(
        click_wav, str(tmp_path / "run2"), mode="full", cache_dir=cache, force=True
    )
    assert report["cache"]["used"] is False, "--force must re-run everything"


def test_cache_key_changes_with_audio(click_wav, silent_wav, tmp_path, stub_missing_backends):
    """Two different files must not share a cache entry."""
    cache = str(tmp_path / "cache")
    d1, _l1, _r1 = run_v2(click_wav, str(tmp_path / "r1"), mode="fast", cache_dir=cache)
    d2, _l2, _r2 = run_v2(silent_wav, str(tmp_path / "r2"), mode="fast", cache_dir=cache)
    assert d1["analysisMeta"]["audioHash"] != d2["analysisMeta"]["audioHash"]
    assert d2["global"]["silent"] is True
    assert os.path.isdir(os.path.join(cache, d1["analysisMeta"]["audioHash"]))
    assert os.path.isdir(os.path.join(cache, d2["analysisMeta"]["audioHash"]))


# ---------------------------------------------------------------------------
# Provenance
# ---------------------------------------------------------------------------

def test_analysis_meta_records_the_settings_used(click_wav, tmp_path, stub_missing_backends):
    doc, _legacy, _out = run_v2(
        click_wav, str(tmp_path), mode="full", cache_dir=str(tmp_path / "cache")
    )
    meta = doc["analysisMeta"]
    assert meta["analyzerVersion"]
    assert meta["settingsSignature"]
    assert meta["settings"]["sampleRate"] > 0
    assert meta["settings"]["hopLength"] > 0
    assert meta["flags"]["mode"] == "full"


def test_bpm_override_is_honoured(click_wav, tmp_path, stub_missing_backends):
    """An operator-supplied tempo must win and be recorded as such."""
    doc, legacy, _out = run_v2(
        click_wav,
        str(tmp_path),
        mode="fast",
        bpm_override=150.0,
        cache_dir=str(tmp_path / "cache"),
    )
    assert doc["global"]["bpm"] == 150.0
    assert legacy["tempo"]["bpm"] == 150.0
    assert legacy["tempo"]["confidence"] == 1.0
    assert doc["analysisMeta"]["flags"]["bpmOverride"] == 150.0

    # The grid must follow the override: beat_len = 60/150.
    beat_len = 60.0 / 150.0
    assert abs(legacy["beats"][1]["time"] - beat_len) < 1e-6

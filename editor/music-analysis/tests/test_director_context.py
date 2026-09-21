"""Director context tests (prompt section 25).

Everything here runs the real pipeline (ML backends stubbed) and asserts on
the ``director_context.json`` it writes: schema validity, reference
integrity, the no-raw-dumps policy, and byte-determinism.
"""

from __future__ import annotations

import hashlib
import json
import os

import pytest

from conftest import load_director, run_v2

SCHEMA_DIR = os.path.join(
    os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))),
    "schemas",
)


def _errors(schema: dict, doc: dict) -> list:
    jsonschema = pytest.importorskip("jsonschema")
    validator = jsonschema.Draft202012Validator(schema)
    return sorted(validator.iter_errors(doc), key=lambda e: list(e.path))


def _director(click_wav, tmp_path, stub):
    doc, _legacy, _out = run_v2(
        click_wav, str(tmp_path), mode="full", cache_dir=str(tmp_path / "cache")
    )
    return doc, load_director(str(tmp_path))


def test_director_context_validates_against_its_schema(click_wav, tmp_path, stub_full_backends):
    _doc, director = _director(click_wav, tmp_path, None)
    with open(os.path.join(SCHEMA_DIR, "director-context.schema.json"), encoding="utf-8") as fh:
        schema = json.load(fh)
    errors = _errors(schema, director)
    assert not errors, "\n".join(
        f"{'/'.join(str(p) for p in e.path)} :: {e.message[:200]}" for e in errors[:10]
    )


def test_director_context_validates_without_backends(click_wav, tmp_path, stub_missing_backends):
    _doc, director = _director(click_wav, tmp_path, None)
    with open(os.path.join(SCHEMA_DIR, "director-context.schema.json"), encoding="utf-8") as fh:
        schema = json.load(fh)
    assert not _errors(schema, director)


def test_no_raw_note_or_onset_lists(click_wav, tmp_path, stub_full_backends):
    """The compression contract: full notes/onsets stay in music_analysis_v2.json."""
    _doc, director = _director(click_wav, tmp_path, None)
    assert "notes" not in director["melody_summary"]
    assert "onsets" not in director["stem_summary"]
    blob = json.dumps(director)
    assert '"pitchMidi"' not in blob, "per-note pitches leaked into the director context"
    assert len(director["important_events"]) <= 250


def test_important_events_exclude_plain_beats(click_wav, tmp_path, stub_missing_backends):
    doc, director = _director(click_wav, tmp_path, None)
    types = {e["type"] for e in director["important_events"]}
    assert "beat" not in types
    # Whatever is kept must exist in the full event list.
    full_types = {e["type"] for e in doc["events"]}
    assert types <= full_types


def test_references_are_internally_consistent(click_wav, tmp_path, stub_full_backends):
    _doc, director = _director(click_wav, tmp_path, None)
    section_ids = {s["section_id"] for s in director["sections"]}
    group_ids = {g["group_id"] for g in director["repeat_groups"]}

    for ph in director["phrases"]:
        assert ph["section_id"] in section_ids
    for g in director["repeat_groups"]:
        for occ in g["occurrences"]:
            assert occ["section_id"] in section_ids
    for c in director["repeat_comparisons"]:
        assert c["group_id"] in group_ids
    for s in director["sections"]:
        if s.get("repeat"):
            assert s["repeat"]["group_id"] in group_ids
            assert s["repeat"]["occurrence"] >= 1


def test_all_times_stay_inside_the_song(click_wav, tmp_path, stub_full_backends):
    _doc, director = _director(click_wav, tmp_path, None)
    duration = director["source"]["duration"]
    assert duration > 0

    def check(t, where):
        assert t is None or 0.0 <= t <= duration + 1e-6, f"{where}: {t} outside the song"

    for s in director["sections"]:
        check(s["start"], "section.start")
        check(s["end"], "section.end")
    for ph in director["phrases"]:
        check(ph["start"], "phrase.start")
        check(ph["end"], "phrase.end")
        for t in ph["important_event_times"]:
            check(t, "phrase.important_event_times")
    for e in director["important_events"]:
        check(e["time"], "important_event.time")
    for bar in director["grid"]["bars"]:
        check(bar["start"], "grid.bars.start")
        check(bar["end"], "grid.bars.end")


def test_bar_references_are_legal(click_wav, tmp_path, stub_full_backends):
    _doc, director = _director(click_wav, tmp_path, None)
    n_bars = director["global"]["bar_count"]
    assert len(director["grid"]["bars"]) == n_bars
    for ph in director["phrases"]:
        assert 1 <= ph["start_bar"] <= n_bars
        assert 1 <= ph["end_bar"] <= n_bars
    for e in director["important_events"]:
        assert e["bar"] is None or 1 <= e["bar"] <= n_bars
    assert len(director["intensity_curve"]) == n_bars
    for point in director["intensity_curve"]:
        assert 1 <= point["bar"] <= n_bars


def test_grid_matches_the_beat_analysis(click_wav, tmp_path, stub_missing_backends):
    """director_context bars must be the same constant grid the analysis uses."""
    doc, director = _director(click_wav, tmp_path, None)
    rhythm = doc["layers"]["rhythm"]
    assert director["grid"]["bpm"] == rhythm["bpm"]
    assert director["grid"]["bars"][0]["start"] == 0.0
    beat_len = rhythm["beatLengthSec"]
    bpb = rhythm["timeSignature"][0]
    for i, bar in enumerate(director["grid"]["bars"]):
        # fnum rounds published values to 6 dp, so allow a little rounding slack.
        assert abs(bar["start"] - i * bpb * beat_len) < 1e-4


def test_lyrics_block_is_schema_only(click_wav, tmp_path, stub_missing_backends):
    _doc, director = _director(click_wav, tmp_path, None)
    assert director["lyrics"] == {
        "available": False,
        "provider": None,
        "language": None,
        "words": [],
    }


def test_director_export_is_deterministic(click_wav, tmp_path, stub_full_backends):
    cache = str(tmp_path / "cache")
    run_v2(click_wav, str(tmp_path / "a"), mode="full", cache_dir=cache)
    run_v2(click_wav, str(tmp_path / "b"), mode="full", cache_dir=cache)

    def digest(d):
        with open(os.path.join(d, "director_context.json"), "rb") as fh:
            return hashlib.sha256(fh.read()).hexdigest()

    assert digest(str(tmp_path / "a")) == digest(str(tmp_path / "b")), (
        "director_context.json is not byte-deterministic"
    )


def test_cli_also_writes_the_v2_doc_and_legacy_projection(click_wav, tmp_path, stub_missing_backends):
    """Prompt section 18: one run leaves all three files behind."""
    run_v2(click_wav, str(tmp_path), mode="fast", cache_dir=str(tmp_path / "cache"))
    for name in (
        "music_analysis_v2.json",
        "music_analysis.json",       # the v1 projection, existing name kept
        "director_context.json",
    ):
        assert os.path.isfile(os.path.join(str(tmp_path), name)), f"{name} missing"


def test_director_output_path_is_overridable(click_wav, tmp_path, stub_missing_backends):
    import analyze_music_v2

    custom = os.path.join(str(tmp_path), "nested", "ctx.json")
    analyze_music_v2.analyze_v2(
        click_wav,
        os.path.join(str(tmp_path), "v2.json"),
        mode="fast",
        cache_dir=str(tmp_path / "cache"),
        director_output=custom,
        quiet=True,
    )
    assert os.path.isfile(custom)
    assert os.path.isfile(os.path.join(str(tmp_path), "director_context.json")) is False


def test_silence_produces_a_valid_empty_director_context(silent_wav, tmp_path, stub_missing_backends):
    doc, _legacy, _out = run_v2(
        silent_wav, str(tmp_path), mode="full", cache_dir=str(tmp_path / "cache")
    )
    director = load_director(str(tmp_path))
    assert director["global"]["bpm"] is None
    assert director["grid"]["bars"] == []
    assert director["phrases"] == []
    assert director["repeat_groups"] == []
    with open(os.path.join(SCHEMA_DIR, "director-context.schema.json"), encoding="utf-8") as fh:
        schema = json.load(fh)
    assert not _errors(schema, director)


def test_provenance_covers_the_high_level_blocks(click_wav, tmp_path, stub_missing_backends):
    _doc, director = _director(click_wav, tmp_path, None)
    for block in (
        "global", "grid", "sections", "phrases", "repeat_groups",
        "repeat_comparisons", "important_events", "melody_summary",
        "intensity_curve", "stem_summary", "lyrics",
    ):
        assert block in director["provenance"], f"provenance missing {block}"
        assert isinstance(director["provenance"][block], list)

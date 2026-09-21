"""Director Context V2 tests.

The V2 document is the *contract* the level-generation pipeline reads, so these
tests are about the guarantees a generator is allowed to rely on:

* nothing it is handed points outside the song (the hard duration rule);
* every bar range is unambiguous -- half-open, ordered, contiguous;
* a phrase belongs to exactly one section, and stays inside it;
* anchors are in range, known-typed, deduplicated and inside budget;
* repeat groups carry a deterministic gameplay-relation hint;
* the whole document matches the published schema and is byte-deterministic.

The end-to-end tests run the real analyzer over a synthetic click track with the
ML backends stubbed, so they exercise the real construction path in seconds.
The synthetic fixtures are also the *only* way to test the clamp honestly: a
clean song has nothing to drop, so the drop paths are driven with injected
out-of-range data (see ``test_out_of_range_*``).
"""

from __future__ import annotations

import hashlib
import json
import os

import pytest

from conftest import load_director_v2, project_root, run_v2

from beatbound_audio import director_context_v2 as dcv2
from beatbound_audio.director_context_v2 import (
    ANCHOR_TYPES,
    DIRECTOR_V2_SCHEMA_VERSION,
    validate_director_context_v2,
)

pytestmark = pytest.mark.filterwarnings("ignore")


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _schema() -> dict:
    path = os.path.join(project_root(), "editor", "schemas", "director-context-v2.schema.json")
    with open(path, "r", encoding="utf-8") as fh:
        return json.load(fh)


def _schema_errors(doc: dict):
    jsonschema = pytest.importorskip("jsonschema")
    from jsonschema import Draft202012Validator

    schema = _schema()
    Draft202012Validator.check_schema(schema)
    return sorted(
        Draft202012Validator(schema).iter_errors(doc),
        key=lambda e: [str(p) for p in e.path],
    )


def _all_times(doc: dict):
    """Every timestamped value in the document, with a label for failures."""
    for s in doc["sections"]:
        yield "section.start_sec", s["start_sec"]
        yield "section.end_sec", s["end_sec"]
    for p in doc["phrases"]:
        yield "phrase.start_sec", p["start_sec"]
        yield "phrase.end_sec", p["end_sec"]
        for i, t in enumerate(p["important_event_times"]):
            yield f"phrase.important_event_times[{i}]", t
        for i, a in enumerate(p["anchors"]):
            yield f"phrase.anchors[{i}].time_sec", a["time_sec"]
    for i, a in enumerate(doc["anchors"]):
        yield f"anchors[{i}].time_sec", a["time_sec"]
    for i, r in enumerate(doc["bar_curve"]):
        yield f"bar_curve[{i}].start_sec", r["start_sec"]
    for i, g in enumerate(doc["repeat_groups"]):
        for j, o in enumerate(g["occurrences"]):
            yield f"repeat_groups[{i}].occurrences[{j}].start_sec", o["start_sec"]
            yield f"repeat_groups[{i}].occurrences[{j}].end_sec", o["end_sec"]
    for i, pk in enumerate(doc["melody"]["peaks"]):
        yield f"melody.peaks[{i}].time_sec", pk["time_sec"]


@pytest.fixture(scope="module")
def v2_doc(tmp_path_factory, request):
    """One full-mode run over the synthetic click track, shared by the module."""
    audio = str(tmp_path_factory.mktemp("audio") / "click.wav")

    import numpy as np

    from conftest import _click_track, _write_wav

    _write_wav(audio, _click_track(24.0))

    # Reuse the session-scoped backend stubs by hand: a module-scoped fixture
    # cannot take function-scoped monkeypatch, so patch explicitly.
    from beatbound_audio import melody_analyzer, stem_separator
    from conftest import _fake_note_matrix, _fake_stems

    saved = (
        stem_separator.demucs_available,
        stem_separator._separate_with_python_api,
        melody_analyzer.backend_available,
        melody_analyzer._run_backend,
    )

    def fake_separate(audio_path, out_dir, *, threads=4, sr=22050):
        import librosa

        _y, _sr = librosa.load(audio_path, sr=sr, mono=True)
        return _fake_stems(len(_y) / float(sr), sr=sr)

    notes = [(0.5 + i * 0.45, 0.5 + i * 0.45 + 0.25, 60 + (i % 7), 0.7, 0.0) for i in range(20)]
    stem_separator.demucs_available = lambda: (True, "stub")
    stem_separator._separate_with_python_api = fake_separate
    melody_analyzer.backend_available = lambda: (True, "stub")
    melody_analyzer._run_backend = lambda path: ({"note": _fake_note_matrix()}, notes)

    out_dir = str(tmp_path_factory.mktemp("v2out"))
    try:
        run_v2(audio, out_dir, cache_dir=str(tmp_path_factory.mktemp("cache")))
        yield load_director_v2(out_dir)
    finally:
        (
            stem_separator.demucs_available,
            stem_separator._separate_with_python_api,
            melody_analyzer.backend_available,
            melody_analyzer._run_backend,
        ) = saved


@pytest.fixture(scope="module")
def synthetic_doc():
    """A full V2 document built from a hand-written analysis of a 3-section song.

    The structure detector is deliberately conservative, so a synthetic click
    track yields one section -- which would make every multi-section assertion
    vacuous. This fixture supplies the analysis directly: three contiguous
    sections published with V1's *overlapping inclusive* bar bounds, a phrase
    that straddles a section boundary, a repeat group, and timestamped data that
    runs past the end of the audio. That combination is exactly what the builder
    has to repair, and it is not reproducible from any synthetic song.
    """
    import numpy as np

    from beatbound_audio.results import (
        AudioContext,
        DownbeatResult,
        EnergyResult,
        MelodyResult,
        PhraseResult,
        RepetitionResult,
        RhythmResult,
        StemFeatureResult,
        StructureResult,
        TonalResult,
    )

    bpm = 120.0
    beat_len = 60.0 / bpm          # 0.5 s
    bar_len = beat_len * 4         # 2.0 s
    n_bars = 40
    duration = 80.0
    hop = 0.25
    times = np.arange(0.0, duration, hop)

    # A rising-then-falling energy curve, so builds/releases are real.
    phase = np.linspace(0.0, np.pi, times.size)
    rms = 0.15 + 0.8 * np.sin(phase) ** 2
    rms_smooth = rms.copy()

    def curve(scale, offset=0.0):
        return np.clip(scale * rms + offset, 0.0, 1.0)

    stems = StemFeatureResult(
        available=True,
        backend="test-stub",
        times=times,
        curves={
            "drumsActivity": curve(1.0),
            "drumsDensity": curve(0.8),
            "bassActivity": curve(0.9, -0.1),
            "vocalsActivity": curve(0.7, 0.1),
            "otherActivity": curve(0.6),
        },
        onsets={
            "drums": [
                {"time": float(t), "strength": 0.8}
                for t in np.arange(0.0, duration, bar_len / 2.0)
            ]
        },
        activity={"drums": 0.6, "bass": 0.5, "vocals": 0.4, "other": 0.3},
        drums={"available": True, "pieces": {"kickLike": 0.5, "snareLike": 0.3, "highPercussionLike": 0.2}},
        bass={"available": True},
        vocals={"available": True},
        other={"available": True},
    )

    ctx = AudioContext(
        path="synthetic.wav",
        file="synthetic.wav",
        song_id="synthetic",
        title="synthetic",
        y=np.zeros(0),
        sr=22050,
        duration=duration,
        channels=1,
        native_sr=22050,
        source_hash="0123456789abcdef",
        audio_hash="0" * 64,
        silent=False,
    )

    rhythm = RhythmResult(
        bpm=bpm,
        tempo_confidence=0.92,
        time_signature=(4, 4),
        meter_confidence=0.9,
        beat_len=beat_len,
        n_beats=n_bars * 4,
        n_bars=n_bars,
        beats=[],
        bar_bounds=np.arange(n_bars + 1) * bar_len,
        hop_times=times,
        onset_env=np.zeros(times.size),
        onset_env_norm=np.zeros(times.size),
        onsets=[],
        onset_times=np.arange(0.0, duration, beat_len),
        onset_strengths=np.full(int(duration / beat_len), 0.7),
        silent=False,
    )

    energy = EnergyResult(
        rms=rms,
        rms_norm=rms,
        rms_smooth=rms_smooth,
        times=times,
        timeline=[],
        overall_energy=float(np.mean(rms)),
        dynamic_range=float(np.max(rms) - np.min(rms)),
        loudness_db=np.zeros(times.size),
        loudness_range_db=6.0,
    )

    tonal = TonalResult(
        available=True,
        chroma=np.zeros((12, times.size)),
        chroma_times=times,
        chroma_mean=[1.0 / 12] * 12,
        key="C",
        scale="major",
        key_confidence=0.8,
        centroid_hz=np.zeros(times.size),
        centroid_times=times,
        centroid_mean_hz=1200.0,
        brightness=0.5,
        contrast_mean=[0.0] * 6,
        band_balance={"low": 0.4, "mid": 0.4, "high": 0.2},
        mfcc=np.zeros((13, times.size)),
        mfcc_times=times,
        warnings=[],
    )

    # V1's convention: inclusive bounds that overlap by one bar at every seam.
    structure = StructureResult(
        sections=[
            {"id": "section_01", "start": 0.0, "end": 32.0, "startBar": 1, "endBar": 17},
            {"id": "section_02", "start": 32.0, "end": 64.0, "startBar": 17, "endBar": 33},
            {"id": "section_03", "start": 64.0, "end": 80.0, "startBar": 33, "endBar": 40},
        ],
        boundaries=[32.0, 64.0],
        novelty=np.zeros(times.size),
        novelty_times=times,
        method="test",
    )

    # ``phrase_006`` deliberately straddles the section_01/section_02 seam.
    phrasing = PhraseResult(
        phrases=[
            _phrase("phrase_001", "section_01", 0.0, 16.0, 0.80, "opening", 0.20, "stable"),
            _phrase("phrase_002", "section_01", 16.0, 32.0, 0.70, "peak", 0.55, "rising"),
            _phrase("phrase_003", "section_02", 32.0, 48.0, 0.75, "opening", 0.45, "falling"),
            _phrase("phrase_004", "section_02", 48.0, 64.0, 0.72, "peak", 0.75, "rising"),
            _phrase("phrase_005", "section_03", 64.0, 80.0, 0.78, "development", 0.30, "falling"),
            # starts at 30.0 s (bar 16) and ends at 36.0 s (bar 19): 2 bars of it
            # belong to section_02, so it must be clipped into section_01.
            _phrase("phrase_006", "section_01", 30.0, 36.0, 0.60, "development", 0.40, "stable"),
        ],
        method="test",
    )

    melody = MelodyResult(
        available=True,
        backend="test-stub",
        input_source="other",
        confidence=0.7,
        # Two notes run past the end of the song -- the regression this guards.
        notes=[
            {"start": 1.0, "end": 1.5, "pitchMidi": 60, "confidence": 0.8},
            {"start": 2.0, "end": 2.5, "pitchMidi": 67, "confidence": 0.8},
            {"start": 40.0, "end": 40.5, "pitchMidi": 72, "confidence": 0.8},
            {"start": 79.5, "end": 80.0, "pitchMidi": 64, "confidence": 0.8},
            {"start": 96.0, "end": 96.5, "pitchMidi": 79, "confidence": 0.9},   # out
            {"start": 158.0, "end": 158.5, "pitchMidi": 81, "confidence": 0.9}, # out
        ],
        phrases=[{"start": 0.0, "end": 8.0, "direction": "rising"}],
        pitch_times=times,
        pitch_midi=np.where((times % 2.0) < 1.0, 60.0 + (times % 12), np.nan),
        pitch_norm=np.where((times % 2.0) < 1.0, 0.5, np.nan),
        note_density=4.0,
        pitch_range_semitones=21,
        warnings=[],
    )

    downbeat = DownbeatResult(
        offset_beats=0, confidence=0.75, downbeats=[], method="test", warnings=[]
    )

    repetition = RepetitionResult(
        groups=[
            {
                "group_id": "repeat_001",
                "confidence": 0.91,
                "semantic_role": None,
                "semantic_role_confidence": None,
                "occurrences": [
                    {"section_id": "section_01", "occurrence_index": 1,
                     "start": 0.0, "end": 32.0, "similarity_to_group": 0.91},
                    {"section_id": "section_03", "occurrence_index": 2,
                     "start": 64.0, "end": 80.0, "similarity_to_group": 0.91},
                ],
            }
        ],
        comparisons=[
            {
                "group_id": "repeat_001", "occurrence": 2, "compared_to_occurrence": 1,
                "base_section_id": "section_01", "section_id": "section_03",
                "energy_delta": -0.22, "drum_activity_delta": -0.18,
                "drum_density_delta": -0.10, "bass_activity_delta": -0.20,
                "vocal_activity_delta": -0.15, "other_activity_delta": -0.05,
                "onset_density_delta": -0.12, "brightness_delta": -0.03,
                "melody_density_delta": -0.04, "arrangement_intensity_delta": -0.19,
            }
        ],
        section_stats={
            "section_01": {"energy": 0.7, "drum_activity": 0.6, "bass_activity": 0.5,
                           "vocal_activity": 0.4, "other_activity": 0.3, "onset_density": 0.6,
                           "arrangement_intensity": 0.62},
            "section_02": {"energy": 0.5, "drum_activity": 0.5, "bass_activity": 0.4,
                           "vocal_activity": 0.35, "other_activity": 0.3, "onset_density": 0.5,
                           "arrangement_intensity": 0.50},
            "section_03": {"energy": 0.48, "drum_activity": 0.42, "bass_activity": 0.30,
                           "vocal_activity": 0.25, "other_activity": 0.25, "onset_density": 0.48,
                           "arrangement_intensity": 0.43},
        },
        method="test",
        threshold=0.86,
        warnings=[],
    )

    events = [
        {"type": "strong_onset", "time": 1.0, "strength": 0.9, "source": "rhythm"},
        {"type": "strong_onset", "time": 1.2, "strength": 0.5, "source": "rhythm"},  # dedup
        {"type": "strong_beat", "time": 2.0, "strength": 0.8, "source": "rhythm"},
        {"type": "energy_peak", "time": 40.0, "strength": 0.95, "source": "energy"},
        {"type": "energy_drop", "time": 64.0, "strength": 0.7, "source": "energy"},
        {"type": "vocal_entry", "time": 8.0, "strength": 0.6, "source": "stems"},
        {"type": "vocal_exit", "time": 60.0, "strength": 0.6, "source": "stems"},
        {"type": "beat", "time": 3.0, "strength": 0.4, "source": "rhythm"},          # excluded
        {"type": "strong_onset", "time": 96.0, "strength": 0.9, "source": "rhythm"},  # out of range
        {"type": "energy_peak", "time": 158.0, "strength": 0.9, "source": "energy"},  # out of range
        {"type": "vocal_entry", "time": -1.0, "strength": 0.5, "source": "stems"},    # out of range
    ]

    global_summary = {
        "bpm": bpm,
        "tempoConfidence": 0.92,
        "meterConfidence": 0.9,
        "key": "C",
        "scale": "major",
        "keyConfidence": 0.8,
        "overallEnergy": 0.55,
        "dynamicRange": 0.8,
        "brightness": 0.5,
        "rhythmicDensity": 0.6,
        "melodicDensity": 0.4,
        "silent": False,
    }

    return dcv2.build_director_context_v2(
        ctx=ctx,
        rhythm=rhythm,
        energy=energy,
        tonal=tonal,
        structure=structure,
        melody=melody,
        stems=stems,
        downbeat=downbeat,
        repetition=repetition,
        phrasing=phrasing,
        events=events,
        global_summary=global_summary,
    )


def _phrase(pid, section_id, start, end, confidence, label, energy_mean, trend):
    return {
        "phrase_id": pid,
        "section_id": section_id,
        "start": start,
        "end": end,
        "confidence": confidence,
        "position_label": label,
        "energy_mean": energy_mean,
        "energy_trend": trend,
        "dominant_layers": ["drums", "bass"],
        "melody_contour": "rising",
        "important_event_times": [],
    }


# ---------------------------------------------------------------------------
# Contract shape
# ---------------------------------------------------------------------------

def test_schema_version_is_v2(v2_doc):
    assert v2_doc["schema_version"] == DIRECTOR_V2_SCHEMA_VERSION


def test_document_matches_published_schema(v2_doc):
    errors = _schema_errors(v2_doc)
    assert not errors, "\n".join(f"{'/'.join(str(p) for p in e.path)}: {e.message}" for e in errors)


def test_structural_validator_agrees_with_the_schema(v2_doc):
    """The dependency-free validator must not be more permissive than the schema.

    ``diagnostics.output_schema_valid`` is written by the validator, so if the
    two ever disagree the artifact lies about itself.
    """
    assert validate_director_context_v2(v2_doc) == []
    assert v2_doc["diagnostics"]["output_schema_valid"] is True
    assert not _schema_errors(v2_doc)


def test_document_is_deterministic(tmp_path, v2_doc):
    """Same audio, same settings -> byte-identical JSON."""
    path = os.path.join(str(tmp_path), "director_context_v2.json")
    with open(path, "w", encoding="utf-8") as fh:
        json.dump(v2_doc, fh, indent=2, ensure_ascii=False)
    first = hashlib.sha256(open(path, "rb").read()).hexdigest()

    with open(path, "w", encoding="utf-8") as fh:
        json.dump(v2_doc, fh, indent=2, ensure_ascii=False)
    second = hashlib.sha256(open(path, "rb").read()).hexdigest()
    assert first == second


def test_no_wall_clock_in_the_document(v2_doc):
    """A generated_at field would break byte-determinism; there must not be one."""
    blob = json.dumps(v2_doc)
    for forbidden in ("generated_at", "timestamp", "createdAt", "runAt"):
        assert forbidden not in blob


# ---------------------------------------------------------------------------
# The hard duration rule
# ---------------------------------------------------------------------------

def test_all_times_stay_inside_the_song(v2_doc):
    duration = v2_doc["source"]["duration_sec"]
    for label, value in _all_times(v2_doc):
        assert 0.0 <= value <= duration, f"{label} = {value} is outside 0..{duration}"


def test_bar_references_are_legal(v2_doc):
    n_bars = v2_doc["timing"]["bar_count"]
    for s in v2_doc["sections"]:
        assert 1 <= s["start_bar"] <= n_bars
        assert s["start_bar"] < s["end_bar_exclusive"] <= n_bars + 1
    for p in v2_doc["phrases"]:
        assert 1 <= p["start_bar"] <= n_bars
        assert p["start_bar"] < p["end_bar_exclusive"] <= n_bars + 1
    for a in v2_doc["anchors"]:
        assert 1 <= a["bar"] <= n_bars


def test_clean_analysis_drops_nothing(v2_doc):
    """A song whose layers are all in range must lose nothing to the clamp."""
    diag = v2_doc["diagnostics"]
    assert diag["dropped_out_of_range_events"] == 0
    assert diag["dropped_out_of_range_notes"] == 0
    assert diag["dropped_out_of_range_phrase_refs"] == 0
    assert diag["dropped_out_of_range_sections"] == 0
    assert diag["dropped_out_of_range_phrases"] == 0


def test_out_of_range_events_are_dropped_not_remapped():
    """The regression that motivated V2.

    A detector that reports events past the end of the audio (the 2x-duration
    stem bug did exactly this) must have them *dropped and counted*. V1 mapped
    every one of them onto the final bar, which is how a director ends up
    believing the last bar holds 83 accents.
    """
    guard = dcv2._DurationGuard(100.0)
    assert guard.keep(0.0, "event") == 0.0
    assert guard.keep(100.0, "event") == 100.0
    assert guard.keep(100.001, "event") is None
    assert guard.keep(290.667392, "event") is None
    assert guard.keep(-1.0, "event") is None
    assert guard.keep(float("nan"), "event") is None
    assert guard.keep(None, "event") is None
    assert guard.dropped["event"] == 4


def test_bar_of_time_never_exceeds_the_last_bar():
    """The V1 bug, isolated: a late time must not land on the final bar."""
    import numpy as np

    from beatbound_audio.results import RhythmResult

    beat_len = 0.48761
    n_bars = 75
    rhythm = RhythmResult(
        bpm=123.0,
        tempo_confidence=0.9,
        time_signature=(4, 4),
        meter_confidence=0.9,
        beat_len=beat_len,
        n_beats=n_bars * 4,
        n_bars=n_bars,
        beats=[],
        bar_bounds=np.arange(n_bars + 1) * beat_len * 4,
        hop_times=np.zeros(0),
        onset_env=np.zeros(0),
        onset_env_norm=np.zeros(0),
        onsets=[],
        onset_times=np.zeros(0),
        onset_strengths=np.zeros(0),
        silent=False,
    )
    grid = dcv2._BarGrid(rhythm, 147.133741)

    assert grid.bar_of_time(147.133741) == n_bars
    assert grid.bar_of_time(1e9) == n_bars          # clamped, not overflowed
    assert grid.bar_of_time(-5.0) == 1
    assert grid.bar_of_time(0.0) == 1
    assert grid.end_bar_exclusive_of_time(1e9) == n_bars + 1
    assert grid.end_bar_exclusive_of_time(0.0) == 1


# ---------------------------------------------------------------------------
# Bar-range normalization
# ---------------------------------------------------------------------------

def test_sections_are_ordered_contiguous_and_non_overlapping(synthetic_doc):
    sections = synthetic_doc["sections"]
    assert len(sections) >= 3
    assert sections[0]["start_bar"] == 1
    assert sections[-1]["end_bar_exclusive"] == synthetic_doc["timing"]["bar_count"] + 1
    for prev, cur in zip(sections, sections[1:]):
        assert prev["end_bar_exclusive"] == cur["start_bar"], (
            "sections must tile the song without gaps or overlaps -- "
            f"{prev['section_id']} ends at {prev['end_bar_exclusive']}, "
            f"{cur['section_id']} starts at {cur['start_bar']}"
        )


def test_phrases_belong_to_exactly_one_section_and_stay_inside_it(synthetic_doc):
    by_id = {s["section_id"]: s for s in synthetic_doc["sections"]}
    assert synthetic_doc["phrases"]
    for p in synthetic_doc["phrases"]:
        owner = by_id[p["section_id"]]
        assert p["start_bar"] >= owner["start_bar"]
        assert p["end_bar_exclusive"] <= owner["end_bar_exclusive"]


def test_phrase_bar_counts_match_their_ranges(synthetic_doc):
    for p in synthetic_doc["phrases"]:
        assert p["bar_count"] == p["end_bar_exclusive"] - p["start_bar"]


def test_bar_curve_has_one_row_per_bar_in_order(synthetic_doc):
    curve = synthetic_doc["bar_curve"]
    assert len(curve) == synthetic_doc["timing"]["bar_count"]
    assert [r["bar"] for r in curve] == list(range(1, len(curve) + 1))
    assert len(synthetic_doc["timing"]["bars"]) == len(curve)


def test_sections_and_phrases_agree_with_the_bar_grid(synthetic_doc):
    """A section's start_sec must be its start bar's grid time."""
    starts = {b["bar"]: b["start"] for b in synthetic_doc["timing"]["bars"]}
    for s in synthetic_doc["sections"]:
        assert abs(s["start_sec"] - starts[s["start_bar"]]) < 1e-6
    for p in synthetic_doc["phrases"]:
        assert abs(p["start_sec"] - starts[p["start_bar"]]) < 1e-6


def test_normalization_repairs_overlapping_inclusive_bounds():
    """V1 published section_01 end_bar 17 / section_02 start_bar 17.

    The V2 builder derives bars from the contiguous section *times*, so the
    overlap cannot survive.
    """
    import numpy as np

    from beatbound_audio.results import RhythmResult, StructureResult

    beat_len = 0.5
    n_bars = 40
    rhythm = RhythmResult(
        bpm=120.0,
        tempo_confidence=0.9,
        time_signature=(4, 4),
        meter_confidence=0.9,
        beat_len=beat_len,
        n_beats=n_bars * 4,
        n_bars=n_bars,
        beats=[],
        bar_bounds=np.arange(n_bars + 1) * beat_len * 4,
        hop_times=np.zeros(0),
        onset_env=np.zeros(0),
        onset_env_norm=np.zeros(0),
        onsets=[],
        onset_times=np.zeros(0),
        onset_strengths=np.zeros(0),
        silent=False,
    )
    # Overlapping inclusive bounds, exactly as V1 published them.
    structure = StructureResult(
        sections=[
            {"id": "section_01", "start": 0.0, "end": 34.0, "startBar": 1, "endBar": 17},
            {"id": "section_02", "start": 34.0, "end": 80.0, "startBar": 17, "endBar": 40},
        ],
        boundaries=[34.0],
        novelty=None,
        novelty_times=None,
        method="test",
    )
    grid = dcv2._BarGrid(rhythm, 80.0)
    guard = dcv2._DurationGuard(80.0)
    sections, _adjusted = dcv2._normalize_sections(structure, grid, guard)

    assert [s["start_bar"] for s in sections] == [1, 18]
    assert [s["end_bar_exclusive"] for s in sections] == [18, 41]
    assert sections[0]["end_bar_exclusive"] == sections[1]["start_bar"]
    assert sections[0]["start_bar"] == 1
    assert sections[-1]["end_bar_exclusive"] == n_bars + 1


def test_normalization_covers_a_gap_left_by_the_detector():
    """Whatever the detector leaves uncovered belongs to a section, not to a hole."""
    import numpy as np

    from beatbound_audio.results import RhythmResult, StructureResult

    beat_len = 0.5
    n_bars = 40
    rhythm = RhythmResult(
        bpm=120.0,
        tempo_confidence=0.9,
        time_signature=(4, 4),
        meter_confidence=0.9,
        beat_len=beat_len,
        n_beats=n_bars * 4,
        n_bars=n_bars,
        beats=[],
        bar_bounds=np.arange(n_bars + 1) * beat_len * 4,
        hop_times=np.zeros(0),
        onset_env=np.zeros(0),
        onset_env_norm=np.zeros(0),
        onsets=[],
        onset_times=np.zeros(0),
        onset_strengths=np.zeros(0),
        silent=False,
    )
    structure = StructureResult(
        sections=[
            {"id": "section_01", "start": 8.0, "end": 40.0, "startBar": 5, "endBar": 20},
            {"id": "section_02", "start": 48.0, "end": 80.0, "startBar": 25, "endBar": 40},
        ],
        boundaries=[8.0, 40.0, 48.0],
        novelty=None,
        novelty_times=None,
        method="test",
    )
    grid = dcv2._BarGrid(rhythm, 80.0)
    guard = dcv2._DurationGuard(80.0)
    sections, _adjusted = dcv2._normalize_sections(structure, grid, guard)

    assert sections[0]["start_bar"] == 1          # head extended
    assert sections[-1]["end_bar_exclusive"] == n_bars + 1  # tail extended
    for prev, cur in zip(sections, sections[1:]):
        assert prev["end_bar_exclusive"] == cur["start_bar"]


# ---------------------------------------------------------------------------
# Anchors
# ---------------------------------------------------------------------------

def test_anchors_use_the_documented_vocabulary(v2_doc):
    for a in v2_doc["anchors"]:
        assert a["type"] in ANCHOR_TYPES


def test_anchors_are_sorted_and_deduplicated(v2_doc):
    anchors = v2_doc["anchors"]
    times = [a["time_sec"] for a in anchors]
    assert times == sorted(times)
    # No two anchors of the same type may sit closer than a quarter beat apart.
    beat_len = 60.0 / v2_doc["timing"]["bpm"]
    per_type: dict = {}
    for a in anchors:
        per_type.setdefault(a["type"], []).append(a["time_sec"])
    for atype, ts in per_type.items():
        if atype.endswith("boundary"):
            continue
        for x, y in zip(ts, ts[1:]):
            assert y - x >= 0.2 * beat_len, f"{atype} anchors {x} and {y} are too close"


def test_anchors_stay_inside_the_budget(v2_doc):
    from beatbound_audio import config

    assert len(v2_doc["anchors"]) <= config.DIRECTOR_V2_ANCHOR_BUDGET


def test_structural_boundaries_are_not_double_counted(v2_doc):
    """Derived boundaries are authoritative; event-sourced duplicates are not."""
    section_starts = {s["start_bar"] for s in v2_doc["sections"]}
    derived = [
        a for a in v2_doc["anchors"]
        if a["type"] == "section_boundary" and a["source"] == "structure"
    ]
    assert {a["bar"] for a in derived} == section_starts


def test_phrase_anchors_are_in_range_and_inside_the_phrase(v2_doc):
    for p in v2_doc["phrases"]:
        for a in p["anchors"]:
            assert p["start_bar"] <= a["bar"] <= p["end_bar_exclusive"] - 1
            assert a["type"] in ANCHOR_TYPES


# ---------------------------------------------------------------------------
# Derived design features
# ---------------------------------------------------------------------------

def test_design_features_are_present_and_typed(v2_doc):
    for p in v2_doc["phrases"]:
        f = p["design_features"]
        for key in (
            "is_transition_candidate",
            "is_climax_candidate",
            "is_recovery_candidate",
            "motif_recurrence_candidate",
        ):
            assert isinstance(f[key], bool)
        if f["relative_intensity"] is not None:
            assert 0.0 <= f["relative_intensity"] <= 1.0
        if f["recommended_density"] is not None:
            assert 0.0 <= f["recommended_density"] <= 1.0


def test_bar_curve_derived_flags_are_consistent(v2_doc):
    curve = v2_doc["bar_curve"]
    assert curve[0]["derived"]["change_from_previous"] is None
    for prev, cur in zip(curve, curve[1:]):
        a, b = prev["combined_intensity"], cur["combined_intensity"]
        change = cur["derived"]["change_from_previous"]
        if a is None or b is None:
            assert change is None
        else:
            assert abs(change - (b - a)) < 1e-6
        assert isinstance(cur["derived"]["is_build"], bool)
        assert isinstance(cur["derived"]["is_release"], bool)
        assert not (cur["derived"]["is_build"] and cur["derived"]["is_release"])


# ---------------------------------------------------------------------------
# Repeat structure
# ---------------------------------------------------------------------------

def test_repeat_groups_reference_real_sections_and_are_ordered(v2_doc):
    ids = {s["section_id"] for s in v2_doc["sections"]}
    for g in v2_doc["repeat_groups"]:
        assert len(g["occurrences"]) >= 2
        for occ in g["occurrences"]:
            assert occ["section_id"] in ids


def test_repeat_relation_is_deterministic_and_documented(v2_doc):
    allowed = {
        "statement",
        "reprise_equivalent",
        "reprise_with_escalation",
        "reprise_with_reduction",
    }
    for g in v2_doc["repeat_groups"]:
        assert g["recommended_gameplay_relation"] in allowed
        delta = g["variation_profile"]["arrangement_intensity_delta"]
        expected = dcv2._recommended_relation(delta, len(g["occurrences"]))
        assert g["recommended_gameplay_relation"] == expected


def test_section_repeat_link_agrees_with_the_repeat_groups(v2_doc):
    index = {}
    for g in v2_doc["repeat_groups"]:
        for occ in g["occurrences"]:
            index[occ["section_id"]] = g["repeat_group_id"]
    for s in v2_doc["sections"]:
        link = s["repeat"]
        if s["section_id"] in index:
            assert link is not None
            assert link["group_id"] == index[s["section_id"]]
        else:
            assert link is None


# ---------------------------------------------------------------------------
# Reliability and diagnostics
# ---------------------------------------------------------------------------

def test_reliability_tiers_are_documented_values(v2_doc):
    rel = v2_doc["reliability"]
    for key in ("tempo", "meter", "bar_phase", "structure", "melody", "stem_separation"):
        assert rel[key] in ("high", "medium", "low", "unknown")
    assert isinstance(rel["warnings"], list)


def test_unknown_is_distinct_from_low(v2_doc):
    """An absent signal reports 'unknown'; a weak one reports 'low'."""
    assert dcv2._tier(None, "tempo") == "unknown"
    assert dcv2._tier(0.1, "tempo") == "low"
    assert dcv2._tier(0.5, "tempo") == "medium"
    assert dcv2._tier(0.9, "tempo") == "high"


def test_diagnostics_counters_are_present_and_integral(v2_doc):
    diag = v2_doc["diagnostics"]
    for key in (
        "dropped_out_of_range_events",
        "dropped_out_of_range_notes",
        "dropped_out_of_range_phrase_refs",
        "dropped_out_of_range_sections",
        "dropped_out_of_range_phrases",
        "deduplicated_anchors",
        "sections_range_adjusted",
        "phrases_clipped_to_section",
        "timeline_window_count",
    ):
        assert isinstance(diag[key], int) and diag[key] >= 0, key
    assert isinstance(diag["input_schema_valid"], bool)
    assert isinstance(diag["output_schema_valid"], bool)


def test_sync_checkpoints_are_in_range_and_unique(v2_doc):
    bars = [c["bar"] for c in v2_doc["sync_checkpoints"]]
    assert bars == sorted(bars)
    assert len(bars) == len(set(bars))
    n_bars = v2_doc["timing"]["bar_count"]
    assert all(1 <= b <= n_bars for b in bars)
    assert 1 in bars


# ---------------------------------------------------------------------------
# Degenerate inputs
# ---------------------------------------------------------------------------

def test_silence_degrades_without_inventing_structure(tmp_path, stub_missing_backends):
    from conftest import _write_wav
    import numpy as np

    audio = os.path.join(str(tmp_path), "silent.wav")
    _write_wav(audio, np.zeros(int(5.0 * 22050)))
    out_dir = os.path.join(str(tmp_path), "out")
    run_v2(audio, out_dir, cache_dir=os.path.join(str(tmp_path), "cache"))
    doc = load_director_v2(out_dir)

    assert validate_director_context_v2(doc) == []
    # Nothing may be claimed that the audio cannot support.
    assert doc["timing"]["bpm"] is None or doc["timing"]["bpm"] > 0
    for label, value in _all_times(doc):
        assert 0.0 <= value <= doc["source"]["duration_sec"], label


def test_very_short_audio_does_not_crash(tmp_path, stub_missing_backends):
    from conftest import _write_wav
    import numpy as np

    audio = os.path.join(str(tmp_path), "tiny.wav")
    _write_wav(audio, np.zeros(int(0.02 * 22050)))
    out_dir = os.path.join(str(tmp_path), "out")
    run_v2(audio, out_dir, cache_dir=os.path.join(str(tmp_path), "cache"))
    doc = load_director_v2(out_dir)

    assert validate_director_context_v2(doc) == []
    assert doc["sections"] == [] or doc["sections"][0]["start_bar"] == 1


def test_fast_mode_without_stems_or_melody_still_produces_a_valid_document(
    tmp_path, stub_missing_backends
):
    from conftest import _click_track, _write_wav

    audio = os.path.join(str(tmp_path), "click.wav")
    _write_wav(audio, _click_track(24.0))
    out_dir = os.path.join(str(tmp_path), "out")
    run_v2(
        audio,
        out_dir,
        mode="fast",
        use_stems=False,
        use_melody=False,
        cache_dir=os.path.join(str(tmp_path), "cache"),
    )
    doc = load_director_v2(out_dir)

    assert not _schema_errors(doc)
    assert doc["melody"]["available"] is False
    assert doc["melody"]["peaks"] == []
    # Every melody-derived anchor type must be absent rather than zero-valued.
    types = {a["type"] for a in doc["anchors"]}
    assert not types & {"melody_rise", "melody_fall", "melody_peak", "large_pitch_jump"}


# ---------------------------------------------------------------------------
# Multi-section synthetic analysis -- the paths a clean song cannot reach
# ---------------------------------------------------------------------------

def test_synthetic_document_is_valid(synthetic_doc):
    assert validate_director_context_v2(synthetic_doc) == []
    assert not _schema_errors(synthetic_doc)


def test_v1_style_overlapping_bounds_are_repaired(synthetic_doc):
    """V1 published section_01 endBar 17 and section_02 startBar 17.

    The builder must publish a tiling instead: [1,17) [17,33) [33,41).
    """
    sections = synthetic_doc["sections"]
    assert [s["start_bar"] for s in sections] == [1, 17, 33]
    assert [s["end_bar_exclusive"] for s in sections] == [17, 33, 41]
    for prev, cur in zip(sections, sections[1:]):
        assert prev["end_bar_exclusive"] == cur["start_bar"]
    assert sections[-1]["end_bar_exclusive"] == synthetic_doc["timing"]["bar_count"] + 1


def test_phrase_straddling_a_section_seam_is_clipped(synthetic_doc):
    """phrase_006 runs 30.0-36.0 s (bars 16-19) but belongs to section_01."""
    phrases = {p["phrase_id"]: p for p in synthetic_doc["phrases"]}
    p = phrases["phrase_006"]
    assert p["section_id"] == "section_01"
    assert p["start_bar"] == 16
    assert p["end_bar_exclusive"] == 17, "the phrase must stop at its section's edge"
    assert p["bar_count"] == 1
    assert synthetic_doc["diagnostics"]["phrases_clipped_to_section"] >= 1


def test_out_of_range_events_are_dropped_and_counted_end_to_end(synthetic_doc):
    """The headline regression: late events must vanish, not land on the last bar.

    The fixture feeds one event at 96 s, one at 158 s and one at -1 s into an
    80 s song. All three must be absent from the anchors and reported in
    ``diagnostics`` -- and the final bar must not be the place they went.
    """
    diag = synthetic_doc["diagnostics"]
    assert diag["dropped_out_of_range_events"] == 3

    duration = synthetic_doc["source"]["duration_sec"]
    for a in synthetic_doc["anchors"]:
        assert a["time_sec"] <= duration

    last_bar = synthetic_doc["timing"]["bar_count"]
    last_bar_anchors = [a for a in synthetic_doc["anchors"] if a["bar"] == last_bar]
    # The song's real content is what populates the last bar -- not the junk.
    assert len(last_bar_anchors) < len(synthetic_doc["anchors"])


def test_out_of_range_melody_notes_are_dropped_and_counted(synthetic_doc):
    """Two of the six fixture notes run past the 80 s song."""
    assert synthetic_doc["diagnostics"]["dropped_out_of_range_notes"] == 2
    for peak in synthetic_doc["melody"]["peaks"]:
        assert peak["time_sec"] <= synthetic_doc["source"]["duration_sec"]


def test_grid_beat_events_are_not_anchors(synthetic_doc):
    """A plain 'beat' is the grid, not a musical moment worth syncing to."""
    assert "beat" not in {a["type"] for a in synthetic_doc["anchors"]}


def test_near_duplicate_anchors_are_merged(synthetic_doc):
    """Two strong_onsets 0.2 s apart are one musical moment."""
    assert synthetic_doc["diagnostics"]["deduplicated_anchors"] >= 1
    onsets = [a["time_sec"] for a in synthetic_doc["anchors"] if a["type"] == "strong_onset"]
    assert len(onsets) == len(set(onsets))


def test_repeat_group_carries_the_variation_profile(synthetic_doc):
    groups = synthetic_doc["repeat_groups"]
    assert len(groups) == 1
    g = groups[0]
    assert g["repeat_group_id"] == "repeat_001"
    assert [o["section_id"] for o in g["occurrences"]] == ["section_01", "section_03"]
    assert g["variation_profile"]["arrangement_intensity_delta"] == pytest.approx(-0.19, abs=1e-4)
    # A reduction of that size is a reprise that comes back lighter.
    assert g["recommended_gameplay_relation"] == "reprise_with_reduction"


def test_sections_carry_their_repeat_linkage(synthetic_doc):
    by_id = {s["section_id"]: s for s in synthetic_doc["sections"]}
    assert by_id["section_01"]["repeat"]["group_id"] == "repeat_001"
    assert by_id["section_01"]["repeat"]["occurrence"] == 1
    assert by_id["section_01"]["repeat"]["total_occurrences"] == 2
    assert by_id["section_03"]["repeat"]["occurrence"] == 2
    assert by_id["section_02"]["repeat"] is None


def test_section_energy_trend_is_derived_from_the_curve(synthetic_doc):
    """The fixture's energy rises to the midpoint and falls after it."""
    by_id = {s["section_id"]: s for s in synthetic_doc["sections"]}
    assert by_id["section_01"]["energy"]["trend"] == "rising"
    assert by_id["section_03"]["energy"]["trend"] == "falling"


def test_motif_recurrence_flag_follows_the_repeat_groups(synthetic_doc):
    by_section = {}
    for p in synthetic_doc["phrases"]:
        by_section.setdefault(p["section_id"], []).append(p)
    for section_id, phrases in by_section.items():
        expected = section_id in {"section_01", "section_03"}
        for p in phrases:
            assert p["design_features"]["motif_recurrence_candidate"] is expected


def test_sync_checkpoints_cover_the_structural_landmarks(synthetic_doc):
    bars = {c["bar"] for c in synthetic_doc["sync_checkpoints"]}
    assert 1 in bars
    assert 17 in bars and 33 in bars, "section boundaries must be checkpoints"


def test_synthetic_document_is_deterministic(synthetic_doc):
    """Rebuilding from the same analysis must produce identical bytes."""
    again = json.loads(json.dumps(synthetic_doc))
    assert again == synthetic_doc
    assert json.dumps(again, sort_keys=True) == json.dumps(synthetic_doc, sort_keys=True)


# ---------------------------------------------------------------------------
# The validator itself
# ---------------------------------------------------------------------------

def test_validator_rejects_a_missing_schema_version(synthetic_doc):
    broken = json.loads(json.dumps(synthetic_doc))
    del broken["schema_version"]
    assert any("schema_version" in p for p in validate_director_context_v2(broken))


def test_validator_rejects_an_out_of_range_time(synthetic_doc):
    broken = json.loads(json.dumps(synthetic_doc))
    broken["anchors"][0]["time_sec"] = broken["source"]["duration_sec"] + 1.0
    problems = validate_director_context_v2(broken)
    assert any("outside" in p for p in problems)


def test_validator_rejects_a_gap_between_sections(synthetic_doc):
    broken = json.loads(json.dumps(synthetic_doc))
    if len(broken["sections"]) < 2:
        pytest.skip("needs at least two sections")
    broken["sections"][1]["start_bar"] += 1
    problems = validate_director_context_v2(broken)
    assert any("contiguous" in p for p in problems)


def test_validator_rejects_a_phrase_escaping_its_section(synthetic_doc):
    broken = json.loads(json.dumps(synthetic_doc))
    if not broken["phrases"]:
        pytest.skip("needs at least one phrase")
    owner = next(
        s for s in broken["sections"]
        if s["section_id"] == broken["phrases"][0]["section_id"]
    )
    n_bars = broken["timing"]["bar_count"]
    if owner["end_bar_exclusive"] <= n_bars:
        broken["phrases"][0]["end_bar_exclusive"] = owner["end_bar_exclusive"] + 1
    elif owner["start_bar"] > 1:
        broken["phrases"][0]["start_bar"] = owner["start_bar"] - 1
    else:
        pytest.skip("the only section spans the whole song, so no phrase can escape it")
    problems = validate_director_context_v2(broken)
    assert any("escapes" in p for p in problems)


def test_validator_rejects_an_unknown_anchor_type(synthetic_doc):
    broken = json.loads(json.dumps(synthetic_doc))
    if not broken["anchors"]:
        pytest.skip("needs at least one anchor")
    broken["anchors"][0]["type"] = "laser_beam"
    assert any("unknown type" in p for p in validate_director_context_v2(broken))

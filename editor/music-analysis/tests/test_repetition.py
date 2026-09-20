"""Repetition tests (prompt section 25).

Synthetic, controlled inputs: the sections' chroma, energy and stem activity
are built so "same theme" and "different theme" are ground truth by
construction, which is what makes the clustering assertions meaningful.
"""

from __future__ import annotations

import numpy as np

from fakes import make_energy, make_rhythm, make_structure, make_stems, make_tonal, section

from beatbound_audio.repetition import analyze_repetition


def _frame_times(duration: float, step: float = 0.1) -> np.ndarray:
    return np.arange(0.0, duration, step)


def _build(duration=96.0):
    """Four sections over a 96 s grid: A B A' C (A' = A with more drums)."""
    times = _frame_times(duration)
    rhythm = make_rhythm(
        onset_times=np.arange(0.0, duration, 0.5).tolist(),
        onset_strengths=[0.6] * len(np.arange(0.0, duration, 0.5)),
        duration=duration,
    )
    energy = make_energy(times, np.full(times.size, 0.5))
    tonal = make_tonal(
        times,
        [
            (0.0, 24.0, 0),    # section_01: C
            (24.0, 48.0, 6),   # section_02: F#
            (48.0, 72.0, 0),   # section_03: C again
            (72.0, 96.0, 3),   # section_04: D#
        ],
        duration,
    )
    structure = make_structure([
        section("section_01", 0.0, 24.0, 1, 12),
        section("section_02", 24.0, 48.0, 13, 24),
        section("section_03", 48.0, 72.0, 25, 36),
        section("section_04", 72.0, 96.0, 37, 48),
    ])
    return rhythm, energy, tonal, structure, times


def _stem_curves(times, drums_level):
    return make_stems(
        times,
        {
            "drumsActivity": np.full(times.size, drums_level),
            "drumsDensity": np.full(times.size, drums_level * 0.8),
            "bassActivity": np.full(times.size, 0.5),
            "vocalsActivity": np.full(times.size, 0.4),
            "otherActivity": np.full(times.size, 0.3),
        },
    )


def test_repeated_sections_are_clustered():
    rhythm, energy, tonal, structure, times = _build()
    stems = _stem_curves(times, 0.5)
    rep = analyze_repetition(_Ctx(), rhythm, tonal, energy, structure, stems=stems, melody=None)
    # section_01 (C) and section_03 (C) must form exactly one group.
    assert len(rep.groups) == 1, f"expected one repeat group, got {[g['occurrences'] for g in rep.groups]}"
    group = rep.groups[0]
    ids = [o["section_id"] for o in group["occurrences"]]
    assert ids == ["section_01", "section_03"]
    assert [o["occurrence_index"] for o in group["occurrences"]] == [1, 2]
    assert group["confidence"] is not None and group["confidence"] > 0.8


def test_different_sections_are_not_clustered():
    """The prompt is explicit: verse and chorus must never merge by accident."""
    rhythm, energy, tonal, structure, times = _build()
    structure = make_structure([
        section("section_01", 0.0, 24.0, 1, 12),   # C
        section("section_02", 24.0, 48.0, 13, 24),  # F# -- different theme
    ])
    rep = analyze_repetition(_Ctx(), rhythm, tonal, energy, structure, stems=None, melody=None)
    assert rep.groups == []
    assert rep.comparisons == []


def test_occurrence_indices_for_three_repeats():
    duration = 96.0
    times = _frame_times(duration)
    rhythm = make_rhythm(
        onset_times=np.arange(0.0, duration, 0.5).tolist(),
        onset_strengths=[0.6] * len(np.arange(0.0, duration, 0.5)),
        duration=duration,
    )
    energy = make_energy(times, np.full(times.size, 0.5))
    tonal = make_tonal(times, [(0.0, duration, 0)], duration)
    structure = make_structure([
        section("section_01", 0.0, 32.0, 1, 16),
        section("section_02", 32.0, 64.0, 17, 32),
        section("section_03", 64.0, 96.0, 33, 48),
    ])
    rep = analyze_repetition(_Ctx(), rhythm, tonal, energy, structure, stems=None, melody=None)
    assert len(rep.groups) == 1
    assert [o["occurrence_index"] for o in rep.groups[0]["occurrences"]] == [1, 2, 3]

    # Occurrence 3 is compared against both occurrence 1 and occurrence 2.
    pairs = {(c["occurrence"], c["compared_to_occurrence"]) for c in rep.comparisons}
    assert (2, 1) in pairs
    assert (3, 1) in pairs
    assert (3, 2) in pairs


def test_group_ordering_is_deterministic():
    rhythm, energy, tonal, structure, times = _build()
    stems = _stem_curves(times, 0.5)
    a = analyze_repetition(_Ctx(), rhythm, tonal, energy, structure, stems=stems)
    b = analyze_repetition(_Ctx(), rhythm, tonal, energy, structure, stems=stems)
    assert a.groups == b.groups
    assert a.comparisons == b.comparisons


def test_arrangement_delta_positive_when_drums_grow():
    """Occurrence 2 is the same theme with bigger drums -> delta > 0."""
    duration = 48.0
    times = _frame_times(duration)
    rhythm = make_rhythm(
        onset_times=np.arange(0.0, duration, 0.5).tolist(),
        onset_strengths=[0.6] * len(np.arange(0.0, duration, 0.5)),
        duration=duration,
    )
    energy = make_energy(times, np.full(times.size, 0.5))
    tonal = make_tonal(times, [(0.0, duration, 0)], duration)
    structure = make_structure([
        section("section_01", 0.0, 24.0, 1, 12),
        section("section_02", 24.0, 48.0, 13, 24),
    ])

    # Same harmonic identity, drums grow from 0.2 to 0.8 in the repeat.
    curves = {}
    for name in ("drumsActivity", "drumsDensity", "bassActivity", "vocalsActivity", "otherActivity"):
        base = {"drumsActivity": 0.2, "drumsDensity": 0.16, "bassActivity": 0.5,
                "vocalsActivity": 0.4, "otherActivity": 0.3}[name]
        grow = base * 2.0 if name.startswith("drums") else base
        arr = np.where(times < 24.0, base, grow)
        curves[name] = arr
    stems = make_stems(times, curves)

    rep = analyze_repetition(_Ctx(), rhythm, tonal, energy, structure, stems=stems)
    assert len(rep.groups) == 1
    cmp_to_first = next(c for c in rep.comparisons if c["occurrence"] == 2 and c["compared_to_occurrence"] == 1)
    assert cmp_to_first["drum_activity_delta"] > 0
    assert cmp_to_first["drum_density_delta"] > 0
    # Layers that did not change must read as ~0, not as noise.
    assert abs(cmp_to_first["bass_activity_delta"]) < 1e-6
    assert cmp_to_first["arrangement_intensity_delta"] > 0


def test_identical_occurrences_delta_near_zero():
    duration = 48.0
    times = _frame_times(duration)
    rhythm = make_rhythm(
        onset_times=np.arange(0.0, duration, 0.5).tolist(),
        onset_strengths=[0.6] * len(np.arange(0.0, duration, 0.5)),
        duration=duration,
    )
    energy = make_energy(times, np.full(times.size, 0.5))
    tonal = make_tonal(times, [(0.0, duration, 0)], duration)
    structure = make_structure([
        section("section_01", 0.0, 24.0, 1, 12),
        section("section_02", 24.0, 48.0, 13, 24),
    ])
    stems = _stem_curves(times, 0.5)

    rep = analyze_repetition(_Ctx(), rhythm, tonal, energy, structure, stems=stems)
    assert len(rep.groups) == 1
    for c in rep.comparisons:
        for key, value in c.items():
            if key.endswith("_delta") and value is not None:
                assert abs(value) < 5e-4, f"{key} should be ~0, got {value}"


def test_missing_stems_degrade_instead_of_failing():
    """Fast mode: no stems at all. Deltas over stem layers read null."""
    rhythm, energy, tonal, structure, _times = _build()
    rep = analyze_repetition(_Ctx(), rhythm, tonal, energy, structure, stems=None, melody=None)
    # Chroma identity still groups the two C sections.
    assert len(rep.groups) == 1
    stats = rep.section_stats["section_01"]
    assert stats["drum_activity"] is None
    assert stats["arrangement_intensity"] is not None  # energy + onset still feed it


def test_too_few_sections_is_reported_not_crashed():
    rhythm = make_rhythm([], [], duration=8.0)
    energy = make_energy(np.zeros(0), np.zeros(0))
    tonal = make_tonal(np.zeros(0), [], 8.0)
    structure = make_structure([section("section_01", 0.0, 8.0, 1, 4)])
    rep = analyze_repetition(_Ctx(), rhythm, tonal, energy, structure)
    assert rep.groups == []
    assert rep.comparisons == []
    assert any("fewer than two sections" in w for w in rep.warnings)


class _Ctx:
    """Repetition only reads nothing from ctx today; a stub keeps the signature honest."""

    duration = 96.0

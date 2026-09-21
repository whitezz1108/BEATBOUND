"""Repetition detection: which sections are the same musical theme again (V2.1).

The question answered here is deliberately narrow: *are these two sections the
same theme repeating?* -- not "is this the chorus". Semantic naming is fragile
and prompt section 3.4 forbids depending on it, so ``semantic_role`` stays
``null`` everywhere this round.

Method, end to end:

1. Every section gets a multi-dimensional **fingerprint** built only from data
   the V2 pipeline already computed (chroma, onset layer, stem activity curves,
   melody notes, energy curve, bar count). A family that is missing (no stems in
   fast mode, no melody notes in a section) drops out of the comparison and the
   remaining weights renormalise -- repetition never fails because one layer is
   absent.
2. Section-to-section similarity is a weighted sum of per-family cosine
   similarities.
3. Grouping is **conservative** (prompt section 28): a pair only groups above
   ``REPEAT_SIM_THRESHOLD``, the harmonic (chroma) sub-similarity must clear
   ``REPEAT_HARMONIC_MIN`` on its own, very different section lengths are
   excluded, and a merge only happens when *every* cross pair between the two
   clusters clears the threshold (complete linkage). A missed repeat costs a
   lost opportunity; a false one poisons pattern evolution.
4. For every repeat group, occurrence N is compared against occurrence 1 and
   against the previous occurrence with normalised **arrangement deltas**:
   positive = stronger / denser / brighter / more active (prompt section 5.1).

``arrangement_intensity`` is a documented weighted blend, never a black box::

    energy .22  drums .18  drums-density .10  bass .12  vocals .14
    other .06  onset-density .10  brightness .04  melody-density .04

When components are missing the weights renormalise over what is available
(fewer than two components -> ``None``).

Determinism: no randomness anywhere; pair ordering and tie-breaks are total
orders, so the same inputs give byte-identical output.
"""

from __future__ import annotations

from typing import Dict, List, Optional, Tuple

import numpy as np

from . import config, util
from .results import (
    AudioContext,
    EnergyResult,
    MelodyResult,
    RepetitionResult,
    RhythmResult,
    StemFeatureResult,
    StructureResult,
    TonalResult,
)

#: Weights for the composite ``arrangement_intensity`` (documented, not tuned
#: per song). They renormalise over the components a given song actually has.
ARRANGEMENT_WEIGHTS: Dict[str, float] = {
    "energy": 0.22,
    "drum_activity": 0.18,
    "drum_density": 0.10,
    "bass_activity": 0.12,
    "vocal_activity": 0.14,
    "other_activity": 0.06,
    "onset_density": 0.10,
    "brightness": 0.04,
    "melody_density": 0.04,
}

#: Fingerprint families: name -> weight. Which families are usable is decided
#: per song; the used ones renormalise to sum 1.
_FAMILY_WEIGHTS: Dict[str, float] = {
    "harmonic": 0.30,
    "rhythm": 0.25,
    "arrangement": 0.20,
    "melody": 0.15,
    "energy": 0.10,
}

#: Reference rates that map to a density of 1.0 (matches the event/aggregator
#: layers' references so the numbers stay comparable across the document).
_ONSET_REF_NPS = 6.0
_MELODY_REF_NPS = 8.0


def _cos(a: np.ndarray, b: np.ndarray) -> float:
    """Cosine similarity; a zero vector is *not* similar to anything."""
    na, nb = float(np.linalg.norm(a)), float(np.linalg.norm(b))
    if na < 1e-9 or nb < 1e-9:
        return 0.0
    return float(np.dot(a, b) / (na * nb))


def _mean_between(times: np.ndarray, values: np.ndarray, lo: float, hi: float) -> Optional[float]:
    if times.size == 0 or values.size == 0:
        return None
    mask = (times >= lo) & (times < hi)
    if not mask.any():
        return None
    seg = values[mask]
    seg = seg[np.isfinite(seg)]
    if seg.size == 0:
        return None
    return float(np.mean(seg))


class _SectionProfile:
    """Everything one section contributes to repetition, in normalised units."""

    def __init__(
        self,
        section: dict,
        rhythm: RhythmResult,
        energy: EnergyResult,
        tonal: TonalResult,
        stems: Optional[StemFeatureResult],
        melody: Optional[MelodyResult],
    ) -> None:
        self.section = section
        self.start = float(section.get("start") or 0.0)
        self.end = float(section.get("end") or 0.0)
        self.duration = max(self.end - self.start, 1e-6)

        # ---- energy -----------------------------------------------------
        self.energy = _mean_between(energy.times, energy.rms_smooth, self.start, self.end)
        if self.energy is not None:
            third = self.duration / 3.0
            self.energy_first = _mean_between(
                energy.times, energy.rms_smooth, self.start, self.start + third
            )
            self.energy_last = _mean_between(
                energy.times, energy.rms_smooth, self.end - third, self.end
            )
        else:
            self.energy_first = self.energy_last = None

        # ---- rhythm / onsets ----------------------------------------------
        in_sec = (rhythm.onset_times >= self.start) & (rhythm.onset_times < self.end)
        n_onsets = int(np.sum(in_sec))
        self.onset_density = util.clamp01((n_onsets / self.duration) / _ONSET_REF_NPS)
        strengths = rhythm.onset_strengths[in_sec]
        self.onset_strength = (
            float(np.mean(strengths[np.isfinite(strengths)])) if strengths.size else None
        )

        # ---- stems ---------------------------------------------------------
        self.stem_means: Dict[str, Optional[float]] = {
            name: None for name in ("drums", "bass", "vocals", "other")
        }
        self.drums_density: Optional[float] = None
        if stems is not None and stems.available:
            for name in self.stem_means:
                self.stem_means[name] = _mean_between(
                    stems.times, stems.curves.get(f"{name}Activity"), self.start, self.end
                )
            self.drums_density = _mean_between(
                stems.times, stems.curves.get("drumsDensity"), self.start, self.end
            )

        # ---- tonal -----------------------------------------------------------
        self.chroma: Optional[np.ndarray] = None
        self.brightness: Optional[float] = None
        if tonal.available and tonal.chroma.size:
            mask = (tonal.chroma_times >= self.start) & (tonal.chroma_times < self.end)
            if mask.any():
                prof = tonal.chroma[:, mask].mean(axis=1)
                total = float(prof.sum())
                self.chroma = prof / total if total > 1e-9 else None
        if tonal.available and tonal.centroid_hz.size:
            # Same log scaling the window timeline uses, so the two agree.
            lo, hi = np.log10(60.0), np.log10(8000.0)
            curve = np.clip(
                (np.log10(np.maximum(tonal.centroid_hz, 60.0)) - lo) / (hi - lo), 0.0, 1.0
            )
            self.brightness = _mean_between(tonal.centroid_times, curve, self.start, self.end)

        # ---- melody ------------------------------------------------------------
        self.melody_density: Optional[float] = None
        self.melody_voiced: Optional[float] = None
        self.melody_mean_pitch: Optional[float] = None
        self.melody_range: Optional[float] = None
        self.melody_note_count = 0
        if melody is not None and melody.available and melody.notes:
            notes = [
                n for n in melody.notes
                if n["start"] is not None and n["end"] is not None
                and n["start"] < self.end and n["end"] > self.start
            ]
            self.melody_note_count = len(notes)
            if notes:
                self.melody_density = util.clamp01(
                    (len(notes) / self.duration) / _MELODY_REF_NPS
                )
            if melody.pitch_times.size:
                inside = (melody.pitch_times >= self.start) & (melody.pitch_times < self.end)
                if inside.any():
                    voiced = np.isfinite(melody.pitch_midi[inside])
                    self.melody_voiced = float(np.mean(voiced))
                    pitches = melody.pitch_midi[inside]
                    pitches = pitches[np.isfinite(pitches)]
                    if pitches.size:
                        self.melody_mean_pitch = float(np.mean(pitches))
                        self.melody_range = util.clamp01(
                            (float(np.max(pitches)) - float(np.min(pitches))) / 24.0
                        )

        # ---- structure -----------------------------------------------------------
        sb, eb = section.get("startBar"), section.get("endBar")
        self.bars = int(eb - sb + 1) if (sb and eb) else None

    # -- fingerprint -----------------------------------------------------------

    def family_vectors(self) -> Dict[str, Optional[np.ndarray]]:
        """Fingerprint families; ``None`` marks "not measurable for this section"."""
        families: Dict[str, Optional[np.ndarray]] = {}

        families["harmonic"] = self.chroma

        rhythm_vec = [self.onset_density]
        if self.onset_strength is not None:
            rhythm_vec.append(self.onset_strength)
        if self.stem_means.get("drums") is not None:
            rhythm_vec.append(self.stem_means["drums"])
        if self.drums_density is not None:
            rhythm_vec.append(self.drums_density)
        families["rhythm"] = np.asarray(rhythm_vec, dtype=float)

        if all(v is not None for v in self.stem_means.values()):
            families["arrangement"] = np.asarray(
                [self.stem_means[n] for n in ("drums", "bass", "vocals", "other")],
                dtype=float,
            )
        else:
            families["arrangement"] = None

        if self.melody_note_count > 0:
            families["melody"] = np.asarray(
                [
                    self.melody_density or 0.0,
                    self.melody_voiced or 0.0,
                    # Mean pitch is normalised over the song's own range when the
                    # melody layer computed one; a neutral 0.5 keeps the family
                    # comparable when it could not be scaled.
                    self.melody_mean_pitch / 127.0 if self.melody_mean_pitch is not None else 0.5,
                    self.melody_range or 0.0,
                ],
                dtype=float,
            )
        else:
            families["melody"] = None

        if self.energy is not None:
            families["energy"] = np.asarray(
                [
                    self.energy,
                    self.energy_first if self.energy_first is not None else self.energy,
                    self.energy_last if self.energy_last is not None else self.energy,
                    _curve_peak(self.energy),
                ],
                dtype=float,
            )
        else:
            families["energy"] = None

        return families

    def stats(self) -> dict:
        """Normalised per-section metrics -- the delta vocabulary (section 5.1)."""
        return {
            "energy": self.energy,
            "drum_activity": self.stem_means.get("drums"),
            "drum_density": self.drums_density,
            "bass_activity": self.stem_means.get("bass"),
            "vocal_activity": self.stem_means.get("vocals"),
            "other_activity": self.stem_means.get("other"),
            "onset_density": self.onset_density,
            "brightness": self.brightness,
            "melody_density": self.melody_density,
        }

    def intensity(self) -> Optional[float]:
        """Documented weighted blend over the metrics that exist (never a black box).

        At least two components must be measurable; a single number would be
        just that number wearing a different name.
        """
        stats = self.stats()
        num = den = 0.0
        count = 0
        for key, weight in ARRANGEMENT_WEIGHTS.items():
            value = stats.get(key)
            if value is None:
                continue
            num += weight * float(value)
            den += weight
            count += 1
        if count < 2 or den < 1e-9:
            return None
        return util.fnum(util.clamp01(num / den), 4)


def _curve_peak(value: Optional[float]) -> float:
    """A single peak slot for the energy family (the curve peak is not carried)."""
    return value or 0.0


def _pair_similarity(
    a: _SectionProfile, b: _SectionProfile
) -> Tuple[float, Optional[float]]:
    """Weighted cosine similarity plus the harmonic sub-similarity.

    Returns ``(overall, harmonic)``. Families present in only one of the two
    sections are dropped and the weights renormalise, so a section without
    melody notes is compared on what both sections do have.
    """
    fa, fb = a.family_vectors(), b.family_vectors()
    num = 0.0
    den = 0.0
    harmonic: Optional[float] = None
    for name, weight in _FAMILY_WEIGHTS.items():
        va, vb = fa.get(name), fb.get(name)
        if va is None or vb is None:
            continue
        cos = _cos(va, vb)
        num += weight * cos
        den += weight
        if name == "harmonic":
            harmonic = cos
    if den < 1e-9:
        return 0.0, harmonic
    return num / den, harmonic


def _length_compatible(a: _SectionProfile, b: _SectionProfile) -> bool:
    """Very different section lengths are not the same theme."""
    if a.bars and b.bars:
        lo, hi = min(a.bars, b.bars), max(a.bars, b.bars)
        return lo / hi >= config.REPEAT_LENGTH_RATIO_MIN
    lo, hi = min(a.duration, b.duration), max(a.duration, b.duration)
    return lo / hi >= config.REPEAT_LENGTH_RATIO_MIN


def _similarity_matrix(profiles: List[_SectionProfile]):
    """Pairwise (overall similarity, harmonic similarity) for every pair."""
    n = len(profiles)
    sims = np.zeros((n, n))
    harmonics: Dict[Tuple[int, int], Optional[float]] = {}
    for i in range(n):
        sims[i, i] = 1.0
        for j in range(i + 1, n):
            sim, harmonic = _pair_similarity(profiles[i], profiles[j])
            sims[i, j] = sims[j, i] = sim
            harmonics[(i, j)] = harmonics[(j, i)] = harmonic
    return sims, harmonics


def _cluster(
    profiles: List[_SectionProfile], sims: np.ndarray, harmonics
) -> List[List[int]]:
    """Complete-linkage clustering over eligible pairs, deterministic.

    A pair is eligible only when the overall similarity clears the threshold,
    the harmonic sub-similarity clears its own (lower) floor, and the section
    lengths are compatible. A merge of two clusters additionally requires every
    cross pair to be eligible -- one weak link blocks the whole merge.
    """
    n = len(profiles)

    def eligible(i: int, j: int) -> bool:
        if sims[i, j] < config.REPEAT_SIM_THRESHOLD:
            return False
        if not _length_compatible(profiles[i], profiles[j]):
            return False
        harmonic = harmonics.get((i, j))
        if harmonic is not None and harmonic < config.REPEAT_HARMONIC_MIN:
            return False
        return True

    pairs = [
        (float(sims[i, j]), i, j)
        for i in range(n)
        for j in range(i + 1, n)
        if eligible(i, j)
    ]
    clusters: List[List[int]] = [[i] for i in range(n)]

    # Highest similarity first; ties broken by index order (a total order).
    for _sim, i, j in sorted(pairs, key=lambda p: (-p[0], p[1], p[2])):
        ci = next(k for k, c in enumerate(clusters) if i in c)
        cj = next(k for k, c in enumerate(clusters) if j in c)
        if ci == cj:
            continue
        if all(eligible(x, y) for x in clusters[ci] for y in clusters[cj]):
            merged = sorted(clusters[ci] + clusters[cj])
            clusters = [
                c for k, c in enumerate(clusters) if k not in (ci, cj)
            ] + [merged]
    return clusters


def analyze_repetition(
    ctx: AudioContext,
    rhythm: RhythmResult,
    tonal: TonalResult,
    energy: EnergyResult,
    structure: StructureResult,
    stems: Optional[StemFeatureResult] = None,
    melody: Optional[MelodyResult] = None,
) -> RepetitionResult:
    """Detect repeat groups across sections and their arrangement deltas."""
    warnings: List[str] = []
    sections = structure.sections
    threshold = config.REPEAT_SIM_THRESHOLD

    if len(sections) < config.REPEAT_MIN_SECTIONS:
        return RepetitionResult(
            groups=[],
            comparisons=[],
            section_stats={},
            method="fingerprint-cosine",
            threshold=threshold,
            warnings=["repetition not attempted: fewer than two sections"],
        )

    profiles = [
        _SectionProfile(sec, rhythm, energy, tonal, stems, melody) for sec in sections
    ]
    sims, _harmonics = _similarity_matrix(profiles)
    clusters = _cluster(profiles, sims, _harmonics)

    groups: List[dict] = []
    comparisons: List[dict] = []
    section_stats = {
        sec["id"]: {**p.stats(), "arrangement_intensity": p.intensity()}
        for sec, p in zip(sections, profiles)
    }

    repeat_cluster_idxs = [
        idx for idx, members in enumerate(clusters) if len(members) >= 2
    ]
    # Group ids follow first-occurrence time order, so the numbering is stable.
    repeat_cluster_idxs.sort(key=lambda idx: min(clusters[idx]))

    for n_group, ci in enumerate(repeat_cluster_idxs, start=1):
        members = clusters[ci]  # ascending section order == time order
        pair_sims = [
            float(sims[x, y])
            for x_i, x in enumerate(members)
            for y in members[x_i + 1:]
        ]
        confidence = util.fnum(float(np.mean(pair_sims)), 4) if pair_sims else 0.0

        occurrences = []
        for occ, mi in enumerate(members, start=1):
            others = [m for m in members if m != mi]
            sim_to_group = (
                util.fnum(float(np.mean([sims[mi, o] for o in others])), 4)
                if others
                else None
            )
            sec = sections[mi]
            occurrences.append({
                "section_id": sec["id"],
                "occurrence_index": occ,
                "start": sec.get("start"),
                "end": sec.get("end"),
                "similarity_to_group": sim_to_group,
            })

        groups.append({
            "group_id": f"repeat_{n_group:03d}",
            "confidence": confidence,
            "semantic_role": None,   # deliberately not inferred this round
            "semantic_role_confidence": None,
            "occurrences": occurrences,
        })

        # Deltas: every occurrence N >= 2 vs occurrence 1 and vs the previous.
        for k in range(1, len(members)):
            for compared_to in sorted({0, k - 1}):
                comparisons.append(
                    _comparison(
                        f"repeat_{n_group:03d}",
                        k + 1,
                        compared_to + 1,
                        sections[members[compared_to]]["id"],
                        sections[members[k]]["id"],
                        section_stats,
                    )
                )

    return RepetitionResult(
        groups=groups,
        comparisons=comparisons,
        section_stats=section_stats,
        method="fingerprint-cosine",
        threshold=threshold,
        warnings=warnings,
    )


def _delta(a: Optional[float], b: Optional[float]) -> Optional[float]:
    """``b - a`` in normalised units; positive = stronger/denser/brighter."""
    if a is None or b is None:
        return None
    return util.fnum(b - a, 4)


_DELTA_FIELDS = (
    ("energy_delta", "energy"),
    ("drum_activity_delta", "drum_activity"),
    ("drum_density_delta", "drum_density"),
    ("bass_activity_delta", "bass_activity"),
    ("vocal_activity_delta", "vocal_activity"),
    ("other_activity_delta", "other_activity"),
    ("onset_density_delta", "onset_density"),
    ("brightness_delta", "brightness"),
    ("melody_density_delta", "melody_density"),
)


def _comparison(
    group_id: str,
    occurrence: int,
    compared_to: int,
    base_section_id: str,
    other_section_id: str,
    section_stats: Dict[str, dict],
) -> dict:
    base = section_stats.get(base_section_id, {})
    other = section_stats.get(other_section_id, {})
    out = {
        "group_id": group_id,
        "occurrence": occurrence,
        "compared_to_occurrence": compared_to,
        "base_section_id": base_section_id,
        "section_id": other_section_id,
    }
    for field, key in _DELTA_FIELDS:
        out[field] = _delta(base.get(key), other.get(key))
    out["arrangement_intensity_delta"] = _delta(
        base.get("arrangement_intensity"), other.get("arrangement_intensity")
    )
    return out

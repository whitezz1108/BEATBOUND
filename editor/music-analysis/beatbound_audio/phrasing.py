"""Phrase hierarchy: beat -> bar -> phrase -> section (V2.1).

A phrase is the granularity a level director arranges at -- usually 4, 8 or 16
bars. This module cuts every section into phrases **strictly on the bar grid**
(the same constant grid the runtime uses), so a phrase boundary is always a bar
boundary and phrase bar numbers can be fed straight into level patterns.

Boundary decision (prompt section 4.2): a bar line is scored by what the music
does across it -- energy change, drum / bass / vocal activity change, onset
change, chroma novelty, melody phrase edges nearby -- and the 4/8/16-bar
periodicity acts as a *strong prior* (weight below), never as the only signal.
A dynamic-programming partition then picks the boundary set that minimises
``(1 - boundary score) + length penalty``, where the length penalty is zero
only at 4/8/16 bars. Cutting every 8 bars regardless of the music is exactly
what this is built to avoid, and what the DP would produce for free if the
prior were 1.0.

Families that are missing (no stems in fast mode, no melody notes) drop out
and the remaining weights renormalise. Sections shorter than 4 bars, songs
without a usable tempo, and degenerate inputs all degrade to fewer or no
phrases rather than to invented ones.
"""

from __future__ import annotations

from typing import Dict, List, Optional

import numpy as np

from . import config, util
from .results import (
    AudioContext,
    EnergyResult,
    MelodyResult,
    PhraseResult,
    RhythmResult,
    StemFeatureResult,
    StructureResult,
    TonalResult,
)

#: Boundary-score families: name -> weight (renormalised over what exists).
_BOUNDARY_WEIGHTS: Dict[str, float] = {
    "energy": 0.09,
    "drums": 0.09,
    "bass": 0.08,
    "vocals": 0.08,
    "onset": 0.10,
    "chroma_novelty": 0.12,
    "melody_edge": 0.14,
    "period_prior": 0.30,
}

#: Event types worth surfacing per phrase in ``important_event_times``.
_IMPORTANT_EVENT_TYPES = {
    "energy_rise", "energy_drop", "energy_peak",
    "vocal_entry", "vocal_exit", "bass_entry", "drum_density_rise",
    "melody_rise", "melody_fall", "melody_peak", "large_pitch_jump",
    "section_boundary",
}

#: Score assumed at a boundary nobody has to detect: the section's own edges.
_STRUCTURAL_EDGE_SCORE = 0.8

#: Half-bar window in which a melody phrase edge counts as boundary evidence.
_MELODY_EDGE_HALF_BAR = 0.5


def _cos(a: np.ndarray, b: np.ndarray) -> float:
    na, nb = float(np.linalg.norm(a)), float(np.linalg.norm(b))
    if na < 1e-9 or nb < 1e-9:
        return 0.0
    return float(np.dot(a, b) / (na * nb))


def _mean_between(times: np.ndarray, values: Optional[np.ndarray], lo: float, hi: float) -> Optional[float]:
    if values is None or times.size == 0 or values.size == 0:
        return None
    mask = (times >= lo) & (times < hi)
    if not mask.any():
        return None
    seg = values[mask]
    seg = seg[np.isfinite(seg)]
    return float(np.mean(seg)) if seg.size else None


def _length_penalty(bars: int) -> float:
    if bars in config.PHRASE_LENGTHS:
        return 0.0
    if bars in (2, 3, 5, 6, 7, 12):
        return config.PHRASE_NEAR_LENGTH_PENALTY
    return config.PHRASE_FAR_LENGTH_PENALTY


def _length_fit(bars: int) -> float:
    if bars in config.PHRASE_LENGTHS:
        return 1.0
    if bars in (2, 3, 5, 6, 7, 12):
        return 0.6
    return 0.3


class _BarFeatures:
    """Per-bar feature table for one section's bar range."""

    def __init__(
        self,
        bar_range: range,
        rhythm: RhythmResult,
        energy: EnergyResult,
        tonal: TonalResult,
        stems: Optional[StemFeatureResult],
    ) -> None:
        self.bar_range = bar_range
        bounds = rhythm.bar_bounds
        # Start time of every bar line in the range -- the melody-edge evidence
        # needs absolute times, everything else is keyed by bar number.
        self._line_times = {b: float(bounds[b - 1]) for b in bar_range}
        self.energy: Dict[int, Optional[float]] = {}
        self.drums: Dict[int, Optional[float]] = {}
        self.bass: Dict[int, Optional[float]] = {}
        self.vocals: Dict[int, Optional[float]] = {}
        self.onset: Dict[int, float] = {}
        self.chroma: Dict[int, Optional[np.ndarray]] = {}

        for b in bar_range:
            lo, hi = float(bounds[b - 1]), float(bounds[b])
            self.energy[b] = _mean_between(energy.times, energy.rms_smooth, lo, hi)
            if stems is not None and stems.available:
                self.drums[b] = _mean_between(stems.times, stems.curves.get("drumsActivity"), lo, hi)
                self.bass[b] = _mean_between(stems.times, stems.curves.get("bassActivity"), lo, hi)
                self.vocals[b] = _mean_between(stems.times, stems.curves.get("vocalsActivity"), lo, hi)
            else:
                self.drums[b] = self.bass[b] = self.vocals[b] = None
            in_bar = (rhythm.onset_times >= lo) & (rhythm.onset_times < hi)
            bar_sec = max(hi - lo, 1e-6)
            self.onset[b] = util.clamp01((float(np.sum(in_bar)) / bar_sec) / 6.0)
            if tonal.available and tonal.chroma.size:
                mask = (tonal.chroma_times >= lo) & (tonal.chroma_times < hi)
                self.chroma[b] = tonal.chroma[:, mask].mean(axis=1) if mask.any() else None
            else:
                self.chroma[b] = None

    def boundary_score(
        self,
        bar: int,
        section_start_bar: int,
        melody_edges: Optional[np.ndarray],
        bar_sec: float,
    ) -> float:
        """Score the bar line at the *start* of ``bar`` (interior line).

        Families without data are skipped and the weights renormalise, so a
        fast-mode run (no stems) still produces a meaningful score from the
        remaining evidence.
        """
        prev = bar - 1
        parts: Dict[str, float] = {}
        weights: Dict[str, float] = {}

        def delta(table: Dict[int, Optional[float]], name: str, weight: float) -> None:
            a, b = table.get(prev), table.get(bar)
            if a is None or b is None:
                return
            parts[name] = abs(b - a)
            weights[name] = weight

        delta(self.energy, "energy", _BOUNDARY_WEIGHTS["energy"])
        delta(self.drums, "drums", _BOUNDARY_WEIGHTS["drums"])
        delta(self.bass, "bass", _BOUNDARY_WEIGHTS["bass"])
        delta(self.vocals, "vocals", _BOUNDARY_WEIGHTS["vocals"])

        parts["onset"] = abs(self.onset[bar] - self.onset[prev])
        weights["onset"] = _BOUNDARY_WEIGHTS["onset"]

        ca, cb = self.chroma.get(prev), self.chroma.get(bar)
        if ca is not None and cb is not None:
            parts["chroma_novelty"] = 1.0 - _cos(ca, cb)
            weights["chroma_novelty"] = _BOUNDARY_WEIGHTS["chroma_novelty"]

        if melody_edges is not None and melody_edges.size:
            line_t = self._line_times[bar]
            close = np.abs(melody_edges - line_t) <= _MELODY_EDGE_HALF_BAR * bar_sec
            parts["melody_edge"] = 1.0 if bool(np.any(close)) else 0.0
            weights["melody_edge"] = _BOUNDARY_WEIGHTS["melody_edge"]

        dist = bar - section_start_bar
        if dist % 8 == 0:
            parts["period_prior"] = 1.0
        elif dist % 4 == 0:
            parts["period_prior"] = 0.7
        else:
            parts["period_prior"] = 0.0
        weights["period_prior"] = _BOUNDARY_WEIGHTS["period_prior"]

        total_w = sum(weights.values())
        if total_w < 1e-9:
            return 0.0
        return float(sum(weights[k] * parts[k] for k in parts) / total_w)


def _segment(bars: List[int], start_score: Dict[int, float]) -> List[List[int]]:
    """Optimal partition of ``bars`` into phrases (list of inclusive bar ranges).

    Cutting at bar line ``a`` pays ``CUT_OFFSET - score(a)`` -- a *gain* when
    the evidence is strong, a cost when it is weak -- and a phrase of length
    ``L`` pays the length penalty (zero at 4/8/16 bars). The partition
    minimises the total, so a boundary only survives when its musical evidence
    plus the periodicity prior outweigh the cost of having a boundary at all.
    Ties prefer the longer leading phrase, so the result is deterministic.
    """
    n = len(bars)
    if n == 0:
        return []
    first = bars[0]
    INF = float("inf")
    max_len = 2 * max(config.PHRASE_LENGTHS)

    dp = [INF] * (n + 1)
    back = [-1] * (n + 1)
    dp[0] = 0.0
    for idx in range(1, n + 1):
        for j in range(0, idx):
            length = idx - j
            if length < config.PHRASE_MIN_BARS:
                break  # j ascending: length only shrinks from here
            if length > max_len:
                continue
            if dp[j] == INF:
                continue
            boundary_cost = (
                config.PHRASE_CUT_OFFSET - start_score.get(first + j, 0.0)
                if j > 0
                else 0.0
            )
            cost = dp[j] + boundary_cost + _length_penalty(length)
            if cost < dp[idx] - 1e-12:
                dp[idx] = cost
                back[idx] = j

    if back[n] < 0:
        return [bars[:]]  # degenerate: one phrase over the whole range

    pieces: List[List[int]] = []
    idx = n
    while idx > 0:
        j = back[idx]
        pieces.insert(0, [first + j, first + idx - 1])
        idx = j
    return pieces


def _melody_edge_times(melody: Optional[MelodyResult]) -> Optional[np.ndarray]:
    if melody is None or not melody.available or not melody.phrases:
        return None
    edges = [t for ph in melody.phrases for t in (ph.get("start"), ph.get("end")) if t is not None]
    return np.asarray(sorted(edges), dtype=float) if edges else None


def analyze_phrasing(
    ctx: AudioContext,
    rhythm: RhythmResult,
    energy: EnergyResult,
    tonal: TonalResult,
    structure: StructureResult,
    stems: Optional[StemFeatureResult] = None,
    melody: Optional[MelodyResult] = None,
    events: Optional[List[dict]] = None,
) -> PhraseResult:
    """Cut every section into bar-aligned phrases."""
    warnings: List[str] = []
    phrases: List[dict] = []

    has_grid = bool(rhythm.bpm and rhythm.n_bars >= 1 and len(rhythm.bar_bounds) >= 2)
    if not has_grid:
        if structure.sections:
            warnings.append("no bar grid -- phrases not built")
        return PhraseResult(phrases=[], method="none", warnings=warnings)

    bpb = int(rhythm.time_signature[0])
    bar_sec = rhythm.beat_len * bpb
    melody_edges = _melody_edge_times(melody)
    counter = 0

    for sec in structure.sections:
        sb, eb = sec.get("startBar"), sec.get("endBar")
        if not sb or not eb or eb < sb:
            continue
        sb, eb = int(sb), int(eb)
        sb = max(1, min(sb, rhythm.n_bars))
        eb = max(sb, min(eb, rhythm.n_bars))
        span = eb - sb + 1

        if span < min(config.PHRASE_LENGTHS[0], 4):
            # Too short to phrase: one phrase over the whole section.
            counter += 1
            phrases.append(_describe_phrase(
                counter, sec, sb, eb, rhythm, energy, stems, melody, events,
                confidence=0.3,
            ))
            continue

        bar_range = range(sb, eb + 1)
        feats = _BarFeatures(bar_range, rhythm, energy, tonal, stems)

        start_score = {sb: _STRUCTURAL_EDGE_SCORE}
        for b in range(sb + 1, eb + 1):
            start_score[b] = feats.boundary_score(b, sb, melody_edges, bar_sec)
        start_score[eb + 1] = _STRUCTURAL_EDGE_SCORE  # section end line

        pieces = _segment(list(bar_range), start_score)
        pieces = [p for p in pieces if p[1] >= p[0]]

        for a, b in pieces:
            counter += 1
            phrases.append(_describe_phrase(
                counter, sec, a, b, rhythm, energy, stems, melody, events,
                confidence=_phrase_confidence(a, b, start_score),
            ))

    _label_positions(phrases)

    if not phrases and structure.sections:
        warnings.append("no phrases could be built from the bar grid")

    return PhraseResult(phrases=phrases, method="bar-grid-dp", warnings=warnings)


def _phrase_confidence(a: int, b: int, start_score: Dict[int, float]) -> float:
    """How well-evidenced this one phrase is: its edges plus its length fit."""
    length = b - a + 1
    start_s = start_score.get(a, 0.0)
    end_s = start_score.get(b + 1, _STRUCTURAL_EDGE_SCORE)
    conf = 0.45 * start_s + 0.20 * end_s + 0.35 * _length_fit(length)
    return util.fnum(util.clamp01(conf), 4)


def _describe_phrase(
    phrase_num: int,
    sec: dict,
    a: int,
    b: int,
    rhythm: RhythmResult,
    energy: EnergyResult,
    stems: Optional[StemFeatureResult],
    melody: Optional[MelodyResult],
    events: Optional[List[dict]],
    *,
    confidence: float,
) -> dict:
    bounds = rhythm.bar_bounds
    start = float(bounds[a - 1])
    end = float(min(bounds[b], bounds[-1]))
    n_bars = b - a + 1

    e_first = _mean_between(energy.times, energy.rms_smooth, start, start + (end - start) / 2)
    e_second = _mean_between(energy.times, energy.rms_smooth, start + (end - start) / 2, end)
    trend = None
    if e_first is not None and e_second is not None:
        if e_second - e_first >= 0.08:
            trend = "rising"
        elif e_first - e_second >= 0.08:
            trend = "falling"
        else:
            trend = "stable"

    dominant: List[str] = []
    if stems is not None and stems.available:
        means = {
            name: _mean_between(stems.times, stems.curves.get(f"{name}Activity"), start, end)
            for name in ("drums", "bass", "vocals", "other")
        }
        dominant = [
            name for name, v in sorted(means.items(), key=lambda kv: -(kv[1] or 0.0))
            if (v or 0.0) >= 0.4
        ][:3]

    contour: Optional[str] = None
    if melody is not None and melody.available and melody.phrases:
        overlapping = [
            ph for ph in melody.phrases
            if ph["end"] > start and ph["start"] < end
        ]
        if overlapping:
            counts: Dict[str, int] = {}
            for ph in overlapping:
                d = ph.get("direction")
                if d:
                    counts[d] = counts.get(d, 0) + 1
            contour = sorted(counts.items(), key=lambda kv: (-kv[1], kv[0]))[0][0]

    important_times: List[float] = []
    if events:
        candidates = [
            e for e in events
            if e.get("type") in _IMPORTANT_EVENT_TYPES
            and e.get("time") is not None
            and start <= e["time"] < end
        ]
        candidates.sort(key=lambda e: (-(e.get("strength") or 0.0), e["time"]))
        important_times = [util.fnum(e["time"]) for e in candidates[:6]]

    sec_sb = sec.get("startBar") or a
    sec_eb = sec.get("endBar") or b
    position = (a - sec_sb) / max(sec_eb - sec_sb, 1)

    return {
        "phrase_id": f"phrase_{phrase_num:03d}",
        "section_id": sec["id"],
        "start_bar": a,
        "end_bar": b,
        "bar_count": n_bars,
        "start": util.fnum(start),
        "end": util.fnum(end),
        "confidence": util.fnum(confidence, 4),
        "position_in_section": util.fnum(max(0.0, min(1.0, position)), 4),
        "position_label": None,   # filled by _label_positions
        "energy_mean": util.fnum(
            _mean_between(energy.times, energy.rms_smooth, start, end), 4
        ),
        "energy_trend": trend,
        "dominant_layers": dominant,
        "melody_contour": contour,
        "important_event_times": important_times,
    }


def _label_positions(phrases: List[dict]) -> None:
    """opening / development / peak -- only from clear, deterministic rules.

    The first phrase of each section is ``opening``; the phrase with the
    highest ``energy_mean`` becomes ``peak`` when it is not also the first;
    everything else is ``development``. No label is ever guessed from
    subjective structure.
    """
    by_section: Dict[str, List[dict]] = {}
    for ph in phrases:
        by_section.setdefault(ph["section_id"], []).append(ph)
    for group in by_section.values():
        if not group:
            continue
        for ph in group:
            ph["position_label"] = "development"
        group[0]["position_label"] = "opening"
        if len(group) >= 2:
            energies = [ph["energy_mean"] for ph in group]
            peak_idx = int(np.argmax(energies))  # first max on ties
            if peak_idx > 0:
                group[peak_idx]["position_label"] = "peak"

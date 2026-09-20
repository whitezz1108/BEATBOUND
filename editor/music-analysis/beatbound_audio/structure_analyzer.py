"""Section / structure detection (prompt section 11).

The prompt is careful here: boundary detection, similarity and energy profiles
are the deliverable -- *not* automatic "this is a chorus" labelling. So this
module detects boundaries and summarises sections, and only attaches a semantic
label when the evidence is a plain energy statement ("high_energy_section").
Everything else stays ``label: null``.

Method: build a beat-synchronous feature matrix (MFCC + chroma + per-stem
activity), run a checkerboard-kernel novelty function over its self-similarity,
peak-pick, then **snap every boundary to the bar grid**. Snapping is what keeps
sections aligned with the runtime's bars, which is the whole reason the v1
analyzer used a constant grid in the first place.

When no tempo could be estimated (silence, or an unparseable track) the same
machinery runs on a fixed 2 s grid instead, so the analyzer still returns a
well-formed section list rather than nothing.
"""

from __future__ import annotations

from typing import List, Optional

import numpy as np

from . import config, util
from .results import (
    AudioContext,
    EnergyResult,
    MelodyResult,
    RhythmResult,
    StemFeatureResult,
    StructureResult,
    TonalResult,
)

#: Fallback segmentation grid when there is no usable beat grid.
_FALLBACK_FRAME_SEC = 2.0
#: A section is called high/low energy only outside this middle band.
_LABEL_HIGH = 0.66
_LABEL_LOW = 0.33


def _checkerboard_kernel(half: int) -> np.ndarray:
    """Gaussian-tapered checkerboard kernel, ``(2*half, 2*half)``.

    A Gaussian taper of length ``2*half`` is taken as the outer product, then
    the two diagonal quadrants are negated. Correlating this against a
    self-similarity matrix peaks where the music *before* a point resembles
    itself and the music *after* resembles itself, but the two sides do not
    resemble each other -- i.e. at a structural boundary.
    """
    n = 2 * half
    x = np.linspace(-2.0, 2.0, n)
    g = np.exp(-0.5 * x ** 2)
    g = g / g.sum()
    kernel = np.outer(g, g)
    kernel[:half, :half] *= -1.0
    kernel[half:, half:] *= -1.0
    return kernel


def _novelty(similarity: np.ndarray, half: int) -> np.ndarray:
    """Correlate a self-similarity matrix with the checkerboard kernel."""
    n = similarity.shape[0]
    out = np.zeros(n)
    if n < 2 * half:
        return out
    kernel = _checkerboard_kernel(half)
    for i in range(half, n - half):
        window = similarity[i - half : i + half, i - half : i + half]
        out[i] = float(np.sum(window * kernel))
    # Normalise to 0..1 for a stable threshold across songs.
    lo, hi = float(np.min(out)), float(np.max(out))
    if hi - lo < 1e-9:
        return np.zeros_like(out)
    return (out - lo) / (hi - lo)


def _frame_grid(rhythm: RhythmResult, ctx: AudioContext) -> np.ndarray:
    """Times at which to measure structure: beats when known, else fixed."""
    if rhythm.bpm and rhythm.n_beats >= 8:
        return np.asarray([b["time"] for b in rhythm.beats], dtype=float)
    n = max(2, int(ctx.duration / _FALLBACK_FRAME_SEC))
    return np.arange(n) * _FALLBACK_FRAME_SEC


def _aggregate(times: np.ndarray, values: np.ndarray, edges: np.ndarray) -> np.ndarray:
    """Mean of ``values`` between consecutive ``edges`` (NaN when empty)."""
    out = np.full(len(edges) - 1, np.nan)
    for i in range(len(edges) - 1):
        mask = (times >= edges[i]) & (times < edges[i + 1])
        if mask.any():
            seg = values[mask]
            seg = seg[np.isfinite(seg)]
            if seg.size:
                out[i] = float(np.mean(seg))
    return out


def _feature_matrix(
    grid: np.ndarray,
    ctx: AudioContext,
    tonal: TonalResult,
    stems: Optional[StemFeatureResult],
) -> np.ndarray:
    """Beat-synchronous feature matrix: MFCC + chroma + stem activity."""
    edges = np.concatenate([grid, [ctx.duration + 1.0]])

    blocks: List[np.ndarray] = []
    if tonal.mfcc.size:
        blocks.append(np.column_stack([
            _aggregate(tonal.mfcc_times, tonal.mfcc[k], edges)
            for k in range(tonal.mfcc.shape[0])
        ]))
    if tonal.chroma.size:
        blocks.append(np.column_stack([
            _aggregate(tonal.chroma_times, tonal.chroma[k], edges)
            for k in range(tonal.chroma.shape[0])
        ]))
    if stems is not None and stems.available and stems.curves:
        blocks.append(np.column_stack([
            _aggregate(stems.times, stems.curves[k], edges)
            for k in sorted(stems.curves)
        ]))

    if not blocks:
        return np.zeros((len(edges) - 1, 1))

    matrix = np.column_stack(blocks)
    # Missing frames break similarity; fill with the column mean.
    col_mean = np.nanmean(matrix, axis=0)
    col_mean = np.where(np.isfinite(col_mean), col_mean, 0.0)
    idx = np.where(~np.isfinite(matrix))
    matrix[idx] = np.take(col_mean, idx[1])
    return matrix


def _self_similarity(matrix: np.ndarray) -> np.ndarray:
    """Cosine self-similarity, robust to all-zero rows."""
    norms = np.linalg.norm(matrix, axis=1, keepdims=True)
    norms[norms < 1e-9] = 1.0
    unit = matrix / norms
    sim = unit @ unit.T
    return np.nan_to_num(sim, nan=0.0)


def _snap_to_bars(times: List[float], rhythm: RhythmResult) -> List[float]:
    """Snap boundary times onto the bar grid (no-op without a grid)."""
    bounds = rhythm.bar_bounds
    if bounds is None or len(bounds) < 2:
        return times
    snapped: List[float] = []
    for t in times:
        nearest = float(bounds[int(np.argmin(np.abs(bounds - t)))])
        if not snapped or nearest > snapped[-1] + 1e-6:
            snapped.append(nearest)
    return snapped


def _pick_boundaries(
    novelty: np.ndarray, grid: np.ndarray, min_sep_sec: float
) -> List[float]:
    """Peak-pick novelty with a minimum separation."""
    if novelty.size == 0:
        return []
    threshold = float(np.mean(novelty)) + config.NOVELTY_PEAK_STD * float(np.std(novelty))
    picked: List[int] = []
    for i in range(1, novelty.size - 1):
        if novelty[i] < threshold:
            continue
        if novelty[i] < novelty[i - 1] or novelty[i] <= novelty[i + 1]:
            continue
        if picked and (grid[i] - grid[picked[-1]]) < min_sep_sec:
            if novelty[i] > novelty[picked[-1]]:
                picked[-1] = i
            continue
        picked.append(i)
    return [float(grid[i]) for i in picked]


def analyze_structure(
    ctx: AudioContext,
    rhythm: RhythmResult,
    tonal: TonalResult,
    energy: EnergyResult,
    stems: Optional[StemFeatureResult] = None,
    melody: Optional[MelodyResult] = None,
) -> StructureResult:
    """Detect section boundaries and summarise each section."""
    warnings: list[str] = []

    grid = _frame_grid(rhythm, ctx)
    if grid.size < 2:
        return StructureResult(
            sections=[],
            boundaries=[],
            novelty=np.zeros(0),
            novelty_times=grid,
            method="none",
            warnings=["audio too short for structure analysis"],
        )

    matrix = _feature_matrix(grid, ctx, tonal, stems)
    similarity = _self_similarity(matrix)
    half = max(2, min(config.NOVELTY_KERNEL // 2, grid.size // 4))
    novelty = _novelty(similarity, half)

    has_grid = bool(rhythm.bpm and rhythm.n_beats >= 8)
    min_sep = (
        config.MIN_SECTION_BARS * rhythm.beat_len * rhythm.time_signature[0]
        if has_grid and rhythm.beat_len
        else config.MIN_SECTION_SEC
    )

    raw_boundaries = _pick_boundaries(novelty, grid, min_sep)
    method = "beat-sync-checkerboard" if has_grid else "fixed-grid-checkerboard"

    # Section edges: always start at 0 and end at the song's end.
    edges = [0.0] + _snap_to_bars(raw_boundaries, rhythm) + [float(ctx.duration)]
    # Drop anything that ended up too close to its neighbour after snapping.
    cleaned: List[float] = [edges[0]]
    for t in edges[1:-1]:
        if t - cleaned[-1] >= min_sep:
            cleaned.append(t)
    cleaned.append(edges[-1])

    sections: List[dict] = []
    for i in range(len(cleaned) - 1):
        start, end = cleaned[i], cleaned[i + 1]
        if end - start < 1e-6:
            continue
        sections.append(
            _summarise_section(
                f"section_{i + 1:02d}", start, end, rhythm, energy, stems, melody
            )
        )

    _apply_energy_labels(sections)

    if not sections:
        warnings.append("no sections could be derived")

    return StructureResult(
        sections=sections,
        boundaries=[s["start"] for s in sections[1:]],
        novelty=novelty,
        novelty_times=grid,
        method=method,
        warnings=warnings,
    )


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


def _summarise_section(
    section_id: str,
    start: float,
    end: float,
    rhythm: RhythmResult,
    energy: EnergyResult,
    stems: Optional[StemFeatureResult],
    melody: Optional[MelodyResult],
) -> dict:
    """Per-section feature summary, with ``None`` for anything unavailable."""
    e = _mean_between(energy.times, energy.rms_smooth, start, end)

    def stem_curve(name: str) -> Optional[float]:
        if stems is None or not stems.available:
            return None
        curve = stems.curves.get(name)
        if curve is None:
            return None
        return _mean_between(stems.times, curve, start, end)

    melodic = None
    if melody is not None and melody.available and melody.pitch_midi.size:
        voiced = np.isfinite(melody.pitch_midi)
        inside = (melody.pitch_times >= start) & (melody.pitch_times < end)
        if inside.any():
            # Fraction of *this section's* frames that carry a pitch. Dividing by
            # the whole song's frame count instead would shrink every section by
            # the same factor, making the number incomparable between sections
            # and unreadable next to the other per-section activity values.
            melodic = float(np.mean(voiced[inside]))

    # Bar range on the constant grid, when one exists.
    start_bar = end_bar = None
    if rhythm.bar_bounds is not None and len(rhythm.bar_bounds) > 1:
        bounds = rhythm.bar_bounds
        start_bar = int(np.clip(np.searchsorted(bounds, start), 1, len(bounds) - 1))
        end_bar = int(np.clip(np.searchsorted(bounds, end, side="left"), start_bar, len(bounds) - 1))

    return {
        "id": section_id,
        "start": util.fnum(start),
        "end": util.fnum(end),
        "durationSec": util.fnum(end - start),
        "label": None,
        "startBar": start_bar,
        "endBar": end_bar,
        "energy": util.fnum(e, 4),
        "drumActivity": util.fnum(stem_curve("drumsActivity"), 4),
        "bassActivity": util.fnum(stem_curve("bassActivity"), 4),
        "vocalActivity": util.fnum(stem_curve("vocalsActivity"), 4),
        "melodicActivity": util.fnum(melodic, 4),
    }


def _apply_energy_labels(sections: List[dict]) -> None:
    """Attach a *descriptive* label only where the energy profile is decisive.

    Prompt section 11: never write ``"chorus"``. A section may be called
    ``high_energy_section`` / ``low_energy_section`` when its mean energy sits
    clearly outside the middle band; otherwise the label stays ``null``.
    """
    values = [s["energy"] for s in sections if s["energy"] is not None]
    if len(values) < 3:
        return
    for s in sections:
        if s["energy"] is None:
            continue
        if s["energy"] >= _LABEL_HIGH:
            s["label"] = "high_energy_section"
        elif s["energy"] <= _LABEL_LOW:
            s["label"] = "low_energy_section"

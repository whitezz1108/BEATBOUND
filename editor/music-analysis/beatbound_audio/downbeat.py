"""Downbeat / bar-phase estimation (V2.1).

The constant beat/bar grid is anchored at audio time 0 -- deliberately, because
analysis bars must stay equal to the runtime's bars. But nothing guarantees the
music's *perceived* downbeat lands on beat 0 of each grid bar: the track may
start mid-bar, or the grid phase may simply be off by one or two beats.

This module answers one narrow question: within the grid bar, which beat
carries the strongest downbeat contrast? The answer is reported as
``offset_beats`` (0..bpb-1) with an honest confidence. The grid itself is never
shifted, and an explicit operator tempo/meter override keeps winning by
construction -- the phase is measured *on the declared grid*.

Confidence policy (prompt section 24): the value is the margin of the best
phase over the runner-up, squashed to 0..1. When there are too few beats, no
tempo, or no positive downbeat contrast at all, ``confidence`` is ``None`` /
``0.0`` and ``offset_beats`` is ``None`` -- an honest "unknown" instead of a
guess dressed up as a measurement.
"""

from __future__ import annotations

from typing import List, Optional

import numpy as np

from . import config, util
from .results import DownbeatResult, RhythmResult


def _phase_contrast(strengths: np.ndarray, bpb: int) -> dict:
    """Relative downbeat contrast for each candidate phase of the grid.

    For phase ``p``, the "downbeats" are grid beats whose index ``i`` satisfies
    ``(i - p) % bpb == 0``. The score compares their mean strength against the
    mean strength of all other beats, relative to that baseline -- the same
    shape ``rhythm_analyzer._estimate_meter`` uses at the meter level.
    """
    n = strengths.size
    scores: dict[int, float] = {}
    for p in range(bpb):
        idx = np.arange(n)
        down = (idx - p) % bpb == 0
        if down.sum() < 2 or (~down).sum() < 2:
            continue
        off = float(np.mean(strengths[~down]))
        if off <= 1e-9:
            continue
        scores[p] = (float(np.mean(strengths[down])) - off) / off
    return scores


def analyze_downbeats(rhythm: RhythmResult) -> DownbeatResult:
    """Estimate the bar phase from beat-strength contrast on the declared grid."""
    warnings: List[str] = []
    bpb = int(rhythm.time_signature[0])

    if rhythm.beat_len is None or rhythm.n_beats < config.DOWNBEAT_MIN_BEATS:
        return DownbeatResult(
            offset_beats=None,
            confidence=None,
            downbeats=[],
            method="none",
            warnings=["too few beats for a bar-phase estimate"],
        )

    strengths = np.asarray([b["strength"] or 0.0 for b in rhythm.beats], dtype=float)
    scores = _phase_contrast(strengths, bpb)

    if not scores:
        return DownbeatResult(
            offset_beats=None,
            confidence=None,
            downbeats=[],
            method="beat-strength-contrast",
            warnings=["beat strengths carry no usable downbeat contrast"],
        )

    # Deterministic: ties resolve to the lowest phase because of sort stability.
    ranked = sorted(scores.items(), key=lambda kv: kv[1], reverse=True)
    best_phase, best = ranked[0]

    if best <= 0.0:
        # Every phase is weaker on its downbeats than off them: the beat level
        # carries no metric information. Say so rather than picking one.
        return DownbeatResult(
            offset_beats=None,
            confidence=0.0,
            downbeats=[],
            method="beat-strength-contrast",
            warnings=["no positive downbeat contrast at any bar phase"],
        )

    runner = ranked[1][1] if len(ranked) > 1 else 0.0
    # Two honest components: the margin over the runner-up phase, and the
    # strength of the contrast itself (a 50% downbeat-over-offbeat edge counts
    # as full strength). A perfect margin on a weak contrast is still shaky.
    # The 0.95 ceiling says "never claim certainty" -- there is always a
    # downbeat detector that could be fooled by an anacrusis or a drop.
    margin = util.clamp01((best - max(runner, 0.0)) / (best + 1e-9))
    strength = util.clamp01(best / 0.5)
    confidence = util.fnum(0.95 * margin * (0.5 + 0.5 * strength), 4)

    downbeats: List[dict] = []
    offset_time = best_phase * rhythm.beat_len
    for bar in range(1, rhythm.n_bars + 1):
        t = (bar - 1) * bpb * rhythm.beat_len + offset_time
        if t > rhythm.beats[-1]["time"] + rhythm.beat_len:
            break
        downbeats.append({
            "bar": bar,
            "time": util.fnum(t),
            "confidence": confidence,
        })

    return DownbeatResult(
        offset_beats=int(best_phase),
        confidence=confidence,
        downbeats=downbeats,
        method="beat-strength-contrast",
        warnings=warnings,
    )

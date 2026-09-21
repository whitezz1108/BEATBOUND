"""Rhythm layer: tempo, the constant beat/bar grid, and onsets.

The **grid** is deliberately the same constant-tempo grid the v1 analyzer
produced and the same one the runtime's ``ConstantTempoMap`` builds: anchored at
audio time 0, ``beat_len = 60 / bpm``, bars of ``timeSignature[0]`` beats. That
identity is what keeps analysis bars == runtime bars, and it is why this module
reproduces the v1 arithmetic exactly rather than adopting a variable-tempo grid.

What is *new* here is the meter estimate. The declared ``timeSignature`` remains
the grid's parameter (default 4/4, overridable), but the analyzer also estimates
whether the music actually groups in 3 or 4 and reports it with a confidence --
so the honest answer "I am not sure this is 4/4" is expressible instead of being
hardcoded away (prompt section 6).
"""

from __future__ import annotations

from typing import List, Optional, Tuple

import numpy as np

from . import config, util
from .preprocess import sample_at
from .results import AudioContext, RhythmResult

#: Candidate meters for the downbeat-contrast estimate. 4 is the tie-break.
METER_CANDIDATES = (3, 4, 6)


def _estimate_meter(
    beat_strengths: np.ndarray,
) -> Tuple[Optional[int], float]:
    """Group beats by downbeat contrast.

    For each candidate ``k``, compare the mean onset strength of beats that
    would be downbeats against the rest. The candidate with the largest
    positive contrast wins; the confidence is the margin over the runner-up,
    squashed to 0..1. Returns ``(None, 0.0)`` when the beats carry no usable
    contrast at all -- an honest "unknown" beats a confident guess.
    """
    n = len(beat_strengths)
    if n < 2 * max(METER_CANDIDATES):
        return None, 0.0

    scores: dict[int, float] = {}
    for k in METER_CANDIDATES:
        idx = np.arange(n)
        down = idx % k == 0
        if down.sum() < 2 or (~down).sum() < 2:
            continue
        off = float(np.mean(beat_strengths[~down]))
        if off <= 1e-9:
            continue
        scores[k] = (float(np.mean(beat_strengths[down])) - off) / off

    if not scores:
        return None, 0.0

    ranked = sorted(scores.items(), key=lambda kv: kv[1], reverse=True)
    best_k, best = ranked[0]
    if best <= 0.0:
        # Every candidate is weaker on its downbeats than off them: the beat
        # level carries no metric information. Say so rather than picking one.
        return None, 0.0

    runner = ranked[1][1] if len(ranked) > 1 else 0.0
    margin = (best - max(runner, 0.0)) / (best + 1e-9)
    return best_k, util.clamp01(margin)


def analyze_rhythm(
    ctx: AudioContext,
    *,
    bpm_override: Optional[float] = None,
    time_sig: Tuple[int, int] = (4, 4),
) -> RhythmResult:
    """Tempo + constant grid + onset layer for ``ctx``."""
    import librosa

    warnings: list[str] = []
    bpb = int(time_sig[0])
    hop_times = librosa.times_like(
        np.zeros(1 + len(ctx.y) // config.HOP), sr=ctx.sr, hop_length=config.HOP
    )

    # ---- onset layer (needed for strength sampling and meter) --------------
    onset_env = librosa.onset.onset_strength(y=ctx.y, sr=ctx.sr, hop_length=config.HOP)
    onset_env_norm = util.percentile_norm(onset_env)
    onsets = librosa.onset.onset_detect(
        onset_envelope=onset_env, sr=ctx.sr, hop_length=config.HOP, backtrack=True
    )
    onset_times = hop_times[onsets] if len(onsets) else np.zeros(0)
    onset_strengths = (
        util.percentile_norm(onset_env[onsets]) if len(onsets) else np.zeros(0)
    )

    # ---- tempo -------------------------------------------------------------
    bpm: Optional[float]
    confidence: Optional[float]
    if bpm_override:
        bpm = float(bpm_override)
        confidence = 1.0
    elif ctx.silent:
        # v1 divided by this and crashed. Silence is a real input; report it.
        bpm = None
        confidence = 0.0
        warnings.append("audio is silent -- no tempo could be estimated")
    else:
        est, _ = librosa.beat.beat_track(y=ctx.y, sr=ctx.sr, trim=False)
        raw = float(np.atleast_1d(est)[0])
        if not np.isfinite(raw) or raw <= 0.0:
            bpm = None
            confidence = 0.0
            warnings.append("tempo detection returned no usable value")
        else:
            bpm = round(raw, 2)
            confidence = _tempo_confidence(onset_env, ctx.sr, bpm)

    # ---- constant grid -----------------------------------------------------
    if bpm is None:
        beat_len: Optional[float] = None
        n_beats = 0
        n_bars = 0
        beat_times = np.zeros(0)
    else:
        beat_len = 60.0 / bpm
        n_beats = int(ctx.duration // beat_len)
        beat_times = np.arange(n_beats) * beat_len
        n_bars = max(1, n_beats // bpb)

    beats: List[dict] = []
    beat_strengths = np.zeros(n_beats)
    for i, t in enumerate(beat_times):
        s = sample_at(hop_times, onset_env_norm, float(t))
        beat_strengths[i] = s
        beats.append({
            "index": i,
            "time": util.fnum(t),
            "bar": i // bpb + 1,
            "beat": i % bpb + 1,
            "beatInBar": i % bpb + 1,
            "isDownbeat": (i % bpb) == 0,
            "strength": util.fnum(s, 4),
        })

    meter, meter_conf = _estimate_meter(beat_strengths)
    if meter is not None and meter != bpb and meter_conf >= 0.35:
        warnings.append(
            f"meter estimate suggests {meter}/4 but the grid uses {bpb}/4 "
            f"(confidence {meter_conf:.2f}); the declared time signature wins "
            f"so analysis bars stay equal to runtime bars"
        )

    bar_bounds = (
        np.arange(n_bars + 1) * bpb * beat_len
        if beat_len is not None
        else np.zeros(0)
    )

    return RhythmResult(
        bpm=bpm,
        tempo_confidence=util.fnum(confidence, 4),
        time_signature=(bpb, int(time_sig[1])),
        meter_confidence=util.fnum(meter_conf, 4) or 0.0,
        beat_len=beat_len,
        n_beats=n_beats,
        n_bars=n_bars,
        beats=beats,
        bar_bounds=bar_bounds,
        hop_times=hop_times,
        onset_env=onset_env,
        onset_env_norm=onset_env_norm,
        onsets=[
            {"time": util.fnum(t), "strength": util.fnum(s, 4)}
            for t, s in zip(onset_times, onset_strengths)
        ],
        onset_times=np.asarray(onset_times, dtype=float),
        onset_strengths=np.asarray(onset_strengths, dtype=float),
        silent=ctx.silent,
    )


def _tempo_confidence(onset_env: np.ndarray, sr: int, bpm: float) -> float:
    """How periodic the onset envelope is at the detected tempo.

    Measures the mean onset strength that lands on the detected beat grid
    against the envelope's overall mean. A track whose energy does not line up
    with its own beat grid scores low, which is exactly the signal the caller
    wants before trusting a BPM.
    """
    if onset_env.size == 0 or bpm <= 0:
        return 0.0
    beat_frames = np.arange(0, onset_env.size, max(1, int(round(60.0 / bpm * sr / config.HOP))))
    beat_frames = beat_frames[beat_frames < onset_env.size]
    if beat_frames.size < 4:
        return 0.0
    on_beat = float(np.mean(onset_env[beat_frames]))
    overall = float(np.mean(onset_env))
    if overall <= 1e-9:
        return 0.0
    return util.clamp01((on_beat / overall) / 2.0)

"""Energy layer: a continuous loudness curve, not a single number.

Prompt section 7 is explicit that energy must be a timeline. This module keeps
the raw RMS (for musicology / debug) and publishes a percentile-normalised,
smoothed 0..1 curve (for downstream consumers), plus the two global scalars the
schema asks for: ``overallEnergy`` and ``dynamicRange``.
"""

from __future__ import annotations

from typing import Optional

import numpy as np

from . import config, util
from .results import AudioContext, EnergyResult


def analyze_energy(ctx: AudioContext) -> EnergyResult:
    """RMS / loudness curves for ``ctx``."""
    import librosa

    rms = librosa.feature.rms(y=ctx.y, hop_length=config.HOP)[0]
    times = librosa.times_like(rms, sr=ctx.sr, hop_length=config.HOP)

    rms_norm = util.percentile_norm(rms)
    # ~0.5 s smoothing at the feature rate, so the curve reads as loudness
    # rather than per-frame jitter.
    win = max(1, int(round(0.5 * ctx.sr / config.HOP)))
    rms_smooth = util.smooth(rms_norm, win)

    amp = np.maximum(rms, 1e-10)
    loudness_db = 20.0 * np.log10(amp)

    if ctx.silent or rms.size == 0:
        overall: Optional[float] = 0.0
        dyn: Optional[float] = None
        loud_range: Optional[float] = None
    else:
        overall = util.fnum(float(np.mean(rms_smooth)), 4)
        p95, p05 = float(np.percentile(rms, 95)), float(np.percentile(rms, 5))
        dyn = util.fnum(util.clamp01((p95 - p05) / max(p95, 1e-9)), 4)
        hi, lo = float(np.percentile(loudness_db, 95)), float(np.percentile(loudness_db, 5))
        loud_range = util.fnum(hi - lo, 2)

    t_ds, v_ds = util.downsample(times, rms_smooth, config.ENERGY_POINTS)
    timeline = [
        {"time": util.fnum(t), "value": util.fnum(v, 4)}
        for t, v in zip(t_ds, v_ds)
    ]

    return EnergyResult(
        rms=rms,
        rms_norm=rms_norm,
        rms_smooth=rms_smooth,
        times=times,
        timeline=timeline,
        overall_energy=overall,
        dynamic_range=dyn,
        loudness_db=loudness_db,
        loudness_range_db=loud_range,
    )

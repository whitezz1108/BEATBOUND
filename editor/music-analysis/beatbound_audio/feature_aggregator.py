"""Feature aggregator (prompt sections 13 and 14).

Produces the two things the schema needs on top of the per-layer results:

* the **global** summary block, and
* the **unified window timeline** -- a fixed-rate grid where every feature the
  director might want is already resampled onto the same clock, so nothing
  downstream ever has to touch raw audio again.

Normalisation policy (prompt section 14) is applied here and stated once:
every field published in a window is 0..1 and safe to compare across songs.
Raw values (Hz, MIDI, seconds, BPM) stay in the per-layer blocks where they are
useful for musicology and debugging.
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
    TonalResult,
)

#: Stem activity below this is "not playing" for the window's flags.
_STEM_FLAG_MIN = 0.25


def _sample(times: np.ndarray, values: np.ndarray, t: float) -> Optional[float]:
    """Nearest-sample lookup that returns None when the grid is empty."""
    if times.size == 0 or values.size == 0:
        return None
    idx = int(np.clip(np.searchsorted(times, t), 0, values.size - 1))
    v = values[idx]
    return float(v) if np.isfinite(v) else None


def _sample_pitch(melody: Optional[MelodyResult], t: float) -> Optional[float]:
    """Nearest *voiced* normalised pitch at ``t``, else None.

    Unvoiced frames must not be interpolated across: a gap in the melody is a
    real musical fact, and filling it with the previous note would invent one.
    """
    if melody is None or not melody.available or melody.pitch_norm.size == 0:
        return None
    times = melody.pitch_times
    if times.size == 0:
        return None
    idx = int(np.clip(np.searchsorted(times, t), 0, times.size - 1))
    # Look a short way either side for the nearest voiced frame.
    span = max(1, int(round(0.25 * 86.0)))
    for off in range(0, span):
        for j in (idx - off, idx + off):
            if 0 <= j < melody.pitch_norm.size and np.isfinite(melody.pitch_norm[j]):
                return float(melody.pitch_norm[j])
    return None


def build_windows(
    ctx: AudioContext,
    energy: EnergyResult,
    tonal: TonalResult,
    melody: Optional[MelodyResult],
    stems: Optional[StemFeatureResult],
) -> List[dict]:
    """Fixed-rate unified timeline (default 500 ms / 250 ms hop)."""
    if ctx.duration <= 0:
        return []

    step = config.WINDOW_HOP_SEC
    n = int(ctx.duration / step) + 1
    times = np.arange(n) * step

    brightness_curve = None
    if tonal.centroid_hz.size and tonal.centroid_times.size:
        lo, hi = np.log10(60.0), np.log10(8000.0)
        brightness_curve = np.clip(
            (np.log10(np.maximum(tonal.centroid_hz, 60.0)) - lo) / (hi - lo), 0.0, 1.0
        )

    stem_curves = stems.curves if (stems is not None and stems.available) else {}

    windows: List[dict] = []
    for t in times:
        w = {
            "time": util.fnum(t),
            "energy": util.fnum(_sample(energy.times, energy.rms_smooth, t), 4),
            "drumActivity": util.fnum(
                _sample(stems.times, stem_curves["drumsActivity"], t), 4
            ) if "drumsActivity" in stem_curves else None,
            "bassActivity": util.fnum(
                _sample(stems.times, stem_curves["bassActivity"], t), 4
            ) if "bassActivity" in stem_curves else None,
            "vocalActivity": util.fnum(
                _sample(stems.times, stem_curves["vocalsActivity"], t), 4
            ) if "vocalsActivity" in stem_curves else None,
            "melodicActivity": util.fnum(
                _sample(stems.times, stem_curves["otherActivity"], t), 4
            ) if "otherActivity" in stem_curves else None,
            "pitchNormalized": util.fnum(_sample_pitch(melody, t), 4),
            "brightness": util.fnum(_sample(tonal.centroid_times, brightness_curve, t), 4)
            if brightness_curve is not None else None,
        }
        windows.append(w)

    return windows


def build_global(
    ctx: AudioContext,
    rhythm: RhythmResult,
    energy: EnergyResult,
    tonal: TonalResult,
    melody: Optional[MelodyResult],
    stems: Optional[StemFeatureResult],
) -> dict:
    """The ``global`` block (prompt section 5).

    Anything that could not be estimated is ``null`` -- never a plausible
    substitute. ``rhythmicDensity`` is onsets per second scaled against a fixed
    reference; ``melodicDensity`` comes from the melody layer.
    """
    rhythmic_density: Optional[float] = None
    if ctx.duration > 0 and not ctx.silent:
        rhythmic_density = util.fnum(
            util.clamp01((len(rhythm.onsets) / ctx.duration) / 6.0), 4
        )

    return {
        "bpm": util.fnum(rhythm.bpm, 2),
        "tempoConfidence": util.fnum(rhythm.tempo_confidence, 4),
        "key": tonal.key,
        "scale": tonal.scale,
        "keyConfidence": util.fnum(tonal.key_confidence, 4),
        "overallEnergy": util.fnum(energy.overall_energy, 4),
        "dynamicRange": util.fnum(energy.dynamic_range, 4),
        "brightness": util.fnum(tonal.brightness, 4),
        "rhythmicDensity": rhythmic_density,
        "melodicDensity": util.fnum(melody.note_density, 4) if melody is not None and melody.available else None,
        "meterConfidence": util.fnum(rhythm.meter_confidence, 4),
        "silent": bool(ctx.silent),
    }

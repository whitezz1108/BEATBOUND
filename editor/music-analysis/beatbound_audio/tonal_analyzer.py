"""Tonal / timbre layer: chroma, key/scale, brightness, band balance.

Prompt section 10: these features exist to describe musical atmosphere for a
future director or visual theme system. Nothing here drives gameplay.

The key estimate is a Krumhansl-Schmuckler style correlation of the mean chroma
against major/minor profiles. It reports ``None`` when the chroma is too flat
for any key to stand out -- the schema's way of saying "not reliably
estimated", which prompt section 5 explicitly prefers over a fabricated answer.
"""

from __future__ import annotations

from typing import List, Optional, Tuple

import numpy as np

from . import config, util
from .results import AudioContext, TonalResult
from .preprocess import Spectrogram

#: Krumhansl-Schmuckler key profiles.
_MAJOR_PROFILE = np.array(
    [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88]
)
_MINOR_PROFILE = np.array(
    [6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17]
)
_PITCH_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]

#: Minimum correlation a key must reach before it is reported at all.
KEY_MIN_CORRELATION = 0.45
#: Minimum gap over the runner-up key before we trust the winner.
KEY_MIN_MARGIN = 0.04

#: Band edges for the low / mid / high balance, in Hz.
_BAND_LOW = (20.0, 250.0)
_BAND_MID = (250.0, 2000.0)
_BAND_HIGH = (2000.0, 11025.0)


def _estimate_key(
    chroma_mean: np.ndarray,
) -> Tuple[Optional[str], Optional[str], Optional[float]]:
    """Correlate mean chroma against rotated key profiles.

    Returns ``(key, scale, confidence)`` with ``(None, None, None)`` when the
    chroma carries no clear tonal centre.
    """
    c = np.asarray(chroma_mean, dtype=float)
    if c.size != 12 or not np.isfinite(c).all():
        return None, None, None
    c = c - c.mean()
    if float(np.max(np.abs(c))) < 1e-9:
        return None, None, None

    scored: list[tuple[float, int, str]] = []
    for shift in range(12):
        for profile, scale in ((_MAJOR_PROFILE, "major"), (_MINOR_PROFILE, "minor")):
            rotated = np.roll(profile, shift)
            r = float(np.corrcoef(c, rotated - rotated.mean())[0, 1])
            if np.isfinite(r):
                scored.append((r, shift, scale))
    if not scored:
        return None, None, None

    scored.sort(key=lambda t: t[0], reverse=True)
    best_r, best_shift, best_scale = scored[0]
    runner_r = scored[1][0] if len(scored) > 1 else 0.0
    if best_r < KEY_MIN_CORRELATION or (best_r - runner_r) < KEY_MIN_MARGIN:
        return None, None, util.fnum(util.clamp01(max(best_r, 0.0)), 4)

    return (
        _PITCH_NAMES[best_shift],
        best_scale,
        util.fnum(util.clamp01(best_r), 4),
    )


def _band_balance(mag: np.ndarray, freqs: np.ndarray) -> dict:
    """Fraction of spectral energy in the low / mid / high bands."""
    power = (mag ** 2).mean(axis=1) if mag.ndim == 2 else mag ** 2
    total = float(power.sum())
    if total <= 1e-12:
        return {"low": None, "mid": None, "high": None}

    def frac(lo: float, hi: float) -> float:
        mask = (freqs >= lo) & (freqs < hi)
        return float(power[mask].sum()) / total

    low, mid, high = frac(*_BAND_LOW), frac(*_BAND_MID), frac(*_BAND_HIGH)
    s = low + mid + high
    if s <= 1e-12:
        return {"low": None, "mid": None, "high": None}
    return {
        "low": util.fnum(low / s, 4),
        "mid": util.fnum(mid / s, 4),
        "high": util.fnum(high / s, 4),
    }


def analyze_tonal(ctx: AudioContext, spec: Spectrogram) -> TonalResult:
    """Chroma, key, timbre descriptors for ``ctx``."""
    import librosa

    warnings: list[str] = []

    chroma = librosa.feature.chroma_cqt(y=ctx.y, sr=ctx.sr, hop_length=config.HOP)
    chroma_mean = np.mean(chroma, axis=1)
    if chroma_mean.sum() > 1e-9:
        chroma_mean = chroma_mean / chroma_mean.sum()
    key, scale, key_conf = _estimate_key(chroma_mean)
    if key is None:
        warnings.append("no reliable tonal centre -- key reported as null")

    centroid = librosa.feature.spectral_centroid(
        S=spec.mag, sr=ctx.sr, hop_length=config.HOP
    )[0]
    contrast = librosa.feature.spectral_contrast(
        S=spec.mag, sr=ctx.sr, hop_length=config.HOP
    )
    mfcc = librosa.feature.mfcc(S=spec.mel_db, n_mfcc=13)

    if ctx.silent or centroid.size == 0:
        brightness: Optional[float] = 0.0
        centroid_mean: Optional[float] = None
    else:
        # Log-scaled centroid mapped onto the audible band -> 0..1.
        centroid_mean = util.fnum(float(np.mean(centroid)), 2)
        lo, hi = np.log10(60.0), np.log10(8000.0)
        brightness = util.fnum(
            util.clamp01((np.log10(max(float(np.mean(centroid)), 60.0)) - lo) / (hi - lo)), 4
        )

    return TonalResult(
        available=True,
        chroma=chroma,
        chroma_times=spec.times,
        chroma_mean=[util.fnum(v, 6) for v in chroma_mean],
        key=key,
        scale=scale,
        key_confidence=key_conf,
        centroid_hz=centroid,
        centroid_times=spec.times,
        centroid_mean_hz=centroid_mean,
        brightness=brightness,
        contrast_mean=[util.fnum(v, 4) for v in np.mean(contrast, axis=1)],
        band_balance=_band_balance(spec.mag, spec.freqs),
        mfcc=mfcc,
        mfcc_times=spec.times,
        warnings=warnings,
    )

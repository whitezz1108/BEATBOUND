"""Per-stem musical descriptors (prompt section 8).

Each stem gets a shared set of curves on one hop grid, so the aggregator can
build a single window timeline without resampling anything.

Normalisation choice, stated explicitly because it is a design decision: stem
levels are scaled **against the loudest stem**, not against each stem's own
percentiles. Self-normalisation would make every stem average ~0.5 and destroy
exactly the comparison the report wants ("drums 0.74 / bass 0.63 / vocals
0.48"). So ``activity`` means "this stem's typical level relative to the
dominant stem in this song", and the curves keep that same shared scale.

Drum piece classification is a **heuristic** and is named ``*Like`` with an
explicit confidence, per the prompt's instruction not to dress it up as real
drum transcription.
"""

from __future__ import annotations

from typing import Dict, List, Optional

import numpy as np

from . import config, util
from .preprocess import sample_at
from .results import StemFeatureResult, StemResult

#: Band edges for the crude drum-piece split, in Hz.
_KICK_MAX = 150.0
_SNARE_MAX = 2000.0
#: Bass "low-frequency intensity" ceiling.
_BASS_LOW_MAX = 250.0
#: Minimum length of a vocal phrase / gap, in seconds.
_VOCAL_MIN_PHRASE = 0.8
_VOCAL_MIN_GAP = 0.4


def _stem_curves(y: np.ndarray, sr: int, hop: int):
    """RMS and onset-strength curves for one stem on the shared hop grid."""
    import librosa

    rms = librosa.feature.rms(y=y, hop_length=hop)[0]
    onset_env = librosa.onset.onset_strength(y=y, sr=sr, hop_length=hop)
    times = librosa.times_like(rms, sr=sr, hop_length=hop)
    return times, rms, onset_env


def _runs(mask: np.ndarray, times: np.ndarray, min_len_sec: float) -> List[tuple]:
    """Contiguous True runs in ``mask`` at least ``min_len_sec`` long."""
    out: List[tuple] = []
    if mask.size == 0:
        return out
    idx = np.flatnonzero(np.diff(np.concatenate(([0], mask.view(np.int8), [0]))))
    for start, end in zip(idx[::2], idx[1::2]):
        if end - start < 2:
            continue
        t0, t1 = float(times[start]), float(times[min(end, len(times) - 1)])
        if (t1 - t0) >= min_len_sec:
            out.append((t0, t1))
    return out


def _drum_piece_share(
    y: np.ndarray, sr: int, hop: int, onset_frames: np.ndarray
) -> dict:
    """Crude kick / snare / high-percussion share at the detected drum onsets.

    For each onset frame, the spectral energy is split into three bands and the
    onset is attributed to whichever dominates. This is a spectral heuristic,
    not drum transcription: it is reported with ``confidence: "low"`` and
    ``method`` so no consumer mistakes it for ground truth.
    """
    import librosa

    if len(onset_frames) == 0:
        return {
            "kickLike": 0.0,
            "snareLike": 0.0,
            "highPercussionLike": 0.0,
            "counts": {"kickLike": 0, "snareLike": 0, "highPercussionLike": 0},
            "confidence": "low",
            "method": "spectral-band-heuristic",
        }

    stft = np.abs(librosa.stft(y, n_fft=config.N_FFT, hop_length=hop))
    freqs = librosa.fft_frequencies(sr=sr, n_fft=config.N_FFT)
    low = freqs < _KICK_MAX
    mid = (freqs >= _KICK_MAX) & (freqs < _SNARE_MAX)
    high = freqs >= _SNARE_MAX

    frames = np.clip(onset_frames, 0, stft.shape[1] - 1)
    e_low = stft[low][:, frames].sum(axis=0)
    e_mid = stft[mid][:, frames].sum(axis=0)
    e_high = stft[high][:, frames].sum(axis=0)
    stacked = np.stack([e_low, e_mid, e_high], axis=0)
    total = stacked.sum(axis=0)
    winner = np.argmax(stacked, axis=0)

    # Only count onsets with real energy; a silent frame is not a kick.
    valid = total > 1e-6
    counts = {
        "kickLike": int(np.sum(valid & (winner == 0))),
        "snareLike": int(np.sum(valid & (winner == 1))),
        "highPercussionLike": int(np.sum(valid & (winner == 2))),
    }
    n = max(1, sum(counts.values()))
    return {
        "kickLike": util.fnum(counts["kickLike"] / n, 4),
        "snareLike": util.fnum(counts["snareLike"] / n, 4),
        "highPercussionLike": util.fnum(counts["highPercussionLike"] / n, 4),
        "counts": counts,
        "confidence": "low",
        "method": "spectral-band-heuristic",
    }


def analyze_stems(stems: StemResult) -> StemFeatureResult:
    """Derive per-stem descriptors from separated audio."""
    import librosa

    if not stems.available or not stems.signals:
        return StemFeatureResult(
            available=False,
            backend=stems.backend,
            times=np.zeros(0),
            curves={},
            onsets={},
            activity={name: None for name in ("drums", "bass", "vocals", "other")},
            drums=_unavailable_block(),
            bass=_unavailable_block(),
            vocals=_unavailable_block(),
            other=_unavailable_block(),
            warnings=list(stems.warnings),
        )

    sr, hop = stems.sr, config.STEM_HOP
    warnings: list[str] = list(stems.warnings)

    raw: Dict[str, tuple] = {}
    for name, y in stems.signals.items():
        raw[name] = _stem_curves(y, sr, hop)

    times = next(iter(raw.values()))[0]

    # Shared scale: the loudest stem by mean RMS. This is what makes the
    # per-stem activity numbers comparable to each other.
    means = {name: float(np.mean(curves[1])) for name, curves in raw.items()}
    scale = max(means.values()) if means else 0.0
    if scale <= 1e-12:
        scale = 1.0
        warnings.append("all stems are silent -- stem activity reported as 0")

    smooth_win = max(1, int(round(0.4 * sr / hop)))
    curves: Dict[str, np.ndarray] = {}
    onset_curves: Dict[str, np.ndarray] = {}
    for name, (_t, rms, onset_env) in raw.items():
        curves[f"{name}Activity"] = np.clip(
            util.smooth(rms / scale, smooth_win), 0.0, 1.0
        )
        onset_curves[name] = util.smooth(util.percentile_norm(onset_env), smooth_win)

    # ---- drums -------------------------------------------------------------
    drum_y = stems.signals.get("drums")
    if drum_y is not None:
        drum_onsets = librosa.onset.onset_detect(
            y=drum_y, sr=sr, hop_length=hop, backtrack=True
        )
        drum_env = librosa.onset.onset_strength(y=drum_y, sr=sr, hop_length=hop)
        drum_times = librosa.times_like(drum_env, sr=sr, hop_length=hop)
        drum_strength = (
            util.percentile_norm(drum_env[drum_onsets]) if len(drum_onsets) else np.zeros(0)
        )
        onset_list = [
            {"time": util.fnum(drum_times[i]), "strength": util.fnum(s, 4)}
            for i, s in zip(drum_onsets, drum_strength)
        ]
        # Local density: onsets per second in a 2 s sliding window.
        dens = np.zeros_like(drum_env)
        win = max(1, int(round(2.0 * sr / hop)))
        counts = np.zeros_like(drum_env)
        if len(drum_onsets):
            np.add.at(counts, drum_onsets, 1.0)
        dens = util.smooth(counts, win) * (sr / hop)
        drums = {
            "available": True,
            "onsetCount": len(onset_list),
            "onsets": onset_list,
            "activity": util.fnum(float(np.mean(curves.get("drumsActivity", [0.0]))), 4),
            "density": util.fnum(float(np.mean(dens)), 4),
            "densityPeak": util.fnum(float(np.max(dens)) if dens.size else 0.0, 4),
            "pieces": _drum_piece_share(drum_y, sr, hop, np.asarray(drum_onsets, dtype=int)),
        }
        curves["drumsDensity"] = util.unit_norm(dens)
        onsets_out = {"drums": onset_list}
    else:
        drums = _unavailable_block()
        onsets_out = {}

    # ---- bass --------------------------------------------------------------
    bass_y = stems.signals.get("bass")
    if bass_y is not None:
        stft = np.abs(librosa.stft(bass_y, n_fft=config.N_FFT, hop_length=hop))
        freqs = librosa.fft_frequencies(sr=sr, n_fft=config.N_FFT)
        low_mask = freqs < _BASS_LOW_MAX
        low_e = stft[low_mask].sum(axis=0)
        total_e = stft.sum(axis=0)
        ratio = np.divide(low_e, total_e, out=np.zeros_like(low_e), where=total_e > 1e-9)
        bass_onsets = librosa.onset.onset_detect(
            y=bass_y, sr=sr, hop_length=hop, backtrack=True
        )
        bass_env = librosa.onset.onset_strength(y=bass_y, sr=sr, hop_length=hop)
        bass_times = librosa.times_like(bass_env, sr=sr, hop_length=hop)
        bass_strength = (
            util.percentile_norm(bass_env[bass_onsets]) if len(bass_onsets) else np.zeros(0)
        )
        bass = {
            "available": True,
            "onsetCount": int(len(bass_onsets)),
            "activity": util.fnum(float(np.mean(curves.get("bassActivity", [0.0]))), 4),
            "lowFrequencyIntensity": util.fnum(float(np.mean(ratio)), 4),
            "onsets": [
                {"time": util.fnum(bass_times[i]), "strength": util.fnum(s, 4)}
                for i, s in zip(bass_onsets, bass_strength)
            ],
        }
        onsets_out["bass"] = bass["onsets"]
    else:
        bass = _unavailable_block()

    # ---- vocals ------------------------------------------------------------
    vocals_y = stems.signals.get("vocals")
    if vocals_y is not None:
        act = curves.get("vocalsActivity", np.zeros_like(times))
        # Hysteresis: enter at the threshold, leave only once the curve has
        # fallen to half of it. A single threshold on a near-silent stem
        # flickers, and every flicker would otherwise become a vocal entry.
        active = _hysteresis(act, config.VOCAL_ACTIVE_MIN, config.VOCAL_ACTIVE_MIN * 0.5)
        runs = _runs(active, times, _VOCAL_MIN_PHRASE)
        phrases = [
            {"start": util.fnum(a), "end": util.fnum(b), "durationSec": util.fnum(b - a)}
            for a, b in runs
        ]
        gaps = [
            {"start": util.fnum(a), "end": util.fnum(b), "durationSec": util.fnum(b - a)}
            for a, b in _runs(~active, times, _VOCAL_MIN_GAP)
        ]
        # Entries / exits come from the *surviving* phrases, so a blip shorter
        # than a vocal phrase never reports as a vocal entry.
        entries = [{"time": util.fnum(a)} for a, _b in runs]
        exits = [{"time": util.fnum(b)} for _a, b in runs]
        vocals = {
            "available": True,
            "activity": util.fnum(float(np.mean(act)), 4),
            "activeRatio": util.fnum(float(np.mean(active)), 4),
            "phraseCount": len(phrases),
            "phrases": phrases,
            "entries": entries,
            "exits": exits,
            "silenceGaps": gaps,
            "lyrics": None,   # prompt section 8: no lyric recognition this round
        }
        onsets_out["vocals"] = entries
    else:
        vocals = _unavailable_block()

    # ---- other (melody candidate / harmonic material) ----------------------
    other_y = stems.signals.get("other")
    if other_y is not None:
        other_env = librosa.onset.onset_strength(y=other_y, sr=sr, hop_length=hop)
        other_times = librosa.times_like(other_env, sr=sr, hop_length=hop)
        other_onsets = librosa.onset.onset_detect(
            y=other_y, sr=sr, hop_length=hop, backtrack=True
        )
        other_strength = (
            util.percentile_norm(other_env[other_onsets]) if len(other_onsets) else np.zeros(0)
        )
        other = {
            "available": True,
            "onsetCount": int(len(other_onsets)),
            "activity": util.fnum(float(np.mean(curves.get("otherActivity", [0.0]))), 4),
            "harmonicActivity": util.fnum(
                float(np.mean(util.percentile_norm(other_env))), 4
            ),
            "onsets": [
                {"time": util.fnum(other_times[i]), "strength": util.fnum(s, 4)}
                for i, s in zip(other_onsets, other_strength)
            ],
        }
        onsets_out["other"] = other["onsets"]
    else:
        other = _unavailable_block()

    activity = {
        name: util.fnum(float(np.mean(curves.get(f"{name}Activity", [0.0]))), 4)
        for name in ("drums", "bass", "vocals", "other")
    }

    return StemFeatureResult(
        available=True,
        backend=stems.backend,
        times=times,
        curves=curves,
        onsets=onsets_out,
        activity=activity,
        drums=drums,
        bass=bass,
        vocals=vocals,
        other=other,
        warnings=warnings,
    )


def _hysteresis(curve: np.ndarray, high: float, low: float) -> np.ndarray:
    """Boolean mask that turns on above ``high`` and off only below ``low``."""
    out = np.zeros(curve.shape, dtype=bool)
    on = False
    for i, v in enumerate(curve):
        if on:
            if v < low:
                on = False
        elif v >= high:
            on = True
        out[i] = on
    return out


def _entries_exits(active: np.ndarray, times: np.ndarray) -> tuple[List[dict], List[dict]]:
    """Entry / exit times (raw transitions in a boolean mask)."""
    entries: List[dict] = []
    exits: List[dict] = []
    if active.size == 0:
        return entries, exits
    edges = np.diff(active.astype(np.int8))
    for i in np.flatnonzero(edges == 1):
        entries.append({"time": util.fnum(times[min(i + 1, len(times) - 1)])})
    for i in np.flatnonzero(edges == -1):
        exits.append({"time": util.fnum(times[min(i + 1, len(times) - 1)])})
    return entries, exits


def _unavailable_block() -> dict:
    return {"available": False}

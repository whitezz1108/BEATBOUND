"""Synthetic layer-result factories for the V2.1 unit tests.

The real analyzers are exercised by the integration tests; the repetition /
downbeat / phrasing unit tests need *controlled* inputs -- a section whose
chroma is exactly one pitch class, beats whose downbeat phase is exactly 2 --
so their assertions are about the algorithm, not about librosa.
"""

from __future__ import annotations

from typing import List, Optional, Sequence, Tuple

import numpy as np

from beatbound_audio.results import (
    EnergyResult,
    RhythmResult,
    StemFeatureResult,
    StructureResult,
    TonalResult,
)


def make_rhythm(
    onset_times: Sequence[float],
    onset_strengths: Sequence[float],
    *,
    time_sig: Tuple[int, int] = (4, 4),
    bpm: float = 120.0,
    duration: float = 60.0,
) -> RhythmResult:
    beat_len = 60.0 / bpm
    bpb = time_sig[0]
    n_beats = int(duration // beat_len)
    beats = [
        {
            "index": i,
            "time": round(i * beat_len, 6),
            "bar": i // bpb + 1,
            "beat": i % bpb + 1,
            "beatInBar": i % bpb + 1,
            "isDownbeat": (i % bpb) == 0,
            "strength": 0.5,
        }
        for i in range(n_beats)
    ]
    n_bars = max(1, n_beats // bpb)
    return RhythmResult(
        bpm=bpm,
        tempo_confidence=0.9,
        time_signature=time_sig,
        meter_confidence=0.5,
        beat_len=beat_len,
        n_beats=n_beats,
        n_bars=n_bars,
        beats=beats,
        bar_bounds=np.arange(n_bars + 1) * bpb * beat_len,
        hop_times=np.arange(int(duration * 43)) / 43.0,
        onset_env=np.zeros(0),
        onset_env_norm=np.zeros(0),
        onsets=[
            {"time": round(float(t), 6), "strength": round(float(s), 4)}
            for t, s in zip(onset_times, onset_strengths)
        ],
        onset_times=np.asarray(onset_times, dtype=float),
        onset_strengths=np.asarray(onset_strengths, dtype=float),
        silent=False,
    )


def make_energy(times: Sequence[float], values: Sequence[float]) -> EnergyResult:
    arr_v = np.asarray(values, dtype=float)
    return EnergyResult(
        rms=arr_v,
        rms_norm=arr_v,
        rms_smooth=arr_v,
        times=np.asarray(times, dtype=float),
        timeline=[],
        overall_energy=None,
        dynamic_range=None,
        loudness_db=np.zeros(0),
        loudness_range_db=None,
    )


def make_tonal(
    chroma_times: Sequence[float],
    profiles: List[Tuple[float, float, object]],
    duration: float,
) -> TonalResult:
    """Chroma whose dominant pitch class changes over time.

    ``profiles`` is a list of ``(t_start, t_end, pc)``; inside each span the
    chroma vector is 0.9 on that pitch class and 0.1/12 elsewhere, so sections
    built on different pitch classes are exactly orthogonal in the harmonic
    family while still being legal chroma.
    """
    times = np.asarray(chroma_times, dtype=float)
    chroma = np.full((12, times.size), 0.1 / 12.0)
    for t0, t1, pc in profiles:
        mask = (times >= t0) & (times < t1)
        chroma[:, mask] = 0.1 / 12.0
        chroma[int(pc), mask] = 0.9
    return TonalResult(
        available=True,
        chroma=chroma,
        chroma_times=times,
        chroma_mean=[float(v) for v in chroma.mean(axis=1)] if times.size else [0.0] * 12,
        key=None,
        scale=None,
        key_confidence=None,
        centroid_hz=np.zeros(0),      # brightness stays honestly None
        centroid_times=np.zeros(0),
        centroid_mean_hz=None,
        brightness=None,
        contrast_mean=[],
        band_balance={},
        mfcc=np.zeros(0),
        mfcc_times=np.zeros(0),
    )


def make_stems(
    times: Sequence[float],
    curves: dict,
) -> StemFeatureResult:
    times_arr = np.asarray(times, dtype=float)
    return StemFeatureResult(
        available=True,
        backend="stub",
        times=times_arr,
        curves={k: np.asarray(v, dtype=float) for k, v in curves.items()},
        onsets={},
        activity={name: float(np.mean(curves.get(f"{name}Activity", [0.0]))) for name in ("drums", "bass", "vocals", "other")},
        drums={"available": True},
        bass={"available": True},
        vocals={"available": True},
        other={"available": True},
    )


def make_structure(sections: List[dict]) -> StructureResult:
    return StructureResult(
        sections=sections,
        boundaries=[s["start"] for s in sections[1:]],
        novelty=np.zeros(0),
        novelty_times=np.zeros(0),
        method="stub",
    )


def section(
    sid: str,
    start: float,
    end: float,
    start_bar: Optional[int] = None,
    end_bar: Optional[int] = None,
) -> dict:
    return {
        "id": sid,
        "start": start,
        "end": end,
        "durationSec": end - start,
        "label": None,
        "startBar": start_bar,
        "endBar": end_bar,
        "energy": None,
        "drumActivity": None,
        "bassActivity": None,
        "vocalActivity": None,
        "melodicActivity": None,
    }

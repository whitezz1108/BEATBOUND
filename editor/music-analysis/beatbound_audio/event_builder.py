"""Unified musical event layer (prompt section 12).

This is the layer a future director will consume, but **this round only
produces it** -- nothing in the editor reads these events yet, and the type
vocabulary is strictly musical. There is deliberately no ``spawn_ring``,
``jump`` or ``change_mode`` here: gameplay events belong to the next stage.

Event types produced:
    beat, strong_beat, strong_onset,
    energy_rise, energy_drop, energy_peak,
    melody_rise, melody_fall, melody_peak, large_pitch_jump,
    vocal_entry, vocal_exit, bass_entry, drum_density_rise,
    section_boundary
"""

from __future__ import annotations

from typing import List, Optional

import numpy as np

from . import config, util
from .results import (
    EnergyResult,
    MelodyResult,
    RhythmResult,
    StemFeatureResult,
    StructureResult,
)

EVENT_TYPES = (
    "beat",
    "strong_beat",
    "strong_onset",
    "energy_rise",
    "energy_drop",
    "energy_peak",
    "melody_rise",
    "melody_fall",
    "melody_peak",
    "large_pitch_jump",
    "vocal_entry",
    "vocal_exit",
    "bass_entry",
    "drum_density_rise",
    "section_boundary",
)


def _ev(time: float, etype: str, strength: Optional[float], source: str, **extra) -> dict:
    out = {
        "time": util.fnum(time),
        "type": etype,
        "strength": util.fnum(strength, 4),
        "source": source,
    }
    out.update(extra)
    return out


def _beat_events(rhythm: RhythmResult) -> List[dict]:
    """Every beat, plus the strong ones.

    ``strong_beat`` is reserved for downbeats that also carry above-average
    onset strength -- a downbeat in a quiet bar is not a strong beat, and the
    report should not claim otherwise.
    """
    if not rhythm.beats:
        return []
    strengths = np.array([b["strength"] for b in rhythm.beats], dtype=float)
    mean_s = float(np.mean(strengths)) if strengths.size else 0.0
    out: List[dict] = []
    for b in rhythm.beats:
        out.append(_ev(b["time"], "beat", b["strength"], "rhythm", bar=b["bar"], beat=b["beat"]))
        if b["isDownbeat"] and b["strength"] >= max(config.STRONG_BEAT_MIN, mean_s):
            out.append(_ev(b["time"], "strong_beat", b["strength"], "rhythm", bar=b["bar"]))
    return out


def _energy_events(energy: EnergyResult, rhythm: RhythmResult) -> List[dict]:
    """Rises, drops and peaks on the smoothed energy curve.

    Measured per bar when a grid exists (so a "rise" means a bar-to-bar rise,
    matching the v1 semantics), otherwise on a fixed 1 s step.

    The sampled bar values are percentile-normalised **across bars** before the
    deltas are taken. That is deliberate and it is what "matching v1" means: v1
    normalised bar RMS against the other bars in the song, whereas the
    frame-level ``rms_smooth`` curve is normalised against the other *frames*.
    The two scales differ by a large factor -- on a steady track the frame-level
    curve compresses bar-to-bar change to ~0.14 where the bar-level curve gives
    ~0.58 -- so measuring deltas on the frame curve silently stops this layer
    from ever firing.
    """
    times, values = energy.times, energy.rms_smooth
    if times.size < 2:
        return []

    if rhythm.bpm and rhythm.n_beats >= 4:
        edges = rhythm.bar_bounds[: rhythm.n_bars + 1]
        step_name = "bar"
    else:
        n = max(2, int(times[-1]) + 1)
        edges = np.arange(n, dtype=float)
        step_name = "step"

    sampled_t = []
    sampled_v = []
    for i in range(len(edges) - 1):
        mask = (times >= edges[i]) & (times < edges[i + 1])
        if mask.any():
            sampled_t.append(float(edges[i]))
            sampled_v.append(float(np.mean(values[mask])))
    if len(sampled_v) < 2:
        return []

    # Bar-relative scale, so a "rise" is a rise relative to the rest of the song.
    scaled = util.percentile_norm(np.asarray(sampled_v, dtype=float))

    out: List[dict] = []
    for i in range(1, len(scaled)):
        delta = float(scaled[i] - scaled[i - 1])
        if abs(delta) >= config.ENERGY_RISE_MIN:
            out.append(
                _ev(
                    sampled_t[i],
                    "energy_rise" if delta > 0 else "energy_drop",
                    min(1.0, abs(delta) * 2.0),
                    "global",
                    magnitude=util.fnum(abs(delta), 4),
                    step=step_name,
                )
            )

    # Local maxima above the peak threshold.
    for i in range(1, len(scaled) - 1):
        if scaled[i] < config.ENERGY_PEAK_MIN:
            continue
        if scaled[i] >= scaled[i - 1] and scaled[i] > scaled[i + 1]:
            out.append(_ev(sampled_t[i], "energy_peak", float(scaled[i]), "global"))
    return out


def _melody_events(melody: MelodyResult) -> List[dict]:
    """Phrase-level direction, peaks and leaps."""
    if not melody.available or not melody.phrases:
        return []
    out: List[dict] = []
    for ph in melody.phrases:
        if ph["direction"] == "rising":
            out.append(_ev(ph["end"], "melody_rise", ph["noteDensity"], "melody",
                           pitchRangeSemitones=ph["pitchRangeSemitones"]))
        elif ph["direction"] == "falling":
            out.append(_ev(ph["end"], "melody_fall", ph["noteDensity"], "melody",
                           pitchRangeSemitones=ph["pitchRangeSemitones"]))
        if (ph["largestJumpSemitones"] or 0) >= config.MELODY_JUMP_MIN_SEMITONES:
            out.append(_ev(ph["end"], "large_pitch_jump",
                           min(1.0, ph["largestJumpSemitones"] / 12.0), "melody",
                           semitones=ph["largestJumpSemitones"]))

    # Melodic peaks: the highest note in a neighbourhood of phrases.
    tops = [(ph["end"], (ph["meanPitchMidi"] or 0) + (ph["pitchRangeSemitones"] or 0) / 2.0)
            for ph in melody.phrases]
    if len(tops) >= 3:
        vals = np.array([t[1] for t in tops], dtype=float)
        for i in range(1, len(tops) - 1):
            if vals[i] >= vals[i - 1] and vals[i] > vals[i + 1]:
                out.append(_ev(tops[i][0], "melody_peak",
                               util.clamp01((vals[i] - float(np.min(vals))) /
                                            max(float(np.max(vals) - np.min(vals)), 1e-6)),
                               "melody"))
    return out


def _stem_events(stems: Optional[StemFeatureResult]) -> List[dict]:
    """Vocal entries/exits, bass entries and drum-density rises."""
    if stems is None or not stems.available:
        return []
    out: List[dict] = []

    for e in stems.vocals.get("entries", []) or []:
        out.append(_ev(e["time"], "vocal_entry", None, "vocals"))
    for e in stems.vocals.get("exits", []) or []:
        out.append(_ev(e["time"], "vocal_exit", None, "vocals"))

    bass = stems.curves.get("bassActivity")
    if bass is not None and bass.size:
        for t in _activity_entries(stems.times, bass, config.ACTIVITY_ENTRY_MIN):
            out.append(_ev(t, "bass_entry", None, "bass"))

    density = stems.curves.get("drumsDensity")
    if density is not None and density.size:
        for t in _activity_entries(stems.times, density, config.ACTIVITY_ENTRY_MIN):
            out.append(_ev(t, "drum_density_rise", None, "drums"))
    return out


def _activity_entries(times: np.ndarray, curve: np.ndarray, min_jump: float) -> List[float]:
    """Times where a 0..1 activity curve crosses up through ``min_jump``.

    A crude gate with a hysteresis floor, so a curve hovering on the threshold
    does not emit a stream of spurious entries.
    """
    out: List[float] = []
    if curve.size < 2:
        return out
    above = curve >= min_jump
    edges = np.diff(above.astype(np.int8))
    for i in np.flatnonzero(edges == 1):
        # Require the curve to have come from genuinely quiet.
        lo = max(0, i - 4)
        if float(np.min(curve[lo : i + 1])) <= min_jump * 0.5:
            out.append(float(times[min(i + 1, len(times) - 1)]))
    return out


def _onset_events(rhythm: RhythmResult) -> List[dict]:
    """Onsets that stand clearly above the rest of the track."""
    return [
        _ev(o["time"], "strong_onset", o["strength"], "mix")
        for o in rhythm.onsets
        if (o["strength"] or 0.0) >= config.STRONG_ONSET_MIN
    ]


def _structure_events(structure: StructureResult, novelty_strength: float = 0.8) -> List[dict]:
    """One event per detected section boundary."""
    return [
        _ev(t, "section_boundary", novelty_strength, "structure")
        for t in structure.boundaries
    ]


def build_events(
    rhythm: RhythmResult,
    energy: EnergyResult,
    structure: StructureResult,
    melody: Optional[MelodyResult] = None,
    stems: Optional[StemFeatureResult] = None,
) -> List[dict]:
    """Assemble the unified, time-sorted event list."""
    events: List[dict] = []
    events += _beat_events(rhythm)
    events += _onset_events(rhythm)
    events += _energy_events(energy, rhythm)
    events += _melody_events(melody) if melody is not None else []
    events += _stem_events(stems)
    events += _structure_events(structure)

    events.sort(key=lambda e: (e["time"] if e["time"] is not None else 0.0, e["type"]))

    if len(events) > config.MAX_EVENTS:
        # Keep the strongest events when a dense song overflows the budget;
        # beats are the floor so the timeline never loses its pulse.
        keep = sorted(
            events,
            key=lambda e: (e["strength"] if e["strength"] is not None else 0.0),
            reverse=True,
        )[: config.MAX_EVENTS]
        events = sorted(keep, key=lambda e: (e["time"] or 0.0, e["type"]))

    return events


def event_counts(events: List[dict]) -> dict:
    counts: dict = {}
    for e in events:
        counts[e["type"]] = counts.get(e["type"], 0) + 1
    return dict(sorted(counts.items()))

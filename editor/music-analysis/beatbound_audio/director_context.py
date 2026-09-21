"""Director context builder (V2.1): the agent-facing compression of V2.

``music_analysis_v2.json`` is a complete musicological record -- hundreds of
beats, onsets, notes, windows and events. A level-design agent should not have
to drink from that firehose, and a prompt should not have to carry it. This
module compresses one full analysis into ``director_context.json``: the song's
grid, sections, phrases, repeat relationships, arrangement deltas, layer
activity, melody contour, a pruned event list and a per-bar intensity curve.

What is deliberately **kept out** (prompt sections 14-16, 29): raw note lists,
raw onset lists, the full window timeline, and anything gameplay-flavoured
(``recommended_difficulty``, ``hazard_count``, ``ring_speed``...). Those belong
to the future Gameplay Director stage, not to musical understanding.

Determinism: no wall-clock anywhere -- ``generated_at`` is ``null`` by design,
mirroring the V2 document's policy, so the same audio and settings produce
byte-identical JSON.
"""

from __future__ import annotations

from typing import Dict, List, Optional

import numpy as np

from . import config, util, version
from .repetition import ARRANGEMENT_WEIGHTS
from .results import (
    AudioContext,
    DownbeatResult,
    EnergyResult,
    MelodyResult,
    PhraseResult,
    RepetitionResult,
    RhythmResult,
    StemFeatureResult,
    StructureResult,
    TonalResult,
)

DIRECTOR_SCHEMA_VERSION = "beatbound_director_context_v1"

#: Event types kept verbatim (no pruning beyond the global budget).
_KEEP_ALL_EVENT_TYPES = {
    "section_boundary",
    "energy_rise", "energy_drop", "energy_peak",
    "vocal_entry", "vocal_exit",
    "melody_rise", "melody_fall",
}
#: High-frequency types, thinned by strength with a per-type minimum spacing
#: (in beats) before the global budget is applied. Entry gates flicker around
#: their threshold on real songs -- a hundred bass_entry events is noise, not
#: information, so spacing is what keeps the list readable.
_POOLED_EVENT_SPACING_BEATS = {
    "strong_beat": None,        # filled from DIRECTOR_STRONG_BEAT_SPACING_BARS
    "strong_onset": None,       # filled from DIRECTOR_STRONG_ONSET_SPACING_BEATS
    "bass_entry": 4,
    "drum_density_rise": 4,
    "melody_peak": 8,
    "large_pitch_jump": 4,
}
#: Never included: the beat grid itself carries the pulse.
_EXCLUDED_EVENT_TYPES = {"beat"}

_MELODY_DENSITY_REF_NPS = 8.0
_ONSET_DENSITY_REF_NPS = 6.0


def _mean_between(times: np.ndarray, values: Optional[np.ndarray], lo: float, hi: float) -> Optional[float]:
    if values is None or times.size == 0 or values.size == 0:
        return None
    mask = (times >= lo) & (times < hi)
    if not mask.any():
        return None
    seg = values[mask]
    seg = seg[np.isfinite(seg)]
    return float(np.mean(seg)) if seg.size else None


def _bar_for_time(rhythm: RhythmResult, t: Optional[float]) -> Optional[int]:
    if t is None or not rhythm.beats:
        return None
    for b in rhythm.beats:
        if b["time"] is not None and b["time"] > t:
            # The final (possibly incomplete) bar can number past n_bars;
            # the published grid only ever has n_bars bars.
            return min(b["bar"], rhythm.n_bars)
    return min(rhythm.beats[-1]["bar"], rhythm.n_bars) if rhythm.beats else None


# ---------------------------------------------------------------------------
# Blocks
# ---------------------------------------------------------------------------

def _global_block(global_summary: dict, rhythm: RhythmResult, duration: float) -> dict:
    return {
        "duration": util.fnum(duration, 6),
        "bpm": global_summary.get("bpm"),
        "bpm_confidence": global_summary.get("tempoConfidence"),
        "meter": f"{rhythm.time_signature[0]}/{rhythm.time_signature[1]}",
        "meter_confidence": global_summary.get("meterConfidence"),
        "bar_count": rhythm.n_bars,
        "beat_count": rhythm.n_beats,
        "key": global_summary.get("key"),
        "scale": global_summary.get("scale"),
        "key_confidence": global_summary.get("keyConfidence"),
        "overall_energy": global_summary.get("overallEnergy"),
        "dynamic_range": global_summary.get("dynamicRange"),
        "brightness": global_summary.get("brightness"),
        "rhythmic_density": global_summary.get("rhythmicDensity"),
        "melodic_density": global_summary.get("melodicDensity"),
        "silent": global_summary.get("silent", False),
    }


def _grid_block(rhythm: RhythmResult, downbeat: DownbeatResult, duration: float) -> dict:
    bars: List[dict] = []
    if rhythm.beat_len is not None and len(rhythm.bar_bounds) >= 2:
        for b in range(1, rhythm.n_bars + 1):
            start = float(rhythm.bar_bounds[b - 1])
            end = float(min(rhythm.bar_bounds[b], duration))
            bars.append({
                "bar": b,
                "start": util.fnum(start),
                "end": util.fnum(end),
                "downbeat_confidence": downbeat.confidence,
            })
    return {
        "bpm": util.fnum(rhythm.bpm, 2),
        "meter": f"{rhythm.time_signature[0]}/{rhythm.time_signature[1]}",
        "beats_per_bar": int(rhythm.time_signature[0]),
        "bar_phase_offset_beats": downbeat.offset_beats,
        "bar_phase_confidence": downbeat.confidence,
        "bars": bars,
    }


def _repeat_index(repetition: RepetitionResult) -> Dict[str, dict]:
    """section_id -> its repeat linkage, for the per-section ``repeat`` slot."""
    out: Dict[str, dict] = {}
    for group in repetition.groups:
        total = len(group["occurrences"])
        for occ in group["occurrences"]:
            out[occ["section_id"]] = {
                "group_id": group["group_id"],
                "occurrence": occ["occurrence_index"],
                "total_occurrences": total,
                "similarity_to_group": occ.get("similarity_to_group"),
            }
    return out


def _section_block(
    sec: dict,
    rhythm: RhythmResult,
    energy: EnergyResult,
    melody: Optional[MelodyResult],
    stems: Optional[StemFeatureResult],
    rep_stats: Optional[dict],
    repeat_link: Optional[dict],
) -> dict:
    start = sec.get("start")
    end = sec.get("end")
    duration = max((end or 0.0) - (start or 0.0), 1e-6)

    # ---- energy ------------------------------------------------------------
    e_mean = _mean_between(energy.times, energy.rms_smooth, start, end)
    e_peak = None
    if energy.times.size:
        mask = (energy.times >= start) & (energy.times < end)
        if mask.any():
            e_peak = float(np.max(energy.rms_smooth[mask]))
    third = duration / 3.0
    e_first = _mean_between(energy.times, energy.rms_smooth, start, start + third)
    e_last = _mean_between(energy.times, energy.rms_smooth, end - third, end)
    if e_first is not None and e_last is not None:
        if e_last - e_first >= 0.08:
            trend = "rising"
        elif e_first - e_last >= 0.08:
            trend = "falling"
        else:
            trend = "stable"
    else:
        trend = None

    # ---- stems ---------------------------------------------------------------
    stem_activity = {
        "drums": rep_stats.get("drum_activity") if rep_stats else None,
        "bass": rep_stats.get("bass_activity") if rep_stats else None,
        "vocals": rep_stats.get("vocal_activity") if rep_stats else None,
        "other": rep_stats.get("other_activity") if rep_stats else None,
    }
    if all(v is None for v in stem_activity.values()) and stems is not None and stems.available:
        for name in stem_activity:
            stem_activity[name] = _mean_between(
                stems.times, stems.curves.get(f"{name}Activity"), start, end
            )

    # ---- rhythm --------------------------------------------------------------
    onset_density = rep_stats.get("onset_density") if rep_stats else None
    kick = snare = high = None
    if stems is not None and stems.available:
        pieces = (stems.drums or {}).get("pieces") or {}
        drum_onsets = (stems.onsets or {}).get("drums") or []
        n_in = sum(1 for o in drum_onsets if start <= (o.get("time") or -1) < end)
        norm = util.clamp01((n_in / duration) / _ONSET_DENSITY_REF_NPS)
        # The kick/snare/high split is a song-level share (a spectral heuristic,
        # confidence "low"); the per-section value is that share times the
        # section's drum-onset density. Documented, not transcribed.
        kick = util.fnum(norm * (pieces.get("kickLike") or 0.0), 4)
        snare = util.fnum(norm * (pieces.get("snareLike") or 0.0), 4)
        high = util.fnum(norm * (pieces.get("highPercussionLike") or 0.0), 4)

    # ---- melody -----------------------------------------------------------------
    melody_activity = None
    melody_density = None
    melody_contour = None
    peak_times: List[float] = []
    if melody is not None and melody.available:
        if melody.pitch_times.size:
            inside = (melody.pitch_times >= start) & (melody.pitch_times < end)
            if inside.any():
                melody_activity = float(np.mean(np.isfinite(melody.pitch_midi[inside])))
        notes = [
            n for n in melody.notes
            if n["start"] is not None and n["end"] is not None
            and n["start"] < end and n["end"] > start
        ]
        if notes:
            melody_density = util.clamp01((len(notes) / duration) / _MELODY_DENSITY_REF_NPS)
            top = sorted(notes, key=lambda n: (-n["pitchMidi"], n["start"]))[:3]
            peak_times = [util.fnum(n["start"]) for n in top]
        directions: Dict[str, int] = {}
        for ph in melody.phrases:
            if ph["end"] > start and ph["start"] < end:
                d = ph.get("direction")
                if d:
                    directions[d] = directions.get(d, 0) + 1
        if directions:
            melody_contour = sorted(directions.items(), key=lambda kv: (-kv[1], kv[0]))[0][0]

    return {
        "section_id": sec.get("id"),
        "start": start,
        "end": end,
        "start_bar": sec.get("startBar"),
        "end_bar": sec.get("endBar"),
        "energy": {
            "mean": util.fnum(e_mean, 4),
            "peak": util.fnum(e_peak, 4),
            "trend": trend,
        },
        "stems": {k: util.fnum(v, 4) for k, v in stem_activity.items()},
        "rhythm": {
            "onset_density": util.fnum(onset_density, 4),
            "kick_activity": kick,
            "snare_activity": snare,
            "high_percussion_activity": high,
        },
        "melody": {
            "activity": util.fnum(melody_activity, 4),
            "density": util.fnum(melody_density, 4),
            "contour": melody_contour,
            "peak_times": peak_times,
        },
        "repeat": repeat_link,
    }


def _important_events(events: List[dict], rhythm: RhythmResult) -> List[dict]:
    """Prune the unified event list to its director-relevant core.

    Plain ``beat`` events are dropped (the grid carries the pulse); every
    high-frequency type is thinned by strength with a minimum temporal spacing;
    the total is then kept within ``DIRECTOR_EVENT_BUDGET`` by dropping the
    weakest pooled events first -- the curated core types are never dropped.
    """
    kept: List[dict] = []

    for e in events:
        etype = e.get("type")
        if etype in _EXCLUDED_EVENT_TYPES:
            continue
        if etype in _KEEP_ALL_EVENT_TYPES:
            kept.append(e)

    beat_len = rhythm.beat_len or 0.5
    bpb = int(rhythm.time_signature[0])
    spacing_beats = dict(_POOLED_EVENT_SPACING_BEATS)
    spacing_beats["strong_beat"] = config.DIRECTOR_STRONG_BEAT_SPACING_BARS * bpb
    spacing_beats["strong_onset"] = config.DIRECTOR_STRONG_ONSET_SPACING_BEATS
    for etype, spacing_b in spacing_beats.items():
        pool = sorted(
            (e for e in events if e.get("type") == etype),
            key=lambda e: (-(e.get("strength") or 0.0), e.get("time") or 0.0),
        )
        min_gap = spacing_b * beat_len
        taken: List[float] = []
        for e in pool:
            t = e.get("time") or 0.0
            if any(abs(t - u) < min_gap for u in taken):
                continue
            taken.append(t)
            kept.append(e)

    if len(kept) > config.DIRECTOR_EVENT_BUDGET:
        # Drop weakest pooled events first; the curated core is never dropped.
        pooled = sorted(
            (e for e in kept if e.get("type") in spacing_beats),
            key=lambda e: (e.get("strength") if e.get("strength") is not None else -1.0,
                           e.get("time") or 0.0),
        )
        drop = set(id(e) for e in pooled[: len(kept) - config.DIRECTOR_EVENT_BUDGET])
        kept = [e for e in kept if id(e) not in drop]

    out = [
        {
            "time": e.get("time"),
            "type": e.get("type"),
            "strength": e.get("strength"),
            "bar": _bar_for_time(rhythm, e.get("time")),
        }
        for e in kept
    ]
    out.sort(key=lambda e: (e.get("time") or 0.0, e.get("type") or ""))
    return out


def _melody_summary(
    melody: Optional[MelodyResult], structure: StructureResult, events: List[dict]
) -> dict:
    """Melodic shape without the note list (which stays in the full document)."""
    if melody is None or not melody.available:
        return {
            "available": False,
            "backend": melody.backend if melody is not None else None,
            "note_count": 0,
            "note_density": None,
            "pitch_range_semitones": None,
            "mean_pitch_midi": None,
            "global_contour": None,
            "section_contours": [],
            "peaks": [],
            "rise_count": 0,
            "fall_count": 0,
            "large_jumps": [],
        }

    notes = melody.notes
    pitches = np.array([n["pitchMidi"] for n in notes], dtype=float) if notes else np.zeros(0)

    global_contour = None
    if notes:
        starts = np.array([n["start"] for n in notes], dtype=float)
        lo, hi = float(starts.min()), float(starts.max())
        span = max(hi - lo, 1e-6)
        first = float(np.mean(pitches[starts < lo + span / 3]))
        last = float(np.mean(pitches[starts > lo + 2 * span / 3]))
        if last - first >= 2.0:
            global_contour = "rising"
        elif first - last >= 2.0:
            global_contour = "falling"
        else:
            global_contour = "stable"

    section_contours: List[dict] = []
    for sec in structure.sections:
        start, end = sec.get("start"), sec.get("end")
        directions: Dict[str, int] = {}
        for ph in melody.phrases:
            if ph["end"] > start and ph["start"] < end:
                d = ph.get("direction")
                if d:
                    directions[d] = directions.get(d, 0) + 1
        in_sec = [
            n for n in notes
            if start <= n["start"] < end
        ]
        if directions or in_sec:
            section_contours.append({
                "section_id": sec.get("id"),
                "contour": (
                    sorted(directions.items(), key=lambda kv: (-kv[1], kv[0]))[0][0]
                    if directions else None
                ),
                "mean_pitch_midi": util.fnum(
                    float(np.mean([n["pitchMidi"] for n in in_sec])), 2
                ) if in_sec else None,
                "note_count": len(in_sec),
            })

    peaks = [
        {"time": n["start"], "pitch_midi": n["pitchMidi"]}
        for n in sorted(notes, key=lambda n: (-n["pitchMidi"], n["start"]))[:5]
    ]
    jumps = sorted(
        (ph for ph in melody.phrases if (ph.get("largestJumpSemitones") or 0) > 0),
        key=lambda ph: (-ph["largestJumpSemitones"], ph["end"]),
    )[:5]
    large_jumps = [
        {"time": ph["end"], "semitones": ph["largestJumpSemitones"]} for ph in jumps
    ]
    rise_count = sum(1 for e in events if e.get("type") == "melody_rise")
    fall_count = sum(1 for e in events if e.get("type") == "melody_fall")

    return {
        "available": True,
        "backend": melody.backend,
        "note_count": len(notes),
        "note_density": melody.note_density,
        "pitch_range_semitones": melody.pitch_range_semitones,
        "mean_pitch_midi": util.fnum(float(np.mean(pitches)), 2) if pitches.size else None,
        "global_contour": global_contour,
        "section_contours": section_contours,
        "peaks": peaks,
        "rise_count": rise_count,
        "fall_count": fall_count,
        "large_jumps": large_jumps,
    }


def _intensity_curve(
    ctx: AudioContext,
    rhythm: RhythmResult,
    energy: EnergyResult,
    stems: Optional[StemFeatureResult],
) -> List[dict]:
    """One point per bar: the curve a director reads to feel the song's arc."""
    curve: List[dict] = []
    if rhythm.beat_len is None or len(rhythm.bar_bounds) < 2:
        return curve

    stems_ok = stems is not None and stems.available
    stem_curves = stems.curves if stems_ok else {}
    stem_times = stems.times if stems_ok else np.zeros(0)
    for b in range(1, rhythm.n_bars + 1):
        lo = float(rhythm.bar_bounds[b - 1])
        hi = float(min(rhythm.bar_bounds[b], ctx.duration))
        bar_sec = max(hi - lo, 1e-6)

        e = _mean_between(energy.times, energy.rms_smooth, lo, hi)
        drums = _mean_between(stem_times, stem_curves.get("drumsActivity"), lo, hi)
        drums_density = _mean_between(stem_times, stem_curves.get("drumsDensity"), lo, hi)
        bass = _mean_between(stem_times, stem_curves.get("bassActivity"), lo, hi)
        vocals = _mean_between(stem_times, stem_curves.get("vocalsActivity"), lo, hi)
        other = _mean_between(stem_times, stem_curves.get("otherActivity"), lo, hi)
        n_onsets = float(np.sum((rhythm.onset_times >= lo) & (rhythm.onset_times < hi)))
        onset_density = util.clamp01((n_onsets / bar_sec) / _ONSET_DENSITY_REF_NPS)

        # Same documented weights as the section-level arrangement intensity,
        # over the components that exist at bar resolution.
        metrics = {
            "energy": e,
            "drum_activity": drums,
            "drum_density": drums_density,
            "bass_activity": bass,
            "vocal_activity": vocals,
            "other_activity": other,
            "onset_density": onset_density,
        }
        num = den = 0.0
        for key, weight in ARRANGEMENT_WEIGHTS.items():
            v = metrics.get(key)
            if v is None:
                continue
            num += weight * v
            den += weight
        combined = util.clamp01(num / den) if den > 1e-9 else None

        curve.append({
            "time": util.fnum(lo),
            "bar": b,
            "energy": util.fnum(e, 4),
            "drums": util.fnum(drums, 4),
            "bass": util.fnum(bass, 4),
            "vocals": util.fnum(vocals, 4),
            "melody": util.fnum(other, 4),
            "combined_intensity": util.fnum(combined, 4),
        })
    return curve


def _stem_summary(stems: Optional[StemFeatureResult]) -> dict:
    if stems is None or not stems.available:
        return {
            "available": False,
            "backend": stems.backend if stems is not None else None,
            "activity": {name: None for name in ("drums", "bass", "vocals", "other")},
            "drum_pieces": None,
        }
    pieces = (stems.drums or {}).get("pieces")
    return {
        "available": True,
        "backend": stems.backend,
        "activity": stems.activity,
        "drum_pieces": pieces,
    }


def _lyrics_block() -> dict:
    """Reserved schema slot (prompt section 7): never a blocker, never faked.

    Local sung-vocal transcription is not wired up this round, so the block
    reports exactly that -- ``available: false`` with no provider and no words.
    """
    return {
        "available": False,
        "provider": None,
        "language": None,
        "words": [],
    }


def _provenance() -> dict:
    """Module-level lineage for the high-level fields (prompt section 17)."""
    return {
        "global": ["layers.rhythm", "layers.energy", "layers.tonal", "layers.melody"],
        "grid": ["layers.rhythm", "layers.barPhase"],
        "sections": [
            "layers.structure", "layers.energy", "layers.stems",
            "layers.melody", "layers.rhythm", "layers.repetition",
        ],
        "phrases": [
            "layers.rhythm", "layers.energy", "layers.tonal",
            "layers.stems", "layers.melody", "layers.phrasing", "events",
        ],
        "repeat_groups": [
            "layers.structure", "layers.rhythm", "layers.stems",
            "layers.melody", "layers.energy", "layers.tonal",
        ],
        "repeat_comparisons": ["layers.repetition.section_stats"],
        "important_events": ["events"],
        "melody_summary": ["layers.melody", "layers.structure", "events"],
        "intensity_curve": ["layers.rhythm", "layers.energy", "layers.stems"],
        "stem_summary": ["layers.stems"],
        "lyrics": ["none -- transcription not wired up this round"],
    }


# ---------------------------------------------------------------------------
# Builder
# ---------------------------------------------------------------------------

def build_director_context(
    *,
    ctx: AudioContext,
    rhythm: RhythmResult,
    energy: EnergyResult,
    tonal: TonalResult,
    structure: StructureResult,
    melody: Optional[MelodyResult],
    stems: Optional[StemFeatureResult],
    downbeat: DownbeatResult,
    repetition: RepetitionResult,
    phrasing: PhraseResult,
    events: List[dict],
    global_summary: dict,
) -> dict:
    """Compress one full V2 analysis into the director-facing document."""
    repeat_index = _repeat_index(repetition)

    sections = [
        _section_block(
            sec,
            rhythm,
            energy,
            melody,
            stems,
            repetition.section_stats.get(sec.get("id")),
            repeat_index.get(sec.get("id")),
        )
        for sec in structure.sections
    ]

    return {
        "schema_version": DIRECTOR_SCHEMA_VERSION,
        "source": {
            "audio_file": ctx.file,
            "song_id": ctx.song_id,
            "title": ctx.title,
            "duration": util.fnum(ctx.duration, 6),
            "analysis_version": version.ANALYZER_VERSION,
            "analysis_schema_version": version.SCHEMA_VERSION,
            # Wall-clock would break byte-determinism; see module docstring.
            "generated_at": None,
        },
        "global": _global_block(global_summary, rhythm, ctx.duration),
        "grid": _grid_block(rhythm, downbeat, ctx.duration),
        "sections": sections,
        "phrases": phrasing.phrases,
        "repeat_groups": repetition.groups,
        "repeat_comparisons": repetition.comparisons,
        "stem_summary": _stem_summary(stems),
        "important_events": _important_events(events, rhythm),
        "melody_summary": _melody_summary(melody, structure, events),
        "intensity_curve": _intensity_curve(ctx, rhythm, energy, stems),
        "lyrics": _lyrics_block(),
        "provenance": _provenance(),
    }

"""Director context V2 -- the canonical, generation-safe music representation.

``music_analysis_v2.json`` is a musicological record. ``director_context.json``
(V1) compressed it, but it was written as a *reading aid*: it inherited the
analysis' bar conventions (inclusive, overlapping section bounds), it published
event timestamps verbatim, and it had no notion of what a level generator is
allowed to touch.

``director_context_v2.json`` is the contract the level-generation pipeline
actually consumes. Compared with V1 it is:

**Duration-safe.** Every timestamped thing that reaches it -- events, notes,
melody peaks, phrase event references, anchors -- is clamped against
``source.duration_sec``. Anything outside ``0 <= t <= duration`` is dropped and
counted in ``diagnostics``. This is not cosmetic: the pitch backend can report
notes past the end of the audio (a 2x-duration stem, see the module note below),
and V1 mapped every one of those onto the final bar. A director that believes
bar 75 holds 83 extra accents writes an unplayable ending.

**Unambiguous.** Sections and phrases use half-open bar ranges
``[start_bar, end_bar_exclusive)``, snapped to the beat grid, ordered,
non-overlapping and contiguous. Phrases are clipped to their section.

**Generation-shaped.** A bar-level director curve with derived intensity
classes and build/release flags, deduplicated and ranked musical anchors,
repeat groups with an arrangement-delta variation profile and a deterministic
gameplay-relation recommendation, sync checkpoints, explicit reliability tiers
and generation-safety diagnostics.

Determinism: no wall clock, no RNG, sorted where order is not meaningful -- the
same analysis yields byte-identical JSON, mirroring the V2 document's policy.

Note on the upstream duration bug (reported, not papered over here): the stem
separator writes the Demucs python-API output at the requested analysis rate
without resampling its 44.1 kHz result, so cached stems for a 44.1 kHz source
are twice as long as the song. Melody is transcribed from those stems, which is
why notes run to ~2x the duration. This module makes the *generation context*
safe regardless; the analysis-side fix is tracked separately.
"""

from __future__ import annotations

from typing import Dict, List, Optional, Sequence, Tuple

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

DIRECTOR_V2_SCHEMA_VERSION = "beatbound_director_context_v2"

#: The full anchor vocabulary (prompt section 6.7). Nothing outside this set is
#: ever emitted, so a consumer can switch on it exhaustively.
ANCHOR_TYPES = (
    "section_boundary",
    "phrase_boundary",
    "energy_rise",
    "energy_drop",
    "energy_peak",
    "strong_beat",
    "strong_onset",
    "large_pitch_jump",
    "melody_rise",
    "melody_fall",
    "melody_peak",
    "vocal_entry",
    "vocal_exit",
)

#: Default importance per anchor type, before strength is considered.
_ANCHOR_PRIORITY = {
    "section_boundary": "high",
    "energy_peak": "high",
    "energy_drop": "high",
    "vocal_entry": "high",
    "phrase_boundary": "medium",
    "energy_rise": "medium",
    "strong_beat": "medium",
    "large_pitch_jump": "medium",
    "melody_peak": "medium",
    "vocal_exit": "medium",
    "strong_onset": "low",
    "melody_rise": "low",
    "melody_fall": "low",
}

#: Minimum spacing between two kept anchors of the same type, in beats. ``None``
#: means "keep every one" (boundaries are structural, not detected).
_ANCHOR_SPACING_BEATS: Dict[str, Optional[float]] = {
    "section_boundary": None,
    "phrase_boundary": None,
    "energy_peak": 2.0,
    "energy_rise": 2.0,
    "energy_drop": 2.0,
    "strong_beat": None,        # filled from DIRECTOR_STRONG_BEAT_SPACING_BARS
    "strong_onset": None,       # filled from DIRECTOR_STRONG_ONSET_SPACING_BEATS
    "large_pitch_jump": 4.0,
    "melody_peak": 8.0,
    "melody_rise": 2.0,
    "melody_fall": 2.0,
    "vocal_entry": 4.0,
    "vocal_exit": 4.0,
}

#: Bar-level ``combined_intensity`` -> class. Ascending; first match wins.
_INTENSITY_CLASSES: Tuple[Tuple[float, str], ...] = (
    (0.25, "low"),
    (0.45, "medium"),
    (0.65, "high"),
    (float("inf"), "peak"),
)

#: Reliability tier thresholds, per signal. Explicit and tested (prompt 6.9).
_RELIABILITY_THRESHOLDS = {
    "tempo": (0.60, 0.35),
    "meter": (0.60, 0.30),
    "bar_phase": (0.70, 0.40),
    "structure": (0.80, 0.50),
    "melody": (0.60, 0.30),
    "stem_separation": (0.60, 0.30),
}

#: Energy change that counts as a build / release at bar resolution.
_BAR_CHANGE_THRESHOLD = 0.06

_MELODY_DENSITY_REF_NPS = 8.0
_ONSET_DENSITY_REF_NPS = 6.0

#: How many in-range anchors a phrase carries into the prompt.
_PHRASE_ANCHOR_LIMIT = 6
#: How many bars an anchor may be merged across (prompt 6.7 "merge near-duplicates").
_ANCHOR_MERGE_BEATS = 0.25


# ---------------------------------------------------------------------------
# Duration safety
# ---------------------------------------------------------------------------

class _DurationGuard:
    """The prompt's hard rule: ``0 <= t <= duration`` or it does not exist.

    Every timestamped value funnels through here. Dropped values are counted per
    kind so ``diagnostics`` can say exactly what was thrown away instead of
    silently reshaping the song.
    """

    def __init__(self, duration: float) -> None:
        self.duration = float(duration)
        self.dropped: Dict[str, int] = {}

    def keep(self, t, kind: str) -> Optional[float]:
        """Return ``t`` if it is a real in-song time, else ``None``."""
        if t is None:
            return None
        try:
            value = float(t)
        except (TypeError, ValueError):
            self._drop(kind)
            return None
        if not np.isfinite(value) or value < 0.0 or value > self.duration:
            self._drop(kind)
            return None
        return value

    def _drop(self, kind: str) -> None:
        self.dropped[kind] = self.dropped.get(kind, 0) + 1


def _clamp(value: float, lo: float, hi: float) -> float:
    return max(lo, min(hi, value))


# ---------------------------------------------------------------------------
# Bar grid
# ---------------------------------------------------------------------------

class _BarGrid:
    """The canonical music-time <-> bar conversion surface.

    Bars come from the analysis grid, clamped to the real audio duration. The
    grid is constant (analysis bars == runtime bars), so every bar boundary is a
    clean integer beat and a section that starts mid-bar is a bug, not a feature.
    """

    def __init__(self, rhythm: RhythmResult, duration: float) -> None:
        self.duration = float(duration)
        self.n_bars = int(rhythm.n_bars)
        self.beats_per_bar = int(rhythm.time_signature[0])
        self.beat_len = rhythm.beat_len
        self.bars: List[dict] = []
        if self.beat_len is None or len(rhythm.bar_bounds) < 2 or self.n_bars <= 0:
            return
        for b in range(1, self.n_bars + 1):
            start = float(rhythm.bar_bounds[b - 1])
            end = float(min(rhythm.bar_bounds[b], self.duration))
            self.bars.append({"bar": b, "start": start, "end": max(end, start)})

    @property
    def usable(self) -> bool:
        return len(self.bars) > 0

    def bar_start(self, bar: int) -> float:
        return self.bars[_clamp_int(bar, 1, self.n_bars) - 1]["start"]

    def bar_end(self, bar: int) -> float:
        return self.bars[_clamp_int(bar, 1, self.n_bars) - 1]["end"]

    def end_of_range(self, end_bar_exclusive: int) -> float:
        """End time of ``[_, end_bar_exclusive)`` -- the last bar's end."""
        if end_bar_exclusive > self.n_bars:
            return self.bars[-1]["end"] if self.bars else self.duration
        return self.bar_end(max(end_bar_exclusive - 1, 1))

    def bar_of_time(self, t: Optional[float]) -> Optional[int]:
        """Which bar contains ``t`` (1-based), clamped into ``1..n_bars``."""
        if t is None or not self.bars or self.beat_len is None:
            return None
        if t <= 0.0:
            return 1
        if t >= self.duration:
            return self.n_bars
        return _clamp_int(int(t / (self.beat_len * self.beats_per_bar)) + 1, 1, self.n_bars)

    def start_bar_of_time(self, t: Optional[float]) -> Optional[int]:
        return self.bar_of_time(t)

    def end_bar_exclusive_of_time(self, t: Optional[float]) -> Optional[int]:
        """First bar *after* the one containing ``t``; ``n_bars + 1`` past the end."""
        if t is None or not self.bars or self.beat_len is None:
            return None
        if t >= self.duration:
            return self.n_bars + 1
        if t <= 0.0:
            return 1
        bar = int(t / (self.beat_len * self.beats_per_bar)) + 1
        return _clamp_int(bar, 1, self.n_bars + 1)

    def beat_in_bar(self, t: Optional[float]) -> Optional[float]:
        """Fractional beat position inside the bar containing ``t`` (1-based)."""
        if t is None or self.beat_len is None or not self.bars:
            return None
        bar = self.bar_of_time(t)
        if bar is None:
            return None
        return util.fnum((t - self.bar_start(bar)) / self.beat_len + 1.0, 3)


def _clamp_int(value: int, lo: int, hi: int) -> int:
    return max(lo, min(hi, int(value)))


# ---------------------------------------------------------------------------
# Small aggregation helpers
# ---------------------------------------------------------------------------

def _mean_between(times: np.ndarray, values: Optional[np.ndarray], lo: float, hi: float) -> Optional[float]:
    if values is None or times is None or times.size == 0 or values.size == 0:
        return None
    mask = (times >= lo) & (times < hi)
    if not mask.any():
        return None
    seg = values[mask]
    seg = seg[np.isfinite(seg)]
    return float(np.mean(seg)) if seg.size else None


def _percentile_rank(values: Sequence[Optional[float]], value: Optional[float]) -> Optional[float]:
    """Where ``value`` sits in ``values`` as 0..1 (0 = smallest)."""
    clean = sorted(float(v) for v in values if v is not None and np.isfinite(v))
    if value is None or not clean or not np.isfinite(value):
        return None
    below = sum(1 for v in clean if v < float(value))
    equal = sum(1 for v in clean if v == float(value))
    return util.fnum((below + 0.5 * equal) / len(clean), 4)


def _tier(value: Optional[float], key: str) -> str:
    high, medium = _RELIABILITY_THRESHOLDS[key]
    if value is None:
        return "unknown"
    if value >= high:
        return "high"
    if value >= medium:
        return "medium"
    return "low"


def _intensity_class(value: Optional[float]) -> Optional[str]:
    if value is None:
        return None
    for threshold, name in _INTENSITY_CLASSES:
        if value < threshold:
            return name
    return "peak"


# ---------------------------------------------------------------------------
# Blocks
# ---------------------------------------------------------------------------

def _source_block(ctx: AudioContext) -> dict:
    return {
        "song_id": ctx.song_id,
        "audio_file": ctx.file,
        "duration_sec": util.fnum(ctx.duration, 6),
        "analysis_version": version.ANALYZER_VERSION,
        "analysis_schema_version": version.SCHEMA_VERSION,
        "source_hash": ctx.source_hash,
        "audio_hash": ctx.audio_hash,
    }


def _timing_block(rhythm: RhythmResult, downbeat: DownbeatResult, grid: _BarGrid) -> dict:
    return {
        "bpm": util.fnum(rhythm.bpm, 4),
        "bpm_confidence": util.fnum(rhythm.tempo_confidence, 4),
        "meter": f"{rhythm.time_signature[0]}/{rhythm.time_signature[1]}",
        "meter_confidence": util.fnum(rhythm.meter_confidence, 4),
        "beats_per_bar": grid.beats_per_bar,
        "bar_count": grid.n_bars,
        "beat_count": int(rhythm.n_beats),
        "bar_phase_offset_beats": downbeat.offset_beats,
        "bar_phase_confidence": util.fnum(downbeat.confidence, 4),
        "bars": [
            {"bar": b["bar"], "start": util.fnum(b["start"]), "end": util.fnum(b["end"])}
            for b in grid.bars
        ],
    }


def _music_profile(global_summary: dict, tonal: TonalResult, rhythm: RhythmResult) -> dict:
    notes: List[str] = []
    if global_summary.get("key") is None:
        notes.append(
            f"key not published (best-guess confidence {util.fnum(global_summary.get('keyConfidence'), 4)})"
        )
    if not tonal.available:
        notes.append("tonal layer unavailable -- brightness/band balance are absent")
    if rhythm.tempo_confidence is not None and rhythm.tempo_confidence < 0.6:
        notes.append(
            f"tempo confidence {util.fnum(rhythm.tempo_confidence, 4)} is below the 0.60 high tier"
        )
    return {
        "overall_energy": util.fnum(global_summary.get("overallEnergy"), 4),
        "dynamic_range": util.fnum(global_summary.get("dynamicRange"), 4),
        "brightness": util.fnum(global_summary.get("brightness"), 4),
        "rhythmic_density": util.fnum(global_summary.get("rhythmicDensity"), 4),
        "melodic_density": util.fnum(global_summary.get("melodicDensity"), 4),
        "key": global_summary.get("key"),
        "scale": global_summary.get("scale"),
        "confidence_notes": notes,
    }


def _normalize_sections(
    structure: StructureResult, grid: _BarGrid, guard: _DurationGuard
) -> Tuple[List[dict], int]:
    """Time-derived, half-open, ordered, contiguous, non-overlapping sections.

    The analysis' ``startBar``/``endBar`` are inclusive and overlap by one bar at
    every boundary (section 01 "ends" at bar 17, section 02 "starts" at bar 17).
    The section *times* are contiguous, so they are the source of truth: the bar
    range is derived from them and then snapped back onto the grid.
    """
    if not grid.usable:
        return [], 0

    raw: List[dict] = []
    for sec in structure.sections:
        start = guard.keep(sec.get("start"), "section")
        end = guard.keep(sec.get("end"), "section")
        if start is None or end is None or end <= start:
            continue
        start_bar = grid.start_bar_of_time(start)
        end_bar_excl = grid.end_bar_exclusive_of_time(end)
        if start_bar is None or end_bar_excl is None:
            continue
        raw.append({
            "section_id": sec.get("id"),
            "start_bar": start_bar,
            "end_bar_exclusive": end_bar_excl,
        })

    if not raw:
        return [], 0

    raw.sort(key=lambda s: (s["start_bar"], s["end_bar_exclusive"]))
    adjusted = 0

    # Clamp into the song, drop empties, then make the run contiguous: a gap
    # belongs to the section that precedes it (its tail), an overlap to the one
    # that follows (the later start wins).
    fixed: List[dict] = []
    for sec in raw:
        start_bar = _clamp_int(sec["start_bar"], 1, grid.n_bars)
        end_bar_excl = _clamp_int(sec["end_bar_exclusive"], 1, grid.n_bars + 1)
        if end_bar_excl <= start_bar:
            continue
        if fixed:
            prev = fixed[-1]
            if start_bar < prev["end_bar_exclusive"]:
                start_bar = prev["end_bar_exclusive"]
                adjusted += 1
            elif start_bar > prev["end_bar_exclusive"]:
                prev["end_bar_exclusive"] = start_bar
                adjusted += 1
        if end_bar_excl <= start_bar:
            continue
        fixed.append({
            "section_id": sec["section_id"],
            "start_bar": start_bar,
            "end_bar_exclusive": end_bar_excl,
        })

    if not fixed:
        return [], adjusted

    # Cover the whole song: whatever the detector left at the head or tail is
    # part of the first / last section, never a hole.
    if fixed[0]["start_bar"] > 1:
        fixed[0]["start_bar"] = 1
        adjusted += 1
    if fixed[-1]["end_bar_exclusive"] <= grid.n_bars:
        fixed[-1]["end_bar_exclusive"] = grid.n_bars + 1
        adjusted += 1

    # Re-apply contiguity after the head/tail extension.
    for i in range(1, len(fixed)):
        if fixed[i]["start_bar"] != fixed[i - 1]["end_bar_exclusive"]:
            fixed[i]["start_bar"] = fixed[i - 1]["end_bar_exclusive"]
            adjusted += 1

    return [s for s in fixed if s["end_bar_exclusive"] > s["start_bar"]], adjusted


def _section_block(
    sec: dict,
    rhythm: RhythmResult,
    energy: EnergyResult,
    melody: Optional[MelodyResult],
    stems: Optional[StemFeatureResult],
    rep_stats: Optional[dict],
    repeat_link: Optional[dict],
    grid: _BarGrid,
) -> dict:
    start = grid.bar_start(sec["start_bar"])
    end = grid.end_of_range(sec["end_bar_exclusive"])
    span = max(end - start, 1e-6)

    # ---- energy ------------------------------------------------------------
    e_mean = _mean_between(energy.times, energy.rms_smooth, start, end)
    e_peak = None
    if energy.times.size:
        mask = (energy.times >= start) & (energy.times < end)
        if mask.any():
            e_peak = float(np.max(energy.rms_smooth[mask]))
    third = span / 3.0
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
        norm = util.clamp01((n_in / span) / _ONSET_DENSITY_REF_NPS)
        kick = util.fnum(norm * (pieces.get("kickLike") or 0.0), 4)
        snare = util.fnum(norm * (pieces.get("snareLike") or 0.0), 4)
        high = util.fnum(norm * (pieces.get("highPercussionLike") or 0.0), 4)

    # ---- melody -----------------------------------------------------------------
    # ``activity`` is the fraction of pitch frames that actually carry a pitch,
    # not a loudness: it answers "is a melody present here", which is the only
    # melody question a director needs at section resolution.
    melody_activity = None
    melody_density = None
    melody_contour = None
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
            melody_density = util.clamp01((len(notes) / span) / _MELODY_DENSITY_REF_NPS)
        directions: Dict[str, int] = {}
        for ph in melody.phrases:
            if ph["end"] > start and ph["start"] < end:
                d = ph.get("direction")
                if d:
                    directions[d] = directions.get(d, 0) + 1
        if directions:
            melody_contour = sorted(directions.items(), key=lambda kv: (-kv[1], kv[0]))[0][0]

    return {
        "section_id": sec["section_id"],
        "start_bar": sec["start_bar"],
        "end_bar_exclusive": sec["end_bar_exclusive"],
        "start_sec": util.fnum(start),
        "end_sec": util.fnum(end),
        "energy": {"mean": util.fnum(e_mean, 4), "peak": util.fnum(e_peak, 4), "trend": trend},
        "rhythm": {
            "onset_density": util.fnum(onset_density, 4),
            "kick_activity": kick,
            "snare_activity": snare,
            "high_percussion_activity": high,
        },
        "stems": {k: util.fnum(v, 4) for k, v in stem_activity.items()},
        "melody": {
            "activity": util.fnum(melody_activity, 4),
            "density": util.fnum(melody_density, 4),
            "contour": melody_contour,
        },
        "repeat": repeat_link,
    }


def _normalize_phrases(
    phrasing: PhraseResult,
    sections: List[dict],
    grid: _BarGrid,
    guard: _DurationGuard,
) -> Tuple[List[dict], int, int]:
    """Half-open phrase ranges, clipped into their section.

    The phrasing layer segments on times and its phrase can straddle a section
    boundary (phrase 004 starts in section 01's last bar). Clipping to the owning
    section is what keeps "a phrase belongs to exactly one section" true.
    """
    if not grid.usable or not sections:
        return [], 0, 0

    by_id = {s["section_id"]: s for s in sections}
    out: List[dict] = []
    clipped = 0
    dropped = 0

    for ph in phrasing.phrases:
        section = by_id.get(ph.get("section_id"))
        if section is None:
            dropped += 1
            continue
        start = guard.keep(ph.get("start"), "phrase")
        end = guard.keep(ph.get("end"), "phrase")
        if start is None or end is None or end <= start:
            dropped += 1
            continue

        start_bar = grid.start_bar_of_time(start)
        end_bar_excl = grid.end_bar_exclusive_of_time(end)
        if start_bar is None or end_bar_excl is None:
            dropped += 1
            continue

        sec_start = section["start_bar"]
        sec_end = section["end_bar_exclusive"]
        clipped_start = max(start_bar, sec_start)
        clipped_end = min(end_bar_excl, sec_end)
        if clipped_start != start_bar or clipped_end != end_bar_excl:
            clipped += 1
        if clipped_end <= clipped_start:
            dropped += 1
            continue

        kept_times = [
            guard.keep(t, "phrase_event_ref")
            for t in (ph.get("important_event_times") or [])
        ]
        out.append({
            "phrase_id": ph.get("phrase_id"),
            "section_id": ph.get("section_id"),
            "start_bar": clipped_start,
            "end_bar_exclusive": clipped_end,
            "bar_count": clipped_end - clipped_start,
            "start_sec": util.fnum(grid.bar_start(clipped_start)),
            "end_sec": util.fnum(grid.end_of_range(clipped_end)),
            "confidence": util.fnum(ph.get("confidence"), 4),
            "position_label": ph.get("position_label") or "other",
            "energy": {
                "mean": util.fnum(ph.get("energy_mean"), 4),
                "trend": ph.get("energy_trend"),
            },
            "dominant_layers": list(ph.get("dominant_layers") or []),
            "melody_contour": ph.get("melody_contour"),
            "important_event_times": [util.fnum(t) for t in kept_times if t is not None],
        })

    out.sort(key=lambda p: (p["start_bar"], p["end_bar_exclusive"], p["phrase_id"] or ""))
    return out, clipped, dropped


def _bar_curve(
    ctx: AudioContext,
    rhythm: RhythmResult,
    energy: EnergyResult,
    stems: Optional[StemFeatureResult],
    grid: _BarGrid,
) -> List[dict]:
    """One compact record per bar: the primary control signal for the director."""
    if not grid.usable:
        return []

    stems_ok = stems is not None and stems.available
    stem_curves = stems.curves if stems_ok else {}
    stem_times = stems.times if stems_ok else np.zeros(0)

    rows: List[dict] = []
    for b in grid.bars:
        lo, hi = b["start"], b["end"]
        bar_sec = max(hi - lo, 1e-6)
        e = _mean_between(energy.times, energy.rms_smooth, lo, hi)
        drums = _mean_between(stem_times, stem_curves.get("drumsActivity"), lo, hi)
        drums_density = _mean_between(stem_times, stem_curves.get("drumsDensity"), lo, hi)
        bass = _mean_between(stem_times, stem_curves.get("bassActivity"), lo, hi)
        vocals = _mean_between(stem_times, stem_curves.get("vocalsActivity"), lo, hi)
        other = _mean_between(stem_times, stem_curves.get("otherActivity"), lo, hi)
        n_onsets = float(np.sum((rhythm.onset_times >= lo) & (rhythm.onset_times < hi)))
        onset_density = util.clamp01((n_onsets / bar_sec) / _ONSET_DENSITY_REF_NPS)

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

        rows.append({
            "bar": b["bar"],
            "start_sec": util.fnum(lo),
            "energy": util.fnum(e, 4),
            "drums": util.fnum(drums, 4),
            "bass": util.fnum(bass, 4),
            "vocals": util.fnum(vocals, 4),
            "melody": util.fnum(other, 4),
            "onset_density": util.fnum(onset_density, 4),
            "combined_intensity": util.fnum(combined, 4),
        })

    # Derived flags need neighbours, so they are a second pass.
    for i, row in enumerate(rows):
        value = row["combined_intensity"]
        prev = rows[i - 1]["combined_intensity"] if i > 0 else None
        nxt = rows[i + 1]["combined_intensity"] if i + 1 < len(rows) else None
        change = (
            util.fnum(value - prev, 4)
            if value is not None and prev is not None
            else None
        )
        row["derived"] = {
            "intensity_class": _intensity_class(value),
            "change_from_previous": change,
            "is_local_peak": bool(
                value is not None
                and (prev is None or value >= prev)
                and (nxt is None or value >= nxt)
                and ((prev is not None and value > prev) or (nxt is not None and value > nxt))
            ),
            "is_local_valley": bool(
                value is not None
                and (prev is None or value <= prev)
                and (nxt is None or value <= nxt)
                and ((prev is not None and value < prev) or (nxt is not None and value < nxt))
            ),
            "is_build": bool(change is not None and change >= _BAR_CHANGE_THRESHOLD),
            "is_release": bool(change is not None and change <= -_BAR_CHANGE_THRESHOLD),
        }
    return rows


# ---------------------------------------------------------------------------
# Anchors
# ---------------------------------------------------------------------------

def _collect_anchors(
    events: List[dict],
    sections: List[dict],
    phrases: List[dict],
    grid: _BarGrid,
    guard: _DurationGuard,
    rhythm: RhythmResult,
) -> Tuple[List[dict], int]:
    """Deduplicated, ranked, generation-safe anchors (prompt 6.7).

    Three passes, each one recorded: drop what is not in the song, thin each
    high-frequency type by strength with a minimum spacing, then keep the whole
    set inside a budget -- curated types first, weakest pooled types last.
    """
    beat_len = rhythm.beat_len or 0.5
    bpb = int(rhythm.time_signature[0])
    spacing = dict(_ANCHOR_SPACING_BEATS)
    spacing["strong_beat"] = float(config.DIRECTOR_STRONG_BEAT_SPACING_BARS * bpb)
    spacing["strong_onset"] = float(config.DIRECTOR_STRONG_ONSET_SPACING_BEATS)

    candidates: List[dict] = []

    # ``section_boundary`` / ``phrase_boundary`` also appear as analysis events,
    # but the derived ones below are authoritative (they sit exactly on the
    # normalized grid). Taking both would double-count every structural edge.
    derived_types = {"section_boundary", "phrase_boundary"}

    for e in events:
        etype = e.get("type")
        if etype not in _ANCHOR_PRIORITY or etype in derived_types:
            continue  # also skips the plain "beat" grid events
        t = guard.keep(e.get("time"), "event")
        if t is None:
            continue
        candidates.append({
            "time_sec": t,
            "type": etype,
            "strength": util.fnum(e.get("strength"), 4),
            "source": e.get("source"),
        })

    # Structural anchors are derived, not detected -- they are always in range
    # because sections and phrases were normalized onto the grid first.
    for sec in sections:
        t = grid.bar_start(sec["start_bar"])
        if guard.keep(t, "event") is not None:
            candidates.append({
                "time_sec": t, "type": "section_boundary", "strength": 1.0,
                "source": "structure",
            })
    for ph in phrases:
        t = grid.bar_start(ph["start_bar"])
        if guard.keep(t, "event") is not None:
            candidates.append({
                "time_sec": t, "type": "phrase_boundary",
                "strength": util.fnum(ph.get("confidence"), 4) or 0.5,
                "source": "phrasing",
                "confidence": util.fnum(ph.get("confidence"), 4),
            })

    # ---- merge near-duplicates -------------------------------------------
    # Two detectors firing on the same musical moment are one anchor. Bucket by
    # a fraction of a beat and keep the strongest, recording what it absorbed.
    bucket = max(_ANCHOR_MERGE_BEATS * beat_len, 1e-3)
    merged_count = 0
    buckets: Dict[Tuple[str, int], List[dict]] = {}
    for c in candidates:
        key = (c["type"], int(round(c["time_sec"] / bucket)))
        buckets.setdefault(key, []).append(c)
    deduped: List[dict] = []
    for group in buckets.values():
        if len(group) == 1:
            deduped.append(group[0])
            continue
        group.sort(key=lambda c: (-(c.get("strength") or 0.0), c["time_sec"]))
        winner = dict(group[0])
        merged_count += len(group) - 1
        deduped.append(winner)

    # ---- per-type spacing -------------------------------------------------
    kept: List[dict] = []
    for etype, min_spacing_b in spacing.items():
        pool = sorted(
            (c for c in deduped if c["type"] == etype),
            key=lambda c: (-(c.get("strength") or 0.0), c["time_sec"]),
        )
        if min_spacing_b is None:
            kept.extend(pool)
            continue
        min_gap = min_spacing_b * beat_len
        taken: List[float] = []
        for c in pool:
            if any(abs(c["time_sec"] - u) < min_gap for u in taken):
                merged_count += 1
                continue
            taken.append(c["time_sec"])
            kept.append(c)

    # ---- budget ------------------------------------------------------------
    budget = config.DIRECTOR_V2_ANCHOR_BUDGET
    if len(kept) > budget:
        rank = {"high": 2, "medium": 1, "low": 0}
        kept.sort(
            key=lambda c: (
                rank[_ANCHOR_PRIORITY[c["type"]]],
                c.get("strength") if c.get("strength") is not None else -1.0,
            )
        )
        drop = len(kept) - budget
        kept = kept[drop:]
        merged_count += drop

    # ---- publish -----------------------------------------------------------
    anchors: List[dict] = []
    for c in kept:
        priority = _ANCHOR_PRIORITY[c["type"]]
        strength = c.get("strength")
        if priority == "medium" and strength is not None and strength >= 0.9:
            priority = "high"
        anchors.append({
            "time_sec": util.fnum(c["time_sec"]),
            "bar": grid.bar_of_time(c["time_sec"]),
            "beat_in_bar": grid.beat_in_bar(c["time_sec"]),
            "type": c["type"],
            "strength": strength,
            # Only structural anchors carry a detection confidence of their own;
            # for a detected anchor, ``strength`` *is* the evidence.
            "confidence": c.get("confidence"),
            "priority": priority,
            "source": c.get("source"),
        })

    anchors.sort(key=lambda a: (a["time_sec"], a["type"]))
    return anchors, merged_count


# ---------------------------------------------------------------------------
# Repeat structure
# ---------------------------------------------------------------------------

def _recommended_relation(delta: Optional[float], occurrences: int) -> str:
    """Deterministic gameplay-relation hint -- derived, never an LLM call."""
    if occurrences < 2:
        return "statement"
    if delta is None:
        return "reprise_equivalent"
    if delta >= 0.15:
        return "reprise_with_escalation"
    if delta <= -0.15:
        return "reprise_with_reduction"
    return "reprise_equivalent"


def _repeat_block(
    repetition: RepetitionResult, section_by_id: Dict[str, dict]
) -> List[dict]:
    comparisons_by_group: Dict[str, List[dict]] = {}
    for c in repetition.comparisons:
        comparisons_by_group.setdefault(c.get("group_id"), []).append(c)

    out: List[dict] = []
    for group in repetition.groups:
        gid = group.get("group_id")
        occs = []
        for occ in group.get("occurrences", []):
            sec = section_by_id.get(occ.get("section_id"))
            if sec is None:
                continue
            occs.append({
                "section_id": occ.get("section_id"),
                "occurrence": occ.get("occurrence_index"),
                "start_bar": sec["start_bar"],
                "end_bar_exclusive": sec["end_bar_exclusive"],
                "start_sec": sec["start_sec"],
                "end_sec": sec["end_sec"],
                "similarity": util.fnum(occ.get("similarity_to_group"), 4),
            })
        occs.sort(key=lambda o: (o["occurrence"] or 0, o["start_bar"]))
        if not occs:
            continue

        comps = sorted(
            comparisons_by_group.get(gid, []),
            key=lambda c: (c.get("occurrence") or 0, c.get("compared_to_occurrence") or 0),
        )

        def _mean_delta(key: str) -> Optional[float]:
            vals = [c.get(key) for c in comps if c.get(key) is not None]
            return util.fnum(float(np.mean(vals)), 4) if vals else None

        arrangement_delta = _mean_delta("arrangement_intensity_delta")
        variation_profile = {
            "energy_delta": _mean_delta("energy_delta"),
            "drum_delta": _mean_delta("drum_activity_delta"),
            "bass_delta": _mean_delta("bass_activity_delta"),
            "vocal_delta": _mean_delta("vocal_activity_delta"),
            "onset_density_delta": _mean_delta("onset_density_delta"),
            "arrangement_intensity_delta": arrangement_delta,
        }
        out.append({
            "repeat_group_id": gid,
            "confidence": util.fnum(group.get("confidence"), 4),
            "occurrences": occs,
            "similarity": util.fnum(group.get("confidence"), 4),
            "variation_profile": variation_profile,
            "recommended_gameplay_relation": _recommended_relation(
                arrangement_delta, len(occs)
            ),
        })
    out.sort(key=lambda g: g["repeat_group_id"] or "")
    return out


def _repeat_index(repeats: List[dict]) -> Dict[str, dict]:
    index: Dict[str, dict] = {}
    for group in repeats:
        total = len(group["occurrences"])
        for occ in group["occurrences"]:
            index[occ["section_id"]] = {
                "group_id": group["repeat_group_id"],
                "occurrence": occ["occurrence"],
                "total_occurrences": total,
                "similarity": occ["similarity"],
            }
    return index


# ---------------------------------------------------------------------------
# Design features
# ---------------------------------------------------------------------------

def _phrase_design_features(
    phrases: List[dict],
    sections: List[dict],
    repeat_index: Dict[str, dict],
) -> None:
    """Annotate each phrase in place -- intensity rank, density hint, role flags."""
    phrase_energies = [p["energy"]["mean"] for p in phrases]
    section_energies = [s["energy"]["mean"] for s in sections]
    peak_section = None
    if section_energies and any(v is not None for v in section_energies):
        peak_section = max(
            (s for s in sections if s["energy"]["mean"] is not None),
            key=lambda s: s["energy"]["mean"],
            default=None,
        )
    peak_section_id = peak_section["section_id"] if peak_section else None

    by_section: Dict[str, List[dict]] = {}
    for p in phrases:
        by_section.setdefault(p["section_id"], []).append(p)

    for p in phrases:
        rel = _percentile_rank(phrase_energies, p["energy"]["mean"])
        section_peers = by_section.get(p["section_id"], [])
        is_section_peak = bool(
            section_peers
            and p["energy"]["mean"] is not None
            and p["energy"]["mean"] >= max(
                (q["energy"]["mean"] for q in section_peers if q["energy"]["mean"] is not None),
                default=float("-inf"),
            )
        )
        section = next((s for s in sections if s["section_id"] == p["section_id"]), None)
        at_section_edge = bool(
            section
            and (
                p["start_bar"] == section["start_bar"]
                or p["end_bar_exclusive"] == section["end_bar_exclusive"]
            )
        )
        p["design_features"] = {
            "relative_intensity": rel,
            "recommended_density": (
                util.fnum(util.clamp01(0.15 + 0.75 * rel), 4) if rel is not None else None
            ),
            "is_transition_candidate": bool(
                at_section_edge and (p["energy"]["trend"] in ("falling", "rising"))
            ),
            "is_climax_candidate": bool(
                is_section_peak and p["section_id"] == peak_section_id
            ),
            "is_recovery_candidate": bool(rel is not None and rel <= 0.25),
            "motif_recurrence_candidate": bool(p["section_id"] in repeat_index),
        }


def _sync_checkpoints(
    sections: List[dict], curve: List[dict], grid: _BarGrid
) -> List[dict]:
    """Deterministic manual-sync landmarks the user can playtest (prompt 32)."""
    checkpoints: List[dict] = []
    seen: set = set()

    def add(bar: Optional[int], reason: str) -> None:
        if bar is None or bar in seen or not (1 <= bar <= grid.n_bars):
            return
        seen.add(bar)
        checkpoints.append({"bar": bar, "reason": reason})

    add(1, "song start")
    for sec in sections[1:]:
        add(sec["start_bar"], "section boundary")

    scored = [
        (row["bar"], row["combined_intensity"])
        for row in curve
        if row["combined_intensity"] is not None
    ]
    if scored:
        top = max(scored, key=lambda kv: (kv[1], -kv[0]))
        add(top[0], "highest intensity")
        # Two local peaks spread across the song, so the middle is covered too.
        peaks = [
            (bar, value) for bar, value in scored
            if value >= 0.65 and bar not in seen
        ]
        peaks.sort(key=lambda kv: (-kv[1], kv[0]))
        for bar, _value in peaks[:2]:
            add(bar, "high intensity")

    add(grid.n_bars, "ending")
    checkpoints.sort(key=lambda c: c["bar"])
    return checkpoints


def _reliability(
    rhythm: RhythmResult,
    downbeat: DownbeatResult,
    repetition: RepetitionResult,
    melody: Optional[MelodyResult],
    stems: Optional[StemFeatureResult],
) -> dict:
    tiers = {
        "tempo": _tier(rhythm.tempo_confidence, "tempo"),
        "meter": _tier(rhythm.meter_confidence, "meter"),
        "bar_phase": _tier(downbeat.confidence, "bar_phase"),
        "structure": _tier(
            max((g.get("confidence") or 0.0) for g in repetition.groups)
            if repetition.groups else None,
            "structure",
        ),
        "melody": _tier(melody.confidence if melody is not None else None, "melody"),
        "stem_separation": _tier(
            (stems.activity.get("drums") if stems is not None and stems.available else None),
            "stem_separation",
        ),
    }
    warnings: List[str] = []
    if tiers["meter"] == "low":
        warnings.append("meter confidence is low; manual sync verification recommended")
    if tiers["tempo"] == "low":
        warnings.append("tempo confidence is low; verify the grid against playback")
    if tiers["bar_phase"] == "low":
        warnings.append("bar phase is uncertain; the perceived downbeat may sit off the grid bar")
    if tiers["structure"] == "low":
        warnings.append("no confident repeat group found; section-level structure is a guess")
    if melody is not None and not melody.available:
        warnings.append("melody layer unavailable; melody-derived anchors are absent")
    if stems is None or not stems.available:
        warnings.append("stems unavailable; per-layer activity falls back to the mix")
    if tiers["melody"] == "low" and melody is not None and melody.available:
        warnings.append(
            f"melody backend confidence {util.fnum(melody.confidence, 4)} is low; "
            "pitch-derived anchors are advisory"
        )
    return {**tiers, "warnings": warnings}


# ---------------------------------------------------------------------------
# Builder
# ---------------------------------------------------------------------------

def build_director_context_v2(
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
    """Compress one full V2 analysis into the generation-facing document."""
    guard = _DurationGuard(ctx.duration)
    grid = _BarGrid(rhythm, ctx.duration)

    raw_sections, sections_adjusted = _normalize_sections(structure, grid, guard)
    repeats = _repeat_block(repetition, {s["section_id"]: _section_placeholder(s, grid) for s in raw_sections})
    repeat_index = _repeat_index(repeats)

    sections = [
        _section_block(
            sec,
            rhythm,
            energy,
            melody,
            stems,
            repetition.section_stats.get(sec["section_id"]),
            repeat_index.get(sec["section_id"]),
            grid,
        )
        for sec in raw_sections
    ]

    phrases, phrases_clipped, phrases_dropped = _normalize_phrases(phrasing, sections, grid, guard)
    _phrase_design_features(phrases, sections, repeat_index)

    curve = _bar_curve(ctx, rhythm, energy, stems, grid)
    anchors, anchors_merged = _collect_anchors(events, sections, phrases, grid, guard, rhythm)

    # Attach the strongest in-range anchors to the phrase that contains them.
    for ph in phrases:
        inside = [
            a for a in anchors
            if ph["start_bar"] <= (a["bar"] or 0) <= ph["end_bar_exclusive"] - 1
        ]
        inside.sort(key=lambda a: (-(a["strength"] or 0.0), a["time_sec"]))
        ph["anchors"] = [
            {
                "time_sec": a["time_sec"],
                "bar": a["bar"],
                "beat_in_bar": a["beat_in_bar"],
                "type": a["type"],
                "strength": a["strength"],
                "priority": a["priority"],
            }
            for a in inside[:_PHRASE_ANCHOR_LIMIT]
        ]

    # Melody peaks that survive the duration rule, for the melody block.
    melody_peaks: List[dict] = []
    if melody is not None and melody.available:
        for n in sorted(melody.notes, key=lambda n: (-n["pitchMidi"], n["start"])):
            t = guard.keep(n["start"], "note")
            if t is None:
                continue
            melody_peaks.append({
                "time_sec": util.fnum(t),
                "bar": grid.bar_of_time(t),
                "pitch_midi": n["pitchMidi"],
            })
            if len(melody_peaks) >= 5:
                break

    diagnostics = {
        "dropped_out_of_range_events": guard.dropped.get("event", 0),
        "dropped_out_of_range_notes": guard.dropped.get("note", 0),
        "dropped_out_of_range_phrase_refs": guard.dropped.get("phrase_event_ref", 0),
        "dropped_out_of_range_sections": guard.dropped.get("section", 0),
        "dropped_out_of_range_phrases": guard.dropped.get("phrase", 0) + phrases_dropped,
        "deduplicated_anchors": anchors_merged,
        "sections_range_adjusted": sections_adjusted,
        "phrases_clipped_to_section": phrases_clipped,
        "timeline_window_count": int(len(energy.times)),
        "input_schema_valid": _input_is_v2(global_summary, rhythm, structure),
        "output_schema_valid": False,  # set below, after the document exists
    }

    document = {
        "schema_version": DIRECTOR_V2_SCHEMA_VERSION,
        "source": _source_block(ctx),
        "timing": _timing_block(rhythm, downbeat, grid),
        "music_profile": _music_profile(global_summary, tonal, rhythm),
        "sections": sections,
        "phrases": phrases,
        "bar_curve": curve,
        "anchors": anchors,
        "repeat_groups": repeats,
        "melody": {
            "available": bool(melody is not None and melody.available),
            "backend": melody.backend if melody is not None else None,
            "input_source": melody.input_source if melody is not None else None,
            "confidence": util.fnum(melody.confidence, 4) if melody is not None else None,
            "note_count": len(melody.notes) if melody is not None else 0,
            "note_density": util.fnum(melody.note_density, 4) if melody is not None else None,
            "pitch_range_semitones": (
                melody.pitch_range_semitones if melody is not None else None
            ),
            "peaks": melody_peaks,
        },
        "sync_checkpoints": _sync_checkpoints(sections, curve, grid),
        "reliability": _reliability(rhythm, downbeat, repetition, melody, stems),
        "diagnostics": diagnostics,
    }

    problems = validate_director_context_v2(document)
    diagnostics["output_schema_valid"] = not problems
    if problems:
        diagnostics["validation_problems"] = problems
    return document


def _section_placeholder(sec: dict, grid: _BarGrid) -> dict:
    """Minimal section record so the repeat block can carry bar ranges."""
    return {
        "section_id": sec["section_id"],
        "start_bar": sec["start_bar"],
        "end_bar_exclusive": sec["end_bar_exclusive"],
        "start_sec": util.fnum(grid.bar_start(sec["start_bar"])),
        "end_sec": util.fnum(grid.end_of_range(sec["end_bar_exclusive"])),
    }


def _input_is_v2(global_summary: dict, rhythm: RhythmResult, structure: StructureResult) -> bool:
    """A cheap structural sanity check on the analysis we were handed."""
    return bool(
        isinstance(global_summary, dict)
        and "overallEnergy" in global_summary
        and getattr(rhythm, "time_signature", None)
        and isinstance(getattr(structure, "sections", None), list)
    )


# ---------------------------------------------------------------------------
# Structural validation
# ---------------------------------------------------------------------------

def validate_director_context_v2(doc: dict) -> List[str]:
    """Dependency-free structural validation of a director context V2 document.

    This is the same relationship ``editor/generator/validate.js`` has to the
    runtime's ``LevelLoader``: a mirror that the pipeline can run without a JSON
    Schema library, kept honest by a pytest test that also validates the
    published schema. Deterministic by construction -- no optional dependency can
    change the bytes this writes.
    """
    problems: List[str] = []

    if doc.get("schema_version") != DIRECTOR_V2_SCHEMA_VERSION:
        problems.append(f"schema_version must be {DIRECTOR_V2_SCHEMA_VERSION!r}")

    source = doc.get("source") or {}
    duration = source.get("duration_sec")
    if not isinstance(duration, (int, float)) or duration <= 0:
        problems.append("source.duration_sec must be a positive number")
        duration = 0.0

    timing = doc.get("timing") or {}
    n_bars = timing.get("bar_count")
    bars = timing.get("bars")
    if not isinstance(n_bars, int) or n_bars < 0:
        problems.append("timing.bar_count must be a non-negative integer")
        n_bars = 0
    if not isinstance(bars, list) or len(bars) != n_bars:
        problems.append(f"timing.bars must have exactly bar_count ({n_bars}) entries")

    def check_time(value, where: str) -> None:
        if value is None:
            return
        if not isinstance(value, (int, float)):
            problems.append(f"{where}: {value!r} is not a number")
            return
        if value < 0 or value > duration + 1e-6:
            problems.append(f"{where}: {value} is outside 0..{duration}")

    def check_bar(value, where: str, allow_end: bool = False) -> None:
        hi = n_bars + 1 if allow_end else n_bars
        if not isinstance(value, int) or not (1 <= value <= hi):
            problems.append(f"{where}: bar {value!r} outside 1..{hi}")

    sections = doc.get("sections") or []
    if not isinstance(sections, list):
        problems.append("sections must be an array")
        sections = []
    previous_end = None
    section_ids = set()
    for i, sec in enumerate(sections):
        where = f"sections[{i}]"
        sid = sec.get("section_id")
        if not isinstance(sid, str) or not sid:
            problems.append(f"{where}: section_id must be a non-empty string")
        elif sid in section_ids:
            problems.append(f"{where}: duplicate section_id {sid!r}")
        else:
            section_ids.add(sid)
        check_bar(sec.get("start_bar"), f"{where}.start_bar")
        check_bar(sec.get("end_bar_exclusive"), f"{where}.end_bar_exclusive", allow_end=True)
        if (
            isinstance(sec.get("start_bar"), int)
            and isinstance(sec.get("end_bar_exclusive"), int)
            and sec["end_bar_exclusive"] <= sec["start_bar"]
        ):
            problems.append(f"{where}: end_bar_exclusive must be greater than start_bar")
        if previous_end is not None and sec.get("start_bar") != previous_end:
            problems.append(
                f"{where}: sections must be contiguous -- starts at {sec.get('start_bar')}, "
                f"previous ended at {previous_end}"
            )
        previous_end = sec.get("end_bar_exclusive")
        check_time(sec.get("start_sec"), f"{where}.start_sec")
        check_time(sec.get("end_sec"), f"{where}.end_sec")

    phrases = doc.get("phrases") or []
    for i, ph in enumerate(phrases):
        where = f"phrases[{i}]"
        if ph.get("section_id") not in section_ids:
            problems.append(f"{where}: unknown section_id {ph.get('section_id')!r}")
        check_bar(ph.get("start_bar"), f"{where}.start_bar")
        check_bar(ph.get("end_bar_exclusive"), f"{where}.end_bar_exclusive", allow_end=True)
        if (
            isinstance(ph.get("start_bar"), int)
            and isinstance(ph.get("end_bar_exclusive"), int)
            and ph["end_bar_exclusive"] <= ph["start_bar"]
        ):
            problems.append(f"{where}: end_bar_exclusive must be greater than start_bar")
        owner = next((s for s in sections if s.get("section_id") == ph.get("section_id")), None)
        if owner is not None:
            if ph.get("start_bar", 1) < owner.get("start_bar", 1) or ph.get(
                "end_bar_exclusive", 1
            ) > owner.get("end_bar_exclusive", 1):
                problems.append(f"{where}: phrase escapes its section's bar range")
        check_time(ph.get("start_sec"), f"{where}.start_sec")
        check_time(ph.get("end_sec"), f"{where}.end_sec")
        for j, t in enumerate(ph.get("important_event_times") or []):
            check_time(t, f"{where}.important_event_times[{j}]")

    curve = doc.get("bar_curve") or []
    if len(curve) != n_bars:
        problems.append(f"bar_curve must have exactly bar_count ({n_bars}) entries")
    for i, row in enumerate(curve):
        if row.get("bar") != i + 1:
            problems.append(f"bar_curve[{i}].bar must be {i + 1}")
            break
        check_time(row.get("start_sec"), f"bar_curve[{i}].start_sec")

    anchors = doc.get("anchors") or []
    for i, a in enumerate(anchors):
        where = f"anchors[{i}]"
        if a.get("type") not in ANCHOR_TYPES:
            problems.append(f"{where}: unknown type {a.get('type')!r}")
        check_time(a.get("time_sec"), f"{where}.time_sec")
        check_bar(a.get("bar"), f"{where}.bar")
        if a.get("priority") not in ("high", "medium", "low"):
            problems.append(f"{where}: priority must be high|medium|low")

    for i, group in enumerate(doc.get("repeat_groups") or []):
        where = f"repeat_groups[{i}]"
        for j, occ in enumerate(group.get("occurrences") or []):
            if occ.get("section_id") not in section_ids:
                problems.append(f"{where}.occurrences[{j}]: unknown section_id")

    diagnostics = doc.get("diagnostics") or {}
    for key in (
        "dropped_out_of_range_events",
        "dropped_out_of_range_notes",
        "dropped_out_of_range_phrase_refs",
        "deduplicated_anchors",
        "timeline_window_count",
    ):
        if not isinstance(diagnostics.get(key), int):
            problems.append(f"diagnostics.{key} must be an integer")

    return problems

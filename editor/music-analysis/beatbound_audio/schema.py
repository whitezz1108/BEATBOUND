"""Document assembly: the V2 root shape, and the legacy v1 projection.

Two responsibilities live here, and they exist for different reasons.

**1. ``build_document``** produces the prompt section 4 root::

    {schemaVersion, source, global, timeline, sections, events, analysisMeta}

plus a ``layers`` block holding the per-layer detail (rhythm, energy, tonal,
stems, melody, structure). ``layers`` is additional to the seven required keys:
sections 8-11 ask for note events, per-stem descriptors and chroma, and there is
nowhere else honest to put them. Every key the prompt names is present and
populated.

**2. ``project_legacy``** regenerates the exact v1 ``music_analysis.json``
object from the V2 results. This is what lets ``analyze_music.py``, the v1
schema, ``editor/generator/levelDirector.js`` and ``editor/ui/editor.js`` all
keep working with zero edits -- the upgrade is additive.

Determinism: nothing in the document records wall-clock time. The prompt's
section 20 determinism test requires the same audio to produce byte-identical
JSON, and a ``generatedAt`` field would defeat that. Timings live in the
CLI's human-readable report instead, never in the artifact.
"""

from __future__ import annotations

from typing import Dict, List, Optional, Tuple

import numpy as np

from . import config, util, version
from .results import (
    AudioContext,
    DownbeatResult,
    EnergyResult,
    MelodyResult,
    PhraseResult,
    RepetitionResult,
    RhythmResult,
    StemFeatureResult,
    StemResult,
    StructureResult,
    TonalResult,
)

#: Nominal tempo used by the legacy projection when none could be estimated.
#: The v1 schema requires ``bpm > 0``, so a silent file has to project *some*
#: grid; the substitution is recorded in ``report.tempoFallback`` rather than
#: hidden.
_LEGACY_FALLBACK_BPM = 120.0

#: v1's bar-to-bar energy-change threshold.
_LEGACY_ENERGY_DELTA = 0.18


# ---------------------------------------------------------------------------
# V2 document
# ---------------------------------------------------------------------------

def _source_block(ctx: AudioContext) -> dict:
    return {
        "path": ctx.path,
        "file": ctx.file,
        "songId": ctx.song_id,
        "title": ctx.title,
        "durationSec": util.fnum(ctx.duration, 6),
        "sampleRate": ctx.sr,
        "nativeSampleRate": ctx.native_sr,
        "channels": ctx.channels,
        "sourceHash": ctx.source_hash,
        "audioHash": ctx.audio_hash,
    }


def _rhythm_layer(rhythm: RhythmResult) -> dict:
    return {
        "bpm": util.fnum(rhythm.bpm, 2),
        "tempoConfidence": util.fnum(rhythm.tempo_confidence, 4),
        "timeSignature": list(rhythm.time_signature),
        "meterConfidence": util.fnum(rhythm.meter_confidence, 4),
        "beatLengthSec": util.fnum(rhythm.beat_len, 6),
        "beatCount": rhythm.n_beats,
        "barCount": rhythm.n_bars,
        "gridAnchoredAtSec": 0.0,
        "beats": rhythm.beats,
        "onsets": rhythm.onsets,
    }


def _energy_layer(energy: EnergyResult) -> dict:
    return {
        "overallEnergy": util.fnum(energy.overall_energy, 4),
        "dynamicRange": util.fnum(energy.dynamic_range, 4),
        "loudnessRangeDb": util.fnum(energy.loudness_range_db, 2),
        "timeline": energy.timeline,
    }


def _tonal_layer(tonal: TonalResult) -> dict:
    return {
        "available": bool(tonal.available),
        "key": tonal.key,
        "scale": tonal.scale,
        "keyConfidence": util.fnum(tonal.key_confidence, 4),
        "chromaMean": tonal.chroma_mean,
        "spectralCentroidHz": util.fnum(tonal.centroid_mean_hz, 2),
        "brightness": util.fnum(tonal.brightness, 4),
        "bandBalance": tonal.band_balance,
        "spectralContrastMean": tonal.contrast_mean,
    }


def _stem_reason(raw: Optional[StemResult]) -> str:
    """Why stems are missing, preferring the raw separator's own error.

    ``analyze_stems`` propagates the separator's warnings but not its ``error``
    string, so the specific cause ("model weights are corrupt") is read from the
    raw result when there is one.
    """
    if raw is not None and raw.error:
        return raw.error
    if raw is not None and raw.warnings:
        return raw.warnings[-1]
    return "stem analysis unavailable"


def _stems_layer(stems: Optional[StemFeatureResult], raw: Optional[StemResult]) -> dict:
    if stems is None or not stems.available:
        return {
            "available": False,
            "backend": raw.backend if raw is not None else None,
            "reason": _stem_reason(raw),
            "activity": {name: None for name in ("drums", "bass", "vocals", "other")},
            "drums": {"available": False},
            "bass": {"available": False},
            "vocals": {"available": False},
            "other": {"available": False},
        }
    return {
        "available": True,
        "backend": stems.backend,
        "activity": stems.activity,
        "drums": stems.drums,
        "bass": stems.bass,
        "vocals": stems.vocals,
        "other": stems.other,
    }


def _melody_layer(melody: Optional[MelodyResult]) -> dict:
    if melody is None or not melody.available:
        return {
            "available": False,
            "backend": melody.backend if melody is not None else None,
            "reason": "melody analysis unavailable",
            "notes": [],
            "phrases": [],
            "noteDensity": None,
            "pitchRangeSemitones": None,
        }
    return {
        "available": True,
        "backend": melody.backend,
        "inputSource": melody.input_source,
        "confidence": melody.confidence,
        "noteCount": len(melody.notes),
        "phraseCount": len(melody.phrases),
        "noteDensity": melody.note_density,
        "pitchRangeSemitones": melody.pitch_range_semitones,
        "notes": melody.notes,
        "phrases": melody.phrases,
    }


def _structure_layer(structure: StructureResult) -> dict:
    return {
        "method": structure.method,
        "boundaryCount": len(structure.boundaries),
        "boundaries": util.flist(structure.boundaries),
        "sections": structure.sections,
    }


def _bar_phase_layer(downbeat: DownbeatResult) -> dict:
    """Where inside the grid bar the true musical downbeat sits (V2.1)."""
    return {
        "method": downbeat.method,
        "offsetBeats": downbeat.offset_beats,
        "confidence": downbeat.confidence,
        "downbeatCount": len(downbeat.downbeats),
        "downbeats": downbeat.downbeats,
    }


def _repetition_layer(repetition: RepetitionResult) -> dict:
    """Repeat groups and arrangement deltas over ``structure.sections`` (V2.1)."""
    return {
        "method": repetition.method,
        "threshold": repetition.threshold,
        "groupCount": len(repetition.groups),
        "comparisonCount": len(repetition.comparisons),
        "groups": repetition.groups,
        "comparisons": repetition.comparisons,
        "sectionStats": repetition.section_stats,
    }


def _phrasing_layer(phrasing: PhraseResult) -> dict:
    """Bar-aligned phrase hierarchy inside every section (V2.1)."""
    return {
        "method": phrasing.method,
        "phraseCount": len(phrasing.phrases),
        "phrases": phrasing.phrases,
    }


def _lyrics_block() -> dict:
    """Reserved slot for word-level lyrics (prompt section 7): schema-only.

    Transcription is deliberately not wired up this round, so this is honestly
    closed: no provider, no language, no words -- and nothing downstream may
    treat lyrics as a required input.
    """
    return {
        "available": False,
        "provider": None,
        "language": None,
        "words": [],
    }


def _timeline_block(
    ctx: AudioContext,
    energy: EnergyResult,
    tonal: TonalResult,
    melody: Optional[MelodyResult],
    stems: Optional[StemFeatureResult],
    windows: List[dict],
    envelope_times: np.ndarray,
    envelope_values: np.ndarray,
) -> dict:
    """The unified, fixed-rate timeline plus the downsampled draw curves."""
    rms_t, rms_v = util.downsample(energy.times, energy.rms_smooth, config.ENERGY_POINTS)
    chroma_t, chroma_m = util.downsample_rows(
        tonal.chroma_times, tonal.chroma.T, config.CHROMA_POINTS
    )

    stem_activity: dict = {"times": []}
    if stems is not None and stems.available and stems.curves:
        st, _ = util.downsample(stems.times, stems.times, config.STEM_ACTIVITY_POINTS)
        stem_activity["times"] = util.flist(st)
        for name in ("drums", "bass", "vocals", "other"):
            curve = stems.curves.get(f"{name}Activity")
            if curve is None:
                stem_activity[name] = []
                continue
            _, sv = util.downsample(stems.times, curve, config.STEM_ACTIVITY_POINTS)
            stem_activity[name] = util.flist(sv)

    pitch_times: List[Optional[float]] = []
    pitch_values: List[Optional[float]] = []
    if melody is not None and melody.available and melody.pitch_times.size:
        pt, pv = util.downsample(melody.pitch_times, melody.pitch_norm, config.PITCH_POINTS)
        pitch_times = util.flist(pt)
        pitch_values = util.flist(pv)

    return {
        "windowSec": config.WINDOW_SEC,
        "hopSec": config.WINDOW_HOP_SEC,
        "windows": windows,
        "energyCurve": {"times": util.flist(rms_t), "values": util.flist(rms_v)},
        "rmsCurve": {"times": util.flist(rms_t), "values": util.flist(rms_v)},
        "waveformEnvelope": {
            "times": util.flist(envelope_times),
            "values": util.flist(envelope_values),
        },
        "chroma": {
            "times": util.flist(chroma_t),
            "values": [[util.fnum(v, 5) for v in row] for row in chroma_m],
        },
        "pitchCurve": {"times": pitch_times, "values": pitch_values},
        "stemActivity": stem_activity,
    }


def _analysis_meta(
    ctx: AudioContext,
    rhythm: RhythmResult,
    structure: StructureResult,
    melody: Optional[MelodyResult],
    stems: Optional[StemFeatureResult],
    raw_stems: Optional[StemResult],
    backends: dict,
    warnings: List[str],
    cache_info: dict,
    flags: dict,
) -> dict:
    """What actually ran, as measured.

    Deliberately **run-state-free**: no cache root (an absolute path on this
    machine), no cache hit/miss flags, no timings. Those describe the run, not
    the song, and publishing them would make the artifact depend on whether a
    previous run happened to have warmed the cache -- which would break the
    prompt's byte-determinism requirement. They go in the CLI's debug report
    instead. What stays here is the song-level fact of which backends
    contributed: an uninstalled component is never claimed to have worked.
    """
    return {
        "analyzer": version.ANALYZER_NAME,
        "analyzerVersion": version.ANALYZER_VERSION,
        "schemaVersion": version.SCHEMA_VERSION,
        "legacySchemaVersion": version.LEGACY_SCHEMA_VERSION,
        "settingsSignature": version.SETTINGS_SIGNATURE,
        "settings": {
            "sampleRate": config.SR,
            "hopLength": config.HOP,
            "nFft": config.N_FFT,
            "stemSampleRate": config.STEM_SR,
            "windowSec": config.WINDOW_SEC,
            "windowHopSec": config.WINDOW_HOP_SEC,
            "minSectionBars": config.MIN_SECTION_BARS,
        },
        "flags": flags,
        # What actually ran, not what is installed. A backend that is missing
        # reports available: false with the import error that stopped it.
        "backends": backends,
        "models": {
            "stems": {
                "name": version.STEM_MODEL_NAME,
                "version": version.STEM_MODEL_VERSION,
                "used": bool(stems is not None and stems.available),
            },
            "melody": {
                "name": version.MELODY_MODEL_NAME,
                "version": version.MELODY_MODEL_VERSION,
                "used": bool(melody is not None and melody.available),
            },
        },
        "structureMethod": structure.method,
        "audioHash": cache_info.get("audioHash"),
        "warnings": warnings,
        "sourceSilent": bool(ctx.silent),
    }


def build_document(
    *,
    ctx: AudioContext,
    rhythm: RhythmResult,
    energy: EnergyResult,
    tonal: TonalResult,
    structure: StructureResult,
    melody: Optional[MelodyResult],
    stems: Optional[StemFeatureResult],
    raw_stems: Optional[StemResult],
    windows: List[dict],
    global_summary: dict,
    events: List[dict],
    event_counts: dict,
    envelope_times: np.ndarray,
    envelope_values: np.ndarray,
    backends: dict,
    cache_info: dict,
    flags: dict,
    downbeat: Optional[DownbeatResult] = None,
    repetition: Optional[RepetitionResult] = None,
    phrasing: Optional[PhraseResult] = None,
) -> dict:
    """Assemble the complete ``music_analysis_v2.json`` document."""
    warnings: List[str] = list(ctx.warnings)
    warnings += rhythm_warnings(rhythm)
    warnings += tonal.warnings
    warnings += structure.warnings
    if melody is not None:
        warnings += melody.warnings
    if stems is not None:
        warnings += stems.warnings
    if downbeat is not None:
        warnings += downbeat.warnings
    if repetition is not None:
        warnings += repetition.warnings
    if phrasing is not None:
        warnings += phrasing.warnings

    return {
        "schemaVersion": version.SCHEMA_VERSION,
        "source": _source_block(ctx),
        "global": global_summary,
        "timeline": _timeline_block(
            ctx, energy, tonal, melody, stems, windows, envelope_times, envelope_values
        ),
        "sections": structure.sections,
        "events": events,
        "layers": {
            "rhythm": _rhythm_layer(rhythm),
            "energy": _energy_layer(energy),
            "tonal": _tonal_layer(tonal),
            "stems": _stems_layer(stems, raw_stems),
            "melody": _melody_layer(melody),
            "structure": _structure_layer(structure),
            "barPhase": _bar_phase_layer(
                downbeat
                or DownbeatResult(
                    offset_beats=None, confidence=None, downbeats=[], method="none"
                )
            ),
            "repetition": _repetition_layer(
                repetition
                or RepetitionResult(
                    groups=[], comparisons=[], section_stats={},
                    method="none", threshold=0.0,
                )
            ),
            "phrasing": _phrasing_layer(
                phrasing or PhraseResult(phrases=[], method="none")
            ),
            "eventCounts": event_counts,
        },
        "lyrics": _lyrics_block(),
        "analysisMeta": _analysis_meta(
            ctx, rhythm, structure, melody, stems, raw_stems,
            backends, warnings, cache_info, flags,
        ),
    }


def rhythm_warnings(rhythm: RhythmResult) -> List[str]:
    """Warnings the rhythm layer accumulated but could not store itself.

    ``RhythmResult`` carries no ``warnings`` field (it is the oldest type in the
    package), so its two recoverable conditions are re-derived here rather than
    widening the dataclass and touching every caller.
    """
    out: List[str] = []
    if rhythm.silent:
        out.append("audio is silent -- no tempo could be estimated")
    elif rhythm.bpm is None:
        out.append("tempo detection returned no usable value")
    return out


# ---------------------------------------------------------------------------
# Legacy v1 projection
# ---------------------------------------------------------------------------

def _legacy_bars(
    ctx: AudioContext,
    rhythm: RhythmResult,
    energy: EnergyResult,
) -> List[dict]:
    """Rebuild the v1 per-bar feature table from the V2 layer results.

    This reproduces ``analyze_music.py``'s bar loop arithmetic exactly (same
    constant grid, same hop grid, same percentile normalisation *across bars*)
    so the numbers the director sees keep their v1 meaning: bar energy is
    relative to the other bars in this song, not to the frame-level curve.
    """
    if rhythm.bpm is None or rhythm.beat_len is None or rhythm.n_bars <= 0:
        return []

    bpb = rhythm.time_signature[0]
    hop_times = rhythm.hop_times
    rms = energy.rms
    onset_env = rhythm.onset_env
    onset_times = rhythm.onset_times
    n = min(len(hop_times), len(rms), len(onset_env))

    bars: List[dict] = []
    for b in range(rhythm.n_bars):
        start = float(rhythm.bar_bounds[b])
        end = float(min(rhythm.bar_bounds[b + 1], ctx.duration))
        mask = (hop_times[:n] >= start) & (
            hop_times[:n] < max(end, start + config.HOP / max(ctx.sr, 1))
        )
        seg_rms = rms[:n][mask]
        seg_nov = onset_env[:n][mask]
        onsets_in = int(np.sum((onset_times >= start) & (onset_times < end)))
        beat_idx = np.arange(b * bpb, min((b + 1) * bpb, rhythm.n_beats))
        bar_beats = [
            rhythm.beats[i]["strength"]
            for i in beat_idx
            if i < len(rhythm.beats) and rhythm.beats[i]["strength"] is not None
        ]
        bars.append({
            "bar": b + 1,
            "startTime": util.fnum(start),
            "endTime": util.fnum(end),
            "rmsMean": util.fnum(float(np.mean(seg_rms)) if len(seg_rms) else 0.0),
            "rmsPeak": util.fnum(float(np.max(seg_rms)) if len(seg_rms) else 0.0),
            "onsetCount": onsets_in,
            "beatStrength": util.fnum(float(np.mean(bar_beats)) if bar_beats else 0.0, 4),
            "novelty": util.fnum(float(np.max(seg_nov)) if len(seg_nov) else 0.0),
        })

    e_norm = util.percentile_norm(np.array([b["rmsMean"] for b in bars], dtype=float))
    d_norm = util.percentile_norm(np.array([b["onsetCount"] for b in bars], dtype=float))
    n_norm = util.percentile_norm(np.array([b["novelty"] for b in bars], dtype=float))
    for i, bar in enumerate(bars):
        bar["energy"] = util.fnum(float(e_norm[i]), 4)
        bar["rhythmDensity"] = util.fnum(float(d_norm[i]), 4)
        bar["novelty"] = util.fnum(float(n_norm[i]), 4)
    return bars


def _legacy_sections(
    ctx: AudioContext,
    rhythm: RhythmResult,
    structure: StructureResult,
    bars: List[dict],
) -> List[dict]:
    """Project V2 sections onto the v1 section shape.

    v1 required integer ``startBar`` / ``endBar`` >= 1 and a string ``label``;
    V2 sections may carry ``None`` for either. Bars are recovered from the time
    range when the grid exists, and the v1-style ``section_NN`` label is written
    from the section id -- the V2 descriptive label stays in the V2 document.
    """
    out: List[dict] = []
    for i, sec in enumerate(structure.sections):
        start = sec.get("start")
        end = sec.get("end")
        if start is None or end is None:
            continue

        start_bar = sec.get("startBar")
        end_bar = sec.get("endBar")
        if start_bar is None or end_bar is None:
            start_bar, end_bar = _bars_for_range(rhythm, bars, start, end)
        start_bar = max(1, int(start_bar))
        end_bar = max(start_bar, int(end_bar))

        in_range = [b for b in bars if start_bar <= b["bar"] <= end_bar]
        if in_range:
            mean_energy = float(np.mean([b["energy"] for b in in_range]))
            peak_energy = float(np.max([b["energy"] for b in in_range]))
            mean_density = float(np.mean([b["rhythmDensity"] for b in in_range]))
            onset_count = int(np.sum([b["onsetCount"] for b in in_range]))
            start_time = in_range[0]["startTime"]
            end_time = in_range[-1]["endTime"]
        else:
            mean_energy = peak_energy = mean_density = 0.0
            onset_count = 0
            start_time, end_time = util.fnum(start), util.fnum(end)

        section_id = sec.get("id") or f"section_{i + 1:02d}"
        out.append({
            "id": section_id,
            "label": section_id,
            "startBar": start_bar,
            "endBar": end_bar,
            "startTime": start_time,
            "endTime": end_time,
            "durationSec": util.fnum((end_time or 0.0) - (start_time or 0.0)),
            "meanEnergy": util.fnum(mean_energy, 4),
            "peakEnergy": util.fnum(peak_energy, 4),
            "meanRhythmDensity": util.fnum(mean_density, 4),
            "onsetCount": onset_count,
        })
    return out


def _bars_for_range(
    rhythm: RhythmResult, bars: List[dict], start: float, end: float
) -> Tuple[int, int]:
    """First / last bar index overlapping ``[start, end)``."""
    if not bars:
        return 1, 1
    lo = next((b["bar"] for b in bars if b["endTime"] > start), bars[0]["bar"])
    hi = next(
        (b["bar"] for b in reversed(bars) if b["startTime"] < end),
        bars[-1]["bar"],
    )
    return lo, max(lo, hi)


def _legacy_energy_changes(bars: List[dict]) -> List[dict]:
    """v1's bar-to-bar rises / falls, threshold 0.18."""
    out: List[dict] = []
    for i in range(1, len(bars)):
        delta = (bars[i]["energy"] or 0.0) - (bars[i - 1]["energy"] or 0.0)
        if abs(delta) >= _LEGACY_ENERGY_DELTA:
            out.append({
                "time": bars[i]["startTime"],
                "bar": bars[i]["bar"],
                "direction": "rise" if delta > 0 else "fall",
                "magnitude": util.fnum(abs(delta), 4),
            })
    return out


def project_legacy(
    *,
    ctx: AudioContext,
    rhythm: RhythmResult,
    energy: EnergyResult,
    structure: StructureResult,
    bpm_override: Optional[float] = None,
    time_sig: Tuple[int, int] = (4, 4),
    source_document: Optional[dict] = None,
) -> dict:
    """Regenerate the v1 ``music_analysis.json`` object from V2 results.

    The result validates against ``editor/schemas/music-analysis.schema.json``
    unchanged, which is the whole point: the director and the editor UI keep
    consuming the same shape they always did.
    """
    warnings: List[str] = []

    bpm = rhythm.bpm
    tempo_fallback: Optional[str] = None
    if bpm is None:
        bpm = _LEGACY_FALLBACK_BPM
        tempo_fallback = f"nominal {_LEGACY_FALLBACK_BPM:g} bpm (no tempo could be estimated)"
        warnings.append(f"legacy projection: {tempo_fallback}")

    bars = _legacy_bars(ctx, rhythm, energy)
    sections = _legacy_sections(ctx, rhythm, structure, bars)

    # v1's waveform / rms curves were percentile-normalised for drawing.
    envelope_values = util.percentile_norm(
        np.abs(ctx.y[:: config.HOP])[: len(rhythm.hop_times)]
    )
    env_t, env_v = util.downsample(
        rhythm.hop_times, envelope_values, config.ENVELOPE_POINTS
    )
    rms_norm = util.percentile_norm(energy.rms)
    rms_t, rms_v = util.downsample(
        energy.times, rms_norm, config.ENVELOPE_POINTS
    )

    # v1 stripped everything but these five keys per beat.
    beats = [
        {
            "time": b["time"],
            "index": b["index"],
            "bar": b["bar"],
            "beat": b["beat"],
            "strength": b["strength"],
        }
        for b in rhythm.beats
    ]

    return {
        "version": version.LEGACY_SCHEMA_VERSION,
        "song": {
            "id": ctx.song_id,
            "title": ctx.title,
            "audioPath": ctx.path,
            "durationSec": util.fnum(ctx.duration, 6),
            "sampleRate": ctx.sr,
            "sourceHash": ctx.source_hash,
        },
        "tempo": {
            "bpm": util.fnum(bpm, 2),
            "confidence": util.fnum(rhythm.tempo_confidence if bpm_override is None else 1.0, 4) or 0.0,
            "timeSignature": [int(time_sig[0]), int(time_sig[1])],
        },
        "beats": beats,
        "bars": bars,
        "onsets": [
            {"time": o["time"], "strength": o["strength"]}
            for o in rhythm.onsets
        ],
        "energyChanges": _legacy_energy_changes(bars),
        "sections": sections,
        "waveformEnvelope": {"times": util.flist(env_t), "values": util.flist(env_v)},
        "rmsCurve": {"times": util.flist(rms_t), "values": util.flist(rms_v)},
        "report": {
            "analyzer": f"{version.ANALYZER_NAME} {version.ANALYZER_VERSION} (v1 projection)",
            "projectedFrom": f"music_analysis_v2.json (schemaVersion {version.SCHEMA_VERSION})",
            "sampleRate": config.SR,
            "hopLength": config.HOP,
            "bpmOverride": bpm_override,
            "tempoFallback": tempo_fallback,
            "minSectionBars": config.MIN_SECTION_BARS,
            "beats": rhythm.n_beats,
            "bars": len(bars),
            "sections": len(sections),
            "onsets": len(rhythm.onsets),
            "energyChanges": len(_legacy_energy_changes(bars)),
            "warnings": warnings,
        },
    }

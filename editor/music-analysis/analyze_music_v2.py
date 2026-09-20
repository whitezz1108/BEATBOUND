#!/usr/bin/env python3
"""BeatBound music understanding V2.

    Audio file -> analysis layers -> music_analysis_v2.json
                                    (+ a v1 music_analysis.json projection)

This is the V2 entry point. It sits beside ``analyze_music.py`` rather than
replacing it: the v1 script is untouched, and the V2 run additionally writes a
projection that validates against the v1 schema, so the editor server, the level
director and the editor UI keep working without a single edit.

Scope, stated because it is easy to overreach: this tool **describes music**. It
stops at ``music_analysis_v2.json``. It does not generate patterns, levels or
gameplay, does not call an LLM, and does not touch the ARENA / RUNNER /
VERTICAL / RADIAL rule sets.

Usage::

    python analyze_music_v2.py song.mp3 out/music_analysis_v2.json
    python analyze_music_v2.py song.mp3 out/v2.json --full
    python analyze_music_v2.py song.mp3 out/v2.json --fast --force

Modes:
    --fast   rhythm + energy + tonal + structure only  (no ML models)
    --full   everything, including stems and melody    (default)

Deterministic: fixed parameters, no RNG, and no wall-clock field in the
artifact. The same audio yields byte-identical JSON.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import time
from typing import List, Optional

# Make ``beatbound_audio`` importable when run as a script from anywhere.
_HERE = os.path.dirname(os.path.abspath(__file__))
if _HERE not in sys.path:
    sys.path.insert(0, _HERE)

import numpy as np  # noqa: E402

from beatbound_audio import config, util, version  # noqa: E402
from beatbound_audio import melody_analyzer, stem_separator  # noqa: E402
from beatbound_audio.cache import AudioCache, default_root  # noqa: E402
from beatbound_audio.director_context import build_director_context  # noqa: E402
from beatbound_audio.downbeat import analyze_downbeats  # noqa: E402
from beatbound_audio.energy_analyzer import analyze_energy  # noqa: E402
from beatbound_audio.event_builder import build_events, event_counts  # noqa: E402
from beatbound_audio.feature_aggregator import build_global, build_windows  # noqa: E402
from beatbound_audio.melody_analyzer import analyze_melody  # noqa: E402
from beatbound_audio.phrasing import analyze_phrasing  # noqa: E402
from beatbound_audio.preprocess import load_audio, spectrogram  # noqa: E402
from beatbound_audio.repetition import analyze_repetition  # noqa: E402
from beatbound_audio.rhythm_analyzer import analyze_rhythm  # noqa: E402
from beatbound_audio.schema import build_document, project_legacy  # noqa: E402
from beatbound_audio.stem_features import analyze_stems  # noqa: E402
from beatbound_audio.stem_separator import separate_audio  # noqa: E402
from beatbound_audio.structure_analyzer import analyze_structure  # noqa: E402
from beatbound_audio.tonal_analyzer import analyze_tonal  # noqa: E402


class Stage:
    """Wall-clock timer for one pipeline stage (report only, never in JSON)."""

    def __init__(self) -> None:
        self.timings: dict[str, float] = {}
        self._t0 = time.perf_counter()
        self._last = self._t0

    def mark(self, name: str) -> None:
        now = time.perf_counter()
        self.timings[name] = round(now - self._last, 3)
        self._last = now

    @property
    def total(self) -> float:
        return round(time.perf_counter() - self._t0, 3)


def _backend_status(flags: dict) -> dict:
    """What is actually usable here -- reported as measured, not assumed.

    The probes are read off the modules at call time (``stem_separator.demucs_available``)
    rather than imported by name, so a test or an embedder can stub them.
    """
    demucs_ok, demucs_note = stem_separator.demucs_available()
    melody_ok, melody_note = melody_analyzer.backend_available()
    return {
        "stems": {
            "name": version.STEM_MODEL_NAME,
            "available": bool(demucs_ok),
            "detail": demucs_note,
            "enabled": bool(flags.get("stems")),
        },
        "melody": {
            "name": version.MELODY_MODEL_NAME,
            "available": bool(melody_ok),
            "detail": melody_note,
            "enabled": bool(flags.get("melody")),
        },
        "key": {
            "name": "krumhansl-schmuckler",
            "available": True,
            "detail": "built in",
            "enabled": True,
        },
    }


def analyze_v2(
    input_path: str,
    output_path: str,
    *,
    bpm_override: Optional[float] = None,
    time_sig: tuple[int, int] = (4, 4),
    mode: str = "full",
    use_stems: bool = True,
    use_melody: bool = True,
    force: bool = False,
    cache_dir: Optional[str] = None,
    legacy_output: Optional[str] = None,
    director_output: Optional[str] = None,
    quiet: bool = False,
) -> tuple[dict, dict]:
    """Run the whole pipeline and write both JSON documents.

    Returns ``(document, report)``. The document is what was written to
    ``output_path``; the report is run-state -- timings, cache hit/miss, which
    backends were probed -- and is deliberately kept *out* of the artifact, both
    because it would break byte-determinism and because none of it describes the
    song.
    """
    stage = Stage()
    flags = {
        "mode": mode,
        "stems": bool(use_stems and mode != "fast"),
        "melody": bool(use_melody and mode != "fast"),
        "bpmOverride": bpm_override,
        "timeSignature": [int(time_sig[0]), int(time_sig[1])],
        "force": bool(force),
    }

    # ---- 1. decode --------------------------------------------------------
    ctx = load_audio(input_path)
    spec = spectrogram(ctx)
    stage.mark("decode")

    # ---- 2. cache ---------------------------------------------------------
    cache = AudioCache(ctx.audio_hash, root=cache_dir)
    cache.ensure_dir()
    cache_info = {
        "root": cache_dir or default_root(),
        "audioHash": ctx.audio_hash,
        "used": False,
        "sections": [],
    }
    stage.mark("cache")

    # ---- 3. rhythm / energy / tonal ---------------------------------------
    rhythm = analyze_rhythm(ctx, bpm_override=bpm_override, time_sig=time_sig)
    stage.mark("rhythm")
    energy = analyze_energy(ctx)
    stage.mark("energy")
    tonal = analyze_tonal(ctx, spec)
    stage.mark("tonal")

    # ---- 4. stems (optional, expensive) -----------------------------------
    raw_stems = None
    stems = None
    if flags["stems"]:
        raw_stems = separate_audio(
            input_path, cache=cache, sr=config.STEM_SR, force=force, enabled=True
        )
        if raw_stems.cached:
            cache_info["used"] = True
            cache_info["sections"].append("stems")
        if raw_stems.mechanism:
            cache_info["mechanisms"] = {"stems": raw_stems.mechanism}
        stems = analyze_stems(raw_stems)
        stage.mark("stems")

    # ---- 5. melody (optional) ---------------------------------------------
    melody = None
    if flags["melody"]:
        # Ask the cache *before* running, so "used" reports what was actually
        # reused rather than what happened to be available afterwards.
        melody_cached = not force and cache.is_valid(
            model_name=version.MELODY_MODEL_NAME,
            model_version=version.MELODY_MODEL_VERSION,
            section="melody",
        )
        melody = analyze_melody(
            ctx, raw_stems, cache=cache, force=force, enabled=True
        )
        if melody_cached and melody.available:
            cache_info["used"] = True
            cache_info["sections"].append("melody")
        stage.mark("melody")

    # ---- 6. structure ------------------------------------------------------
    structure = analyze_structure(ctx, rhythm, tonal, energy, stems=stems, melody=melody)
    stage.mark("structure")

    # ---- 7. events ---------------------------------------------------------
    events = build_events(rhythm, energy, structure, melody=melody, stems=stems)
    counts = event_counts(events)
    stage.mark("events")

    # ---- 7b. V2.1: bar phase, repetition, phrasing ---------------------------
    downbeat = analyze_downbeats(rhythm)
    stage.mark("downbeat")
    repetition = analyze_repetition(ctx, rhythm, tonal, energy, structure, stems=stems, melody=melody)
    stage.mark("repetition")
    phrasing = analyze_phrasing(
        ctx, rhythm, energy, tonal, structure,
        stems=stems, melody=melody, events=events,
    )
    stage.mark("phrasing")

    # ---- 8. aggregate ------------------------------------------------------
    windows = build_windows(ctx, energy, tonal, melody, stems)
    global_summary = build_global(ctx, rhythm, energy, tonal, melody, stems)
    stage.mark("aggregate")

    # ---- 9. assemble -------------------------------------------------------
    backends = _backend_status(flags)
    envelope_values = util.percentile_norm(
        np.abs(ctx.y[:: config.HOP])[: len(rhythm.hop_times)]
    )
    env_t, env_v = util.downsample(
        rhythm.hop_times, envelope_values, config.ENVELOPE_POINTS
    )

    document = build_document(
        ctx=ctx,
        rhythm=rhythm,
        energy=energy,
        tonal=tonal,
        structure=structure,
        melody=melody,
        stems=stems,
        raw_stems=raw_stems,
        windows=windows,
        global_summary=global_summary,
        events=events,
        event_counts=counts,
        envelope_times=env_t,
        envelope_values=env_v,
        backends=backends,
        cache_info=cache_info,
        flags=flags,
        downbeat=downbeat,
        repetition=repetition,
        phrasing=phrasing,
    )

    _write_json(output_path, document)
    stage.mark("write")

    # ---- 10. legacy projection --------------------------------------------
    legacy_path = legacy_output
    if legacy_path is None:
        legacy_dir = os.path.dirname(os.path.abspath(output_path))
        legacy_path = os.path.join(legacy_dir, "music_analysis.json")

    legacy = project_legacy(
        ctx=ctx,
        rhythm=rhythm,
        energy=energy,
        structure=structure,
        bpm_override=bpm_override,
        time_sig=time_sig,
        source_document=document,
    )
    _write_json(legacy_path, legacy)
    stage.mark("legacy")

    # ---- 11. director context (agent-facing compression, V2.1) --------------
    director_path = director_output
    if director_path is None:
        director_dir = os.path.dirname(os.path.abspath(output_path))
        director_path = os.path.join(director_dir, "director_context.json")

    director = build_director_context(
        ctx=ctx,
        rhythm=rhythm,
        energy=energy,
        tonal=tonal,
        structure=structure,
        melody=melody,
        stems=stems,
        downbeat=downbeat,
        repetition=repetition,
        phrasing=phrasing,
        events=events,
        global_summary=global_summary,
    )
    _write_json(director_path, director)
    stage.mark("director")

    # Cache the finished documents so a re-run is instant.
    cache.write_json(document, "analysis_v2.json")
    cache.write_json(director, "director_context.json")
    cache.merge_meta(
        analyzerVersion=version.ANALYZER_VERSION,
        settingsSignature=version.SETTINGS_SIGNATURE,
        sourceFile=ctx.file,
        durationSec=round(ctx.duration, 3),
        lastRun={
            "mode": mode,
            "flags": flags,
            "outputs": {
                "v2": output_path,
                "legacy": legacy_path,
                "director": director_path,
            },
        },
    )

    document["_debugReport"] = _report(
        document, stage, backends, output_path, legacy_path, director_path,
        director, cache_info,
    )
    if not quiet:
        print(json.dumps(document["_debugReport"], indent=2, ensure_ascii=False))
    report = document.pop("_debugReport")
    return document, report


def _write_json(path: str, obj) -> None:
    directory = os.path.dirname(os.path.abspath(path))
    if directory:
        os.makedirs(directory, exist_ok=True)
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as fh:
        json.dump(obj, fh, indent=2, ensure_ascii=False)
    os.replace(tmp, path)


def _report(
    document: dict,
    stage: Stage,
    backends: dict,
    output_path: str,
    legacy_path: str,
    director_path: str,
    director: dict,
    cache_info: dict,
) -> dict:
    """The prompt's section 21 debug report, printed to stdout."""
    g = document["global"]
    layers = document["layers"]
    return {
        "analyzer": f"{version.ANALYZER_NAME} {version.ANALYZER_VERSION}",
        "schemaVersion": version.SCHEMA_VERSION,
        "outputs": {"v2": output_path, "legacyV1": legacy_path, "director": director_path},
        "durationSec": document["source"]["durationSec"],
        "global": g,
        "counts": {
            "beats": layers["rhythm"]["beatCount"],
            "bars": layers["rhythm"]["barCount"],
            "onsets": len(layers["rhythm"]["onsets"]),
            "sections": len(document["sections"]),
            "events": len(document["events"]),
            "windows": len(document["timeline"]["windows"]),
            "melodyNotes": layers["melody"].get("noteCount", 0),
            "melodyPhrases": layers["melody"].get("phraseCount", 0),
            "phrases": layers["phrasing"]["phraseCount"],
            "repeatGroups": layers["repetition"]["groupCount"],
            "repeatComparisons": layers["repetition"]["comparisonCount"],
            "directorImportantEvents": len(director.get("important_events", [])),
        },
        "barPhase": {
            "offsetBeats": layers["barPhase"]["offsetBeats"],
            "confidence": layers["barPhase"]["confidence"],
        },
        "lyrics": document["lyrics"],
        "eventCounts": layers["eventCounts"],
        "stemActivity": layers["stems"]["activity"],
        "backends": backends,
        "structureMethod": layers["structure"]["method"],
        "cache": cache_info,
        "warnings": document["analysisMeta"]["warnings"],
        "timingsSec": {**stage.timings, "total": stage.total},
    }


def main() -> None:
    parser = argparse.ArgumentParser(
        description="BeatBound music understanding V2 (librosa + demucs + basic-pitch)"
    )
    parser.add_argument("input", help="audio file to analyse")
    parser.add_argument("output", help="where to write music_analysis_v2.json")
    parser.add_argument("--bpm", type=float, default=None, help="override detected tempo")
    parser.add_argument(
        "--timesig", type=int, nargs=2, default=[4, 4], metavar=("NUM", "DEN")
    )
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument(
        "--fast",
        action="store_const",
        const="fast",
        dest="mode",
        help="rhythm/energy/tonal/structure only -- no ML models",
    )
    mode.add_argument(
        "--full",
        action="store_const",
        const="full",
        dest="mode",
        help="everything, including stem separation and melody (default)",
    )
    parser.set_defaults(mode="full")
    parser.add_argument("--no-stems", action="store_true", help="skip stem separation")
    parser.add_argument("--no-melody", action="store_true", help="skip pitch tracking")
    parser.add_argument("--force", action="store_true", help="ignore cached artifacts")
    parser.add_argument("--cache-dir", default=None, help="override the audio cache root")
    parser.add_argument(
        "--legacy-output",
        default=None,
        help="where to write the v1 projection (default: music_analysis.json beside the output)",
    )
    parser.add_argument(
        "--director-output",
        default=None,
        help="where to write director_context.json (default: beside the output)",
    )
    parser.add_argument("--quiet", action="store_true", help="write files, print nothing")
    args = parser.parse_args()

    try:
        analyze_v2(
            args.input,
            args.output,
            bpm_override=args.bpm,
            time_sig=(args.timesig[0], args.timesig[1]),
            mode=args.mode,
            use_stems=not args.no_stems,
            use_melody=not args.no_melody,
            force=args.force,
            cache_dir=args.cache_dir,
            legacy_output=args.legacy_output,
            director_output=args.director_output,
            quiet=args.quiet,
        )
    except Exception as exc:  # clean message for the editor server
        print(f"ANALYSIS ERROR: {type(exc).__name__}: {exc}", file=sys.stderr)
        raise


if __name__ == "__main__":
    main()

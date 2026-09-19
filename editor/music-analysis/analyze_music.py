#!/usr/bin/env python3
"""BeatBound music analysis.

Turns one audio file into editor/output/music_analysis.json:

  - duration, tempo/BPM (librosa beat tracking; optional --bpm override)
  - a constant-tempo beat/bar grid anchored at audio time 0
    (the runtime uses ConstantTempoMap, so analysis bars == runtime bars)
  - per-bar features: RMS energy, onset count, beat strength, rhythm density,
    spectral novelty -- all percentile-normalised to 0..1
  - onset timestamps and strengths
  - novelty-based structural sections snapped to the bar grid
    (labels are section_01, section_02, ... -- no semantic labels)
  - major bar-to-bar energy changes (rises / falls)
  - downsampled waveform envelope + RMS curve for timeline drawing

Deterministic: fixed parameters, no RNG. Same file -> same JSON.

Usage:
  python analyze_music.py input.mp3 output.json [--bpm 120] [--timesig 4 4]
"""

import argparse
import hashlib
import json
import sys

import numpy as np
import librosa

VERSION = "1.0.0"
SR = 22050
HOP = 512
ENVELOPE_POINTS = 1600

# Segmentation tuning (in bars on the constant grid).
MIN_SECTION_BARS = 8
NOVELTY_PEAK_STD = 0.55      # local maxima above mean + k*std become boundaries
NOVELTY_MIN_SEP_BARS = 4     # boundaries must be at least this many bars apart


def percentile_norm(x):
    """Robust 0..1 normalisation: (x - p05) / (p95 - p05), clipped."""
    lo, hi = np.percentile(x, 5), np.percentile(x, 95)
    if hi - lo < 1e-9:
        return np.zeros_like(x)
    return np.clip((x - lo) / (hi - lo), 0.0, 1.0)


def downsample(times, values, n=ENVELOPE_POINTS):
    if len(times) <= n:
        return times.tolist(), values.tolist()
    idx = np.linspace(0, len(times) - 1, n).astype(int)
    return times[idx].tolist(), values[idx].tolist()


def analyze(path, output, bpm_override, time_sig):
    # ---- load --------------------------------------------------------------
    y, sr = librosa.load(path, sr=SR, mono=True)
    duration = float(len(y) / sr)

    # ---- tempo + grid ------------------------------------------------------
    est_tempo, _ = librosa.beat.beat_track(y=y, sr=sr, trim=False)
    bpm = float(np.atleast_1d(est_tempo)[0]) if not bpm_override else bpm_override
    bpm = round(bpm, 2)
    bpb = time_sig[0]  # beats per bar
    beat_len = 60.0 / bpm
    n_beats = int(duration // beat_len)
    beat_times = np.arange(n_beats) * beat_len
    n_bars = max(1, n_beats // bpb)

    # ---- features on the hop grid -----------------------------------------
    rms = librosa.feature.rms(y=y, hop_length=HOP)[0]
    # times_like on a *feature* array gives frame times; on a raw time series
    # it would return per-sample times instead.
    hop_times = librosa.times_like(rms, sr=sr, hop_length=HOP)
    onset_env = librosa.onset.onset_strength(y=y, sr=sr, hop_length=HOP)
    onsets = librosa.onset.onset_detect(
        onset_envelope=onset_env, sr=sr, hop_length=HOP, backtrack=True
    )
    onset_times = hop_times[onsets]
    onset_strengths = percentile_norm(onset_env[onsets])

    def sample_at(times, values, t):
        """Nearest-hop value at time t (grid beats can fall between hops)."""
        idx = np.searchsorted(times, t)
        idx = int(np.clip(idx, 0, len(values) - 1))
        return float(values[idx])

    # ---- beats (grid, with sampled strength) --------------------------------
    beats = []
    for i, t in enumerate(beat_times):
        beats.append({
            "time": round(t, 6),
            "index": i,
            "bar": i // bpb + 1,
            "beat": i % bpb + 1,
            "strength": round(sample_at(hop_times, percentile_norm(onset_env), t), 4),
        })

    # ---- per-bar features --------------------------------------------------
    bar_bounds = np.arange(n_bars + 1) * bpb * beat_len
    bars = []
    for b in range(n_bars):
        start, end = bar_bounds[b], min(bar_bounds[b + 1], duration)
        mask = (hop_times >= start) & (hop_times < max(end, start + HOP / sr))
        seg_rms = rms[mask]
        seg_nov = onset_env[mask]
        onsets_in = int(np.sum((onset_times >= start) & (onset_times < end)))
        beat_idx = np.arange(b * bpb, min((b + 1) * bpb, n_beats))
        bar_beats = [beats[i]["strength"] for i in beat_idx]
        bars.append({
            "bar": b + 1,
            "startTime": round(start, 6),
            "endTime": round(end, 6),
            "rmsMean": round(float(np.mean(seg_rms)) if len(seg_rms) else 0.0, 6),
            "rmsPeak": round(float(np.max(seg_rms)) if len(seg_rms) else 0.0, 6),
            "onsetCount": onsets_in,
            "beatStrength": round(float(np.mean(bar_beats)) if bar_beats else 0.0, 4),
            "novelty": round(float(np.max(seg_nov)) if len(seg_nov) else 0.0, 6),
        })

    energy = percentile_norm(np.array([b["rmsMean"] for b in bars]))
    density = percentile_norm(np.array([b["onsetCount"] for b in bars], dtype=float))
    novelty = percentile_norm(np.array([b["novelty"] for b in bars]))
    for i, b in enumerate(bars):
        b["energy"] = round(float(energy[i]), 4)
        b["rhythmDensity"] = round(float(density[i]), 4)
        b["novelty"] = round(float(novelty[i]), 4)

    # ---- energy changes (major bar-to-bar transitions) ----------------------
    energy_changes = []
    threshold = 0.18
    for i in range(1, len(bars)):
        delta = bars[i]["energy"] - bars[i - 1]["energy"]
        if abs(delta) >= threshold:
            energy_changes.append({
                "time": bars[i]["startTime"],
                "bar": bars[i]["bar"],
                "direction": "rise" if delta > 0 else "fall",
                "magnitude": round(abs(delta), 4),
            })

    # ---- structural sections (novelty peaks -> bar grid) --------------------
    boundaries = [1]  # bar numbers, 1-based, inclusive starts
    mean_n, std_n = float(np.mean(novelty)), float(np.std(novelty))
    threshold_n = mean_n + NOVELTY_PEAK_STD * std_n
    for i in range(1, len(bars) - 1):
        is_peak = novelty[i] >= novelty[i - 1] and novelty[i] > novelty[i + 1]
        if is_peak and novelty[i] >= threshold_n:
            bar_no = bars[i]["bar"]
            if bar_no - boundaries[-1] >= NOVELTY_MIN_SEP_BARS:
                boundaries.append(bar_no)
    boundaries.append(n_bars + 1)

    # Merge segments shorter than MIN_SECTION_BARS into the previous one.
    merged = [boundaries[0]]
    for b in boundaries[1:]:
        if b - merged[-1] < MIN_SECTION_BARS and b != n_bars + 1:
            continue
        merged.append(b)
    if merged[-1] != n_bars + 1:
        merged.append(n_bars + 1)
    if len(merged) > 2 and merged[-1] - merged[-2] < MIN_SECTION_BARS:
        merged.pop(-2)

    sections = []
    for s in range(len(merged) - 1):
        lo, hi = merged[s], merged[s + 1]  # hi exclusive
        bars_in = bars[lo - 1:hi - 1]
        sections.append({
            "id": f"section_{s + 1:02d}",
            "label": f"section_{s + 1:02d}",
            "startBar": lo,
            "endBar": hi - 1,
            "startTime": bars_in[0]["startTime"],
            "endTime": bars_in[-1]["endTime"],
            "durationSec": round(bars_in[-1]["endTime"] - bars_in[0]["startTime"], 6),
            "meanEnergy": round(float(np.mean([b["energy"] for b in bars_in])), 4),
            "peakEnergy": round(float(np.max([b["energy"] for b in bars_in])), 4),
            "meanRhythmDensity": round(float(np.mean([b["rhythmDensity"] for b in bars_in])), 4),
            "onsetCount": int(np.sum([b["onsetCount"] for b in bars_in])),
        })

    # ---- curves for the UI ---------------------------------------------------
    env_times, env_vals = downsample(hop_times, percentile_norm(np.abs(y[:: HOP])[: len(hop_times)]))
    rms_times, rms_vals = downsample(hop_times, percentile_norm(rms))

    # ---- assemble -------------------------------------------------------------
    song_id = path.split("/")[-1].split("\\")[-1].rsplit(".", 1)[0]
    analysis = {
        "version": VERSION,
        "song": {
            "id": song_id,
            "title": song_id,
            "audioPath": path,
            "durationSec": round(duration, 6),
            "sampleRate": sr,
            "sourceHash": hashlib.sha256(open(path, "rb").read()).hexdigest()[:16],
        },
        "tempo": {
            "bpm": bpm,
            "confidence": 1.0 if bpm_override else round(float(np.minimum(1.0, len(beat_times) / max(n_beats, 1))), 4),
            "timeSignature": list(time_sig),
        },
        "beats": beats,
        "bars": bars,
        "onsets": [
            {"time": round(float(t), 6), "strength": round(float(s), 4)}
            for t, s in zip(onset_times, onset_strengths)
        ],
        "energyChanges": energy_changes,
        "sections": sections,
        "waveformEnvelope": {"times": env_times, "values": env_vals},
        "rmsCurve": {"times": rms_times, "values": rms_vals},
        "report": {
            "analyzer": f"librosa {librosa.__version__}",
            "sampleRate": sr,
            "hopLength": HOP,
            "bpmOverride": bpm_override,
            "minSectionBars": MIN_SECTION_BARS,
            "noveltyThreshold": {"mean": round(mean_n, 4), "std": round(std_n, 4), "k": NOVELTY_PEAK_STD},
            "beats": n_beats,
            "bars": n_bars,
            "sections": len(sections),
            "onsets": len(onset_times),
            "energyChanges": len(energy_changes),
        },
    }

    with open(output, "w", encoding="utf-8") as f:
        json.dump(analysis, f, indent=2, ensure_ascii=False)
    print(json.dumps(analysis["report"], indent=2))
    return analysis


def main():
    parser = argparse.ArgumentParser(description="BeatBound music analysis (librosa)")
    parser.add_argument("input", help="audio file to analyse")
    parser.add_argument("output", help="where to write music_analysis.json")
    parser.add_argument("--bpm", type=float, default=None, help="override detected tempo")
    parser.add_argument("--timesig", type=int, nargs=2, default=[4, 4], metavar=("NUM", "DEN"))
    args = parser.parse_args()
    try:
        analyze(args.input, args.output, args.bpm, tuple(args.timesig))
    except Exception as exc:  # surface a clean message to the editor server
        print(f"ANALYSIS ERROR: {exc}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()

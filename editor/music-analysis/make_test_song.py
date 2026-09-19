#!/usr/bin/env python3
"""Generate a synthetic test song for the analysis pipeline.

Produces a steady click track at a known BPM with deliberate structure:
four energy levels (low -> mid -> high -> peak -> mid) and a tempo, so the
analyser has something real to detect. Deterministic (fixed seed).

Usage: python make_test_song.py out.wav [--bpm 120] [--bars 64]
"""

import argparse

import numpy as np


def make_test_song(path, bpm, total_bars, sr=22050):
    bpb = 4
    beat_len = 60.0 / bpm
    bar_len = beat_len * bpb
    duration = bar_len * total_bars
    n = int(duration * sr)
    t = np.arange(n) / sr

    rng = np.random.default_rng(42)

    # Energy arc per bar: low -> mid -> high -> peak -> mid, with a big rise.
    def bar_energy(bar):
        if bar <= total_bars * 0.2:
            return 0.25
        if bar <= total_bars * 0.45:
            return 0.5
        if bar <= total_bars * 0.6:
            return 0.8
        if bar <= total_bars * 0.75:
            return 1.0
        return 0.55

    y = np.zeros(n)
    for b in range(1, total_bars + 1):
        start = (b - 1) * bar_len
        amp = bar_energy(b)
        for beat in range(bpb):
            at = start + beat * beat_len
            # Click: short decaying sine burst, louder + denser with energy.
            seg_len = int(0.08 * sr)
            i0 = int(at * sr)
            if i0 >= n:
                break
            i1 = min(i0 + seg_len, n)
            seg_t = t[i0:i1] - at
            click = np.sin(2 * np.pi * 1000 * seg_t) * np.exp(-seg_t * 60)
            y[i0:i1] += click * (0.2 + 0.8 * amp)
            # Extra hi-hat ticks at high energy: off-beats.
            if amp >= 0.8:
                at2 = at + beat_len / 2
                i2 = int(at2 * sr)
                if i2 < n:
                    i3 = min(i2 + int(0.03 * sr), n)
                    seg2 = t[i2:i3] - at2
                    y[i2:i3] += np.sin(2 * np.pi * 4000 * seg2) * np.exp(-seg2 * 200) * 0.15

    # Noise bed scaled by energy, so RMS follows the arc too.
    noise = rng.standard_normal(n)
    env = np.array([bar_energy(int(tt / bar_len) + 1) for tt in t])
    y += noise * env * 0.04

    y = np.tanh(y)  # soft clip
    peak = np.max(np.abs(y)) + 1e-9
    y = y / peak * 0.85

    pcm = (y * 32767).astype(np.int16)
    import wave

    with wave.open(path, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(sr)
        w.writeframes(pcm.tobytes())
    print(f"wrote {path}: {total_bars} bars @ {bpm} BPM ({duration:.1f}s)")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("out", help="output .wav path")
    parser.add_argument("--bpm", type=float, default=120.0)
    parser.add_argument("--bars", type=int, default=64)
    args = parser.parse_args()
    make_test_song(args.out, args.bpm, args.bars)

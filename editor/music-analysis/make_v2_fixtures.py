#!/usr/bin/env python3
"""Generate synthetic audio fixtures for the V2 analyzer tests.

The test suite builds its fixtures in memory (see ``tests/conftest.py``); this
script exists for the other case -- when you want a *file on disk* to run the
CLI against by hand, or to feed the editor's debug overlay.

Everything here is deterministic (fixed seed), so a fixture generated today is
byte-identical to one generated next month.

Usage::

    python make_v2_fixtures.py out_dir
    python make_v2_fixtures.py out_dir --only silence
"""

from __future__ import annotations

import argparse
import os
import wave

import numpy as np

SR = 22050


def _write(path: str, y: np.ndarray, sr: int = SR) -> str:
    pcm = (np.clip(np.asarray(y, dtype=np.float64), -1.0, 1.0) * 32767).astype(np.int16)
    with wave.open(path, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(sr)
        w.writeframes(pcm.tobytes())
    return path


def _click(duration: float, bpm: float = 120.0, sr: int = SR) -> np.ndarray:
    """Steady click track with a loud second half -- real tempo, real onsets."""
    n = int(duration * sr)
    y = np.zeros(n)
    t = np.arange(n) / sr
    beat = 60.0 / bpm
    k = 0
    while k * beat < duration:
        at = k * beat
        amp = 0.35 if at < duration / 2 else 0.9
        i0 = int(at * sr)
        i1 = min(i0 + int(0.06 * sr), n)
        if i0 < n:
            seg = t[i0:i1] - at
            y[i0:i1] += np.sin(2 * np.pi * 1000 * seg) * np.exp(-seg * 60) * amp
        k += 1
    return y


def _musical(duration: float, bpm: float = 120.0, sr: int = SR) -> np.ndarray:
    """A click track plus a simple melodic line -- gives the pitch backend work.

    Three "sections": a low A-minor figure, a rising line, then a quiet outro.
    Crude on purpose: it is a fixture, not music.
    """
    n = int(duration * sr)
    y = _click(duration, bpm, sr).astype(np.float64)
    t = np.arange(n) / sr
    beat = 60.0 / bpm

    # Section A: A3/C4/E4 arpeggio. Section B: rising G3..C5. Section C: quiet.
    scale_a = [220.0, 261.63, 329.63, 261.63]
    scale_b = [196.0, 246.94, 293.66, 349.23, 392.0, 523.25]
    k = 0
    while k * beat < duration:
        at = k * beat
        frac = at / max(duration, 1e-6)
        if frac < 0.35:
            f = scale_a[k % len(scale_a)]
            amp = 0.30
        elif frac < 0.75:
            f = scale_b[k % len(scale_b)]
            amp = 0.36
        else:
            f = scale_a[k % len(scale_a)]
            amp = 0.10
        i0 = int(at * sr)
        i1 = min(i0 + int(beat * 0.9 * sr), n)
        if i0 < n:
            seg = t[i0:i1] - at
            env = np.exp(-seg * 3.0)
            y[i0:i1] += np.sin(2 * np.pi * f * seg) * env * amp
            # A fifth above, quieter -- makes the chroma less trivially tonal.
            y[i0:i1] += np.sin(2 * np.pi * f * 1.5 * seg) * env * amp * 0.3
        k += 1

    peak = float(np.max(np.abs(y))) + 1e-9
    return y / peak * 0.85


def _silence(duration: float, sr: int = SR) -> np.ndarray:
    return np.zeros(int(duration * sr))


def _noise_bed(duration: float, sr: int = SR) -> np.ndarray:
    """Broadband noise with no tempo and no pitch -- every estimator should abstain."""
    rng = np.random.default_rng(20260920)
    n = int(duration * sr)
    return rng.standard_normal(n) * 0.05


FIXTURES = {
    "click_12s": lambda: _click(12.0),
    "musical_30s": lambda: _musical(30.0),
    "short_0p4s": lambda: _click(0.4),
    "tiny_0p02s": lambda: _click(0.02),
    "silence_5s": lambda: _silence(5.0),
    "noise_10s": lambda: _noise_bed(10.0),
}


def main() -> None:
    parser = argparse.ArgumentParser(description="Generate V2 analyzer test fixtures")
    parser.add_argument("out_dir", help="directory to write the .wav fixtures into")
    parser.add_argument(
        "--only", default=None, choices=sorted(FIXTURES), help="generate just one fixture"
    )
    args = parser.parse_args()

    os.makedirs(args.out_dir, exist_ok=True)
    names = [args.only] if args.only else sorted(FIXTURES)
    for name in names:
        path = _write(os.path.join(args.out_dir, f"{name}.wav"), FIXTURES[name]())
        size_kb = os.path.getsize(path) / 1024.0
        print(f"wrote {path} ({size_kb:.0f} kB)")


if __name__ == "__main__":
    main()

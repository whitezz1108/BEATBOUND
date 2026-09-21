"""Shared fixtures for the audio-understanding V2 tests.

Every fixture here is *synthetic and generated on the fly*, so the suite runs
without the multi-minute Demucs download and without any real song file. The ML
backends are stubbed where a test needs the "available" code path; the fallback
tests stub them the other way, to unavailable.

Tests deliberately avoid the real cache directory: each one is handed a
``tmp_path`` cache root so a test run can never invalidate or overwrite the
artifacts a developer is using interactively.
"""

from __future__ import annotations

import os
import sys
import wave
from typing import List, Tuple

import numpy as np
import pytest

# Make both the CLI and the package importable from the test directory.
_HERE = os.path.dirname(os.path.abspath(__file__))
_MUSIC_ANALYSIS = os.path.dirname(_HERE)
for _p in (_HERE, _MUSIC_ANALYSIS):
    if _p not in sys.path:
        sys.path.insert(0, _p)


# ---------------------------------------------------------------------------
# Audio fixtures
# ---------------------------------------------------------------------------

def _write_wav(path: str, y: np.ndarray, sr: int = 22050) -> str:
    pcm = np.clip(np.asarray(y, dtype=np.float64), -1.0, 1.0)
    pcm = (pcm * 32767).astype(np.int16)
    with wave.open(path, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(sr)
        w.writeframes(pcm.tobytes())
    return path


def _click_track(duration: float, bpm: float = 120.0, sr: int = 22050) -> np.ndarray:
    """A steady click track with two energy levels -- real tempo, real onsets."""
    n = int(duration * sr)
    y = np.zeros(n)
    t = np.arange(n) / sr
    beat = 60.0 / bpm
    k = 0
    while k * beat < duration:
        at = k * beat
        amp = 0.35 if k < 8 else 0.9
        i0 = int(at * sr)
        i1 = min(i0 + int(0.06 * sr), n)
        if i0 < n:
            seg = t[i0:i1] - at
            y[i0:i1] += np.sin(2 * np.pi * 1000 * seg) * np.exp(-seg * 60) * amp
        k += 1
    return y


@pytest.fixture(scope="session")
def click_wav(tmp_path_factory) -> str:
    """12 s click track: enough bars for tempo + structure, fast to analyse."""
    path = str(tmp_path_factory.mktemp("audio") / "click.wav")
    return _write_wav(path, _click_track(12.0))


@pytest.fixture(scope="session")
def short_wav(tmp_path_factory) -> str:
    """0.4 s -- shorter than a single bar at any sane tempo."""
    path = str(tmp_path_factory.mktemp("audio") / "short.wav")
    return _write_wav(path, _click_track(0.4, bpm=120.0))


@pytest.fixture(scope="session")
def silent_wav(tmp_path_factory) -> str:
    """5 s of digital silence. A legitimate input, not an error case."""
    path = str(tmp_path_factory.mktemp("audio") / "silent.wav")
    return _write_wav(path, np.zeros(int(5.0 * 22050)))


@pytest.fixture(scope="session")
def tiny_wav(tmp_path_factory) -> str:
    """20 ms -- the degenerate end of the range."""
    path = str(tmp_path_factory.mktemp("audio") / "tiny.wav")
    return _write_wav(path, _click_track(0.02, bpm=120.0))


# ---------------------------------------------------------------------------
# Backend stubs
# ---------------------------------------------------------------------------

def _fake_stems(duration: float, sr: int = 22050):
    """Four distinguishable sine-ish stems, deterministic."""
    n = int(duration * sr)
    t = np.arange(n) / sr
    return {
        "drums": (0.5 * np.sin(2 * np.pi * 200 * t) * (np.sin(2 * np.pi * 2 * t) > 0)).astype(np.float32),
        "bass": (0.4 * np.sin(2 * np.pi * 55 * t)).astype(np.float32),
        "vocals": (0.3 * np.sin(2 * np.pi * 440 * t) * (np.sin(2 * np.pi * 0.4 * t) > 0)).astype(np.float32),
        "other": (0.35 * np.sin(2 * np.pi * 660 * t)).astype(np.float32),
    }


def _fake_note_matrix(n_frames: int = 400, n_bins: int = 88) -> np.ndarray:
    """A note-salience matrix whose argmax walks a short melodic line."""
    m = np.zeros((n_frames, n_bins), dtype=np.float32)
    for i in range(n_frames):
        m[i, 30 + (i // 40) % 8] = 0.9
    return m


@pytest.fixture
def stub_full_backends(monkeypatch):
    """Make stems and melody report *available*, without any real model.

    This exercises the shape of the success branch -- the parts of the document
    that a fast-mode run never produces -- in a couple of seconds instead of a
    couple of minutes.
    """
    from beatbound_audio import melody_analyzer, stem_separator

    def fake_separate(audio_path, out_dir, *, threads=4):
        import librosa

        _y, _sr = librosa.load(audio_path, sr=22050, mono=True)
        return _fake_stems(len(_y) / 22050.0)

    monkeypatch.setattr(stem_separator, "demucs_available", lambda: (True, "stub"))
    monkeypatch.setattr(stem_separator, "_separate_with_python_api", fake_separate)

    notes: List[Tuple[float, float, int, float, float]] = [
        (0.5 + i * 0.45, 0.5 + i * 0.45 + 0.25, 60 + (i % 7), 0.7, 0.0)
        for i in range(20)
    ]
    monkeypatch.setattr(melody_analyzer, "backend_available", lambda: (True, "stub"))
    monkeypatch.setattr(
        melody_analyzer,
        "_run_backend",
        lambda path: ({"note": _fake_note_matrix()}, notes),
    )
    return {"stems": True, "melody": True}


@pytest.fixture
def stub_missing_backends(monkeypatch):
    """Make every optional ML backend report unavailable (the fallback path)."""
    from beatbound_audio import melody_analyzer, stem_separator

    monkeypatch.setattr(
        stem_separator, "demucs_available", lambda: (False, "stub: not installed")
    )
    monkeypatch.setattr(
        stem_separator, "_separate_with_cli", lambda *a, **k: (_ for _ in ()).throw(
            RuntimeError("stub: demucs CLI not found")
        )
    )
    monkeypatch.setattr(
        melody_analyzer, "backend_available", lambda: (False, "stub: not installed")
    )
    return {"stems": False, "melody": False}


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def run_v2(audio: str, out_dir: str, **kwargs):
    """Run the CLI's pipeline in-process.

    Returns ``(document, legacy, report)`` -- the two written documents plus the
    run-state report the CLI prints. ``out_dir`` is created if it does not exist,
    so a test can use subdirectories to keep runs apart.
    """
    import json

    import analyze_music_v2

    os.makedirs(out_dir, exist_ok=True)
    out = os.path.join(out_dir, "music_analysis_v2.json")
    doc, report = analyze_music_v2.analyze_v2(audio, out, quiet=True, **kwargs)

    with open(out, "r", encoding="utf-8") as fh:
        written = json.load(fh)
    legacy_path = os.path.join(out_dir, "music_analysis.json")
    with open(legacy_path, "r", encoding="utf-8") as fh:
        legacy = json.load(fh)

    # The returned document must be exactly what was written to disk.
    assert written == doc, "the returned document differs from the written file"
    return doc, legacy, report


def load_director(out_dir: str) -> dict:
    """The director_context.json a ``run_v2`` call into ``out_dir`` produced."""
    import json

    with open(os.path.join(out_dir, "director_context.json"), "r", encoding="utf-8") as fh:
        return json.load(fh)

"""Melody / pitch layer (prompt section 9).

Backend: Basic Pitch (ICASSP 2022, ONNX runtime). The prompt is explicit that
MIDI transcription accuracy is *not* the goal -- what BeatBound needs is when
melodic events happen, roughly what pitch they carry, which way the line moves,
where the big leaps are, and how dense it is. So this module runs the backend
once and then compresses its note list into gameplay-agnostic descriptors
(notes + phrases), never publishing a raw salience matrix.

The backend is imported lazily and every failure degrades to
``available: false`` with a warning, so a missing model cannot take down an
analyze run (prompt section 15).

Basic Pitch prints to stdout as it works. That would corrupt the CLI's
stdout-JSON contract, so every call is wrapped in a stdout suppressor.
"""

from __future__ import annotations

import contextlib
import io
import os
import tempfile
from typing import List, Optional, Tuple

import numpy as np

from . import config, util, version
from .cache import AudioCache
from .results import MelodyResult, StemResult

#: Basic Pitch annotation frame rate (22050 / 256), and its lowest MIDI note.
_BP_FPS = 86.0
_BP_BASE_MIDI = 21   # A0 -- the first of the model's 88 note bins
_BP_N_BINS = 88

#: Reference note rate that maps to a melodic density of 1.0.
_DENSITY_REFERENCE_NPS = 8.0
#: A phrase smaller than this many semitones is "stable", not rising/falling.
_STABLE_SPAN = 2
#: Mean-pitch change across a phrase that counts as a direction.
_DIRECTION_DELTA = 1.0
#: Interval that counts as a leap when classifying "mixed".
_MIXED_JUMP = 2


def backend_available() -> tuple[bool, Optional[str]]:
    """Whether the pitch backend imports, without loading any weights."""
    try:
        import basic_pitch  # noqa: F401
        from basic_pitch.inference import Model, run_inference  # noqa: F401
        from basic_pitch.note_creation import model_output_to_notes  # noqa: F401

        return True, version.MELODY_MODEL_VERSION
    except Exception as exc:  # pragma: no cover - environment dependent
        return False, f"{type(exc).__name__}: {exc}"


def _pick_input(
    stems: Optional[StemResult], mix: np.ndarray, sr: int
) -> Tuple[str, np.ndarray]:
    """Choose the signal to transcribe: other -> vocals -> full mix.

    The ``other`` stem is the melodic / harmonic material once drums and bass
    are gone, which is why the prompt routes melody through it (section 1.1).

    ``stems`` may be ``None`` (``--no-stems``) or unavailable (no separator):
    melody then falls back to the full mix rather than failing, so the two
    optional backends stay independently usable.
    """
    if stems is not None and stems.available and stems.signals:
        for name in ("other", "vocals"):
            sig = stems.signals.get(name)
            if sig is not None and sig.size and util.peak(sig) > 1e-4:
                return name, sig
    return "mix", mix


def _write_temp_wav(y: np.ndarray, sr: int, directory: Optional[str]) -> str:
    import soundfile as sf

    fd, path = tempfile.mkstemp(suffix=".wav", dir=directory)
    os.close(fd)
    sf.write(path, np.asarray(y, dtype=np.float32), sr, subtype="PCM_16")
    return path


def _run_backend(path: str):
    """Run inference + note extraction, with stdout suppressed."""
    from basic_pitch import ICASSP_2022_MODEL_PATH
    from basic_pitch.inference import Model, run_inference
    from basic_pitch.note_creation import model_output_to_notes

    buf = io.StringIO()
    with contextlib.redirect_stdout(buf):
        model = Model(ICASSP_2022_MODEL_PATH)
        output = run_inference(path, model)
        min_note_len = int(
            round(config.MELODY_MIN_NOTE_SEC * 1000 / 1000 * (_BP_FPS))
        )
        _midi, notes = model_output_to_notes(
            output,
            onset_thresh=0.5,
            frame_thresh=0.3,
            min_note_len=max(1, min_note_len),
            min_freq=config.MELODY_FMIN_HZ,
            max_freq=config.MELODY_FMAX_HZ,
            include_pitch_bends=False,
            multiple_pitch_bends=False,
            melodia_trick=True,
        )
    return output, notes


def _pitch_curve(output: dict) -> Tuple[np.ndarray, np.ndarray]:
    """Per-frame pitch track from the note salience, NaN where unvoiced.

    The note matrix is the model's own frame-level estimate; taking its argmax
    gives a pitch curve at 86 fps -- far better resolution than the note list,
    and it needs no second inference pass.
    """
    note = np.asarray(output.get("note", []))
    if note.ndim != 2 or note.shape[0] == 0:
        return np.zeros(0), np.zeros(0)
    times = np.arange(note.shape[0]) / _BP_FPS
    best = np.argmax(note, axis=1)
    strength = note[np.arange(note.shape[0]), best]
    voiced = strength >= 0.3
    midi = np.where(voiced, best + _BP_BASE_MIDI, np.nan).astype(float)
    return times, midi


def _classify_direction(pitches: np.ndarray) -> str:
    """rising / falling / stable / mixed / unknown for one phrase."""
    if pitches.size == 0:
        return "unknown"
    if pitches.size == 1:
        return "stable"
    span = float(np.max(pitches) - np.min(pitches))
    if span < _STABLE_SPAN:
        return "stable"
    half = max(1, pitches.size // 2)
    delta = float(np.mean(pitches[half:]) - np.mean(pitches[:half]))
    if delta > _DIRECTION_DELTA:
        return "rising"
    if delta < -_DIRECTION_DELTA:
        return "falling"
    steps = np.diff(pitches)
    if np.any(steps >= _MIXED_JUMP) and np.any(steps <= -_MIXED_JUMP):
        return "mixed"
    return "unknown"


def _build_phrases(notes: List[dict]) -> List[dict]:
    """Split notes into phrases at silence gaps and describe each one."""
    if not notes:
        return []
    phrases: List[dict] = []
    group: List[dict] = [notes[0]]
    for prev, cur in zip(notes, notes[1:]):
        if cur["start"] - prev["end"] > config.PHRASE_GAP_SEC:
            phrases.append(_describe_phrase(group))
            group = []
        group.append(cur)
    if group:
        phrases.append(_describe_phrase(group))
    return phrases


def _describe_phrase(group: List[dict]) -> dict:
    pitches = np.array([n["pitchMidi"] for n in group], dtype=float)
    start, end = group[0]["start"], group[-1]["end"]
    dur = max(end - start, 1e-6)
    steps = np.abs(np.diff(pitches)) if pitches.size > 1 else np.zeros(0)
    nps = len(group) / dur
    return {
        "start": util.fnum(start),
        "end": util.fnum(end),
        "durationSec": util.fnum(dur),
        "direction": _classify_direction(pitches),
        "pitchRangeSemitones": util.fnum(float(np.max(pitches) - np.min(pitches)), 2),
        "noteDensity": util.fnum(util.clamp01(nps / _DENSITY_REFERENCE_NPS), 4),
        "largestJumpSemitones": util.fnum(float(np.max(steps)) if steps.size else 0.0, 2),
        "meanPitchMidi": util.fnum(float(np.mean(pitches)), 2),
        "noteCount": len(group),
        "confidence": util.fnum(float(np.mean([n["confidence"] for n in group])), 4),
    }


def analyze_melody(
    ctx,
    stems: Optional[StemResult],
    *,
    cache: Optional[AudioCache] = None,
    force: bool = False,
    enabled: bool = True,
) -> MelodyResult:
    """Note events and phrase descriptors for the song's melodic material."""
    warnings: list[str] = []

    empty = MelodyResult(
        available=False,
        backend=None,
        input_source="none",
        confidence=None,
        notes=[],
        phrases=[],
        pitch_times=np.zeros(0),
        pitch_midi=np.zeros(0),
        pitch_norm=np.zeros(0),
        note_density=None,
        pitch_range_semitones=None,
        warnings=warnings,
    )

    if not enabled:
        empty.warnings.append("melody analysis disabled by --no-melody")
        return empty

    # ---- cache ------------------------------------------------------------
    cached = None
    if cache is not None and not force and cache.is_valid(
        model_name=version.MELODY_MODEL_NAME,
        model_version=version.MELODY_MODEL_VERSION,
        section="melody",
    ):
        cached = cache.read_json("melody", "notes.json")

    if cached:
        notes = cached.get("notes", [])
        pitch_times = np.asarray(cached.get("pitchTimes", []), dtype=float)
        pitch_midi = np.asarray(cached.get("pitchMidi", []), dtype=float)
        input_source = cached.get("inputSource", "unknown")
        backend = cached.get("backend")
    else:
        ok, note_or_err = backend_available()
        if not ok:
            empty.warnings.append(f"pitch backend unavailable: {note_or_err}")
            return empty

        input_source, signal = _pick_input(stems, ctx.y, ctx.sr)
        if util.peak(signal) <= 1e-4:
            empty.warnings.append(f"melody input ({input_source}) is silent")
            return empty

        tmp = None
        try:
            tmp = _write_temp_wav(signal, ctx.sr, None)
            output, raw_notes = _run_backend(tmp)
        except Exception as exc:
            empty.warnings.append(
                f"pitch backend failed: {type(exc).__name__}: {exc}"
            )
            return empty
        finally:
            if tmp and os.path.exists(tmp):
                with contextlib.suppress(OSError):
                    os.remove(tmp)

        notes = [
            {
                "start": util.fnum(start),
                "end": util.fnum(end),
                "pitchMidi": int(pitch),
                "confidence": util.fnum(float(amp), 4),
            }
            for start, end, pitch, amp, _bend in raw_notes
        ]
        notes.sort(key=lambda n: (n["start"], n["pitchMidi"]))
        pitch_times, pitch_midi = _pitch_curve(output)
        backend = version.MELODY_MODEL_VERSION

        if cache is not None:
            cache.write_json(
                {
                    "notes": notes,
                    "pitchTimes": util.flist(pitch_times),
                    "pitchMidi": util.flist(pitch_midi),
                    "inputSource": input_source,
                    "backend": backend,
                },
                "melody",
                "notes.json",
            )
            cache.mark(
                "melody",
                model_name=version.MELODY_MODEL_NAME,
                model_version=version.MELODY_MODEL_VERSION,
                inputSource=input_source,
            )

    if not notes:
        empty.backend = backend
        empty.input_source = input_source
        empty.warnings.append("pitch backend found no melodic notes")
        return empty

    phrases = _build_phrases(notes)
    pitches = np.array([n["pitchMidi"] for n in notes], dtype=float)
    lo, hi = float(np.min(pitches)), float(np.max(pitches))
    span = int(round(hi - lo))

    # Normalisation window: the song's own range when it is wide enough to be
    # meaningful, otherwise a fixed C2..C6 so a narrow-range song does not get
    # stretched into a false full-scale contour.
    if hi - lo >= 12:
        norm_lo, norm_hi = lo, hi
    else:
        norm_lo, norm_hi = float(config.PITCH_FALLBACK_LO), float(config.PITCH_FALLBACK_HI)
        warnings.append(
            "melodic range under an octave -- pitch normalised over a fixed "
            "C2..C6 window instead of the song's own range"
        )

    if pitch_midi.size:
        pitch_norm = np.where(
            np.isnan(pitch_midi), np.nan, (pitch_midi - norm_lo) / max(norm_hi - norm_lo, 1e-6)
        )
        pitch_norm = np.clip(pitch_norm, 0.0, 1.0)
    else:
        pitch_norm = np.zeros(0)

    duration = max(ctx.duration, 1e-6)
    density = util.clamp01((len(notes) / duration) / _DENSITY_REFERENCE_NPS)

    return MelodyResult(
        available=True,
        backend=backend,
        input_source=input_source,
        confidence=util.fnum(float(np.mean([n["confidence"] for n in notes])), 4),
        notes=notes,
        phrases=phrases,
        pitch_times=pitch_times,
        pitch_midi=pitch_midi,
        pitch_norm=pitch_norm,
        note_density=util.fnum(density, 4),
        pitch_range_semitones=span,
        warnings=warnings,
    )

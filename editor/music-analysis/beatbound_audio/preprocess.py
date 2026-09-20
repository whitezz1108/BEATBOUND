"""Audio preprocessing: decode once, describe the source, share the grid.

This module owns the only place the audio file is read for the *mix* analysis.
Every downstream analyzer consumes the same mono signal and the same frame
times, which is what makes the layers comparable and the output deterministic.

It does not resample for the stem backend -- Demucs wants stereo at 44.1 kHz
and loads the file itself. That second decode is deliberate: keeping it inside
the separator means a stem-backend failure can never corrupt the mix analysis.
"""

from __future__ import annotations

import os
from dataclasses import dataclass
from typing import Optional

import numpy as np

from . import config, util
from .results import AudioContext


@dataclass
class Spectrogram:
    """Magnitude / mel spectrograms on the shared feature grid."""

    mag: np.ndarray          # (1 + n_fft/2, frames)
    mel_db: np.ndarray       # (n_mels, frames)
    times: np.ndarray        # (frames,)
    freqs: np.ndarray        # (1 + n_fft/2,)


def _native_info(path: str, fallback_sr: int) -> tuple[int, int]:
    """Native sample rate + channel count without decoding the whole file."""
    try:
        import soundfile as sf

        info = sf.info(path)
        return int(info.samplerate), int(info.channels)
    except Exception:
        return fallback_sr, 1


def load_audio(
    path: str,
    *,
    sr: int = config.SR,
    song_id: Optional[str] = None,
    title: Optional[str] = None,
) -> AudioContext:
    """Decode ``path`` into an :class:`AudioContext`.

    Never raises for a decodable-but-silent file: silence is a legitimate input
    that the analyzer must describe honestly (prompt section 20).
    """
    import librosa

    warnings: list[str] = []
    if not os.path.isfile(path):
        raise FileNotFoundError(f"audio file not found: {path}")

    audio_hash = util.hash_file(path)
    native_sr, channels = _native_info(path, sr)

    y, _ = librosa.load(path, sr=sr, mono=True)
    y = np.ascontiguousarray(np.asarray(y, dtype=np.float32).reshape(-1))
    duration = float(len(y) / sr) if sr else 0.0

    if duration <= 0.0:
        warnings.append("audio decoded to zero samples")

    base = os.path.basename(path)
    derived_id = util.slugify(os.path.splitext(base)[0])

    return AudioContext(
        path=path,
        file=base,
        song_id=song_id or derived_id,
        title=title or os.path.splitext(base)[0],
        y=y,
        sr=sr,
        duration=duration,
        channels=channels,
        native_sr=native_sr,
        # 16 hex, truncated from the same SHA-256 the v1 analyzer used, so
        # level.json's editor.analysisSource stays comparable across the upgrade.
        source_hash=audio_hash[:16],
        audio_hash=audio_hash,
        silent=util.is_silent(y, sr, config.SILENCE_PEAK),
        warnings=warnings,
    )


def spectrogram(ctx: AudioContext) -> Spectrogram:
    """Compute the magnitude and mel spectrograms once for every consumer."""
    import librosa

    mag = np.abs(
        librosa.stft(ctx.y, n_fft=config.N_FFT, hop_length=config.HOP)
    )
    mel = librosa.feature.melspectrogram(
        S=mag ** 2, sr=ctx.sr, n_fft=config.N_FFT, hop_length=config.HOP
    )
    mel_db = librosa.power_to_db(mel, ref=np.max)
    times = librosa.times_like(mag, sr=ctx.sr, hop_length=config.HOP)
    freqs = librosa.fft_frequencies(sr=ctx.sr, n_fft=config.N_FFT)
    return Spectrogram(mag=mag, mel_db=mel_db, times=times, freqs=freqs)


def frame_times(ctx: AudioContext) -> np.ndarray:
    """Frame times of the shared feature grid (without computing an STFT)."""
    import librosa

    n_frames = 1 + len(ctx.y) // config.HOP
    return librosa.times_like(
        np.zeros(n_frames), sr=ctx.sr, hop_length=config.HOP
    )


def sample_at(times: np.ndarray, values: np.ndarray, t: float) -> float:
    """Nearest-frame value at time ``t`` (grid beats fall between frames)."""
    if len(values) == 0:
        return 0.0
    idx = int(np.clip(np.searchsorted(times, t), 0, len(values) - 1))
    return float(values[idx])

"""Small numeric helpers shared by the analyzers.

Everything here is deterministic and free of global state: same input, same
output, which is what the determinism test relies on.
"""

from __future__ import annotations

import hashlib
import math
from typing import Iterable, Sequence

import numpy as np


# ---------------------------------------------------------------------------
# Normalisation
# ---------------------------------------------------------------------------

def percentile_norm(x, lo_p: float = 5.0, hi_p: float = 95.0) -> np.ndarray:
    """Robust 0..1 normalisation: ``(x - p_lo) / (p_hi - p_lo)``, clipped.

    This is the same shape of normalisation the v1 analyzer used, kept
    identical so the legacy projection stays stable across the upgrade.
    """
    arr = np.asarray(x, dtype=float)
    if arr.size == 0:
        return arr
    lo, hi = float(np.percentile(arr, lo_p)), float(np.percentile(arr, hi_p))
    if hi - lo < 1e-9:
        return np.zeros_like(arr)
    return np.clip((arr - lo) / (hi - lo), 0.0, 1.0)


def unit_norm(x) -> np.ndarray:
    """Scale a non-negative curve so its maximum is 1 (all-zero stays zero)."""
    arr = np.asarray(x, dtype=float)
    if arr.size == 0:
        return arr
    peak = float(np.max(arr))
    if peak <= 1e-12:
        return np.zeros_like(arr)
    return np.clip(arr / peak, 0.0, 1.0)


def smooth(x, win: int) -> np.ndarray:
    """Centered moving average with edge clamping (no zero padding artefacts)."""
    arr = np.asarray(x, dtype=float)
    win = max(1, int(win))
    if arr.size == 0 or win == 1:
        return arr
    if win > arr.size:
        win = arr.size
    pad = win // 2
    padded = np.pad(arr, pad, mode="edge")
    kernel = np.ones(win, dtype=float) / win
    return np.convolve(padded, kernel, mode="valid")[: arr.size]


# ---------------------------------------------------------------------------
# Downsampling for the JSON timeline
# ---------------------------------------------------------------------------

def downsample(times, values, n: int = 1600):
    """Uniformly subsample a curve down to at most ``n`` points."""
    t = np.asarray(times, dtype=float)
    v = np.asarray(values, dtype=float)
    if t.size <= n or n <= 0:
        return t, v
    idx = np.linspace(0, t.size - 1, n).astype(int)
    return t[idx], v[idx]


def downsample_rows(times, matrix, n: int = 400):
    """Uniformly subsample a ``(frames, dims)`` matrix down to ``n`` frames."""
    t = np.asarray(times, dtype=float)
    m = np.asarray(matrix, dtype=float)
    if t.size == 0:
        return t, m
    if t.size <= n or n <= 0:
        return t, m
    idx = np.linspace(0, t.size - 1, n).astype(int)
    return t[idx], m[idx]


# ---------------------------------------------------------------------------
# JSON-safe numbers
# ---------------------------------------------------------------------------

def fnum(value, nd: int = 6):
    """Round to ``nd`` decimals, mapping NaN / inf / None to ``None``.

    ``None`` is the schema's way of saying "could not be estimated" -- the
    analyzer never substitutes a made-up number.
    """
    if value is None:
        return None
    try:
        v = float(value)
    except (TypeError, ValueError):
        return None
    if not math.isfinite(v):
        return None
    return round(v, nd)


def flist(values: Iterable, nd: int = 6) -> list:
    return [fnum(v, nd) for v in values]


def ilist(values: Sequence) -> list:
    return [int(v) for v in values]


def clamp01(v: float) -> float:
    return float(min(1.0, max(0.0, v)))


# ---------------------------------------------------------------------------
# Hashing
# ---------------------------------------------------------------------------

def hash_bytes(data: bytes, length: int = 64) -> str:
    return hashlib.sha256(data).hexdigest()[:length]


def hash_file(path, chunk: int = 1 << 20) -> str:
    """Full-file SHA-256 (the cache key must not depend on file size alone)."""
    h = hashlib.sha256()
    with open(path, "rb") as fh:
        while True:
            block = fh.read(chunk)
            if not block:
                break
            h.update(block)
    return h.hexdigest()


def hash_strings(*parts: str, length: int = 32) -> str:
    h = hashlib.sha256()
    for part in parts:
        h.update(str(part).encode("utf-8"))
        h.update(b"\x00")
    return h.hexdigest()[:length]


# ---------------------------------------------------------------------------
# Signal helpers
# ---------------------------------------------------------------------------

def to_mono(y) -> np.ndarray:
    """``(channels, samples)`` or ``(samples,)`` -> ``(samples,)`` float32."""
    arr = np.asarray(y, dtype=np.float32)
    if arr.ndim == 2:
        # librosa's convention for multi-channel is (channels, samples).
        arr = arr.mean(axis=0)
    return np.ascontiguousarray(arr.reshape(-1))


def peak(y) -> float:
    arr = np.asarray(y, dtype=float)
    return float(np.max(np.abs(arr))) if arr.size else 0.0


def is_silent(y, sr: int, threshold: float = 1e-4) -> bool:
    """True when the clip carries no usable signal (digital or near silence)."""
    arr = np.asarray(y, dtype=float)
    if arr.size == 0:
        return True
    if peak(arr) < threshold:
        return True
    # Very low but non-zero noise floors also carry no musical content.
    return float(np.percentile(np.abs(arr), 95)) < threshold / 4.0


def slugify(name: str) -> str:
    out = []
    for ch in name.lower():
        if ch.isalnum() or ch in "_-":
            out.append(ch)
        elif ch in " .":
            out.append("_")
    slug = "".join(out).strip("_")
    while "__" in slug:
        slug = slug.replace("__", "_")
    return slug or "song"

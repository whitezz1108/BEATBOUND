"""Stem separation adapter (prompt section 2.B).

The analyzer never talks to a specific Demucs CLI: it asks this module for four
stem paths, and this module decides how to produce them. Backends are tried in
order and the first that works wins; if none work, ``StemResult.available`` is
False and the pipeline continues without stems -- a missing model must never
take down an analyze run.

Backend order:
  1. ``demucs`` python API (HTDemucs) -- what this project uses
  2. the ``demucs`` command line, if the python API is unusable
  3. unavailable
"""

from __future__ import annotations

import os
import shutil
import subprocess
import tempfile
from typing import Dict, Optional

import numpy as np

from . import config, util, version
from .cache import AudioCache
from .results import StemResult

STEMS = ("drums", "bass", "vocals", "other")


def demucs_available() -> tuple[bool, Optional[str]]:
    """Whether the python API is importable, without loading any weights."""
    try:
        import demucs  # noqa: F401
        from demucs.pretrained import get_model  # noqa: F401
        from demucs.apply import apply_model  # noqa: F401

        return True, getattr(demucs, "__version__", "unknown")
    except Exception as exc:  # pragma: no cover - environment dependent
        return False, f"{type(exc).__name__}: {exc}"


def _read_stem(path: str, sr: int) -> np.ndarray:
    """Read a written stem back as mono float32 on the analysis grid."""
    import librosa

    y, _ = librosa.load(path, sr=sr, mono=True)
    return np.ascontiguousarray(np.asarray(y, dtype=np.float32).reshape(-1))


def _separate_with_python_api(
    audio_path: str, out_dir: str, *, threads: int = 4
) -> Dict[str, np.ndarray]:
    """Run HTDemucs through the demucs python API.

    ``shifts=0`` is not an optimisation -- it is required for determinism.
    Demucs defaults to ``shifts=1``, which pads the mix by up to half a second
    and draws a *random* time offset (``random.randint``) before separating and
    shifting the result back. Even a single shift is therefore a random variable,
    and the same audio run twice in one process gave stems differing by up to
    ~0.3 in absolute sample value -- enough to move onset counts, section
    melodicActivity and event ordering. BeatBound's contract is that the same
    song yields byte-identical JSON, so the random-shift augmentation is turned
    off. The cost is the small SDR gain that averaging shifts buys (Demucs's own
    help text: "up to 0.2 points"), which is irrelevant here -- the stems feed
    activity curves, not a listening mix.
    """
    import torch
    from demucs.pretrained import get_model
    from demucs.apply import apply_model

    torch.set_num_threads(max(1, threads))
    model = get_model(version.STEM_MODEL_NAME)
    model.eval()

    # Demucs needs (batch, channels, samples) at its own sample rate; mono input
    # is rejected, so duplicate the channel when the source is mono.
    import librosa

    y, _ = librosa.load(audio_path, sr=model.samplerate, mono=False)
    arr = np.atleast_2d(np.asarray(y, dtype=np.float32))
    if arr.shape[0] == 1:
        arr = np.repeat(arr, model.audio_channels, axis=0)
    elif arr.shape[0] > model.audio_channels:
        arr = arr[: model.audio_channels]

    tensor = torch.from_numpy(np.ascontiguousarray(arr)).unsqueeze(0)
    with torch.no_grad():
        separated = apply_model(
            model, tensor, device="cpu", progress=False, shifts=0
        )[0]

    signals: Dict[str, np.ndarray] = {}
    for i, name in enumerate(model.sources):
        mono = separated[i].mean(dim=0).cpu().numpy().astype(np.float32)
        signals[name] = mono
    return signals


def _write_stems(signals: Dict[str, np.ndarray], out_dir: str, sr: int) -> Dict[str, str]:
    import soundfile as sf

    os.makedirs(out_dir, exist_ok=True)
    paths: Dict[str, str] = {}
    for name, sig in signals.items():
        target = os.path.join(out_dir, f"{name}.wav")
        sf.write(target, sig, sr, subtype="PCM_16")
        paths[name] = target
    return paths


def _separate_with_cli(audio_path: str, out_dir: str) -> Dict[str, str]:
    """Fallback: shell out to the ``demucs`` entry point.

    ``--shifts 0`` for the same reason as the python API path above: the CLI
    defaults to one *random* time shift, which would make this fallback
    non-deterministic in exactly the way the pipeline forbids.
    """
    exe = shutil.which("demucs")
    if not exe:
        raise RuntimeError("demucs CLI not found on PATH")
    os.makedirs(out_dir, exist_ok=True)
    proc = subprocess.run(
        [
            exe,
            "-n",
            version.STEM_MODEL_NAME,
            "-o",
            out_dir,
            "--two-stems=vocals",
            "--shifts",
            "0",
            audio_path,
        ],
        capture_output=True,
        text=True,
    )
    if proc.returncode != 0:
        raise RuntimeError(f"demucs CLI failed: {proc.stderr.strip()[:400]}")
    found: Dict[str, str] = {}
    for root, _dirs, files in os.walk(out_dir):
        for f in files:
            if f.endswith(".wav"):
                found[os.path.splitext(f)[0]] = os.path.join(root, f)
    return found


def separate_audio(
    audio_path: str,
    *,
    cache: Optional[AudioCache] = None,
    sr: int = config.STEM_SR,
    force: bool = False,
    enabled: bool = True,
) -> StemResult:
    """Return four stems for ``audio_path``, or an unavailable result.

    ``separate_audio(input_path) -> {drums, bass, vocals, other}`` per the
    prompt's suggested interface, with the failure mode made explicit instead of
    raising.
    """
    warnings: list[str] = []
    empty = {name: None for name in STEMS}

    if not enabled:
        return StemResult(
            available=False,
            backend=None,
            paths=dict(empty),
            signals={},
            sr=sr,
            error="stem separation disabled by --no-stems",
            warnings=warnings,
        )

    # ---- cache ------------------------------------------------------------
    if cache is not None and not force and cache.is_valid(
        model_name=version.STEM_MODEL_NAME,
        model_version=version.STEM_MODEL_VERSION,
        section="stems",
    ):
        cached_paths = {name: cache.path("stems", f"{name}.wav") for name in STEMS}
        if all(os.path.isfile(p) for p in cached_paths.values()):
            signals = {name: _read_stem(p, sr) for name, p in cached_paths.items()}
            return StemResult(
                available=True,
                backend=version.STEM_MODEL_VERSION,
                paths=cached_paths,
                signals=signals,
                sr=sr,
                cached=True,
                warnings=warnings,
            )

    # ---- live separation --------------------------------------------------
    has_api, api_note = demucs_available()
    signals: Dict[str, np.ndarray] = {}
    mechanism: Optional[str] = None
    error: Optional[str] = None

    if has_api:
        try:
            signals = _separate_with_python_api(audio_path, "")
            mechanism = f"demucs-python {api_note}"
        except Exception as exc:
            error = f"demucs python API failed: {type(exc).__name__}: {exc}"
            warnings.append(error)

    if not signals:
        try:
            with tempfile.TemporaryDirectory() as tmp:
                paths = _separate_with_cli(audio_path, tmp)
                if paths:
                    signals = {n: _read_stem(p, sr) for n, p in paths.items()}
                    mechanism = "demucs-cli"
        except Exception as exc:
            if error is None:
                error = f"demucs unavailable: {type(exc).__name__}: {exc}"
            warnings.append(error)

    if not signals:
        return StemResult(
            available=False,
            backend=None,
            paths=dict(empty),
            signals={},
            sr=sr,
            error=error or "no stem separation backend available",
            warnings=warnings,
        )

    # Demucs reports sources in its own order; normalise to the schema's four.
    normalised: Dict[str, np.ndarray] = {}
    for name in STEMS:
        if name in signals:
            normalised[name] = signals[name]
        elif name == "other":
            # Some backends (e.g. --two-stems) fold everything non-vocal into
            # "other"; if it is absent, mix whatever else came back.
            extras = [v for k, v in signals.items() if k not in normalised]
            if extras:
                normalised[name] = np.mean(np.stack(extras, axis=0), axis=0)
    if not normalised:
        return StemResult(
            available=False,
            backend=None,
            paths=dict(empty),
            signals={},
            sr=sr,
            error="backend returned no recognised stems",
            warnings=warnings,
        )

    # ---- persist ----------------------------------------------------------
    paths: Dict[str, Optional[str]] = dict(empty)
    if cache is not None:
        out_dir = cache.ensure_dir("stems")
        written = _write_stems(normalised, out_dir, sr)
        for name, p in written.items():
            paths[name] = p
        # Analyse the stems **as written**, not the in-memory floats. The cache
        # stores PCM_16, so reading back is lossy; if the first run analysed the
        # unquantised signal and later runs analysed the quantised one, the same
        # song would produce two different documents depending on whether the
        # cache happened to be warm. Re-reading here makes the quantised signal
        # the single source of truth for every run.
        normalised = {name: _read_stem(p, sr) for name, p in written.items()}
        cache.mark(
            "stems",
            model_name=version.STEM_MODEL_NAME,
            model_version=version.STEM_MODEL_VERSION,
            mechanism=mechanism,
            stems=sorted(normalised.keys()),
        )

    return StemResult(
        available=True,
        # The model identifier, not the code path -- see StemResult's docstring.
        backend=version.STEM_MODEL_VERSION,
        paths=paths,
        signals=normalised,
        sr=sr,
        cached=False,
        mechanism=mechanism,
        warnings=warnings,
    )

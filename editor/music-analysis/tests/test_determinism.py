"""Determinism test (prompt section 20).

The same audio must produce byte-identical JSON. This is why the document
carries no wall-clock timestamp: a ``generatedAt`` field would make this test
impossible, and nothing downstream needs one.

Two runs in the *same* process catch RNG / dict-ordering drift. Two runs in
separate processes catch anything that depends on process state -- hash seeds,
library caches, model warm-up order. Both are checked.
"""

from __future__ import annotations

import hashlib
import json
import os
import subprocess
import sys

import pytest

from conftest import run_v2

MUSIC_ANALYSIS = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CLI = os.path.join(MUSIC_ANALYSIS, "analyze_music_v2.py")


def _digest(path: str) -> str:
    with open(path, "rb") as fh:
        return hashlib.sha256(fh.read()).hexdigest()


def test_two_runs_in_one_process_are_identical(click_wav, tmp_path, stub_full_backends):
    a_dir = tmp_path / "a"
    b_dir = tmp_path / "b"
    a_dir.mkdir()
    b_dir.mkdir()

    run_v2(click_wav, str(a_dir), mode="full", cache_dir=str(tmp_path / "cache"))
    run_v2(click_wav, str(b_dir), mode="full", cache_dir=str(tmp_path / "cache"))

    assert _digest(str(a_dir / "music_analysis_v2.json")) == _digest(
        str(b_dir / "music_analysis_v2.json")
    ), "V2 document is not byte-deterministic"
    assert _digest(str(a_dir / "music_analysis.json")) == _digest(
        str(b_dir / "music_analysis.json")
    ), "legacy projection is not byte-deterministic"


def test_two_runs_in_separate_processes_are_identical(click_wav, tmp_path):
    """Fast mode here, so no model stub is needed across the process boundary."""
    out_a = tmp_path / "proc_a.json"
    out_b = tmp_path / "proc_b.json"
    env = dict(os.environ, PYTHONIOENCODING="utf-8")

    for out in (out_a, out_b):
        proc = subprocess.run(
            [
                sys.executable,
                CLI,
                click_wav,
                str(out),
                "--fast",
                "--quiet",
                "--cache-dir",
                str(tmp_path / "cache"),
            ],
            capture_output=True,
            text=True,
            env=env,
            cwd=MUSIC_ANALYSIS,
        )
        assert proc.returncode == 0, f"CLI failed:\n{proc.stdout}\n{proc.stderr}"

    assert _digest(str(out_a)) == _digest(str(out_b)), (
        "V2 document differs across processes -- something depends on process state"
    )


def test_document_has_no_timestamp_field(click_wav, tmp_path, stub_missing_backends):
    """No wall-clock value may appear in the artifact.

    Only the *values* are scanned, not the whole serialised blob: a warning
    string may legitimately contain the word "timestamp" when a backend reports
    an error mentioning it, and a substring match on the raw JSON would flag that
    as a false positive.
    """
    doc, _legacy, _out = run_v2(
        click_wav, str(tmp_path), mode="full", cache_dir=str(tmp_path / "cache")
    )
    banned = ("generatedat", "timestamp", "createdat", "analysistime", "date")

    def walk(node, path=""):
        if isinstance(node, dict):
            for key, value in node.items():
                assert key.lower() not in banned, f"timestamp-ish key {path}/{key}"
                walk(value, f"{path}/{key}")
        elif isinstance(node, list):
            for i, value in enumerate(node):
                walk(value, f"{path}[{i}]")

    walk(doc)


def test_document_does_not_leak_machine_paths(click_wav, tmp_path, stub_missing_backends):
    """Absolute paths outside `source` would make the artifact machine-specific."""
    doc, _legacy, _out = run_v2(
        click_wav, str(tmp_path), mode="full", cache_dir=str(tmp_path / "cache")
    )
    blob = json.dumps(doc["analysisMeta"])
    assert str(tmp_path) not in blob, "analysisMeta leaked the cache directory"
    assert str(tmp_path) not in json.dumps(doc["global"])


def test_repeated_run_reuses_cache_without_changing_output(click_wav, tmp_path):
    """A cached second run must produce the same bytes as the first."""
    cache = str(tmp_path / "cache")
    first_dir = tmp_path / "first"
    second_dir = tmp_path / "second"
    first_dir.mkdir()
    second_dir.mkdir()

    run_v2(click_wav, str(first_dir), mode="fast", cache_dir=cache)
    run_v2(click_wav, str(second_dir), mode="fast", cache_dir=cache)

    assert _digest(str(first_dir / "music_analysis_v2.json")) == _digest(
        str(second_dir / "music_analysis_v2.json")
    )


# ---------------------------------------------------------------------------
# Demucs random-shift augmentation
# ---------------------------------------------------------------------------
#
# These two tests exist because the real-song pipeline was *not* reproducible
# even though every test above passed. The tests above all stub the ML backends,
# so they never exercised Demucs' own defaults -- and Demucs' default is
# non-deterministic on purpose. `apply_model` takes `shifts=1`, which pads the
# mix by up to half a second, draws a *random* offset via `random.randint`, and
# shifts the result back. Two runs over the same audio in the *same process*
# therefore returned stems differing by up to ~0.3 absolute sample value, which
# moved stem onsets, section melodicActivity, melodicDensity and event ordering.
#
# The fix is `shifts=0` on both the python-API and CLI paths. These tests pin the
# argument rather than the numeric output, so they run in seconds without the
# model weights and cannot pass by accident.


class _FakeDemucsModel:
    """Enough of a Demucs model for the separator's plumbing, no weights."""

    samplerate = 22050
    audio_channels = 2
    sources = ["drums", "bass", "vocals", "other"]

    def eval(self):
        return self


def _install_fake_demucs(monkeypatch, captured: dict):
    """Patch the demucs entry points, recording the kwargs apply_model got."""
    torch = pytest.importorskip("torch")
    pytest.importorskip("demucs.apply")
    pytest.importorskip("demucs.pretrained")

    monkeypatch.setattr(
        "demucs.pretrained.get_model", lambda _name: _FakeDemucsModel()
    )

    def fake_apply_model(model, mix, **kwargs):
        captured.update(kwargs)
        return torch.zeros(1, len(model.sources), model.audio_channels, 16)

    monkeypatch.setattr("demucs.apply.apply_model", fake_apply_model)


def test_demucs_python_api_disables_random_shifts(short_wav, monkeypatch):
    """`shifts=0` is contractual, not a speed tweak.

    Left at Demucs' default of 1, the separator returns different stems for the
    same audio on every call, and the 'byte-identical JSON' guarantee is false
    for any real song.
    """
    from beatbound_audio import stem_separator

    captured: dict = {}
    _install_fake_demucs(monkeypatch, captured)

    signals = stem_separator._separate_with_python_api(short_wav, "")

    assert captured.get("shifts") == 0, (
        "Demucs apply_model must be called with shifts=0; the default of 1 draws "
        "a random time offset and makes the artifact non-reproducible"
    )
    assert set(signals) == {"drums", "bass", "vocals", "other"}


def test_demucs_cli_fallback_disables_random_shifts(short_wav, tmp_path, monkeypatch):
    """The CLI fallback must pass --shifts 0 too, or the guarantee leaks."""
    import subprocess

    from beatbound_audio import stem_separator

    monkeypatch.setattr(stem_separator.shutil, "which", lambda _name: "demucs")

    seen: dict = {}

    class _Proc:
        returncode = 0
        stderr = ""

    def fake_run(cmd, **_kwargs):
        seen["cmd"] = list(cmd)
        return _Proc()

    monkeypatch.setattr(subprocess, "run", fake_run)

    stem_separator._separate_with_cli(short_wav, str(tmp_path))

    cmd = seen["cmd"]
    assert "--shifts" in cmd, f"demucs CLI was called without --shifts: {cmd}"
    assert cmd[cmd.index("--shifts") + 1] == "0", (
        f"demucs CLI must use --shifts 0, got: {cmd}"
    )

"""Short-audio and silence tests (prompt section 20).

Two inputs that break naive analyzers, and both are legitimate:

* **short audio** -- shorter than a bar, sometimes shorter than a single frame.
  There is no tempo to estimate and no structure to find. The document must
  still be well formed.
* **silence** -- digital zeros. v1 divided by the estimated tempo and crashed on
  this input. The V2 contract is that silence produces ``bpm: null`` and
  ``silent: true``, not an exception and not a fabricated tempo.
"""

from __future__ import annotations

import json
import os

import pytest

from conftest import run_v2


def _schema_errors(doc: dict) -> list:
    jsonschema = pytest.importorskip("jsonschema")
    here = os.path.dirname(os.path.abspath(__file__))
    schema_path = os.path.join(
        os.path.dirname(os.path.dirname(here)), "schemas", "music-analysis-v2.schema.json"
    )
    with open(schema_path, "r", encoding="utf-8") as fh:
        schema = json.load(fh)
    validator = jsonschema.Draft202012Validator(schema)
    return sorted(validator.iter_errors(doc), key=lambda e: list(e.path))


# ---------------------------------------------------------------------------
# Silence
# ---------------------------------------------------------------------------

def test_silence_does_not_raise(silent_wav, tmp_path, stub_missing_backends):
    """The v1 analyzer divided by the tempo here and crashed. V2 must not."""
    doc, _legacy, _out = run_v2(
        silent_wav, str(tmp_path), mode="full", cache_dir=str(tmp_path / "cache")
    )
    assert doc["schemaVersion"] == 2


def test_silence_reports_no_tempo_rather_than_faking_one(silent_wav, tmp_path, stub_missing_backends):
    doc, legacy, _out = run_v2(
        silent_wav, str(tmp_path), mode="full", cache_dir=str(tmp_path / "cache")
    )
    assert doc["global"]["silent"] is True
    assert doc["global"]["bpm"] is None, "silence must not produce a tempo"
    assert doc["global"]["tempoConfidence"] in (None, 0.0)
    assert doc["layers"]["rhythm"]["beatCount"] == 0
    assert doc["layers"]["rhythm"]["barCount"] == 0
    assert doc["events"] == []

    # The v1 schema requires bpm > 0, so the projection substitutes a nominal
    # tempo -- and says so, loudly, instead of hiding it.
    assert legacy["tempo"]["bpm"] > 0
    assert legacy["report"]["tempoFallback"], "the substituted tempo must be disclosed"
    assert any("nominal" in w for w in legacy["report"]["warnings"])


def test_silence_still_validates(silent_wav, tmp_path, stub_missing_backends):
    doc, _legacy, _out = run_v2(
        silent_wav, str(tmp_path), mode="full", cache_dir=str(tmp_path / "cache")
    )
    errors = _schema_errors(doc)
    assert not errors, "\n".join(
        f"{'/'.join(str(p) for p in e.path)} :: {e.message}" for e in errors[:10]
    )


def test_silence_reports_zero_energy_and_null_dynamic_range(silent_wav, tmp_path, stub_missing_backends):
    """"Silent" and "no dynamic range" are different facts from "loud"."""
    doc, _legacy, _out = run_v2(
        silent_wav, str(tmp_path), mode="full", cache_dir=str(tmp_path / "cache")
    )
    assert doc["global"]["overallEnergy"] == 0.0
    assert doc["global"]["dynamicRange"] is None
    assert doc["global"]["rhythmicDensity"] is None
    assert doc["global"]["key"] is None


def test_silence_legacy_projection_validates(silent_wav, tmp_path, stub_missing_backends):
    """The projection must stay loadable by the editor even for a silent file."""
    jsonschema = pytest.importorskip("jsonschema")
    _doc, legacy, _out = run_v2(
        silent_wav, str(tmp_path), mode="full", cache_dir=str(tmp_path / "cache")
    )
    here = os.path.dirname(os.path.abspath(__file__))
    schema_path = os.path.join(
        os.path.dirname(os.path.dirname(here)), "schemas", "music-analysis.schema.json"
    )
    with open(schema_path, "r", encoding="utf-8") as fh:
        schema = json.load(fh)
    errors = list(jsonschema.Draft202012Validator(schema).iter_errors(legacy))
    assert not errors, "\n".join(
        f"{'/'.join(str(p) for p in e.path)} :: {e.message}" for e in errors[:10]
    )


# ---------------------------------------------------------------------------
# Short audio
# ---------------------------------------------------------------------------

def test_short_audio_does_not_raise(short_wav, tmp_path, stub_missing_backends):
    doc, _legacy, _out = run_v2(
        short_wav, str(tmp_path), mode="full", cache_dir=str(tmp_path / "cache")
    )
    assert doc["schemaVersion"] == 2


def test_short_audio_still_validates(short_wav, tmp_path, stub_missing_backends):
    doc, _legacy, _out = run_v2(
        short_wav, str(tmp_path), mode="full", cache_dir=str(tmp_path / "cache")
    )
    errors = _schema_errors(doc)
    assert not errors, "\n".join(
        f"{'/'.join(str(p) for p in e.path)} :: {e.message}" for e in errors[:10]
    )


def test_short_audio_has_no_invented_structure(short_wav, tmp_path, stub_missing_backends):
    """A 0.4 s clip cannot have a chorus. It must not claim sections it can't know."""
    doc, _legacy, _out = run_v2(
        short_wav, str(tmp_path), mode="full", cache_dir=str(tmp_path / "cache")
    )
    # At most one section (the whole clip), never several fabricated boundaries.
    assert len(doc["sections"]) <= 1
    for section in doc["sections"]:
        assert section["label"] is None or section["label"] in (
            "high_energy_section",
            "low_energy_section",
        )


def test_tiny_audio_does_not_raise(tiny_wav, tmp_path, stub_missing_backends):
    """20 ms -- fewer samples than a single analysis frame."""
    doc, _legacy, _out = run_v2(
        tiny_wav, str(tmp_path), mode="full", cache_dir=str(tmp_path / "cache")
    )
    assert doc["schemaVersion"] == 2
    errors = _schema_errors(doc)
    assert not errors, "\n".join(
        f"{'/'.join(str(p) for p in e.path)} :: {e.message}" for e in errors[:10]
    )


def test_short_audio_legacy_projection_validates(short_wav, tmp_path, stub_missing_backends):
    jsonschema = pytest.importorskip("jsonschema")
    _doc, legacy, _out = run_v2(
        short_wav, str(tmp_path), mode="full", cache_dir=str(tmp_path / "cache")
    )
    here = os.path.dirname(os.path.abspath(__file__))
    schema_path = os.path.join(
        os.path.dirname(os.path.dirname(here)), "schemas", "music-analysis.schema.json"
    )
    with open(schema_path, "r", encoding="utf-8") as fh:
        schema = json.load(fh)
    errors = list(jsonschema.Draft202012Validator(schema).iter_errors(legacy))
    assert not errors, "\n".join(
        f"{'/'.join(str(p) for p in e.path)} :: {e.message}" for e in errors[:10]
    )

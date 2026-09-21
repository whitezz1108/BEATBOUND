"""Fallback tests (prompt section 20).

A missing ML backend must degrade, never raise. These tests stub the backends to
unavailable and assert that:

* the run still completes and writes both documents,
* every section that depends on the missing backend reports ``available: false``
  rather than inventing values,
* ``analysisMeta.backends`` reports the truth -- an uninstalled component is
  never claimed to have worked (prompt section 25.C).
"""

from __future__ import annotations

import json
import os

from conftest import run_v2


def _available_flags(doc: dict) -> dict:
    return {name: block["available"] for name, block in doc["analysisMeta"]["backends"].items()}


def test_missing_backends_still_produce_both_documents(click_wav, tmp_path, stub_missing_backends):
    doc, legacy, _report = run_v2(
        click_wav, str(tmp_path), mode="full", cache_dir=str(tmp_path / "cache")
    )
    assert os.path.isfile(str(tmp_path / "music_analysis_v2.json"))
    assert os.path.isfile(str(tmp_path / "music_analysis.json"))
    assert doc["schemaVersion"] == 2
    assert legacy["version"] == "1.0.0"


def test_missing_backends_report_unavailable_not_fabricated(click_wav, tmp_path, stub_missing_backends):
    doc, _legacy, _out = run_v2(
        click_wav, str(tmp_path), mode="full", cache_dir=str(tmp_path / "cache")
    )

    assert doc["layers"]["stems"]["available"] is False
    assert doc["layers"]["melody"]["available"] is False
    assert doc["layers"]["stems"]["reason"], "an unavailable backend must say why"

    # The four stem activity numbers must be null, not 0.0 -- "we could not
    # measure this" and "this stem is silent" are different statements.
    for stem in ("drums", "bass", "vocals", "other"):
        assert doc["layers"]["stems"]["activity"][stem] is None
        assert doc["layers"]["stems"][stem] == {"available": False}

    assert doc["layers"]["melody"]["notes"] == []
    assert doc["layers"]["melody"]["phrases"] == []
    assert doc["global"]["melodicDensity"] is None

    # No event may be sourced from a backend that did not run.
    sources = {e["source"] for e in doc["events"]}
    assert not (sources & {"vocals", "bass", "drums", "melody"}), (
        f"events came from unavailable backends: {sorted(sources)}"
    )


def test_backends_block_records_what_actually_ran(click_wav, tmp_path, stub_missing_backends):
    doc, _legacy, _out = run_v2(
        click_wav, str(tmp_path), mode="full", cache_dir=str(tmp_path / "cache")
    )
    flags = _available_flags(doc)
    assert flags["stems"] is False
    assert flags["melody"] is False
    # The built-in key estimator has no optional dependency, so it must be true.
    assert flags["key"] is True

    for name in ("stems", "melody"):
        detail = doc["analysisMeta"]["backends"][name]["detail"]
        assert isinstance(detail, str) and detail, f"{name} must carry a reason string"

    assert doc["analysisMeta"]["models"]["stems"]["used"] is False
    assert doc["analysisMeta"]["models"]["melody"]["used"] is False


def test_fast_mode_skips_backends_entirely(click_wav, tmp_path, stub_full_backends):
    """--fast must not call the ML backends even when they are available."""
    doc, _legacy, _out = run_v2(
        click_wav, str(tmp_path), mode="fast", cache_dir=str(tmp_path / "cache")
    )
    assert doc["analysisMeta"]["flags"]["stems"] is False
    assert doc["analysisMeta"]["flags"]["melody"] is False
    assert doc["layers"]["stems"]["available"] is False
    assert doc["layers"]["melody"]["available"] is False
    # Tempo / energy / key still work -- fast mode is reduced, not empty.
    assert doc["global"]["bpm"] is not None
    assert doc["global"]["overallEnergy"] is not None


def test_no_stems_flag_disables_only_stems(click_wav, tmp_path, stub_full_backends):
    doc, _legacy, _out = run_v2(
        click_wav,
        str(tmp_path),
        mode="full",
        use_stems=False,
        cache_dir=str(tmp_path / "cache"),
    )
    assert doc["layers"]["stems"]["available"] is False
    assert doc["layers"]["melody"]["available"] is True
    assert doc["analysisMeta"]["models"]["melody"]["used"] is True


def test_backend_failure_does_not_abort_the_run(click_wav, tmp_path, monkeypatch):
    """A backend that *raises* must be caught, not propagated (prompt section 15)."""
    from beatbound_audio import stem_separator

    monkeypatch.setattr(
        stem_separator, "demucs_available", lambda: (True, "stub that will explode")
    )

    def boom(*_a, **_k):
        raise RuntimeError("stub: model weights are corrupt")

    monkeypatch.setattr(stem_separator, "_separate_with_python_api", boom)
    monkeypatch.setattr(stem_separator, "_separate_with_cli", boom)

    doc, _legacy, _out = run_v2(
        click_wav, str(tmp_path), mode="full", cache_dir=str(tmp_path / "cache")
    )
    assert doc["layers"]["stems"]["available"] is False
    assert "corrupt" in (doc["layers"]["stems"]["reason"] or "")
    # The rest of the pipeline still ran.
    assert doc["global"]["bpm"] is not None
    assert len(doc["events"]) > 0

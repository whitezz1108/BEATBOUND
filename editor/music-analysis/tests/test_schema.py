"""Schema test (prompt section 20).

Both documents the pipeline writes must validate: the V2 document against
``music-analysis-v2.schema.json``, and the v1 projection against the *existing*
``music-analysis.schema.json``. The second one is the load-bearing assertion of
the whole upgrade -- it is what proves the level director and the editor UI can
keep consuming the file unchanged.
"""

from __future__ import annotations

import json
import os

import pytest

from conftest import run_v2

SCHEMA_DIR = os.path.join(
    os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))),
    "schemas",
)


def _load_schema(name: str) -> dict:
    with open(os.path.join(SCHEMA_DIR, name), "r", encoding="utf-8") as fh:
        return json.load(fh)


def _errors(schema: dict, doc: dict) -> list:
    jsonschema = pytest.importorskip("jsonschema")
    validator = jsonschema.Draft202012Validator(schema)
    return sorted(validator.iter_errors(doc), key=lambda e: list(e.path))


def _render(errors: list) -> str:
    return "\n".join(
        f"  {'/'.join(str(p) for p in e.path) or '(root)'} :: {e.message[:200]}"
        for e in errors[:10]
    )


def test_v2_document_matches_v2_schema(click_wav, tmp_path, stub_missing_backends):
    doc, _legacy, _out = run_v2(
        click_wav, str(tmp_path), mode="full", cache_dir=str(tmp_path / "cache")
    )
    errors = _errors(_load_schema("music-analysis-v2.schema.json"), doc)
    assert not errors, "V2 document failed its own schema:\n" + _render(errors)


def test_v2_document_matches_v2_schema_with_backends(
    click_wav, tmp_path, stub_full_backends
):
    """The success branch has extra keys (stem blocks, notes) -- check those too."""
    doc, _legacy, _out = run_v2(
        click_wav, str(tmp_path), mode="full", cache_dir=str(tmp_path / "cache")
    )
    assert doc["layers"]["stems"]["available"] is True
    assert doc["layers"]["melody"]["available"] is True
    errors = _errors(_load_schema("music-analysis-v2.schema.json"), doc)
    assert not errors, "V2 document failed its schema with backends on:\n" + _render(errors)


def test_legacy_projection_matches_v1_schema(click_wav, tmp_path, stub_full_backends):
    """The projection must satisfy the schema the editor already ships."""
    _doc, legacy, _out = run_v2(
        click_wav, str(tmp_path), mode="full", cache_dir=str(tmp_path / "cache")
    )
    errors = _errors(_load_schema("music-analysis.schema.json"), legacy)
    assert not errors, "v1 projection failed the v1 schema:\n" + _render(errors)


def test_root_shape_has_every_required_key(click_wav, tmp_path, stub_missing_backends):
    """Prompt section 4's root shape, asserted literally."""
    doc, _legacy, _out = run_v2(
        click_wav, str(tmp_path), mode="full", cache_dir=str(tmp_path / "cache")
    )
    for key in (
        "schemaVersion",
        "source",
        "global",
        "timeline",
        "sections",
        "events",
        "analysisMeta",
    ):
        assert key in doc, f"root is missing {key!r}"
    assert doc["schemaVersion"] == 2


def test_global_block_has_every_required_field(click_wav, tmp_path, stub_missing_backends):
    """Prompt section 5's global fields, present even when null."""
    doc, _legacy, _out = run_v2(
        click_wav, str(tmp_path), mode="full", cache_dir=str(tmp_path / "cache")
    )
    for field in (
        "bpm",
        "tempoConfidence",
        "key",
        "scale",
        "overallEnergy",
        "dynamicRange",
        "brightness",
        "rhythmicDensity",
        "melodicDensity",
    ):
        assert field in doc["global"], f"global is missing {field!r}"


def test_no_gameplay_event_types(click_wav, tmp_path, stub_full_backends):
    """This layer is musical only -- no gameplay vocabulary may leak in."""
    doc, _legacy, _out = run_v2(
        click_wav, str(tmp_path), mode="full", cache_dir=str(tmp_path / "cache")
    )
    allowed = set(_load_schema("music-analysis-v2.schema.json")["properties"]["events"]["items"]["properties"]["type"]["enum"])
    seen = {e["type"] for e in doc["events"]}
    assert seen <= allowed, f"unexpected event types: {sorted(seen - allowed)}"
    for banned in ("spawn_ring", "jump", "change_mode", "spawn_note", "spawn_obstacle"):
        assert banned not in seen


def test_no_semantic_section_labels(click_wav, tmp_path, stub_full_backends):
    """Prompt section 11: never label a section "chorus" or similar."""
    doc, _legacy, _out = run_v2(
        click_wav, str(tmp_path), mode="full", cache_dir=str(tmp_path / "cache")
    )
    allowed = {"high_energy_section", "low_energy_section", None}
    for section in doc["sections"]:
        assert section["label"] in allowed, f"semantic label leaked: {section['label']!r}"


def test_legacy_projection_keeps_v1_section_shape(click_wav, tmp_path, stub_missing_backends):
    """v1 required integer startBar/endBar >= 1 and a string label."""
    _doc, legacy, _out = run_v2(
        click_wav, str(tmp_path), mode="full", cache_dir=str(tmp_path / "cache")
    )
    assert legacy["version"] == "1.0.0"
    for section in legacy["sections"]:
        assert isinstance(section["startBar"], int) and section["startBar"] >= 1
        assert isinstance(section["endBar"], int) and section["endBar"] >= section["startBar"]
        assert isinstance(section["label"], str) and section["label"]

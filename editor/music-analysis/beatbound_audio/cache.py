"""Disk cache for expensive analysis artifacts (prompt section 16).

Layout::

    editor/cache/audio/<audio_hash>/
        meta.json              cache-key record + timing
        stems/<stem>.wav       separated stems, mono @ config.STEM_SR
        melody/notes.json      note events from the pitch backend
        analysis_v2.json       final aggregated document

The cache key is (audio hash, analyzer version, model version, settings
signature). If any component disagrees with the stored record, the entry is
treated as a miss and overwritten -- there is no partial trust.
"""

from __future__ import annotations

import json
import os
import shutil
from typing import Any, Optional

from . import util, version


def default_root() -> str:
    """``<repo>/editor/cache/audio`` -- resolved from this file's location."""
    here = os.path.dirname(os.path.abspath(__file__))
    editor_dir = os.path.dirname(os.path.dirname(here))
    return os.path.join(editor_dir, "cache", "audio")


class AudioCache:
    """One song's cache directory."""

    def __init__(self, audio_hash: str, root: Optional[str] = None):
        self.audio_hash = audio_hash
        self.root = root or default_root()
        self.dir = os.path.join(self.root, audio_hash)

    # -- generic helpers ----------------------------------------------------

    def path(self, *parts: str) -> str:
        return os.path.join(self.dir, *parts)

    def exists(self, *parts: str) -> bool:
        return os.path.exists(self.path(*parts))

    def ensure_dir(self, *parts: str) -> str:
        target = self.path(*parts)
        os.makedirs(target, exist_ok=True)
        return target

    def read_json(self, *parts: str) -> Optional[Any]:
        try:
            with open(self.path(*parts), "r", encoding="utf-8") as fh:
                return json.load(fh)
        except Exception:
            return None

    def write_json(self, obj: Any, *parts: str) -> str:
        target = self.path(*parts)
        os.makedirs(os.path.dirname(target), exist_ok=True)
        tmp = target + ".tmp"
        with open(tmp, "w", encoding="utf-8") as fh:
            json.dump(obj, fh, indent=2, ensure_ascii=False)
        os.replace(tmp, target)
        return target

    # -- meta record --------------------------------------------------------

    def read_meta(self) -> dict:
        return self.read_json("meta.json") or {}

    def merge_meta(self, **fields) -> dict:
        meta = self.read_meta()
        meta.update(fields)
        self.write_json(meta, "meta.json")
        return meta

    # -- cache-key checks ---------------------------------------------------

    def key_for(self, *, model_name: str, model_version: str) -> dict:
        return {
            "audioHash": self.audio_hash,
            "analyzerVersion": version.ANALYZER_VERSION,
            "settingsSignature": version.SETTINGS_SIGNATURE,
            "modelName": model_name,
            "modelVersion": model_version,
        }

    def is_valid(self, *, model_name: str, model_version: str, section: str) -> bool:
        """True when ``meta.json[section]`` matches the expected cache key.

        The stored record is a *superset* of the key: ``mark`` also records
        provenance that is useful when reading the cache by hand (which backend
        ran, which stem names came back, which signal melody was transcribed
        from). So the comparison is key-field-by-key-field rather than whole-dict
        equality -- an extra provenance field must not invalidate an entry.
        """
        stored = self.read_meta().get(section)
        if not isinstance(stored, dict):
            return False
        expected = self.key_for(model_name=model_name, model_version=model_version)
        return all(stored.get(field) == value for field, value in expected.items())

    def mark(self, section: str, *, model_name: str, model_version: str, **extra) -> None:
        record = self.key_for(model_name=model_name, model_version=model_version)
        record.update(extra)
        meta = self.read_meta()
        meta[section] = record
        self.write_json(meta, "meta.json")

    # -- maintenance --------------------------------------------------------

    def clear(self) -> None:
        shutil.rmtree(self.dir, ignore_errors=True)

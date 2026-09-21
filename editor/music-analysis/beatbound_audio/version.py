"""Version constants for the BeatBound audio understanding layer.

Bumping ``ANALYZER_VERSION`` invalidates every cached artifact (stems, melody
notes, aggregated analysis), so only change it when the analysis output would
actually differ.
"""

ANALYZER_NAME = "beatbound-audio-analyzer"
ANALYZER_VERSION = "2.1.0"

#: Schema version of ``music_analysis_v2.json``. The V2.1 additions (bar
#: phase, repetition, phrasing, lyrics slot) are additive optional layers, so
#: the document version stays 2.
SCHEMA_VERSION = 2

#: Schema version of the legacy ``music_analysis.json`` compatibility
#: projection. This stays 1 so the existing editor / director keep working.
LEGACY_SCHEMA_VERSION = "1.0.0"

#: Model identifiers recorded in the cache key and in analysisMeta. Changing a
#: model name or its version string re-runs the expensive inference.
STEM_MODEL_NAME = "htdemucs"
STEM_MODEL_VERSION = "demucs-4.1.0"
MELODY_MODEL_NAME = "icassp_2022"
MELODY_MODEL_VERSION = "basic-pitch-0.4.0"

#: Analysis settings that participate in the cache key. Bump the signature when
#: a default in this module changes in a way that alters numeric output.
#:
#: 2.1.0 -> 2.1.1: the demucs python-API path wrote 44.1 kHz samples under a
#: 22.05 kHz header (no resample), so every cached stem ran at half speed and
#: the stem/melody/structure/phrasing/repetition layers built on them were
#: time-compressed by 2. The signature bump retires those cached stems instead
#: of silently reusing them.
SETTINGS_SIGNATURE = "v2.1.1-sr22050-hop512-win500hop250"

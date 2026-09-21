"""BeatBound Audio Understanding V2.

Modular music-understanding layer for the level editor. Each analyzer owns one
kind of musical information and returns plain JSON-safe dicts; the feature
aggregator assembles them into ``music_analysis_v2.json``.

This package is deliberately independent of the game runtime: it never imports
from ``src/``, never writes levels, and never emits gameplay events. Its output
describes what the music does, not what the game should do.

Entry points:
    python analyze_music.py <audio> <out.json>          (v1-compatible CLI)
    python analyze_music_v2.py <audio> <out.json>       (explicit V2 CLI)
"""

__all__ = ["version", "util"]

"""Result types shared by every analyzer.

The pipeline is a straight line of pure functions, each returning one of these
dataclasses. They deliberately carry **both** raw numpy arrays (so downstream
stages can resample / aggregate at full resolution) and JSON-ready lists (so
the aggregator never has to re-derive anything).

Keeping every type in one module is what lets the analyzers be written and
tested independently: the interface cannot drift between them.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Dict, List, Optional, Tuple

import numpy as np


# ---------------------------------------------------------------------------
# Input
# ---------------------------------------------------------------------------

@dataclass
class AudioContext:
    """Everything downstream needs to know about the source audio."""

    path: str
    file: str
    song_id: str
    title: str
    y: np.ndarray            # mono float32 at ``sr``
    sr: int
    duration: float
    channels: int
    native_sr: int
    source_hash: str         # 16 hex -- stays byte-stable, feeds level.analysisSource
    audio_hash: str          # 64 hex -- cache key
    silent: bool
    warnings: List[str] = field(default_factory=list)


# ---------------------------------------------------------------------------
# Layer 1 -- rhythm / energy
# ---------------------------------------------------------------------------

@dataclass
class RhythmResult:
    """Tempo, the constant beat/bar grid, and the onset layer."""

    bpm: Optional[float]
    tempo_confidence: Optional[float]
    time_signature: Tuple[int, int]
    meter_confidence: float
    beat_len: Optional[float]
    n_beats: int
    n_bars: int
    beats: List[dict]              # {index,time,bar,beat,beatInBar,isDownbeat,strength}
    bar_bounds: np.ndarray         # (n_bars + 1,) grid times, anchored at 0
    hop_times: np.ndarray          # frame times of the feature grid
    onset_env: np.ndarray          # raw onset strength envelope
    onset_env_norm: np.ndarray     # percentile-normalised envelope
    onsets: List[dict]             # {time,strength}
    onset_times: np.ndarray
    onset_strengths: np.ndarray
    silent: bool


@dataclass
class EnergyResult:
    """Continuous loudness / energy curves."""

    rms: np.ndarray
    rms_norm: np.ndarray           # percentile-normalised 0..1
    rms_smooth: np.ndarray         # moving average of ``rms_norm``
    times: np.ndarray
    timeline: List[dict]           # {time,value} downsampled, value in 0..1
    overall_energy: Optional[float]
    dynamic_range: Optional[float]
    loudness_db: np.ndarray
    loudness_range_db: Optional[float]


# ---------------------------------------------------------------------------
# Layer 2 -- stems
# ---------------------------------------------------------------------------

@dataclass
class StemResult:
    """Separated stem audio (paths on disk) plus the in-memory signals.

    ``backend`` is the *model* identifier and is what the document publishes, so
    it is identical on a cold run and a cached one. ``mechanism`` records which
    code path actually produced the stems (python API vs CLI); that is run-state
    and is reported only in the CLI's debug report, never in the artifact.
    """

    available: bool
    backend: Optional[str]
    paths: Dict[str, Optional[str]]
    signals: Dict[str, np.ndarray]
    sr: int
    cached: bool = False
    mechanism: Optional[str] = None
    error: Optional[str] = None
    warnings: List[str] = field(default_factory=list)


@dataclass
class StemFeatureResult:
    """Per-stem musical descriptors derived from the separated audio."""

    available: bool
    backend: Optional[str]
    times: np.ndarray                        # shared hop grid for every curve
    curves: Dict[str, np.ndarray]            # name -> 0..1 curve on ``times``
    onsets: Dict[str, List[dict]]            # stem -> [{time,strength}]
    activity: Dict[str, Optional[float]]     # stem -> mean activity 0..1
    drums: dict
    bass: dict
    vocals: dict
    other: dict
    warnings: List[str] = field(default_factory=list)


# ---------------------------------------------------------------------------
# Layer 3 -- melody / tonal
# ---------------------------------------------------------------------------

@dataclass
class MelodyResult:
    """Note events plus gameplay-agnostic melodic phrase descriptors."""

    available: bool
    backend: Optional[str]
    input_source: str                        # "other" | "vocals" | "mix"
    confidence: Optional[float]
    notes: List[dict]                        # {start,end,pitchMidi,confidence}
    phrases: List[dict]                      # {start,end,direction,...}
    pitch_times: np.ndarray
    pitch_midi: np.ndarray                   # NaN where no pitch
    pitch_norm: np.ndarray                   # 0..1, NaN where no pitch
    note_density: Optional[float]
    pitch_range_semitones: Optional[int]
    warnings: List[str] = field(default_factory=list)


@dataclass
class TonalResult:
    """Chroma, key/scale and timbre descriptors."""

    available: bool
    chroma: np.ndarray                       # (12, frames)
    chroma_times: np.ndarray
    chroma_mean: List[float]                 # 12 values summing to ~1
    key: Optional[str]                       # e.g. "F#"
    scale: Optional[str]                     # "major" | "minor"
    key_confidence: Optional[float]
    centroid_hz: np.ndarray
    centroid_times: np.ndarray
    centroid_mean_hz: Optional[float]
    brightness: Optional[float]              # 0..1
    contrast_mean: List[float]
    band_balance: dict                       # {low,mid,high} fractions summing to 1
    mfcc: np.ndarray                         # (n_mfcc, frames) -- for structure
    mfcc_times: np.ndarray
    warnings: List[str] = field(default_factory=list)


# ---------------------------------------------------------------------------
# Layer 4 -- structure
# ---------------------------------------------------------------------------

@dataclass
class StructureResult:
    """Section boundaries and their per-section summaries."""

    sections: List[dict]
    boundaries: List[float]                  # boundary times in seconds
    novelty: np.ndarray
    novelty_times: np.ndarray
    method: str                              # which detector produced the result
    warnings: List[str] = field(default_factory=list)


# ---------------------------------------------------------------------------
# Layer 5 -- V2.1 additions: bar phase, repetition, phrasing
# ---------------------------------------------------------------------------

@dataclass
class DownbeatResult:
    """Which beat of the grid bar carries the true musical downbeat.

    The constant grid itself never moves (analysis bars == runtime bars), so the
    phase is *advisory*: ``offset_beats`` says where inside each grid bar the
    perceived downbeat sits. ``None`` means "not reliably estimated" -- silence,
    no tempo, or no metric contrast at all.
    """

    offset_beats: Optional[int]
    confidence: Optional[float]
    downbeats: List[dict]                    # {bar, time, confidence}
    method: str
    warnings: List[str] = field(default_factory=list)


@dataclass
class RepetitionResult:
    """Repeat groups over sections, plus arrangement deltas between them."""

    groups: List[dict]                       # {group_id, confidence, occurrences}
    comparisons: List[dict]                  # {group_id, occurrence, ...deltas}
    section_stats: Dict[str, dict]           # section_id -> normalised metrics
    method: str
    threshold: float
    warnings: List[str] = field(default_factory=list)


@dataclass
class PhraseResult:
    """Bar-aligned phrase segmentation inside every section."""

    phrases: List[dict]                      # {phrase_id, section_id, start_bar, ...}
    method: str
    warnings: List[str] = field(default_factory=list)

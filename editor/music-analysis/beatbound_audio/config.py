"""Fixed analysis parameters.

Every value here participates in the cache key through
``version.SETTINGS_SIGNATURE``; changing one without bumping that signature
would silently reuse stale cached artifacts.
"""

from __future__ import annotations

# ---- feature analysis grid -------------------------------------------------
SR = 22050          # analysis sample rate for the full mix
HOP = 512           # ~43 fps at 22.05 kHz -- same as the v1 analyzer
N_FFT = 2048

# ---- stem analysis grid ----------------------------------------------------
STEM_SR = 22050     # stems are cached mono at this rate
STEM_HOP = 512

# ---- melody ----------------------------------------------------------------
MELODY_FMIN_HZ = 65.0     # C2
MELODY_FMAX_HZ = 1000.0   # ~B5
MELODY_MIN_NOTE_SEC = 0.058
PHRASE_GAP_SEC = 0.6      # a silence this long ends a melodic phrase
PITCH_FALLBACK_LO = 36    # C2 -- only used when too few notes to scale by data
PITCH_FALLBACK_HI = 84    # C6

# ---- unified window grid (prompt section 13) -------------------------------
WINDOW_SEC = 0.5
WINDOW_HOP_SEC = 0.25

# ---- JSON curve budgets (keep music_analysis_v2.json small) ----------------
ENERGY_POINTS = 800
CHROMA_POINTS = 300
PITCH_POINTS = 800
STEM_ACTIVITY_POINTS = 600
ENVELOPE_POINTS = 1600

# ---- structure (prompt section 11) -----------------------------------------
MIN_SECTION_BARS = 8
MIN_SECTION_SEC = 8.0
NOVELTY_KERNEL = 32       # checkerboard kernel size, in beat-sync frames
NOVELTY_PEAK_STD = 0.55

# ---- repetition (V2.1) ------------------------------------------------------
# Thresholds are deliberately conservative: a false "same theme" claim is far
# more damaging to the future pattern-evolution director than a missed repeat.
REPEAT_SIM_THRESHOLD = 0.86   # weighted cosine to call two sections the same theme
REPEAT_HARMONIC_MIN = 0.80    # chroma sub-similarity floor for a same-theme claim
REPEAT_LENGTH_RATIO_MIN = 0.5 # shorter/longer bar-count ratio floor
REPEAT_MIN_SECTIONS = 2       # fewer sections than this -> no grouping attempted

# ---- phrasing (V2.1) --------------------------------------------------------
PHRASE_LENGTHS = (4, 8, 16)   # preferred phrase lengths, in bars (strong prior)
PHRASE_NEAR_LENGTH_PENALTY = 0.15   # cost for lengths 2/3/5/6/7/12 bars
PHRASE_FAR_LENGTH_PENALTY = 0.35    # cost for any other length
PHRASE_MIN_BARS = 2                 # a phrase is at least this many bars
PHRASE_CUT_OFFSET = 0.45            # a boundary must score above this to pay for itself

# ---- downbeat / bar phase (V2.1) ---------------------------------------------
DOWNBEAT_MIN_BEATS = 32      # beats needed before a phase estimate is attempted

# ---- director context (V2.1) --------------------------------------------------
DIRECTOR_STRONG_BEAT_SPACING_BARS = 1   # min spacing between kept strong_beat events
DIRECTOR_STRONG_ONSET_SPACING_BEATS = 2 # min spacing between kept strong_onset events
DIRECTOR_EVENT_BUDGET = 250             # hard ceiling for important_events

# ---- director context V2 (generation-facing) ---------------------------------
DIRECTOR_V2_ANCHOR_BUDGET = 200         # hard ceiling for anchors
DIRECTOR_V2_ANCHOR_MERGE_BEATS = 0.25   # same-type anchors closer than this merge

# ---- events (prompt section 12) --------------------------------------------
MAX_EVENTS = 4000
STRONG_ONSET_MIN = 0.55
STRONG_BEAT_MIN = 0.6
ENERGY_RISE_MIN = 0.18
ENERGY_PEAK_MIN = 0.75
MELODY_JUMP_MIN_SEMITONES = 7
VOCAL_ACTIVE_MIN = 0.12   # activity floor for a vocal phrase
ACTIVITY_ENTRY_MIN = 0.25 # activity jump that counts as an entry

# ---- silence ---------------------------------------------------------------
SILENCE_PEAK = 1e-4

# BeatBound — Gameplay Capability Catalog (Consolidated)

- **Schema**: `beatbound_gameplay_capabilities_v1`
- **Generated**: 2026-09-21
- **Purpose**: Single normalized catalog for the Gameplay Director LLM: mode selection, primitive vocabulary, parameter truth, and safe generation bounds across ARENA / RUNNER / VERTICAL / RADIAL plus mode transitions. Consolidation only - no gameplay fact was corrected, invented, or flattened.

This document is the human-readable companion of `BEATBOUND_GAMEPLAY_CAPABILITY_CATALOG.json`. It is a consolidation of five read-only runtime capability audits. No gameplay fact was corrected, invented, or flattened; where source catalogs disagree, values are kept per-mode and recorded as integration warnings.

## 1. Source catalogs (5/5 loaded)

| Mode area | Source catalog | Audit date | Companion audit report | sha256 (16) |
|---|---|---|---|---|
| ARENA | `ARENA_PATTERN_CATALOG.json` | 2026-09-20 | `ARENA_PATTERN_CAPABILITY_AUDIT.md` | `2c4d326bbe26179c` |
| RUNNER | `RUNNER_CAPABILITY_CATALOG.json` | 2026-09-20 | `RUNNER_CAPABILITY_AUDIT.md` | `b533997581c4f297` |
| VERTICAL | `VERTICAL_CAPABILITY_CATALOG.json` | 2026-09-20 | `VERTICAL_CAPABILITY_AUDIT.md` | `b4a6edf514a1b05a` |
| RADIAL | `RADIAL_CAPABILITY_CATALOG.json` | 2026-09-20 | `RADIAL_CAPABILITY_AUDIT.md` | `343f81667ea38b74` |
| TRANSITION | `TRANSITION_CAPABILITY_CATALOG.json` | 2026-09-20 | `TRANSITION_CAPABILITY_AUDIT.md` | `43ac03673019c834` |

### Counts

- Modes covered: **4** (+ mode transitions)
- Runtime primitives total: **35** (ARENA 11 / RUNNER 17 / VERTICAL 4 / RADIAL 3)
- Library patterns total: **71** (ARENA 26 / RUNNER 25 / VERTICAL 9 / RADIAL 11)
- Integration warnings: **14**

### Consolidation constraints honored

- no gameplay code modified
- no source catalog modified
- no git operations performed
- mode-specific parameters never flattened into unified fields
- conflicts kept per-mode and recorded in integration_warnings
- UNKNOWN left as UNKNOWN

## 2. Director view (quick mode selection)

### 2.1 Mode selection affinity

#### ARENA

**Best for**
- layered spatial pressure from telegraphed hazards (rings, fans, spirals, sweeps)
- continuous melody-accented movement: player motion in real seconds, hazards on beat
- dodge/graze mastery and perfect-dodge chains (0.5 beat cooldown)

**Avoid when**
- you need jump/platform/gravity verbs (not supported in ARENA)
- you need per-note rhythm tap windows (ARENA judges collision/graze, not timing offsets)
- you rely on cross-mechanic coordination or concurrency caps (none enforced)

**Timing resolution**: fractional beats + offsetBeats for events; telegraph floor 0.6 beat / 0.9 s comfort reaction

**Safety summary**: per-mechanic floors enforced in code (reaction 0.6 s, gap >= 0.06 field units, gap shift <= 0.85x player speed); no cross-mechanic coordination or concurrent cap - off-runtime tools: fairness-check, camp-audit, level-report

#### RUNNER

**Best for**
- Geometry-Dash-style manual jump/slide/gravity-flip timing over authored terrain
- phrase archetypes (staircases, gap chains, sky steps, flip set pieces) synced to strong beats and 8th-note streams
- speed-feel sections whose arcs stay tempo-invariant in beats

**Avoid when**
- gaps > 0.2106 u (R02 clamp 0.22 overshoots - cap 0.21)
- gravity flips closer than 2 beats (no runtime clamp)
- difficulty-driven scaling (section difficulty is METADATA ONLY for RUNNER)

**Timing resolution**: fractional beats for events; jump envelope in beats (full jump 0.95 air-beats); reaction window 3 beats = 180/BPM s (1.2 s @150)

**Safety summary**: physics-derived bounds (max gap 0.2106 u single / 0.2445 double / 0.2971 pad 1.35; step <= 0.27 u; landing >= 0.104 u); runner-check 25/25 patterns + 15/15 courses clearable off-runtime

#### VERTICAL

**Best for**
- note-chart rhythm on 6 fixed lanes: tap streams, alternating lanes, chords, holds
- melody-contour-to-lane mapping with 4-tier judgement (0.09/0.16/0.25 beats)
- call-and-response and trill shapes at 1-beat lane intervals

**Avoid when**
- drift/path holds (V04 drift subsystem is dead code; path data collapses to first lane)
- same-lane intervals < 1 beat (double-hit risk below 0.5)
- score-driven design (no point score exists)

**Timing resolution**: arbitrary fractional beats + offsetBeats/stepBeats; fixed windows 0.09/0.16/0.25 beats; approach fixed 2 beats

**Safety summary**: no runtime chart-feasibility guarantee; runtime chord clamp 6 (recommended 2); hold >= 0.5 beat; lapse tolerance 0.12 beat (regrab allowed)

#### RADIAL

**Best for**
- 8-direction directional hit patterns (kick/snare direction calls)
- rising/falling melody contours as clockwise/counter rings
- short chords <= 4 scoreable targets with independent per-direction judgement

**Avoid when**
- hold notes (unsupported: no mechanic emits holdBeats > 0)
- same-beat adjacent cardinal pairs (alias into diagonals, unplayable)
- same-direction intervals < 0.5 beat (window overlap double-scores)

**Timing resolution**: arbitrary fractional beats + offsetBeats/stepBeats; fixed 2-beat approach; windows 0.09/0.16/0.25 beats

**Safety summary**: no runtime guards (no overlap/duplicate/min-spacing checks); recommended same-direction interval 0.5 beat, chords <= 2; one D02 event dedupes to <= 8 directions

### 2.2 Primary gameplay vocabulary

- **ARENA** — primitives: A01 Floor Warning; A02 Safe Tile; A03 Projectile (edge emitter); A04 Radial Burst (rotating spray); A05 Chain (whip); A06 Laser; A07 Rotating Fan; A08 Spiral (centre emitter); A09 Wave Sweep (rhythmic window wall); A10 Ring (gap ring); A11 Sector Sweep · library: 26 AP patterns (AP01-AP26) · verbs: dodge, telegraph, graze, perfect-dodge, safe tile, chain, ring gap, fan, spiral, wave sweep, radial burst, projectile, floor warning
- **RUNNER** — primitives: R01 Spike; R02 Gap; R03 Low Wall; R04 Platform; R08 Bounce Pad; R09 Gravity Flip; COURSE_SLAB Course slab (platform / walkway / roof); COURSE_GAP Course gap (hole); COURSE_PAD Course bounce pad; COURSE_AIRJUMP Course air-jump ring; COURSE_SPIKE Course spike hazard; COURSE_WALL Course beam (slide wall); COURSE_FLIP Course gravity flip gate; ACTION_JUMP Player jump (single, variable height, buffered, coyote); ACTION_AIR_JUMP Player double jump (mid-air second press); ACTION_SLIDE Player slide; ACTION_MANUAL_FLIP Player manual gravity flip · library: 25 RP patterns (RP01-RP25) + 15 course levels · verbs: GROUND_RUN, SHORT_JUMP, MEDIUM_JUMP, LONG_JUMP, HIGH_JUMP, QUICK_HOP, DOUBLE_HOP, TRIPLE_HOP, LAND_AND_IMMEDIATE_REJUMP, GAP_JUMP, LONG_GAP, DROP, DROP_AND_JUMP, STAIRCASE_UP, STAIRCASE_DOWN, PLATFORM_ASCENT, PLATFORM_DESCENT, HIGH_LOW_ALTERNATION, PLATFORM_HOP_CHAIN, RHYTHMIC_BOUNCE, SYNCOPATED_HOPS, AIRBORNE_ACCENT, CEILING_RUN, CEILING_HOP, INVERTED_PLATFORM_CHAIN, GRAVITY_FLIP_UP, GRAVITY_FLIP_DOWN, GRAVITY_ZIGZAG, TOP_BOTTOM_CORRIDOR, TIGHT_VERTICAL_WINDOW, DOUBLE_JUMP_MOUNT, SKY_STEPS, RELEASE_RUN · phrase archetypes: GROOVE, ASCENT, DESCENT, BOUNCE, WAVE, CLIMB_AND_DROP, GAP_RUN, FLIP, INVERTED_GROOVE, CORRIDOR, BURST, RELEASE
- **VERTICAL** — primitives: V01 Tap; V02 Hold; V03 Double; V04 Drift Hold · library: 9 VP patterns (VP01-VP09) · verbs: tap_streams, alternating_lanes, chords, holds, drifts, call_response, trills, staircases, sub_beat_streams, lanes_5_6_used_in_library · verdicts: PERFECT/NICE/GOOD/MISS
- **RADIAL** — primitives: D01 Single; D02 Opposite Double (legacy name: accepts ANY direction chord); D06 Clockwise (legacy name: sequence is fully data-driven, any order) · library: 11 DP patterns (DP01-DP11) · verbs: direction tap, diagonal chord, clockwise ring, counter ring, direction call

### 2.3 Safe generation summary

**ARENA**

- **reaction_floor_seconds**: 0.6
- **comfort_reaction_seconds**: 0.9
- **min_telegraph_beats**: 0.6
- **min_gap_width_field_units**: 0.06
- **max_gap_shift_per_beat**: 0.85x player per-beat distance
- **not_enforced**: cross-mechanic coordination, concurrency cap

**RUNNER**

- **min_reaction_seconds**: 1.2
- **max_jumpable_gap_units**: 0.2106
- **max_jumpable_gap_double_jump_units**: 0.2445
- **max_jumpable_gap_pad_1_35_units**: 0.2971
- **max_step_up_units**: 0.27
- **max_step_down_units**: 0.27
- **min_obstacle_spacing_beats**: 1
- **gravity_flip_min_spacing_beats**: 2
- **min_landing_width_units**: 0.104
- **authored_gap_hard_cap_units**: 0.21

**VERTICAL**

- **lanes**: 6
- **min_same_lane_interval_beats**: 0.5
- **recommended_same_lane_interval_beats**: 1
- **max_runtime_chord_size**: 6
- **recommended_max_chord_size**: 2
- **min_hold_duration_beats**: 0.5
- **approach_time_beats**: 2

**RADIAL**

- **directions**: 8
- **recommended_same_direction_interval_beats**: 0.5
- **max_scoreable_targets_single_instant**: 4
- **recommended_max_chord_size**: 2
- **approach_time_beats**: 2
- **hold_capable**: false

**TRANSITIONS**

- **minimum_breathing_beats**: 6
- **clear_previous_hazards**: true
- **clear_point**: mode switch beat (not breather start)
- **allow_active_hold_crossing**: false
- **pending_queue_cap_per_mode**: 64
- **note**: same-mode boundaries get NO breather

## 3. Global contract

### 3.1 Timing & coordinate systems

**Shared**

- **tempo**: ConstantTempoMap compiled by src/core/LevelLoader.ts; one absolute beat clock shared by all modes
- **event_position**: at: { bar (1-based), beat (1-based, fractional allowed), offsetBeats }
- **activation_beat_formula**: (placement.startBar - 1 + at.bar - 1) * beatsPerBar + (at.beat - 1) + at.offsetBeats
- **telegraph_or_approach_domain**: beats; spawn happens at activation - spawnLeadBeats (PatternScheduler)
- **transitions**: music and beat clock never stop or reset on mode switch (transitions catalog beat_clock)

| Mode | Space | Motion time domain |
|---|---|---|
| ARENA | normalized unit square x/y in 0..1, origin top-left, y down; angles degrees in JSON / radians internal, 0 = +x east | player movement in REAL seconds (BPM-independent feel); mechanic timing in beats |
| RUNNER | world units, x scroll, y down; feet y clamp [-1.4, 2.4] | scroll 0.26 units/beat; ballistic integration in seconds (dt<=0.05s); jump arcs tempo-invariant when expressed in beats |
| VERTICAL | 3D highway; lanes 1..6 map to x; notes travel along z | z is a pure beat function: 0.9 world-units/beat, approach 2 beats; judgement windows in beats |
| RADIAL | polar: centre, judgement ring radius, spawn/cull radii; 8 compass directions (N NE E SE S SW W NW) | straight inward travel, fixed 2-beat approach (D06 first note effectively 1 beat); windows in beats |

Cross-refs: `modes.ARENA.catalog.meta.field_space`, `modes.RUNNER.catalog.player_physics`, `modes.VERTICAL.catalog.physics`, `modes.RADIAL.catalog.geometry`, `transitions.catalog.beat_clock`

### 3.2 Difficulty model

Shared input: `section.difficulty 1..5` → tier mapping: 1=EASY, 2=MEDIUM, 3=HARD, 4=INTENSE, 5=INTENSE, unset=MEDIUM (implemented in `src/core/LevelLoader.ts tier resolution`).

| Mode | Runtime effect of section difficulty |
|---|---|
| ARENA | REAL: telegraph tiers + intensity scaling per mechanic (see modes.ARENA.catalog.arena.timing) |
| RUNNER | METADATA ONLY for RUNNER mechanics (tier handed to mechanics but unread); course difficulty effect described in transitions catalog difficulty_continuity |
| VERTICAL | spawn lead only via tier.telegraphScale; no effect on windows/speed/density/health |
| RADIAL | metadata-only for gameplay; ambient section energy + section lead-in cap only |

⚠ same authoring field, different per-mode semantics - do not assume uniform scaling (integration_warnings W04)

### 3.3 Intensity model

- **ARENA**: per-mechanic intensity scaling incl. effective travel scale; see arena.timing.intensity_per_mechanic
- **RUNNER**: placement_intensity 0..1 (default 0.5) drives R01 height / R02 width / R03 clearance / R08 strength lerps; phrase_intensity > 0.55 adds hazards, composer caps DESCENT/RELEASE loudness at 0.4
- **VERTICAL**: spawn lead only: clamp(lerp(base, base*0.65, intensity), max(0.6, minReactionBeats), base)
- **RADIAL**: metadata-only for gameplay (telegraph result ignored; raw library telegraph used)

⚠ integration_warnings W05

### 3.4 Health / score / combo

- **Health pool**: single shared pool across modes, max 100 (TUNING.health)
- **Continuity**: health persists across mode switches (transitions state_handoff.health); death at 0 -> outcome FAILED
- **Per-mode damage**:

| Mode | Damage model |
|---|---|
| ARENA | {"MISS":8,"COLLISION":10,"PROJECTILE":12,"OBSTACLE":15,"invulnerable_seconds_after_hit":0.8} |
| RUNNER | see modes.RUNNER.catalog.player.damage + safety.damage (contact / fall-out model; head bonk 0) |
| VERTICAL | {"miss_damage":8,"bypasses_invulnerability":true} |
| RADIAL | {"miss_damage":8,"bypasses_invulnerability":true} |

- **Score**: no point score system in any mode catalog; accuracy = notesHit/(notesHit+notesMissed) where applicable
- **Combo**: {"hit":"+1","miss":"reset to 0","milestone_every":10,"across_mode_switch":"reset by incoming mode activate; preserved on same-mode boundaries"}
- ⚠ damage semantics differ per mode while the pool is shared (integration_warnings W03)

### 3.5 Mode switching

- **pipeline**: mode-agnostic ModeManager.setMode (no mode-id branches in the transition path); 16/16 mode pairs supported
- **breather_formula**: max(6 beats, round(bpm/20)) beats back from the outgoing section end beat; same-mode boundaries get none
- **what_resets**: combo, position/velocity, RUNNER gravity, all active mechanics (on incoming activate); held long-notes cut without penalty
- **what_persists**: health, score/notes counters, invulnerability frames, held keys (global input state)
- **beat_clock**: music never stops; absolute beat continuous; switch point = bar line - leadIn (<= 1 bar; max(4, beatsPerBar) for courses)
- **bounds_ref**: transitions.normalized.safe_transition_bounds

## 4. Modes (normalized summary + verbatim catalog reference)

Each mode block below is a normalized digest. The **full verbatim source catalog** is embedded in the JSON under `modes.<MODE>.catalog` — every parameter, unit, default, clamp, minimal JSON example, and audit detail lives there and remains authoritative.

### 4.1 ARENA — ARENA

Provenance: `ARENA_PATTERN_CATALOG.json` (2026-09-20, READ-ONLY runtime capability audit) → digest below; verbatim catalog in JSON.

- **Movement model**: free 2D movement on a normalized unit square; continuous axis input; no jumping
- **Input model**: continuous analog-style digital input — WASD or arrow keys, per-axis -1/0/+1, diagonal normalized, no dash
- **Primitives (11)**: A01, A02, A03, A04, A05, A06, A07, A08, A09, A10, A11
- **Pattern library (26)**: AP01, AP02, AP03, AP04, AP05, AP06, AP07, AP08, AP09, AP10, AP11, AP12, AP13, AP14, AP15, AP16, AP17, AP18, AP19, AP20, AP21, AP22, AP23, AP24, AP25, AP26
- **Judgement model**: collision/graze based (no rhythm tap windows)

Primitive details:

| ID | Name | Category | Damage source |
|---|---|---|---|
| A01 | Floor Warning | floor/zone | COLLISION |
| A02 | Safe Tile | floor/safe-zone | COLLISION |
| A03 | Projectile (edge emitter) | projectile/edge | PROJECTILE |
| A04 | Radial Burst (rotating spray) | projectile/centre | PROJECTILE |
| A05 | Chain (whip) | chain/line | COLLISION |
| A06 | Laser | static band | COLLISION |
| A07 | Rotating Fan | radial/continuous | COLLISION |
| A08 | Spiral (centre emitter) | projectile/centre | PROJECTILE |
| A09 | Wave Sweep (rhythmic window wall) | moving wall | COLLISION |
| A10 | Ring (gap ring) | radial/heavy | COLLISION |
| A11 | Sector Sweep | radial/sequential | COLLISION |

Pattern library:

| ID | Name | Bars | Difficulty | Mechanics / notes |
|---|---|---|---|---|
| AP01 | Checkerboard | 2 | 1 | A01 · TEACH |
| AP02 | Side Volley | 2 | 2 | A03 · PRACTICE |
| AP03 | Four Direction Chain | 1 | 2 | A05 · PRACTICE |
| AP04 | Diagonal Whip | 2 | 2 | A05 · PRACTICE |
| AP05 | Safe Ground | 2 | 1 | A02 · TEACH |
| AP06 | Chain Corridor | 4 | 3 | A05 · PRACTICE |
| AP07 | Serpent Chain | 2 | 3 | A05 · VARIATION |
| AP08 | Spiral Out | 2 | 3 | A08 · VARIATION |
| AP09 | Rhythm Window | 2 | 3 | A09 · COMBINE |
| AP10 | Spray And Pendulum | 2 | 3 | A04, A07 · COMBINE |
| AP11 | Spray Rotation | 4 | 2 | A04 · PRACTICE |
| AP12 | Alternating Spray | 4 | 3 | A04, A07 · VARIATION |
| AP13 | Ring Collapse | 4 | 4 | A10 · CLIMAX |
| AP14 | Spray Double Time | 4 | 4 | A04 · VARIATION |
| AP15 | Safe Tile Sweep | 4 | 3 | A02, A09 · COMBINE |
| AP16 | Fan And Spray | 4 | 4 | A07, A04 · COMBINE |
| AP17 | Pendulum Fan | 4 | 3 | A07 · PRACTICE |
| AP18 | Spiral Inward | 2 | 3 | A08 · VARIATION |
| AP19 | Shrinking Window | 4 | 3 | A09 · PRACTICE |
| AP20 | Laser And Ring Climax | 4 | 5 | A04, A06, A10, A07 · CLIMAX |
| AP21 | Sector Chase | 4 | 3 | A11, A03 · COMBINE |
| AP22 | Sector And Spray | 4 | 4 | A11, A04, A10 · CLIMAX |
| AP23 | Shifting Ground | 4 | 3 | A02 · VARIATION |
| AP24 | Quadrant Rotation | 4 | 4 | A02 · COMBINE |
| AP25 | Chain Formation | 4 | 3 | A05 · VARIATION |
| AP26 | Floor Stripes | 4 | 2 | A01 · TEACH |

- **Health**: {"max":100,"shared_across_modes":true,"damage":{"MISS":8,"COLLISION":10,"PROJECTILE":12,"OBSTACLE":15},"invulnerable_seconds_after_hit":0.8}
- **Score**: no point score found in catalog (progression via shared health; combo state managed globally)

**Safe generation bounds**:

- **reaction_floor_seconds**: 0.6
- **comfort_reaction_seconds**: 0.9
- **min_telegraph_beats**: 0.6
- **min_gap_width_field_units**: 0.06
- **min_angular_gap**: 2*asin(0.06/(2r)); ~10.9 deg at r=0.32, ~24.7 deg at r=0.14 (A10 judgement radius)
- **max_gap_shift_per_beat**: 0.85 x player per-beat distance (0.257 at 123.05 BPM)

**Safety enforcement**:

- Enforced in mechanics: A01: telegraph derived from measured escape walk (cap 4 beats) | A05: ensureWarningFloor on whip travel (comfort 0.9s) | A10: gap arc >= 24.7 deg at r=0.14; ring-to-ring gap-edge step <= player walk; warning floor stretches duration | A11: stepBeats >= escape walk / speed budget AND ensureWarningFloor | A02 MOVING: patch speed <= player; QUADRANT: quadrantBeats >= crossing walk, telegraph >= full-field walk | A04: step clamped to burstArc + min angular gap and to speed budget | A08 PULSE: arm count capped by min angular gap at r=0.32 | A09: gapWidth >= 0.06 (SHRINK >= 0.06/shrinkTo); gapPath steps clamped to speed budget
- Not enforced: NO cross-mechanic coordination (e.g. safe tile vs ring gap alignment) | NO runtime cap on concurrent mechanics | constraints.maxSimultaneousThreats and requiresMechanics are metadata only (never read at runtime) | tier.densityScale has no consumer | no global difficulty multiplier exists
- Off-runtime tools: tools/fairness-check.ts, tools/camp-audit.ts, tools/level-report.ts

**Dead / unreachable / aliases**:

- **noop_aliases**: ["A10 variant FOLLOW_GAP behaves identically to BASIC_GAP (RingMechanic.ts buildRings switch)"]
- **phantom_references**: ["A14","A15 (referenced in mechanics.mvp.json compatibility metadata only, do not exist)"]
- **dead_implementations**: 0

**Metadata-only fields**: constraints.maxSimultaneousThreats and requiresMechanics are metadata only (never read at runtime)

### 4.2 RUNNER — RUNNER

Provenance: `RUNNER_CAPABILITY_CATALOG.json` (2026-09-20, READ-ONLY RUNTIME AUDIT) → digest below; verbatim catalog in JSON.

- **Movement model**: auto-runner: world scrolls left, player x fixed; manual jump/slide/gravity-flip timing
- **Input model**: discrete timed actions
- **Primitives (17)**: R01, R02, R03, R04, R08, R09, COURSE_SLAB, COURSE_GAP, COURSE_PAD, COURSE_AIRJUMP, COURSE_SPIKE, COURSE_WALL, COURSE_FLIP, ACTION_JUMP, ACTION_AIR_JUMP, ACTION_SLIDE, ACTION_MANUAL_FLIP
- **Pattern library (25)**: RP01, RP02, RP03, RP04, RP05, RP06, RP07, RP08, RP09, RP10, RP11, RP12, RP13, RP14, RP15, RP16, RP17, RP18, RP19, RP20, RP21, RP22, RP23, RP24, RP25
- **Motion verbs**: 33 · **Phrase archetypes**: 12
- **Judgement model**: physics contact (no rhythm tap windows)

Primitive details:

| ID | Name | Category |
|---|---|---|
| R01 | Spike | hazard |
| R02 | Gap | terrain/hazard |
| R03 | Low Wall | hazard |
| R04 | Platform | terrain |
| R08 | Bounce Pad | terrain/helper |
| R09 | Gravity Flip | modifier |
| COURSE_SLAB | Course slab (platform / walkway / roof) | terrain |
| COURSE_GAP | Course gap (hole) | terrain/hazard |
| COURSE_PAD | Course bounce pad | helper |
| COURSE_AIRJUMP | Course air-jump ring | helper |
| COURSE_SPIKE | Course spike hazard | hazard |
| COURSE_WALL | Course beam (slide wall) | hazard |
| COURSE_FLIP | Course gravity flip gate | modifier |
| ACTION_JUMP | Player jump (single, variable height, buffered, coyote) | action |
| ACTION_AIR_JUMP | Player double jump (mid-air second press) | action |
| ACTION_SLIDE | Player slide | posture |
| ACTION_MANUAL_FLIP | Player manual gravity flip | action |

Pattern library:

| ID | Name | Bars | Difficulty | Mechanics / notes |
|---|---|---|---|---|
| RP01 | Basic Jump | 1 | 1 | R01 · TEACH |
| RP02 | Double Jump | 1 | 2 | R01 · PRACTICE |
| RP03 | Jump Slide | 1 | 2 | R01, R03 · PRACTICE |
| RP04 | Triple Chain | 1 | 3 | R01 · PRACTICE |
| RP05 | Jump Bounce Jump | 2 | 3 | R01, R08 · VARIATION |
| RP06 | Short Gap Chain | 2 | 3 | R02, R01, R03 · VARIATION |
| RP07 | Bounce Chain | 2 | 3 | R08, R01 · VARIATION |
| RP08 | Half Beat Jumps | 1 | 4 | R01 · VARIATION |
| RP09 | Rapid Stair | 2 | 4 | R01, R03 · VARIATION |
| RP10 | Gravity Entry | 2 | 3 | R09, R01 · TRANSITION |
| RP11 | Gravity Alternation | 4 | 5 | R09, R01 · CLIMAX |
| RP12 | Runner Climax | 2 | 5 | R01, R08, R03 · CLIMAX |
| RP13 | Ceiling Chain | 4 | 4 | R09, R01, R03 · VARIATION |
| RP14 | Mixed Chain | 4 | 4 | R01, R08, R03, R02 · COMBINE |
| RP15 | Recovery | 4 | 1 | R01 · RECOVERY |
| RP16 | Platform Step | 2 | 1 | R04 · TEACH |
| RP17 | Platform Hop | 2 | 2 | R04 · PRACTICE |
| RP18 | Staircase Up | 2 | 2 | R04 · VARIATION |
| RP19 | Platform Ladder | 2 | 3 | R04, R01 · COMBINE |
| RP20 | Gap Bridge | 2 | 2 | R02, R04 · PRACTICE |
| RP21 | Platform Leap | 2 | 3 | R02, R04, R01 · COMBINE |
| RP22 | Gravity Shelf | 2 | 3 | R09, R04 · TRANSITION |
| RP23 | Gravity Corridor | 4 | 4 | R09, R04, R01 · COMBINE |
| RP24 | Platform Climax | 4 | 4 | R02, R04, R01, R09, R03 · CLIMAX |
| RP25 | Platform Recovery | 2 | 1 | R04 · RECOVERY |

- **Health**: {"details_ref":"catalog.player.damage + catalog.safety.damage"}
- **Score**: see catalog.player.damage / safety (survival-oriented; no rhythm score)

**Player physics (from code)**:

- **note**: all values computed from src/mechanics/runner/runnerPhysics.ts and src/tuning.ts TUNING.runner
- **horizontal**: {"movement":"world scroll only","units_per_beat":0.26,"units_per_second_formula":"0.26 * BPM / 60"}
- **vertical**: {"model":"ballistic integration, dt clamped <= 0.05s","gravity_units_per_s2_at_120bpm":11.35,"jump_velocity_units_per_s_at_120bpm":2.69,"velocity_positive":"down the screen (world …
- **forgiveness**: {"input_buffer_seconds":0.12,"coyote_seconds":0.09,"step_up_units":0.045,"head_bonk_damage":0}
- **world_bounds**: {"feet_y_clamp":[-1.4,2.4],"fall_out_floor":1.02,"fall_out_ceiling":-0.02}

**Jump envelope (key numbers)**:

- Full jump: apex 0.32 u · air 0.95 beats · distance 0.247 u · max safe gap 0.2106 u (zero-margin 0.247 u)
- Double jump max gap: 0.2445 u · pad 1.35: 0.2971 u
- Inverted gravity symmetry: EXACT — physics is gravity-relative; envelope identical on ceiling. Placement caps (MAX_LEVEL 0.27) are the only asymmetry.
- Speed sensitivity: arc shape is tempo-invariant in beats; only seconds scale with BPM. There are no speed changes to break spacing.

**Reaction window**:

- **beats_from_field_edge**: 3
- **beats_from_render_cull_1_08**: 3.31
- **seconds_by_bpm**: {"90":2,"100":1.8,"110":1.64,"120":1.5,"150":1.2}
- **formula**: (1.0 - 0.22) / 0.26 beats = 3 beats; seconds = 180 / BPM
- **r09_extra**: 1-beat telegraph charge + ACTIVE countdown display
- **course_flip_gate_charge_beats**: 3

**Music affinity** (id lists per category):

- **strong_beat**: ["R01","R02","R08","R09","GROUND_RUN","MEDIUM_JUMP"]
- **quarter_note_pulse**: ["R04 step chains","QUICK_HOP","DOUBLE_HOP","SHORT_JUMP"]
- **eighth_note_sequence**: ["TRIPLE_HOP","SYNCOPATED_HOPS","half-beat spike groups (RP08/RP12)"]
- **melody_contour**: ["STAIRCASE_UP","STAIRCASE_DOWN","PLATFORM_ASCENT","PLATFORM_DESCENT","HIGH_LOW_ALTERNATION","SKY_STEPS"]
- **phrase_boundary**: ["archetype role changes","FLIP (surface inversion)","motif recurrence","phrase tint on the running surface"]
- **build**: ["BURST","CLIMB_AND_DROP","GAP_RUN","RHYTHMIC_BOUNCE","R09 during BUILD"]
- **drop**: ["R09 during DROP/CHORUS","GAP_RUN","WAVE","DROP"]
- **sustained_section**: ["R03 (slide posture)","RELEASE_RUN","GROOVE runs","CORRIDOR"]
- **role_dramaturgy**: ROLE_ARCHETYPES maps INTRO/REPEAT/VARIATION/CLIMAX/RELEASE to archetype pools; composer loudness: CLIMAX x1.25, INTRO x0.7, RELEASE x0.6, …

**Safe generation bounds**:

- **min_reaction_seconds**: 1.2
- **min_reaction_seconds_note**: 3.0 beats from field edge (x=1.0) to player; = 180/BPM seconds: 1.2 s @150 BPM, 1.5 s @120, 2.0 s @90. From the 1.08 render cull: 3.31 beats.
- **max_jumpable_gap_default_speed_units**: 0.2106
- **max_jumpable_gap_with_double_jump_units**: 0.2445
- **max_jumpable_gap_with_pad_1_35_units**: 0.2971
- **max_jumpable_gap_absolute_units**: 0.247
- **max_step_up_units**: 0.27
- **max_step_up_note**: single-jump planner cap MAX_LEVEL 0.27 (physical maxRise 0.3008, apex 0.32); DOUBLE_JUMP_MOUNT block at 0.34; combined double-jump apex 0.45
- **max_step_down_units**: 0.27
- **max_step_down_note**: planner floor MIN_LEVEL 0; any drop is survivable if the target has support; drop time = 0.475*sqrt(depth/0.32) beats
- **min_obstacle_spacing_beats**: 1
- **min_obstacle_spacing_note**: for independent jump demands; 0.5-beat spacing valid only as a one-jump-spanning group (runner-check grouping); take-off comfort floor 0.10 beats
- **gravity_flip_min_spacing_beats**: 2
- **gravity_flip_min_spacing_note**: NO runtime clamp; 2 beats is the observed planner minimum (GRAVITY_ZIGZAG: 4 beats for flip-play-flip); legacy R09 enforces 4+2 beats between portals
- **min_landing_width_units**: 0.104
- **min_landing_width_note**: max(BODY_WIDTH*2, 0.4 beats * 0.26)
- **max_authored_gap_width_units**: 0.22
- **max_authored_gap_width_warning**: R02 clamp ceiling 0.22 EXCEEDS max_jumpable_gap_default_speed 0.2106 — autogenerators must cap authored gaps at 0.21 units (R02 width param <= ~1.5)

**Known risks (12)**:

- R02 gap width param >= ~1.55 (or >= 1.35 at intensity 1.0) produces a clamped 0.22-unit gap that NO jump can clear (max safe 0.2106) — IMPOSSIBLE terrain reachable from JSON
- R02 width ~1.3-1.55 is frame-perfect (take-off slack below the 0.10-beat comfort floor)
- a spike within ~0.21 beats after a planned landing beat has no answer
- bounce pad strength >= 1.35 sends the player past the opposite surface line (apex 0.583 > 0.44 span) — ceiling hazards inside the arc are unavoidable
- pattern-mode R09 flips teleport the player to the base line — a live floor gap at the flip beat is a fall; courses auto-plate but pattern mode does not
- overlapping R09 zones: last active gravity mechanic wins; flip order can contradict the visuals
- maxSimultaneousThreats is unenforced — hazard stacking on one beat is accepted
- no runtime feasibility guard in RunnerMode; the guarantee lives in loader validation + npm run runner-check
- HazardDemand kind 'SAW' is declared but never emitted (dead enum member)
- CourseWorld.activeSurface() and RunnerMode.RUNNER_UNITS_PER_BEAT are dead (no consumers)
- TUNING.runner.gravityTelegraphBeats has zero consumers (dead tuning knob)
- mechanic ids R05/R06/R07 are absent (numbering gap, not dead code)

### 4.3 VERTICAL — VERTICAL

Provenance: `VERTICAL_CAPABILITY_CATALOG.json` (2026-09-20, READ-ONLY RUNTIME AUDIT) → digest below; verbatim catalog in JSON.

- **Movement model**: 3D highway note chart; notes approach along z as a pure beat function; player does not move, lanes are hit
- **Input model**: 6-lane discrete taps + holds — {"1":["a"],"2":["s"],"3":["d"],"4":["j"],"5":["k"],"6":["l"]}
- **Key remap**: not supported
- **Primitives (4)**: V01, V02, V03, V04
  - note: V04 drift hold is degraded at runtime to a straight hold (drift path subsystem unreachable)
- **Explicitly NOT supported**: flick, slide (non-hold), drag, cross-lane tap, per-lane multiple judgement lines, touch/mouse input, arbitrary key remap
- **Pattern library (9)**: VP01, VP02, VP03, VP04, VP05, VP06, VP07, VP08, VP09
- **Judgement model**: rhythm tap windows (4-tier)

Primitive details:

| ID | Name | Category |
|---|---|---|
| V01 | Tap | tap |
| V02 | Hold | hold |
| V03 | Double | chord_tap |
| V04 | Drift Hold | hold |

Pattern library:

| ID | Name | Bars | Difficulty | Mechanics / notes |
|---|---|---|---|---|
| VP01 | Stair Up | 1 | 1 | V01 · TEACH · 1->2->3->4, one per beat |
| VP02 | Sustain | 2 | 2 | V02 · TEACH · lane 2 and 3, holdBeats 3 |
| VP03 | Alternating | 1 | 2 | V01 · PRACTICE · lane 1<->4 alternating per beat |
| VP04 | Double Beat | 1 | 3 | V03 · COMBINE · chords [1,4] and [2,3], every 2 beats |
| VP05 | Taps Into Hold | 2 | 3 | V01, V02 · COMBINE · taps 1->2->3 then hold lane 4 (4 beats) |
| VP06 | Drift Up | 2 | 3 | V04 · TEACH · authored path 1->4 over 6 beats; RUNTIME: straight hold lane 1 |
| VP07 | Drift Zigzag | 2 | 4 | V04 · PRACTICE · authored zigzag 4->3->2->3->4; RUNTIME: straight hold lane 4 |
| VP08 | Hold Plus Taps | 2 | 4 | V02, V01 · COMBINE · hold lane 1 (6 beats) while taps on lanes 3/4 |
| VP09 | Vertical Climax | 4 | 5 | V03, V01, V04 · CLIMAX · chords [1,4]/[2,3], 4-tap stair, authored descending drift 4->3->2->1 (RUNTIME: hold lane 4), closing taps lane 4 |

- **Judgement windows (beats)**: {"perfect":0.09,"nice":0.16,"good":0.25}
- **Health**: {"max":100,"miss_damage":8,"bypasses_invulnerability":true,"source":"src/tuning.ts TUNING.health.damage.MISS"}
- **Combo**: {"hit":"+1","miss":"reset to 0","milestone_every":10}
- **Score**: none (no point score; only notesHit/notesMissed, combo/bestCombo, per-verdict counts, ACC %)

**Judgement**:

- **verdicts**: ["PERFECT","NICE","GOOD","MISS"]
- **windows_beats**: {"perfect":0.09,"nice":0.16,"good":0.25}
- **miss_condition**: offset > 0.25 beats (late side only; early side never misses, presses before -0.25 do nothing)
- **unit**: beats (BPM-dependent in seconds; independent of difficulty and intensity)
- **seconds_at_120bpm**: {"perfect":45,"nice":80,"good":125,"unit":"ms"}
- **seconds_at_123.05bpm**: {"perfect":43.9,"nice":78,"good":121.9,"unit":"ms"}
- **early_late_display**: false
- **score_system**: none (no point score; only notesHit/notesMissed, combo/bestCombo, per-verdict counts, ACC %)
- **combo**: {"hit":"+1","miss":"reset to 0","milestone_every":10}
- **health**: {"max":100,"miss_damage":8,"bypasses_invulnerability":true,"source":"src/tuning.ts TUNING.health.damage.MISS"}
- **feedback_sfx**: {"PERFECT":"tap_perfect","NICE":"tap_good","GOOD":"tap_good","MISS":"miss","hold_start":"hold_start","hold_tick":"hold_tick (every 0.5 beat while …

**Pattern shape inventory**: {"tap_streams":true,"alternating_lanes":true,"chords":true,"holds":true,"drifts":false,"call_response":"partial (VP05 taps resolving into a hold)","trills":false,"staircases":true,"sub_beat_streams":false,"lanes_5_6_used_in_library":false}

**Safe generation bounds**:

- **lane_count**: 6
- **min_same_lane_interval_beats**: 0.5
- **min_same_lane_interval_basis**: 2 x goodWindow (0.25); below this one press can double-hit both notes
- **recommended_same_lane_interval_beats**: 1
- **max_runtime_chord_size**: 6
- **recommended_max_chord_size**: 2
- **min_hold_duration_beats**: 0.5
- **min_hold_duration_note**: V04 clamps to >=0.5; V01/V02 accept 0 (tap) or negative (behaves as tap)
- **recommended_hold_duration_beats**: [1,6]
- **min_lane_change_time**: null
- **approach_time_beats**: 2
- **approach_time_seconds_null_note**: BPM-dependent: beats * 60 / bpm
- **judgement_windows_beats**: {"perfect":0.09,"nice":0.16,"good":0.25}
- **hold_lapse_tolerance_beats**: 0.12
- **hold_lapse_tolerance_drift_beats**: 0.18
- **drift_lapse_tolerance_note**: unreachable: applies only to path holds, which no content can produce
- **mode_change_silence_before_boundary**: max(6 beats, 3 seconds converted to beats)
- **unknown_fields_policy**: values above are code-verified; null = not present in runtime

**Dead / unreachable / aliases**:

- **0**: {"kind":"unreachable_engine_system","name":"drift path system (multi-checkpoint path holds)","components":["NoteMode.judgeHold isDrift branch (src/modes/rhythm/NoteMode.ts)","TUNING.vertical.driftToleranceBeats = 0.18 …
- **1**: {"kind":"parsed_but_discarded_param","name":"V04 params.path (library default and VP06/VP07/VP09 event paths)","reason":"readPath parses and sorts but only path[0].lane is consumed; the rest is dropped before target construction"}

**Metadata-only fields**: pattern.difficulty (overall + 5 sub-scores) | pattern.function and section.function | pattern.musicTags and mechanic.musicTags / playerSkills / compatibility | pattern.constraints.maxSimultaneousThreats | pattern.constraints.requiresMechanics | mechanic.status (MVP/OPTIONAL/STRETCH) | mechanic.difficulty | event.role (PLAYER_A/PLAYER_B/BOTH) - no input split | params.cooldownBeats -> recoveryBeats resolved but unconsumed by V mechanics | stale display hints: levels.index.json 'D F J K', editor transition-rules 'D F J K lanes', VP06/VP07 notes describing …

**Known risks (12)**:

- **NOT SUPPORTED** — lane-switching drift (slide/ path hold) unreachable from content: V04 flattens path to head lane; VP06/VP07/VP09 named 'Drift...' play as straight holds — evidence: src/mechanics/vertical/DriftHoldMechanic.ts (RETIRED comment; target.path never set)
- **IMPOSSIBLE** — chord larger than 6 lanes cannot be expressed: lanes clamped 1..6 and deduped, silently collapsing — evidence: src/mechanics/vertical/LaneNoteMechanic.ts readLanes
- **IMPOSSIBLE** — consecutive same-lane notes without key release: wasPressed is an edge; holding through the next head guarantees MISS — evidence: src/core/Input.ts, src/modes/rhythm/NoteMode.ts judge
- **HIGH RISK** — same-lane notes <0.5 beats apart: judgement windows overlap; one press can double-hit both (double score/combo) or a press lands ambiguously — evidence: NoteMode judge per-target, no press consumption
- **HIGH RISK** — events scheduled inside the pre-mode-change breather (max(6 beats, 3s)) are silently never spawned — evidence: src/core/PatternScheduler.ts schedulePlacement breatherFromBeat continue
- **HIGH RISK** — MISS damage 8 bypasses collision invulnerability: 3 misses = 24 HP with no mitigation — evidence: src/tuning.ts, src/core/HealthManager.ts, NoteMode registerMiss
- **HIGH RISK** — hold tail immediately followed by same-lane note (<0.5 beat): requires release+repress within one window; frequently BROKEN/MISS — evidence: input edge + holdToleranceBeats 0.12
- **CONDITIONAL** — V01 with params.holdBeats>0 silently becomes a hold; VP06/VP07 difficulty metadata (inputComplexity 4) no longer matches flattened behavior — evidence: LaneNoteMechanic constructor, patterns.mvp.json
- **CONDITIONAL** — stale key hints in metadata: levels.index.json blurb and editor/rules/transition-rules.json say 'D F J K'; actual keys are A S D J K L — evidence: src/core/controls.ts VERTICAL_LANE_KEYS
- **CONDITIONAL** — vertical_test.level.json references audio/vertical_test_01.mp3 which does not exist; falls back to click track — evidence: beatbound_library_v1/audio contains only editor/ assets; BeatBoundGame.load fallback
- **CONDITIONAL** — intensity is often assumed to add density or shorten reaction time; for VERTICAL it has NO gameplay effect at all (approach constant 2 beats; resolved telegraph is dead data for V mechanics) — evidence: MechanicRegistry.spawnLeadBeats reads the unscaled library telegraph; V01-V04 never read timing.telegraphBeats
- **CONDITIONAL** — window blur releases all keys: an active hold breaks after 0.12 beats of lapse (mitigated by auto-pause on visibilitychange) — evidence: src/core/Input.ts onBlur, NoteMode judgeHold

### 4.4 RADIAL — RADIAL

Provenance: `RADIAL_CAPABILITY_CATALOG.json` (2026-09-20, READ_ONLY_RUNTIME_AUDIT) → digest below; verbatim catalog in JSON.

- **Movement model**: polar note ring: directional targets travel straight inward to a fixed judgement ring; player does not move, directions are hit
- **Input model**: 8-direction discrete taps (diagonals = 2 adjacent cardinals)
- **Primitives (3)**: D01, D02, D06
- **Pattern library (11)**: DP01, DP02, DP03, DP04, DP05, DP06, DP07, DP08, DP09, DP10, DP11
- **Judgement model**: directional rhythm tap windows (4-tier)

Primitive details:

| ID | Name | Category |
|---|---|---|
| D01 | Single | direction_tap |
| D02 | Opposite Double (legacy name: accepts ANY direction chord) | direction_tap_chord |
| D06 | Clockwise (legacy name: sequence is fully data-driven, any order) | direction_tap_sequence |

Pattern library:

| ID | Name | Bars | Difficulty | Mechanics / notes |
|---|---|---|---|---|
| DP01 | Cardinal |  | 1 | D01 · TEACH |
| DP02 | Clockwise |  | 2 | D06 · PRACTICE |
| DP03 | Diagonal Cycle |  | 2 | D01 · TEACH |
| DP04 | Clockwise 8 |  | 3 | D06 · PRACTICE |
| DP05 | Counterclockwise 8 |  | 3 | D06 · PRACTICE |
| DP06 | Cross Double |  | 3 | D02 · CLIMAX |
| DP07 | Cardinal Diagonal Alternation |  | 4 | D01 · VARIATION |
| DP08 | Diagonal Opposite Pairs |  | 4 | D02 · COMBINE |
| DP09 | Spiral 8 |  | 4 | D06 · VARIATION |
| DP10 | Star |  | 4 | D06 · VARIATION |
| DP11 | Radial Climax |  | 5 | D02, D06 · CLIMAX |

- **Judgement windows (beats)**: {"PERFECT":0.09,"NICE":0.16,"GOOD":0.25,"MISS":"> 0.25 late"}
- **Max scoreable targets in one instant**: 4
- **Health**: {"health":-8,"health_source":"TUNING.health.damage.MISS","bypasses_invulnerability":true,"invulnerability_window_seconds":0.8,"combo_reset":true,"counts_notesMissed":true,"max_health":100}
- **Combo**: {"combo":"+1, flourish every 10","health":0,"sfx":["direction_perfect (PERFECT)","direction_hit (NICE/GOOD)","radial_combo (every 10 combo)"]}
- **Score**: none (no point score); accuracy = notesHit/(notesHit+notesMissed); verdictCounts tracked but not rendered by RadialMode

**Geometry & approach**:

- **centre**: {"x":0.5,"y":0.5}
- **judgement_ring_radius**: 0.13
- **spawn_radius**: 0.46
- **visible_cull_radius**: 0.52
- **expire_radius**: 0.012
- **travel**: straight line inward along the direction vector; radius linear in beats: RING + (beatsAway/approachBeats)*(SPAWN-RING)
- **travel_rotation_or_arc**: false
- **travel_easing**: none (linear); easeOutCubic only on the hit ripple
- **approach_beats**: 2
- **approach_fixed**: true
- **approach_speed_field_units_per_beat**: 0.165
- **outward_notes_supported**: false
- **miss_trail**: missed notes keep converging past the ring to expire at radius 0.012 (~0.715 beats after target); mechanic detaches at +0.6 beats which truncates the fade …
- **d06_first_note_note**: D06 spawn lead (library telegraph 1 beat) < approach 2 beats: its first note appears mid-arm at radius ~0.295 instead of at the rim

**NOT supported**: hold_notes (NOT SUPPORTED: both radial mechanics hardcode holdBeats: 0; the shared NoteMode hold …); drift_or_path (NOT SUPPORTED: path/lane checkpoints are VERTICAL-only semantics); outward_or_center_notes (NOT SUPPORTED: travel direction is hardcoded inward); approach_speed_or_window_scaling (NOT SUPPORTED: approachBeats, hit windows and diagonal tolerance are fixed TUNING.radial …); randomization (NOT SUPPORTED: radial mechanics do not consume the deterministic seed); dedicated_double_tap_or_call_response (NOT SUPPORTED as mechanics; expressible only as data arrangements)

**Safe generation bounds**:

- **direction_count**: 8
- **min_same_direction_interval_seconds**: null
- **min_same_direction_interval_note**: no runtime guard; library-densest = 0.5 beats (DP09/DP11); intervals < 0.25 beats overlap judgement windows and double-score from one press
- **min_same_direction_interval_beats_recommended**: 0.5
- **max_runtime_chord_size**: null
- **max_runtime_chord_size_note**: targets per beat uncapped in code; one D02 event dedupes to <= 8 distinct directions; a single instant can score at most 4 targets (the diagonals)
- **max_scoreable_targets_single_instant**: 4
- **recommended_max_chord_size**: 2
- **approach_time**: 2 beats (fixed; TUNING.radial.approachBeats); D06 first note effectively 1 beat
- **min_direction_change_interval**: null
- **min_direction_change_interval_note**: no runtime guard; same-beat adjacent-cardinal pairs are effectively unplayable (diagonal aliasing); diagonal two-key window is 0.09s real time
- **min_direction_change_interval_beats_recommended**: 0.5
- **hold_capable**: false
- **judgement_window_beats**: {"perfect":0.09,"nice":0.16,"good":0.25}
- **authoring_resolution**: arbitrary fractional beat + offsetBeats + fractional stepBeats

**Dead / unreachable / aliases**:

- **implemented_but_unreachable_from_radial_json**: ["hold/drift judging machinery (NoteMode.judgeHold + RadialMode.isHeld): no radial mechanic emits holdBeats > 0 or path (hardcoded 0)"]
- **dead_exports**: ["direction8.rotate() / opposite(): zero src consumers","capabilities.RADIAL_DIRECTIONS const: never imported (the RadialDirection TYPE lives on via NoteTarget)","direction8.CARDINALS / DIAGONALS consts: never imported","AudioFX …
- **parser_accepts_runtime_ignores**: ["section 'scene' / 'scene.effects' present in editor-generated levels: not part of SectionDefinition, ignored by LevelLoader"]
- **metadata_only_fields**: ["ResolvedTiming (telegraph/duration/recovery) computed for D01/D02/D06 but never read by the mechanics","placement intensity (gameplay no-op; ambient energy only)","section difficulty tier (ignored by radial mechanics; ambient + lead-in …
- **doc_drift**: ["levels.index.json blurb for radial_test says 'Four directions' while the runtime supports 8"]

**Known risks (10)**:

- Adjacent cardinals pressed within 0.09s alias to a diagonal: a same-beat adjacent-cardinal chord can never score as two cardinal hits (both eventually MISS, -8 HP each)
- N+E+S+W pressed together reads as the four DIAGONALS only; an 8-target same-beat chord can never be fully cleared (single-instant maximum is 4 scored targets)
- Non-consuming presses: duplicate same-direction notes on one beat all score from one press (no validator forbids this)
- D06 spawn lead (1 beat) is shorter than the approach (2 beats): its first note pops in mid-arm
- MISSED note fade is truncated when the mechanic detaches (activation+0.6) before the expiry radius is reached (~+0.715 beats) - cosmetic
- difficulty/intensity and pattern constraints (maxSimultaneousThreats, requiresMechanics, minReactionBeats) have no gameplay effect in RADIAL
- No holds despite shared NoteMode support; hold tolerances live under TUNING.vertical
- diagonalToleranceSeconds (0.09s) is real time, independent of BPM, so diagonal difficulty varies with tempo
- No runtime feasibility/overlap guard: chart safety is entirely the author's responsibility
- Invalid direction strings never error at load; they silently become 'N' (D01/D02) or the default 8-step sequence (D06)

## 5. Mode transitions

Provenance: `TRANSITION_CAPABILITY_CATALOG.json` (2026-09-20) → digest below; verbatim catalog in JSON under `transitions.catalog`.

- **Runtime-usable modes**: ARENA, RUNNER, VERTICAL, RADIAL · placeholder (do not generate): DUO
- **Mode pair matrix**: 16/16 cells supported (12 cross-mode + 4 same-mode no-op boundaries)

### 5.1 Breather

- **formula**: max(TUNING.transition.breatherBeats=6, beatsForSeconds(bpm, TUNING.transition.countdownSeconds=3))
- **trigger**: adjacent sections with different modes only (LevelLoader.ts:332-334)
- **enforcement**: PatternScheduler.schedulePlacement spawn suppression (src/core/PatternScheduler.ts:89)
- **behavior**: {"suppresses_spawn":true,"ends_active_hazards_early":false,"spawned_hazards_remain_lethal":true,"spawned_hazards_cleared_at":"mode switch beat (deactivate)","warnings_of_suppressed_events":"never created (the mechanic object is never …

BPM table: [{"bpm":90,"beats":6,"seconds":4},{"bpm":100,"beats":6,"seconds":3.6},{"bpm":110,"beats":6,"seconds":3.27},{"bpm":120,"beats":6,"seconds":3},{"bpm":126,"beats":6,"seconds":2.86},{"bpm":128,"beats":6,"seconds":2.81},{"bpm":130,"beats":7,"seconds":3.23},{"bpm":140,"beats":7,"seconds":3},{"bpm":160,"beats":8,"seconds":3},{"bpm":174,"beats":9,"seconds":3.1},{"bpm":200,"beats":10,"seconds":3}]

### 5.2 State handoff (what persists vs resets)

**Persists**: `health`, `score_hits_notes`, `invulnerability`

- **health**: preserved (single HealthManager for the whole run, shared by all modes; reset only at run start) - src/core/RunStatus.ts, src/core/HealthManager.ts
- **combo**: reset on incoming mode activate (NoteMode.activate, src/modes/rhythm/NoteMode.ts:82-87); preserved across same-mode boundaries; ARENA/RUNNER have no combo
- **invulnerability**: preserved (invulnerableUntil in song seconds, 0.8s window, TUNING.health.invulnerableSeconds; can span the switch)
- **reset on incoming activate**: combo, position/velocity, RUNNER gravity, all active mechanics (see catalog for details)

### 5.3 Input handoff

- **model**: single global Input (src/core/Input.ts); modes read shared binding tables (src/core/controls.ts); no per-mode input map
- **held_keys_across_switch**: preserved and immediately re-interpreted by the incoming mode
- **key_overlaps**: {"runner_jump":["w","arrowup"," "],"runner_slide":["s","arrowdown"],"runner_flip":["shift","f"],"vertical_lanes":[["a"],["s"],["d"],["j"],["k"],["l"]],"radial_cardinals":"arrows + wasd","arena_move":"wasd + …

### 5.4 Beat clock continuity

- **music_continuity**: uninterrupted; mode switch never touches the SongPlayer (AudioContext-clock anchored, src/core/AudioEngine.ts)
- **beat_reset_on_switch**: false
- **absolute_beat**: recomputed from playbackTime every frame (src/core/BeatClock.ts:181)

### 5.5 Cleanup contract

- GameplayMode.deactivate 'should drop its mechanics' (src/modes/GameplayMode.ts:29-39)
- Per-mode cleanup and pending-queue behavior: see `transitions.catalog.cleanup` in the JSON.

### 5.6 Safe transition bounds

- **minimum_breathing_beats**: 6
- **minimum_breathing_seconds_nominal**: 3
- **minimum_breathing_seconds_worst_case**: 2.81
- **breather_formula**: max(6, round(bpm/20)) beats, measured back from the outgoing section's end beat
- **clear_previous_hazards**: true
- **clear_previous_hazards_at**: mode switch beat (outgoing sectionEndBeat - incoming leadInBeats), NOT at breather start
- **allow_active_hold_crossing**: false
- **hold_cut_penalty**: none (no MISS, no damage; combo reset by incoming activate)
- **allowed_boundary_types**: ["section_boundary"]
- **section_boundary_definition**: bar line (incoming section startBar) minus leadInBeats (<= 1 bar; max(4, beatsPerBar) for courses)
- **phrase_boundary_enforced**: false

**Compiler requirements**:

- last outgoing event activation strictly < breatherFromBeat (>= is suppressed); keep the active-window tail clear of the switch beat
- avoid long-duration mechanics (A07/A08/A11, slowed() variants) in the final bars before a mode change
- same-mode section boundaries get NO runtime breather - manage density manually
- incoming first event should activate at or after its startBar (earlier is possible via pending but visually compressed)
- single-mode buffered spawns <= 64 (MAX_PENDING) to avoid silent drops
- expect held-key carryover across the switch (input is global state)
- fill section gaps explicitly (empty bars keep the outgoing mode running with a load warning)

**Known risks (8)**:

- **HIGH RISK (compiler-avoidable) · R-1 · long-duration ARENA mechanic (A07/A08/A11, slowed() variants) active across the …** — breather suppresses new spawns only; an already-active hazard stays lethal until the switch beat. runtime offers no early end
- **CONDITIONAL · R-2 · non-RUNNER -> pattern-based RUNNER section** — first obstacle spawned 4 beats early waits in pending; visible only from the switch beat, already ~3/4 scrolled (compressed warning, beat-accurate)
- **CONDITIONAL · R-3 · held keys crossing the switch** — a/s/d/arrows held into ARENA cause immediate drift; s/arrowdown held into RUNNER causes immediate slide
- **CONDITIONAL (low) · R-4 · damage invulnerability active at the switch** — 0.8s window persists in song time; the incoming mode's first hit may be silently absorbed
- **CONDITIONAL (pathological levels) · R-5 · pending queue overflow for one mode (>64)** — oldest spawn silently dropped, droppedSpawns counter incremented (HUD-visible), no warning
- **SAFE (run terminal) · R-6 · death during a transition window** — clock.clearSchedule() also cancels the scheduled mode switch; world frozen in the outgoing mode
- **NOT SUPPORTED (gameplay) · R-7 · section into DUO (or any unregistered mode)** — PlaceholderMode: no hazards, events counted as skipped, run continues
- **CONDITIONAL (readability) · R-8 · difficulty jump across a boundary** — tier telegraphScale/travelScale change immediately for the next spawn; e.g. INTENSE -> EASY lengthens warnings by 67%

## 6. Integration warnings (14)

Conflicts and caveats discovered while merging. Original per-mode values are always preserved; these entries tell the director when NOT to treat modes uniformly.

### W01 — unit_conflict (ARENA, RUNNER, VERTICAL, RADIAL)

Mechanic/note timing is in beats everywhere, but player-facing motion units differ: ARENA player movement is real seconds (0.62 u/s, BPM-independent); RUNNER physics is seconds with beat-domain arcs (0.26 u/beat scroll); VERTICAL/RADIAL approach is a fixed 2-beat function. No unified motion unit exists.

- **Resolution**: per-mode values preserved; director must consult the owning mode before converting time to distance
- **Evidence**: `ARENA arena.player.movement.note`, `RUNNER player_physics.horizontal`, `VERTICAL physics.approachBeats`, `RADIAL geometry.approach_beats`

### W02 — semantic_conflict (VERTICAL, RADIAL, ARENA, RUNNER)

Identical window values 0.09/0.16/0.25 beats appear in VERTICAL and RADIAL as rhythm tap judgement windows; ARENA and RUNNER have no tap windows at all (ARENA judges by collision/graze with perfect-dodge cooldown 0.5 beat; RUNNER judges by physics contact). Same numbers, different gameplay meaning.

- **Resolution**: kept per-mode; do not present 0.09/0.16/0.25 as a global judgement contract
- **Evidence**: `VERTICAL judgement.windows_beats`, `RADIAL judgement.windows_beats`, `ARENA arena.collision_system`, `RUNNER player.collision`

### W03 — parameter_conflict (ARENA, RUNNER, VERTICAL, RADIAL)

Health pool is shared across modes (max 100) but damage rules differ per mode: ARENA damage table MISS 8 / COLLISION 10 / PROJECTILE 12 / OBSTACLE 15 with 0.8 s invulnerability; VERTICAL and RADIAL MISS -8 that bypasses invulnerability; RUNNER uses its own contact/fall-out damage model (catalog.player.damage).

- **Resolution**: per-mode damage values preserved; cross-mode HP continuity means mode order changes the difficulty budget
- **Evidence**: `ARENA arena.player.health`, `VERTICAL judgement.health`, `RADIAL judgement.miss_consequences`, `RUNNER player.damage`, `TRANSITION state_handoff.health`

### W04 — semantic_conflict (ARENA, RUNNER, VERTICAL, RADIAL)

section.difficulty (1..5) shares one tier mapping (1 EASY / 2 MEDIUM / 3 HARD / 4-5 INTENSE, unset MEDIUM) but its runtime effect differs per mode: ARENA telegraph tiers (real), VERTICAL spawn-lead only, RADIAL ambient-only (mechanics never read it), RUNNER METADATA ONLY.

- **Resolution**: per-mode effect statements preserved in global_contract.difficulty_model
- **Evidence**: `ARENA arena.timing.tiers_from_section_difficulty`, `RUNNER difficulty.section_difficulty_1_5.status`, `VERTICAL difficulty.section_difficulty_1_to_5`, `RADIAL difficulty.section_difficulty_1_5`, `TRANSITION difficulty_continuity`

### W05 — semantic_conflict (ARENA, RUNNER, VERTICAL, RADIAL)

placement intensity has a real per-mechanic effect in ARENA (telegraph/travel scaling) and RUNNER (R01/R02/R03/R08 lerps, phrase thresholds), but is spawn-lead-only in VERTICAL and gameplay-metadata-only in RADIAL.

- **Resolution**: per-mode intensity model preserved in global_contract.intensity_model
- **Evidence**: `ARENA arena.timing.intensity_per_mechanic`, `RUNNER difficulty.placement_intensity.consumers`, `VERTICAL difficulty.placement_intensity_0_to_1`, `RADIAL difficulty.placement_intensity`

### W06 — dead_or_alias (ARENA)

ARENA A10 variant FOLLOW_GAP behaves identically to BASIC_GAP (RingMechanic buildRings switch), and A14/A15 are phantom references existing only in mechanics.mvp.json compatibility metadata.

- **Resolution**: original values kept; generation must not emit FOLLOW_GAP as a distinct capability nor reference A14/A15
- **Evidence**: `ARENA meta.counts.noop_aliases`, `ARENA meta.counts.phantom_references`

### W07 — dead_code (VERTICAL)

VERTICAL drift/path subsystem is unreachable: V04 degrades to a straight hold; note path data in VP06/VP07/VP09 collapses to the first lane; drift lapse tolerance 0.18 beat, drift checkpoints and drift SFX have no producer. The parsed V04 path parameter is discarded.

- **Resolution**: kept as-is with degraded status; directors must not design drift charts
- **Evidence**: `VERTICAL unreachable_or_dead`, `VERTICAL notes (V04)`, `VERTICAL metadata_only_fields`

### W08 — metadata_only (ARENA, VERTICAL, RADIAL)

constraints.maxSimultaneousThreats and requiresMechanics are metadata only (never read at runtime); section/pattern function labels (including the 2 function:"TRANSITION" patterns) and musicTags/playerSkills/compatibility are likewise unconsumed.

- **Resolution**: flagged; runtime concurrency is uncapped (except transition pending queue 64), so stacking safety is author responsibility
- **Evidence**: `ARENA arena.safety.not_enforced`, `VERTICAL metadata_only_fields`, `RADIAL unreachable_dead_and_metadata_only.metadata_only_fields`, `TRANSITION counts.metadata_only_detail`

### W09 — safety_overshoot (RUNNER)

RUNNER R02 clamp ceiling 0.22 u EXCEEDS the max single-jump gap 0.2106 u at default speed: authored gap width param >= ~1.5 produces unjumpable gaps.

- **Resolution**: kept as-is (no code change); autogenerators must cap authored gaps at 0.21 u
- **Evidence**: `RUNNER safe_generation_bounds.max_authored_gap_width_warning`

### W10 — transition_edge (TRANSITION)

Same-mode section boundaries get NO runtime breather; held keys carry across the switch and are reinterpreted by the incoming mode immediately; pending-queue buffering silently drops spawns beyond 64 per mode; hazards stay lethal until the switch beat (breather suppresses creation, not existing hazards).

- **Resolution**: kept; see transitions.normalized.safe_transition_bounds.compiler_required
- **Evidence**: `TRANSITION same_mode_boundary`, `TRANSITION input_handoff`, `TRANSITION cleanup.pending_queues`, `TRANSITION safe_generation_bounds`

### W11 — placeholder_mode (TRANSITION)

DUO is declared in the mode enum with a PlaceholderMode fallback but has no reachable runtime gameplay from shipped content.

- **Resolution**: UNKNOWN capability preserved as placeholder; do not generate DUO sections
- **Evidence**: `TRANSITION modes.placeholder`, `TRANSITION counts.declared_without_runtime`

### W12 — parameter_conflict (VERTICAL, RADIAL)

Chord caps differ and are not unifiable: VERTICAL silently clamps chords >6 and collapses duplicate lanes (recommended max 2, min same-lane interval 1 beat); RADIAL chords are uncapped in code but a single instant can score at most 4 targets (diagonals) and same-beat adjacent-cardinal pairs alias into diagonals (recommended max 2).

- **Resolution**: per-mode bounds preserved in each mode normalized block and director_view.safe_generation_summary
- **Evidence**: `VERTICAL safe_generation_bounds`, `RADIAL safe_generation_bounds`

### W13 — no_global_guarantee (ARENA, RUNNER, VERTICAL, RADIAL, TRANSITION)

No unified playability guarantee exists: ARENA enforces per-mechanic floors but no cross-mechanic coordination or concurrency cap; VERTICAL/RADIAL have no runtime chart-feasibility guard; RUNNER clearability is verified off-runtime (tools/runner-check.ts, fairness tools are ARENA-scoped); transition safety depends on compiler discipline.

- **Resolution**: kept; generation pipelines must run the per-mode off-runtime checkers
- **Evidence**: `ARENA arena.safety`, `VERTICAL safety.verdict`, `RADIAL safety.guarantee_statement`, `RUNNER safety.runtime_guarantees`, `TRANSITION safe_generation_bounds`

### W14 — score_absence (ARENA, RUNNER, VERTICAL, RADIAL)

No point score system exists in VERTICAL/RADIAL (notesHit/combo/ACC only); ARENA and RUNNER catalogs likewise expose no score model; combo resets on mode switch (preserved on same-mode boundaries). Score-based director logic has no runtime backing.

- **Resolution**: recorded as a global fact in global_contract.health_score_combo
- **Evidence**: `VERTICAL judgement.score_system`, `RADIAL judgement.score_system`, `TRANSITION state_handoff.combo`

## 7. Integrity

- Source catalogs were hashed (sha256, first 16 hex chars) before and after consolidation; the merge asserted they are byte-identical (see `meta.source_catalogs[*].sha256_16`).
- No gameplay code was modified; no source catalog was modified; no git operations were performed during consolidation.
- The four non-ARENA source catalogs were produced by the read-only audit specs in `prompt/audit prompt/` immediately before this consolidation (`*_CAPABILITY_AUDIT.md` + `*_CAPABILITY_CATALOG.json` at repo root).
- UNKNOWN / NEEDS RUNTIME VERIFICATION entries in the source catalogs are preserved verbatim.


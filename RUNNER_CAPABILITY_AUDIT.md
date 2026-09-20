# BeatBound RUNNER — Complete Runtime Capability Audit

- Audit date: 2026-09-20
- Mode: **READ-ONLY RUNTIME AUDIT** — no gameplay code modified, no git operations performed.
- Source of truth: the workspace as it exists at audit time (`C:\Users\44977\Desktop\BB`).
- Companion machine-readable catalog: `RUNNER_CAPABILITY_CATALOG.json` (same directory).
- All physics numbers below were computed by executing the real module
  `src/mechanics/runner/runnerPhysics.ts` (bundled with esbuild and run in node), not re-derived by hand.
- The offline validators were executed during this audit: `npm run runner-check` (patterns + courses +
  procedural) — results quoted in §14.

---

## 1. Executive summary

RUNNER is a beat-anchored auto-runner. The player x is pinned at `PLAYER_X = 0.22` field units and the world
scrolls right-to-left at a **fixed** `UNITS_PER_BEAT = 0.26` field units per beat. An obstacle's screen x is a
pure function of the beat:

```
x(beat) = PLAYER_X + (activationBeat − beat) × UNITS_PER_BEAT      (src/mechanics/runner/runnerGeometry.ts, trackX)
```

so an obstacle scheduled on a beat arrives at the player exactly on that beat at any BPM.

The mode has **two runtime content pipelines**, both live and both dispatched to the same `RunnerMode`:

1. **Pattern pipeline** (shared with all modes): level JSON → `LevelLoader` → `PatternScheduler` →
   `MechanicRegistry` → six registered mechanic implementations (`R01 R02 R03 R04 R08 R09`).
2. **Course pipeline** (RUNNER-only): `section.course` → `composeCourse` (optional, seeded) → `planCourse`
   (phrase → motion verbs → trajectory → terrain demands) → one synthetic `R-COURSE` mechanic carrying the whole
   stretch via the `RunnerTerrain` capability. A course **fully replaces** that section's `patterns`.

Player action vocabulary (runtime-confirmed): **jump (variable height, buffered, coyote), one mid-air second jump
per take-off (re-armable by a course ring), slide (posture), manual gravity flip (key, grounded only)**.
Everything else commonly expected of the genre — dash, wall jump, drop-through, speed portals, moving platforms,
slopes — is **NOT SUPPORTED**.

### Headline counts

| Metric | Count |
|---|---:|
| Runtime-usable primitives (6 registry mechanics + 7 course terrain/hazard kinds + 4 player actions) | **17** |
| Motion verbs implemented in the planner (all reachable from course JSON) | **33** (`MOTION_VERBS`) |
| Phrase archetypes / roles | **12 / 5** |
| Library pattern definitions (RUNNER), all dispatched and all verified clearable | **25** (RP01–RP25) |
| Level files containing RUNNER content | **19** (15 course-based `runner_*` files + 4 files with pattern-based RUNNER sections) |
| RUNNER sections total | **23** (15 course sections + 8 pattern sections) |
| Dead / unreachable implementations found | **4** |
| Metadata-only fields (declared, never consumed at RUNNER runtime) | **5** |
| Absent mechanic ids (numbering gap, NOT dead code) | R05, R06, R07 |

---

## 2. Complete runtime call chain

### 2.1 Pattern pipeline

```
level JSON section.patterns[].patternId (+repeat, +intensity)
→ LevelLoader.validate / compile            (src/core/LevelLoader.ts)
    placements laid end-to-end per section; CompiledPlacement{startBar, intensity}
→ PatternScheduler.schedulePlacement        (src/core/PatternScheduler.ts)
    activationBeat = (startBar−1)×4 + (event.at.bar−1)×4 + (event.at.beat−1) + (event.at.offsetBeats ?? 0)
    spawnBeat = activationBeat − registry.spawnLeadBeats(id)      [= 4 for every RUNNER mechanic]
    events due after section.breatherFromBeat are dropped (mode-change breather)
→ BeatClock.scheduleAtBeat fires            (src/core/BeatClock.ts)
→ MechanicRegistry.create                   (src/core/MechanicRegistry.ts)
    params = definition.defaults merged with event.params
    timing resolved (RUNNER telegraphs are 0/0.25/1 → effectively unchanged; see §13)
    tier = tierForDifficulty(section.difficulty)   ← not consumed by any RUNNER mechanic (§13)
→ SpawnedMechanicInfo{mode:'RUNNER'} → ModeManager.route → RunnerMode.accept
→ RunnerMode.update                         (src/modes/runner/RunnerMode.ts)
    m.update(u) → BaseMechanic phase machine (SCHEDULED→TELEGRAPH→ACTIVE→RECOVERY→FINISHED)
    resolveTerrain() → resolveProbe (support/blocker, world y)
    RunnerPlayer.update (integration, jump/slide/bonk/land)
    applyBouncePads (contact capture 0.03)
    resolveCollisions (circle probe vs hazard shapes; fall-out check)
→ cleanup: ScrollingObstacle.isFinished = beat > activationBeat + SCROLL_TAIL_BEATS (1.5); filtered same frame
```

Key lifecycle fact: `ScrollingObstacle` **overrides `hazards()` to return its danger shapes unconditionally** —
RUNNER obstacles are dangerous the whole time they exist, not only during an ACTIVE window
(`src/mechanics/runner/ScrollingObstacle.ts`).

### 2.2 Course pipeline (RUNNER-only, `section.course`)

```
section.course {phrases[] | generate{beats,seed,intensity,phraseBeats}}
→ LevelLoader.compileCourse                 (src/core/LevelLoader.ts)
    generate expanded by composeCourse (deterministic per seed) into an ordinary CourseSpec
    startBeat = (startBar−1)×beatsPerBar; leadInBeats = max(SCROLL_LEAD_BEATS=4, beatsPerBar)
→ planCourse                                (src/mechanics/runner/runnerPlanner.ts)
    phrase → archetype/verbs → planVerb (each verb resolves REAL physics from runnerPhysics)
    → Trajectory (contiguous segments; terrain demands + hazard tolerances per segment)
→ BeatBoundGame.scheduleCourses → scheduleCourse (src/mechanics/runner/courseSchedule.ts)
    spawnBeat = course.startBeat − leadInBeats; synthetic registry context id 'R-COURSE'
→ RunnerCourseMechanic (one mechanic per course; implements RunnerTerrain)
    per-frame reads: world.surfaceAt / gravityAt / platformsOn / gapsOn / padsAt / hazardsAt / airJumpAt
→ RunnerMode.accept (route on mode:'RUNNER', patternId:'R-COURSE')
→ cleanup: isFinished = beat > trajectory.endBeat + 1.5   (CourseWorld.isFinishedAt)
```

Validation errors in a course (unknown archetype/verb, bad generate params, empty phrase list) are **load
errors**, not silent gaps. When `course.generate` and an authored `phrases` list are both present, the authored
list wins (warning).

Both pipelines converge on the same collision, physics, gravity and cleanup code; the course world
(`CourseWorld`) is a pure function of the beat shared with the offline simulator and check tool, so a validated
course and a played course cannot disagree.

---

## 3. Primitive master table

"可用" = runtime-usable as of this audit. P=pattern pipeline, C=course pipeline, A=player action.

| ID / Type | 名称 | 当前可用 | 类别 | 作用 | 致命 | 可参数化 | 可组合 |
|---|---|---|---|---|---|---|---|
| `R01` | Spike | YES (P) | hazard | Ground/ceiling blade, jump it | YES (OBSTACLE 15 dmg) | height, surface | YES |
| `R02` | Gap | YES (P) | terrain/hazard | Hole in the floor; jump or fall | YES (fall = OBSTACLE) | width | YES |
| `R03` | Low Wall | YES (P) | hazard | Overhead beam, slide under | YES | clearance, surface | YES |
| `R04` | Platform | YES (P) | terrain | Solid block; front face hurts, top is standable | YES (face only) | surface, height, width | YES |
| `R08` | Bounce Pad | YES (P) | terrain/helper | Contact launches the player | NO (harmless) | launchStrength | YES |
| `R09` | Gravity Flip | YES (P) | modifier | Portal zone; inverts gravity while ACTIVE | NO (indirect) | gravityScale, durationBeats | YES |
| `R05`/`R06`/`R07` | — | **ABSENT** (no library entry, no implementation, no JSON reference anywhere) | — | — | — | — | — |
| `R-COURSE` | Course | YES (C) | terrain container | Whole-stretch terrain from a planned trajectory | (carries hazards) | phrase/archetype/verb/intensity/inverted/generate | YES |
| COURSE: SLAB | Slab / platform / corridor roof | YES (C) | terrain | Anchored or floating block; support+blocker | NO (body harmless; only SPIKE/WALL hazards kill) | beat, width, faceY, backY, surface, floating | YES |
| COURSE: GAP | Hole | YES (C) | terrain/hazard | Missing stretch of the live surface | YES (fall) | beat, width, surface | YES |
| COURSE: PAD | Bounce pad | YES (C) | helper | Launch on contact | NO | beat, faceY, surface, strength | YES |
| COURSE: AIRJUMP | Mid-air jump ring | YES (C) | helper | Re-arms a spent air jump (±1/3 beat window) | NO | beat, faceY, surface | YES |
| COURSE: SPIKE | Spike hazard | YES (C) | hazard | Blade on the live surface | YES | beat, faceY, surface | YES |
| COURSE: WALL | Beam (slide) | YES (C) | hazard | Overhead beam with authored clearance | YES | beat, faceY, clearance, surface | YES |
| COURSE: FLIP | Gravity flip gate | YES (C) | modifier | Inverts gravity at an absolute beat, persists | NO (indirect) | beat, to | YES |
| ACTION: jump | Single jump | YES (A) | action | Buffered + coyote + variable height | — | hold length (player input) | YES |
| ACTION: air jump | Double jump | YES (A) | action | One per take-off; shorter impulse | — | — (fixed scale) | YES |
| ACTION: slide | Slide | YES (A) | posture | Body shrinks; required under beams | — | — | YES |
| ACTION: manual flip | Manual gravity flip | YES (A) | action | Keyed flip while grounded (Shift/F) | — | — | YES |

Explicitly **NOT SUPPORTED** (no implementation anywhere in `src/`): dash, air dash, wall jump, drop-through
platform, hold-to-fly, speed portal / speed change, moving platform, slope, one-way platform, orb chain,
ceiling-walk without a gravity flip, invulnerability pickups.

---

## 4. Player physics (from code, with units)

All heights/distance in **field units** (field is 0..1 wide/tall); time in **beats** unless stated; vertical
speeds in field units/second; gravity in field units/second².

| Property | Value | Source |
|---|---|---|
| Player x | **fixed at `PLAYER_X = 0.22`** — movement is world scroll, never player translation | `runnerGeometry.ts` |
| Track speed | `UNITS_PER_BEAT = 0.26` field units/beat, **constant**; at BPM b that is `0.26·b/60` units/s (0.52 u/s @120) | `TUNING.runner.unitsPerBeat` |
| Body (standing) | w 0.030 × h 0.094 | `TUNING.runner.playerWidth/standingHeight` |
| Body (sliding) | h 0.044 (slide only while grounded) | `TUNING.runner.slidingHeight` |
| Collision probe | circle at body centre, r = min(w,h)/2 = **0.015**; reach above feet: standing **0.062** (`STAND_TOP`), sliding **0.037** (`SLIDE_TOP`) | `runnerPhysics.ts` |
| Gravity | derived from the arc: g = 8·apex/(0.95·spb)² → **11.35 u/s² @120 BPM** (7.88 @100, 17.73 @150) | `gravityFor()` |
| Jump take-off speed | **2.69 u/s @120 BPM** (launched against gravity) | `jumpVelocityFor()` |
| Jump arc | apex **0.32**, airtime **0.95 beats**, apex at 0.475 beats; identical *shape* at every BPM | `TUNING.runner.jumpBeats/jumpHeight` |
| Variable jump | releasing while rising multiplies remaining upward speed by **0.45** (`jumpCutFactor`); zero-length press apex floor **0.0648**; deliberate-tap floor `MIN_TAP_BEATS = 0.08` → 0.1435 apex | `RunnerPlayer.update`, `runnerPhysics` |
| Jump buffer | **0.12 s** (`inputBufferSeconds`) — a press that early before landing fires on touchdown | `TUNING.runner` |
| Coyote time | **0.09 s** after leaving a surface | `TUNING.runner.coyoteSeconds` |
| Double jump | **one per take-off, armed automatically**; mid-air impulse = jump velocity × `AIR_JUMP_SCALE = 0.6374`; adds **0.13** apex above the press point; combined apex **0.45**; combined airtime **1.0805 beats**; disarmed on landing and on gravity flips | `RunnerPlayer`, `runnerPhysics` |
| Air-jump ring (course) | re-arms a *spent* air jump while live; window **±1/3 beat** around the ring beat | `CourseWorld.airJumpAt` |
| Slide | hold S/↓ while grounded; body height 0.094→0.044; no speed change (x is fixed anyway) | `RunnerPlayer` |
| Step-up | terrain ≤ **0.045** above the feet is walked onto, not jumped (`stepUpHeight`); airborne reach is 0 (exact face landings) | `resolveProbe`, `RunnerMode.resolveTerrain` |
| Head bonk | rising into a solid face stops the rise dead (velocity=0); **no damage** — it is feedback, not a fail | `RunnerPlayer.update` |
| Terminal velocity | **none** (pure ballistic integration) | `RunnerPlayer.update` |
| Acceleration / friction / air control | **none** (x fixed; vertical is ballistic) | — |
| Integration guard | dt clamped to ≤ 0.05 s per frame | `RunnerPlayer.update` |
| World bounds | feet y clamped to [−1.4, 2.4]; fall-out: feet y > **1.02** (floor gravity) or < **−0.02** (ceiling) | `RunnerPlayer.hasFallenOut` |
| Fall-out behavior | OBSTACLE damage (15) + instant reset to the current base surface (GROUND_Y 0.72 / CEILING_Y 0.28) | `RunnerMode.resolveCollisions` |
| Damage / i-frames | OBSTACLE = **15 hp** of 100; **0.8 s** invulnerability after any collision hit | `TUNING.health` |
| Death conditions | only cumulative health exhaustion (via `HealthManager`); no instant-death hazard | — |
| Respawn | none; damage is continuous and fall-outs teleport the player to the base line | `RunnerMode` |
| Visual/collision parity | visual body equals physical body rect (squash/stretch ±25% *reduces* height on land); course hazards render from the same rects as collision; the legacy spike is drawn a triangle but its **collision is the enclosing rect** | `SpikeMechanic`, `RunnerCourseMechanic` |

### 4.1 Gravity at runtime (both pipelines)

- Gravity direction is `courseGravity × (manualFlip ? −1 : +1)`, where `courseGravity` = sign of the last active
  gravity source (`R09` while ACTIVE, or the course flip timeline). Default **+1 (floor)**.
- A flip is an **instant snap, not a transition**: velocity is zeroed, feet are set to the new base line
  (0.72 / 0.28), `grounded` clears, coyote time (0.09 s) is granted, armed air jumps are cleared
  (`RunnerPlayer.update` gravity branch). The *visual* surface eases over `gravitySnapBeats = 0.18` beats —
  presentation only.
- Vertical velocity is **not** preserved across a flip (an in-code comment suggests momentum carry; the code sets
  `this.velocity = 0`). Code behavior is authoritative.
- The sprite/hitbox is gravity-relative (`head = feet − g·bodyHeight`); the camera does not flip, the *world
  colors* invert (live surface bright, other ghosted).
- Obstacles are surface-tagged (`surface: FLOOR | CEILING` legacy; per-demand surface in courses). The mode
  filters hazards/terrain to the **live** surface: an obstacle on the other surface is scenery (drawn dim in
  courses) and can never hurt or support the player.
- Flip triggers and JSON: (a) legacy `R09` params `{gravityScale: −1}` with library `durationBeats: 4`,
  `cooldownBeats: 2`, telegraph 1 beat; (b) course phrase `inverted: true/false` or verbs
  `GRAVITY_FLIP_UP / GRAVITY_FLIP_DOWN / GRAVITY_ZIGZAG` (planner `FLIP_BEATS = 0.5`; each flip auto-emits a
  2.4-beat "plate" slab so the arrival surface is solid); (c) manual key flip (no JSON).
- Minimum spacing between flips: **no runtime clamp**. Observed planner grammar: `GRAVITY_ZIGZAG`
  (flip → play ≥0.5 → flip back) spans 4 beats; the composer refuses a `FLIP` pair with < `phraseBeats×2` beats
  left; legacy `R09` imposes 4-beat duration + 2-beat cooldown (≥6 beats between portals). Course flips land
  exactly at their authored beat; the manual flip is grounded-only.
- No landing protection exists beyond the auto-plate: a flip onto a hole still drops the player out of the
  world. The planner prevents this for courses; **pattern-mode authors must guarantee it themselves**.

---

## 5. Jump envelope (computed from the real module)

Defaults: strength 1, full hold; secondsPerBeat = 60/BPM.

### 5.1 Single jump (full hold)

| Quantity | Value |
|---|---|
| Apex | 0.32 field units above take-off surface |
| Total airtime | 0.95 beats (0.475 s @120, 0.57 @100, 0.633 @90, 0.38 @150) |
| Time to apex | 0.475 beats |
| Horizontal distance covered | **0.247 units** (= 0.95 × 0.26) |
| Airtime above 0.04 | 0.889 beats ([0.031, 0.919] of flight) |
| Airtime above a default spike (0.09) | **0.805 beats** ([0.072, 0.878]) |
| Max safe gap (0.14-beat landing margin) | **0.2106 units** |
| Max gap, zero margin (theoretical) | 0.247 units |
| Widest rise landable | apex 0.32; planner aim cap `maxRise(1) = 0.3008` (6% margin), field cap `MAX_LEVEL = 0.27` |

### 5.2 Horizontal progress at default speed (no jump needed)

| Time | Distance |
|---|---|
| 0.25 beat | 0.065 units |
| 0.5 beat | 0.13 units |
| 1 beat | 0.26 units |
| 2 beats | 0.52 units |
| 4 beats | 1.04 units |

### 5.3 Variable-height jumps (tap = hop)

| Key hold (beats) | Apex | Airtime | Distance |
|---|---|---|---|
| 0 (instant release floor) | 0.0648 | 0.428 | 0.111 |
| 0.08 (`MIN_TAP_BEATS`) | 0.1435 | 0.576 | 0.150 |
| 0.20 (`QUICK_HOP`/`TRIPLE_HOP`) | 0.2345 | 0.730 | 0.190 |
| 0.22 (`DOUBLE_HOP`) | 0.2465 | 0.752 | 0.195 |
| 0.30 (`SHORT_JUMP`) | 0.2854 | 0.827 | 0.215 |
| 0.55 (`MEDIUM_JUMP`) | 0.3200 | 0.950 | 0.247 |

### 5.4 Landings at a rise (full jump, descending crossing)

| Rise above take-off | Landing beat | Horizontal distance to landing |
|---|---|---|
| +0.06 (one stair step) | 0.903 | 0.235 |
| +0.08 (SKY_STEPS step) | 0.886 | 0.230 |
| +0.12 (library default platform) | 0.851 | 0.221 |
| +0.16 (`HIGH_LEVEL`) | 0.811 | 0.211 |
| +0.27 (`ASCENT_LEVEL`/`MAX_LEVEL`) | 0.663 | 0.172 |
| +0.3008 (`maxRise(1)`) | 0.586 | 0.152 |

Drops (no impulse, pure fall): depth 0.06 → 0.206 beats; 0.12 → 0.291; 0.16 → 0.336; 0.27 → 0.436.
Formula: `dropBeats(d) = 0.475 × √(d/0.32)` beats.

### 5.5 Bounce pads (impulse × s ⇒ apex × s², airtime × s)

| Strength | Apex | Airtime | Distance | Max safe gap |
|---|---|---|---|---|
| 1.35 (planner `RHYTHMIC_BOUNCE`) | 0.583 | 1.283 | 0.334 | 0.297 |
| 1.4 | 0.627 | 1.330 | 0.346 | 0.309 |
| 1.5 | 0.720 | 1.425 | 0.371 | 0.334 |
| 2.0 (`R08` clamp ceiling) | 1.280 | 1.900 | 0.494 | 0.458 |

Note: pad 1.35 apex (0.583) exceeds the 0.44 span between the two running surfaces — a floor pad at ≥1.35
launches the player past the ceiling line unless nothing stops them. The planner only pairs pads with open sky;
pattern-mode authors must not place a ceiling obstacle inside a pad arc.

### 5.6 Double jump (jump + mid-air re-press at apex)

Combined apex **0.45**; combined airtime **1.0805 beats** (distance 0.281); second press planned at 0.475 beats.
A `DOUBLE_JUMP_MOUNT` block sits at rise **0.34** — unreachable by any single jump (apex 0.32) — with a ring at
the first apex; the ring window is ±1/3 beat.

### 5.7 Inverted gravity symmetry

The physics is gravity-relative (`runnerPhysics` is sign-agnostic; verbs are surface-relative), so the jump
envelope on the ceiling is **exactly symmetric**: same apex (0.32 down-screen), same airtime, same gaps. The
asymmetries are *placement* ones, not physics: climbs cap at `MAX_LEVEL = 0.27` from either surface (a slab
never pokes through the opposite route), and course flip gates — not physics — decide surface changes.

### 5.8 Slide / beams

Beam clearance band that makes a beam meaningful: **[0.037, 0.062]** (`SLIDE_TOP`, `STAND_TOP`). The planner uses
`BEAM_CLEARANCE = 0.0495` (band middle). Legacy `R03` maps its `clearance` param through `× 0.15`, clamped
**[0.062, 0.14]** — the legacy wall always blocks a standing player (0.062 = `STAND_TOP`) and always passes a
sliding one (0.062 > 0.037) even at the clamp floor. Corridor headroom floor:
`CORRIDOR_MIN_CLEARANCE = 0.094 + 0.1435 + 0.022 ≈ 0.2595` (body + minimum deliberate tap + margin);
`CORRIDOR_CLEARANCE ≈ 0.3095`.

---

## 6. Ground / platform / obstacle audit (detail)

### R01 — Spike (`SpikeMechanic.ts`)
- JSON: `{ "mechanicId": "R01", "params": { "height": 1.0, "surface": "FLOOR" } }`
- Final height = `clamp(0.09 × height × lerp(1, 1.15, intensity), 0.04, 0.16)`.
- `surface`: `"FLOOR"` (default) | `"CEILING"` — any other value silently means FLOOR (`readSurface`).
- Centred on its activation beat; width **0.024**; danger = enclosing rect (drawn as a triangle, collision is
  the rect — slightly stricter than the visual). Lethal the whole time it exists; retired at activation+1.5.
- One jump clears it if the arc stays above `height − (STANDING_HEIGHT/2 − PROBE_RADIUS)` across its
  ~0.21-beat danger window.

### R02 — Gap (`GapMechanic.ts`)
- JSON: `{ "params": { "width": 1.0 } }` (floor only; ceiling gaps exist only in courses).
- Final width = `clamp(0.13 × width × lerp(1, 1.25, intensity), 0.06, 0.22)`.
- Implements `RunnerTerrain.groundGap()`; the danger is absence of floor — fall-out = OBSTACLE 15 + reset.
- **RISK**: the clamp ceiling 0.22 exceeds the max safe full-jump gap 0.2106 (§5.1). A `width` param ≳ **1.55**
  (intensity 0) or ≳ **1.35** (intensity 1.0) produces a gap no jump can clear. The library patterns use
  width ≤ 1.1 (verified); the runtime itself offers no protection.

### R03 — Low Wall (`LowWallMechanic.ts`)
- JSON: `{ "params": { "clearance": 0.5, "surface": "FLOOR" } }` (library default 0.5).
- Final clearance = `clamp(clearance × 0.15 × lerp(1, 0.85, intensity), 0.062, 0.14)`; beam body 0.07 × 0.14.
- Floor wall: gap under it = `clearance`; ceiling wall mirrored. Slide-only by construction.

### R04 — Platform (`PlatformMechanic.ts`)
- JSON: `{ "params": { "surface": "FLOOR", "height": 0.12, "width": 1.0 } }`.
- height `clamp(h, 0.02, 0.24)`; width `clamp(w, 0.5, 2.5) × (0.5 beats × 0.26 = 0.13 units)`.
- Standable face at `base − height` (floor) / `base + height` (ceiling). **Only the leading face** (x1 side,
  depth `FACE_DEPTH 0.035`) is lethal; the body is terrain. height ≤ 0.045 is walked over automatically.
- Floating behaviour (slab with a usable underside) exists only in the course pipeline; legacy R04 is anchored.

### R08 — Bounce Pad (`BouncePadMechanic.ts`)
- JSON: `{ "params": { "launchStrength": 1.0 } }`.
- Final strength = `clamp(launchStrength × lerp(1, 1.2, intensity), 1, 2)`; body 0.09 × 0.022 on GROUND_Y.
- Fires on contact (feet within `PAD_CAPTURE 0.03` of the pad face + x overlap); harmless; floor-only in the
  legacy pipeline (course pads support both surfaces via `faceY`).

### R09 — Gravity Flip portal (`GravityFlipMechanic.ts`)
- JSON: `{ "mechanicId": "R09", "params": { "gravityScale": -1 } }`; library timing
  `durationBeats: 4, telegraphBeats: 1, cooldownBeats: 2`.
- `gravityScale` clamp [−2, 2]; the mode uses its **sign** only. Active window = exactly `durationBeats`.
- Scrolls in like an obstacle; charge visual during the 1-beat telegraph; screen tint + beat countdown while
  ACTIVE. The flip lands on the player the instant the mechanic turns ACTIVE (§4.1 snap semantics).

### Course terrain demands (`trajectory.ts`, `courseWorld.ts`; internal — not JSON-authorable directly)
- `SLAB {beat, width(units), faceY, backY, surface, floating}` — anchored slabs reach the base line (can never
  block); floating slabs are `PLATFORM_DEPTH 0.05` thick (support *and* block ⇒ corridors expressible). Landing
  slabs default `LANDING_SLAB_BEATS 1.2` beats wide, ≥ `minLandingWidth() 0.104` units. Same-line touching slabs
  coalesce; terrain ends where a planned fall leaves it (`clipFalls`).
- `GAP {beat, width, surface}` — width = `maxGapWidthForAirtime(actual flight airbeats) × gapScale`
  (`gapScale` 0.6 for SKY_STEPS) ⇒ planner-made holes always fit the flight that crosses them.
- `PAD {beat, faceY, surface, strength}` — planner strength 1.35 on the current face.
- `AIRJUMP {beat, faceY, surface}` — ring; live ±1/3 beat; arms one extra air jump.
- Hazards: `SPIKE` (blade surface→`faceY`, collision rect w 0.024) and `WALL` (beam 0.07 × 0.14 at authored
  `clearance`, measured from the walkway, not the base line).

### Cleanup / lifetime
- Legacy obstacle: retired at `activationBeat + 1.5` beats, filtered in `update`.
- Course: retired at `trajectory.endBeat + 1.5`.
- Mode change: `clearHazards()` empties the mechanic list; player state resets on `activate`.

---

## 7. Jump / action mechanic audit

| Action | Status | Detail |
|---|---|---|
| single jump | SUPPORTED | buffered (0.12 s), coyote (0.09 s), variable height (cut ×0.45) |
| double jump | SUPPORTED | exactly one per take-off, armed automatically; ring re-arms a spent one |
| hold jump / variable height | SUPPORTED | jump cut on release while rising |
| short hop | SUPPORTED | same jump released early (see 5.3) |
| drop-through | **NOT SUPPORTED** | no input; slide does not pass through terrain |
| dash / air dash | **NOT SUPPORTED** | |
| wall jump | **NOT SUPPORTED** | walls bonk, never boost |
| orb-assisted jump | SUPPORTED | course AIRJUMP ring (re-arm window ±1/3 beat) |
| jump pad | SUPPORTED | R08 + course PAD |
| gravity flip (portal) | SUPPORTED | R09 zone; course flip timeline |
| manual gravity toggle | SUPPORTED | Shift/F while **grounded**; multiplies course gravity; instant |
| automatic gravity portal | SUPPORTED | R09 and course flips are automatic |
| ceiling run | SUPPORTED | any inverted state (`CEILING_RUN`/`CEILING_HOP` verbs) |

Keys: jump `W / ↑ / SPACE`, slide `S / ↓`, manual flip `Shift / F` (`src/core/controls.ts`).

---

## 8. Speed / scroll audit

- Base speed: `0.26` units/beat. **There are no speed changes, no speed multiplier, no speed portal/trigger, and
  no clamps because nothing varies.** `speed` params exist only in ARENA mechanics.
- BPM affects only the seconds conversion: jump duration = 0.95 × 60/BPM s; gravity and take-off speed re-derive
  (`gravityFor`, `jumpVelocityFor`); scroll speed = 0.26 × BPM/60 units/s. The *beat-space* geometry is
  tempo-invariant — the mode's core contract.
- Section `difficulty` and placement `intensity` **do not** change speed (§13).
- `TUNING.runner.parallax = [0.12, 0.28, 0.55]` — background layers only, no gameplay effect.

---

## 9. Sequencing capability

Pattern pipeline (per event): `at: {bar, beat, offsetBeats?}` (1-based bar/beat; fractional beats and
`offsetBeats` supported), `params`, `role`. Patterns repeat via placement `repeat`; placements are laid
end-to-end per section in declaration order; overflow/underflow produce load warnings, not errors.
Parallel/stacking: **yes — multiple mechanics can share a beat** (runner-check's group logic treats close JUMP
demands as "one jump must span them"). `maxSimultaneousThreats` in pattern JSON is metadata only — nothing
enforces it (§13).

Course pipeline: `phraseBeats` (default 4), phrases placed by **accumulated real length** (never index×default);
`beats` per phrase; `role` (INTRO/REPEAT/VARIATION/CLIMAX/RELEASE or derived from position 0/0.15/0.4/0.7/0.9
fraction); `motif` (recurrence label); `inverted` (surface statement; absent = carry over); `verbs` (explicit
verb list overriding the archetype's default sequence). Loop: archetype shapes repeat to fill (`verbsFor`,
guarded at 32 iterations); random choice: only via `course.generate` (seeded, deterministic, verified);
conditional logic: none; nested courses: none. A phrase always occupies exactly its beats — verbs that overshoot
are dropped whole or trimmed at a segment boundary, remainder filled with running.

`course.generate {beats, seed, intensity?, phraseBeats?}` — expanded at load by `composeCourse`;
anti-repetition (no same archetype twice in a row unless the role changed); flip pairs reserve
`phraseBeats×2`; motifs recur from a 4-motif pool (`drive climb air invert`); role loudness reshape
(CLIMAX ×1.25, INTRO ×0.7, RELEASE ×0.6; DESCENT/RELEASE capped ≤0.4).

---

## 10. Telegraph / readability / reaction window

RUNNER is **not warning-based**: registry entries declare `telegraphBeats: 0` and buy
`spawnLeadBeats = SCROLL_LEAD_BEATS = 4` of *spatial* lead. Obstacles spawn at x = 0.22 + 4×0.26 = 1.26 (just
off the right edge); course hazards render until x ≤ 1.08, legacy visuals until x ≤ 1.1.

- First-visible → contact: from the field edge x = 1.0: (1.00−0.22)/0.26 = **3.0 beats**; from the 1.08 cull:
  **3.31 beats**. In seconds: 2.0 s @90 BPM, 1.5 s @120, 1.2 s @150. This is the mode's actual reaction window —
  everywhere above the 0.6 s fairness floor.
- R09 portal additionally charges during its 1-beat telegraph and shows an on-screen beat countdown while
  ACTIVE.
- Course flip gates charge over the **3 beats** of approach (hardcoded in `RunnerCourseMechanic.renderFlipGates`)
  with arrows pointing the new gravity's way.
- Beat ticks scroll on the running surface (downbeats emphasized); the player lane line is drawn; debug view
  (` key) draws the collision world, apex line and breadcrumbs.

---

## 11. Collision / death audit

- Player: circle probe r 0.015 at body centre (sliding shrinks vertical reach to 0.037). Not an AABB; beam
  clearances are derived from this probe.
- Spike (course): rect w 0.024 × (surface→faceY). Spike (legacy): rect 0.024 × 0.04..0.16. Wall:
  0.07 × 0.14 at authored clearance. Platform face: rect 0.035 deep × height. Course slab bodies: never lethal.
- Swept collision / tunneling protection: **none for hazards** — per-frame static tests. At 0.26 units/beat a
  spike's danger window is ~0.21 beats (≈20+ frames @60 fps) so tunneling is not practically exploitable, but
  the test is not swept. Terrain landing is resolved on the frame the feet cross the face (integrator clamps to
  the exact support); the simulator runs at 64 steps/beat and matches live play.
- Landing tolerance: exact-face (airborne reach 0). Grounded step tolerance: 0.045.
- Head collision: rise stops at the blocker (velocity zeroed, `bonked`), no damage.
- Side collision: platform front face damages (OBSTACLE). Course slabs have no lethal face.
- Fall out of world: OBSTACLE damage + teleport to base surface. Death = health exhaustion only.
- Visual/collision parity: course hazards render from the same `hazardShape` used for collision; legacy spike
  collision is slightly larger than the drawn triangle.

---

## 12. Pattern / template library

### 12.1 Library patterns (patterns.mvp.json, mode RUNNER) — 25, all dispatched and clearable

| Pattern | 名称 | Bars | Primitives | Key params | 难度 |
|---|---|---:|---|---|---:|
| RP01 | Basic Jump | 1 | R01 | height 0.9–1.0 | 1 |
| RP02 | Double Jump | 1 | R01 | heights 0.8–1.1, beats 1/2/4 | 2 |
| RP03 | Jump Slide | 1 | R01+R03 | clearance 0.6 | 2 |
| RP04 | Triple Chain | 1 | R01 | 4 spikes, beats 1–4 | 3 |
| RP05 | Jump Bounce Jump | 2 | R01+R08 | launchStrength 1.1 | 3 |
| RP06 | Short Gap Chain | 2 | R02+R01+R03 | width 0.9–1.0 | 3 |
| RP07 | Bounce Chain | 2 | R08+R01 | launchStrength 1–1.1 | 3 |
| RP08 | Half Beat Jumps | 1 | R01 | spikes at 1/1.5/2.5/3/4 | 4 |
| RP09 | Rapid Stair | 2 | R01+R03 | heights 0.7→1.3 | 4 |
| RP10 | Gravity Entry | 2 | R09+R01 | flip then spikes | 3 |
| RP11 | Gravity Alternation | 4 | R09+R01 | 2 flips, CEILING spikes | 5 |
| RP12 | Runner Climax | 2 | R01+R08+R03 | half-beat chains + pad | 5 |
| RP13 | Ceiling Chain | 4 | R09+R01+R03 | CEILING surface chain | 4 |
| RP14 | Mixed Chain | 4 | R01+R08+R03+R02 | all four legacy hazards | 4 |
| RP15 | Recovery | 4 | R01 | 2 spikes | 1 |
| RP16 | Platform Step | 2 | R04 | height 0.04 (auto-step), width 1–1.5 | 1 |
| RP17 | Platform Hop | 2 | R04 | heights 0.12/0.14 | 2 |
| RP18 | Staircase Up | 2 | R04 | 0.08→0.22 | 2 |
| RP19 | Platform Ladder | 2 | R04+R01 | alternating 0.04/0.14–0.16 | 3 |
| RP20 | Gap Bridge | 2 | R02+R04 | gaps + steps | 2 |
| RP21 | Platform Leap | 2 | R02+R04+R01 | gap→platform→spike | 3 |
| RP22 | Gravity Shelf | 2 | R09+R04 | CEILING shelves 0.04/0.14 | 3 |
| RP23 | Gravity Corridor | 4 | R09+R04+R01 | two flips + shelves | 4 |
| RP24 | Platform Climax | 4 | R02+R04+R01+R09+R03 | full mix incl. ceiling | 4 |
| RP25 | Platform Recovery | 2 | R04 | two wide steps | 1 |

Pattern functions: TEACH (RP01/RP16), PRACTICE (RP02/03/04/07/17/20), VARIATION (RP05/06/08/09/13/18),
TRANSITION (RP10/22), COMBINE (RP14/19/21/23), CLIMAX (RP11/12/24), RECOVERY (RP15/25).
All declare `maxSimultaneousThreats: 1` (unenforced) and `minReactionBeats` 0.5–2 (inert for RUNNER — §13).

### 12.2 Course levels and mixed levels

Course-based (15 files, one course section each): runner_test_01..13 (BPM 120, 8 bars, 8 phrases each,
difficulty 2; runner_test_12/13 difficulty 3), runner_showcase (BPM 120, 30 bars, 26 phrases, handcrafted),
runner_procedural (BPM 100, 16 bars, `generate {beats 64, seed 7, intensity 0.6}`).

Pattern-based RUNNER sections (8, across 4 files): runner_test.level.json (3 sections, BPM 110 — RP01/16/03/17/
20/19 placements), prototype_90s.level.json (S02: RP01×2+RP16×3; S06: RP18×3), test_song.level.json (S02:
RP01+RP04×4+RP03×4+RP05×4), dance_fruits_..._toosie_slide_sped_up.level.json (S02: RP08×4+RP01×3+RP01;
S06: RP01+RP09×4+RP22×3).

Family coverage by test level: 01 GROOVE chains, 02 tap/hold rhythm, 03 staircases, 04 high/low, 05 gaps,
06 drops, 07 gravity zigzag, 08 inverted chains, 09 corridors, 10 dense bursts, 11 all families,
12 DOUBLE_JUMP_MOUNT, 13 SKY_STEPS.

### 12.3 Composite vocabulary

- 33 motion verbs (`MOTION_VERBS`, `motion.ts`), every one implemented in `planVerb` and reachable from JSON via
  `verbs:[...]` or archetypes. (The in-code comment says "31" — stale; the array has 33.)
- 12 phrase archetypes, each a named verb sequence (`ARCHETYPE_VERBS`); `ROLE_ARCHETYPES` implements the
  I→R→V→C→R arc: INTRO (GROOVE/BOUNCE/RELEASE), REPEAT (+WAVE/GAP_RUN), VARIATION (WAVE/GAP_RUN/ASCENT/DESCENT/
  CORRIDOR), CLIMAX (BURST/CLIMB_AND_DROP/CORRIDOR/GAP_RUN/FLIP), RELEASE (RELEASE/DESCENT).
- Distinct layers: **primitive mechanic** (R01–R09 + course demands), **composite pattern** (RP01–RP25; course
  verb/archetype), **level placement** (section patterns / course phrases).

---

## 13. Difficulty / scaling audit

| Field | Declared in | Actual consumer | Verdict |
|---|---|---|---|
| placement `intensity` 0..1 | level JSON patterns[] | R01 height ×1→1.15, R02 width ×1→1.25, R03 clearance ×1→0.85, R08 strength ×1→1.2 (all clamped); R04/R09 ignore it | **RUNTIME ACTIVE** |
| phrase `intensity` 0..1 | course phrases / generate | `heavy = intensity > 0.55` adds a spike over LONG_JUMP/LONG_GAP flights; RELEASE/DESCENT loudness ≤0.4 (composer); `calm()` strips hazards in RELEASE phrases | **RUNTIME ACTIVE** |
| section `difficulty` 1..5 | level JSON | → `tierForDifficulty` → mechanic `tier` — **no RUNNER mechanic or mode reads `tier`**; the course mechanic's synthetic `intensity = (difficulty−1)/4` is likewise unread | **METADATA ONLY (RUNNER)** |
| `PatternConstraints.maxSimultaneousThreats` | patterns JSON | no consumer in `src/` or `tools/` | **METADATA ONLY** |
| `PatternConstraints.requiresMechanics` | patterns JSON | no runtime consumer | **METADATA ONLY** |
| `PatternConstraints.minReactionBeats` | patterns JSON | only via `scaleTelegraphBeats`; RUNNER telegraphs 0 (R01–R04) and 0.25 (R08) sit below the 0.6-beat floor and are returned unchanged; R09's 1-beat telegraph can shrink to 0.65 at intensity 1 (visual only; spawn lead stays 4) | **EFFECTIVELY INERT for RUNNER** |
| pattern `difficulty.{reaction,...}` sub-scores | patterns JSON | not read at runtime | **METADATA ONLY** |
| mechanic `musicTags` / `playerSkills` / `compatibility` | mechanics JSON | typed in `types.ts`, never read | **METADATA ONLY** |
| `TUNING.runner.gravityTelegraphBeats = 1` | tuning | **zero consumers** (course gate charge hardcodes 3 beats; R09 telegraph comes from its library entry) | **DEAD KNOB** |
| `speedMultiplier` / `obstacleDensity` / `reactionScale` / `jumpScale` | (spec keywords) | do not exist in RUNNER code; `gapScale` exists only as an internal planner hop option (0.6 for SKY_STEPS), not a JSON field | **NOT SUPPORTED (JSON)** |

---

## 14. Playability protection (§17) and verification results

What actually protects playability:

1. **Planner-side physics** (course pipeline): landings clamped to `maxRise`/`MAX_LEVEL`; holes sized from the
   *actual flight's* airtime minus a 0.14-beat margin; every landing ≥ 0.104 units; flip destinations get an
   auto plate; terrain never exceeds 0.27 above the live surface; corridor headroom ≥ ≈0.2595; height carry-over
   between phrases descends as a real drop.
2. **Offline validators** (CI): analytical per-pattern feasibility at intensities 0.2/0.55/0.9 with jump
   grouping and a 0.10-beat comfort floor; full flight simulation of every course (`traversalSim`, real player
   physics, autopilot, 8 issue kinds); structural audit (`courseAudit`, 15 issue kinds incl. `GAP_TOO_WIDE`,
   `UNREACHABLE_JUMP`, `TIGHT_WINDOW`, `SPAWN_OVERLAP`, `FLAT_ENERGETIC_PHRASE`); seeded procedural courses at
   90/120/150 BPM × seeds 1/7/13 with determinism and seed-variety checks.
3. **Runtime fairness: none specific to RUNNER.** `TUNING.fairness` floors (0.6 s) target telegraphed hazards;
   RUNNER hazards carry no telegraph. **No runtime jump-feasibility guarantee exists at play time** — JSON that
   beats the clamps (e.g. R02 `width ≥ 1.55`) runs as an impossible gap. The guarantee lives in loader
   validation + CI tools, not in `RunnerMode`.

**Audit-time verification** (`npm run runner-check`, executed during this audit):
- Patterns: 25/25 `ok`, 0 impossible, 0 tight (intensities 0.2/0.55/0.9).
- Courses: 15/15 `fly as planned` (0 flight or shape issues); NOTE-level empty-stretch warnings only.
- Procedural: 9/9 ok (3 tempos × 3 seeds), deterministic per seed, seeds compose distinct courses.

---

## 15. Dangerous / impossible / conditional combinations

- **IMPOSSIBLE — R02 gap with `width ≳ 1.55`** (intensity 0) / **≥ ~1.35** (intensity 1.0): clamped width 0.22
  > max safe full-jump gap 0.2106. (`GapMechanic` clamp vs `maxGapWidth(1)`.)
- **IMPOSSIBLE — contradictory state demands**: e.g. spikes so close the arc cannot span them *and* the player
  cannot land between (runner-check IMPOSSIBLE class: "no single jump covers it, and they are too close to land
  between"). Library patterns avoid these; hand-written JSON can produce them.
- **HIGH RISK — R02 width ~1.3–1.55**: gap fits only with a frame-perfect take-off (slack < `COMFORT_BEATS 0.10`).
- **HIGH RISK — spike immediately at a landing point**: a landing consumes the whole arc; a spike within
  ~0.21 beats after the landing beat of a planned jump has no answer (landing is exact-face; buffer/coyote do not
  help once grounded).
- **HIGH RISK — pad arc into a ceiling obstacle**: apex = 0.32·s²; s = 1.35 → 0.583 > the 0.44 floor-ceiling
  span. Any ceiling hazard inside the pad arc is unavoidable.
- **CONDITIONAL — gravity flip then immediate gap**: course flips auto-emit a 2.4-beat plate (planned flips are
  safe); pattern-mode R09 inverts the player onto the base line — if a floor R02 gap is live there, the player
  falls through. Manual flip over a hole is the same trap.
- **CONDITIONAL — overlapping R09 zones**: the *last active* gravity mechanic wins
  (`currentGravityDirection` iterates the spawn list); two R09s closer than 4+2 beats flip the player back
  sooner than either portal's visuals suggest.
- **SELF-PROTECTING — DOUBLE_JUMP_MOUNT from a raised start**: the planner falls back to a plain mount above
  `CORRIDOR_WALK 0.05` start level instead of emitting an impossible block.

---

## 16. Playability envelope summary (machine values also in the catalog JSON)

```json
{
  "safe_generation_bounds": {
    "min_reaction_seconds": 1.2,
    "min_reaction_seconds_note": "3.0 beats from field edge to player; 1.2 s at 150 BPM, 1.5 s at 120, 2.0 s at 90; formula 180/BPM s",
    "max_jumpable_gap_default_speed_units": 0.2106,
    "max_jumpable_gap_with_double_jump_units": 0.2445,
    "max_jumpable_gap_with_pad_1_35_units": 0.2971,
    "max_jumpable_gap_absolute_units": 0.247,
    "max_step_up_units": 0.27,
    "max_step_up_note": "single-jump planner cap MAX_LEVEL 0.27 (physical 0.3008, apex 0.32); DOUBLE_JUMP_MOUNT block 0.34; combined double-jump apex 0.45",
    "max_step_down_units": 0.27,
    "max_step_down_note": "planner floor MIN_LEVEL 0; any drop depth survivable if the target has support; drop time = 0.475*sqrt(depth/0.32) beats",
    "min_obstacle_spacing_beats": 1.0,
    "min_obstacle_spacing_note": "for independent jump demands; 0.5-beat spacing valid only as a one-jump-spanning group; take-off comfort floor 0.10 beats",
    "gravity_flip_min_spacing_beats": 2.0,
    "gravity_flip_min_spacing_note": "no runtime clamp; 2 beats = observed planner minimum inside GRAVITY_ZIGZAG; legacy R09 imposes 4+2 beats",
    "min_landing_width_units": 0.104,
    "max_authored_gap_width_units": 0.22,
    "max_authored_gap_width_note": "R02 clamp ceiling EXCEEDS max_jumpable_gap_default_speed — do not exceed 0.21 units (width param <= ~1.5)"
  }
}
```

---

## 17. Music-design affinity (capability classification only)

| Primitive | Strong beat | Quarter pulse | Eighth seq | Melody contour | Phrase boundary | Build | Drop | Sustained |
|---|---|---|---|---|---|---|---|---|
| R01 Spike | YES (tag BEAT) | YES (half-beat groups) | — | — | — | YES | YES | — |
| R02 Gap | YES | — | — | — | — | YES | YES | — |
| R03 Low Wall | YES | — | — | — | — | — | — | YES (posture) |
| R04 Platform | YES | YES (step chains) | — | YES (staircase contours) | YES (landings) | YES | — | YES |
| R08 Pad | YES (STRONG_BEAT) | — | — | — | — | YES | YES (on-beat launches) | — |
| R09 Flip | YES (DOWNBEAT) | — | — | — | YES (section-scale inversion) | YES (BUILD) | YES (DROP/CHORUS) | — |
| Course verbs | GROUND_RUN on beat | QUICK_HOP/DOUBLE_HOP | TRIPLE_HOP, SYNCOPATED_HOPS | STAIRCASE_*, PLATFORM_ASCENT/DESCENT, SKY_STEPS | archetype roles INTRO/RELEASE | BURST, CLIMB_AND_DROP | FLIP, GAP_RUN, WAVE | RELEASE_RUN, GROOVE runs |

Role dramaturgy is built in (`ROLE_ARCHETYPES` + composer loudness reshape: CLIMAX ×1.25, INTRO ×0.7,
RELEASE ×0.6, DESCENT/RELEASE ≤0.4).

---

## 18. Real JSON examples (parser-accepted shapes)

### Pattern pipeline — minimal mechanic event (inside a pattern in patterns JSON)

```json
{ "at": { "bar": 1, "beat": 1 }, "mechanicId": "R01", "params": { "height": 1.0 } }
```

### Pattern pipeline — advanced (fractional beat, surface, role)

```json
{
  "at": { "bar": 2, "beat": 1.5, "offsetBeats": 0.25 },
  "mechanicId": "R03",
  "params": { "clearance": 0.6, "surface": "CEILING" },
  "role": "BOTH"
}
```

### Level JSON — pattern-based RUNNER section (minimal)

```json
{
  "version": "1.0.0",
  "song": { "id": "s1", "audio": "audio/x.wav", "bpm": 120, "timeSignature": [4, 4] },
  "sections": [
    {
      "id": "R1", "mode": "RUNNER", "startBar": 1, "lengthBars": 4, "difficulty": 2,
      "patterns": [ { "patternId": "RP01", "repeat": 2, "intensity": 0.5 } ]
    }
  ]
}
```

### Level JSON — course section (minimal authored)

```json
{
  "id": "RC1", "mode": "RUNNER", "startBar": 1, "lengthBars": 8,
  "patterns": [],
  "course": {
    "phraseBeats": 4,
    "phrases": [ { "archetype": "GROOVE", "beats": 4, "intensity": 0.5, "motif": "drive" } ]
  }
}
```

### Level JSON — course phrase, explicit verbs + inversion (advanced)

```json
{
  "archetype": "FLIP", "role": "CLIMAX", "beats": 8, "intensity": 0.8, "motif": "invert",
  "inverted": true,
  "verbs": ["CEILING_HOP", "INVERTED_PLATFORM_CHAIN", "GRAVITY_FLIP_DOWN"]
}
```

### Level JSON — procedural course (what runner_procedural.level.json uses)

```json
{ "id": "RP1", "mode": "RUNNER", "startBar": 1, "lengthBars": 16, "difficulty": 3,
  "patterns": [],
  "course": { "generate": { "beats": 64, "seed": 7, "intensity": 0.6 } } }
```

Course JSON does **not** author slabs/spikes directly — terrain is compiled from verbs. Terrain demands
(`SLAB/GAP/PAD/AIRJUMP`) are internal to the planner/trajectory and unreachable from level JSON.

---

## 19. Dead / unreachable / metadata-only register

| Item | File | Status |
|---|---|---|
| `HazardDemand.kind: 'SAW'` | src/mechanics/runner/trajectory.ts:88 | **DEAD** — declared, never emitted by the planner or any mechanic |
| `CourseWorld.activeSurface()` (answers `gravityAt(0)`) | src/mechanics/runner/courseWorld.ts | **DEAD** — no consumer; `RunnerCourseMechanic.activeSurface` (beat-current) is what the capability layer reaches |
| `RUNNER_UNITS_PER_BEAT` export | src/modes/runner/RunnerMode.ts | **DEAD EXPORT** — no importer |
| `TUNING.runner.gravityTelegraphBeats` | src/tuning.ts | **DEAD KNOB** — zero consumers |
| mechanic ids `R05`, `R06`, `R07` | — | **ABSENT** (no library entry, no implementation, no reference) — numbering gap, not removed code |
| section `difficulty` (RUNNER), pattern `maxSimultaneousThreats`, `requiresMechanics`, mechanic `musicTags`/`playerSkills`/`compatibility`, pattern difficulty sub-scores | library/level JSON | **METADATA ONLY** — no RUNNER runtime consumer (§13) |

---

## 20. Known risks

1. R02 authored width can exceed the jump envelope — clamp authored gaps to ≤ 0.21 units (width ≤ ~1.5).
2. Pad strength ≥ 1.35 leaves the 0.44 field span — never combine with ceiling hazards inside the arc.
3. No runtime feasibility guard: pattern-mode JSON is only as safe as authoring + CI; courses are safe by
   construction.
4. `maxSimultaneousThreats` unenforced — stacking hazards on one beat is accepted by the runtime.
5. Gravity flips zero vertical velocity and teleport to the base line; the destination surface must be solid
   (courses guarantee it; pattern mode does not).
6. Manual flip (Shift/F) lets the player leave authored floor-only routes at will; CEILING-tagged hazards are
   only meaningful under an active inversion (surface filtering).

---

## 21. Completion self-check

- [x] Complete runtime call chain traced (§2, both pipelines)
- [x] All RUNNER primitives audited (§3, §6, §7)
- [x] Player physics extracted (§4, real constants)
- [x] Jump envelope computed (§5, from the real module)
- [x] Gravity audited (§4.1)
- [x] Speed/scroll audited (§8)
- [x] Collision audited (§11)
- [x] Pattern library audited (§12)
- [x] Sequencing audited (§9)
- [x] Reaction/readability quantified (§10)
- [x] Runtime safety audited (§14)
- [x] Dangerous combinations listed (§15)
- [x] Real JSON examples given (§18)
- [x] Machine-readable catalog output (`RUNNER_CAPABILITY_CATALOG.json`)
- [x] No code modified, no git operations

---

## RUNNER DESIGNER CHEAT SHEET

**Currently usable terrain**
- Pattern mode: R04 Platform (anchored block; face hurts, top standable; ≤0.045 auto-step), R02 Gap (floor hole 0.06–0.22 u).
- Course mode: anchored slabs, floating slabs (0.05 deep — corridors, walkways, roofs), holes (flight-sized), pads (strength 1.35), air-jump rings, flip gates with auto landing plates. Terrain is compiled from 33 verbs — never authored as raw geometry.

**Currently usable hazards**
- R01 Spike (0.04–0.16 tall, FLOOR/CEILING), R03 Low Wall (slide beam, clearance 0.062–0.14), course SPIKE and WALL (clearance-authored, walkway-relative). All 15 hp; no telegraph — the warning is the ~3-beat scroll-in.

**Currently usable movement modifiers**
- R09 Gravity Flip portal (sign-only gravityScale, 4-beat zone, 2-beat cooldown), course flip timeline (`inverted` per phrase; GRAVITY_FLIP_UP/DOWN/ZIGZAG), R08 Bounce Pad (strength 1–2), air-jump ring, manual flip key (Shift/F, grounded).

**Gravity capabilities**
- Two states (FLOOR/CEILING), exactly symmetric physics. Flip = instant snap to the far base line, velocity zeroed, coyote granted, air jump disarmed. Triggers: R09 zone, course phrase `inverted`, manual key. No runtime min-spacing — keep ≥2 beats (planner practice); never flip onto a hole in pattern mode.

**Speed capabilities**
- One speed: 0.26 units/beat, forever. BPM rescales seconds only. No speed events. NOT SUPPORTED: everything else.

**Best beat-sync mechanics**
- R01/R02/R08 on the beat (1-beat chains), QUICK_HOP/DOUBLE_HOP (half-beat), TRIPLE_HOP (1.5-beat bursts), pads on strong beats, R09 flips on section downbeats.

**Best phrase-level mechanics**
- Archetypes as musical roles (GROOVE teach, BURST climax, RELEASE exhale), STAIRCASE/PLATFORM_ASCENT contours, GAP_RUN builds, FLIP for section-scale drama, motifs for recurrence.

**Player physics summary**
- x fixed 0.22; scroll 0.26 u/beat; body 0.030×0.094 (slide 0.044); probe circle r 0.015; jump apex 0.32 / 0.95 beats; cut ×0.45; buffer 0.12 s; coyote 0.09 s; step-up 0.045; one air jump per take-off (scale 0.6374, +0.13 apex); slide = posture; fall-out = 15 dmg + reset to base line.

**Jump envelope**
- Full jump: 0.247 u far, clears ≤0.2106 u hole with margin, lands +0.27 in 0.663 beats. Tap (0.08 hold): apex 0.1435. Double: 0.45 apex, 1.0805 beats. Pad 1.35: 0.583 apex, 0.334 u. Fully symmetric inverted.

**Safe autogeneration bounds**
- reaction ≥ 3 beats (1.2 s @150 BPM); gaps ≤ 0.21 u; step-up ≤ 0.27 u per jump; step-down any (≤0.27 to floor); independent obstacles ≥ 1 beat apart (0.5 only as one-jump groups); flips ≥ 2 beats apart; landings ≥ 0.104 u wide; stay ≤ 0.27 above the live surface.

**Current hard limitations**
- No dash/wall-jump/drop-through/speed-change/moving-platform/slope. No runtime feasibility guard (pattern mode). Section difficulty does nothing in RUNNER. No R05/R06/R07. Ceiling gaps only in courses. Legacy pads floor-only.

**Known impossible/high-risk combinations**
- Gap width > ~1.5× (clamp 0.22 > envelope 0.2106) = IMPOSSIBLE; spike right on a landing beat = HIGH RISK; pad arc (≥1.35) into ceiling hazard = HIGH RISK; flip onto a hole (pattern mode) = fall; overlapping R09 zones = ambiguous flip order; unspanned spike clusters = IMPOSSIBLE.

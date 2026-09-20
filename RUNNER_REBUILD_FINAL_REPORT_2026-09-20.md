# BeatBound RUNNER — Definitive Rebuild Final Report

**Date:** 2026-09-20 · **Branch:** `evan-branch` · HEAD `1dfafed` unchanged · no git operations performed
**Status:** validator-clean **and** runtime-playtested. `npm test` passes end to end (exit 0) for the first time.

---

## A. Architecture

The pipeline is the inversion the spec demanded (§2/§3), and it is load-bearing
code, not documentation:

```
SONG/PHRASE → MOTIF → INTENDED MOTION → TRAJECTORY → TERRAIN → HAZARDS → TELEGRAPH → JUICE
```

| Stage | File |
|---|---|
| Motion language (32 verbs, 12 archetypes) | `src/mechanics/runner/motion.ts` |
| Intended motion → trajectory | `src/mechanics/runner/runnerPlanner.ts` |
| Trajectory model (contiguity invariant) | `src/mechanics/runner/trajectory.ts` |
| Physics — single source of truth | `src/mechanics/runner/runnerPhysics.ts` |
| Trajectory → terrain/hazards/world | `src/mechanics/runner/courseWorld.ts`, `courseSchedule.ts` |
| Terrain → runtime mechanic | `src/mechanics/runner/RunnerCourseMechanic.ts` |
| Collision probe | `src/mechanics/runner/terrainProbe.ts` |
| Autopilot flight sim (16 metrics) | `src/mechanics/runner/traversalSim.ts` |
| Structural audit (15 issue kinds) | `src/mechanics/runner/courseAudit.ts` |
| Vertical zones | `src/mechanics/runner/verticalZones.ts` |
| Load-time validation + procedural expansion | `src/core/LevelLoader.ts` |

"Player trajectory is the level" holds: `planCourse()` emits segments with
`endBeat === next.startBeat` and `endFeetY === next.startFeetY` (flips excepted
by definition), and every slab, gap, pad, ring and hazard downstream is derived
from a segment's demands. Procedural and authored courses run the identical
pipeline; there is no second runtime.

## B. Motion language

32 verbs in 12 archetypes (GROOVE, ASCENT, DESCENT, BOUNCE, WAVE,
CLIMB_AND_DROP, GAP_RUN, FLIP, INVERTED_GROOVE, CORRIDOR, BURST, RELEASE).
All gravity-relative: `GROUND_RUN` and `CEILING_RUN` are one code path. Verbs
declare a nominal slot (`VERB_INFO.beats`) but are budgeted by what they
actually build (`verbCost`) — a corridor that builds 2.19 beats fits 2.19
beats of room. New this phase: `DOUBLE_JUMP_MOUNT` (see F/D below).

Roles drive the dramaturgy (§22 I→R→V→C→R): `ROLE_ARCHETYPES` gates which
archetypes each role may draw, motifs recur visibly (per-motif phrase tint on
the running surface, deterministic colour from the motif name), and the
composer carries intensity through the arc (climax 1.25×, intro 0.7×, release
0.6×; DESCENT/RELEASE archetypes cap at 0.4 — calm shapes labelled calmly).

## C. Physics

`runnerPhysics.ts` is the only place a jump is defined: `jumpArc(strength,
hold)` with analytic cut-jump math (`apex`, `airBeats`, `heightAt`,
`beatsToRise`), airtime 0.95 beats at any BPM, `MIN_TAP_BEATS`-derived corridor
clearances, `maxGapWidthForAirtime`, `minLandingWidth`, `BEAM_CLEARANCE_BAND`.
The planner, the simulator, the audit and `runner-check` all read it, so none
can disagree with another about what a jump is. New: `DOUBLE_JUMP_LEVEL`
(0.34), `AIR_JUMP_APEX`, `AIR_JUMP_SCALE` (derived, not chosen) and
`doubleJumpArc()` — the piecewise combined arc (full jump → shorter mid-air
impulse) that the planner, audit and sim share.

## D. Trajectory / terrain model

Terrain is a consequence of motion. A landing emits a slab because feet need
somewhere to stand; a run raised onto a walkway asserts its ground (`ensureGround`);
a fall ends terrain at the height the player left (`clipFalls`, height-aware);
same-line geometry coalesces once, at the world boundary (`coalesceSlabs`).
World objects: slabs (floating plates and anchored blocks), gaps, pads, hazards
(spike/wall/saw), flip gates, phrase tints, and now air-jump rings.

**Double-jump blocks** (Geometry-Dash-orb semantics): a block face at
`DOUBLE_JUMP_LEVEL` 0.34 is past the single-jump apex (0.32) — one jump cannot
land it. The paired ring sits at the first arc's apex; passing it arms exactly
one mid-air press (`RunnerPlayer.armAirJump`, disarmed on landing and flips);
the second press applies the `AIR_JUMP_SCALE`-scaled impulse, flying the same
`doubleJumpArc()` the plan and sim fly. No ring → no air jump → every existing
level is untouched. Demo: `runner_test_12_double_jump.level.json`.

## E. Inverted / gravity gameplay

The ceiling is a route: flips are phrase-boundary events charged to the phrase
that asks for them, inverted chains hang into the field, corridors thread
between the surfaces. Zones are measured in absolute field space (the ceiling
route stays visible in every metric), while the *flatness* predicate is
surface-relative — a phrase glued to the ceiling is as flat as one glued to the
floor, and an inverted hop chain reaching into the field is the opposite of
flat. The composer writes flips as explicit pairs (ceiling phrase + floor
return) so truncation can never strand a course on the far surface.

## F. Procedural composition

`composeCourse()` is reconnected (spec §44–§48). A level section may declare
`course.generate { beats, seed, intensity, phraseBeats }`; LevelLoader expands
it deterministically at compile time through the same phrase composer the
validator tests, and everything downstream — validation, planning, world,
runtime — is identical to authored levels. Anti-repetition (re-roll on repeat),
anti-chaos (motif memory, role-gated archetypes), controlled randomness (seeded
`makeRng`). Proven by the seeded block in `runner-check` and by the live
`runner_procedural.level.json` (seed 7, 100 BPM).

## G. Validation

| Validator | Proves |
|---|---|
| `npm run typecheck` | the code is the type story |
| `npm run test:timing` | 23 mechanics have runtimes; 65 patterns schedule/run/retire; every library level loads |
| `npm run audit` | no ARENA section is beatable by standing still |
| `npm run runner-check` | 25 RUNNER patterns clearable; **14 courses** fly as planned with zero structural issues; **9 seeded courses at 90/120/150 BPM** fly, compose deterministically, differ by seed; contiguity inline |
| `npm run fairness` | all ARENA patterns readable |
| `tools/__contig.ts` | trajectory beat+y contiguity, whole library (0 violations) |
| `tools/__hole.ts` | no grounded run crosses an uncovered hole |

FLAT_ENERGETIC_PHRASE policy (final): zones are absolute (route visibility);
flatness is surface-relative (`surfaceSideRatio` ≥ 0.7 at intensity ≥ 0.45,
flipping phrases exempt); drills encode calm phrases with sub-energetic
intensity; showcase content is authored energetic. No level names in the
validator, no thresholds lowered.

## H. Showcase and micro levels

- `runner_showcase` — 26 phrases / 120 beats / 9-part structure: groove intro,
  bounce, climb & drop, wave, gaps, FLIP climax pair, corridors (incl. the
  re-authored @84 corridor suite), burst, three-phrase release.
- `runner_test_01…11` — one design problem each (basic chain, short-short-long,
  staircase, high/low, gaps, drop & jump, gravity flips, inverted chains,
  corridors, dense phrases, mixed).
- `runner_test_12_double_jump` — isolates the double-jump mount: approach,
  three mounts with recoveries, groove, release.
- `runner_procedural` — the composer's live calling card (seed 7).

## I. Playtest findings (real runtime: vite + browser automation)

- The showcase boots through the real LevelLoader into RUNNER: terrain, phrase
  tints, HP, hits and jump input all behave; a run survived to bar 24 with the
  player landing on raised slabs and hazards draining HP on mistakes.
- test_12 live: takeoff → ring → second press lifted the player to the block
  face with jump particles firing (`jumps:1 air`); no errors.
- Environment artifact (not a game bug): the embedded automation browser
  suspends rAF between calls and the game auto-pauses ("rendering stalled —
  press P"); a real browser session is unaffected.
- Corridor lesson found live and encoded in authoring: a corridor/window exit
  is always followed by grounded content — a fall directly after one lands one
  frame past the walkway edge (`MISSED_LANDING`).

## J. Remaining limitations (genuine, deferred)

1. Corridor exit adjacency is an authoring convention, not yet a validator check.
2. Fill-from-archetype (phrases that fall quiet early) awaits world-layer
   support for inter-verb roof/walkway/slab interactions.
3. The dropped-verb census needs verb-identity semantics (derived segment names
   like GAP_JUMP→LONG_GAP count as false drops today).
4. RunnerDebug phrase readout covers courses; pattern-lab sections report `-`.
5. Multi-BPM is validated headlessly at 90/120/150; a human feel-pass at
   extreme tempos is still worth doing.
6. Editor UI authoring for `DOUBLE_JUMP_MOUNT`/rings (the data path is done;
   the editor is a parallel workstream).

## K. Final command results

```
npm run typecheck    PASS (exit 0)
npm run test:timing  PASS — 23 mechanics, 65 patterns, all levels load
npm run audit        PASS — no ARENA section beatable by standing still
npm run runner-check PASS — 25/25 patterns · 14/14 courses · 9/9 seeded courses (90/120/150 BPM)
                       contiguity 0 · empty sections 0 · flight issues 0 · structural issues 0
npm run fairness     PASS — all ARENA patterns readable
npm test             PASS (exit 0) — full chain, first time
```

Significant files this phase: `src/mechanics/runner/{verticalZones,courseAudit,
runnerPlanner,trajectory,runnerPhysics,courseWorld,RunnerCourseMechanic,motion}.ts`,
`src/core/{types,LevelLoader}.ts`, `src/modes/runner/{RunnerMode,RunnerPlayer,
RunnerDebug}.ts`, `tools/runner-check.ts`, `beatbound_library_v1/
runner_{showcase,test_03_staircase,test_06_drop_and_jump,test_12_double_jump,
procedural}.level.json`, `beatbound_library_v1/levels.index.json`,
`RUNNER_CHECKPOINT_2026-09-20.md`. Scratch tools reduced by 192 deletions.

# RUNNER Checkpoint — 2026-09-20

Pause point for the RUNNER "Definitive Rebuild" task (prompt:
`prompt/BeatBound_Runner_Definitive_Rebuild_Ultracode.md`).

**No git operations were performed.** No commit, push, reset, restore, checkout,
clean, stash, merge or rebase. No ARENA or EDITOR file was modified, reverted or
reconciled. The working tree is exactly as it was when work stopped, plus this
report.

- Workspace: `C:\Users\44977\Desktop\BB`
- Branch: `evan-branch`
- HEAD: `1dfafed` ("game polish 0919 and editor v0.1") — unchanged

---

## 1. What is fully completed

### 1.1 The architectural inversion (spec §2, §3)

The pipeline is now `SONG/PHRASE → MOTIF → INTENDED MOTION → TRAJECTORY →
TERRAIN → HAZARDS → TELEGRAPH → JUICE`, and it is real code, not a document:

| Stage | File |
|---|---|
| Motion language (31 verbs, 12 archetypes) | `src/mechanics/runner/motion.ts` |
| Intended motion → trajectory | `src/mechanics/runner/runnerPlanner.ts` |
| Trajectory model | `src/mechanics/runner/trajectory.ts` |
| Trajectory → terrain + hazards | `src/mechanics/runner/courseWorld.ts`, `courseSchedule.ts` |
| Terrain → runtime mechanic | `src/mechanics/runner/RunnerCourseMechanic.ts` |
| Collision probe | `src/mechanics/runner/terrainProbe.ts` |

"Player trajectory is the level" holds: `planCourse()` emits `TrajectorySegment`s
with the contiguity invariant (`endBeat === next.startBeat`,
`endFeetY === next.startFeetY`), and every slab, gap, pad and hazard downstream is
*derived* from a segment's `demands`/`hazards`.

### 1.2 Shared physics (spec §8)

`src/mechanics/runner/runnerPhysics.ts` is the single source of truth for jump
arcs, airtime, apex, `holdForApex`, `maxRise`, `minLandingWidth`,
`maxGapWidthForAirtime`, `BEAM_CLEARANCE_BAND`. The planner, the traversal
simulator, the audit and `tools/runner-check.ts` all read it, so no two of them
can disagree about what a jump is.

Verified numbers (via scratch probe, deleted from the deliverable set):
`apexForHold(Infinity) = 0.3200`; feet at apex from the floor line `0.4000`;
head at apex `0.3060` against the ceiling line `0.28`; airtime always
`0.95` beats regardless of BPM.

### 1.3 Vertical zones (spec §9) — new this session

`src/mechanics/runner/verticalZones.ts` (141 lines). Five equal fifths of the
playable span between the two track lines: `BOTTOM LOW MID HIGH CEILING`.
Measured **in the field**, not from the live surface — otherwise an inverted
phrase reports identically to a floor phrase and the mode's most distinctive
idea (the ceiling is a route) becomes invisible to the validator.

Wired into four places:
- `traversalSim.ts` — samples the player's real feet every `BEAT_STEP`
- `trajectory.ts` — `TrajectoryPhrase.intensity` carried through
- `courseAudit.ts` — new issue kind `FLAT_ENERGETIC_PHRASE` (mode 15)
- `tools/runner-check.ts` — a `zones:` line per course

### 1.4 Showcase + micro levels (spec §27, §28)

- `beatbound_library_v1/runner_showcase.level.json` — 26 phrases, 120 beats,
  registered in `levels.index.json` as `runner_showcase` / "Runner Showcase".
- `runner_test_01_basic_chain` … `runner_test_11_mixed_showcase` — 11 micro
  levels, all registered in `levels.index.json`, all loading and scheduling.

### 1.5 Validation tooling (spec §29–§32)

- `src/mechanics/runner/traversalSim.ts` — deterministic lightweight autopilot
  flying the real physics; reports 16 diagnostic metrics.
- `src/mechanics/runner/courseAudit.ts` — structural audit, 15 issue kinds.
- `tools/runner-check.ts` — **extended**, not duplicated (spec §29). Pattern
  half (25 RUNNER patterns, analytic windows) + course half (12 courses, fly +
  audit + metrics + zones).
- `tools/course-dump.ts` — human-readable course dump.
- `src/modes/runner/RunnerDebug.ts` — developer debug view.

---

## 2. Bugs fixed

| # | Bug | Fix |
|---|---|---|
| 1 | **16 × `SPAWN_OVERLAP`** (test_07 ×12, test_11 ×4). The gravity-flip landing plate at level 0 was emitted as an *anchored* slab, so `faceY === backY === base line` and `coalesceSlabs`'s `sameLine` (which requires **both** faces to agree) refused to merge it with the run's floating plate. | Emitted as a forced plate: `slab(to, state.beat + FLIP_BEATS, 0, 2.4, true, true)` in `runnerPlanner.ts`. |
| 2 | **test_08 `MISSED_LANDING @23.75` + `LANDING_TOO_NARROW @23.66`.** A `CEILING_HOP` (`MEDIUM_JUMP`) landing at level 0.180 emitted no slab because `landOnSlab` was false, so the player landed on the base line instead of the planned platform. | Landing-slab invariant in `hop()`: `if (opts.landOnSlab \|\| endLevel > 0.001) pushSlab(...)`. |
| 3 | **test_04 `FLIGHT_DID_NOT_SETTLE @32.00`.** The sim loop stopped at `endBeat + 0.25`; a flight that begins at the last possible beat lands a frame past `endBeat`. | 1.5-beat settle tail in `traversalSim.ts`, with metric accumulation gated to `beat <= endBeat + BEAT_STEP` so the tail cannot dilute the ratios. |
| 4 | **`R-Tok` label collision** in `runner-check.ts` output. `padEnd(46)` was narrower than the longest label (49 chars). | `padEnd(52)`. |
| 5 | **Zone sampling inverted** — `zoneOfY` indexed `VERTICAL_ZONES[clamped]` where `clamped` counted down from the ceiling, so BOTTOM and CEILING were swapped. | `VERTICAL_ZONES[VERTICAL_ZONES.length - 1 - clamped]`. Verified: `0.28→CEILING, 0.40→HIGH, 0.50→MID, 0.60→LOW, 0.72→BOTTOM`. |
| 6 | **Zone check over-reporting, twice.** (a) a 0.25-beat sampling grid stepped over sub-beat hop segments and called them flat → switched to per-segment sampling; (b) sampling a flight at the midpoint of take-off/landing heights averaged every symmetric hop back to the base line → switched to sampling at the **apex**. | Took test_01 and test_02 from 3 and 4 issues to `ok`. |
| 7 | **TS6133** `'world' is declared but its value is never read` in `checkPhraseZones`. | Parameter removed, call site updated. |

**Status after fixes 1–3 and 7:** `tools/runner-check.ts` printed
`12 course(s) fly as planned.` — i.e. the *world geometry* is clean and every
course is flyable. That is the state to return to for the flight/audit half.

---

## 3. Validators/tests added or changed

- `tools/runner-check.ts` — **+163 lines**: the whole course half (fly + audit +
  metrics + zones), `describeZones` import, `padEnd(52)`, and the `zones:` row.
- `src/mechanics/runner/courseAudit.ts` — `checkPhraseZones()` and the
  `EMPTY_SECTION` / `FLAT_ENERGETIC_PHRASE` issue kinds.
- `src/mechanics/runner/traversalSim.ts` — `TraversalMetrics.zones: ZoneUsage`,
  the settle tail, gated accumulation, per-beat zone sampling.
- `src/mechanics/runner/verticalZones.ts` — new; `BOTTOM_HEAVY_LIMIT = 0.7`,
  `ENERGETIC_INTENSITY = 0.45`.
- `src/mechanics/runner/trajectory.ts` — `TrajectoryPhrase.intensity`.

No ARENA, VERTICAL or RADIAL validator was touched.

---

## 4. Exact validation commands already run, and results

| Command | Result |
|---|---|
| `npm run typecheck` (`tsc --noEmit`) | **EXIT 0 — passes** |
| `npm run test:timing` (`tools/sync-test.ts`) | **EXIT 0 — passes.** All timing checks passed; 23/23 mechanics have a runtime; all 65 patterns schedule/run/retire; all 20 library levels load. |
| `npm run audit` (`tools/camp-audit.ts`) | **EXIT 0 — passes.** "No ARENA section can be beaten by standing still." |
| `npm run runner-check` | **EXIT 1 — FAILS.** See §5. |
| `npm run fairness` (`tools/fairness-check.ts`) | **EXIT 0 — passes.** "All 20 ARENA patterns are readable." |
| `npm test` (all five chained) | **FAILS at step 4** (`runner-check`), which is why the chain stops there. |

Pattern half of `runner-check` is **fully green**: all 25 RUNNER patterns
(`RP01`…`RP25`) report `ok` — "Every RUNNER pattern is clearable."

Course half: **12 courses, 14 issues, all of them the single new check.**
All 12 courses are flyable; zero flight issues, zero structural issues other
than `FLAT_ENERGETIC_PHRASE`.

---

## 5. Current unresolved issue — the high-severity one under investigation

**`FLAT_ENERGETIC_PHRASE` (audit mode 15) fires 14 times across 8 courses.**

```
runner_test_03_staircase      @12.00 (45%) @20.00 (50%)
runner_test_04_high_low       @16.00 (50%)
runner_test_06_drop_and_jump  @16.00 (50%) @20.00 (50%)
runner_test_08_inverted_chain @ 8.00 (45%) @20.00 (55%)
runner_test_09_vertical_corridor @8.00 (50%) @16.00 (60%) @24.00 (70%)
runner_test_11_mixed_showcase @12.00 (50%)
runner_showcase               @28.00 (50%) @36.00 (50%) @84.00 (85%)
```

**Root cause is now diagnosed, and it is a real planner defect, not a
threshold problem.** The investigation reached this conclusion:

The zone ratios are being measured on `trajectory.phrases[i].segments`, and
**`planPhrase` prepends the previous phrase's height carry-over to the *next*
phrase's segment list.** When a phrase ends raised (a staircase top, an ascent
top, a corridor walkway, a `HIGH_LOW_ALTERNATION` high landing), the following
phrase opens with a `PLATFORM_DESCENT`/`DROP` that it did not author. That
descent belongs to the *boundary*, but it is counted inside the following
phrase — and worse, it consumes the phrase's whole budget.

Measured proof (scratch probe, `tools/__ckpt.ts`):

```
runner_test_09 @ 8  TOP_BOTTOM_CORRIDOR   entryLevel=0.050 → got ["DROP","GROUND_RUN"]
runner_test_09 @16  TOP_BOTTOM_CORRIDOR   entryLevel=0.050 → got ["DROP","GROUND_RUN"]
runner_test_09 @24  TOP_BOTTOM_CORRIDOR   entryLevel=0.050 → got ["DROP","GROUND_RUN"]
runner_test_04 @16  HIGH_LOW_ALTERNATION  entryLevel=0.270 → got ["DROP","GROUND_RUN"]
runner_test_06 @20  PLATFORM_ASCENT       entryLevel=0.040 → got ["DROP","GROUND_RUN"]
runner_showcase @28 STAIRCASE_DOWN        entryLevel=0.240 → got ["DROP","GROUND_RUN"]
runner_showcase @36 HIGH_LOW_ALTERNATION  entryLevel=0.270 → got ["DROP","GROUND_RUN"]
```

`entryLevel=0.270` means the phrase was handed a player standing at the top of
the field, and `planPhrase`'s descent block (`runnerPlanner.ts:1194-1204`) spent
the entire 4-beat budget coming down. The authored verb list was then never
reached.

**Library-wide count: 74 authored verbs are silently dropped** by this path —
including `TOP_BOTTOM_CORRIDOR`, `TIGHT_VERTICAL_WINDOW`,
`HIGH_LOW_ALTERNATION`, `PLATFORM_ASCENT`, `PLATFORM_DESCENT`,
`STAIRCASE_DOWN`, `GAP_JUMP`, `CEILING_HOP`, `RELEASE_RUN`,
`LAND_AND_IMMEDIATE_REJUMP` and `GRAVITY_ZIGZAG`. This is the *same defect*
behind the 85%-intensity showcase climax at `@84` degenerating to
`["DROP","PLATFORM_HOP_CHAIN","LONG_JUMP","GROUND_RUN", GROUND_RUN ×6.31 beats]`
— 81% bottom-heavy because 6.31 of its 8 beats are the settle run.

Two secondary contributing defects found alongside it:

1. **`ARCHETYPE_VERBS` shape lengths do not match the phrase budget.**
   `DESCENT` totals 6 beats, `INVERTED_GROOVE` 7, `CORRIDOR` 8, `FLIP` 6 — but
   `verbsFor` fills only until `beats` is reached, so any phrase shorter than its
   archetype's shape truncates the tail verb. `RELEASE` (2 beats) truncates
   under `GROUND_RUN`, and `GAP_RUN`'s `GAP_JUMP` is dropped whenever
   `LONG_GAP` already filled the budget.
2. **`hop()`'s `landOnSlab` invariant** (fix #2 above) is correct but means a
   descent emitted by the boundary path leaves a slab the next phrase then has
   to step off — worth re-checking once the boundary path is fixed.

**Decision not yet made:** whether `FLAT_ENERGETIC_PHRASE` stays fatal, becomes a
warning for single-idea drills (spec §28: "Each level isolates exactly one design
problem"), or is scoped to multi-archetype courses. This decision is now
*downstream* of the planner fix — once the boundary descent stops eating the
budget, most of these 14 are expected to clear on their own, and the policy
question only needs answering for the genuinely flat drills (test_09) and for
`runner_showcase @84`.

---

## 6. Partially implemented

- **Procedural composer reconnection (spec §44–§48).** `composeCourse()` exists in
  `runnerPlanner.ts:1371` and is exercised only by scratch probes; it has **no
  production caller**. It does not yet use `ROLE_ARCHETYPES` per-motif, and it
  does not carry `intensity` into the audit meaningfully. Deliberately deferred —
  spec §44 says reconnect only after the showcase works.
- **`RunnerDebug.ts` has no zone readout.** The `zones:` metrics exist on
  `TraversalMetrics` but are not surfaced in the developer debug view (spec §63).
- **Multi-BPM validation (spec §52, §67).** `runner-check` validates at each
  level's own `bpm` only. Seeded generations at slow/medium/high BPM have not
  been run.
- **§33 empty-space rule.** `maxEmptyScreenBeats` is measured and surfaced as a
  `NOTE`, but not yet enforced as an issue kind.

---

## 7. Known unresolved issues (full list)

| # | Severity | Issue |
|---|---|---|
| 1 | **High** | Boundary-descent budget consumption (see §5) — 74 authored verbs dropped library-wide, 14 `FLAT_ENERGETIC_PHRASE` failures, showcase climax degenerate. |
| 2 | Medium | `FLAT_ENERGETIC_PHRASE` verdict policy undecided (fatal vs warning vs scoped). |
| 3 | Medium | `ARCHETYPE_VERBS` shape totals exceed common phrase budgets → tail verbs truncated. |
| 4 | Low | `runner_showcase` `@84` climax: 6.31 of 8 beats are settle-run. |
| 5 | Low | `RunnerDebug.ts` has no zone readout. |
| 6 | Low | `composeCourse` has no caller; §44–§48 not reconnected. |
| 7 | Low | No multi-BPM validation path in `runner-check`. |
| 8 | Low | 166 scratch tool files in `tools/` (see §8) — should be deleted before the final report, **not** by this checkpoint. |
| 9 | Info | Bare full-hold jump from the base line puts the head at `0.3060` vs ceiling line `0.28`. **Benign and re-verified this session**: the base line has no roof so there is nothing to bonk; `MAX_LEVEL = ASCENT_LEVEL = 0.27` is exactly the cap that keeps a *platform-raised* head below the ceiling line, which is the case that matters. `RunnerMode.ts:144-152` does implement head collision (`probe.blocker` → `result.bonked` → particle cue), and `courseAudit.ts`'s mode-5 `CEILING_IN_ARC` check uses a swept overlap test, not an apex-height comparison. **Not a defect.** |

---

## 8. Files modified / created by the RUNNER task

### New RUNNER source (untracked, all required)
```
src/mechanics/runner/PlatformMechanic.ts
src/mechanics/runner/RunnerCourseMechanic.ts
src/mechanics/runner/courseAudit.ts
src/mechanics/runner/courseSchedule.ts
src/mechanics/runner/courseWorld.ts
src/mechanics/runner/motion.ts
src/mechanics/runner/runnerPhysics.ts
src/mechanics/runner/runnerPlanner.ts
src/mechanics/runner/terrainProbe.ts
src/mechanics/runner/trajectory.ts
src/mechanics/runner/traversalSim.ts
src/mechanics/runner/verticalZones.ts
src/modes/runner/RunnerDebug.ts
tools/course-dump.ts
```

### Modified RUNNER source
```
src/mechanics/runner/GapMechanic.ts
src/mechanics/runner/SpikeMechanic.ts
src/mechanics/runner/index.ts
src/modes/runner/RunnerMode.ts      (+189/-…)
src/modes/runner/RunnerPlayer.ts    (+245/-…)
tools/runner-check.ts               (+163/-…)
```

### New RUNNER levels (untracked)
```
beatbound_library_v1/runner_showcase.level.json
beatbound_library_v1/runner_test_01_basic_chain.level.json
beatbound_library_v1/runner_test_02_short_short_long.level.json
beatbound_library_v1/runner_test_03_staircase.level.json
beatbound_library_v1/runner_test_04_high_low.level.json
beatbound_library_v1/runner_test_05_gap_chain.level.json
beatbound_library_v1/runner_test_06_drop_and_jump.level.json
beatbound_library_v1/runner_test_07_gravity_flip.level.json
beatbound_library_v1/runner_test_08_inverted_chain.level.json
beatbound_library_v1/runner_test_09_vertical_corridor.level.json
beatbound_library_v1/runner_test_10_dense_phrase.level.json
beatbound_library_v1/runner_test_11_mixed_showcase.level.json
```

### Scratch / diagnostic files created during investigation (untracked)
166 files matching `tools/__*.ts`, `tools/.tmp-*.ts`, `tools/tmp-*.ts`,
`tools/zz-*.ts`, `tools/.verify-*.ts`. All are throwaway probes. They should be
deleted before the §68 final report, but **this checkpoint deliberately deletes
nothing.**

### NOT touched by this task — do not revert
`src/mechanics/arena/*`, `editor/**`, `beatbound_library_v1/arena_test.level.json`,
`beatbound_library_v1/levels.index.json` (only the RUNNER entries were added;
other entries are ARENA/EDITOR work), `README.md`, `package.json`,
`src/tuning.ts`, `src/core/{Input,LevelLoader,MechanicRegistry,capabilities,types,controls,fairness}.ts`,
`src/game/BeatBoundGame.ts`, `src/modes/vertical/VerticalMode.ts`,
`tools/{level-report,sync-test,fairness-check}.ts`,
`beatbound_library_v1/{mechanics.mvp,patterns.mvp}.json`,
`beatbound_library_v1/{prototype_90s,dance_fruits_…,runner_test}.level.json`.

These are shared or belong to the parallel ARENA/EDITOR windows. The RUNNER
rebuild *depends* on some of them (notably `LevelLoader.ts`'s `validateCourse` /
`compileCourse` and `MechanicRegistry.ts`'s runtime registration), so they must
not be reverted.

---

## 9. Tests that still need to be run

1. `npm run runner-check` after the boundary-descent fix — expect the 14
   `FLAT_ENERGETIC_PHRASE` issues to fall to a small number, and
   `12 course(s) fly as planned.`
2. `npm test` (all five stages chained) — currently stops at stage 4.
3. Re-run the 74-dropped-verb census (`tools/__ckpt.ts`) — expect ~0.
4. Seeded `composeCourse` generations at slow/medium/high BPM (spec §52, §67).
5. A real playtest of `?level=runner_showcase.level.json` and each of the 11
   micro levels, to confirm the mode is *actually playable* and not merely
   validated (spec: "Do not stop because unit tests pass").
6. `npm run course-dump` on the showcase, to eyeball the 9-part structure.

---

## 10. Exact next implementation step when development resumes

**Fix the boundary-descent budget consumption in `planPhrase`
(`src/mechanics/runner/runnerPlanner.ts`, the block at lines 1194–1204).**

Today that block emits a `PLATFORM_DESCENT` from the carried-over level *inside
the new phrase's budget*, and when the entry level is high enough it consumes the
entire budget, so the phrase's authored verbs are never planned.

The fix is to make the boundary descent **its own segment group charged to the
boundary, not to the phrase** — i.e. plan the carry-over descent as a prelude
whose beats are subtracted from the phrase's *musical* window in a way that
still leaves room for at least one authored verb, or (preferred) plan the
descent with an explicit small budget cap and let the phrase's own verbs start
from the landed level rather than being starved. The invariant to preserve is the
existing one: `segments` stay contiguous in beat and in world y, and the phrase
still occupies exactly `beats`.

Concretely:
1. Read `runnerPlanner.ts:1153-1266` (`planPhrase`) and `runnerPlanner.ts:495-560`
   (`hop`).
2. Cap the descent's share of the budget so at least `verbBeats(verbs[0])`
   remains, and prefer a `DROP` (0.2–0.44 beats, free fall) over a full
   `PLATFORM_DESCENT` (4 beats) whenever the height allows it.
3. Re-run `npx tsx tools/__ckpt.ts` — the dropped-verb count must fall sharply.
4. Re-run `npm run runner-check`.
5. **Then** decide the `FLAT_ENERGETIC_PHRASE` policy on whatever genuinely-flat
   phrases remain (expected: test_09's floor drills, and possibly the showcase
   climax).

Then, in order: surface zones in `RunnerDebug.ts` → reconnect `composeCourse`
(§44–§48) → multi-BPM validation (§52) → delete the 166 scratch tools → write the
§68 final report (sections A–K) → update `memory/runner-rebuild-progress.md` and
the memory index.

---

## 11. Working-tree state after this checkpoint

Unchanged. No cleanup, no revert, no formatting. `git status --short` shows the
same 31 modified tracked files and the same untracked set as before the pause,
plus this report (`RUNNER_CHECKPOINT_2026-09-20.md`).

---

# CONTINUATION — planner correctness session, 2026-09-20 (later)

Took over from the handoff (`BeatBound_Runner_New_Agent_Handoff_2026-09-20.md`).
Target was RUNNER PLANNER CORRECTNESS only. No git operations. No Arena or
Editor files touched. Actual-cost budgeting (`verbCost`) is preserved and
untouched.

## Baseline reproduced before any edit

- `npm run typecheck` → EXIT 0
- `npx tsx tools/runner-check.ts` → **11 problems / 12 courses**
  - 5 `EMPTY_SECTION` (the handoff said 4; it had missed `showcase @0`):
    test_01 @0, test_02 @0, test_10 @0, showcase @0, showcase @109.25
  - 6 `FLAT_ENERGETIC_PHRASE`: test_03 @12/@20, test_06 @16, test_08 @8,
    showcase @28/@84
  - 9 contiguity violations (`tools/__contig.ts`), 0 hole crossings

## Root causes found and fixed

### 1. `airborneSeen` had verb scope, not phrase scope (the EMPTY_SECTION regression)

`planPhrase` reset `airborneSeen` inside the per-verb loop while the settle path
used phrase-wide history (`segments.some(s => s.airborne)`). With actual-cost
budgeting accepting the final short verb, no leftover reached the settle path,
so the forced ground slab it used to emit vanished — phrases of plain hops +
runs emitted **zero** world demands, and test_01 measured a single 20.25-beat
empty stretch (confirmed by trace: phrases 0–4 had `demands=0`).

**Fix:** `airborneSeen` is now declared once at phrase scope, seeded from the
prelude (entry flip + boundary descent), read by `ensureGround` in the verb loop
and by the settle path alike. Effect: a grounded run after any flight in the
phrase asserts the ground under itself (a floating plate at its line), which
`coalesceSlabs` merges — the world is visible again.

### 2. Trimmed verbs handed back the wrong state (3 of the contiguity violations)

When a verb was trimmed by the budget (`built > consumed`), `state` was set from
`result.next` — the end state of the *whole* verb — while the pushed segments
ended earlier. `INVERTED_PLATFORM_CHAIN` trimmed after 2 of 3 hops told the next
verb the player stood at level 0.18 when the trajectory ended at 0.12: a y
teleport at the verb boundary (`test_08` @16/@24, `test_11` @24).

**Fix:** on trim, state is derived from the last **pushed** segment
(`surface`/`level` from `levelOf(last)`), then the loop breaks (trim still ends
the phrase, as before).

### 3. `SYNCOPATED_HOPS` broke contiguity by construction (6 of the violations)

The second hop was staged at `a.next.beat + 0.5` — a deliberate 0.5-beat hole
in the trajectory (and an overlap against the following verb). A player cannot
take off in the middle of nothing.

**Fix:** the second hop chains from `a.next`; the syncopation comes from the
~0.83-beat airtime itself, which already lands off the beat grid.

### 4. The boundary prelude stole descent verbs' ideas (`test_03 @12`, `showcase @28`)

`STAIRCASE_DOWN` authored first in a phrase that entered raised: the prelude
drop spent the height, `stairs()` hit the floor and emitted *nothing* (its doc
promises a DROP fallback the code never had), and the phrase collapsed into a
3.6-beat settle run.

**Fix (two parts):** the prelude is skipped when the phrase *opens with* a
descent verb (`STAIRCASE_DOWN`/`PLATFORM_DESCENT`/`DROP`) — the authored descent
then plays from the carried height; and a verb that builds zero segments is
skipped instead of being treated as a budget refusal that strands the phrase.

### 5. `slideUnder` swallowed the whole budget (`showcase @84`)

The heavy CORRIDOR run took `budget` beats while every other run takes its
nominal slice (`min(budget, VERB_INFO.beats)`), letting one authored
`GROUND_RUN` turn the back half of the 8-beat climax into a single 6.31-beat
crawl under one beam.

**Fix:** the slide takes the same nominal slice as every other run.

### 6. `clipFalls` clipped terrain at the wrong height (exposed by fix 4)

`clipFalls` cut *every* slab on a surface at each fall's take-off beat, but a
fall only ends the ground at the height the player **left**. A drop's landing
slab reaches half its width back before the landing beat, so it spanned the
take-off instant too and was amputated from the landing — leaving a 0.2-beat
fragment (`LANDING_TOO_NARROW @12.29` in `test_06` once real fall chains
existed; before, all drops were zero-depth and skipped).

**Fix:** `clipFalls` records each fall's departure y and only clips slabs whose
face matches it. The original ledge/hole semantics are unchanged (those slabs
are at the departure height by definition).

### Tried and reverted: fill-from-archetype

When the verb list ran out early, refilling from the phrase's archetype shape
before settling cleared more flat-phrase flags in isolation, but produced roofs
and walkways that collided with neighbouring arcs (8 flight/`CEILING_IN_ARC`
issues in test_09, 12 in showcase) and fill DROPs clipped previous landings.
Reverted. **Policy decision:** fill-from-archetype is the right long-term filler
but requires the world layer to handle inter-verb roof/walkway/slab
interactions — a later rebuild stage, not a planner-quick-fix.

## hop() status

`hop()` was **not changed**. It was never the bug — it exposed the phrase-state
scope bug when actual-cost budgeting stopped pre-rejecting final verbs.

## Results (before → after)

| Metric | Before | After |
|---|---|---|
| `runner-check` problems | 11 / 12 courses | **5 / 12 courses** |
| `EMPTY_SECTION` | 5 | **0** |
| Contiguity violations | 9 | **0** |
| Grounded runs over holes | 0 | 0 |
| Flight issues (all 12 courses + 25 patterns) | 0 | 0 |
| `FLAT_ENERGETIC_PHRASE` | 6 | 5 (see below) |

`npm run typecheck` EXIT 0. `npm run test:timing` PASS (23 mechanics, 65
patterns schedule/run/retire, all library levels load). `npm run audit` PASS.
`npm run fairness` PASS. Only `runner-check` exits 1, on the 5 flat-phrase
reports below.

## Remaining Runner issues (exact)

All five are `FLAT_ENERGETIC_PHRASE`, and all are *policy/authoring* questions,
not planner accounting bugs:

1. `test_03 @20` (50%) — authored `["PLATFORM_DESCENT","GROUND_RUN"]`: the
   phrase's own content is descend-then-run; 90% bottom by authoring.
2. `test_06 @16` (50%) — authored `["HIGH_JUMP","DROP","GROUND_RUN"]`: a
   2.9-beat authored ground-run tail.
3. `test_08 @8` (45%) — inverted hop chains: each hop's apex hangs away from
   the ceiling toward the floor line, so the phrase genuinely plays in the
   bottom half of the *field*. Fixing this means either re-shaping
   `INVERTED_GROOVE` (more ceiling-level run between chains) or revisiting the
   zone semantics for inverted phrases — a design decision.
4. `test_08 @20` (55%) — same cause.
5. `showcase @84` (85%) — the climax is authored as a floor corridor
   (`TIGHT_VERTICAL_WINDOW` + run); a corridor's walkway sits at `CORRIDOR_WALK`
   = 0.05 by design ("low on purpose"), so the phrase plays at the bottom of
   the field. Fix is authoring (corridors are not climax material) or policy
   (scope the check), not planner surgery.

Also noted: the dropped-verb census (`tools/__ckpt.ts`) reports 59 hits, but
essentially all are *name* artifacts (GAP_JUMP plans a hole and the segment is
named LONG_GAP from airtime; RELEASE_RUN's segment is named GROUND_RUN;
GRAVITY_ZIGZAG's own flip/run/flip expansion; corridor entry hops named
PLATFORM_HOP_CHAIN) or legitimate budget refusals (drop-whole when the room is
gone). The census needs verb-identity semantics before the number means
anything.

## Commands run this session

```
npm run typecheck
npx tsx tools/runner-check.ts
npx tsx tools/__contig.ts
npx tsx tools/__hole.ts
npx tsx tools/__ckpt.ts
npm run test:timing
npm run audit
npm run fairness
```

New scratch probes (do not delete): `tools/__ea_trace.ts`,
`tools/__ea_zones.ts`, `tools/__ea_slabs.ts`.

## Files changed this session

- `src/mechanics/runner/runnerPlanner.ts` — fixes 1–5 (airborneSeen scope,
  trim state, SYNCOPATED_HOPS, prelude descent-verb skip, empty-verb skip,
  slideUnder slice)
- `src/mechanics/runner/courseWorld.ts` — fix 6 (clipFalls height-aware)

Planner correctness is now stable enough to resume the broader Runner rebuild:
the trajectory invariant holds library-wide (0 contiguity violations), every
course and pattern flies, and the remaining audit reports are authored/policy
decisions rather than planner defects.


---

# FINAL PHASE — integration / validation / composer / playtest, 2026-09-20 (latest)

Took over from the final-phase handoff. Planner correctness untouched. No git
operations. Arena/Editor files untouched (VerticalMode.ts changed under us by
the parallel window; typecheck transiently red mid-session, green at close).

## P1 — FLAT_ENERGETIC_PHRASE resolved to zero (by policy + authoring)

- **Inverted phrases (test_08 @8/@20):** the flatness *predicate* is now
  surface-relative (`surfaceSideRatio`, verticalZones.ts) while the zones stay
  absolute. Rationale: the motion language is gravity-relative
  (`GROUND_RUN`/`CEILING_RUN` are one code path), so a phrase glued to the
  ceiling is exactly as flat as one glued to the floor; an inverted hop chain
  whose apexes reach into the field is the opposite of flat. This also
  *strengthens* the check: a ceiling phrase that only ceiling-runs now flags
  ("ceiling two zones"), which absolute-only measurement let pass.
- **test_03 @20:** re-authored `[PLATFORM_DESCENT, GROUND_RUN]` →
  `[PLATFORM_DESCENT, STAIRCASE_UP]` — descend then climb again: on-theme for
  the staircase drill, honestly energetic.
- **test_06 @16:** `[HIGH_JUMP, DROP, GROUND_RUN]` → `[…, DROP_AND_JUMP]` —
  the level's namesake verb replaces the long run tail.
- **showcase @84:** re-authored `[TIGHT_VERTICAL_WINDOW, GROUND_RUN]` →
  `[TOP_BOTTOM_CORRIDOR, GROUND_RUN, DROP, TIGHT_VERTICAL_WINDOW, GROUND_RUN]`.
  Constraint discovered live: corridor/window walkways end exactly at their
  exit landing, so a *fall* must not follow them (the landing frame falls
  through — sim `MISSED_LANDING`); every corridor exit is followed by grounded
  content, as in test_09 and phrase @76.
- No level names in the validator; no thresholds lowered.

## P2 — composeCourse reconnected (spec §44–§48)

- `CourseSpec.generate { beats, seed, intensity, phraseBeats }` — a section can
  now declare a procedural course. LevelLoader validates the parameters and
  expands through `composeCourse()` at compile time; the result flows through
  the same validation and `planCourse()` as authored data. No second runtime.
- Live demo: `runner_procedural.level.json` (seed 7, 64 beats, 100 BPM),
  registered in the index, flies clean.
- Composer fixes the reconnection forced into the open:
  - **Surface planning** — a `FLIP` selection composes as a *pair*:
    `inverted:true` ceiling phrase (`verbs: [CEILING_HOP,
    INVERTED_PLATFORM_CHAIN]`) + `inverted:false` floor return. Boundary flips
    are charged to their own phrases, so a truncated verb shape can never
    strand the course on the ceiling (which the generated seed-7 course
    immediately demonstrated).
  - **Dynamics** — RELEASE roles get 0.6× loudness; DESCENT/RELEASE archetypes
    cap at 0.4 (calm shapes labelled calmly).

## P4 — multi-BPM / multi-seed validation (spec §52, §67) inside runner-check

New `RUNNER procedural` block: 3 BPMs (90/120/150) × 3 seeds (1/7/13), each
course composed → planned → world → flight-sim → audit → inline contiguity.
Determinism checked by composing twice; seed variety checked by comparing
archetype sequences. All green.

## P3 — RunnerDebug zone readout

`samplePhraseZones()` (verticalZones.ts) is the shared phrase-zone sampler (the
audit reuses it). `WorldPhrase` carries intensity + zone beats + ground ratio;
the debug legend (backtick) shows `zone:` + `level:` live and the current
phrase's loudness + ground-hugging percentage.

## NEW — double-jump blocks (user request, Geometry-Dash-orb semantics)

- Physics: `DOUBLE_JUMP_LEVEL` 0.34 (> single-jump apex 0.32, head-safe under
  the ceiling route), `AIR_JUMP_APEX`, `AIR_JUMP_SCALE` (derived), and
  `doubleJumpArc()` — the one piecewise arc the planner, audit and simulator
  all read.
- Verb `DOUBLE_JUMP_MOUNT`: full jump → ring at the first arc's apex → second
  impulse → lands on the block. The ring (`AIRJUMP` demand → world `airJumps`)
  renders as an amber ◎ and arms exactly one mid-air press; landing and flips
  disarm. Without the ring a mid-air press is nothing — existing levels are
  untouched.
- Audit: reach limit for air-jump flights, combined arc in `headReach`, no
  single-arc takeoff window. Sim: applies the scaled impulse at the planned
  beat. Demo: `runner_test_12_double_jump.level.json` (registered, flies).
- Verified live in the browser: the ring-armed second press lifts the player to
  the block face height mid-flight, jump particles fire, no errors.

## Playtest (real runtime, vite + browser automation)

- Showcase: boots through the real LevelLoader into RUNNER mode; intro groove
  renders terrain/phrase tint; jump input lands on raised slabs; hazards
  register hits and drain HP; the run continues past bar 24.
- test_12: the double-jump sequence above.
- Environment note: the embedded browser suspends rAF between automation
  calls and the game auto-pauses ("rendering stalled — press P"); that is the
  known IAB artifact, not a game defect.

## P6 — regression

`npm test` (typecheck → timing → audit → runner-check → fairness) passes end to
end for the first time: **exit 0**. 14 courses + 25 patterns + 9 seeded courses
green; contiguity 0; holes 0.

## P7 — cleanup

192 scratch files under `tools/` deleted (plain filesystem rm; no git clean).
Kept: `runner-check`, `course-dump`, the six library tools, `__contig`,
`__hole`, and the documented `__ea_{trace,zones,slabs,compose}` probes.

## Known limitations / deferred

- Corridor/window walkways end at their exit landing: never author a fall
  directly after one (enforced by authoring convention, not yet by a check).
- `fill-from-archetype` remains future work (needs the world layer to handle
  inter-verb roof/walkway interactions).
- The dropped-verb census (`__ckpt.ts`-class) still needs verb-identity
  semantics (name artifacts vs real drops).
- RunnerDebug phrase readout covers courses; pattern-lab sections show `-`.

---

# PLAYTEST FEEDBACK PASS — 2026-09-20 (latest)

Four items from hands-on playtesting:

1. **Air-jump forgiveness** — the ring window was ±0.25 beats with only 0.045
   of landing margin: too tight to land by feel. Window widened to ±1/3 beat,
   `AIR_JUMP_APEX` 0.10 → 0.13 (combined peak 0.45, measured landing margin
   0.074), and the debug legend shows `◎ARMED` while the ring has armed the
   second press. Player logic verified headlessly (`tools/__ea_airjump.ts`).
2. **`SKY_STEPS`** — new verb answering "consecutive jumps each landing
   exactly on a floating block": three full jumps, each onto a floating slab
   with a hole under the flight (`SKY_STEP_RISE` 0.08, holes at 60% of the
   flight's max width — a full-width hole leaves 0.02 beats of take-off
   slack, a frame trap). `hop()` gained `gapScale`. Demo:
   `runner_test_13_sky_steps.level.json` (registered, flies clean). Authoring
   rule re-confirmed: never follow a floating-landing verb with a DROP.
3. **Manual gravity flip** — `F`/`Shift` while grounded inverts the player's
   side of the field (GD-ball read). Implemented as a multiplier on the
   course's gravity (`manualFlip`), so authored flips still flip both sides
   together; reset on restart. The other base line is solid wherever the
   level has no hole — a manual flip over a gap is the player's own fall.
4. **Phrase-tint question** — no code change: the tint is legibility
   (spec §65), not a mechanic.

`npm test` exit 0 after all changes (15 courses, 25 patterns, 9 seeded).

## Double jump made universal (playtest feedback, round 2)

The ring-gated design was the wrong read of "must double-jump to climb": the
player expected jump → press jump again mid-air to *always* work, with tall
blocks simply requiring it. Now: every take-off arms exactly one mid-air press
(universal double jump; spent until the next take-off; flips/landing clear
it). Rings remain, re-arming a *spent* jump — an extra jump the level hands
out where it wants one. Verified headlessly (2 presses fire, a third does
not, rise 0.414 > 0.34) and live (jumps:2, no ring involved). 15 courses
still fly clean; `npm test` green.

## Double-jump somersault (playtest feedback, round 3)

The air jump now performs a full forward 360° roll: `Renderer.withRotation`
(generic rotated-draw wrapper) + an `airRollActive` flag on the player, timed
to the second impulse's own flight (`AIR_ROLL_BEATS` 0.5, direction follows
gravity so a ceiling-route roll reads forward too). Purely visual -- physics,
sim and validation untouched; 15 courses still fly, air-jump probe still
passes. Verified live mid-roll.

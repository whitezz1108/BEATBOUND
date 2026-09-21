# ARENA Checkpoint — 2026-09-20

Paused mid-task. Nothing in this file has been integrated into the original
project, and nothing should be until the RUNNER work in the original workspace
settles.

---

## 1. Workspaces

| | |
|---|---|
| **Isolated ARENA workspace** | `C:\Users\44977\Desktop\BB-arena` |
| **Original / source workspace** | `C:\Users\44977\Desktop\BB` |
| **Original workspace branch** | `evan-branch` (git user `whitezz1108`) |
| **Isolated workspace branch** | *none* — `BB-arena` is **not** a git repository |
| **Isolation method** | Physical full-folder copy. `robocopy` of the whole project excluding `.git`, `dist` and `.editor-checkpoint-*`, then a **separate physical copy of `node_modules`** (verified: no junction / reparse point). |

**Why a physical copy and not a worktree or branch:** the brief requires
local-filesystem-only isolation with no version-control operations at all. A
worktree or branch would have required VCS operations and would have shared
`.git` metadata with the RUNNER window.

**Why `node_modules` is a real copy, not a junction:** `package.json` bundles
every tool to `node_modules/.cache/beatbound/*.mjs`. A shared junction would let
this window's `npm test` overwrite the RUNNER window's cached bundles (or the
reverse). That is a genuine cross-contamination path, so the junction was
removed and the directory copied physically. A first attempt at a junction was
made and then deliberately undone.

**Staleness:** the copy was taken at the start of this task. The original
workspace has moved on since — see §5.

---

## 2. Files modified by ARENA

Four files. Two ARENA-owned, two shared.

| File | Δ | Class |
|---|---|---|
| `src/mechanics/arena/RingMechanic.ts` | +335 / −103 | ARENA-only |
| `src/mechanics/arena/FloorWarningMechanic.ts` | +184 / −55 | ARENA-only |
| `src/core/fairness.ts` | +33 / −0 | **shared** |
| `src/core/Mechanic.ts` | +25 / −0 | **shared** |

Both shared changes are **purely additive** — no existing line was altered,
moved or deleted in either file. Verified by diff: every hunk is an insertion.

Nothing else in the isolated workspace has been touched. Confirmed by a
recursive diff of `BB-arena` against `BB`, excluding the four files above and
excluding the RUNNER files the *original* has since changed.

---

## 3. Completed ARENA upgrades

### 3.1 Gap Ring fairness — `RingMechanic.ts` (P0 item 2)

The ring was a single ring with an evenly-spread gap and no reachability maths
at all. It is now a variant-driven sequence with two hard, derived floors.

**Variants implemented** (all five requested):

- `BASIC_GAP` — single ring, one wide opening.
- `FOLLOW_GAP` — openings stay where they are across a sequence.
- `ROTATING_GAP` — successive openings rotate by `rotationPerRingDeg`.
- `NARROWING_GAP` — the arc shrinks per ring by `narrowingPerRing`.
- `ADVANCED_ALTERNATING` — zig-zag: the opening steps out and comes back, so
  the player is never asked to cross the whole arena twice in a row.

New params: `variant`, `ringCount`, `rotationPerRingDeg`, `narrowingPerRing`.
Existing params (`mode`, `gapCount`, `gapArcDeg`, `gapAngleDeg`, `thickness`,
`rotationDeg`) are unchanged, so AP13 and every existing ring pattern plays
exactly as before.

**Floor 1 — gap width.** The arc is clamped against
`minimumAngularGap(playerRadius, JUDGEMENT_RADIUS)` so the opening always fits a
body *even after a narrowing sequence has spent several rings shrinking it*.
Previously a NARROWING chain could in principle walk the arc below the body.

**Floor 2 — reachability.** This is the substantive fix. The step between
successive rings is clamped against what the player can actually walk:

```
maxGapEdgeStep = asin( playerSpeed · secondsPerBeat · staggerBeats · 0.85
                       / ARENA_OUTER_RADIUS )
```

and the step is measured **between gap edges**, not gap centres, with the arc
change deducted from the same allowance:

```
budget = max(0, maxGapEdgeStep − |halfArc − previousHalfArc|)
step   = clamp(angleDelta(anchorEdge, wantedEdge), −budget, +budget)
```

Two deliberate choices here:

- *Edges, not centres.* A wedge whose centre barely moved can still throw its
  trailing edge a long way if the ring also widened. Measuring centres would
  miss that.
- *Outer radius, not inner.* The worst case is the player parked at the outer
  rim, because the same angular step is a longer walk the further out you stand.
  The previous draft of this used the innermost radius and was **wrong** — it
  was corrected before the checkpoint. A worked example: at 120 BPM with 2 beats
  between rings the budget is ≈50°; the naive inner-radius version allowed ≈248°,
  which is a coin flip, not a dodge.

At 120 BPM / 2-beat stagger this lands near **50°**, so AP13's 90°/180° jumps
are now physically walkable rather than theoretical. The clamp is applied to the
whole ring as one rotation, so gaps stay evenly spaced and can never collapse
onto each other.

**Ring stop radius is now derived from thickness**, not a constant:

```ts
minRingRadius(thickness) = thickness / 2 + playerRadius * 0.5
```

This is load-bearing. The ring is an annulus — everything inside
`radius − thickness/2` is safe — so if the inner edge ever grows past the
player's body, dead centre becomes a permanent camp spot and the mechanic stops
asking a question. Tying the floor to `thickness/2` keeps the inner edge *under*
the player at every thickness. (The first draft hardcoded `0.06`; the
camp-audit caught it — see §6.)

**Telegraph.** Later rings in a sequence now preview as thin arcs at the same
radius, so a rotating sequence reads as a *sequence* rather than as one ring
that moved.

### 3.2 Floor Warning timing — `FloorWarningMechanic.ts` + `Mechanic.ts` (P0 item 3)

This was the highest-priority gameplay item, and it was the worst offender: the
library declares `telegraphBeats: 1`, which at 120 BPM is **0.5 s** — below the
0.6 s reaction floor. The warning was authored, not computed, and it was illegal.

**Four-stage lifecycle now visually distinct:**

| Stage | Reading |
|---|---|
| `TELEGRAPH` | dashed outline, slow fill ramp, gentle shiver — *"somewhere here"* |
| `CRITICAL_WARNING` | solid fill, solid bright outline, shiver at double frequency — *"this tile, now"* |
| `ACTIVE` | damaging, overshoot punch |
| `RECOVERY` | spent, fading |

**The warning length is now derived, not authored:**

```
warningBeats = max( libraryTelegraph,
                    minimumWarningBeats(worstCaseEscapeWalk, secondsPerBeat)
                    × (1 − 0.25 · intensity) )
```

`worstCaseEscapeWalk` is computed exactly on the tile grid — the centre of the
armed tile furthest from any safe tile, straight to the nearest safe tile — so
the number is right for the layout rather than estimated from a bounding box. It
is floored at the library value and capped at 4 beats, and intensity may shrink
it toward the reaction floor but never past it. The tier's `telegraphScale` is
applied on top by the registry, which only ever lengthens.

This is what makes a full-width row and a single checkerboard square both fair
without hand-tuning each one: the row telegraphs longer because escaping it is a
longer walk.

**Floor pattern library** — all eight requested layouts implemented:
`single`, `horizontal_strip`, `vertical_strip`, `cross`, `checker_A`,
`checker_B`, `center_danger`, `outer_danger`, `sector` (plus the legacy
`rows`/`cols`/`all`).

**The `CRITICAL_WARNING` stage did not require a new `MechanicPhase`.** Adding
one would have forced every mode — RUNNER, VERTICAL, RADIAL — to learn about a
phase none of them use. Instead `BaseMechanic` gained an opt-in
`criticalFraction` getter that defaults to `0`:

```ts
protected get criticalFraction(): number { return 0; }
get criticalStartBeat(): number { … }
get isCritical(): boolean { … }
```

A mechanic that overrides it gets the fourth stage for free. A mechanic that
does not is byte-for-byte unchanged in behaviour. Only `FloorWarningMechanic`
overrides it today.

### 3.3 Shared helper — `fairness.ts`

Added `minimumWarningSeconds` and `minimumWarningBeats`, the escape-walk-plus-
margin formula the floor hazard is built on. Purely additive; nothing existing
in the file changed, so no other mechanic's clamping is affected.

---

## 4. Not started

None of the following was begun. The checkpoint was requested mid-P0.

| Item | Priority | State |
|---|---|---|
| Rebalance projectile size / speed / readability | P0 #4 | **not started** |
| Expand chain patterns (FAN, SWEEP, PARALLEL, CROSS, X_CROSS, CURVE_C, CURVE_S, ARC, SPIRAL, ROTATING_CHAINS) | P0 #5 | **not started** — `ChainMechanic` still has only its original 8 layouts |
| Richer projectile patterns (FLOWER, FAN, PULSE, DOUBLE_SPIRAL, MOVING_EMITTER paths) | P0 #6 | **not started** |
| Presentation: background + central arena (replace the geometric debug room) | P0 #7 | **not started** — `ArenaMode.renderField` still draws the flat grid + guide rings |
| Player avatar upgrade (orb → readable character with cosmetic-slot architecture) | P0 #8 | **not started** — `ArenaPlayer` still renders the glowing ellipse |
| Editor/data reachability for the new ring + floor families | — | **not started** — the new params are code-reachable and lab-testable, but no JSON pattern uses them yet |
| P1 items (moving emitter, sector/arena sweep, safe zone, explicit difficulty tiers, hit polish) | P1 | **not started** |

**Requested-but-unimplemented mechanics summary:** of the prompt's P0 list,
items 2 and 3 are done and validated; items 4–8 are untouched. All P1 and all
P2 items are untouched.

---

## 5. Integration risk

The original workspace has changed since the copy. A recursive diff shows the
original now has RUNNER work the isolated copy does not:

**Files the original has changed that the isolated copy has NOT (RUNNER, not mine — do not copy back):**

- `src/mechanics/runner/courseAudit.ts`
- `src/mechanics/runner/runnerPlanner.ts`
- `src/mechanics/runner/trajectory.ts`
- `src/mechanics/runner/traversalSim.ts`
- `src/mechanics/runner/verticalZones.ts` *(new file)*
- `tools/runner-check.ts` *(original is newer — zone reporting)*
- `tools/__probe3.ts` *(scratch file, original is newer)*
- `editor/music-analysis/beatbound_audio/` *(new directory in original)*
- ~20 untracked scratch files in `tools/` (`.tmp-*.ts`, `__probe*.ts`, `zz-verify*.ts`, `.verify-sync.ts`, `.probe/`)

**Integration-sensitive files — modified by ARENA *and* plausibly in RUNNER's path:**

| File | Why sensitive | Conflict risk |
|---|---|---|
| `src/core/Mechanic.ts` | Shared by all four modes. `BaseMechanic` is the base class every RUNNER mechanic extends. | **HIGH** — RUNNER adds mechanics; if the RUNNER window also edits `BaseMechanic`, the two additive hunks will need a manual merge. Both changes here are pure insertions after `recoveryEndBeat`, which keeps the conflict local and small. |
| `src/core/fairness.ts` | Shared. `ensureWarningFloor` / `maxGapShiftPerBeat` are used by RUNNER's feasibility maths. | **MEDIUM** — the ARENA change is a pure append at the end of the file, so a merge should be mechanical. |
| `src/mechanics/arena/RingMechanic.ts` | ARENA-only. | **LOW** — RUNNER has no reason to touch it. |
| `src/mechanics/arena/FloorWarningMechanic.ts` | ARENA-only. | **LOW** — same. |

No conflict was resolved. Per the brief, integration is a later manual step.

**Do not** copy `BB-arena` over `BB`. Doing so would revert the RUNNER window's
`runnerPlanner.ts`, `trajectory.ts`, `traversalSim.ts`, `courseAudit.ts`,
`verticalZones.ts` and `runner-check.ts` to the pre-copy state.

---

## 6. Validation

### Commands actually run, and their actual results

| Command | Where | Result |
|---|---|---|
| `npx tsc --noEmit` | `BB-arena` | **clean** — no output, exit 0 |
| `npm test` | `BB-arena` | **exit 0** |
| `npm run audit` (isolated, mid-fix) | `BB-arena` | exit 1 — caught a real bug (below) |
| `diff -rq BB BB-arena` | `Desktop` | read-only; used to enumerate diverged files |

`npm test` = `typecheck && test:timing && audit && runner-check && fairness`. All
five stages green. Headline lines from the run:

```
12 course(s) fly as planned.
PASS  every library mechanic has a runtime (23 mechanics)
PASS  all 65 patterns schedule, run and retire
      (ARENA 20, RUNNER 25, VERTICAL 9, RADIAL 11; 536 mechanics)
No ARENA section can be beaten by standing still.
All 20 ARENA patterns are readable.
```

### The camp-audit catch (worth recording)

An intermediate draft of the ring hardcoded its stop radius at `0.06`. The
camp-audit caught it immediately:

```
arena_test.level.json  T03  0  1/1681  CAMPABLE at (0.50, 0.50)
1 section(s) can be beaten by standing still.
```

Dead centre. The ring's inner edge was stopping just outside the player's body,
leaving a permanent safe pocket. Confirmed by swapping the *original*
`RingMechanic.ts` back in — the original gives `T03 → 2 hits, 0/1681 safe`,
i.e. the original did **not** have this hole, so it was a regression introduced
by the draft, not a pre-existing condition.

Fixed by deriving the stop radius from `thickness` (§3.1). After the fix:

```
arena_test.level.json  T03  2  0/1681  ok (must move)
No ARENA section can be beaten by standing still.
```

### Fairness-check note

The per-pattern section still reports 12 of 20 ARENA patterns as campable *in
isolation*. This is **pre-existing and unchanged by this work** — the baseline
run before any edit reported the same count. The tool itself labels these as
"layer pieces, and camp-audit gates the composed levels where they are actually
played." The composed-level audit is the gate that matters and it is green. The
per-pattern numbers moved slightly for AP13 (was campable, now `ok`) because the
ring's reachability clamp is now doing real work.

### What was NOT validated

- **No manual playtest was performed.** The `?lab=arena-*` labs
  (`arena-patterns`, `arena-radial-inout`, `arena-floor`) were identified as the
  right tuning environment but never launched. Every claim above is a headless
  validator result or a geometric argument, not a feel judgement. The derived
  warning lengths in particular are *computationally* fair and *unverified* for
  readability on screen.
- No new pattern JSON was authored, so the new `variant` / layout params have
  never been exercised through the real `LevelLoader → PatternScheduler` path —
  only through the code path the validators drive.

---

## 7. Known issues / unresolved

1. **`ringCount > 1` is untested end-to-end.** The staggered-sequence code path
   (multiple rings in one stretched ACTIVE window) has no JSON pattern using it,
   so no validator has driven it. `npm test` exercises `ringCount = 1` only,
   because that is all the library declares. **This is the highest-risk
   untested code in the checkpoint.**
2. **`ADVANCED_ALTERNATING`'s clamp makes it behave like `ROTATING_GAP`** when
   the budget is small: the intended ±1.35× swing gets clamped to roughly the
   same step. It is not wrong — it is safe — but the variant does not yet read
   as visually distinct from ROTATING_GAP at 120 BPM. Needs either a longer
   stagger or a different shaping.
3. **Ring warning is not yet floor-derived.** Unlike the floor hazard, the ring
   telegraph is still the library's authored value (scaled by tier). The
   reachability clamp makes the *dodge* fair, but the *warning* has not been
   through the `minimumWarningBeats` treatment. Worth doing for consistency.
4. **`editor/patterns/annotations.json`** exists in the original workspace and is
   untouched here. If the new ring/floor params should be editor-visible, that
   file needs a look — but it may also be RUNNER-touched, so it was left alone.
5. **The isolated copy is stale relative to the original.** Any shared file
   edited here (`fairness.ts`, `Mechanic.ts`) is diffed against the *old* base.
   A three-way merge against the current original has not been attempted.

---

## 8. Exact next step

**Playtest the two finished mechanics before writing anything new.**

Launch the isolated workspace's dev server and drive the ring and floor labs by
hand, because both changes are computationally fair and visually unverified:

```
cd C:\Users\44977\Desktop\BB-arena
npm run dev
```

then open, in order:

1. `?lab=arena-radial-inout` — watch the ring's telegraph and gap placement.
   Confirm the SAFE wedge is findable at a glance and that the ≈50° clamp does
   not make `ROTATING_GAP` feel static.
2. `?lab=arena-floor` — confirm the two warning stages are distinguishable at
   speed, and that the derived warning lengths do not make the mechanic feel
   sluggish at low difficulty.
3. `?lab=arena-patterns` — cycle all 20 AP patterns and confirm AP13 (Ring
   Collapse) still reads as a climax under the new clamp.

Lab keys: `R` reset · `Space` trigger · `1/2/3` intensity · `-`/`=` BPM ·
`[`/`]` variant · `,`/`.` polish preset · `Tab` lab menu.

**Then, and only then,** move to P0 item 4 (projectile rebalance) — which is the
next unstarted item in the brief's own order, and the one that most affects how
the arena reads in motion.

Do **not** start item 4 before the playtest: the ring and floor changes both
alter what the player's attention is doing, and tuning projectiles against an
unplayed baseline would be tuning blind.

---

## 9. Files left exactly as they are

No ARENA development file was altered while writing this report. The only write
performed was this file. The mid-fix experiment in §6 — temporarily copying the
original `RingMechanic.ts` in to confirm the camping regression was mine — was
reverted immediately, and the restored file was re-verified with
`npm run audit` and a full `npm test` (exit 0) before this report was written.

No version-control operation of any kind was performed in either workspace. No
formatter, autofix, RUNNER modification or EDITOR modification was made.

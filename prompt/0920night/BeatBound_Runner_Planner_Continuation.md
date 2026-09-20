# BeatBound Runner Planner — Continuation Prompt

Take over the EXISTING BeatBound Runner working copy from its current filesystem state.

This is a CONTINUATION of the Runner refinement task, NOT a fresh implementation.

The immediate task is planner correctness.

Do NOT begin visual polish or broad Runner redesign until the current planner regression is understood and fixed.

Do NOT perform any git commit / reset / checkout / stash / revert operations.

Arena and Editor are being modified in parallel in the same working tree.

Do NOT touch, revert, clean up, format, or delete their changes.

## First: read the existing checkpoint

Read:

`RUNNER_CHECKPOINT_2026-09-20.md`

Treat it as historical context, but verify everything against the CURRENT filesystem.

The checkpoint is slightly behind the latest change described below.

## Exact current stopping point

The previous session was fixing:

`src/mechanics/runner/runnerPlanner.ts`

Specifically:

authored verbs / phrase budgeting inside `planPhrase`.

The old budget logic used nominal declared verb durations:

```text
remaining < verbBeats(verb)
```

where `verbBeats()` reads:

`VERB_INFO[verb].beats`

That nominal duration is demonstrably not equal to the actual geometry produced.

Measured examples:

```text
TOP_BOTTOM_CORRIDOR
nominal = 4
actual = 2.187

TIGHT_VERTICAL_WINDOW
nominal = 2
actual = 1.487

PLATFORM_DESCENT
nominal = 4
actual = 0.200

STAIRCASE_UP
nominal = 4
actual = 3.613
```

A concrete failure was:

`runner_test_09`

Its theme is corridor-heavy.

A 4-beat phrase had ~3.99 beats remaining.

`TOP_BOTTOM_CORRIDOR` declared itself as 4 beats, so the old planner rejected the entire authored verb and replaced the phrase with `GROUND_RUN`.

That was one source of `FLAT_ENERGETIC_PHRASE`.

## Latest code change already applied

Inside `planPhrase`, the previous session changed the authored verb loop so that it:

1. actually calls `planVerb`
2. builds the real result
3. computes actual cost from generated segments
4. budgets using `verbCost(result)`

A new helper `verbCost(result)` was added.

`verbBeats()` documentation was changed to make clear that it is a declaration / nominal metadata value, NOT the authoritative generated duration.

This change already typechecks.

DO NOT immediately revert it.

The nominal-duration model has been empirically proven wrong.

## Effect on runner-check

Before the change:

`runner-check = 14`

After the actual-cost budgeting change:

`runner-check = 11`

It FIXED several existing problems, including improvements such as:

- test_04: 1 -> 0
- test_08: 2 -> 1
- test_06: 2 -> 1
- showcase: 3 -> 2

However it introduced four NEW EMPTY_SECTION-type regressions.

Known examples include:

- `test_01 @0`
- `test_02 @0`
- `test_10 @0`
- showcase around `@109.25`

Exact diagnostic wording should be regenerated from the current tool output.

## Known concrete regression

`test_01` currently produces approximately:

```text
world slabs = 2
```

where before the change it produced much more world geometry.

Observed phrase diagnostics included:

```text
@0  GROOVE demands=0
@4  GROOVE demands=0
@8  GROOVE demands=0
@12 GROOVE demands=0
```

The previous session traced an important part of this to `hop()` behavior.

There is an invariant resembling:

```ts
if (opts.landOnSlab || endLevel !== null) {
    demands.push(...slab(...))
}
```

For something like `MEDIUM_JUMP` starting at level 0 and returning to the baseline:

```text
endLevel = null
```

The world builder does NOT emit a landing slab because the base line is already solid.

That behavior may itself be correct.

The problem is that planner accounting may now treat a logically valid verb as sufficient phrase content even when it contributes very little explicit world geometry.

## Important hypothesis to verify, NOT blindly assume

There may currently be a conflation between:

1. planned musical/time cost
2. actual playable duration
3. visible/world geometry coverage

A verb can be valid and have:

```text
cost > 0
```

while producing:

```text
explicit slabs = 0
```

For baseline movement this may be legitimate.

Therefore do NOT “fix” this by forcing every baseline jump to emit redundant slabs unless the architecture proves that is intended.

Instead investigate whether phrase filling / break conditions stop too early after a valid-but-low-geometry verb.

There is particular suspicion around a condition involving:

```text
built > consumed
```

or equivalent planner stopping logic.

The previous session stopped before identifying the exact failing branch.

## First task: DIAGNOSE BEFORE MODIFYING

Before changing planner logic again, instrument or use existing diagnostics to produce a precise trace for at least:

- test_01
- test_02
- test_10
- showcase around the new empty section

For each failing phrase record:

```text
phrase start
phrase length / budget
remaining before each verb
authored verb selected
nominal verbBeats
planVerb result
actual verbCost
segment count
segment beat totals
demand count
slab count / world geometry contribution
consumed value
built value
remaining after verb
exact reason loop continued or stopped
fallback behavior
final emitted phrase/world coverage
```

The goal is to identify the first exact invariant violation.

Do NOT broadly rewrite `runnerPlanner.ts` before this trace is understood.

## Diagnostic tools

There are many local diagnostic scripts under `tools/__*`.

Approximately 42 diagnostic utilities exist.

Recent files such as:

- `__diag1..7`
- a cost diagnostic that lists over-budget phrases

were intentionally created for this investigation.

DO NOT delete them.

Use existing diagnostics where useful rather than recreating everything.

## Validation commands

At minimum begin with:

```bash
npm run typecheck
```

and:

```bash
npx tsx tools/runner-check.ts
```

Reproduce the current baseline before editing.

## Desired fix direction

Preserve actual-cost budgeting.

The likely architectural correction should distinguish something conceptually like:

```text
verbCost(result)
```

meaning:

“how much real phrase/time budget did this generated verb consume?”

from something like:

```text
phrase coverage / meaningful world coverage / completion
```

meaning:

“has this phrase actually been filled enough to stop planning?”

Do not necessarily introduce exactly those APIs.

Use the smallest correction consistent with the existing planner design.

The important rule is:

```text
successful verb generation
!=
phrase is necessarily complete
```

A valid baseline jump must not disappear simply because it emits no redundant slab.

But a phrase must also not become effectively empty because the planner prematurely stops after such a verb.

## Regression constraints

A correct fix must preserve the wins from actual-cost budgeting.

Specifically, do not reintroduce the old behavior where authored corridor verbs are discarded because nominal metadata says 4 beats while generated content is shorter.

After the fix, verify both categories:

A. old false rejection problems remain fixed

B. new EMPTY_SECTION regressions disappear

## After the immediate regression is fixed

Continue reducing remaining `runner-check` issues, but only after planner invariants are stable.

Prioritize root causes over case-by-case patches.

Do not add special-case hacks per test unless there is a clear authored-design reason.

## Working tree safety

The git working tree contains unrelated Arena and Editor changes.

Runner work must not touch or revert them.

Do not use commands that reset or clean the repository.

Do not modify:

- Arena mechanics
- Arena tests/patterns unless already Runner-specific
- `editor/music-analysis/`
- unrelated shared Editor files
- unrelated Arena fairness files

If a shared file must be touched for a genuine Runner requirement, inspect current concurrent changes first and minimize the edit.

## Scope control

Do NOT:

- redesign the full Runner mode
- polish visuals before planner correctness
- replace the authored verb system
- revert to nominal budgeting
- delete diagnostic tools
- perform git operations
- change Arena or Editor work
- start music-analysis integration

The current target is:

```text
ACTUAL VERB COST
        ↓
CORRECT PHRASE FILL
        ↓
NON-EMPTY WORLD GEOMETRY
        ↓
STABLE RUNNER-CHECK
```

## Checkpoint update

Once the root cause and fix are stable, update:

`RUNNER_CHECKPOINT_2026-09-20.md`

with:

- actual-cost budgeting change
- exact regression root cause
- final fix
- runner-check before / after counts
- any remaining known failures
- diagnostic commands used

Do this only after the code state is stable.

## Completion report

At the end, report:

1. exact root cause of the four new EMPTY_SECTION regressions
2. whether `hop()` itself was wrong or merely exposed planner accounting
3. planner invariant that was changed
4. why the fix preserves actual-cost budgeting
5. runner-check before and after
6. typecheck/test results
7. remaining Runner issues
8. exact files changed
9. whether planner correctness is stable enough to proceed to later Runner polish

Do not claim the Runner is finished merely because runner-check improved.

The main success criterion for this session is that the planner model is internally coherent and the newly introduced empty sections are resolved without undoing the authored-verb improvements.

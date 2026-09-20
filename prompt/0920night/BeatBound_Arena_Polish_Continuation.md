# BeatBound Arena Polish — Continuation Prompt

Take over the EXISTING BeatBound Arena working copy from its current filesystem state.

This is a CONTINUATION of the Arena refinement task, NOT a fresh rebuild.

Preserve all valid Arena work already present.

Do NOT perform git commit / reset / checkout / stash / revert operations.

There are simultaneous Runner and Editor tasks in the same working tree. Do NOT modify, revert, delete, or normalize their files.

Before editing, inspect the actual current Arena implementation and reconstruct the real current state.

## Current Arena state

The previous session audited the original Arena refinement prompt against the actual code.

P0 requirements 1–10 are already implemented and previously verified.

Implemented systems include:

### Gap Ring fairness

`src/mechanics/arena/RingMechanic.ts`

Already includes:

- 5 ring variants
- gap width lower bounds
- reachable gap-edge clamping
- `maxGapEdgeStep()` based on travel/radius geometry
- stopping radius derived from thickness
- anti-center-camping behavior

Pink gap rings are no longer using the original obviously impossible opposite-gap behavior.

### Floor warning

`FloorWarningMechanic.ts`

Already includes:

- TELEGRAPH
- CRITICAL
- ACTIVE
- RECOVERY

Warning duration is derived from worst-case escape movement via `minimumWarningBeats`.

There are already 8 floor layouts.

### Projectile readability

Tuning already changed projectile speed / radius and added separate edge projectile sizing.

Projectile families already distinguish center-spawned and edge-spawned visual types.

`ProjectileMechanic.ts` already supports deliberate formations such as:

- spread
- wall
- stream
- fan

Do not rewrite this system from scratch.

### Chains

`src/mechanics/arena/chainPaths.ts`

Already contains approximately 9 pattern families:

- PARALLEL
- X_CROSS
- FAN
- SWEEP
- CURVE_C
- CURVE_S
- ARC
- SPIRAL
- ROTATING_CHAINS

Difficulty controls already include values such as:

- chains
- complexity

The missing problem is NOT lack of raw pattern variety.

### Rich projectile mechanics

`SpiralMechanic.ts` already includes:

- SPIRAL
- DOUBLE_SPIRAL
- FLOWER
- PULSE

`RadialBurstMechanic.ts` already includes moving emitters such as:

- CIRCLE
- SQUARE
- DIAMOND
- FIGURE_EIGHT
- WAVE
- ORBIT

### Arena visuals

Arena already has a dedicated stage/background system.

The old debug-grid look has been replaced.

The player orb has already been replaced by an Avatar system with cosmetic slots and collision radius separated from visual radius.

### Regression status

Previous `npm test` passed across the project.

Do not break other game modes.

## P1 already implemented

Previously completed P1 items include:

- moving emitters
- spiral projectile patterns
- curved chains
- rotating gap ring
- explicit difficulty mapping
- strengthened player-hit feedback / hit-stop / border response

## P1 still missing

Two explicitly requested capabilities remain incomplete:

1. Sector Sweep

Desired behavior:

- sectors activate sequentially
- clockwise / counter-clockwise variants
- possibly skip-step variants
- readable warning before activation

Existing fixed-sector floor layouts do NOT satisfy this.

2. Advanced Safe Zone

Existing SafeTile behavior predates this refinement.

Need at least a richer advanced form such as:

- moving safe zone
and/or
- quadrant-based safe zone

Preserve existing useful SafeTile behavior.

## Most important REAL gap: new capabilities are not connected to the data layer

This is the highest-value missing work.

A previous audit of Arena JSON patterns found that newly added parameters such as:

- complexity
- richer chain controls
- new ring variants
- spiral configuration
- moving emitter configuration

are largely or entirely absent from real Arena pattern JSON.

That means many new capabilities currently exist only in code / lab paths rather than in actual authored LevelLoader content.

`editor/patterns/annotations.json` also has not yet been updated for the new Arena capabilities.

The goal is NOT to create more mechanics.

The goal is to make the existing mechanics actually appear in real authored Arena content.

## Second major gap: phrase-based progression

The original Arena requirements explicitly wanted difficulty to rise progressively across musical phrases.

Example intent:

early phrase:

- 1–2 chains
- simple geometry

later phrases:

- 3 patterns
- then 4
- then 5 / higher complexity

Currently `chains` / `complexity` mostly behave as manually supplied parameters.

There is no strong automatic or authored phrase-progression path tying Arena difficulty to section/phrase progression.

Implement the smallest clean progression mechanism that fits the existing architecture.

DO NOT create a new giant difficulty framework.

Prefer something conceptually like:

```text
phrase / section progression
        ↓
difficulty tier
        ↓
existing pattern parameters
(chains / complexity / variant / pattern pool)
```

The system should remain compatible with future Editor-driven music mapping.

## Other known Arena issues to close

### Ring warning duration

Floor warnings already derive minimum warning timing from movement.

Ring warning timing still relies too much on authored/library values.

Review whether gap-ring telegraph timing should also use an Arena fairness minimum derived from actual player movement / geometry.

Do not simply increase all warnings arbitrarily.

### `ringCount > 1`

This path has not received sufficient end-to-end verification.

Test it explicitly.

### ADVANCED_ALTERNATING

At ~120 BPM it may clamp into behavior visually too similar to ROTATING_GAP.

Inspect and improve differentiation only if needed without breaking fairness.

### Maximum mechanic combination rule

The design requirement is:

avoid unreadable stacks; generally no more than two simultaneous major mechanics.

This is not yet enforced strongly.

Add a lightweight validation / audit path if the existing architecture supports it cleanly.

Do not redesign level composition around this.

### Manual playtest still required

Automated fairness validation is not equivalent to feel.

After automated tests pass, perform whatever local/manual inspection is possible and produce a concrete playtest checklist for:

- ring reaction time
- consecutive gap reachability
- floor escape timing
- chain readability
- projectile rhythm/readability
- combined-mechanic readability

## Work order

Follow this order unless the actual code proves a prerequisite requires otherwise.

### A — Data integration

First:

- inspect Arena pattern JSON
- identify new mechanics/parameters that exist only in code
- wire representative uses into real Arena pattern data
- preserve existing good patterns
- do NOT replace the whole library
- update Arena-relevant pattern annotations only where safe

Goal:

new Arena capabilities must be reachable through the normal:

`JSON -> LevelLoader -> Arena runtime`

path.

Verify this path end to end.

### B — Phrase progression

Implement progressive Arena difficulty across phrases/sections using existing pattern controls.

Goals:

- no maximum-complexity pattern immediately
- clear escalation
- early readability
- later density / chain count / complexity
- future editor readiness

Do not connect to music-analysis V2 yet.

This should operate with current level/section metadata.

### C — Remaining P1 / fairness closure

Then handle:

- Sector Sweep
- advanced Safe Zone
- ring warning minimum
- ringCount > 1 verification
- mechanic-combination validation
- any small differentiation needed between ring variants

## Validation

After meaningful changes run the relevant existing validation commands.

At minimum verify:

- typecheck/build as appropriate
- `npm test`
- Arena fairness tooling
- camp audit
- real pattern loading
- no Runner regression
- no Editor regression caused by Arena changes

Existing fairness note:

Some individual Arena patterns can be beaten by standing still because they are intended as layered material.

Do NOT blindly force every atomic pattern to defeat camping if that destroys its compositional role.

The important invariant is that composed Arena sections remain non-trivial and fair.

## Scope control

Do NOT:

- add large numbers of new mechanics
- rewrite RingMechanic from scratch
- rewrite chain system from scratch
- rewrite projectile system from scratch
- redesign the entire Arena architecture
- integrate music-analysis V2
- edit Runner planner files
- alter Editor music-analysis files
- perform git operations

Arena already has enough raw variety.

The remaining goal is:

`CAPABILITY INTEGRATION -> PROGRESSION -> FAIRNESS CLOSURE -> PLAYTEST READINESS`

## Completion report

When done, clearly report:

1. existing work preserved
2. data-layer additions
3. phrase progression implementation
4. remaining P1 implementations
5. fairness/timing changes
6. validations run and exact results
7. remaining manual-playtest risks
8. exact files changed
9. any items intentionally left out and why

Stop once Arena reaches a clean playable refinement state.

Do not continue inventing new mechanics after the stated gaps are closed.

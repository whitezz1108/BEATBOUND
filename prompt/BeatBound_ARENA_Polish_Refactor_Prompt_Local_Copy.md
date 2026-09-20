# BeatBound — ARENA Mode Polish & Refactor Prompt

## Role

You are working on the **ARENA mode** of the BeatBound project.

Your task is to perform a focused polish/refactor pass that upgrades the current ARENA from a functional prototype into a polished, readable, fair, visually distinctive top-down rhythm survival mode.

This is **not** a whole-project rewrite.

The RUNNER mode is being actively refactored by another agent in a separate local project directory at the same time. Therefore, this ARENA work must be physically isolated in its own local full-project copy and must avoid touching the directory being used for the RUNNER refactor.

---

# 1. High-Level Goal

ARENA should feel like a polished top-down rhythm survival arena where the player:

- reads attack patterns,
- understands where danger will happen,
- has enough time to react,
- moves through intentionally designed safe paths,
- experiences progressively more complex patterns,
- and sees clear visual escalation that matches the music.

The desired feeling is:

> "I understood the pattern and barely made it through."

Not:

> "I got hit before I even understood what happened."

The mode should prioritize:

- readability,
- fairness,
- pattern quality,
- visual identity,
- gradual difficulty growth,
- rhythm integration,
- editor/data-driven compatibility.

---

# 2. Local Workspace Isolation — MANDATORY

This ARENA refactor must be performed only inside a **separate local full-project copy**.

The RUNNER refactor is already in progress elsewhere. The two agents must never edit the same local project directory.

## Required local layout

Use a structure conceptually like:

```text
BeatBound-runner/
→ existing project directory currently being modified by the RUNNER agent

BeatBound-arena/
→ separate complete local project copy dedicated to this ARENA refactor
```

The exact folder names may differ, but physical directory separation is mandatory.

## Before modifying any source file

1. Inspect the current working directory.
2. Determine whether this directory is the same project directory currently being used for the RUNNER refactor.
3. If it is the RUNNER/original active directory, **do not modify source code there**.
4. Create a separate complete local project copy for ARENA using ordinary filesystem copy operations.
5. Perform all ARENA work only inside that copy.
6. Do not edit, overwrite, move, delete, rename, or synchronize files in the RUNNER working directory.
7. Do not copy finished ARENA files back into the RUNNER directory during this task.
8. Integration between the two versions is a later manual step and is outside the scope of this task.

A full project copy is preferred over copying only ARENA files because ARENA still depends on normal shared project code, assets, configuration, build tools, and runtime infrastructure.

Transient/generated directories such as caches or build outputs may be recreated instead of duplicated when appropriate, but source code, assets, configuration, package metadata, and all files required to run the project must be present in the ARENA copy.

## No version-control operations

This task is **local-filesystem-only**.

Do not perform any version-control operations.

Do not use version-control commands for:

- creating or switching development lines;
- saving checkpoints;
- restoring files;
- comparing revisions;
- merging;
- cleaning;
- resetting;
- reverting;
- publishing;
- synchronizing.

Do not modify version-control metadata.

All safety must come from **physical local directory isolation**, not repository operations.

---

# 3. Critical Scope Rule

## Prefer ARENA-local changes

Prioritize modifications inside ARENA-specific files and systems.

Do **not** perform broad refactors of:

- RUNNER,
- VERTICAL,
- RADIAL,
- BeatClock,
- global timing,
- LevelLoader,
- shared player physics,
- global input,
- shared level schema,
- mechanic registry,
- unrelated shared rendering systems.

If a shared file absolutely must be changed:

1. keep the change minimal;
2. explain why it is necessary;
3. preserve compatibility with every other mode;
4. record it in the final report under:

```text
Shared files modified
- file
- reason
- compatibility impact
```

Do not modify `src/mechanics/runner/*`.

---

# 4. Before Coding

First inspect the current ARENA implementation and identify:

- ARENA renderer,
- player rendering,
- movement logic,
- projectile logic,
- chain logic,
- floor warning logic,
- gap-ring logic,
- current attack/pattern data model,
- current level integration,
- any ARENA-specific tests or validation tools.

Before making large changes, summarize internally:

1. current architecture;
2. which files are ARENA-only;
3. which files are shared;
4. where each requested mechanic currently lives;
5. what can be safely refactored locally.

Do not rewrite working systems merely because a different architecture looks cleaner.

Preserve current working behavior unless it conflicts with this specification.

---

# 5. Core Design Principles

## 4.1 Readability before speed

Difficulty should not mainly come from extremely fast attacks.

Prefer:

- more bullets,
- more structured patterns,
- more spatial complexity,
- slower readable motion,
- stronger telegraphs,
- clearer safe paths.

Avoid turning difficulty into pure reaction-speed testing.

---

## 4.2 Every pattern must have a plausible escape path

Patterns must not create unavoidable damage under normal play.

Avoid:

- two consecutive mechanics sealing every exit;
- a correct dodge for attack A making attack B unavoidable;
- floor hazards activating before the player can physically leave;
- gap rings requiring impossible cross-arena travel;
- projectiles spawning directly on top of the player without telegraphing.

Where practical, derive timing from actual:

- player move speed,
- arena dimensions,
- hazard dimensions,
- travel distance,
- attack speed.

Do not tune all fairness purely by arbitrary constants.

---

## 4.3 Difficulty should evolve through pattern design

Preferred difficulty progression:

1. increase count;
2. add directions;
3. add pattern complexity;
4. shrink safe spaces slightly;
5. combine two mechanics;
6. only then make modest speed increases.

Avoid:

```text
easy = slow
hard = same thing but extremely fast
```

Prefer:

```text
easy = simple pattern
hard = richer but still readable pattern
```

---

# 6. Visual Layout — Central Arena Stage

The ARENA should no longer visually consume the entire game screen as a flat test space.

Rework its presentation toward:

```text
large themed background
        +
central battle arena
        +
UI / gameplay effects
```

The camera remains fully top-down.

Do not introduce perspective gameplay or camera tilt that changes spatial judgment.

---

## 5.1 Background

Create support for a large non-collidable environmental background.

The background should visually frame the central arena and make the scene feel like a real location rather than a debug room.

The background should not interfere with gameplay readability.

The implementation should remain compatible with future song/theme-specific artwork.

---

## 5.2 Central Arena

Preferred first-pass arena shape:

**rounded rectangle / rounded square**

Reasons:

- strong stage identity;
- good for floor-warning patterns;
- good for edge projectiles;
- still compatible with circular / radial projectile patterns;
- visually resembles a distinct board or combat stage.

The arena should occupy the center of the screen with visible surrounding environment.

The playable boundary must be visually obvious.

---

## 5.3 Arena Border

Improve the arena edge so it looks intentional.

Possible treatments:

- luminous rim,
- energy barrier,
- physical decorative border,
- light strip,
- subtle reactive pulse.

The border must help the player understand the exact playable region.

Do not make decorative elements visually confused with hazards.

---

# 7. Player Visual Upgrade

The current glowing-ball player is too abstract.

Upgrade it into a small readable character-like avatar.

The first implementation does **not** need a full character creator.

Preferred direction:

- simplified chibi character,
- small animal,
- compact robot,
- minimal top-down mascot.

Requirements:

- readable from top-down view;
- small footprint;
- collision clarity must remain obvious;
- easy to find during heavy bullet patterns;
- visually more expressive than a glowing dot.

Keep gameplay collision separate from decorative sprite size.

Do not increase the collision box just because the visual becomes larger.

---

## 6.1 Future DIY compatibility

Architect the visual layer so the character can later support lightweight cosmetics such as:

- headwear,
- fruit hats,
- animal ears,
- helmets,
- crowns,
- trails.

Do **not** build a full customization UI now.

This pass only needs a clean visual structure that will not block future skins.

---

# 8. Gap Ring Refactor — HIGH PRIORITY

The current pink expanding gap ring is visually promising but currently unfair.

Observed problem:

- rings expand too quickly;
- safe gaps can switch to nearly opposite positions;
- the player cannot physically reach the next gap;
- consecutive rings can create effectively unavoidable damage.

Keep the mechanic.

Fix the gameplay.

---

## 7.1 Base Gap Ring

Create a fair baseline version:

- slower expansion;
- readable pre-spawn telegraph;
- sufficiently wide gap;
- clear visual distinction between dangerous ring and safe opening.

The player should have enough time to:

1. identify the opening;
2. move toward it;
3. pass through it.

---

## 7.2 Gap Ring Pattern Variants

Support structured variants such as:

### BASIC_GAP
Single ring with one wide opening.

### FOLLOW_GAP
Two or more rings whose openings remain nearby.

### ROTATING_GAP
Successive openings rotate gradually clockwise or counter-clockwise.

### NARROWING_GAP
Gap becomes moderately narrower over successive rings.

### ADVANCED_ALTERNATING
Only for higher difficulty and only when travel time is still physically achievable.

Do not randomly flip a gap approximately 180 degrees between closely spaced rings unless the timing guarantees the player can reach it.

---

## 7.3 Ring fairness check

Gap placement should account for:

- player move speed,
- ring travel time,
- angular displacement,
- arena radius / dimensions.

Where possible, constrain generation mathematically instead of relying on random tuning.

---

# 9. Chain System Expansion — HIGH PRIORITY

The current chain mechanic is good and should be expanded rather than replaced.

Turn it into a richer pattern language.

---

## 8.1 Chain Pattern Library

Implement or prepare support for:

### Tier 1
- SINGLE
- DOUBLE

### Tier 2
- PARALLEL
- CROSS
- X_CROSS

### Tier 3
- FAN
- SWEEP

### Tier 4
- CURVE_C
- CURVE_S
- ARC

### Tier 5
- SPIRAL
- ROTATING_CHAINS

The exact implementation may be simplified if some variants are expensive, but the architecture should support pattern families rather than hardcoded one-off attacks.

---

## 8.2 Progressive chain difficulty

The chain system should support gradual escalation.

Example progression:

```text
first 16 beats
1–2 chains

next 16 beats
2–3 chains

next 16 beats
3–4 chains

later phrase
4–5 chains + curved / moving pattern
```

Do not hardcode this exact progression globally.

Expose parameters so the editor/composer can later decide the count and complexity based on music energy.

---

# 10. Floor Warning Refactor — HIGHEST GAMEPLAY PRIORITY

The current floor warning timing is too short.

The player often cannot leave before the floor becomes hazardous.

This must be fixed.

---

## 9.1 Hazard lifecycle

Every floor hazard should clearly move through:

### TELEGRAPH
Early weak warning.

### CRITICAL_WARNING
Clearly imminent activation.

### ACTIVE
Actual dangerous state.

### RECOVERY
Hazard ends / floor returns.

These phases must be visually distinguishable.

---

## 9.2 Timing

Do not choose warning duration without considering player movement.

At minimum consider:

- player movement speed;
- width/height of the hazard;
- likely escape distance;
- arena size;
- reaction margin.

Implement a sensible minimum warning-time calculation if practical.

A useful conceptual rule is:

```text
minimum warning
>=
reasonable escape travel time
+
reaction margin
```

The result should feel generous at low difficulty and tighter at high difficulty, but never physically impossible.

---

## 9.3 Floor pattern library

Support several readable shapes:

- SINGLE_ZONE
- HORIZONTAL_STRIP
- VERTICAL_STRIP
- CROSS
- CHECKERBOARD
- CENTER_DANGER
- OUTER_DANGER
- SECTOR / REGION

Do not activate many floor pattern types simultaneously.

---

# 11. Projectile System Expansion — HIGH PRIORITY

The current projectile system is functional but too repetitive.

Improve it into a real pattern system.

The desired direction is:

> more projectiles, slower motion, more structured trajectories, clearer projectile families.

Avoid:

> a few very large high-speed generic circles.

---

# 12. Projectile Sources

Support three broad source types.

## CENTER_EMITTER

A source inside the arena.

Patterns may include:

- RADIAL_BURST
- SPIRAL
- DOUBLE_SPIRAL
- FLOWER
- FAN
- PULSE

---

## MOVING_EMITTER

Allow an emitter to follow a path such as:

- CIRCLE
- SQUARE
- DIAMOND
- FIGURE_EIGHT
- WAVE
- ORBIT

The emitter can fire while moving.

Do not make movement so fast that the source becomes unreadable.

---

## EDGE_EMITTER

Projectiles can enter from:

- LEFT
- RIGHT
- TOP
- BOTTOM

Reduce current projectile size if necessary.

The edge projectile system should look visually different from center-emitter bullets.

---

# 13. Projectile Visual Language

Different sources should use different shapes.

Example:

### Center bullets
- orb
- star
- spark
- petal

### Edge bullets
- diamond
- arrow
- shard
- rectangle
- short beam segment

The distinction should help players understand attack origin instantly.

Avoid overly large sprites that hide safe gaps.

---

# 14. Projectile Motion

Prefer:

- higher density;
- lower average speed;
- predictable trajectories;
- readable spacing.

The player should be able to see and navigate a **bullet field**.

Do not turn the system into instant reflex shots.

---

# 15. New Spatial Patterns — P1

After P0 systems are stable, add a small number of new pattern families.

---

## 14.1 Safe Zone

Create clearly marked safe regions while other areas become dangerous.

Use this to reposition the player between major phrases.

Possible future uses:

- center safe;
- edge safe;
- moving safe zone;
- quadrant safe zone.

---

## 14.2 Sector Sweep

Divide the arena into sectors/regions and activate danger in ordered patterns:

- clockwise;
- counter-clockwise;
- alternating;
- skipping.

Keep telegraphing clear.

---

## 14.3 Arena Sweep

Support large sweeps:

- horizontal,
- vertical,
- diagonal.

These should use long, obvious warnings and align well with strong beats.

---

# 16. Pattern Combination Rules

Do not create chaos by stacking everything.

For this pass:

> maximum two major gameplay mechanics active as a deliberate combination.

Recommended combinations:

- GAP_RING + FLOOR_WARNING
- CHAIN + PROJECTILE
- SPIRAL_PROJECTILE + SAFE_ZONE
- SECTOR_SWEEP + CURVED_CHAIN

Do not intentionally create:

```text
ring + chain + floor + projectile + sweep
```

all at once.

---

# 17. Music / Phrase Structure

Patterns should be compatible with musical phrasing.

Prefer units such as:

- 4 beats;
- 8 beats;
- 16 beats.

Example structure:

```text
0–8
introduce simple pattern

8–16
repeat with variation

16–24
increase complexity

24–32
combine two mechanics
```

Do not hardcode one global song structure, but ensure mechanics can be scheduled this way.

---

# 18. Pattern Grammar / Data-Driven Design

This is important for the future editor.

Do not make every complex pattern a pile of manually spawned individual bullets.

Prefer high-level pattern definitions such as:

```text
CHAIN
pattern = CURVE_S
count = 3
duration = 8
difficulty = 0.5
```

or:

```text
PROJECTILE
source = CENTER
pattern = SPIRAL
bulletSpeed = 0.35
density = 0.7
rotationSpeed = 0.4
duration = 16
```

The runtime should expand these high-level pattern instructions into gameplay entities.

Where possible, expose data such as:

- startBeat
- duration
- type
- pattern
- count
- speed
- density
- angle
- rotation
- warningDuration
- difficulty
- source
- movementPath
- safeGap
- phase

Do not over-engineer a massive schema rewrite if the current data model can be extended cleanly.

---

# 19. Telegraph Visual Language

Create a consistent ARENA warning language.

The player should intuitively understand:

### early warning
hazard is coming

### urgent warning
hazard is about to activate

### active danger
hazard can damage now

Do not let different mechanics use contradictory color/state meanings.

Use existing visual style where possible.

---

# 20. Hit Feedback

Improve hit readability.

A hit should combine several lightweight effects:

- player flash;
- particle burst;
- small screen shake;
- hit sound if the audio system already supports it;
- temporary invulnerability / damage cooldown if already part of the design;
- clear UI feedback if applicable.

Do not introduce excessive full-screen shake.

---

# 21. Camera

Camera remains fixed top-down.

Allowed polish:

- subtle hit shake;
- beat pulse;
- arena pulse;
- background parallax;
- extremely small visual scale response.

Do not introduce gameplay camera rotation or perspective tilt.

---

# 22. Development Priority

Follow this order.

## P0 — MUST COMPLETE

1. inspect current ARENA architecture;
2. fix Gap Ring fairness;
3. fix Floor Warning timing;
4. rebalance projectile size/speed/readability;
5. expand chain patterns;
6. implement richer projectile patterns;
7. convert presentation to background + central arena;
8. upgrade player from simple orb to a readable character-like avatar;
9. preserve current working ARENA gameplay;
10. verify other game modes are not broken.

---

## P1 — COMPLETE IF P0 IS STABLE

1. moving projectile emitter;
2. spiral projectile;
3. curved chain;
4. rotating gap ring;
5. safe zone;
6. sector / arena sweep;
7. explicit difficulty tiers;
8. stronger hit / arena polish.

---

## P2 — DO NOT PRIORITIZE NOW

Do not spend substantial time on:

- full character creator;
- large cosmetic inventory;
- boss system;
- huge theme system;
- advanced scoring;
- complex near-miss system;
- three-or-more mechanic combinations;
- AI-generated patterns;
- broad global refactor.

---

# 23. Testing Requirements

Do not stop after code compiles.

You must test real gameplay behavior.

At minimum verify:

## Gap Ring
- basic gap is dodgeable;
- consecutive gaps are physically reachable;
- rotating gap is readable;
- expansion speed is not excessive.

## Floor Warning
- player can escape a representative hazard from a bad starting position;
- telegraph/critical/active phases are visually distinguishable;
- warning time scales reasonably.

## Chain
- new patterns render correctly;
- curved patterns do not create invisible collision regions;
- escalation remains readable.

## Projectile
- edge projectiles are not oversized;
- center and edge bullet styles are visually distinguishable;
- spiral/radial patterns leave navigable gaps;
- bullet density can increase without forcing extreme speed.

## Player
- character remains easy to locate;
- visual size does not accidentally enlarge collision;
- gameplay remains readable under dense attacks.

## Arena
- central stage is visually distinct;
- background does not interfere with hazards;
- arena bounds remain obvious.

---

# 24. Regression Requirements

Run the project's existing validation commands.

At minimum:

```bash
npm test
```

and any existing project-specific validators relevant to ARENA.

If the project already has mode validation tools, use them.

Do not claim success while tests are red.

Do not silently delete or weaken tests merely to make them pass.

---

# 25. Manual Playtest Requirement

This task is not complete based only on static code or unit tests.

Perform an actual gameplay/playtest pass if the environment allows it.

Specifically evaluate:

- can I understand the attack before it activates?
- can I physically reach the intended safe space?
- are attacks visually attractive without becoming noisy?
- does the arena feel like a designed stage?
- can I always find the player?
- does increasing difficulty feel like richer pattern design rather than arbitrary speed?

If something technically works but clearly feels unfair, adjust it.

---

# 26. Do Not Over-Polish One Mechanic Before Integration

Avoid spending the entire task perfecting one attack.

Use this development loop:

```text
baseline audit
→ fix P0 mechanics
→ integrate arena presentation
→ playtest all together
→ correct fairness/readability
→ add P1 selectively
→ regression test
→ final report
```

---

# 27. Final Acceptance Criteria

The first ARENA polish pass is complete only when all of the following are true.

## Fairness

A first-time player has a reasonable chance to dodge each major pattern.

## Readability

Players can tell:

- where danger is coming from;
- when it becomes active;
- where they should move.

## Variety

A 30–60 second ARENA sequence should not feel like the same attack repeating.

## Progression

Difficulty clearly evolves:

```text
simple
→ variation
→ denser pattern
→ more complex pattern
→ two-mechanic combination
```

## Visual Identity

A screenshot should look like a real BeatBound arena scene:

```text
environment
+
central stage
+
distinct player
+
designed attack patterns
```

not a geometric debug room.

## Editor Readiness

Core patterns remain data-driven and parameterizable.

## Isolation

RUNNER and unrelated modes remain unaffected.

---

# 28. Final Report

When finished, provide a concise but complete report with these sections:

## A. Files changed

List every modified/added file.

Separate:

```text
ARENA-only files
Shared files
```

---

## B. Gameplay changes

Explain:

- Gap Ring changes;
- Chain patterns;
- Floor Warning changes;
- Projectile patterns;
- any new mechanics.

---

## C. Visual changes

Explain:

- arena presentation;
- background support;
- player visual;
- projectile styling;
- telegraphs;
- feedback.

---

## D. Fairness / timing changes

Include any formulas, constraints, or timing rules introduced.

---

## E. Data-driven/editor compatibility

Explain what can now be controlled by data and what remains hardcoded.

---

## F. Validation

Report actual command results.

For example:

```text
npm test: PASS
ARENA validation: PASS
build: PASS
```

Do not write PASS unless the command was actually run.

---

## G. Manual playtest findings

Describe:

- what was tested;
- what felt improved;
- remaining known rough edges.

---

## H. Shared files modified

If none:

```text
Shared files modified: none
```

If any exist, explain exactly why they were necessary.

---

# 29. Important Final Instruction

This is a polish/refactor of a mode that already has a useful foundation.

Do not destroy working content just to replace it with a theoretically cleaner system.

Keep the strong parts of the current ARENA:

- the pink gap-ring concept;
- chain attacks;
- floor hazards;
- projectile gameplay.

The goal is to make them:

**fairer, richer, clearer, more musical, and more visually distinctive.**

Prioritize a playable, testable, integrated result over architectural perfection.

# BeatBound — Music-Driven Multi-Mode Level
## ARENA-Primary / Other Modes as Supporting Contrast

You are working in the local BeatBound project.

Your task is to create **one finished, playable, music-driven level** for:

`dance_fruits_musicsteve_void_-_toosie_slide_sped_up.mp3`

This must be an **ARENA-dominant level**. RUNNER, RADIAL, and VERTICAL are supporting contrast modes only.

The intended identity is:

> **This is an ARENA level with carefully selected excursions into other modes.**

ARENA must remain the home mode, own most climaxes, repeatedly return after excursions, and own the ending.

---

# 0. Hard Safety Rules

Do NOT:

- run any git command;
- commit, stash, checkout, reset, clean, merge, or rebase;
- overwrite unrelated existing levels;
- refactor unrelated runtime systems;
- modify Editor/music-analysis code unless a verified bug makes authoring impossible;
- weaken validators to make bad content pass.

Work locally only.

Prefer:

1. one new song-specific level JSON;
2. one concise design/coverage document;
3. only minimal runtime changes if an objectively broken existing capability blocks valid authored content.

---

# 1. Read Current Capabilities Before Authoring

Read the current authoritative files first:

- `ARENA_PATTERN_CAPABILITY_AUDIT.md`
- `ARENA_PATTERN_CATALOG.json`
- `RUNNER_CAPABILITY_AUDIT.md`
- `RUNNER_CAPABILITY_CATALOG.json`
- `VERTICAL_CAPABILITY_AUDIT.md`
- `VERTICAL_CAPABILITY_CATALOG.json`
- `RADIAL_CAPABILITY_AUDIT.md`
- `RADIAL_CAPABILITY_CATALOG.json`
- `TRANSITION_CAPABILITY_AUDIT.md`
- `TRANSITION_CAPABILITY_CATALOG.json`
- `BEATBOUND_GAMEPLAY_CAPABILITY_CATALOG.md`
- `BEATBOUND_GAMEPLAY_CAPABILITY_CATALOG.json`
- current level schema / loader / scheduler
- current mechanic and pattern libraries
- existing mixed-mode song levels
- existing validation tools

Runtime + audits/catalogs are the source of truth.

Do not rely on old prompts when current code differs.

---

# 2. Music Analysis Source

Use the existing analysis for:

```text
schema_version: beatbound_director_context_v1
analysis_version: 2.1.0
audio: dance_fruits_musicsteve_void_-_toosie_slide_sped_up.mp3

duration: 147.133741 sec
BPM: 123.05
BPM confidence: 0.4745
meter: 4/4
meter confidence: 0.2491
bar-phase confidence: 0.6145
bars: 75
beats: 301

overall energy: 0.5025
dynamic range: 0.7155
brightness: 0.7709
rhythmic density: 0.8598
melodic density: 0.4452
```

Locate the exact JSON locally if available, probably under `editor/music-analysis/` or song/library outputs.

Do not regenerate unless absolutely necessary.

---

# 3. Critical Analysis Guardrails

## 3.1 Never use events after the real audio duration

Only use music events inside:

`0.0 <= time <= 147.133741`

The analysis contains erroneous `important_events` after the real song duration.

Those are invalid.

Do not author anything after the actual audio ends.

Do not map those late events back into bar 75.

---

## 3.2 Prefer the beat grid over suspicious event timestamps

For gameplay placement, prefer:

1. actual audio playback verification;
2. `grid.bars`;
3. phrase / section boundaries;
4. valid in-range important events.

If phrase/section timestamps overlap around boundaries, do not double-author those overlaps.

Use clean bar boundaries.

---

## 3.3 Verify sync manually

Because BPM/meter confidence is not high, do not blindly trust the grid.

Play the actual level with the actual audio and verify several strong landmarks.

If a small offset exists, correct supported sync/timing fields instead of inventing a different BPM without evidence.

---

# 4. Music Structure

## Section 01 — bars 1–17

Approx:
- 0.0–33.157 sec
- energy mean 0.3811
- rising
- sparse drums/bass early
- vocals/other dominant
- repeat group `repeat_001`, occurrence 1

Phrases:
- bars 1–4: opening, very low energy, rising melody
- bars 5–12: development
- bars 13–17: peak, much higher energy

Important landmarks:
- bar 9 energy drop
- bar 12 energy drop
- bar 13 energy rise
- bar 14 energy peak / strong beat
- bar 16 energy peak
- bar 18 section boundary / major peak

## Section 02 — bars 18–40

Approx:
- 33.157–78.017 sec
- energy mean 0.5081
- high rhythmic density
- drums/bass/vocals active
- repeat group `repeat_002`, occurrence 1

Phrases:
- bars 18–24: high-energy opening
- bars 25–32: falling development
- bars 33–40: rising development

Important:
- drops around bars 25, 28, 29
- energy rise around bar 37
- strong peak around bar 38
- bars 37–40 have very high combined intensity

## Section 03 — bars 41–62

Approx:
- 78.017–120.926 sec
- energy mean 0.5384
- repeat group `repeat_002`, occurrence 2
- highly similar musically to Section 02

Phrases:
- bars 41–55: high-energy opening/development
- bars 56–62: lighter section that rises again near the end

Important:
- bars 42–51 contain repeated peaks
- bar 52 major energy drop
- bars 56–59 have sharply reduced drums/bass
- bar 60 energy rise
- bar 61 energy peak
- bar 63 section boundary

## Section 04 — bars 63–71

Approx:
- 120.926–138.480 sec
- highest section mean energy: 0.6199
- onset density: 0.9969
- repeat group `repeat_001`, occurrence 2
- substantially more intense than Section 01

This is the natural **final major ARENA escalation**.

Phrases:
- bars 63–69: high-energy opening
- bars 70–71: compact peak

Important:
- bar 65 peak
- bar 67 drop
- bar 68 rise
- bar 69 peak
- bars 70–71 dense climax

## Section 05 — bars 72–75

Approx:
- 138.480–147.134 sec
- final short section
- energy falling
- drums/bass remain strong
- melody falling

Important:
- bar 73 peak
- bar 74 strong beat
- bar 75 large pitch event / energy drop

Finish in ARENA. Do not switch modes again.

---

# 5. Global Mode Allocation

Target approximately:

```text
ARENA:    70–80%
RUNNER:    8–12%
RADIAL:    8–12%
VERTICAL:  4–8%
```

Do not distribute modes equally.

ARENA must:

- open the song;
- establish core motifs;
- occupy the majority of bars;
- own most high points;
- return after each supporting mode;
- own the final climax and ending.

---

# 6. Default Macro Plan

Use this plan unless current engine constraints require a small change.

## Bars 1–4 — ARENA
### Intro / calibration

Music:
- low energy
- rising
- sparse rhythm

Gameplay:
- clean Arena introduction
- teach movement/readability
- one low-pressure pattern family
- establish a signature motif that can return later

Difficulty:
`very easy`

---

## Bars 5–12 — ARENA
### Development 1

Gameplay:
- introduce 2–3 more Arena pattern families
- use call-and-response
- gradually increase spatial demand
- preserve wide reaction windows
- use bar 9 / bar 12 energy drops as short breathing moments

Difficulty:
`easy -> medium`

---

## Bars 13–17 — ARENA
### First mini-climax

Gameplay:
- first real Arena combination section
- evolve an earlier motif
- use major accents around bars 14 and 16
- end with a clear exit setup into first mode transition

Difficulty:
`medium -> medium-high`

---

## Bars 18–24 — RUNNER
### First contrast excursion

Use a compact polished Runner phrase.

Prefer:
- jump
- short jump chain
- slide
- platform/gap
- optionally one pad or gravity accent if it fits

Do NOT turn this into a Runner showcase.

The goal is contrast, not exhaustive coverage.

Difficulty:
`medium`

Return to Arena at bar 25.

---

## Bars 25–32 — ARENA
### Return / groove rebuild

Gameplay:
- Arena immediately feels like home again
- more space than bars 13–17
- use elegant spatial patterns
- use chain/ring/curved-space ideas only if current audit confirms support
- lower-energy music should become controlled dodging rather than dead gameplay

Difficulty:
`medium`

---

## Bars 33–40 — ARENA
### Major escalation

Music rises strongly into bars 37–40.

Gameplay:
- increase Arena density progressively
- return the bars 13–17 motif in stronger form
- use one of the best current Arena pattern families
- strongest local attack combination around bars 37–40
- preserve readable escape lanes

Difficulty:
`medium-high -> high`

---

## Bars 41–48 — RADIAL
### Cross-mode reinterpretation

Section 03 repeats the Section 02 musical family.

Instead of repeating Runner, reinterpret the repeated rhythm in Radial.

Use:
- clear directional rhythm
- supported 8-direction behavior if current runtime confirms it
- clean symmetric/asymmetric patterns
- one recognizable rhythm skeleton inherited from bars 18–24

Do NOT use every Radial mechanic.

Choose the best few.

Difficulty:
`medium-high`

---

## Bars 49–55 — ARENA
### Heavy return

Gameplay:
- Arena returns sharply
- immediately restate a known Arena motif
- bars 49–51 can be dense
- bar 52 drop becomes a small release
- bars 53–55 rebuild

Difficulty:
`high with a brief release`

---

## Bars 56–59 — VERTICAL
### Breakdown / precision contrast

Music:
- drums and bass collapse
- vocals remain strong
- melody becomes relatively more prominent

Gameplay:
- cleaner visual field
- precision rather than density
- melody/phrase-driven design
- only 1–2 signature Vertical mechanics

Do NOT make this the hardest section.

Difficulty:
`medium`

---

## Bars 60–62 — ARENA
### Final re-entry build

Music rises again.

Gameplay:
- concise three-bar Arena build
- visually signal final act
- no new mechanic

Difficulty:
`medium-high -> high`

---

## Bars 63–69 — ARENA
### Final major climax

This section is the repeat-group counterpart of Section 01, but much more intense.

Reuse Arena gameplay identity from bars 1–17 in transformed form.

The player should feel:

> "The opening idea is back in its final form."

Transform via:
- larger pattern scale
- tighter but still fair windows
- stronger combinations
- more spatial layers
- evolved signature motifs

Do NOT simply maximize every parameter.

Difficulty:
`high`

---

## Bars 70–71 — ARENA
### Compact peak

Use the strongest concise Arena phrase of the level.

Rules:
- no new mechanic
- one signature combo
- very readable
- actions should hit hard on the music

Difficulty:
`highest controlled peak`

---

## Bars 72–75 — ARENA
### Final burst and resolution

Remain in Arena.

Do not switch again.

Suggested shape:
- bar 73 final burst
- bar 74 setup
- bar 75 satisfying final hit / break / escape / resolution

Then leave a clean visual release as the song ends.

---

# 7. Arena Is the Primary Authoring Focus

Before writing patterns, inspect the current Arena audit/catalog and enumerate the actually supported:

- primitive attack types
- directional variants
- shape/pattern families
- floor/zone hazards
- projectile families
- chain/curve capabilities
- ring/enclosing capabilities
- any shield / dance / QTE-like mechanics if currently supported
- pattern intensity controls
- verified reaction windows
- known unsafe combinations

Do not use old assumed capability names.

Use current audited/runtime names.

---

# 8. Arena Motif Requirement

Create at least **four recurring Arena motifs**.

Conceptual examples:

```text
Motif A — ring/opening escape
Motif B — directional sweep
Motif C — chain/curved-space control
Motif D — floor/lane pressure
```

These are examples only.

Use real supported Arena mechanics.

Each motif should have:

1. introduction
2. variation
3. combination
4. late-song transformation

---

# 9. Repeat-Group Choreography

## repeat_001

Occurrence 1:
- Section 01

Occurrence 2:
- Section 04

Similarity:
- 0.9683

The second occurrence has higher arrangement intensity.

Therefore:

Arena material from bars 1–17 must have a recognizable descendant in bars 63–71.

Use:

`A -> A' -> A''`

Do not literal-copy.

---

## repeat_002

Occurrence 1:
- Section 02

Occurrence 2:
- Section 03

Similarity:
- 0.9926

Use this for cross-mode reinterpretation:

- first occurrence opening → Runner
- second occurrence opening → Radial

Preserve a recognizable rhythm cadence while changing the interaction language.

The rest returns to Arena.

---

# 10. Mode Transitions

Target transitions:

```text
ARENA -> RUNNER      ~bar 18
RUNNER -> ARENA      ~bar 25
ARENA -> RADIAL      ~bar 41
RADIAL -> ARENA      ~bar 49
ARENA -> VERTICAL    ~bar 56
VERTICAL -> ARENA    ~bar 60
```

Read `TRANSITION_CAPABILITY_AUDIT.md` first.

Use the real transition/breather system.

Requirements:

- never switch mid-unresolved lethal pattern
- clear outgoing hazards safely
- give perceptual time for the new control language
- align switches to phrase/section boundaries
- keep breathers musically tight
- do not add more mode switches without clear reason

---

# 11. Supporting-Mode Philosophy

RUNNER / RADIAL / VERTICAL are supporting colors.

For each excursion:

- use only the mode's strongest and clearest mechanics
- avoid exhaustive capability coverage
- avoid long tutorials
- make it understandable within a few beats
- exit before it becomes the song's new identity

---

# 12. Runner Constraints

Use current Runner audit values.

Important:

- player x fixed
- no speed changes
- safe gap geometry only
- no spike directly on required landing
- no unsafe pad arc into ceiling hazard
- no ambiguous overlapping gravity zones
- respect current gravity semantics

This song level does not need exhaustive Runner coverage.

Run `npm run runner-check`.

---

# 13. Radial Constraints

Read current Radial audit/catalog.

Do not assume outdated four-direction behavior.

If current runtime supports eight directions, use it.

Priorities:

- readable directional cues
- strong beat pulses
- controlled direction changes
- clear symmetric/asymmetric patterning
- rhythm correspondence with the earlier Runner repeat

Avoid unreadable direction spam.

---

# 14. Vertical Constraints

Read current Vertical audit/catalog.

The bars 56–59 segment is intentionally low-density.

Prefer:

- clean precision
- melody/phrase-driven movement
- low visual clutter
- only a few strong mechanics

Do not turn the breakdown into a difficulty spike.

---

# 15. Important In-Range Music Anchors

Use these selectively, not as one-object-per-event spam:

- 23.405 s — energy rise
- 25.356 s — energy peak / strong beat
- 29.256 s — energy peak
- 33.157 s — energy peak + section boundary
- 37.058 s — energy peak
- 44.860 s — energy peak
- 50.711 s — energy peak
- 54.612 s — deep energy drop
- 70.215 s — energy rise
- 72.166 s — energy peak + strong beat
- 78.017 s — section boundary
- 79.967 s — energy peak
- 85.819 s — energy peak
- 89.720 s — energy peak
- 93.620 s — energy peak
- 97.521 s — energy peak
- 99.472 s — energy drop
- 107.273 s — energy drop
- 115.075 s — energy rise
- 117.026 s — energy peak
- 118.976 s — strong beat
- 120.926 s — peak + section boundary
- 124.827 s — peak
- 128.728 s — energy drop
- 130.679 s — energy rise
- 132.629 s — energy peak
- 138.480 s — section boundary
- 140.431 s — final-section peak
- 142.381 s — strong beat
- 144.332 s — final energy drop

---

# 16. Intensity Mapping

Do not map audio intensity directly 1:1 into gameplay parameters.

Use it as guidance:

```text
0.10–0.30 -> sparse / teach
0.30–0.45 -> light development
0.45–0.60 -> medium
0.60–0.72 -> medium-high
0.72+      -> high / climax
```

Human-readable pacing overrides mechanical scaling.

---

# 17. Fairness

No mode may become unfair just because the music is dense.

For every difficult phrase:

- preserve reaction time
- preserve escape space
- avoid unavoidable overlap
- introduce mechanics before combining them
- avoid camera-hidden threats
- prefer decision complexity over raw speed

Desired failure response:

> "I mistimed or chose wrong."

Not:

> "That was impossible to read."

---

# 18. Arena Difficulty Arc

Use approximately:

```text
bars 1–4    teach
bars 5–12   develop
bars 13–17  first payoff

bars 25–32  reset + new spatial vocabulary
bars 33–40  strong escalation

bars 49–55  heavy return with micro-release

bars 60–62  final build
bars 63–69  transformed opening motif
bars 70–71  compact peak
bars 72–75  final burst + resolution
```

Do not use a monotonic difficulty wall.

---

# 19. No New Mechanics

This is primarily level authoring.

Do not add absent gameplay systems.

Do not implement unsupported mechanics just because a musical moment suggests them.

If a supported mechanic is actually broken, reproduce and prove the bug first.

---

# 20. Output Level

Create one new song-specific level using current naming conventions.

Suggested semantic name:

`toosie_slide_arena_primary.level.json`

Use the original audio:

`dance_fruits_musicsteve_void_-_toosie_slide_sped_up.mp3`

Use the analyzed timing unless real playback proves a correction is required.

---

# 21. Design Document

Create:

`TOOSIE_SLIDE_ARENA_PRIMARY_LEVEL_DESIGN.md`

Include:

1. audio source
2. analysis source path
3. timing assumptions
4. full 75-bar macro map
5. exact mode allocation
6. Arena motif definitions
7. purpose of each supporting mode
8. transition plan
9. major musical anchors
10. difficulty curve
11. technical constraints

Keep it concrete.

---

# 22. QA Table

Include:

| Bars | Music role | Mode | Main mechanics/patterns | Motif | Intensity | Transition |
|---|---|---|---|---|---:|---|

Also report:

```text
Arena bars / total
Runner bars / total
Radial bars / total
Vertical bars / total
number of mode transitions
```

Arena must remain at least 70%.

If it falls below 70%, redesign.

---

# 23. Validation

Run all relevant validators.

At minimum:

- level/schema validation
- current sync test / level report if available
- Arena-specific checks if available
- `npm run runner-check`
- Radial checks if available
- Vertical checks if available
- transition checks if available

Do not weaken validation.

---

# 24. Manual Playtest

Launch the actual level with actual audio.

Play from start to finish.

Check:

## Sync
- strong events align
- boundaries feel correct
- transitions feel musical
- final hit matches the real ending

## Arena
- readable
- fair
- motifs recur
- climax is difficult but not chaotic

## Runner
- flow is valid
- no impossible geometry

## Radial
- direction cues are unambiguous

## Vertical
- breakdown feels deliberate and clean

## Transitions
- old hazards clear
- control change is understandable
- no transition-caused damage

---

# 25. Mandatory Sync Checkpoints

Manually inspect at least:

- bar 1
- bar 14
- bar 18
- bar 38
- bar 41
- bar 45
- bar 52
- bar 56
- bar 61
- bar 63
- bar 69
- bar 73
- bar 75

If sync gradually drifts, investigate timing representation instead of manually nudging every pattern.

---

# 26. Completion Criteria

The task is complete only when:

- [ ] exact analyzed song is used
- [ ] no gameplay exists after 147.133741 s
- [ ] invalid post-duration analysis events are ignored
- [ ] Arena occupies >=70% of the level
- [ ] Arena opens the level
- [ ] Arena owns the ending
- [ ] Runner is a short supporting excursion
- [ ] Radial is a short supporting excursion
- [ ] Vertical is a short supporting excursion
- [ ] every mode switch happens at a meaningful boundary
- [ ] repeat_001 becomes an Arena motif return/transformation
- [ ] repeat_002 becomes a deliberate cross-mode reinterpretation
- [ ] bars 63–75 feel like the largest Arena payoff
- [ ] no unsupported mechanic is invented
- [ ] all relevant validators pass
- [ ] the whole level is manually playtested with audio
- [ ] no git commands are used

---

# 27. Final Report

Report:

## Files created/modified
Every path.

## Song timing
- final BPM
- any offset
- total bars
- duration
- sync verification result

## Mode allocation
Exact bar ranges and percentages.

## Arena motifs
Describe each motif and where it returns.

## Supporting-mode purpose
Explain why Runner / Radial / Vertical were assigned to those music regions.

## Validation
Exact command results.

## Playtest findings
Any tuning made for fairness/readability.

## Remaining limitations
Anything current runtime prevented.

## Safety confirmation
Confirm:
- no git commands
- no unrelated systems modified
- no invalid post-duration events used

---

# 28. Execute, Do Not Stop at Planning

Proceed autonomously:

1. read current audits/catalogs/runtime
2. locate the exact music-analysis JSON
3. verify the 75-bar grid
4. design Arena motifs
5. map the three supporting-mode excursions
6. author the level
7. run validators
8. manually playtest with the real song
9. fix weak/unfair sections
10. produce final design/report

Do not stop after a proposal if the project files are available.

The deliverable is a **finished BeatBound level**, not merely a design document.

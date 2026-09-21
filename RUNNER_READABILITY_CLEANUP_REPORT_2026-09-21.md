# Runner Ground & Obstacle Readability Cleanup — Completion Report

Date: 2026-09-21
Scope: RUNNER runtime, rendering, and Runner-specific level behaviour only.
No Arena / Radial / Vertical / editor / music-analysis / generation code was touched.
No Git operations were performed.

---

## 1. What the old coloured floor represented

Nothing about the run.

`RunnerCourseMechanic.renderPhraseTint()` painted a band along the running surface in
`motifColour(phrase.motif)` — a hash of the motif *name* into a six-entry palette
(`#4dffd0`, `#7dd0ff`, `#b98cff`, `#ffd166`, `#ff8fb1`, `#9ffcff`). Its intended job was
the anti-chaos idea from the generation spec: a recurring motif should *look* like the one
before it, or the player's memory of having played it is invisible.

The intent was fine. The placement was not. `runner_showcase` holds 26 phrases at
`phraseBeats: 4`, so the floor changed hue every four beats, 26 times in a minute — on the
one surface the player has to parse at speed, in colours drawn from the same family the
game uses for "you can land here". Every hue change was a signal that meant nothing, and
the cost was paid by the signal that does.

## 2. What the embedded bricks represented

Also nothing — and this one is provable rather than argued.

A "brick" was a slab whose *standable face* lies exactly on its surface's base line. For
FLOOR that puts `backY = faceY + depth`, so the block is drawn *inside* the floor body,
below the line the player runs on.

`resolveProbe()` is the single source of truth for what the player can stand on, and it
says `support = overGap ? null : baseY`. The base line is solid everywhere except over a
hole. A slab sitting on the base line therefore cannot change support, cannot be jumped
onto, cannot be collided with, does not mark a beat, and does not telegraph anything.

Measured across the six pre-existing Runner course levels:

| level | slabs | base-line | bridging a hole | anchored |
|---|---|---|---|---|
| runner_showcase | 59 | 32 | 2 | 0 |
| runner_benchmark_v2 | 32 | 16 | 4 | 0 |
| runner_golden_courses R-C1 | 8 | 6 | 0 | 0 |
| runner_golden_courses R-C2 | 13 | 8 | 1 | 0 |
| runner_golden_courses R-C3 | 21 | 9 | 1 | 0 |
| runner_procedural | 33 | 15 | 2 | 0 |
| **total** | **166** | **86 (52%)** | **10** | **0** |

**Half of every course in the library was invisible-to-gameplay geometry drawn as solid
blocks.** A further finding fell out of the same table: `anchored` is 0 everywhere. The
renderer split `SLAB_EDGE` (#7dd0ff) from `SLAB_ROOF_EDGE` (#b98cff) to distinguish
floating slabs from anchored ones, and the planner defaults every slab to `floating: true`
— so that colour distinction had never once been exercised.

## 3. What was removed

1. **`renderPhraseTint()`** — deleted outright.
2. **The motif palette itself.** `motifColour()` hashed a motif's name into six hues
   (`#4dffd0`, `#7dd0ff`, `#b98cff`, `#ffd166`, `#ff8fb1`, `#9ffcff`). It was first moved
   off the floor and into a background wash — but a hue that repaints the screen up to six
   times a minute is the same noise at lower volume, and it still asks the player to decide
   whether a colour means something. The palette, the hash, and the wash are all gone. The
   phrase keeps one thing, and it is the part that was ever information: a hairline on the
   beat where the phrase begins, in the backdrop's single blue-grey. It states *when*,
   never *which*, so it needs no palette at all.
3. **Base-line slab bodies.** No slab whose standable face is on the base line is drawn as
   a block any more — *except* where it bridges a hole. Six base-line slabs in the library
   are the only standable plate over a pit, and hiding those would have made real geometry
   invisible, so `CourseWorld.visibleSpans()` returns exactly the portion of a base-line
   slab that overlaps a gap on its own surface (10 across the library).
4. **The floating/anchored edge-colour split** — dead code, 0 anchored slabs, replaced by
   one mass outline.
5. **`renderParallax()`** — the old layers were rows of blocks whose bottom edge sat
   exactly *on* the live surface, aligned with real geometry and lit from the same
   direction. Decoration standing on the floor in the same posture as a platform is
   geometry as far as the eye is concerned. Replaced by `renderSkyline()`.
6. **`PlatformMechanic`'s third blue** (`EDGE_COLOUR = '#7dd0ff'`) — a landing face in a
   different colour from every other landing face in the game.

## 4. What was redesigned

**One colour per surface, meaning one thing.** `surface.ts` now owns the palette:

- `SURFACE_COLOUR` — the colour of *everything standable*. The base line, every course
  slab's landing face, every pattern platform's landing face, and every gravity gate all
  use it. Blue = gravity puts you on the floor, violet = gravity puts you on the ceiling.
  Which of the two is bright is the whole gravity read.
- `SURFACE_TINT` — the same two hues lifted toward white, for things that are *about* to
  put you on a surface (the gravity portal's arrow).
- `MASS_FILL` / `MASS_OUTLINE` — one dark fill and one thin outline for every solid block,
  course slab or pattern platform. The blocks are not the message; the face is.

**The gravity portal now points where it takes you.** `GravityFlipMechanic` drew both a
ceiling-bound and a floor-bound gate in the same violet — the one frame that has to answer
"where will I be in two beats?" answered with the colour of where the player already was.
It is now painted in the destination surface's colour, in both the mechanic and the
course-level flip gates.

**The backdrop moved off the running plane.** `renderSkyline()` derives depth from
`TUNING.runner.parallax` (scroll speed *is* depth, so the fastest layer is the nearest),
and the nearest layer is held `BODY_HEIGHT * 1.5` off the live surface. Every layer fades
to transparent as it approaches the plane, so no layer ends at a line that could be read
as an edge to land on. The phrase wash sits in the dead band between the routes
(0.40–0.60) at alpha 0.10, fading out at both scrolling ends so it cannot read as a wall;
the phrase's leading edge gets one hairline, which is the only hard mark the backdrop is
allowed.

**The phrase kept its downbeat, not its colour.** `renderPhraseMark()` draws one hairline
at the beat the current phrase begins on, in the backdrop's single blue-grey. It is the
only phrase cue left, and it is the only one that was ever information: a new phrase is a
real event that lands on a beat. `PhraseReadout` now carries `startBeat` and nothing else —
the phrase's *extent* is no longer drawn, so the mode does not ask for it.

**One hue in the whole backdrop.** The phrase mark and the gravity drift dashes share
`MARK_COLOUR` (`#8fa6d8`), so the background's entire vocabulary is one blue-grey plus the
two sky tones. Every other colour on screen is one the player can act on.

**A new directional cue.** `renderGravityDrift()` draws seven 1px dashes drifting toward
the live surface. The track says which way is down with colour and the gate says it with an
arrow, but both are statements about the *world*; this is the only cue that is a statement
about the player — the field streaming past them in the direction they are about to fall.
It inverts with gravity.

**Beat feedback without a repainted floor.** The beat ruler was already drawn *into* the
body of the live surface, below its edge, so it reads as a ruler on the ground rather than
marks standing on it. That was kept and is now the only rhythm mark on the surface.

## 5. §9 classification of every Runner visual object

**1 — Gameplay-critical** (must be instantly readable; strong silhouette, high contrast)

| object | drawn by | colour |
|---|---|---|
| player body | `RunnerPlayer` | bright, drawn after all terrain |
| base floor / ceiling line | `RunnerMode.renderTrack` | `SURFACE_COLOUR`, 3px live · 1.5px ghost |
| course slab landing face | `RunnerCourseMechanic.renderSlabs` | `SURFACE_COLOUR`, 3px @ 0.95 |
| pattern platform landing face | `PlatformMechanic` | `SURFACE_COLOUR`, 3px @ 0.95 |
| spike | `SpikeMechanic` | `#ff5c5c` + glow, `#ffd0d0` edges |
| low wall (beam) | `LowWallMechanic` | `#ffa23d`, `#ffe0b8` edge |
| gap (pit) | `GapMechanic` / `renderGaps` | `#05070d` void, `#7d86a3` lips |
| gravity portal | `GravityFlipMechanic` / `renderFlipGates` | destination `SURFACE_COLOUR` + `SURFACE_TINT` |
| bounce pad | `BouncePadMechanic` / `renderPads` | `#4dffd0` |
| air-jump ring | `RunnerCourseMechanic` | `#ffd166` |
| hazard beam | `renderHazards` | `#ff9d5c` |
| platform lethal front face | `PlatformMechanic` | `#ff5c5c` @ 0.35 |

**2 — Gameplay communication** (states something true about the run, not about itself)

| object | what it states |
|---|---|
| beat ticks on the live surface (`#4a5a80`, 1–2px, drawn *into* the body) | the beat |
| player lane line (`#6de3ff` @ 0.12) | fixed timing reference |
| gravity drift dashes (`#8fa6d8`, 1px, ≤0.16) | which way the world is pulling |
| phrase mark (`#8fa6d8`, 1.5px @ 0.22) | that a new phrase has started |
| live surface bright vs. inactive ghosted | the gravity read |
| speed streaks while airborne (`#6de3ff`, ≤0.14) | speed |
| flip-gate countdown text | when gravity returns |
| hit flash | the hit |
| debug overlay (`this.debug` only) | apex line, probe, breadcrumbs |

**3 — Decoration** (verified not mistakable for geometry)

| object | why it cannot be mistaken |
|---|---|
| phrase mark: one hairline at the phrase's first beat (`#8fa6d8` @ 0.22) | vertical, spans only the dead band 0.40–0.60 — a wall would span between surfaces |
| skyline layers (3, alpha 0.20–0.42) | ≥1.5× body height off the live surface, gradient-faded *toward* the plane, derived from scroll depth |
| sky fill (`#0b0f18` / `#150d1c`) | full-bleed, no edge |
| track body fills (`#141b29`) | behind the surface lines |

**4 — Meaningless visual noise** (removed or redesigned)

| object | verdict |
|---|---|
| `renderPhraseTint` motif-coloured floor band | **removed** (see §3.1) |
| the 6-hue motif palette + `motifColour()` hash | **removed** (see §3.2) — phrase identity is now a single neutral hairline |
| base-line slab bodies (86 of 166) | **removed** (except 10 that bridge a hole) |
| floating/anchored edge-colour split | **removed** (0 anchored slabs exist) |
| `renderParallax` blocks standing on the plane | **replaced** by `renderSkyline` |
| `PlatformMechanic`'s third blue landing face | **redesigned** → `SURFACE_COLOUR` |

## 6. §13 visual test level

`beatbound_library_v1/runner_readability.level.json` — registered in `levels.index.json`,
so it is automatically enrolled in `test:timing`, `runner-check`, `audit`, `fairness` and
`level-report`. 120 BPM, 27 bars, 54 seconds.

| section | bars | beats | what it shows | measured |
|---|---|---|---|---|
| R-A Basic running | 1–4 | 16 | stable floor, 0 slabs, 0 hazards, 0 gaps | 0 jumps, 100% on the base line |
| R-B Simple jump rhythm | 5–8 | 16 | single obstacle, clear telegraph | 7 jumps, 1.75/bar |
| R-C Multi-jump phrase | 9–12 | 16 | consecutive jump phrase | 15 jumps, 3.75/bar, 0.61 airborne |
| R-D Platform variation | 13–16 | 16 | elevated surfaces, clearly readable | 12 jumps, v-range 0.580, all 5 zones |
| R-E Gravity inversion | 17–22 | 24 | flip up, ceiling run, flip back | 2 flips, 26% of the run on the ceiling |
| R-F Faster rhythmic sequence | 23–27 | 20 | demanding but uncluttered close | 18 jumps, 3.60/bar, the level's only hazard + 3 gaps |

R-A is deliberately obstacle-free: it is the frame you look at to check the floor reads as
one surface and nothing decorative sits on it. `runner-check` reports it as
`NOTE longest empty stretch 16.03 beats` — informational, and the intended state for that
section. No difficulty was raised anywhere: the demo's obstacle density is below
`runner_showcase`'s (2.80 jumps/bar).

## 7. Gameplay result

- The normal floor is one surface, one colour, one thickness, every frame. It no longer
  changes hue, because nothing in the level may recolour it.
- The background does not change hue either. The backdrop's whole vocabulary is one
  blue-grey plus the two sky tones, and it never states a colour the player has to
  interpret.
- A bright horizontal line means "you can land on this" and nothing else, everywhere it
  appears — base line, course slab, pattern platform. There is no second blue.
- A gravity gate is painted in the colour of the surface it delivers you to, so the flip
  answers its own question.
- Nothing decorative is drawn as a block on or near the running plane. The nearest skyline
  layer is 1.5 player-heights away and fades out before it gets there.
- No fake platforms, no fake obstacles, no meaningless floor bricks, no arbitrary
  gameplay-coloured ground.
- Physics, collision, pattern generation and difficulty were not touched. Every course
  still flies exactly as before, with the same jump counts and the same flip counts.

## 8. Test result

Run after the final edit:

| check | result |
|---|---|
| `npm run typecheck` | pass (exit 0) |
| `npm run test:timing` | pass — all 96 patterns schedule, run and retire (ARENA 51, RUNNER 25, VERTICAL 9, RADIAL 11; 630 mechanics) |
| `npm run runner-check` | pass — **12 course(s) fly as planned**, 25/25 RUNNER patterns clearable, scroll-lead and entry checks ok |
| `npm run fairness` | pass — all 51 ARENA patterns readable |
| `npm run test:editor` | pass — 273/273 |
| `npm run audit` | **fail — not caused by this work, see below** |

The new level was validated in all of the above: `runner_readability.level.json` reports
`ok` for R-A through R-F in `runner-check`, `6 events` in `test:timing`, and is correctly
skipped by `camp-audit` (no ARENA sections).

### The one failing check

`npm run audit` exits 1 on `beatbound_library_v1/arkins_-_jangchung.level.json`
(`section_02`, `section_09` — both ARENA, 965/1681 and 831/1681 safe spots, campable at
(0.01, 0.01)).

This is not a regression from this work:

- The level file is untracked and was written at 20:40 today, and `levels.index.json` was
  modified at 20:43 — **while this session was running**. The same audit passed earlier in
  the session, and its level list at that point did not include `arkins_-_jangchung`.
- Both failing sections are ARENA. `camp-audit` only reports ARENA sections, and no ARENA
  file, shared file, or level file other than `levels.index.json` was modified by this
  work.
- Every other check, including all ARENA ones (`fairness`, `test:timing`'s ARENA coverage,
  and the ARENA sections of `toosie_slide_arena_primary` and `prototype_90s`), passes.

Fixing it would mean editing ARENA level content, which the work order excludes. It is
flagged here for a decision.

## 9. Files changed

| file | change |
|---|---|
| `src/mechanics/runner/surface.ts` | +`SURFACE_COLOUR`, `SURFACE_TINT`, `MASS_FILL`, `MASS_OUTLINE` — the palette, single source of truth |
| `src/mechanics/runner/courseWorld.ts` | +`baseYOf()`, `isBaseLineSlab()`, `CourseWorld.visibleSpans()` — what is geometry vs. what merely sits on the base line |
| `src/mechanics/runner/RunnerCourseMechanic.ts` | new palette; `renderSlabs` draws mass + one surface-coloured landing face; `renderPhraseTint` and `motifColour()` deleted; flip gates coloured by destination; hardcoded 0.72/0.28 → `GROUND_Y`/`CEILING_Y` |
| `src/modes/runner/RunnerMode.ts` | `renderBackdrop` (phrase mark, skyline, gravity drift); `renderTrack` uses the surface palette; `PhraseReadout` reduced to `startBeat` |
| `src/mechanics/runner/PlatformMechanic.ts` | landing face → `SURFACE_COLOUR`; body → `MASS_FILL` |
| `src/mechanics/runner/GravityFlipMechanic.ts` | portal colour and highlight from the destination surface |
| `beatbound_library_v1/runner_readability.level.json` | **new** — the §13 visual test level |
| `beatbound_library_v1/levels.index.json` | registered `runner_readability` |

## 10. Not verified

There is no headless canvas in this project (`node_modules` has no `canvas`,
`skia-canvas`, `puppeteer` or `playwright`), so the visual claims above are established by
reading the render code and by asserting the geometry, not by rendering a frame. The
numbers in §2 come from a temporary analysis tool that loaded every course through
`LevelLoader` and read the real `CourseWorld`; it was deleted after use. Manual play of
`runner_readability.level.json` in the browser is still worth doing —
`npm run dev`, then open the level from the library.

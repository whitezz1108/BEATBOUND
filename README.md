<div align="center">

<img src="../assets/beatbound-banner.jpg" alt="BeatBound" width="100%">

# BeatBound

**One song. Four games. No cuts.**

A rhythm game where the music decides which game you're playing.
Dodge, run, tap and aim — inside a single continuous take, on one health bar.

![TypeScript](https://img.shields.io/badge/TypeScript-5.5-3178C6?logo=typescript&logoColor=white)
![Vite](https://img.shields.io/badge/Vite-5-646CFF?logo=vite&logoColor=white)
![Engine](https://img.shields.io/badge/game_engine-none-2b2b2b)
![Node](https://img.shields.io/badge/node-18%2B-339933?logo=node.js&logoColor=white)

</div>

---

## Why we built this

Most rhythm games pick one verb and repeat it for three minutes. You dodge, or
you tap, or you run — and after the first chorus you have seen everything the
game will ever ask of you. The song changes; the game doesn't.

We wanted the opposite. **The song is the level designer.** When the music drops
into a breakdown, the game should change with it, not just get faster. So
BeatBound splits a song into sections and gives each section its own mode:
one bar you're dodging a floor of hazards top-down, the next you're
auto-running a platform course, then six lanes of falling notes, then eight
directions of incoming arrows. A section boundary is a mode boundary.

Two things follow from that, and they shaped the whole build:

**One run, one health bar.** Because the modes are stitched end to end, damage
is shared. The hit you took dodging in ARENA is still on your bar when the song
hands you to RUNNER. There is no reset between modes and no place to hide.

**The level data has to be readable — by people and by machines.** Every level,
pattern and mechanic is JSON, and musical time is expressed in bars and beats
rather than seconds. That is what makes levels diffable, auditable, and
generatable.

---

## How it's built

TypeScript and Vite. No game engine, no asset pipeline — the renderer is a
plain 2D canvas and every visual is drawn in code. The only dependencies are
dev-time (`vite`, `typescript`, `esbuild`).

### The runtime is five systems in one direction

```text
BeatClock          musical time from the audio clock; schedules by bar/beat
    ↓
LevelLoader        validates + compiles Song → Sections → Patterns → absolute bars
    ↓
PatternScheduler   pattern events → BeatClock callbacks (no mechanic knowledge)
    ↓
MechanicRegistry   mechanic id → runtime implementation, params, timing
    ↓
Runtime Mechanic   SCHEDULED → TELEGRAPH → ACTIVE → RECOVERY → FINISHED

ModeManager        owns the active gameplay environment
```

Each layer only knows the one below it. `PatternScheduler` has never heard of a
spike or a laser; it moves beats. `ModeManager` is the only thing that knows a
mode can change at all.

| Path | Role |
| --- | --- |
| `src/core/` | The five systems, plus tempo maps, geometry and rendering |
| `src/modes/` | Per-mode environments: `arena/`, `runner/`, `vertical/`, `radial/` |
| `src/mechanics/` | One folder per mode; each `index.ts` binds ids to runtimes |
| `src/feel/` | Camera, particles, screen and audio, behind one `GameFeel` facade |
| `src/tuning.ts` | Every tunable number in the game, in one file |

Adding a mechanic is one `register()` call plus one implementation file. Adding
a mode is one `register()` call in `BeatBoundGame`. Neither touches BeatClock,
LevelLoader or the scheduler.

### The AI level director

Hand-authoring a multi-mode level means deciding, bar by bar, what the song is
doing and which mode should answer it. That is a real design job, and it is the
one part of the pipeline we let a model attempt — under supervision.

```text
LAYER 1  Music analysis       audio → BPM, beats, downbeats, sections
LAYER 2  Director context     analysis → director_context_v2.json
LAYER 3  AI director          context → level_blueprint_v2.json   ← the only model call
LAYER 4  Compiler + validator blueprint → level.json, then audited
```

The rule that organizes all of it: **the model directs; the code decides.**
The AI emits a plan — sections, modes, functions, difficulty curve, intent —
and never touches collision logic, physics or validation. Facts are not the
model's to invent: BPM, bar count, duration and audio path are *recorded* from
the analysis artifacts and never accepted from the model. Layer 4 calls the
same primitives the hand-authored levels use, so the AI path cannot drift from
the tested one.

A blueprint is a complete, replayable artifact. `generateLevel({ blueprint })`
recompiles it with no model call at all, and the same seed produces
byte-identical output — which is what makes the AI layer auditable.

### We tested the design, not just the code

The interesting failures in this genre aren't crashes, they're *design* faults:
a section you can beat by standing still, a pattern that's unreadable, an
obstacle that is physically impossible. So the test suite asks design questions.

| Command | The question it answers |
| --- | --- |
| `npm run level` | Bar-by-bar report of what a level schedules. **Fails on empty bars** — dead air cannot creep back in. |
| `npm run audit` | Can this section be beaten standing still? Simulates 1681 standing positions against the real mechanics. |
| `npm run runner-check` | Is every obstacle physically clearable? RUNNER is the one mode where a pattern can be *impossible* rather than hard. |
| `npm run fairness` | Is every ARENA event readable, and can the pattern be camped? |
| `npm test` | All of the above, plus typecheck and the editor tests. |

These are not decoration. `camp-audit` caught an A05 chain and an A03
projectile flaw, then caught them a second time — a wall of projectiles that
stopped 0.07 units short of the arena edge, leaving a permanent safe band along
it that no one would have noticed by playing. `runner-check` fails the build on
any obstacle with under 0.10 beats of take-off slack, because at 120 BPM that's
50 ms and no human clears it.

The workflow behind that: every system landed with a written audit document and
a headless test that could reproduce its claims, rather than a manual playtest
and a shrug.

---

## Gameplay

Pick a level, press start, and play the song. The track is split into sections;
each section names a mode, a difficulty tier and a list of patterns. You don't
choose the mode — the arrangement does.

### The four modes

| Mode | What it is | Controls |
| --- | --- | --- |
| **ARENA** | Top-down dodging. Floors, chains, lasers and sweeps telegraph their danger, then activate on the beat. | `W` `A` `S` `D` / arrows — move |
| **RUNNER** | Auto-running platforming. Obstacles arrive on the beat; you supply the rhythm of jumps. | `W` / `↑` / `Space` — jump (hold = higher, press again mid-air = double jump) · `S` / `↓` — slide · `F` / `Shift` — flip gravity |
| **VERTICAL** | Six-lane 3D highway. Notes fall toward you and are judged in beats, so accuracy demands scale with tempo. | `A` `S` `D` `J` `K` `L` — lanes 1–6 |
| **RADIAL** | Eight-direction notes converging on a centre ring. Diagonals are two keys at once. | arrows / `W` `A` `S` `D` |
| **DUO** | Two-player co-op. Designed for, not implemented — no mechanics in the library yet. | — |

`P` pauses · `R` restarts the level in place · `Esc` returns to the menu.

### Health is shared across the whole song

| Source | Cost | Notes |
| --- | --- | --- |
| `MISS` | 8 | A missed rhythm note. Deliberately bypasses invulnerability |
| `COLLISION` | 10 | Floors, chains, lasers, sweeps |
| `PROJECTILE` | 12 | Anything fired at you |
| `OBSTACLE` | 15 | RUNNER obstacles, and falling out of the world |

Collision damage grants 0.8 s of immunity — otherwise a hazard you're standing
inside would drain the bar in a few frames. Missed notes skip that window on
purpose: three missed notes should cost three notes' worth of health.

At zero, the modes stop accepting input, live hazards are dropped, and `R`
restarts the level **in place** — a page reload would throw away the audio
context and desync the whole run.

### Mode changes get a runway

A mode change is a context switch: different controls, different camera,
different thing to look at. It is the one place the game can be unfair without
any single hazard being unfair, so the tail of the outgoing section simply
doesn't spawn. The pattern isn't rewritten — its tail is held back. You get a
clear runway and a countdown banner naming the incoming mode and printing its
real bindings, read from the same table the mode itself imports.

Every countdown in the game is the same three seconds, opening count-in
included.

### What's in the box

10 levels in `levels.index.json`. A few worth starting with:

| Level | Why |
| --- | --- |
| `prototype_90s` | The full multi-mode song map — all four modes and every transition. Start here. |
| `toosie_slide_arena_primary` | Arena-dominant arrangement, 75% ARENA with Runner/Radial/Vertical excursions at the phrase boundaries. |
| `toosie_slide_dance_golden` | The whole song as one mode: 44 rounds of hand-authored phrases, each played then mirrored at double speed. |
| `runner_benchmark_v2` | 30 seconds of RUNNER authored as a single arc — teach, develop, transform, climax, release. |
| `arkins_-_jangchung` | Generated end-to-end by the AI level director. |

URL switches for jumping straight into a section:

| Switch | Effect |
| --- | --- |
| `?level=<file>` | Load a different level |
| `?startBar=21` | Start playback at that bar (earlier events are skipped, not replayed) |
| `?invincible` | Hits still flash and count, but the run never fails |

They combine: `?startBar=21&invincible` drops you into the chain section with
nothing at stake. The start screen mirrors all three.

### Coverage

**25 mechanics, 96 patterns** — every one has a runtime, and `npm test` fails
if any pattern stops scheduling, spawning or retiring cleanly.

| Mode | Mechanics | Patterns |
| --- | --- | --- |
| ARENA | 12 — Floor Warning, Safe Tile, Projectile, Radial Burst, Chain, Laser, Rotating Fan, Spiral, Wave Sweep, Ring, Sector Sweep, Rhythm Breakout | 51 |
| RUNNER | 6 — Spike, Gap, Low Wall, Platform, Bounce Pad, Gravity Flip | 25 |
| VERTICAL | 4 — Tap, Hold, Double, Drift Hold | 9 |
| RADIAL | 3 — Single, Opposite Double, Clockwise, across all eight directions | 11 |

---

## Running it

Needs **Node 18+**.

```bash
npm install
npm run dev
```

Open the printed localhost URL and press Start. The level picker, start bar and
invincible toggle are all on the start screen.

### Commands

```bash
npm run dev           # play it
npm test              # typecheck + timing + camp-audit + runner-check + fairness + editor tests
npm run build         # typecheck + production bundle

npm run level         # bar-by-bar report of a level
npm run audit         # can any section be beaten standing still?
npm run runner-check  # is every RUNNER obstacle physically clearable?
npm run fairness      # is every ARENA pattern readable, and can it be camped?
```

`npm run level` takes a filename and an optional start bar:

```bash
npm run level -- prototype_90s.level.json
npm run level -- arena_test.level.json 17
```

### The editor and the AI director

`npm run editor` starts the level editor — an AI-assisted authoring workshop
that writes JSON and audio back into this folder, which the runtime already
fetches at play time. The game itself is untouched by it.

`npm run generate` runs the level director end to end. It needs an LLM
endpoint; copy `.env.example` to `.env` and set `BEATBOUND_LLM_API_KEY`
(defaults to DeepSeek). Without a key the editor still works — only generation
is unavailable.

### Polish Lab

`?lab=<id>` launches an isolated test that loops forever: one mode, one
mechanic or one pattern family, with live BPM and intensity controls. The lab
menu is on the start screen. Labs build their level in memory and hand it to
the same `LevelLoader` the JSON levels use, so they exercise the real
compile → schedule → spawn path rather than a shortcut.

| Keys | |
| --- | --- |
| `R` | instant reset |
| `Space` | trigger this lab's mechanic again |
| `1` `2` `3` | intensity preset (0.25 / 0.55 / 0.90) |
| `-` `=` | BPM ±5 |
| `[` `]` | cycle pattern variant |
| `,` `.` | polish preset: SUBTLE / STANDARD / MAX |
| `Tab` | back to the lab menu |

---

## This folder

Everything here is data. The runtime fetches it directly, and so does the
editor — designers and the game read the same files, which is why there is no
export step and no drift between them.

| File | What it is |
| --- | --- |
| `mechanics.mvp.json` | Atomic mechanics — the verbs. 25 of them. |
| `patterns.mvp.json` | Reusable gameplay phrases built from mechanics. 96 of them. |
| `*.level.json` | How one song arranges modes and patterns across its sections. |
| `levels.index.json` | The level picker's source of truth. |
| `*.schema.json` | The contracts the loader validates against. |
| `audio/` | Level audio, served relative to this folder. |

### Conventions

- Patterns are authored in **bar / beat**, never seconds. `bar` starts at 1;
  in 4/4 `beat` is usually 1–4, with subdivisions like 1.5 allowed.
- `telegraphBeats` outranks any visual effect. A player must be able to read
  the warning before the hazard exists.
- `intensity` is 0–1, mapped at runtime to speed, density and count.
- Mechanic owns runtime behaviour; pattern owns arrangement. Neither reaches
  into the other.

---

<div align="center">

Capstone project by **Muneeb, Evan and Nadia**.
See `LICENSE` in the repository root.

</div>

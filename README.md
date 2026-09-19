# BEATBOUND

2nd game for capstone groupwork by Muneeb, Evan and Nadia

![BeatBound banner](assets/beatbound-banner.jpg)

testing adding stuff

## Running the prototype

```bash
npm install
npm run dev          # open the printed localhost URL, click Start
npm run test:timing  # headless BeatClock / scheduler checks
npm run build        # typecheck + production bundle
```

### Modes and controls

| Mode | Gameplay | Controls |
| --- | --- | --- |
| ARENA | Top-down dodging | **WASD / arrows** move |
| RUNNER | Side-scrolling platforming | **W / ↑ / space** jump, **S / ↓** slide |
| VERTICAL | Four-lane falling notes | **D F J K** (or **1–4**) |
| RADIAL | Four-direction notes | **arrows** or **WASD** |
| DUO | Two-player co-op | not implemented — no mechanics in the library yet |

**P** pauses, **R** restarts. The start screen has a level picker, a start-bar
box and an invincible toggle; all three are mirrored in the URL.

### Inspecting levels without playing them

`npm run level` prints a bar-by-bar report of what a level schedules — every
mechanic, its musical position, its resolved params and its telegraph/active
window — so you can read a level instead of surviving it.

```bash
npm run level                                 # the default arena test level
npm run level -- prototype_90s.level.json     # any level in the library
npm run level -- arena_test.level.json 17     # only bar 17 onward
```

URL switches for jumping straight to a section in the browser:

| Switch | Effect |
| --- | --- |
| `?level=prototype_90s.level.json` | load a different level |
| `?startBar=21` | start playback at that bar (earlier events are skipped, not replayed) |
| `?invincible` | hits still flash and count, but the run never fails |

They combine: `?startBar=21&invincible` drops you into the chain section with
nothing at stake.

The level's audio file is optional during development — if `song.audio` is
missing, the runtime synthesizes a click track from the tempo map so BeatClock
still runs on the real audio clock. Drop the mp3 in at the path the level names
and it is used automatically.

## Architecture

Gameplay is data-driven: levels are authored as JSON in `beatbound_library_v1/`,
which Vite serves directly, so designers and the runtime read the same files.

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

ModeManager        owns the active gameplay environment (ARENA today)
```

| Path | Role |
| --- | --- |
| `src/core/` | The five core systems, plus tempo maps, geometry and rendering |
| `src/modes/` | Per-mode environments: `arena/`, `runner/`, `vertical/`, `radial/`, shared `rhythm/` |
| `src/mechanics/` | One folder per mode; `index.ts` in each binds ids to runtimes |
| `src/core/capabilities.ts` | Opt-in mechanic capabilities (timed input, runner terrain) |
| `tools/sync-test.ts` | Headless timing/scheduling verification |

Adding a mechanic is one `register()` call in its mode's `index.ts` plus an
implementation file; adding a mode is one `register()` call in `BeatBoundGame`.
Neither touches BeatClock, PatternScheduler or LevelLoader.

Most mechanics only need `RuntimeMechanic` -- run a beat-driven lifecycle,
expose damaging shapes, draw. Two kinds need more, and say so through opt-in
interfaces in `src/core/capabilities.ts` rather than by widening the contract
for everyone:

- **`InputTargetMechanic`** — VERTICAL and RADIAL notes expose `NoteTarget`s
  (lane or direction, beat, hold length). `NoteMode` judges them; the timing
  windows are in beats, so accuracy demands scale with tempo.
- **`RunnerTerrain`** — RUNNER mechanics that change the world rather than
  damage it: gaps in the ground, bounce pads, gravity flips.

RUNNER obstacles declare `telegraphBeats: 0` in the library because their
warning is spatial. They ask the registry for `spawnLeadBeats` instead, so
`PatternScheduler` creates them a bar early without knowing why, and
`ModeManager` holds them until the RUNNER section actually starts.

### Mechanic coverage

| Mode | Implemented |
| --- | --- |
| ARENA | A01 Floor Warning, A02 Safe Tile, A03 Projectile, A05 Chain, A06 Laser |
| RUNNER | R01 Spike, R02 Gap, R03 Low Wall, R08 Bounce Pad, R09 Gravity Flip |
| VERTICAL | V01 Tap, V02 Hold, V03 Double |
| RADIAL | D01 Single, D02 Opposite Double, D06 Clockwise |

Every mechanic in `mechanics.mvp.json` now has a runtime.

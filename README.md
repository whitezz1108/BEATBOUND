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

Controls: **WASD / arrows** move, **P** pause, **R** restart.

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
| `src/modes/` | Per-mode gameplay environments (`arena/`, placeholder for the rest) |
| `src/mechanics/arena/` | A01 Floor Warning, A03 Projectile, A05 Chain |
| `tools/sync-test.ts` | Headless timing/scheduling verification |

Adding a mechanic is one `register()` call in `src/mechanics/arena/index.ts`
plus its implementation file; adding a mode is one `register()` call in
`BeatBoundGame`. Neither touches BeatClock, PatternScheduler or LevelLoader.

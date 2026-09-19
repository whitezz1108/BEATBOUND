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
Load a different level with `?level=prototype_90s.level.json`.

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

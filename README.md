# BEATBOUND

2nd game for capstone groupwork by Muneeb, Evan and Nadia

![BeatBound banner](assets/beatbound-banner.jpg)

testing adding stuff

## Running the prototype

```bash
npm install
npm run dev          # open the printed localhost URL, click Start
npm test             # typecheck + timing checks + camping audit
npm run level        # bar-by-bar report of a level, with reaction seconds
npm run audit        # can any section be beaten standing still?
npm run runner-check # is every RUNNER obstacle physically clearable?
npm run fairness     # is every ARENA pattern readable, and can it be camped?
npm run build        # typecheck + production bundle
```

### Polish Lab

The combined demo is no longer the tuning environment. `?lab=<id>` launches an
isolated test that loops forever — one mode, one mechanic or one pattern family,
with live BPM and intensity controls. The lab menu is on the start screen.

| Keys | |
| --- | --- |
| `R` | instant reset |
| `Space` | trigger this lab's mechanic again |
| `1` `2` `3` | intensity preset (0.25 / 0.55 / 0.90) |
| `-` `=` | BPM ±5 |
| `[` `]` | cycle pattern variant |
| `,` `.` | polish preset: SUBTLE / STANDARD / MAX |
| `Tab` | back to the lab menu |

Labs build their level in memory and hand it to the same `LevelLoader` the JSON
levels use, so a lab exercises the real compile → schedule → spawn path rather
than a shortcut.

### Modes and controls

| Mode | Gameplay | Controls |
| --- | --- | --- |
| ARENA | Top-down dodging | **WASD / arrows** move |
| RUNNER | Auto-run rhythm platforming | **W / ↑ / space** jump (hold = higher), **S / ↓** slide |
| VERTICAL | Six-lane 3D-highway falling notes | **A S D J K L** |
| RADIAL | Eight-direction notes | **arrows** or **WASD**; diagonals are two keys at once |
| DUO | Two-player co-op | not implemented — no mechanics in the library yet |

**P** pauses, **R** restarts the level in place, **Esc** returns to the menu.
The start screen has a level picker, a start-bar box and an invincible toggle;
all three are mirrored in the URL.

### Inspecting levels without playing them

`npm run level` prints a bar-by-bar report of what a level schedules — every
mechanic, its musical position, its resolved params and its telegraph/active
window — so you can read a level instead of surviving it. Each section also
gets a **bar map** of events per bar, where a `.` marks a bar with nothing in
it (dead air the player just stands through):

```text
S01  ARENA  bars 1-8  TEACH  difficulty 1
  patterns: AP01@1 AP01@3 AP01@5 AP03@7 AP03@8
  bar map:  2 2 2 2 2 2 4 4
```

`npm run test:timing` fails if any level has an empty bar, so dead air cannot
creep back in.

`npm run audit` answers a different question: **can this section be beaten by
standing still?** It simulates the real mechanics and, for a grid of 1681
standing positions, counts the hits a motionless player would take. A section
where any position takes zero hits is trivially campable.

```text
level                       section   min hits  safe spots   verdict
arena_test.level.json       T02       4         0/1681       ok (must move)
prototype_90s.level.json    S05       2         0/1681       ok (must move)
```

This is how the A05 chain and A03 projectile flaws were found and confirmed
fixed — twice: the audit later caught a wall of projectiles that stopped 0.07
short of the far edge, leaving a permanent safe band along it. RUNNER, VERTICAL
and RADIAL are skipped — you cannot stand still in them by construction.

`npm run runner-check` answers the RUNNER equivalent: **is every obstacle
physically clearable?** The runner is the one mode where a pattern can be
impossible rather than merely hard, because two obstacles can demand
contradictory states — be airborne here, be sliding on the ground a fraction of
a beat later. It derives each obstacle's danger window from the same constants
the mechanics use, allows one jump to clear a group (a half-beat "double spike"
is meant to be one jump), and reports the take-off slack in beats.

It also models R04 platforms: only the leading face damages, so a platform is a
JUMP obstacle whose top is terrain — a platform at or under the step-up height
is walked onto and is not an obstacle at all.

```text
jump 0.95 beats / 0.32 high · track 0.26 units per beat
spike window 0.21 beats · wall window 0.38 beats
  RP18  Staircase Up          ok
  RP21  Platform Leap         ok
```

Anything under 0.10 beats of slack (50 ms at 120 BPM) is flagged as tight;
negative slack fails the build.

`npm run fairness` audits the ARENA library against the fairness system. Two
questions, both in the player's units:

- **Is every event readable?** Each event's warning — its telegraph plus the
  hazard's travel at the section's tier — is compared with the seconds a perfect
  player needs to reach safety. The mechanics clamp themselves against the same
  helpers at construction, so this is the independent check that the clamps hold
  across the whole library.
- **Can the pattern be camped?** The same question `camp-audit` asks of levels,
  asked of single patterns. Many ARENA patterns are *layer pieces* that only
  cover part of the arena by design, so this one reports rather than fails;
  `camp-audit` gates the composed levels, which is where the player meets them.

```text
reaction floor 0.60s · comfort 0.90s · player radius 0.014
minimum gap 0.060 field units
AP09    Rhythm Window       0.80  1.95s   0.60s   ok
```

`npm test` runs the typecheck, the timing test, the camping audit, the runner
check and the fairness check.

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

### Health, damage and death

One `HealthManager` lives for a whole song and is shared by all four modes, so
damage taken dodging in ARENA still matters when the song hands the player to
RUNNER. Modes never subtract health — they name what happened and the manager
decides what it costs.

| Source | Cost | Notes |
| --- | --- | --- |
| `MISS` | 8 | A missed rhythm note. Bypasses invulnerability on purpose |
| `COLLISION` | 10 | Floors, chains, lasers, sweeps |
| `PROJECTILE` | 12 | Anything fired at you |
| `OBSTACLE` | 15 | RUNNER obstacles, and falling out of the world |

Collision damage grants 0.8 s of immunity, or a hazard you are standing inside
drains the bar in a few frames. Missed notes deliberately skip that window —
three missed notes should cost three notes' worth of health.

At zero health the modes stop accepting input, the scheduler is cleared, live
hazards are dropped, and **R** restarts the level in place (not a page reload —
that would throw away the audio context too).

All of it is in `TUNING.health`.

### Game feel

Presentation lives in `src/feel/` behind one facade. Mechanics describe *what
happened* — "a heavy impact here, pointing that way" — and `GameFeel` decides
what the camera, particles, screen and audio do about it. Nothing else owns a
shake timer or a flash.

| File | Role |
| --- | --- |
| `GameFeel.ts` | The facade: `impact`, `playerHit`, `perfectDodge`, `telegraph`, ambient layer |
| `CameraFX.ts` | Beat and downbeat pulses (in beats), shake and directional kick (in seconds) |
| `ScreenFX.ts` | Flashes, vignette pulses, shockwave rings — all one-shot |
| `ParticlePool.ts` | 900-particle pool, no per-emission allocation |
| `AudioFX.ts` | ~28 named cues, synthesized, mixed under the music |
| `Easing.ts` | The motion grammar: telegraph easeIn, attack easeOut, impact easeOutBack |
| `FeelSink.ts` | The narrow interface mechanics use; `NULL_FEEL` lets headless tools run the same code |

Impact levels are `LIGHT` / `MEDIUM` / `HEAVY`. A player hit also triggers a
60 ms **hit-stop**: `BeatClock.visualBeat` is held while `absoluteBeat` keeps
running, so the picture freezes but scheduling, judging and the music never do.

All tuning is centralised in `src/tuning.ts` — camera, arena, runner, vertical,
radial and ambient values, plus the three polish presets.

### Transitions

A mode change is a context switch — different controls, different camera,
different read — and it is the one place the game can be unfair without any
single hazard being unfair. So the tail of a section before a mode change
simply does not spawn. The pattern is not rewritten; its tail is held back,
which gives the player a clear runway and a countdown banner naming what is
arriving. The scene then wipes in the incoming mode's colour.

Every countdown in the game is the same three seconds, whether it is the
opening count-in or the mode-change breather. The window is expressed in
*seconds* (`TUNING.transition.countdownSeconds`) and converted with
`beatsForSeconds`, with the legacy beat count as a floor so a slow song cannot
cut it short and a 4-beat floor so a bar-1 RUNNER pattern still gets the scroll
lead it needs. The banner prints the next mode's real bindings, read from
`src/core/controls.ts` — the same tables the modes import — so a rebind updates
the gameplay and the on-screen hint together.

`npm run test:timing` knows about breathers and does not count them as dead air.

### Mechanic coverage

| Mode | Implemented |
| --- | --- |
| ARENA | A01 Floor Warning, A02 Safe Tile, A03 Projectile, **A04 Rotating Radial Spray**, A05 Chain, A06 Laser, **A07 Rotating Fan**, **A08 Spiral**, **A09 Wave Sweep**, **A10 Ring** |
| RUNNER | R01 Spike, R02 Gap, R03 Low Wall, **R04 Platform**, R08 Bounce Pad, R09 Gravity Flip |
| VERTICAL | V01 Tap, V02 Hold, V03 Double, **V04 Drift Hold** |
| RADIAL | D01 Single, D02 Opposite Double, D06 Clockwise — all across **eight** directions |

All 23 mechanics and all 65 patterns (ARENA 20, RUNNER 25, VERTICAL 9, RADIAL 11)
have runtimes, and `npm test` fails if any pattern stops scheduling, spawning or
retiring cleanly.

R04 Platform is the newest of these and the only one that changes the *shape* of
the world rather than adding a hazard to it: a block's leading face damages, but
clear it and the block's top becomes terrain the player can stand on, run along
and step off. Blocks at or below `TUNING.runner.stepUpHeight` are walked onto
without an input, so the library can use them as stairs. On the ceiling, in
inverted gravity, the same block hangs down and is run along underneath.

Directions live in `src/core/direction8.ts`: one table maps N/NE/E/SE/S/SW/W/NW
to angles, vectors, glyphs, colours and the cardinal keys that enter them. The
legacy `UP`/`DOWN`/`LEFT`/`RIGHT` spellings still parse, so existing patterns
were not touched.

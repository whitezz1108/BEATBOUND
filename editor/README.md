# BeatBound Level Editor

AI-assisted level creation workshop for BeatBound. This folder is **separate
from the game runtime** — the existing game is untouched and stays playable on
its own. The editor only *writes data* (JSON + audio) into
`beatbound_library_v1/`, which the runtime already fetches at play time.

## Findings from inspecting the runtime (recorded per dev order step 1)

- The game is **data-driven**: levels, patterns and mechanics are JSON in
  `beatbound_library_v1/`, served by Vite as the web root. No game code was
  modified to build this editor.
- **Four implemented gameplay modes**: `ARENA`, `RUNNER`, `VERTICAL`, `RADIAL`
  (the prompt's "fourth mode" is RADIAL — eight-direction notes). `DUO` exists
  as a name only.
- **Level format** (`level.schema.json`): `song` (bpm, timeSignature, audio
  path) + `sections[]`. Each section has an absolute `startBar`, `lengthBars`,
  `mode`, optional `function` / `difficulty`, and an ordered `patterns[]` list
  of `{patternId, repeat, intensity}`. `transitionOut` names the mode hand-off
  (e.g. `ARENA_TO_RUNNER`); the runtime runs a coloured wipe (`sceneBeats` = 2
  beats, live value in `src/tuning.ts`) when the mode swaps at the section
  boundary.
- **Mode-change breather**: before every mode change the runtime stops spawning
  entirely for the last `TUNING.transition.breatherBeats` (6) beats of the
  outgoing section — the pattern is not rewritten, its tail is held back.
  The editor mirrors this **beat-precisely**: the fillable region of such a
  section ends exactly at `sectionEndBeat - breatherBeats` (which cuts 1.5 bars
  in 4/4, not 2), and the transition tail ends inside that region. The last
  placement may *straddle* the boundary — that is the designed hand-off: the
  runtime holds back the beats past it, so validation treats held-back
  activations as expected warnings, and only errors when a placement starts
  inside the breather. Breather bars stay deliberately empty
  (`npm run test:timing` exempts them). The editor never hardcodes the value:
  the server reads `src/tuning.ts` at startup, injects it over the rules-JSON
  mirror, and warns on any disagreement.
- **Pattern library**: 55 patterns in `patterns.mvp.json` (`APxx`, `RPxx`,
  `VPxx`, `DPxx`) with per-pattern difficulty axes, `lengthBars`, music tags and
  event lists. The library is the single source of truth — the editor's pattern
  index is *derived* from it (see `patterns/`), never a copy. Patterns that do
  not activate in every one of their bars (holds/drifts, e.g. `AP07`, `AP14`,
  `RP15`) are excluded from auto-placement but stay hand-pickable.
- **Tempo is constant**: `ConstantTempoMap` — one BPM for the whole level. The
  music analysis therefore re-grids beats/bars onto a constant grid anchored at
  audio time 0, so analysis bars and runtime bars are the same bars.
- **Playtest loop**: the runtime loads any level via `?level=<file>`; audio is
  fetched relative to the library root (`audio/...`). The editor writes
  generated levels + uploaded audio into `beatbound_library_v1/` so the real
  runtime plays them unchanged.
- **Existing tooling to reuse**: `npm run level -- <file>` prints a bar-by-bar
  report through the *real* LevelLoader (authoritative validation), plus
  `npm run audit` / `runner-check` for beatability.
- **Runtime systems the editor's difficulty choices feed into** (game update
  b9da35f/cb098f7): a shared health pool (damage by source: MISS 8, COLLISION
  10, PROJECTILE 12, OBSTACLE 15), and ARENA readability tiers
  (`EASY`/`MEDIUM`/`HARD`/`INTENSE`) selected by each section's `difficulty`
  1–5 — telegraph length, safe-gap size and hazard travel time all scale with
  it. Difficulty in the editor is therefore a real gameplay dial, not a label.

## Workflow

```
Upload Music / Assets
        ↓
Analyze Music            (librosa → output/music_analysis.json)
        ↓
AI / Rule-Based Level Director   (seeded, deterministic → output/level_blueprint.json)
        ↓
Manual Fine-Tuning       (web UI: per-section mode/difficulty/patterns/bounds)
        ↓
Generate level.json      (compiled into beatbound_library_v1/<song>.level.json)
        ↓
Playtest                 (the real game at /?level=<song>.level.json)
        ↓
Edit & Iterate
```

## Running

Requirements: Node 18+, Python 3.10+ with librosa.

```bash
# one-time
pip install -r editor/music-analysis/requirements.txt

# terminal 1 — the game runtime
npm run dev

# terminal 2 — the editor (http://localhost:5174)
npm run editor
```

The editor's "Playtest" button opens the game URL (default
`http://localhost:5173/?level=...`); the URL is configurable in the editor's
bottom bar.

## Directory layout

```
editor/
  music-analysis/   analyze_music.py (librosa) + requirements.txt + test song maker
  schemas/          music-analysis.schema.json, level-blueprint.schema.json,
                    level.schema.json (game schema + documented editor extensions)
  rules/            gameplay-rules.json, difficulty-rules.json, transition-rules.json
  generator/        seed.js · patternIndex.js · difficultyManager.js
                    patternGenerator.js · transitionGenerator.js
                    levelDirector.js · levelCompiler.js · validate.js
  patterns/         annotations.json — curated families/energy/next-pattern hints
                    for every pattern in the live library (merged at runtime, no copies)
  server/           server.mjs — zero-dependency Node server: static UI + JSON API,
                    runs the Python analysis, owns all file writes
  ui/               index.html + editor.css + editor.js — the fine-tuning workshop
  output/           music_analysis.json, level_blueprint.json, level.json (working copies)
```

## How the layers split (design philosophy)

- **Music analysis** (librosa) understands the song: tempo, beat/bar grid,
  per-bar energy, rhythm density, novelty-based sections, energy changes.
  Section labels are `section_01…` — no pretend chorus/verse semantics.
- **Level Director** (rules + seeded RNG) decides the high-level structure:
  four-mode rotation (ARENA → RUNNER → VERTICAL → RADIAL → …) cut at detected
  section boundaries, per-section difficulty/function from the difficulty
  rules, pattern *families* and densities from energy, transition durations and
  scene instructions. It never invents obstacles — every placement references a
  pattern from the live library.
- **Rules** (`rules/`) enforce valid gameplay: section bounds, repetition caps,
  difficulty bands, transition lengths, hazard reduction.
- **Human designers** fine-tune the blueprint in the UI and can regenerate any
  one section in isolation.
- **The runtime** plays the compiled `level.json` — the editor is a JSON
  producer, never a runtime manipulator.

## Determinism

The same song + analysis + rules + seed produces the same blueprint and level.
All randomness comes from a seeded mulberry32 PRNG (`generator/seed.js`).
librosa analysis is parameter-fixed and deterministic.

## Editor extensions to the level format

`level.json` output is valid against the game's `level.schema.json` plus two
forward-compatible extras the runtime currently ignores (its LevelLoader only
checks known fields):

- `sections[].scene` — transition scene instructions chosen by the director
  (`cameraZoom`, `paletteShift`, `particles`, `wipe`, `lightFlash`, …), waiting
  for a future runtime integration hook.
- `editor` — provenance: `{seed, analysisSource, blueprintVersion}`.

## Not built (deliberately — MVP)

No accounts, cloud, sharing, or backend systems. No AI network calls: the
director is the rule-based stand-in for the "AI" layer, and its input/output
(analysis JSON → decision record) is exactly the contract an LLM director can
later be slotted into at `generator/levelDirector.js`.

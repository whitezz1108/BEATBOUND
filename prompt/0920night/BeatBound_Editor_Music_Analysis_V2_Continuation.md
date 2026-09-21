# BeatBound Editor Music Analysis V2 — Continuation Prompt

You are taking over an EXISTING BeatBound working copy from its current filesystem state.

This is a CONTINUATION of the Editor Music Analysis V2 task, NOT a fresh implementation.

Your scope is STRICTLY:

`editor/music-analysis/`

Do NOT modify Arena or Runner files.
Do NOT perform git commit / reset / checkout / stash / revert operations.
Do NOT overwrite or revert unrelated changes already present in the working tree.

Before changing anything, inspect the actual current filesystem and confirm the state described below.

## Current verified state

The Music Analysis V2 implementation is essentially complete.

Already implemented:

- `editor/music-analysis/analyze_music_v2.py`
- full `beatbound_audio/` module set:
  - rhythm
  - energy
  - tonal
  - stems
  - melody
  - structure
  - events
  - aggregator
  - schema
- `editor/schemas/music-analysis-v2.schema.json`
- 46 automated tests
- `make_v2_fixtures.py`
- `requirements-audio.txt`
- relevant `.gitignore` updates

Last verified test state:

`46/46 tests passing`

A real 147-second song has already completed the full V2 pipeline successfully with:

- Demucs 4.1.0
- Basic Pitch 0.4.0
- built-in Krumhansl tonal analysis

The V2 output and V1 compatibility projection have both previously passed schema validation with 0 errors.

The existing V1 schema and V1 pipeline were intentionally NOT modified.

Important compatibility result:

The V1 projection validates against the untouched `music-analysis.schema.json`, so existing `levelDirector.js` / `editor.js` remain usable without modification.

Determinism has already been verified:

- same process
- cross process
- cold cache
- warm cache

All produced byte-identical output before the latest structure fix.

## Most recent code change

A real bug was just fixed in:

`beatbound_audio/structure_analyzer.py`

The old code incorrectly computed section melodic activity by dividing voiced frames by the entire song frame count:

```python
mask = (times >= start) & (times < end) & voiced
melodic = float(np.mean(mask))
```

It was changed to compute the mean only inside the current section:

```python
inside = (times >= start) & (times < end)
melodic = float(np.mean(voiced[inside]))
```

Observed correction examples:

- section_01: ~0.0421 -> ~0.3738
- section_05: ~0.0128 -> ~0.4355

All 46 tests still pass after this fix.

HOWEVER:

The real generated file:

`editor/output/music_analysis_v2.json`

still contains the OLD melodicActivity values.

This is the first thing that must be corrected.

## First task: regenerate the real song

From:

`editor/music-analysis`

run:

```bash
python analyze_music_v2.py \
  "../../beatbound_library_v1/audio/editor/dance_fruits_musicsteve_void_-_toosie_slide_sped_up.mp3" \
  ../output/music_analysis_v2.json --full --force
```

Then verify:

1. V2 JSON validates against `music-analysis-v2.schema.json`
2. V1 projection validates against the UNMODIFIED V1 schema
3. schema validation reports 0 errors for both
4. `sections[].melodicActivity` now reflects the fixed values
5. inspect all section melodicActivity values for plausibility rather than only checking that they are non-null
6. ensure the real-song output is still deterministic after the fix

Expected rough melodicActivity range from the previous direct probe is around 0.25–0.45 for relevant sections, with examples near 0.37 and 0.43.

Do not hardcode values merely to match this expectation.

## Then complete the remaining task in this order

### P0 — Final Gate

Perform the task's parallel-safety and final validation pass.

Confirm explicitly:

- no Arena files changed
- no Runner files changed
- V1 analyzer untouched
- V1 schema untouched
- `server.mjs` untouched
- shared `package.json` untouched
- `editor/ui/*` untouched unless implementing the debug overlay described below
- `editor/generator/*` untouched
- `patterns/annotations.json` untouched
- CLI reproducibility intact
- cache reproducibility intact
- all tests pass
- real-song schemas pass
- no stale generated result is being treated as current

Do NOT modify shared files merely to make invocation more convenient.

The Python CLI remains the authoritative entry point for this task.

### P0 — Final report

Produce the §25 final report with at least:

A. changed files  
B. actual V2 pipeline  
C. actual enabled backends and versions  
D. representative real JSON results  
E. test results  
F. observed performance  
G. known limitations / honest abstentions / fallbacks

Important known behavior to preserve:

- section labels may remain null when confidence is insufficient
- do not manufacture labels to make output look complete
- key may remain null if confidence is insufficient
- fallbacks must remain explicit and deterministic

### P1 — README updates

Update the relevant Editor / music-analysis documentation.

Document clearly:

- V2 CLI invocation
- `--full`
- `--force`
- fast vs full behavior/defaults
- required optional backends
- cache behavior
- V1 compatibility projection
- known limitations

Avoid modifying unrelated project documentation.

### P1 — Debug visualization overlay

Implement ONLY a lightweight analysis-debug visualization, not a full music editor.

The purpose is to make future music-to-level mapping debuggable.

Useful tracks include:

- beat / bar positions
- energy
- drums
- bass
- vocals
- melody / melodic activity
- section boundaries
- event markers

Desired behavior:

- timeline-based
- toggleable tracks if simple to implement
- section boundaries clearly visible
- useful time/value inspection
- readable enough to compare musical structure against future gameplay decisions

Do NOT expand scope into:

- DAW functionality
- waveform editing
- MIDI piano roll editing
- stem mixing
- draggable section editing
- music-to-level generation
- new levelDirector architecture

If the debug UI would require touching risky shared files or substantially expanding scope, keep it isolated and document the limitation instead of forcing integration.

## Cleanup

The temporary probe file:

`editor/output/_probe_real_v2.json`

may be deleted.

Do not delete useful diagnostic/test infrastructure.

## Working rules

1. Preserve all valid existing work.
2. Inspect before editing.
3. Do not reimplement completed components.
4. Do not perform any git mutation.
5. Do not touch Arena / Runner.
6. Do not begin music-to-level generation.
7. Run tests after meaningful changes.
8. If one optional P1 item becomes disproportionately large, leave a precise documented TODO rather than redesigning the editor.
9. Keep the task focused on closing Music Analysis V2 cleanly.

## Completion report

At completion, report:

- what was already complete
- what you changed in this session
- final test count
- real-song validation results
- final backend status
- any remaining limitations
- exact files modified
- whether Music Analysis V2 can now be considered CLOSED for this development round

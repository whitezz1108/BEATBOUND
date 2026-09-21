# BeatBound Editor — Music-to-Level Generation Architecture Rebuild

**Final report.** This documents the rebuilt post-analysis + level-generation
side of the BeatBound Editor: what the architecture is, what changed, what is
enforced, and what is known to be weak.

---

## A. Architecture

The pipeline has four layers, and the boundary between them is the whole design.

```
LAYER 1  MUSIC ANALYSIS         (existing V2, untouched)
         analyze_music_v2.py  ->  music_analysis_v2.json      (full document)
                                 music_analysis.json         (v1 projection)
                                 director_context.json       (v1 export)
                                 director_context_v2.json    <- the generator reads this

LAYER 2  DIRECTOR CONTEXT BUILDER   (existing V2, untouched)
         beatbound_audio/director_context_v2.py

LAYER 3  AI LEVEL DIRECTOR           editor/generation/pipeline.js
         DeepSeek -> level_blueprint_v2.json
         The model decides: sections, modes, functions, difficulty curve, intent.

LAYER 4  DETERMINISTIC COMPILER + VALIDATION
         blueprint.js  -> validate / normalize / repair
         compiler.js   -> level.json via the tested generator primitives
         validator.js  -> npm run level, runner-check, fairness
         bounded repair (MAX_REPAIR_PASSES = 2 structural, 1 runtime)
```

### The rule that organizes everything

**The model directs; the code decides.**

The AI is not the parser, not the validator, not the physics engine, and not the
source of truth. It emits a *plan* — a blueprint — and every fact in that plan
is checked, normalized, or overwritten by deterministic code before it can reach
a level file. Two consequences run through the implementation:

1. **Facts are not the model's to invent.** `song` (id, title, audio, bpm, meter,
   bar count, duration) and `generator` (provenance) are *recorded* by the
   pipeline from the analysis artifacts, never accepted from the model. Every
   replacement is logged in `manifest.fact_corrections`. The validator was not
   relaxed to accommodate this — the model is simply not asked.
2. **Reuse the tested primitive.** The compiler calls the same
   `fillSection` / `buildTransition` / `breatherForSection` / `energyStats` /
   `loadPatternIndex` the rule-based director calls, so the AI path cannot drift
   from the tested one. There is no second implementation of level assembly.

### Why the layers are separate

Each boundary is a file that can be inspected without running anything:

| Layer | Reads | Writes | Can be re-run without |
|---|---|---|---|
| 1 Analysis | audio | 4 JSON documents | network, model |
| 2 Director context | analysis | `director_context_v2.json` | model |
| 3 Director | director context + gameplay context | `level_blueprint_v2.json` | audio |
| 4 Compile/validate | blueprint + analysis | `level.json` + manifest | model |

A blueprint is a complete, replayable artifact: `generateLevel({ blueprint })`
recompiles it with no model call, and the same seed produces byte-identical
output. That is what makes the AI layer auditable — you can re-run layer 4 on
any layer-3 output, forever, without a key.

---

## B. Files changed

### Created

| File | Lines | What it is |
|---|---|---|
| `editor/generation/pipeline.js` | 874 | Layers 3+4 orchestration: artifact loading, the director call, fact seeding, repair loops, manifest. |
| `editor/generation/blueprint.js` | 744 | Blueprint v2 validation and normalization. |
| `editor/generation/microContext.js` | 666 | Bar-level context handed to the model (the model reads numbers, not prose). |
| `editor/generation/compiler.js` | 372 | Blueprint -> `level.json`, via the existing tested primitives. |
| `editor/generation/validator.js` | 310 | Wraps the real validators; scopes the verdict to the candidate. |
| `editor/generation/gameplayContext.js` | 296 | Reads the capability catalog into the prompt. |
| `editor/generation/presets.js` | 187 | The seven named generation presets. |
| `editor/generation/repair.js` | 177 | The bounded structural repair loop. |
| `editor/generation/llm/config.js` | 176 | Env-only config, masking, scrubbing. |
| `editor/generation/rules.js` | 104 | Shared rules loading + live tuning mirror. |
| `editor/generation/prompts.js` | 94 | Prompt loading, rendering, unfilled-placeholder detection. |
| `editor/generation/llm/client.js` | 368 | OpenAI-compatible client: retry, backoff, timeout, abort, injectable fetch. |
| `editor/generation/prompts/level_director_v2.md` | 202 | The director prompt. |
| `editor/generation/prompts/repair_v1.md` | 86 | The repair prompt. |
| `editor/generation/prompts/micro_choreographer_v1.md` | 123 | Bar-level choreography prompt. |
| `editor/generation/cli.mjs` | — | `node editor/generation/cli.mjs` — headless generation. |
| `editor/server/requests.js` | 56 | Request-body -> generation-request resolution (extracted so it is testable). |
| `editor/schemas/level-blueprint-v2.schema.json` | — | The published blueprint contract. |
| `editor/schemas/director-context-v2.schema.json` | — | The published director-context contract. |
| `editor/music-analysis/beatbound_audio/director_context_v2.py` | — | Layer 2 builder. |
| 11 test files under `editor/tests/` | 4,338 | 273 tests. |

### Modified

| File | Change |
|---|---|
| `editor/server/server.mjs` | Wired to the shared `rules.js` and `pipeline.js`; added the V2 routes; pointed the director-context export at v2. |
| `editor/ui/index.html` | Added the AI Level Director panel. |
| `editor/ui/editor.js` | Panel logic: NDJSON stream reader, status, preset wiring. |
| `editor/ui/editor.css` | Panel styles. |
| `package.json` | `test:editor` script (see G — the glob is load-bearing). |

### Not modified

Layer 1 and layer 2 — the Python analysis — are **untouched**. No analysis
output was deleted. No gameplay runtime file was changed.

---

## C. Schemas

Two JSON Schemas (Draft 2020-12) are published as the *contract*:

- `editor/schemas/level-blueprint-v2.schema.json`
- `editor/schemas/director-context-v2.schema.json`

They are documentation and editor tooling. They are **not** the enforcement
mechanism. Enforcement is `blueprint.js`'s hand-written, dependency-free
validator, because a JSON Schema cannot express the things that actually matter
here: that a section's bar range tiles the song without gaps, that a mode is
generatable, that a pattern belongs to the mode it is used in, that a breather
fits in the section that owns it.

The two are coupled by **drift tests** (`editor/tests/schema.test.mjs`), which
assert that the schema and the validator agree on the same documents. A schema
that drifts from the validator fails the suite rather than quietly lying to
whoever reads it.

### Bar-range convention (a real source of bugs)

The blueprint is half-open: `[start_bar, end_bar_exclusive)`. The runtime uses
`startBar` + `lengthBars`. The compiler is the only place that converts, and
`blueprint.test.mjs` pins the arithmetic.

---

## D. API configuration

All configuration is environment-only. There is no key in any source file, any
generated JSON, or any log line.

| Variable | Default | Meaning |
|---|---|---|
| `BEATBOUND_LLM_PROVIDER` | `deepseek` | `deepseek` \| `openai` \| `openai_compatible` \| `local` |
| `BEATBOUND_LLM_BASE_URL` | `https://api.deepseek.com/v1` | OpenAI-compatible endpoint |
| `BEATBOUND_LLM_API_KEY` | *(none)* | **Required only for layer 3** |
| `BEATBOUND_LLM_MODEL` | `deepseek-chat` | Model id |
| `BEATBOUND_LLM_TIMEOUT_MS` | `120000` | Per-request timeout |
| `BEATBOUND_LLM_MAX_TOKENS` | `8192` | Response cap |
| `BEATBOUND_LLM_REASONING_EFFORT` | *(none)* | `low` \| `medium` \| `high` |

**Layers 1, 2 and 4 run with no key at all.** Only layer 3 needs one. A
generation from a supplied blueprint is fully deterministic and offline.

### What is done to keep the key contained

- `loadLlmConfig` is the only reader; the key never leaves it.
- `describeConfig` reports `apiKeyPresent: boolean` and `apiKeyMask` — the last
  four characters, which distinguishes two keys in a log and is useless to
  anyone reading it.
- `scrubSecrets` strips `Authorization:` headers, bare `Bearer` tokens and
  `sk-…` shapes from anything that might be logged or returned.
- Verified live: with a key set, `/api/state`, `/api/llm/status` and
  `/api/presets` contain **zero** occurrences of the key, and the server log is
  clean. `editor/tests/server-routes.test.mjs` asserts this on every run.
- The CLI never accepts a key as an argument — only via the environment.

---

## E. Tests

```
$ npm run test:editor
ℹ tests 273
ℹ pass 273
ℹ fail 0
```

| File | Tests | Covers |
|---|---|---|
| `blueprint.test.mjs` | 52 | Tiling, clamping, normalization, the mode/pattern rules |
| `micro-context.test.mjs` | 42 | Bar-level context assembly |
| `llm-client.test.mjs` | 42 | Retry, backoff, timeout, abort, JSON extraction, masking |
| `pipeline.test.mjs` | 24 | End-to-end: mocked director -> real compiler -> real validators |
| `prompts.test.mjs` | 23 | Template rendering, unfilled placeholders |
| `compiler.test.mjs` | 23 | Blueprint -> level, bar arithmetic, breather placement |
| `validator.test.mjs` | 18 | Parsing the real tools' output |
| `repair.test.mjs` | 15 | The bounded repair loop |
| `schema.test.mjs` | 14 | Schema/validator drift |
| `server-request.test.mjs` | 12 | Request resolution, refusal before spending a request |
| `server-routes.test.mjs` | 8 | The HTTP contract the UI depends on |

### The golden test

`pipeline.test.mjs`'s golden run is the one test that can catch a break
*between* layers: a mocked director produces a blueprint, and the real compiler,
the real `npm run level`, the real `runner-check` and the real library index all
process it. It asserts:

- the mocked director produces a level the real loaders accept;
- the same seed compiles to a byte-identical level twice;
- a rejected blueprint is **never published** to the library;
- with no key and no blueprint, it fails *before* spending a request;
- a dry run writes nothing at all.

It writes into the real `beatbound_library_v1/` (that is where the runtime
resolves level paths from) and removes what it wrote, including any stale
`_probe*` index entry a previous crashed run left behind.

---

## F. Verified end to end

A full CLI generation against the real analysis artifacts
(`arkins_-_jangchung`, 129.2 BPM, 4/4, 105 bars):

```
$ node editor/generation/cli.mjs --preset arena_primary --seed 5
```

- 3 sections compiled; `npm run level` reported **0 errors, 1 warning** — the
  warning being exactly the one silent bar the breather occupies, which is the
  intended behaviour, not a defect.
- Both RUNNER courses flew with real metrics:
  `120 jumps (2.35/bar) · 0.50 airborne · v-range 0.490 · 6 flip(s) · 51 phrase(s) · motif repeat 92%`.
- The manifest carried a complete audit trail: `apiKeyPresent: false`, no
  key-shaped string anywhere, and `fact_corrections` listing every field the
  pipeline overwrote.
- Determinism confirmed: the same seed produced a byte-identical level.

Every probe artifact was removed afterwards. `beatbound_library_v1/` is back to
the user's own pre-existing state.

---

## G. Known limitations

### 1. `npm test` is broken by a pre-existing library cleanup — not by this work

`npm run test:timing` fails:

```
Error: ENOENT: no such file or directory, open
  '.../beatbound_library_v1/arena_test.level.json'
```

`tools/sync-test.ts:68` hardcodes `levelUrl: '/arena_test.level.json'`, but that
file was deleted by commit `e612435` ("library cleanup") — a commit that predates
this work. `npm run test:editor`, `npm run typecheck`, `npm run level` and
`npm run runner-check` all pass; only the hardcoded reference fails.

This is a **test fixture** problem, not a runtime problem, and it is reported
rather than fixed because fixing it means either restoring a deleted level or
editing a tool, both outside the scope of this rebuild.

### 2. `validateCourse` hardcodes a 4-beat bar — reported, not fixed

`editor/generator/validate.js`'s `validateCourse` computes

```js
const sectionBeats = section.lengthBars * 4;   // hardcoded metre
```

The rest of the system derives beats-per-bar from the director context's meter.
For the songs in the library (all 4/4) the two agree, so nothing is broken
today. For a 3/4 or 6/8 song the course validator would measure coverage against
the wrong section length and could report a spurious coverage warning — or miss
a real one.

Per the brief, a gameplay-runtime change was not made on the strength of a
theoretical case. It is recorded here so it is a known limitation rather than a
latent surprise.

### 3. `node --test <dir>` does not work on this Windows/Node combination

`node --test editor/tests` silently discovers nothing here. The `test:editor`
script uses a glob — `node --test "editor/tests/*.test.mjs"` — which is
load-bearing. Node 24 also refuses `spawnSync('npm.cmd')` with `EINVAL`
(CVE-2024-27980 mitigation), so anything spawning npm must use `shell: true`
with a single command string.

### 4. The UI panel has no automated tests

`editor/ui/editor.js` is vanilla JS with no build step and no test runner. The
routes it calls are pinned by `server-routes.test.mjs` — the panel reads
`hasDirectorContextV2`, `tuningMirror`, `apiKeyPresent`, `model` and the preset
fields by name, and those are asserted. The panel's own rendering and event
handling are not covered; they were verified by hand.

### 5. The director's output quality is not measured

The pipeline proves a blueprint is *valid* and *playable*. It does not measure
whether the arrangement is *good* — whether the mode changes land on the right
musical moments, whether the difficulty curve matches the song's arc. That
remains a human judgement made by listening and playing. `manifest.blueprint`
records the plan so the judgement can be made against something specific.

---

## H. Confirmation

**No git commands were run.** No commit, stash, checkout, reset, clean, merge or
rebase. No repository history was modified. The only files touched are the ones
listed in section B; `git status` shows the user's own in-flight edits to
`beatbound_library_v1/levels.index.json` and
`toosie_slide_arena_primary.level.json` exactly as they were found.

No analysis output was deleted. The Python analysis stack was not replaced. No
validator was weakened. No API key or gateway token was written into any source
file, generated JSON, or report.

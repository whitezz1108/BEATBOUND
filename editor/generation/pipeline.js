/**
 * The generation pipeline -- layers 2 through 4 wired together.
 *
 *     analysis (layer 1, already on disk)
 *       -> director context (layer 2, already on disk)
 *       -> AI level director (layer 3)          <- the only network call
 *       -> structural repair (layer 4b, bounded)
 *       -> deterministic compile (layer 4a)
 *       -> the runtime's own validators (layer 4c)
 *       -> bounded runtime repair (layer 4d, optional)
 *       -> final level.json + generation manifest
 *
 * Two rules shape everything below.
 *
 * **The model directs; the code decides.** The model chooses the section
 * tiling, the modes, the difficulty curve and the intent. It never chooses a
 * pattern id (the pattern index does), never places a bar (the compiler does),
 * never computes a breather (the game's own tuning does), and never gets the
 * last word (the validator does).
 *
 * **Facts are not the model's to invent.** The song block -- id, title, audio
 * path, BPM, meter, bar count, duration -- and the generator provenance are
 * *recorded* here from the analysis and from what actually ran, not parsed out
 * of the model's answer. Asking a model to transcribe a float like `129.2` is
 * asking for a typo that the validator will (correctly) reject, and then
 * spending repair passes on arithmetic instead of on direction. The validator
 * is not relaxed for this: it stays exactly as strict, and the pipeline simply
 * never hands it a guess.
 *
 * Nothing here writes a secret anywhere: the manifest carries `describeConfig`
 * output, which is a mask and a boolean.
 */

import { existsSync, readFileSync, promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadRulesWithTuning } from './rules.js';
import { loadPatternIndex } from '../generator/patternIndex.js';
import { buildGameplayContext } from './gameplayContext.js';
import { buildPrompt, breatherValues } from './prompts.js';
import { createLlmClient, extractJson } from './llm/client.js';
import { describeConfig, loadLlmConfig } from './llm/config.js';
import {
  BLUEPRINT_V2_SCHEMA_VERSION,
  GENERATOR_KINDS,
  beatsPerBarOf,
  breatherBeats,
  validateBlueprint,
} from './blueprint.js';
import { MAX_REPAIR_PASSES, repairBlueprint } from './repair.js';
import { COMPILER_VERSION, compileBlueprint } from './compiler.js';
import { summarize, validateAll } from './validator.js';
import { buildRequest, describeRequest } from './presets.js';

export const PIPELINE_VERSION = '2.0.0';
export const MANIFEST_SCHEMA_VERSION = 'beatbound_generation_manifest_v1';

/** Runtime-error repairs per generation. One is enough; two is a smell. */
export const MAX_RUNTIME_REPAIR_PASSES = 1;

export const PROJECT_ROOT = fileURLToPath(new URL('../..', import.meta.url));

const ANALYSIS_FILE = 'music_analysis.json';
const DIRECTOR_CONTEXT_FILE = 'director_context_v2.json';

// ---------------------------------------------------------------------------
// Layer 2 -- loading what the analysis already produced
// ---------------------------------------------------------------------------

/**
 * Load the artifacts the pipeline needs from `editor/output/`.
 *
 * Both are written by `analyze_music_v2.py` in a single run, so they are always
 * a matched pair; loading them together is what makes "the analysis changed
 * under us" detectable rather than a mystery.
 *
 * @returns {{analysis, directorContext, rules, tuning, notes, missing}}
 */
export function loadArtifacts({ projectRoot = PROJECT_ROOT, outputDir } = {}) {
  const dir = outputDir ?? path.join(projectRoot, 'editor', 'output');
  const missing = [];
  const read = (name) => {
    const file = path.join(dir, name);
    if (!existsSync(file)) {
      missing.push(file);
      return null;
    }
    return JSON.parse(readFileSync(file, 'utf8'));
  };

  // `music_analysis.json` is the **v1 projection**, and it is the one the
  // compiler needs: it is the only artifact with a top-level `bars[]` grid
  // carrying `energy` and `rhythmDensity`. V2 holds its energy in
  // `timeline.windows[]` on a 0.25 s hop instead. Both are on disk; the
  // projection is the one with the bar grid.
  const analysis = read(ANALYSIS_FILE);
  const directorContext = read(DIRECTOR_CONTEXT_FILE);

  const { rules, notes, tuning } = loadRulesWithTuning({ projectRoot });

  return { analysis, directorContext, rules, tuning, notes, missing };
}

// ---------------------------------------------------------------------------
// Facts the pipeline owns
// ---------------------------------------------------------------------------

/**
 * Turn the analysis's audio path into the library-relative path a level needs.
 *
 * `level.song.audio` is resolved by the runtime against the library root, so an
 * absolute Windows path written into a level produces a level that loads in the
 * editor and 404s in the game. The analysis stores whatever path the upload
 * used, which is absolute.
 */
export function libraryAudioPath(analysis, { libraryDir } = {}) {
  const raw = analysis?.song?.audioPath;
  if (typeof raw !== 'string' || raw.length === 0) return null;
  const normalised = raw.replace(/\\/g, '/');

  if (!path.isAbsolute(raw)) return normalised.replace(/^\/+/, '');

  if (libraryDir) {
    const rel = path.relative(libraryDir, raw).replace(/\\/g, '/');
    // `path.relative` answers a path on another drive (or in another root) by
    // returning the target unchanged and absolute -- so `..` alone is not
    // enough of a test: `D:/music/song.mp3` would sail through and end up in
    // the level, where the runtime cannot resolve it.
    if (!rel.startsWith('..') && !path.isAbsolute(rel)) return rel;
  }
  return `audio/editor/${path.basename(normalised)}`;
}

/**
 * The `song` block, from the analysis rather than from the model.
 *
 * Every field here is checked by `validateBlueprint` against the director
 * context; building it from that same context means the check passes because
 * the value is right, not because the check was loosened.
 */
export function songBlock({ directorContext, analysis, libraryDir, levelId }) {
  const timing = directorContext?.timing ?? {};
  const source = directorContext?.source ?? {};

  // `meter` is the string "4/4" in a real director context; the array form is
  // accepted so hand-built contexts (tests, fixtures) work too.
  let timeSignature = [4, 4];
  if (typeof timing.meter === 'string') {
    const [num, den] = timing.meter.split('/').map(Number);
    if (Number.isFinite(num) && Number.isFinite(den) && num > 0 && den > 0) timeSignature = [num, den];
  } else if (Array.isArray(timing.meter) && timing.meter.length === 2) {
    timeSignature = [...timing.meter];
  }

  // `song.id` is the *level's* name, which is the analysed song's id unless the
  // caller asked for a named variant -- see `levelId` in `generateLevel`.
  const songId = source.song_id ?? analysis?.song?.id ?? 'unknown';
  const id = levelId ?? songId;
  return {
    id,
    title: analysis?.song?.title ?? id,
    audio: libraryAudioPath(analysis, { libraryDir }),
    bpm: timing.bpm ?? analysis?.tempo?.bpm ?? 120,
    timeSignature,
    barCount: timing.bar_count ?? analysis?.bars?.length ?? 1,
    durationSec: source.duration_sec ?? analysis?.song?.durationSec ?? 0,
  };
}

/**
 * The `generator` block -- provenance, recorded by whoever actually ran.
 *
 * A model asked to fill this in would be guessing at its own prompt version,
 * and `created_from` would be a claim rather than a fact. So the pipeline
 * writes it.
 *
 * Each field takes one of three states, and the distinction matters when a
 * blueprint is replayed from disk rather than generated now:
 *   - a value       -- this run knows it (it called the model, with this prompt)
 *   - `null`        -- this run knows the field is empty (a non-AI plan)
 *   - `undefined`   -- this run has no opinion; keep what the artifact declares
 *
 * The third case is why a saved AI blueprint keeps `kind: 'ai_director'` when
 * it is recompiled, instead of being relabelled `manual` by the mere fact of
 * having come from a file.
 */
export function generatorBlock({ kind, model, promptVersion, existing }) {
  const declared = GENERATOR_KINDS.includes(existing?.kind) ? existing.kind : null;
  const resolvedKind = kind === undefined ? (declared ?? 'manual') : (GENERATOR_KINDS.includes(kind) ? kind : 'ai_director');
  return {
    kind: resolvedKind,
    model: model === undefined ? (existing?.model ?? null) : model,
    prompt_version: promptVersion === undefined ? (existing?.prompt_version ?? null) : promptVersion,
    created_from: 'director_context_v2',
  };
}

/**
 * Overwrite the fact-bearing parts of a model's blueprint with the truth.
 *
 * Returns the same object, mutated, plus the list of what was corrected so the
 * manifest can say "the model got the BPM wrong and we fixed it" instead of
 * hiding it. Only the song block and the generator block are touched: the
 * sections, the request and the intent are the model's work and are left
 * exactly as written.
 */
export function seedFacts(blueprint, { directorContext, analysis, libraryDir, levelId, kind, model, promptVersion }) {
  const corrections = [];
  const truth = songBlock({ directorContext, analysis, libraryDir, levelId });
  const before = blueprint.song ?? {};

  for (const [key, value] of Object.entries(truth)) {
    const had = before[key];
    if (JSON.stringify(had) !== JSON.stringify(value)) {
      corrections.push(`song.${key}: ${JSON.stringify(had)} -> ${JSON.stringify(value)}`);
    }
  }
  blueprint.song = truth;

  const gen = generatorBlock({ kind, model, promptVersion, existing: blueprint.generator });
  const beforeGen = blueprint.generator ?? {};
  for (const [key, value] of Object.entries(gen)) {
    if (JSON.stringify(beforeGen[key]) !== JSON.stringify(value)) {
      corrections.push(`generator.${key}: ${JSON.stringify(beforeGen[key])} -> ${JSON.stringify(value)}`);
    }
  }
  blueprint.generator = gen;

  return corrections;
}

// ---------------------------------------------------------------------------
// Layer 3 -- the AI director
// ---------------------------------------------------------------------------

/**
 * Ask the model for a blueprint.
 *
 * The response is parsed with `extractJson`, which tolerates a fenced code
 * block or a sentence of preamble -- models do that, and rejecting a correct
 * plan over its packaging would be silly. What it does *not* tolerate is a
 * response with no JSON object in it, which throws.
 */
export async function runDirector({
  client,
  directorContext,
  gameplayContext,
  request,
  tuning,
  analysis,
  signal,
  temperature = 0.4,
}) {
  const beatsPerBar = beatsPerBarOf(directorContext, { song: { timeSignature: null } });
  const bpm = directorContext?.timing?.bpm ?? analysis?.tempo?.bpm ?? 120;
  const durationSec = directorContext?.source?.duration_sec ?? analysis?.song?.durationSec ?? 0;

  const prompt = buildPrompt('levelDirector', {
    DIRECTOR_CONTEXT: directorContext,
    GAMEPLAY_CONTEXT: gameplayContext,
    REQUEST: request,
    DURATION_SEC: String(Math.round(durationSec)),
    ...breatherValues(bpm, beatsPerBar, breatherBeats(bpm, tuning)),
  });

  // A prompt that reaches the model with `{{GAMEPLAY_CONTEXT}}` still in it
  // produces a plausible-looking blueprint built on nothing. Fail instead.
  if (prompt.unfilled.length > 0) {
    throw new Error(
      `the level director prompt has unfilled placeholders: ${prompt.unfilled.join(', ')}`,
    );
  }

  const res = await client.complete({
    messages: [{ role: 'user', content: prompt.text }],
    temperature,
    json: true,
    signal,
  });

  const { value: blueprint, strategy } = extractJson(res.text);
  if (!blueprint || typeof blueprint !== 'object' || Array.isArray(blueprint)) {
    throw new Error(`the level director did not return a JSON object (${strategy})`);
  }

  return {
    blueprint,
    parseStrategy: strategy,
    promptVersion: prompt.version,
    promptChars: prompt.text.length,
    model: res.model,
    usage: res.usage,
    latencyMs: res.latencyMs,
    attempts: res.attempts,
    finishReason: res.finishReason,
  };
}

/** A one-line reading of a `repairBlueprint` progress event, for logs. */
function describeRepairEvent(e) {
  switch (e.stage) {
    case 'director':
      return `the blueprint has ${e.errors} error(s) and ${e.warnings} warning(s)`;
    case 'normalize':
      return `normalization applied ${e.fixes} fix(es); ${e.errors} error(s) remain`;
    case 'normalize-rejected':
      return 'normalization changed nothing useful -- the original is kept';
    case 'model-repair':
      return `pass ${e.pass}: asked the model to repair`;
    case 'accepted':
      return `pass ${e.pass}: the rewrite validates`;
    case 'rejected':
      return `pass ${e.pass}: the rewrite is worse and was discarded`;
    case 'model-error':
      return `pass ${e.pass}: the model call failed -- ${e.error}`;
    case 'model-invalid':
      return `pass ${e.pass}: the model did not return a blueprint`;
    case 'stopped':
      return `stopped: ${e.reason}`;
    default:
      return e.stage;
  }
}

/** The repair callback `repairBlueprint` calls: same client, repair prompt. */
export function makeRepairCallback({ client, tuning, directorContext, analysis, signal, temperature = 0.2 }) {
  const beatsPerBar = beatsPerBarOf(directorContext, { song: { timeSignature: null } });
  const bpm = directorContext?.timing?.bpm ?? analysis?.tempo?.bpm ?? 120;

  return async (blueprint, errors, { label = 'blueprint' } = {}) => {
    const prompt = buildPrompt('repair', {
      BLUEPRINT: blueprint,
      ERRORS: errors.map((e) => `- ${e}`).join('\n'),
      ...breatherValues(bpm, beatsPerBar, breatherBeats(bpm, tuning)),
    });
    const res = await client.complete({
      messages: [{ role: 'user', content: prompt.text }],
      temperature,
      json: true,
      signal,
    });
    const { value: repaired, strategy } = extractJson(res.text);
    if (!repaired || typeof repaired !== 'object' || Array.isArray(repaired)) {
      throw new Error(`the repair response for ${label} was not a JSON object (${strategy})`);
    }
    return repaired;
  };
}

// ---------------------------------------------------------------------------
// Layer 4 -- compile, write, validate
// ---------------------------------------------------------------------------

/**
 * Write the level into the library and register it in the index.
 *
 * Registration is not bookkeeping: `runner-check` reads `levels.index.json`, so
 * an unregistered level's RUNNER courses are never flown. A level that is not
 * in the index has not really been checked.
 */
async function publishLevel(level, { libraryDir, levelId, title }) {
  const levelFile = `${levelId}.level.json`;
  await fs.writeFile(path.join(libraryDir, levelFile), JSON.stringify(level, null, 2));
  await registerInIndex({ id: levelId, file: levelFile, title, blurb: 'Generated by the BeatBound AI level director.' }, { libraryDir });
  return levelFile;
}

/**
 * Add or update one entry in `levels.index.json`.
 *
 * The file is written with a trailing newline because that is how it is stored
 * -- without it, every generation would show a one-line diff in the index
 * purely from having rewritten it, which makes real changes hard to spot in a
 * file the user also edits by hand.
 */
export async function registerInIndex(entry, { libraryDir } = {}) {
  const indexPath = path.join(libraryDir, 'levels.index.json');
  let index = { version: '1.0.0', levels: [] };
  try {
    index = JSON.parse(await fs.readFile(indexPath, 'utf8'));
  } catch {
    // A missing or unreadable index is rebuilt rather than fatal; the entry we
    // are adding is the one the caller needs.
  }
  if (!Array.isArray(index.levels)) index.levels = [];
  const existing = index.levels.find((l) => l.file === entry.file);
  if (existing) Object.assign(existing, entry);
  else index.levels.push(entry);
  await fs.writeFile(indexPath, `${JSON.stringify(index, null, 2)}\n`);
}

/** Undo a publish, so a failed generation leaves no trace in the library. */
async function unpublishLevel(levelFile, { libraryDir } = {}) {
  const abs = path.join(libraryDir, levelFile);
  if (existsSync(abs)) await fs.unlink(abs);
  const indexPath = path.join(libraryDir, 'levels.index.json');
  try {
    const index = JSON.parse(await fs.readFile(indexPath, 'utf8'));
    const before = index.levels.length;
    index.levels = index.levels.filter((l) => l.file !== levelFile);
    if (index.levels.length !== before) {
      await fs.writeFile(indexPath, `${JSON.stringify(index, null, 2)}\n`);
    }
  } catch {
    // Nothing to undo.
  }
}

// ---------------------------------------------------------------------------
// The pipeline
// ---------------------------------------------------------------------------

/**
 * Generate one level, end to end.
 *
 * @param {object} opts
 * @param {string} [opts.levelId]       the level's name -- its file name stem, its
 *   `song.id` and its manifest name. Defaults to the analysed song's id. Pass a
 *   distinct id to generate a *variant* of a song (the library does this:
 *   `toosie_slide_arena_primary` is one arrangement of a differently-named song).
 * @param {string} [opts.projectRoot]
 * @param {string} [opts.outputDir]     where the manifest goes (default editor/output)
 * @param {string} [opts.libraryDir]    default beatbound_library_v1
 * @param {string} [opts.preset]        a preset id from presets.js
 * @param {string} [opts.primaryMode]
 * @param {string[]} [opts.allowedModes]
 * @param {number} [opts.difficulty]
 * @param {number} [opts.ratio]
 * @param {number} [opts.seed]
 * @param {object} [opts.request]       a ready-made request block; wins over the above
 * @param {object} [opts.blueprint]     supply a blueprint to skip layer 3 entirely
 * @param {object} [opts.client]        LLM client; built from config when omitted
 * @param {object} [opts.config]        LLM config; loaded from the environment when omitted
 * @param {boolean} [opts.repair]       allow model repair (default true)
 * @param {boolean} [opts.courses]      also fly the RUNNER courses (default true)
 * @param {boolean} [opts.fairness]     also run the fairness probe (default false)
 * @param {boolean} [opts.dryRun]       compile and validate, write nothing
 * @param {boolean} [opts.keepOnFailure] keep a level that failed validation
 * @param {(e: object) => void} [opts.onEvent]
 */
export async function generateLevel(opts = {}) {
  const {
    projectRoot = PROJECT_ROOT,
    repair = true,
    courses = true,
    fairness = false,
    dryRun = false,
    keepOnFailure = false,
    onEvent,
    signal,
  } = opts;

  const outputDir = opts.outputDir ?? path.join(projectRoot, 'editor', 'output');
  const libraryDir = opts.libraryDir ?? path.join(projectRoot, 'beatbound_library_v1');
  const emit = (event) => onEvent?.({ at: new Date().toISOString(), ...event });

  // ---- artifacts -----------------------------------------------------------
  emit({ stage: 'load', message: 'loading analysis artifacts' });
  const { analysis, directorContext, rules, tuning, notes, missing } = loadArtifacts({ projectRoot, outputDir });
  if (missing.length > 0) {
    throw new Error(
      `the pipeline needs the analysis artifacts and these are missing:\n  ${missing.join('\n  ')}\n` +
        `Run the editor's analysis step first (POST /api/analyze, or editor/music-analysis/analyze_music_v2.py).`,
    );
  }

  // ---- request -------------------------------------------------------------
  // Precedence: an explicit request, then the ask recorded in a supplied
  // blueprint (it is part of the artifact -- overriding it would make a replay
  // generate something the manifest does not describe), then the preset.
  const request =
    opts.request ??
    opts.blueprint?.request ??
    buildRequest({
      preset: opts.preset,
      primaryMode: opts.primaryMode,
      allowedModes: opts.allowedModes,
      difficulty: opts.difficulty,
      ratio: opts.ratio,
      seed: opts.seed,
    });
  const seed = request.seed ?? opts.seed ?? 1;
  // The level's identity. This is what names the file, the index entry and the
  // manifest, and what lands in `level.song.id` -- a level is its own thing, and
  // two arrangements of one song are two levels with two ids.
  const levelId = opts.levelId ?? directorContext.source?.song_id ?? analysis.song?.id;
  if (!levelId) throw new Error('cannot determine the level id -- pass levelId explicitly');

  const gameplayContext = buildGameplayContext({
    projectRoot,
    allowedModes: request.allowed_modes,
    primaryMode: request.primary_mode,
  });

  emit({
    stage: 'request',
    message: describeRequest(request),
    request,
    levelId,
    songId: directorContext.source?.song_id ?? null,
    tuning,
    rulesNotes: notes,
    gameplayWarnings: gameplayContext.cross_mode_warnings ?? [],
  });

  // ---- layer 3: the director ----------------------------------------------
  const config = opts.config ?? loadLlmConfig();
  const llm = describeConfig(config);
  let client = opts.client ?? null;
  let director = null;

  if (opts.blueprint) {
    emit({ stage: 'director', message: 'using the supplied blueprint -- layer 3 skipped' });
  } else {
    if (!client) {
      if (!config.configured) {
        throw new Error(
          'no LLM API key configured: set BEATBOUND_LLM_API_KEY to run the AI level director, ' +
            'or pass an existing blueprint to run the deterministic half only',
        );
      }
      client = createLlmClient({ config });
    }
    emit({ stage: 'director', message: `asking ${llm.model} for a blueprint`, model: llm.model });
    director = await runDirector({ client, directorContext, gameplayContext, request, tuning, analysis, signal });
    emit({
      stage: 'director',
      message: `blueprint received (${director.usage?.completion_tokens ?? '?'} completion tokens, ${director.latencyMs} ms)`,
      usage: director.usage,
    });
  }

  let blueprint = opts.blueprint ?? director.blueprint;
  blueprint.schema_version = blueprint.schema_version ?? BLUEPRINT_V2_SCHEMA_VERSION;
  blueprint.request = request;

  // Facts are recorded, not parsed.
  const corrections = seedFacts(blueprint, {
    directorContext,
    analysis,
    libraryDir,
    levelId,
    // A supplied blueprint keeps whatever origin it declares -- it is the
    // artifact's own record of how it was made, and this run did not make it.
    kind: director ? 'ai_director' : undefined,
    model: director ? (director.model ?? llm.model) : undefined,
    promptVersion: director ? director.promptVersion : undefined,
  });
  if (corrections.length > 0) {
    emit({ stage: 'facts', message: `corrected ${corrections.length} transcribed field(s)`, corrections });
  }

  // ---- layer 4b: structural repair ----------------------------------------
  const repairCallback =
    repair && client ? makeRepairCallback({ client, tuning, directorContext, analysis, signal }) : undefined;

  const structural = await repairBlueprint({
    blueprint,
    directorContext,
    gameplayContext,
    patternIndex: loadPatternIndex({ projectRoot }),
    tuning,
    repair: repairCallback,
    maxPasses: opts.maxRepairPasses ?? MAX_REPAIR_PASSES,
    onEvent: (e) => emit({ stage: 'repair', message: describeRepairEvent(e), ...e }),
  });
  blueprint = structural.blueprint;

  if (!structural.ok) {
    // Compiling a blueprint the validator rejects produces a level nobody
    // should play. It is still compiled -- so the failure report names real
    // bars and real sections rather than just schema complaints -- but it is
    // never published.
    emit({
      stage: 'repair',
      message: `blueprint did not validate after ${structural.passes} repair pass(es)`,
      errors: structural.validation.errors,
    });
  }

  // ---- layer 4a: compile ---------------------------------------------------
  const { level, warnings: compileWarnings, meta } = compileBlueprint(blueprint, {
    analysis,
    directorContext,
    rules,
    projectRoot,
    seed,
  });
  emit({ stage: 'compile', message: `compiled ${meta.sectionCount} sections`, meta, warnings: compileWarnings });

  // ---- publish -------------------------------------------------------------
  let levelFile = null;
  let published = false;
  if (!dryRun && structural.ok) {
    levelFile = await publishLevel(level, { libraryDir, levelId, title: blueprint.song.title });
    published = true;
    emit({ stage: 'publish', message: `wrote ${levelFile} and registered it in levels.index.json`, levelFile });
  } else if (dryRun) {
    emit({ stage: 'publish', message: 'dry run -- nothing written' });
  } else {
    emit({ stage: 'publish', message: 'not published: the blueprint failed validation' });
  }

  // ---- layer 4c: the real validators --------------------------------------
  let validation = null;
  if (published) {
    emit({ stage: 'validate', message: 'running the runtime validators' });
    validation = validateAll(levelFile, { projectRoot, courses, fairness, timeoutMs: opts.timeoutMs });
    emit({ stage: 'validate', message: summarize(validation), ok: validation.ok });
  } else if (dryRun) {
    // Without publishing, the runtime's loader has no file to read. Say so
    // rather than reporting a pass we did not earn.
    emit({
      stage: 'validate',
      message: 'dry run -- the runtime validators read beatbound_library_v1/, so nothing was validated',
    });
  }

  // ---- layer 4d: bounded runtime repair -----------------------------------
  const runtimeRepair = { attempted: false, passes: 0, history: [] };
  if (
    published &&
    validation &&
    !validation.ok &&
    repair &&
    client &&
    (opts.maxRuntimeRepairPasses ?? MAX_RUNTIME_REPAIR_PASSES) > 0
  ) {
    runtimeRepair.attempted = true;
    const limit = opts.maxRuntimeRepairPasses ?? MAX_RUNTIME_REPAIR_PASSES;
    // The model can only change the blueprint, so runtime errors are handed
    // back as blueprint errors. Everything the level validator reports is a
    // consequence of the plan -- an impossible pattern id, a section that
    // overruns the song, a missing breather -- so this is a fair translation
    // rather than a hint.
    for (let pass = 1; pass <= limit; pass += 1) {
      const errors = [...validation.level.errors, ...(validation.courses?.mine ?? []).filter((l) => !l.ok).map((l) => `course ${l.file}: ${l.verdict}`)];
      if (errors.length === 0) break;
      emit({ stage: 'runtime-repair', pass, errors });

      let candidate;
      try {
        candidate = await makeRepairCallback({ client, tuning, directorContext, analysis, signal })(blueprint, errors, {
          label: 'level',
        });
      } catch (err) {
        runtimeRepair.history.push({ pass, stage: 'error', message: String(err?.message ?? err) });
        break;
      }

      candidate.schema_version = candidate.schema_version ?? BLUEPRINT_V2_SCHEMA_VERSION;
      candidate.request = request;
      // The rewrite is the model's work, so the origin is now unambiguously
      // the director that produced the version it was repairing.
      seedFacts(candidate, {
        directorContext,
        analysis,
        libraryDir,
        levelId,
        kind: 'ai_director',
        model: director?.model ?? llm.model,
        promptVersion: director?.promptVersion ?? undefined,
      });

      const candidateStructural = validateBlueprint(candidate, {
        directorContext,
        gameplayContext,
        patternIndex: loadPatternIndex({ projectRoot }),
        tuning,
      });
      if (candidateStructural.errors.length > 0) {
        runtimeRepair.history.push({
          pass,
          stage: 'rejected',
          reason: 'the rewrite does not validate as a blueprint',
          errors: candidateStructural.errors,
        });
        break;
      }

      const compiled = compileBlueprint(candidate, { analysis, directorContext, rules, projectRoot, seed });
      await fs.writeFile(path.join(libraryDir, levelFile), JSON.stringify(compiled.level, null, 2));
      const candidateValidation = validateAll(levelFile, { projectRoot, courses, fairness, timeoutMs: opts.timeoutMs });

      if (candidateValidation.ok) {
        blueprint = candidate;
        validation = candidateValidation;
        runtimeRepair.passes = pass;
        runtimeRepair.history.push({ pass, stage: 'accepted' });
        emit({ stage: 'runtime-repair', pass, message: 'the rewrite validated', ok: true });
        break;
      }

      runtimeRepair.history.push({ pass, stage: 'no-improvement', errors: candidateValidation.level.errors });
      // Keep the better of the two, exactly as the structural loop does.
      if (candidateValidation.level.errors.length < validation.level.errors.length) {
        blueprint = candidate;
        validation = candidateValidation;
        runtimeRepair.passes = pass;
      }
    }
  }

  const ok = Boolean(validation?.ok) && structural.ok;
  const finalLevel = validation && blueprint !== opts.blueprint ? compileBlueprint(blueprint, { analysis, directorContext, rules, projectRoot, seed }).level : level;

  // ---- cleanup -------------------------------------------------------------
  if (published && !ok && !keepOnFailure) {
    await unpublishLevel(levelFile, { libraryDir });
    emit({
      stage: 'cleanup',
      message: `${levelFile} failed validation and was removed from the library (pass keepOnFailure to keep it)`,
    });
  }

  // ---- manifest ------------------------------------------------------------
  const manifest = buildManifest({
    levelId,
    songId: directorContext.source?.song_id ?? null,
    levelFile,
    ok,
    dryRun,
    published: published && (ok || keepOnFailure),
    request,
    tuning,
    rulesNotes: notes,
    director,
    structural,
    runtimeRepair,
    compileWarnings,
    corrections,
    meta,
    llm,
    validation,
    level: finalLevel,
    blueprintSectionCount: Array.isArray(blueprint.sections) ? blueprint.sections.length : null,
  });

  if (!dryRun) {
    const manifestPath = path.join(outputDir, `${levelId}.generation.json`);
    await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2));
    emit({ stage: 'manifest', message: `wrote ${path.basename(manifestPath)}`, manifestPath });
  }

  return {
    ok,
    level: finalLevel,
    blueprint,
    validation,
    structural,
    runtimeRepair,
    manifest,
    levelFile,
    files: {
      level: published && (ok || keepOnFailure) ? path.join(libraryDir, levelFile) : null,
      manifest: dryRun ? null : path.join(outputDir, `${levelId}.generation.json`),
    },
  };
}

/**
 * The generation manifest: what was asked, what ran, what came out, and what
 * was checked. This is the audit trail -- it is the only place a level's origin
 * is recorded, and it is written whether or not generation succeeded.
 */
export function buildManifest({
  levelId,
  songId,
  levelFile,
  ok,
  dryRun,
  published,
  request,
  tuning,
  rulesNotes,
  director,
  structural,
  runtimeRepair,
  compileWarnings,
  corrections,
  meta,
  llm,
  validation,
  level,
  blueprintSectionCount,
}) {
  return {
    schema_version: MANIFEST_SCHEMA_VERSION,
    pipeline_version: PIPELINE_VERSION,
    compiler_version: COMPILER_VERSION,
    level_id: levelId,
    song_id: songId,
    level_file: levelFile,
    ok,
    dry_run: Boolean(dryRun),
    published: Boolean(published),

    request,
    seed: request.seed,

    // `describeConfig` output: a mask and a boolean, never a key.
    llm: { ...llm, used: Boolean(director) },

    director: director
      ? {
          model: director.model,
          prompt_version: director.promptVersion,
          prompt_chars: director.promptChars,
          usage: director.usage,
          latency_ms: director.latencyMs,
          attempts: director.attempts,
          finish_reason: director.finishReason,
        }
      : null,

    // What the model transcribed wrong and the pipeline replaced with the
    // analysis's own values. Recorded so a run that "needed" 12 corrections is
    // visible rather than silently smoothed over.
    fact_corrections: corrections,

    blueprint: {
      schema_version: level?.editor?.blueprintVersion ?? null,
      sections: blueprintSectionCount,
      structural_ok: structural?.ok ?? null,
      structural_errors: structural?.validation?.errors ?? [],
      structural_warnings: structural?.validation?.warnings ?? [],
      structural_repairs: structural?.passes ?? 0,
      normalization_fixes: structural?.normalized ?? [],
      history: structural?.history ?? [],
    },

    runtime_repair: runtimeRepair,

    compile: {
      warnings: compileWarnings,
      sections: meta?.sectionCount ?? null,
      transitions: meta?.transitions ?? null,
      difficulty_curve: meta?.difficultyCurve ?? null,
      notes: meta?.notes ?? [],
      breather_beats: meta?.breatherBeats ?? null,
      beats_per_bar: meta?.beatsPerBar ?? null,
    },

    validation: validation
      ? {
          ok: validation.ok,
          errors: validation.level.errors,
          warnings: validation.level.warnings,
          mechanics: validation.level.mechanics,
          missing_mechanics: validation.level.missingMechanics,
          courses: validation.courses
            ? {
                // Candidate-scoped, as `validateAll` narrows it -- the library's
                // own verdict is `library_ok`.
                ok: validation.courses.ok,
                library_ok: validation.courses.libraryOk,
                mine: validation.courses.mine,
                procedural: validation.courses.procedural,
                others_failing: validation.courses.othersFailing,
              }
            : null,
          fairness: validation.fairness
            ? { ok: validation.fairness.ok, readable: validation.fairness.readable, total: validation.fairness.total, campable: validation.fairness.campable }
            : null,
          summary: summarize(validation),
        }
      : { ok: null, reason: dryRun ? 'dry run -- not validated' : 'not published -- not validated' },

    tuning,
    rules_notes: rulesNotes,
    generated_at: new Date().toISOString(),
  };
}

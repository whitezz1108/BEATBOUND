/**
 * BeatBound Level Editor server.
 *
 * Zero-dependency Node HTTP server (bind 127.0.0.1:5174) that:
 *   - serves the editor UI (editor/ui/)
 *   - stores uploaded songs into beatbound_library_v1/audio/editor/ so the
 *     runtime can fetch them via the level's relative audio path
 *   - runs the Python librosa analysis as a subprocess
 *   - runs the Level Director / section regeneration / level compilation
 *     (the generator is plain ESM -- same modules the tests use)
 *   - writes generated levels into beatbound_library_v1/ and registers them
 *     in levels.index.json so the game's picker + ?level= playtest them
 *   - offers the authoritative `npm run level -- <file>` check
 *
 * The browser UI talks to this server only; the game runtime never does.
 */

import { createServer } from 'node:http';
import { createReadStream, existsSync, readFileSync, statSync, promises as fs } from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { readTuningMirror, loadRulesWithTuning, TUNING_FALLBACK } from '../generation/rules.js';
import { registerInIndex as registerInIndexShared, generateLevel, loadArtifacts, MANIFEST_SCHEMA_VERSION } from '../generation/pipeline.js';
import { PRESETS, PRESET_IDS, describeRequest } from '../generation/presets.js';
import { resolveGenerationRequest } from './requests.js';
import { loadCatalog, buildGameplayContext, GAMEPLAY_CONTEXT_SCHEMA_VERSION } from '../generation/gameplayContext.js';
import { describeConfig, loadLlmConfig } from '../generation/llm/config.js';
// The same module the browser loads. Schema detection lives in exactly one
// place so the server cannot disagree with the UI about what is in the session.
import { detectBlueprintSchema, isV2, V2_SCHEMA } from '../ui/blueprintModel.js';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const UI_DIR = path.join(ROOT, 'editor', 'ui');
const OUTPUT_DIR = path.join(ROOT, 'editor', 'output');
const LIB_DIR = path.join(ROOT, 'beatbound_library_v1');
const AUDIO_DIR = path.join(LIB_DIR, 'audio', 'editor');
const ANALYSIS_SCRIPT = path.join(ROOT, 'editor', 'music-analysis', 'analyze_music_v2.py');
const V2_OUTPUT = path.join(OUTPUT_DIR, 'music_analysis_v2.json');
const LEGACY_OUTPUT = path.join(OUTPUT_DIR, 'music_analysis.json');
const DIRECTOR_OUTPUT = path.join(OUTPUT_DIR, 'director_context.json'); // v1, still exported
const DIRECTOR_V2_OUTPUT = path.join(OUTPUT_DIR, 'director_context_v2.json');
const PORT = Number(process.env.EDITOR_PORT) || 5174;
const HOST = '127.0.0.1';
const MAX_UPLOAD_BYTES = 200 * 1024 * 1024;

await fs.mkdir(AUDIO_DIR, { recursive: true });
await fs.mkdir(OUTPUT_DIR, { recursive: true });

// ---- session state (also persisted to editor/output/) ----------------------
const state = {
  song: null, // { id, title, file, audioPath, audioUrl }
  analysis: null, // music_analysis.json object
  blueprint: null, // level_blueprint.json object -- v1 or v2, see below
  blueprintSchema: null, // 'v1' | 'beatbound_level_blueprint_v2' | null
  levelFile: null, // <slug>.level.json inside the library
  seed: 42,
};

/**
 * Put a blueprint into the session, recording which schema it is.
 *
 * `state.blueprint` is one slot that can hold either schema, and for a long
 * time nothing recorded which -- so `/api/generate` handed v2 blueprints to the
 * v1 compiler and the failure surfaced as an unrelated-looking error deep
 * inside it. The schema is derived rather than passed in, so a caller cannot
 * record it wrongly, and it is recomputed on every write rather than cached, so
 * it cannot go stale against the blueprint it describes.
 */
function setBlueprint(bp) {
  state.blueprint = bp;
  state.blueprintSchema = detectBlueprintSchema(bp);
  return bp;
}

async function restoreState() {
  try {
    const a = JSON.parse(await fs.readFile(path.join(OUTPUT_DIR, 'music_analysis.json'), 'utf8'));
    state.analysis = a;
  } catch {}
  try {
    const b = JSON.parse(await fs.readFile(path.join(OUTPUT_DIR, 'level_blueprint.json'), 'utf8'));
    setBlueprint(b);
    state.seed = b.seed ?? state.seed;
  } catch {}
  if (state.blueprint) {
    state.levelFile = `${state.blueprint.song.id}.level.json`;
    const audioPath = state.blueprint.song.audioPath;
    const abs = path.join(LIB_DIR, audioPath.replace(/^\//, ''));
    if (existsSync(abs)) {
      state.song = {
        id: state.blueprint.song.id,
        title: state.blueprint.song.title,
        audioPath: audioPath.replace(/^\//, ''),
        audioUrl: `/api/audio/${path.basename(abs)}`,
      };
    }
  }
}
await restoreState();

// ---- runtime tuning mirror ---------------------------------------------------
// The editor must never hardcode values the game owns. The mirror of
// `TUNING.transition` is parsed out of the live game source at startup and
// injected over the rules JSON, which only carries an offline fallback; a
// disagreement between the two is surfaced as a consistency note instead of
// silently generating levels against a stale value.
//
// Both halves live in editor/generation/rules.js, shared with the generation
// pipeline, so the server and the pipeline cannot read different numbers.
const tuningMirror = readTuningMirror({ projectRoot: ROOT });
const rulesConsistencyNotes = []; // filled by loadRules()

// ---- helpers ----------------------------------------------------------------

function json(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(body);
}

/**
 * Serve a UI file with an ETag.
 *
 * Without any validator the browser applies heuristic caching and keeps running
 * a stale `editor.js` after the file changes -- which is how a fixed panel kept
 * reporting a bug that was no longer in the code. `no-cache` still allows the
 * file to be *stored*, it just forces a revalidation, so the common case is a
 * 304 with no body.
 */
function sendFile(res, filePath, contentType, req) {
  if (!existsSync(filePath)) {
    res.writeHead(404);
    res.end('not found');
    return;
  }
  const { mtimeMs, size } = statSync(filePath);
  const etag = `W/"${size}-${Math.round(mtimeMs)}"`;
  if (req?.headers['if-none-match'] === etag) {
    res.writeHead(304, { ETag: etag, 'Cache-Control': 'no-cache' });
    res.end();
    return;
  }
  res.writeHead(200, {
    'Content-Type': contentType,
    'Cache-Control': 'no-cache',
    ETag: etag,
  });
  createReadStream(filePath).pipe(res);
}

async function readBody(req, limit = MAX_UPLOAD_BYTES) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw new Error('body too large');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

function slugify(name) {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9_\- ]+/g, '')
      .trim()
      .replace(/\s+/g, '_')
      .replace(/_+/g, '_') || 'song'
  );
}

/** Run the V2 Python analyser (music_analysis_v2 + v1 projection + director context).
 *
 * The CLI is invoked with --quiet: everything the editor needs is read back
 * from the JSON files it writes, so nothing here depends on stdout parsing.
 * Resolves with a small summary for the UI; rejects on a non-zero exit.
 */
function runAnalysis(audioAbsPath, { bpm, timesig, mode } = {}) {
  return new Promise((resolve, reject) => {
    const args = [ANALYSIS_SCRIPT, audioAbsPath, V2_OUTPUT, '--quiet'];
    if (mode === 'fast') args.push('--fast');
    if (bpm) args.push('--bpm', String(bpm));
    if (timesig && Array.isArray(timesig)) args.push('--timesig', ...timesig.map(String));
    const child = spawn('python', args, { cwd: ROOT });
    let err = '';
    child.stdout.on('data', () => {}); // --quiet keeps stdout empty; drain regardless
    child.stderr.on('data', (d) => (err += d));
    child.on('close', (code) => {
      if (code !== 0) return reject(new Error(err.trim().slice(-800) || `python exited with ${code}`));
      resolve({ ok: true });
    });
  });
}

/**
 * A small shape summary of director_context_v2.json, or null when it is absent.
 *
 * Read back rather than derived from the analyser's own stdout: `--quiet` is
 * deliberate (nothing downstream should depend on parsing a subprocess log),
 * so the artifacts are the contract.
 */
async function readDirectorSummary() {
  try {
    const dc = JSON.parse(await fs.readFile(DIRECTOR_V2_OUTPUT, 'utf8'));
    return {
      schema_version: dc.schema_version,
      song_id: dc.source?.song_id ?? null,
      bars: dc.timing?.bars?.length ?? 0,
      bar_count: dc.timing?.bar_count ?? null,
      bpm: dc.timing?.bpm ?? null,
      meter: dc.timing?.meter ?? null,
      sections: dc.sections?.length ?? 0,
      phrases: dc.phrases?.length ?? 0,
      anchors: dc.anchors?.length ?? 0,
      repeat_groups: dc.repeat_groups?.length ?? 0,
      sync_checkpoints: dc.sync_checkpoints?.length ?? 0,
      melody_available: dc.melody?.available ?? false,
      reliability: dc.reliability ?? null,
    };
  } catch {
    return null;
  }
}

/** Serve one of the analysis JSON files, optionally as a forced download. */
function sendAnalysisFile(res, filePath, filename, download) {
  if (!existsSync(filePath)) {
    return json(res, 404, { error: `${filename} not generated yet -- run an analysis first` });
  }
  const headers = { 'Content-Type': 'application/json; charset=utf-8' };
  if (download) headers['Content-Disposition'] = `attachment; filename="${filename}"`;
  res.writeHead(200, headers);
  createReadStream(filePath).pipe(res);
}

/** The authoritative check: the game's own level-report tool. */
function runLevelCheck(levelFile) {
  return new Promise((resolve) => {
    const child = spawn('npm', ['run', 'level', '--', levelFile], {
      cwd: ROOT,
      shell: process.platform === 'win32',
    });
    let out = '';
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (out += d));
    child.on('close', () => resolve(out));
  });
}

// The index writer lives in the generation pipeline so the server and the
// pipeline register levels the same way -- including the trailing newline the
// old copy here dropped, which showed up as a whitespace diff on every write.
function registerInIndex(entry) {
  return registerInIndexShared(entry, { libraryDir: LIB_DIR });
}

async function loadGeneratorModules() {
  const [seedMod, directorMod, compilerMod, validateMod, indexMod] = await Promise.all([
    import('../generator/seed.js'),
    import('../generator/levelDirector.js'),
    import('../generator/levelCompiler.js'),
    import('../generator/validate.js'),
    import('../generator/patternIndex.js'),
  ]);
  return { seedMod, directorMod, compilerMod, validateMod, indexMod };
}

/**
 * The v2 modules, which are a different set from the v1 ones above.
 *
 * `blueprint.js` is the schema (validator + normalizer) and `patternIndex.js`
 * is shared. Loaded lazily for the same reason the v1 group is: these pull in
 * the whole generation tree, and the editor's hot paths -- `/api/state`,
 * static files -- must not pay for that on every request.
 */
async function loadV2Modules() {
  const [blueprintMod, indexMod] = await Promise.all([
    import('../generation/blueprint.js'),
    import('../generator/patternIndex.js'),
  ]);
  return { blueprintMod, indexMod };
}

/**
 * Apply a hand-edited v2 blueprint: repair, compile, publish, validate.
 *
 * This calls `generateLevel` with the session's blueprint rather than
 * re-implementing compile-and-publish here, and that is the whole point. The
 * pipeline skips layer 3 when a blueprint is supplied (`pipeline.js:513`) and
 * runs everything after it -- structural repair, the authoritative compiler,
 * the library write, the index registration, the game's own level report. So an
 * AI-generated plan and a hand-edited one go through one implementation and
 * cannot drift apart. A second compile path here is exactly how the two would
 * start disagreeing about bar conventions.
 *
 * No model is involved: a supplied blueprint skips the director, and with no
 * `client` the model-repair callback is never built either. Deterministic
 * repair still runs, which is what makes an edited blueprint legal again.
 */
async function applyV2Blueprint(res, opts) {
  const blueprint = state.blueprint;
  if (opts.title) blueprint.song.title = opts.title;
  const levelId = opts.level_id ?? blueprint.song?.id;
  if (!levelId) {
    return json(res, 400, { error: 'the blueprint has no song.id to name the level after' });
  }

  const result = await generateLevel({
    projectRoot: ROOT,
    outputDir: OUTPUT_DIR,
    libraryDir: LIB_DIR,
    // The blueprint's own request block, not a fresh one: it is part of the
    // artifact, and overriding it would compile something the manifest does not
    // describe.
    request: blueprint.request,
    blueprint,
    levelId,
    repair: false,
    courses: opts.courses !== false,
    fairness: opts.fairness === true,
    keepOnFailure: opts.keep_on_failure === true,
  });

  // Keep the session in step with what just landed, so /api/check and the
  // playtest button point at the new file -- and so the repaired blueprint the
  // pipeline hands back (tiling restored, ranges clamped) is what the editor
  // shows next, rather than the pre-repair copy the user typed.
  if (result.files?.level) {
    state.levelFile = result.levelFile;
    setBlueprint(result.blueprint);
    await writeBlueprintFile();
  }

  // The validators' own reports, read at the level each actually nests its
  // verdicts under. `validateAll` returns `{ok, level:{errors,warnings}, ...}`
  // and `repairBlueprint` returns `{validation:{errors,warnings}, ...}`;
  // reading `.errors` off either top level is `undefined`, and `?? []` turns
  // that into a confident "0 errors" for a level that failed.
  //
  // The structural report is the fallback rather than the primary because a
  // blueprint that fails *structural* validation is never published, so
  // `validation` is `null` -- and without this the route would answer 200 with
  // no level file, which reads as success to everything downstream.
  const structuralErrors = result.structural?.validation?.errors ?? [];
  const errors = result.validation?.level?.errors ?? structuralErrors;
  const warnings =
    result.validation?.level?.warnings ?? result.structural?.validation?.warnings ?? [];

  if (!result.ok || errors.length > 0) {
    return json(res, 422, {
      ok: false,
      errors:
        errors.length > 0
          ? errors
          : ['the blueprint did not compile into a publishable level, and no validator reported why'],
      warnings,
      levelFile: result.levelFile ?? null,
      schema: state.blueprintSchema,
      structural: result.structural ?? null,
    });
  }

  return json(res, 200, {
    ok: true,
    levelFile: result.levelFile,
    warnings,
    level: result.level,
    schema: state.blueprintSchema,
    validation: result.validation ?? null,
    structural: result.structural ?? null,
  });
}

/** Persist the session's blueprint where a restart will find it again. One
 *  writer, so the file cannot disagree with `state.blueprint`. */
async function writeBlueprintFile() {
  await fs.writeFile(
    path.join(OUTPUT_DIR, 'level_blueprint.json'),
    JSON.stringify(state.blueprint, null, 2),
  );
}

/**
 * The three rules files with the live game tuning injected over them.
 *
 * The comparison itself is `loadRulesWithTuning`'s; all this adds is capturing
 * its notes once, into the array `/api/state` reports. Reading the files on
 * every call (rather than caching the result) keeps the editor honest while a
 * rules JSON is being edited underneath it.
 */
function loadRules() {
  const { rules, notes, tuning } = loadRulesWithTuning({ projectRoot: ROOT, mirror: tuningMirror });
  if (rulesConsistencyNotes.length === 0) rulesConsistencyNotes.push(...notes);
  liveTuning = tuning;
  return rules;
}

/**
 * The mirror in the shape the UI already reads.
 *
 * `readTuningMirror` returns `{values, source, missing}`; `/api/state` has
 * always published the values flattened alongside `source` and `missing`, and
 * the UI reads them that way. Kept flat here so the shared loader could change
 * shape without breaking the panel.
 */
function tuningMirrorForUi() {
  return { ...tuningMirror.values, source: tuningMirror.source, missing: [...tuningMirror.missing] };
}

let liveTuning = { ...TUNING_FALLBACK };

// ---- routes ------------------------------------------------------------------

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const p = url.pathname;

  try {
    // ---- static UI ----
    if (req.method === 'GET' && (p === '/' || p === '/index.html')) {
      return sendFile(res, path.join(UI_DIR, 'index.html'), 'text/html; charset=utf-8', req);
    }
    if (req.method === 'GET' && /^\/[a-zA-Z0-9_.\-]+$/.test(p) && existsSync(path.join(UI_DIR, p))) {
      const ext = p.split('.').pop();
      const types = { html: 'text/html', css: 'text/css', js: 'text/javascript', svg: 'image/svg+xml' };
      return sendFile(res, path.join(UI_DIR, p), types[ext] || 'application/octet-stream', req);
    }

    // ---- audio preview (with Range support so seeking works) ----
    if (req.method === 'GET' && p.startsWith('/api/audio/')) {
      const name = path.basename(p);
      const file = path.join(AUDIO_DIR, name);
      if (!existsSync(file)) {
        res.writeHead(404);
        return res.end('no audio');
      }
      const stat = await fs.stat(file);
      const range = req.headers.range;
      if (range) {
        const m = /bytes=(\d*)-(\d*)/.exec(range);
        const start = m && m[1] ? Number(m[1]) : 0;
        const end = m && m[2] ? Number(m[2]) : stat.size - 1;
        res.writeHead(206, {
          'Content-Type': 'audio/mpeg',
          'Content-Range': `bytes ${start}-${end}/${stat.size}`,
          'Accept-Ranges': 'bytes',
          'Content-Length': end - start + 1,
        });
        return createReadStream(file, { start, end }).pipe(res);
      }
      res.writeHead(200, { 'Content-Type': 'audio/mpeg', 'Content-Length': stat.size });
      return createReadStream(file).pipe(res);
    }

    // ---- state ----
    if (req.method === 'GET' && p === '/api/state') {
      loadRules(); // triggers the consistency check on first use
      return json(res, 200, {
        song: state.song,
        seed: state.seed,
        hasAnalysis: state.analysis !== null,
        hasBlueprint: state.blueprint !== null,
        // Which schema the session's blueprint is, so the UI can pick its
        // editors before it renders anything. Recomputed here rather than read
        // off `state` so a blueprint written by a path that forgot
        // `setBlueprint` still reports honestly instead of reporting stale.
        blueprintSchema: detectBlueprintSchema(state.blueprint),
        levelFile: state.levelFile,
        hasDirectorContext: existsSync(DIRECTOR_OUTPUT),
        hasDirectorContextV2: existsSync(DIRECTOR_V2_OUTPUT),
        hasFullAnalysis: existsSync(V2_OUTPUT),
        tuningMirror: tuningMirrorForUi(),
        tuning: { ...liveTuning },
        consistencyNotes: [...rulesConsistencyNotes],
        // The *whole* analysis, not a summary: the timeline and waveform
        // canvases read `bars[].energy`, `tempo.timeSignature`, `onsets` and
        // `waveformEnvelope` directly, and `/api/analysis` hands out the same
        // object. Sending a reduced shape here meant whichever of the two
        // landed last in `state.analysis` decided whether the panel rendered
        // or threw -- so there is only one shape now.
        analysis: state.analysis,
      });
    }

    // ---- upload song ----
    if (req.method === 'POST' && p === '/api/upload') {
      const filename = url.searchParams.get('filename') || 'song.mp3';
      const ext = (filename.split('.').pop() || 'mp3').toLowerCase().slice(0, 5);
      const slug = slugify(filename.slice(0, filename.length - ext.length - 1));
      const buf = await readBody(req);
      const target = path.join(AUDIO_DIR, `${slug}.${ext}`);
      await fs.writeFile(target, buf);
      state.song = {
        id: slug,
        title: filename.replace(new RegExp(`\\.${ext}$`, 'i'), ''),
        audioPath: `audio/editor/${slug}.${ext}`,
        audioUrl: `/api/audio/${slug}.${ext}`,
      };
      state.analysis = null;
      setBlueprint(null);
      state.levelFile = null;
      // Stale analysis exports must not be downloadable against the new song.
      for (const stale of [V2_OUTPUT, LEGACY_OUTPUT, DIRECTOR_OUTPUT, DIRECTOR_V2_OUTPUT]) {
        await fs.rm(stale, { force: true });
      }
      return json(res, 200, { ok: true, song: state.song });
    }

    // ---- analyse ----
    if (req.method === 'POST' && p === '/api/analyze') {
      if (!state.song) return json(res, 400, { error: 'upload a song first' });
      const opts = await readJsonBody(req);
      const audioAbs = path.join(LIB_DIR, state.song.audioPath);
      await runAnalysis(audioAbs, opts);
      const analysis = JSON.parse(await fs.readFile(LEGACY_OUTPUT, 'utf8'));
      // Store library-relative paths so the compiler emits runtime-ready audio.
      analysis.song.audioPath = state.song.audioPath;
      analysis.song.id = state.song.id;
      analysis.song.title = state.song.title;
      await fs.writeFile(LEGACY_OUTPUT, JSON.stringify(analysis, null, 2));
      state.analysis = analysis;

      // The V2 director context is what the generator reads, so summarise that
      // one -- the UI is confirming what the pipeline will be handed, not what
      // the v1 export looks like.
      const directorSummary = await readDirectorSummary();
      return json(res, 200, {
        ok: true,
        report: {
          bpm_override: Boolean(opts.bpm),
          bpm: analysis.tempo.bpm,
          bars: analysis.bars.length,
          sections: analysis.sections.length,
          onsets: analysis.onsets.length,
          mode: opts.mode === 'fast' ? 'fast' : 'full',
        },
        directorContext: directorSummary,
        analysis: state.analysis,
      });
    }

    // ---- analysis ----
    if (req.method === 'GET' && p === '/api/analysis') {
      if (!state.analysis) return json(res, 404, { error: 'no analysis yet' });
      return json(res, 200, state.analysis);
    }

    // ---- director context (the generator-facing export, V2) ----
    // `?v=1` still serves the legacy v1 document, which the old UI panel and
    // any saved bookmark may be asking for.
    if (req.method === 'GET' && p === '/api/director-context') {
      const legacy = url.searchParams.get('v') === '1';
      const file = legacy ? DIRECTOR_OUTPUT : DIRECTOR_V2_OUTPUT;
      const name = legacy ? 'director_context.json' : 'director_context_v2.json';
      return sendAnalysisFile(res, file, name, url.searchParams.get('download') === '1');
    }

    // ---- full V2 analysis (optional secondary download) ----
    if (req.method === 'GET' && p === '/api/analysis-v2') {
      return sendAnalysisFile(res, V2_OUTPUT, 'music_analysis_v2.json', url.searchParams.get('download') === '1');
    }

    // ---- blueprint ----
    if (req.method === 'GET' && p === '/api/blueprint') {
      if (!state.blueprint) return json(res, 404, { error: 'no blueprint yet' });
      return json(res, 200, state.blueprint);
    }

    // ---- mechanics for the UI (lead-in beats, telegraphs) ----
    if (req.method === 'GET' && p === '/api/mechanics') {
      const lib = JSON.parse(readFileSync(path.join(LIB_DIR, 'mechanics.mvp.json'), 'utf8'));
      return json(res, 200, lib.mechanics.map((m) => ({
        id: m.id,
        name: m.name,
        mode: m.mode,
        telegraphBeats: m.timing?.telegraphBeats ?? 0,
        durationBeats: m.timing?.durationBeats ?? 1,
      })));
    }

    // ---- patterns for the UI ----
    if (req.method === 'GET' && p === '/api/patterns') {
      const { indexMod } = await loadGeneratorModules();
      const index = indexMod.loadPatternIndex();
      return json(res, 200, {
        entries: index.entries.map((e) => ({
          id: e.id,
          name: e.name,
          mode: e.mode,
          function: e.function,
          difficulty: e.difficulty,
          lengthBars: e.lengthBars,
          family: e.family,
          energy: e.energy,
          recovery: e.recovery,
          teach: e.teach,
          mechanicIds: [...new Set((e.events ?? []).map((ev) => ev.mechanicId))],
        })),
        meta: index.meta,
      });
    }

    // ---- level director ----
    if (req.method === 'POST' && p === '/api/direct') {
      if (!state.analysis) return json(res, 400, { error: 'run analysis first' });
      const opts = await readJsonBody(req);
      const { directorMod } = await loadGeneratorModules();
      state.seed = Number.isInteger(opts.seed) ? opts.seed : state.seed;
      const blueprint = directorMod.direct(state.analysis, loadRules(), {
        seed: state.seed,
        startMode: opts.startMode,
      });
      await fs.writeFile(
        path.join(OUTPUT_DIR, 'level_blueprint.json'),
        JSON.stringify(blueprint, null, 2)
      );
      setBlueprint(blueprint);
      return json(res, 200, { ok: true, blueprint, seed: state.seed });
    }

    // ---- save hand-edited blueprint ----
    if (req.method === 'POST' && p === '/api/blueprint') {
      const blueprint = await readJsonBody(req);
      setBlueprint(blueprint);
      await fs.writeFile(
        path.join(OUTPUT_DIR, 'level_blueprint.json'),
        JSON.stringify(blueprint, null, 2)
      );
      return json(res, 200, { ok: true, schema: state.blueprintSchema });
    }

    // ---- regenerate one section ----
    //
    // v1 only, and deliberately so. The v2 director writes the whole plan in a
    // single pass -- there is no per-section prompt and no section-level entry
    // point into the pipeline. Synthesising one here would be a second
    // level-design algorithm living in the server, which is the thing the
    // pipeline exists to prevent. Worse, `regenerateSection` reads v1 field
    // names, so handing it a v2 blueprint returns sections carrying `startBar`
    // alongside `start_bar`: a hybrid, and the mixed state the editor is
    // supposed to make impossible. So a v2 session is told what it can do
    // instead of being quietly corrupted.
    //
    // `mode: 'repair'` is the v2-native action that *is* safe, and it is the
    // one that maps onto what this button means for v2: re-run the
    // deterministic normalizer, which restores tiling, bar ranges and
    // mode-change feasibility in place while leaving every choice the director
    // made -- and every hand edit -- alone.
    if (req.method === 'POST' && p === '/api/regenerate') {
      if (!state.blueprint) return json(res, 400, { error: 'no blueprint yet' });
      if (!state.analysis) return json(res, 400, { error: 'no analysis yet' });
      const { sectionId, mode } = await readJsonBody(req);

      if (isV2(state.blueprint)) {
        if (mode !== 'repair') {
          return json(res, 400, {
            code: 'unsupported_for_v2',
            error:
              'this session holds a beatbound_level_blueprint_v2, which has no per-section ' +
              'regeneration -- the director plans the whole song at once. Re-run AI GENERATE ' +
              'for a new plan, or repair to re-establish this blueprint’s invariants in place.',
          });
        }
        const { blueprintMod, indexMod } = await loadV2Modules();
        const { directorContext, tuning } = loadArtifacts({ projectRoot: ROOT, outputDir: OUTPUT_DIR });
        const request = state.blueprint.request ?? {};
        const { blueprint, fixes } = blueprintMod.normalizeBlueprint(state.blueprint, {
          directorContext,
          gameplayContext: buildGameplayContext({
            projectRoot: ROOT,
            allowedModes: request.allowed_modes,
            primaryMode: request.primary_mode,
          }),
          patternIndex: indexMod.loadPatternIndex({ projectRoot: ROOT }),
          tuning,
        });
        setBlueprint(blueprint);
        await writeBlueprintFile();
        return json(res, 200, { ok: true, blueprint, fixes, schema: state.blueprintSchema });
      }

      const { directorMod } = await loadGeneratorModules();
      setBlueprint(
        directorMod.regenerateSection(state.blueprint, sectionId, loadRules(), {
          music: state.analysis,
        }),
      );
      await writeBlueprintFile();
      return json(res, 200, { ok: true, blueprint: state.blueprint, schema: state.blueprintSchema });
    }

    // ---- compile level.json into the library ----
    if (req.method === 'POST' && p === '/api/generate') {
      if (!state.blueprint) return json(res, 400, { error: 'no blueprint yet' });
      const opts = await readJsonBody(req);
      // Schema decides the compiler. A v2 blueprint handed to `compilerMod`
      // (the v1 compiler) reads `section.startBar`, finds `undefined`, and
      // fails somewhere unrelated to the real problem.
      if (isV2(state.blueprint)) return applyV2Blueprint(res, opts);
      const { compilerMod, validateMod } = await loadGeneratorModules();
      if (opts.title) state.blueprint.song.title = opts.title;
      const { level } = compilerMod.compile(state.blueprint);
      const { errors, warnings } = validateMod.validateLevel(level, {
        breatherBeats: loadRules().gameplay.transition.breatherBeats,
      });
      if (errors.length > 0) {
        return json(res, 422, { ok: false, errors, warnings });
      }
      const levelFile = `${state.blueprint.song.id}.level.json`;
      await fs.writeFile(path.join(LIB_DIR, levelFile), JSON.stringify(level, null, 2));
      await fs.writeFile(path.join(OUTPUT_DIR, 'level.json'), JSON.stringify(level, null, 2));
      await registerInIndex({
        id: state.blueprint.song.id,
        file: levelFile,
        title: state.blueprint.song.title,
        blurb: 'Generated in the BeatBound Level Editor.',
      });
      state.levelFile = levelFile;
      return json(res, 200, { ok: true, levelFile, warnings, level });
    }

    // ---- authoritative check through the real LevelLoader ----
    if (req.method === 'POST' && p === '/api/check') {
      if (!state.levelFile) return json(res, 400, { error: 'generate a level first' });
      const output = await runLevelCheck(state.levelFile);
      return json(res, 200, { ok: true, output });
    }

    // ---- V2 generation: presets, LLM status, gameplay context --------------

    // ---- generation presets (the UI's dropdown) ----
    if (req.method === 'GET' && p === '/api/presets') {
      return json(res, 200, {
        presets: PRESET_IDS.map((id) => PRESETS[id]),
        ids: PRESET_IDS,
      });
    }

    // ---- LLM status: is a director configured, and what will it be? ----
    // Reports the key as a mask plus a boolean. The value never leaves
    // `loadLlmConfig`, and nothing here writes it anywhere.
    if (req.method === 'GET' && p === '/api/llm/status') {
      const config = loadLlmConfig();
      return json(res, 200, {
        ...describeConfig(config),
        // The pipeline can run without a key as long as a blueprint is supplied;
        // the UI uses this to decide whether the generate button needs a file.
        canGenerateWithoutKey: true,
      });
    }

    // ---- gameplay context: the capability catalog for the chosen modes ----
    if (req.method === 'GET' && p === '/api/gameplay-context') {
      const primaryMode = url.searchParams.get('primary_mode') || undefined;
      const allowedParam = url.searchParams.get('allowed_modes');
      const allowedModes = allowedParam ? allowedParam.split(',').map((s) => s.trim()).filter(Boolean) : undefined;
      const context = buildGameplayContext({ projectRoot: ROOT, allowedModes, primaryMode });
      return json(res, 200, context);
    }

    // ---- the generation manifest for a level (the audit trail) ----
    if (req.method === 'GET' && p === '/api/manifest') {
      const levelId = url.searchParams.get('level_id');
      if (!levelId) return json(res, 400, { error: 'level_id is required' });
      // `path.basename` so a crafted id cannot walk out of editor/output/.
      const manifestPath = path.join(OUTPUT_DIR, `${path.basename(levelId)}.generation.json`);
      if (!existsSync(manifestPath)) return json(res, 404, { error: `no manifest for ${levelId}` });
      return sendAnalysisFile(res, manifestPath, `${path.basename(levelId)}.generation.json`, url.searchParams.get('download') === '1');
    }

    // ---- run the V2 generation pipeline (streamed) ----
    //
    // This is the long one: it may call the model, compile, run the game's own
    // level report, run both RUNNER courses, and repair. It streams
    // newline-delimited JSON events so the UI can show where it is instead of
    // staring at a spinner, and ends with one `result` event.
    if (req.method === 'POST' && p === '/api/generate-level') {
      const opts = await readJsonBody(req);
      return streamGeneration(res, req, opts);
    }

    // ---- existing levels (for reference) ----
    if (req.method === 'GET' && p === '/api/levels') {
      try {
        const index = JSON.parse(
          await fs.readFile(path.join(LIB_DIR, 'levels.index.json'), 'utf8')
        );
        return json(res, 200, index.levels);
      } catch {
        return json(res, 200, []);
      }
    }

    res.writeHead(404);
    res.end('not found');
  } catch (err) {
    console.error('[editor]', err);
    json(res, 500, { error: String(err?.message ?? err) });
  }
});

async function readJsonBody(req) {
  const buf = await readBody(req, 10 * 1024 * 1024);
  if (buf.length === 0) return {};
  return JSON.parse(buf.toString('utf8'));
}

/**
 * Run the generation pipeline and stream its events to the browser.
 *
 * Wire format is newline-delimited JSON rather than SSE: there is no reconnect
 * story to support (a generation is one-shot and cannot be resumed), and NDJSON
 * needs no event framing on either end. Each line is
 * `{"type": "event"|"result"|"error", ...}`.
 *
 * The abort controller is wired to the response closing, so a browser that
 * navigates away mid-generation stops the model call rather than leaving it to
 * finish against a socket nobody is reading.
 */
async function streamGeneration(res, req, opts) {
  res.writeHead(200, {
    'Content-Type': 'application/x-ndjson; charset=utf-8',
    'Cache-Control': 'no-cache',
    // The pipeline writes to the library and the model call can be slow; a
    // proxy that buffers would defeat the point of streaming at all.
    'X-Accel-Buffering': 'no',
  });

  const controller = new AbortController();
  res.on('close', () => controller.abort());

  const send = (obj) => {
    if (res.writableEnded) return;
    res.write(`${JSON.stringify(obj)}\n`);
  };

  try {
    const request = resolveGenerationRequest(opts);
    send({ type: 'event', stage: 'request', message: describeRequest(request), request });

    const result = await generateLevel({
      projectRoot: ROOT,
      outputDir: OUTPUT_DIR,
      libraryDir: LIB_DIR,
      request,
      blueprint: opts.blueprint ?? undefined,
      levelId: opts.level_id ?? undefined,
      // No `model` here on purpose: the model is deployment configuration and
      // comes from BEATBOUND_LLM_MODEL, not from a request body. The CLI's
      // --model sets that same variable rather than threading a second path.
      preset: opts.preset,
      repair: opts.repair !== false,
      courses: opts.courses !== false,
      fairness: opts.fairness === true,
      dryRun: opts.dry_run === true,
      keepOnFailure: opts.keep_on_failure === true,
      signal: controller.signal,
      onEvent: (event) => send({ type: 'event', ...event }),
    });

    // Keep the session's notion of "the level" in step with what just landed,
    // so /api/check and the playtest button point at the new file.
    if (result.files?.level) {
      state.levelFile = result.levelFile;
      setBlueprint(result.blueprint);
      // Persist it, or the session is a lie: `restoreState` reads
      // level_blueprint.json on boot, so an unpersisted v2 plan meant a restart
      // -- or a refresh after the server was reaped -- silently reloaded
      // whatever v1 blueprint happened to be on disk from an earlier run. The
      // user saw their v2 session "turn into v1", which is exactly what it was.
      await writeBlueprintFile();
    }

    send({
      type: 'result',
      ok: result.ok,
      levelFile: result.levelFile,
      files: result.files,
      manifest: result.manifest,
      manifestSchemaVersion: MANIFEST_SCHEMA_VERSION,
      level: result.level,
      validation: result.validation,
      structural: result.structural,
      runtimeRepair: result.runtimeRepair,
    });
  } catch (err) {
    send({ type: 'error', error: String(err?.message ?? err) });
  } finally {
    if (!res.writableEnded) res.end();
  }
}

server.listen(PORT, HOST, () => {
  console.log('');
  console.log('  BeatBound Level Editor  ->  http://localhost:' + PORT);
  console.log('  Game runtime (playtest) ->  http://localhost:5173  (npm run dev)');
  console.log('');
});

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
import { createReadStream, existsSync, readFileSync, promises as fs } from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const UI_DIR = path.join(ROOT, 'editor', 'ui');
const OUTPUT_DIR = path.join(ROOT, 'editor', 'output');
const LIB_DIR = path.join(ROOT, 'beatbound_library_v1');
const AUDIO_DIR = path.join(LIB_DIR, 'audio', 'editor');
const ANALYSIS_SCRIPT = path.join(ROOT, 'editor', 'music-analysis', 'analyze_music_v2.py');
const V2_OUTPUT = path.join(OUTPUT_DIR, 'music_analysis_v2.json');
const LEGACY_OUTPUT = path.join(OUTPUT_DIR, 'music_analysis.json');
const DIRECTOR_OUTPUT = path.join(OUTPUT_DIR, 'director_context.json');
const PORT = Number(process.env.EDITOR_PORT) || 5174;
const HOST = '127.0.0.1';
const MAX_UPLOAD_BYTES = 200 * 1024 * 1024;

await fs.mkdir(AUDIO_DIR, { recursive: true });
await fs.mkdir(OUTPUT_DIR, { recursive: true });

// ---- session state (also persisted to editor/output/) ----------------------
const state = {
  song: null, // { id, title, file, audioPath, audioUrl }
  analysis: null, // music_analysis.json object
  blueprint: null, // level_blueprint.json object
  levelFile: null, // <slug>.level.json inside the library
  seed: 42,
};

async function restoreState() {
  try {
    const a = JSON.parse(await fs.readFile(path.join(OUTPUT_DIR, 'music_analysis.json'), 'utf8'));
    state.analysis = a;
  } catch {}
  try {
    const b = JSON.parse(await fs.readFile(path.join(OUTPUT_DIR, 'level_blueprint.json'), 'utf8'));
    state.blueprint = b;
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
// The editor must never hardcode values the game owns. breatherBeats and
// sceneBeats are parsed from the live game source (src/tuning.ts) at startup;
// the rules JSON only carries an offline fallback, and any disagreement
// between the two is surfaced as a consistency warning instead of silently
// generating levels against a stale value.
function readTuningMirror() {
  const mirror = { breatherBeats: null, sceneBeats: null, source: null, missing: [] };
  try {
    const src = readFileSync(path.join(ROOT, 'src', 'tuning.ts'), 'utf8');
    const block = src.match(/transition:\s*\{([\s\S]*?)\n\s*\},/);
    if (!block) {
      mirror.missing.push('TUNING.transition block');
      return mirror;
    }
    const read = (name) => {
      const m = block[1].match(new RegExp(`${name}\\s*:\\s*(\\d+)`));
      if (!m) {
        mirror.missing.push(`TUNING.transition.${name}`);
        return null;
      }
      return Number(m[1]);
    };
    mirror.breatherBeats = read('breatherBeats');
    mirror.sceneBeats = read('sceneBeats');
    mirror.source = 'src/tuning.ts';
  } catch (err) {
    mirror.missing.push(`src/tuning.ts unreadable (${err.message})`);
  }
  return mirror;
}
const tuningMirror = readTuningMirror();
const rulesConsistencyNotes = []; // set on the first loadRules() call

// ---- helpers ----------------------------------------------------------------

function json(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(body);
}

function sendFile(res, filePath, contentType) {
  if (!existsSync(filePath)) {
    res.writeHead(404);
    res.end('not found');
    return;
  }
  res.writeHead(200, { 'Content-Type': contentType });
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

async function registerInIndex(entry) {
  const indexPath = path.join(LIB_DIR, 'levels.index.json');
  let index = { version: '1.0.0', levels: [] };
  try {
    index = JSON.parse(await fs.readFile(indexPath, 'utf8'));
  } catch {}
  const existing = index.levels.find((l) => l.file === entry.file);
  if (!existing) index.levels.push(entry);
  else Object.assign(existing, entry);
  await fs.writeFile(indexPath, JSON.stringify(index, null, 2));
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

function loadRules() {
  const read = (name) => JSON.parse(readFileSync(path.join(ROOT, 'editor', 'rules', name), 'utf8'));
  const rules = {
    gameplay: read('gameplay-rules.json'),
    difficulty: read('difficulty-rules.json'),
    transition: read('transition-rules.json'),
  };
  // Consistency check: the game source is authoritative for breatherBeats.
  // Inject the live value over the JSON mirror and say so once, loudly.
  if (rulesConsistencyNotes.length === 0) {
    if (tuningMirror.breatherBeats !== null && rules.gameplay.transition.breatherBeats !== tuningMirror.breatherBeats) {
      rulesConsistencyNotes.push(
        `gameplay-rules.json breatherBeats (${rules.gameplay.transition.breatherBeats}) differs from ` +
        `src/tuning.ts (${tuningMirror.breatherBeats}) -- the live game value is used. ` +
        `Update the rules JSON mirror.`
      );
    }
    for (const missing of tuningMirror.missing) {
      rulesConsistencyNotes.push(`Could not read ${missing} from src/tuning.ts -- using the rules JSON fallback.`);
    }
  }
  if (tuningMirror.breatherBeats !== null) {
    rules.gameplay.transition.breatherBeats = tuningMirror.breatherBeats;
  }
  return rules;
}

// ---- routes ------------------------------------------------------------------

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const p = url.pathname;

  try {
    // ---- static UI ----
    if (req.method === 'GET' && (p === '/' || p === '/index.html')) {
      return sendFile(res, path.join(UI_DIR, 'index.html'), 'text/html; charset=utf-8');
    }
    if (req.method === 'GET' && /^\/[a-zA-Z0-9_.\-]+$/.test(p) && existsSync(path.join(UI_DIR, p))) {
      const ext = p.split('.').pop();
      const types = { html: 'text/html', css: 'text/css', js: 'text/javascript', svg: 'image/svg+xml' };
      return sendFile(res, path.join(UI_DIR, p), types[ext] || 'application/octet-stream');
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
        levelFile: state.levelFile,
        hasDirectorContext: existsSync(DIRECTOR_OUTPUT),
        hasFullAnalysis: existsSync(V2_OUTPUT),
        tuningMirror: { ...tuningMirror, missing: [...tuningMirror.missing] },
        consistencyNotes: [...rulesConsistencyNotes],
        analysis: state.analysis
          ? {
              bpm: state.analysis.tempo.bpm,
              durationSec: state.analysis.song.durationSec,
              bars: state.analysis.bars.length,
              sections: state.analysis.sections.map((s) => ({
                id: s.id,
                startBar: s.startBar,
                endBar: s.endBar,
                meanEnergy: s.meanEnergy,
                peakEnergy: s.peakEnergy,
              })),
            }
          : null,
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
      state.blueprint = null;
      state.levelFile = null;
      // Stale analysis exports must not be downloadable against the new song.
      for (const stale of [V2_OUTPUT, LEGACY_OUTPUT, DIRECTOR_OUTPUT]) {
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

      // The director context is the headline V2.1 export; summarise it so the
      // UI can confirm what the download button will deliver.
      let directorSummary = null;
      try {
        const dc = JSON.parse(await fs.readFile(DIRECTOR_OUTPUT, 'utf8'));
        directorSummary = {
          sections: dc.sections.length,
          phrases: dc.phrases.length,
          repeat_groups: dc.repeat_groups.length,
          repeat_comparisons: dc.repeat_comparisons.length,
          important_events: dc.important_events.length,
          bars: dc.grid.bars.length,
          bar_phase_confidence: dc.grid.bar_phase_confidence,
          lyrics_available: dc.lyrics.available,
        };
      } catch {
        directorSummary = null;
      }
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

    // ---- director context (the agent-facing export, V2.1) ----
    if (req.method === 'GET' && p === '/api/director-context') {
      return sendAnalysisFile(res, DIRECTOR_OUTPUT, 'director_context.json', url.searchParams.get('download') === '1');
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
      state.blueprint = blueprint;
      return json(res, 200, { ok: true, blueprint, seed: state.seed });
    }

    // ---- save hand-edited blueprint ----
    if (req.method === 'POST' && p === '/api/blueprint') {
      const blueprint = await readJsonBody(req);
      state.blueprint = blueprint;
      await fs.writeFile(
        path.join(OUTPUT_DIR, 'level_blueprint.json'),
        JSON.stringify(blueprint, null, 2)
      );
      return json(res, 200, { ok: true });
    }

    // ---- regenerate one section ----
    if (req.method === 'POST' && p === '/api/regenerate') {
      if (!state.blueprint) return json(res, 400, { error: 'no blueprint yet' });
      if (!state.analysis) return json(res, 400, { error: 'no analysis yet' });
      const { sectionId } = await readJsonBody(req);
      const { directorMod } = await loadGeneratorModules();
      state.blueprint = directorMod.regenerateSection(state.blueprint, sectionId, loadRules(), {
        music: state.analysis,
      });
      await fs.writeFile(
        path.join(OUTPUT_DIR, 'level_blueprint.json'),
        JSON.stringify(state.blueprint, null, 2)
      );
      return json(res, 200, { ok: true, blueprint: state.blueprint });
    }

    // ---- compile level.json into the library ----
    if (req.method === 'POST' && p === '/api/generate') {
      if (!state.blueprint) return json(res, 400, { error: 'no blueprint yet' });
      const opts = await readJsonBody(req);
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

server.listen(PORT, HOST, () => {
  console.log('');
  console.log('  BeatBound Level Editor  ->  http://localhost:' + PORT);
  console.log('  Game runtime (playtest) ->  http://localhost:5173  (npm run dev)');
  console.log('');
});

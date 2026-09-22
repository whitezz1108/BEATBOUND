/**
 * Tests for the generation pipeline.
 *
 * Two things are being pinned here, and they are different in kind.
 *
 * The **unit** tests cover the parts of the pipeline that are pure decisions:
 * which audio path a level gets, what the song block says, what happens to a
 * fact the model transcribed wrong. These need no network, no key and no
 * library, so they run everywhere.
 *
 * The **golden** test runs the whole thing -- mocked model, real compiler, real
 * validators, real library -- and asserts on the artifact that comes out. It is
 * the only test that can catch a break between layers: a compiler that emits a
 * field the loader rejects, a course the runner cannot fly, a manifest that
 * claims a validation it did not run. It writes into the real
 * `beatbound_library_v1/` because that is where the runtime's loader resolves
 * level paths from, and it removes what it wrote.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  PROJECT_ROOT,
  buildManifest,
  generateLevel,
  generatorBlock,
  libraryAudioPath,
  loadArtifacts,
  registerInIndex,
  runDirector,
  seedFacts,
  songBlock,
} from '../generation/pipeline.js';
import { BLUEPRINT_V2_SCHEMA_VERSION } from '../generation/blueprint.js';
import { buildGameplayContext } from '../generation/gameplayContext.js';
import { loadRulesWithTuning } from '../generation/rules.js';

const ROOT = `${fileURLToPath(new URL('../..', import.meta.url))}`.replace(/\\/g, '/');
const LIB = `${ROOT}beatbound_library_v1`;
const INDEX = `${LIB}/levels.index.json`;
const REAL_DIRECTOR_CONTEXT = `${ROOT}editor/output/director_context_v2.json`;
const REAL_ANALYSIS = `${ROOT}editor/output/music_analysis.json`;
const HAVE_REAL_ARTIFACTS = existsSync(REAL_DIRECTOR_CONTEXT) && existsSync(REAL_ANALYSIS);

const realDirectorContext = HAVE_REAL_ARTIFACTS ? JSON.parse(readFileSync(REAL_DIRECTOR_CONTEXT, 'utf8')) : null;
const realAnalysis = HAVE_REAL_ARTIFACTS ? JSON.parse(readFileSync(REAL_ANALYSIS, 'utf8')) : null;

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/** A director context with a string meter, like the real one. */
function makeDirectorContext({ songId = 'test_song', meter = '4/4', barCount = 40, bpm = 120 } = {}) {
  return {
    schema_version: 'beatbound_director_context_v2',
    source: { song_id: songId, audio_file: `${songId}.mp3`, duration_sec: 80, source_hash: 'abc123' },
    timing: { bpm, beats_per_bar: 4, meter, bar_count: barCount },
    sections: [{ section_id: 'section_01', start_bar: 1, end_bar_exclusive: barCount + 1 }],
  };
}

function makeAnalysis({ songId = 'test_song', barCount = 40, audioPath = `/somewhere/${songId}.mp3` } = {}) {
  return {
    version: '1.0.0',
    song: { id: songId, title: 'Test Song', audioPath, durationSec: 80, sampleRate: 22050, sourceHash: 'abc123' },
    tempo: { bpm: 120, confidence: 0.9, timeSignature: [4, 4] },
    bars: Array.from({ length: barCount }, (_, i) => ({
      bar: i + 1,
      startTime: i * 2,
      endTime: (i + 1) * 2,
      energy: 0.5,
      rhythmDensity: 0.5,
      onsetCount: 4,
      beatStrength: 0.5,
      novelty: 0.5,
      rmsMean: 0.1,
      rmsPeak: 0.2,
    })),
  };
}

/** A blueprint the real validator accepts, tiling a 40-bar song. */
function makeBlueprint(dc, { cuts = [1, 11, 25, 41], modes = ['ARENA', 'RUNNER', 'ARENA'] } = {}) {
  const bars = dc.timing.bar_count;
  return {
    schema_version: BLUEPRINT_V2_SCHEMA_VERSION,
    generator: { kind: 'ai_director', model: 'mock-model', prompt_version: 'mock_v1', created_from: 'director_context_v2' },
    song: {
      id: dc.source.song_id,
      title: 'Test Song',
      audio: `${dc.source.song_id}.mp3`,
      bpm: dc.timing.bpm,
      timeSignature: [4, 4],
      barCount: bars,
      durationSec: dc.source.duration_sec,
    },
    request: { primary_mode: 'ARENA', allowed_modes: ['ARENA', 'RUNNER'], target_difficulty: 3, primary_mode_ratio: 0.5, seed: 5 },
    global: { intent: 'test', arc: 'rise', difficulty_curve: Array.from({ length: bars }, () => 3) },
    sections: cuts.slice(0, -1).map((start, i) => ({
      id: `S0${i + 1}`,
      start_bar: start,
      end_bar_exclusive: cuts[i + 1],
      mode: modes[i] ?? 'ARENA',
      function: i === 0 ? 'INTRO' : 'PEAK',
      difficulty: 3,
      intensity: 0.5,
      rationale: 'test',
    })),
  };
}

/** A fake LLM client whose answer is a fixed string. */
function fakeClient(text, { model = 'mock-model' } = {}) {
  const calls = [];
  return {
    calls,
    complete: async (opts) => {
      calls.push(opts);
      const body = typeof text === 'function' ? text(opts, calls.length) : text;
      return { text: body, usage: { total_tokens: 100 }, model, attempts: 1, latencyMs: 1, finishReason: 'stop' };
    },
  };
}

// ---------------------------------------------------------------------------
// libraryAudioPath -- level.song.audio must be resolvable by the runtime
// ---------------------------------------------------------------------------

test('an absolute path inside the library becomes library-relative', () => {
  const analysis = { song: { audioPath: `${LIB}/audio/editor/song.mp3` } };
  assert.equal(libraryAudioPath(analysis, { libraryDir: LIB }), 'audio/editor/song.mp3');
});

test('a Windows absolute path is normalised, not left with backslashes', () => {
  const analysis = { song: { audioPath: 'C:\\Users\\x\\BB\\beatbound_library_v1\\audio\\editor\\song.mp3' } };
  assert.equal(libraryAudioPath(analysis, { libraryDir: 'C:\\Users\\x\\BB\\beatbound_library_v1' }), 'audio/editor/song.mp3');
});

test('an already-relative path is passed through without a leading slash', () => {
  assert.equal(libraryAudioPath({ song: { audioPath: 'audio/editor/song.mp3' } }), 'audio/editor/song.mp3');
  assert.equal(libraryAudioPath({ song: { audioPath: '/audio/editor/song.mp3' } }), 'audio/editor/song.mp3');
});

test('audio outside the library falls back to the editor upload directory', () => {
  // The runtime resolves `song.audio` against the library root, so a path that
  // escapes it can never be served. The basename is the best available guess.
  const analysis = { song: { audioPath: 'D:/music/song.mp3' } };
  assert.equal(libraryAudioPath(analysis, { libraryDir: LIB }), 'audio/editor/song.mp3');
});

test('a missing audio path is null rather than an empty string', () => {
  assert.equal(libraryAudioPath({ song: {} }), null);
  assert.equal(libraryAudioPath(null), null);
});

// ---------------------------------------------------------------------------
// songBlock -- the facts the pipeline owns
// ---------------------------------------------------------------------------

test('the song block is read from the director context, not from the model', () => {
  const dc = makeDirectorContext({ songId: 'x', barCount: 40, bpm: 128 });
  const block = songBlock({ directorContext: dc, analysis: makeAnalysis({ songId: 'x', barCount: 40 }), libraryDir: LIB });
  assert.equal(block.id, 'x');
  assert.equal(block.bpm, 128);
  assert.deepEqual(block.timeSignature, [4, 4]);
  assert.equal(block.barCount, 40);
  assert.equal(block.durationSec, 80);
});

test('a string meter is parsed and an array meter is accepted', () => {
  const analysis = makeAnalysis({});
  const asString = songBlock({ directorContext: makeDirectorContext({ meter: '3/4' }), analysis });
  assert.deepEqual(asString.timeSignature, [3, 4], 'the real director context carries "4/4" as a string');
  const asArray = songBlock({ directorContext: makeDirectorContext({ meter: [6, 8] }), analysis });
  assert.deepEqual(asArray.timeSignature, [6, 8], 'hand-built contexts use the array form');
});

test('a level id names the level while the audio stays the analysed song', () => {
  // This is the variant case the library already ships: one arrangement of a
  // song, named for the arrangement.
  const dc = makeDirectorContext({ songId: 'the_song' });
  const block = songBlock({
    directorContext: dc,
    analysis: makeAnalysis({ songId: 'the_song', audioPath: `${LIB}/audio/editor/the_song.mp3` }),
    libraryDir: LIB,
    levelId: 'the_song_arena_primary',
  });
  assert.equal(block.id, 'the_song_arena_primary');
  assert.equal(block.audio, 'audio/editor/the_song.mp3');
});

// ---------------------------------------------------------------------------
// generatorBlock / seedFacts -- provenance and fact correction
// ---------------------------------------------------------------------------

test('generator provenance distinguishes "known empty" from "no opinion"', () => {
  // A model ran: the run knows the kind, the model and the prompt version.
  assert.deepEqual(generatorBlock({ kind: 'ai_director', model: 'm', promptVersion: 'p', existing: {} }), {
    kind: 'ai_director',
    model: 'm',
    prompt_version: 'p',
    created_from: 'director_context_v2',
  });

  // A non-AI plan: null is a statement, not a gap.
  assert.equal(generatorBlock({ kind: 'rule_based', model: null, promptVersion: null, existing: {} }).model, null);

  // No opinion: the artifact's own declaration survives. This is what keeps a
  // replayed AI blueprint from being relabelled `manual`.
  const replayed = generatorBlock({ existing: { kind: 'ai_director', model: 'm', prompt_version: 'p' } });
  assert.equal(replayed.kind, 'ai_director');
  assert.equal(replayed.model, 'm');
  assert.equal(replayed.prompt_version, 'p');

  // Nothing declared and no opinion: the honest answer is "a person wrote it".
  assert.equal(generatorBlock({ existing: {} }).kind, 'manual');
  // An unrecognised kind is not passed through.
  assert.equal(generatorBlock({ kind: 'wizard', existing: {} }).kind, 'ai_director');
});

test('seedFacts replaces the song block and records what it replaced', () => {
  const dc = makeDirectorContext({ songId: 'x', barCount: 40, bpm: 128 });
  const analysis = makeAnalysis({ songId: 'x', barCount: 40, audioPath: `${LIB}/audio/editor/x.mp3` });
  const blueprint = makeBlueprint(dc);
  blueprint.song = { id: 'WRONG', title: 'wrong', audio: 'nope.mp3', bpm: 1, timeSignature: [7, 8], barCount: 2, durationSec: 3 };

  const corrections = seedFacts(blueprint, { directorContext: dc, analysis, libraryDir: LIB, kind: 'ai_director', model: 'm', promptVersion: 'p' });

  assert.equal(blueprint.song.id, 'x');
  assert.equal(blueprint.song.bpm, 128);
  assert.equal(blueprint.song.audio, 'audio/editor/x.mp3');
  assert.equal(blueprint.song.barCount, 40);
  const songCorrections = corrections.filter((c) => c.startsWith('song.'));
  assert.equal(songCorrections.length, 7, `every song field was wrong: ${corrections.join(' | ')}`);
  assert.ok(songCorrections.some((c) => c.startsWith('song.bpm: 1 -> 128')));
  // The run also records what it knows about provenance, and says so.
  assert.ok(corrections.some((c) => c.startsWith('generator.model:')));
  assert.equal(blueprint.generator.kind, 'ai_director');
  assert.equal(blueprint.generator.model, 'm');
});

test('seedFacts leaves the sections exactly as the director wrote them', () => {
  // The song block is fact; the sections are direction. Only one of the two is
  // the pipeline's to overwrite.
  const dc = makeDirectorContext({});
  const blueprint = makeBlueprint(dc);
  const before = JSON.parse(JSON.stringify(blueprint.sections));
  seedFacts(blueprint, { directorContext: dc, analysis: makeAnalysis({}), libraryDir: LIB, kind: 'ai_director', model: 'm', promptVersion: 'p' });
  assert.deepEqual(blueprint.sections, before);
});

// ---------------------------------------------------------------------------
// runDirector -- prompting and parsing
// ---------------------------------------------------------------------------

test('the director prompt is fully rendered before it is sent', async () => {
  const dc = makeDirectorContext({});
  const client = fakeClient(JSON.stringify(makeBlueprint(dc)));
  await runDirector({
    client,
    directorContext: dc,
    gameplayContext: { modes: [], allowed_modes: ['ARENA', 'RUNNER'], primary_mode: 'ARENA', transitions: [], cross_mode_warnings: [], global_contract: {} },
    request: { primary_mode: 'ARENA', allowed_modes: ['ARENA', 'RUNNER'], target_difficulty: 3, primary_mode_ratio: 0.5, seed: 5 },
    tuning: { breatherBeats: 6, countdownSeconds: 3, sceneBeats: 2 },
    analysis: makeAnalysis({}),
  });
  const sent = client.calls[0].messages[0].content;
  assert.ok(!/\{\{[A-Z0-9_]+\}\}/.test(sent), 'no placeholder may survive into the prompt');
  assert.ok(sent.includes('"bpm": 120'), 'the director context is embedded');
  assert.ok(sent.includes('ARENA'), 'the request is embedded');
  assert.equal(client.calls[0].json, true, 'a JSON response is requested');
});

test('a fenced JSON answer is parsed, and a non-object answer is refused', async () => {
  const dc = makeDirectorContext({});
  const args = {
    directorContext: dc,
    gameplayContext: { modes: [], allowed_modes: ['ARENA'], primary_mode: 'ARENA', transitions: [], cross_mode_warnings: [], global_contract: {} },
    request: { primary_mode: 'ARENA', allowed_modes: ['ARENA'], target_difficulty: 3, primary_mode_ratio: 1, seed: 5 },
    tuning: { breatherBeats: 6, countdownSeconds: 3, sceneBeats: 2 },
    analysis: makeAnalysis({}),
  };

  const fenced = await runDirector({ ...args, client: fakeClient('Here is the plan:\n```json\n{"schema_version":"x"}\n```') });
  assert.equal(fenced.blueprint.schema_version, 'x');

  await assert.rejects(
    () => runDirector({ ...args, client: fakeClient('I am unable to help with that.') }),
    /did not return a JSON object/,
  );
});

// ---------------------------------------------------------------------------
// loadArtifacts
// ---------------------------------------------------------------------------

test('missing artifacts are named rather than silently null', () => {
  const { analysis, directorContext, missing } = loadArtifacts({ outputDir: path.join(ROOT, 'editor', 'no_such_dir') });
  assert.equal(analysis, null);
  assert.equal(directorContext, null);
  assert.equal(missing.length, 2);
  assert.ok(missing.every((m) => m.includes('no_such_dir')));
});

test('the real artifacts load', { skip: !HAVE_REAL_ARTIFACTS }, () => {
  const { analysis, directorContext, tuning, notes } = loadArtifacts({});
  assert.ok(analysis.bars.length > 0, 'the v1 projection has the bar grid the compiler needs');
  assert.ok(directorContext.timing.bar_count > 0);
  assert.equal(tuning.breatherBeats, 6);
  assert.deepEqual(notes, []);
});

// ---------------------------------------------------------------------------
// buildManifest
// ---------------------------------------------------------------------------

test('the manifest never carries a secret', () => {
  const manifest = buildManifest({
    levelId: 'x',
    songId: 'x',
    levelFile: 'x.level.json',
    ok: true,
    request: { primary_mode: 'ARENA', allowed_modes: ['ARENA'], target_difficulty: 3, primary_mode_ratio: 1, seed: 1 },
    llm: { provider: 'deepseek', baseUrl: 'https://api.deepseek.com/v1', model: 'm', apiKeyPresent: true, apiKeyMask: '********abcd', configured: true, problems: [] },
    tuning: {},
    rulesNotes: [],
    structural: null,
    runtimeRepair: { attempted: false, passes: 0, history: [] },
    compileWarnings: [],
    corrections: [],
    meta: {},
    validation: null,
    level: null,
  });
  const text = JSON.stringify(manifest);
  assert.ok(text.includes('********abcd'), 'the mask is recorded');
  assert.ok(!/\bsk-[A-Za-z0-9]{8,}/.test(text), 'no key-shaped string anywhere in the manifest');
  assert.equal(manifest.llm.apiKeyMask, '********abcd');
});

// ---------------------------------------------------------------------------
// registerInIndex
// ---------------------------------------------------------------------------

test('registering a level rewrites the index without reformatting it', async () => {
  // The index is a file the user also edits by hand, so a generation must not
  // produce a diff made only of whitespace. `JSON.stringify` drops the trailing
  // newline the file is stored with, which is exactly that diff.
  const dir = path.join(ROOT, 'editor', 'tests', '_tmp_index');
  const original = readFileSync(INDEX, 'utf8');
  try {
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, 'levels.index.json'), original);
    // Awaited inside the try: the cleanup below must not run while the write is
    // still in flight.
    await registerInIndex({ id: 'probe', file: 'probe.level.json', title: 'probe', blurb: 'probe' }, { libraryDir: dir });

    const after = readFileSync(path.join(dir, 'levels.index.json'), 'utf8');
    assert.ok(after.endsWith('}\n'), 'the trailing newline survives');
    assert.equal(JSON.parse(after).levels.at(-1).file, 'probe.level.json');
    // Everything the entry was appended to is byte-identical, so the diff a
    // generation produces is the entry itself and nothing else.
    const beforeEntriesEnd = original.slice(0, original.lastIndexOf('\n  ]'));
    assert.ok(after.startsWith(beforeEntriesEnd), 'the existing entries are untouched, byte for byte');
    assert.ok(after.includes('    {\n      "id": "probe"'), 'the new entry is formatted like its neighbours');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// The golden run: mocked model, real compiler, real validators, real library
// ---------------------------------------------------------------------------

/**
 * Generate one level through every layer and clean up after it.
 *
 * The library is shared with the user's own work, so the probe is careful: it
 * saves the index, restores it byte for byte, and removes the level it wrote.
 * Nothing it leaves behind can be mistaken for the user's.
 */
async function goldenRun({ levelId, blueprint, client, onEvent } = {}) {
  const indexBackup = readFileSync(INDEX, 'utf8');
  const levelPath = `${LIB}/${levelId}.level.json`;
  const manifestPath = `${ROOT}editor/output/${levelId}.generation.json`;
  const preexisting = existsSync(levelPath);
  try {
    return await generateLevel({ levelId, blueprint, client, courses: true, onEvent });
  } finally {
    if (!preexisting && existsSync(levelPath)) unlinkSync(levelPath);
    // Restore the index, minus any probe entry a crashed earlier run may have
    // left in it. `runner-check` reads the whole index, so a stale entry for a
    // deleted file would show up in every later run's course report -- noise
    // from a previous failure, not a verdict on this one.
    const index = JSON.parse(indexBackup);
    index.levels = index.levels.filter((l) => !l.file.startsWith('_probe'));
    writeFileSync(INDEX, `${JSON.stringify(index, null, 2)}\n`);
    if (existsSync(manifestPath)) unlinkSync(manifestPath);
  }
}

test('golden: a mocked director produces a level the real loaders accept', { skip: !HAVE_REAL_ARTIFACTS }, async () => {
  const levelId = '_probe_golden_director';
  const dc = realDirectorContext;
  const bars = dc.timing.bar_count;

  // A plan with two modes and a RUNNER course, so the course checker has
  // something to fly and the mode change has a breather to respect.
  const cut = Math.floor(bars / 2);
  const blueprint = {
    schema_version: BLUEPRINT_V2_SCHEMA_VERSION,
    // Deliberately wrong in every song field: the pipeline must correct them,
    // and the level must still validate.
    generator: { kind: 'ai_director', model: 'mock-model', prompt_version: 'mock_v1', created_from: 'director_context_v2' },
    song: { id: 'WRONG', title: 'wrong', audio: 'wrong.mp3', bpm: 1, timeSignature: [3, 4], barCount: 1, durationSec: 1 },
    request: { primary_mode: 'ARENA', allowed_modes: ['ARENA', 'RUNNER'], target_difficulty: 3, primary_mode_ratio: 0.5, seed: 99 },
    global: { intent: 'golden', arc: 'rise', difficulty_curve: Array.from({ length: bars }, () => 3) },
    sections: [
      {
        id: 'S01', start_bar: 1, end_bar_exclusive: cut, mode: 'RUNNER', function: 'INTRO', difficulty: 2,
        intensity: 0.4, rationale: 'golden', course: { phraseBeats: 4, seed: 99, phrases: [], generate: { beats: (cut - 1) * 4, seed: 99, intensity: 0.5 } },
      },
      { id: 'S02', start_bar: cut, end_bar_exclusive: bars + 1, mode: 'ARENA', function: 'PEAK', difficulty: 4, intensity: 0.8, rationale: 'golden' },
    ],
  };

  const result = await goldenRun({ levelId, blueprint });

  assert.equal(result.ok, true, `expected a valid level, got:\n${result.manifest.validation.summary}`);
  assert.equal(result.levelFile, `${levelId}.level.json`);

  // The song facts are the analysis's, not the model's.
  assert.equal(result.level.song.id, levelId, 'song.id is the level id');
  assert.equal(result.level.song.bpm, dc.timing.bpm);
  assert.deepEqual(result.level.song.timeSignature, [4, 4]);
  assert.ok(result.level.song.audio.startsWith('audio/'), 'the audio path is library-relative');
  assert.ok(!result.level.song.audio.includes(':'), 'no absolute path leaked into the level');
  assert.equal(result.manifest.fact_corrections.length, 7);

  // It really was validated, by the real loader.
  assert.equal(result.validation.level.ok, true);
  assert.ok(result.validation.level.mechanics.length > 0, 'the loader resolved mechanics');
  assert.equal(result.validation.courses.ok, true, 'the RUNNER course flew');
  assert.ok(result.validation.courses.mine.length > 0, 'the candidate was in the index and was checked');
  assert.ok(result.validation.courses.mine.every((l) => l.ok), 'and it flew cleanly');
  // The candidate-scoped verdict is what the manifest reports; the library-wide
  // one is kept alongside it so a broken neighbour is visible without being
  // blamed on this generation.
  assert.equal(result.manifest.validation.courses.ok, true);
  assert.equal(typeof result.manifest.validation.courses.library_ok, 'boolean');

  // The tiling and the breather are the runtime's, not the model's.
  const [s1, s2] = result.level.sections;
  assert.equal(s1.startBar, 1);
  assert.equal(s1.lengthBars + s2.lengthBars, bars, 'the sections tile the whole song');
  assert.equal(s2.startBar, s1.lengthBars + 1);
  assert.equal(s2.transitionOut, null, 'the last section hands off to nothing');
  assert.equal(s2.breatherFromBeat, undefined, 'and a last section has nothing to breathe for');
  // S01 changes mode, so it owns the breather. `breatherFromBeat` is 0-based and
  // absolute, and the section ends at `cut * 4` exclusive -- so the distance to
  // the end of the section is the breather itself. At 129.2 BPM the countdown
  // is 6.46 beats, and the runtime uses 6; a fractional value here would mean
  // the compiler had stopped mirroring `beatsForSeconds`.
  assert.ok(Number.isInteger(s1.breatherFromBeat), `the breather must be whole beats, got ${s1.breatherFromBeat}`);
  const s1EndBeat = (s1.startBar - 1 + s1.lengthBars) * 4;
  assert.equal(s1EndBeat - s1.breatherFromBeat, 6, 'the breather is 6 beats at this tempo');

  // The manifest says what ran.
  assert.equal(result.manifest.level_id, levelId);
  assert.equal(result.manifest.song_id, dc.source.song_id);
  assert.equal(result.manifest.published, true);
  assert.equal(result.manifest.validation.ok, true);
  assert.equal(result.manifest.blueprint.structural_ok, true);
  assert.equal(result.manifest.llm.used, false, 'no model was called -- a blueprint was supplied');
});

test('golden: the same seed compiles to the same level twice', { skip: !HAVE_REAL_ARTIFACTS }, async () => {
  const levelId = '_probe_golden_determinism';
  const dc = realDirectorContext;
  const bars = dc.timing.bar_count;
  const blueprint = {
    schema_version: BLUEPRINT_V2_SCHEMA_VERSION,
    generator: { kind: 'ai_director', model: 'mock-model', prompt_version: 'mock_v1', created_from: 'director_context_v2' },
    song: { id: dc.source.song_id, title: 'x', audio: `${dc.source.song_id}.mp3`, bpm: dc.timing.bpm, timeSignature: [4, 4], barCount: bars, durationSec: dc.source.duration_sec },
    request: { primary_mode: 'ARENA', allowed_modes: ['ARENA'], target_difficulty: 3, primary_mode_ratio: 1, seed: 4242 },
    global: { intent: 'determinism', arc: 'flat', difficulty_curve: Array.from({ length: bars }, () => 3) },
    sections: [{ id: 'S01', start_bar: 1, end_bar_exclusive: bars + 1, mode: 'ARENA', function: 'PEAK', difficulty: 3, intensity: 0.5, rationale: 'x' }],
  };

  const first = await goldenRun({ levelId, blueprint: JSON.parse(JSON.stringify(blueprint)) });
  const second = await goldenRun({ levelId, blueprint: JSON.parse(JSON.stringify(blueprint)) });
  assert.equal(JSON.stringify(first.level), JSON.stringify(second.level), 'the same ask must produce the same level');
});

test('every streamed event spells `errors` as a list, never a count', { skip: !HAVE_REAL_ARTIFACTS }, async () => {
  // The editor panel renders each event with `for (const err of ev.errors)`.
  // `repairBlueprint` reports progress with *counts* -- its `score()` helper
  // returns `{errors: number, warnings: number}` -- and the pipeline used to
  // spread those straight onto the event. `0 ?? []` is still `0`, so the very
  // first repair event of every run threw "number 0 is not iterable" inside
  // the panel's try block and the whole generation was reported as failed,
  // after it had in fact compiled, published and validated. The counts are
  // namespaced now; this pins the contract so a future spread cannot put a
  // number back under the name the panel iterates.
  const levelId = '_probe_event_contract';
  const dc = realDirectorContext;
  const bars = dc.timing.bar_count;
  const blueprint = {
    schema_version: BLUEPRINT_V2_SCHEMA_VERSION,
    generator: { kind: 'ai_director', model: 'mock-model', prompt_version: 'mock_v1', created_from: 'director_context_v2' },
    song: { id: dc.source.song_id, title: 'x', audio: `${dc.source.song_id}.mp3`, bpm: dc.timing.bpm, timeSignature: [4, 4], barCount: bars, durationSec: dc.source.duration_sec },
    request: { primary_mode: 'ARENA', allowed_modes: ['ARENA', 'RUNNER'], target_difficulty: 3, primary_mode_ratio: 0.5, seed: 7 },
    global: { intent: 'contract', arc: 'rise', difficulty_curve: Array.from({ length: bars }, () => 3) },
    sections: [
      { id: 'S01', start_bar: 1, end_bar_exclusive: Math.floor(bars / 2), mode: 'ARENA', function: 'INTRO', difficulty: 2, intensity: 0.4, rationale: 'x' },
      { id: 'S02', start_bar: Math.floor(bars / 2), end_bar_exclusive: bars + 1, mode: 'RUNNER', function: 'PEAK', difficulty: 4, intensity: 0.8, rationale: 'x' },
    ],
  };

  const events = [];
  await goldenRun({ levelId, blueprint, onEvent: (e) => events.push(e) });

  assert.ok(events.length > 0, 'the pipeline emitted no events at all');
  for (const e of events) {
    for (const field of ['errors', 'warnings']) {
      const v = e[field];
      assert.ok(
        v === undefined || Array.isArray(v),
        `event "${e.stage}" carries \`${field}\` as ${typeof v} (${JSON.stringify(v)}) -- ` +
          `the panel iterates that field as a list`,
      );
    }
    // The counts are still reported, just under a name nothing iterates.
    if (e.errorCount !== undefined) {
      assert.equal(typeof e.errorCount, 'number', `event "${e.stage}" errorCount must be a number`);
    }
  }

  // Checked last, so a regression reports the violation above rather than this.
  // The repair progress events carry the sub-stage as their `stage` -- the
  // pipeline spreads the repair event after `stage: 'repair'`, so `director`
  // and `normalize` win -- so `errorCount` is the marker that the path which
  // used to throw actually ran.
  assert.ok(
    events.some((e) => e.errorCount !== undefined),
    'no repair progress event was emitted, so this test would not have caught the bug it exists for',
  );
});

test('golden: a blueprint the validator rejects is never published', { skip: !HAVE_REAL_ARTIFACTS }, async () => {
  const levelId = '_probe_golden_rejected';
  const dc = realDirectorContext;
  const bars = dc.timing.bar_count;
  const blueprint = {
    schema_version: BLUEPRINT_V2_SCHEMA_VERSION,
    // An origin the pipeline cannot record honestly is exactly the kind of
    // defect normalization must not invent its way out of.
    generator: { kind: 'wizard', model: null, prompt_version: null, created_from: 'director_context_v2' },
    song: { id: dc.source.song_id, title: 'x', audio: `${dc.source.song_id}.mp3`, bpm: dc.timing.bpm, timeSignature: [4, 4], barCount: bars, durationSec: dc.source.duration_sec },
    request: { primary_mode: 'ARENA', allowed_modes: ['ARENA'], target_difficulty: 3, primary_mode_ratio: 1, seed: 1 },
    global: { intent: 'x', arc: 'x', difficulty_curve: Array.from({ length: bars }, () => 3) },
    sections: [{ id: 'S01', start_bar: 1, end_bar_exclusive: bars + 1, mode: 'ARENA', function: 'PEAK', difficulty: 3, intensity: 0.5, rationale: 'x' }],
  };

  // `kind: 'wizard'` is rewritten by the pipeline's own provenance seeding, so
  // break something it will not touch: an intent that is not a string.
  blueprint.global.intent = 42;

  const result = await goldenRun({ levelId, blueprint });
  assert.equal(result.ok, false);
  assert.equal(result.levelFile, null, 'nothing was published');
  assert.equal(existsSync(`${LIB}/${levelId}.level.json`), false, 'and nothing was left on disk');
  assert.ok(result.manifest.blueprint.structural_errors.length > 0, 'the reason is recorded');
  assert.equal(result.manifest.published, false);
});

test('golden: a run with no key and no blueprint fails before spending a request', { skip: !HAVE_REAL_ARTIFACTS }, async () => {
  await assert.rejects(
    () => generateLevel({ levelId: '_probe_no_key', config: { configured: false, apiKey: null, model: 'm', problems: [] } }),
    /no LLM API key configured/,
  );
});

test('golden: a dry run writes nothing at all', { skip: !HAVE_REAL_ARTIFACTS }, async () => {
  const levelId = '_probe_dry_run';
  const dc = realDirectorContext;
  const bars = dc.timing.bar_count;
  const blueprint = {
    schema_version: BLUEPRINT_V2_SCHEMA_VERSION,
    generator: { kind: 'ai_director', model: null, prompt_version: null, created_from: 'director_context_v2' },
    song: { id: dc.source.song_id, title: 'x', audio: `${dc.source.song_id}.mp3`, bpm: dc.timing.bpm, timeSignature: [4, 4], barCount: bars, durationSec: dc.source.duration_sec },
    request: { primary_mode: 'ARENA', allowed_modes: ['ARENA'], target_difficulty: 3, primary_mode_ratio: 1, seed: 1 },
    global: { intent: 'x', arc: 'x', difficulty_curve: Array.from({ length: bars }, () => 3) },
    sections: [{ id: 'S01', start_bar: 1, end_bar_exclusive: bars + 1, mode: 'ARENA', function: 'PEAK', difficulty: 3, intensity: 0.5, rationale: 'x' }],
  };

  const indexBackup = readFileSync(INDEX, 'utf8');
  try {
    const result = await generateLevel({ levelId, blueprint, dryRun: true, courses: false });
    assert.equal(existsSync(`${LIB}/${levelId}.level.json`), false, 'no level was written');
    assert.equal(existsSync(`${ROOT}editor/output/${levelId}.generation.json`), false, 'no manifest was written');
    assert.equal(readFileSync(INDEX, 'utf8'), indexBackup, 'the index was not touched');
    assert.equal(result.manifest.validation.ok, null, 'a dry run does not claim a validation it did not run');
    assert.match(result.manifest.validation.reason, /dry run/);
    assert.ok(result.level.sections.length > 0, 'but it did compile');
  } finally {
    writeFileSync(INDEX, indexBackup);
  }
});

// ---------------------------------------------------------------------------
// The pipeline's shape
// ---------------------------------------------------------------------------

test('generateLevel reports the wiring mistake instead of guessing at a song', { skip: !HAVE_REAL_ARTIFACTS }, async () => {
  await assert.rejects(
    () => generateLevel({ outputDir: path.join(ROOT, 'editor', 'no_such_dir'), blueprint: {} }),
    /these are missing/,
  );
});

test('the real gameplay context is what the pipeline validates against', { skip: !HAVE_REAL_ARTIFACTS }, () => {
  // A stub context would let the pipeline pass on a shape production never
  // builds; build the real one so a capability the catalog does not have fails
  // here rather than in the editor.
  const ctx = buildGameplayContext({ allowedModes: ['ARENA', 'RUNNER'], primaryMode: 'ARENA' });
  assert.deepEqual(ctx.allowed_modes, ['ARENA', 'RUNNER']);
  assert.ok(ctx.modes.length >= 2);
  assert.ok(ctx.modes.every((m) => typeof m.mode === 'string'));
  const { tuning, notes } = loadRulesWithTuning({});
  assert.equal(tuning.breatherBeats, 6);
  assert.deepEqual(notes, []);
});

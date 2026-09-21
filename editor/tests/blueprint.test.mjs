/**
 * Blueprint V2 -- validator and normalizer.
 *
 * The property these tests exist to protect: **normalize then validate is
 * clean**. A director (especially an AI one) will emit blueprints that are
 * plausible but wrong -- bars past the end of the song, a mode it was never
 * offered, a pattern from another mode. The pipeline must never let those
 * reach the compiler, and must never silently pass them either. So every
 * repairable mutation is checked twice: the validator catches it, and the
 * normalizer fixes it into something that validates with zero errors.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { loadPatternIndex } from '../generator/patternIndex.js';
import { buildGameplayContext } from '../generation/gameplayContext.js';
import {
  BLUEPRINT_V2_SCHEMA_VERSION,
  breatherBeats,
  beatsForSeconds,
  beatsPerBarOf,
  validateBlueprint,
  normalizeBlueprint,
} from '../generation/blueprint.js';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const REAL_DIRECTOR_CONTEXT = `${ROOT}editor/output/director_context_v2.json`;

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/**
 * A synthetic director context: 40 bars at 120 BPM in 4/4, three sections
 * tiling the song, and a handful of anchors including one at a section seam.
 * Deliberately hand-built so these tests do not depend on any generated file.
 */
function makeDirectorContext({
  barCount = 40,
  bpm = 120,
  beatsPerBar = 4,
  tiles = [[1, 17], [17, 33], [33, 41]],
  anchors = [
    { bar: 17, type: 'section_boundary' },
    { bar: 33, type: 'section_boundary' },
    { bar: 8, type: 'energy_peak' },
    { bar: 24, type: 'vocal_entry' },
  ],
} = {}) {
  return {
    source: { song_id: 'test_song', audio_file: 'test_song.wav', duration_sec: 80 },
    timing: { bpm, beats_per_bar: beatsPerBar, meter: [beatsPerBar, 4], bar_count: barCount },
    sections: tiles.map(([start, end], i) => ({
      section_id: `section_${String(i + 1).padStart(2, '0')}`,
      start_bar: start,
      end_bar_exclusive: end,
    })),
    anchors,
  };
}

/** A blueprint matching `makeDirectorContext()`'s default shape. */
function makeBlueprint(dc, overrides = {}) {
  const beatsPerBar = dc.timing.beats_per_bar;
  return {
    schema_version: BLUEPRINT_V2_SCHEMA_VERSION,
    generator: { kind: 'rule_based', model: null, prompt_version: 'test', created_from: 'test' },
    song: {
      id: dc.source.song_id,
      title: 'Test Song',
      audio: dc.source.audio_file,
      bpm: dc.timing.bpm,
      timeSignature: [beatsPerBar, 4],
      barCount: dc.timing.bar_count,
      durationSec: dc.source.duration_sec,
    },
    request: {
      primary_mode: 'ARENA',
      allowed_modes: ['ARENA', 'RUNNER'],
      target_difficulty: 3,
      primary_mode_ratio: 0.5,
      seed: 7,
    },
    global: {
      intent: 'test',
      arc: 'rise',
      difficulty_curve: Array.from({ length: dc.timing.bar_count }, () => 3),
    },
    sections: dc.sections.map((s, i) => ({
      id: s.section_id,
      start_bar: s.start_bar,
      end_bar_exclusive: s.end_bar_exclusive,
      mode: i === 0 ? 'ARENA' : 'RUNNER',
      function: i === 0 ? 'INTRO' : 'PEAK',
      difficulty: 3,
      intensity: 0.5,
      rationale: 'test',
      pattern_families: [],
      pattern_ids: [],
      energy_band: 'MID',
      course: i === 1 ? { phraseBeats: 4, seed: 7, phrases: [], generate: { beats: 64, seed: 7, intensity: 0.6 } } : null,
      transition_out: null,
    })),
    sync_points: [],
    notes: [],
    ...overrides,
  };
}

const patternIndex = loadPatternIndex({ projectRoot: ROOT });
const gameplayContext = buildGameplayContext({
  projectRoot: ROOT,
  allowedModes: ['ARENA', 'RUNNER'],
  primaryMode: 'ARENA',
});

function check(bp, dc) {
  return validateBlueprint(bp, { directorContext: dc, gameplayContext, patternIndex });
}

function fix(bp, dc) {
  return normalizeBlueprint(bp, { directorContext: dc, gameplayContext, patternIndex });
}

/** Apply `mutate`, then assert the validator catches it and normalize repairs it. */
function assertRepaired(name, mutate, dc = makeDirectorContext(), { repaired = true } = {}) {
  const bp = makeBlueprint(dc);
  mutate(bp);

  const before = check(bp, dc);
  assert.ok(
    before.errors.length + before.warnings.length > 0,
    `${name}: the validator reported nothing for a broken blueprint`,
  );

  const { blueprint, fixes } = fix(bp, dc);
  const after = check(blueprint, dc);

  if (repaired) {
    assert.equal(after.errors.length, 0, `${name}: still invalid after normalize -- ${after.errors.join('; ')}`);
    assert.ok(fixes.length > 0, `${name}: normalize claimed to repair but recorded no fix`);
  }
  return { before, after, fixes, blueprint };
}

// ---------------------------------------------------------------------------
// breatherBeats / beatsPerBarOf
// ---------------------------------------------------------------------------

test('breatherBeats honours the floor at low BPM', () => {
  // 3 s of countdown at 60 BPM is 3 beats, below the 6-beat floor.
  assert.equal(breatherBeats(60), 6);
  assert.equal(breatherBeats(60, { breatherBeats: 6, countdownSeconds: 3 }), 6);
});

test('breatherBeats honours the countdown at high BPM', () => {
  // 3 s at 160 BPM is 8 beats, above the floor.
  assert.equal(breatherBeats(160), 8);
});

test('breatherBeats is overridable by tuning', () => {
  assert.equal(breatherBeats(160, { breatherBeats: 6, countdownSeconds: 2 }), 6);
});

test('breatherBeats rounds exactly like the runtime', () => {
  // The runtime is
  //   Math.max(TUNING.transition.breatherBeats,
  //            beatsForSeconds(bpm, TUNING.transition.countdownSeconds))
  // with beatsForSeconds = max(1, round(seconds * bpm / 60))  (src/tuning.ts).
  // The rounding is load-bearing: at 129.2 BPM (the real director context) the
  // countdown is 6.46 beats and the engine uses 6. If this ever returns 6.46
  // the validator starts rejecting mode changes the engine plays happily.
  const runtimeBreather = (bpm, floor = 6, seconds = 3) =>
    Math.max(floor, Math.max(1, Math.round((seconds * bpm) / 60)));

  for (const bpm of [60, 90, 100, 119, 120, 129.2, 140, 160, 174, 200]) {
    assert.equal(breatherBeats(bpm), runtimeBreather(bpm), `bpm=${bpm}`);
    assert.ok(Number.isInteger(breatherBeats(bpm)), `bpm=${bpm} must be whole beats`);
  }
  assert.equal(breatherBeats(129.2), 6, 'the real song: 6.46 rounds down to 6');
  assert.equal(beatsForSeconds(129.2, 3), 6);
  assert.equal(beatsForSeconds(1, 3), 1, 'never below one beat');
});

test('beatsPerBarOf prefers the analysis meter over the declared signature', () => {
  const dc = makeDirectorContext({ beatsPerBar: 3, meter: undefined, tiles: [[1, 41]] });
  dc.timing.meter = [3, 4];
  const bp = makeBlueprint(dc);
  bp.song.timeSignature = [4, 4]; // the director got it wrong
  assert.equal(beatsPerBarOf(dc, bp), 3, 'the music is 3/4, not the declared 4/4');
});

test('a wrong declared meter is a warning, not an error', () => {
  const dc = makeDirectorContext();
  const bp = makeBlueprint(dc);
  bp.song.timeSignature = [3, 4];
  const { errors, warnings } = check(bp, dc);
  assert.equal(errors.length, 0);
  assert.ok(warnings.some((w) => w.includes('disagrees with the analysis meter')));
});

// ---------------------------------------------------------------------------
// The clean path
// ---------------------------------------------------------------------------

test('a well-formed blueprint validates with no errors and no warnings', () => {
  const dc = makeDirectorContext();
  const { errors, warnings } = check(makeBlueprint(dc), dc);
  assert.deepEqual(errors, []);
  assert.deepEqual(warnings, []);
});

test('a clean blueprint needs no normalization', () => {
  const dc = makeDirectorContext();
  const { fixes } = fix(makeBlueprint(dc), dc);
  assert.deepEqual(fixes, []);
});

test('normalize is idempotent', () => {
  const dc = makeDirectorContext();
  const bp = makeBlueprint(dc);
  bp.sections[1].difficulty = 9;
  bp.sections[0].intensity = -1;
  const once = fix(bp, dc).blueprint;
  const twice = fix(once, dc);
  assert.deepEqual(twice.fixes, [], 'a second pass changed something the first pass should have settled');
});

// ---------------------------------------------------------------------------
// Structural failures
// ---------------------------------------------------------------------------

test('a non-object blueprint is rejected without throwing', () => {
  assert.deepEqual(validateBlueprint(null, { directorContext: makeDirectorContext(), gameplayContext, patternIndex }).errors, [
    'blueprint is not an object',
  ]);
});

test('the wrong schema_version is rejected', () => {
  const dc = makeDirectorContext();
  const bp = makeBlueprint(dc);
  bp.schema_version = 'beatbound_level_blueprint_v1';
  assert.ok(check(bp, dc).errors.some((e) => e.includes('schema_version')));
});

test('empty sections are rejected', () => {
  const dc = makeDirectorContext();
  const bp = makeBlueprint(dc);
  bp.sections = [];
  assert.ok(check(bp, dc).errors.some((e) => e.includes('non-empty array')));
});

test('sections that do not start at bar 1 are rejected', () => {
  const dc = makeDirectorContext();
  const bp = makeBlueprint(dc);
  bp.sections[0].start_bar = 3;
  assert.ok(check(bp, dc).errors.some((e) => e.includes('must start at bar 1')));
});

test('sections that do not reach the end of the song are rejected', () => {
  const dc = makeDirectorContext();
  const bp = makeBlueprint(dc);
  bp.sections[2].end_bar_exclusive = 39;
  assert.ok(check(bp, dc).errors.some((e) => e.includes('must cover the song')));
});

test('a gap between sections is rejected', () => {
  const dc = makeDirectorContext();
  const bp = makeBlueprint(dc);
  bp.sections[1].start_bar = 20;
  assert.ok(check(bp, dc).errors.some((e) => e.includes('must tile the song')));
});

test('a song.barCount that disagrees with the analysis is rejected', () => {
  const dc = makeDirectorContext();
  const bp = makeBlueprint(dc);
  bp.song.barCount = 41;
  assert.ok(check(bp, dc).errors.some((e) => e.includes('does not match the analysis bar_count')));
});

// A level's `song.id` is the level's own name, not the analysed song's. The
// library already ships variants that way -- `toosie_slide_arena_primary`
// declares that id while its `song.audio` points at the one analysed file --
// so a differing id is a note, not a rejection. What must match the analysis is
// the audio, BPM, meter and bar count, and those are errors.
test('a song id that differs from the analysis is a warning, not an error', () => {
  const dc = makeDirectorContext();
  const bp = makeBlueprint(dc);
  bp.song.id = 'some_other_song';
  const result = check(bp, dc);
  assert.deepEqual(result.errors, []);
  assert.ok(result.warnings.some((w) => w.includes('is not the analysed song')));
});

// ---------------------------------------------------------------------------
// Modes and capabilities
// ---------------------------------------------------------------------------

test('a mode the generation was never offered is caught and repaired', () => {
  const dc = makeDirectorContext();
  const { before, fixes, blueprint } = assertRepaired('unoffered mode', (b) => {
    b.sections[1].mode = 'VERTICAL';
  }, dc);
  assert.ok(before.errors.some((e) => e.includes('was not offered')));
  assert.ok(fixes.some((f) => f.includes('replaced with the primary mode')));
  assert.equal(blueprint.sections[1].mode, 'ARENA');
});

test('a mode that does not exist at all is caught and repaired', () => {
  const dc = makeDirectorContext();
  const { fixes, blueprint } = assertRepaired('unknown mode', (b) => {
    b.sections[1].mode = 'TETRIS';
  }, dc);
  assert.ok(fixes.some((f) => f.includes('is unknown')));
  assert.equal(blueprint.sections[1].mode, 'ARENA');
});

test('an unknown pattern id is caught and dropped', () => {
  const dc = makeDirectorContext();
  const { before, fixes, blueprint } = assertRepaired('unknown pattern', (b) => {
    b.sections[0].pattern_ids = ['ARENA_NOPE_01'];
  }, dc);
  assert.ok(before.errors.some((e) => e.includes('unknown patternId')));
  assert.ok(fixes.some((f) => f.includes('dropped unknown patternId')));
  assert.equal(blueprint.sections[0].pattern_ids, undefined);
});

test('a pattern from the wrong mode is caught and dropped', () => {
  const dc = makeDirectorContext();
  const runnerPattern = patternIndex.byMode.get('RUNNER')[0].id;
  const { before, fixes, blueprint } = assertRepaired('cross-mode pattern', (b) => {
    b.sections[0].pattern_ids = [runnerPattern];
  }, dc);
  assert.ok(before.errors.some((e) => e.includes(`is a RUNNER pattern`)));
  assert.ok(fixes.some((f) => f.includes(`dropped ${runnerPattern}`)));
  assert.equal(blueprint.sections[0].pattern_ids, undefined);
});

test('a real pattern id for the section mode is accepted', () => {
  const dc = makeDirectorContext();
  const arenaPattern = patternIndex.byMode.get('ARENA')[0].id;
  const bp = makeBlueprint(dc);
  bp.sections[0].pattern_ids = [arenaPattern];
  assert.deepEqual(check(bp, dc).errors, []);
});

test('a pattern family with no patterns in that mode is a warning, not an error', () => {
  const dc = makeDirectorContext();
  const bp = makeBlueprint(dc);
  bp.sections[0].pattern_families = ['no_such_family'];
  const { errors, warnings } = check(bp, dc);
  assert.deepEqual(errors, []);
  assert.ok(warnings.some((w) => w.includes('has no ARENA patterns')));
});

// ---------------------------------------------------------------------------
// Ranges and values
// ---------------------------------------------------------------------------

test('a range running past the song is clamped back inside it', () => {
  const dc = makeDirectorContext();
  const { before, fixes, blueprint } = assertRepaired('past the end', (b) => {
    b.sections[2].end_bar_exclusive = 60;
  }, dc);
  assert.ok(before.errors.some((e) => e.includes('runs past the song')));
  assert.ok(fixes.some((f) => f.includes('clamped')));
  assert.equal(blueprint.sections[2].end_bar_exclusive, 41);
});

test('a gap in the tiling is closed by pulling the next section back', () => {
  const dc = makeDirectorContext();
  const { fixes, blueprint } = assertRepaired('gap', (b) => {
    b.sections[1].start_bar = 20;
  }, dc);
  assert.ok(fixes.some((f) => f.includes('moved to 17 to keep the song tiled')));
  assert.equal(blueprint.sections[1].start_bar, 17);
});

// The normalizer must not "repair" a plan by snapping it onto the sections the
// music detector happened to find. Subdividing the music is the director's job:
// a song the detector heard as three sections can carry eight, and a boundary
// between two detected sections is a legitimate place for one. Snapping used to
// collapse such a plan onto the detector's few boundaries, and because the
// tiling rebuild then closes the gaps it opened, the result was a level made of
// one-bar sections. This pins the boundaries of a plan that subdivides.
test('a plan that subdivides the music keeps its own boundaries', () => {
  const dc = makeDirectorContext();
  const bp = makeBlueprint(dc);
  // Eight sections over the detector's three tiles.
  const cuts = [1, 6, 11, 17, 23, 29, 33, 37, 41];
  bp.sections = cuts.slice(0, -1).map((start, i) => ({
    ...bp.sections[0],
    id: `s${i + 1}`,
    start_bar: start,
    end_bar_exclusive: cuts[i + 1],
    mode: 'ARENA',
    function: 'BUILD',
  }));
  bp.global.difficulty_curve = Array.from({ length: dc.timing.bar_count }, () => 3);

  const { blueprint, fixes } = fix(bp, dc);
  assert.deepEqual(
    blueprint.sections.map((s) => [s.start_bar, s.end_bar_exclusive]),
    cuts.slice(0, -1).map((start, i) => [start, cuts[i + 1]]),
    'every boundary the director chose must survive normalization',
  );
  assert.ok(!fixes.some((f) => f.includes('snapped')), `no snapping expected, got: ${fixes.join(' | ')}`);
  assert.equal(blueprint.sections.length, 8);
});

test('difficulty is clamped into 1..5', () => {
  const dc = makeDirectorContext();
  const { before, fixes, blueprint } = assertRepaired('difficulty high', (b) => {
    b.sections[0].difficulty = 9;
  }, dc);
  assert.ok(before.errors.some((e) => e.includes('difficulty must be an integer')));
  assert.ok(fixes.some((f) => f.includes('clamped')));
  assert.equal(blueprint.sections[0].difficulty, 5);

  const low = fix(Object.assign(makeBlueprint(dc), {}), dc);
  assert.deepEqual(low.fixes, []);
});

test('a difficulty below 1 is clamped up', () => {
  const dc = makeDirectorContext();
  const bp = makeBlueprint(dc);
  bp.sections[0].difficulty = 0;
  assert.equal(fix(bp, dc).blueprint.sections[0].difficulty, 1);
});

test('intensity is clamped into 0..1', () => {
  const dc = makeDirectorContext();
  const { before, fixes, blueprint } = assertRepaired('intensity', (b) => {
    b.sections[0].intensity = 1.7;
  }, dc);
  assert.ok(before.errors.some((e) => e.includes('intensity must be a number')));
  assert.ok(fixes.some((f) => f.includes('clamped')));
  assert.equal(blueprint.sections[0].intensity, 1);
});

test('an unknown section function is replaced', () => {
  const dc = makeDirectorContext();
  const { before, fixes, blueprint } = assertRepaired('function', (b) => {
    b.sections[0].function = 'VIBE';
  }, dc);
  assert.ok(before.errors.some((e) => e.includes('is not one of')));
  assert.ok(fixes.some((f) => f.includes('replaced with SUSTAIN')));
  assert.equal(blueprint.sections[0].function, 'SUSTAIN');
});

test('a missing rationale is filled in', () => {
  const dc = makeDirectorContext();
  const { blueprint, fixes } = assertRepaired('rationale', (b) => {
    delete b.sections[0].rationale;
  }, dc);
  assert.ok(fixes.some((f) => f.includes('rationale')));
  assert.ok(blueprint.sections[0].rationale.length > 0);
});

test('a difficulty curve of the wrong length is rebuilt from the sections', () => {
  const dc = makeDirectorContext();
  const bp = makeBlueprint(dc);
  bp.global.difficulty_curve = [3, 3];
  const { blueprint, fixes } = fix(bp, dc);
  assert.ok(fixes.some((f) => f.includes('difficulty_curve')));
  assert.equal(blueprint.global.difficulty_curve.length, 40);
});

test('section ids that are missing or duplicated are repaired positionally', () => {
  const dc = makeDirectorContext();
  const bp = makeBlueprint(dc);
  delete bp.sections[0].id;
  bp.sections[1].id = bp.sections[2].id;
  const { blueprint, fixes } = fix(bp, dc);
  const ids = blueprint.sections.map((s) => s.id);
  assert.equal(new Set(ids).size, ids.length, 'ids must be unique after repair');
  assert.ok(fixes.some((f) => f.includes('missing id')));
  assert.ok(fixes.some((f) => f.includes('duplicate id')));
  assert.deepEqual(check(blueprint, dc).errors, []);
});

// ---------------------------------------------------------------------------
// Courses (RUNNER only)
// ---------------------------------------------------------------------------

test('a course in a non-RUNNER section is an error', () => {
  const dc = makeDirectorContext();
  const bp = makeBlueprint(dc);
  bp.sections[0].course = { phraseBeats: 4, seed: 1, phrases: [], generate: { beats: 8, seed: 1 } };
  assert.ok(check(bp, dc).errors.some((e) => e.includes('courses are RUNNER-only')));
});

test('a course with neither phrases nor generate is an error', () => {
  const dc = makeDirectorContext();
  const bp = makeBlueprint(dc);
  bp.sections[1].course = { phraseBeats: 4, seed: 1, phrases: [] };
  assert.ok(check(bp, dc).errors.some((e) => e.includes('non-empty phrases list or a generate block')));
});

test('a course that does not cover its section is a warning, not an error', () => {
  const dc = makeDirectorContext();
  const bp = makeBlueprint(dc);
  // section_02 is 16 bars = 64 beats; give it 8.
  bp.sections[1].course = { phraseBeats: 4, seed: 1, phrases: [{ beats: 8 }] };
  const { errors, warnings } = check(bp, dc);
  assert.deepEqual(errors, []);
  assert.ok(warnings.some((w) => w.includes('no terrain')));
});

test('a course that overruns its section is a warning, not an error', () => {
  const dc = makeDirectorContext();
  const bp = makeBlueprint(dc);
  bp.sections[1].course = { phraseBeats: 4, seed: 1, phrases: [{ beats: 200 }] };
  const { errors, warnings } = check(bp, dc);
  assert.deepEqual(errors, []);
  assert.ok(warnings.some((w) => w.includes('runs past the section')));
});

// ---------------------------------------------------------------------------
// Transitions and the breather
// ---------------------------------------------------------------------------

test('a mode change in a section too short for the breather is an error', () => {
  const dc = makeDirectorContext({ barCount: 6, tiles: [[1, 2], [2, 3], [3, 4], [4, 5], [5, 6], [6, 7]] });
  const bp = makeBlueprint(dc);
  for (const [i, s] of bp.sections.entries()) {
    s.mode = i % 2 === 0 ? 'ARENA' : 'RUNNER';
    s.course = i % 2 === 1 ? { phraseBeats: 4, seed: 1, phrases: [], generate: { beats: 4, seed: 1 } } : null;
  }
  const { errors } = check(bp, dc);
  assert.ok(errors.some((e) => e.includes('breather')));
});

test('the infeasible mode change is dropped and the whole tiling stays valid', () => {
  const dc = makeDirectorContext({ barCount: 6, tiles: [[1, 2], [2, 3], [3, 4], [4, 5], [5, 6], [6, 7]] });
  const bp = makeBlueprint(dc);
  for (const [i, s] of bp.sections.entries()) {
    s.mode = i % 2 === 0 ? 'ARENA' : 'RUNNER';
    s.course = i % 2 === 1 ? { phraseBeats: 4, seed: 1, phrases: [], generate: { beats: 4, seed: 1 } } : null;
  }
  const { blueprint, fixes } = fix(bp, dc);
  assert.deepEqual(blueprint.sections.map((s) => s.mode), Array(6).fill('ARENA'));
  assert.deepEqual(blueprint.sections.map((s) => s.course ?? null), Array(6).fill(null));
  assert.ok(fixes.some((f) => f.includes('too short for a')));
  assert.ok(fixes.some((f) => f.includes('course dropped')));
});

test('a transition_out on the last section is dropped', () => {
  const dc = makeDirectorContext();
  const bp = makeBlueprint(dc);
  bp.sections[2].transition_out = { kind: 'cut', reason: 'end', breather_beats: 8, scene: [] };
  const { blueprint, fixes } = fix(bp, dc);
  assert.equal(blueprint.sections[2].transition_out, undefined);
  assert.ok(fixes.some((f) => f.includes('dropped transition_out on the last section')));
});

test('an unknown scene effect is caught and dropped', () => {
  const dc = makeDirectorContext();
  const bp = makeBlueprint(dc);
  bp.sections[0].transition_out = {
    kind: 'wipe', reason: 'mode change', breather_beats: 8,
    scene: [{ effect: 'cameraZoom' }, { effect: 'explodeTheUniverse' }],
  };
  const { errors } = check(bp, dc);
  assert.ok(errors.some((e) => e.includes('unknown scene effect')));

  const { blueprint, fixes } = fix(bp, dc);
  assert.deepEqual(blueprint.sections[0].transition_out.scene, [{ effect: 'cameraZoom' }]);
  assert.ok(fixes.some((f) => f.includes('unknown scene effects')));
});

test('an under-specified breather is a warning', () => {
  const dc = makeDirectorContext();
  const bp = makeBlueprint(dc);
  bp.sections[0].transition_out = { kind: 'cut', reason: 'mode change', breather_beats: 1, scene: [] };
  const { errors, warnings } = check(bp, dc);
  assert.deepEqual(errors, []);
  assert.ok(warnings.some((w) => w.includes('breather beats')));
});

// ---------------------------------------------------------------------------
// Sync points
// ---------------------------------------------------------------------------

test('a sync point on a real anchor is accepted', () => {
  const dc = makeDirectorContext();
  const bp = makeBlueprint(dc);
  bp.sync_points = [{ bar: 8, anchor_type: 'energy_peak', why: 'the drop' }];
  assert.deepEqual(check(bp, dc).errors, []);
  assert.deepEqual(check(bp, dc).warnings, []);
});

test('a sync point the music does not offer is a warning and is dropped', () => {
  const dc = makeDirectorContext();
  const bp = makeBlueprint(dc);
  bp.sync_points = [{ bar: 3, anchor_type: 'vocal_entry', why: 'vocal' }];
  const { errors, warnings } = check(bp, dc);
  assert.deepEqual(errors, []);
  assert.ok(warnings.some((w) => w.includes('the music does not offer')));

  const { blueprint, fixes } = fix(bp, dc);
  assert.deepEqual(blueprint.sync_points, []);
  assert.ok(fixes.some((f) => f.includes('dropped sync point')));
});

test('a sync point past the end of the song is an error and is dropped', () => {
  const dc = makeDirectorContext();
  const bp = makeBlueprint(dc);
  bp.sync_points = [{ bar: 99, anchor_type: 'strong_beat', why: 'x' }];
  assert.ok(check(bp, dc).errors.some((e) => e.includes('outside the song')));
  assert.deepEqual(fix(bp, dc).blueprint.sync_points, []);
});

test('an unknown anchor type is an error', () => {
  const dc = makeDirectorContext();
  const bp = makeBlueprint(dc);
  bp.sync_points = [{ bar: 8, anchor_type: 'vibe_check', why: 'x' }];
  assert.ok(check(bp, dc).errors.some((e) => e.includes('unknown anchor_type')));
});

// ---------------------------------------------------------------------------
// Request constraints
// ---------------------------------------------------------------------------

test('a primary mode outside the allowed list is an error', () => {
  const dc = makeDirectorContext();
  const bp = makeBlueprint(dc);
  bp.request.primary_mode = 'VERTICAL';
  assert.ok(check(bp, dc).errors.some((e) => e.includes('primary_mode')));
});

test('an allowed_modes list wider than the generation was offered is an error', () => {
  const dc = makeDirectorContext();
  const bp = makeBlueprint(dc);
  bp.request.allowed_modes = ['ARENA', 'RUNNER', 'VERTICAL'];
  assert.ok(check(bp, dc).errors.some((e) => e.includes('wider than the modes')));
});

test('a target_difficulty outside 1..5 is an error', () => {
  const dc = makeDirectorContext();
  const bp = makeBlueprint(dc);
  bp.request.target_difficulty = 7;
  assert.ok(check(bp, dc).errors.some((e) => e.includes('target_difficulty')));
});

test('a primary_mode_ratio outside 0..1 is an error', () => {
  const dc = makeDirectorContext();
  const bp = makeBlueprint(dc);
  bp.request.primary_mode_ratio = 1.4;
  assert.ok(check(bp, dc).errors.some((e) => e.includes('primary_mode_ratio')));
});

test('falling well short of the requested primary-mode share is a warning', () => {
  const dc = makeDirectorContext();
  const bp = makeBlueprint(dc);
  bp.request.primary_mode_ratio = 0.9; // only 16 of 40 bars are ARENA
  const { errors, warnings } = check(bp, dc);
  assert.deepEqual(errors, []);
  assert.ok(warnings.some((w) => w.includes('of bars but')));
});

// ---------------------------------------------------------------------------
// The real artifact
// ---------------------------------------------------------------------------

test('the real director context produces a blueprint that validates', { skip: !existsSync(REAL_DIRECTOR_CONTEXT) }, () => {
  const dc = JSON.parse(readFileSync(REAL_DIRECTOR_CONTEXT, 'utf8'));
  const beatsPerBar = beatsPerBarOf(dc);
  const bp = {
    schema_version: BLUEPRINT_V2_SCHEMA_VERSION,
    generator: { kind: 'rule_based', model: null, prompt_version: 'test', created_from: 'director_context_v2.json' },
    song: {
      id: dc.source.song_id,
      title: dc.source.song_id,
      audio: dc.source.audio_file,
      bpm: dc.timing.bpm,
      timeSignature: [beatsPerBar, 4],
      barCount: dc.timing.bar_count,
      durationSec: dc.source.duration_sec,
    },
    request: {
      primary_mode: 'ARENA',
      allowed_modes: ['ARENA', 'RUNNER'],
      target_difficulty: 3,
      primary_mode_ratio: 0.5,
      seed: 7,
    },
    global: { intent: 'real', arc: 'rise', difficulty_curve: Array.from({ length: dc.timing.bar_count }, () => 3) },
    sections: dc.sections.map((s, i) => ({
      id: s.section_id,
      start_bar: s.start_bar,
      end_bar_exclusive: s.end_bar_exclusive,
      mode: i === 0 ? 'ARENA' : 'RUNNER',
      function: i === 0 ? 'INTRO' : 'PEAK',
      difficulty: 3,
      intensity: 0.5,
      rationale: 'real',
      pattern_families: [],
      pattern_ids: [],
      energy_band: 'MID',
      course: i === 1 ? { phraseBeats: 4, seed: 7, phrases: [], generate: { beats: 64, seed: 7, intensity: 0.6 } } : null,
      transition_out: null,
    })),
    sync_points: [],
    notes: [],
  };

  const { errors, warnings } = check(bp, dc);
  assert.deepEqual(errors, []);
  assert.deepEqual(warnings, []);

  // The last section must reach exactly one bar past the song.
  assert.equal(bp.sections[bp.sections.length - 1].end_bar_exclusive, dc.timing.bar_count + 1);

  const { fixes } = fix(bp, dc);
  assert.deepEqual(fixes, []);
});

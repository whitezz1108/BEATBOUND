/**
 * Compiler tests: level_blueprint_v2 -> runtime level.json.
 *
 * These run against the *real* rules files, the *real* pattern library and the
 * real generator primitives, because the compiler's whole job is to drive those
 * correctly -- a hermetic pattern index would test nothing. What is synthetic is
 * the analysis and the director context, so the section tiling, energies and
 * mode plan are exactly what each test wants to exercise.
 *
 * The assertions are structural (ids resolve, modes agree, bars tile, the
 * breather is left empty) rather than golden, so a change to the pattern
 * library or the difficulty rules does not fail the suite for the wrong reason.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { compileBlueprint, COMPILER_VERSION } from '../generation/compiler.js';
import { validateBlueprint, breatherBeats } from '../generation/blueprint.js';
import { loadRulesWithTuning } from '../generation/rules.js';
import { loadPatternIndex } from '../generator/patternIndex.js';

const { rules, tuning } = loadRulesWithTuning();
const index = loadPatternIndex();

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const BPM = 120;
const BEATS_PER_BAR = 4;
const BAR_SEC = (60 / BPM) * BEATS_PER_BAR;

/**
 * A v1-projection-shaped analysis: `bars[]` with the energy fields the
 * difficulty bands read. `energies` lets a test shape the arc.
 */
function makeAnalysis(bars = 32, energies = null) {
  return {
    version: '1.0.0',
    song: {
      id: 'test_song',
      title: 'Test Song',
      audioPath: 'audio/editor/test_song.mp3',
      durationSec: bars * BAR_SEC,
      sourceHash: 'deadbeef',
    },
    tempo: { bpm: BPM, confidence: 0.9, timeSignature: [4, 4] },
    bars: Array.from({ length: bars }, (_, i) => ({
      bar: i + 1,
      startTime: i * BAR_SEC,
      endTime: (i + 1) * BAR_SEC,
      energy: energies ? energies[i] : 0.3 + 0.5 * (i / Math.max(1, bars - 1)),
      rhythmDensity: 0.5,
      onsetCount: 4,
    })),
    sections: [],
  };
}

function makeDirectorContext({ bars = 32, beatsPerBar = BEATS_PER_BAR, bpm = BPM, meter } = {}) {
  return {
    schema_version: 'beatbound_director_context_v2',
    source: { song_id: 'test_song', audio_file: 'test_song.mp3', duration_sec: bars * BAR_SEC },
    timing: {
      bpm,
      meter: meter ?? `${beatsPerBar}/4`,
      beats_per_bar: beatsPerBar,
      bar_count: bars,
      bars: Array.from({ length: bars }, (_, i) => ({
        bar: i + 1,
        start: i * BAR_SEC,
        end: (i + 1) * BAR_SEC,
      })),
    },
    sections: [],
  };
}

/** A blueprint whose sections tile `cuts` and use `modes`. */
function makeBlueprint({ analysis, directorContext, cuts, modes, functions = null, difficulty = 3, extra = {} }) {
  const bpm = directorContext.timing.bpm;
  const bpb = directorContext.timing.beats_per_bar;
  const breather = breatherBeats(bpm, tuning);
  const n = cuts.length - 1;
  return {
    schema_version: 'beatbound_level_blueprint_v2',
    generator: { kind: 'ai_director', model: 'test', prompt_version: 'test' },
    song: {
      id: analysis.song.id,
      title: analysis.song.title,
      bpm,
      timeSignature: [4, 4],
      barCount: analysis.bars.length,
      durationSec: analysis.song.durationSec,
      audio: analysis.song.audioPath,
    },
    global: { intent: 'test level', arc: 'steady rise', difficulty_curve: [] },
    request: {
      primary_mode: modes[0],
      allowed_modes: [...new Set(modes)],
      target_difficulty: difficulty,
      primary_mode_ratio: 0.5,
      seed: 7,
    },
    sections: Array.from({ length: n }, (_, i) => ({
      id: `section_${String(i + 1).padStart(2, '0')}`,
      start_bar: cuts[i],
      end_bar_exclusive: cuts[i + 1],
      mode: modes[i],
      function: functions ? functions[i] : 'BUILD',
      difficulty,
      intensity: 0.5,
      rationale: `section ${i} follows the energy`,
      ...(i < n - 1
        ? {
            transition_out: {
              kind: 'mode_change',
              reason: 'the mode changes here',
              breather_beats: breather,
              scene: [{ effect: 'paletteShift' }],
            },
          }
        : {}),
    })),
    notes: [],
    sync_points: [],
    ...extra,
  };
}

const compile = (blueprint, analysis, directorContext) =>
  compileBlueprint(blueprint, { analysis, directorContext, rules });

// ---------------------------------------------------------------------------
// Input contract
// ---------------------------------------------------------------------------

test('the compiler refuses a V2 analysis, which has no bar grid', () => {
  // music_analysis_v2.json has `timeline.windows[]` on a 0.25s hop and no
  // top-level bars. Passing it would make every section's energy zero and the
  // whole level flat, so it must throw rather than produce a quiet bad level.
  const analysis = makeAnalysis(16);
  const dc = makeDirectorContext({ bars: 16 });
  const bp = makeBlueprint({ analysis, directorContext: dc, cuts: [1, 17], modes: ['ARENA'] });

  const v2Shaped = { schemaVersion: '2.0.0', source: { path: 'x' }, timeline: { windows: [] } };
  assert.throws(
    () => compileBlueprint(bp, { analysis: v2Shaped, directorContext: dc, rules }),
    /analysis\.bars is empty/,
  );
  assert.throws(
    () => compileBlueprint(bp, { analysis: { ...analysis, bars: [] }, directorContext: dc, rules }),
    /analysis\.bars is empty/,
  );
});

test('the compiler requires analysis, director context and full rules', () => {
  const analysis = makeAnalysis(16);
  const dc = makeDirectorContext({ bars: 16 });
  const bp = makeBlueprint({ analysis, directorContext: dc, cuts: [1, 17], modes: ['ARENA'] });

  assert.throws(() => compileBlueprint(bp, { directorContext: dc, rules }), /analysis is required/);
  assert.throws(() => compileBlueprint(bp, { analysis, rules }), /directorContext is required/);
  assert.throws(
    () => compileBlueprint(bp, { analysis, directorContext: dc, rules: { gameplay: {} } }),
    /gameplay, difficulty and transition/,
  );
});

// ---------------------------------------------------------------------------
// Bars: half-open -> startBar/lengthBars
// ---------------------------------------------------------------------------

test('half-open blueprint bars become the runtime startBar/lengthBars pair', () => {
  const analysis = makeAnalysis(32);
  const dc = makeDirectorContext({ bars: 32 });
  const bp = makeBlueprint({ analysis, directorContext: dc, cuts: [1, 9, 17, 33], modes: ['ARENA', 'RUNNER', 'ARENA'] });
  const { level } = compile(bp, analysis, dc);

  assert.deepEqual(
    level.sections.map((s) => [s.startBar, s.lengthBars]),
    [
      [1, 8],
      [9, 8],
      [17, 16],
    ],
  );
  assert.equal(
    level.sections.reduce((n, s) => n + s.lengthBars, 0),
    analysis.bars.length,
    'the sections cover every bar of the song exactly once',
  );
});

test('sections tile the song without gaps or overlaps', () => {
  const analysis = makeAnalysis(40);
  const dc = makeDirectorContext({ bars: 40 });
  const bp = makeBlueprint({
    analysis,
    directorContext: dc,
    cuts: [1, 5, 13, 21, 29, 41],
    modes: ['ARENA', 'RUNNER', 'VERTICAL', 'ARENA', 'RUNNER'],
  });
  const { level } = compile(bp, analysis, dc);

  assert.equal(level.sections[0].startBar, 1, 'starts at bar 1');
  for (let i = 1; i < level.sections.length; i++) {
    const prev = level.sections[i - 1];
    assert.equal(
      level.sections[i].startBar,
      prev.startBar + prev.lengthBars,
      `section ${i} begins where section ${i - 1} ended`,
    );
  }
  const last = level.sections[level.sections.length - 1];
  assert.equal(last.startBar + last.lengthBars, 41, 'the last section ends past the final bar');
});

// ---------------------------------------------------------------------------
// Patterns
// ---------------------------------------------------------------------------

test('every emitted pattern exists in the library and matches its section mode', () => {
  const analysis = makeAnalysis(48);
  const dc = makeDirectorContext({ bars: 48 });
  const bp = makeBlueprint({
    analysis,
    directorContext: dc,
    cuts: [1, 13, 25, 37, 49],
    modes: ['ARENA', 'RUNNER', 'VERTICAL', 'ARENA'],
  });
  const { level } = compile(bp, analysis, dc);

  let placements = 0;
  for (const s of level.sections) {
    for (const p of s.patterns) {
      const pattern = index.byId.get(p.patternId);
      assert.ok(pattern, `${s.id}: patternId ${p.patternId} is not in the library`);
      assert.equal(pattern.mode, s.mode, `${s.id}: ${p.patternId} is a ${pattern.mode} pattern`);
      assert.ok(p.repeat >= 1, `${s.id}: repeat must be >= 1`);
      assert.ok(p.intensity >= 0 && p.intensity <= 1, `${s.id}: intensity out of 0..1`);
      placements++;
    }
  }
  assert.ok(placements > 0, 'the compiler placed at least one pattern');
});

test('a section never overflows its own bars', () => {
  const analysis = makeAnalysis(48);
  const dc = makeDirectorContext({ bars: 48 });
  const bp = makeBlueprint({
    analysis,
    directorContext: dc,
    cuts: [1, 9, 21, 33, 49],
    modes: ['ARENA', 'RUNNER', 'VERTICAL', 'ARENA'],
  });
  const { level } = compile(bp, analysis, dc);

  for (const s of level.sections) {
    const bars = s.patterns.reduce(
      (n, p) => n + (index.byId.get(p.patternId)?.lengthBars ?? 0) * (p.repeat ?? 1),
      0,
    );
    assert.ok(
      bars <= s.lengthBars,
      `${s.id}: patterns occupy ${bars} bars but the section is ${s.lengthBars}`,
    );
  }
});

test('a mode change leaves the runtime breather empty at the end of the section', () => {
  // The runtime stops spawning for the last `breatherBeats` before a mode
  // change. If the compiler filled those bars the level would look complete and
  // play as dead air, so the section must stop at the breather boundary.
  //
  // The boundary is mid-bar in general (6 beats of a 4/4 song), so the bar it
  // falls inside is *partially* usable -- a pattern may start there as long as
  // it activates before the breather closes the bar. The fill therefore runs to
  // the bar containing the boundary, never past it.
  const analysis = makeAnalysis(48);
  const dc = makeDirectorContext({ bars: 48 });
  const bp = makeBlueprint({
    analysis,
    directorContext: dc,
    cuts: [1, 17, 33, 49],
    modes: ['ARENA', 'RUNNER', 'ARENA'],
  });
  const { level } = compile(bp, analysis, dc);

  const breather = breatherBeats(BPM, tuning);
  const first = level.sections[0];
  assert.equal(first.transitionOut, 'mode_change', 'the boundary is a mode change');
  assert.ok(breather > 0, 'the tuning says a breather is required');

  const filled = first.patterns.reduce(
    (n, p) => n + (index.byId.get(p.patternId)?.lengthBars ?? 0) * (p.repeat ?? 1),
    0,
  );
  const usableBeats = first.lengthBars * BEATS_PER_BAR - breather;
  const lastUsableBar = Math.ceil(usableBeats / BEATS_PER_BAR);
  assert.ok(
    filled <= lastUsableBar,
    `${first.id}: filled ${filled} bars but the breather starts in bar ${lastUsableBar}`,
  );
  assert.ok(
    filled < first.lengthBars,
    `${first.id}: the section is filled to the end -- the breather was ignored`,
  );
});

// ---------------------------------------------------------------------------
// RUNNER courses
// ---------------------------------------------------------------------------

test('a RUNNER course replaces the patterns and carries a generate block', () => {
  const analysis = makeAnalysis(32);
  const dc = makeDirectorContext({ bars: 32 });
  const bp = makeBlueprint({ analysis, directorContext: dc, cuts: [1, 17, 33], modes: ['RUNNER', 'ARENA'] });
  bp.sections[0].course = {
    phraseBeats: 4,
    seed: 99,
    phrases: [],
    generate: { beats: 64, seed: 99, intensity: 0.6 },
  };

  const { level } = compile(bp, analysis, dc);
  const runner = level.sections[0];

  assert.equal(runner.mode, 'RUNNER');
  assert.deepEqual(runner.patterns, [], 'a course and patterns together would make the runtime warn');
  assert.ok(runner.course, 'the course is emitted');
  assert.equal(runner.course.generate.beats, 64);
  assert.equal(runner.course.generate.seed, 99);
  assert.equal(runner.course.phraseBeats, 4);
});

test('a course with no explicit beats covers its section exactly', () => {
  const analysis = makeAnalysis(32);
  const dc = makeDirectorContext({ bars: 32 });
  const bp = makeBlueprint({ analysis, directorContext: dc, cuts: [1, 25, 33], modes: ['RUNNER', 'ARENA'] });
  bp.sections[0].course = { phraseBeats: 4, seed: 3, phrases: [], generate: { seed: 3, intensity: 0.5 } };

  const { level } = compile(bp, analysis, dc);
  const runner = level.sections[0];
  assert.equal(runner.lengthBars, 24);
  assert.equal(runner.course.generate.beats, 24 * BEATS_PER_BAR, 'the course spans every bar');
});

test('a course with an authored phrase list keeps it and drops generate', () => {
  const analysis = makeAnalysis(16);
  const dc = makeDirectorContext({ bars: 16 });
  const bp = makeBlueprint({ analysis, directorContext: dc, cuts: [1, 17], modes: ['RUNNER'] });
  bp.sections[0].course = {
    phraseBeats: 4,
    seed: 5,
    phrases: [{ archetype: 'GAP_RUN', beats: 16 }],
    generate: { beats: 64, seed: 5, intensity: 0.5 },
  };

  const { level } = compile(bp, analysis, dc);
  const course = level.sections[0].course;
  assert.equal(course.phrases.length, 1, 'the authored list survives');
  assert.equal(course.generate, undefined, 'generate would be ignored, so it is not emitted');
});

test('a non-RUNNER section never carries a course', () => {
  const analysis = makeAnalysis(16);
  const dc = makeDirectorContext({ bars: 16 });
  const bp = makeBlueprint({ analysis, directorContext: dc, cuts: [1, 17], modes: ['ARENA'] });
  const { level } = compile(bp, analysis, dc);
  assert.equal(level.sections[0].course, undefined);
});

// ---------------------------------------------------------------------------
// Transitions and scenes
// ---------------------------------------------------------------------------

test('a mode change becomes the transitionOut the blueprint asked for', () => {
  const analysis = makeAnalysis(32);
  const dc = makeDirectorContext({ bars: 32 });
  const bp = makeBlueprint({ analysis, directorContext: dc, cuts: [1, 17, 33], modes: ['ARENA', 'RUNNER'] });
  bp.sections[0].transition_out.kind = 'wipe';
  const { level } = compile(bp, analysis, dc);

  assert.equal(level.sections[0].transitionOut, 'wipe', "the director's kind wins");
  assert.equal(level.sections[1].transitionOut, null, 'the last section hands off to nothing');
});

test('a same-mode boundary is not a transitionOut but keeps its scene', () => {
  // `transitionOut` tells the runtime which mode comes next; two ARENA
  // sections in a row hand off to ARENA, so it stays null. The visual beat the
  // director asked for still has to reach the level.
  const analysis = makeAnalysis(32);
  const dc = makeDirectorContext({ bars: 32 });
  const bp = makeBlueprint({ analysis, directorContext: dc, cuts: [1, 17, 33], modes: ['ARENA', 'ARENA'] });
  bp.sections[0].transition_out.scene = [{ effect: 'wipe', params: { direction: 'left' } }];

  const { level } = compile(bp, analysis, dc);
  assert.equal(level.sections[0].transitionOut, null, 'no mode change, so no transitionOut');
  assert.equal(level.sections[0].scene.effects[0].effect, 'wipe', 'the scene survives');
  assert.deepEqual(level.sections[0].scene.effects[0].params, { direction: 'left' });
});

test('an undeclared mode change still gets a full generated transition', () => {
  // A mode change is not optional: the runtime needs the breather and the
  // hazard-reduction bars whether or not the director described them. With no
  // declaration the compiler falls back to what `buildTransition` generates --
  // the same thing the rule-based director has always emitted.
  const analysis = makeAnalysis(32);
  const dc = makeDirectorContext({ bars: 32 });
  const bp = makeBlueprint({ analysis, directorContext: dc, cuts: [1, 17, 33], modes: ['ARENA', 'RUNNER'] });
  delete bp.sections[0].transition_out;
  const { level } = compile(bp, analysis, dc);

  assert.equal(level.sections[0].transitionOut, 'ARENA_TO_RUNNER', 'the mode change is still described');
  assert.ok(level.sections[0].scene?.effects?.length > 0, 'and it still has scene instructions');
});

test('every transitionOut is a string or null, never undefined', () => {
  const analysis = makeAnalysis(40);
  const dc = makeDirectorContext({ bars: 40 });
  const bp = makeBlueprint({
    analysis,
    directorContext: dc,
    cuts: [1, 9, 17, 25, 33, 41],
    modes: ['ARENA', 'ARENA', 'RUNNER', 'VERTICAL', 'ARENA'],
  });
  const { level } = compile(bp, analysis, dc);

  for (const s of level.sections) {
    assert.ok(
      s.transitionOut === null || typeof s.transitionOut === 'string',
      `${s.id}: transitionOut is ${JSON.stringify(s.transitionOut)}`,
    );
  }
});

// ---------------------------------------------------------------------------
// Determinism and provenance
// ---------------------------------------------------------------------------

test('compiling the same blueprint twice is byte-identical', () => {
  const analysis = makeAnalysis(48);
  const dc = makeDirectorContext({ bars: 48 });
  const bp = makeBlueprint({
    analysis,
    directorContext: dc,
    cuts: [1, 13, 25, 37, 49],
    modes: ['ARENA', 'RUNNER', 'VERTICAL', 'ARENA'],
  });

  const a = compile(bp, analysis, dc);
  const b = compile(bp, analysis, dc);
  assert.equal(JSON.stringify(a.level), JSON.stringify(b.level), 'no wall-clock, no Math.random');
});

test('a different seed composes different patterns', () => {
  const analysis = makeAnalysis(48);
  const dc = makeDirectorContext({ bars: 48 });
  const bp = makeBlueprint({
    analysis,
    directorContext: dc,
    cuts: [1, 13, 25, 37, 49],
    modes: ['ARENA', 'RUNNER', 'VERTICAL', 'ARENA'],
  });

  const a = compile(bp, analysis, dc);
  const b = compile(bp, analysis, dc);
  b.level = null;
  const other = compileBlueprint(bp, { analysis, directorContext: dc, rules, seed: 12345 });
  assert.notEqual(
    JSON.stringify(a.level.sections),
    JSON.stringify(other.level.sections),
    'a different seed must change the composition',
  );
  assert.equal(other.level.editor.seed, 12345, 'the seed is recorded');
});

test('the level carries its provenance', () => {
  const analysis = makeAnalysis(32);
  const dc = makeDirectorContext({ bars: 32 });
  const bp = makeBlueprint({ analysis, directorContext: dc, cuts: [1, 17, 33], modes: ['ARENA', 'RUNNER'] });
  const { level, meta } = compile(bp, analysis, dc);

  assert.equal(level.version, '1.0.0');
  assert.equal(level.editor.compilerVersion, COMPILER_VERSION);
  assert.equal(level.editor.blueprintVersion, 'beatbound_level_blueprint_v2');
  assert.equal(level.editor.generator, 'ai_director');
  assert.equal(level.editor.intent, 'test level');
  assert.equal(level.editor.seed, 7);
  assert.equal(level.song.id, analysis.song.id);
  assert.equal(level.song.bpm, BPM);
  assert.equal(meta.sectionCount, 2);
  assert.equal(meta.difficultyCurve.length, 2, 'one curve entry per section');
});

test('the compiler reports the breather it used, matching the runtime formula', () => {
  const analysis = makeAnalysis(32);
  const dc = makeDirectorContext({ bars: 32 });
  const bp = makeBlueprint({ analysis, directorContext: dc, cuts: [1, 17, 33], modes: ['ARENA', 'RUNNER'] });
  const { meta } = compile(bp, analysis, dc);

  assert.equal(meta.breatherBeats, breatherBeats(BPM, tuning));
  assert.ok(Number.isInteger(meta.breatherBeats), 'whole beats, as the runtime computes it');
});

// ---------------------------------------------------------------------------
// Meter
// ---------------------------------------------------------------------------

test('a non-4/4 song warns about the runtime hardcoding four beats per bar', () => {
  // src/core/LevelLoader.ts measures course coverage as `lengthBars * 4`. In
  // 3/4 the compiler emits a course that is exactly right and the runtime
  // disagrees, so the compiler says so instead of looking like the bug.
  const analysis = makeAnalysis(16);
  const dc = makeDirectorContext({ bars: 16, beatsPerBar: 3, meter: '3/4' });
  analysis.tempo.timeSignature = [3, 4];
  const bp = makeBlueprint({ analysis, directorContext: dc, cuts: [1, 17], modes: ['RUNNER'] });
  bp.song.timeSignature = [3, 4];
  bp.sections[0].course = { phraseBeats: 4, seed: 2, phrases: [], generate: { seed: 2, intensity: 0.5 } };

  const { level, warnings, meta } = compile(bp, analysis, dc);
  assert.equal(meta.beatsPerBar, 3, 'the compiler uses the real meter');
  assert.equal(level.sections[0].course.generate.beats, 16 * 3, 'the course covers 16 bars of 3');
  assert.ok(
    warnings.some((w) => w.includes('lengthBars * 4')),
    `expected a meter warning, got ${JSON.stringify(warnings)}`,
  );
});

test('a 4/4 song raises no meter warning', () => {
  const analysis = makeAnalysis(16);
  const dc = makeDirectorContext({ bars: 16 });
  const bp = makeBlueprint({ analysis, directorContext: dc, cuts: [1, 17], modes: ['RUNNER'] });
  bp.sections[0].course = { phraseBeats: 4, seed: 2, phrases: [], generate: { seed: 2, intensity: 0.5 } };
  const { warnings } = compile(bp, analysis, dc);
  assert.deepEqual(warnings, []);
});

// ---------------------------------------------------------------------------
// Integration: the compiler only accepts what the validator accepts
// ---------------------------------------------------------------------------

test('a blueprint the validator rejects still compiles without throwing', () => {
  // The pipeline wants to *report* a bad level, not crash on it, so the
  // compiler is deliberately not a second validator -- and the repair loop
  // needs a level back to show the operator what the errors cost.
  const analysis = makeAnalysis(16);
  const dc = makeDirectorContext({ bars: 16 });
  const bp = makeBlueprint({ analysis, directorContext: dc, cuts: [1, 17], modes: ['ARENA'] });
  bp.sections[0].mode = 'NOT_A_MODE';

  assert.ok(validateBlueprint(bp, { directorContext: dc }).errors.length > 0, 'the validator rejects it');

  let out;
  assert.doesNotThrow(() => {
    out = compile(bp, analysis, dc);
  });
  assert.deepEqual(out.level.sections[0].patterns, [], 'an unfillable mode yields an empty section');
  assert.ok(
    out.warnings.some((w) => w.includes('NOT_A_MODE')),
    `expected a warning naming the mode, got ${JSON.stringify(out.warnings)}`,
  );
});

test('the real director context and analysis compile end to end', () => {
  // The one non-synthetic case: the artifacts the Python analysis actually
  // wrote for the library song.
  const dc = JSON.parse(readFileSync(new URL('../output/director_context_v2.json', import.meta.url), 'utf8'));
  const analysis = JSON.parse(readFileSync(new URL('../output/music_analysis.json', import.meta.url), 'utf8'));

  const barCount = dc.timing.bar_count;
  const cuts = [1, 13, 29, 45, 61, 81, barCount + 1];
  const modes = ['ARENA', 'ARENA', 'RUNNER', 'RUNNER', 'VERTICAL', 'ARENA'];
  const bp = makeBlueprint({
    analysis,
    directorContext: dc,
    cuts,
    modes,
    functions: ['INTRO', 'BUILD', 'PEAK', 'SUSTAIN', 'BREAKDOWN', 'OUTRO'],
  });
  bp.song.id = analysis.song.id;
  bp.song.audio = 'arkins_-_jangchung.mp3';

  const { level, warnings, meta } = compile(bp, analysis, dc);

  assert.deepEqual(warnings, [], 'the real artifacts compile cleanly');
  assert.equal(meta.beatsPerBar, 4);
  assert.equal(meta.breatherBeats, 6, '129.2 BPM rounds to 6 beats, as the runtime computes');
  assert.equal(
    level.sections.reduce((n, s) => n + s.lengthBars, 0),
    barCount,
    'the compiled level covers the whole song',
  );
  assert.equal(level.song.bpm, dc.timing.bpm);
  for (const s of level.sections) {
    assert.ok(s.startBar >= 1 && s.lengthBars >= 1, `${s.id} is a real section`);
  }
  // Every pattern must resolve against the live library.
  for (const s of level.sections) {
    for (const p of s.patterns) {
      assert.ok(index.byId.has(p.patternId), `${s.id}: ${p.patternId} missing from the library`);
    }
  }
});

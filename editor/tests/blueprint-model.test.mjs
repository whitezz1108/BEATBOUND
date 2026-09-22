/**
 * The editor's blueprint model -- schema ownership.
 *
 * The property these tests exist to protect: **the editor never reads a
 * blueprint field by name.** Two schemas share one session slot and disagree
 * about almost every field, so every reader goes through
 * `editor/ui/blueprintModel.js`. When that discipline slipped, the symptoms
 * were three unrelated-looking crashes -- `undefined.find`,
 * `undefined.forEach`, and a timeline that rendered nothing at all -- and all
 * three had one cause: a v1 reader meeting a v2 blueprint.
 *
 * So this file tests the model the way the editor uses it: hand it a blueprint
 * of either schema and check the answers are right, in the convention the
 * compiler actually uses.
 *
 * The convention that matters most is the bar range. v2 sections are half-open
 * `[start_bar, end_bar_exclusive)` and v1's `endBar` is inclusive. A single
 * stray `+ 1` lengthens every section by one bar and desynchronises the level
 * from the music, and nothing throws -- so it is asserted directly, and the
 * test that would have caught the original bug is asserted to be
 * *load-bearing* rather than vacuous.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  detectBlueprintSchema,
  isV2,
  sectionsOf,
  sectionStartBar,
  sectionEndBarExclusive,
  sectionDurationBars,
  sectionMode,
  normalizeTransitionOut,
  boundariesOf,
  findSection,
  findBoundary,
  assertV2Purity,
  V1_ONLY_FIELDS,
  V1_SCHEMA,
  V2_SCHEMA,
  SCENE_EFFECTS,
  SECTION_FUNCTIONS,
  MODES,
} from '../ui/blueprintModel.js';

// ---------------------------------------------------------------------------
// Fixtures -- the same shapes the generators actually emit
// ---------------------------------------------------------------------------

/** A v2 blueprint: three sections tiling 40 bars, half-open ranges. */
function v2Blueprint(overrides = {}) {
  return {
    schema_version: 'beatbound_level_blueprint_v2',
    generator: { kind: 'ai_director', model: 'test', prompt_version: 'test', created_from: 'test' },
    song: { id: 'test_song', title: 'Test Song', audio: 'test.wav', bpm: 120, timeSignature: [4, 4], barCount: 40, durationSec: 80 },
    request: { primary_mode: 'ARENA', allowed_modes: ['ARENA', 'RUNNER'], target_difficulty: 3, primary_mode_ratio: 0.5, seed: 7 },
    global: { intent: 'test', arc: 'rise', difficulty_curve: [] },
    sections: [
      { id: 'section_01', start_bar: 1, end_bar_exclusive: 17, mode: 'ARENA', function: 'INTRO', difficulty: 2, intensity: 0.3, rationale: 'a', pattern_families: ['teach'], pattern_ids: [], energy_band: 'LOW', course: null, transition_out: null },
      { id: 'section_02', start_bar: 17, end_bar_exclusive: 33, mode: 'RUNNER', function: 'PEAK', difficulty: 4, intensity: 0.8, rationale: 'b', pattern_families: ['sprint'], pattern_ids: [], energy_band: 'HIGH', course: null, transition_out: null },
      { id: 'section_03', start_bar: 33, end_bar_exclusive: 41, mode: 'ARENA', function: 'OUTRO', difficulty: 1, intensity: 0.2, rationale: 'c', pattern_families: [], pattern_ids: [], energy_band: 'LOW', course: null, transition_out: null },
    ],
    sync_points: [],
    notes: [],
    ...overrides,
  };
}

/** A v1 blueprint: the same song, inclusive `endBar`, `patterns`, `transitions`. */
function v1Blueprint() {
  return {
    version: '1.0.0',
    generator: { name: 'beatbound-level-director', version: '1.0.0' },
    song: { id: 'test_song', title: 'Test Song', audioPath: 'test.wav', durationSec: 80 },
    analysisSource: 'test',
    sections: [
      { id: 'S01', startBar: 1, endBar: 16, lengthBars: 16, mode: 'ARENA', function: 'TEACH', difficulty: 2, patterns: [{ patternId: 'AP01', repeat: 1, intensity: 0.4 }] },
      { id: 'S02', startBar: 17, endBar: 32, lengthBars: 16, mode: 'RUNNER', function: 'CLIMAX', difficulty: 4, patterns: [] },
    ],
    transitions: [
      { id: 'T01', fromSection: 'S01', toSection: 'S02', kind: 'ARENA_TO_RUNNER', lengthBeats: 6, tailBars: 1, headBars: 1, scene: [{ effect: 'wipe', params: {}, durationBeats: 4 }] },
    ],
    difficultyCurve: [],
  };
}

// ---------------------------------------------------------------------------
// Schema detection
// ---------------------------------------------------------------------------

test('detects the schema from the stamp each generator writes', () => {
  assert.equal(detectBlueprintSchema(v2Blueprint()), V2_SCHEMA);
  assert.equal(detectBlueprintSchema(v1Blueprint()), V1_SCHEMA);
  assert.ok(isV2(v2Blueprint()));
  assert.ok(!isV2(v1Blueprint()));
});

test('a missing or unrecognisable blueprint is null, not a wrong guess', () => {
  // "no blueprint yet" and "a blueprint I do not understand" are different
  // states, and conflating them is how an empty session renders as a v1 one.
  assert.equal(detectBlueprintSchema(null), null);
  assert.equal(detectBlueprintSchema(undefined), null);
  assert.equal(detectBlueprintSchema({}), null);
  assert.equal(detectBlueprintSchema({ sections: [] }), null);
  assert.equal(detectBlueprintSchema({ schema_version: 'something_else', sections: [{}] }), null);
});

test('sectionsOf never throws and never returns a non-array', () => {
  assert.deepEqual(sectionsOf(null), []);
  assert.deepEqual(sectionsOf({}), []);
  assert.deepEqual(sectionsOf({ sections: 'nope' }), []);
  assert.equal(sectionsOf(v2Blueprint()).length, 3);
});

// ---------------------------------------------------------------------------
// Geometry -- the bar convention
// ---------------------------------------------------------------------------

test('v2 duration is end_bar_exclusive - start_bar, with no +1', () => {
  const [a, b, c] = v2Blueprint().sections;
  // 17 - 1, 33 - 17, 41 - 33. An inclusive reading would say 17, 17, 9.
  assert.equal(sectionDurationBars(a), 16);
  assert.equal(sectionDurationBars(b), 16);
  assert.equal(sectionDurationBars(c), 8);
});

test('v1 endBar is inclusive and is adapted to exclusive exactly once', () => {
  const [a] = v1Blueprint().sections;
  assert.equal(sectionStartBar(a), 1);
  // v1 says endBar 16 -- the last bar *in* the section -- so the exclusive
  // bound is 17. The adapter adds the one, here, and nowhere else.
  assert.equal(sectionEndBarExclusive(a), 17);
  assert.equal(sectionDurationBars(a), 16);
  assert.equal(sectionDurationBars(a), a.lengthBars, 'the adapter must agree with v1 lengthBars');
});

test('v2 sections tile the song: each starts where the last ended', () => {
  const sections = v2Blueprint().sections;
  for (let i = 0; i < sections.length - 1; i++) {
    assert.equal(
      sectionStartBar(sections[i + 1]),
      sectionEndBarExclusive(sections[i]),
      `${sections[i + 1].id} does not start where ${sections[i].id} ended`,
    );
  }
});

test('every v2 section yields finite timeline geometry -- the fillRect(NaN) regression', () => {
  // The original bug: the timeline computed `(s.endBar - s.startBar + 1) *
  // pxPerBar`. Against a v2 section `s.endBar` is `undefined`, so the width was
  // `NaN`, and `ctx.fillRect(NaN, ...)` is silently a no-op in canvas -- every
  // v2 section vanished with no exception and nothing in the console.
  const pxPerBar = 12.5;
  const bp = v2Blueprint();

  for (const s of sectionsOf(bp)) {
    const bars = sectionDurationBars(s);
    assert.ok(bars !== null, `${s.id}: the model could not read a duration`);
    const width = bars * pxPerBar;
    assert.ok(
      Number.isFinite(width),
      `${s.id}: timeline width is ${width} -- this is the value that reaches fillRect`,
    );
    assert.ok(width > 0, `${s.id}: timeline width is ${width}, so nothing would be drawn`);
  }

  // The control. If this ever stops being NaN the first assertion has gone
  // vacuous -- the v1 expression would no longer be the bug it guards against.
  for (const s of sectionsOf(bp)) {
    const legacy = (s.endBar - s.startBar + 1) * pxPerBar;
    assert.ok(
      Number.isNaN(legacy),
      `${s.id}: the old v1 expression returned ${legacy} for a v2 section, so this test no longer proves anything`,
    );
  }
});

test('unreadable geometry is null, never NaN', () => {
  // A section missing its bars must be skipped visibly, not painted at NaN.
  assert.equal(sectionDurationBars({ id: 'x' }), null);
  assert.equal(sectionDurationBars({ start_bar: 1 }), null);
  assert.equal(sectionDurationBars(null), null);
  // A zero-length or inverted range is not a section either.
  assert.equal(sectionDurationBars({ start_bar: 5, end_bar_exclusive: 5 }), null);
  assert.equal(sectionDurationBars({ start_bar: 5, end_bar_exclusive: 2 }), null);
});

test('sectionMode reads both schemas and refuses to invent one', () => {
  assert.equal(sectionMode({ mode: 'ARENA' }), 'ARENA');
  assert.equal(sectionMode({}), null);
  assert.equal(sectionMode(null), null);
  assert.equal(sectionMode({ mode: 7 }), null);
});

// ---------------------------------------------------------------------------
// Transitions -- derived, not stored
// ---------------------------------------------------------------------------

test('v2 boundaries are derived from transition_out on the outgoing section', () => {
  const bp = v2Blueprint();
  bp.sections[0].transition_out = {
    kind: 'mode_swap',
    reason: 'cut the held note',
    breather_beats: 6,
    scene: [{ effect: 'wipe', params: {}, durationBeats: 4 }],
  };

  const [first, second] = boundariesOf(bp);
  assert.equal(boundariesOf(bp).length, 2, 'three sections have two seams');
  assert.equal(first.id, 'boundary:section_01');
  assert.equal(first.fromId, 'section_01');
  assert.equal(first.toId, 'section_02');
  assert.equal(first.bar, 17, 'a seam sits on the first bar of the incoming section');
  assert.equal(first.kind, 'mode_swap');
  assert.equal(first.reason, 'cut the held note');
  assert.equal(first.breatherBeats, 6);
  assert.equal(first.scene.length, 1);
  assert.ok(first.changesMode, 'ARENA -> RUNNER is a mode change');
  assert.ok(first.editable, 'v2 seams are editable');

  // No transition_out declared -- the seam still exists, it just has no intent.
  assert.equal(second.kind, null);
  assert.equal(second.reason, null);
  assert.ok(second.editable, 'the seam exists whether or not the director wrote one');
  assert.ok(second.changesMode, 'RUNNER -> ARENA is a mode change too');
});

test('v1 boundaries come from transitions[] and carry compiled geometry', () => {
  const bp = v1Blueprint();
  const [t] = boundariesOf(bp);
  assert.equal(boundariesOf(bp).length, 1);
  assert.equal(t.id, 'boundary:S01');
  assert.equal(t.kind, 'ARENA_TO_RUNNER');
  assert.equal(t.tailBars, 1);
  assert.equal(t.headBars, 1);
  assert.equal(t.scene.length, 1);
  assert.ok(!t.editable, 'v1 seams are rebuilt by regenerateSection, not edited directly');
});

test('a v2 blueprint with no transitions[] still yields its seams', () => {
  // This is the exact shape that produced `undefined.find`:
  // `state.blueprint?.transitions.find(...)` -- `?.` guards a missing
  // *blueprint*, not a missing *transitions*.
  const bp = v2Blueprint();
  assert.equal(bp.transitions, undefined);
  assert.equal(boundariesOf(bp).length, 2);
  assert.equal(boundariesOf(bp)[0].kind, null, 'and reading one does not throw');
});

test('a string transition_out becomes {reason} instead of being dropped', () => {
  // The director prompt only ever shows `"transition_out": null` and never
  // documents the object shape, so the model free-forms prose. The validator
  // reads `.breather_beats` and the compiler reads `.kind`/`.scene` -- all
  // undefined on a string -- so the intent was accepted and then thrown away.
  assert.deepEqual(normalizeTransitionOut('cut held notes on the downbeat'), {
    reason: 'cut held notes on the downbeat',
  });
  assert.deepEqual(normalizeTransitionOut('   '), null, 'blank prose carries no intent');
  assert.equal(normalizeTransitionOut(null), null);
  assert.equal(normalizeTransitionOut(undefined), null);

  const obj = { kind: 'wipe', breather_beats: 4 };
  assert.equal(normalizeTransitionOut(obj), obj, 'a real object passes through untouched');

  // And it reaches the boundary in that form.
  const bp = v2Blueprint();
  bp.sections[0].transition_out = 'cut held notes on the downbeat';
  const [first] = boundariesOf(bp);
  assert.equal(first.reason, 'cut held notes on the downbeat');
  assert.equal(first.kind, null, 'prose declares no kind, and none is invented');
});

test('findSection and findBoundary answer null rather than throwing', () => {
  const bp = v2Blueprint();
  assert.equal(findSection(bp, 'section_02').mode, 'RUNNER');
  assert.equal(findSection(bp, 'nope'), null);
  assert.equal(findSection(null, 'section_01'), null);
  assert.equal(findBoundary(bp, 'boundary:section_01').toId, 'section_02');
  assert.equal(findBoundary(bp, 'nope'), null);
  assert.equal(findBoundary(null, 'boundary:section_01'), null);
});

// ---------------------------------------------------------------------------
// Schema purity -- the hybrid is forbidden
// ---------------------------------------------------------------------------

test('a clean v2 blueprint is pure', () => {
  assert.deepEqual(assertV2Purity(v2Blueprint()), []);
});

test('a v2 blueprint that gains a v1 field is reported, wherever it lands', () => {
  // Top-level v1 fields.
  for (const field of V1_ONLY_FIELDS) {
    const bp = v2Blueprint();
    bp[field] = field === 'transitions' ? [] : field === 'difficultyCurve' ? [] : 1;
    const problems = assertV2Purity(bp);
    assert.ok(
      problems.some((p) => p.includes(`blueprint.${field}`)),
      `a v2 blueprint carrying \`${field}\` was not reported`,
    );
  }

  // And on a section, which is how it actually happened: v1 readers writing
  // `startBar`/`patterns` back onto v2 sections.
  const bp = v2Blueprint();
  bp.sections[0].startBar = 1;
  bp.sections[0].patterns = [];
  const problems = assertV2Purity(bp);
  assert.equal(problems.length, 2, problems.join(' | '));
  assert.ok(problems.some((p) => p.includes('section_01.startBar')));
  assert.ok(problems.some((p) => p.includes('section_01.patterns')));
});

test('purity does not apply to a v1 blueprint', () => {
  // v1 is allowed to be v1. The check exists to catch a v2 session drifting,
  // not to make the legacy path unrepresentable.
  assert.deepEqual(assertV2Purity(v1Blueprint()), []);
  assert.deepEqual(assertV2Purity(null), []);
});

// ---------------------------------------------------------------------------
// The constants the UI's dropdowns are built from must match the schema's
// ---------------------------------------------------------------------------

test('the model\'s mode and effect lists match the schema that validates them', async () => {
  // These are duplicated rather than imported because the browser must not pull
  // the whole generation tree in to render a <select>. Duplication is only safe
  // if it is checked, so it is checked here.
  const { GENERATABLE_MODES } = await import('../generation/gameplayContext.js');
  const {
    SCENE_EFFECTS: REAL_EFFECTS,
    SECTION_FUNCTIONS: REAL_FUNCTIONS,
  } = await import('../generation/blueprint.js');

  assert.deepEqual([...MODES].sort(), [...GENERATABLE_MODES].sort());
  assert.deepEqual([...SCENE_EFFECTS].sort(), [...REAL_EFFECTS].sort());
  assert.deepEqual([...SECTION_FUNCTIONS].sort(), [...REAL_FUNCTIONS].sort());
});

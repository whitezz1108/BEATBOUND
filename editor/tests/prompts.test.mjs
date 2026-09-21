/**
 * Prompt templates.
 *
 * The load-bearing checks: every template renders with no unfilled
 * placeholders, the values the prompts quote match the values the validator
 * enforces, and the templates state the rules the validator actually applies.
 * A prompt that promises a rule the code does not enforce teaches the model to
 * produce blueprints that fail validation -- so the last test here is a real
 * coupling between prose and behaviour, not a spelling check.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { PROMPTS, loadPrompt, renderPrompt, buildPrompt, breatherValues } from '../generation/prompts.js';
import { breatherBeats, SECTION_FUNCTIONS, ANCHOR_TYPES, GENERATOR_KINDS } from '../generation/blueprint.js';


/** The values every template needs to render completely. */
const FULL_VALUES = {
  DIRECTOR_CONTEXT: '{"source":{"song_id":"x"}}',
  GAMEPLAY_CONTEXT: '{"allowed_modes":["ARENA"]}',
  REQUEST: '{"primary_mode":"ARENA"}',
  SECTION: '{"id":"section_01"}',
  MICRO_CONTEXT: '{"bars":[]}',
  ERRORS: '["sections[2]: ..."]',
  BLUEPRINT: '{"schema_version":"beatbound_level_blueprint_v2"}',
  BREATHER_BEATS: '6.46',
  BREATHER_BARS: '1.62',
  BEATS_PER_BAR: '4',
  DURATION_SEC: '196.36',
};

test('every declared prompt file exists and is non-empty', () => {
  for (const name of Object.keys(PROMPTS)) {
    const text = loadPrompt(name);
    assert.ok(typeof text === 'string' && text.length > 200, `${name} looks empty`);
  }
});

test('an unknown prompt name is rejected with the known names', () => {
  assert.throws(() => loadPrompt('nope'), /unknown prompt/);
});

test('every template renders with no unfilled placeholders', () => {
  for (const name of Object.keys(PROMPTS)) {
    const { unfilled } = buildPrompt(name, FULL_VALUES);
    assert.deepEqual(unfilled, [], `${name} left placeholders unfilled: ${unfilled.join(', ')}`);
  }
});

test('an unfilled placeholder is left visible rather than blanked', () => {
  // A prompt that reaches the model saying {{DIRECTOR_CONTEXT}} is an obvious
  // bug; one with a silently empty section is a confusing one.
  const rendered = renderPrompt('before {{MISSING}} after', {});
  assert.equal(rendered, 'before {{MISSING}} after');
});

test('a null value is treated as unfilled', () => {
  assert.equal(renderPrompt('{{A}}', { A: null }), '{{A}}');
});

test('an object value is serialised as JSON', () => {
  assert.equal(renderPrompt('{{A}}', { A: { b: 1 } }), '{\n  "b": 1\n}');
});

test('JSON braces in a template are not mistaken for placeholders', () => {
  const rendered = renderPrompt('{"a": {"b": 1}}', {});
  assert.equal(rendered, '{"a": {"b": 1}}');
});

test('buildPrompt reports the version that lands in the manifest', () => {
  const { version, name } = buildPrompt('levelDirector', FULL_VALUES);
  assert.equal(version, 'level_director_v2');
  assert.equal(name, 'levelDirector');
  assert.equal(version, PROMPTS.levelDirector.version);
});

// ---------------------------------------------------------------------------
// The prompt must describe the validator that will actually run
// ---------------------------------------------------------------------------

test('the director prompt names every section function the validator accepts', () => {
  const text = loadPrompt('levelDirector');
  for (const fn of SECTION_FUNCTIONS) {
    assert.ok(text.includes(fn), `the prompt never mentions the ${fn} function`);
  }
});

test('the director prompt names every anchor type the validator accepts', () => {
  const text = loadPrompt('levelDirector');
  for (const type of ANCHOR_TYPES) {
    assert.ok(text.includes(type), `the prompt never mentions the ${type} anchor`);
  }
});

test('the director prompt defers to the gameplay context for the mode list', () => {
  // The prompt deliberately does NOT enumerate the modes: the gameplay context
  // is the authority on what this generation may use, and a hardcoded list in
  // the prose would drift away from it the moment the catalogue changes.
  const text = loadPrompt('levelDirector');
  assert.match(text, /Only use modes you were offered/);
  assert.match(text, /must be one of\s+`request\.allowed_modes`/);
  assert.match(text, /Do not invent pattern ids, mode names, anchor types/);
  assert.ok(text.includes('{{GAMEPLAY_CONTEXT}}'), 'the modes must arrive via the injected context');
});

test('the director prompt uses the same generator kind the validator accepts', () => {
  const text = loadPrompt('levelDirector');
  assert.ok(text.includes('ai_director'));
  assert.ok(GENERATOR_KINDS.includes('ai_director'));
});

test('the director prompt pins the schema version the validator requires', () => {
  assert.ok(loadPrompt('levelDirector').includes('beatbound_level_blueprint_v2'));
});

test('the director prompt states the difficulty and intensity bounds the validator enforces', () => {
  const text = loadPrompt('levelDirector');
  assert.match(text, /difficulty`? is an integer \*\*1–5\*\*/, 'the prompt must state the 1-5 difficulty range');
  assert.match(text, /intensity`? is a number \*\*0–1\*\*/, 'the prompt must state the 0-1 intensity range');
});

test('the director prompt states the half-open bar convention', () => {
  const text = loadPrompt('levelDirector');
  assert.match(text, /half-open/i);
  assert.ok(text.includes('end_bar_exclusive'), 'the prompt must name the exclusive end');
  assert.match(text, /bar_count \+ 1/, 'the prompt must say the last section ends at bar_count + 1');
});

test('the director prompt says courses are RUNNER-only', () => {
  const text = loadPrompt('levelDirector');
  assert.match(text, /course`? is \*\*only\*\* legal on a `RUNNER` section/);
});

test('the breather the prompts quote is the breather the validator enforces', () => {
  // The whole point of breatherValues: three templates quote a number, and the
  // validator computes one. If they disagree, the model is told a mode change
  // is legal exactly where the validator will reject it.
  const bpm = 129.2;
  const beatsPerBar = 4;
  const enforced = breatherBeats(bpm);
  const values = breatherValues(bpm, beatsPerBar, enforced);

  assert.equal(Number(values.BREATHER_BEATS), Number(enforced.toFixed(2)));
  assert.equal(Number(values.BREATHER_BARS), Number((enforced / beatsPerBar).toFixed(2)));
  assert.equal(values.BEATS_PER_BAR, String(beatsPerBar));

  const { unfilled } = buildPrompt('levelDirector', { ...FULL_VALUES, ...values });
  assert.deepEqual(unfilled, []);
});

test('the repair prompt quotes the same breather rule', () => {
  const text = loadPrompt('repair');
  assert.match(text, /`\{\{BREATHER_BEATS\}\}` beats of room/);
  assert.match(text, /`\{\{BREATHER_BARS\}\}` bars/);
});

test('the repair prompt requires the tiling invariant to survive the repair', () => {
  const text = loadPrompt('repair');
  assert.match(text, /cover the song exactly/);
  assert.match(text, /bar_count \+ 1/);
});

test('the repair prompt tells the model to fix only what was reported', () => {
  const text = loadPrompt('repair');
  assert.match(text, /Fix only what is reported/);
});

test('the micro prompt pins the section-bounded bar rule', () => {
  const text = loadPrompt('microChoreographer');
  assert.ok(text.includes('end_bar_exclusive'));
  assert.match(text, /Stay inside the section/);
  assert.match(text, /DURATION_SEC/);
});

test('the micro prompt names the breather exclusion for a mode change', () => {
  const text = loadPrompt('microChoreographer');
  assert.match(text, /breather/);
  assert.match(text, /\{\{BREATHER_BARS\}\}/);
});

test('every prompt forbids prose around the JSON', () => {
  for (const name of Object.keys(PROMPTS)) {
    const text = loadPrompt(name);
    assert.match(
      text,
      /only\*\* the JSON|only\*\* the JSON|no code fence/i,
      `${name} does not tell the model to emit bare JSON`,
    );
  }
});

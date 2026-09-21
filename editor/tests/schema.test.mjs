/**
 * Schema / implementation drift.
 *
 * The JSON Schema files under editor/schemas are the *published contract* for
 * the generated documents; the validators in editor/generation are the
 * *enforcement*. Nothing in the editor has a JSON Schema library (the editor is
 * deliberately dependency-free), so the two are maintained separately and would
 * otherwise be free to drift apart -- a schema that promises an enum the
 * validator does not know about, or vice versa.
 *
 * These tests are the coupling. They also check the schemas against each other
 * where one references the other's vocabulary: a blueprint sync point names an
 * anchor type, so the two anchor enums must be the same list.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import {
  BLUEPRINT_V2_SCHEMA_VERSION,
  MIN_DIFFICULTY,
  MAX_DIFFICULTY,
  SECTION_FUNCTIONS,
  ANCHOR_TYPES,
  SCENE_EFFECTS,
  GENERATOR_KINDS,
  validateBlueprint,
} from '../generation/blueprint.js';
import { GENERATABLE_MODES } from '../generation/gameplayContext.js';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const readSchema = (name) => JSON.parse(readFileSync(`${ROOT}editor/schemas/${name}`, 'utf8'));

const blueprintSchema = readSchema('level-blueprint-v2.schema.json');
const directorSchema = readSchema('director-context-v2.schema.json');
const sectionDef = blueprintSchema.$defs.section;

test('both schemas are Draft 2020-12 and declare a $id', () => {
  for (const [name, s] of [
    ['level-blueprint-v2', blueprintSchema],
    ['director-context-v2', directorSchema],
  ]) {
    assert.match(s.$schema, /2020-12/, `${name} must be Draft 2020-12`);
    assert.ok(typeof s.$id === 'string' && s.$id.length > 0, `${name} needs an $id`);
  }
});

test('the blueprint schema pins the same schema_version the validator does', () => {
  assert.equal(blueprintSchema.properties.schema_version.const, BLUEPRINT_V2_SCHEMA_VERSION);
});

test('the section function enum matches SECTION_FUNCTIONS', () => {
  assert.deepEqual(sectionDef.properties.function.enum, SECTION_FUNCTIONS);
});

test('the section mode enum matches GENERATABLE_MODES', () => {
  assert.deepEqual(sectionDef.properties.mode.enum, GENERATABLE_MODES);
});

test('the difficulty bounds match the validator constants', () => {
  assert.equal(sectionDef.properties.difficulty.minimum, MIN_DIFFICULTY);
  assert.equal(sectionDef.properties.difficulty.maximum, MAX_DIFFICULTY);
  assert.equal(sectionDef.properties.difficulty.type, 'integer');
});

test('the intensity bounds match the validator constants', () => {
  assert.equal(sectionDef.properties.intensity.minimum, 0);
  assert.equal(sectionDef.properties.intensity.maximum, 1);
});

test('the sync point anchor enum matches ANCHOR_TYPES', () => {
  const enumValues = blueprintSchema.properties.sync_points.items.properties.anchor_type.enum;
  assert.deepEqual(enumValues, ANCHOR_TYPES);
});

test('the scene effect enum matches SCENE_EFFECTS', () => {
  const enumValues =
    sectionDef.properties.transition_out.oneOf[1].properties.scene.items.properties.effect.enum;
  assert.deepEqual(enumValues, SCENE_EFFECTS);
});

test('the generator kind enum matches GENERATOR_KINDS', () => {
  assert.deepEqual(blueprintSchema.properties.generator.properties.kind.enum, GENERATOR_KINDS);
});

test('the blueprint and director-context anchor vocabularies are the same list', () => {
  // A blueprint sync point claims an anchor type that the director context is
  // supposed to have offered. If these two lists ever diverge, every claim
  // about the differing types becomes permanently unverifiable.
  const directorAnchors = directorSchema.$defs.anchor.properties.type.enum;
  assert.deepEqual(ANCHOR_TYPES, directorAnchors);
});

test('the request mode enums match GENERATABLE_MODES', () => {
  assert.deepEqual(blueprintSchema.properties.request.properties.primary_mode.enum, GENERATABLE_MODES);
  assert.deepEqual(blueprintSchema.properties.request.properties.allowed_modes.items.enum, GENERATABLE_MODES);
});

test('every field the schema requires is one the validator actually enforces', () => {
  // The schema says a blueprint is invalid without these. If the validator
  // shrugged at a missing one, a document could pass the pipeline while
  // violating the published contract.
  const cases = [
    ['generator', (b) => delete b.generator],
    ['song', (b) => delete b.song],
    ['request', (b) => delete b.request],
    ['global', (b) => delete b.global],
    ['sections', (b) => delete b.sections],
  ];
  for (const [field, mutate] of cases) {
    assert.ok(
      blueprintSchema.required.includes(field),
      `the schema does not actually require ${field} -- the test list is stale`,
    );
  }

  const base = minimalBlueprint();
  for (const [field, mutate] of cases) {
    const bp = JSON.parse(JSON.stringify(base));
    mutate(bp);
    const { errors } = validateBlueprint(bp, { directorContext: null, gameplayContext: null, patternIndex: null });
    assert.ok(errors.length > 0, `removing ${field} produced no error`);
  }
});

test('every section field the schema requires is one the validator enforces', () => {
  const required = sectionDef.required;
  const base = minimalBlueprint();
  for (const field of required) {
    const bp = JSON.parse(JSON.stringify(base));
    delete bp.sections[0][field];
    const { errors } = validateBlueprint(bp, { directorContext: null, gameplayContext: null, patternIndex: null });
    assert.ok(errors.length > 0, `removing sections[0].${field} produced no error`);
  }
});

test('the schema and the validator agree that a minimal blueprint is valid', () => {
  const { errors } = validateBlueprint(minimalBlueprint(), {
    directorContext: null,
    gameplayContext: null,
    patternIndex: null,
  });
  assert.deepEqual(errors, [], 'a blueprint satisfying every schema requirement must validate');
});

/**
 * The smallest blueprint that satisfies the schema, with no music context at
 * all -- so only the self-contained structural rules are in play.
 */
function minimalBlueprint() {
  return {
    schema_version: BLUEPRINT_V2_SCHEMA_VERSION,
    generator: { kind: 'rule_based', model: null, prompt_version: 'test', created_from: 'test' },
    song: {
      id: 'x', title: 'x', audio: 'x.wav', bpm: 120,
      timeSignature: [4, 4], barCount: 4, durationSec: 8,
    },
    request: {
      primary_mode: 'ARENA', allowed_modes: ['ARENA'],
      target_difficulty: 3, primary_mode_ratio: 1, seed: 1,
    },
    global: { intent: 'x', arc: 'x', difficulty_curve: [3, 3, 3, 3] },
    sections: [
      {
        id: 'section_01', start_bar: 1, end_bar_exclusive: 5, mode: 'ARENA',
        function: 'INTRO', difficulty: 3, intensity: 0.5, rationale: 'x',
        pattern_families: [], pattern_ids: [], energy_band: 'MID',
        course: null, transition_out: null,
      },
    ],
    sync_points: [],
    notes: [],
  };
}

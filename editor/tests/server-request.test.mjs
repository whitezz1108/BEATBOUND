/**
 * Tests for the editor server's request resolution.
 *
 * These are cheap and they are the whole point of extracting the function:
 * every check runs before the model is called, so what is being pinned here is
 * "a bad request fails without spending a request". The alternative -- a typo
 * in a preset id reaching the API and coming back as a 400 from DeepSeek -- is
 * exactly the failure this prevents.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { resolveGenerationRequest } from '../server/requests.js';
import { PRESET_IDS } from '../generation/presets.js';

test('a bare body falls back to the default preset', () => {
  const request = resolveGenerationRequest({});
  assert.equal(request.primary_mode, 'ARENA');
  assert.ok(request.allowed_modes.includes('ARENA'));
  assert.equal(typeof request.target_difficulty, 'number');
  assert.equal(typeof request.primary_mode_ratio, 'number');
});

test('an unknown preset is refused, and refused by name', () => {
  assert.throws(() => resolveGenerationRequest({ preset: 'no_such_preset' }), /no_such_preset/);
});

test('every advertised preset resolves', () => {
  for (const id of PRESET_IDS) {
    const request = resolveGenerationRequest({ preset: id });
    assert.ok(request.allowed_modes.includes(request.primary_mode), `${id} excludes its own primary mode`);
  }
});

test('explicit fields override the preset', () => {
  const request = resolveGenerationRequest({
    preset: 'arena_primary',
    primary_mode: 'RUNNER',
    allowed_modes: ['RUNNER', 'VERTICAL'],
    difficulty: 5,
    ratio: 0.9,
    seed: 77,
  });
  assert.equal(request.primary_mode, 'RUNNER');
  assert.deepEqual(request.allowed_modes, ['RUNNER', 'VERTICAL']);
  assert.equal(request.target_difficulty, 5);
  assert.equal(request.primary_mode_ratio, 0.9);
  assert.equal(request.seed, 77);
});

test('a primary mode outside the allowed list is added to it, not rejected', () => {
  // buildRequest widens rather than throwing: asking for RUNNER primary while
  // listing only ARENA is a UI slip, not a reason to fail a whole generation.
  const request = resolveGenerationRequest({ primary_mode: 'RUNNER', allowed_modes: ['ARENA'] });
  assert.equal(request.primary_mode, 'RUNNER');
  assert.deepEqual(request.allowed_modes, ['RUNNER', 'ARENA']);
});

test('an explicit request wins over the preset', () => {
  const explicit = {
    primary_mode: 'VERTICAL',
    allowed_modes: ['VERTICAL'],
    target_difficulty: 2,
    primary_mode_ratio: 1,
    seed: 3,
  };
  assert.deepEqual(resolveGenerationRequest({ preset: 'arena_primary', request: explicit }), explicit);
});

test("a supplied blueprint's own request wins over the preset", () => {
  // The request is part of the blueprint artifact. Overriding it would make a
  // replay generate something the manifest does not describe.
  const blueprint = {
    request: {
      primary_mode: 'RADIAL',
      allowed_modes: ['RADIAL', 'ARENA'],
      target_difficulty: 4,
      primary_mode_ratio: 0.7,
      seed: 11,
    },
  };
  const request = resolveGenerationRequest({ preset: 'gentle', blueprint });
  assert.equal(request.primary_mode, 'RADIAL');
  assert.equal(request.seed, 11);
});

test('a blueprint without a request keeps the preset-derived one', () => {
  const request = resolveGenerationRequest({ preset: 'gentle', blueprint: { sections: [] } });
  assert.equal(request.primary_mode, 'ARENA');
});

test('a non-object blueprint is refused before anything runs', () => {
  for (const blueprint of [null, 'nope', 42, true]) {
    assert.throws(() => resolveGenerationRequest({ blueprint }), /blueprint must be a JSON object/);
  }
});

test('an invalid difficulty is refused', () => {
  assert.throws(() => resolveGenerationRequest({ difficulty: 9 }), /difficulty/i);
});

test('an invalid ratio is refused', () => {
  assert.throws(() => resolveGenerationRequest({ ratio: 1.5 }), /ratio/i);
});

test('an empty allowed-modes list is refused', () => {
  assert.throws(() => resolveGenerationRequest({ allowed_modes: [] }), /mode/i);
});

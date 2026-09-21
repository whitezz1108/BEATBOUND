/**
 * Generation presets -- named answers to "what kind of level do you want?".
 *
 * A preset is not a level template. It fixes only the *ask*: which mode should
 * carry the song, which modes are available to it, how hard it should be, and
 * how much of the song the primary mode should own. Everything about the shape
 * of the level -- where sections fall, what they do, which patterns fill them --
 * is still the director's decision, made against the actual music.
 *
 * `primary_mode_ratio` is the interesting one. It is a constraint the validator
 * enforces, not a hint: a preset that asks for 0.7 and gets 0.4 back is a
 * failed generation. So the presets below are deliberately loose enough that a
 * director working from real sections can satisfy them, and `validateRequest`
 * refuses a ratio the music cannot support before a single token is spent.
 */

import { GENERATABLE_MODES } from './gameplayContext.js';

export const PRESET_VERSION = '1.0.0';

/**
 * @typedef {object} Preset
 * @property {string} id
 * @property {string} name
 * @property {string} description
 * @property {string} primary_mode
 * @property {string[]} allowed_modes
 * @property {number} target_difficulty  1..5
 * @property {number} primary_mode_ratio 0..1, share of bars the primary mode owns
 */

/** @type {Record<string, Preset>} */
export const PRESETS = {
  arena_primary: {
    id: 'arena_primary',
    name: 'Arena Primary',
    description:
      'The song is an ARENA set piece. ARENA carries most of it; RUNNER and VERTICAL break the ' +
      'longer builds so the level has somewhere to go.',
    primary_mode: 'ARENA',
    allowed_modes: ['ARENA', 'RUNNER', 'VERTICAL'],
    target_difficulty: 3,
    primary_mode_ratio: 0.5,
  },
  runner_primary: {
    id: 'runner_primary',
    name: 'Runner Primary',
    description:
      'The song is a run. RUNNER owns the body of it, with ARENA sections where the music opens ' +
      'up into something with room to move.',
    primary_mode: 'RUNNER',
    allowed_modes: ['RUNNER', 'ARENA', 'VERTICAL'],
    target_difficulty: 3,
    primary_mode_ratio: 0.5,
  },
  vertical_primary: {
    id: 'vertical_primary',
    name: 'Vertical Primary',
    description: 'A climbing set. VERTICAL carries the song, with ARENA for the peaks.',
    primary_mode: 'VERTICAL',
    allowed_modes: ['VERTICAL', 'ARENA', 'RUNNER'],
    target_difficulty: 3,
    primary_mode_ratio: 0.5,
  },
  showcase: {
    id: 'showcase',
    name: 'Showcase',
    description:
      'Rotate through every mode so each gets a real turn. The loosest ratio of the set -- it ' +
      'asks only that no single mode is starved.',
    primary_mode: 'ARENA',
    allowed_modes: ['ARENA', 'RUNNER', 'VERTICAL', 'RADIAL'],
    target_difficulty: 3,
    primary_mode_ratio: 0.3,
  },
  single_mode: {
    id: 'single_mode',
    name: 'Single Mode',
    description:
      'One mode for the whole song, with no mode changes at all. The purest read of the music: ' +
      'every section boundary is a musical one.',
    primary_mode: 'ARENA',
    allowed_modes: ['ARENA'],
    target_difficulty: 3,
    primary_mode_ratio: 1,
  },
  gentle: {
    id: 'gentle',
    name: 'Gentle',
    description: 'Low difficulty throughout -- an easy read of the song, for warming up.',
    primary_mode: 'ARENA',
    allowed_modes: ['ARENA', 'RUNNER'],
    target_difficulty: 1,
    primary_mode_ratio: 0.5,
  },
  demanding: {
    id: 'demanding',
    name: 'Demanding',
    description: 'High difficulty throughout, for a song that can carry it.',
    primary_mode: 'ARENA',
    allowed_modes: ['ARENA', 'RUNNER', 'VERTICAL'],
    target_difficulty: 5,
    primary_mode_ratio: 0.5,
  },
};

export const PRESET_IDS = Object.keys(PRESETS);

/** Look a preset up by id, or return a copy of it. */
export function getPreset(id) {
  if (typeof id === 'string') {
    const preset = PRESETS[id];
    if (!preset) {
      throw new Error(`unknown preset ${JSON.stringify(id)}; expected one of ${PRESET_IDS.join(', ')}`);
    }
    return { ...preset, allowed_modes: [...preset.allowed_modes] };
  }
  if (id && typeof id === 'object') {
    const preset = { ...id, allowed_modes: [...(id.allowed_modes ?? [])] };
    validatePreset(preset);
    return preset;
  }
  throw new Error('getPreset: expected a preset id or a preset object');
}

/**
 * Check a preset's internal consistency.
 *
 * These are authoring mistakes, not generation outcomes, so they throw rather
 * than being reported in the manifest.
 */
export function validatePreset(preset) {
  const problems = [];
  if (!GENERATABLE_MODES.includes(preset.primary_mode)) {
    problems.push(`primary_mode ${JSON.stringify(preset.primary_mode)} is not generatable`);
  }
  if (!Array.isArray(preset.allowed_modes) || preset.allowed_modes.length === 0) {
    problems.push('allowed_modes must be a non-empty array');
  } else {
    for (const m of preset.allowed_modes) {
      if (!GENERATABLE_MODES.includes(m)) problems.push(`allowed_modes contains ${JSON.stringify(m)}, which is not generatable`);
    }
    if (!preset.allowed_modes.includes(preset.primary_mode)) {
      problems.push(`primary_mode ${preset.primary_mode} must also be in allowed_modes`);
    }
  }
  if (!Number.isInteger(preset.target_difficulty) || preset.target_difficulty < 1 || preset.target_difficulty > 5) {
    problems.push(`target_difficulty must be an integer 1..5 (got ${preset.target_difficulty})`);
  }
  if (!(preset.primary_mode_ratio >= 0 && preset.primary_mode_ratio <= 1)) {
    problems.push(`primary_mode_ratio must be 0..1 (got ${preset.primary_mode_ratio})`);
  }
  if (problems.length > 0) {
    throw new Error(`invalid preset ${JSON.stringify(preset.id ?? preset.name)}: ${problems.join('; ')}`);
  }
  return preset;
}

/**
 * Turn a preset plus CLI overrides into the `request` block of a blueprint.
 *
 * `seed` is required and explicit: the same song, preset and seed must always
 * produce the same level, so there is no default that quietly changes between
 * runs.
 */
export function buildRequest({ preset, primaryMode, allowedModes, difficulty, ratio, seed } = {}) {
  const base = getPreset(preset ?? 'arena_primary');
  const request = {
    primary_mode: primaryMode ?? base.primary_mode,
    allowed_modes: allowedModes ? [...allowedModes] : [...base.allowed_modes],
    target_difficulty: difficulty ?? base.target_difficulty,
    primary_mode_ratio: ratio ?? base.primary_mode_ratio,
    seed: seed ?? 1,
  };
  if (primaryMode && !request.allowed_modes.includes(primaryMode)) {
    request.allowed_modes = [primaryMode, ...request.allowed_modes];
  }
  return request;
}

/** A one-line description of a request, for logs and the manifest. */
export function describeRequest(request) {
  return (
    `${request.primary_mode} primary, ${request.allowed_modes.join('/')} allowed, ` +
    `difficulty ${request.target_difficulty}, ratio ${request.primary_mode_ratio}, seed ${request.seed}`
  );
}

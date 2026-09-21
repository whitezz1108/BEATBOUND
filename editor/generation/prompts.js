/**
 * Prompt templates.
 *
 * Prompts are files, not string literals, for one reason: a generated level has
 * to be reproducible, and "which prompt produced this?" is part of that. Each
 * template carries a version in its filename and is recorded in the generation
 * manifest, so a blueprint can be traced back to the exact instructions that
 * produced it.
 *
 * Placeholders are `{{NAME}}` and are substituted verbatim -- prompts contain
 * JSON examples with braces, so any cleverer templating would corrupt them.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const PROMPT_DIR = fileURLToPath(new URL('./prompts/', import.meta.url));

/**
 * The templates the pipeline uses. `version` is what lands in the manifest and
 * in `generator.prompt_version`.
 */
export const PROMPTS = {
  levelDirector: { file: 'level_director_v2.md', version: 'level_director_v2' },
  microChoreographer: { file: 'micro_choreographer_v1.md', version: 'micro_choreographer_v1' },
  repair: { file: 'repair_v1.md', version: 'repair_v1' },
};

const cache = new Map();

/** Load a template's raw text. */
export function loadPrompt(name, { dir = PROMPT_DIR } = {}) {
  const spec = PROMPTS[name];
  if (!spec) {
    throw new Error(`unknown prompt ${JSON.stringify(name)}; known: ${Object.keys(PROMPTS).join(', ')}`);
  }
  const key = `${dir}${spec.file}`;
  if (!cache.has(key)) {
    cache.set(key, readFileSync(key, 'utf8'));
  }
  return cache.get(key);
}

/**
 * Substitute `{{NAME}}` placeholders.
 *
 * A placeholder with no value is left in place rather than blanked: a prompt
 * that reaches the model saying `{{DIRECTOR_CONTEXT}}` is an obvious bug, while
 * one with a silently empty section is a confusing one.
 */
export function renderPrompt(template, values) {
  return template.replace(/\{\{([A-Z0-9_]+)\}\}/g, (match, name) => {
    if (!(name in values)) return match;
    const value = values[name];
    if (value === null || value === undefined) return match;
    return typeof value === 'string' ? value : JSON.stringify(value, null, 2);
  });
}

/**
 * Load and render a template in one step.
 *
 * @returns {{text: string, version: string, name: string, unfilled: string[]}}
 */
export function buildPrompt(name, values, { dir } = {}) {
  const spec = PROMPTS[name];
  const text = renderPrompt(loadPrompt(name, { dir }), values);
  return {
    text,
    version: spec.version,
    name,
    // Anything left unfilled -- the caller can assert this is empty in tests
    // and surface it in diagnostics rather than sending a broken prompt.
    unfilled: [...new Set(text.match(/\{\{[A-Z0-9_]+\}\}/g) ?? [])],
  };
}

/**
 * The breather values every prompt that talks about mode changes needs.
 *
 * Kept here so the three templates cannot disagree about how long a breather
 * is -- the number they quote has to be the number the validator enforces.
 */
export function breatherValues(bpm, beatsPerBar, breatherBeatsValue) {
  // `breatherBeats` rounds like the runtime, so this is normally a whole number
  // and "6" reads better in a prompt than "6.00". A fractional floor from
  // unusual tuning still renders, just with two decimals.
  const num = (v) => (Number.isInteger(v) ? String(v) : v.toFixed(2));
  return {
    BREATHER_BEATS: num(breatherBeatsValue),
    BREATHER_BARS: num(breatherBeatsValue / beatsPerBar),
    BEATS_PER_BAR: String(beatsPerBar),
  };
}

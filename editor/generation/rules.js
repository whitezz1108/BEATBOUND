/**
 * Rules loading, shared by the editor server and the generation pipeline.
 *
 * Two things live here, and both exist for the same reason -- the editor must
 * never act on a value the game owns:
 *
 *   1. the three rules JSON files (gameplay / difficulty / transition)
 *   2. a mirror of the live `TUNING.transition` block parsed out of
 *      `src/tuning.ts`, injected *over* the JSON fallback
 *
 * `src/tuning.ts` is the authority. The rules JSON carries an offline fallback
 * for when the game source cannot be read; a disagreement between the two is
 * reported as a note rather than silently generating levels against a stale
 * number. This is the same mechanism `editor/generator/breather.js` documents,
 * hoisted so the server and the pipeline share one implementation.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

export const PROJECT_ROOT = fileURLToPath(new URL('../..', import.meta.url));

/** Fields of TUNING.transition the editor needs. */
export const TUNING_FIELDS = ['breatherBeats', 'countdownSeconds', 'sceneBeats'];

/** Offline fallbacks, used only when src/tuning.ts cannot be parsed. */
export const TUNING_FALLBACK = { breatherBeats: 6, countdownSeconds: 3, sceneBeats: 2 };

/**
 * Parse the live TUNING.transition block out of the game source.
 *
 * Returns `{values, source, missing}`; `values` holds only what was read, so a
 * caller can tell "the game says 6" from "we fell back to 6".
 */
export function readTuningMirror({ projectRoot = PROJECT_ROOT } = {}) {
  const mirror = { values: {}, source: null, missing: [] };
  let src;
  try {
    src = readFileSync(path.join(projectRoot, 'src', 'tuning.ts'), 'utf8');
  } catch (err) {
    mirror.missing.push(`src/tuning.ts unreadable (${err.message})`);
    return mirror;
  }
  const block = src.match(/transition:\s*\{([\s\S]*?)\n\s*\},/);
  if (!block) {
    mirror.missing.push('TUNING.transition block');
    return mirror;
  }
  for (const name of TUNING_FIELDS) {
    const m = block[1].match(new RegExp(`${name}\\s*:\\s*(\\d+(?:\\.\\d+)?)`));
    if (!m) mirror.missing.push(`TUNING.transition.${name}`);
    else mirror.values[name] = Number(m[1]);
  }
  mirror.source = 'src/tuning.ts';
  return mirror;
}

/**
 * Load the three rules files with the live tuning injected.
 *
 * @returns {{rules: object, notes: string[], tuning: object}}
 */
export function loadRulesWithTuning({ projectRoot = PROJECT_ROOT, mirror } = {}) {
  const read = (name) => JSON.parse(readFileSync(path.join(projectRoot, 'editor', 'rules', name), 'utf8'));
  const rules = {
    gameplay: read('gameplay-rules.json'),
    difficulty: read('difficulty-rules.json'),
    transition: read('transition-rules.json'),
  };

  const live = mirror ?? readTuningMirror({ projectRoot });
  const notes = [];
  const tuning = { ...TUNING_FALLBACK };

  for (const name of TUNING_FIELDS) {
    const gameValue = live.values[name];
    if (gameValue === undefined) {
      notes.push(`Could not read TUNING.transition.${name} from src/tuning.ts -- using the fallback ${TUNING_FALLBACK[name]}.`);
      continue;
    }
    tuning[name] = gameValue;
    // Two mirrors exist for breatherBeats: gameplay-rules.json and
    // transition-rules.json. Report either disagreeing with the game.
    for (const [file, block] of [
      ['gameplay-rules.json', rules.gameplay?.transition],
      ['transition-rules.json', rules.transition],
    ]) {
      const mirrored = block?.[name];
      if (mirrored !== undefined && mirrored !== gameValue) {
        notes.push(
          `${file} ${name} (${mirrored}) differs from src/tuning.ts (${gameValue}) -- the live game value is used. ` +
            `Update the rules JSON mirror.`,
        );
      }
    }
  }

  // Inject over the JSON so every downstream reader sees one number.
  rules.gameplay.transition = { ...rules.gameplay.transition, ...tuning };
  rules.transition = { ...rules.transition, ...tuning };

  return { rules, notes, tuning };
}

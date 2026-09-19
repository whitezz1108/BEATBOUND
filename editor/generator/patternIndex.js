/**
 * Pattern index: the live pattern library merged with the editor's curated
 * annotations. Pattern ids, names, difficulties, lengths and events always
 * come from beatbound_library_v1/patterns.mvp.json -- the single source of
 * truth -- while family / energy / group tags come from
 * editor/patterns/annotations.json.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// This file lives at <root>/editor/generator/patternIndex.js, so the project
// root is two levels up.
const PROJECT_ROOT = fileURLToPath(new URL('../..', import.meta.url));

/** Load the merged index from disk (cached per process). */
let cached = null;
export function loadPatternIndex({ projectRoot = PROJECT_ROOT } = {}) {
  if (cached) return cached;
  const libPath = `${projectRoot}/beatbound_library_v1/patterns.mvp.json`;
  const annPath = `${projectRoot}/editor/patterns/annotations.json`;
  const lib = JSON.parse(readFileSync(libPath, 'utf8'));
  const annotations = JSON.parse(readFileSync(annPath, 'utf8'));

  const entries = lib.patterns.map((p) => {
    const ann = annotations.patterns[p.id] ?? {};
    // Which bars of the pattern actually contain a mechanic activation. The
    // runtime's timing test (`npm run test:timing`) flags any bar without an
    // activation as dead air, so patterns that only activate in some of their
    // bars (e.g. 2-bar holds whose hold runs across the second bar) must not
    // be auto-placed end-to-end. They stay hand-pickable in the UI.
    const eventBars = [...new Set(p.events.map((e) => e.at.bar))];
    // Activation offsets (0-based beats) within the pattern's LAST bar. When a
    // mode-change breather cuts a section mid-bar, the editor may only place a
    // pattern in the final bar if it activates before the breather starts --
    // otherwise that bar plays as dead air. Beat 1-based in the library.
    const finalBarOffsets = [
      ...new Set(
        p.events.filter((e) => e.at.bar === p.lengthBars).map((e) => (e.at.beat ?? 1) - 1)
      ),
    ].sort((a, b) => a - b);
    return {
      id: p.id,
      name: p.name,
      mode: p.mode,
      function: p.function,
      difficulty: p.difficulty.overall,
      difficultyAxes: p.difficulty,
      lengthBars: p.lengthBars,
      musicTags: p.musicTags ?? {},
      constraints: p.constraints ?? {},
      family: ann.family ?? 'unassigned',
      energy: ann.energy ?? 'MID',
      groups: ann.groups ?? [],
      recovery: (annotations.meta.recoveryByMode[p.mode] ?? []).includes(p.id),
      teach: (annotations.meta.teachByMode[p.mode] ?? []).includes(p.id),
      eventBars,
      fullCoverage: eventBars.length >= Math.ceil(p.lengthBars),
      finalBarOffsets,
      finalBarFirstOffset: finalBarOffsets.length > 0 ? finalBarOffsets[0] : 0,
      finalBarLastOffset:
        finalBarOffsets.length > 0 ? finalBarOffsets[finalBarOffsets.length - 1] : 0,
      events: p.events,
    };
  });

  cached = {
    version: lib.version,
    entries,
    byId: new Map(entries.map((e) => [e.id, e])),
    byMode: new Map(
      ['ARENA', 'RUNNER', 'VERTICAL', 'RADIAL'].map((mode) => [
        mode,
        entries.filter((e) => e.mode === mode),
      ])
    ),
    meta: annotations.meta,
  };
  return cached;
}

/** Energy band names in ascending order, for comparisons. */
export const ENERGY_ORDER = ['LOW', 'MID', 'HIGH', 'PEAK'];

export function energyRank(energy) {
  return ENERGY_ORDER.indexOf(energy);
}

/** Recovery patterns for a mode (transition tails). */
export function recoveryPatterns(index, mode) {
  return index.byMode.get(mode).filter((p) => p.recovery);
}

/** Teach patterns for a mode (transition heads, first sections). */
export function teachPatterns(index, mode) {
  return index.byMode.get(mode).filter((p) => p.teach);
}

/**
 * Patterns whose family matches any of `families`, ordered by |difficulty -
 * targetDifficulty|. Used by the UI to offer sensible per-section defaults.
 */
export function candidatesFor(index, mode, { difficulty, families }) {
  let pool = index.byMode.get(mode);
  if (families && families.length > 0) {
    const want = new Set(families);
    const filtered = pool.filter((p) => want.has(p.family));
    if (filtered.length > 0) pool = filtered;
  }
  return [...pool].sort(
    (a, b) =>
      Math.abs(a.difficulty - difficulty) - Math.abs(b.difficulty - difficulty) ||
      a.id.localeCompare(b.id)
  );
}

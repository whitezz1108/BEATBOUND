/**
 * Structural validation of a compiled level against the same rules the
 * runtime's LevelLoader enforces (src/core/LevelLoader.ts validate()):
 * known patterns, mode agreement, repeat/intensity bounds, no overlaps or
 * gaps, and section length vs. pattern coverage. Kept as a mirror so the
 * editor never writes a level the game would refuse.
 *
 * The authoritative check is still `npm run level -- <file>`, which runs the
 * real LevelLoader headlessly; the editor's "Run checks" button offers it.
 */

import { loadPatternIndex } from './patternIndex.js';

const MODES = ['ARENA', 'RUNNER', 'VERTICAL', 'RADIAL', 'DUO'];

export function validateLevel(level, { projectRoot, breatherBeats = 6 } = {}) {
  const errors = [];
  const warnings = [];
  const index = loadPatternIndex({ projectRoot });

  if (!level.song) errors.push('level.song is missing');
  else {
    if (!(level.song.bpm > 0)) errors.push(`song.bpm must be > 0 (got ${level.song.bpm})`);
    if (!Array.isArray(level.song.timeSignature) || level.song.timeSignature.length !== 2) {
      errors.push('song.timeSignature must be a [numerator, denominator] pair');
    }
  }
  if (!Array.isArray(level.sections) || level.sections.length === 0) {
    errors.push('level.sections must be a non-empty array');
    return { errors, warnings };
  }

  let previousEnd = 0;
  const beatsPerBar = level.song?.timeSignature?.[0] ?? 4;
  for (let si = 0; si < level.sections.length; si++) {
    const section = level.sections[si];
    const next = level.sections[si + 1] ?? null;
    const where = `section "${section.id}"`;
    if (!MODES.includes(section.mode)) errors.push(`${where}: unknown mode "${section.mode}"`);
    if (!(section.startBar >= 1)) errors.push(`${where}: startBar must be >= 1`);
    if (!(section.lengthBars >= 1)) errors.push(`${where}: lengthBars must be >= 1`);
    if (previousEnd > 0 && section.startBar < previousEnd) {
      errors.push(
        `${where}: starts at bar ${section.startBar}, overlapping the previous section which ends at bar ${previousEnd}`
      );
    }
    if (previousEnd > 0 && section.startBar > previousEnd) {
      warnings.push(
        `${where}: gap of ${section.startBar - previousEnd} bar(s) before it (bars ${previousEnd}-${section.startBar - 1} are empty)`
      );
    }
    previousEnd = section.startBar + section.lengthBars;

    // The runtime's mode-change breather: everything at >= breatherFromBeat
    // is dropped by PatternScheduler, and test:timing exempts those bars.
    // Mirror that here so "silent" bars in the breather are not flagged and
    // placements poking into it are.
    const sectionStartBeat = (section.startBar - 1) * beatsPerBar;
    const sectionEndBeat = sectionStartBeat + section.lengthBars * beatsPerBar;
    const breather =
      next !== null && next.mode !== section.mode && breatherBeats > 0
        ? sectionEndBeat - breatherBeats
        : null;
    const breatherBar = breather !== null ? Math.floor(breather / beatsPerBar) + 1 : Infinity;

    if (!Array.isArray(section.patterns)) {
      errors.push(`${where}: patterns must be an array`);
      continue;
    }
    if (section.patterns.length === 0) {
      warnings.push(`${where}: has no patterns -- the mode runs with no hazards`);
      continue;
    }

    let barsUsed = 0;
    let cursorBar = 0; // bars into the section, for absolute activation beats
    for (const placement of section.patterns) {
      const pattern = index.byId.get(placement.patternId);
      if (!pattern) {
        errors.push(`${where}: references unknown patternId "${placement.patternId}"`);
        continue;
      }
      if (pattern.mode !== section.mode) {
        warnings.push(
          `${where}: pattern ${pattern.id} is a ${pattern.mode} pattern but the section mode is ${section.mode}`
        );
      }
      const repeat = placement.repeat ?? 1;
      if (repeat < 1) errors.push(`${where}: pattern ${pattern.id} has repeat ${repeat} (must be >= 1)`);
      const intensity = placement.intensity ?? 0.5;
      if (intensity < 0 || intensity > 1) {
        errors.push(`${where}: pattern ${pattern.id} intensity ${intensity} is outside 0..1`);
      }
      // Beat-precise breather check: the runtime holds back every activation
      // at >= breatherFromBeat. A placement that STARTS inside the breather
      // is a wasted bar (error). A placement that starts before it and runs
      // past it is the designed hand-off -- the runtime holds its tail back,
      // which is exactly how the breather is meant to end a section (warn).
      if (breather !== null) {
        const base = sectionStartBeat + cursorBar * beatsPerBar;
        const absFor = (e, rep) =>
          base + rep * pattern.lengthBars * beatsPerBar +
          (e.at.bar - 1) * beatsPerBar + ((e.at.beat ?? 1) - 1);
        let firstAbs = Infinity;
        let heldBack = 0;
        for (const e of pattern.events ?? []) {
          for (let rep = 0; rep < repeat; rep++) {
            const abs = absFor(e, rep);
            if (abs < firstAbs) firstAbs = abs;
            if (abs >= breather) heldBack++;
          }
        }
        if (firstAbs >= breather) {
          errors.push(
            `${where}: ${pattern.id} starts at beat ${+firstAbs.toFixed(2)}, inside the ` +
            `mode-change breather (>= ${breather}); the runtime will not spawn it`
          );
        } else if (heldBack > 0) {
          warnings.push(
            `${where}: ${pattern.id} runs into the mode-change breather (>= ${breather}) -- ` +
            `${heldBack} activation(s) held back by the runtime (expected tail hand-off)`
          );
        }
      }
      barsUsed += pattern.lengthBars * repeat;
      cursorBar += pattern.lengthBars * repeat;
    }

    if (barsUsed > section.lengthBars) {
      warnings.push(
        `${where}: patterns occupy ${barsUsed} bars but the section is ${section.lengthBars} bars -- the overflow runs past the section`
      );
    } else {
      // Bars the breather deliberately empties are not dead air.
      const exempt = breather !== null ? Math.max(0, section.startBar + section.lengthBars - breatherBar) : 0;
      const expectedFilled = section.lengthBars - exempt;
      if (barsUsed < expectedFilled) {
        warnings.push(
          `${where}: patterns occupy ${barsUsed} of ${expectedFilled} fillable bars -- ` +
          `${expectedFilled - barsUsed} bar(s) will be silent` +
          (exempt > 0 ? ` (${exempt} bar(s) are the mode-change breather)` : '')
        );
      }
    }
  }

  return { errors, warnings };
}

/**
 * DifficultyManager -- music energy -> difficulty, function and intensity.
 *
 * Pure functions over difficulty-rules.json. "High energy" raises complexity,
 * density and layering -- the rules deliberately keep it away from speed.
 */

import { clamp } from './seed.js';

export function energyBand(rules, energy) {
  const bands = rules.energyBands;
  for (const band of bands) {
    if (energy >= band.minEnergy && energy < band.maxEnergy) return band;
  }
  return bands[bands.length - 1];
}

/**
 * Difficulty 1..5 from mean energy + rhythm density.
 * difficulty = round(1 + 4 * (energyWeight * energy + densityWeight * density))
 * with the band's difficulty as the floor for high-energy sections.
 */
export function difficultyFor(rules, { energy, rhythmDensity }) {
  const band = energyBand(rules, energy);
  const weights = rules.difficultyFromEnergy;
  const raw =
    1 +
    4 * clamp(weights.energyWeight * energy + weights.densityWeight * rhythmDensity, 0, 1);
  const difficulty = Math.round(raw);
  return clamp(Math.max(difficulty, band.difficulty), 1, 5);
}

/** Function for a section: honours first-section, climax and difficulty ladder. */
export function functionFor(rules, { isFirst, isClimax, difficulty, mode, seedChoice }) {
  if (isClimax) return 'CLIMAX';
  if (isFirst) return 'TEACH';
  const ladder = rules.functionByDifficulty[String(clamp(difficulty, 1, 5))] ?? ['PRACTICE'];
  // Deterministic pick between equally valid functions.
  return ladder[Math.floor(seedChoice * ladder.length) % ladder.length];
}

/** Intensity 0..1 from the band's range, interpolated by the section's energy. */
export function intensityFor(rules, { energy, rhythmDensity, peakEnergy }) {
  const band = energyBand(rules, energy);
  const [lo, hi] = band.intensityRange;
  const e = clamp((energy - band.minEnergy) / Math.max(band.maxEnergy - band.minEnergy, 1e-6), 0, 1);
  const intensity = lo + (hi - lo) * e;
  // Peak-energy bars push toward the top of the band.
  const peakBoost = clamp(peakEnergy - 0.85, 0, 0.15) * 0.5;
  return clamp(intensity + peakBoost, rulesEnergyFloor(rules), 1);
}

function rulesEnergyFloor(rules) {
  return rules.energyBands[0].intensityRange[0];
}

/**
 * Smooth the difficulty curve across sections:
 *  - no more than maxStepBetweenSections per hop,
 *  - ramp from startDifficulty toward targetEndDifficulty,
 *  - optional rest (restDifficulty) after the climax.
 * Mutates section.difficulty in place; returns the sections.
 */
export function smoothDifficultyCurve(rules, sections, music) {
  const prog = rules.progression;
  const climaxIdx = sections.findIndex((s) => s.function === 'CLIMAX');

  // Gentle ramp: blend raw difficulty toward a line from start to target end.
  for (let i = 0; i < sections.length; i++) {
    const t = sections.length <= 1 ? 0 : i / (sections.length - 1);
    const ramp = prog.startDifficulty + (prog.targetEndDifficulty - prog.startDifficulty) * t;
    const raw = sections[i].difficulty;
    sections[i].difficulty = Math.round(raw * 0.6 + ramp * 0.4);
  }

  // Enforce per-hop step limit, forward then backward.
  for (let pass = 0; pass < 2; pass++) {
    for (let i = 1; i < sections.length; i++) {
      const prev = sections[i - 1].difficulty;
      const cur = sections[i].difficulty;
      if (cur - prev > prog.maxStepBetweenSections) {
        sections[i].difficulty = prev + prog.maxStepBetweenSections;
      }
    }
    for (let i = sections.length - 2; i >= 0; i--) {
      const next = sections[i + 1].difficulty;
      const cur = sections[i].difficulty;
      if (cur - next > prog.maxStepBetweenSections) {
        sections[i].difficulty = next + prog.maxStepBetweenSections;
      }
    }
  }

  if (climaxIdx >= 0) {
    sections[climaxIdx].difficulty = Math.max(sections[climaxIdx].difficulty, 4);
    if (prog.allowRestAfterClimax && climaxIdx + 1 < sections.length) {
      sections[climaxIdx + 1].difficulty = Math.min(
        sections[climaxIdx + 1].difficulty,
        prog.restDifficulty
      );
    }
  }

  // Clamp to per-mode caps.
  for (const s of sections) {
    const cap = rules.perMode[s.mode] ?? { minDifficulty: 1, maxDifficulty: 5 };
    s.difficulty = clamp(s.difficulty, cap.minDifficulty, cap.maxDifficulty);
    if (s.function === 'CLIMAX') s.difficulty = Math.max(s.difficulty, 4);
  }
  return sections;
}

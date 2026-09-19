/**
 * Intensity -> gameplay parameter mapping.
 *
 * A section's `intensity` (0..1) is NOT a global speed multiplier. It nudges
 * individual, per-mechanic knobs -- projectile count, projectile speed, warning
 * length, obstacle density -- and every knob has a hard floor/ceiling so a high
 * intensity can never produce an unreadable or undodgeable pattern.
 */

import { clamp, lerp } from './geometry';

/** Absolute readability floor: no telegraph may ever be shorter than this. */
export const MIN_TELEGRAPH_BEATS = 0.5;

/**
 * Higher intensity shortens the warning, but never below the pattern's declared
 * `constraints.minReactionBeats` (nor the global floor).
 */
export function scaleTelegraphBeats(baseBeats: number, intensity: number, minReactionBeats?: number): number {
  const floor = Math.max(MIN_TELEGRAPH_BEATS, minReactionBeats ?? 0);
  if (baseBeats <= floor) return baseBeats;
  return clamp(lerp(baseBeats, baseBeats * 0.65, intensity), floor, baseBeats);
}

/** Counts grow with intensity but stay within a sane ceiling. */
export function scaleCount(baseCount: number, intensity: number, maxCount = baseCount * 3): number {
  const scaled = Math.round(lerp(baseCount, baseCount * 3, intensity));
  return clamp(scaled, Math.max(1, Math.round(baseCount)), Math.round(maxCount));
}

/** Speed multiplier stays modest: dodging must remain about reading, not reflexes alone. */
export function scaleSpeed(baseSpeed: number, intensity: number, maxMultiplier = 1.6): number {
  return baseSpeed * lerp(1, maxMultiplier, intensity);
}

/** 0..1 density knob, e.g. what fraction of a tile layout is armed. */
export function scaleDensity(baseDensity: number, intensity: number, maxDensity = 1): number {
  return clamp(lerp(baseDensity, maxDensity, intensity), 0, maxDensity);
}

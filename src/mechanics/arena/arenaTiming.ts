/**
 * ARENA difficulty tiers and hazard pacing.
 *
 * Two ideas live here. First, a section's declared difficulty picks a tier, and
 * the tier says how much readability budget the player gets -- warning length,
 * safe-gap size, travel time. Second, travelling hazards must slow their
 * *active window* by the same factor they slow their motion, or a projectile
 * would stop being dangerous halfway across the arena.
 */

import type { MechanicSpawnContext } from '../../core/Mechanic';
import { TUNING } from '../../tuning';

export type ArenaTierName = 'EASY' | 'MEDIUM' | 'HARD' | 'INTENSE';
export type ArenaTier = (typeof TUNING.arenaTiers)[ArenaTierName];

/** Section difficulty 1-5 -> tier. Anything unset behaves as MEDIUM. */
export function tierForDifficulty(difficulty: number | undefined): ArenaTier {
  switch (Math.round(difficulty ?? 2)) {
    case 1: return TUNING.arenaTiers.EASY;
    case 2: return TUNING.arenaTiers.MEDIUM;
    case 3: return TUNING.arenaTiers.HARD;
    default: return TUNING.arenaTiers.INTENSE;
  }
}

/** Combined slow-down applied to anything that crosses the arena. */
export function travelScale(tier: ArenaTier): number {
  return TUNING.arena.hazardTravelScale * tier.travelScale;
}

/**
 * Stretch a travelling mechanic's ACTIVE window by the same factor its motion
 * is slowed. Call it around `spawn` on the way into `super()`.
 */
export function slowed(spawn: MechanicSpawnContext): MechanicSpawnContext {
  const scale = travelScale(spawn.tier);
  return {
    ...spawn,
    timing: { ...spawn.timing, durationBeats: spawn.timing.durationBeats * scale },
  };
}

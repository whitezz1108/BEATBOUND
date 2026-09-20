/**
 * Fairness system.
 *
 * Every readability guarantee in the game is expressed in *seconds* here,
 * because the player's body reacts in seconds while hazards move in beats.
 * Mechanics clamp against these helpers at construction; `tools/fairness-check`
 * audits the library against the same numbers, so a pattern that is impossible
 * to read is caught in CI rather than in a playtest.
 *
 * The floor values are deliberately generous. Difficulty is meant to come from
 * pattern design -- layering, safe gaps, timing -- not from hazards the player
 * physically cannot reach or read.
 */

import { TUNING } from '../tuning';

/** Warning time below which a hazard becomes unreactable, in seconds. */
export const REACTION_FLOOR_SECONDS = TUNING.fairness.reactionFloorSeconds;
/** Warning time below which a hazard stops being comfortable. */
export const COMFORT_REACTION_SECONDS = TUNING.fairness.comfortReactionSeconds;

/** How far the avatar travels at full speed in `seconds`. */
export function escapeDistance(seconds: number, playerSpeed = TUNING.arena.playerSpeed): number {
  return playerSpeed * seconds;
}

/**
 * The smallest opening a travelling hazard may present.
 *
 * A safe gap has to fit the player's diameter plus room to arrive and stand:
 * a dodge that requires pixel-perfect entry is a dodge that will fail for
 * reasons the designer did not intend.
 */
export function minimumGapWidth(playerRadius: number = TUNING.arena.playerRadius): number {
  return Math.max(playerRadius * 2 + 0.024, 0.06);
}

/**
 * Smallest angular opening (radians) the player can stand in at radius `r`.
 * Radial mechanics use this to keep their spray arms from closing the circle.
 */
export function minimumAngularGap(playerRadius: number, radius: number): number {
  const chord = minimumGapWidth(playerRadius);
  return 2 * Math.asin(Math.min(1, chord / (2 * Math.max(0.01, radius))));
}

/**
 * Total warning a travelling hazard gives: the telegraph plus however long the
 * hazard takes to reach the player. Both count -- a slow projectile is its own
 * warning.
 */
export function totalWarningSeconds(telegraphBeats: number, travelBeats: number, secondsPerBeat: number): number {
  return (telegraphBeats + travelBeats) * secondsPerBeat;
}

/**
 * Clamp a hazard's travel so the combined warning never drops below the floor.
 * Call in a mechanic's constructor with its resolved timing; the tier scaling
 * may already have stretched it, and this is the absolute floor on top.
 */
export function ensureWarningFloor(
  telegraphBeats: number,
  travelBeats: number,
  secondsPerBeat: number,
  floor = COMFORT_REACTION_SECONDS,
): number {
  return Math.max(travelBeats, floor / Math.max(0.01, secondsPerBeat) - telegraphBeats);
}

/**
 * How fast a safe gap may move, in field units per beat, and stay reachable.
 * A moving gap (wave sweeps, rotating sprays) may travel at most this far
 * between beats or it outruns the player it is asking to chase it.
 */
export function maxGapShiftPerBeat(secondsPerBeat: number, fraction = 0.85, playerSpeed = TUNING.arena.playerSpeed): number {
  return playerSpeed * secondsPerBeat * fraction;
}

/**
 * The minimum warning a hazard owes, given how far the player has to travel to
 * be safe: the escape walk, plus a margin to notice and decide.
 *
 * This is the formula the floor hazards are built on. `reactionMarginSeconds`
 * defaults to the reaction *floor* rather than the comfort value, because this
 * is the "physically possible" bound -- callers that want comfort pass it.
 */
export function minimumWarningSeconds(
  distanceToSafe: number,
  playerSpeed: number = TUNING.arena.playerSpeed,
  reactionMarginSeconds: number = REACTION_FLOOR_SECONDS,
): number {
  return distanceToSafe / Math.max(0.01, playerSpeed) + reactionMarginSeconds;
}

/**
 * `minimumWarningSeconds` expressed in beats, which is what a mechanic's timing
 * is denominated in. `maxBeats` keeps a pathological layout from demanding an
 * absurd telegraph -- a floor hazard that warns for eight beats is its own kind
 * of unreadable.
 */
export function minimumWarningBeats(
  distanceToSafe: number,
  secondsPerBeat: number,
  playerSpeed: number = TUNING.arena.playerSpeed,
  reactionMarginSeconds: number = REACTION_FLOOR_SECONDS,
  maxBeats = 4,
): number {
  const seconds = minimumWarningSeconds(distanceToSafe, playerSpeed, reactionMarginSeconds);
  return Math.min(maxBeats, seconds / Math.max(0.01, secondsPerBeat));
}

export interface ReactionBudget {
  /** Warning seconds the event actually grants. */
  warningSeconds: number;
  /** Seconds a perfect player needs, worst case. */
  requiredSeconds: number;
  /** warning >= required -- the event is physically readable. */
  fair: boolean;
  slackSeconds: number;
}

/**
 * The headline audit number: how much warning an event gives versus how much a
 * perfect player needs. `distanceToSafeGap` is the field distance from the
 * least-favourable legal position to the nearest safe spot, measured at the
 * moment the telegraph starts.
 */
export function reactionBudget(opts: {
  telegraphSeconds: number;
  hazardTravelSeconds: number;
  distanceToSafeGap: number;
  playerSpeed?: number;
  reactionFloorSeconds?: number;
}): ReactionBudget {
  const playerSpeed = opts.playerSpeed ?? TUNING.arena.playerSpeed;
  const floor = opts.reactionFloorSeconds ?? REACTION_FLOOR_SECONDS;
  const warning = opts.telegraphSeconds + opts.hazardTravelSeconds;
  const required = Math.max(floor, opts.distanceToSafeGap / playerSpeed);
  return {
    warningSeconds: warning,
    requiredSeconds: required,
    fair: warning >= required,
    slackSeconds: warning - required,
  };
}

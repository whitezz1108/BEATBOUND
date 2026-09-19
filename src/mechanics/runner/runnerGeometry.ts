/**
 * Shared RUNNER world constants.
 *
 * The track scrolls right-to-left past a player pinned at a fixed x. An
 * obstacle's position is a pure function of the beat:
 *
 *   x(beat) = PLAYER_X + (activationBeat - beat) * UNITS_PER_BEAT
 *
 * so it arrives at the player exactly on its scheduled beat, at any tempo, with
 * no per-frame accumulation. RUNNER mechanics declare `telegraphBeats: 0` in the
 * library because the warning is spatial rather than temporal -- seeing the
 * obstacle scroll in *is* the telegraph -- so the registry gives them
 * SCROLL_LEAD_BEATS of spawn lead instead.
 */

import { TUNING } from '../../tuning';

export const GROUND_Y = 0.72;
/** Mirror of GROUND_Y, used when gravity is inverted. */
export const CEILING_Y = 1 - GROUND_Y;
export const PLAYER_X = 0.22;
/** Field units the track travels per beat. */
export const UNITS_PER_BEAT = TUNING.runner.unitsPerBeat;
/** One bar of run-up: obstacles enter just off the right edge. */
export const SCROLL_LEAD_BEATS = 4;
/** Beats after passing the player before a mechanic is retired. */
export const SCROLL_TAIL_BEATS = 1.5;

/** Where an obstacle due on `activationBeat` sits at `beat`. */
export function trackX(activationBeat: number, beat: number): number {
  return PLAYER_X + (activationBeat - beat) * UNITS_PER_BEAT;
}

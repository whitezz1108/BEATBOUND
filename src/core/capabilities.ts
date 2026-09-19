/**
 * Optional mechanic capabilities.
 *
 * `RuntimeMechanic` covers what every mechanic in every mode does: run a
 * beat-driven lifecycle, expose damaging shapes, draw itself. Some modes need
 * more than that -- VERTICAL and RADIAL judge timed input, RUNNER shapes the
 * terrain the player runs over -- and those needs are expressed here as small
 * opt-in interfaces with type guards.
 *
 * They live in core (not next to a mode) so mechanics can implement them
 * without importing from `src/modes/`, keeping the dependency direction
 * one-way: modes know about mechanics, mechanics never know about modes.
 */

import type { Rect } from './geometry';
import type { RuntimeMechanic } from './Mechanic';

// --------------------------------------------------------------------------
// Timed input (VERTICAL, RADIAL)
// --------------------------------------------------------------------------

export const RADIAL_DIRECTIONS = ['UP', 'RIGHT', 'DOWN', 'LEFT'] as const;
export type RadialDirection = (typeof RADIAL_DIRECTIONS)[number];

export type NoteState = 'PENDING' | 'HOLDING' | 'HIT' | 'MISSED' | 'BROKEN';

/**
 * One thing the player has to press, at one musical moment.
 *
 * A mechanic may own several: V03 Double has two targets on the same beat,
 * D06 Clockwise has four a beat apart.
 */
export interface NoteTarget {
  /** 1-based lane, for VERTICAL. */
  lane?: number;
  /** Direction, for RADIAL. */
  direction?: RadialDirection;
  /** Absolute beat the player must hit. */
  beat: number;
  /** >0 for hold notes: how long the key must stay down after the hit. */
  holdBeats: number;
  state: NoteState;
  /** Beat the player actually hit on, for scoring feedback. */
  hitBeat?: number;
}

export interface InputTargetMechanic {
  readonly targets: NoteTarget[];
}

export function hasNoteTargets(m: RuntimeMechanic): m is RuntimeMechanic & InputTargetMechanic {
  return Array.isArray((m as Partial<InputTargetMechanic>).targets);
}

// --------------------------------------------------------------------------
// Terrain (RUNNER)
// --------------------------------------------------------------------------

/** A missing stretch of ground, in field-space x. */
export interface GroundGap {
  x0: number;
  x1: number;
}

export interface BouncePad {
  rect: Rect;
  /** Multiplier on the player's normal jump impulse. */
  strength: number;
}

/**
 * RUNNER mechanics that change the world rather than (or as well as) damaging
 * the player. Every member is optional; the mode asks for what it needs.
 */
export interface RunnerTerrain {
  /** Ground removed while this mechanic is in range. */
  groundGap?(): GroundGap | null;
  /** Launch pad the player bounces off on contact. */
  bouncePad?(): BouncePad | null;
  /** Gravity multiplier applied while ACTIVE (e.g. -1 for a flip). */
  gravityScale?(): number | null;
}

export function hasTerrain(m: RuntimeMechanic): m is RuntimeMechanic & RunnerTerrain {
  const t = m as Partial<RunnerTerrain>;
  return typeof t.groundGap === 'function'
    || typeof t.bouncePad === 'function'
    || typeof t.gravityScale === 'function';
}

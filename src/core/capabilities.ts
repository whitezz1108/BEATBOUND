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

import { DIRECTION8, type Direction8 } from './direction8';
import type { Rect } from './geometry';
import type { RuntimeMechanic } from './Mechanic';

// --------------------------------------------------------------------------
// Timed input (VERTICAL, RADIAL)
// --------------------------------------------------------------------------

/**
 * Radial prompts use the shared eight-direction vocabulary. The alias exists so
 * mechanics written against the old four-direction type keep compiling.
 */
export const RADIAL_DIRECTIONS = DIRECTION8;
export type RadialDirection = Direction8;

export type NoteState = 'PENDING' | 'HOLDING' | 'HIT' | 'MISSED' | 'BROKEN';

/** One checkpoint of a drift hold: "by this beat, be in this lane". */
export interface NoteSegment {
  /** Beats after the note's head. */
  beatOffset: number;
  lane: number;
}

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
  /**
   * Drift holds only: lane checkpoints the hold travels through. The required
   * lane moves while the note is held, so the player traces the melody across
   * the board instead of pinning one key.
   */
  path?: NoteSegment[];
  /** Runtime scratch: beats spent off the required lane during a hold. */
  offBeats?: number;
  /** Runtime scratch: the last checkpoint index a cue was played for. */
  lastCheckpoint?: number;
}

/**
 * Lane required at `beat`, following a drift path if the note has one.
 *
 * Checkpoints are steps, not ramps: the lane changes at each checkpoint and the
 * visual path draws the ramp between them as the warning. Interpolating the
 * *requirement* would make it ambiguous which key is currently correct.
 */
export function requiredLaneAt(target: NoteTarget, beat: number): number {
  const base = target.lane ?? 1;
  if (!target.path || target.path.length === 0) return base;
  const elapsed = beat - target.beat;
  let lane = target.path[0].lane;
  for (const segment of target.path) {
    if (elapsed >= segment.beatOffset) lane = segment.lane;
    else break;
  }
  return lane;
}

/** Index of the most recently passed checkpoint, or -1. */
export function checkpointIndexAt(target: NoteTarget, beat: number): number {
  if (!target.path) return -1;
  const elapsed = beat - target.beat;
  let index = -1;
  for (let i = 0; i < target.path.length; i++) {
    if (elapsed >= target.path[i].beatOffset) index = i;
    else break;
  }
  return index;
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

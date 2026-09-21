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
import type { Renderer } from './Renderer';

// --------------------------------------------------------------------------
// Timed input (VERTICAL, RADIAL)
// --------------------------------------------------------------------------

/**
 * Radial prompts use the shared eight-direction vocabulary. The alias exists so
 * mechanics written against the old four-direction type keep compiling.
 */
export const RADIAL_DIRECTIONS = DIRECTION8;
export type RadialDirection = Direction8;

/**
 * A note's life, in order:
 *
 *   PENDING -> HIT                                  (played)
 *   PENDING -> MISSED -> EXPIRED                    (not played; keeps falling)
 *   PENDING -> HOLDING -> HIT | BROKEN -> EXPIRED   (sustained)
 *
 * MISSED and BROKEN are scored exactly once and then stop interacting, but the
 * note stays on screen and keeps moving until it leaves the play area and
 * becomes EXPIRED. A note that vanishes the instant it is missed steals the
 * feedback the player needs to see how late they were.
 */
export type NoteState = 'PENDING' | 'HOLDING' | 'HIT' | 'MISSED' | 'BROKEN' | 'EXPIRED';

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
 * A solid block the player can stand on. `top` is the standable surface for
 * FLOOR platforms (its upper face); `bottom` is the standable surface for
 * CEILING platforms (the underside it hangs from).
 *
 * Both faces are world y, always, whichever surface the block belongs to. That
 * is what lets a *floating* block exist: a walkway whose `top` is high above the
 * floor has a `bottom` that is not on the floor line, so it can be stood on
 * *and* can stop a rising jump. The old model -- one face derived from a
 * surface tag -- could not express that, which is why RUNNER had no corridors.
 */
export interface Platform {
  x0: number;
  x1: number;
  top: number;
  bottom: number;
}

/**
 * RUNNER mechanics that change the world rather than (or as well as) damaging
 * the player. Every member is optional; the mode asks for what it needs.
 */
export interface RunnerTerrain {
  /** Ground removed while this mechanic is in range. */
  groundGap?(): GroundGap | null;
  /** Several holes at once. Preferred over `groundGap()` when present. */
  groundGaps?(): GroundGap[];
  /** Launch pad the player bounces off on contact. */
  bouncePad?(): BouncePad | null;
  /** Several pads at once. Preferred over `bouncePad()` when present. */
  bouncePads?(): BouncePad[];
  /** Gravity multiplier applied while ACTIVE (e.g. -1 for a flip). */
  gravityScale?(): number | null;
  /** A platform to jump onto / run off (R04). */
  platform?(): Platform | null;
  /**
   * Several platforms at once, for terrain that is a *course* rather than one
   * obstacle -- a staircase, a corridor, a ceiling route. Preferred over
   * `platform()` when present; the mode reads whichever exists.
   */
  platforms?(): Platform[];
  /**
   * Which running surface this mechanic currently belongs to.
   *
   * Legacy obstacles answer this from a `surface` param, because each one is
   * pinned to one surface forever. A course mechanic spans both -- it owns the
   * flip -- so it answers from its own timeline instead. When absent, the mode
   * falls back to the `surface` param, which is what every existing mechanic
   * does.
   */
  activeSurface?(): TrackSurfaceLike;
}

/** `'FLOOR' | 'CEILING'`, mirrored here so core does not import from mechanics. */
export type TrackSurfaceLike = 'FLOOR' | 'CEILING';

export function hasTerrain(m: RuntimeMechanic): m is RuntimeMechanic & RunnerTerrain {
  const t = m as Partial<RunnerTerrain>;
  return typeof t.groundGap === 'function'
    || typeof t.groundGaps === 'function'
    || typeof t.bouncePad === 'function'
    || typeof t.bouncePads === 'function'
    || typeof t.gravityScale === 'function'
    || typeof t.platform === 'function'
    || typeof t.platforms === 'function';
}

/**
 * Every solid block a terrain mechanic is currently contributing.
 *
 * The singular/plural pairs exist because the two shapes of mechanic differ:
 * a legacy obstacle is one thing pinned to one surface, while a course is a
 * whole stretch of level and contributes many at once. Modes read through
 * these helpers so neither has to know which kind it is talking to.
 */
export function platformsOf(m: RuntimeMechanic): Platform[] {
  const t = m as Partial<RunnerTerrain>;
  if (typeof t.platforms === 'function') return t.platforms() ?? [];
  if (typeof t.platform === 'function') {
    const one = t.platform();
    return one ? [one] : [];
  }
  return [];
}

/** Every hole in the running surface a terrain mechanic is contributing. */
export function gapsOf(m: RuntimeMechanic): GroundGap[] {
  const t = m as Partial<RunnerTerrain>;
  if (typeof t.groundGaps === 'function') return t.groundGaps() ?? [];
  if (typeof t.groundGap === 'function') {
    const one = t.groundGap();
    return one ? [one] : [];
  }
  return [];
}

/** Every launch pad a terrain mechanic is contributing. */
export function padsOf(m: RuntimeMechanic): BouncePad[] {
  const t = m as Partial<RunnerTerrain>;
  if (typeof t.bouncePads === 'function') return t.bouncePads() ?? [];
  if (typeof t.bouncePad === 'function') {
    const one = t.bouncePad();
    return one ? [one] : [];
  }
  return [];
}

/**
 * Which surface a mechanic belongs to, given the player's current gravity.
 *
 * A course mechanic spans both surfaces and answers for itself; every other
 * terrain mechanic is pinned by its `surface` param, which is what the mode
 * reads through `surfaceOf` in the mechanics layer. The fallback lives here so
 * core keeps its one-way dependency on mechanics.
 */
export function surfaceFor(
  m: RuntimeMechanic,
  fallback: TrackSurfaceLike,
): TrackSurfaceLike {
  const t = m as Partial<RunnerTerrain>;
  return typeof t.activeSurface === 'function' ? t.activeSurface() : fallback;
}

// --------------------------------------------------------------------------
// Sequence encounters (ARENA)
// --------------------------------------------------------------------------

/**
 * A mechanic that borrows the player's controls for a scripted musical moment.
 *
 * ARENA is a dodge mode: the avatar is steered, never *played*. A12 Rhythm
 * Breakout breaks that for the length of one encounter -- the player is sealed
 * in and has to perform a short rhythm phrase to get out -- and this is the
 * narrow surface that makes it possible without ARENA growing a second input
 * system or the mechanic learning what a mode is.
 *
 * The mode does three things with it, all of them per-frame and stateless, so
 * an encounter that ends (or dies mid-flight) can never leave the controls in
 * a strange state:
 *
 *   1. asks whether the encounter currently wants directional input,
 *   2. forwards the presses it wants, and scales movement while it does,
 *   3. draws the encounter's UI *above* the avatar, which ordinary mechanic
 *      rendering cannot do because it happens underneath.
 */
/** One scored moment of an encounter, drained by the mode into the run's stats. */
export type SequenceVerdict = 'PERFECT' | 'GOOD' | 'MISS';

export interface SequenceEncounter {
  /**
   * True while directional keys belong to the encounter rather than to
   * movement. False before it starts and after it resolves, so the mode's
   * control context follows the encounter's own timeline.
   */
  capturesInput(beat: number): boolean;
  /** 0..1 multiplier on walking speed right now. 1 when nothing is happening. */
  movementScale(beat: number): number;
  /** A cardinal direction was entered on this frame. */
  pressDirection(direction: Direction8, beat: number): void;
  /** The confirm key was pressed on this frame. */
  pressConfirm(beat: number): void;
  /** Where the body this encounter is wrapped around currently is. */
  focusOn(x: number, y: number): void;
  /** Drawn after the avatar. Everything else goes through `render`. */
  renderOverlay(r: Renderer, beat: number): void;
  /**
   * Verdicts scored since the last call, and clear them.
   *
   * The encounter judges its own phrase -- it owns the windows -- but the
   * *run* owns the tally, so the notes land in RunStatus through the mode like
   * every other scored input in the game. Drained rather than pushed so the
   * mechanic never holds a reference to anything outside itself.
   */
  drainJudgements(): SequenceVerdict[];
  /** Short HUD string: how the encounter is going. */
  readonly encounterLabel: string;
}

export function isSequenceEncounter(m: RuntimeMechanic): m is RuntimeMechanic & SequenceEncounter {
  return typeof (m as Partial<SequenceEncounter>).capturesInput === 'function'
    && typeof (m as Partial<SequenceEncounter>).pressDirection === 'function';
}

/**
 * A hazard built around the player rather than around the arena.
 *
 * Almost every mechanic in the game places its geometry somewhere on the board
 * and asks the player to be elsewhere. A few -- currently only A12's seal --
 * close around the body itself, which changes what "can this hit me?" even
 * means: the answer no longer depends on where the player is standing, because
 * the hazard moves with them.
 *
 * That distinction is invisible during play and only matters to tools that
 * reason about a player who is *not* being simulated frame by frame. Such a
 * tool has to ask the anchored mechanic where it currently is, and test the
 * body there, rather than testing the body against a board position the hazard
 * would never occupy.
 */
export interface PlayerAnchoredMechanic {
  readonly playerAnchored: true;
  /** Where the hazard is closed around right now. */
  readonly anchor: { x: number; y: number };
}

export function isPlayerAnchored(
  m: RuntimeMechanic,
): m is RuntimeMechanic & PlayerAnchoredMechanic {
  return (m as Partial<PlayerAnchoredMechanic>).playerAnchored === true;
}

/**
 * The RUNNER trajectory model -- the artifact the whole mode is generated from.
 *
 * Spec §3: "the most important generated artifact in RUNNER should be the
 * player's intended movement trajectory". This is that artifact. It is built
 * *first*; terrain and hazards are then derived from it, never the other way
 * round.
 *
 * ## What a trajectory says
 *
 * A trajectory is a list of segments, one per movement verb, each carrying:
 *
 *   - the beat it starts on and how long it lasts;
 *   - which surface the player is on (FLOOR / CEILING);
 *   - where the feet start and where they are meant to end, in world y;
 *   - whether the player is airborne, and for how long;
 *   - the arc, when there is one, so a *validator* can ask "was the player
 *     actually above that spike" without re-deriving the physics;
 *   - the terrain the segment *requires* (a landing slab, a pad, a hole) and
 *     the hazards it *permits*.
 *
 * ## The invariant
 *
 * Segments are contiguous: `segment[i].endBeat === segment[i+1].startBeat` and
 * `segment[i].endFeetY === segment[i+1].startFeetY`. Everything downstream --
 * the terrain builder, the hazard placer, the validator -- can therefore walk
 * the list once and trust it. A course that violates this is a bug in the
 * planner, not something the renderer has to cope with.
 *
 * ## World y, not height
 *
 * Feet positions are world y (0 at the top of the field, 1 at the bottom), the
 * same space the player and the collision code use. Under FLOOR gravity "higher"
 * means smaller y; under CEILING gravity it means larger y. The helper
 * `riseFrom(surface)` converts between the two so verbs can be written once.
 */

import type { MotionVerb } from './motion';
import type { TrackSurface } from './surface';

/** A slab of solid terrain the trajectory needs to exist. */
export interface TerrainDemand {
  kind: 'SLAB';
  /** Absolute beat at which the slab's leading edge reaches the player. */
  beat: number;
  /** Track units the slab occupies, centred on the beat. */
  width: number;
  /** World y of the standable face. */
  faceY: number;
  /** World y of the far face (the underside for a floor slab). */
  backY: number;
  surface: TrackSurface;
  /** True when the slab is not anchored to the base surface (a floating block). */
  floating: boolean;
}

/** A hole in the running surface. */
export interface GapDemand {
  kind: 'GAP';
  beat: number;
  width: number;
  surface: TrackSurface;
}

/** A launch pad sitting on a face. */
export interface PadDemand {
  kind: 'PAD';
  beat: number;
  /** World y of the face the pad sits on. */
  faceY: number;
  surface: TrackSurface;
  strength: number;
}

/** A mid-air jump ring: passing it arms one extra jump while airborne. */
export interface AirJumpDemand {
  kind: 'AIRJUMP';
  beat: number;
  /** World y of the ring's centre (the height it arms at). */
  faceY: number;
  surface: TrackSurface;
}

export type TerrainDemandAny = TerrainDemand | GapDemand | PadDemand | AirJumpDemand;

/** A hazard the trajectory tolerates at a beat, and what the player must do. */
export interface HazardDemand {
  kind: 'SPIKE' | 'WALL' | 'SAW';
  beat: number;
  surface: TrackSurface;
  /**
   * World y of the tip of the hazard, for a spike/saw, or the underside of a
   * beam for a wall. The validator checks the arc clears this.
   */
  faceY: number;
  /** For a beam: how much room is left under it. */
  clearance?: number;
  /** The verb that answers this hazard, for the debug view. */
  answer: MotionVerb;
}

/** One movement idea, resolved into numbers. */
export interface TrajectorySegment {
  verb: MotionVerb;
  archetype: string;
  /** Absolute beat the segment starts on. */
  startBeat: number;
  /** Length in beats. */
  beats: number;
  surface: TrackSurface;
  /** World y of the feet at the start and end of the segment. */
  startFeetY: number;
  endFeetY: number;
  /** World y of the surface the player is running on during the segment. */
  runY: number;
  /** True while the player is off the surface. */
  airborne: boolean;
  /** Beats airborne, when `airborne`. */
  airBeats?: number;
  /**
   * Beats into the flight when the mid-air second jump is pressed, for a
   * `DOUBLE_JUMP_MOUNT`: the ring passes the player at this beat, and pressing
   * jump again while the ring is live resets the rise with a shorter impulse.
   * Present on exactly the flights the plan arms an air jump for.
   */
  airJumpAt?: number;
  /** Take-off impulse multiplier: 1 for a plain jump, more from a pad. */
  strength?: number;
  /** Key-hold length in beats; omitted means a full-hold jump. */
  holdBeats?: number;
  /**
   * True when the player must be *sliding* through this segment.
   *
   * A slide is not a verb -- it is a posture the player holds while running, so
   * it belongs to the segment rather than the vocabulary. Recording it here is
   * what lets the validator check the one thing that makes a beam fair: that the
   * gap under it is taller than a sliding player and shorter than a standing one.
   */
  slide?: boolean;
  /** Apex above the take-off surface, when airborne. */
  apex?: number;
  /**
   * Absolute beat at which gravity inverts during this segment.
   *
   * A flip is not an instant at a segment boundary: the player is airborne
   * across it and changes surface *inside* the flight. Recording the beat
   * explicitly is what lets the course mechanic schedule the inversion exactly
   * where the planner intended rather than rounding it to the nearest landing.
   */
  flipAt?: number;
  /**
   * True when the segment ends by *arriving* at a surface rather than leaving
   * one -- a landing, as opposed to a take-off.
   */
  lands: boolean;
  /** Terrain this segment needs in order to be possible. */
  demands: TerrainDemandAny[];
  /** Hazards this segment is designed to carry. */
  hazards: HazardDemand[];
  /** Human-readable note for the debug view and course dumps. */
  note?: string;
}

/** A phrase: an archetype's worth of segments sharing one musical job. */
export interface TrajectoryPhrase {
  archetype: string;
  role: string;
  /** Absolute beat the phrase starts on. */
  startBeat: number;
  beats: number;
  /** Motif id: phrases sharing one are variations of the same idea. */
  motif: string;
  /**
   * How loud the music is here, 0..1.
   *
   * Carried through from the spec rather than recomputed, because it is what the
   * phrase was *planned* at -- and the audit's job is to check the plan against
   * the claim it was built to make (spec §9: an energetic phrase should not sit
   * on the floor).
   */
  intensity: number;
  segments: TrajectorySegment[];
}

/** The whole intended course, in order. */
export interface Trajectory {
  phrases: TrajectoryPhrase[];
  segments: TrajectorySegment[];
  startBeat: number;
  endBeat: number;
}

/** Flatten phrases into the single ordered segment list. */
export function flattenTrajectory(phrases: TrajectoryPhrase[]): Trajectory {
  const segments = phrases.flatMap((p) => p.segments);
  return {
    phrases,
    segments,
    startBeat: phrases.length > 0 ? phrases[0].startBeat : 0,
    endBeat: phrases.length > 0 ? phrases[phrases.length - 1].startBeat + phrases[phrases.length - 1].beats : 0,
  };
}

/** World y of a face `rise` above (further from) `surface`. */
export function faceYFor(surface: TrackSurface, rise: number): number {
  return surface === 'FLOOR' ? FLOOR_Y - rise : CEILING_Y_CONST + rise;
}

/** World y of the running surface itself. */
export const FLOOR_Y = 0.72;
export const CEILING_Y_CONST = 0.28;

/** Rise from `surface` to a world y. Negative when the y is closer to the base. */
export function riseFrom(surface: TrackSurface, y: number): number {
  return surface === 'FLOOR' ? FLOOR_Y - y : y - CEILING_Y_CONST;
}

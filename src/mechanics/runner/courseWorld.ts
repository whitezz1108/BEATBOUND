/**
 * A RUNNER course, as a pure world model.
 *
 * The trajectory is planned once, and everything downstream needs to ask the
 * same questions of it at an arbitrary beat:
 *
 *   "what is solid here?"  "is there a hole?"  "which way is down?"
 *   "what would hurt me, on the surface I am on?"
 *
 * Those questions have exactly one right answer, and *four* consumers need it:
 *
 *   1. `RunnerCourseMechanic`, every frame, for collision and rendering;
 *   2. `RunnerMode`, through that mechanic's `RunnerTerrain` capability;
 *   3. `traversalSim.ts`, which replays the planned route to prove it is flyable;
 *   4. `tools/runner-check.ts`, which reports on the whole library.
 *
 * If the simulator resolved the world even slightly differently from the mode it
 * would be validating a game nobody plays, so the answers live here, as pure
 * functions of a beat -- no clock, no spawn context, no canvas. That is what
 * makes the headless validator meaningful (spec §8, §30).
 *
 * ## Beats, not pixels
 *
 * Everything is anchored at absolute beats and placed with `trackX`, so a slab
 * due on beat 12 is at the right x on every frame with no accumulation error and
 * no per-piece scheduling. The world is therefore *queryable*, not just
 * renderable: asking for beat 40.5 gives the same answer whether the song is
 * playing, being simulated, or being validated offline.
 */

import type { BouncePad, GroundGap, Platform, TrackSurfaceLike } from '../../core/capabilities';
import type { Rect, Shape } from '../../core/geometry';
import { PLAYER_X, UNITS_PER_BEAT, trackX } from './runnerGeometry';
import { BODY_HEIGHT } from './runnerPhysics';
import { surfaceForGravity, type TrackSurface } from './surface';
import { xOverGap } from './terrainProbe';
import { CEILING_Y_CONST, FLOOR_Y, type HazardDemand, type TerrainDemandAny, type Trajectory } from './trajectory';
import { samplePhraseZones, surfaceSideRatio, type VerticalZone } from './verticalZones';

/** How far off screen a piece must be before it stops being reported. */
const CULL_MARGIN = 0.1;

/** How deep a floating slab is drawn when the trajectory did not say. */
export const DEFAULT_SLAB_DEPTH = BODY_HEIGHT;

/** A slab, resolved to absolute beats and world y. */
export interface WorldSlab {
  startBeat: number;
  endBeat: number;
  faceY: number;
  backY: number;
  surface: TrackSurface;
  floating: boolean;
}

export interface WorldGap {
  startBeat: number;
  endBeat: number;
  surface: TrackSurface;
}

export interface WorldPad {
  beat: number;
  faceY: number;
  surface: TrackSurface;
  strength: number;
}

export interface WorldFlip {
  beat: number;
  to: TrackSurface;
}

/** A mid-air jump ring, resolved into world form. */
export interface WorldAirJump {
  beat: number;
  surface: TrackSurface;
  /** World y of the ring centre -- the height the second press happens at. */
  faceY: number;
}

export interface WorldPhrase {
  startBeat: number;
  endBeat: number;
  archetype: string;
  motif: string;
  role: string;
  /** The phrase's authored loudness, 0..1, for the debug view. */
  intensity: number;
  /** The surface the phrase plays on (null only for an empty phrase). */
  surface: TrackSurface | null;
  /** Beats sampled per field zone; see `samplePhraseZones`. */
  zoneBeats: Record<VerticalZone, number>;
  /** Fraction of the phrase in the two zones nearest its own surface. */
  groundRatio: number;
}

/** The pad's drawn height: a thin tile on the face it launches from. */
export const PAD_THICKNESS = 0.022;
/** The pad's drawn width, in field units of track. */
export const PAD_WIDTH = 0.09;

export class CourseWorld {
  readonly slabs: WorldSlab[] = [];
  readonly gaps: WorldGap[] = [];
  readonly pads: WorldPad[] = [];
  readonly airJumps: WorldAirJump[] = [];
  readonly hazards: HazardDemand[] = [];
  readonly flips: WorldFlip[] = [];
  readonly phrases: WorldPhrase[] = [];
  readonly startBeat: number;
  readonly endBeat: number;
  /** The beat the course's terrain is live from, including its scroll-in. */
  readonly spawnBeat: number;

  constructor(trajectory: Trajectory, spawnBeat = trajectory.startBeat) {
    this.startBeat = trajectory.startBeat;
    this.endBeat = trajectory.endBeat;
    this.spawnBeat = spawnBeat;

    for (const phrase of trajectory.phrases) {
      const zoneBeats = samplePhraseZones(phrase);
      this.phrases.push({
        startBeat: phrase.startBeat,
        endBeat: phrase.startBeat + phrase.beats,
        archetype: phrase.archetype,
        motif: phrase.motif,
        role: phrase.role,
        intensity: phrase.intensity,
        surface: zoneBeats.surface,
        zoneBeats: zoneBeats.beats,
        groundRatio: zoneBeats.surface !== null ? surfaceSideRatio(zoneBeats.beats, zoneBeats.surface) : 0,
      });
    }

    for (const segment of trajectory.segments) {
      for (const demand of segment.demands) this.adopt(demand);
      for (const demand of segment.hazards) this.hazards.push(demand);
      if (segment.flipAt !== undefined) {
        // The destination is the surface the segment *runs on*, not the other
        // one: a flip segment is authored from the side the player arrives at,
        // so its own surface is where gravity is about to point.
        this.flips.push({ beat: segment.flipAt, to: segment.surface });
      }
    }
    this.flips.sort((a, b) => a.beat - b.beat);
    this.clipFalls(trajectory);
    this.coalesceSlabs();
  }

  /**
   * End each surface's terrain where the plan says the player leaves it *by
   * falling*.
   *
   * A jump's take-off beat is set by the input: the player presses when they
   * mean to, and the terrain under them is irrelevant. A fall's departure beat
   * is set by the terrain -- the player runs until the ground stops. That makes
   * the two need opposite treatment when the plan and the geometry disagree
   * about where a ledge ends.
   *
   * They do disagree, because a landing slab is deliberately wider than the beat
   * it is met on: `LANDING_SLAB_BEATS` buys a platform you can land on and
   * re-launch from, so it reaches half that width *past* the landing beat. Run
   * that on and the slab is still under the player's feet when the next verb --
   * a `DROP`, say -- says they walk off it, so they leave up to 0.6 beats late.
   * On flat ground that costs nothing; after a gap it is fatal. The drop is
   * planned to land on the far side of a hole, and leaving late means the feet
   * come down *inside* the hole, which is how a course whose every individual
   * hole is a legal width still ends with the player falling out of the world.
   *
   * Trimming here rather than in the planner is deliberate: the planner emits
   * one demand at a time and cannot see the segment that follows, whereas this
   * is a statement about the world as a whole -- and the same statement the
   * simulator and the live mode both need to be true.
   */
  private clipFalls(trajectory: Trajectory): void {
    const fallBeats: Array<{ beat: number; surface: TrackSurface; fromY: number }> = [];
    for (const segment of trajectory.segments) {
      // `apex` is zero exactly for the segments that are falls rather than
      // jumps: a `DROP` or a `PLATFORM_DESCENT` records no impulse. A "fall" that
      // does not actually change height is not one -- a verb asked to drop to
      // the level it is already on emits a zero-depth descent, and clipping the
      // terrain for it would cut a platform the player never leaves.
      if (!segment.airborne || (segment.apex ?? 0) > 0) continue;
      if (Math.abs(segment.startFeetY - segment.endFeetY) < 1e-6) continue;
      fallBeats.push({ beat: segment.startBeat, surface: segment.surface, fromY: segment.startFeetY });
    }
    if (fallBeats.length === 0) return;

    const out: WorldSlab[] = [];
    for (const slab of this.slabs) {
      // The player runs this slab until the first beat they leave it by falling,
      // and that is where it ends. Nothing of it survives past that beat: the
      // only way back onto the line is a jump, and a jump brings its own landing.
      //
      // "This slab" is the one at the height the player *left*. Clipping by beat
      // alone also cut terrain at the height the player was about to *arrive*
      // at: a drop's landing slab reaches half its width back before the landing
      // beat, so it spanned the take-off instant too, and the cut amputated
      // everything after it -- the landing was then held by a fragment a fifth
      // of a beat wide, one fall chain deep. A fall ends the ground at one
      // height: the one its feet departed.
      let end = slab.endBeat;
      for (const fall of fallBeats) {
        if (fall.surface !== slab.surface) continue;
        if (Math.abs(slab.faceY - fall.fromY) > 1e-6) continue;
        if (fall.beat <= slab.startBeat + 1e-6 || fall.beat >= end - 1e-6) continue;
        end = fall.beat;
      }
      if (end - slab.startBeat > 1e-6) out.push({ ...slab, endBeat: end });
    }
    this.slabs.length = 0;
    this.slabs.push(...out);
  }

  /**
   * Merge slabs that share a standing line and touch or overlap.
   *
   * The planner emits terrain per *demand* -- a landing slab here, a raised run
   * there -- and consecutive demands at the same height naturally abut. Left
   * alone they would be a stack of overlapping blocks: the renderer would draw
   * their seams, the metrics would report the average of fragments rather than
   * the length of a walkway, and "is this landing wide enough" would be asked
   * of a piece that is only half the platform.
   *
   * Merging here rather than in the planner is deliberate: the planner should
   * not have to know that the slab it just emitted is the continuation of the
   * one before it. Geometry is coalesced once, at the boundary where it becomes
   * the world.
   */
  private coalesceSlabs(): void {
    const sorted = [...this.slabs].sort((a, b) =>
      a.surface.localeCompare(b.surface) || a.faceY - b.faceY || a.startBeat - b.startBeat,
    );
    const merged: WorldSlab[] = [];
    for (const slab of sorted) {
      const prev = merged[merged.length - 1];
      const sameLine = prev !== undefined
        && prev.surface === slab.surface
        && Math.abs(prev.faceY - slab.faceY) < 0.004
        && Math.abs(prev.backY - slab.backY) < 0.004;
      // Two slabs may only merge when they *really* meet. The sort above orders
      // by height first and beat second, so a pair that is adjacent in the list
      // is not necessarily adjacent on the track -- two disjoint runs at the
      // same height sort next to each other whenever nothing else shares their
      // line. Testing only `slab.startBeat <= prev.endBeat` then merges the
      // *later* run into the earlier one and extends it backwards over track
      // neither of them covers, which silently deletes the earlier slab. That is
      // how a staircase lost its third step and the player fell to the floor
      // line where a 0.54 slab was planned.
      const overlaps = slab.startBeat <= prev?.endBeat + 1e-6 && slab.endBeat >= prev?.startBeat - 1e-6;
      if (sameLine && overlaps) {
        prev.startBeat = Math.min(prev.startBeat, slab.startBeat);
        prev.endBeat = Math.max(prev.endBeat, slab.endBeat);
        continue;
      }
      merged.push({ ...slab });
    }
    this.slabs.length = 0;
    this.slabs.push(...merged);
  }

  /** Turn a planner demand into the resolved form the world reports. */
  private adopt(demand: TerrainDemandAny): void {
    switch (demand.kind) {
      case 'SLAB': {
        const half = demand.width / 2 / UNITS_PER_BEAT;
        this.slabs.push({
          startBeat: demand.beat - half,
          endBeat: demand.beat + half,
          faceY: demand.faceY,
          backY: demand.backY,
          surface: demand.surface,
          floating: demand.floating,
        });
        return;
      }
      case 'GAP': {
        const half = demand.width / 2 / UNITS_PER_BEAT;
        this.gaps.push({ startBeat: demand.beat - half, endBeat: demand.beat + half, surface: demand.surface });
        return;
      }
      case 'PAD':
        this.pads.push({ beat: demand.beat, faceY: demand.faceY, surface: demand.surface, strength: demand.strength });
        return;
      case 'AIRJUMP':
        this.airJumps.push({ beat: demand.beat, faceY: demand.faceY, surface: demand.surface });
        return;
    }
  }

  /**
   * The air-jump ring live at `beat`, if any.
   *
   * The window is a third of a beat either side -- at 120 BPM that is ±140 ms
   * around the arc's apex, roughly the rhythm game's "good" window and about
   * double a frame of integration error. The impulse carries the height, so a
   * press at the window's edge still lands; what a *missed* window costs is
   * the whole ring, which is the read the player is being taught.
   */
  airJumpAt(beat: number): WorldAirJump | null {
    for (const ring of this.airJumps) {
      if (Math.abs(beat - ring.beat) <= 1 / 3) return ring;
    }
    return null;
  }

  // ---- gravity ----------------------------------------------------------

  /**
   * Gravity direction at `beat`: -1 on the ceiling, +1 on the floor.
   *
   * A flip persists until the next one, so the course is *always* answering --
   * there is no "outside the portal" state for the player to be in, and no frame
   * where the world has no opinion about which way is down.
   */
  gravityAt(beat: number): number {
    let direction = 1;
    for (const flip of this.flips) {
      if (beat >= flip.beat) direction = flip.to === 'CEILING' ? -1 : 1;
      else break;
    }
    return direction;
  }

  surfaceAt(beat: number): TrackSurface {
    return surfaceForGravity(this.gravityAt(beat));
  }

  activeSurface(): TrackSurfaceLike {
    return surfaceForGravity(this.gravityAt(0));
  }

  // ---- terrain ----------------------------------------------------------

  platformsAt(beat: number): Platform[] {
    const out: Platform[] = [];
    for (const slab of this.slabs) {
      const x0 = trackX(slab.startBeat, beat);
      const x1 = trackX(slab.endBeat, beat);
      if (x1 < -CULL_MARGIN || x0 > 1 + CULL_MARGIN) continue;
      out.push(platformOf(slab, x0, x1));
    }
    return out;
  }

  /**
   * The platforms of one surface, at `beat`.
   *
   * The mode and the simulator both need this rather than the full list: a
   * course's slabs live on two different surfaces, and asking `resolveProbe`
   * about a ceiling slab while the player is on the floor would let them land on
   * geometry that is not there. The renderer wants *everything*, so both
   * accessors exist rather than one with a flag.
   */
  platformsOn(surface: TrackSurface, beat: number): Platform[] {
    const out: Platform[] = [];
    for (const slab of this.slabs) {
      if (slab.surface !== surface) continue;
      const x0 = trackX(slab.startBeat, beat);
      const x1 = trackX(slab.endBeat, beat);
      if (x1 < -CULL_MARGIN || x0 > 1 + CULL_MARGIN) continue;
      out.push(platformOf(slab, x0, x1));
    }
    return out;
  }

  gapsAt(beat: number): GroundGap[] {
    const out: GroundGap[] = [];
    for (const gap of this.gaps) {
      const x0 = trackX(gap.startBeat, beat);
      const x1 = trackX(gap.endBeat, beat);
      if (x1 < -CULL_MARGIN || x0 > 1 + CULL_MARGIN) continue;
      out.push({ x0, x1 });
    }
    return out;
  }

  /** The holes on one surface, at `beat`. See `platformsOn` for why. */
  gapsOn(surface: TrackSurface, beat: number): GroundGap[] {
    const out: GroundGap[] = [];
    for (const gap of this.gaps) {
      if (gap.surface !== surface) continue;
      const x0 = trackX(gap.startBeat, beat);
      const x1 = trackX(gap.endBeat, beat);
      if (x1 < -CULL_MARGIN || x0 > 1 + CULL_MARGIN) continue;
      out.push({ x0, x1 });
    }
    return out;
  }

  /** Is the player over a hole on `surface` at `beat`? */
  overGap(surface: TrackSurface, beat: number, x: number): boolean {
    return xOverGap(this.gapsOn(surface, beat), x);
  }

  padsAt(beat: number): BouncePad[] {
    const out: BouncePad[] = [];
    const gravityDown = this.gravityAt(beat) > 0;
    for (const pad of this.pads) {
      const x = trackX(pad.beat, beat);
      if (x < -CULL_MARGIN || x > 1 + CULL_MARGIN) continue;
      // The pad's rect is positioned so the face it launches from is the face
      // the player is standing on, whichever way gravity points.
      const y = gravityDown ? pad.faceY - PAD_THICKNESS : pad.faceY;
      out.push({ rect: { x: x - PAD_WIDTH / 2, y, w: PAD_WIDTH, h: PAD_THICKNESS }, strength: pad.strength });
    }
    return out;
  }

  /** A pad's drawn rect at `beat`, for the renderer. */
  padRect(pad: WorldPad, beat: number, gravityDown: boolean): Rect {
    const x = trackX(pad.beat, beat);
    return {
      x: x - PAD_WIDTH / 2,
      y: gravityDown ? pad.faceY - PAD_THICKNESS : pad.faceY,
      w: PAD_WIDTH,
      h: PAD_THICKNESS,
    };
  }

  // ---- hazards ----------------------------------------------------------

  /**
   * The hazards that can hurt the player at `beat`.
   *
   * Only the ones on the *live* surface count: a course spike is dangerous once
   * the player is actually attached to the surface it sits on, which the course
   * knows from its own flip timeline. A floor spike during a ceiling phrase is
   * scenery, exactly as it is for the legacy obstacles.
   */
  hazardsAt(beat: number): Shape[] {
    const live = this.surfaceAt(beat);
    const out: Shape[] = [];
    for (const demand of this.hazards) {
      if (demand.surface !== live) continue;
      const x = trackX(demand.beat, beat);
      if (x < -CULL_MARGIN || x > 1 + CULL_MARGIN) continue;
      out.push(hazardShape(demand, x));
    }
    return out;
  }

  /** Every hazard, whichever surface, for the validator and the renderer. */
  hazardsOn(surface: TrackSurface, beat: number): HazardDemand[] {
    const out: HazardDemand[] = [];
    for (const demand of this.hazards) {
      if (demand.surface !== surface) continue;
      const x = trackX(demand.beat, beat);
      if (x < -CULL_MARGIN || x > 1 + CULL_MARGIN) continue;
      out.push(demand);
    }
    return out;
  }

  phraseAt(beat: number): WorldPhrase | null {
    for (const phrase of this.phrases) {
      if (beat >= phrase.startBeat && beat < phrase.endBeat) return phrase;
    }
    return null;
  }

  // ---- what is actually geometry ----------------------------------------

  /**
   * The beat ranges of a slab that are *geometry*, rather than a redrawing of
   * the base line.
   *
   * A slab placed on its surface's base line is not terrain, it is the floor.
   * The base line is solid wherever the course has no hole -- `resolveProbe`
   * falls back to it -- so such a slab changes no collision, cannot be jumped
   * onto (the player is already standing at its height) and cannot be jumped
   * under. Nothing in the game can tell it apart from the ground it duplicates.
   *
   * The renderer is the only thing that could, and did: it drew one brick of
   * body colour with a bright edge per landing, so a course read as a row of
   * blocks laid along the floor instead of as one running surface. Asking this
   * question instead of drawing them is the whole fix, and it is asked here, on
   * the world, because "is this piece real" is a fact about the course rather
   * than a decision for a paint call.
   *
   * The exception is the one case where a base-line slab is *not* the floor:
   * where it covers a hole. There it is a plate bridging the pit, it is real
   * terrain the player can stand on over nothing, and the part of it over the
   * pit is exactly the part that is not already drawn. That part is what comes
   * back; every other base-line slab comes back empty.
   */
  visibleSpans(slab: WorldSlab): Array<{ startBeat: number; endBeat: number }> {
    if (!isBaseLineSlab(slab)) return [{ startBeat: slab.startBeat, endBeat: slab.endBeat }];
    const spans: Array<{ startBeat: number; endBeat: number }> = [];
    for (const gap of this.gaps) {
      if (gap.surface !== slab.surface) continue;
      const start = Math.max(slab.startBeat, gap.startBeat);
      const end = Math.min(slab.endBeat, gap.endBeat);
      if (end - start > 1e-6) spans.push({ startBeat: start, endBeat: end });
    }
    return spans.sort((a, b) => a.startBeat - b.startBeat);
  }

  /** Spatial retirement: the course lives until its last beat has scrolled past. */
  isFinishedAt(beat: number): boolean {
    return beat > this.endBeat + 1.5;
  }
}

/**
 * How tall a beam's body is, above the gap the player slides through.
 *
 * Arbitrary visually -- nothing can reach it -- but it has to be tall enough
 * that a *standing* player's head is unambiguously inside it, or the beam would
 * be passable without sliding and stop meaning anything.
 */
export const BEAM_HEIGHT = 0.14;
/** How wide a beam is, in track units. */
export const BEAM_WIDTH = 0.07;

/**
 * A hazard's damaging shape at track x.
 *
 * A spike is a blade growing out of the running surface with `faceY` as its tip.
 * A beam is the opposite: a block hanging over the surface whose *underside* is
 * the clearance the player slides through, so its body is built upward from
 * `clearance` rather than downward from a tip.
 *
 * For a beam, `faceY` is the *running surface* the beam hangs over -- not a tip.
 * That matters because a beam can hang over a raised walkway (a corridor's whole
 * idea is a roof over a platform), and measuring its clearance from the base
 * line instead would put the gap somewhere the player is not: too high to be
 * ducked under when they are standing on the walkway, and clear of them
 * entirely when they are not.
 */
export function hazardShape(demand: HazardDemand, x: number): Shape {
  const gravityDown = demand.surface === 'FLOOR';
  if (demand.kind === 'WALL') {
    const clearance = demand.clearance ?? 0.13;
    const base = demand.faceY;
    const y = gravityDown ? base - clearance - BEAM_HEIGHT : base + clearance;
    return { kind: 'rect', x: x - BEAM_WIDTH / 2, y, w: BEAM_WIDTH, h: BEAM_HEIGHT };
  }
  const base = gravityDown ? FLOOR_Y : CEILING_Y_CONST;
  const tip = demand.faceY;
  const top = Math.min(tip, base);
  return { kind: 'rect', x: x - 0.012, y: top, w: 0.024, h: Math.abs(tip - base) };
}

/** Player x, re-exported so course consumers need one import, not two. */
export const COURSE_PLAYER_X = PLAYER_X;
/** Track units per beat, re-exported for course dumps. */
export const COURSE_UNITS_PER_BEAT = UNITS_PER_BEAT;

/** Build the world for a trajectory, anchored at `spawnBeat`. */
export function buildCourseWorld(trajectory: Trajectory, spawnBeat?: number): CourseWorld {
  return new CourseWorld(trajectory, spawnBeat);
}

/**
 * A slab as the mode's `Platform`: two x extents and two world-y faces.
 *
 * `top` is always the *upper* face and `bottom` the lower one, whichever surface
 * the slab belongs to -- the mode derives which of the two is standable from the
 * gravity it is under, so a ceiling slab reports `top` as its body and `bottom`
 * as the face the player runs along.
 */
function platformOf(slab: WorldSlab, x0: number, x1: number): Platform {
  return {
    x0,
    x1,
    top: Math.min(slab.faceY, slab.backY),
    bottom: Math.max(slab.faceY, slab.backY),
  };
}

/**
 * The face of a slab the player stands on, for a surface.
 *
 * Mirrors `platformOf` + `resolveProbe` exactly: the standable face is the
 * *upper* one under FLOOR gravity and the *lower* one under CEILING gravity,
 * because an inverted player hangs beneath the slab rather than on top of it.
 *
 * This lives here, exported, because the offline audit needs the same answer and
 * had its own copy that said `backY` for both surfaces. That is the kind of
 * disagreement the whole `CourseWorld` split exists to prevent: the audit was
 * checking inverted landings against the wrong face of every slab, so it
 * reported a landing as invalid whenever the slab was a real one.
 */
export function standFaceOf(slab: WorldSlab, surface: TrackSurface): number {
  return surface === 'FLOOR'
    ? Math.min(slab.faceY, slab.backY)
    : Math.max(slab.faceY, slab.backY);
}

/**
 * The face of a slab the player stands on *and the geometry is anchored to*.
 *
 * A floating slab's standable face is its own face. An anchored one reaches all
 * the way to the base line, so the line it is *placed* at -- `faceY` -- is where
 * the player runs, and the far face is the base line itself. Both of the faces
 * `standFaceOf` might return are then the same only when the slab is at the base
 * level; anywhere else, `standFaceOf` on an anchored slab answers a question
 * about where the mass reaches rather than where the player is.
 *
 * The audit needs the anchored answer when it is deciding whether a run's own
 * terrain is what is overhead: a run along a raised walkway that reaches down to
 * the floor line has its *own* mass below it, and reading that mass as a roof
 * would report the walkway as unstandable.
 */
export function placedFaceOf(slab: WorldSlab, surface: TrackSurface): number {
  return slab.floating ? standFaceOf(slab, surface) : slab.faceY;
}

/** The face of a slab a rising head meets, for a surface. See `standFaceOf`. */
export function blockFaceOf(slab: WorldSlab, surface: TrackSurface): number {
  return surface === 'FLOOR'
    ? Math.max(slab.faceY, slab.backY)
    : Math.min(slab.faceY, slab.backY);
}

/** World y of a surface's base line -- the ground the course runs along. */
export function baseYOf(surface: TrackSurface): number {
  return surface === 'FLOOR' ? FLOOR_Y : CEILING_Y_CONST;
}

/**
 * True when a slab sits *on* its surface's base line, so the player running the
 * base line is already standing on it.
 *
 * Read through `standFaceOf` rather than off `faceY`, so a slab that was placed
 * at the base line but anchored the other way still answers honestly. See
 * `CourseWorld.visibleSpans` for what follows from this.
 */
export function isBaseLineSlab(slab: WorldSlab): boolean {
  return Math.abs(standFaceOf(slab, slab.surface) - baseYOf(slab.surface)) < 1e-6;
}

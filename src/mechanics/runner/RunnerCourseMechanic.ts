/**
 * RUNNER course terrain: a whole stretch of level, as one mechanic.
 *
 * ## Why this is one mechanic and not many
 *
 * The rest of RUNNER is pattern-shaped: a spike is one hazard at one beat, and
 * the library's `R01`..`R09` mechanics each express exactly that. A *course* is
 * not that shape. A staircase is four slabs whose relationship to each other is
 * the entire point; spawning them as four independent `R04`s would lose the
 * relationship, and the mode would have no way to know the player is meant to be
 * climbing rather than dodging.
 *
 * So a course compiles into exactly one `RuntimeMechanic` that answers the
 * `RunnerTerrain` capability with *all* of its terrain at once, and owns the
 * gravity inversion for the stretch it covers.
 *
 * ## The world is a separate, pure object
 *
 * Everything this class reports comes from a `CourseWorld` -- a plain model of
 * the course as a function of a beat, with no clock and no canvas. That split is
 * what lets the traversal simulator and the offline validator ask the *same*
 * questions the live mode asks and get the same answers (spec §8, §30). This
 * class is then only the adapter: it reads the world at the current beat and
 * draws it.
 */

import { BaseMechanic, type MechanicSpawnContext } from '../../core/Mechanic';
import type { BouncePad, GroundGap, Platform, RunnerTerrain, TrackSurfaceLike } from '../../core/capabilities';
import type { Rect, Shape } from '../../core/geometry';
import type { Renderer } from '../../core/Renderer';
import { CourseWorld, blockFaceOf, hazardShape, standFaceOf } from './courseWorld';
import { CEILING_Y, GROUND_Y, trackX } from './runnerGeometry';
import type { VerticalZone } from './verticalZones';
import { MASS_FILL, MASS_OUTLINE, SURFACE_COLOUR, type TrackSurface } from './surface';
import type { Trajectory } from './trajectory';

/**
 * The palette, one rule per entry.
 *
 * A platformer's colours are a language, and a language with exceptions is not
 * one. Each entry below means exactly one thing everywhere it is used, so the
 * player can learn the vocabulary once:
 *
 *   - a *standable* face is the colour of its surface (`SURFACE_COLOUR`) and
 *     nothing else may use it. The base line, a step and a floating plate all
 *     answer "can I land here?" the same way, because the answer is the same;
 *   - *lethal* is red for a spike and orange for a beam;
 *   - *input the level is asking for* is green for a pad and gold for a ring;
 *   - *mass* -- a body the player can be stopped by but not stand on -- is a
 *     dark low-contrast fill with a thin outline. It never competes with any of
 *     the above, and it is never bright.
 *
 * Decoration has no entry here at all. It lives in `RunnerMode`'s background,
 * off the running plane and at low alpha, and never borrows a surface colour.
 */
/** The face of a floating slab a rising head meets: mass, not a landing. */
const MASS_FACE = MASS_OUTLINE;
const HAZARD_COLOUR = '#ff5c5c';
const BEAM_COLOUR = '#ff9d5c';
const PAD_COLOUR = '#4dffd0';
const AIRJUMP_COLOUR = '#ffd166';
const GAP_COLOUR = '#05070d';
const GAP_EDGE = '#7d86a3';

/**
 * The least body a slab is drawn with, whatever the trajectory said.
 *
 * A slab's depth is a physical number -- how far its mass reaches from the face
 * the player stands on -- and a shallow one would otherwise draw as a hairline
 * that reads as a stray line rather than as something solid.
 */
const MIN_MASS_DEPTH = 0.028;

export class RunnerCourseMechanic extends BaseMechanic implements RunnerTerrain {
  override readonly damageSource = 'OBSTACLE' as const;

  private readonly world: CourseWorld;

  constructor(spawn: MechanicSpawnContext, trajectory: Trajectory) {
    super(spawn);
    this.world = new CourseWorld(trajectory, spawn.activationBeat);
  }

  // ---- RunnerTerrain ----------------------------------------------------

  /** The course owns its own flips, so it answers for its own surface. */
  activeSurface(): TrackSurfaceLike {
    return this.world.surfaceAt(this.beat);
  }

  gravityScale(): number | null {
    return this.world.gravityAt(this.beat);
  }

  platforms(): Platform[] {
    // Only the slabs on the surface the course is *currently* on. A ceiling
    // slab while the player runs the floor is not terrain yet -- it is where
    // they will be after the flip, and handing it to the probe now would let
    // them land on it early.
    return this.world.platformsOn(this.world.surfaceAt(this.beat), this.beat);
  }

  groundGaps(): GroundGap[] {
    // Same reasoning as `platforms()`: a hole in the ceiling is not a hole
    // while the player is running the floor.
    return this.world.gapsOn(this.world.surfaceAt(this.beat), this.beat);
  }

  bouncePads(): BouncePad[] {
    return this.world.padsAt(this.beat);
  }

  /**
   * The hazards the trajectory tolerates.
   *
   * Unlike a legacy obstacle these are not gated on the ACTIVE phase: a course
   * covers a whole section, so it is dangerous for all of it, and what makes a
   * given spike live is whether the player is on its surface -- which the world
   * answers from the flip timeline.
   */
  override hazards(): Shape[] {
    return this.world.hazardsAt(this.beat);
  }

  /** Spatial retirement: the course lives until its last beat has scrolled past. */
  override get isFinished(): boolean {
    return this.world.isFinishedAt(this.beat);
  }

  protected dangerShapes(): Shape[] {
    return [];
  }

  private get beat(): number {
    return this.spawn.clock.absoluteBeat;
  }

  // ---- debug ------------------------------------------------------------

  /** Phrase currently under the player, for the debug view and the backdrop. */
  phraseAt(beat: number): {
    label: string;
    motif: string;
    intensity: number;
    surface: TrackSurface | null;
    zoneBeats: Record<VerticalZone, number>;
    groundRatio: number;
    startBeat: number;
  } | null {
    const phrase = this.world.phraseAt(beat);
    if (!phrase) return null;
    return {
      label: phrase.archetype,
      motif: phrase.motif,
      intensity: phrase.intensity,
      surface: phrase.surface,
      zoneBeats: phrase.zoneBeats,
      groundRatio: phrase.groundRatio,
      startBeat: phrase.startBeat,
    };
  }

  /**
   * True while an air-jump ring is live on the player's surface at `beat`.
   * The mode polls this and arms the player's mid-air jump; the ring is the
   * whole gate, so nothing here needs to know whether the player is airborne.
   */
  airJumpLive(beat: number): boolean {
    const ring = this.world.airJumpAt(beat);
    if (!ring) return false;
    return (this.world.gravityAt(beat) > 0) === (ring.surface === 'FLOOR');
  }

  // ---- render -----------------------------------------------------------

  render(r: Renderer): void {
    const beat = this.spawn.clock.visualBeat;
    // Terrain first, then the things that can hurt you, then the gate -- so a
    // hazard is never buried under the slab it sits on.
    this.renderGaps(r, beat);
    this.renderSlabs(r, beat);
    this.renderPads(r, beat);
    this.renderAirJumps(r, beat);
    this.renderHazards(r, beat);
    this.renderFlipGates(r, beat);
  }

  private renderGaps(r: Renderer, beat: number): void {
    for (const gap of this.world.gaps) {
      const x0 = trackX(gap.startBeat, beat);
      const x1 = trackX(gap.endBeat, beat);
      if (x1 < -0.1 || x0 > 1.1) continue;
      // The pit is the *body* of its own surface, hollowed out: from the base
      // line inward, in the direction gravity would drop the player.
      const base = gap.surface === 'FLOOR' ? GROUND_Y : 0;
      const depth = gap.surface === 'FLOOR' ? 1 - GROUND_Y : CEILING_Y;
      r.fillRect({ x: x0, y: base, w: x1 - x0, h: depth }, GAP_COLOUR, 1);
      const dir = gap.surface === 'FLOOR' ? 1 : -1;
      r.line(x0, base, x0, base + dir * 0.05, GAP_EDGE, 2, 0.8);
      r.line(x1, base, x1, base + dir * 0.05, GAP_EDGE, 2, 0.8);
    }
  }

  /**
   * Every slab that is *geometry*, drawn so a landing is unmistakable.
   *
   * Three things are deliberately absent here, and each was a real read the
   * player was being asked to make for nothing:
   *
   *   - **Base-line slabs.** A slab on its surface's base line is the floor, not
   *     terrain -- see `CourseWorld.visibleSpans`, which is what decides. Drawing
   *     them put a brick of body colour with a bright edge on the running surface
   *     once per landing, so half of every course (70 of the 134 slabs in the
   *     library) was furniture laid along the floor. They are not drawn at all,
   *     except where one bridges a hole, which is the one place such a slab is
   *     genuinely standable over nothing.
   *   - **A second edge colour.** A slab's standable face was cyan when the slab
   *     was floating and violet when it was anchored, a distinction no course in
   *     the library ever produced. Now every standable face is the colour of its
   *     surface, which is the same colour the base line uses -- so "land here"
   *     looks the same wherever it is, and the hue only ever means which way is
   *     down.
   *   - **A leading-edge stripe.** The body outline already gives the slab its
   *     extent; a second vertical line at the same place was one more mark on the
   *     screen saying what the silhouette already said.
   *
   * What is left is the hierarchy the mode is built on: mass, then the face you
   * land on, and nothing else.
   */
  private renderSlabs(r: Renderer, beat: number): void {
    for (const slab of this.world.slabs) {
      // The face the player stands on, and the one a rising head meets. Both come
      // from the world's own accessors so the drawing cannot disagree with the
      // collision about which of a slab's two faces is which.
      const stand = standFaceOf(slab, slab.surface);
      const far = blockFaceOf(slab, slab.surface);
      const depth = Math.max(MIN_MASS_DEPTH, Math.abs(stand - far));
      // Mass hangs *away* from the standable face: downward from a floor slab's
      // top, upward from a ceiling slab's underside.
      const top = slab.surface === 'FLOOR' ? stand : stand - depth;
      const body = { y: top, h: depth };

      for (const span of this.world.visibleSpans(slab)) {
        const x0 = trackX(span.startBeat, beat);
        const x1 = trackX(span.endBeat, beat);
        if (x1 < -0.1 || x0 > 1.1) continue;
        r.fillRect({ x: x0, y: body.y, w: x1 - x0, h: body.h }, MASS_FILL, 0.95);
        r.strokeRect({ x: x0, y: body.y, w: x1 - x0, h: body.h }, MASS_OUTLINE, 1.5, 0.7);
        // The landing face. This is the one bright mark on a platform.
        r.line(x0, stand, x1, stand, SURFACE_COLOUR[slab.surface], 3, 0.95);
        // The far face is mass, not a landing -- a corridor's roof, a plate's
        // underside. It is drawn quietly so it cannot be mistaken for one.
        r.line(x0, far, x1, far, MASS_FACE, 2, 0.55);
      }
    }
  }

  private renderPads(r: Renderer, beat: number): void {
    const gravityDown = this.world.gravityAt(beat) > 0;
    for (const pad of this.world.pads) {
      const x = trackX(pad.beat, beat);
      if (x < -0.1 || x > 1.1) continue;
      const body: Rect = this.world.padRect(pad, beat, gravityDown);
      const pulse = 0.5 + 0.5 * Math.sin(beat * Math.PI);
      r.fillRect(body, PAD_COLOUR, 0.9);
      r.strokeRect(body, '#d6fff4', 2, 0.9);
      r.text('▲', x, gravityDown ? body.y - 0.035 : body.y + body.h + 0.035, PAD_COLOUR, 15, 'center', 0.4 + 0.5 * pulse);
    }
  }

  /**
   * A mid-air jump ring: the visible promise that a second press *here* is
   * answered. Styled like a pad -- a bright box plus a glyph -- because it is
   * the same kind of object: input the level is asking for, at a place.
   */
  private renderAirJumps(r: Renderer, beat: number): void {
    for (const ring of this.world.airJumps) {
      const x = trackX(ring.beat, beat);
      if (x < -0.1 || x > 1.1) continue;
      const size = 0.035;
      const pulse = 0.5 + 0.5 * Math.sin(beat * Math.PI);
      const body: Rect = { x: x - size / 2, y: ring.faceY - size / 2, w: size, h: size };
      r.strokeRect(body, AIRJUMP_COLOUR, 2, 0.85);
      r.strokeRect({ x: body.x - 0.006, y: body.y - 0.006, w: body.w + 0.012, h: body.h + 0.012 }, AIRJUMP_COLOUR, 1, 0.3 + 0.4 * pulse);
      r.text('◎', x, ring.faceY + (this.world.gravityAt(beat) > 0 ? -0.05 : 0.055), AIRJUMP_COLOUR, 13, 'center', 0.5 + 0.4 * pulse);
    }
  }

  private renderHazards(r: Renderer, beat: number): void {
    const live = this.world.surfaceAt(beat);
    for (const demand of this.world.hazards) {
      const x = trackX(demand.beat, beat);
      if (x < -0.08 || x > 1.08) continue;
      // A hazard on the surface the player is not on is scenery: draw it dim so
      // the route reads as "that is over there" rather than "that is a threat".
      const alpha = demand.surface === live ? 1 : 0.3;
      const gravityDown = demand.surface === 'FLOOR';
      if (demand.kind === 'WALL') {
        // A beam: its underside is the clearance the player slides through, so
        // the *gap* is the readable thing and is drawn as a bright line. The
        // body comes from `hazardShape` rather than being re-derived here, so
        // what the player sees and what can hurt them are the same rect.
        const clearance = demand.clearance ?? 0.13;
        const base = demand.faceY;
        const body = hazardShape(demand, x) as Rect;
        r.fillRect(body, BEAM_COLOUR, 0.9 * alpha);
        r.strokeRect(body, '#ffe0b8', 2, 0.8 * alpha);
        const gapTop = gravityDown ? base - clearance : base + clearance;
        r.line(body.x, gapTop, body.x + body.w, gapTop, '#ffe0b8', 2, 0.6 * alpha);
        continue;
      }
      const tip = demand.faceY;
      const base = gravityDown ? GROUND_Y : CEILING_Y;
      r.glow(x, tip, Math.abs(tip - base) * 1.6, HAZARD_COLOUR, 0.2 * alpha);
      r.fillPolygon([
        { x: x - 0.012, y: base },
        { x, y: tip },
        { x: x + 0.012, y: base },
      ], HAZARD_COLOUR, 0.96 * alpha);
    }
  }

  /**
   * A gate at each inversion.
   *
   * The flip is the single most disorienting event in the mode, so it gets an
   * unmistakable marker: a full-height band at the exact beat the world turns
   * over, with arrows pointing the way gravity is about to go.
   */
  private renderFlipGates(r: Renderer, beat: number): void {
    for (const flip of this.world.flips) {
      const x = trackX(flip.beat, beat);
      if (x < -0.15 || x > 1.15) continue;
      const approaching = flip.beat - beat;
      const charge = Math.max(0, Math.min(1, 1 - approaching / 3));
      // The gate is coloured by the surface it hands the player to, so the mark
      // and the world it opens onto are the same colour.
      const colour = SURFACE_COLOUR[flip.to];
      const width = 0.014 + 0.02 * charge;
      r.fillRect({ x: x - width / 2, y: CEILING_Y, w: width, h: GROUND_Y - CEILING_Y }, colour, 0.18 + 0.35 * charge);
      r.line(x, CEILING_Y, x, GROUND_Y, colour, 2 + 3 * charge, 0.5 + 0.5 * charge);
      const arrow = flip.to === 'CEILING' ? '⇡' : '⇣';
      r.text(arrow, x, CEILING_Y + 0.045, colour, 16 + 8 * charge, 'center', 0.5 + 0.5 * charge);
      r.text(arrow, x, GROUND_Y - 0.045, colour, 16 + 8 * charge, 'center', 0.5 + 0.5 * charge);
    }
  }
}

/**
 * Compile a trajectory into the single mechanic that carries it.
 *
 * Kept as a free function rather than a method so the *registry* decides when a
 * course exists: the mechanic is registered under a synthetic id and only ever
 * constructed through this entry point, which is what keeps `PatternScheduler`
 * and `LevelLoader` unaware that courses exist at all.
 */
export function courseMechanic(spawn: MechanicSpawnContext, trajectory: Trajectory): RunnerCourseMechanic {
  return new RunnerCourseMechanic(spawn, trajectory);
}

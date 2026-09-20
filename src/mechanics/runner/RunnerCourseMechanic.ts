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
import { CourseWorld, hazardShape } from './courseWorld';
import { BODY_HEIGHT } from './runnerPhysics';
import { trackX } from './runnerGeometry';
import type { VerticalZone } from './verticalZones';
import type { TrackSurface } from './surface';
import type { Trajectory } from './trajectory';
/** Colours: terrain is quiet, the standable edge is bright, hazards shout. */
const SLAB_BODY = '#243050';
const SLAB_EDGE = '#7dd0ff';
const SLAB_ROOF_EDGE = '#b98cff';
const SLAB_DEAD_EDGE = '#3d4c75';
const HAZARD_COLOUR = '#ff5c5c';
const BEAM_COLOUR = '#ff9d5c';
const PAD_COLOUR = '#4dffd0';
const AIRJUMP_COLOUR = '#ffd166';
const GAP_COLOUR = '#05070d';
const GAP_EDGE = '#7d86a3';

/** How deep a slab is drawn when the trajectory did not say. */
const DEFAULT_SLAB_DEPTH = BODY_HEIGHT;

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

  /** Phrase currently under the player, for the debug view. */
  phraseAt(beat: number): {
    label: string;
    motif: string;
    intensity: number;
    surface: TrackSurface | null;
    zoneBeats: Record<VerticalZone, number>;
    groundRatio: number;
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
    this.renderPhraseTint(r, beat);
    this.renderFlipGates(r, beat);
  }

  /**
   * A hairline of colour on the running surface for the phrase in play.
   *
   * Spec §65's readability requirement is really a *legibility* one: the player
   * should be able to feel that a new phrase started without reading anything.
   * A tint that changes per motif does that at almost no cost, and it makes the
   * motif's recurrence visible -- the same colour coming back is the mode
   * telling the player "you have done this before".
   */
  private renderPhraseTint(r: Renderer, beat: number): void {
    const phrase = this.world.phraseAt(beat);
    if (!phrase) return;
    const gravityDown = this.world.gravityAt(beat) > 0;
    const y = gravityDown ? 0.72 : 0.28;
    const colour = motifColour(phrase.motif);
    const x0 = trackX(phrase.startBeat, beat);
    const x1 = trackX(phrase.endBeat, beat);
    const left = Math.max(-0.02, x0);
    const right = Math.min(1.02, x1);
    if (right <= left) return;
    const dir = gravityDown ? 1 : -1;
    r.fillRect({ x: left, y: y + (gravityDown ? 0 : -0.012), w: right - left, h: 0.012 }, colour, 0.5);
    r.line(left, y + dir * 0.02, right, y + dir * 0.02, colour, 1.5, 0.35);
  }

  private renderGaps(r: Renderer, beat: number): void {
    for (const gap of this.world.gaps) {
      const x0 = trackX(gap.startBeat, beat);
      const x1 = trackX(gap.endBeat, beat);
      if (x1 < -0.1 || x0 > 1.1) continue;
      const base = gap.surface === 'FLOOR' ? 0.72 : 0;
      r.fillRect({ x: x0, y: base, w: x1 - x0, h: 0.28 }, GAP_COLOUR, 1);
      const dir = gap.surface === 'FLOOR' ? 1 : -1;
      r.line(x0, base, x0, base + dir * 0.05, GAP_EDGE, 2, 0.8);
      r.line(x1, base, x1, base + dir * 0.05, GAP_EDGE, 2, 0.8);
    }
  }

  private renderSlabs(r: Renderer, beat: number): void {
    const gravityDown = this.world.gravityAt(beat) > 0;
    for (const slab of this.world.slabs) {
      const x0 = trackX(slab.startBeat, beat);
      const x1 = trackX(slab.endBeat, beat);
      if (x1 < -0.1 || x0 > 1.1) continue;
      const top = Math.min(slab.faceY, slab.backY);
      const bottom = Math.max(slab.faceY, slab.backY);
      const h = Math.max(DEFAULT_SLAB_DEPTH * 0.35, bottom - top);
      r.fillRect({ x: x0, y: top, w: x1 - x0, h }, SLAB_BODY, 0.95);
      // The standable edge is the bright line. Which of the two faces that is
      // depends on gravity, so the *live* one is drawn brighter and the other
      // dimmer -- the same read the track itself uses.
      const liveFace = gravityDown ? slab.faceY : slab.backY;
      const deadFace = gravityDown ? slab.backY : slab.faceY;
      r.line(x0, liveFace, x1, liveFace, slab.floating ? SLAB_EDGE : SLAB_ROOF_EDGE, 3, 0.95);
      r.line(x0, deadFace, x1, deadFace, SLAB_DEAD_EDGE, 2, 0.5);
      // A leading-edge marker so the direction of travel is legible on a wide slab.
      r.line(x1, top, x1, bottom, '#8fa6d8', 1.5, 0.55);
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
      const base = gravityDown ? 0.72 : 0.28;
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
      const colour = flip.to === 'CEILING' ? '#8a5fff' : '#4dffd0';
      const width = 0.014 + 0.02 * charge;
      r.fillRect({ x: x - width / 2, y: 0.28, w: width, h: 0.44 }, colour, 0.18 + 0.35 * charge);
      r.line(x, 0.28, x, 0.72, colour, 2 + 3 * charge, 0.5 + 0.5 * charge);
      const arrow = flip.to === 'CEILING' ? '⇡' : '⇣';
      r.text(arrow, x, 0.28 + 0.045, colour, 16 + 8 * charge, 'center', 0.5 + 0.5 * charge);
      r.text(arrow, x, 0.72 - 0.045, colour, 16 + 8 * charge, 'center', 0.5 + 0.5 * charge);
    }
  }
}

/**
 * A motif's colour, hashed from its id.
 *
 * Deterministic and free of state: the same motif is always the same colour, on
 * every run and in every section, which is the whole point -- a recurring motif
 * has to *look* like the one that came before or the memory is invisible.
 */
function motifColour(motif: string): string {
  const palette = ['#4dffd0', '#7dd0ff', '#b98cff', '#ffd166', '#ff8fb1', '#9ffcff'];
  let h = 2166136261;
  for (let i = 0; i < motif.length; i++) {
    h ^= motif.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return palette[(h >>> 0) % palette.length];
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

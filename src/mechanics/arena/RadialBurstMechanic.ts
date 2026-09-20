/**
 * A04 -- Radial Burst (ARENA): a rotating spray.
 *
 * Not a static ring any more: one or more *bursts* of projectiles fire from the
 * centre (or inward from the rim), and each emission is rotated by `stepDeg`
 * from the last, so the spray walks around the arena. Because the rotation
 * trend is visible from the first two emissions, the player can read where the
 * next burst will point -- prediction, not reaction.
 *
 * Fairness floors are built in at construction: the angular gap between
 * consecutive bursts is never smaller than the player at the reference radius,
 * and the gap never rotates faster than the player can chase it.
 *
 * Params:
 *   arms             streams rotating together        default 1
 *   bulletsPerBurst  projectiles per emission         default 3
 *   burstArcDeg      angular width of each burst      default 40
 *   stepDeg          rotation between emissions       default 45
 *   subdivision      beats between emissions          default 1
 *   direction        "CW" | "CCW" | "ALTERNATE"       default "CW"
 *   startAngleDeg    first emission angle             default -90
 *   origin           "CENTER" | "EDGE"                default "CENTER"
 *   speed            travel-speed multiplier          default 1.0
 *   shape            bullet silhouette, see bullets.ts default per origin
 *   emitter          "STATIC" | CIRCLE | SQUARE | DIAMOND | FIGURE_EIGHT
 *                    | WAVE | ORBIT                   default "STATIC"
 *   emitterRadius    how far a moving emitter travels  default 0.22
 *   emitterSpeed     orbits per second                default 0.5
 *   emitterAngleDeg  where the emitter starts         default -90
 *
 * Legacy aliases: gapCount -> arms, gapAngleDeg -> startAngleDeg,
 * gapArcDeg -> burstArcDeg, rotationDeg -> added to startAngleDeg.
 *
 * ANTICIPATION: guide spokes, a charging core, and the first emissions ghosted.
 * ACTION:       each burst leaves on its subdivision, trails behind it.
 * IMPACT:       a shockwave and a camera pulse at the origin.
 */

import { BaseMechanic, type MechanicSpawnContext, type MechanicPhase } from '../../core/Mechanic';
import type { Shape } from '../../core/geometry';
import { clamp } from '../../core/geometry';
import { minimumAngularGap, maxGapShiftPerBeat } from '../../core/fairness';
import { easeIn, easeOutCubic } from '../../feel/Easing';
import type { Renderer } from '../../core/Renderer';
import { TUNING } from '../../tuning';
import {
  ARENA_CENTRE, ARENA_OUTER_RADIUS, degToRad, polarToField,
} from './polar';
import { slowed } from './arenaTiming';
import { bulletHitCircles, drawBullet, readShape, type BulletShape } from './bullets';

interface Bullet {
  angle: number;
  /** Emission beat; travel is measured from here. */
  emitBeat: number;
  radius: number;
  /** Where the emitter was when this bullet left it, in field space. */
  ox: number;
  oy: number;
  /** Trail samples, oldest first. */
  trail: number[];
}

/**
 * Emitter paths. The emitter is a *source*, not a hazard: it never damages, so
 * it is allowed to move at whatever rate reads best. What must not happen is the
 * player losing track of it, which is why every path here is closed, centred and
 * slow, and why the motion is a pure function of the beat rather than of frame
 * time -- the same emission always comes from the same place.
 */
export type EmitterPath = 'STATIC' | 'CIRCLE' | 'SQUARE' | 'DIAMOND' | 'FIGURE_EIGHT' | 'WAVE' | 'ORBIT';

const EMITTER_PATHS: EmitterPath[] = ['STATIC', 'CIRCLE', 'SQUARE', 'DIAMOND', 'FIGURE_EIGHT', 'WAVE', 'ORBIT'];

/** Radius at which the spray's angular gaps are guaranteed to fit the player. */
const REFERENCE_RADIUS = 0.32;
const COLOUR = '#ffd479';
const EDGE_COLOUR = '#ff8a3d';
const EDGE_BULLET_COLOUR = '#ff9d6b';
const EDGE_BULLET_EDGE = '#c2551f';

export class RadialBurstMechanic extends BaseMechanic {
  override readonly damageSource = 'PROJECTILE' as const;

  private readonly bullets: Bullet[] = [];
  private readonly fromCentre: boolean;
  private readonly bulletRadius: number;
  private readonly travelBeats: number;
  /** Emission schedule: burst centre angle per emission, in order. */
  private readonly emissionAngles: number[] = [];
  private readonly subdivision: number;
  private readonly burstArc: number;
  private readonly startAngle: number;
  private readonly stepRad: number;
  private readonly bulletShape: BulletShape;
  private readonly emitterPath: EmitterPath;
  private readonly emitterRadius: number;
  private readonly emitterBeatsPerLap: number;
  private readonly emitterStart: number;

  constructor(spawn: MechanicSpawnContext) {
    super(slowed(spawn));
    this.fromCentre = String(this.params.origin ?? 'CENTER').toUpperCase() !== 'EDGE';
    // Centre bullets are the arena's own voice and get the round family; edge
    // bullets arrive from a wall and get a pointed one, so origin reads instantly.
    this.bulletRadius = this.fromCentre
      ? TUNING.arena.projectileRadius * 0.9
      : TUNING.arena.edgeProjectileRadius * 0.9;
    this.bulletShape = readShape(this.params.shape, this.fromCentre ? 'ORB' : 'ARROW');

    // Each burst crosses the arena in its own travel, fast enough that several
    // emissions fit inside the active window -- the rotation trend needs at
    // least two or three bursts to read.
    const speed = numberOr(this.params.speed, 1) * (1 + 0.25 * this.intensity);
    const spb = Math.max(0.01, this.spawn.clock.secondsPerBeat);
    this.travelBeats = clamp((ARENA_OUTER_RADIUS / (TUNING.arena.projectileSpeed * speed)) / spb, 0.5, 3);

    // Moving emitter. The path is closed and centred, and a lap is floored at
    // four beats so the source can never become the hard part of the read.
    const pathName = String(this.params.emitter ?? 'STATIC').toUpperCase();
    this.emitterPath = (EMITTER_PATHS as string[]).includes(pathName)
      ? (pathName as EmitterPath)
      : 'STATIC';
    this.emitterRadius = clamp(numberOr(this.params.emitterRadius, 0.22), 0.05, 0.34);
    this.emitterBeatsPerLap = Math.max(4, 1 / Math.max(0.02, numberOr(this.params.emitterSpeed, 0.5)));
    this.emitterStart = degToRad(numberOr(this.params.emitterAngleDeg, -90));

    // Legacy aliases keep old patterns compiling against the new design.
    const arms = clamp(Math.round(numberOr(this.params.arms, numberOr(this.params.gapCount, 1))), 1, 3);
    const perBurst = clamp(Math.round(numberOr(this.params.bulletsPerBurst, 3)), 2, 4);
    this.burstArc = degToRad(clamp(
      numberOr(this.params.burstArcDeg, numberOr(this.params.gapArcDeg, 40)) * this.tier.gapScale,
      22, 60,
    ));
    this.startAngle = degToRad(
      numberOr(this.params.startAngleDeg, numberOr(this.params.gapAngleDeg, -90))
      + numberOr(this.params.rotationDeg, 0),
    );
    this.subdivision = clamp(numberOr(this.params.subdivision, 1), 0.5, 2);

    // Rotation step: big enough that bursts never close the circle on the
    // player, small enough that the moving gap does not outrun them.
    const minGapDeg = minimumAngularGap(TUNING.arena.playerRadius, REFERENCE_RADIUS) * (180 / Math.PI);
    const maxStepRad = (maxGapShiftPerBeat(spb) * this.subdivision) / REFERENCE_RADIUS;
    const requestedStep = clamp(numberOr(this.params.stepDeg, 45), 10, 90);
    this.stepRad = Math.min(
      degToRad(Math.max(requestedStep, this.burstArc * (180 / Math.PI) + minGapDeg)),
      maxStepRad,
    );

    const dirParam = String(this.params.direction ?? 'CW').toUpperCase();
    const baseDir = dirParam === 'CCW' ? -1 : 1;
    // Emissions across the active window; each bullet must finish its travel
    // before the mechanic retires. ALTERNATE zig-zags: the stream walks out
    // and back, which reads as a call-and-response with the beat.
    const emissions = Math.max(1, Math.floor((this.timing.durationBeats - this.travelBeats) / this.subdivision) + 1);
    let current = this.startAngle;
    let prevDir = baseDir;
    for (let k = 0; k < emissions; k++) {
      const dir = dirParam === 'ALTERNATE' ? (k % 2 === 0 ? 1 : -1) : baseDir;
      if (k > 0) current += this.stepRad * prevDir;
      this.emissionAngles.push(current);
      const emitBeat = this.activationBeat + k * this.subdivision;
      const origin = this.emitterAt(emitBeat);
      for (let b = 0; b < perBurst; b++) {
        // Spread inside the burst: for two bullets at the edges, otherwise
        // centred around the emission angle so the burst reads as one blade.
        const u = perBurst === 1 ? 0 : b / (perBurst - 1) - 0.5;
        const angle = current + this.burstArc * u;
        this.bullets.push({
          angle, emitBeat, radius: 0, ox: origin.x, oy: origin.y, trail: [],
        });
      }
      prevDir = dir;
    }
    // Interleave arms: evenly spaced streams rotating together.
    if (arms > 1) {
      const spacing = (Math.PI * 2) / arms;
      const base = [...this.bullets];
      for (let a = 1; a < arms; a++) {
        for (const b of base) {
          this.bullets.push({ ...b, angle: b.angle + spacing * a, trail: [] });
        }
      }
    }
  }

  /**
   * Where the emitter is at `beat`, in field space.
   *
   * A pure function of the beat, like everything else that moves here, so an
   * emission always leaves from the same place on a replay. STATIC returns the
   * arena centre (or the rim, for an inward spray), which is what every existing
   * pattern gets and therefore what keeps them byte-identical.
   */
  private emitterAt(beat: number): { x: number; y: number } {
    if (this.emitterPath === 'STATIC') return { x: ARENA_CENTRE.x, y: ARENA_CENTRE.y };
    // ORBIT is the rim emitter: the same shapes as CIRCLE, but pushed out to the
    // edge so the spray comes from the wall rather than from inside.
    const base = this.emitterPath === 'ORBIT' ? ARENA_OUTER_RADIUS * 0.92 : this.emitterRadius;
    const turns = (beat - this.activationBeat) / this.emitterBeatsPerLap;
    const t = this.emitterStart + turns * Math.PI * 2;
    switch (this.emitterPath) {
      case 'CIRCLE':
      case 'ORBIT':
        return polarToField(t, base);
      case 'SQUARE':
      case 'DIAMOND': {
        // The same angle, measured in a different norm: SQUARE is L-infinity
        // (a box), DIAMOND is L1 (a rotated box). Both stay continuous, so the
        // emitter rounds its corners instead of teleporting across them.
        const cos = Math.cos(t);
        const sin = Math.sin(t);
        const norm = this.emitterPath === 'SQUARE'
          ? Math.max(Math.abs(cos), Math.abs(sin))
          : Math.abs(cos) + Math.abs(sin);
        const scale = base / Math.max(1e-4, norm);
        return { x: ARENA_CENTRE.x + cos * scale, y: ARENA_CENTRE.y + sin * scale };
      }
      case 'FIGURE_EIGHT':
        // Lemniscate of Gerono: crosses the middle twice per lap, which makes
        // the emitter's own path the thing the player tracks.
        return {
          x: ARENA_CENTRE.x + Math.cos(t) * base,
          y: ARENA_CENTRE.y + Math.sin(t * 2) * base * 0.5,
        };
      case 'WAVE':
        // Along one axis, drifting on the other: the emitter slides across the
        // arena and back rather than circling it.
        return {
          x: ARENA_CENTRE.x + Math.sin(t) * base,
          y: ARENA_CENTRE.y + Math.sin(t * 2) * base * 0.45,
        };
      default:
        return { x: ARENA_CENTRE.x, y: ARENA_CENTRE.y };
    }
  }

  /** 0..1 travel progress of a bullet. */
  private progress(beat: number, emitBeat: number): number {
    return clamp((beat - emitBeat) / this.travelBeats, 0, 1);
  }

  /**
   * How far a bullet has travelled from its own emitter, in field units.
   *
   * A bullet that leaves a moving emitter keeps that emitter's offset for the
   * rest of its flight -- it travels along a parallel line, not one that bends
   * back toward the arena centre. Recomputing the emitter per frame would make
   * every shot curve, which reads as a homing missile.
   */
  private distanceAt(beat: number, emitBeat: number): number {
    const t = easeOutCubic(this.progress(beat, emitBeat));
    return this.fromCentre ? t * ARENA_OUTER_RADIUS : t * (ARENA_OUTER_RADIUS - 0.04);
  }

  protected override onUpdate(u: { beat: number }): void {
    if (this.phase !== 'ACTIVE') return;
    for (const b of this.bullets) {
      b.radius = this.distanceAt(u.beat, b.emitBeat);
      b.trail.push(b.radius);
      if (b.trail.length > TUNING.arena.projectileTrail) b.trail.shift();
    }
  }

  /** Field position of a bullet, given how far it has travelled. */
  private positionOf(b: Bullet, distance: number): { x: number; y: number } {
    if (this.fromCentre) {
      return { x: b.ox + Math.cos(b.angle) * distance, y: b.oy + Math.sin(b.angle) * distance };
    }
    // Inward: the bullet starts at the rim and falls toward the emitter.
    const start = ARENA_OUTER_RADIUS;
    return {
      x: b.ox + Math.cos(b.angle) * (start - distance),
      y: b.oy + Math.sin(b.angle) * (start - distance),
    };
  }

  protected override onPhaseChange(_from: MechanicPhase, to: MechanicPhase): void {
    if (to === 'TELEGRAPH') this.feel.sfx('projectile_charge');
    if (to === 'ACTIVE') {
      const origin = this.emitterAt(this.activationBeat);
      this.feel.impact('MEDIUM', {
        x: origin.x, y: origin.y, colour: COLOUR, sfx: 'projectile_fire',
        shockwave: this.fromCentre,
      });
    }
  }

  protected dangerShapes(): Shape[] {
    const beat = this.spawn.clock.absoluteBeat;
    const shapes: Shape[] = [];
    for (const b of this.bullets) {
      if (b.emitBeat > beat + 1e-9) continue;
      const p = this.positionOf(b, this.distanceAt(beat, b.emitBeat));
      for (const c of bulletHitCircles(this.bulletShape, p.x, p.y, this.bulletRadius, b.angle)) {
        shapes.push({ kind: 'circle' as const, ...c });
      }
    }
    return shapes;
  }

  render(r: Renderer): void {
    const beat = this.spawn.clock.visualBeat;

    if (this.phase === 'TELEGRAPH') {
      const t = this.telegraphProgress(beat);
      const grow = easeIn(t);

      if (this.fromCentre) {
        // Outward: spokes push out from a charging core, so the eye starts at
        // the centre and is carried to where the ring will pass.
        const core = this.emitterAt(this.activationBeat);
        for (const b of this.bullets.slice(0, 9)) {
          const to = {
            x: core.x + Math.cos(b.angle) * ARENA_OUTER_RADIUS * (0.25 + 0.5 * grow),
            y: core.y + Math.sin(b.angle) * ARENA_OUTER_RADIUS * (0.25 + 0.5 * grow),
          };
          r.line(core.x, core.y, to.x, to.y, EDGE_COLOUR, 1, 0.10 + 0.25 * t);
        }
        const size = 0.012 + 0.03 * grow;
        r.glow(core.x, core.y, size * 3, COLOUR, 0.25 + 0.5 * t);
        r.fillCircle(core.x, core.y, size, '#fff3d0', 0.6 + 0.4 * t);
        if (this.emitterPath !== 'STATIC') this.renderEmitterPath(r, t);
      } else {
        // Inward: the threat starts at the rim, so the warning does too --
        // muzzle marks on the perimeter and spokes aimed at the centre.
        const core = this.emitterAt(this.activationBeat);
        for (const b of this.bullets.slice(0, 9)) {
          const from = {
            x: core.x + Math.cos(b.angle) * ARENA_OUTER_RADIUS * 0.94,
            y: core.y + Math.sin(b.angle) * ARENA_OUTER_RADIUS * 0.94,
          };
          const to = {
            x: core.x + Math.cos(b.angle) * ARENA_OUTER_RADIUS * (0.94 - 0.55 * grow),
            y: core.y + Math.sin(b.angle) * ARENA_OUTER_RADIUS * (0.94 - 0.55 * grow),
          };
          r.line(from.x, from.y, to.x, to.y, EDGE_COLOUR, 1.5, 0.12 + 0.35 * t);
          r.fillCircle(from.x, from.y, 0.008 + 0.012 * grow, COLOUR, 0.4 + 0.5 * t);
        }
        r.strokeCircle(core.x, core.y, ARENA_OUTER_RADIUS * 0.94, EDGE_COLOUR, 2, 0.12 + 0.3 * t);
      }

      // The rotation trend: a curved arrow around the hub and the first
      // emissions' fans ghosted, so the player predicts instead of reacting.
      const hub = this.emitterAt(this.activationBeat);
      const firstDir = this.emissionAngles.length >= 2
        ? Math.sign(this.emissionAngles[1] - this.emissionAngles[0])
        : 1;
      r.strokeArc(
        hub.x, hub.y, 0.12,
        this.startAngle + (firstDir < 0 ? Math.PI * 0.25 : -Math.PI * 0.25),
        this.startAngle + (firstDir < 0 ? -Math.PI * 0.25 : Math.PI * 0.25),
        EDGE_COLOUR, 2, 0.25 + 0.35 * t,
      );
      for (const k of [0, 1, 2]) {
        if (k >= this.emissionAngles.length) break;
        const centre = this.emissionAngles[k];
        const at = this.emitterAt(this.activationBeat + k * this.subdivision);
        r.strokeArc(
          at.x, at.y, REFERENCE_RADIUS + 0.05,
          centre - this.burstArc / 2, centre + this.burstArc / 2,
          '#ffb35c', 2, 0.18 + 0.3 * t,
        );
      }
      return;
    }

    if (this.phase !== 'ACTIVE') return;
    for (const b of this.bullets) {
      if (b.emitBeat > beat + 1e-9) continue;
      const head = this.positionOf(b, b.radius);
      if (b.trail.length > 1) {
        const tail = this.positionOf(b, b.trail[0]);
        r.line(tail.x, tail.y, head.x, head.y, this.fromCentre ? EDGE_COLOUR : EDGE_BULLET_EDGE, 2, 0.35);
      }
      drawBullet(r, {
        x: head.x,
        y: head.y,
        radius: this.bulletRadius,
        shape: this.bulletShape,
        angle: this.fromCentre ? b.angle : b.angle + Math.PI,
        colour: this.fromCentre ? COLOUR : EDGE_BULLET_COLOUR,
        edge: this.fromCentre ? EDGE_COLOUR : EDGE_BULLET_EDGE,
        glow: this.fromCentre,
      });
    }
    // The emitter itself, drawn last so it sits on top of its own spray: the
    // player needs to be able to find the source, not just its output.
    if (this.emitterPath !== 'STATIC') {
      const at = this.emitterAt(beat);
      r.glow(at.x, at.y, 0.06, COLOUR, 0.35);
      r.fillCircle(at.x, at.y, 0.016, '#fff3d0', 0.9);
      r.strokeCircle(at.x, at.y, 0.024, EDGE_COLOUR, 2, 0.7);
    }
  }

  /**
   * The path a moving emitter will take, ghosted during the telegraph.
   *
   * A source that moves without showing where it is going is a source the player
   * has to guess about, which is exactly the "unreadable" failure the brief
   * warns about. Drawing the whole loop up front costs nothing and turns the
   * emitter from a surprise into a landmark.
   */
  private renderEmitterPath(r: Renderer, progress: number): void {
    const points: Array<{ x: number; y: number }> = [];
    const steps = 48;
    for (let i = 0; i <= steps; i++) {
      points.push(this.emitterAt(this.activationBeat + (i / steps) * this.emitterBeatsPerLap));
    }
    r.polyline(points, EDGE_COLOUR, 1, 0.10 + 0.18 * progress);
    r.strokeCircle(ARENA_CENTRE.x, ARENA_CENTRE.y, this.emitterRadius, EDGE_COLOUR, 1, 0.06 + 0.1 * progress);
  }
}

function numberOr(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

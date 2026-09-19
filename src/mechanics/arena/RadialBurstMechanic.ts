/**
 * A04 -- Radial Burst (ARENA).
 *
 * A ring of projectiles fired from the centre (or inward from the rim) with one
 * or more safe arcs. Rotating `gapAngleDeg` between repeats turns a static ring
 * into a safe arc that walks around the arena, which is the backbone of the
 * mode's radial choreography.
 *
 * Params:
 *   count         projectiles in the full ring        default 18
 *   gapCount      openings                            default 1
 *   gapArcDeg     width of each opening               default 46
 *   gapAngleDeg   where the first opening points      default -90 (north)
 *   rotationDeg   extra rotation applied to the gap   default 0
 *   origin        "CENTER" | "EDGE"                   default "CENTER"
 *   speed         travel-speed multiplier             default 1.0
 *
 * ANTICIPATION: guide spokes and a charging core.
 * ACTION:       the ring leaves the centre on the beat.
 * IMPACT:       a shockwave and a camera pulse at the origin.
 */

import { BaseMechanic, type MechanicSpawnContext, type MechanicPhase } from '../../core/Mechanic';
import type { Shape } from '../../core/geometry';
import { clamp, normalizeAngle } from '../../core/geometry';
import { easeIn, easeOutCubic } from '../../feel/Easing';
import type { Renderer } from '../../core/Renderer';
import { TUNING } from '../../tuning';
import {
  ARENA_CENTRE, ARENA_OUTER_RADIUS, dangerArcs, degToRad, polarToField, spreadGaps,
} from './polar';

interface Bullet {
  angle: number;
  radius: number;
  /** Trail samples, oldest first. */
  trail: number[];
}

const COLOUR = '#ffd479';
const EDGE_COLOUR = '#ff8a3d';

export class RadialBurstMechanic extends BaseMechanic {
  private readonly bullets: Bullet[] = [];
  private readonly fromCentre: boolean;
  private readonly bulletRadius: number;
  private readonly travelBeats: number;
  private readonly gapCentres: number[];
  private readonly gapArc: number;

  constructor(spawn: MechanicSpawnContext) {
    super(spawn);
    this.fromCentre = String(this.params.origin ?? 'CENTER').toUpperCase() !== 'EDGE';
    this.bulletRadius = TUNING.arena.projectileRadius * 0.85;

    const speed = numberOr(this.params.speed, 1) * (1 + 0.25 * this.intensity);
    this.travelBeats = Math.max(0.5, this.timing.durationBeats / Math.max(0.25, speed));

    this.gapArc = degToRad(clamp(numberOr(this.params.gapArcDeg, 46), 18, 150));
    const first = degToRad(numberOr(this.params.gapAngleDeg, -90) + numberOr(this.params.rotationDeg, 0));
    this.gapCentres = spreadGaps(first, numberOr(this.params.gapCount, 1));

    // Lay bullets around the ring, dropping the ones that fall inside a gap.
    const count = Math.max(6, Math.round(numberOr(this.params.count, 18)));
    const arcs = dangerArcs(this.gapCentres, this.gapArc);
    const step = (Math.PI * 2) / count;
    for (let i = 0; i < count; i++) {
      const angle = first + i * step;
      if (!arcs.some(([a0, a1]) => inArc(angle, a0, a1))) continue;
      this.bullets.push({ angle, radius: 0, trail: [] });
    }
  }

  /** 0..1 travel progress. */
  private progress(beat: number): number {
    return clamp((beat - this.activationBeat) / this.travelBeats, 0, 1);
  }

  private radiusAt(beat: number): number {
    const t = this.progress(beat);
    const eased = easeOutCubic(t);
    return this.fromCentre
      ? 0.04 + eased * ARENA_OUTER_RADIUS
      : ARENA_OUTER_RADIUS - eased * ARENA_OUTER_RADIUS;
  }

  protected override onUpdate(u: { beat: number }): void {
    if (this.phase !== 'ACTIVE') return;
    const radius = this.radiusAt(u.beat);
    for (const b of this.bullets) {
      b.radius = radius;
      b.trail.push(radius);
      if (b.trail.length > TUNING.arena.projectileTrail) b.trail.shift();
    }
  }

  protected override onPhaseChange(_from: MechanicPhase, to: MechanicPhase): void {
    if (to === 'TELEGRAPH') this.feel.sfx('projectile_charge');
    if (to === 'ACTIVE') {
      const origin = this.fromCentre ? ARENA_CENTRE : { x: 0.5, y: 0.5 };
      this.feel.impact('MEDIUM', {
        x: origin.x, y: origin.y, colour: COLOUR, sfx: 'projectile_fire',
        shockwave: this.fromCentre,
      });
    }
  }

  protected dangerShapes(): Shape[] {
    return this.bullets.map((b) => {
      const p = polarToField(b.angle, b.radius);
      return { kind: 'circle' as const, x: p.x, y: p.y, r: this.bulletRadius };
    });
  }

  render(r: Renderer): void {
    const beat = this.spawn.clock.visualBeat;

    if (this.phase === 'TELEGRAPH') {
      const t = this.telegraphProgress(beat);
      // Spokes show exactly which angles will be covered; the gaps stay dark.
      for (const b of this.bullets) {
        const to = polarToField(b.angle, ARENA_OUTER_RADIUS * (0.25 + 0.5 * easeIn(t)));
        r.line(ARENA_CENTRE.x, ARENA_CENTRE.y, to.x, to.y, EDGE_COLOUR, 1, 0.10 + 0.25 * t);
      }
      // Safe arcs are drawn positively, so the player looks for the opening.
      for (const centre of this.gapCentres) {
        r.strokeArc(
          ARENA_CENTRE.x, ARENA_CENTRE.y, 0.3,
          centre - this.gapArc / 2, centre + this.gapArc / 2,
          '#7dffb0', 3, 0.3 + 0.5 * t,
        );
      }
      const core = 0.012 + 0.03 * easeIn(t);
      r.glow(ARENA_CENTRE.x, ARENA_CENTRE.y, core * 3, COLOUR, 0.25 + 0.5 * t);
      r.fillCircle(ARENA_CENTRE.x, ARENA_CENTRE.y, core, '#fff3d0', 0.6 + 0.4 * t);
      return;
    }

    if (this.phase !== 'ACTIVE') return;
    for (const b of this.bullets) {
      const head = polarToField(b.angle, b.radius);
      if (b.trail.length > 1) {
        const tail = polarToField(b.angle, b.trail[0]);
        r.line(tail.x, tail.y, head.x, head.y, EDGE_COLOUR, 2, 0.35);
      }
      r.fillCircle(head.x, head.y, this.bulletRadius, COLOUR);
      r.strokeCircle(head.x, head.y, this.bulletRadius + 0.005, EDGE_COLOUR, 2, 0.8);
    }
  }
}

function inArc(angle: number, a0: number, a1: number): boolean {
  const offset = normalizeAngle(angle - a0);
  return offset <= normalizeAngle(a1 - a0) + 1e-9;
}

function numberOr(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

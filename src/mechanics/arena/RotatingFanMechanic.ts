/**
 * A07 -- Rotating Fan (ARENA).
 *
 * Angular arms sweeping around the centre. Rotation is quantised to the beat,
 * not to frames: at `rotationPerBeatDeg` the fan advances exactly that far each
 * beat and eases between steps, so the sweep is something you can hear.
 *
 * Params:
 *   arms                 number of arms                      default 3
 *   armArcDeg            angular width of each arm           default 34
 *   startAngleDeg        where arm 0 begins                  default -90
 *   rotationPerBeatDeg   degrees advanced per beat           default 45
 *   direction            "CW" | "CCW"                        default "CW"
 *   radius               outer radius of the arms            default 0.72
 */

import { BaseMechanic, type MechanicSpawnContext, type MechanicPhase } from '../../core/Mechanic';
import type { Shape } from '../../core/geometry';
import { clamp } from '../../core/geometry';
import { easeInOut, easeIn } from '../../feel/Easing';
import type { Renderer } from '../../core/Renderer';
import { ARENA_CENTRE, degToRad, polarToField, sector } from './polar';

const COLOUR = '#7cc4ff';
const INNER_RADIUS = 0.07;

export class RotatingFanMechanic extends BaseMechanic {
  private readonly arms: number;
  private readonly armArc: number;
  private readonly startAngle: number;
  private readonly rotationPerBeat: number;
  private readonly outerRadius: number;

  constructor(spawn: MechanicSpawnContext) {
    super(spawn);
    this.arms = clamp(Math.round(numberOr(this.params.arms, 3)), 1, 6);
    // Arms must never close the circle: there is always a wedge to stand in.
    const maxArc = (360 / this.arms) * 0.62;
    this.armArc = degToRad(clamp(numberOr(this.params.armArcDeg, 34), 10, maxArc));
    this.startAngle = degToRad(numberOr(this.params.startAngleDeg, -90));
    const sign = String(this.params.direction ?? 'CW').toUpperCase() === 'CCW' ? -1 : 1;
    this.rotationPerBeat = degToRad(numberOr(this.params.rotationPerBeatDeg, 45)) * sign;
    this.outerRadius = clamp(numberOr(this.params.radius, 0.72), 0.2, 1.1);
  }

  /**
   * Beat-quantised rotation: the fan holds a step, then eases to the next one
   * over the back half of the beat, so the movement lands on the pulse.
   */
  private angleAt(beat: number): number {
    const beatsIn = Math.max(0, beat - this.activationBeat);
    const step = Math.floor(beatsIn);
    const withinBeat = beatsIn - step;
    const glide = easeInOut(clamp((withinBeat - 0.45) / 0.55, 0, 1));
    return this.startAngle + this.rotationPerBeat * (step + glide);
  }

  private armSectors(beat: number): Shape[] {
    const base = this.angleAt(beat);
    const spacing = (Math.PI * 2) / this.arms;
    const out: Shape[] = [];
    for (let i = 0; i < this.arms; i++) {
      const centre = base + i * spacing;
      out.push({ kind: 'sector', ...sector(INNER_RADIUS, this.outerRadius, centre - this.armArc / 2, centre + this.armArc / 2) });
    }
    return out;
  }

  protected override onPhaseChange(_from: MechanicPhase, to: MechanicPhase, beat: number): void {
    if (to === 'ACTIVE') {
      this.feel.impact('MEDIUM', { x: 0.5, y: 0.5, colour: COLOUR, sfx: 'laser_fire' });
    }
    if (to === 'TELEGRAPH') this.feel.sfx('laser_charge', 0.7);
    void beat;
  }

  protected dangerShapes(): Shape[] {
    return this.armSectors(this.spawn.clock.absoluteBeat);
  }

  render(r: Renderer): void {
    const beat = this.spawn.clock.visualBeat;

    if (this.phase === 'TELEGRAPH') {
      const t = this.telegraphProgress(beat);
      const base = this.angleAt(this.activationBeat);
      const spacing = (Math.PI * 2) / this.arms;
      for (let i = 0; i < this.arms; i++) {
        const centre = base + i * spacing;
        const arc = this.armArc * easeIn(t);
        r.fillAnnulusSector(
          ARENA_CENTRE.x, ARENA_CENTRE.y, INNER_RADIUS, this.outerRadius,
          centre - arc / 2, centre + arc / 2, COLOUR, 0.08 + 0.18 * t,
        );
        // A thin sight line from the hub shows the arm's axis before it exists.
        const tip = polarToField(centre, this.outerRadius);
        r.line(ARENA_CENTRE.x, ARENA_CENTRE.y, tip.x, tip.y, '#bfe4ff', 1.5, 0.25 + 0.4 * t);
      }
      r.strokeCircle(ARENA_CENTRE.x, ARENA_CENTRE.y, INNER_RADIUS, '#bfe4ff', 2, 0.4 + 0.4 * t);
      return;
    }

    if (this.phase !== 'ACTIVE') return;
    const shapes = this.armSectors(beat);
    for (const shape of shapes) {
      if (shape.kind !== 'sector') continue;
      r.fillAnnulusSector(shape.cx, shape.cy, shape.rInner, shape.rOuter, shape.a0, shape.a1, COLOUR, 0.8);
      // Leading edge, so the direction of travel is unmistakable.
      const leading = this.rotationPerBeat >= 0 ? shape.a1 : shape.a0;
      const tip = polarToField(leading, shape.rOuter);
      const hub = polarToField(leading, shape.rInner);
      r.line(hub.x, hub.y, tip.x, tip.y, '#ffffff', 3, 0.9);
    }
    r.fillCircle(ARENA_CENTRE.x, ARENA_CENTRE.y, INNER_RADIUS * 0.7, '#dff0ff', 0.5);
  }
}

function numberOr(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

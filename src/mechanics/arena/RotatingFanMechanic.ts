/**
 * A07 -- Rotating Fan (ARENA): an arc sweep that crosses the player's path.
 *
 * The old fan had a dead hub -- stand in the middle and every arm passed you
 * by. Now the arms reach all the way to the centre, so the safe zone is the
 * *moving* wedge between arms and the play is orbiting it in time with the
 * beat. A pendulum mode (`reversalBeats`) sweeps an arc back and forth instead
 * of turning forever, which reads as call-and-response with the phrase.
 *
 * Rotation is quantised to the beat, not to frames: at `rotationPerBeatDeg`
 * the fan advances exactly that far each beat and eases between steps, so the
 * sweep is something you can hear.
 *
 * Params:
 *   arms                 number of arms                      default 2
 *   armArcDeg            angular width of each arm           default 55
 *   startAngleDeg        where arm 0 begins                  default -90
 *   rotationPerBeatDeg   degrees advanced per beat           default 45
 *   direction            "CW" | "CCW"                        default "CW"
 *   radius               outer radius of the arms            default 0.72
 *   innerRadius          inner radius; 0 means arms reach    default 0
 *                        the centre (no dead hub)
 *   reversalBeats        beats per pendulum swing; 0 turns   default 0
 *                        the pendulum off
 */

import { BaseMechanic, type MechanicSpawnContext, type MechanicPhase } from '../../core/Mechanic';
import type { Shape } from '../../core/geometry';
import { clamp } from '../../core/geometry';
import { easeInOut, easeIn } from '../../feel/Easing';
import type { Renderer } from '../../core/Renderer';
import { ARENA_CENTRE, degToRad, polarToField, sector } from './polar';

const COLOUR = '#7cc4ff';

export class RotatingFanMechanic extends BaseMechanic {
  private readonly arms: number;
  private readonly armArc: number;
  private readonly startAngle: number;
  private readonly rotationPerBeat: number;
  private readonly outerRadius: number;
  private readonly innerRadius: number;
  private readonly reversalBeats: number;

  constructor(spawn: MechanicSpawnContext) {
    super(spawn);
    this.arms = clamp(Math.round(numberOr(this.params.arms, 2)), 1, 6);
    // Arms must never close the circle: there is always a wedge to stand in,
    // and wide single arms cap at 140 degrees so a dodge never means circling
    // more than a glance away.
    const maxArc = Math.min(140, (360 / this.arms) * 0.9);
    this.armArc = degToRad(clamp(numberOr(this.params.armArcDeg, 55), 16, maxArc));
    this.startAngle = degToRad(numberOr(this.params.startAngleDeg, -90));
    const sign = String(this.params.direction ?? 'CW').toUpperCase() === 'CCW' ? -1 : 1;
    this.rotationPerBeat = degToRad(clamp(numberOr(this.params.rotationPerBeatDeg, 45), 10, 120)) * sign;
    this.outerRadius = clamp(numberOr(this.params.radius, 0.72), 0.2, 1.1);
    this.innerRadius = clamp(numberOr(this.params.innerRadius, 0), 0, 0.3);
    this.reversalBeats = Math.max(0, numberOr(this.params.reversalBeats, 0));
  }

  /**
   * Beat-quantised rotation: the fan holds a step, then eases to the next one
   * over the back half of the beat, so the movement lands on the pulse. With
   * `reversalBeats` the fan pendulums: it sweeps one way for that many beats,
   * then comes back along the same arc.
   */
  private angleAt(beat: number): number {
    const beatsIn = Math.max(0, beat - this.activationBeat);
    if (this.reversalBeats <= 0) {
      const step = Math.floor(beatsIn);
      const withinBeat = beatsIn - step;
      const glide = easeInOut(clamp((withinBeat - 0.45) / 0.55, 0, 1));
      return this.startAngle + this.rotationPerBeat * (step + glide);
    }
    const cycle = Math.floor(beatsIn / this.reversalBeats);
    const within = beatsIn - cycle * this.reversalBeats;
    const position = cycle % 2 === 0 ? within : this.reversalBeats - within;
    const step = Math.floor(position);
    const glide = easeInOut(clamp((position - step - 0.45) / 0.55, 0, 1));
    return this.startAngle + this.rotationPerBeat * (step + glide);
  }

  /** True in the beat before a pendulum swing reverses. */
  private nearReversal(beat: number): boolean {
    if (this.reversalBeats <= 0) return false;
    const beatsIn = Math.max(0, beat - this.activationBeat);
    return this.reversalBeats - (beatsIn % this.reversalBeats) <= 1.2;
  }

  private armSectors(beat: number): Shape[] {
    const base = this.angleAt(beat);
    const spacing = (Math.PI * 2) / this.arms;
    const out: Shape[] = [];
    for (let i = 0; i < this.arms; i++) {
      const centre = base + i * spacing;
      out.push({ kind: 'sector', ...sector(this.innerRadius, this.outerRadius, centre - this.armArc / 2, centre + this.armArc / 2) });
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
        // With innerRadius 0 the annulus degrades to a pie slice reaching the
        // hub -- there is no dead spot to stand in.
        r.fillAnnulusSector(
          ARENA_CENTRE.x, ARENA_CENTRE.y, this.innerRadius, this.outerRadius,
          centre - arc / 2, centre + arc / 2, COLOUR, 0.08 + 0.18 * t,
        );
        // A thin sight line from the hub shows the arm's axis before it exists.
        const tip = polarToField(centre, this.outerRadius);
        r.line(ARENA_CENTRE.x, ARENA_CENTRE.y, tip.x, tip.y, '#bfe4ff', 1.5, 0.25 + 0.4 * t);
      }
      // Rotation direction, so the sweep's travel is readable up front.
      const arrow = this.rotationPerBeat >= 0 ? '↻' : '↺';
      r.text(arrow, ARENA_CENTRE.x, ARENA_CENTRE.y, this.reversalBeats > 0 ? '#ffd479' : '#bfe4ff', 22, 'center', 0.3 + 0.4 * t);
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
      const hub = polarToField(leading, Math.max(0.02, shape.rInner));
      r.line(hub.x, hub.y, tip.x, tip.y, '#ffffff', 3, 0.9);
    }
    // Pendulum warning: the sweep is about to come back.
    if (this.nearReversal(beat)) {
      r.text('↻ ↺', ARENA_CENTRE.x, ARENA_CENTRE.y - 0.14, '#ffd479', 16, 'center', 0.4 + 0.3 * Math.sin(beat * 10));
    }
  }
}

function numberOr(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

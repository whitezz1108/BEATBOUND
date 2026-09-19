/**
 * A08 -- Spiral (ARENA).
 *
 * An emitter whose angle advances a fixed step every subdivision, so the shots
 * lay down a spiral arm. Dense on screen, but the rule behind it is one line,
 * which is what keeps it readable at sixteenth-note rates.
 *
 * Params:
 *   arms           simultaneous emitters                  default 2
 *   stepDeg        angle added per emission               default 26
 *   subdivision    beats between emissions                default 0.25
 *   direction      "CW" | "CCW" | "ALTERNATE"             default "CW"
 *   speed          travel-speed multiplier                default 0.9
 *   startAngleDeg  first emission angle                   default -90
 *   expand         true fires outward, false inward       default true
 */

import { BaseMechanic, type MechanicSpawnContext, type MechanicPhase } from '../../core/Mechanic';
import type { Shape } from '../../core/geometry';
import { clamp } from '../../core/geometry';
import { easeIn } from '../../feel/Easing';
import type { Renderer } from '../../core/Renderer';
import { TUNING } from '../../tuning';
import { ARENA_CENTRE, ARENA_OUTER_RADIUS, degToRad, polarToField } from './polar';

interface Shot {
  angle: number;
  /** Beat this shot left the emitter. */
  bornBeat: number;
}

const COLOUR = '#c08bff';
const EDGE = '#8f5fff';

export class SpiralMechanic extends BaseMechanic {
  private readonly arms: number;
  private readonly stepAngle: number;
  private readonly subdivision: number;
  private readonly alternate: boolean;
  private readonly expand: boolean;
  private readonly travelBeats: number;
  private readonly startAngle: number;
  private readonly bulletRadius: number;
  private shots: Shot[] = [];
  private emitted = 0;

  constructor(spawn: MechanicSpawnContext) {
    super(spawn);
    this.arms = clamp(Math.round(numberOr(this.params.arms, 2)), 1, 4);
    const dir = String(this.params.direction ?? 'CW').toUpperCase();
    this.alternate = dir === 'ALTERNATE';
    const sign = dir === 'CCW' ? -1 : 1;
    this.stepAngle = degToRad(clamp(numberOr(this.params.stepDeg, 26), 4, 90)) * sign;
    this.subdivision = clamp(numberOr(this.params.subdivision, 0.25), 0.125, 1);
    this.expand = this.params.expand !== false;
    this.startAngle = degToRad(numberOr(this.params.startAngleDeg, -90));
    this.bulletRadius = TUNING.arena.projectileRadius * 0.7;
    const speed = numberOr(this.params.speed, 0.9) * (1 + 0.2 * this.intensity);
    this.travelBeats = Math.max(0.75, 2.2 / Math.max(0.3, speed));
  }

  protected override onUpdate(u: { beat: number }): void {
    if (this.phase === 'ACTIVE') {
      // Emit every subdivision that has come due since the last frame.
      const due = Math.floor((u.beat - this.activationBeat) / this.subdivision) + 1;
      while (this.emitted < due) {
        const index = this.emitted;
        // ALTERNATE reverses the arm every bar's worth of emissions.
        const flip = this.alternate && Math.floor(index * this.subdivision) % 2 === 1 ? -1 : 1;
        const base = this.startAngle + this.stepAngle * index * flip;
        const bornBeat = this.activationBeat + index * this.subdivision;
        for (let a = 0; a < this.arms; a++) {
          this.shots.push({ angle: base + (a * Math.PI * 2) / this.arms, bornBeat });
        }
        this.emitted += 1;
        if (this.emitted > 400) break;
      }
      if (this.emitted % 4 === 0) this.feel.sfx('projectile_fire', 0.35);
    }
    // Retire shots that have finished their travel.
    this.shots = this.shots.filter((s) => u.beat - s.bornBeat <= this.travelBeats);
  }

  override get isFinished(): boolean {
    const beat = this.spawn.clock.visualBeat;
    return beat > this.recoveryEndBeat && this.shots.length === 0;
  }

  protected override onPhaseChange(_from: MechanicPhase, to: MechanicPhase): void {
    if (to === 'ACTIVE') {
      this.feel.impact('LIGHT', { x: 0.5, y: 0.5, colour: COLOUR, shockwave: true });
    }
  }

  private radiusOf(shot: Shot, beat: number): number {
    const t = clamp((beat - shot.bornBeat) / this.travelBeats, 0, 1);
    return this.expand
      ? 0.05 + t * ARENA_OUTER_RADIUS
      : ARENA_OUTER_RADIUS - t * (ARENA_OUTER_RADIUS - 0.03);
  }

  protected dangerShapes(): Shape[] {
    const beat = this.spawn.clock.visualBeat;
    return this.shots.map((s) => {
      const p = polarToField(s.angle, this.radiusOf(s, beat));
      return { kind: 'circle' as const, x: p.x, y: p.y, r: this.bulletRadius };
    });
  }

  render(r: Renderer): void {
    const beat = this.spawn.clock.visualBeat;

    if (this.phase === 'TELEGRAPH') {
      const t = this.telegraphProgress(beat);
      // Show the opening arm angles and which way the spiral will wind.
      for (let a = 0; a < this.arms; a++) {
        const angle = this.startAngle + (a * Math.PI * 2) / this.arms;
        const tip = polarToField(angle, 0.2 + 0.3 * easeIn(t));
        r.line(ARENA_CENTRE.x, ARENA_CENTRE.y, tip.x, tip.y, EDGE, 2, 0.25 + 0.5 * t);
        const next = polarToField(angle + this.stepAngle * 3, 0.24);
        r.line(tip.x, tip.y, next.x, next.y, EDGE, 1.5, 0.15 + 0.35 * t);
      }
      r.glow(ARENA_CENTRE.x, ARENA_CENTRE.y, 0.08, COLOUR, 0.2 + 0.4 * t);
      return;
    }

    for (const s of this.shots) {
      const radius = this.radiusOf(s, beat);
      const p = polarToField(s.angle, radius);
      const fade = clamp(1 - (beat - s.bornBeat) / this.travelBeats, 0, 1);
      r.fillCircle(p.x, p.y, this.bulletRadius, COLOUR, 0.55 + 0.45 * fade);
    }
    if (this.phase === 'ACTIVE') r.fillCircle(ARENA_CENTRE.x, ARENA_CENTRE.y, 0.018, '#efe3ff', 0.55);
  }
}

function numberOr(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

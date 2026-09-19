/**
 * A06 -- Laser (ARENA).
 *
 * A stationary beam across the whole field, claiming one band. Like A05 Chain
 * it is dodged by leaving the band, not by outrunning it -- but it does not
 * travel, so two crossed lasers (pattern AP04) carve the arena into quadrants.
 *
 * Params:
 *   orientation  "HORIZONTAL" | "VERTICAL"   default "HORIZONTAL"
 *   position     0..1 centre of the beam     default 0.5
 *   thickness    band thickness              default 0.15
 */

import { BaseMechanic, type MechanicPhase, type MechanicSpawnContext } from '../../core/Mechanic';
import type { Rect, Shape } from '../../core/geometry';
import { clamp, lerp } from '../../core/geometry';
import type { Renderer } from '../../core/Renderer';
import { easeIn, easeOutExpo } from '../../feel/Easing';

/** Keep a crossed pair from sealing off the arena. */
const MAX_THICKNESS = 0.2;

export class LaserMechanic extends BaseMechanic {
  private readonly horizontal: boolean;
  private readonly position: number;
  private readonly thickness: number;

  constructor(spawn: MechanicSpawnContext) {
    super(spawn);
    this.horizontal = String(this.params.orientation ?? 'HORIZONTAL').toUpperCase() !== 'VERTICAL';
    // Intensity widens the beam a little; the cap keeps a safe corridor.
    this.thickness = clamp(
      numberOr(this.params.thickness, 0.15) * lerp(1, 1.2, this.intensity),
      0.05,
      MAX_THICKNESS,
    );
    const half = this.thickness / 2;
    this.position = clamp(numberOr(this.params.position, 0.5), half, 1 - half);
  }

  private beam(): Rect {
    return this.horizontal
      ? { x: 0, y: this.position - this.thickness / 2, w: 1, h: this.thickness }
      : { x: this.position - this.thickness / 2, y: 0, w: this.thickness, h: 1 };
  }

  protected override onPhaseChange(_from: MechanicPhase, to: MechanicPhase): void {
    const along = this.horizontal ? { x: 0.5, y: this.position } : { x: this.position, y: 0.5 };
    if (to === 'TELEGRAPH') {
      this.feel.sfx('laser_charge');
      return;
    }
    if (to === 'ACTIVE') {
      this.feel.impact('MEDIUM', {
        x: along.x, y: along.y, colour: '#ff2f86', sfx: 'laser_fire',
        dirX: this.horizontal ? 0 : 1, dirY: this.horizontal ? 1 : 0,
      });
      // Sparks along the whole beam, not just at a point.
      this.feel.emit(along.x, along.y, {
        count: 16, speed: 0.8, colour: '#ffb3d5', size: 0.007, shape: 'spark', life: 0.3,
        direction: this.horizontal ? 0 : Math.PI / 2, spread: Math.PI * 0.35,
      });
    }
  }

  protected dangerShapes(): Shape[] {
    return [{ kind: 'rect', ...this.beam() }];
  }

  render(r: Renderer): void {
    const beat = this.spawn.clock.visualBeat;
    const beam = this.beam();

    if (this.phase === 'TELEGRAPH') {
      // AIM: a hairline sight. CHARGE: it thickens and particles converge.
      const p = this.telegraphProgress(beat);
      const charge = easeIn(p);
      const preview: Rect = this.horizontal
        ? { ...beam, y: this.position - (this.thickness * charge) / 2, h: this.thickness * charge }
        : { ...beam, x: this.position - (this.thickness * charge) / 2, w: this.thickness * charge };
      r.fillRect(preview, '#ff5fa2', 0.12 + 0.2 * p);
      if (this.horizontal) r.line(0, this.position, 1, this.position, '#ff8ec4', 1.5, 0.4 + 0.5 * p);
      else r.line(this.position, 0, this.position, 1, '#ff8ec4', 1.5, 0.4 + 0.5 * p);

      // Emitter nodes at both ends pulse in time with the charge.
      const nodeRadius = 0.012 + 0.02 * charge;
      const ends = this.horizontal
        ? [{ x: 0, y: this.position }, { x: 1, y: this.position }]
        : [{ x: this.position, y: 0 }, { x: this.position, y: 1 }];
      for (const e of ends) {
        r.glow(e.x, e.y, nodeRadius * 3, '#ff8ec4', 0.25 + 0.45 * charge);
        r.fillCircle(e.x, e.y, nodeRadius, '#ffe3f0', 0.6 + 0.4 * charge);
      }
      if (p > 0.55) this.feel.telegraph(ends[0].x, ends[0].y, '#ff8ec4', p);
      return;
    }

    if (this.phase === 'ACTIVE') {
      // FIRE then STABILIZE: an overshoot on contact settling to the steady beam.
      const settle = easeOutExpo(Math.min(1, this.activeProgress(beat) * 5));
      const swell = 1 + 0.5 * (1 - settle);
      const fired: Rect = this.horizontal
        ? { ...beam, y: this.position - (this.thickness * swell) / 2, h: this.thickness * swell }
        : { ...beam, x: this.position - (this.thickness * swell) / 2, w: this.thickness * swell };
      r.fillRect(fired, '#ff2f86', 0.9);
      // Hot core, so the lethal band reads instantly.
      const core: Rect = this.horizontal
        ? { ...beam, y: this.position - this.thickness / 6, h: this.thickness / 3 }
        : { ...beam, x: this.position - this.thickness / 6, w: this.thickness / 3 };
      r.fillRect(core, '#ffe3f0', 0.95);
      return;
    }

    if (this.phase === 'RECOVERY') {
      const span = Math.max(0.0001, this.recoveryEndBeat - this.activeEndBeat);
      const fade = clamp(1 - (beat - this.activeEndBeat) / span, 0, 1);
      r.fillRect(beam, '#a32b62', 0.3 * fade);
    }
  }
}

function numberOr(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

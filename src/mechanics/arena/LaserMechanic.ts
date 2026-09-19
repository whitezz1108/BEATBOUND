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

import { BaseMechanic, type MechanicSpawnContext } from '../../core/Mechanic';
import type { Rect, Shape } from '../../core/geometry';
import { clamp, lerp } from '../../core/geometry';
import type { Renderer } from '../../core/Renderer';

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

  protected dangerShapes(): Shape[] {
    return [{ kind: 'rect', ...this.beam() }];
  }

  render(r: Renderer): void {
    const beat = this.spawn.clock.absoluteBeat;
    const beam = this.beam();

    if (this.phase === 'TELEGRAPH') {
      // A thin sight-line thickens into the full beam as the hit approaches.
      const p = this.telegraphProgress(beat);
      const preview: Rect = this.horizontal
        ? { ...beam, y: this.position - (this.thickness * p) / 2, h: this.thickness * p }
        : { ...beam, x: this.position - (this.thickness * p) / 2, w: this.thickness * p };
      r.fillRect(preview, '#ff5fa2', 0.12 + 0.2 * p);
      if (this.horizontal) r.line(0, this.position, 1, this.position, '#ff8ec4', 2, 0.4 + 0.5 * p);
      else r.line(this.position, 0, this.position, 1, '#ff8ec4', 2, 0.4 + 0.5 * p);
      return;
    }

    if (this.phase === 'ACTIVE') {
      r.fillRect(beam, '#ff2f86', 0.9);
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

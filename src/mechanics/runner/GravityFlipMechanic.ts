/**
 * R09 -- Gravity Flip (RUNNER).
 *
 * A zone rather than an obstacle: while ACTIVE the player falls upward and runs
 * along the ceiling. It has a real telegraph (1 beat in the library) because
 * unlike the scrolling obstacles there is nothing spatial to read.
 *
 * Params:
 *   gravityScale  multiplier applied while active   default -1
 */

import { BaseMechanic, type MechanicSpawnContext } from '../../core/Mechanic';
import type { RunnerTerrain } from '../../core/capabilities';
import type { Shape } from '../../core/geometry';
import { clamp } from '../../core/geometry';
import type { Renderer } from '../../core/Renderer';

export class GravityFlipMechanic extends BaseMechanic implements RunnerTerrain {
  private readonly scale: number;

  constructor(spawn: MechanicSpawnContext) {
    super(spawn);
    this.scale = clamp(numberOr(this.params.gravityScale, -1), -2, 2);
  }

  gravityScale(): number | null {
    return this.phase === 'ACTIVE' ? this.scale : null;
  }

  protected dangerShapes(): Shape[] {
    return [];
  }

  render(r: Renderer): void {
    const beat = this.spawn.clock.absoluteBeat;
    if (this.phase === 'TELEGRAPH') {
      const p = this.telegraphProgress(beat);
      r.fillRect({ x: 0, y: 0, w: 1, h: 1 }, '#6b4dff', 0.04 + 0.12 * p);
      r.text('⇅ GRAVITY FLIP', 0.5, 0.12, '#c9bcff', 18, 'center', 0.4 + 0.6 * p);
      return;
    }
    if (this.phase === 'ACTIVE') {
      const remaining = this.activeEndBeat - beat;
      r.fillRect({ x: 0, y: 0, w: 1, h: 1 }, '#6b4dff', 0.12);
      r.text(`⇅ ${remaining.toFixed(1)}`, 0.5, 0.12, '#c9bcff', 16, 'center', 0.8);
    }
  }
}

function numberOr(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

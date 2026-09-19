/**
 * R02 -- Gap (RUNNER). A hole in the ground: jump across or fall in.
 *
 * Reports itself through the RunnerTerrain capability rather than as a hazard
 * shape -- the danger is the *absence* of floor, which the mode resolves when
 * it decides whether the player is standing on anything.
 *
 * Params:
 *   width  gap width multiplier   default 1.0
 */

import type { MechanicSpawnContext } from '../../core/Mechanic';
import { ScrollingObstacle } from './ScrollingObstacle';
import type { GroundGap, RunnerTerrain } from '../../core/capabilities';
import type { Shape } from '../../core/geometry';
import { clamp, lerp } from '../../core/geometry';
import type { Renderer } from '../../core/Renderer';
import { GROUND_Y } from './runnerGeometry';

export const GAP_BASE_WIDTH = 0.13;
/** Wider than this and a normal jump cannot clear it. */
const MAX_WIDTH = 0.22;

export class GapMechanic extends ScrollingObstacle implements RunnerTerrain {
  override readonly damageSource = 'OBSTACLE' as const;

  private readonly width: number;

  constructor(spawn: MechanicSpawnContext) {
    super(spawn);
    this.width = clamp(GAP_BASE_WIDTH * numberOr(this.params.width, 1) * lerp(1, 1.25, this.intensity), 0.06, MAX_WIDTH);
  }

  groundGap(): GroundGap {
    const x = this.x;
    return { x0: x - this.width / 2, x1: x + this.width / 2 };
  }

  protected dangerShapes(): Shape[] {
    return [];
  }

  render(r: Renderer): void {
    const { x0, x1 } = this.groundGap();
    // Draw the pit as a void below the ground line, with lip markers.
    r.fillRect({ x: x0, y: GROUND_Y, w: x1 - x0, h: 1 - GROUND_Y }, '#05070d', 1);
    r.line(x0, GROUND_Y, x0, GROUND_Y + 0.05, '#7d86a3', 2, 0.8);
    r.line(x1, GROUND_Y, x1, GROUND_Y + 0.05, '#7d86a3', 2, 0.8);
  }
}

function numberOr(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

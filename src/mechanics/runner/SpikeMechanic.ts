/**
 * R01 -- Spike (RUNNER). Ground hazard: jump it.
 *
 * Params:
 *   height  spike height multiplier   default 1.0
 */

import type { MechanicSpawnContext } from '../../core/Mechanic';
import { ScrollingObstacle } from './ScrollingObstacle';
import type { Rect, Shape } from '../../core/geometry';
import { clamp, lerp } from '../../core/geometry';
import type { Renderer } from '../../core/Renderer';
import { GROUND_Y } from './runnerGeometry';

const BASE_HEIGHT = 0.09;
const WIDTH = 0.055;

export class SpikeMechanic extends ScrollingObstacle {
  private readonly height: number;

  constructor(spawn: MechanicSpawnContext) {
    super(spawn);
    // Taller with intensity, but always clearable by a normal jump.
    this.height = clamp(BASE_HEIGHT * numberOr(this.params.height, 1) * lerp(1, 1.3, this.intensity), 0.04, 0.16);
  }

  private body(): Rect {
    const x = this.x;
    return { x: x - WIDTH / 2, y: GROUND_Y - this.height, w: WIDTH, h: this.height };
  }

  protected dangerShapes(): Shape[] {
    return [{ kind: 'rect', ...this.body() }];
  }

  render(r: Renderer): void {
    const body = this.body();
    r.fillRect(body, '#ff5c5c', 0.95);
    r.strokeRect(body, '#ffd0d0', 2, 0.8);
    // Apex highlight so the required clearance is readable at a glance.
    r.line(body.x, body.y, body.x + body.w, body.y, '#ffffff', 2, 0.9);
  }
}

function numberOr(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

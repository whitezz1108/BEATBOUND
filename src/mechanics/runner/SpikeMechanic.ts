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
    // Triangular blade rather than a bar: the silhouette says "jump".
    const tipY = body.y;
    const baseY = body.y + body.h;
    r.glow(body.x + body.w / 2, tipY, this.height * 1.6, '#ff5c5c', 0.2);
    r.fillPolygon([
      { x: body.x, y: baseY },
      { x: body.x + body.w / 2, y: tipY },
      { x: body.x + body.w, y: baseY },
    ], '#ff5c5c', 0.96);
    r.line(body.x, baseY, body.x + body.w / 2, tipY, '#ffd0d0', 2, 0.85);
    r.line(body.x + body.w / 2, tipY, body.x + body.w, baseY, '#ffd0d0', 2, 0.85);
  }
}

function numberOr(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

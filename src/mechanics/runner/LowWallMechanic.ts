/**
 * R03 -- Low Wall (RUNNER). An overhead beam: slide under it.
 *
 * Params:
 *   clearance  gap under the beam (library default 0.5 == a sliding player)
 */

import type { MechanicSpawnContext } from '../../core/Mechanic';
import { ScrollingObstacle } from './ScrollingObstacle';
import type { Rect, Shape } from '../../core/geometry';
import { clamp, lerp } from '../../core/geometry';
import type { Renderer } from '../../core/Renderer';
import { GROUND_Y } from './runnerGeometry';

const WIDTH = 0.07;
/** Clearance 0.5 (the library default) maps to this gap above the ground. */
const CLEARANCE_SCALE = 0.15;

export class LowWallMechanic extends ScrollingObstacle {
  private readonly clearance: number;

  constructor(spawn: MechanicSpawnContext) {
    super(spawn);
    // Lower with intensity, but never below a sliding player's height.
    this.clearance = clamp(
      numberOr(this.params.clearance, 0.5) * CLEARANCE_SCALE * lerp(1, 0.85, this.intensity),
      0.062,
      0.14,
    );
  }

  private body(): Rect {
    const x = this.x;
    const top = GROUND_Y - this.clearance - 0.14;
    return { x: x - WIDTH / 2, y: top, w: WIDTH, h: 0.14 };
  }

  protected dangerShapes(): Shape[] {
    return [{ kind: 'rect', ...this.body() }];
  }

  render(r: Renderer): void {
    const body = this.body();
    r.fillRect(body, '#ffa23d', 0.95);
    r.strokeRect(body, '#ffe0b8', 2, 0.85);
    // Mark the slide gap underneath so the required action is obvious.
    r.line(body.x, GROUND_Y - this.clearance, body.x + body.w, GROUND_Y - this.clearance, '#ffe0b8', 2, 0.5);
  }
}

function numberOr(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

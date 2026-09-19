/**
 * R03 -- Low Wall (RUNNER). An overhead beam: slide under it.
 *
 * Params:
 *   clearance  gap under the beam (library default 0.5 == a sliding player)
 *   surface    "FLOOR" | "CEILING"                        default "FLOOR"
 */

import type { MechanicSpawnContext } from '../../core/Mechanic';
import { ScrollingObstacle } from './ScrollingObstacle';
import type { Rect, Shape } from '../../core/geometry';
import { clamp, lerp } from '../../core/geometry';
import type { Renderer } from '../../core/Renderer';
import { CEILING_Y, GROUND_Y } from './runnerGeometry';
import { readSurface, type TrackSurface } from './surface';

export const WALL_WIDTH = 0.07;
/** Clearance 0.5 (the library default) maps to this gap above the ground. */
export const WALL_CLEARANCE_SCALE = 0.15;

export class LowWallMechanic extends ScrollingObstacle {
  override readonly damageSource = 'OBSTACLE' as const;

  private readonly clearance: number;
  readonly surface: TrackSurface;

  constructor(spawn: MechanicSpawnContext) {
    super(spawn);
    this.surface = readSurface(this.params.surface);
    // Lower with intensity, but never below a sliding player's height.
    this.clearance = clamp(
      numberOr(this.params.clearance, 0.5) * WALL_CLEARANCE_SCALE * lerp(1, 0.85, this.intensity),
      0.062,
      0.14,
    );
  }

  private body(): Rect {
    const x = this.x;
    const top = this.surface === 'CEILING'
      ? CEILING_Y + this.clearance
      : GROUND_Y - this.clearance - 0.14;
    return { x: x - WALL_WIDTH / 2, y: top, w: WALL_WIDTH, h: 0.14 };
  }

  protected dangerShapes(): Shape[] {
    return [{ kind: 'rect', ...this.body() }];
  }

  render(r: Renderer): void {
    const body = this.body();
    r.glow(body.x + body.w / 2, body.y + body.h, 0.1, '#ffa23d', 0.18);
    r.fillRect(body, '#ffa23d', 0.96);
    r.strokeRect(body, '#ffe0b8', 2, 0.85);
    // Hatch the gap you have to slide through, so the answer is unambiguous.
    const gapTop = this.surface === 'CEILING' ? CEILING_Y : GROUND_Y - this.clearance;
    for (let i = 0; i < 3; i++) {
      const y = gapTop + (this.clearance * (i + 0.5)) / 3;
      r.line(body.x, y, body.x + body.w, y, '#ffe0b8', 1, 0.28);
    }
    r.line(body.x, gapTop, body.x + body.w, gapTop, '#ffe0b8', 2, 0.6);
  }
}

function numberOr(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

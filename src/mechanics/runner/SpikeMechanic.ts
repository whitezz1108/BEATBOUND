/**
 * R01 -- Spike (RUNNER). Ground hazard: jump it.
 *
 * Params:
 *   height   spike height multiplier          default 1.0
 *   surface  "FLOOR" | "CEILING"               default "FLOOR"
 *
 * A ceiling spike hangs down from the upper surface and is what an inverted
 * gravity sequence dodges; a floor spike is irrelevant while the player is
 * running on the ceiling, and vice versa.
 */

import type { MechanicSpawnContext } from '../../core/Mechanic';
import { ScrollingObstacle } from './ScrollingObstacle';
import type { Rect, Shape } from '../../core/geometry';
import { clamp, lerp } from '../../core/geometry';
import type { Renderer } from '../../core/Renderer';
import { CEILING_Y, GROUND_Y } from './runnerGeometry';
import { readSurface, type TrackSurface } from './surface';

export const SPIKE_BASE_HEIGHT = 0.09;
/**
 * Spikes are drawn as a narrow triangle, so a wide rectangular hazard was
 * charging the player for space the blade does not occupy. The width also sets
 * how long a jump has to stay airborne, which is what made half-beat chains
 * impossible -- see TUNING.runner.jumpBeats.
 */
export const SPIKE_WIDTH = 0.024;

export class SpikeMechanic extends ScrollingObstacle {
  override readonly damageSource = 'OBSTACLE' as const;

  private readonly height: number;
  readonly surface: TrackSurface;

  constructor(spawn: MechanicSpawnContext) {
    super(spawn);
    this.surface = readSurface(this.params.surface);
    // Taller with intensity -- but only slightly. A taller spike needs more
    // clearance, which narrows the slice of the jump arc that is above it, and
    // in a half-beat double that slice *is* the timing window. Scaling height
    // hard with intensity quietly turns a demanding pattern into a
    // frame-perfect one, so the range is deliberately small.
    this.height = clamp(SPIKE_BASE_HEIGHT * numberOr(this.params.height, 1) * lerp(1, 1.15, this.intensity), 0.04, 0.16);
  }

  private body(): Rect {
    const x = this.x;
    const top = this.surface === 'CEILING' ? CEILING_Y : GROUND_Y - this.height;
    return { x: x - SPIKE_WIDTH / 2, y: top, w: SPIKE_WIDTH, h: this.height };
  }

  protected dangerShapes(): Shape[] {
    return [{ kind: 'rect', ...this.body() }];
  }

  render(r: Renderer): void {
    const body = this.body();
    // Triangular blade rather than a bar: the silhouette says "jump". On the
    // ceiling it points the other way, so the shape still reads as a threat
    // growing out of whichever surface the player is running on.
    const ceiling = this.surface === 'CEILING';
    const tipY = ceiling ? body.y + body.h : body.y;
    const baseY = ceiling ? body.y : body.y + body.h;
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

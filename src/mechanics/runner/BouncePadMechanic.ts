/**
 * R08 -- Bounce Pad (RUNNER). Harmless: touching it launches the player.
 *
 * Params:
 *   launchStrength  multiplier on a normal jump   default 1.0
 */

import type { MechanicSpawnContext } from '../../core/Mechanic';
import { ScrollingObstacle } from './ScrollingObstacle';
import type { BouncePad, RunnerTerrain } from '../../core/capabilities';
import type { Rect, Shape } from '../../core/geometry';
import { clamp, lerp } from '../../core/geometry';
import type { Renderer } from '../../core/Renderer';
import { GROUND_Y } from './runnerGeometry';

const WIDTH = 0.09;
const HEIGHT = 0.022;

export class BouncePadMechanic extends ScrollingObstacle implements RunnerTerrain {
  private readonly strength: number;

  constructor(spawn: MechanicSpawnContext) {
    super(spawn);
    this.strength = clamp(numberOr(this.params.launchStrength, 1) * lerp(1, 1.2, this.intensity), 1, 2);
  }

  private body(): Rect {
    const x = this.x;
    return { x: x - WIDTH / 2, y: GROUND_Y - HEIGHT, w: WIDTH, h: HEIGHT };
  }

  bouncePad(): BouncePad {
    return { rect: this.body(), strength: this.strength };
  }

  protected dangerShapes(): Shape[] {
    return [];
  }

  render(r: Renderer): void {
    const body = this.body();
    const pulse = 0.5 + 0.5 * Math.sin(this.spawn.clock.absoluteBeat * Math.PI);
    r.fillRect(body, '#4dffd0', 0.9);
    r.strokeRect(body, '#d6fff4', 2, 0.9);
    // Upward chevrons: this one helps rather than hurts.
    r.text('▲', body.x + body.w / 2, body.y - 0.035, '#4dffd0', 15, 'center', 0.4 + 0.5 * pulse);
  }
}

function numberOr(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/**
 * A05 -- Chain (ARENA).
 *
 * Helltaker-inspired directional chain whip. The chain claims one *lane* (a row
 * or a column, chosen by the direction axis) and extends across it from the
 * origin edge. Claiming a lane rather than the whole field is what makes it
 * dodgeable: the player leaves the lane during the telegraph.
 *
 * Params:
 *   direction  "LEFT_TO_RIGHT" | "RIGHT_TO_LEFT" | "TOP_TO_BOTTOM" | "BOTTOM_TO_TOP"
 *   width      lane thickness multiplier                default 1.0
 *   lane       explicit lane centre, 0..1               default: deterministic
 *   laneCount  lanes the field is divided into          default 4
 */

import { BaseMechanic, type MechanicSpawnContext } from '../../core/Mechanic';
import type { Rect, Shape } from '../../core/geometry';
import { clamp, lerp, makeRng } from '../../core/geometry';
import type { Renderer } from '../../core/Renderer';

export const CHAIN_DIRECTIONS = ['LEFT_TO_RIGHT', 'RIGHT_TO_LEFT', 'TOP_TO_BOTTOM', 'BOTTOM_TO_TOP'] as const;
export type ChainDirection = (typeof CHAIN_DIRECTIONS)[number];

const ARROW: Record<ChainDirection, string> = {
  LEFT_TO_RIGHT: '→',
  RIGHT_TO_LEFT: '←',
  TOP_TO_BOTTOM: '↓',
  BOTTOM_TO_TOP: '↑',
};

/** Thickness bounds keep a lane dodgeable no matter what params/intensity ask for. */
const MIN_THICKNESS = 0.05;
const MAX_THICKNESS = 0.2;

export class ChainMechanic extends BaseMechanic {
  private readonly direction: ChainDirection;
  private readonly horizontal: boolean;
  private readonly laneCenter: number;
  private readonly thickness: number;
  /** How long the whip takes to reach the far edge, in beats. */
  private readonly extendBeats: number;

  constructor(spawn: MechanicSpawnContext) {
    super(spawn);
    const requested = String(this.params.direction ?? 'LEFT_TO_RIGHT').toUpperCase();
    this.direction = (CHAIN_DIRECTIONS as readonly string[]).includes(requested)
      ? (requested as ChainDirection)
      : 'LEFT_TO_RIGHT';
    this.horizontal = this.direction === 'LEFT_TO_RIGHT' || this.direction === 'RIGHT_TO_LEFT';

    const width = numberOr(this.params.width, 1);
    this.thickness = clamp(0.13 * width * lerp(1, 1.25, this.intensity), MIN_THICKNESS, MAX_THICKNESS);

    const laneCount = Math.max(1, Math.round(numberOr(this.params.laneCount, 4)));
    const explicit = this.params.lane;
    this.laneCenter = typeof explicit === 'number'
      ? clamp(explicit, this.thickness / 2, 1 - this.thickness / 2)
      : (Math.floor(makeRng(this.seed)() * laneCount) + 0.5) / laneCount;

    this.extendBeats = Math.max(0.15, Math.min(0.4, this.timing.durationBeats * 0.45));
  }

  /** The full corridor the chain will occupy once fully extended. */
  private laneRect(): Rect {
    const t = this.thickness;
    return this.horizontal
      ? { x: 0, y: this.laneCenter - t / 2, w: 1, h: t }
      : { x: this.laneCenter - t / 2, y: 0, w: t, h: 1 };
  }

  /** The portion currently swept, growing from the origin edge. */
  private sweptRect(beat: number): Rect {
    const lane = this.laneRect();
    const extend = clamp((beat - this.activationBeat) / this.extendBeats, 0, 1);
    switch (this.direction) {
      case 'LEFT_TO_RIGHT': return { ...lane, w: extend };
      case 'RIGHT_TO_LEFT': return { ...lane, x: 1 - extend, w: extend };
      case 'TOP_TO_BOTTOM': return { ...lane, h: extend };
      case 'BOTTOM_TO_TOP': return { ...lane, y: 1 - extend, h: extend };
    }
  }

  protected dangerShapes(): Shape[] {
    return [{ kind: 'rect', ...this.sweptRect(this.spawn.clock.absoluteBeat) }];
  }

  render(r: Renderer): void {
    const beat = this.spawn.clock.absoluteBeat;
    const lane = this.laneRect();

    if (this.phase === 'TELEGRAPH') {
      const p = this.telegraphProgress(beat);
      r.fillRect(lane, '#8c6bff', 0.08 + 0.22 * p * p);
      r.strokeRect(lane, '#b9a4ff', 2, 0.4 + 0.5 * p, [10, 6]);
      this.renderArrow(r, lane, 0.5 + 0.5 * p);
      return;
    }

    if (this.phase === 'ACTIVE') {
      const swept = this.sweptRect(beat);
      r.fillRect(lane, '#3b2e6b', 0.3);
      r.fillRect(swept, '#a68bff', 0.95);
      // Bright head at the leading edge sells the whip direction.
      this.renderHead(r, swept);
      return;
    }

    if (this.phase === 'RECOVERY') {
      const span = Math.max(0.0001, this.recoveryEndBeat - this.activeEndBeat);
      const fade = clamp(1 - (beat - this.activeEndBeat) / span, 0, 1);
      r.fillRect(lane, '#6a58b5', 0.35 * fade);
    }
  }

  private renderHead(r: Renderer, swept: Rect): void {
    switch (this.direction) {
      case 'LEFT_TO_RIGHT': r.line(swept.x + swept.w, swept.y, swept.x + swept.w, swept.y + swept.h, '#ffffff', 3, 0.9); break;
      case 'RIGHT_TO_LEFT': r.line(swept.x, swept.y, swept.x, swept.y + swept.h, '#ffffff', 3, 0.9); break;
      case 'TOP_TO_BOTTOM': r.line(swept.x, swept.y + swept.h, swept.x + swept.w, swept.y + swept.h, '#ffffff', 3, 0.9); break;
      case 'BOTTOM_TO_TOP': r.line(swept.x, swept.y, swept.x + swept.w, swept.y, '#ffffff', 3, 0.9); break;
    }
  }

  private renderArrow(r: Renderer, lane: Rect, alpha: number): void {
    const cx = lane.x + lane.w / 2;
    const cy = lane.y + lane.h / 2;
    r.text(ARROW[this.direction].repeat(3), cx, cy, '#d8ccff', 22, 'center', alpha);
  }
}

function numberOr(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

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

/**
 * Lanes must TILE the arena.
 *
 * The first version used a fixed band thickness (0.13) on lane centres spaced
 * 0.25 apart, which left uncovered strips between lanes -- 19% of the field,
 * including dead centre and all four edges, was safe from every chain forever.
 * A chain now claims whole lanes, so wherever the player stands some lane
 * covers them and standing still is never an answer.
 */
const DEFAULT_LANE_COUNT = 4;

export class ChainMechanic extends BaseMechanic {
  private readonly direction: ChainDirection;
  private readonly horizontal: boolean;
  /** Start of the claimed band, 0..1. */
  private readonly laneStart: number;
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

    const laneCount = Math.max(2, Math.round(numberOr(this.params.laneCount, DEFAULT_LANE_COUNT)));
    // `width` is now measured in lanes. One lane is the default; the arena is
    // never fully covered, so there is always somewhere to go.
    const span = clamp(Math.round(numberOr(this.params.width, 1)), 1, laneCount - 1);
    this.thickness = span / laneCount;

    const explicitLane = this.params.lane;
    const laneIndex = typeof explicitLane === 'number'
      ? clamp(Math.round(explicitLane), 0, laneCount - span)
      : Math.floor(makeRng(this.seed)() * (laneCount - span + 1));
    this.laneStart = laneIndex / laneCount;

    // Intensity cannot thicken the band without breaking the tiling, so it
    // sharpens the whip instead: the same lane, arriving faster.
    const sweep = this.timing.durationBeats * lerp(0.45, 0.28, this.intensity);
    this.extendBeats = Math.max(0.12, Math.min(0.4, sweep));
  }

  /** The full corridor the chain will occupy once fully extended. */
  private laneRect(): Rect {
    const t = this.thickness;
    return this.horizontal
      ? { x: 0, y: this.laneStart, w: 1, h: t }
      : { x: this.laneStart, y: 0, w: t, h: 1 };
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
      // The whole claimed lane lights up, so "leave this strip" is the reading.
      r.fillRect(lane, '#8c6bff', 0.12 + 0.3 * p * p);
      r.strokeRect(lane, '#b9a4ff', 3, 0.5 + 0.45 * p, [12, 7]);
      this.renderIncomingEdge(r, lane, p);
      this.renderArrows(r, lane, 0.45 + 0.55 * p);
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

  /** Arrows repeated along the lane, so the travel direction reads from anywhere. */
  private renderArrows(r: Renderer, lane: Rect, alpha: number): void {
    const glyph = ARROW[this.direction];
    const steps = 5;
    for (let i = 0; i < steps; i++) {
      const t = (i + 0.5) / steps;
      const x = this.horizontal ? t : lane.x + lane.w / 2;
      const y = this.horizontal ? lane.y + lane.h / 2 : t;
      r.text(glyph, x, y, '#d8ccff', 20, 'center', alpha);
    }
  }

  /** A bright sliver at the origin edge, growing as the strike approaches. */
  private renderIncomingEdge(r: Renderer, lane: Rect, progress: number): void {
    const depth = 0.03 + 0.05 * progress;
    const edge: Rect =
      this.direction === 'LEFT_TO_RIGHT' ? { ...lane, w: depth }
      : this.direction === 'RIGHT_TO_LEFT' ? { ...lane, x: 1 - depth, w: depth }
      : this.direction === 'TOP_TO_BOTTOM' ? { ...lane, h: depth }
      : { ...lane, y: 1 - depth, h: depth };
    r.fillRect(edge, '#d8ccff', 0.3 + 0.5 * progress);
  }
}

function numberOr(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

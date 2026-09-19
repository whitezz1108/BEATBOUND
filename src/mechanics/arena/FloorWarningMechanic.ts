/**
 * A01 -- Floor Warning (ARENA).
 *
 * Telegraphed floor tiles: outlined + pulsing during TELEGRAPH, solid and
 * damaging during ACTIVE, fading during RECOVERY. Layout comes from pattern
 * params ("checker_A" / "checker_B" / explicit tiles), never from code.
 *
 * Params (merged from mechanics.mvp.json defaults + pattern event params):
 *   layout             "checker_A" | "checker_B" | "all" | "rows" | "cols"
 *   grid               [cols, rows]              default [4, 4]
 *   tiles              [[col,row], ...]          explicit override
 *   damageActiveBeats  danger window in beats    default from the library
 *   warningStyle       cosmetic tag              default "red_flash"
 */

import { BaseMechanic, type MechanicSpawnContext } from '../../core/Mechanic';
import type { Rect, Shape } from '../../core/geometry';
import { clamp, makeRng } from '../../core/geometry';
import type { Renderer } from '../../core/Renderer';

/** Never arm more than this share of the floor, whatever the intensity says. */
const MAX_ARMED_FRACTION = 0.6;

export class FloorWarningMechanic extends BaseMechanic {
  private readonly tiles: Rect[];

  constructor(spawn: MechanicSpawnContext) {
    // `damageActiveBeats` is this mechanic's name for its ACTIVE window.
    const damageBeats = numberOr(spawn.params.damageActiveBeats, spawn.timing.durationBeats);
    super({ ...spawn, timing: { ...spawn.timing, durationBeats: damageBeats } });

    const [cols, rows] = readGrid(this.params.grid);
    this.tiles = this.buildTiles(cols, rows);
  }

  private buildTiles(cols: number, rows: number): Rect[] {
    const explicit = this.params.tiles;
    const cells: Array<[number, number]> = [];
    const complement: Array<[number, number]> = [];

    if (Array.isArray(explicit)) {
      for (const cell of explicit) {
        if (Array.isArray(cell) && cell.length >= 2) cells.push([Number(cell[0]), Number(cell[1])]);
      }
    } else {
      const layout = String(this.params.layout ?? 'checker_A');
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          (matchesLayout(layout, c, r) ? cells : complement).push([c, r]);
        }
      }
    }

    // Intensity may add a few tiles from the unused set, but the armed floor is
    // hard-capped so a checkerboard can never become a full-floor kill.
    const capacity = Math.floor(cols * rows * MAX_ARMED_FRACTION) - cells.length;
    const extras = Math.min(
      Math.max(0, capacity),
      Math.floor(complement.length * 0.25 * this.intensity),
    );
    if (extras > 0) {
      const rng = makeRng(this.seed);
      const pool = [...complement];
      for (let i = 0; i < extras && pool.length > 0; i++) {
        pool.splice(Math.floor(rng() * pool.length), 1).forEach((cell) => cells.push(cell));
      }
    }

    const w = 1 / cols;
    const h = 1 / rows;
    return cells
      .filter(([c, r]) => c >= 0 && c < cols && r >= 0 && r < rows)
      .map(([c, r]) => ({ x: c * w, y: r * h, w, h }));
  }

  protected dangerShapes(): Shape[] {
    return this.tiles.map((t) => ({ kind: 'rect' as const, ...t }));
  }

  render(r: Renderer): void {
    const beat = this.spawn.clock.absoluteBeat;
    switch (this.phase) {
      case 'TELEGRAPH': {
        // Fill ramps up toward activation so "when" is readable, not just "where".
        const p = this.telegraphProgress(beat);
        for (const t of this.tiles) {
          r.fillRect(t, '#ff4d6d', 0.10 + 0.28 * p * p);
          r.strokeRect(inset(t, 0.004), '#ff8098', 2, 0.35 + 0.5 * p, [6, 5]);
        }
        break;
      }
      case 'ACTIVE': {
        const p = this.activeProgress(beat);
        for (const t of this.tiles) {
          r.fillRect(t, '#ff2547', 0.92 - 0.25 * p);
          r.strokeRect(inset(t, 0.003), '#ffd9e0', 2, 0.9);
        }
        break;
      }
      case 'RECOVERY': {
        const span = Math.max(0.0001, this.recoveryEndBeat - this.activeEndBeat);
        const fade = clamp(1 - (beat - this.activeEndBeat) / span, 0, 1);
        for (const t of this.tiles) r.fillRect(t, '#7a2038', 0.4 * fade);
        break;
      }
      default:
        break;
    }
  }
}

function matchesLayout(layout: string, col: number, row: number): boolean {
  switch (layout) {
    case 'checker_A': return (col + row) % 2 === 0;
    case 'checker_B': return (col + row) % 2 === 1;
    case 'rows': return row % 2 === 0;
    case 'cols': return col % 2 === 0;
    case 'all': return true;
    default: return (col + row) % 2 === 0;
  }
}

function readGrid(value: unknown): [number, number] {
  if (Array.isArray(value) && value.length >= 2) {
    const c = Math.max(1, Math.round(Number(value[0])));
    const r = Math.max(1, Math.round(Number(value[1])));
    if (Number.isFinite(c) && Number.isFinite(r)) return [c, r];
  }
  return [4, 4];
}

function numberOr(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function inset(rect: Rect, by: number): Rect {
  return { x: rect.x + by, y: rect.y + by, w: rect.w - by * 2, h: rect.h - by * 2 };
}

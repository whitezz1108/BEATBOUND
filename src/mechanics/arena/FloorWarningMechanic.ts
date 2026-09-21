/**
 * A01 -- Floor Warning (ARENA).
 *
 * Telegraphed floor tiles. The whole point of this mechanic is the *when*, so it
 * is the one hazard that runs a four-stage lifecycle rather than three:
 *
 *   TELEGRAPH          "somewhere here is going to hurt" -- outline only
 *   CRITICAL_WARNING   "this exact tile, now" -- solid, urgent, pulsing fast
 *   ACTIVE             damaging
 *   RECOVERY           spent, fading
 *
 * The warning length is not authored, it is *derived*: the telegraph is the time
 * it takes to walk from the worst legal standing spot to the nearest safe tile,
 * plus a reaction margin. That is what makes a full-width row and a single
 * checkerboard square both fair without hand-tuning each layout -- the row
 * telegraphs longer because escaping it is a longer walk.
 *
 * Layout comes from pattern params, never from code:
 *   layout             "checker_A" | "checker_B" | "all" | "rows" | "cols"
 *                      | "single" | "horizontal_strip" | "vertical_strip"
 *                      | "cross" | "center_danger" | "outer_danger"
 *                      | "sector"                       default "checker_A"
 *   grid               [cols, rows]              default [4, 4]
 *   tiles              [[col,row], ...]          explicit override
 *   damageActiveBeats  danger window in beats    default from the library
 *   warningStyle       cosmetic tag              default "red_flash"
 */

import { BaseMechanic, type MechanicPhase, type MechanicSpawnContext } from '../../core/Mechanic';
import type { Rect, Shape } from '../../core/geometry';
import { clamp, makeRng } from '../../core/geometry';
import type { Renderer } from '../../core/Renderer';
import { minimumWarningBeats } from '../../core/fairness';
import { easeIn, easeOutBack, easeOutCubic } from '../../feel/Easing';

/** Never arm more than this share of the floor, whatever the intensity says. */
const MAX_ARMED_FRACTION = 0.6;
/** Beats before activation at which the warning turns urgent. */
const CRITICAL_LEAD_BEATS = 0.75;
/** Longest telegraph the escape calculation may ask for. */
const MAX_WARNING_BEATS = 4;

export class FloorWarningMechanic extends BaseMechanic {
  private readonly tiles: Rect[];

  constructor(spawn: MechanicSpawnContext) {
    // `damageActiveBeats` is this mechanic's name for its ACTIVE window.
    const damageBeats = numberOr(spawn.params.damageActiveBeats, spawn.timing.durationBeats);
    const [cols, rows] = readGrid(spawn.params.grid);
    const tiles = buildTiles(spawn, cols, rows);
    const telegraph = warningBeatsFor(spawn, tiles);

    super({ ...spawn, timing: { ...spawn.timing, telegraphBeats: telegraph, durationBeats: damageBeats } });

    this.tiles = tiles;
  }

  /**
   * The urgent tail is the last stretch of the warning, but never more than half
   * of it: a two-beat telegraph should still spend most of its life calm, or the
   * two stages stop being distinguishable.
   */
  protected override get criticalFraction(): number {
    return Math.min(CRITICAL_LEAD_BEATS, this.timing.telegraphBeats * 0.5) / Math.max(0.001, this.timing.telegraphBeats);
  }

  /** `isCritical` against the *visual* beat, which is what the renderer draws at. */
  private criticalNow(beat: number): boolean {
    return this.phase === 'TELEGRAPH' && this.criticalFraction > 0 && beat >= this.criticalStartBeat;
  }

  protected dangerShapes(): Shape[] {
    return this.tiles.map((t) => ({ kind: 'rect' as const, ...t }));
  }

  /** Centre of the armed area, for effects that need one point. */
  private centroid(): { x: number; y: number } {
    if (this.tiles.length === 0) return { x: 0.5, y: 0.5 };
    let x = 0;
    let y = 0;
    for (const t of this.tiles) { x += t.x + t.w / 2; y += t.y + t.h / 2; }
    return { x: x / this.tiles.length, y: y / this.tiles.length };
  }

  protected override onPhaseChange(_from: MechanicPhase, to: MechanicPhase): void {
    if (to === 'TELEGRAPH') {
      this.feel.sfx('floor_warning');
      return;
    }
    if (to !== 'ACTIVE') return;
    const c = this.centroid();
    this.feel.impact('MEDIUM', { x: c.x, y: c.y, colour: '#ff2547', sfx: 'floor_impact' });
    // Embers thrown up from each tile edge, so the floor reads as erupting.
    for (const t of this.tiles) {
      this.feel.emit(t.x + t.w / 2, t.y + t.h / 2, {
        count: 4, speed: 0.5, colour: '#ff8098', size: 0.006, life: 0.45,
        shape: 'spark', gravity: 0.35,
      });
    }
  }

  render(r: Renderer): void {
    const beat = this.spawn.clock.visualBeat;
    switch (this.phase) {
      case 'TELEGRAPH': {
        this.renderWarning(r, beat);
        break;
      }
      case 'ACTIVE': {
        const p = this.activeProgress(beat);
        // Overshoot on arrival: the tile snaps past full size and settles.
        const punch = 1 + 0.06 * (1 - easeOutBack(Math.min(1, p * 4)));
        for (const t of this.tiles) {
          const grown = {
            x: t.x - (t.w * (punch - 1)) / 2, y: t.y - (t.h * (punch - 1)) / 2,
            w: t.w * punch, h: t.h * punch,
          };
          r.fillRect(grown, '#ff2547', 0.92 - 0.25 * p);
          r.strokeRect(inset(grown, 0.003), '#ffd9e0', 2, 0.9);
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

  /**
   * Two-stage warning.
   *
   * The early stage says *where*: a dashed outline that ramps in slowly, so a
   * busy screen is not covered in shouting red a second before anything happens.
   * The critical stage says *now*: the tile fills, the outline goes solid and the
   * shiver snaps to double speed. A player who only ever reads colour still gets
   * an unambiguous "this one, immediately".
   */
  private renderWarning(r: Renderer, beat: number): void {
    const critical = this.criticalNow(beat);
    const p = this.telegraphProgress(beat);
    const urgency = critical
      ? clamp((beat - this.criticalStartBeat) / Math.max(0.001, this.activationBeat - this.criticalStartBeat), 0, 1)
      : 0;
    const shake = (critical ? 0.006 : 0.003) * easeIn(p) * Math.sin(beat * (critical ? 92 : 40));

    for (const t of this.tiles) {
      const jittered = { ...t, x: t.x + shake, y: t.y - shake };
      if (critical) {
        r.fillRect(jittered, '#ff4d6d', 0.30 + 0.30 * urgency);
        r.strokeRect(inset(jittered, 0.004), '#ffe3ea', 3, 0.75 + 0.25 * urgency);
      } else {
        r.fillRect(jittered, '#ff4d6d', 0.06 + 0.14 * easeOutCubic(p));
        r.strokeRect(inset(jittered, 0.004), '#ff8098', 2, 0.30 + 0.35 * p, [7, 6]);
      }
    }
  }
}

// ---- layout --------------------------------------------------------------

function buildTiles(spawn: MechanicSpawnContext, cols: number, rows: number): Rect[] {
  const explicit = spawn.params.tiles;
  const cells: Array<[number, number]> = [];
  const complement: Array<[number, number]> = [];

  if (Array.isArray(explicit)) {
    for (const cell of explicit) {
      if (Array.isArray(cell) && cell.length >= 2) cells.push([Number(cell[0]), Number(cell[1])]);
    }
  } else {
    const layout = String(spawn.params.layout ?? 'checker_A');
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        (matchesLayout(layout, c, r, cols, rows) ? cells : complement).push([c, r]);
      }
    }
  }

  // Intensity may add a few tiles from the unused set, but the armed floor is
  // hard-capped so a checkerboard can never become a full-floor kill.
  const capacity = Math.floor(cols * rows * MAX_ARMED_FRACTION) - cells.length;
  const extras = Math.min(
    Math.max(0, capacity),
    Math.floor(complement.length * 0.25 * spawn.intensity),
  );
  if (extras > 0) {
    const rng = makeRng(spawn.seed);
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

/**
 * How long this layout's warning has to be.
 *
 * The measured quantity is the worst-case walk out of danger: the centre of the
 * armed tile furthest from any safe tile, straight to the nearest safe tile.
 * Both are computed on the tile grid, so the number is exact for the layout
 * rather than an estimate from its bounding box.
 *
 * Intensity is allowed to *shrink* this toward the reaction floor -- that is
 * one of the ways a section gets harder -- but never past it, and the tier's
 * telegraph scale is applied on top by the registry, which only ever lengthens.
 */
function warningBeatsFor(spawn: MechanicSpawnContext, tiles: Rect[]): number {
  const spb = Math.max(0.01, spawn.clock.secondsPerBeat);
  const library = spawn.timing.telegraphBeats;
  if (tiles.length === 0) return library;

  const [cols, rows] = readGrid(spawn.params.grid);
  const armed = new Set(tiles.map((t) => `${Math.round(t.x * cols)}:${Math.round(t.y * rows)}`));
  const cell = 1 / Math.max(cols, rows);

  let worst = 0;
  for (const t of tiles) {
    const centre = { x: t.x + t.w / 2, y: t.y + t.h / 2 };
    let nearest = Infinity;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        if (armed.has(`${c}:${r}`)) continue;
        const safe = { x: (c + 0.5) / cols, y: (r + 0.5) / rows };
        nearest = Math.min(nearest, Math.hypot(safe.x - centre.x, safe.y - centre.y));
      }
    }
    // A full-floor layout has no safe tile at all; fall back to the far corner.
    if (!Number.isFinite(nearest)) nearest = Math.hypot(0.5, 0.5);
    worst = Math.max(worst, nearest);
  }

  // The walk is centre-to-centre, so it is short by about one tile: the player
  // has to be fully clear of the danger, not merely at its neighbour's centre.
  const distance = worst + cell * 0.5;
  const derived = minimumWarningBeats(distance, spb, undefined, undefined, MAX_WARNING_BEATS);
  return Math.max(library, derived * (1 - 0.25 * clamp(spawn.intensity, 0, 1)));
}

function matchesLayout(layout: string, col: number, row: number, cols: number, rows: number): boolean {
  switch (layout) {
    case 'checker_A': return (col + row) % 2 === 0;
    case 'checker_B': return (col + row) % 2 === 1;
    case 'rows': return row % 2 === 0;
    case 'cols': return col % 2 === 0;
    case 'all': return true;
    case 'single':
      return col === Math.floor(cols / 2) && row === Math.floor(rows / 2);
    case 'horizontal_strip': return row === Math.floor(rows / 2);
    case 'vertical_strip': return col === Math.floor(cols / 2);
    case 'cross':
      return row === Math.floor(rows / 2) || col === Math.floor(cols / 2);
    case 'center_danger': {
      // The middle block is lethal, the rim is safe -- the inverse read of
      // outer_danger, and the one that punishes camping the centre.
      const c0 = Math.floor(cols / 4);
      const r0 = Math.floor(rows / 4);
      return col >= c0 && col < cols - c0 && row >= r0 && row < rows - r0;
    }
    case 'outer_danger': {
      const c0 = Math.floor(cols / 4);
      const r0 = Math.floor(rows / 4);
      const inner = col >= c0 && col < cols - c0 && row >= r0 && row < rows - r0;
      return !inner;
    }
    case 'sector': {
      // A quarter wedge from the arena centre, so it composes with the radial
      // family without needing a second hazard to describe a direction.
      const dx = (col + 0.5) / cols - 0.5;
      const dy = (row + 0.5) / rows - 0.5;
      const angle = Math.atan2(dy, dx);
      return angle >= -Math.PI / 2 && angle < 0;
    }
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

/**
 * A02 -- Safe Tile (ARENA).
 *
 * The inverse of A01: the whole floor becomes dangerous *except* a small safe
 * patch. The telegraph shows where to stand rather than where not to.
 *
 * Params:
 *   safeAreaCount  how many safe patches          default 1
 *   safeAreaSize   patch side length, 0..1        default 0.25
 *   safeAreas      explicit [[x, y], ...] centres (overrides the above)
 */

import { BaseMechanic, type MechanicPhase, type MechanicSpawnContext } from '../../core/Mechanic';
import type { Rect, Shape } from '../../core/geometry';
import { clamp, lerp, makeRng } from '../../core/geometry';
import type { Renderer } from '../../core/Renderer';

/** The player is ~0.064 wide; a patch must comfortably contain them. */
const MIN_SAFE_SIZE = 0.16;
/** How finely the dangerous complement is diced before merging into strips. */
const GRID = 12;

export class SafeTileMechanic extends BaseMechanic {
  private readonly safeAreas: Rect[];
  private readonly danger: Rect[];

  constructor(spawn: MechanicSpawnContext) {
    super(spawn);
    this.safeAreas = this.buildSafeAreas();
    this.danger = this.buildDanger();
  }

  private buildSafeAreas(): Rect[] {
    // Intensity shrinks the refuge, but never below a size the player fits in.
    const size = clamp(
      numberOr(this.params.safeAreaSize, 0.25) * lerp(1, 0.75, this.intensity),
      MIN_SAFE_SIZE,
      1,
    );
    const explicit = this.params.safeAreas;
    if (Array.isArray(explicit)) {
      return explicit
        .filter((c): c is [number, number] => Array.isArray(c) && c.length >= 2)
        .map(([cx, cy]) => centred(Number(cx), Number(cy), size));
    }

    const count = Math.max(1, Math.round(numberOr(this.params.safeAreaCount, 1)));
    const rng = makeRng(this.seed);
    const areas: Rect[] = [];
    for (let i = 0; i < count; i++) {
      // Deterministic placement, kept clear of the field edges.
      const cx = lerp(size / 2, 1 - size / 2, rng());
      const cy = lerp(size / 2, 1 - size / 2, rng());
      areas.push(centred(cx, cy, size));
    }
    return areas;
  }

  /**
   * Everything outside the safe patches. Diced on a grid, then merged into
   * horizontal strips so collision walks a handful of rects, not 144 cells.
   */
  private buildDanger(): Rect[] {
    const cell = 1 / GRID;
    const strips: Rect[] = [];
    for (let row = 0; row < GRID; row++) {
      let runStart = -1;
      for (let col = 0; col <= GRID; col++) {
        const inside = col < GRID && !this.isSafe(col * cell, row * cell, cell);
        if (inside && runStart === -1) runStart = col;
        if (!inside && runStart !== -1) {
          strips.push({ x: runStart * cell, y: row * cell, w: (col - runStart) * cell, h: cell });
          runStart = -1;
        }
      }
    }
    return strips;
  }

  private isSafe(x: number, y: number, cell: number): boolean {
    return this.safeAreas.some(
      (a) => x >= a.x - 1e-9 && y >= a.y - 1e-9 && x + cell <= a.x + a.w + 1e-9 && y + cell <= a.y + a.h + 1e-9,
    );
  }

  protected override onPhaseChange(_from: MechanicPhase, to: MechanicPhase): void {
    if (to === 'TELEGRAPH') {
      this.feel.sfx('floor_warning');
      return;
    }
    if (to !== 'ACTIVE') return;
    this.feel.impact('MEDIUM', { colour: '#ff2547', sfx: 'floor_impact', shockwave: false });
    // Ring each refuge so the eye is pulled to safety, not to the danger.
    for (const a of this.safeAreas) {
      this.feel.shockwave(a.x + a.w / 2, a.y + a.h / 2, a.w * 1.6, '#4dffa6', 0.35, 2);
    }
  }

  protected dangerShapes(): Shape[] {
    return this.danger.map((rect) => ({ kind: 'rect' as const, ...rect }));
  }

  render(r: Renderer): void {
    const beat = this.spawn.clock.visualBeat;

    if (this.phase === 'TELEGRAPH') {
      const p = this.telegraphProgress(beat);
      for (const strip of this.danger) r.fillRect(strip, '#ff4d6d', 0.06 + 0.2 * p * p);
      for (const area of this.safeAreas) {
        r.fillRect(area, '#4dffa6', 0.10 + 0.14 * p);
        r.strokeRect(area, '#8affd0', 3, 0.5 + 0.5 * p, [8, 5]);
      }
      return;
    }

    if (this.phase === 'ACTIVE') {
      for (const strip of this.danger) r.fillRect(strip, '#ff2547', 0.88);
      for (const area of this.safeAreas) {
        r.fillRect(area, '#0d2018', 1);
        r.strokeRect(area, '#4dffa6', 3, 0.95);
      }
      return;
    }

    if (this.phase === 'RECOVERY') {
      const span = Math.max(0.0001, this.recoveryEndBeat - this.activeEndBeat);
      const fade = clamp(1 - (beat - this.activeEndBeat) / span, 0, 1);
      for (const strip of this.danger) r.fillRect(strip, '#7a2038', 0.35 * fade);
    }
  }
}

function centred(cx: number, cy: number, size: number): Rect {
  const x = clamp(cx, size / 2, 1 - size / 2) - size / 2;
  const y = clamp(cy, size / 2, 1 - size / 2) - size / 2;
  return { x, y, w: size, h: size };
}

function numberOr(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

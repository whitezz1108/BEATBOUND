/**
 * Shared polar helpers for the Arena's radial choreography.
 *
 * The arena is a unit square, but the geometric patterns think in polar
 * coordinates around its centre. Keeping the conversions and the safe-arc maths
 * here means A04, A07, A08 and A10 all agree on what "the gap at -90 degrees"
 * means, and a pattern author only ever writes degrees.
 */

import type { Sector, Vec2 } from '../../core/geometry';
import { normalizeAngle } from '../../core/geometry';

export const ARENA_CENTRE = { x: 0.5, y: 0.5 };
/** Distance from centre to a corner: far enough to be off-field everywhere. */
export const ARENA_OUTER_RADIUS = Math.SQRT1_2 + 0.06;

export function degToRad(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

export function radToDeg(radians: number): number {
  return (radians * 180) / Math.PI;
}

/**
 * Field point at `radius` from `centre`, along `angleRadians`.
 *
 * The centre is a parameter rather than a constant because not every radial
 * figure in the arena is centred on the arena. A12's seal is centred on the
 * *player* (see RhythmBreakoutMechanic), and it draws and damages from the same
 * polar maths every other radial mechanic uses -- so the maths has to be told
 * which centre it is working around rather than assuming.
 */
export function polarToField(
  angleRadians: number, radius: number, centre: Vec2 = ARENA_CENTRE,
): { x: number; y: number } {
  return {
    x: centre.x + Math.cos(angleRadians) * radius,
    y: centre.y + Math.sin(angleRadians) * radius,
  };
}

export function fieldToAngle(x: number, y: number, centre: Vec2 = ARENA_CENTRE): number {
  return Math.atan2(y - centre.y, x - centre.x);
}

/**
 * Split a full circle into the arcs that are *dangerous*, given a set of
 * openings. This is the one piece of geometry every radial mechanic needs: a
 * ring is the whole circle minus its gaps.
 *
 * Returns arcs as [start, end] pairs with end > start.
 */
export function dangerArcs(gapCentres: number[], gapArc: number): Array<[number, number]> {
  if (gapCentres.length === 0) return [[0, Math.PI * 2]];
  const half = Math.min(gapArc, Math.PI * 2 * 0.95) / 2;
  const gaps = gapCentres
    .map((centre) => normalizeAngle(centre))
    .sort((a, b) => a - b);

  const arcs: Array<[number, number]> = [];
  for (let i = 0; i < gaps.length; i++) {
    const start = gaps[i] + half;
    const end = (i + 1 < gaps.length ? gaps[i + 1] : gaps[0] + Math.PI * 2) - half;
    if (end > start + 1e-4) arcs.push([start, end]);
  }
  return arcs;
}

/** Evenly spaced gap centres starting at `firstCentre`. */
export function spreadGaps(firstCentre: number, count: number): number[] {
  const n = Math.max(1, Math.round(count));
  const step = (Math.PI * 2) / n;
  return Array.from({ length: n }, (_, i) => firstCentre + i * step);
}

export function sector(
  rInner: number, rOuter: number, a0: number, a1: number, centre: Vec2 = ARENA_CENTRE,
): Sector {
  return { cx: centre.x, cy: centre.y, rInner, rOuter, a0, a1 };
}

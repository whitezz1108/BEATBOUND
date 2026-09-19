/**
 * Field-space geometry.
 *
 * All gameplay positions live in a normalized unit square: x and y run 0..1,
 * origin top-left. Mechanics therefore never know the canvas size, and a level
 * plays identically at any resolution.
 */

export interface Vec2 { x: number; y: number }
export interface Rect { x: number; y: number; w: number; h: number }
export interface Circle { x: number; y: number; r: number }

export type Shape =
  | ({ kind: 'rect' } & Rect)
  | ({ kind: 'circle' } & Circle);

export function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * clamp(t, 0, 1);
}

export function circleIntersectsRect(c: Circle, r: Rect): boolean {
  const nx = clamp(c.x, r.x, r.x + r.w);
  const ny = clamp(c.y, r.y, r.y + r.h);
  const dx = c.x - nx;
  const dy = c.y - ny;
  return dx * dx + dy * dy <= c.r * c.r;
}

export function circleIntersectsCircle(a: Circle, b: Circle): boolean {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const rr = a.r + b.r;
  return dx * dx + dy * dy <= rr * rr;
}

export function circleIntersectsShape(c: Circle, s: Shape): boolean {
  return s.kind === 'rect' ? circleIntersectsRect(c, s) : circleIntersectsCircle(c, s);
}

/**
 * Small deterministic PRNG (mulberry32).
 *
 * Mechanics that need variety ("spawnSide": "random") seed this from their own
 * activation beat, so a level replays identically every run -- randomness never
 * escapes the pattern's control.
 */
export function makeRng(seed: number): () => number {
  let a = Math.imul(seed ^ 0x9e3779b9, 0x85ebca6b) >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

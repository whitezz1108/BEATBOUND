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

/**
 * An annular sector -- a wedge of a ring.
 *
 * This is the natural hazard shape for radial choreography: a fan arm, a slice
 * of a burst ring, the dangerous part of a collapsing ring. Angles are radians
 * in canvas convention (0 = +x, increasing toward +y, i.e. clockwise on screen)
 * and `a1` may exceed `a0` by up to 2*PI.
 */
export interface Sector {
  cx: number;
  cy: number;
  rInner: number;
  rOuter: number;
  a0: number;
  a1: number;
}

export type Shape =
  | ({ kind: 'rect' } & Rect)
  | ({ kind: 'circle' } & Circle)
  | ({ kind: 'sector' } & Sector);

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

/** Normalise to [0, 2*PI). */
export function normalizeAngle(angle: number): number {
  const twoPi = Math.PI * 2;
  return ((angle % twoPi) + twoPi) % twoPi;
}

/** Shortest signed distance from `a` to `b`, in [-PI, PI]. */
export function angleDelta(a: number, b: number): number {
  let d = normalizeAngle(b) - normalizeAngle(a);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}

/** Is `angle` inside the arc running from a0 forward to a1? */
export function angleInArc(angle: number, a0: number, a1: number): boolean {
  const span = a1 - a0;
  if (span >= Math.PI * 2) return true;
  const offset = normalizeAngle(angle - a0);
  return offset <= normalizeAngle(span) + 1e-9;
}

export function circleIntersectsSector(c: Circle, s: Sector): boolean {
  const dx = c.x - s.cx;
  const dy = c.y - s.cy;
  const distance = Math.hypot(dx, dy);
  if (distance + c.r < s.rInner) return false;
  if (distance - c.r > s.rOuter) return false;

  const span = s.a1 - s.a0;
  if (span >= Math.PI * 2) return true;
  // Inflate the wedge by the angle the player's radius subtends at this
  // distance, so grazing the edge counts as a hit at any radius.
  const half = distance < 1e-6 ? Math.PI : Math.asin(Math.min(1, c.r / Math.max(distance, c.r)));
  const angle = Math.atan2(dy, dx);
  return angleInArc(angle, s.a0 - half, s.a1 + half);
}

export function circleIntersectsShape(c: Circle, s: Shape): boolean {
  switch (s.kind) {
    case 'rect': return circleIntersectsRect(c, s);
    case 'circle': return circleIntersectsCircle(c, s);
    case 'sector': return circleIntersectsSector(c, s);
  }
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

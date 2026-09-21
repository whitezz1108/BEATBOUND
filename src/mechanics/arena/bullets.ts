/**
 * Bullet visual language.
 *
 * The brief's complaint about the old projectile system was that it read as "a
 * few very large high-speed generic circles". Two of those three words are fixed
 * by numbers in `tuning.ts`; the third is fixed here, by giving each *source* a
 * silhouette family so the player can tell where a shot came from without
 * looking at it.
 *
 *   CENTER family  round and symmetric -- orb, star, spark, petal. The emitter
 *                  is in the arena, so the bullet has no travel axis worth
 *                  reading and the shape stays axis-agnostic.
 *   EDGE family    angular and oriented -- diamond, arrow, shard, rect, beam.
 *                  These enter from a wall, so the silhouette points the way it
 *                  is going and the player reads the direction for free.
 *
 * The hitbox is always a circle (or a short run of them for the long
 * silhouettes). Shapes are therefore drawn *inscribed* in the hitbox, never
 * larger: a sprite that looks bigger than it hits hides safe gaps, which is the
 * exact failure the brief calls out.
 *
 * Everything here draws through `Renderer`'s existing primitives -- polygons are
 * filled and then outlined edge-by-edge with `line()`. Nothing was added to the
 * shared renderer for this.
 */

import type { Renderer } from '../../core/Renderer';
import type { Circle } from '../../core/geometry';

export type BulletShape =
  | 'ORB' | 'STAR' | 'SPARK' | 'PETAL'
  | 'DIAMOND' | 'ARROW' | 'SHARD' | 'RECT' | 'BEAM';

export const CENTER_SHAPES: BulletShape[] = ['ORB', 'STAR', 'SPARK', 'PETAL'];
export const EDGE_SHAPES: BulletShape[] = ['DIAMOND', 'ARROW', 'SHARD', 'RECT', 'BEAM'];

/** Long silhouettes need more than one hit circle to stay honest. */
const ELONGATED: BulletShape[] = ['BEAM'];

export function isBulletShape(value: unknown): value is BulletShape {
  const name = String(value ?? '').toUpperCase();
  return (CENTER_SHAPES as string[]).concat(EDGE_SHAPES as string[]).includes(name);
}

export function readShape(value: unknown, fallback: BulletShape): BulletShape {
  return isBulletShape(value) ? (String(value).toUpperCase() as BulletShape) : fallback;
}

/**
 * The hitbox for one bullet.
 *
 * One circle for the compact silhouettes. For a beam the shape is drawn long and
 * thin, so a single circle at its centre would leave both tips visually lethal
 * and physically harmless -- the player would dodge things that cannot hurt
 * them, which teaches the wrong lesson. Two circles along the travel axis cover
 * the drawn length instead.
 */
export function bulletHitCircles(
  shape: BulletShape,
  x: number,
  y: number,
  radius: number,
  angle: number,
): Circle[] {
  if (!ELONGATED.includes(shape)) return [{ x, y, r: radius }];
  const offset = radius * 0.7;
  return [
    { x: x + Math.cos(angle) * offset, y: y + Math.sin(angle) * offset, r: radius },
    { x: x - Math.cos(angle) * offset, y: y - Math.sin(angle) * offset, r: radius },
  ];
}

export interface BulletDraw {
  x: number;
  y: number;
  /** Collision radius. The silhouette is inscribed in this, never larger. */
  radius: number;
  shape: BulletShape;
  /** Travel direction, radians. Only the edge family reads it. */
  angle: number;
  colour: string;
  /** Outline colour. Defaults to `colour`, which reads as a solid shape. */
  edge?: string;
  alpha?: number;
  /** Soft halo. Wants to be on for centre bullets, off for edge bullets. */
  glow?: boolean;
}

export function drawBullet(r: Renderer, o: BulletDraw): void {
  const alpha = o.alpha ?? 1;
  if (o.radius <= 0) return;

  if (o.shape === 'ORB') {
    if (o.glow !== false) r.glow(o.x, o.y, o.radius * 3, o.colour, 0.22 * alpha);
    r.fillCircle(o.x, o.y, o.radius, o.colour, alpha);
    if (o.edge) r.strokeCircle(o.x, o.y, o.radius, o.edge, 2, 0.85 * alpha);
    return;
  }

  const points = silhouette(o.shape, o.x, o.y, o.radius, o.angle);
  if (o.glow) r.glow(o.x, o.y, o.radius * 3.2, o.colour, 0.18 * alpha);
  r.fillPolygon(points, o.colour, alpha);
  if (o.edge) outline(r, points, o.edge, 2, 0.85 * alpha);
}

/** The same silhouette, as a stroked outline only. Used for telegraph ghosts. */
export function drawBulletOutline(r: Renderer, o: BulletDraw): void {
  if (o.radius <= 0) return;
  const alpha = o.alpha ?? 1;
  if (o.shape === 'ORB') {
    r.strokeCircle(o.x, o.y, o.radius, o.edge ?? o.colour, 2, alpha);
    return;
  }
  outline(r, silhouette(o.shape, o.x, o.y, o.radius, o.angle), o.edge ?? o.colour, 2, alpha);
}

// ---- silhouettes ---------------------------------------------------------

/** Unit-space outlines, pointing +x, inscribed in a circle of radius 1. */
const UNIT: Record<Exclude<BulletShape, 'ORB'>, Array<[number, number]>> = {
  // Five-pointed, symmetric: the "something burst here" read.
  STAR: star(5, 1, 0.45, Math.PI / 2),
  // A four-pointed spike. Sharper than a star, so it reads as fast.
  SPARK: star(4, 1, 0.2, 0),
  // A leaf pointed along the travel axis: fat in the middle, sharp at both ends.
  PETAL: leaf(14),
  DIAMOND: [[1, 0], [0, 0.8], [-1, 0], [0, -0.8]],
  // Nose, two swept barbs, and a notched tail -- an arrowhead, unmistakably.
  ARROW: [[1.05, 0], [-0.5, 0.9], [-0.15, 0], [-0.5, -0.9]],
  // A narrow splinter. Reads as debris thrown off something larger.
  SHARD: [[1.05, 0], [-0.7, 0.34], [-0.55, 0], [-0.7, -0.34]],
  RECT: [[0.85, 0.6], [-0.85, 0.6], [-0.85, -0.6], [0.85, -0.6]],
  // Deliberately a *short* beam segment, per the brief: long enough to read as
  // a beam, short enough that its two hit circles cover the whole drawing.
  BEAM: [[1.2, 0.32], [-1.2, 0.32], [-1.2, -0.32], [1.2, -0.32]],
};

function silhouette(
  shape: BulletShape,
  x: number,
  y: number,
  radius: number,
  angle: number,
): Array<{ x: number; y: number }> {
  const unit = UNIT[shape as Exclude<BulletShape, 'ORB'>] ?? UNIT.DIAMOND;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return unit.map(([ux, uy]) => {
    const lx = ux * radius;
    const ly = uy * radius;
    return { x: x + lx * cos - ly * sin, y: y + lx * sin + ly * cos };
  });
}

function star(points: number, outer: number, inner: number, phase: number): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  for (let i = 0; i < points * 2; i++) {
    const radius = i % 2 === 0 ? outer : inner;
    const angle = phase + (i * Math.PI) / points;
    out.push([Math.cos(angle) * radius, Math.sin(angle) * radius]);
  }
  return out;
}

/** `r(theta) = inner + (1 - inner) * |cos theta|` -- a lens pointed along +x. */
function leaf(steps: number, inner = 0.42): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  for (let i = 0; i < steps; i++) {
    const angle = (i / steps) * Math.PI * 2;
    const radius = inner + (1 - inner) * Math.abs(Math.cos(angle));
    out.push([Math.cos(angle) * radius, Math.sin(angle) * radius]);
  }
  return out;
}

/** Close a polygon with `line()` calls. No stroked-polygon primitive needed. */
function outline(
  r: Renderer,
  points: Array<{ x: number; y: number }>,
  style: string,
  widthPx: number,
  alpha: number,
): void {
  for (let i = 0; i < points.length; i++) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    r.line(a.x, a.y, b.x, b.y, style, widthPx, alpha);
  }
}

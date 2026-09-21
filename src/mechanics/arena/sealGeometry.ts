/**
 * The shape of a seal, for A12 Rhythm Breakout.
 *
 * A seal is a closed band around the centre of the arena. Which *silhouette*
 * that band has is a skin decision -- a circle, a hexagon, an octagonal rune --
 * and this module is the one place that knows how to turn a silhouette into
 * the three things the rest of the mechanic needs:
 *
 *   1. the hazard shapes the mode collides against,
 *   2. the outline the renderer draws,
 *   3. the conversion between the radius an *author* writes and the radius the
 *      geometry actually runs on.
 *
 * WHY THE CONVERSION EXISTS
 * -------------------------
 * A polygon has two radii. Its circumradius reaches the vertices; its inradius
 * reaches the middle of each edge, and that is the one the player can feel,
 * because the closest wall is what crushes them first. So every radius in the
 * level data is an *inradius*: `criticalRadius: 0.13` means "the nearest wall
 * stops 0.13 from the middle", whatever silhouette the skin picked. A hexagonal
 * seal is therefore exactly as fair as a circular one at the same numbers,
 * which is what lets a skin be a cosmetic choice rather than a difficulty one.
 *
 * WHY THE HAZARD IS SAMPLED
 * -------------------------
 * `Shape` has circles, rects and annular sectors -- no polygons, and no rotated
 * rects. A polygon band is therefore approximated by one sector per sample
 * step, each at the band's radius for that step. The renderer draws from the
 * *same* sample set, so what is drawn and what damages are the same figure
 * rather than two figures that happen to look alike.
 *
 * WHERE THE CENTRE COMES FROM
 * ---------------------------
 * Every function here takes the band's centre as an argument. A seal is not
 * necessarily centred on the arena -- A12's is centred on the player -- and the
 * only way a drawn figure and a damaging figure stay the same figure is if both
 * are built from one centre, passed in once.
 */

import type { Shape, Vec2 } from '../../core/geometry';
import { ARENA_CENTRE, polarToField, sector } from './polar';

/**
 * Sectors per polygon edge.
 *
 * Four keeps the radial error inside an edge under half a percent of the
 * radius -- far below the band's own thickness -- while keeping the hazard
 * list short enough that the headless camp audits, which test a 41x41 grid of
 * standing positions against every shape, stay quick.
 */
const SEGMENTS_PER_SIDE = 4;
/** Sample steps used for a circle's outline. Drawing only; its hazard is one sector. */
const CIRCLE_SEGMENTS = 64;

/** A silhouette. Fewer than three sides means a circle. */
export interface SealShape {
  sides: number;
  /** Turns per beat. Cosmetic: a regular polygon's inradius does not rotate. */
  spinPerBeat: number;
}

export function isRound(shape: SealShape): boolean {
  return shape.sides < 3;
}

/** Inradius / circumradius. 1 for a circle. */
export function inradiusFactor(shape: SealShape): number {
  return isRound(shape) ? 1 : Math.cos(Math.PI / shape.sides);
}

/** The circumradius a silhouette needs to put its nearest wall at `inradius`. */
export function circumradiusFor(shape: SealShape, inradius: number): number {
  return inradius / inradiusFactor(shape);
}

/** Current rotation of the silhouette, in radians. */
export function spinAt(shape: SealShape, beat: number): number {
  return isRound(shape) ? 0 : beat * shape.spinPerBeat * Math.PI * 2;
}

/** Distance from the centre to the band's centre line, at `angle`. */
export function radiusAt(shape: SealShape, circumradius: number, angle: number, spin: number): number {
  if (isRound(shape)) return circumradius;
  const step = (Math.PI * 2) / shape.sides;
  // Angle measured from the middle of whichever edge we are looking at.
  const local = (((angle - spin) % step) + step) % step - step / 2;
  return (circumradius * Math.cos(step / 2)) / Math.cos(local);
}

export interface BandSample {
  /** Segment bounds, radians. */
  a0: number;
  a1: number;
  /** The band's centre-line radius across this segment. */
  radius: number;
}

/**
 * The band, chopped into segments.
 *
 * Polygon segments are aligned to the vertices, so a corner always falls on a
 * segment boundary and never gets rounded off inside one.
 */
export function bandSamples(shape: SealShape, circumradius: number, spin: number): BandSample[] {
  const count = isRound(shape) ? CIRCLE_SEGMENTS : shape.sides * SEGMENTS_PER_SIDE;
  const step = (Math.PI * 2) / count;
  const start = isRound(shape) ? 0 : spin - Math.PI / shape.sides;
  return Array.from({ length: count }, (_, i) => {
    const a0 = start + i * step;
    const a1 = a0 + step;
    return { a0, a1, radius: radiusAt(shape, circumradius, (a0 + a1) / 2, spin) };
  });
}

/**
 * Everything the band damages.
 *
 * A circle is one full-turn sector -- the cheap, exact case, and the one every
 * shipped pattern uses. A polygon is one sector per segment.
 */
export function bandShapes(
  shape: SealShape, circumradius: number, thickness: number, spin: number,
  centre: Vec2 = ARENA_CENTRE,
): Shape[] {
  const half = thickness / 2;
  if (isRound(shape)) {
    return [{
      kind: 'sector',
      ...sector(Math.max(0, circumradius - half), circumradius + half, 0, Math.PI * 2, centre),
    }];
  }
  return bandSamples(shape, circumradius, spin).map((s) => ({
    kind: 'sector' as const,
    ...sector(Math.max(0, s.radius - half), s.radius + half, s.a0, s.a1, centre),
  }));
}

/** Closed outline at `offset` from the band's centre line, in field points. */
export function outlinePoints(
  shape: SealShape, circumradius: number, spin: number, offset: number,
  centre: Vec2 = ARENA_CENTRE,
): Vec2[] {
  if (isRound(shape)) {
    return Array.from({ length: CIRCLE_SEGMENTS }, (_, i) => {
      const angle = (i / CIRCLE_SEGMENTS) * Math.PI * 2;
      return polarToField(angle, Math.max(0, circumradius + offset), centre);
    });
  }
  // A polygon only needs its corners: the edges between them are straight.
  return Array.from({ length: shape.sides }, (_, i) => {
    const angle = spin + (i / shape.sides) * Math.PI * 2;
    return polarToField(angle, Math.max(0, circumradius + offset / inradiusFactor(shape)), centre);
  });
}

/** The four corners of one segment's slab of band, for filling. */
export function segmentQuad(
  shape: SealShape, sample: BandSample, thickness: number, circumradius: number, spin: number,
  centre: Vec2 = ARENA_CENTRE,
): Vec2[] {
  const half = thickness / 2;
  const r0 = radiusAt(shape, circumradius, sample.a0, spin);
  const r1 = radiusAt(shape, circumradius, sample.a1, spin);
  return [
    polarToField(sample.a0, Math.max(0, r0 - half), centre),
    polarToField(sample.a1, Math.max(0, r1 - half), centre),
    polarToField(sample.a1, r1 + half, centre),
    polarToField(sample.a0, r0 + half, centre),
  ];
}

export { ARENA_CENTRE };

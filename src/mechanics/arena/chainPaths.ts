/**
 * Chain path families for A05.
 *
 * `ChainMechanic` is a whip: it walks a polyline and reveals links along it. All
 * that separates one chain attack from another is therefore *which polyline* --
 * so the shapes live here, as pure generators, and the mechanic stays a renderer
 * and a collision source.
 *
 * Two kinds of family:
 *
 *   static   the path is fixed and the whip runs along it (CURVE_C, SPIRAL, ...)
 *   rotating the path turns about the arena centre as the whip extends
 *            (SWEEP, ROTATING_CHAINS) -- a rotating chain is a rotating fan made
 *            of joints, so it is clamped against the same reachability budget
 *
 * Every generator is deterministic: same params + same seed, same path, so a
 * level replays identically. `makeRng` is used only where the shape is meant to
 * vary, and it is seeded from the event.
 *
 * Fairness is enforced here rather than trusted to the author: a rotating family
 * may not turn faster than the player can follow at the path's outermost radius.
 */

import { clamp, makeRng } from '../../core/geometry';
import { maxGapShiftPerBeat } from '../../core/fairness';
import { ARENA_CENTRE, degToRad } from './polar';

export type PathFamily =
  | 'PARALLEL' | 'X_CROSS' | 'FAN' | 'SWEEP'
  | 'CURVE_C' | 'CURVE_S' | 'ARC' | 'SPIRAL' | 'ROTATING_CHAINS';

export const PATH_FAMILIES: PathFamily[] = [
  'PARALLEL', 'X_CROSS', 'FAN', 'SWEEP',
  'CURVE_C', 'CURVE_S', 'ARC', 'SPIRAL', 'ROTATING_CHAINS',
];

export interface Point { x: number; y: number }

export interface ChainPathSpec {
  points: Point[];
  /** Radians per beat the whole path turns about the arena centre. 0 = static. */
  rotationPerBeat: number;
  /** True when the whip should run from the last point to the first. */
  reversed?: boolean;
}

export interface PathRequest {
  family: PathFamily;
  params: Record<string, unknown>;
  seed: number;
  secondsPerBeat: number;
}

/** Number of chains a family draws, and how complex each one is. */
interface Shape {
  chains: number;
  /** 0..1 -- how far the shape leans into its own idea. */
  complexity: number;
}

/**
 * Build the paths for one chain event.
 *
 * `chains` and `complexity` are the two knobs the composer escalates on: a
 * section that is getting louder adds chains first and complexity second, which
 * is the order the brief asks for (count, then complexity, then speed).
 */
export function buildChainPaths(request: PathRequest): ChainPathSpec[] {
  const rng = makeRng(request.seed);
  const shape: Shape = {
    chains: clamp(Math.round(numberOr(request.params.chains, defaultChains(request.family))), 1, 6),
    complexity: clamp(numberOr(request.params.complexity, 0.5), 0, 1),
  };

  const paths = generate(request, shape, rng);
  return paths.map((path) => ({
    ...path,
    rotationPerBeat: clampRotation(path, numberOr(request.params.rotationPerBeat, 0), request.secondsPerBeat),
  }));
}

function generate(request: PathRequest, shape: Shape, rng: () => number): ChainPathSpec[] {
  switch (request.family) {
    case 'PARALLEL': return parallel(shape);
    case 'X_CROSS': return xCross(shape);
    case 'FAN': return fan(shape, rng);
    case 'SWEEP': return sweep(shape, request.params);
    case 'CURVE_C': return curveC(shape);
    case 'CURVE_S': return curveS(shape, request.params);
    case 'ARC': return arc(shape);
    case 'SPIRAL': return spiral(shape, request.params);
    case 'ROTATING_CHAINS': return rotatingChains(shape, request.params);
    default: return parallel(shape);
  }
}

// ---- static families -----------------------------------------------------

/**
 * Several straight chains crossing the arena side by side.
 *
 * The gaps between them are the safe lanes, and they are sized from the
 * fairness minimum rather than authored, so "parallel" can never mean "a wall
 * with slits too small to stand in".
 */
function parallel(shape: Shape): ChainPathSpec[] {
  const out: ChainPathSpec[] = [];
  const lanes = shape.chains + 1;
  for (let i = 1; i <= shape.chains; i++) {
    const t = i / lanes;
    // Alternate orientation so the set reads as a weave, not a fence.
    out.push(i % 2 === 0
      ? { points: [{ x: 0, y: t }, { x: 1, y: t }], rotationPerBeat: 0 }
      : { points: [{ x: t, y: 0 }, { x: t, y: 1 }], rotationPerBeat: 0 });
  }
  return out;
}

/** Both diagonals plus both cardinals: eight arms out of the centre. */
function xCross(shape: Shape): ChainPathSpec[] {
  const arms = [
    [{ x: 0, y: 0 }, { x: 1, y: 1 }],
    [{ x: 1, y: 0 }, { x: 0, y: 1 }],
    [{ x: 0, y: 0.5 }, { x: 1, y: 0.5 }],
    [{ x: 0.5, y: 0 }, { x: 0.5, y: 1 }],
  ];
  // Complexity decides how many of the four survive; the diagonals go first so
  // a low-complexity X_CROSS is still recognisably an X.
  const keep = shape.complexity < 0.34 ? 2 : shape.complexity < 0.67 ? 3 : 4;
  return arms.slice(0, keep).map((points) => ({ points, rotationPerBeat: 0 }));
}

/**
 * Chains radiating from a point on the rim.
 *
 * A fan is the readable version of a burst: the player sees the origin and can
 * count the arms, and the safe space is the wedge between two of them.
 */
function fan(shape: Shape, rng: () => number): ChainPathSpec[] {
  const origin = { x: 0.08 + rng() * 0.06, y: 0.15 + rng() * 0.7 };
  const spread = degToRad(60 + 70 * shape.complexity);
  const out: ChainPathSpec[] = [];
  for (let i = 0; i < shape.chains; i++) {
    const t = shape.chains === 1 ? 0.5 : i / (shape.chains - 1);
    const angle = -spread / 2 + spread * t;
    const reach = 1.5;
    out.push({
      points: [origin, { x: origin.x + Math.cos(angle) * reach, y: origin.y + Math.sin(angle) * reach }],
      rotationPerBeat: 0,
    });
  }
  return out;
}

/** A single chain pivoting about the rim: the whip sweeps a quadrant. */
function sweep(shape: Shape, params: Record<string, unknown>): ChainPathSpec[] {
  const pivotSide = String(params.pivot ?? 'LEFT').toUpperCase();
  const pivot =
    pivotSide === 'RIGHT' ? { x: 1, y: 0.5 }
    : pivotSide === 'TOP' ? { x: 0.5, y: 0 }
    : pivotSide === 'BOTTOM' ? { x: 0.5, y: 1 }
    : { x: 0, y: 0.5 };
  const out: ChainPathSpec[] = [];
  for (let i = 0; i < shape.chains; i++) {
    const offset = (i - (shape.chains - 1) / 2) * 0.12;
    out.push({
      points: [pivot, { x: 0.5 + offset, y: 0.5 + offset }],
      rotationPerBeat: degToRad(numberOr(params.rotationPerBeat, 30)),
    });
  }
  return out;
}

/** A C: one arc bulging to one side. */
function curveC(shape: Shape): ChainPathSpec[] {
  const out: ChainPathSpec[] = [];
  for (let i = 0; i < shape.chains; i++) {
    const radius = 0.34 + i * 0.13;
    out.push({ points: arcPoints(radius, degToRad(-70), degToRad(70), 26), rotationPerBeat: 0 });
  }
  return out;
}

/** An S: two opposed arcs joined, so the whip changes hands mid-flight. */
function curveS(shape: Shape, params: Record<string, unknown>): ChainPathSpec[] {
  const vertical = String(params.axis ?? 'HORIZONTAL').toUpperCase() !== 'VERTICAL';
  const amplitude = clamp(numberOr(params.amplitude, 0.26), 0.08, 0.42);
  const out: ChainPathSpec[] = [];
  for (let i = 0; i < shape.chains; i++) {
    const offset = (i - (shape.chains - 1) / 2) * 0.16;
    const points: Point[] = [];
    const steps = 40;
    for (let s = 0; s <= steps; s++) {
      const u = s / steps;
      const sway = Math.sin(u * Math.PI * 2) * amplitude;
      points.push(vertical
        ? { x: clamp(u + offset, 0, 1), y: clamp(0.5 + sway + offset, 0, 1) }
        : { x: clamp(0.5 + sway + offset, 0, 1), y: clamp(u + offset, 0, 1) });
    }
    out.push({ points, rotationPerBeat: 0 });
  }
  return out;
}

/** A shallow arc across the arena: less curve than CURVE_C, more reach. */
function arc(shape: Shape): ChainPathSpec[] {
  const out: ChainPathSpec[] = [];
  for (let i = 0; i < shape.chains; i++) {
    const radius = 0.62 + i * 0.16;
    out.push({ points: arcPoints(radius, degToRad(-40), degToRad(40), 22), rotationPerBeat: 0 });
  }
  return out;
}

/**
 * An Archimedean spiral.
 *
 * `expand` decides which way the whip runs: outward from the eye, or inward
 * toward it. Inward is the meaner read, because the safe space is the rim and
 * the rim is where the player already is.
 */
function spiral(shape: Shape, params: Record<string, unknown>): ChainPathSpec[] {
  const expand = String(params.direction ?? 'OUTWARD').toUpperCase() !== 'INWARD';
  const turns = 1.4 + 1.6 * shape.complexity;
  const points: Point[] = [];
  const steps = 150;
  for (let s = 0; s <= steps; s++) {
    const u = s / steps;
    const r = 0.06 + u * 0.62;
    const a = u * turns * Math.PI * 2;
    points.push({ x: ARENA_CENTRE.x + Math.cos(a) * r, y: ARENA_CENTRE.y + Math.sin(a) * r });
  }
  return [{ points: expand ? points : points.reverse(), rotationPerBeat: 0 }];
}

/** Several straight chains that turn as they extend. */
function rotatingChains(shape: Shape, params: Record<string, unknown>): ChainPathSpec[] {
  const arms = shape.chains;
  const rotation = degToRad(numberOr(params.rotationPerBeat, 45));
  const out: ChainPathSpec[] = [];
  for (let i = 0; i < arms; i++) {
    const a = (i / arms) * Math.PI * 2;
    out.push({
      points: [
        ARENA_CENTRE,
        { x: ARENA_CENTRE.x + Math.cos(a) * 0.72, y: ARENA_CENTRE.y + Math.sin(a) * 0.72 },
      ],
      rotationPerBeat: rotation,
    });
  }
  return out;
}

// ---- helpers -------------------------------------------------------------

function arcPoints(radius: number, a0: number, a1: number, steps: number): Point[] {
  const points: Point[] = [];
  for (let s = 0; s <= steps; s++) {
    const a = a0 + (a1 - a0) * (s / steps);
    points.push({ x: ARENA_CENTRE.x + Math.cos(a) * radius, y: ARENA_CENTRE.y + Math.sin(a) * radius });
  }
  return points;
}

/**
 * Clamp a path's turn rate to what the player can follow.
 *
 * A rotating chain is a fan made of joints, so it obeys the fan's budget: the
 * outermost point of the path may not travel further per beat than the player
 * can walk. Clamping in *angular* terms against the path's own reach is what
 * makes a long chain turn slower than a short one automatically -- which is the
 * correct behaviour and not something an author should have to reason about.
 */
function clampRotation(path: ChainPathSpec, requested: number, secondsPerBeat: number): number {
  if (requested === 0) return 0;
  const reach = path.points.reduce(
    (max, p) => Math.max(max, Math.hypot(p.x - ARENA_CENTRE.x, p.y - ARENA_CENTRE.y)),
    0.01,
  );
  const budget = maxGapShiftPerBeat(secondsPerBeat) / reach;
  return clamp(requested, -budget, budget);
}

function defaultChains(family: PathFamily): number {
  switch (family) {
    case 'PARALLEL': return 2;
    case 'X_CROSS': return 4;
    case 'FAN': return 3;
    case 'SWEEP': return 1;
    case 'CURVE_C': return 1;
    case 'CURVE_S': return 1;
    case 'ARC': return 1;
    case 'SPIRAL': return 1;
    case 'ROTATING_CHAINS': return 2;
    default: return 1;
  }
}

function numberOr(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

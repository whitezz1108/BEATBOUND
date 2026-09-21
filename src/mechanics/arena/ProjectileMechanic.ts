/**
 * A03 -- Projectile (ARENA).
 *
 * Spawns one or more projectiles from a side and crosses the field. Motion is
 * a pure function of the current beat (`position = f(beat)`), so playback is
 * frame-rate independent and deterministic: the same level replays identically.
 *
 * This is the EDGE emitter of the arena's three projectile sources. Everything
 * it fires is drawn in the edge silhouette family (diamond, arrow, shard, rect,
 * beam -- see `bullets.ts`) and at the smaller `edgeProjectileRadius`, so a shot
 * arriving from a wall is never mistaken for something the arena's centre spat
 * out. A centre bullet is a thing you look at; an edge bullet is an interruption
 * whose direction you read.
 *
 * Params:
 *   spawnSide  "LEFT" | "RIGHT" | "TOP" | "BOTTOM" | "random"   default "random"
 *   formation  "spread" | "wall" | "stream" | "fan"              default "spread"
 *   count      projectiles in this volley (spread / stream / fan) default 1
 *   speed      crossing-speed multiplier                         default 1.0
 *   radius     projectile radius in field units      default edgeProjectileRadius
 *   shape      edge silhouette, see bullets.ts                   default "DIAMOND"
 *   gaps       openings in a wall                                default 2
 *   lanes      optional explicit 0..1 lateral positions
 *   spacing    beats between stream shots                        default 0.5
 *   spreadDeg  fan half-width in degrees                         default 30
 *
 * Four formations:
 *
 *   spread  a few projectiles on scattered lanes. Cheap and readable, but a
 *           handful of thin projectiles leaves most of the field untouched, so
 *           a volley alone cannot force the player to move.
 *   wall    projectiles tile the spawn edge except for a small number of
 *           openings. The player has to find a gap and get to it, which is the
 *           formation to reach for when a section must not be campable.
 *   stream  the same lane, fired over and over on a subdivision. Reads as a line
 *           of bullets crossing the arena -- the player walks *alongside* it
 *           rather than through it, which is a different verb from dodging.
 *   fan     one origin on the wall, several arms out of it. The safe space is
 *           the wedge between two arms, and the shared origin tells the player
 *           which wall to watch.
 *
 * `spawnSide: "random"` draws from the event's deterministic seed, so the
 * "randomness" is fixed by the pattern, not by the run.
 */

import { BaseMechanic, type MechanicPhase, type MechanicSpawnContext, type MechanicUpdate } from '../../core/Mechanic';
import type { Shape } from '../../core/geometry';
import { clamp, makeRng } from '../../core/geometry';
import { scaleCount, scaleSpeed } from '../../core/Intensity';
import { TUNING } from '../../tuning';
import { slowed } from './arenaTiming';
import type { Renderer } from '../../core/Renderer';
import { bulletHitCircles, drawBullet, drawBulletOutline, readShape, type BulletShape } from './bullets';

type Side = 'LEFT' | 'RIGHT' | 'TOP' | 'BOTTOM';
const SIDES: Side[] = ['LEFT', 'RIGHT', 'TOP', 'BOTTOM'];

/** One shot in a volley, before the constructor turns it into world positions. */
interface Shot {
  side: Side;
  /** 0..1 position along the spawn edge. */
  lane: number;
  /**
   * Lateral drift per unit of travel, in field units.
   *
   * A fan arm is not aimed *from* a point on the wall, it is aimed *at* one: the
   * arms all start at the same lane and separate as they travel. Modelling it as
   * drift rather than as a rotated heading keeps the crossing axis-aligned,
   * which is what the rest of the mode assumes.
   */
  drift: number;
  /** Beats after the activation beat that this shot leaves the wall. */
  fireOffset: number;
}

interface Projectile extends Shot {
  radius: number;
  fireBeat: number;
  x: number;
  y: number;
}

/** Cap a spread volley so a high-intensity section stays dodgeable. */
const MAX_COUNT = 4;
/** Cap a stream so a fast subdivision cannot tile the whole arena. */
const MAX_STREAM = 8;

/**
 * Centre-to-centre spacing of a wall.
 *
 * Derived rather than written down: the player fits between two projectiles
 * exactly when the spacing exceeds both radii plus both of theirs, so shrinking
 * the avatar must shrink this too. The 0.92 keeps a margin so a wall is a wall.
 */
function wallSpacing(radius: number): number {
  return (radius + TUNING.arena.playerRadius) * 2 * 0.92;
}

export class ProjectileMechanic extends BaseMechanic {
  override readonly damageSource = 'PROJECTILE' as const;

  private readonly projectiles: Projectile[];
  /** Beats required to cross the field, after intensity and tier scaling. */
  private readonly crossBeats: number;
  private readonly bulletShape: BulletShape;

  constructor(spawn: MechanicSpawnContext) {
    // Slowing the flight without slowing the ACTIVE window would leave the
    // projectile mid-arena and harmless.
    super(slowed(spawn));

    const speed = scaleSpeed(numberOr(this.params.speed, 1), this.intensity);
    // durationBeats is the library's "time to cross at speed 1" -- and after
    // `slowed()` it is that, slowed, which is exactly what the tier intends.
    this.crossBeats = Math.max(0.25, this.timing.durationBeats / Math.max(0.25, speed));

    // Edge bullets are the smaller family: they arrive from off-screen with no
    // silhouette of their own until they cross the wall, so they get a pointed
    // shape rather than bulk. See bullets.ts.
    const radius = clamp(
      numberOr(this.params.radius, TUNING.arena.edgeProjectileRadius),
      0.006, 0.028,
    );
    this.bulletShape = readShape(this.params.shape, 'DIAMOND');

    const shots = planVolley(spawn, this.seed, radius, this.tier.gapScale);

    // Fire offsets are authored in the *unslowed* beat grid, so they are
    // stretched by the same factor `slowed()` applied to the window. Without
    // that, an EASY section would fire its stream at the original tempo while
    // each shot crawled across, and the formation would pile up at the wall.
    const stretch = this.timing.durationBeats / Math.max(0.01, spawn.timing.durationBeats);
    this.projectiles = shots.map((s) => ({
      ...s,
      radius,
      fireBeat: this.activationBeat + s.fireOffset * stretch,
      x: 0,
      y: 0,
    }));

    // A staggered formation keeps firing after activation, so the window has to
    // cover the last shot plus that shot's own crossing time.
    const lastOffset = this.projectiles.reduce((max, p) => Math.max(max, p.fireBeat - this.activationBeat), 0);
    const span = lastOffset + this.crossBeats;
    if (span > this.timing.durationBeats) {
      (this.timing as { durationBeats: number }).durationBeats = span;
    }

    this.positionAt(this.activationBeat);
  }

  protected override onUpdate(u: MechanicUpdate): void {
    this.positionAt(u.beat);
  }

  /** Travel progress: -radius (off-field) at fire time, 1+radius when spent. */
  private positionAt(beat: number): void {
    for (const p of this.projectiles) {
      const t = clamp((beat - p.fireBeat) / this.crossBeats, 0, 1);
      const travel = -p.radius + t * (1 + p.radius * 2);
      // Drift accumulates with travel, so a fan arm is straight, not curved.
      const lane = clamp(p.lane + p.drift * t, -0.5, 1.5);
      switch (p.side) {
        case 'LEFT': p.x = travel; p.y = lane; break;
        case 'RIGHT': p.x = 1 - travel; p.y = lane; break;
        case 'TOP': p.x = lane; p.y = travel; break;
        case 'BOTTOM': p.x = lane; p.y = 1 - travel; break;
      }
    }
  }

  protected override onPhaseChange(_from: MechanicPhase, to: MechanicPhase): void {
    if (to === 'TELEGRAPH') {
      this.feel.sfx('projectile_charge', 0.6);
      return;
    }
    if (to !== 'ACTIVE') return;
    this.feel.sfx('projectile_fire');
    // A muzzle flash per projectile that leaves on the activation beat.
    for (const p of this.projectiles) {
      if (p.fireBeat > this.activationBeat + 1e-9) continue;
      const dir = directionOf(p.side);
      this.feel.emit(p.x, p.y, {
        count: 3, speed: 0.5, colour: '#ffd479', size: 0.006, shape: 'spark', life: 0.25,
        direction: Math.atan2(dir.y, dir.x), spread: Math.PI * 0.4,
      });
    }
    this.feel.impact('LIGHT', {
      x: this.projectiles[0]?.x ?? 0.5, y: this.projectiles[0]?.y ?? 0.5,
      shockwave: false, particles: false,
    });
  }

  protected dangerShapes(): Shape[] {
    const beat = this.spawn.clock.absoluteBeat;
    const shapes: Shape[] = [];
    for (const p of this.projectiles) {
      // A staggered shot that has not left the wall yet is not a hazard.
      if (beat < p.fireBeat - 1e-9) continue;
      const dir = directionOf(p.side);
      const angle = Math.atan2(dir.y, dir.x);
      for (const c of bulletHitCircles(this.bulletShape, p.x, p.y, p.radius, angle)) {
        shapes.push({ kind: 'circle' as const, ...c });
      }
    }
    return shapes;
  }

  render(r: Renderer): void {
    const beat = this.spawn.clock.visualBeat;
    if (this.phase === 'TELEGRAPH') {
      const p = this.telegraphProgress(beat);
      for (const proj of this.projectiles) this.renderTelegraph(r, proj, p);
      return;
    }
    if (this.phase !== 'ACTIVE') return;

    for (const proj of this.projectiles) {
      if (beat < proj.fireBeat) continue;
      const dir = directionOf(proj.side);
      const angle = Math.atan2(dir.y, dir.x);
      // Short motion trail pointing back along the travel direction.
      r.line(
        proj.x - dir.x * proj.radius * 3.5,
        proj.y - dir.y * proj.radius * 3.5,
        proj.x, proj.y,
        '#ff8a3d', 2, 0.4,
      );
      drawBullet(r, {
        x: proj.x,
        y: proj.y,
        radius: proj.radius,
        shape: this.bulletShape,
        angle,
        colour: '#ffc98a',
        edge: '#ff7a2d',
      });
    }
  }

  /**
   * Where the volley will come from, and how many shots there are.
   *
   * The whole point of an edge emitter is that the threat arrives from a wall,
   * so the warning is drawn *on the wall*: a muzzle mark per shot and a dashed
   * flight line that grows toward the player as the beat approaches. A staggered
   * formation shows every muzzle at once -- the player should be able to count
   * the shots before the first one leaves.
   */
  private renderTelegraph(r: Renderer, proj: Projectile, progress: number): void {
    const dir = directionOf(proj.side);
    const angle = Math.atan2(dir.y, dir.x);
    const horizontal = proj.side === 'LEFT' || proj.side === 'RIGHT';
    const originX = proj.side === 'RIGHT' ? 1 : proj.side === 'LEFT' ? 0 : proj.lane;
    const originY = proj.side === 'BOTTOM' ? 1 : proj.side === 'TOP' ? 0 : proj.lane;
    const reach = 0.18 + 0.4 * progress;
    r.line(
      originX, originY,
      originX + dir.x * reach + (horizontal ? 0 : proj.drift * 0.5 * progress),
      originY + dir.y * reach + (horizontal ? proj.drift * 0.5 * progress : 0),
      '#ff8a3d', 2, 0.12 + 0.2 * progress,
    );
    drawBulletOutline(r, {
      x: originX + dir.x * 0.012,
      y: originY + dir.y * 0.012,
      radius: proj.radius * (0.6 + 0.4 * progress),
      shape: this.bulletShape,
      angle,
      colour: '#ffb35c',
      edge: '#ffb35c',
      alpha: 0.4 + 0.5 * progress,
    });
  }
}

// ---- formations ----------------------------------------------------------

/**
 * Turn the event's params into a list of shots, before any timing is resolved.
 *
 * Pure, and deliberately separate from the class: a formation is a *shape*, and
 * the same shape has to be buildable at construction time to know how long the
 * ACTIVE window must be. Keeping it out here means the arithmetic can be read
 * without the lifecycle in the way.
 */
function planVolley(spawn: MechanicSpawnContext, seed: number, radius: number, gapScale: number): Shot[] {
  const rng = makeRng(seed);
  const configured = String(spawn.params.spawnSide ?? 'random').toUpperCase();
  const pickSide = (): Side =>
    SIDES.includes(configured as Side) ? (configured as Side) : SIDES[Math.floor(rng() * SIDES.length)];

  switch (String(spawn.params.formation ?? 'spread').toLowerCase()) {
    case 'wall': return buildWall(spawn, rng, pickSide(), radius, gapScale);
    case 'stream': return buildStream(spawn, rng, pickSide(), radius);
    case 'fan': return buildFan(spawn, rng, pickSide());
    default: return buildSpread(spawn, rng, pickSide());
  }
}

function buildSpread(spawn: MechanicSpawnContext, rng: () => number, side: Side): Shot[] {
  const baseCount = numberOr(spawn.params.count, 1);
  const count = clamp(scaleCount(baseCount, spawn.intensity, MAX_COUNT), 1, MAX_COUNT);
  const explicitLanes = Array.isArray(spawn.params.lanes) ? spawn.params.lanes.map(Number) : null;

  const out: Shot[] = [];
  for (let i = 0; i < count; i++) {
    // Spread lanes evenly, nudged by the deterministic rng, keeping clear of edges.
    const lane = explicitLanes?.[i] ?? clamp((i + 0.5) / count + (rng() - 0.5) * (0.5 / count), 0.08, 0.92);
    out.push({ side, lane, drift: 0, fireOffset: 0 });
  }
  return out;
}

/**
 * A barrier across one edge with a few openings.
 *
 * Gaps are spread evenly (with deterministic jitter) rather than placed at
 * random, so the nearest opening is always within reach of the telegraph -- the
 * volley demands a read, not a sprint.
 */
function buildWall(
  spawn: MechanicSpawnContext,
  rng: () => number,
  side: Side,
  radius: number,
  gapScale: number,
): Shot[] {
  const gaps = clamp(Math.round(numberOr(spawn.params.gaps, 2)), 1, 4);
  const spacing = wallSpacing(radius);
  const gapCentres: number[] = [];
  for (let i = 0; i < gaps; i++) {
    gapCentres.push(clamp((i + 0.5) / gaps + (rng() - 0.5) * (0.6 / gaps), 0.12, 0.88));
  }

  // Tile the edge exactly: `count` lanes at (i + 0.5) / count. Stepping from
  // spacing / 2 upward instead would stop short of the far edge and leave a band
  // along it -- measured at 0.07 wide, which is wider than the player, so the
  // corner was safe from every wall forever.
  const count = Math.max(2, Math.round(1 / spacing));
  const out: Shot[] = [];
  for (let i = 0; i < count; i++) {
    const lane = (i + 0.5) / count;
    // Drop the projectiles nearest each gap centre; the survivors on either side
    // are then far enough apart for the player to pass between them. Easier
    // tiers widen the openings rather than removing projectiles.
    if (gapCentres.some((g) => Math.abs(lane - g) < spacing * 0.85 * gapScale)) continue;
    out.push({ side, lane, drift: 0, fireOffset: 0 });
  }
  return out;
}

/**
 * One lane, fired repeatedly on a subdivision.
 *
 * Reads as a moving line rather than as a volley: the player walks *alongside*
 * it, keeping pace, instead of timing a dash through a gap. The subdivision is
 * floored at a quarter beat so the line stays a line rather than becoming a
 * solid wall with no gap in it at all.
 */
function buildStream(spawn: MechanicSpawnContext, rng: () => number, side: Side, radius: number): Shot[] {
  void radius;
  const spacing = clamp(numberOr(spawn.params.spacing, 0.5), 0.25, 2);
  const count = clamp(scaleCount(numberOr(spawn.params.count, 4), spawn.intensity, MAX_STREAM), 2, MAX_STREAM);
  const lanes = Array.isArray(spawn.params.lanes) ? spawn.params.lanes.map(Number) : null;
  const explicit = lanes?.[0];
  const lane = clamp(
    typeof explicit === 'number' && Number.isFinite(explicit) ? explicit : 0.25 + rng() * 0.5,
    0.08, 0.92,
  );
  return Array.from({ length: count }, (_, i) => ({
    side, lane, drift: 0, fireOffset: i * spacing,
  }));
}

/**
 * Several arms out of one point on the wall.
 *
 * The arms all start at the same lane and separate as they travel, so the origin
 * is a single readable spot and the safe space is the wedge between two arms.
 * `spreadDeg` is the half-width, and the drift is capped so the outermost arm
 * cannot leave the arena before the player has had a chance to read it.
 */
function buildFan(spawn: MechanicSpawnContext, rng: () => number, side: Side): Shot[] {
  const count = clamp(Math.round(numberOr(spawn.params.count, 3)), 2, 5);
  const spread = clamp(numberOr(spawn.params.spreadDeg, 30), 10, 70) * (Math.PI / 180);
  const lane = clamp(0.2 + rng() * 0.6, 0.15, 0.85);
  const out: Shot[] = [];
  for (let i = 0; i < count; i++) {
    const u = i / (count - 1) - 0.5;
    // Aim at a lane offset rather than rotating a heading: the bullet still
    // crosses axis-aligned, it just slides sideways while it does.
    const drift = clamp(Math.tan(spread * u * 2) * 0.5, -0.9, 0.9);
    out.push({ side, lane, drift, fireOffset: 0 });
  }
  return out;
}

function directionOf(side: Side): { x: number; y: number } {
  switch (side) {
    case 'LEFT': return { x: 1, y: 0 };
    case 'RIGHT': return { x: -1, y: 0 };
    case 'TOP': return { x: 0, y: 1 };
    case 'BOTTOM': return { x: 0, y: -1 };
  }
}

function numberOr(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/**
 * A03 -- Projectile (ARENA).
 *
 * Spawns one or more projectiles from a side and crosses the field. Motion is
 * a pure function of the current beat (`position = f(beat)`), so playback is
 * frame-rate independent and deterministic: the same level replays identically.
 *
 * Params:
 *   spawnSide  "LEFT" | "RIGHT" | "TOP" | "BOTTOM" | "random"   default "random"
 *   formation  "spread" | "wall"                                 default "spread"
 *   count      projectiles in this volley (spread only)          default 1
 *   speed      crossing-speed multiplier                         default 1.0
 *   radius     projectile radius in field units                  default 0.03
 *   gaps       openings in a wall                                default 2
 *   lanes      optional explicit 0..1 lateral positions
 *
 * Two formations:
 *
 *   spread  a few projectiles on scattered lanes. Cheap and readable, but a
 *           handful of thin projectiles leaves most of the field untouched, so
 *           a volley alone cannot force the player to move.
 *   wall    projectiles tile the spawn edge except for a small number of
 *           openings. The player has to find a gap and get to it, which is the
 *           formation to reach for when a section must not be campable.
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

type Side = 'LEFT' | 'RIGHT' | 'TOP' | 'BOTTOM';
const SIDES: Side[] = ['LEFT', 'RIGHT', 'TOP', 'BOTTOM'];

interface Projectile {
  side: Side;
  /** 0..1 position along the spawn edge. */
  lane: number;
  radius: number;
  x: number;
  y: number;
}

/** Cap a spread volley so a high-intensity section stays dodgeable. */
const MAX_COUNT = 4;
const DEFAULT_RADIUS = 0.03;
/**
 * Centre-to-centre spacing of a wall.
 *
 * Derived rather than written down: the player fits between two projectiles
 * exactly when the spacing exceeds both radii plus both of theirs, so shrinking
 * the avatar must shrink this too. The 0.92 keeps a margin so a wall is a wall.
 */
const WALL_SPACING = (DEFAULT_RADIUS + TUNING.arena.playerRadius) * 2 * 0.92;

export class ProjectileMechanic extends BaseMechanic {
  override readonly damageSource = 'PROJECTILE' as const;

  private readonly projectiles: Projectile[];
  /** Beats required to cross the field, after intensity scaling. */
  private readonly crossBeats: number;

  constructor(spawn: MechanicSpawnContext) {
    // Slowing the flight without slowing the ACTIVE window would leave the
    // projectile mid-arena and harmless.
    super(slowed(spawn));
    const rng = makeRng(this.seed);

    const speed = scaleSpeed(numberOr(this.params.speed, 1), this.intensity);
    // durationBeats is the library's "time to cross at speed 1".
    this.crossBeats = Math.max(0.25, this.timing.durationBeats / Math.max(0.25, speed));

    const radius = numberOr(this.params.radius, DEFAULT_RADIUS);
    const configuredSide = String(this.params.spawnSide ?? 'random').toUpperCase();
    const pickSide = (): Side =>
      SIDES.includes(configuredSide as Side)
        ? (configuredSide as Side)
        : SIDES[Math.floor(rng() * SIDES.length)];

    this.projectiles = String(this.params.formation ?? 'spread').toLowerCase() === 'wall'
      ? this.buildWall(rng, pickSide(), radius)
      : this.buildSpread(rng, pickSide, radius);

    this.positionAt(this.activationBeat);
  }

  private buildSpread(rng: () => number, pickSide: () => Side, radius: number): Projectile[] {
    const baseCount = numberOr(this.params.count, 1);
    const count = clamp(scaleCount(baseCount, this.intensity, MAX_COUNT), 1, MAX_COUNT);
    const explicitLanes = Array.isArray(this.params.lanes) ? this.params.lanes.map(Number) : null;

    const out: Projectile[] = [];
    for (let i = 0; i < count; i++) {
      // Spread lanes evenly, nudged by the deterministic rng, keeping clear of edges.
      const lane = explicitLanes?.[i] ?? clamp((i + 0.5) / count + (rng() - 0.5) * (0.5 / count), 0.08, 0.92);
      out.push({ side: pickSide(), lane, radius, x: 0, y: 0 });
    }
    return out;
  }

  /**
   * A barrier across one edge with a few openings.
   *
   * Gaps are spread evenly (with deterministic jitter) rather than placed at
   * random, so the nearest opening is always within reach of the telegraph --
   * the volley demands a read, not a sprint.
   */
  private buildWall(rng: () => number, side: Side, radius: number): Projectile[] {
    const gaps = clamp(Math.round(numberOr(this.params.gaps, 2)), 1, 4);
    // Easier tiers widen the openings rather than removing projectiles.
    const gapScale = this.tier.gapScale;
    const gapCentres: number[] = [];
    for (let i = 0; i < gaps; i++) {
      gapCentres.push(clamp((i + 0.5) / gaps + (rng() - 0.5) * (0.6 / gaps), 0.12, 0.88));
    }

    const out: Projectile[] = [];
    for (let lane = WALL_SPACING / 2; lane < 1; lane += WALL_SPACING) {
      // Drop the projectiles nearest each gap centre; the survivors on either
      // side are then far enough apart for the player to pass between them.
      if (gapCentres.some((g) => Math.abs(lane - g) < WALL_SPACING * 0.85 * gapScale)) continue;
      out.push({ side, lane, radius, x: 0, y: 0 });
    }
    return out;
  }

  protected override onUpdate(u: MechanicUpdate): void {
    this.positionAt(u.beat);
  }

  /** Travel progress: -margin (off-field) at activation, 1+margin when spent. */
  private positionAt(beat: number): void {
    const t = clamp((beat - this.activationBeat) / this.crossBeats, 0, 1);
    for (const p of this.projectiles) {
      const travel = -p.radius + t * (1 + p.radius * 2);
      switch (p.side) {
        case 'LEFT': p.x = travel; p.y = p.lane; break;
        case 'RIGHT': p.x = 1 - travel; p.y = p.lane; break;
        case 'TOP': p.x = p.lane; p.y = travel; break;
        case 'BOTTOM': p.x = p.lane; p.y = 1 - travel; break;
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
    // A muzzle flash per projectile, pushed along its travel direction.
    for (const p of this.projectiles) {
      const dir = directionOf(p.side);
      this.feel.emit(p.x, p.y, {
        count: 3, speed: 0.5, colour: '#ffd479', size: 0.006, shape: 'spark', life: 0.25,
        direction: Math.atan2(dir.y, dir.x), spread: Math.PI * 0.4,
      });
    }
    this.feel.impact('LIGHT', { x: this.projectiles[0]?.x ?? 0.5, y: this.projectiles[0]?.y ?? 0.5, shockwave: false, particles: false });
  }

  protected dangerShapes(): Shape[] {
    return this.projectiles.map((p) => ({ kind: 'circle' as const, x: p.x, y: p.y, r: p.radius }));
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
      // Short motion trail pointing back along the travel direction.
      const dir = directionOf(proj.side);
      r.line(
        proj.x - dir.x * proj.radius * 3,
        proj.y - dir.y * proj.radius * 3,
        proj.x, proj.y,
        '#ffb35c', 3, 0.45,
      );
      r.fillCircle(proj.x, proj.y, proj.radius, '#ffd479');
      r.strokeCircle(proj.x, proj.y, proj.radius + 0.006, '#ff8a3d', 2, 0.8);
    }
  }

  private renderTelegraph(r: Renderer, proj: Projectile, progress: number): void {
    const dir = directionOf(proj.side);
    const originX = proj.side === 'RIGHT' ? 1 : proj.side === 'LEFT' ? 0 : proj.lane;
    const originY = proj.side === 'BOTTOM' ? 1 : proj.side === 'TOP' ? 0 : proj.lane;
    // Dashed flight line + a marker growing at the muzzle.
    r.line(originX, originY, originX + dir.x, originY + dir.y, '#ff8a3d', 2, 0.12 + 0.2 * progress);
    r.fillCircle(
      originX + dir.x * 0.02,
      originY + dir.y * 0.02,
      proj.radius * (0.4 + 0.6 * progress),
      '#ff8a3d',
      0.35 + 0.5 * progress,
    );
  }
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

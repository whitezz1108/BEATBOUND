/**
 * A03 -- Projectile (ARENA).
 *
 * Spawns one or more projectiles from a side and crosses the field. Motion is
 * a pure function of the current beat (`position = f(beat)`), so playback is
 * frame-rate independent and deterministic: the same level replays identically.
 *
 * Params:
 *   spawnSide  "LEFT" | "RIGHT" | "TOP" | "BOTTOM" | "random"   default "random"
 *   count      projectiles in this volley                        default 1
 *   speed      crossing-speed multiplier                         default 1.0
 *   radius     projectile radius in field units                  default 0.028
 *   lanes      optional explicit 0..1 lateral positions
 *
 * `spawnSide: "random"` draws from the event's deterministic seed, so the
 * "randomness" is fixed by the pattern, not by the run.
 */

import { BaseMechanic, type MechanicSpawnContext, type MechanicUpdate } from '../../core/Mechanic';
import type { Shape } from '../../core/geometry';
import { clamp, makeRng } from '../../core/geometry';
import { scaleCount, scaleSpeed } from '../../core/Intensity';
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

/** Cap the volley so a high-intensity section stays dodgeable. */
const MAX_COUNT = 4;

export class ProjectileMechanic extends BaseMechanic {
  private readonly projectiles: Projectile[];
  /** Beats required to cross the field, after intensity scaling. */
  private readonly crossBeats: number;

  constructor(spawn: MechanicSpawnContext) {
    super(spawn);
    const rng = makeRng(this.seed);

    const baseCount = numberOr(this.params.count, 1);
    const count = clamp(scaleCount(baseCount, this.intensity, MAX_COUNT), 1, MAX_COUNT);

    const speed = scaleSpeed(numberOr(this.params.speed, 1), this.intensity);
    // durationBeats is the library's "time to cross at speed 1".
    this.crossBeats = Math.max(0.25, this.timing.durationBeats / Math.max(0.25, speed));

    const radius = numberOr(this.params.radius, 0.028);
    const explicitLanes = Array.isArray(this.params.lanes) ? this.params.lanes.map(Number) : null;
    const configuredSide = String(this.params.spawnSide ?? 'random').toUpperCase();

    this.projectiles = [];
    for (let i = 0; i < count; i++) {
      const side: Side = SIDES.includes(configuredSide as Side)
        ? (configuredSide as Side)
        : SIDES[Math.floor(rng() * SIDES.length)];
      // Spread lanes evenly, nudged by the deterministic rng, keeping clear of edges.
      const lane = explicitLanes?.[i] ?? clamp((i + 0.5) / count + (rng() - 0.5) * (0.5 / count), 0.08, 0.92);
      this.projectiles.push({ side, lane, radius, x: 0, y: 0 });
    }
    this.positionAt(this.activationBeat);
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

  protected dangerShapes(): Shape[] {
    return this.projectiles.map((p) => ({ kind: 'circle' as const, x: p.x, y: p.y, r: p.radius }));
  }

  render(r: Renderer): void {
    const beat = this.spawn.clock.absoluteBeat;
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

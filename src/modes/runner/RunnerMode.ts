/**
 * RUNNER -- side-scrolling rhythm platforming.
 *
 * The player is pinned at a fixed x while the track scrolls past, so an
 * obstacle scheduled on a beat arrives exactly on that beat. Jump and slide are
 * the whole vocabulary; the mode resolves them against generic hazard shapes
 * plus the RunnerTerrain capability (gaps, pads, gravity), never against
 * specific mechanic ids.
 */

import { hasTerrain } from '../../core/capabilities';
import { circleIntersectsShape, type Circle } from '../../core/geometry';
import type { MechanicUpdate, RuntimeMechanic } from '../../core/Mechanic';
import type { Renderer } from '../../core/Renderer';
import type { SpawnedMechanicInfo } from '../../core/PatternScheduler';
import type { GameMode } from '../../core/types';
import { GROUND_Y, PLAYER_X } from '../../mechanics/runner/runnerGeometry';
import type { GameplayMode, ModeContext } from '../GameplayMode';
import { RunnerPlayer } from './RunnerPlayer';

const JUMP_KEYS = ['w', 'arrowup', ' '];
const SLIDE_KEYS = ['s', 'arrowdown'];

export class RunnerMode implements GameplayMode {
  readonly mode: GameMode = 'RUNNER';
  readonly player = new RunnerPlayer();
  private mechanics: RuntimeMechanic[] = [];
  private lastHitBeat = -Infinity;
  private lastPatternId = '-';

  constructor(private readonly ctx: ModeContext) {}

  activate(_atBeat: number): void {
    this.player.reset();
    this.mechanics = [];
  }

  deactivate(_atBeat: number): void {
    this.mechanics = [];
  }

  accept(info: SpawnedMechanicInfo): void {
    this.mechanics.push(info.mechanic);
    this.lastPatternId = info.patternId;
  }

  update(u: MechanicUpdate): void {
    for (const m of this.mechanics) m.update(u);

    const gravityDirection = this.currentGravityDirection();
    const hasFloor = !this.isOverGap();

    this.player.update(
      u.deltaSeconds,
      u.secondsPerBeat,
      {
        jump: this.ctx.input.wasPressed(...JUMP_KEYS),
        slide: this.ctx.input.isDown(...SLIDE_KEYS),
      },
      gravityDirection,
      hasFloor,
    );

    this.applyBouncePads(u.secondsPerBeat);
    this.resolveCollisions(u.beat);

    if (this.mechanics.some((m) => m.isFinished)) {
      this.mechanics = this.mechanics.filter((m) => !m.isFinished);
    }
  }

  /** Last active gravity mechanic wins; absent any, gravity is normal. */
  private currentGravityDirection(): number {
    for (const m of this.mechanics) {
      if (!hasTerrain(m)) continue;
      const scale = m.gravityScale?.() ?? null;
      if (scale !== null && scale !== 0) return Math.sign(scale);
    }
    return 1;
  }

  private isOverGap(): boolean {
    for (const m of this.mechanics) {
      if (!hasTerrain(m)) continue;
      const gap = m.groundGap?.() ?? null;
      if (gap && PLAYER_X > gap.x0 && PLAYER_X < gap.x1) return true;
    }
    return false;
  }

  private applyBouncePads(secondsPerBeat: number): void {
    if (!this.player.isGrounded && this.player.height > 0.02) return;
    const body = this.player.body;
    for (const m of this.mechanics) {
      if (!hasTerrain(m)) continue;
      const pad = m.bouncePad?.() ?? null;
      if (!pad) continue;
      const overlapsX = body.x < pad.rect.x + pad.rect.w && body.x + body.w > pad.rect.x;
      if (overlapsX) {
        this.player.launch(secondsPerBeat, pad.strength);
        return;
      }
    }
  }

  private resolveCollisions(beat: number): void {
    // Falling out of the world counts as a hit, same as touching a spike.
    if (this.player.hasFallenOut) {
      if (this.ctx.status.registerHit(beat)) {
        this.lastHitBeat = beat;
        this.player.reset();
      }
      return;
    }

    const body = this.player.body;
    // Approximate the body with a circle so it reuses the shared shape tests.
    const probe: Circle = {
      x: body.x + body.w / 2,
      y: body.y + body.h / 2,
      r: Math.min(body.w, body.h) / 2,
    };
    for (const m of this.mechanics) {
      for (const shape of m.hazards()) {
        if (!circleIntersectsShape(probe, shape)) continue;
        if (this.ctx.status.registerHit(beat)) this.lastHitBeat = beat;
        return;
      }
    }
  }

  render(r: Renderer): void {
    const beat = this.ctx.clock.absoluteBeat;
    const flipped = this.player.gravityDirection < 0;
    r.fillRect({ x: 0, y: 0, w: 1, h: 1 }, flipped ? '#0d0a18' : '#0b0f18');

    r.withFieldClip(() => {
      this.renderTrack(r, beat);
      for (const m of this.mechanics) m.render(r);
      this.player.render(r, this.ctx.status.isInvulnerable(beat), beat);
      const since = beat - this.lastHitBeat;
      if (since >= 0 && since <= 0.5) {
        r.fillRect({ x: 0, y: 0, w: 1, h: 1 }, '#ff3355', 0.35 * (1 - since / 0.5));
      }
    });
  }

  private renderTrack(r: Renderer, beat: number): void {
    // Ground and ceiling, so a gravity flip has somewhere to land.
    r.fillRect({ x: 0, y: GROUND_Y, w: 1, h: 1 - GROUND_Y }, '#141b29');
    r.line(0, GROUND_Y, 1, GROUND_Y, '#2b3750', 2, 0.9);
    r.fillRect({ x: 0, y: 0, w: 1, h: 1 - GROUND_Y }, '#10151f', 0.6);
    r.line(0, 1 - GROUND_Y, 1, 1 - GROUND_Y, '#2b3750', 2, 0.35);

    // Beat ticks scrolling with the track: a visible metronome on the floor.
    const beatsPerBar = this.ctx.clock.beatsPerBar;
    for (let i = -1; i < 8; i++) {
      const tickBeat = Math.floor(beat) + i;
      const x = PLAYER_X + (tickBeat - beat) * 0.2;
      if (x < -0.05 || x > 1.05) continue;
      const downbeat = ((tickBeat % beatsPerBar) + beatsPerBar) % beatsPerBar === 0;
      r.line(x, GROUND_Y, x, GROUND_Y + (downbeat ? 0.05 : 0.025), '#3a4763', downbeat ? 2 : 1, 0.7);
    }

    // The lane the player occupies, so timing reads clearly.
    r.line(PLAYER_X, 0, PLAYER_X, 1, '#6de3ff', 1, 0.15);
  }

  get activeMechanicCount(): number {
    return this.mechanics.length;
  }

  get statusLine(): string {
    const g = this.player.gravityDirection < 0 ? ' gravity:FLIPPED' : '';
    return `RUNNER  obstacles:${this.mechanics.length}  last pattern:${this.lastPatternId}${g}`;
  }
}

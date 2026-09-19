/**
 * RUNNER -- fast auto-running rhythm platforming.
 *
 * The player is pinned at a fixed x while the track scrolls past, so an
 * obstacle scheduled on a beat arrives exactly on that beat. Jump and slide are
 * the whole vocabulary; the mode resolves them against generic hazard shapes
 * plus the RunnerTerrain capability (gaps, pads, gravity), never against
 * specific mechanic ids.
 *
 * The presentation exists to sell speed and to keep the *running surface*
 * obvious at all times -- especially through a gravity inversion, where the
 * player needs to know within a frame which way is down.
 */

import { hasTerrain } from '../../core/capabilities';
import { circleIntersectsShape, clamp, type Circle } from '../../core/geometry';
import type { MechanicUpdate, RuntimeMechanic } from '../../core/Mechanic';
import type { Renderer } from '../../core/Renderer';
import type { SpawnedMechanicInfo } from '../../core/PatternScheduler';
import type { GameMode } from '../../core/types';
import { CEILING_Y, GROUND_Y, PLAYER_X, UNITS_PER_BEAT } from '../../mechanics/runner/runnerGeometry';
import { surfaceForGravity, surfaceOf } from '../../mechanics/runner/surface';
import { TUNING } from '../../tuning';
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
  private gravityDirection = 1;
  private jumps = 0;

  constructor(private readonly ctx: ModeContext) {}

  activate(_atBeat: number): void {
    this.player.reset();
    this.mechanics = [];
    this.gravityDirection = 1;
  }

  deactivate(_atBeat: number): void {
    this.mechanics = [];
  }

  clearHazards(): void {
    this.mechanics = [];
  }

  accept(info: SpawnedMechanicInfo): void {
    this.mechanics.push(info.mechanic);
    this.lastPatternId = info.patternId;
  }

  update(u: MechanicUpdate): void {
    for (const m of this.mechanics) m.update(u);

    const nextGravity = this.currentGravityDirection();
    if (nextGravity !== this.gravityDirection) {
      // The flip itself is the event, not the zone: one heavy cue, no pause.
      const body = this.player.body;
      this.ctx.feel.impact('HEAVY', {
        x: body.x + body.w / 2, y: body.y + body.h / 2,
        dirX: 0, dirY: nextGravity > 0 ? 1 : -1,
        colour: '#c9bcff', sfx: 'gravity_flip',
      });
      this.ctx.feel.emit(body.x + body.w / 2, body.y + body.h / 2, {
        count: 22, speed: 1.1, colour: '#c9bcff', size: 0.009, shape: 'shard', life: 0.5,
      });
      this.gravityDirection = nextGravity;
    }

    const alive = this.ctx.status.outcome === 'PLAYING';
    const hasFloor = !this.isOverGap();
    const step = this.player.update(
      u.deltaSeconds,
      u.secondsPerBeat,
      {
        jumpPressed: alive && this.ctx.input.wasPressed(...JUMP_KEYS),
        jumpHeld: alive && this.ctx.input.isDown(...JUMP_KEYS),
        slide: alive && this.ctx.input.isDown(...SLIDE_KEYS),
      },
      this.gravityDirection,
      hasFloor,
    );

    if (step.jumped) {
      this.jumps += 1;
      this.ctx.feel.sfx('jump');
      const body = this.player.body;
      this.ctx.feel.emit(body.x + body.w / 2, body.y + body.h * (this.gravityDirection > 0 ? 1 : 0), {
        count: 5, speed: 0.4, colour: '#9fdcff', size: 0.005, life: 0.25, shape: 'dot',
        direction: this.gravityDirection > 0 ? Math.PI / 2 : -Math.PI / 2, spread: Math.PI * 0.7,
      });
    }
    if (step.landed) {
      this.ctx.feel.sfx('land');
      this.ctx.feel.impact('LIGHT', { shockwave: false, particles: false });
      const body = this.player.body;
      this.ctx.feel.emit(body.x + body.w / 2, this.player.surfaceY, {
        count: 7, speed: 0.55, colour: '#8aa0c9', size: 0.005, life: 0.3, shape: 'spark',
        direction: this.gravityDirection > 0 ? -Math.PI / 2 : Math.PI / 2, spread: Math.PI * 0.8,
      });
    }

    this.applyBouncePads(u.secondsPerBeat);
    if (alive) this.resolveCollisions(u);

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
    const surface = surfaceForGravity(this.gravityDirection);
    for (const m of this.mechanics) {
      if (!hasTerrain(m) || surfaceOf(m) !== surface) continue;
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
        this.ctx.feel.impact('MEDIUM', {
          x: pad.rect.x + pad.rect.w / 2, y: pad.rect.y,
          dirX: 0, dirY: -1, colour: '#4dffd0', sfx: 'bounce',
        });
        return;
      }
    }
  }

  private resolveCollisions(u: MechanicUpdate): void {
    const beat = u.beat;
    // Falling out of the world counts as a hit, same as touching a spike.
    if (this.player.hasFallenOut) {
      if (this.ctx.status.damage('OBSTACLE', u.songTime)) {
        this.lastHitBeat = beat;
        this.ctx.feel.playerHit(PLAYER_X, this.player.surfaceY);
        this.ctx.feel.sfx('runner_fail');
      }
      this.player.reset();
      return;
    }

    const body = this.player.body;
    // Approximate the body with a circle so it reuses the shared shape tests.
    const probe: Circle = {
      x: body.x + body.w / 2,
      y: body.y + body.h / 2,
      r: Math.min(body.w, body.h) / 2,
    };
    const surface = surfaceForGravity(this.gravityDirection);
    for (const m of this.mechanics) {
      // An obstacle on the surface the player is not attached to is scenery.
      if (surfaceOf(m) !== surface) continue;
      for (const shape of m.hazards()) {
        if (!circleIntersectsShape(probe, shape)) continue;
        if (this.ctx.status.damage(m.damageSource, u.songTime)) {
          this.lastHitBeat = beat;
          this.ctx.feel.playerHit(probe.x, probe.y, -1, 0);
        }
        return;
      }
    }
  }

  render(r: Renderer): void {
    const beat = this.ctx.clock.visualBeat;
    const flipped = this.gravityDirection < 0;
    r.fillRect({ x: 0, y: 0, w: 1, h: 1 }, flipped ? '#0d0a18' : '#0b0f18');

    r.withFieldClip(() => {
      this.renderParallax(r, beat);
      this.renderTrack(r, beat);
      for (const m of this.mechanics) m.render(r);
      this.renderSpeedStreaks(r, beat);
      this.player.render(r, this.ctx.status.isInvulnerable(this.ctx.clock.songTime), beat);
      const since = beat - this.lastHitBeat;
      if (since >= 0 && since <= 0.5) {
        r.fillRect({ x: 0, y: 0, w: 1, h: 1 }, '#ff3355', 0.25 * (1 - since / 0.5));
      }
    });
  }

  /** Layered background scrolling at fractions of track speed. */
  private renderParallax(r: Renderer, beat: number): void {
    const shades = ['#0e1524', '#121a2c', '#161f34'];
    TUNING.runner.parallax.forEach((factor, layer) => {
      const spacing = 0.34 - layer * 0.07;
      const offset = ((beat * UNITS_PER_BEAT * factor) % spacing + spacing) % spacing;
      const height = 0.1 + layer * 0.07;
      for (let x = -offset; x < 1.05; x += spacing) {
        const top = this.gravityDirection > 0 ? GROUND_Y - height : CEILING_Y;
        r.fillRect({ x, y: top, w: spacing * 0.45, h: height }, shades[layer], 0.55);
      }
    });
  }

  private renderTrack(r: Renderer, beat: number): void {
    const flipped = this.gravityDirection < 0;
    // The *live* surface is bright; the inactive one is a ghost. This is the
    // single most important read during a flip.
    const groundAlpha = flipped ? 0.3 : 1;
    const ceilingAlpha = flipped ? 1 : 0.3;

    r.fillRect({ x: 0, y: GROUND_Y, w: 1, h: 1 - GROUND_Y }, '#141b29', groundAlpha);
    r.line(0, GROUND_Y, 1, GROUND_Y, '#3f6fd8', flipped ? 1.5 : 3, groundAlpha);
    r.fillRect({ x: 0, y: 0, w: 1, h: CEILING_Y }, '#141b29', ceilingAlpha);
    r.line(0, CEILING_Y, 1, CEILING_Y, '#8a5fff', flipped ? 3 : 1.5, ceilingAlpha);

    // Beat ticks scrolling with the track: a visible metronome on the surface.
    const beatsPerBar = this.ctx.clock.beatsPerBar;
    const surface = this.gravityDirection > 0 ? GROUND_Y : CEILING_Y;
    const dir = this.gravityDirection > 0 ? 1 : -1;
    for (let i = -1; i < 10; i++) {
      const tickBeat = Math.floor(beat) + i;
      const x = PLAYER_X + (tickBeat - beat) * UNITS_PER_BEAT;
      if (x < -0.05 || x > 1.05) continue;
      const downbeat = ((tickBeat % beatsPerBar) + beatsPerBar) % beatsPerBar === 0;
      r.line(x, surface, x, surface + dir * (downbeat ? 0.055 : 0.028), '#4a5a80', downbeat ? 2 : 1, 0.8);
    }

    // The player's lane, so timing reads against a fixed reference.
    r.line(PLAYER_X, 0, PLAYER_X, 1, '#6de3ff', 1, 0.12);
  }

  /** Horizontal streaks behind the player while airborne -- pure speed cue. */
  private renderSpeedStreaks(r: Renderer, beat: number): void {
    const body = this.player.body;
    const cy = body.y + body.h / 2;
    for (let i = 0; i < 5; i++) {
      const phase = (beat * 3 + i * 0.37) % 1;
      const x = PLAYER_X - 0.04 - phase * 0.4;
      if (x < -0.05) continue;
      const y = clamp(cy + (i - 2) * 0.022, 0.02, 0.98);
      r.line(x, y, x + 0.05, y, '#6de3ff', 1, 0.14 * (1 - phase));
    }
  }

  get activeMechanicCount(): number {
    return this.mechanics.length;
  }

  get statusLine(): string {
    const g = this.gravityDirection < 0 ? ' gravity:CEILING' : ' gravity:FLOOR';
    return `RUNNER  obstacles:${this.mechanics.length}  jumps:${this.jumps}  last:${this.lastPatternId}${g}`;
  }
}

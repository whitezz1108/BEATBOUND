/**
 * ARENA -- top-down 2D dodge.
 *
 * The mode owns the field, the avatar and whichever mechanics are currently
 * alive. It runs collision generically against the `Shape`s mechanics expose,
 * so it never needs to know that A03 is a projectile or A05 is a chain.
 *
 * Spatial composition is deliberately readable: a square play area with a
 * circular guide ring, radial spokes and a centre marker, because most of the
 * pattern families are radial and the player has to be able to see CENTRE,
 * RADIUS and the current SAFE ARC at a glance.
 *
 * The *look* of all that now lives in ArenaStage (environment, board, rim) and
 * Avatar (the player sprite). The mode keeps only what is actually gameplay:
 * collision, the hit/perfect bookkeeping, and the two decaying pulses those
 * produce, which the stage turns into rim colour and the avatar into a blink.
 */

import { circleIntersectsShape } from '../../core/geometry';
import type { MechanicUpdate, RuntimeMechanic } from '../../core/Mechanic';
import type { Renderer } from '../../core/Renderer';
import type { SpawnedMechanicInfo } from '../../core/PatternScheduler';
import type { GameMode } from '../../core/types';
import { TUNING } from '../../tuning';
import type { GameplayMode, ModeContext } from '../GameplayMode';
import { ArenaPlayer } from './ArenaPlayer';
import { ArenaStage } from './ArenaStage';

/** How long the hit and perfect-dodge pulses take to fade, in beats. */
const HIT_PULSE_BEATS = 0.5;
const PERFECT_PULSE_BEATS = 0.7;

export class ArenaMode implements GameplayMode {
  readonly mode: GameMode = 'ARENA';
  readonly player = new ArenaPlayer();
  private readonly stage = new ArenaStage();
  private mechanics: RuntimeMechanic[] = [];
  private lastHitBeat = -Infinity;
  /** Debug label for the HUD: what pattern most recently fed this mode. */
  private lastPatternId = '-';

  /** Perfect-dodge tracking: were we inside the graze margin last frame? */
  private grazing = false;
  private grazeWasClean = true;
  private lastPerfectBeat = -Infinity;
  private perfects = 0;

  constructor(private readonly ctx: ModeContext) {}

  activate(_atBeat: number): void {
    this.player.reset();
    this.mechanics = [];
    this.grazing = false;
    this.lastHitBeat = -Infinity;
    this.lastPerfectBeat = -Infinity;
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
    // Death disables input but leaves the scene standing so the player can see
    // what killed them.
    if (this.ctx.status.outcome === 'PLAYING') {
      this.player.update(u.deltaSeconds, this.ctx.input.axis());
    }

    for (const m of this.mechanics) m.update(u);

    if (this.ctx.status.outcome === 'PLAYING') this.resolveCollisions(u);

    // Drop finished mechanics. Cheap because the list stays short.
    if (this.mechanics.some((m) => m.isFinished)) {
      this.mechanics = this.mechanics.filter((m) => !m.isFinished);
    }
  }

  private resolveCollisions(u: MechanicUpdate): void {
    const beat = u.beat;
    const body = this.player.circle;
    const margin = TUNING.arena.perfectDodgeMargin;
    const grazeBody = { ...body, r: body.r + margin };

    let hitBy: RuntimeMechanic | null = null;
    let graze = false;
    for (const m of this.mechanics) {
      for (const shape of m.hazards()) {
        if (circleIntersectsShape(body, shape)) {
          hitBy = m;
          break;
        }
        if (!graze && circleIntersectsShape(grazeBody, shape)) graze = true;
      }
      if (hitBy) break;
    }

    if (hitBy) {
      this.grazeWasClean = false;
      if (this.ctx.status.damage(hitBy.damageSource, u.songTime)) {
        this.lastHitBeat = beat;
        this.ctx.feel.playerHit(body.x, body.y);
      }
      this.grazing = graze;
      return;
    }

    // A graze that ends without a hit is a perfect dodge: the player was inside
    // the margin and got out. Rate-limited so a long brush is one award.
    if (graze && !this.grazing) this.grazeWasClean = true;
    if (!graze && this.grazing && this.grazeWasClean
        && beat - this.lastPerfectBeat > TUNING.arena.perfectDodgeCooldownBeats) {
      this.lastPerfectBeat = beat;
      this.perfects += 1;
      this.ctx.feel.perfectDodge(body.x, body.y);
    }
    this.grazing = graze;
  }

  render(r: Renderer): void {
    const beat = this.ctx.clock.visualBeat;
    // The stage is deliberately *not* clipped to the field: the environment is
    // the letterbox, and clipping it would leave the arena floating on whatever
    // the previous layer painted.
    this.stage.render(r, {
      beat,
      beatsPerBar: this.ctx.clock.beatsPerBar,
      hitPulse: decay(beat - this.lastHitBeat, HIT_PULSE_BEATS),
      perfectPulse: decay(beat - this.lastPerfectBeat, PERFECT_PULSE_BEATS),
    });
    r.withFieldClip(() => {
      for (const m of this.mechanics) m.render(r);
      this.player.render(r, this.ctx.status.isInvulnerable(this.ctx.clock.songTime), beat);
      this.renderHitFlash(r, beat);
      this.renderPerfectLabel(r, beat);
    });
  }

  private renderHitFlash(r: Renderer, beat: number): void {
    const since = beat - this.lastHitBeat;
    if (since < 0 || since > HIT_PULSE_BEATS) return;
    r.fillRect({ x: 0, y: 0, w: 1, h: 1 }, '#ff3355', 0.25 * (1 - since / HIT_PULSE_BEATS));
  }

  private renderPerfectLabel(r: Renderer, beat: number): void {
    const since = beat - this.lastPerfectBeat;
    if (since < 0 || since > PERFECT_PULSE_BEATS) return;
    const alpha = 1 - since / PERFECT_PULSE_BEATS;
    r.text('PERFECT', this.player.x, this.player.y - 0.075, '#9ffcff', 13, 'center', alpha);
  }

  get activeMechanicCount(): number {
    return this.mechanics.length;
  }

  get statusLine(): string {
    return `ARENA  mechanics:${this.mechanics.length}  perfect:${this.perfects}  last pattern:${this.lastPatternId}`;
  }
}

/** 1 immediately after an event, falling to 0 over `window` beats. */
function decay(since: number, window: number): number {
  if (since < 0 || since > window) return 0;
  return 1 - since / window;
}

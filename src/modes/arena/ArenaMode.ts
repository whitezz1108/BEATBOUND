/**
 * ARENA -- top-down 2D dodge.
 *
 * The mode owns the field, the avatar and whichever mechanics are currently
 * alive. It runs collision generically against the `Shape`s mechanics expose,
 * so it never needs to know that A03 is a projectile or A05 is a chain.
 */

import { circleIntersectsShape } from '../../core/geometry';
import type { MechanicUpdate, RuntimeMechanic } from '../../core/Mechanic';
import type { Renderer } from '../../core/Renderer';
import type { SpawnedMechanicInfo } from '../../core/PatternScheduler';
import type { GameMode } from '../../core/types';
import type { GameplayMode, ModeContext } from '../GameplayMode';
import { ArenaPlayer } from './ArenaPlayer';

export class ArenaMode implements GameplayMode {
  readonly mode: GameMode = 'ARENA';
  readonly player = new ArenaPlayer();
  private mechanics: RuntimeMechanic[] = [];
  private lastHitBeat = -Infinity;
  /** Debug label for the HUD: what pattern most recently fed this mode. */
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
    this.player.update(u.deltaSeconds, this.ctx.input.axis());

    for (const m of this.mechanics) m.update(u);

    this.resolveCollisions(u.beat);

    // Drop finished mechanics. Cheap because the list stays short.
    if (this.mechanics.some((m) => m.isFinished)) {
      this.mechanics = this.mechanics.filter((m) => !m.isFinished);
    }
  }

  private resolveCollisions(beat: number): void {
    const body = this.player.circle;
    for (const m of this.mechanics) {
      for (const shape of m.hazards()) {
        if (!circleIntersectsShape(body, shape)) continue;
        if (this.ctx.status.registerHit(beat)) this.lastHitBeat = beat;
        return; // one hit per frame is enough; i-frames handle the rest
      }
    }
  }

  render(r: Renderer): void {
    const beat = this.ctx.clock.absoluteBeat;
    this.renderField(r, beat);
    r.withFieldClip(() => {
      for (const m of this.mechanics) m.render(r);
      this.player.render(r, this.ctx.status.isInvulnerable(beat), beat);
      this.renderHitFlash(r, beat);
    });
  }

  private renderField(r: Renderer, beat: number): void {
    r.fillRect({ x: 0, y: 0, w: 1, h: 1 }, '#0b0f18');
    // Faint 4x4 guide so checkerboard layouts are spatially readable.
    for (let i = 1; i < 4; i++) {
      r.line(i / 4, 0, i / 4, 1, '#161d2c', 1);
      r.line(0, i / 4, 1, i / 4, '#161d2c', 1);
    }
    // Border pulses on the downbeat -- a constant rhythmic reference point.
    const beatsPerBar = this.ctx.clock.beatsPerBar;
    const intoBar = ((beat % beatsPerBar) + beatsPerBar) % beatsPerBar;
    const pulse = Math.max(0, 1 - intoBar); // 1 on the downbeat, fading over one beat
    r.strokeRect({ x: 0, y: 0, w: 1, h: 1 }, '#2b3750', 2, 0.35 + pulse * 0.5);
  }

  private renderHitFlash(r: Renderer, beat: number): void {
    const since = beat - this.lastHitBeat;
    if (since < 0 || since > 0.5) return;
    r.fillRect({ x: 0, y: 0, w: 1, h: 1 }, '#ff3355', 0.35 * (1 - since / 0.5));
  }

  get activeMechanicCount(): number {
    return this.mechanics.length;
  }

  get statusLine(): string {
    return `ARENA  mechanics:${this.mechanics.length}  last pattern:${this.lastPatternId}`;
  }
}

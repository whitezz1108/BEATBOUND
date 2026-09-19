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
 */

import { circleIntersectsShape } from '../../core/geometry';
import type { MechanicUpdate, RuntimeMechanic } from '../../core/Mechanic';
import type { Renderer } from '../../core/Renderer';
import type { SpawnedMechanicInfo } from '../../core/PatternScheduler';
import type { GameMode } from '../../core/types';
import { TUNING } from '../../tuning';
import { ARENA_CENTRE, polarToField } from '../../mechanics/arena/polar';
import type { GameplayMode, ModeContext } from '../GameplayMode';
import { ArenaPlayer } from './ArenaPlayer';

/** Radii of the composition guide rings. */
const GUIDE_RINGS = [0.18, 0.34, 0.5];

export class ArenaMode implements GameplayMode {
  readonly mode: GameMode = 'ARENA';
  readonly player = new ArenaPlayer();
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
    const margin = TUNING.arena.perfectDodgeMargin;
    const grazeBody = { ...body, r: body.r + margin };

    let hit = false;
    let graze = false;
    for (const m of this.mechanics) {
      for (const shape of m.hazards()) {
        if (circleIntersectsShape(body, shape)) {
          hit = true;
          break;
        }
        if (!graze && circleIntersectsShape(grazeBody, shape)) graze = true;
      }
      if (hit) break;
    }

    if (hit) {
      this.grazeWasClean = false;
      if (this.ctx.status.registerHit(beat)) {
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
    this.renderField(r, beat);
    r.withFieldClip(() => {
      for (const m of this.mechanics) m.render(r);
      this.player.render(r, this.ctx.status.isInvulnerable(beat), beat);
      this.renderHitFlash(r, beat);
      this.renderPerfectLabel(r, beat);
    });
  }

  private renderField(r: Renderer, beat: number): void {
    r.fillRect({ x: 0, y: 0, w: 1, h: 1 }, '#0b0f18');

    const beatsPerBar = this.ctx.clock.beatsPerBar;
    const intoBar = ((beat % beatsPerBar) + beatsPerBar) % beatsPerBar;
    const pulse = Math.max(0, 1 - intoBar); // 1 on the downbeat, fading over a beat
    const intoBeat = ((beat % 1) + 1) % 1;
    const beatPulse = Math.max(0, 1 - intoBeat);

    // Faint 4x4 guide so tile layouts stay spatially readable.
    for (let i = 1; i < 4; i++) {
      r.line(i / 4, 0, i / 4, 1, '#161d2c', 1);
      r.line(0, i / 4, 1, i / 4, '#161d2c', 1);
    }

    // Radial composition: concentric guides and eight spokes. These say where
    // the centre is and how far out an attack currently reaches.
    for (const radius of GUIDE_RINGS) {
      r.strokeCircle(ARENA_CENTRE.x, ARENA_CENTRE.y, radius, '#1b2740', 1, 0.5 + 0.25 * beatPulse);
    }
    for (let i = 0; i < 8; i++) {
      const angle = (i * Math.PI) / 4;
      const from = polarToField(angle, GUIDE_RINGS[0]);
      const to = polarToField(angle, 0.78);
      r.line(from.x, from.y, to.x, to.y, '#161f33', 1, 0.45);
    }
    r.strokeCircle(ARENA_CENTRE.x, ARENA_CENTRE.y, 0.012, '#2b3750', 1, 0.6);

    // Border pulses on the downbeat -- a constant rhythmic reference point.
    r.strokeRect({ x: 0, y: 0, w: 1, h: 1 }, '#2b3750', 2, 0.35 + pulse * 0.5);
  }

  private renderHitFlash(r: Renderer, beat: number): void {
    const since = beat - this.lastHitBeat;
    if (since < 0 || since > 0.5) return;
    r.fillRect({ x: 0, y: 0, w: 1, h: 1 }, '#ff3355', 0.25 * (1 - since / 0.5));
  }

  private renderPerfectLabel(r: Renderer, beat: number): void {
    const since = beat - this.lastPerfectBeat;
    if (since < 0 || since > 0.7) return;
    const alpha = 1 - since / 0.7;
    r.text('PERFECT', this.player.x, this.player.y - 0.075, '#9ffcff', 13, 'center', alpha);
  }

  get activeMechanicCount(): number {
    return this.mechanics.length;
  }

  get statusLine(): string {
    return `ARENA  mechanics:${this.mechanics.length}  perfect:${this.perfects}  last pattern:${this.lastPatternId}`;
  }
}

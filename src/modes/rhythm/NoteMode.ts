/**
 * Shared base for the timed-input modes (VERTICAL, RADIAL).
 *
 * Both judge the same thing -- did the player press the right control close
 * enough to a target's beat -- so the judging, scoring and miss detection live
 * here once. Subclasses supply only what actually differs: which keys satisfy a
 * target, and how the stage and its notes are drawn.
 *
 * Judgement windows are in beats, not milliseconds, so accuracy demands scale
 * with the song instead of getting harder at every tempo.
 */

import { hasNoteTargets, type NoteTarget } from '../../core/capabilities';
import type { MechanicUpdate, RuntimeMechanic } from '../../core/Mechanic';
import type { Renderer } from '../../core/Renderer';
import type { SpawnedMechanicInfo } from '../../core/PatternScheduler';
import type { GameMode } from '../../core/types';
import type { GameplayMode, ModeContext } from '../GameplayMode';

/** Anything inside this is a hit; outside it on the late side is a miss. */
export const HIT_WINDOW_BEATS = 0.25;
/** The tighter band that counts as a perfect, for feedback only. */
export const PERFECT_WINDOW_BEATS = 0.09;

export interface Judgement {
  verdict: 'PERFECT' | 'GOOD' | 'MISS';
  beat: number;
}

export abstract class NoteMode implements GameplayMode {
  abstract readonly mode: GameMode;
  protected mechanics: RuntimeMechanic[] = [];
  protected lastJudgement: Judgement | null = null;
  protected lastPatternId = '-';

  constructor(protected readonly ctx: ModeContext) {}

  /** Keys that satisfy this target (lane keys, direction keys, ...). */
  protected abstract keysFor(target: NoteTarget): string[];
  /** Static stage furniture: lanes, hit line, rings. */
  protected abstract renderStage(r: Renderer, beat: number): void;
  /** One approaching or resolved note. */
  protected abstract renderNote(r: Renderer, target: NoteTarget, beat: number): void;

  activate(_atBeat: number): void {
    this.mechanics = [];
    this.lastJudgement = null;
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

    for (const target of this.pendingTargets()) {
      this.judge(target, u.beat);
    }

    if (this.mechanics.some((m) => m.isFinished)) {
      this.mechanics = this.mechanics.filter((m) => !m.isFinished);
    }
  }

  /** Every target of every live mechanic, in beat order. */
  protected allTargets(): NoteTarget[] {
    const out: NoteTarget[] = [];
    for (const m of this.mechanics) {
      if (hasNoteTargets(m)) out.push(...m.targets);
    }
    return out.sort((a, b) => a.beat - b.beat);
  }

  private pendingTargets(): NoteTarget[] {
    return this.allTargets().filter((t) => t.state === 'PENDING' || t.state === 'HOLDING');
  }

  private judge(target: NoteTarget, beat: number): void {
    const keys = this.keysFor(target);

    if (target.state === 'HOLDING') {
      // Releasing early breaks the hold; surviving to the end completes it.
      if (beat >= target.beat + target.holdBeats) {
        target.state = 'HIT';
      } else if (!this.ctx.input.isDown(...keys)) {
        target.state = 'BROKEN';
        this.ctx.status.registerMiss(beat);
      }
      return;
    }

    const offset = beat - target.beat;
    if (offset > HIT_WINDOW_BEATS) {
      target.state = 'MISSED';
      this.ctx.status.registerMiss(beat);
      this.lastJudgement = { verdict: 'MISS', beat };
      return;
    }
    // Presses before the window simply do nothing -- no penalty for being eager.
    if (offset < -HIT_WINDOW_BEATS) return;
    if (!this.ctx.input.wasPressed(...keys)) return;

    target.hitBeat = beat;
    target.state = target.holdBeats > 0 ? 'HOLDING' : 'HIT';
    this.ctx.status.registerNoteHit();
    this.lastJudgement = {
      verdict: Math.abs(offset) <= PERFECT_WINDOW_BEATS ? 'PERFECT' : 'GOOD',
      beat,
    };
  }

  render(r: Renderer): void {
    const beat = this.ctx.clock.absoluteBeat;
    r.fillRect({ x: 0, y: 0, w: 1, h: 1 }, '#0b0f18');
    r.withFieldClip(() => {
      this.renderStage(r, beat);
      for (const target of this.allTargets()) this.renderNote(r, target, beat);
      this.renderJudgement(r, beat);
    });
  }

  private renderJudgement(r: Renderer, beat: number): void {
    const j = this.lastJudgement;
    if (!j) return;
    const age = beat - j.beat;
    if (age < 0 || age > 0.75) return;
    const alpha = 1 - age / 0.75;
    const colour = j.verdict === 'MISS' ? '#ff5470' : j.verdict === 'PERFECT' ? '#6de3ff' : '#9affc0';
    r.text(j.verdict, 0.5, 0.5, colour, 26, 'center', alpha);
  }

  get activeMechanicCount(): number {
    return this.mechanics.length;
  }

  get statusLine(): string {
    const s = this.ctx.status;
    const total = s.notesHit + s.notesMissed;
    const accuracy = total > 0 ? `${Math.round((s.notesHit / total) * 100)}%` : '--';
    return `${this.mode}  notes:${s.notesHit}/${total} (${accuracy})  last pattern:${this.lastPatternId}`;
  }
}

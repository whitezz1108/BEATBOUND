/**
 * Shared base for the timed-input modes (VERTICAL, RADIAL).
 *
 * Both judge the same thing -- did the player press the right control close
 * enough to a target's beat -- so judging, holds, drift tracking and scoring
 * live here once. Subclasses supply only what actually differs: which keys
 * satisfy a target right now, and how the stage and its notes are drawn.
 *
 * Every window is in beats, not milliseconds, so accuracy demands scale with
 * the song instead of getting harder at every tempo.
 */

import {
  checkpointIndexAt, hasNoteTargets, requiredLaneAt, type NoteTarget,
} from '../../core/capabilities';
import type { MechanicUpdate, RuntimeMechanic } from '../../core/Mechanic';
import type { Renderer } from '../../core/Renderer';
import type { SpawnedMechanicInfo } from '../../core/PatternScheduler';
import type { GameMode } from '../../core/types';
import { TUNING } from '../../tuning';
import type { GameplayMode, ModeContext } from '../GameplayMode';

export type Verdict = 'PERFECT' | 'GOOD' | 'MISS';

export interface Judgement {
  verdict: Verdict;
  beat: number;
  /** Where on screen to show it. Lets each mode place feedback sensibly. */
  x: number;
  y: number;
}

export abstract class NoteMode implements GameplayMode {
  abstract readonly mode: GameMode;
  protected mechanics: RuntimeMechanic[] = [];
  protected lastJudgement: Judgement | null = null;
  protected lastPatternId = '-';
  protected combo = 0;
  protected bestCombo = 0;

  /** Beat the last hold tick fired on, so ticks stay on the subdivision. */
  private lastTickBeat = -Infinity;

  constructor(protected readonly ctx: ModeContext) {}

  /**
   * Did the player enter this target's control on this frame?
   *
   * Modes answer rather than declaring a key list because RADIAL's diagonals
   * are two cardinals pressed together, which is not expressible as "any of
   * these keys".
   */
  protected abstract justPressed(target: NoteTarget, beat: number): boolean;
  /** Is the target's control currently held? Used by holds and drifts. */
  protected abstract isHeld(target: NoteTarget, beat: number): boolean;
  /** Static stage furniture: lanes, hit line, rings. */
  protected abstract renderStage(r: Renderer, beat: number): void;
  /** One approaching or resolved note. */
  protected abstract renderNote(r: Renderer, target: NoteTarget, beat: number): void;
  /** Where a target's feedback should appear. */
  protected abstract judgementAnchor(target: NoteTarget, beat: number): { x: number; y: number };
  /** Has this note travelled out of the visible play area? */
  protected abstract isOffscreen(target: NoteTarget, beat: number): boolean;

  get perfectWindow(): number {
    return this.mode === 'RADIAL' ? TUNING.radial.perfectWindowBeats : TUNING.vertical.perfectWindowBeats;
  }

  get hitWindow(): number {
    return this.mode === 'RADIAL' ? TUNING.radial.goodWindowBeats : TUNING.vertical.goodWindowBeats;
  }

  activate(_atBeat: number): void {
    this.mechanics = [];
    this.lastJudgement = null;
    this.combo = 0;
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
    const alive = this.ctx.status.outcome === 'PLAYING';
    for (const target of this.allTargets()) {
      if (alive && (target.state === 'PENDING' || target.state === 'HOLDING')) {
        this.judge(target, u);
      }
      // A missed note keeps travelling. It is scored and inert, but visible
      // until it leaves the board -- then, and only then, it expires.
      if ((target.state === 'MISSED' || target.state === 'BROKEN')
          && this.isOffscreen(target, u.beat)) {
        target.state = 'EXPIRED';
      }
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

  private judge(target: NoteTarget, u: MechanicUpdate): void {
    const beat = u.beat;

    if (target.state === 'HOLDING') {
      this.judgeHold(target, beat, u.deltaSeconds / Math.max(0.001, u.secondsPerBeat));
      return;
    }

    const offset = beat - target.beat;
    if (offset > this.hitWindow) {
      target.state = 'MISSED';
      this.registerMiss(target, beat);
      return;
    }
    // Presses before the window simply do nothing -- no penalty for being eager.
    if (offset < -this.hitWindow) return;
    if (!this.justPressed(target, beat)) return;

    target.hitBeat = beat;
    target.offBeats = 0;
    target.lastCheckpoint = -1;
    const perfect = Math.abs(offset) <= this.perfectWindow;
    target.state = target.holdBeats > 0 ? 'HOLDING' : 'HIT';
    this.ctx.status.registerNoteHit();
    this.combo += 1;
    this.bestCombo = Math.max(this.bestCombo, this.combo);
    this.onJudged(target, perfect ? 'PERFECT' : 'GOOD', beat);
  }

  /**
   * Holds (and drift holds) survive brief lapses: `offBeats` accumulates while
   * the wrong key is down and only breaks the note past the tolerance. A drift
   * gets the larger allowance because it has to change hands mid-note.
   */
  private judgeHold(target: NoteTarget, beat: number, beatsElapsed: number): void {
    const isDrift = Boolean(target.path && target.path.length > 1);
    const tolerance = isDrift ? TUNING.vertical.driftToleranceBeats : TUNING.vertical.holdToleranceBeats;

    if (beat >= target.beat + target.holdBeats) {
      target.state = 'HIT';
      this.ctx.feel.sfx('hold_complete');
      const at = this.judgementAnchor(target, beat);
      this.ctx.feel.impact('LIGHT', { x: at.x, y: at.y, colour: '#9affc0' });
      return;
    }

    if (this.isHeld(target, beat)) {
      target.offBeats = Math.max(0, (target.offBeats ?? 0) - beatsElapsed * 2);
      // A checkpoint cue every time the required lane moves under the player.
      const checkpoint = checkpointIndexAt(target, beat);
      if (isDrift && checkpoint !== (target.lastCheckpoint ?? -1)) {
        target.lastCheckpoint = checkpoint;
        this.ctx.feel.sfx('drift_checkpoint');
      }
      // Quiet metronomic tick so a long hold still feels connected to the song.
      const tick = Math.floor(beat * 2);
      if (tick !== this.lastTickBeat) {
        this.lastTickBeat = tick;
        this.ctx.feel.sfx('hold_tick', 0.6);
      }
      return;
    }

    target.offBeats = (target.offBeats ?? 0) + beatsElapsed;
    if (target.offBeats > tolerance) {
      target.state = 'BROKEN';
      this.registerMiss(target, beat);
    }
  }

  private registerMiss(target: NoteTarget, beat: number): void {
    // Missed notes bypass collision invulnerability on purpose: three missed
    // notes should cost three notes' worth of health, not one.
    this.ctx.status.damage('MISS', this.ctx.clock.songTime);
    this.combo = 0;
    this.onJudged(target, 'MISS', beat);
  }

  private onJudged(target: NoteTarget, verdict: Verdict, beat: number): void {
    const at = this.judgementAnchor(target, beat);
    this.lastJudgement = { verdict, beat, x: at.x, y: at.y };

    if (verdict === 'MISS') {
      this.ctx.feel.sfx('miss');
      this.ctx.feel.impact('LIGHT', { x: at.x, y: at.y, colour: '#ff5470', shockwave: false });
      return;
    }

    const radial = this.mode === 'RADIAL';
    if (verdict === 'PERFECT') {
      this.ctx.feel.sfx(radial ? 'direction_perfect' : 'tap_perfect');
      this.ctx.feel.impact('MEDIUM', { x: at.x, y: at.y, colour: '#6de3ff' });
    } else {
      this.ctx.feel.sfx(radial ? 'direction_hit' : 'tap_good');
      this.ctx.feel.impact('LIGHT', { x: at.x, y: at.y, colour: '#9affc0' });
    }
    if (target.holdBeats > 0) this.ctx.feel.sfx('hold_start');
    // Milestone combos get their own flourish rather than a louder note cue.
    if (this.combo > 0 && this.combo % 16 === 0) {
      this.ctx.feel.sfx(radial ? 'radial_combo' : 'hold_complete', 0.8);
      this.ctx.feel.shockwave(at.x, at.y, 0.3, '#6de3ff', 0.4, 2);
    }
  }

  render(r: Renderer): void {
    const beat = this.ctx.clock.visualBeat;
    r.fillRect({ x: 0, y: 0, w: 1, h: 1 }, '#0b0f18');
    r.withFieldClip(() => {
      this.renderStage(r, beat);
      for (const target of this.allTargets()) this.renderNote(r, target, beat);
      this.renderJudgement(r, beat);
      this.renderCombo(r);
    });
  }

  private renderJudgement(r: Renderer, beat: number): void {
    const j = this.lastJudgement;
    if (!j) return;
    const age = beat - j.beat;
    if (age < 0 || age > 0.75) return;
    const alpha = 1 - age / 0.75;
    const colour = j.verdict === 'MISS' ? '#ff5470' : j.verdict === 'PERFECT' ? '#6de3ff' : '#9affc0';
    // Floats upward as it fades, so successive judgements do not overlap.
    r.text(j.verdict, j.x, j.y - 0.05 - age * 0.06, colour, 20, 'center', alpha);
  }

  private renderCombo(r: Renderer): void {
    if (this.combo < 4) return;
    r.text(`${this.combo}`, 0.5, 0.1, '#e8ecf8', 26, 'center', 0.75);
    r.text('COMBO', 0.5, 0.145, '#8d99b5', 10, 'center', 0.6);
  }

  /** Required lane for a target right now -- drift holds move between lanes. */
  protected laneOf(target: NoteTarget, beat: number): number {
    return target.state === 'HOLDING' || target.state === 'HIT'
      ? requiredLaneAt(target, beat)
      : (target.path?.[0].lane ?? target.lane ?? 1);
  }

  get activeMechanicCount(): number {
    return this.mechanics.length;
  }

  get statusLine(): string {
    const s = this.ctx.status;
    const total = s.notesHit + s.notesMissed;
    const accuracy = total > 0 ? `${Math.round((s.notesHit / total) * 100)}%` : '--';
    return `${this.mode}  notes:${s.notesHit}/${total} (${accuracy})  combo:${this.combo}/${this.bestCombo}  last:${this.lastPatternId}`;
  }
}

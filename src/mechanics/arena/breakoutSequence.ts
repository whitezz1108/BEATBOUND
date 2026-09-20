/**
 * A12 Rhythm Breakout -- the phrase the player performs, and the judge that
 * scores it.
 *
 * Deliberately free of rendering, audio and input plumbing: it is handed a
 * direction and a beat and answers what that press was worth. The mechanic
 * turns those answers into feedback, and the UI reads the step states to draw
 * them.
 *
 * Judging is denominated in *beats*, like VERTICAL and RADIAL, so accuracy
 * demands scale with the song instead of quietly getting harder at every
 * tempo. The windows themselves are decided in `breakoutPlan.ts`.
 */

import type { Direction8 } from '../../core/direction8';

/** The mechanic uses the four cardinals only: this is a dance pad, not a compass. */
export type BreakoutDirection = Extract<Direction8, 'N' | 'E' | 'S' | 'W'>;
export const BREAKOUT_CARDINALS: readonly BreakoutDirection[] = ['N', 'E', 'S', 'W'];

export type BreakoutVerdict = 'PERFECT' | 'GOOD' | 'MISS';

/**
 * A step's life:
 *
 *   UPCOMING -> ACTIVE -> HIT      (played in time, right direction)
 *   UPCOMING -> ACTIVE -> MISSED   (wrong direction, or never played)
 *
 * MISSED is scored once and then inert, but the step stays on screen for the
 * rest of the encounter: a prompt that vanishes the instant it is missed steals
 * the feedback the player needs to understand what went wrong.
 */
export type StepState = 'UPCOMING' | 'ACTIVE' | 'HIT' | 'MISSED';

/** One authored prompt, relative to the encounter's activation beat. */
export interface SequenceSpec {
  beatOffset: number;
  direction: BreakoutDirection;
}

/** One prompt at runtime. */
export interface SequenceStep {
  direction: BreakoutDirection;
  beatOffset: number;
  /** Absolute beat this step is due on. */
  beat: number;
  state: StepState;
  verdict?: BreakoutVerdict;
  /** Beat the state last changed, so the UI can animate the transition. */
  resolvedBeat?: number;
  /** Signed beats early (-) or late (+), for the judgement readout. */
  offsetBeats?: number;
}

/** Perfect / good / miss from a signed timing offset, in beats. */
export class RhythmTimingJudge {
  constructor(readonly perfectBeats: number, readonly goodBeats: number) {}

  inWindow(offsetBeats: number): boolean {
    return Math.abs(offsetBeats) <= this.goodBeats;
  }

  verdict(offsetBeats: number): BreakoutVerdict {
    const magnitude = Math.abs(offsetBeats);
    if (magnitude <= this.perfectBeats) return 'PERFECT';
    return magnitude <= this.goodBeats ? 'GOOD' : 'MISS';
  }
}

export interface PressResult {
  step: SequenceStep;
  verdict: BreakoutVerdict;
  index: number;
}

/**
 * The phrase in flight.
 *
 * Two rules keep it honest and both are borrowed from `NoteMode`, because a
 * player who has learned one rhythm mode should not have to learn another set
 * of manners for this one:
 *
 *   - a press before any window opens is *ignored*, not punished. Eagerness is
 *     not an error, and punishing it teaches the player to stop playing.
 *   - a press inside a window resolves the nearest unplayed step, right or
 *     wrong. A wrong direction is a miss on that step rather than a free
 *     retry, so the sequence cannot be brute-forced by mashing.
 */
export class RhythmSequence {
  readonly steps: SequenceStep[];
  private _misses = 0;
  private _hits = 0;

  constructor(specs: SequenceSpec[], activationBeat: number, private readonly judge: RhythmTimingJudge) {
    this.steps = specs.map((spec) => ({
      direction: spec.direction,
      beatOffset: spec.beatOffset,
      beat: activationBeat + spec.beatOffset,
      state: 'UPCOMING' as StepState,
    }));
  }

  get misses(): number { return this._misses; }
  get hits(): number { return this._hits; }
  get length(): number { return this.steps.length; }
  get lastBeat(): number { return this.steps[this.steps.length - 1]?.beat ?? 0; }

  /** True once no step can still be played. */
  get isResolved(): boolean {
    return this.steps.every((s) => s.state === 'HIT' || s.state === 'MISSED');
  }

  /**
   * Advance the phrase to `beat`. Returns any step that ran out of time on
   * this frame, so the mechanic can fire exactly one miss cue for it.
   */
  update(beat: number): SequenceStep[] {
    const expired: SequenceStep[] = [];
    for (const step of this.steps) {
      if (step.state === 'HIT' || step.state === 'MISSED') continue;
      if (beat > step.beat + this.judge.goodBeats) {
        step.state = 'MISSED';
        step.verdict = 'MISS';
        step.resolvedBeat = beat;
        this._misses += 1;
        expired.push(step);
        continue;
      }
      step.state = this.judge.inWindow(beat - step.beat) ? 'ACTIVE' : 'UPCOMING';
    }
    return expired;
  }

  /** Enter a direction. Null when no step was listening. */
  press(direction: BreakoutDirection, beat: number): PressResult | null {
    let index = -1;
    let best = Infinity;
    for (let i = 0; i < this.steps.length; i++) {
      const step = this.steps[i];
      if (step.state === 'HIT' || step.state === 'MISSED') continue;
      const offset = Math.abs(beat - step.beat);
      if (offset <= this.judge.goodBeats && offset < best) {
        best = offset;
        index = i;
      }
    }
    if (index < 0) return null;

    const step = this.steps[index];
    const offset = beat - step.beat;
    step.resolvedBeat = beat;
    step.offsetBeats = offset;

    if (step.direction !== direction) {
      step.state = 'MISSED';
      step.verdict = 'MISS';
      this._misses += 1;
      return { step, verdict: 'MISS', index };
    }

    const verdict = this.judge.verdict(offset);
    step.state = 'HIT';
    step.verdict = verdict;
    this._hits += 1;
    return { step, verdict, index };
  }

  /** Index of the step currently being asked for, or the next one due. */
  pendingIndex(): number {
    for (let i = 0; i < this.steps.length; i++) {
      const state = this.steps[i].state;
      if (state === 'UPCOMING' || state === 'ACTIVE') return i;
    }
    return this.steps.length;
  }
}

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
 *   UPCOMING -> ACTIVE -> HIT      (played, right direction)
 *   UPCOMING -> ACTIVE -> MISSED   (wrong direction)
 *
 * There is no timeout state: a step never expires on its own, because the
 * phrase is untimed. MISSED is scored once and then inert, but the step stays
 * on screen for the rest of the encounter: a prompt that vanishes the instant
 * it is missed steals the feedback the player needs to understand what went
 * wrong.
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
 * One rule keeps it honest:
 *
 *   - direction presses are *untimed*. The phrase is what unlocks the seal,
 *     not a rhythm test: a step can be played any time after the encounter
 *     starts and before the final accent, early or late or all in a burst.
 *     Only the direction is judged -- a wrong direction is a miss on that step
 *     rather than a free retry, so the sequence cannot be brute-forced by
 *     mashing. The beat-locked press is the final accent, and only that.
 */
export class RhythmSequence {
  readonly steps: SequenceStep[];
  private _misses = 0;
  private _hits = 0;

  constructor(public readonly specs: SequenceSpec[], readonly activationBeat: number) {
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
   * Advance the phrase to `beat`. Returns nothing: untimed steps never expire,
   * so there is no timeout to miss. Kept for symmetry with the mechanic's
   * update loop and to refresh each step's ACTIVE state for the UI.
   */
  update(_beat: number): SequenceStep[] {
    for (const step of this.steps) {
      if (step.state === 'HIT' || step.state === 'MISSED') continue;
      step.state = 'ACTIVE';
    }
    return [];
  }

  /**
   * Enter a direction. Null when every step has been played already.
   *
   * Resolves the *next unplayed* step, wherever the beat is: the phrase is
   * untimed, so a press always lands on the front of the queue.
   */
  press(direction: BreakoutDirection, beat: number): PressResult | null {
    const index = this.pendingIndex();
    if (index >= this.steps.length) return null;

    const step = this.steps[index];
    step.resolvedBeat = beat;
    step.offsetBeats = 0;

    if (step.direction !== direction) {
      step.state = 'MISSED';
      step.verdict = 'MISS';
      this._misses += 1;
      return { step, verdict: 'MISS', index };
    }

    // A landed direction scores as a plain GOOD: it unlocked the step, but it
    // is not the accent, so it carries no perfect.
    step.state = 'HIT';
    step.verdict = 'GOOD';
    this._hits += 1;
    return { step, verdict: 'GOOD', index };
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

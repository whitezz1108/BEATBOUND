/**
 * A12 Rhythm Breakout -- level data in, a playable encounter timeline out.
 *
 * Every number the mechanic runs on is decided here, once, at construction:
 * the prep window, the step beats, the final accent, the judging windows and
 * the barrier's geometry. The mechanic itself then owns only *state*, and the
 * renderer only *appearance*.
 *
 * This is also where fairness lives, and it is the reason the module exists
 * separately. A breakout is the one ARENA hazard the player cannot dodge -- the
 * seal has no gap -- so "is this encounter possible" cannot be left to whoever
 * authors the JSON, and it certainly cannot be left to an LLM generating
 * sequences from a music analysis. Four things are guaranteed by construction,
 * at every tempo:
 *
 *   1. The seal forms *around the player*, wherever the player is. Radii are
 *      *inradii* -- the distance to the nearest wall -- so a hexagonal seal
 *      guarantees the same clearance a circular one does, and a skin stays a
 *      cosmetic choice rather than a difficulty one.
 *   2. The prep window is long enough for the seal to be read as a seal before
 *      it starts closing. It is *not* a travel budget: the player is already
 *      inside the cage, so there is no walk to pay for. That is why prep can be
 *      authored as short as two beats without becoming unfair.
 *   3. Steps are never closer together than a person can articulate, and the
 *      judging windows can never overlap two adjacent steps.
 *   4. The barrier reaches its critical radius *at* the final beat and not
 *      before, so it cannot become lethal while the player still has inputs
 *      left to make.
 *
 * It also decides what a failed phrase *costs*, which is the same kind of
 * fairness question: the encounter is the one ARENA hazard the player cannot
 * dodge, so a bad bar must be survivable and its price must be legible before
 * it is charged. See `PARTIAL_DAMAGE` / `ACCENT_DAMAGE` below.
 *
 * Nothing here reads the clock or draws: it is a pure function of the param
 * bag plus the tempo, which is what lets `npm run fairness` and the pattern
 * audits exercise the same numbers the game plays.
 */

import { clamp } from '../../core/geometry';
import { parseDirection } from '../../core/direction8';
import { COMFORT_REACTION_SECONDS } from '../../core/fairness';
import type { ParamBag } from '../../core/types';
import { TUNING } from '../../tuning';
import { ARENA_OUTER_RADIUS } from './polar';
import type { BreakoutDirection, SequenceSpec } from './breakoutSequence';
import { SEAL_SKINS, type SealSkinName } from './SealBarrier';

/** What a failed seal costs. Maps onto the shared damage table, never a number. */
export type BreakoutFailureMode = 'LIGHT' | 'DAMAGE' | 'HEAVY';

const FAILURE_MODES: BreakoutFailureMode[] = ['LIGHT', 'DAMAGE', 'HEAVY'];

/**
 * Health a phrase costs, by authored severity -- two prices, because the
 * encounter has two ways to go wrong and they are not the same mistake.
 *
 *   PARTIAL  the phrase was not played in full but its accent still landed.
 *            The seal opens, the player got out, and this is the sting for
 *            the steps that were fumbled rather than a punishment for them.
 *   ACCENT   the accent itself never landed -- the one beat-locked press the
 *            whole encounter is built around -- or the phrase was too broken
 *            for the seal to open at all. This is the real failure, and it is
 *            charged whether the player was early, late, or never pressed.
 *
 * Both are *health*, not a rule: a run survives a bad bar, and the tally on
 * screen says what the bar cost. `failureMode` remains the author's severity
 * knob and keeps its own job -- which source the damage is filed under, and
 * therefore how a collision with the closed seal is charged.
 */
const PARTIAL_DAMAGE: Record<BreakoutFailureMode, number> = { LIGHT: 2, DAMAGE: 3, HEAVY: 5 };
const ACCENT_DAMAGE: Record<BreakoutFailureMode, number> = { LIGHT: 5, DAMAGE: 8, HEAVY: 10 };

/**
 * Ceiling on an authored price, as a share of the health bar.
 *
 * A rhythm encounter is one bar of one song. However badly it goes, it must
 * not be able to take a run out on its own -- that is what the rest of the
 * song's hazards are for -- so no price, authored or generated, goes past this.
 */
const MAX_DAMAGE = 25;

/**
 * How far a player can stand from the centre of the arena.
 *
 * The avatar is clamped to the unit square, so the furthest any body can be
 * from the middle is the corner. The seal must spawn at least this far out or
 * it would form *around* part of the field and trap someone outside itself.
 */
export const FIELD_REACH = Math.SQRT1_2 * (1 - 2 * TUNING.arena.playerRadius) + TUNING.arena.playerRadius;

/** Absolute floors. No difficulty, intensity or authored value goes below these. */
const MIN_PREP_BEATS = 2;
const MAX_PREP_BEATS = 16;
/** Two directional inputs closer together than this are not a rhythm, they are a mash. */
const MIN_STEP_SECONDS = 0.11;
const MIN_STEP_BEATS = 0.25;
/** The anticipation gap between the last step and the final accent. */
const MIN_ANTICIPATION_BEATS = 0.5;
const MIN_ANTICIPATION_SECONDS = 0.35;
/** Beats the failed seal takes to crush inward from critical radius to nothing. */
const COLLAPSE_BEATS = 0.6;

export interface BreakoutPlan {
  /** Beats of build-up before the first step. The seal is visible but inert. */
  prepBeats: number;
  /** Steps, in beats after the activation beat. Sorted and spaced. */
  steps: SequenceSpec[];
  /** Beats after activation at which the seal must be broken. */
  finalBeatOffset: number;
  /** Beats of resolution after the final accent -- shatter, or collapse. */
  releaseBeats: number;
  perfectBeats: number;
  goodBeats: number;
  /** The final accent judges a touch looser: it is one press, not a phrase. */
  finalGoodBeats: number;
  /** Step misses the seal tolerates before it can no longer be broken. */
  maxMisses: number;
  failureMode: BreakoutFailureMode;
  /** Health the accent costs when it is missed, or when the seal cannot open. */
  accentMissDamage: number;
  /** Health a phrase costs when it is fumbled but the accent still lands. */
  missDamage: number;
  /** Distance to the nearest wall at spawn. See `sealGeometry.ts`. */
  startRadius: number;
  /** Distance to the nearest wall at the final accent. */
  criticalRadius: number;
  thickness: number;
  collapseBeats: number;
  /** Walking speed retained while the encounter owns the controls. */
  movementScale: number;
  skin: SealSkinName;
  /** Authoring problems worth a console warning. Empty in well-formed data. */
  notes: string[];
}

export interface PlanContext {
  secondsPerBeat: number;
  /** Library telegraph after tier/intensity scaling -- the default prep window. */
  telegraphBeats: number;
  /** The tier's readability multiplier, applied to the judging windows. */
  gapScale: number;
}

/**
 * The default phrase: four cardinals, one per beat, resolving on the downbeat
 * of the next bar. Deliberately the easiest thing the mechanic can express --
 * a mechanic's library defaults are what an author gets before they have made
 * any decisions, so they should teach rather than test.
 */
const DEFAULT_SEQUENCE: SequenceSpec[] = [
  { beatOffset: 0, direction: 'W' },
  { beatOffset: 1, direction: 'N' },
  { beatOffset: 2, direction: 'E' },
  { beatOffset: 3, direction: 'S' },
];

export function planEncounter(params: ParamBag, ctx: PlanContext): BreakoutPlan {
  const notes: string[] = [];
  const spb = Math.max(0.01, ctx.secondsPerBeat);

  const steps = spaceSteps(readSequence(params.sequence, notes), spb, notes);
  const lastStep = steps[steps.length - 1].beatOffset;

  // The final accent. Authored where the music wants it, but never so close to
  // the last step that the two read as one gesture.
  const anticipation = Math.max(MIN_ANTICIPATION_BEATS, MIN_ANTICIPATION_SECONDS / spb);
  const authoredFinal = numberOr(params.finalBeatOffset, lastStep + 1);
  const finalBeatOffset = Math.max(authoredFinal, lastStep + anticipation);
  if (finalBeatOffset > authoredFinal + 1e-6) {
    notes.push(`finalBeatOffset ${authoredFinal} is too close to the last step; moved to ${finalBeatOffset.toFixed(2)}`);
  }

  // Judging windows. Authored in beats (or milliseconds, for data coming out of
  // a music-analysis pipeline that thinks in real time), scaled by the tier's
  // readability budget, then capped so no window can ever reach the step next
  // door -- an overlapping window would make one press satisfy two prompts.
  const minInterval = minimumInterval(steps, finalBeatOffset);
  const cap = Math.max(0.06, minInterval * 0.45);
  const authoredGood = windowBeats(params.goodWindowBeats, params.goodWindowMs, 0.24, spb);
  const authoredPerfect = windowBeats(params.perfectWindowBeats, params.perfectWindowMs, 0.12, spb);
  const goodBeats = clamp(authoredGood * ctx.gapScale, Math.min(0.08, cap), cap);
  const perfectBeats = clamp(authoredPerfect * ctx.gapScale, 0.03, goodBeats);

  // Geometry. Both radii are measured from the *player*, so the start radius no
  // longer has to reach past the far corner to be safe -- it starts wide because
  // a distant ring reads as distant, which is the whole point of the approach.
  // The critical radius still has to leave a body room to stand.
  const criticalRadius = clamp(
    numberOr(params.criticalRadius, 0.13),
    TUNING.arena.playerRadius * 2 + 0.08,
    0.3,
  );
  const startRadius = clamp(numberOr(params.startRadius, 0.72), FIELD_REACH + 0.01, ARENA_OUTER_RADIUS);
  const thickness = clamp(numberOr(params.thickness, 0.05), 0.025, 0.12);

  // Resolution has to outlast the two things that can happen after the accent:
  // a late-but-legal final press, and the collapse that follows if it never came.
  const collapseBeats = COLLAPSE_BEATS;
  const finalGoodBeats = Math.min(goodBeats * 1.35, anticipation * 0.8);
  const releaseBeats = Math.max(
    numberOr(params.releaseBeats, 2),
    finalGoodBeats + collapseBeats + 0.5,
  );

  // Movement is damped while the encounter owns the controls. The default is a
  // damp rather than a lock so a player can still shuffle; a level that wants a
  // hard lock authors 0, which is a legitimate choice now that the seal travels
  // with the player and there is nowhere to walk to anyway.
  const movementScale = clamp(numberOr(params.movementScale, 0.6), 0, 1);
  const prepBeats = planPrep(params, ctx, spb, notes);
  const failureMode = readFailureMode(params.failureMode);

  return {
    prepBeats,
    steps,
    finalBeatOffset,
    releaseBeats,
    perfectBeats,
    goodBeats,
    finalGoodBeats,
    maxMisses: Math.max(0, Math.round(numberOr(params.maxMisses, 1))),
    failureMode,
    accentMissDamage: readDamage(params.accentMissDamage, ACCENT_DAMAGE[failureMode]),
    // A partial phrase can never cost more than the accent it failed to
    // protect: the accent is the encounter, and the arrows are the run-up.
    missDamage: Math.min(
      readDamage(params.missDamage, PARTIAL_DAMAGE[failureMode]),
      readDamage(params.accentMissDamage, ACCENT_DAMAGE[failureMode]),
    ),
    startRadius,
    criticalRadius,
    thickness,
    collapseBeats,
    movementScale,
    skin: readSkin(params.variant),
    notes,
  };
}

/**
 * The prep window, and the one fairness clamp that can move.
 *
 * The seal is inert during prep, so lengthening it is always safe: it shifts
 * when the barrier *appears*, never when the player has to play. That makes it
 * the right place to absorb a tempo the encounter was not authored for -- at
 * 180 BPM two beats of closing is 0.67 seconds, which is not enough to read a
 * ring, and the answer is to show the player the seal earlier rather than to
 * rewrite their rhythm.
 *
 * What prep is *not* is a travel budget. The seal closes around the player, so
 * the player is inside it from the first frame and there is no walk to pay for;
 * the only requirement is that the seal reads as a seal before it starts to
 * move. That is what makes a two-beat prep defensible, and it is why this clamp
 * no longer consults `startRadius` or the movement scale.
 */
function planPrep(
  params: ParamBag,
  ctx: PlanContext,
  spb: number,
  notes: string[],
): number {
  const authored = typeof params.prepBeats === 'number'
    ? Math.max(0, params.prepBeats)
    // No explicit prep: the library telegraph, already tier- and intensity-scaled
    // by MechanicRegistry, is the build-up -- exactly as for every other mechanic.
    : Math.max(ctx.telegraphBeats, MIN_PREP_BEATS);

  // The floor: the seal must be readable as a seal before it starts closing.
  const comfort = COMFORT_REACTION_SECONDS / spb;

  const prep = clamp(Math.max(authored, comfort, MIN_PREP_BEATS), MIN_PREP_BEATS, MAX_PREP_BEATS);
  if (prep > authored + 1e-6) {
    notes.push(
      `prepBeats stretched ${authored.toFixed(2)} -> ${prep.toFixed(2)} so the seal is readable at this tempo`,
    );
  }
  return prep;
}

/** Parse `sequence`, keeping only the four cardinals. */
function readSequence(raw: unknown, notes: string[]): SequenceSpec[] {
  if (!Array.isArray(raw) || raw.length === 0) return [...DEFAULT_SEQUENCE];
  const steps: SequenceSpec[] = [];
  for (const [i, entry] of raw.entries()) {
    const record = (entry ?? {}) as Record<string, unknown>;
    const direction = parseDirection(record.direction);
    if (direction === null || !isCardinal(direction)) {
      notes.push(`sequence step ${i} has direction "${String(record.direction)}"; only UP/DOWN/LEFT/RIGHT are supported -- skipped`);
      continue;
    }
    steps.push({
      beatOffset: Math.max(0, numberOr(record.beatOffset, i)),
      direction,
    });
  }
  if (steps.length === 0) {
    notes.push('sequence contained no usable steps -- falling back to the default four-beat phrase');
    return [...DEFAULT_SEQUENCE];
  }
  return steps.sort((a, b) => a.beatOffset - b.beatOffset);
}

/**
 * Push steps apart until none is closer to its neighbour than a person can
 * actually play, at this tempo.
 *
 * Only ever forward, never backward, so the phrase keeps its shape and its
 * first step stays on the beat the author chose. In well-formed data this is
 * the identity function; it exists for generated sequences, where a
 * subdivision that reads fine on paper can land under 100ms at a fast tempo.
 */
function spaceSteps(steps: SequenceSpec[], secondsPerBeat: number, notes: string[]): SequenceSpec[] {
  const floor = Math.max(MIN_STEP_BEATS, MIN_STEP_SECONDS / secondsPerBeat);
  let moved = false;
  const out: SequenceSpec[] = [];
  for (const step of steps) {
    const previous = out[out.length - 1];
    if (previous && step.beatOffset - previous.beatOffset < floor - 1e-6) {
      out.push({ ...step, beatOffset: previous.beatOffset + floor });
      moved = true;
    } else {
      out.push({ ...step });
    }
  }
  if (moved) notes.push(`sequence steps were closer than ${floor.toFixed(2)} beats and have been spaced out`);
  return out;
}

/** Smallest gap anywhere in the phrase, including the run into the final accent. */
function minimumInterval(steps: SequenceSpec[], finalBeatOffset: number): number {
  let min = finalBeatOffset - steps[steps.length - 1].beatOffset;
  for (let i = 1; i < steps.length; i++) {
    min = Math.min(min, steps[i].beatOffset - steps[i - 1].beatOffset);
  }
  return Math.max(0.05, min);
}

/** A window authored in beats, or in milliseconds, or neither. */
function windowBeats(beats: unknown, ms: unknown, fallback: number, secondsPerBeat: number): number {
  if (typeof beats === 'number' && Number.isFinite(beats) && beats > 0) return beats;
  if (typeof ms === 'number' && Number.isFinite(ms) && ms > 0) return ms / 1000 / secondsPerBeat;
  return fallback;
}

function isCardinal(direction: string): direction is BreakoutDirection {
  return direction === 'N' || direction === 'E' || direction === 'S' || direction === 'W';
}

function readFailureMode(value: unknown): BreakoutFailureMode {
  const name = String(value ?? 'DAMAGE').toUpperCase();
  return (FAILURE_MODES as string[]).includes(name) ? (name as BreakoutFailureMode) : 'DAMAGE';
}

/** A price authored per encounter, or the severity's own. Never above `MAX_DAMAGE`. */
function readDamage(value: unknown, fallback: number): number {
  return clamp(Math.round(numberOr(value, fallback)), 0, MAX_DAMAGE);
}

function readSkin(value: unknown): SealSkinName {
  const name = String(value ?? 'SINGLE_RING').toUpperCase();
  return name in SEAL_SKINS ? (name as SealSkinName) : 'SINGLE_RING';
}

function numberOr(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

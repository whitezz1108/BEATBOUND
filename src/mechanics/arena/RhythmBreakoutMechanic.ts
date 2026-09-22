/**
 * A12 -- Rhythm Breakout (ARENA).
 *
 * The player is sealed inside a barrier with no gap, plays a short directional
 * phrase in time with the music, and breaks out on a strong beat with a
 * shockwave of their own. It is the mode's punctuation mark: built for
 * build-ups, drops and section changes, where the interesting question is not
 * "can you dodge this" but "can you play this".
 *
 *   BUILD-UP -> PRESSURE -> INPUT -> ANTICIPATION -> IMPACT -> RELEASE
 *
 * WHY THE SEAL HAS NO GAP
 * -----------------------
 * Every other radial hazard in ARENA (A04, A07, A08, A10) asks a *spatial*
 * question: find the opening, be standing in it. This one deliberately removes
 * that answer. No position on the board is safe, so the only way out is through
 * the rhythm. That is what makes it read as a set piece instead of as another
 * ring.
 *
 * WHY THE SEAL FOLLOWS THE PLAYER
 * -------------------------------
 * The seal is closed around the *body*, not around the middle of the board.
 * Every radial in this file -- the band, the teeth, the outline, the interior
 * wash, the shatter fragments, the prompt row, the burst, the collapse -- reads
 * its centre from `anchor`, which is the player's live position, and nothing
 * reads `ARENA_CENTRE`. The arena centre appears in exactly one place: as the
 * seed for `focusX`/`focusY`, so that an encounter which is never focused (a
 * headless audit, or the frame before the mode's first update) still has a
 * defined centre.
 *
 * That is what makes "no gap" fair rather than merely inescapable. A ring that
 * closed on a fixed point would demand a *walk* before the player could even
 * start reading it, and the walk would be priced into the prep window at the
 * speed of the slowest corner. A ring that closes on the player has no walk to
 * pay for: the player is already inside it, so prep is purely "time to read the
 * seal", and a level can author it as short as it likes.
 *
 * It also settles the question of where the encounter *is*. There is one
 * answer, it is wherever the player is standing, and the directional UI, the
 * particles and the shockwave all agree on it by construction.
 *
 * FAILURE IS A COLLISION, NOT A RULE
 * ----------------------------------
 * A seal that is not broken collapses through the player, and the damage
 * arrives through the ordinary ARENA collision path -- the same `hazards()`
 * every mechanic exposes, resolved by the same code that resolves a chain.
 * There is no special "you failed the QTE" channel anywhere in the game, which
 * is why adding this mechanic changed nothing in RunStatus, HealthManager or
 * the mode's collision loop. It also means the headless audits, which have no
 * input and therefore always fail the encounter, see exactly what a player who
 * stands still and does nothing would see.
 *
 * WHAT A PHRASE COSTS
 * -------------------
 * The collapse is the *bad* ending, and the price is authored rather than
 * inherited: `damageAmount` is what the seal charges, so a HEAVY encounter
 * hurts more than a LIGHT one without either of them having to pretend to be a
 * different kind of hazard. The middle ending is newer -- a phrase that was
 * fumbled but whose accent still landed -- and it has no collision to ride on,
 * because the seal opens and the player is left standing in clean air. That one
 * is charged through `drainDamage()`, which is the same bargain as the verdict
 * tally: the mechanic judges, the run charges. Both prices live in
 * `breakoutPlan.ts`, and the row on screen says what the current one is.
 *
 * Timing, parsing and every fairness clamp live in `breakoutPlan.ts`; the
 * phrase and its judging in `breakoutSequence.ts`; the ring in
 * `SealBarrier.ts`; the prompts in `breakoutUI.ts`. This file owns the state
 * machine that ties them together, and nothing else.
 *
 * Params: see `breakoutPlan.ts` and the A12 entry in mechanics.mvp.json.
 */

import { BaseMechanic, type MechanicPhase, type MechanicSpawnContext, type MechanicUpdate } from '../../core/Mechanic';
import type { SequenceDamage, SequenceEncounter, SequenceVerdict } from '../../core/capabilities';
import type { DamageSource } from '../../core/HealthManager';
import { clamp, lerp, makeRng, type Shape } from '../../core/geometry';
import { DIRECTION_ANGLE } from '../../core/direction8';
import type { Renderer } from '../../core/Renderer';
import { easeInOut, easeOutCubic } from '../../feel/Easing';
import { TUNING } from '../../tuning';
import { ARENA_CENTRE } from './polar';
import { planEncounter, type BreakoutFailureMode, type BreakoutPlan } from './breakoutPlan';
import {
  RhythmSequence, RhythmTimingJudge, type BreakoutDirection, type BreakoutVerdict,
} from './breakoutSequence';
import { SEAL_SKINS, SealBarrier, type SealPhase } from './SealBarrier';
import { bandShapes, circumradiusFor, spinAt, type SealShape } from './sealGeometry';
import {
  COUNTDOWN_BEATS, renderEncounterLabel, renderMovementLock, renderPlayerCharge, renderPromptRow, slotPosition,
} from './breakoutUI';

type Outcome = 'PENDING' | 'BROKEN' | 'FAILED';
type FinalState = 'WAITING' | 'READY' | 'HIT' | 'MISSED';

/** What a failed seal costs, in the shared damage vocabulary. */
const FAILURE_DAMAGE: Record<BreakoutFailureMode, DamageSource> = {
  LIGHT: 'MISS',
  DAMAGE: 'COLLISION',
  HEAVY: 'OBSTACLE',
};

/** Below this the movement scale is a lock, not a damp. */
const MOVEMENT_LOCK_EPSILON = 0.05;

/**
 * Beats before the accent at which the countdown starts ticking.
 *
 * The count itself lives in `breakoutUI`, which draws the arc that spans it.
 * Heard and seen are the same number by construction; two constants that had to
 * be kept equal by hand would not stay equal.
 */
const SEAL_COLOUR = '#9d7bff';
const BREAK_COLOUR = '#f7d774';
const MISS_COLOUR = '#ff5470';
const HIT_COLOUR = '#7dffb0';

export class RhythmBreakoutMechanic extends BaseMechanic implements SequenceEncounter {
  override readonly damageSource: DamageSource;
  /**
   * What an unbroken seal costs. Authored, not looked up: the level decided
   * how heavy this encounter is, and the collapse charges exactly that.
   */
  override readonly damageAmount: number;

  private readonly plan: BreakoutPlan;
  private readonly sequence: RhythmSequence;
  private readonly finalJudge: RhythmTimingJudge;
  private readonly barrier: SealBarrier;
  /** The seal's silhouette. Every radius below is an inradius; this converts. */
  private readonly shape: SealShape;
  private readonly rng: () => number;
  /** Absolute beat the seal must be broken on. */
  private readonly finalBeat: number;
  /** Absolute beat the anticipation starts -- the seal turns critical here. */
  private readonly criticalBeat: number;

  private outcome: Outcome = 'PENDING';
  private outcomeBeat = 0;
  private finalState: FinalState = 'WAITING';
  private finalChangedBeat = 0;
  /** One-shot latch for the "the next beat is the hit" cue. */
  private readyCued = false;
  /** Last whole beat the countdown ticked on, so each beat ticks once. */
  private lastTickBeat = -Infinity;
  /** Beat the accent landed on a fumbled phrase, and what it cost. */
  private partialBeat = -Infinity;
  private partialAmount = 0;
  /**
   * What the seal is closed around: the player.
   *
   * Seeded at the arena centre so an encounter that is never focused -- a
   * headless audit, or the one frame before the mode's first update -- still
   * has a defined centre, and then driven by `focusOn` every frame the mode
   * runs. Everything geometric below reads this and nothing reads ARENA_CENTRE.
   */
  private focusX = ARENA_CENTRE.x;
  private focusY = ARENA_CENTRE.y;
  /** Verdicts waiting for the mode to fold into the run's note tally. */
  private judgements: SequenceVerdict[] = [];
  /** Health waiting for the mode to charge to the run. */
  private owed: SequenceDamage[] = [];

  constructor(spawn: MechanicSpawnContext) {
    const plan = planEncounter(spawn.params, {
      secondsPerBeat: spawn.clock.secondsPerBeat,
      telegraphBeats: spawn.timing.telegraphBeats,
      gapScale: spawn.tier.gapScale,
    });
    // The plan *is* the timing: prep is the telegraph, and the active window
    // runs from the first step to the end of the resolution.
    super({
      ...spawn,
      timing: {
        telegraphBeats: plan.prepBeats,
        durationBeats: plan.finalBeatOffset + plan.releaseBeats,
        recoveryBeats: 0,
      },
    });

    this.plan = plan;
    this.damageSource = FAILURE_DAMAGE[plan.failureMode];
    this.damageAmount = plan.accentMissDamage;
    this.rng = makeRng(spawn.seed);
    this.sequence = new RhythmSequence(plan.steps, this.activationBeat);
    this.finalJudge = new RhythmTimingJudge(plan.perfectBeats, plan.finalGoodBeats);
    this.finalBeat = this.activationBeat + plan.finalBeatOffset;
    this.criticalBeat = Math.max(this.sequence.lastBeat, this.finalBeat - 2);
    const skin = SEAL_SKINS[plan.skin];
    this.shape = skin.shape;
    this.barrier = new SealBarrier(skin, plan.thickness);

    for (const note of plan.notes) {
      console.warn(`[A12 ${spawn.definition.id}@${this.activationBeat}] ${note}`);
    }
  }

  // ---- encounter capability ----------------------------------------------

  /**
   * Directional keys belong to the encounter from the moment the seal appears
   * until it resolves.
   *
   * It starts at the *telegraph* rather than at the first step on purpose: the
   * prompts are already on screen during the build-up, and a player who starts
   * tapping along with them a beat early should be practising the phrase, not
   * walking into the wall they are about to have to break.
   */
  capturesInput(beat: number): boolean {
    if (this.outcome !== 'PENDING') return beat < this.outcomeBeat + 0.5;
    return beat >= this.telegraphStartBeat && beat <= this.finalBeat + this.plan.finalGoodBeats;
  }

  movementScale(beat: number): number {
    return this.capturesInput(beat) ? this.plan.movementScale : 1;
  }

  /**
   * The seal holds the arena for the whole *authored* phrase, not for the
   * nominal duration the library declares.
   *
   * A12's library entry is sized for the default six-beat phrase; a level that
   * charts a four-bar encounter is sealed in for four bars. Both ends move: the
   * prep window is stretched at load time by the fairness clamp, and the seal
   * only lets go of the player `releaseBeats` after the accent. A dead-air
   * check reading the nominal numbers would call the back half of every long
   * encounter silent while the player is still sealed inside it.
   */
  override get presenceWindow(): { from: number; to: number } {
    return {
      from: this.activationBeat - this.plan.prepBeats,
      to: this.finalBeat + this.plan.releaseBeats,
    };
  }

  focusOn(x: number, y: number): void {
    this.focusX = x;
    this.focusY = y;
  }

  /**
   * True: this encounter's hazard is built around the player, not the arena.
   *
   * The headless audits model a motionless player standing at a sampled
   * position. For an ordinary ring that means comparing the ring's fixed
   * geometry against the body; for a seal it means the ring *moves with* the
   * body, so the only meaningful comparison is against a body at the seal's own
   * centre. Declaring it here is what lets `camp-audit` ask the right question
   * instead of reporting a corner the seal never reaches.
   *
   * See `isPlayerAnchored` in `core/capabilities.ts` for the reading side.
   */
  readonly playerAnchored = true;

  /** Where the seal is closed around right now. */
  get anchor(): { x: number; y: number } {
    return { x: this.focusX, y: this.focusY };
  }

  pressDirection(direction: BreakoutDirection, beat: number): void {
    if (this.outcome !== 'PENDING') return;
    const result = this.sequence.press(direction, beat);
    if (!result) return;
    // +1: the row the particle lands on includes the SPACE slot at its end.
    const at = slotPosition(result.index, this.sequence.length + 1, this.anchor);
    if (result.verdict === 'MISS') this.cueStepMiss(at);
    else this.cueStepHit(at, result.verdict, direction);
  }

  pressConfirm(beat: number): void {
    if (this.outcome !== 'PENDING' || this.finalState === 'HIT') return;
    if (!this.finalJudge.inWindow(beat - this.finalBeat)) return;
    if (!this.breakable) {
      // The seal took too many misses to break. The press still answers, so
      // the player learns that they pressed correctly and it was the phrase
      // that failed them, not their timing on the accent. The price of that
      // phrase is the seal's own -- it collapses on them in a moment, and
      // charges `damageAmount` when it does.
      this.feel.sfx('miss');
      return;
    }
    this.breakSeal(beat);
  }

  drainJudgements(): SequenceVerdict[] {
    const drained = this.judgements;
    this.judgements = [];
    return drained;
  }

  drainDamage(): SequenceDamage[] {
    const drained = this.owed;
    this.owed = [];
    return drained;
  }

  get encounterLabel(): string {
    const state = this.outcome === 'BROKEN' ? 'BROKEN' : this.outcome === 'FAILED' ? 'FAILED' : 'live';
    return `seal ${this.sequence.hits}/${this.sequence.length} miss:${this.sequence.misses} ${state}`;
  }

  /** False once the phrase has taken more misses than the seal tolerates. */
  private get breakable(): boolean {
    return this.sequence.misses <= this.plan.maxMisses;
  }

  // ---- lifecycle ----------------------------------------------------------

  protected override onUpdate(u: MechanicUpdate): void {
    const beat = u.beat;
    this.barrier.update(u.deltaSeconds);

    if (this.outcome === 'PENDING' && beat >= this.telegraphStartBeat) {
      // Steps never expire on their own -- the phrase is untimed, only the
      // final accent is on the beat -- so update only refreshes UI state.
      this.sequence.update(beat);
      this.updateFinal(beat);
      this.updateCountdown(beat);
    }

  }

  /**
   * The audible clock on the accent.
   *
   * The ring closing on the SPACE target is a clock, but a clock has to be
   * *read*: it says how much time is left only to someone already watching it.
   * The ticks say the same thing to someone who looked up late -- three ticks,
   * then the charge sting on the last beat, then the accent -- and they are
   * deliberately quiet, because they are counting over the music rather than
   * competing with it.
   *
   * One tick per whole beat, on the *song's* beat rather than the visual one,
   * so a hit-stop cannot smear the count. Only the ticks that are actually
   * counting are played: once the phrase is past the seal's tolerance there is
   * no accent left to hit, and ticking through a deadline the player can no
   * longer meet would be a lie told in the one channel they cannot re-read.
   */
  private updateCountdown(beat: number): void {
    if (!this.breakable) return;
    if (beat >= this.finalBeat) return;
    const whole = Math.floor(beat);
    if (whole <= this.lastTickBeat) return;
    this.lastTickBeat = whole;
    // The last beat belongs to `seal_charge`, which is the one that has to
    // cut through; a tick on top of it would only blunt it.
    if (this.finalBeat - whole <= 1) return;
    if (this.finalBeat - whole > COUNTDOWN_BEATS) return;
    this.feel.sfx('hold_tick', 1.6);
  }

  /** The accent's own little state machine: waiting, ready, then resolved. */
  private updateFinal(beat: number): void {
    if (this.finalState === 'HIT') return;

    const readyFrom = this.finalBeat - Math.max(1, this.plan.finalGoodBeats * 2);
    if (this.finalState === 'WAITING' && beat >= readyFrom) {
      this.finalState = 'READY';
      this.finalChangedBeat = beat;
    }
    if (!this.readyCued && beat >= this.finalBeat - 1) {
      this.readyCued = true;
      this.feel.sfx(this.breakable ? 'seal_charge' : 'miss', 0.9);
    }
    if (beat > this.finalBeat + this.plan.finalGoodBeats) {
      this.finalState = 'MISSED';
      this.finalChangedBeat = beat;
      this.failSeal(beat);
    }
  }

  protected override onPhaseChange(_from: MechanicPhase, to: MechanicPhase, beat: number): void {
    if (to === 'TELEGRAPH') {
      // The seal locking on. Loud enough to be an event, not an attack.
      this.feel.sfx('seal_form');
      this.feel.impact('MEDIUM', {
        x: this.focusX, y: this.focusY, colour: SEAL_COLOUR, shockwave: true, particles: false,
      });
    }
    if (to === 'ACTIVE') {
      this.feel.sfx('laser_charge', 0.45);
      this.feel.emit(this.focusX, this.focusY, {
        count: 14, speed: 0.5, colour: SEAL_COLOUR, size: 0.006, life: 0.5, shape: 'spark',
      });
    }
    void beat;
  }

  // ---- resolution ---------------------------------------------------------

  /**
   * The payoff.
   *
   * Layered on purpose, and all of it anchored to the *player's* position
   * rather than to the centre of the arena: the flash, the two shockwaves and
   * the shard spray all start on the body, and the ring breaks where the wave
   * reaches it. The player caused this.
   *
   * The accent detonates where it was *pressed*, too -- on the SPACE slot at
   * the end of the row. That is the other half of the read: the wave says the
   * seal is gone, the burst on the target says which key did it, and a player
   * who got it right by a hair learns where the line was.
   */
  private breakSeal(beat: number): void {
    const verdict: BreakoutVerdict = this.finalJudge.verdict(beat - this.finalBeat);
    this.outcome = 'BROKEN';
    this.outcomeBeat = beat;
    this.finalState = 'HIT';
    this.finalChangedBeat = beat;

    // The accent is a scored input too -- the biggest one in the encounter.
    this.judgements.push(verdict);
    // A phrase that was not fully played but was saved by the accent still
    // costs something. Charged here rather than by the seal, because the seal
    // is about to come apart: the player got out, and this is the price of the
    // steps they did not play.
    //
    // The test is `hits < length` and not `misses > 0`, because a step the
    // player never touched is not a miss -- it never expired, so nothing was
    // scored against it -- but it is emphatically not a step they played. Left
    // as `misses > 0`, a player could stand still through the whole phrase and
    // press SPACE on the beat for a free break, which is the exact behaviour
    // the price exists to rule out.
    if (this.sequence.hits < this.sequence.length) this.chargePartial(beat);

    this.barrier.shatter(this.circumradiusAt(beat), spinAt(this.shape, beat), this.rng);
    // A beat of silence before the wave. Longer for a PERFECT, because the
    // freeze is the reward and a player who nailed it should get more of it.
    this.feel.hitStop(TUNING.hitStop.sealBreakSeconds * (verdict === 'PERFECT' ? 1.25 : 1));
    this.feel.sfx('seal_break');
    this.feel.sfx('seal_shatter', 0.9);
    // HEAVY carries the camera kick, the vignette and the hit-stop-adjacent
    // weight the moment needs; the extra rings shape it into a release.
    this.feel.impact('HEAVY', {
      x: this.focusX, y: this.focusY, colour: BREAK_COLOUR, particles: false,
    });
    this.feel.shockwave(this.focusX, this.focusY, 0.55, BREAK_COLOUR, 0.45, 5);
    this.feel.shockwave(this.focusX, this.focusY, 0.8, SEAL_COLOUR, 0.6, 3);
    this.feel.emit(this.focusX, this.focusY, {
      count: verdict === 'PERFECT' ? 44 : 32,
      speed: 1.15, speedJitter: 0.5, colour: BREAK_COLOUR,
      size: 0.011, life: 0.65, shape: 'shard',
    });
    this.feel.emit(this.focusX, this.focusY, {
      count: 18, speed: 0.6, colour: SEAL_COLOUR, size: 0.007, life: 0.8, shape: 'spark',
    });
    this.cueAccentHit(verdict);
  }

  /**
   * The accent landed: a burst on the SPACE slot itself.
   *
   * Deliberately lighter than the break it triggers. The break is the event;
   * this is the *receipt*, placed on the glyph the player's finger was on, and
   * it is sized so the two read as one gesture rather than two explosions.
   */
  private cueAccentHit(verdict: BreakoutVerdict): void {
    const at = slotPosition(this.sequence.length, this.sequence.length + 1, this.anchor);
    const perfect = verdict === 'PERFECT';
    this.feel.shockwave(at.x, at.y, perfect ? 0.3 : 0.22, '#ffffff', 0.4, perfect ? 4 : 3);
    this.feel.emit(at.x, at.y, {
      count: perfect ? 26 : 18,
      speed: 0.75, speedJitter: 0.4,
      colour: perfect ? BREAK_COLOUR : '#ffffff',
      size: 0.008, life: 0.5, shape: 'spark',
    });
  }

  /**
   * The phrase was fumbled, the accent was not: what that costs.
   *
   * The seal still opens, so there is no collision to carry the price -- the
   * run is handed the debt instead. The feedback is a *sting* rather than a
   * hit: no hit-stop and no camera kick, because the player just earned the
   * loudest moment in the encounter and a red flash over it would read as the
   * break having failed. It is the row that says what happened, by turning red
   * where the steps were missed and printing the price next to the accent.
   */
  private chargePartial(beat: number): void {
    const amount = this.plan.missDamage;
    if (amount > 0) this.owed.push({ source: this.damageSource, amount });
    this.feel.sfx('miss', 0.55);
    this.feel.emit(this.focusX, this.focusY, {
      count: 10, speed: 0.45, colour: MISS_COLOUR, size: 0.006, life: 0.45, shape: 'spark',
    });
    this.partialBeat = beat;
    this.partialAmount = amount;
  }

  /**
   * The seal wins: it keeps closing, and the collapse does the talking.
   *
   * No damage is charged here. The collapse *is* the charge -- the band
   * sweeps through the body a moment later and the mode bills it at
   * `damageAmount` -- which keeps this failure on the same path as every
   * other hazard in the game and keeps the headless audits honest, since a
   * player who never presses anything is exactly what they simulate.
   *
   * What this adds is the warning: the accent is gone, and the player has one
   * beat of collapse to understand that the thing now coming down on them is
   * the price of it. The red rings are that sentence.
   */
  private failSeal(beat: number): void {
    this.outcome = 'FAILED';
    this.outcomeBeat = beat;
    this.judgements.push('MISS');
    this.feel.sfx('miss');
    // The collapse happens *on* the player, so the impact reads from where they
    // are standing rather than from the middle of the board.
    this.feel.impact('MEDIUM', {
      x: this.focusX, y: this.focusY, colour: MISS_COLOUR, particles: false,
    });
    this.feel.shockwave(this.focusX, this.focusY, 0.3, MISS_COLOUR, 0.5, 3);
    this.feel.emit(this.focusX, this.focusY, {
      count: 16, speed: 0.5, colour: MISS_COLOUR, size: 0.007, life: 0.5, shape: 'spark',
    });
  }

  /**
   * A step landed: the row's half of the encounter's feedback.
   *
   * The diamond already punches and turns green in `breakoutUI.ts`, but the
   * row sits low and the player is watching the seal, so the press has to be
   * legible from the middle of the board as well. Two things do that: a ring
   * that marks the glyph as *resolved* rather than merely recoloured, and a
   * spray thrown the way the arrow pointed -- which is the read that ties the
   * key the player hit to the prompt they hit it on.
   */
  private cueStepHit(at: { x: number; y: number }, verdict: BreakoutVerdict, direction: BreakoutDirection): void {
    this.judgements.push(verdict);
    const colour = verdict === 'PERFECT' ? BREAK_COLOUR : HIT_COLOUR;
    this.feel.sfx(verdict === 'PERFECT' ? 'direction_perfect' : 'direction_hit');
    this.feel.impact('LIGHT', { x: at.x, y: at.y, colour });
    this.feel.shockwave(at.x, at.y, 0.14, colour, 0.3, 2);
    this.feel.emit(at.x, at.y, {
      count: 12, speed: 0.6, speedJitter: 0.3, colour,
      size: 0.007, life: 0.4, shape: 'spark',
      direction: DIRECTION_ANGLE[direction], spread: Math.PI * 0.5,
    });
  }

  private cueStepMiss(at: { x: number; y: number }): void {
    this.judgements.push('MISS');
    this.feel.sfx('miss', 0.8);
    this.feel.shockwave(at.x, at.y, 0.12, MISS_COLOUR, 0.28, 2);
    this.feel.emit(at.x, at.y, {
      count: 8, speed: 0.4, colour: MISS_COLOUR, size: 0.006, life: 0.4, shape: 'spark',
    });
  }

  // ---- geometry -----------------------------------------------------------

  /**
   * Radius of the hazard band.
   *
   * One monotonic contraction from the spawn radius to the critical radius,
   * landing on the critical radius *at* the final beat -- never before it,
   * which is the guarantee that the seal cannot kill the player while they
   * still have inputs left. What happens afterwards depends on who won.
   */
  private radiusAt(beat: number): number {
    const { startRadius, criticalRadius, collapseBeats } = this.plan;

    if (this.outcome === 'BROKEN') {
      // Blown outward by the shockwave. The band itself stops existing; this
      // is only where the fragments were thrown from.
      return criticalRadius + (beat - this.outcomeBeat) * 1.2;
    }
    if (this.outcome === 'FAILED') {
      const t = clamp((beat - this.outcomeBeat) / collapseBeats, 0, 1);
      return criticalRadius * (1 - easeOutCubic(t));
    }
    if (beat < this.activationBeat) {
      // Forming: hangs just outside its final spawn radius and settles in.
      return startRadius * (1 + 0.07 * (1 - this.telegraphProgress(beat)));
    }
    const t = clamp((beat - this.activationBeat) / Math.max(0.01, this.plan.finalBeatOffset), 0, 1);
    return lerp(startRadius, criticalRadius, easeInOut(t));
  }

  private sealPhase(beat: number): SealPhase {
    if (this.outcome === 'BROKEN') return 'SHATTER';
    if (this.outcome === 'FAILED') return this.radiusAt(beat) <= 0.005 ? 'GONE' : 'COLLAPSE';
    if (beat < this.telegraphStartBeat) return 'DORMANT';
    if (beat < this.activationBeat) {
      return this.telegraphProgress(beat) < 0.35 ? 'SPAWN' : 'FORMING';
    }
    return beat >= this.criticalBeat ? 'CRITICAL' : 'CLOSING';
  }

  /** 0..1 -- how far the walls have come in. */
  private pressure(beat: number): number {
    const span = Math.max(0.001, this.plan.startRadius - this.plan.criticalRadius);
    return clamp((this.plan.startRadius - this.radiusAt(beat)) / span, 0, 1);
  }

  /**
   * 0..1 -- how close the final accent is. 1 on the beat itself.
   *
   * Deliberately spans the whole phrase rather than the last beat or two. This
   * is the row's clock -- the approach ring's radius *is* this number -- and a
   * clock that only appears once the deadline is in sight tells the player
   * nothing they can act on. The seal's own tension reads the same ramp, so the
   * cage tightens and the ring closes together, and both arrive on the accent.
   */
  private charge(beat: number): number {
    if (this.outcome !== 'PENDING') return 0;
    const span = Math.max(0.5, this.finalBeat - this.activationBeat);
    return clamp(1 - (this.finalBeat - beat) / span, 0, 1);
  }

  /** The band's circumradius, which is what the geometry actually runs on. */
  private circumradiusAt(beat: number): number {
    return circumradiusFor(this.shape, this.radiusAt(beat));
  }

  protected dangerShapes(): Shape[] {
    // Broken seals and finished collapses are scenery. Everything else is a
    // wall with no way through it, in whatever silhouette the skin chose --
    // the same samples the renderer draws from, so what is drawn is what hurts.
    if (this.outcome === 'BROKEN') return [];
    const beat = this.spawn.clock.absoluteBeat;
    if (this.radiusAt(beat) <= 0.005) return [];
    return bandShapes(
      this.shape, this.circumradiusAt(beat), this.plan.thickness, spinAt(this.shape, beat),
      this.anchor,
    );
  }

  // ---- presentation -------------------------------------------------------

  render(r: Renderer): void {
    const beat = this.spawn.clock.visualBeat;
    if (this.phase === 'SCHEDULED') return;

    // Drawing state is computed at draw time, on the *visual* beat, so a
    // hit-stop freezes the seal along with everything else while collision
    // keeps reading the real one.
    this.barrier.set({
      centre: this.anchor,
      radius: this.circumradiusAt(beat),
      spin: spinAt(this.shape, beat),
      phase: this.sealPhase(beat),
      pressure: this.pressure(beat),
      charge: this.charge(beat),
    });
    this.barrier.render(r, beat);

    const reveal = this.revealAlpha(beat);
    if (reveal <= 0.01) return;

    // The heading keeps saying what the encounter *is*; only its colour
    // changes when the seal destabilises. The accent below carries the
    // "unstable" wording, and saying it twice on one screen reads as a bug.
    renderEncounterLabel(
      r,
      this.outcome === 'BROKEN' ? 'SEAL BROKEN' : 'RHYTHM SEAL',
      this.outcome === 'BROKEN' ? BREAK_COLOUR : this.breakable ? SEAL_COLOUR : MISS_COLOUR,
      reveal * 0.8,
      this.anchor,
      this.tally,
    );
    // One row, dance-game style: the arrows and the SPACE target at their far
    // end are a single widget -- and it hangs off the player, so the phrase
    // reads as *theirs*. There is no judgement track under it: the direction
    // presses are untimed, so the accent is the row's only clock.
    renderPromptRow(r, {
      anchor: this.anchor,
      steps: this.sequence.steps,
      beat,
      startBeat: this.activationBeat,
      finalBeat: this.finalBeat,
      finalGoodBeats: this.plan.finalGoodBeats,
      reveal,
      charge: this.charge(beat),
      finalState: this.finalState,
      finalChangedBeat: this.finalChangedBeat,
      breakable: this.breakable,
      keyLabel: 'SPACE',
      missDamage: this.plan.missDamage,
      accentMissDamage: this.plan.accentMissDamage,
      partialBeat: this.partialBeat,
      partialAmount: this.partialAmount,
    });
  }

  /**
   * Overlay, drawn after the avatar: the charge the player is holding, and the
   * wave that leaves them when they let it go.
   */
  renderOverlay(r: Renderer, beat: number): void {
    if (this.phase === 'SCHEDULED' || this.phase === 'FINISHED') return;

    if (this.outcome === 'PENDING') {
      // A locked encounter has to say so, or a frozen avatar reads as a bug.
      if (this.plan.movementScale <= MOVEMENT_LOCK_EPSILON) {
        renderMovementLock(r, this.focusX, this.focusY, this.lockReveal(beat), beat);
      }
      renderPlayerCharge(r, this.focusX, this.focusY, this.charge(beat), beat);
      return;
    }
    if (this.outcome !== 'BROKEN') return;

    // The link between the body and the ring: three rings leaving the player,
    // staggered, reaching the seal's radius at the moment it comes apart.
    const age = beat - this.outcomeBeat;
    if (age > 1.2) return;
    for (let i = 0; i < 3; i++) {
      const t = clamp((age - i * 0.08) / 0.9, 0, 1);
      if (t <= 0) continue;
      r.strokeCircle(
        this.focusX, this.focusY, easeOutCubic(t) * (0.5 + i * 0.12),
        i === 0 ? '#ffffff' : BREAK_COLOUR, 4 - i, (1 - t) * (i === 0 ? 0.8 : 0.5),
      );
    }
    r.glow(this.focusX, this.focusY, 0.12 * (1 - age / 1.2), '#ffffff', 0.5 * (1 - age / 1.2));
  }

  /** The encounter's own scoreboard: landed steps, and misses when there are any. */
  private get tally(): string {
    const missed = this.sequence.misses;
    const base = `${this.sequence.hits} / ${this.sequence.length}`;
    if (missed === 0) return base;
    return `${base}  ·  ${missed} miss${missed === 1 ? '' : 'es'} of ${this.plan.maxMisses} allowed`;
  }

  /** Prompts fade in with the seal and fade out once it is resolved. */
  private revealAlpha(beat: number): number {
    if (this.outcome === 'BROKEN') return clamp(1 - (beat - this.outcomeBeat) / 0.8, 0, 1);
    if (this.outcome === 'FAILED') return clamp(1 - (beat - this.outcomeBeat) / 0.6, 0, 1);
    if (beat < this.activationBeat) return clamp(this.telegraphProgress(beat) * 2.5, 0, 1);
    return 1;
  }

  /**
   * The movement lock's fade.
   *
   * Held through the whole encounter, including the collapse: the player is
   * still rooted while the seal is coming down on them, and dropping the cue at
   * that moment would be the one instant the player most needs to know why they
   * cannot run.
   */
  private lockReveal(beat: number): number {
    if (this.outcome === 'FAILED') return clamp(1 - (beat - this.outcomeBeat) / 0.6, 0, 1);
    return this.revealAlpha(beat);
  }
}

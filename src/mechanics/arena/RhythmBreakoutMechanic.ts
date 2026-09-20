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
 * that answer. Movement is still live -- the avatar is not frozen, because a
 * game that takes the controls away mid-song feels broken rather than tense --
 * but no position on the board is safe, so the only way out is through the
 * rhythm. That is what makes it read as a set piece instead of as another ring.
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
 * Timing, parsing and every fairness clamp live in `breakoutPlan.ts`; the
 * phrase and its judging in `breakoutSequence.ts`; the ring in
 * `SealBarrier.ts`; the prompts in `breakoutUI.ts`. This file owns the state
 * machine that ties them together, and nothing else.
 *
 * Params: see `breakoutPlan.ts` and the A12 entry in mechanics.mvp.json.
 */

import { BaseMechanic, type MechanicPhase, type MechanicSpawnContext, type MechanicUpdate } from '../../core/Mechanic';
import type { SequenceEncounter, SequenceVerdict } from '../../core/capabilities';
import type { DamageSource } from '../../core/HealthManager';
import { clamp, lerp, makeRng, type Shape } from '../../core/geometry';
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
  renderEncounterLabel, renderFinalIndicator, renderPlayerCharge, renderSequenceRow, slotPosition,
} from './breakoutUI';

type Outcome = 'PENDING' | 'BROKEN' | 'FAILED';
type FinalState = 'WAITING' | 'READY' | 'HIT' | 'MISSED';

/** What a failed seal costs, in the shared damage vocabulary. */
const FAILURE_DAMAGE: Record<BreakoutFailureMode, DamageSource> = {
  LIGHT: 'MISS',
  DAMAGE: 'COLLISION',
  HEAVY: 'OBSTACLE',
};

const SEAL_COLOUR = '#9d7bff';
const BREAK_COLOUR = '#f7d774';
const MISS_COLOUR = '#ff5470';

export class RhythmBreakoutMechanic extends BaseMechanic implements SequenceEncounter {
  override readonly damageSource: DamageSource;

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
  private focusX = ARENA_CENTRE.x;
  private focusY = ARENA_CENTRE.y;
  /** Verdicts waiting for the mode to fold into the run's note tally. */
  private judgements: SequenceVerdict[] = [];

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
    this.rng = makeRng(spawn.seed);
    this.sequence = new RhythmSequence(
      plan.steps,
      this.activationBeat,
      new RhythmTimingJudge(plan.perfectBeats, plan.goodBeats),
    );
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

  focusOn(x: number, y: number): void {
    this.focusX = x;
    this.focusY = y;
  }

  pressDirection(direction: BreakoutDirection, beat: number): void {
    if (this.outcome !== 'PENDING') return;
    const result = this.sequence.press(direction, beat);
    if (!result) return;
    const at = slotPosition(result.index, this.sequence.length, this.collapse(beat));
    if (result.verdict === 'MISS') this.cueStepMiss(at);
    else this.cueStepHit(at, result.verdict);
  }

  pressConfirm(beat: number): void {
    if (this.outcome !== 'PENDING' || this.finalState === 'HIT') return;
    if (!this.finalJudge.inWindow(beat - this.finalBeat)) return;
    if (!this.breakable) {
      // The seal took too many misses to break. The press still answers, so
      // the player learns that they pressed correctly and it was the phrase
      // that failed them, not their timing on the accent.
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
      for (const step of this.sequence.update(beat)) {
        const index = this.sequence.steps.indexOf(step);
        this.cueStepMiss(slotPosition(index, this.sequence.length, this.collapse(beat)));
      }
      this.updateFinal(beat);
    }

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
        x: ARENA_CENTRE.x, y: ARENA_CENTRE.y, colour: SEAL_COLOUR, shockwave: true, particles: false,
      });
    }
    if (to === 'ACTIVE') {
      this.feel.sfx('laser_charge', 0.45);
      this.feel.emit(ARENA_CENTRE.x, ARENA_CENTRE.y, {
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
   */
  private breakSeal(beat: number): void {
    const verdict: BreakoutVerdict = this.finalJudge.verdict(beat - this.finalBeat);
    this.outcome = 'BROKEN';
    this.outcomeBeat = beat;
    this.finalState = 'HIT';
    this.finalChangedBeat = beat;

    // The accent is a scored input too -- the biggest one in the encounter.
    this.judgements.push(verdict);
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
  }

  /** The seal wins: it keeps closing, and the collapse does the talking. */
  private failSeal(beat: number): void {
    this.outcome = 'FAILED';
    this.outcomeBeat = beat;
    this.judgements.push('MISS');
    this.feel.sfx('miss');
    this.feel.impact('MEDIUM', {
      x: ARENA_CENTRE.x, y: ARENA_CENTRE.y, colour: MISS_COLOUR, particles: false,
    });
  }

  private cueStepHit(at: { x: number; y: number }, verdict: BreakoutVerdict): void {
    this.judgements.push(verdict);
    this.feel.sfx(verdict === 'PERFECT' ? 'direction_perfect' : 'direction_hit');
    this.feel.impact('LIGHT', { x: at.x, y: at.y, colour: verdict === 'PERFECT' ? BREAK_COLOUR : '#7dffb0' });
  }

  private cueStepMiss(at: { x: number; y: number }): void {
    this.judgements.push('MISS');
    this.feel.sfx('miss', 0.8);
    this.feel.shockwave(at.x, at.y, 0.12, MISS_COLOUR, 0.28, 2);
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

  /** 0..1 -- how close the final accent is. 1 on the beat itself. */
  private charge(beat: number): number {
    if (this.outcome !== 'PENDING') return 0;
    const span = Math.max(0.5, this.finalBeat - this.criticalBeat);
    return clamp(1 - (this.finalBeat - beat) / span, 0, 1);
  }

  /** 0..1 -- how far the prompt row has collapsed into the final accent. */
  private collapse(beat: number): number {
    if (this.outcome === 'BROKEN') return 1;
    const from = this.sequence.lastBeat;
    const span = Math.max(0.25, this.finalBeat - from);
    return clamp((beat - from) / span, 0, 1);
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
      this.tally,
    );
    renderSequenceRow(r, {
      steps: this.sequence.steps,
      beat,
      goodBeats: this.plan.goodBeats,
      startBeat: this.activationBeat,
      finalBeat: this.finalBeat,
      reveal,
      collapse: this.collapse(beat),
    });
    r.withAlpha(reveal, () => {
      renderFinalIndicator(r, {
        beat,
        finalBeat: this.finalBeat,
        charge: this.charge(beat),
        state: this.finalState,
        changedBeat: this.finalChangedBeat,
        breakable: this.breakable,
        keyLabel: 'SPACE',
      });
    });
  }

  /**
   * Overlay, drawn after the avatar: the charge the player is holding, and the
   * wave that leaves them when they let it go.
   */
  renderOverlay(r: Renderer, beat: number): void {
    if (this.phase === 'SCHEDULED' || this.phase === 'FINISHED') return;

    if (this.outcome === 'PENDING') {
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
}

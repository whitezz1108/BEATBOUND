/**
 * The runtime-mechanic contract.
 *
 * Every dangerous thing in BeatBound -- in any mode -- moves through the same
 * lifecycle, expressed entirely in beats:
 *
 *   SCHEDULED -> TELEGRAPH -> ACTIVE -> RECOVERY -> FINISHED
 *
 * The telegraph window is mandatory readability budget (see the Telegraphing
 * Rule): the player should know where danger will land before it lands.
 */

import type { BeatClock } from './BeatClock';
import type { Shape } from './geometry';
import type { Renderer } from './Renderer';
import type { EventRole, MechanicDefinition, ParamBag } from './types';
import type { DamageSource } from './HealthManager';
import type { FeelSink } from '../feel/FeelSink';
import type { ArenaTier } from '../mechanics/arena/arenaTiming';

export type MechanicPhase = 'SCHEDULED' | 'TELEGRAPH' | 'ACTIVE' | 'RECOVERY' | 'FINISHED';

/** Beat-denominated timing after intensity scaling and pattern-constraint clamping. */
export interface ResolvedTiming {
  telegraphBeats: number;
  durationBeats: number;
  recoveryBeats: number;
}

/** Everything a mechanic needs at construction time. Built by MechanicRegistry. */
export interface MechanicSpawnContext {
  definition: MechanicDefinition;
  /** mechanic.defaults merged with the pattern event's `params`. */
  params: ParamBag;
  timing: ResolvedTiming;
  /** Absolute beat at which the mechanic becomes dangerous. */
  activationBeat: number;
  /** 0..1 from the level's pattern placement. */
  intensity: number;
  /** DUO-ready: which player this event belongs to. */
  role: EventRole;
  /** Deterministic seed derived from level + pattern + event position. */
  seed: number;
  clock: BeatClock;
  /** Where a mechanic asks for camera, particle and audio response. */
  feel: FeelSink;
  /** Readability budget from the section's difficulty. See arenaTiming.ts. */
  tier: ArenaTier;
}

export interface MechanicUpdate {
  /** Current absolute beat from BeatClock. */
  beat: number;
  /** Seconds into the song. Used for anything measured in real time. */
  songTime: number;
  /** Real seconds since last frame (for interpolation only, never for rhythm). */
  deltaSeconds: number;
  secondsPerBeat: number;
}

export interface RuntimeMechanic {
  readonly definitionId: string;
  readonly role: EventRole;
  /** What this costs when it connects. Modes read it instead of guessing. */
  readonly damageSource: DamageSource;
  readonly phase: MechanicPhase;
  readonly isFinished: boolean;
  update(u: MechanicUpdate): void;
  /** Damaging shapes *right now*. Empty unless the mechanic is dangerous. */
  hazards(): Shape[];
  render(r: Renderer): void;
}

/** Shared lifecycle bookkeeping. Subclasses only supply visuals + hazard shapes. */
export abstract class BaseMechanic implements RuntimeMechanic {
  readonly definitionId: string;
  readonly role: EventRole;
  /** Overridden by anything fired at the player or run into at speed. */
  readonly damageSource: DamageSource = 'COLLISION';
  protected readonly params: ParamBag;
  protected readonly timing: ResolvedTiming;
  protected readonly activationBeat: number;
  protected readonly intensity: number;
  protected readonly seed: number;
  protected readonly feel: FeelSink;
  protected readonly tier: ArenaTier;

  private _phase: MechanicPhase = 'SCHEDULED';

  constructor(protected readonly spawn: MechanicSpawnContext) {
    this.definitionId = spawn.definition.id;
    this.role = spawn.role;
    this.params = spawn.params;
    this.timing = spawn.timing;
    this.activationBeat = spawn.activationBeat;
    this.intensity = spawn.intensity;
    this.seed = spawn.seed;
    this.feel = spawn.feel;
    this.tier = spawn.tier;
  }

  get telegraphStartBeat(): number { return this.activationBeat - this.timing.telegraphBeats; }
  get activeEndBeat(): number { return this.activationBeat + this.timing.durationBeats; }
  get recoveryEndBeat(): number { return this.activeEndBeat + this.timing.recoveryBeats; }

  get phase(): MechanicPhase { return this._phase; }
  get isFinished(): boolean { return this._phase === 'FINISHED'; }
  get isDangerous(): boolean { return this._phase === 'ACTIVE'; }

  /** 0..1 through the telegraph window (1 == about to activate). */
  protected telegraphProgress(beat: number): number {
    const span = this.timing.telegraphBeats;
    if (span <= 0) return 1;
    return Math.min(1, Math.max(0, (beat - this.telegraphStartBeat) / span));
  }

  /** 0..1 through the active window. */
  protected activeProgress(beat: number): number {
    const span = this.timing.durationBeats;
    if (span <= 0) return beat >= this.activationBeat ? 1 : 0;
    return Math.min(1, Math.max(0, (beat - this.activationBeat) / span));
  }

  update(u: MechanicUpdate): void {
    const previous = this._phase;
    this._phase = this.computePhase(u.beat);
    if (previous !== this._phase) this.onPhaseChange(previous, this._phase, u.beat);
    this.onUpdate(u);
  }

  /**
   * Hook for the presentation grammar: subclasses fire their anticipation cue
   * entering TELEGRAPH, their impact entering ACTIVE, and their settle entering
   * RECOVERY, without every one of them re-deriving the transition.
   */
  protected onPhaseChange(_from: MechanicPhase, _to: MechanicPhase, _beat: number): void {}

  private computePhase(beat: number): MechanicPhase {
    if (beat < this.telegraphStartBeat) return 'SCHEDULED';
    if (beat < this.activationBeat) return 'TELEGRAPH';
    if (beat < this.activeEndBeat) return 'ACTIVE';
    if (beat < this.recoveryEndBeat) return 'RECOVERY';
    return 'FINISHED';
  }

  hazards(): Shape[] {
    return this.isDangerous ? this.dangerShapes() : [];
  }

  /** Per-frame hook for subclasses. */
  protected onUpdate(_u: MechanicUpdate): void {}
  /** Shapes that damage the player while ACTIVE. */
  protected abstract dangerShapes(): Shape[];
  abstract render(r: Renderer): void;
}

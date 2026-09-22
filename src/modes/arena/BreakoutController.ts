/**
 * The ARENA input context for rhythm encounters (A12).
 *
 * ARENA's controls are movement, and exactly one mechanic wants them to mean
 * something else for a few bars. Rather than teaching the mode about that
 * mechanic, it talks to the `SequenceEncounter` capability: it asks whichever
 * live mechanics want directional input, forwards the presses, and reports how
 * much walking speed the player keeps while that is true.
 *
 * THE RULES THAT KEEP THE CONTROLS HONEST
 * ---------------------------------------
 *   - *Nothing latches.* Capture is recomputed from the beat every frame, so
 *     an encounter that finishes -- or one that is torn down mid-flight by a
 *     death or a mode change -- cannot leave a key captured, a speed modifier
 *     applied, or an axis disabled. There is no restore step because there is
 *     no stored state to restore.
 *   - *While an encounter is capturing, every directional key is the phrase.*
 *     Arrows and WASD alike press their cardinal into the sequence, dance-pad
 *     style, and movement is suspended: the seal has no gap, so there is
 *     nowhere to walk to anyway. The moment it ends, both families steer
 *     again, exactly as before.
 *   - *Edges only.* Presses are read with `wasPressed`, which is true on the
 *     frame a key goes down and never again while it is held, so a held key
 *     cannot machine-gun a sequence.
 *
 * It also carries the encounter's verdicts into the run's note tally, and the
 * health it decided a phrase cost into the run's pool, so a phrase played in
 * ARENA counts and costs on the results screen exactly as a phrase played in
 * VERTICAL does. The mechanic judges; the run scores and charges.
 */

import { isSequenceEncounter, type SequenceEncounter } from '../../core/capabilities';
import {
  ARENA_CONFIRM_KEYS, ARENA_MOVE_KEYS, ARENA_MOVE_KEYS_CAPTURED, ARENA_SEQUENCE_KEYS,
} from '../../core/controls';
import type { Input } from '../../core/Input';
import type { RunStatus } from '../../core/RunStatus';
import type { RuntimeMechanic } from '../../core/Mechanic';
import type { Renderer } from '../../core/Renderer';
import type { Direction8 } from '../../core/direction8';

const CARDINALS: Array<'N' | 'E' | 'S' | 'W'> = ['N', 'E', 'S', 'W'];

export class BreakoutController {
  /** Encounters capturing input on this frame. Rebuilt every update. */
  private capturing: SequenceEncounter[] = [];

  constructor(
    private readonly input: Input,
    private readonly status: RunStatus,
  ) {}

  /**
   * Forget every encounter.
   *
   * Called when the mode is activated, deactivated or cleared on death. The
   * per-frame rebuild already means a stale entry cannot affect input, but the
   * mode has just dropped those mechanics and the controller should not be the
   * one thing still holding them.
   */
  reset(): void {
    this.capturing = [];
  }

  /** True while the directional keys are a rhythm phrase rather than movement. */
  get isCapturing(): boolean {
    return this.capturing.length > 0;
  }

  /** The movement binding for this frame. */
  get moveKeys(): typeof ARENA_MOVE_KEYS {
    return this.isCapturing ? ARENA_MOVE_KEYS_CAPTURED : ARENA_MOVE_KEYS;
  }

  /** How much of the walking speed the player keeps. 1 when nothing is live. */
  movementScale(beat: number): number {
    let scale = 1;
    for (const encounter of this.capturing) scale = Math.min(scale, encounter.movementScale(beat));
    return scale;
  }

  /**
   * Refresh the capture set and deliver this frame's presses.
   *
   * Called before the avatar moves, so the movement binding the player gets is
   * the one that matches the presses the encounter is about to receive.
   *
   * `songTime` is what the run charges against: health is denominated in song
   * seconds, not beats, because the immunity a hit grants is a physiological
   * allowance rather than a musical one.
   */
  update(
    mechanics: RuntimeMechanic[], beat: number, songTime: number, focusX: number, focusY: number,
  ): void {
    this.capturing = [];
    for (const mechanic of mechanics) {
      if (!isSequenceEncounter(mechanic)) continue;
      mechanic.focusOn(focusX, focusY);
      // Drained for every encounter, not only the capturing ones: the verdict
      // for a missed final accent is recorded on the frame the window shuts,
      // which is the same frame the encounter stops taking input.
      for (const verdict of mechanic.drainJudgements()) {
        if (verdict === 'MISS') this.status.registerNoteMiss();
        else this.status.registerNoteHit();
      }
      // Charged through the run, like every other hit in the game. The
      // encounter knows what a phrase cost; it does not get to take health.
      for (const owed of mechanic.drainDamage()) {
        this.status.damage(owed.source, songTime, owed.amount);
      }
      if (mechanic.capturesInput(beat)) this.capturing.push(mechanic);
    }
    if (this.capturing.length === 0) return;

    for (const cardinal of CARDINALS) {
      if (!this.input.wasPressed(...ARENA_SEQUENCE_KEYS[cardinal])) continue;
      for (const encounter of this.capturing) {
        encounter.pressDirection(cardinal as Direction8, beat);
      }
    }
    if (this.input.wasPressed(...ARENA_CONFIRM_KEYS)) {
      for (const encounter of this.capturing) encounter.pressConfirm(beat);
    }
  }

  /** Encounter UI that belongs above the avatar. */
  renderOverlay(r: Renderer, mechanics: RuntimeMechanic[], beat: number): void {
    for (const mechanic of mechanics) {
      if (isSequenceEncounter(mechanic)) mechanic.renderOverlay(r, beat);
    }
  }

  /** HUD fragment describing the live encounter, or null. */
  label(mechanics: RuntimeMechanic[]): string | null {
    for (const mechanic of mechanics) {
      if (isSequenceEncounter(mechanic)) return mechanic.encounterLabel;
    }
    return null;
  }
}

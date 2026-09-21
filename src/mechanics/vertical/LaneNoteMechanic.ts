/**
 * V01 Tap / V03 Double (VERTICAL).
 *
 * A note the player must hit on its beat, in one lane (V01) or several at once
 * (V03). The mechanic owns only the note data and its own drawing is left to
 * the mode -- VerticalMode renders notes so every note shares one visual
 * language regardless of which mechanic produced it.
 *
 * Params:
 *   lane   1-based lane            (V01, default 1)
 *   lanes  1-based lane list       (V03, default [1, 4])
 */

import { BaseMechanic, type MechanicSpawnContext } from '../../core/Mechanic';
import type { InputTargetMechanic, NoteTarget } from '../../core/capabilities';
import type { Shape } from '../../core/geometry';
import type { Renderer } from '../../core/Renderer';

export const LANE_COUNT = 6;

export class LaneNoteMechanic extends BaseMechanic implements InputTargetMechanic {
  readonly targets: NoteTarget[];

  constructor(spawn: MechanicSpawnContext) {
    super(spawn);
    const holdBeats = numberOr(this.params.holdBeats, 0);
    this.targets = readLanes(this.params).map((lane) => ({
      lane,
      beat: this.activationBeat,
      holdBeats,
      state: 'PENDING' as const,
    }));
  }

  /**
   * A note lingers briefly after its beat so the judgement can resolve and the
   * hit flash can play, then retires.
   */
  override get isFinished(): boolean {
    const last = this.targets.reduce((max, t) => Math.max(max, t.beat + t.holdBeats), this.activationBeat);
    return this.spawn.clock.absoluteBeat > last + 0.6;
  }

  protected dangerShapes(): Shape[] {
    return []; // rhythm notes are judged, not collided with
  }

  render(_r: Renderer): void {
    // Drawn by VerticalMode from `targets`, so all notes look alike.
  }
}

/** Accepts either `lane` (single) or `lanes` (list), clamped to the board. */
export function readLanes(params: Record<string, unknown>): number[] {
  const raw = Array.isArray(params.lanes)
    ? params.lanes
    : [params.lane ?? 1];
  const lanes = raw
    .map((v) => Math.round(Number(v)))
    .filter((v) => Number.isFinite(v))
    .map((v) => Math.min(Math.max(v, 1), LANE_COUNT));
  return lanes.length > 0 ? [...new Set(lanes)] : [1];
}

function numberOr(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

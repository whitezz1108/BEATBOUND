/**
 * D06 -- Clockwise (RADIAL).
 *
 * One mechanic, several notes: a sequence of directions spaced `stepBeats`
 * apart. This is why NoteTarget carries its own beat rather than inheriting the
 * mechanic's -- a single scheduled event can span a whole bar.
 *
 * Params:
 *   sequence   direction order   default ["UP", "RIGHT", "DOWN", "LEFT"]
 *   stepBeats  spacing in beats  default 1
 */

import { BaseMechanic, type MechanicSpawnContext } from '../../core/Mechanic';
import type { InputTargetMechanic, NoteTarget } from '../../core/capabilities';
import { DIRECTION8, parseDirection, type Direction8 } from '../../core/direction8';
import type { Shape } from '../../core/geometry';
import type { Renderer } from '../../core/Renderer';

export class ClockwiseMechanic extends BaseMechanic implements InputTargetMechanic {
  readonly targets: NoteTarget[];

  constructor(spawn: MechanicSpawnContext) {
    super(spawn);
    const step = numberOr(this.params.stepBeats, 1);
    this.targets = readSequence(this.params).map((direction, i) => ({
      direction,
      beat: this.activationBeat + i * step,
      holdBeats: 0,
      state: 'PENDING' as const,
    }));
  }

  override get isFinished(): boolean {
    const last = this.targets.reduce((max, t) => Math.max(max, t.beat), this.activationBeat);
    return this.spawn.clock.absoluteBeat > last + 0.6;
  }

  protected dangerShapes(): Shape[] {
    return [];
  }

  render(_r: Renderer): void {
    // Drawn by RadialMode.
  }
}

/** Defaults to a full eight-step clockwise turn when no sequence is given. */
function readSequence(params: Record<string, unknown>): Direction8[] {
  const raw = Array.isArray(params.sequence) ? params.sequence : [];
  const valid = raw.map((v) => parseDirection(v)).filter((v): v is Direction8 => v !== null);
  return valid.length > 0 ? valid : [...DIRECTION8];
}

function numberOr(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : fallback;
}

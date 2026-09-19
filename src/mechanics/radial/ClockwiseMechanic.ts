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
import {
  RADIAL_DIRECTIONS,
  type InputTargetMechanic,
  type NoteTarget,
  type RadialDirection,
} from '../../core/capabilities';
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

function readSequence(params: Record<string, unknown>): RadialDirection[] {
  const raw = Array.isArray(params.sequence) ? params.sequence : [];
  const valid = raw
    .map((v) => String(v).toUpperCase())
    .filter((v): v is RadialDirection => (RADIAL_DIRECTIONS as readonly string[]).includes(v));
  return valid.length > 0 ? valid : [...RADIAL_DIRECTIONS];
}

function numberOr(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : fallback;
}

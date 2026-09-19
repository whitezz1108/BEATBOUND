/**
 * D01 Single / D02 Opposite Double (RADIAL).
 *
 * One or more directional notes converging on the centre on the same beat.
 *
 * Params:
 *   direction   single direction   (D01, default "UP")
 *   directions  direction list     (D02, default ["UP", "DOWN"])
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

export class DirectionNoteMechanic extends BaseMechanic implements InputTargetMechanic {
  readonly targets: NoteTarget[];

  constructor(spawn: MechanicSpawnContext) {
    super(spawn);
    this.targets = readDirections(this.params).map((direction) => ({
      direction,
      beat: this.activationBeat,
      holdBeats: 0,
      state: 'PENDING' as const,
    }));
  }

  override get isFinished(): boolean {
    return this.spawn.clock.absoluteBeat > this.activationBeat + 0.6;
  }

  protected dangerShapes(): Shape[] {
    return [];
  }

  render(_r: Renderer): void {
    // RadialMode draws every note, so all of them share one visual language.
  }
}

/** Accepts `direction` (single) or `directions` (list); unknown values drop out. */
export function readDirections(params: Record<string, unknown>): RadialDirection[] {
  const raw = Array.isArray(params.directions) ? params.directions : [params.direction ?? 'UP'];
  const valid = raw
    .map((v) => String(v).toUpperCase())
    .filter((v): v is RadialDirection => (RADIAL_DIRECTIONS as readonly string[]).includes(v));
  return valid.length > 0 ? [...new Set(valid)] : ['UP'];
}

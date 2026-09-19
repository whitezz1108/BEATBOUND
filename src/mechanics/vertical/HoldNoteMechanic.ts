/**
 * V02 -- Hold (VERTICAL).
 *
 * The same note model as a tap, except the key must stay down for `holdBeats`
 * after the hit. NoteMode enforces the hold; this only declares its length.
 *
 * Params:
 *   lane       1-based lane   default 1
 *   holdBeats  beats to hold  default 2 (falls back to the library duration)
 */

import type { MechanicSpawnContext } from '../../core/Mechanic';
import { LaneNoteMechanic } from './LaneNoteMechanic';

export class HoldNoteMechanic extends LaneNoteMechanic {
  constructor(spawn: MechanicSpawnContext) {
    super({
      ...spawn,
      params: { ...spawn.params, holdBeats: pickPositive(spawn.params.holdBeats, spawn.timing.durationBeats, 2) },
    });
  }
}

function pickPositive(...candidates: unknown[]): number {
  for (const c of candidates) {
    if (typeof c === 'number' && Number.isFinite(c) && c > 0) return c;
  }
  return 2;
}

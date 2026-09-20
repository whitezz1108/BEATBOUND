/**
 * V04 -- Drift Hold (VERTICAL).
 *
 * RETIRED as authored content: playtesting showed switching keys mid-hold is
 * not humanly keepable, so every path is flattened to its head lane and the
 * note plays as a straight hold. Existing patterns keep their timing and
 * note counts unchanged -- they simply demand one key, not a hand-swap.
 * The engine still understands multi-checkpoint paths (NoteMode.judgeHold,
 * VerticalMode.renderDrift); no pattern authors one any more.
 *
 * Params:
 *   path       [[beatOffset, lane], ...] -- only the first lane is used
 *   lane       head lane when no path is given         default 1
 *   holdBeats  total length of the hold                default the path's end
 */

import { BaseMechanic, type MechanicSpawnContext } from '../../core/Mechanic';
import type { InputTargetMechanic, NoteSegment, NoteTarget } from '../../core/capabilities';
import type { Shape } from '../../core/geometry';
import { clamp } from '../../core/geometry';
import type { Renderer } from '../../core/Renderer';
import { LANE_COUNT } from './LaneNoteMechanic';

export class DriftHoldMechanic extends BaseMechanic implements InputTargetMechanic {
  readonly targets: NoteTarget[];

  constructor(spawn: MechanicSpawnContext) {
    super(spawn);
    const path = readPath(this.params.path);
    const holdBeats = numberOr(
      this.params.holdBeats,
      path.length > 0 ? path[path.length - 1].beatOffset : this.timing.durationBeats,
    );
    this.targets = [{
      lane: path[0]?.lane ?? clampLane(numberOr(this.params.lane, 1)),
      beat: this.activationBeat,
      holdBeats: Math.max(0.5, holdBeats),
      state: 'PENDING',
      // No `path`: a single-lane hold, never a lane-switching drift.
    }];
  }

  override get isFinished(): boolean {
    const t = this.targets[0];
    return this.spawn.clock.absoluteBeat > t.beat + t.holdBeats + 0.6;
  }

  protected dangerShapes(): Shape[] {
    return [];
  }

  render(_r: Renderer): void {
    // VerticalMode draws every note so the whole board shares one language.
  }
}

/** Accepts [[beatOffset, lane], ...] or [{beatOffset, lane}, ...]. */
function readPath(value: unknown): NoteSegment[] {
  if (!Array.isArray(value)) return [];
  const out: NoteSegment[] = [];
  for (const entry of value) {
    if (Array.isArray(entry) && entry.length >= 2) {
      out.push({ beatOffset: Number(entry[0]), lane: clampLane(Number(entry[1])) });
    } else if (entry && typeof entry === 'object') {
      const e = entry as { beatOffset?: unknown; lane?: unknown };
      out.push({ beatOffset: Number(e.beatOffset ?? 0), lane: clampLane(Number(e.lane ?? 1)) });
    }
  }
  return out
    .filter((s) => Number.isFinite(s.beatOffset) && Number.isFinite(s.lane))
    .sort((a, b) => a.beatOffset - b.beatOffset);
}

function clampLane(lane: number): number {
  return clamp(Math.round(lane), 1, LANE_COUNT);
}

function numberOr(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

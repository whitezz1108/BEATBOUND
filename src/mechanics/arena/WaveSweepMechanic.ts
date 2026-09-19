/**
 * A09 -- Wave Sweep (ARENA).
 *
 * A wall crossing the arena with a gap to pass through. With `amplitude` above
 * zero the wall is a travelling sine instead of a straight line, which reads as
 * the music moving through the space rather than a shutter closing.
 *
 * The wall is emitted as a row of segment rects so it collides exactly, wave or
 * not, using only the shared shape tests.
 *
 * Params:
 *   axis       "HORIZONTAL" | "VERTICAL" | "DIAGONAL"   default "HORIZONTAL"
 *   direction  "FORWARD" | "BACKWARD"                   default "FORWARD"
 *   gapCount   openings                                 default 1
 *   gapWidth   opening size, 0..1                       default 0.2
 *   thickness  wall thickness                           default 0.09
 *   amplitude  sine amplitude, 0 for a straight wall    default 0
 */

import { BaseMechanic, type MechanicSpawnContext, type MechanicPhase } from '../../core/Mechanic';
import type { Rect, Shape } from '../../core/geometry';
import { clamp, makeRng } from '../../core/geometry';
import { easeIn } from '../../feel/Easing';
import type { Renderer } from '../../core/Renderer';

const SEGMENTS = 22;
const COLOUR = '#5ad1b0';
const EDGE = '#a8ffe6';

export class WaveSweepMechanic extends BaseMechanic {
  private readonly vertical: boolean;
  private readonly diagonal: boolean;
  private readonly forward: boolean;
  private readonly thickness: number;
  private readonly amplitude: number;
  /** Lateral positions (0..1) of the openings. */
  private readonly gapCentres: number[];
  private readonly gapWidth: number;

  constructor(spawn: MechanicSpawnContext) {
    super(spawn);
    const axis = String(this.params.axis ?? 'HORIZONTAL').toUpperCase();
    this.vertical = axis === 'VERTICAL';
    this.diagonal = axis === 'DIAGONAL';
    this.forward = String(this.params.direction ?? 'FORWARD').toUpperCase() !== 'BACKWARD';
    this.thickness = clamp(numberOr(this.params.thickness, 0.09), 0.04, 0.2);
    this.amplitude = clamp(numberOr(this.params.amplitude, 0), 0, 0.25);
    // Openings stay wide enough to walk through and spread out so the nearest
    // one is always within a beat of travel.
    this.gapWidth = clamp(numberOr(this.params.gapWidth, 0.2), 0.12, 0.45);

    const count = clamp(Math.round(numberOr(this.params.gapCount, 1)), 1, 3);
    const rng = makeRng(this.seed);
    this.gapCentres = [];
    for (let i = 0; i < count; i++) {
      this.gapCentres.push(clamp((i + 0.5) / count + (rng() - 0.5) * (0.5 / count), 0.12, 0.88));
    }
  }

  /** 0..1 across the arena, in the direction of travel. */
  private sweep(beat: number): number {
    const t = clamp((beat - this.activationBeat) / Math.max(0.25, this.timing.durationBeats), 0, 1);
    return this.forward ? t : 1 - t;
  }

  /** Where the wall sits at lateral position `u` (0..1). */
  private wallOffset(sweep: number, u: number): number {
    if (this.amplitude <= 0) return sweep;
    return sweep + Math.sin(u * Math.PI * 2 - sweep * Math.PI * 2) * this.amplitude;
  }

  private segments(beat: number): Rect[] {
    const sweep = this.sweep(beat);
    const out: Rect[] = [];
    const half = this.thickness / 2;
    for (let i = 0; i < SEGMENTS; i++) {
      const u0 = i / SEGMENTS;
      const u1 = (i + 1) / SEGMENTS;
      const centre = (u0 + u1) / 2;
      if (this.gapCentres.some((g) => Math.abs(centre - g) < this.gapWidth / 2)) continue;
      const offset = this.wallOffset(sweep, centre);
      if (this.diagonal) {
        // A diagonal wall: the crossing position also slides with u.
        const d = clamp(offset + (centre - 0.5) * 0.5, -0.3, 1.3);
        out.push({ x: u0, y: d - half, w: u1 - u0, h: this.thickness });
      } else if (this.vertical) {
        out.push({ x: offset - half, y: u0, w: this.thickness, h: u1 - u0 });
      } else {
        out.push({ x: u0, y: offset - half, w: u1 - u0, h: this.thickness });
      }
    }
    return out;
  }

  protected override onPhaseChange(_from: MechanicPhase, to: MechanicPhase): void {
    if (to === 'ACTIVE') {
      this.feel.impact('LIGHT', { colour: COLOUR, sfx: 'projectile_fire', shockwave: false });
    }
  }

  protected dangerShapes(): Shape[] {
    return this.segments(this.spawn.clock.absoluteBeat).map((rect) => ({ kind: 'rect' as const, ...rect }));
  }

  render(r: Renderer): void {
    const beat = this.spawn.clock.visualBeat;

    if (this.phase === 'TELEGRAPH') {
      const t = easeIn(this.telegraphProgress(beat));
      // Ghost the wall at its entry edge and mark the gaps positively.
      for (const rect of this.segments(this.activationBeat)) {
        r.fillRect(rect, COLOUR, 0.08 + 0.2 * t);
        r.strokeRect(rect, EDGE, 1, 0.2 + 0.3 * t, [5, 4]);
      }
      for (const g of this.gapCentres) {
        const from = this.vertical ? { x: 0, y: g } : { x: g, y: 0 };
        const to = this.vertical ? { x: 1, y: g } : { x: g, y: 1 };
        r.line(from.x, from.y, to.x, to.y, '#7dffb0', 2, 0.15 + 0.3 * t, [6, 8]);
      }
      return;
    }

    if (this.phase !== 'ACTIVE') return;
    for (const rect of this.segments(beat)) {
      r.fillRect(rect, COLOUR, 0.9);
      r.strokeRect(rect, EDGE, 1, 0.5);
    }
  }
}

function numberOr(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

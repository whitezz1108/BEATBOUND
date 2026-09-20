/**
 * A09 -- Wave Sweep (ARENA): a wall whose window moves with the music.
 *
 * The wall crosses the arena and the gap to slip through is now *rhythmic*:
 * in RHYTHM mode its centre follows `gapPath` -- one position per beat --
 * stepping on the pulse the way the fan's rotation does. The window becomes a
 * short choreography: read the next position on the beat, be there when the
 * wall arrives. SHRINK mode tightens the window as the wall travels, and
 * DOUBLE mode mirrors a second window across the arena.
 *
 * Fairness floors are built in at construction: the window never shrinks
 * below the player's minimum gap, and consecutive `gapPath` steps never move
 * faster than the player can follow.
 *
 * The wall is emitted as a row of segment rects so it collides exactly, wave
 * or not, using only the shared shape tests.
 *
 * Params:
 *   mode       "STATIC" | "RHYTHM" | "SHRINK" | "DOUBLE"  default "STATIC"
 *   axis       "HORIZONTAL" | "VERTICAL" | "DIAGONAL"     default "HORIZONTAL"
 *   direction  "FORWARD" | "BACKWARD"                     default "FORWARD"
 *   gapCount   openings                                    default 1
 *   gapWidth   opening size, 0..1                          default 0.2
 *   gapPath    [0..1, ...] window centre per beat          default [0.5]
 *   thickness  wall thickness                              default 0.09
 *   amplitude  sine amplitude, 0 for a straight wall       default 0
 *   shrinkTo   SHRINK: final width as a fraction           default 0.65
 */

import { BaseMechanic, type MechanicSpawnContext, type MechanicPhase } from '../../core/Mechanic';
import type { Rect, Shape } from '../../core/geometry';
import { clamp, makeRng } from '../../core/geometry';
import { minimumGapWidth, maxGapShiftPerBeat } from '../../core/fairness';
import { easeIn, easeInOut } from '../../feel/Easing';
import { slowed } from './arenaTiming';
import type { Renderer } from '../../core/Renderer';

const SEGMENTS = 22;
const COLOUR = '#5ad1b0';
const EDGE = '#a8ffe6';
const SAFE = '#7dffb0';

type SweepMode = 'STATIC' | 'RHYTHM' | 'SHRINK' | 'DOUBLE';

export class WaveSweepMechanic extends BaseMechanic {
  private readonly mode: SweepMode;
  private readonly vertical: boolean;
  private readonly diagonal: boolean;
  private readonly forward: boolean;
  private readonly thickness: number;
  private readonly amplitude: number;
  /** Lateral positions (0..1) of the openings, one path per gap. */
  private readonly gapPaths: number[][];
  private readonly gapWidth: number;
  private readonly shrinkTo: number;

  constructor(spawn: MechanicSpawnContext) {
    super(slowed(spawn));
    const modeParam = String(this.params.mode ?? 'STATIC').toUpperCase();
    this.mode = (['STATIC', 'RHYTHM', 'SHRINK', 'DOUBLE'] as const).includes(modeParam as SweepMode)
      ? (modeParam as SweepMode)
      : 'STATIC';
    const axis = String(this.params.axis ?? 'HORIZONTAL').toUpperCase();
    this.vertical = axis === 'VERTICAL';
    this.diagonal = axis === 'DIAGONAL';
    this.forward = String(this.params.direction ?? 'FORWARD').toUpperCase() !== 'BACKWARD';
    this.thickness = clamp(numberOr(this.params.thickness, 0.09), 0.04, 0.2);
    this.amplitude = clamp(numberOr(this.params.amplitude, 0), 0, 0.25);
    this.shrinkTo = clamp(numberOr(this.params.shrinkTo, 0.65), 0.55, 0.85);

    // Openings stay wide enough to walk through and spread out so the nearest
    // one is always within a beat of travel.
    const floor = minimumGapWidth();
    this.gapWidth = clamp(
      numberOr(this.params.gapWidth, 0.2) * this.tier.gapScale,
      this.mode === 'SHRINK' ? floor / this.shrinkTo : floor,
      0.5,
    );

    const count = clamp(Math.round(numberOr(this.params.gapCount, 1)), 1, 2);
    const spb = Math.max(0.01, this.spawn.clock.secondsPerBeat);
    if (this.mode === 'STATIC') {
      // Legacy behaviour: seeded, fixed openings.
      const rng = makeRng(this.seed);
      this.gapPaths = [];
      for (let i = 0; i < count; i++) {
        this.gapPaths.push([clamp((i + 0.5) / count + (rng() - 0.5) * (0.5 / count), 0.12, 0.88)]);
      }
    } else {
      // A path per opening: the second window mirrors the first.
      const raw = Array.isArray(this.params.gapPath) && this.params.gapPath.length > 0
        ? this.params.gapPath.map((v) => numberOr(v, 0.5))
        : [0.5];
      // The window may not outrun the player between beats.
      const maxShift = maxGapShiftPerBeat(spb);
      const path: number[] = [];
      for (let i = 0; i < raw.length; i++) {
        const target = clamp(raw[i], 0.1, 0.9);
        const prev = path.length > 0 ? path[path.length - 1] : raw[raw.length - 1];
        path.push(clamp(target, prev - maxShift, prev + maxShift));
      }
      this.gapPaths = [path];
      if (count === 2) this.gapPaths.push(path.map((v) => clamp(1 - v, 0.1, 0.9)));
    }
  }

  /** 0..1 across the arena, in the direction of travel. */
  private sweep(beat: number): number {
    const t = clamp((beat - this.activationBeat) / Math.max(0.25, this.timing.durationBeats), 0, 1);
    return this.forward ? t : 1 - t;
  }

  /** Window centre for an opening at `beat`. */
  private gapCentreAt(beat: number, gapIndex: number): number {
    const path = this.gapPaths[gapIndex];
    if (path.length === 1) return path[0];
    const beatsIn = Math.max(0, beat - this.activationBeat);
    const k = Math.floor(beatsIn);
    const frac = easeInOut(beatsIn - k);
    return path[k % path.length] + (path[(k + 1) % path.length] - path[k % path.length]) * frac;
  }

  /** Window width at `beat` (SHRINK tightens it as the wall travels). */
  private gapWidthAt(beat: number): number {
    if (this.mode !== 'SHRINK') return this.gapWidth;
    return this.gapWidth * (1 - (1 - this.shrinkTo) * this.sweep(beat));
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
      let insideGap = false;
      for (let g = 0; g < this.gapPaths.length; g++) {
        if (Math.abs(centre - this.gapCentreAt(beat, g)) < this.gapWidthAt(beat) / 2) insideGap = true;
      }
      if (insideGap) continue;
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
      // The window's choreography: where it will be, beat by beat.
      if (this.mode !== 'STATIC') {
        const steps = 5;
        for (let k = 0; k < steps; k++) {
          const sweep = k / Math.max(1, steps - 1);
          for (let g = 0; g < this.gapPaths.length; g++) {
            const centre = this.gapCentreAt(this.activationBeat + k, g);
            const width = this.gapWidthAt(this.activationBeat + k);
            const p = this.vertical
              ? { x: sweep, y: centre }
              : { x: centre, y: sweep };
            r.fillCircle(p.x, p.y, width * 0.28, SAFE, 0.2 + 0.3 * t);
            r.strokeCircle(p.x, p.y, width * 0.28, SAFE, 1.5, 0.35 + 0.35 * t);
            if (k > 0) {
              const prev = this.gapCentreAt(this.activationBeat + k - 1, g);
              const q = this.vertical
                ? { x: (k - 1) / Math.max(1, steps - 1), y: prev }
                : { x: prev, y: (k - 1) / Math.max(1, steps - 1) };
              r.line(q.x, q.y, p.x, p.y, SAFE, 1.5, 0.15 + 0.25 * t, [3, 4]);
            }
          }
        }
      } else {
        for (const g of this.gapPaths[0] ?? [0.5]) {
          const from = this.vertical ? { x: 0, y: g } : { x: g, y: 0 };
          const to = this.vertical ? { x: 1, y: g } : { x: g, y: 1 };
          r.line(from.x, from.y, to.x, to.y, SAFE, 2, 0.15 + 0.3 * t, [6, 8]);
        }
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

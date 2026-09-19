/**
 * A10 -- Ring (ARENA).
 *
 * A ring closing in on the centre or pushing out from it, with a safe arc. It is
 * the heavy punctuation of the radial family: the player has to be standing in
 * the right slice of the arena when it arrives, not merely dodge a bullet.
 *
 * Params:
 *   mode         "COLLAPSE" | "EXPAND"        default "COLLAPSE"
 *   gapCount     openings                     default 1
 *   gapArcDeg    width of each opening        default 54
 *   gapAngleDeg  where the first one points   default -90
 *   thickness    ring thickness               default 0.07
 *   rotationDeg  extra rotation of the gaps   default 0
 */

import { BaseMechanic, type MechanicSpawnContext, type MechanicPhase } from '../../core/Mechanic';
import type { Shape } from '../../core/geometry';
import { clamp } from '../../core/geometry';
import { easeIn, easeInOut } from '../../feel/Easing';
import type { Renderer } from '../../core/Renderer';
import { ARENA_CENTRE, ARENA_OUTER_RADIUS, dangerArcs, degToRad, polarToField, spreadGaps, sector } from './polar';
import { slowed } from './arenaTiming';

const COLOUR = '#ff6b9d';
const EDGE = '#ffd6e6';

export class RingMechanic extends BaseMechanic {
  private readonly collapse: boolean;
  private readonly thickness: number;
  private readonly gapCentres: number[];
  private readonly gapArc: number;

  constructor(spawn: MechanicSpawnContext) {
    super(slowed(spawn));
    this.collapse = String(this.params.mode ?? 'COLLAPSE').toUpperCase() !== 'EXPAND';
    this.thickness = clamp(numberOr(this.params.thickness, 0.07), 0.04, 0.16);
    this.gapArc = degToRad(clamp(numberOr(this.params.gapArcDeg, 54) * this.tier.gapScale, 28, 170));
    const first = degToRad(numberOr(this.params.gapAngleDeg, -90) + numberOr(this.params.rotationDeg, 0));
    this.gapCentres = spreadGaps(first, numberOr(this.params.gapCount, 1));
  }

  /** Radius of the ring's centre line. */
  private radiusAt(beat: number): number {
    const t = easeInOut(clamp((beat - this.activationBeat) / Math.max(0.25, this.timing.durationBeats), 0, 1));
    return this.collapse
      ? ARENA_OUTER_RADIUS - t * (ARENA_OUTER_RADIUS - 0.04)
      : 0.04 + t * ARENA_OUTER_RADIUS;
  }

  protected override onPhaseChange(_from: MechanicPhase, to: MechanicPhase): void {
    if (to === 'TELEGRAPH') this.feel.sfx('laser_charge', 0.6);
    if (to === 'ACTIVE') {
      this.feel.impact('HEAVY', { x: 0.5, y: 0.5, colour: COLOUR, sfx: 'chain_impact' });
    }
  }

  protected dangerShapes(): Shape[] {
    const radius = this.radiusAt(this.spawn.clock.absoluteBeat);
    const inner = Math.max(0, radius - this.thickness / 2);
    const outer = radius + this.thickness / 2;
    return dangerArcs(this.gapCentres, this.gapArc).map(([a0, a1]) => ({
      kind: 'sector' as const,
      ...sector(inner, outer, a0, a1),
    }));
  }

  render(r: Renderer): void {
    const beat = this.spawn.clock.visualBeat;
    const arcs = dangerArcs(this.gapCentres, this.gapArc);

    if (this.phase === 'TELEGRAPH') {
      const t = easeIn(this.telegraphProgress(beat));
      const radius = this.radiusAt(this.activationBeat);
      for (const [a0, a1] of arcs) {
        r.strokeArc(ARENA_CENTRE.x, ARENA_CENTRE.y, radius, a0, a1, COLOUR, 2 + 4 * t, 0.2 + 0.4 * t);
      }
      // Draw the escape slice as a solid wedge: stand here.
      for (const centre of this.gapCentres) {
        r.fillAnnulusSector(
          ARENA_CENTRE.x, ARENA_CENTRE.y, 0.04, ARENA_OUTER_RADIUS,
          centre - this.gapArc / 2, centre + this.gapArc / 2, '#7dffb0', 0.05 + 0.08 * t,
        );
        const tip = polarToField(centre, 0.42);
        r.text('SAFE', tip.x, tip.y, '#7dffb0', 11, 'center', 0.25 + 0.5 * t);
      }
      return;
    }

    if (this.phase !== 'ACTIVE') return;
    const radius = this.radiusAt(beat);
    const inner = Math.max(0, radius - this.thickness / 2);
    const outer = radius + this.thickness / 2;
    for (const [a0, a1] of arcs) {
      r.fillAnnulusSector(ARENA_CENTRE.x, ARENA_CENTRE.y, inner, outer, a0, a1, COLOUR, 0.92);
      r.strokeArc(ARENA_CENTRE.x, ARENA_CENTRE.y, radius, a0, a1, EDGE, 2, 0.7);
    }
  }
}

function numberOr(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/**
 * R09 -- Gravity Flip (RUNNER).
 *
 * A portal that scrolls in with the track. Crossing it inverts gravity for
 * `durationBeats`; the player keeps their momentum and immediately carries on
 * jumping, this time from the ceiling.
 *
 * The readable sequence the spec asks for:
 *   portal scrolls in  ->  charges on the approach  ->  flips on the beat
 *   ->  world colours invert  ->  running continues without a pause
 *
 * Params:
 *   gravityScale  multiplier applied while active   default -1
 */

import { BaseMechanic, type MechanicPhase, type MechanicSpawnContext } from '../../core/Mechanic';
import type { RunnerTerrain } from '../../core/capabilities';
import type { Shape } from '../../core/geometry';
import { clamp } from '../../core/geometry';
import { easeIn, easeOutCubic } from '../../feel/Easing';
import type { Renderer } from '../../core/Renderer';
import { CEILING_Y, GROUND_Y, trackX } from './runnerGeometry';

const COLOUR = '#8a5fff';
const EDGE = '#c9bcff';

export class GravityFlipMechanic extends BaseMechanic implements RunnerTerrain {
  private readonly scale: number;

  constructor(spawn: MechanicSpawnContext) {
    super(spawn);
    this.scale = clamp(numberOr(this.params.gravityScale, -1), -2, 2);
  }

  gravityScale(): number | null {
    return this.phase === 'ACTIVE' ? this.scale : null;
  }

  protected override onPhaseChange(_from: MechanicPhase, to: MechanicPhase): void {
    if (to === 'TELEGRAPH') this.feel.sfx('laser_charge', 0.8);
    // The flip cue itself is fired by RunnerMode, which knows when the player
    // actually changes surface -- firing it here too would double the impact.
  }

  protected dangerShapes(): Shape[] {
    return [];
  }

  /** Portal x, scrolling in with the track like any other obstacle. */
  private portalX(beat: number): number {
    return trackX(this.activationBeat, beat);
  }

  render(r: Renderer): void {
    const beat = this.spawn.clock.visualBeat;

    if (this.phase === 'SCHEDULED' || this.phase === 'TELEGRAPH') {
      const x = this.portalX(beat);
      if (x > 1.1) return;
      // Charge rises as the gate approaches the player's lane.
      const charge = easeIn(clamp(1 - (x - 0.22) / 0.9, 0, 1));
      const width = 0.018 + 0.02 * charge;
      r.fillRect({ x: x - width / 2, y: CEILING_Y, w: width, h: GROUND_Y - CEILING_Y }, COLOUR, 0.2 + 0.4 * charge);
      r.line(x, CEILING_Y, x, GROUND_Y, EDGE, 2 + 3 * charge, 0.5 + 0.5 * charge);
      // Arrows at both ends: this gate moves you between the two surfaces.
      r.text('⇅', x, CEILING_Y + 0.045, EDGE, 16 + 8 * charge, 'center', 0.5 + 0.5 * charge);
      r.text('⇅', x, GROUND_Y - 0.045, EDGE, 16 + 8 * charge, 'center', 0.5 + 0.5 * charge);
      if (charge > 0.5) this.feel.telegraph(x, CEILING_Y + Math.random() * (GROUND_Y - CEILING_Y), EDGE, charge);
      return;
    }

    if (this.phase === 'ACTIVE') {
      const remaining = this.activeEndBeat - beat;
      // A short flash on entry, then a calm tint for the rest of the zone.
      const entry = easeOutCubic(clamp((beat - this.activationBeat) / 0.4, 0, 1));
      r.fillRect({ x: 0, y: 0, w: 1, h: 1 }, COLOUR, 0.20 * (1 - entry) + 0.07);
      // Countdown so the return to normal gravity is never a surprise.
      const urgency = remaining < 1 ? 0.5 + 0.5 * Math.sin(beat * 18) : 1;
      r.text(`⇅ ${remaining.toFixed(1)}`, 0.5, 0.5, EDGE, 15, 'center', 0.55 * urgency);
    }
  }
}

function numberOr(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

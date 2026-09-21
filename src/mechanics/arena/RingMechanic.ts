/**
 * A10 -- Ring (ARENA).
 *
 * A ring closing in on the centre or pushing out from it, with one or more safe
 * arcs. It is the heavy punctuation of the radial family: the player has to be
 * standing in the right slice of the arena when it arrives, not merely dodge a
 * bullet.
 *
 * Fairness is the whole design problem here. A ring is the one hazard the player
 * cannot outrun -- it spans the arena, so the only defence is *already being* in
 * the gap. That makes two numbers load-bearing:
 *
 *   1. How wide the gap is. Clamped against `minimumAngularGap` at the radius
 *      the player actually stands at, so the opening always fits a body even
 *      after a NARROWING_GAP sequence has spent several rings shrinking it.
 *   2. How far the gap may move between successive rings. Clamped against the
 *      distance the player covers between them, measured between gap *edges*
 *      at the outer rim -- the worst case, because the same angular step is a
 *      longer walk the further out you stand, and a widening ring can throw its
 *      trailing edge a long way even when its centre barely moved. Without this
 *      a pattern can flip a gap ~180 degrees between two rings half a beat
 *      apart, which is not a dodge, it is a coin flip.
 *
 * Params:
 *   variant             "BASIC_GAP" | "FOLLOW_GAP" | "ROTATING_GAP"
 *                       | "NARROWING_GAP" | "ADVANCED_ALTERNATING"  default "BASIC_GAP"
 *   mode                "COLLAPSE" | "EXPAND"        default "COLLAPSE"
 *   ringCount           rings in the sequence        default 1
 *   gapCount            openings per ring            default 1
 *   gapArcDeg           width of each opening        default 54
 *   gapAngleDeg         where the first one points   default -90
 *   thickness           ring thickness               default 0.07
 *   rotationDeg         extra rotation of the first gap default 0
 *   rotationPerRingDeg  ROTATING_GAP step            default 40
 *   narrowingPerRing    NARROWING_GAP arc scale      default 0.82
 */

import { BaseMechanic, type MechanicSpawnContext, type MechanicPhase } from '../../core/Mechanic';
import type { Shape } from '../../core/geometry';
import { angleDelta, clamp } from '../../core/geometry';
import { easeIn, easeInOut } from '../../feel/Easing';
import type { Renderer } from '../../core/Renderer';
import { ensureWarningFloor, minimumAngularGap } from '../../core/fairness';
import { TUNING } from '../../tuning';
import {
  ARENA_CENTRE, ARENA_OUTER_RADIUS, dangerArcs, degToRad, polarToField, sector,
} from './polar';
import { slowed } from './arenaTiming';

const COLOUR = '#ff6b9d';
const EDGE = '#ffd6e6';
const SAFE = '#7dffb0';

/**
 * Radius a gap is judged at.
 *
 * A collapsing ring's gap is a wedge: widest at the outer edge, coming to
 * nothing at the centre. The player can always fall back toward the middle, but
 * they still have to *stand* somewhere, and the tightest arc they will ever be
 * asked to occupy is at this radius. Sizing and reachability are both measured
 * here, which is the conservative choice for both.
 */
const JUDGEMENT_RADIUS = 0.14;
/**
 * Where a collapsing ring stops, derived from its own thickness.
 *
 * This is load-bearing and must not be raised casually. The ring is an annulus:
 * everything inside `radius - thickness/2` is safe, so if that inner edge ever
 * grows past the player's body the dead centre of the arena becomes a permanent
 * camp spot and the whole mechanic stops asking a question. Tying the floor to
 * `thickness/2` plus half a body keeps the inner edge *under* the player at
 * every thickness, which is what makes "you cannot simply stand in the middle"
 * true by construction.
 */
function minRingRadius(thickness: number): number {
  return thickness / 2 + TUNING.arena.playerRadius * 0.5;
}
/** A ring may spend at most this share of the player's speed closing the distance. */
const REACH_FRACTION = 0.85;

export type RingVariant =
  | 'BASIC_GAP' | 'FOLLOW_GAP' | 'ROTATING_GAP' | 'NARROWING_GAP' | 'ADVANCED_ALTERNATING';

const VARIANTS: RingVariant[] = [
  'BASIC_GAP', 'FOLLOW_GAP', 'ROTATING_GAP', 'NARROWING_GAP', 'ADVANCED_ALTERNATING',
];

interface Ring {
  /** Absolute beat this ring becomes dangerous. */
  activationBeat: number;
  /** Gap centres, radians. Evenly spaced. */
  gapCentres: number[];
  /** Half-width of each gap, radians. */
  halfArc: number;
}

export class RingMechanic extends BaseMechanic {
  private readonly collapse: boolean;
  private readonly thickness: number;
  private readonly rings: Ring[];
  /** Beats one ring takes to complete its sweep. */
  private readonly sweepBeats: number;
  /** Beats between successive rings; also the window reachability is judged over. */
  private readonly staggerBeats: number;

  constructor(spawn: MechanicSpawnContext) {
    const count = Math.max(1, Math.round(numberOr(spawn.params.ringCount, 1)));
    const rawDuration = Math.max(0.25, spawn.timing.durationBeats);
    // `ringCount` rings, each sweeping for the authored `durationBeats`, laid end
    // to end -- so the window is `count` sweeps long. The previous `raw + count -
    // 1` mixed its units: it added *beats* where the sequence is measured in
    // *sweeps*, which left every ring after the first still crawling inward when
    // the mechanic stopped being dangerous. They drew, and could not damage.
    const window = count > 1
      ? { ...spawn, timing: { ...spawn.timing, durationBeats: rawDuration * count } }
      : spawn;
    super(slowed(window));

    this.collapse = String(this.params.mode ?? 'COLLAPSE').toUpperCase() !== 'EXPAND';
    this.thickness = clamp(numberOr(this.params.thickness, 0.07), 0.04, 0.16);
    this.applyWarningFloor(count);
    this.sweepBeats = this.timing.durationBeats / count;
    this.staggerBeats = this.sweepBeats;
    this.rings = this.buildRings(count);
  }

  /**
   * Stretch the ring's sweep when the combined warning falls under the Arena
   * fairness minimum.
   *
   * A ring cannot be outrun, so -- unlike every other hazard here -- its warning
   * is not "the telegraph before it arrives", it is "the telegraph plus however
   * long the ring takes to reach the player's radius". That travel is real
   * warning and it is why the authored library value is fine at 120 BPM: the
   * ring is still on its way for most of the active window. What the library
   * value does not do is *express* the floor, so a thin fast ring at a high tier
   * can shrink the travel to almost nothing and leave the telegraph carrying the
   * whole budget on its own.
   *
   * The measurement is geometric, not a blanket increase. A collapsing ring
   * reaches a player standing at the judgement radius after crossing most of the
   * arena; an expanding one reaches them almost immediately, and is the case
   * that actually needs the help. `ensureWarningFloor` is the same helper the
   * chains use, so the ring is held to the identical standard rather than to a
   * number invented for it. Only ever stretched, never shortened, and it lands
   * on `durationBeats` rather than the telegraph so the scheduler's spawn lead
   * stays exactly where `MechanicRegistry` put it.
   */
  private applyWarningFloor(count: number): void {
    const spb = Math.max(0.01, this.spawn.clock.secondsPerBeat);
    const inner = minRingRadius(this.thickness);
    const span = Math.max(1e-3, ARENA_OUTER_RADIUS - inner);
    // Share of one ring's sweep spent getting from the ring's own start to the
    // radius the player is judged at. Eased in practice, so this is the generous
    // read. Scaled by `count` because the window is `count` sweeps long.
    const share = this.collapse
      ? clamp((ARENA_OUTER_RADIUS - JUDGEMENT_RADIUS) / span, 0, 1)
      : clamp((JUDGEMENT_RADIUS - inner) / span, 0, 1);
    const travel = this.timing.durationBeats * share / count;
    const required = ensureWarningFloor(this.timing.telegraphBeats, travel, spb);
    if (required > travel) {
      const stretched = (required / Math.max(1e-3, share)) * count;
      (this.timing as { durationBeats: number }).durationBeats = Math.max(
        this.timing.durationBeats, stretched,
      );
    }
  }

  // ---- construction ------------------------------------------------------

  private buildRings(count: number): Ring[] {
    const variant = readVariant(this.params.variant);
    const baseArc = degToRad(clamp(numberOr(this.params.gapArcDeg, 54) * this.tier.gapScale, 28, 170));
    const gapCount = Math.max(1, Math.round(numberOr(this.params.gapCount, 1)));
    const first = degToRad(numberOr(this.params.gapAngleDeg, -90) + numberOr(this.params.rotationDeg, 0));
    const rotationPerRing = degToRad(numberOr(this.params.rotationPerRingDeg, 40));
    const narrowing = clamp(numberOr(this.params.narrowingPerRing, 0.82), 0.55, 1);
    const rotationAuthored = typeof this.params.rotationPerRingDeg === 'number';
    // The two absolute floors. No variant, tier or intensity may go below them.
    const minHalfArc = minimumAngularGap(TUNING.arena.playerRadius, JUDGEMENT_RADIUS) / 2;
    const maxEdgeStep = this.maxGapEdgeStep();
    /**
     * ADVANCED_ALTERNATING's swing, when the author has not named an angle.
     *
     * The variant's whole idea is a ping-pong: the opening steps out and comes
     * back. Authored as an absolute angle that idea *saturates* -- at a slow BPM
     * the reachability budget is small, the clamp pins the outbound ring to the
     * budget limit and the return ring to the authored angle, and the sequence
     * flattens into ROTATING_GAP with fewer rings. Sizing the swing as a fixed
     * share of whatever the budget actually is keeps it a deliberate, visibly
     * sub-maximal round trip at every tempo, and it can never exceed the floor
     * because the budget *is* the floor.
     */
    const alternateSwing = rotationAuthored ? rotationPerRing * 1.35 : maxEdgeStep * 0.8;

    const rings: Ring[] = [];
    let previousFirst = first;
    let previousHalfArc = 0;

    for (let i = 0; i < count; i++) {
      const arc = clamp(baseArc * Math.pow(narrowing, variant === 'NARROWING_GAP' ? i : 0), 0.12, Math.PI * 1.7);
      const halfArc = Math.max(arc / 2, minHalfArc);

      // Where this ring *wants* its first gap. Everything else is derived.
      let wanted: number;
      switch (variant) {
        case 'ROTATING_GAP':
          wanted = first + rotationPerRing * i;
          break;
        case 'ADVANCED_ALTERNATING':
          // Zig-zag: the opening steps out and comes back, so the player is
          // never asked to cross the whole arena twice in a row. `first` is the
          // ring the sequence starts on, so ring 1 is the return leg.
          wanted = first + alternateSwing * (i % 2 === 0 ? 0 : 1);
          break;
        case 'NARROWING_GAP':
        case 'FOLLOW_GAP':
        case 'BASIC_GAP':
        default:
          wanted = first;
          break;
      }

      // Reachability clamp. It is the gap *edges* that have to be walkable, not
      // the centres: a wedge whose centre barely moved can still throw its
      // trailing edge a long way if the ring also widened. So the step is
      // measured between nearest boundaries and the budget is spent on the
      // boundary, with the arc change coming out of the same allowance.
      let ringFirst = first;
      if (i > 0) {
        const anchor = nearestBoundary(previousFirst, gapCount, previousHalfArc, wanted, halfArc);
        const budget = Math.max(0, maxEdgeStep - Math.abs(halfArc - previousHalfArc));
        const step = clamp(angleDelta(anchor, wanted - halfArc), -budget, budget);
        ringFirst = anchor + step + halfArc;
      }
      const centres = spreadFrom(ringFirst, gapCount);

      rings.push({ activationBeat: this.activationBeat + i * this.staggerBeats, gapCentres: centres, halfArc });
      previousFirst = ringFirst;
      previousHalfArc = halfArc;
    }

    return rings;
  }

  /**
   * How far a gap's *edge* may be from the previous ring's nearest gap edge,
   * in radians.
   *
   * The worst case is not the player at the inner radius -- it is the player
   * parked at the outer rim of the safe wedge, because the same angular step is
   * a longer walk the further out you stand. Two wedges from the centre whose
   * nearest boundary rays are `phi` apart are at most `R * sin(phi)` apart
   * (beyond 90 degrees the shortest route is through the middle, which is `R`).
   * Inverting that against the distance the player covers between rings gives
   * the budget: `phi <= asin(travel / R)`.
   *
   * With the library's ring at 120 BPM and two beats between rings this lands
   * near 50 degrees, which is what makes "never flip a gap 180 degrees between
   * close rings" true by construction instead of by careful authoring.
   */
  private maxGapEdgeStep(): number {
    const spb = Math.max(0.01, this.spawn.clock.secondsPerBeat);
    const travel = TUNING.arena.playerSpeed * spb * this.staggerBeats * REACH_FRACTION;
    return Math.asin(clamp(travel / ARENA_OUTER_RADIUS, 0, 1));
  }

  // ---- geometry ----------------------------------------------------------

  /** Radius of one ring's centre line, at `beat`. */
  private radiusOf(ring: Ring, beat: number): number {
    const t = easeInOut(clamp((beat - ring.activationBeat) / Math.max(0.25, this.sweepBeats), 0, 1));
    return this.collapse
      ? ARENA_OUTER_RADIUS - t * (ARENA_OUTER_RADIUS - minRingRadius(this.thickness))
      : minRingRadius(this.thickness) + t * ARENA_OUTER_RADIUS;
  }

  protected override onPhaseChange(_from: MechanicPhase, to: MechanicPhase): void {
    if (to === 'TELEGRAPH') this.feel.sfx('laser_charge', 0.6);
    if (to === 'ACTIVE') {
      this.feel.impact('HEAVY', { x: 0.5, y: 0.5, colour: COLOUR, sfx: 'chain_impact' });
    }
  }

  protected dangerShapes(): Shape[] {
    const beat = this.spawn.clock.absoluteBeat;
    const shapes: Shape[] = [];
    for (const ring of this.rings) {
      const radius = this.radiusOf(ring, beat);
      const inner = Math.max(0, radius - this.thickness / 2);
      const outer = radius + this.thickness / 2;
      for (const [a0, a1] of dangerArcs(ring.gapCentres, ring.halfArc * 2)) {
        shapes.push({ kind: 'sector' as const, ...sector(inner, outer, a0, a1) });
      }
    }
    return shapes;
  }

  // ---- presentation ------------------------------------------------------

  render(r: Renderer): void {
    const beat = this.spawn.clock.visualBeat;

    if (this.phase === 'TELEGRAPH') {
      this.renderTelegraph(r, beat);
      return;
    }
    if (this.phase !== 'ACTIVE') return;

    for (const ring of this.rings) {
      const radius = this.radiusOf(ring, beat);
      const inner = Math.max(0, radius - this.thickness / 2);
      const outer = radius + this.thickness / 2;
      for (const [a0, a1] of dangerArcs(ring.gapCentres, ring.halfArc * 2)) {
        r.fillAnnulusSector(ARENA_CENTRE.x, ARENA_CENTRE.y, inner, outer, a0, a1, COLOUR, 0.92);
        r.strokeArc(ARENA_CENTRE.x, ARENA_CENTRE.y, radius, a0, a1, EDGE, 2, 0.7);
      }
    }
  }

  /**
   * Telegraph: the danger arcs are drawn where the ring *will be*, the safe
   * wedges are filled solid, and any later rings preview as thin arcs at the
   * same radius -- so a rotating sequence reads as a sequence rather than as one
   * ring that moved.
   */
  private renderTelegraph(r: Renderer, beat: number): void {
    const t = easeIn(this.telegraphProgress(beat));
    const first = this.rings[0];
    const radius = this.radiusOf(first, this.activationBeat);

    for (const [a0, a1] of dangerArcs(first.gapCentres, first.halfArc * 2)) {
      r.strokeArc(ARENA_CENTRE.x, ARENA_CENTRE.y, radius, a0, a1, COLOUR, 2 + 4 * t, 0.2 + 0.4 * t);
    }

    for (const centre of first.gapCentres) {
      r.fillAnnulusSector(
        ARENA_CENTRE.x, ARENA_CENTRE.y, 0.04, ARENA_OUTER_RADIUS,
        centre - first.halfArc, centre + first.halfArc, SAFE, 0.05 + 0.08 * t,
      );
      const tip = polarToField(centre, 0.42);
      r.text('SAFE', tip.x, tip.y, SAFE, 11, 'center', 0.25 + 0.5 * t);
    }

    for (let i = 1; i < this.rings.length; i++) {
      const ring = this.rings[i];
      for (const centre of ring.gapCentres) {
        const from = polarToField(centre - ring.halfArc, radius);
        const to = polarToField(centre + ring.halfArc, radius);
        r.line(from.x, from.y, to.x, to.y, SAFE, 2, (0.10 + 0.25 * t) / i);
      }
    }
  }
}

// ---- helpers -------------------------------------------------------------

/** Gap centres evenly spaced around the circle, starting at `first`. */
function spreadFrom(first: number, count: number): number[] {
  const n = Math.max(1, Math.round(count));
  const step = (Math.PI * 2) / n;
  return Array.from({ length: n }, (_, i) => first + i * step);
}

/**
 * The angular position of the previous ring's boundary nearest a wanted edge.
 *
 * With several gaps per ring the player is standing in one of them, and the
 * step that matters is the one they will actually have to make. Nearest is the
 * generous reading, and the one the clamp should protect.
 */
function nearestBoundary(
  previousFirst: number,
  gapCount: number,
  previousHalfArc: number,
  wantedCentre: number,
  wantedHalfArc: number,
): number {
  const wantedEdge = wantedCentre - wantedHalfArc;
  let best = previousFirst - previousHalfArc;
  let bestDistance = Infinity;
  for (const centre of spreadFrom(previousFirst, gapCount)) {
    for (const edge of [centre - previousHalfArc, centre + previousHalfArc]) {
      const distance = Math.abs(angleDelta(edge, wantedEdge));
      if (distance < bestDistance) { bestDistance = distance; best = edge; }
    }
  }
  return best;
}

function readVariant(value: unknown): RingVariant {
  const name = String(value ?? 'BASIC_GAP').toUpperCase();
  return (VARIANTS as string[]).includes(name) ? (name as RingVariant) : 'BASIC_GAP';
}

function numberOr(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

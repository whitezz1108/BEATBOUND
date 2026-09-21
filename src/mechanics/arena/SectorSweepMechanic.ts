/**
 * A11 -- Sector Sweep (ARENA).
 *
 * The arena is cut into wedges and they go off *in turn*: one wedge is
 * dangerous, then its neighbour, then the next. The player is never asked to
 * find a gap -- there is always a safe majority of the arena -- they are asked
 * to keep moving around it, at the sweep's pace, without being caught in the
 * wedge that is live right now.
 *
 * This is the one floor hazard whose danger is *sequential* rather than fixed.
 * `FloorWarningMechanic`'s `sector` layout lights a static quarter and leaves it
 * lit; a sweep that never moves is just a smaller arena. What makes this
 * mechanic a different question is the order: the live wedge advances, so the
 * answer changes every step and standing still is only ever correct for one of
 * them.
 *
 * Fairness, as everywhere in the arena, is geometry rather than authoring:
 *
 *   1. The stride. The front advances one stride per step and the player stays
 *      ahead of it by matching that pace, so the stride has to be walkable
 *      inside one step. This is where a sweep differs from a gap: the answer is
 *      a *pace*, not a place, and the front's stride is the pace being asked
 *      for. `skipStep` costs what it should here rather than being free --
 *      skipping a wedge doubles the stride, so the floor rises with it.
 *   2. Warning. Each wedge owes the same warning a ring does: the telegraph plus
 *      one step has to cover the walk out of the wedge being lit.
 *      `ensureWarningFloor`, the same helper the chains and the ring use.
 *
 * Both floors only ever *slow the sweep down*, never shrink a wedge, so a level
 * too fast for its tempo gets a longer sequence rather than a tighter one. The
 * window covers exactly the wedges the sweep visits, so the last one finishes as
 * the mechanic stops being dangerous -- and with `skipStep` set, the wedges it
 * never reaches stay safe for the whole event.
 *
 * Params:
 *   sectorCount     wedges the arena is cut into        default 6
 *   sweepDirection  "CW" | "CCW"                        default "CW"
 *   skipStep        wedges skipped between activations  default 0
 *   sweepSteps      how many wedges the sweep visits    default: all reachable
 *   firstAngleDeg   where wedge 0 starts                default -90
 *   startSector     wedge the sequence opens on         default 0
 *   innerRadius     hole at the centre, 0 = none        default 0
 *
 * ANTICIPATION: every wedge boundary is drawn, the opening wedges charge in
 *               order, and the direction arrow points the way the sweep travels.
 * ACTION:       the live wedge burns, the next one outlines, and the leading
 *               edge of the burn carries a bright rim so the front is readable.
 * IMPACT:       a kick on the activation beat and another on every step.
 */

import { BaseMechanic, type MechanicSpawnContext, type MechanicPhase } from '../../core/Mechanic';
import type { Shape } from '../../core/geometry';
import { clamp } from '../../core/geometry';
import { ensureWarningFloor, maxGapShiftPerBeat } from '../../core/fairness';
import { easeIn, easeOutCubic } from '../../feel/Easing';
import type { Renderer } from '../../core/Renderer';
import { ARENA_CENTRE, ARENA_OUTER_RADIUS, degToRad, polarToField, sector } from './polar';
import { slowed } from './arenaTiming';

const COLOUR = '#ff7a45';
const EDGE = '#ffd0a8';
const NEXT = '#ffe9c2';

/** No step may be longer than this, however slow the tempo or wide the wedge. */
const MAX_STEP_BEATS = 4;

export class SectorSweepMechanic extends BaseMechanic {
  private readonly sectors: number;
  private readonly arc: number;
  private readonly first: number;
  /** +1 for CW (increasing angle), -1 for CCW. */
  private readonly dir: number;
  private readonly skip: number;
  private readonly rInner: number;
  /** Beats each wedge stays live. One full lap is `visits * stepBeats`. */
  private readonly stepBeats: number;
  /** How many wedges the sweep actually lights, out of `sectors`. */
  private readonly visits: number;
  private readonly startSector: number;

  constructor(spawn: MechanicSpawnContext) {
    super(slowed(spawn));

    this.sectors = clamp(Math.round(numberOr(this.params.sectorCount, 6)), 3, 12);
    this.arc = (Math.PI * 2) / this.sectors;
    this.first = degToRad(numberOr(this.params.firstAngleDeg, -90));
    this.dir = String(this.params.sweepDirection ?? 'CW').toUpperCase() === 'CCW' ? -1 : 1;
    this.skip = clamp(Math.round(numberOr(this.params.skipStep, 0)), 0, Math.max(0, this.sectors - 2));
    this.rInner = clamp(numberOr(this.params.innerRadius, 0), 0, 0.3);
    this.startSector = ((Math.round(numberOr(this.params.startSector, 0)) % this.sectors) + this.sectors) % this.sectors;

    const spb = Math.max(0.01, this.spawn.clock.secondsPerBeat);
    // The authored pace: the library's window divided among the wedges. The floor
    // below may raise it; nothing may lower it.
    let step = clamp(this.timing.durationBeats / this.sectors, 0.15, MAX_STEP_BEATS);

    // Floor -- reachability, measured as the walk *out of a wedge* rather than
    // around the rim.
    //
    // This is the load-bearing difference between a sweep and a gap. A gap is a
    // place the player has to reach, so its budget is the walk to it; a sweep's
    // answer is a pace, and the walk it asks for is simply "stop being in the
    // wedge that is lit". A wedge is a triangle with its apex at the centre, so
    // that walk is at most half its angular width at whatever radius the player
    // is standing -- and shorter the further in they are, which is exactly why a
    // sweep can be answered by retreating toward the middle as well as by
    // circling. Measuring it at the rim is therefore the honest worst case, and
    // it is why a sweep never demands the arena-crossing a ring does.
    //
    // Spent against the same `maxGapShiftPerBeat` budget every moving hazard uses,
    // 0.85 share included, so a chase stays a chase rather than an exact-tie
    // sprint. `skipStep` does not enter here -- the escape is one wedge either
    // way; what skipping shortens is the cycle, which is a difficulty change the
    // author is entitled to make.
    const escapeDistance = Math.min(ARENA_OUTER_RADIUS, ARENA_OUTER_RADIUS * this.arc / 2);
    const perBeat = maxGapShiftPerBeat(spb);
    if (perBeat > 1e-4) step = Math.max(step, escapeDistance / perBeat);

    // Floor -- the arena's comfort floor on the combined warning, the same one the
    // chains and the ring are held to. Usually subsumed by the escape floor, but
    // it is what keeps a many-wedge sweep from reading as a strobe.
    step = Math.max(step, ensureWarningFloor(this.timing.telegraphBeats, step, spb));
    this.stepBeats = step;

    // A full lap by default: every wedge the sweep can reach gets its turn, and
    // any it never reaches stays safe for the whole event -- which is what
    // `skipStep` is for. `sweepSteps` caps it for authors who want a half lap.
    const reachable = Math.max(1, Math.ceil(this.sectors / (this.skip + 1)));
    this.visits = clamp(Math.round(numberOr(this.params.sweepSteps, reachable)), 1, reachable);
    (this.timing as { durationBeats: number }).durationBeats = this.stepBeats * this.visits;
  }

  /**
   * The wedge that is live at `beat`, or -1 outside the sweep.
   *
   * Steps are counted from the activation beat, so the same beat always lights
   * the same wedge -- a replay is identical, and the telegraph can preview the
   * opening wedges by asking this directly rather than by duplicating the order.
   */
  private liveAt(beat: number): number {
    const index = Math.floor((beat - this.activationBeat) / this.stepBeats);
    if (index < 0 || index >= this.visits) return -1;
    return (this.startSector + index * (this.skip + 1)) % this.sectors;
  }

  /** Start angle of wedge `index`. */
  private angleOf(index: number): number {
    return this.first + index * this.arc;
  }

  protected override onPhaseChange(_from: MechanicPhase, to: MechanicPhase): void {
    if (to === 'TELEGRAPH') this.feel.sfx('laser_charge', 0.5);
    if (to === 'ACTIVE') {
      this.feel.impact('MEDIUM', { x: ARENA_CENTRE.x, y: ARENA_CENTRE.y, colour: COLOUR, shockwave: true });
    }
  }

  protected override onUpdate(u: { beat: number }): void {
    // A tick per step, so the sweep is audible as a pulse rather than as one
    // long burn. Only while it is actually sweeping.
    if (this.phase !== 'ACTIVE') return;
    const index = Math.floor((u.beat - this.activationBeat) / this.stepBeats);
    if (index !== this.lastStep && index >= 0 && index < this.visits) {
      this.lastStep = index;
      this.feel.sfx('floor_warning', 0.4);
    }
  }
  private lastStep = -1;

  protected dangerShapes(): Shape[] {
    const live = this.liveAt(this.spawn.clock.absoluteBeat);
    if (live < 0) return [];
    return [{
      kind: 'sector' as const,
      ...sector(this.rInner, ARENA_OUTER_RADIUS, this.angleOf(live), this.angleOf(live) + this.arc),
    }];
  }

  /**
   * Share of the telegraph spent in the urgent tail.
   *
   * A sweep's warning is short by construction -- the previous wedge is still
   * live while the next one is being announced -- so the tail is what carries
   * the "now" signal. Opting in here is the reason `criticalFraction` exists.
   */
  protected override get criticalFraction(): number { return 0.4; }

  render(r: Renderer): void {
    const beat = this.spawn.clock.visualBeat;

    if (this.phase === 'TELEGRAPH') {
      this.renderTelegraph(r, beat);
      return;
    }
    if (this.phase !== 'ACTIVE') return;

    const live = this.liveAt(beat);
    const t = clamp((beat - this.activationBeat) / this.stepBeats, 0, 1);

    // The wedge after this one, outlined while it is still safe. This is the
    // whole readability story of the mechanic: the player is always being shown
    // where the danger is going, not only where it is.
    const next = this.liveAt(beat + this.stepBeats);
    if (next >= 0) {
      r.fillAnnulusSector(
        ARENA_CENTRE.x, ARENA_CENTRE.y, this.rInner, ARENA_OUTER_RADIUS,
        this.angleOf(next), this.angleOf(next) + this.arc, NEXT, 0.10,
      );
      r.strokeArc(ARENA_CENTRE.x, ARENA_CENTRE.y, ARENA_OUTER_RADIUS * 0.94,
        this.angleOf(next), this.angleOf(next) + this.arc, NEXT, 2, 0.35 + 0.3 * t);
    }

    if (live >= 0) {
      const a0 = this.angleOf(live);
      const a1 = a0 + this.arc;
      r.fillAnnulusSector(ARENA_CENTRE.x, ARENA_CENTRE.y, this.rInner, ARENA_OUTER_RADIUS, a0, a1, COLOUR, 0.9);
      // The leading edge is where the front is. Brightening it as the step runs
      // out turns "this wedge is bad" into "this wedge is about to stop being
      // bad", which is the read the player actually needs to plan the next move.
      const lead = this.dir > 0 ? a1 : a0;
      r.line(
        ARENA_CENTRE.x + Math.cos(lead) * this.rInner,
        ARENA_CENTRE.y + Math.sin(lead) * this.rInner,
        ARENA_CENTRE.x + Math.cos(lead) * ARENA_OUTER_RADIUS,
        ARENA_CENTRE.y + Math.sin(lead) * ARENA_OUTER_RADIUS,
        EDGE, 2 + 2 * t, 0.55 + 0.4 * t,
      );
    }
  }

  private renderTelegraph(r: Renderer, beat: number): void {
    const t = easeIn(this.telegraphProgress(beat));
    const urgent = this.isCritical;

    // Every boundary, so the arena's division is legible before anything moves.
    for (let i = 0; i < this.sectors; i++) {
      const a = this.angleOf(i);
      r.line(
        ARENA_CENTRE.x + Math.cos(a) * this.rInner,
        ARENA_CENTRE.y + Math.sin(a) * this.rInner,
        ARENA_CENTRE.x + Math.cos(a) * ARENA_OUTER_RADIUS,
        ARENA_CENTRE.y + Math.sin(a) * ARENA_OUTER_RADIUS,
        EDGE, 1, 0.10 + 0.12 * t,
      );
    }

    // The opening wedge, and the two after it, ghosted in order. Showing the
    // order rather than only the first step is what makes a sweep predictable.
    for (let k = 0; k < 3; k++) {
      const index = (this.startSector + k * (this.skip + 1)) % this.sectors;
      const a0 = this.angleOf(index);
      const alpha = (k === 0 ? 0.10 + 0.28 * t : 0.05 + 0.10 * t) / (k + 1);
      r.fillAnnulusSector(ARENA_CENTRE.x, ARENA_CENTRE.y, this.rInner, ARENA_OUTER_RADIUS, a0, a0 + this.arc, COLOUR, alpha);
      r.strokeArc(ARENA_CENTRE.x, ARENA_CENTRE.y, ARENA_OUTER_RADIUS * 0.94, a0, a0 + this.arc,
        k === 0 ? EDGE : COLOUR, k === 0 ? 2 + 3 * t : 1.5, (0.2 + 0.4 * t) / (k + 1));
    }

    // Direction arrow at the rim, opposite the opening wedge so it reads as
    // "and then it goes this way" rather than as part of the first wedge.
    const mid = this.angleOf(this.startSector) + this.arc / 2;
    const tail = polarToField(mid - this.dir * this.arc * 0.9, ARENA_OUTER_RADIUS * 0.82);
    const head = polarToField(mid + this.dir * this.arc * 0.9, ARENA_OUTER_RADIUS * 0.82);
    const arrow = 0.5 + 0.5 * easeOutCubic(t);
    r.line(tail.x, tail.y, head.x, head.y, urgent ? '#fff3d0' : NEXT, 2 + 2 * arrow, 0.25 + 0.5 * t);

    // The urgent tail: the opening wedge pulses, which is the fourth stage the
    // floor hazard already uses and the reason it reads as "now".
    if (urgent) {
      const a0 = this.angleOf(this.startSector);
      const pulse = 0.5 + 0.5 * Math.sin(beat * Math.PI);
      r.strokeArc(ARENA_CENTRE.x, ARENA_CENTRE.y, ARENA_OUTER_RADIUS * 0.9, a0, a0 + this.arc,
        '#fff3d0', 3 + 2 * pulse, 0.5 + 0.4 * pulse);
    }
  }
}

function numberOr(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

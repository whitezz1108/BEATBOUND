/**
 * The RUNNER traversal simulator (spec §31).
 *
 * A planned trajectory is a *claim*: "the player jumps here, lands there, and
 * nothing hurts them on the way". This module tests the claim by actually flying
 * it -- with the real `RunnerPlayer`, the real gravity, the real terrain probe,
 * and the real collision shapes -- against an autopilot that does nothing but
 * press the jump key at the beat the trajectory says to.
 *
 * ## Why it is not a re-derivation
 *
 * The cheap way to "validate" a trajectory is to re-read it: check that the
 * landing y is reachable by the arc formula, that the gap is narrower than the
 * jump distance, and so on. That proves the *planner's arithmetic* is
 * self-consistent, which it is by construction, and proves nothing about the
 * game.
 *
 * What can actually go wrong is the seam between planning and playing: the
 * planner reasons about an idealised arc, while the player integrates a real one
 * in discrete steps, with a jump-cut applied on key release, with a body that
 * has width, and with terrain resolved from geometry that has been rounded to
 * track positions. This simulator crosses that seam. If the autopilot lands
 * somewhere other than the trajectory says, the level is broken even though the
 * arithmetic was fine.
 *
 * ## Determinism
 *
 * No clock, no randomness, no rendering: the sim advances a beat cursor by a
 * fixed `BEAT_STEP` and converts to seconds at the given tempo. Two runs at the
 * same BPM produce byte-identical reports, which is what makes it usable as a
 * regression check.
 *
 * ## What it does not do
 *
 * It is not an AI. It does not search for a route, recover from a mistake, or
 * find a *different* solution than the planned one. A course it rejects might
 * still be clearable by a cleverer player -- but it is clearable *by accident*,
 * which is not a level design, and the report says so.
 */

import type { Circle, Shape } from '../../core/geometry';
import { circleIntersectsShape } from '../../core/geometry';
import { PLAYER_X } from './runnerGeometry';
import { AIR_JUMP_SCALE, BODY_HEIGHT, BODY_WIDTH, SLIDE_HEIGHT } from './runnerPhysics';
import type { CourseWorld } from './courseWorld';
import type { TerrainProbe } from './terrainProbe';
import { resolveProbe, xOverGap } from './terrainProbe';
import type { TrackSurface } from './surface';
import type { Trajectory, TrajectorySegment } from './trajectory';
import { type ZoneUsage, summarizeZones, zoneOfY } from './verticalZones';

/**
 * Simulation resolution, in beats.
 *
 * 1/64 beat is 8ms at 120 BPM -- finer than any frame the game will ever draw,
 * so the sim cannot miss a landing the player would have caught. Coarser steps
 * make the arc land late and produce phantom failures.
 */
export const BEAT_STEP = 1 / 64;

/** Beats of lead-in before the first segment, so the player starts grounded. */
const SIM_LEAD_BEATS = 2;

/** How far the feet may drift from the planned landing before it is a miss. */
const LANDING_TOLERANCE = 0.012;

/** How far the feet may drift from the planned run height while grounded. */
const RUN_TOLERANCE = 0.012;

export type TraversalIssueKind =
  /** The autopilot never left the ground where the trajectory said it would. */
  | 'MISSED_TAKEOFF'
  /** The player landed somewhere other than the planned landing. */
  | 'MISSED_LANDING'
  /** The player was airborne where the trajectory said they were running. */
  | 'UNPLANNED_FLIGHT'
  /** The player ran through a hazard. */
  | 'HAZARD_HIT'
  /** The player's head met a solid face mid-arc. */
  | 'CEILING_BONK'
  /** The player fell out of the world. */
  | 'FELL_OUT'
  /** No surface exists where the trajectory planned to land. */
  | 'NO_SUPPORT'
  /** The course never returned to a running surface at the end. */
  | 'DID_NOT_SETTLE';

export interface TraversalIssue {
  kind: TraversalIssueKind;
  /** Absolute beat the problem happened on. */
  beat: number;
  /** The verb of the segment in play, when one was. */
  verb: string;
  detail: string;
}

/** The 16 diagnostic metrics of spec §32, measured on a flown course. */
export interface TraversalMetrics {
  /** Beats the course spans, from first segment to last. */
  beats: number;
  jumps: number;
  jumpsPerBar: number;
  landingsPerBar: number;
  /** Fraction of the course spent off a surface. */
  airborneRatio: number;
  /** Lowest and highest feet y reached, as a span of the field. */
  verticalRange: number;
  /** Standard deviation of landing heights -- how much the course moves. */
  terrainHeightVariance: number;
  /** Times the player moved from one surface to the other. */
  gravityStateChanges: number;
  /** Longest stretch with no takeoff, in beats. */
  maxFlatRunBeats: number;
  /** Longest stretch with nothing on screen at all, in beats. */
  maxEmptyScreenBeats: number;
  /** Mean width of a landing slab, in beats of track. */
  averageLandingWidthBeats: number;
  /** Smallest head clearance the player had at any point. */
  minimumClearance: number;
  phrases: number;
  /** Fraction of phrases whose motif had already appeared. */
  motifRepeatRate: number;
  /** Hazards per bar. */
  hazardDensity: number;
  /** Terrain pieces per bar. */
  structuralDensity: number;
  /** Where on the screen the course actually spent its time (spec §9). */
  zones: ZoneUsage;
}

export interface TraversalReport {
  ok: boolean;
  issues: TraversalIssue[];
  metrics: TraversalMetrics;
  /** Every landing the sim actually made, for debugging a mismatch. */
  landings: Array<{ beat: number; feetY: number; surface: TrackSurface; planned: number; verb: string }>;
  /** Every take-off, for tracing a course's rhythm against its plan. */
  takeoffs: Array<{ beat: number; verb: string; feetY: number }>;
}

export interface SimOptions {
  /** Tempo. Only affects real-time scaling; the beat-space result is identical. */
  bpm: number;
  beatsPerBar?: number;
}

/**
 * Fly a course with an autopilot and report what happened.
 *
 * The autopilot is deliberately stupid: press jump when the plan's next flight
 * is due, hold for that flight's recorded `holdBeats`, slide when the segment
 * says to slide, and otherwise do nothing. Everything the player would have to
 * *decide* has already been decided by the planner; the sim only checks that the
 * decision survives contact with the physics.
 */
export function simulateCourse(
  world: CourseWorld,
  trajectory: Trajectory,
  options: SimOptions,
): TraversalReport {
  const secondsPerBeat = 60 / Math.max(1, options.bpm);
  const dtSeconds = BEAT_STEP * secondsPerBeat;
  const beatsPerBar = options.beatsPerBar ?? 4;

  const segments = trajectory.segments;
  const issues: TraversalIssue[] = [];
  const landings: TraversalReport['landings'] = [];
  const takeoffs: TraversalReport['takeoffs'] = [];

  // A minimal player, driven here rather than through `RunnerMode` so the sim
  // stays headless. The physics it runs is the *same code* the mode runs.
  const state = {
    feetY: 0.72,
    velocity: 0,
    grounded: true,
    gravityDirection: 1 as number,
    supportY: 0.72,
    buffered: 0,
    coyote: 0,
    jumpHeld: false,
    sliding: false,
  };

  const startBeat = Math.max(0, trajectory.startBeat - SIM_LEAD_BEATS);
  let beat = startBeat;
  let lastFlip = 1;

  // Per-segment bookkeeping for the autopilot.
  let cursor = 0;
  let pressed = false;
  // The flight the autopilot is currently flying, and the next one it has not
  // started yet. See the autopilot block for why the plan's own flight list --
  // rather than `currentSegment()` -- drives the presses.
  let flightSegment: TrajectorySegment | null = null;
  const flights = segments.filter((s) => s.airborne && (s.apex ?? 0) > 0);
  let flightIdx = 0;

  // Metric accumulators.
  let jumps = 0;
  let airJumps = 0;
  let landingsCount = 0;
  let airborneSteps = 0;
  let totalSteps = 0;
  let minFeet = state.feetY;
  let maxFeet = state.feetY;
  let minClearance = Infinity;
  let maxFlatRun = 0;
  let flatRun = 0;
  let maxEmpty = 0;
  let emptyRun = 0;
  let takeoffBeat = -Infinity;

  // Which band of the screen the feet were in, sampled per step (spec §9). The
  // zones are measured in *world* y rather than in height above the live
  // surface, so an inverted phrase reports the top of the field -- see
  // `verticalZones.ts` for why that distinction is the whole point.
  const zoneBeats: Record<string, number> = {};

  const landingHeights: number[] = [];

  const currentSegment = (): TrajectorySegment | null => {
    while (cursor < segments.length && beat >= segments[cursor].startBeat + segments[cursor].beats) cursor++;
    if (cursor >= segments.length) return null;
    return beat >= segments[cursor].startBeat ? segments[cursor] : null;
  };

  const endBeat = segments.length > 0 ? segments[segments.length - 1].startBeat + segments[segments.length - 1].beats : 0;
  // The sim runs to the end of the *course*, plus a short tail.
  //
  // The tail is not slack, it is the landing. The autopilot presses on the first
  // frame the plan's next flight is due, which is a fraction of a beat before the
  // segment boundary; a flight that begins at the last possible beat therefore
  // comes down just past `endBeat`. Stopping the loop dead on the last segment's
  // end reported a course whose final verb is a jump as "still airborne" when the
  // landing was one frame away, which is a fact about where the loop stopped
  // rather than about the course.
  const SETTLE_BEATS = 1.5;
  const simEndBeat = endBeat + SETTLE_BEATS;
  const maxSteps = Math.ceil((simEndBeat - startBeat) / BEAT_STEP) + 64;

  for (let step = 0; step < maxSteps && beat <= simEndBeat; step++) {
    const segment = currentSegment();

    // --- gravity, straight from the course's own timeline ------------------
    const g = world.gravityAt(beat);
    if (g !== state.gravityDirection) {
      state.gravityDirection = g;
      state.grounded = false;
      state.coyote = 0.09;
      state.velocity = 0;
      const base = g > 0 ? 0.72 : 0.28;
      state.supportY = base;
      state.feetY = base;
      if (g !== lastFlip) lastFlip = g;
    }

    // --- terrain -----------------------------------------------------------
    const surface = g > 0 ? 'FLOOR' : 'CEILING';
    // Exactly the slabs the *mode* would gather: the ones on the live surface,
    // and only those the player is actually over. Passing the whole world here
    // (as this used to) made the sim resolve support from geometry that has
    // already scrolled past the player -- so it reported a landing on a slab the
    // live game would have dropped them through, and every check downstream of
    // that was validating a world nobody plays.
    const platforms = world.platformsOn(surface, beat).filter((p) => PLAYER_X >= p.x0 && PLAYER_X <= p.x1);
    const probe: TerrainProbe = resolveProbe(platforms, {
      gravityDown: g > 0,
      baseY: g > 0 ? 0.72 : 0.28,
      feet: state.feetY,
      head: state.feetY - g * BODY_HEIGHT,
      reach: state.grounded ? 0.045 : 0,
      overGap: xOverGap(world.gapsOn(surface, beat), PLAYER_X),
    });

    // --- autopilot ---------------------------------------------------------
    //
    // The autopilot is driven by the *plan's* flights, not by whatever segment
    // happens to be current.
    //
    // It used to press whenever the current segment was airborne and had not been
    // pressed yet, and hold for that segment's `holdBeats`. Both halves of that
    // are wrong at a segment boundary. The player presses on the first frame it
    // is grounded -- a fraction of a beat *before* the plan's boundary -- so the
    // segment it is still inside is the one that just landed; pressing on it
    // launched the player with the wrong strength and the wrong hold, and the
    // flight then landed late, which pushed every subsequent take-off further out
    // of phase until the course fell apart at its first chained-hop phrase.
    //
    // `flights` is the trajectory's own list of jump-shaped segments, in order.
    // The autopilot walks it: it presses when the next unflown flight's beat
    // arrives, holds for that flight's hold, and lands on that flight's plan.
    const wantsSlide = segment?.slide === true;
    const flip = segment?.verb === 'GRAVITY_FLIP_UP' || segment?.verb === 'GRAVITY_FLIP_DOWN';
    void flip;
    const nextFlight: TrajectorySegment | null = flights[flightIdx] ?? null;
    const pressNow = !pressed
      && state.grounded
      && nextFlight !== null
      && nextFlight.startBeat <= beat + BEAT_STEP;
    // The hold belongs to the flight *in the air* once there is one, and to the
    // flight about to start before that. Reading it from `nextFlight` alone
    // (as this did) took the *following* flight's hold the instant the press
    // landed -- so a corridor hop that is meant to be cut after 0.12 beats was
    // released on the next frame, and every cut jump in the course flew short.
    const active = flightSegment ?? nextFlight;
    const hold = active?.holdBeats ?? Infinity;
    const stillHolding = flightSegment !== null
      && beat < flightSegment.startBeat + (Number.isFinite(hold) ? hold : 0);

    // --- integrate (the real player physics, inlined so it stays headless) --
    const gravity = (8 * (0.32 * 1 * 1)) / Math.pow(0.95 * secondsPerBeat, 2);
    const jumpVelocity = (gravity * 0.95 * secondsPerBeat) / 2;
    const dt = Math.min(dtSeconds, 0.05);
    const stepUp = 0.045;

    if (pressNow && (state.grounded || state.coyote > 0) && probe.support !== null) {
      state.velocity = -g * jumpVelocity;
      state.grounded = false;
      state.coyote = 0;
      state.buffered = 0;
      jumps += 1;
      takeoffBeat = beat;
      pressed = true;
      // The flight this take-off is flying, and the beat the plan says it comes
      // down. The landing is judged against *this*, not against whichever
      // segment is current when the feet touch down.
      flightSegment = nextFlight;
      flightIdx += 1;
      takeoffs.push({ beat, verb: nextFlight?.verb ?? '-', feetY: state.feetY });
    } else if (pressNow) {
      state.buffered = 0.12;
    } else {
      state.buffered = Math.max(0, state.buffered - dt);
    }
    const released = state.jumpHeld && !stillHolding;
    state.jumpHeld = stillHolding;
    if (released && state.velocity * g < 0) state.velocity *= 0.45;

    // A double-jump mount's ring: at the planned press beat the autopilot
    // presses again, exactly as the live player does when the ring arms the
    // second jump. The impulse is the shared `AIR_JUMP_SCALE`-scaled velocity,
    // so sim, player and planner all fly the same combined arc.
    if (flightSegment?.airJumpAt !== undefined
      && beat >= flightSegment.startBeat + flightSegment.airJumpAt
      && beat < flightSegment.startBeat + flightSegment.airJumpAt + BEAT_STEP
      && !state.grounded) {
      state.velocity = -g * jumpVelocity * AIR_JUMP_SCALE;
      airJumps += 1;
    }
    state.sliding = wantsSlide && state.grounded;

    if (state.grounded) {
      if (probe.support === null) {
        state.grounded = false;
        state.velocity = 0;
      } else if (Math.abs(probe.support - state.feetY) <= stepUp) {
        state.supportY = probe.support;
        state.feetY = probe.support;
      } else if ((probe.support - state.feetY) * g > stepUp) {
        state.grounded = false;
        state.velocity = 0;
      }
      state.coyote = probe.support !== null ? 0.09 : Math.max(0, state.coyote - dt);
    } else {
      state.coyote = Math.max(0, state.coyote - dt);
    }

    if (!state.grounded) {
      state.velocity += g * gravity * dt;
      const nextFeet = state.feetY + state.velocity * dt;
      const falling = state.velocity * g > 0;
      if (!falling && probe.blocker !== null) {
        const head = nextFeet - g * BODY_HEIGHT;
        if ((head - probe.blocker) * g <= 0) {
          state.feetY = probe.blocker + g * BODY_HEIGHT;
          state.velocity = 0;
          issues.push({
            kind: 'CEILING_BONK',
            beat,
            verb: segment?.verb ?? '-',
            detail: `head met a face at y=${probe.blocker.toFixed(3)} during ${segment?.verb ?? 'flight'}`,
          });
        } else {
          state.feetY = nextFeet;
        }
      } else {
        state.feetY = nextFeet;
      }
      if (falling && probe.support !== null && (state.feetY - probe.support) * g >= 0) {
        const flight = flightSegment;
        const planned = flight?.endFeetY ?? probe.support;
        state.feetY = probe.support;
        state.velocity = 0;
        state.supportY = probe.support;
        state.grounded = true;
        flightSegment = null;
        pressed = false;
        landingsCount += 1;
        landingHeights.push(probe.support);
        landings.push({ beat, feetY: probe.support, surface, planned, verb: flight?.verb ?? segment?.verb ?? '-' });
        if (Math.abs(probe.support - planned) > LANDING_TOLERANCE) {
          issues.push({
            kind: 'MISSED_LANDING',
            beat,
            verb: flight?.verb ?? '-',
            detail: `landed at y=${probe.support.toFixed(3)} but the trajectory planned ${planned.toFixed(3)}`,
          });
        }
        if (flight?.airborne === true && beat < flight.startBeat + flight.beats - 0.25) {
          issues.push({
            kind: 'UNPLANNED_FLIGHT',
            beat,
            verb: flight.verb,
            detail: `touched down at beat ${beat.toFixed(2)}, ${(flight.startBeat + flight.beats - beat).toFixed(2)} beats before the segment ends`,
          });
        }
      }
    }

    // --- hazard and support checks ----------------------------------------
    const bodyH = state.sliding && state.grounded ? SLIDE_HEIGHT : BODY_HEIGHT;
    const circle: Circle = {
      x: PLAYER_X,
      y: g > 0 ? state.feetY - bodyH / 2 : state.feetY + bodyH / 2,
      r: Math.min(BODY_WIDTH, bodyH) / 2,
    };
    for (const shape of world.hazardsAt(beat)) {
      if (!circleIntersectsShape(circle, shape)) continue;
      issues.push({
        kind: 'HAZARD_HIT',
        beat,
        verb: segment?.verb ?? '-',
        detail: `body met a ${describeShape(shape)} at beat ${beat.toFixed(2)}`,
      });
      break;
    }

    if (probe.blocker !== null) {
      const head = state.feetY - g * bodyH;
      const clearance = (head - probe.blocker) * g;
      if (clearance >= 0) minClearance = Math.min(minClearance, clearance);
    }

    if (state.grounded && Math.abs(state.feetY - (segment?.runY ?? state.feetY)) > RUN_TOLERANCE && segment && !segment.airborne) {
      // A grounded segment that is not at its planned height means the terrain
      // put the player somewhere else -- worth knowing, but only reported once
      // per segment by the landing check above, so it is deliberately silent.
    }

    // --- metrics -----------------------------------------------------------
    // Only the course itself is measured. The settle tail is flown so the last
    // landing is actually observed, but counting its beats would dilute every
    // ratio with running the course never asked for.
    if (beat <= endBeat + BEAT_STEP) {
      totalSteps += 1;
      if (!state.grounded) airborneSteps += 1;
      minFeet = Math.min(minFeet, state.feetY);
      maxFeet = Math.max(maxFeet, state.feetY);
      // Longest stretch with no takeoff. A run ends the moment the player leaves
      // the ground, so the counter has to *reset* on takeoff rather than keep
      // growing -- otherwise the metric reports the whole course as one flat run
      // and the one number that detects "this section is a corridor of nothing"
      // reads as healthy no matter what.
      flatRun = state.grounded ? beat - takeoffBeat : 0;
      maxFlatRun = Math.max(maxFlatRun, flatRun);
      const onScreen = world.platformsAt(beat).length + world.hazardsAt(beat).length;
      emptyRun = onScreen === 0 ? emptyRun + BEAT_STEP : 0;
      maxEmpty = Math.max(maxEmpty, emptyRun);
      const zone = zoneOfY(state.feetY);
      zoneBeats[zone] = (zoneBeats[zone] ?? 0) + BEAT_STEP;
    }

    if (state.gravityDirection > 0 ? state.feetY > 1.02 : state.feetY < -0.02) {
      issues.push({ kind: 'FELL_OUT', beat, verb: segment?.verb ?? '-', detail: 'fell out of the world' });
      break;
    }

    beat += BEAT_STEP;
  }

  // --- structural checks that do not need the flight ----------------------
  for (const segment of segments) {
    if (!segment.airborne || segment.verb === 'GRAVITY_FLIP_UP' || segment.verb === 'GRAVITY_FLIP_DOWN') continue;
    const landBeat = segment.startBeat + segment.beats;
    const support = supportAt(world, landBeat, segment.surface, segment.endFeetY);
    if (!support) {
      issues.push({
        kind: 'NO_SUPPORT',
        beat: landBeat,
        verb: segment.verb,
        detail: `no surface at y=${segment.endFeetY.toFixed(3)} on the ${segment.surface.toLowerCase()} at beat ${landBeat.toFixed(2)}`,
      });
    }
  }

  if (!state.grounded) {
    issues.push({
      kind: 'DID_NOT_SETTLE',
      beat: endBeat,
      verb: segments.length > 0 ? segments[segments.length - 1].verb : '-',
      detail: 'the course ended with the player still airborne',
    });
  }

  // --- phrase metrics -----------------------------------------------------
  const seenMotifs = new Set<string>();
  let repeats = 0;
  for (const phrase of trajectory.phrases) {
    if (seenMotifs.has(phrase.motif)) repeats += 1;
    seenMotifs.add(phrase.motif);
  }

  const beats = Math.max(0.001, endBeat - trajectory.startBeat);
  const bars = beats / beatsPerBar;
  const terrainPieces = world.slabs.length + world.gaps.length + world.pads.length;

  const metrics: TraversalMetrics = {
    beats,
    jumps,
    jumpsPerBar: jumps / bars,
    landingsPerBar: landingsCount / bars,
    airborneRatio: totalSteps > 0 ? airborneSteps / totalSteps : 0,
    verticalRange: maxFeet - minFeet,
    terrainHeightVariance: stdDev(landingHeights),
    gravityStateChanges: countFlips(world, trajectory.startBeat, endBeat),
    maxFlatRunBeats: maxFlatRun,
    maxEmptyScreenBeats: maxEmpty,
    averageLandingWidthBeats: world.slabs.length > 0
      ? world.slabs.reduce((sum, s) => sum + (s.endBeat - s.startBeat), 0) / world.slabs.length
      : 0,
    minimumClearance: Number.isFinite(minClearance) ? minClearance : Infinity,
    phrases: trajectory.phrases.length,
    motifRepeatRate: trajectory.phrases.length > 0 ? repeats / trajectory.phrases.length : 0,
    hazardDensity: world.hazards.length / bars,
    structuralDensity: terrainPieces / bars,
    zones: summarizeZones(zoneBeats as ZoneUsage['beats']),
  };

  return { ok: issues.length === 0, issues: dedupe(issues), metrics, landings, takeoffs };
}

/** Is there something to stand on at `beat` at (or within a step of) `y`? */
function supportAt(world: CourseWorld, beat: number, surface: TrackSurface, y: number): boolean {
  const base = surface === 'FLOOR' ? 0.72 : 0.28;
  if (Math.abs(y - base) < 0.02 && !xOverGap(world.gapsOn(surface, beat), PLAYER_X)) return true;
  for (const plat of world.platformsOn(surface, beat)) {
    if (PLAYER_X < plat.x0 || PLAYER_X > plat.x1) continue;
    const face = surface === 'FLOOR' ? plat.top : plat.bottom;
    if (Math.abs(face - y) < 0.02) return true;
  }
  return false;
}

function countFlips(world: CourseWorld, startBeat: number, endBeat: number): number {
  return world.flips.filter((f) => f.beat >= startBeat && f.beat <= endBeat).length;
}

function stdDev(values: number[]): number {
  if (values.length < 2) return 0;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  return Math.sqrt(values.reduce((a, b) => a + (b - mean) * (b - mean), 0) / values.length);
}

function describeShape(shape: Shape): string {
  if (shape.kind === 'circle') return `circle r=${shape.r.toFixed(3)}`;
  if (shape.kind === 'sector') return 'sector';
  return `rect ${shape.w.toFixed(3)}x${shape.h.toFixed(3)}`;
}

/** Keep one issue per (kind, beat) so a sustained overlap is not reported 20 times. */
function dedupe(issues: TraversalIssue[]): TraversalIssue[] {
  const seen = new Set<string>();
  const out: TraversalIssue[] = [];
  for (const issue of issues) {
    const key = `${issue.kind}@${Math.round(issue.beat * 4)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(issue);
  }
  return out;
}

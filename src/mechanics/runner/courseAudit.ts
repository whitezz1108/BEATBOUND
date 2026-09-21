/**
 * Structural audit of a planned RUNNER course (spec §29, §30).
 *
 * `traversalSim.ts` answers "can this course be *flown*?" by flying it. This
 * answers the complementary question: "is this course *shaped* like a level?"
 * The two are not the same, and neither subsumes the other.
 *
 *   - A course can be flyable and still be broken: a spike sitting exactly on
 *     the running line, a slab buried inside another slab, a gap the autopilot
 *     happens to clear because the arc is generous that day. The sim reports
 *     "no issue" because nothing went wrong on the planned route -- but the
 *     route is unfair to a human who reads the screen rather than the plan.
 *   - A course can be well-shaped and still be unflyable: the plan says jump
 *     0.12 up and land on a slab, but the terrain was rounded somewhere and the
 *     feet arrive 0.02 off. The audit sees nothing wrong with the shape.
 *
 * So both run, and both are reported. Every check here reads `runnerPhysics.ts`
 * for its numbers -- the same module the planner used to build the course -- so
 * a check can never disagree with the thing it is checking about what a jump is
 * (spec §8).
 *
 * ## The fourteen failure modes
 *
 * Spec §29 names fourteen ways a RUNNER level goes wrong. Each one is a check
 * below, and each check is written to answer the *player's* question, not the
 * planner's: "is there a route here", not "did my own arithmetic work".
 */

import {
  BEAM_CLEARANCE_BAND,
  BODY_HEIGHT,
  DOUBLE_JUMP_LEVEL,
  doubleJumpArc,
  BODY_WIDTH,
  SLIDE_HEIGHT,
  UNITS_PER_BEAT,
  airBeatsFor,
  jumpArc,
  maxGapWidthForAirtime,
  maxRise,
  minLandingWidth,
} from './runnerPhysics';
import { blockFaceOf, placedFaceOf, standFaceOf, type CourseWorld, type WorldSlab } from './courseWorld';
import type { TrackSurface } from './surface';
import type { Trajectory, TrajectorySegment } from './trajectory';
import {
  BOTTOM_HEAVY_LIMIT,
  ENERGETIC_INTENSITY,
  samplePhraseZones,
  surfaceSideRatio,
} from './verticalZones';

/**
 * Take-off slack below which a jump stops being readable and starts being
 * frame-perfect. 0.10 beats is 50ms at 120 BPM -- a rhythm game's "good"
 * window, and the floor the whole mode is designed to stay above.
 */
export const COMFORT_BEATS = 0.1;

/**
 * Beats of nothing at all on screen before a stretch reads as an empty level
 * rather than a rest (spec §33). A bar and a half: long enough to be a
 * deliberate breath, short enough that it is never an accident.
 */
export const MAX_EMPTY_BEATS = 6;

/** How close two faces must be to count as the same line. */
const SAME_FACE = 0.004;

export type CourseIssueKind =
  /** A jump whose landing is above what the arc can reach (mode 1). */
  | 'UNREACHABLE_JUMP'
  /** A hole wider than the arc carries (mode 2). */
  | 'GAP_TOO_WIDE'
  /** A landing narrower than the body plus a re-take-off (mode 3). */
  | 'LANDING_TOO_NARROW'
  /** A landing with no room for the body under whatever is overhead (mode 4). */
  | 'LANDING_CLEARANCE'
  /** A solid face the arc's apex runs into (mode 5). */
  | 'CEILING_IN_ARC'
  /** A hazard sitting on the line the player runs, with no answer (mode 6). */
  | 'UNAVOIDABLE_HAZARD'
  /** A jump whose take-off window is under the comfort floor (mode 7). */
  | 'TIGHT_WINDOW'
  /** A flip whose destination surface is not solid (mode 8). */
  | 'BAD_GRAVITY_TRANSITION'
  /** Two slabs occupying the same beat on the same line (mode 9). */
  | 'SPAWN_OVERLAP'
  /** A hazard inside the arc the player is meant to fly (mode 10). */
  | 'HAZARD_IN_ARC'
  /** A corridor whose headroom is under a standing body (mode 11). */
  | 'CORRIDOR_TOO_NARROW'
  /** A slab whose far face crosses another slab's face (mode 12). */
  | 'SLAB_EMBEDDED'
  /** An inverted landing whose standable face is on the wrong side (mode 13). */
  | 'BAD_INVERTED_LANDING'
  /** A stretch with nothing on screen for longer than a rest (mode 14). */
  | 'EMPTY_SECTION'
  /** An energetic phrase that never left the bottom of the field (mode 15). */
  | 'FLAT_ENERGETIC_PHRASE';

export interface CourseIssue {
  kind: CourseIssueKind;
  /** Absolute beat the problem sits on. */
  beat: number;
  verb: string;
  detail: string;
}

export interface CourseAudit {
  issues: CourseIssue[];
  /** True when nothing at all was found. */
  ok: boolean;
}

/**
 * Every structural problem in a course, in beat order.
 *
 * Pure: it reads the world and the trajectory and touches nothing else, so it
 * can run offline over the whole library and inside the game on one section
 * without behaving differently.
 */
export function auditCourse(world: CourseWorld, trajectory: Trajectory): CourseAudit {
  const issues: CourseIssue[] = [];
  for (const segment of trajectory.segments) {
    checkReach(segment, world, issues);
    checkHazards(segment, world, issues);
    checkLanding(segment, world, issues);
  }
  checkOverlaps(world, issues);
  checkEmbedding(world, issues);
  checkEmptyStretches(world, trajectory, issues);
  checkPhraseZones(trajectory, issues);
  issues.sort((a, b) => a.beat - b.beat);
  return { issues: dedupe(issues), ok: issues.length === 0 };
}

// --------------------------------------------------------------------------
// Per-segment checks
// --------------------------------------------------------------------------

/**
 * The range of world y the player's *head* occupies between two beats of a
 * flight, as `[lowest, highest]` in world y.
 *
 * Read straight from `jumpArc`, the same arc the mode integrates and the planner
 * planned against, so a cut jump's asymmetric shape is reproduced rather than
 * approximated. `null` for a fall, which has no arc to sample -- a falling
 * player's head only descends, and there is nothing to bonk on the way.
 *
 * The window is clamped to the flight: a slab that overlaps only the first
 * instant of the arc is only in the way for that instant, and the head's height
 * at the apex it has not reached yet is not a collision.
 */
function headReach(
  segment: TrajectorySegment,
  from: number,
  to: number,
  g: number,
): [number, number] | null {
  if ((segment.apex ?? 0) <= 0) return null;
  // A double-jump mount is not one `jumpArc`: its second impulse lives in the
  // combined arc, and sampling it with a plain jump's shape would miss the
  // head's real highest point.
  const arc = segment.airJumpAt !== undefined ? doubleJumpArc() : jumpArc(segment.strength ?? 1, segment.holdBeats ?? Infinity);
  const t0 = Math.max(0, from - segment.startBeat);
  const t1 = Math.min(segment.beats, to - segment.startBeat);
  if (t1 <= t0) return null;
  const headAt = (t: number): number => segment.startFeetY - g * (arc.heightAt(t) + BODY_HEIGHT);
  // The arc is unimodal, so the extremes are the two endpoints plus the apex
  // when it falls inside the window.
  const apexT = segment.beats / 2;
  const samples = [headAt(t0), headAt(t1)];
  if (apexT > t0 && apexT < t1) samples.push(headAt(apexT));
  return [Math.min(...samples), Math.max(...samples)];
}

/** Modes 1, 2, 5, 7, 8, 11, 13 -- everything a single flight can get wrong. */
function checkReach(segment: TrajectorySegment, world: CourseWorld, issues: CourseIssue[]): void {
  const strength = segment.strength ?? 1;

  if (segment.airborne && segment.verb !== 'GRAVITY_FLIP_UP' && segment.verb !== 'GRAVITY_FLIP_DOWN') {
    // Mode 1: the landing is above what the arc reaches. A double-jump mount
    // is judged against the combined arc's landing ceiling instead: reaching
    // `DOUBLE_JUMP_LEVEL` is the verb's whole point, and the audit's job here
    // is only to refuse a block planned *above* what two presses buy.
    const rise = riseOf(segment);
    const reachLimit = segment.airJumpAt !== undefined ? DOUBLE_JUMP_LEVEL : maxRise(strength);
    if (rise > reachLimit + SAME_FACE) {
      issues.push({
        kind: 'UNREACHABLE_JUMP',
        beat: segment.startBeat,
        verb: segment.verb,
        detail: `lands ${rise.toFixed(3)} above take-off but a ${strength === 1 ? '' : `${strength}x `}jump reaches ${reachLimit.toFixed(3)}`,
      });
    }

    // Mode 5: something solid sits inside the arc. The apex is where the head
    // goes, and the head is what hits.
    //
    // This has to be a *swept* test, not a height comparison. The player never
    // moves horizontally -- the world does -- so a slab is only in the way
    // during the beats it actually overlaps the body's x extent, and the head is
    // only at any given height for an instant. Comparing the apex against every
    // slab in the flight's time range (as this used to) reports the *landing* the
    // jump is aimed at as a ceiling: the head does pass the landing's underside
    // on the way up, but by then the slab has not scrolled into the player yet.
    //
    // The two tests below are therefore both about overlap:
    //
    //   - which beats is this slab over the body at all (`overlapFrom`/`To`);
    //   - inside that window, does the head's height range reach the slab's body.
    //
    // That is exactly the question `resolveProbe` answers per frame, asked
    // analytically over the whole arc -- so the audit and the physics agree.
    const g = gravityOf(segment);
    const halfWidth = BODY_WIDTH / 2 / UNITS_PER_BEAT;
    for (const slab of slabsUnder(world, segment, segment.startBeat, segment.startBeat + segment.beats)) {
      if (!slab.floating && Math.abs(placedFaceOf(slab, segment.surface) - segment.startFeetY) < SAME_FACE) continue;
      const blockFace = blockFaceOf(slab, segment.surface);
      const onBase = Math.abs(blockFace - baseOf(segment.surface)) < SAME_FACE;
      if (onBase) continue;
      const from = Math.max(segment.startBeat, slab.startBeat - halfWidth);
      const to = Math.min(segment.startBeat + segment.beats, slab.endBeat + halfWidth);
      if (to <= from) continue;
      const reach = headReach(segment, from, to, g);
      if (reach === null) continue;
      const hit = g > 0
        ? blockFace >= reach[0] - SAME_FACE && blockFace <= reach[1] + SAME_FACE
        : blockFace <= reach[1] + SAME_FACE && blockFace >= reach[0] - SAME_FACE;
      if (hit) {
        issues.push({
          kind: 'CEILING_IN_ARC',
          beat: segment.startBeat,
          verb: segment.verb,
          detail: `the head reaches y=${(g > 0 ? reach[0] : reach[1]).toFixed(3)} between beats ${from.toFixed(2)} and ${to.toFixed(2)}, where a face sits at ${blockFace.toFixed(3)}`,
        });
        break;
      }
    }

    // Mode 7: the take-off window. A jump that starts the instant the phrase
    // does and lands with no slack is a jump nobody can time.
    const slack = takeoffSlack(segment, world);
    if (slack !== null && slack < COMFORT_BEATS) {
      issues.push({
        kind: 'TIGHT_WINDOW',
        beat: segment.startBeat,
        verb: segment.verb,
        detail: `only ${slack.toFixed(3)} beats of take-off slack (comfort floor ${COMFORT_BEATS})`,
      });
    }

    // Mode 13: an inverted landing has to arrive on a face that hangs.
    if (segment.surface === 'CEILING' && segment.lands) {
      const landBeat = segment.startBeat + segment.beats;
      const landed = slabsUnder(world, segment, landBeat, landBeat);
      const has = landed.some((s) => Math.abs(standFace(s, 'CEILING') - segment.endFeetY) < 0.02);
      const onBase = Math.abs(segment.endFeetY - baseOf('CEILING')) < 0.02;
      if (!has && !onBase) {
        issues.push({
          kind: 'BAD_INVERTED_LANDING',
          beat: landBeat,
          verb: segment.verb,
          detail: `no ceiling face at y=${segment.endFeetY.toFixed(3)} to land on`,
        });
      }
    }
  }

  // Mode 2: a hole wider than the arc carries.
  for (const demand of segment.demands) {
    if (demand.kind !== 'GAP') continue;
    // Judged against the *flight's own* airtime, not against what a full-hold
    // jump at this strength would have had. A cut jump is airborne for less and
    // therefore clears less, so measuring the hole against `maxGapWidth(strength)`
    // would pass holes that a tap cannot carry. This is the same function the
    // planner sized the hole with, so the two agree by construction.
    const limit = maxGapWidthForAirtime(segment.airBeats ?? airBeatsFor(strength));
    if (demand.width > limit + 1e-6) {
      issues.push({
        kind: 'GAP_TOO_WIDE',
        beat: demand.beat,
        verb: segment.verb,
        detail: `hole is ${demand.width.toFixed(3)} wide but a ${(segment.airBeats ?? airBeatsFor(strength)).toFixed(2)}-beat flight clears ${limit.toFixed(3)}`,
      });
    }
  }

  // Mode 8: a flip needs the far surface to exist where the player arrives.
  if (segment.flipAt !== undefined) {
    const arriving = slabsUnder(world, segment, segment.startBeat, segment.startBeat + segment.beats);
    const anchored = arriving.some((s) => Math.abs(s.faceY - baseOf(segment.surface)) < SAME_FACE);
    if (!anchored) {
      issues.push({
        kind: 'BAD_GRAVITY_TRANSITION',
        beat: segment.flipAt,
        verb: segment.verb,
        detail: `flips onto the ${segment.surface.toLowerCase()} with no anchored slab there`,
      });
    }
  }

  // Mode 11: a corridor's headroom. Under a standing body the player is stuck
  // between a floor and a roof that do not admit them -- unless they slide, in
  // which case the roof is the *point* and the clearance is judged against the
  // sliding body instead.
  if (!segment.airborne) {
    const body = segment.slide ? SLIDE_HEIGHT : BODY_HEIGHT;
    const roof = roofOver(world, segment);
    if (roof !== null) {
      const headroom = (segment.runY - roof) * gravityOf(segment);
      if (headroom < body - SAME_FACE) {
        issues.push({
          kind: 'CORRIDOR_TOO_NARROW',
          beat: segment.startBeat,
          verb: segment.verb,
          detail: `headroom ${headroom.toFixed(3)} is under a ${segment.slide ? 'sliding' : 'standing'} body (${body})`,
        });
      }
    }
  }
}

/** Modes 6 and 10 -- hazards the player has no answer to. */
function checkHazards(segment: TrajectorySegment, world: CourseWorld, issues: CourseIssue[]): void {
  for (const demand of world.hazards) {
    if (demand.surface !== segment.surface) continue;
    if (demand.beat < segment.startBeat || demand.beat >= segment.startBeat + segment.beats) continue;

    if (demand.kind === 'WALL') {
      // A beam is answered by *posture*, so the segment has to say it slides --
      // and the gap has to be one a sliding body fits under and a standing one
      // does not. A beam either side of that band is scenery or a wall.
      const clearance = demand.clearance ?? 0;
      const [lo, hi] = BEAM_CLEARANCE_BAND;
      if (!segment.slide) {
        issues.push({
          kind: 'UNAVOIDABLE_HAZARD',
          beat: demand.beat,
          verb: segment.verb,
          detail: 'a beam sits on the running line but the segment never slides',
        });
      } else if (clearance < lo || clearance > hi) {
        issues.push({
          kind: 'UNAVOIDABLE_HAZARD',
          beat: demand.beat,
          verb: segment.verb,
          detail: `beam clearance ${clearance.toFixed(3)} is outside the slide-only band ${lo.toFixed(3)}..${hi.toFixed(3)}`,
        });
      }
      continue;
    }

    // A spike is answered by being above it. The segment is airborne over this
    // beat or it is not -- and if it is, the arc has to actually clear the tip
    // for the whole time the body is passing it.
    if (!segment.airborne) {
      issues.push({
        kind: 'UNAVOIDABLE_HAZARD',
        beat: demand.beat,
        verb: segment.verb,
        detail: `a ${demand.kind.toLowerCase()} sits on the running line but the segment is grounded`,
      });
      continue;
    }
    const u = (demand.beat - segment.startBeat) / Math.max(1e-6, segment.beats);
    const height = arcHeight(segment, u);
    const tipRise = (segment.startFeetY - demand.faceY) * gravityOf(segment);
    // The *body* has to clear, not the feet: the feet can be level with the tip
    // and the player still takes it in the shins.
    if (height - tipRise < BODY_HEIGHT * 0.5) {
      issues.push({
        kind: 'HAZARD_IN_ARC',
        beat: demand.beat,
        verb: segment.verb,
        detail: `arc is ${height.toFixed(3)} up at the ${demand.kind.toLowerCase()} but the body needs ${(tipRise + BODY_HEIGHT * 0.5).toFixed(3)}`,
      });
    }
  }
}

/** Modes 3 and 4 -- the landing itself. */
function checkLanding(segment: TrajectorySegment, world: CourseWorld, issues: CourseIssue[]): void {
  if (!segment.airborne) return;
  if (segment.verb === 'GRAVITY_FLIP_UP' || segment.verb === 'GRAVITY_FLIP_DOWN') return;

  const landBeat = segment.startBeat + segment.beats;
  const landing = slabsUnder(world, segment, landBeat, landBeat)
    .filter((s) => Math.abs(standFace(s, segment.surface) - segment.endFeetY) < 0.02);
  if (landing.length === 0) return; // NO_SUPPORT is the simulator's finding.

  for (const slab of landing) {
    // Mode 3: the body has to fit, with room to land and leave again.
    const widthBeats = (slab.endBeat - slab.startBeat);
    const widthUnits = widthBeats * UNITS_PER_BEAT;
    if (widthUnits < minLandingWidth() - 1e-6) {
      issues.push({
        kind: 'LANDING_TOO_NARROW',
        beat: landBeat,
        verb: segment.verb,
        detail: `landing is ${widthUnits.toFixed(3)} wide, under the ${minLandingWidth().toFixed(3)} a body needs`,
      });
    }

    // Mode 4: a landing under a low roof is a landing the player cannot stand
    // up from. Judged against the standing body, because landing is exactly
    // when the player is not sliding.
    const roof = roofOver(world, segment, slab);
    if (roof !== null) {
      const headroom = (segment.endFeetY - roof) * gravityOf(segment);
      if (headroom < BODY_HEIGHT - SAME_FACE) {
        issues.push({
          kind: 'LANDING_CLEARANCE',
          beat: landBeat,
          verb: segment.verb,
          detail: `only ${headroom.toFixed(3)} of headroom on the landing, under a standing body (${BODY_HEIGHT})`,
        });
      }
    }
  }
}

// --------------------------------------------------------------------------
// Whole-world checks
// --------------------------------------------------------------------------

/** Mode 9: two slabs on the same line at the same beat, spawning into each other. */
function checkOverlaps(world: CourseWorld, issues: CourseIssue[]): void {
  const bySurface = new Map<TrackSurface, WorldSlab[]>();
  for (const slab of world.slabs) {
    const list = bySurface.get(slab.surface) ?? [];
    list.push(slab);
    bySurface.set(slab.surface, list);
  }
  for (const [surface, slabs] of bySurface) {
    const sorted = [...slabs].sort((a, b) => a.startBeat - b.startBeat);
    for (let i = 1; i < sorted.length; i++) {
      const prev = sorted[i - 1];
      const next = sorted[i];
      if (next.startBeat >= prev.endBeat - 1e-6) continue;
      // Overlapping in time is fine when the two are at different heights --
      // that is a staircase's whole trick. It is a spawn overlap only when they
      // claim the same standing line.
      if (Math.abs(prev.faceY - next.faceY) > SAME_FACE) continue;
      issues.push({
        kind: 'SPAWN_OVERLAP',
        beat: next.startBeat,
        verb: '-',
        detail: `two ${surface.toLowerCase()} slabs share the line y=${next.faceY.toFixed(3)} between beats ${next.startBeat.toFixed(2)} and ${prev.endBeat.toFixed(2)}`,
      });
    }
  }
}

/** Mode 12: a slab whose far face cuts through another slab's standable face. */
function checkEmbedding(world: CourseWorld, issues: CourseIssue[]): void {
  for (const a of world.slabs) {
    if (!a.floating) continue;
    for (const b of world.slabs) {
      if (a === b || a.surface !== b.surface) continue;
      if (b.startBeat >= a.endBeat - 1e-6 || a.startBeat >= b.endBeat - 1e-6) continue;
      // Does b's standable face fall strictly inside a's body?
      const bFace = b.faceY;
      const lo = Math.min(a.faceY, a.backY);
      const hi = Math.max(a.faceY, a.backY);
      if (bFace > lo + SAME_FACE && bFace < hi - SAME_FACE) {
        issues.push({
          kind: 'SLAB_EMBEDDED',
          beat: Math.max(a.startBeat, b.startBeat),
          verb: '-',
          detail: `a slab's face at y=${bFace.toFixed(3)} is buried inside another slab spanning ${lo.toFixed(3)}..${hi.toFixed(3)}`,
        });
        break;
      }
    }
  }
}

/** Mode 14: a stretch of track with nothing to see. */
function checkEmptyStretches(world: CourseWorld, trajectory: Trajectory, issues: CourseIssue[]): void {
  const beats = Math.max(0.001, trajectory.endBeat - trajectory.startBeat);
  const step = 0.25;
  let emptyFrom: number | null = null;
  for (let beat = trajectory.startBeat; beat <= trajectory.endBeat; beat += step) {
    const onScreen = world.platformsAt(beat).length + world.hazardsAt(beat).length + world.padsAt(beat).length;
    if (onScreen === 0) {
      if (emptyFrom === null) emptyFrom = beat;
    } else if (emptyFrom !== null) {
      reportEmpty(emptyFrom, beat, beats, issues);
      emptyFrom = null;
    }
  }
  if (emptyFrom !== null) reportEmpty(emptyFrom, trajectory.endBeat, beats, issues);
}

/**
 * Mode 15: a phrase the music asks to be energetic, played flat against its own
 * ground.
 *
 * Spec §9 is explicit that "energetic Runner sections should not spend most of
 * their duration at BOTTOM", and §10 makes the visual version of the same claim:
 * a frozen frame of a loud phrase should show a *route*. A phrase that stays on
 * the base line has no elevation difference in it at all, so it fails both --
 * and it is the exact failure the whole rebuild exists to remove, which is why
 * it is worth a check rather than a style note.
 *
 * Measured in world y rather than above the running surface (see
 * `verticalZones.ts`), so the *zones* stay absolute and the ceiling route stays
 * visible. The flatness *predicate*, though, is surface-relative
 * (`surfaceSideRatio`): the motion language is gravity-relative, so a phrase
 * glued to the ceiling is exactly as flat as one glued to the floor, and an
 * inverted hop chain -- whose apexes reach deep into the field, away from the
 * ceiling -- is the opposite of flat no matter which field-half the apexes land
 * in. A phrase that flips is exempt outright: the flip itself is the far end of
 * the screen.
 */
function checkPhraseZones(trajectory: Trajectory, issues: CourseIssue[]): void {
  for (const phrase of trajectory.phrases) {
    const intensity = phrase.intensity;
    if (intensity < ENERGETIC_INTENSITY) continue;
    // A phrase that flips is using the field by definition: the other route is
    // the far end of the screen, and the player is about to be on it.
    if (phrase.segments.some((s) => s.flipAt !== undefined)) continue;
    const { beats, surface } = samplePhraseZones(phrase);
    if (surface === null) continue;
    // A phrase checked here never flips, so it plays on one surface throughout.
    const total = Object.values(beats).reduce((sum, b) => sum + b, 0);
    if (total <= 0) continue;
    const groundRatio = surfaceSideRatio(beats, surface);
    if (groundRatio < BOTTOM_HEAVY_LIMIT) continue;
    const side = surface === 'FLOOR' ? 'bottom' : 'ceiling';
    issues.push({
      kind: 'FLAT_ENERGETIC_PHRASE',
      beat: phrase.startBeat,
      verb: phrase.archetype,
      detail: `${(intensity * 100).toFixed(0)}% intensity phrase stays ${(groundRatio * 100).toFixed(0)}% in the ${side} two zones -- nothing in it asks the player to leave the ground`,
    });
  }
}

function reportEmpty(from: number, to: number, courseBeats: number, issues: CourseIssue[]): void {
  const span = to - from;
  // A course that is *entirely* empty is a different bug (an empty phrase list
  // or a planner that produced nothing) and reporting every quarter-beat of it
  // would bury the real message.
  if (span < MAX_EMPTY_BEATS || span >= courseBeats - 0.5) return;
  issues.push({
    kind: 'EMPTY_SECTION',
    beat: from,
    verb: '-',
    detail: `${span.toFixed(1)} beats (${(span / 4).toFixed(1)} bars) with nothing on screen`,
  });
}

// --------------------------------------------------------------------------
// Small physical helpers, all reading the shared physics
// --------------------------------------------------------------------------

/** +1 for FLOOR, -1 for CEILING: which way "up" is for this segment. */
function gravityOf(segment: TrajectorySegment): number {
  return segment.surface === 'FLOOR' ? 1 : -1;
}

function baseOf(surface: TrackSurface): number {
  return surface === 'FLOOR' ? 0.72 : 0.28;
}

/** How far the landing is above the take-off, in the segment's own frame. */
function riseOf(segment: TrajectorySegment): number {
  return (segment.startFeetY - segment.endFeetY) * gravityOf(segment);
}

/** The standable face of a slab, for a surface. Shared with the world, so the
 *  audit can never disagree with the mode about which face a player stands on. */
function standFace(slab: WorldSlab, surface: TrackSurface): number {
  return standFaceOf(slab, surface);
}

/** Slabs alive anywhere in `[from, to]`, on the segment's own surface. */
function slabsUnder(world: CourseWorld, segment: TrajectorySegment, from: number, to: number): WorldSlab[] {
  return world.slabs.filter((s) =>
    s.surface === segment.surface && s.startBeat < to + 1e-6 && s.endBeat > from - 1e-6,
  );
}

/**
 * The nearest solid face above the player's head during a grounded segment, or
 * null when the only thing overhead is the sky.
 *
 * The base line of the *other* surface does not count: the ceiling is not a
 * roof over the floor, it is where the other route runs.
 */
function roofOver(world: CourseWorld, segment: TrajectorySegment, at?: WorldSlab): number | null {
  const g = gravityOf(segment);
  const feet = at ? standFace(at, segment.surface) : segment.runY;
  const from = at ? at.startBeat : segment.startBeat;
  const to = at ? at.endBeat : segment.startBeat + segment.beats;
  // How far the head reaches above the feet, plus the slab thickness the head
  // would have to pass *through* before it counts as overhead.
  //
  // A face is only a roof if it is high enough to matter: a slab whose underside
  // sits inside the standing body's own height is not overhead, it is the body's
  // own space, and reporting it as a roof says the landing is unusable when in
  // fact the player is standing in it. A staircase is exactly this case -- each
  // tread's underside is one `STAIR_STEP` above the tread below, which is less
  // than the body is tall, and treating that as a roof reported every stair as a
  // blocked landing.
  const clearance = BODY_HEIGHT;
  let roof: number | null = null;
  for (const slab of world.slabs) {
    if (slab === at) continue;
    if (slab.surface !== segment.surface) continue;
    if (slab.startBeat >= to - 1e-6 || slab.endBeat <= from + 1e-6) continue;
    const face = blockFaceOf(slab, segment.surface);
    const above = g > 0 ? face < feet - clearance : face > feet + clearance;
    if (!above) continue;
    roof = roof === null ? face : (g > 0 ? Math.max(roof, face) : Math.min(roof, face));
  }
  return roof;
}

/**
 * Beats of slack the player has in choosing when to take off, or null when the
 * segment's landing is a fixed point rather than a window.
 *
 * The arc is at or above the landing height for a contiguous stretch; a take-off
 * anywhere inside that stretch still meets the landing on the way down. That
 * stretch *is* the timing window, and it is what a player actually feels.
 */
function takeoffSlack(segment: TrajectorySegment, world: CourseWorld): number | null {
  const rise = riseOf(segment);
  const apex = segment.apex ?? 0;
  if (apex <= 0) return null;
  // A double-jump mount's timing is two presses strung through a ring, and the
  // one-arc window formula does not describe it. The ring itself is the timing
  // read; the sim is what proves the press pair is flyable.
  if (segment.airJumpAt !== undefined) return null;
  // Fraction of the arc spent at or above the landing height: the landing is
  // met on the way down, so the earlier the take-off, the later the touch-down.
  const root = Math.sqrt(Math.max(0, 1 - rise / apex));
  const windowBeats = ((1 + root) / 2 - (1 - root) / 2) * segment.beats;
  // A hole under the flight shrinks the window from both ends: the player may
  // not take off over the hole, and may not land in it.
  const hole = world.gaps.find((gap) =>
    gap.surface === segment.surface && gap.startBeat < segment.startBeat + segment.beats && gap.endBeat > segment.startBeat,
  );
  if (!hole) return windowBeats;
  const blocked = Math.max(0, Math.min(hole.endBeat, segment.startBeat + segment.beats) - Math.max(hole.startBeat, segment.startBeat));
  return Math.max(0, windowBeats - blocked);
}

/** Height above the take-off surface at normalised time `u` through the arc. */
function arcHeight(segment: TrajectorySegment, u: number): number {
  const apex = segment.apex ?? 0;
  const clamped = u <= 0 || u >= 1 ? 0 : u;
  return 4 * apex * clamped * (1 - clamped);
}

/** Keep one issue per (kind, beat) so a sustained problem is not repeated. */
function dedupe(issues: CourseIssue[]): CourseIssue[] {
  const seen = new Set<string>();
  const out: CourseIssue[] = [];
  for (const issue of issues) {
    const key = `${issue.kind}@${Math.round(issue.beat * 4)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(issue);
  }
  return out;
}

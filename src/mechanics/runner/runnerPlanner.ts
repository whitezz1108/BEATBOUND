/**
 * The RUNNER course planner: `CourseSpec` -> `Trajectory`.
 *
 * This is the architectural inversion spec §2 demands. The old pipeline was
 * `BEAT -> CHOOSE OBSTACLE -> PLACE OBSTACLE`: hazards first, and whatever the
 * player did about them was their problem. This one runs the other way:
 *
 *   phrase archetype -> movement verbs -> the player's intended trajectory
 *     -> the terrain that trajectory requires -> the hazards it tolerates
 *
 * Terrain is a *consequence* of the intended motion, never its cause. A
 * STAIRCASE_UP is four landings a step apart; the four slabs exist because the
 * feet have to be somewhere. That ordering is what makes the result a course
 * instead of a hazard stream.
 *
 * ## Physics first, padding second
 *
 * Every verb resolves its own duration from `runnerPhysics.ts` -- a jump to a
 * slab 0.12 higher takes exactly `jumpArc(1).beatsToRise(0.12)` beats, and that
 * number is not negotiable. The composer then *fills the rest of the phrase with
 * running*, so a phrase always occupies exactly the beats it was given without
 * any verb being stretched into something physically impossible. Stretching the
 * arc to fit a bar is how a generator produces levels nobody can clear.
 *
 * ## Gravity-relative
 *
 * All levels are expressed as a rise above the surface the player is running on,
 * so `GROUND_RUN` and `CEILING_RUN` are the same code path and an inverted
 * phrase is not a special case. See `motion.ts`.
 */

import { makeRng } from '../../core/geometry';
import type { CourseSpec, PhraseSpec } from '../../core/types';
import {
  ARCHETYPE_VERBS,
  ROLE_ARCHETYPES,
  VERB_INFO,
  isArchetype,
  isMotionVerb,
  type MotionVerb,
  type PhraseArchetype,
  type PhraseRole,
} from './motion';
import {
  BEAM_CLEARANCE,
  BODY_HEIGHT,
  DOUBLE_JUMP_LEVEL,
  MIN_TAP_BEATS,
  UNITS_PER_BEAT,
  apexFor,
  apexForHold,
  beatsToUnits,
  doubleJumpArc,
  dropBeats,
  holdForApex,
  jumpArc,
  maxGapWidthForAirtime,
  maxRise,
  minLandingWidth,
} from './runnerPhysics';
import type { TrackSurface } from './surface';
import {
  CEILING_Y_CONST,
  FLOOR_Y,
  faceYFor,
  flattenTrajectory,
  type HazardDemand,
  type TerrainDemandAny,
  type Trajectory,
  type TrajectoryPhrase,
  type TrajectorySegment,
} from './trajectory';

// --------------------------------------------------------------------------
// Authoring constants
//
// These are the numbers a designer would want to change to re-shape the whole
// mode's feel. They are deliberately gathered here rather than scattered
// through the verb implementations (spec §64).
// --------------------------------------------------------------------------

/** Rise of one stair step. Above stepUpHeight, so each step is a real jump. */
export const STAIR_STEP = 0.06;
/** Rise of a "high" platform in an alternation or an ascent. */
export const HIGH_LEVEL = 0.16;
/**
 * Rise of one floating block in a `SKY_STEPS` chain.
 *
 * Comfortably inside a full jump so the *landing beat* is the skill being
 * tested, and three steps land under the field's `MAX_LEVEL` cap without
 * clamping. Each step is a floating slab with a hole under the flight: the
 * player who jumps on time touches down; the one who does not finds out.
 */
export const SKY_STEP_RISE = 0.08;

/** Top of a full ascent, in field units above the base surface. */
export const ASCENT_LEVEL = 0.27;
/**
 * The highest a course may build above the surface it runs on.
 *
 * Not a style choice. The two running surfaces are 0.44 apart and the player's
 * head is `BODY_HEIGHT` above their feet, so a slab above this leaves the
 * avatar's head through the ceiling line -- visible as the player clipping into
 * the other route, and unreadable, because the ceiling is precisely what a flip
 * makes solid. A verb that climbs without a cap (a repeated `STAIRCASE_UP`, an
 * `INVERTED_PLATFORM_CHAIN` played twice) runs away past it, so the cap lives
 * here and every climbing verb clamps to it. `ASCENT_LEVEL` is what a full
 * ascent is designed to top out at, so this is the number the rest of the
 * planner already aims for.
 */
export const MAX_LEVEL = ASCENT_LEVEL;
/** Extra beats of running added after a landing, so landing and re-jumping are two actions. */
export const LANDING_SETTLE_BEATS = 0.3;
/**
 * Clearance left under a beam the player must slide beneath.
 *
 * Re-exported from the physics rather than chosen here, because the band of
 * clearances that make a beam *mean* something is a property of the collision
 * probe -- the player has to fit under it sliding and not fit under it standing
 * -- and a number picked by eye in the planner is how you get a beam that is
 * scenery.
 */
export { BEAM_CLEARANCE } from './runnerPhysics';
/**
 * Air left between the top of the player's head at the apex of a corridor jump
 * and the underside of the roof.
 *
 * Without it the hold is solved so the head arrives at *exactly* the roof line,
 * which is a bonk on any frame the integrator overshoots by a hair. The corridor
 * is a place the player jumps *inside*; grazing the ceiling on every jump would
 * read as a bug rather than as tight level design.
 */
export const CORRIDOR_APEX_MARGIN = 0.022;

/**
 * The whole vertical budget: the distance between the two running surfaces.
 *
 * A corridor is the one structure that has to fit *between* them, so this is the
 * number that bounds it. A roof whose body crosses the other surface's line is
 * not a level-design choice, it is a slab drawn through the route the player
 * will flip onto.
 */
export const FIELD_GAP = FLOOR_Y - CEILING_Y_CONST;

/**
 * Headroom a corridor must leave above its walkway, measured from the feet to
 * the underside of the roof.
 *
 * Derived, not chosen -- and the derivation is the whole reason this is an
 * expression rather than a number. A jump has a floor as well as a ceiling:
 * `jumpCutFactor` only removes part of the upward speed, so a press cannot be
 * made arbitrarily short. `MIN_TAP_BEATS` is the shortest press a hand produces
 * on purpose, and `apexForHold` turns it into the height it buys. A corridor
 * must clear that plus the body plus the apex margin, or the only jump that fits
 * inside it is one nobody can physically input.
 *
 * The original constant was 0.14: below even the mathematical floor of a
 * zero-length tap, so every corridor the planner emitted was impossible to
 * traverse at any input. Written as a sum of the things that actually constrain
 * it, the same mistake cannot be made again by editing one number.
 */
export const CORRIDOR_MIN_CLEARANCE = BODY_HEIGHT + apexForHold(MIN_TAP_BEATS) + CORRIDOR_APEX_MARGIN;
/** Headroom of a corridor the player jumps inside at speed, when the field allows it. */
export const CORRIDOR_CLEARANCE = CORRIDOR_MIN_CLEARANCE + 0.05;
/** Headroom of a corridor so tight that only a minimum tap fits inside it. */
export const TIGHT_CLEARANCE = CORRIDOR_MIN_CLEARANCE;
/**
 * How high a corridor's walkway sits above the surface it runs on.
 *
 * Low on purpose. A walkway only has to be above `stepUpHeight` to be a real
 * jump rather than a step, and every unit it takes is a unit the corridor's
 * roof cannot use -- with the roof capped by the ceiling line, a high walkway
 * squeezes the headroom down until the only jump that fits is a one-frame tap.
 * `corridorHeadroom` does the arithmetic; this is the input to it.
 */
export const CORRIDOR_WALK = 0.05;
/** How much of the arc's margin a hazard may eat before the planner backs off. */
export const HAZARD_MARGIN_BEATS = 0.12;

/**
 * Beats of track a plain landing slab spans.
 *
 * A landing has to be wider than `minLandingWidth()` or it is not a landing, but
 * the width is also what a *staircase* is made of: treads `LANDING_SLAB_BEATS`
 * long, placed one airtime apart, are what makes the risers read as a staircase
 * rather than as scattered blocks. So the number is chosen against the airtime
 * -- 1.2 beats is comfortably wider than the 0.903 a step-up takes, which means
 * consecutive treads always overlap and the staircase is continuous underfoot.
 */
export const LANDING_SLAB_BEATS = 1.2;

/** Key-hold lengths, in beats, for the three jump sizes. */
const HOLD = { SHORT: 0.3, MEDIUM: 0.55, LONG: Infinity } as const;

/**
 * Beats a gravity flip takes, from leaving one surface to standing on the other.
 *
 * Short on purpose. The mode's flip is a *snap*: the world inverts, the player
 * arrives on the far surface, and running continues without a pause. A long
 * flight would mean the player is airborne with no surface under them for most
 * of a bar, which is neither readable nor fair. What makes the flip legible is
 * the gate and the colour change, not the airtime.
 */
const FLIP_BEATS = 0.5;

/** Gravity multiplier a phrase's flip zone applies. */
const FLIP_SCALE = -1;
interface PlanState {
  surface: TrackSurface;
  /** Rise above the base surface of the surface the player runs on. */
  level: number;
  /** Absolute beat the next segment starts on. */
  beat: number;
  /** How many flips the phrase has already performed, for GRAVITY_ZIGZAG. */
  flips: number;
  /**
   * The beat the current grounded stretch began on, if the player has just
   * landed. Absent means "has been running since before the plan started".
   *
   * Only `drop()` reads this, and only to refuse a fall that departs on the
   * beat the player touched down -- see the note there.
   */
  groundedSince?: number;
}

interface VerbResult {
  segments: TrajectorySegment[];
  next: PlanState;
}

// --------------------------------------------------------------------------
// Small physical helpers
// --------------------------------------------------------------------------

/** World y of the feet for a run surface `level` above `surface`'s base line. */
function feetAt(surface: TrackSurface, level: number): number {
  return surface === 'FLOOR' ? FLOOR_Y - level : CEILING_Y_CONST + level;
}

/** Beats of airtime for a jump that lands `rise` above where it took off. */
function airBeatsForRise(rise: number, strength: number, hold: number): number {
  const arc = jumpArc(strength, hold);
  const beats = arc.beatsToRise(rise);
  // A rise the arc cannot reach is a planner bug, not a level: clamp to the
  // longest flight the arc offers rather than emitting an impossible segment.
  return beats === null ? arc.airBeats : beats;
}

/** Rise the arc actually reaches, clamped to what a plain jump can buy. */
function reachableRise(rise: number, strength: number): number {
  return Math.max(-0.5, Math.min(rise, maxRise(strength)));
}

/**
 * The level a climb may actually land at, given where the player is.
 *
 * Two caps, and both are physical rather than stylistic:
 *
 *   - the arc: a plain jump cannot land above `maxRise()`, so a step that would
 *     overshoot it is not a step the player can take;
 *   - the field: `MAX_LEVEL` keeps the avatar's head under the ceiling line, so
 *     a course never builds into the route it would flip onto.
 *
 * A verb that already knows where it wants to land (an ascent to `ASCENT_LEVEL`,
 * a "high" alternation landing) is asking for a *destination*, and the honest
 * answer when the destination is out of reach is the highest one that is not.
 * Clamping here rather than at each call site is what stops a chain of climbs
 * from walking off the top of the field.
 */
function clampLevel(from: number, rise: number, strength: number): number {
  return Math.min(from + reachableRise(rise, strength), MAX_LEVEL);
}

/**
 * How far the *world* may fall below the running surface.
 *
 * Terrain never goes below the surface it is anchored to, and the collision
 * probe's answer at the base line is "the base line" -- so a course that dips
 * under it is not building a basement, it is building a hole the player falls
 * through. Everything that resolves a level clamps here.
 */
export const MIN_LEVEL = 0;

/**
 * How deep a floating platform's *body* is, below its standable face.
 *
 * Much shallower than the body the player is drawn with, and the difference is
 * the whole reason this is a named constant rather than `BODY_HEIGHT`.
 *
 * A slab is a thing you land on. Its body is only there to make it read as a
 * block rather than a hairline, and every unit of depth it takes is a unit of
 * airspace it steals from the route underneath it. Two consequences follow, and
 * both were real bugs before this was separated out:
 *
 *   - a staircase's risers are `STAIR_STEP` apart, so treads deeper than that
 *     bury each other's faces -- a solid staircase drawn as a stack of
 *     interpenetrating blocks;
 *   - a platform 0.16 above the floor with a full body hangs down to 0.626,
 *     which is exactly where a player *running the floor underneath it* has
 *     their head. A low platform then becomes an invisible ceiling over the
 *     route it was supposed to decorate.
 *
 * Below `STAIR_STEP` by a hair, so consecutive treads touch without meeting.
 */
export const PLATFORM_DEPTH = 0.05;

/**
 * A slab the player lands on: wide enough to be a real landing, centred on the
 * beat it is met, with the far face either on the base line (anchored) or
 * `depth` below the face (floating).
 *
 * Returns null for a slab at the base level, because "there is ground here" is
 * already true unless a gap overlaps -- and a zero-height block is not a thing
 * the mode can express. Emitting nothing is the honest answer.
 *
 * `force` is the exception: a slab the player *must* land on even at level 0 --
 * the far side of a flip, or the ground under a staircase that has climbed away
 * from it. "There is ground here" is normally true for free, but not when the
 * phrase before it left a hole in the running surface, and a flip onto a hole
 * drops the player out of the world. A forced slab is one body thick, hanging
 * away from the surface, so it is solid exactly where the feet arrive.
 */
function slab(
  surface: TrackSurface,
  beat: number,
  level: number,
  widthBeats = LANDING_SLAB_BEATS,
  floating = true,
  force = false,
  depth = PLATFORM_DEPTH,
): TerrainDemandAny | null {
  const clamped = Math.max(MIN_LEVEL, level);
  if (clamped <= 0.001 && floating && !force) return null;
  const faceY = faceYFor(surface, clamped);
  const baseY = surface === 'FLOOR' ? FLOOR_Y : CEILING_Y_CONST;
  // An anchored slab reaches down (or up) to the base line, so its far face can
  // never block a jump; a floating one is one body deep, so it can.
  const hasBody = floating;
  const backY = hasBody ? (surface === 'FLOOR' ? faceY + depth : faceY - depth) : baseY;
  return {
    kind: 'SLAB',
    beat,
    width: Math.max(minLandingWidth(), beatsToUnits(widthBeats)),
    faceY,
    backY,
    surface,
    floating: hasBody && (clamped > 0.001 || force),
  };
}

/** Push a slab demand when the planner produced one. */
function pushSlab(into: TerrainDemandAny[], demand: TerrainDemandAny | null): void {
  if (demand) into.push(demand);
}

/**
 * A roof: a solid block whose *near* face is `level` above the base line, with
 * its body extending away from the base.
 *
 * This is the mirror of `slab()`, and the distinction is not cosmetic. A slab is
 * something you land on, so its body hangs below its standable face and out of
 * the way. A roof is something you pass *under*, so its body has to be above the
 * clearance line -- building it the other way round (as the corridor code
 * originally did) puts a solid block exactly where the player is about to run,
 * and the corridor becomes a wall.
 *
 * `level` is therefore the headroom: the distance from the base line to the
 * underside, which is the number a designer actually wants to author.
 */
function roof(
  surface: TrackSurface,
  beat: number,
  level: number,
  widthBeats: number,
): TerrainDemandAny {
  const near = surface === 'FLOOR' ? FLOOR_Y - level : CEILING_Y_CONST + level;
  const far = surface === 'FLOOR' ? near - BODY_HEIGHT : near + BODY_HEIGHT;
  return {
    kind: 'SLAB',
    beat,
    width: Math.max(minLandingWidth(), beatsToUnits(widthBeats)),
    faceY: far,
    backY: near,
    surface,
    floating: true,
  };
}

/**
 * Height of the hazard a jump is planned *over*, from the phrase's intensity.
 *
 * Threat belongs to the verb, not to the intensity. `LONG_JUMP` is documented as
 * MID threat and `LONG_GAP` as HIGH; while both gated their hazard behind
 * `intensity > 0.55`, a phrase below that line asked for the *shape* of a threat
 * and got an empty beat -- the mode's whole library ran at a few hazards per
 * minute, so there was nothing to fail and a course read as a jump animation
 * rather than as pressure to be survived. Intensity now scales how tall the
 * hazard is, which is what "harder" should mean: the same idea, a cleaner arc
 * required, never a beat that quietly became nothing.
 *
 * The ceiling is far below `jumpHeight`, and the hazard sits at the apex where
 * clearance is greatest, so even the top of the range is a spike a full-hold
 * jump sails over.
 */
function overHazardLevel(intensity: number, floor: number, ceiling: number): number {
  const t = Math.max(0, Math.min(1, intensity));
  return floor + t * (ceiling - floor);
}

/**
 * Build corridor hops until the phrase's budget runs out.
 *
 * The corridor verbs used to build a fixed number of hops whatever room they
 * were given, and then size one roof and one walkway to that fixed count. When
 * the phrase's budget cut the verb short, the hops that survived ended early
 * while the roof still ran to where the verb would have ended -- a lid past the
 * end of its own corridor, which the player flies into on the next hop. Building
 * only what fits means the geometry the verb emits is the geometry the player
 * meets, and a corridor cut off by the bar line stays a corridor rather than
 * becoming a wall.
 *
 * `endBeat` is the phrase's own end, so a corridor can never spend beats the
 * phrase did not give it and `planPhrase` never has to trim one.
 */
function corridorHops(
  state: PlanState,
  archetype: string,
  hold: number,
  endBeat: number,
  wanted: number,
  kind: MotionVerb,
): { segments: TrajectorySegment[]; next: PlanState } {
  const segments: TrajectorySegment[] = [];
  let current = state;
  for (let i = 0; i < wanted; i++) {
    // `kind` so the hop is named after the corridor it belongs to. Left to
    // derive its own name, `verbForHop` saw a flat hop with a short hold and
    // called it `PLATFORM_HOP_CHAIN` -- so a course dump showed a corridor as a
    // platform chain followed by two long jumps, and the one verb whose whole
    // point is that the floor and ceiling define the route together was the one
    // verb the dump never mentioned.
    const result = hop(current, archetype, { hold, kind, note: 'hop inside the corridor' });
    if (current.beat + verbCost(result) > endBeat + 1e-6) break;
    segments.push(...result.segments);
    current = result.next;
  }
  return { segments, next: current };
}

/** A hazard the arc is designed to clear. */
function hazard(
  kind: HazardDemand['kind'],
  surface: TrackSurface,
  beat: number,
  level: number,
  answer: MotionVerb,
  clearance?: number,
): HazardDemand {
  return { kind, beat, surface, faceY: faceYFor(surface, level), answer, clearance };
}

function runSegment(
  state: PlanState,
  beats: number,
  archetype: string,
  note?: string,
  demands: TerrainDemandAny[] = [],
): TrajectorySegment {
  const y = feetAt(state.surface, state.level);
  return {
    verb: state.surface === 'FLOOR' ? 'GROUND_RUN' : 'CEILING_RUN',
    archetype,
    startBeat: state.beat,
    beats,
    surface: state.surface,
    startFeetY: y,
    endFeetY: y,
    runY: y,
    airborne: false,
    lands: false,
    demands,
    hazards: [],
    note,
  };
}

/**
 * A run under a beam the player has to slide beneath.
 *
 * The beam is the hazard; the *answer* is a posture, so the segment stays a run
 * and only the clearance is new. The height comes from
 * `BEAM_CLEARANCE_BAND` in the physics module -- the only band where a beam is
 * simultaneously passable sliding and fatal standing, measured against the
 * collision *probe* rather than the drawn body. Picking a number outside it
 * produces a beam that is either scenery or unavoidable, and picking one by eye
 * is how the two drift apart.
 */
function slideUnder(
  state: PlanState,
  archetype: string,
  beats: number,
  note?: string,
): VerbResult {
  const clearance = BEAM_CLEARANCE;
  const y = feetAt(state.surface, state.level);
  const segment: TrajectorySegment = {
    ...runSegment(state, beats, archetype, note ?? 'slide under the beam'),
    slide: true,
    // A beam is a *tolerance*, not an intention: it says "this stretch is safe
    // only while sliding", and the clearance is measured up from the feet, so
    // the hazard does not need to know the beam's own y.
    hazards: [{
      kind: 'WALL',
      beat: state.beat + beats / 2,
      surface: state.surface,
      faceY: y,
      clearance,
      answer: 'LONG_JUMP',
    }],
    // The beam itself, so it is a thing on screen rather than an invisible rule.
    demands: [roof(state.surface, state.beat + beats / 2, clearance, beats * 0.5)],
  };
  return { segments: [segment], next: { ...state, beat: state.beat + beats } };
}

/** Remove the hazards from a verb's segments, for phrases that must be calm. */
function calm(result: VerbResult): VerbResult {
  for (const segment of result.segments) segment.hazards = [];
  return result;
}

/**
 * The ground under a stretch of running, when the running surface may not be
 * there.
 *
 * A run emits no terrain, because "there is ground here" is normally true for
 * free -- the base line is solid everywhere a gap has not been cut. It stops
 * being true in exactly two cases, and both used to be silent bugs:
 *
 *   - the run is *raised* (a corridor's walkway, a platform the player stepped
 *     onto). The base line is not where the feet are, so a run at level 0.05
 *     over bare track is a run over nothing, and the player drops through a
 *     walkway that was drawn under them.
 *   - the run follows a flight that cut a hole (`GAP_JUMP`) or left the surface
 *     (`DROP` from a walkway). The planner cannot see the hole from its own
 *     state -- a gap is a demand, not a level -- so it re-asserts the ground
 *     whenever a grounded segment follows an airborne one.
 *
 * `force` covers the second case, where the slab is redundant by *level* but not
 * by geometry. It is passed rather than inferred because only the caller knows
 * whether a flight just happened.
 */
function ensureGround(segment: TrajectorySegment, force: boolean): TrajectorySegment {
  if (segment.airborne) return segment;
  const level = levelOf(segment);
  if (level <= 0.001 && !force) return segment;
  // Already solid underfoot: a landing slab, a walkway, or another run's ground.
  const half = (d: TerrainDemandAny): number => (d.kind === 'SLAB' ? d.width / 2 / UNITS_PER_BEAT : 0);
  const covered = segment.demands.some((d) =>
    d.kind === 'SLAB'
    && Math.abs(d.faceY - segment.runY) < 1e-6
    && d.beat - half(d) <= segment.startBeat + 1e-6
    && d.beat + half(d) >= segment.startBeat + segment.beats - 1e-6);
  if (covered) return segment;
  const ground = slab(segment.surface, segment.startBeat + segment.beats / 2, level, segment.beats, true, true);
  return ground ? { ...segment, demands: [...segment.demands, ground] } : segment;
}

/**
 * A jump from the current state to a landing `rise` above it.
 *
 * This is the workhorse: nearly every airborne verb is this call with different
 * numbers, which is exactly the point -- they differ in *what they mean*, and
 * the physics of getting there is one implementation.
 */
function hop(
  state: PlanState,
  archetype: string,
  opts: {
    rise?: number;
    hold?: number;
    strength?: number;
    beats?: number;
    /** Emit a slab for the landing (a raised platform) or not (flat ground). */
    landOnSlab?: boolean;
    /** Emit a hole under the flight. */
    gap?: boolean;
    /**
     * Fraction of the flight's maximum hole width to cut.
     *
     * A full-width hole fills the whole arc, which is honest physics and
     * brutal design: the take-off window is the arc minus the hole, and a
     * hole that leaves 0.02 beats of slack is a frame trap. Chains of
     * stepping-stone hops cut narrower holes -- the punition for a miss is
     * still the fall, but the jump itself stays readable.
     */
    gapScale?: number;
    /** Emit a hazard the flight clears. */
    over?: { kind: HazardDemand['kind']; level: number };
    /** True when the landing is the point of the segment (a DROP, say). */
    lands?: boolean;
    /** The verb this hop *is*, when the caller has one. See `verbForHop`. */
    kind?: MotionVerb;
    note?: string;
  } = {},
): VerbResult {
  const strength = opts.strength ?? 1;
  const hold = opts.hold ?? HOLD.LONG;
  // The destination is resolved *first*, against both the arc and the field, and
  // the airtime is then the real flight to that destination. Deriving the
  // airtime from the requested rise instead would plan a longer or shorter
  // flight than the one the player takes -- the same class of bug as
  // `beatsToRise` returning the wrong crossing.
  const endLevel = clampLevel(state.level, opts.rise ?? 0, strength);
  const rise = endLevel - state.level;
  const airBeats = airBeatsForRise(rise, strength, hold);
  const arc = jumpArc(strength, hold);
  const startY = feetAt(state.surface, state.level);
  const endY = feetAt(state.surface, endLevel);
  const landBeat = state.beat + airBeats;

  const demands: TerrainDemandAny[] = [];
  // A landing above the base line is always solid, whether or not the verb
  // meant to build a platform. "There is ground here" is free at level 0 -- the
  // base line is solid wherever a gap has not been cut -- but it is *not* free
  // at level 0.18, where the only thing that can hold the player up is a slab
  // somebody emitted. `landOnSlab` says "this landing is the point of the verb"
  // and stays for the verbs that mean it; this is the invariant underneath it,
  // and without it a `CEILING_HOP` after a hanging-slab chain landed in mid-air
  // and dropped the player to the base line the plan never mentioned.
  if (opts.landOnSlab || endLevel > 0.001) pushSlab(demands, slab(state.surface, landBeat, endLevel));
  if (opts.gap) {
    demands.push({
      kind: 'GAP',
      beat: state.beat + airBeats / 2,
      // The hole is sized from *this flight's* airtime, not from the full-hold
      // airtime a jump at this strength could have had. A cut jump is airborne
      // for less, so a hole built to the full-hold limit is one the actual arc
      // does not carry -- the player clears the near edge and drops into the far
      // one. `maxGapWidthForAirtime` is the same function the audit judges a
      // hole by, so the planner cannot build one the validator rejects.
      width: maxGapWidthForAirtime(airBeats) * (opts.gapScale ?? 1),
      surface: state.surface,
    });
  }
  const hazards: HazardDemand[] = [];
  if (opts.over) {
    hazards.push(hazard(opts.over.kind, state.surface, state.beat + airBeats / 2, opts.over.level, 'LONG_JUMP'));
  }

  const segment: TrajectorySegment = {
    verb: verbForHop(rise, airBeats, opts),    archetype,
    startBeat: state.beat,
    beats: airBeats,
    surface: state.surface,
    startFeetY: startY,
    endFeetY: endY,
    runY: endY,
    airborne: true,
    airBeats,
    strength,
    holdBeats: Number.isFinite(hold) ? hold : undefined,
    apex: arc.apex,
    lands: opts.lands ?? false,
    demands,
    hazards,
    note: opts.note,
  };
  return {
    segments: [segment],
    next: { ...state, level: endLevel, beat: landBeat, groundedSince: landBeat },
  };
}

/** The verb name that best describes a hop, for the debug view and course dumps. */
function verbForHop(
  rise: number,
  airBeats: number,
  opts: { hold?: number; gap?: boolean; lands?: boolean; kind?: MotionVerb },
): MotionVerb {
  // A gap is named from the *flight*, not from the caller: `GAP_JUMP` and
  // `LONG_GAP` are the same shape told apart by how much of the arc the hole
  // takes, and only the airtime knows that. So the gap check comes before the
  // caller's `kind`, and the two gap verbs get their names from physics.
  if (opts.gap) return airBeats > 0.85 ? 'LONG_GAP' : 'GAP_JUMP';
  // A named chain verb says what the *phrase* is doing, and the geometry cannot
  // recover that from a hold length alone: a `QUICK_HOP` and a `DOUBLE_HOP` and a
  // `TRIPLE_HOP` all hold for around a fifth of a beat, so every hop in a burst
  // was reported as a full-hold `LONG_JUMP` -- a course dump that read as one
  // long jump per beat where the player actually taps three times. The caller
  // knows which verb it is building, so it says so; the derived name is only the
  // fallback for hops that have no verb of their own.
  if (opts.kind) return opts.kind;
  if (rise > 0.01) return rise > HIGH_LEVEL * 0.6 ? 'HIGH_JUMP' : 'PLATFORM_HOP_CHAIN';
  // Descending counts as a drop whether or not the player jumped: what the
  // player *did* is leave the ground and arrive lower, and naming it DROP is
  // what makes a staircase-down read as one motion in the course dump.
  if (rise < -0.01) return 'DROP';
  if (opts.lands) return 'DROP';
  if (opts.hold === HOLD.SHORT) return 'SHORT_JUMP';
  if (opts.hold === HOLD.MEDIUM) return 'MEDIUM_JUMP';
  return 'LONG_JUMP';
}

/**
 * A hop that lands *lower* than it took off, with a jump rather than a fall.
 *
 * `drop()` is the ledge version -- no impulse, pure free fall, which is much
 * shorter for the same height. This is the deliberate version: the player
 * jumps and comes down onto a step below, which is what a descending staircase
 * actually is and what `STAIRCASE_DOWN` has to be built from. Without it the
 * only way down was to run off a ledge, so a staircase could descend but never
 * at a rhythm.
 */
function hopDown(
  state: PlanState,
  archetype: string,
  drop: number,
  note?: string,
): VerbResult {
  return hop(state, archetype, { rise: -drop, landOnSlab: true, lands: true, note });
}

/**
 * Repeat a verb-shaped step `count` times, moving `step` in level each time.
 *
 * The sequence is a *shape*, not a fixed displacement: it is played out from
 * wherever the player already is, and clipped so it can never be asked to step
 * below the surface it is running on. `STAIRCASE_DOWN` at level 0 therefore
 * falls back to `DROP`, which is a run off the ledge -- the same idea at the
 * floor of the field, and the only version of it the geometry allows.
 */
function stairs(
  state: PlanState,
  archetype: string,
  count: number,
  step: number,
  verb: MotionVerb,
): VerbResult {
  const segments: TrajectorySegment[] = [];
  let current = state;
  for (let i = 0; i < count; i++) {
    const effective = Math.max(step, -current.level);
    if (Math.abs(effective) < 0.005) break;
    const result = effective > 0
      ? hop(current, archetype, { rise: effective, landOnSlab: true, lands: true, note: `${verb} step ${i + 1}/${count}` })
      : hopDown(current, archetype, -effective, `${verb} step ${i + 1}/${count}`);
    for (const s of result.segments) segments.push({ ...s, verb });
    current = result.next;
  }
  return { segments, next: current };
}

/** A drop off a ledge: no jump, pure free fall to a lower level. */
function drop(
  state: PlanState,
  archetype: string,
  toLevel: number,
  note?: string,
): VerbResult {
  // A fall is the one verb the player does not *choose* the start of. A jump
  // begins on the input, so landing and re-jumping on the same beat is two
  // actions the player performs; a fall begins because the ledge ended, so a
  // fall that starts on the beat the player landed on is not two actions at
  // all -- the terrain never held them. `CourseWorld.clipFalls` ends a surface
  // where the plan says the player leaves it by falling, so that landing slab is
  // cut at the exact beat it was emitted to catch them: the course then asks for
  // a surface that is no longer there, and the traversal check reports
  // `NO_SUPPORT` on the beat the plan calls a landing.
  //
  // `groundedSince` ages out on its own. It is the beat the current grounded
  // stretch began, so once the player has been running longer than the settle
  // the subtraction goes negative and the run is free -- no clearing needed, and
  // a descent built from consecutive falls settles only the first of them.
  const settle = Math.max(
    0,
    (state.groundedSince ?? -Infinity) + LANDING_SETTLE_BEATS - state.beat,
  );
  const segments: TrajectorySegment[] = [];
  let from = state;
  if (settle > 1e-6) {
    segments.push(runSegment(state, settle, archetype, 'settle after the landing'));
    from = { ...state, beat: state.beat + settle };
  }
  // Never below the surface the player is running on: "down" past the base line
  // is through the floor, not onto it.
  const level = Math.max(0, Math.min(toLevel, MAX_LEVEL));
  const depth = Math.max(0, from.level - level);
  const beats = Math.max(0.2, dropBeats(depth));
  const startY = feetAt(from.surface, from.level);
  const endY = feetAt(from.surface, level);
  const landBeat = from.beat + beats;
  const demands: TerrainDemandAny[] = [];
  pushSlab(demands, slab(state.surface, landBeat, level));
  // A fall lands on solid track, and it has to *say so*.
  //
  // `slab()` emits nothing at the base level, on the grounds that "there is
  // ground here" is already true -- which holds only when nothing has punched a
  // hole in the running surface. A gap phrase leaves holes behind it, and a drop
  // planned after one lands inside the hole instead of on the far side of it, so
  // the player falls out of the world exactly where the plan says they land. The
  // `force` slab is the landing, made explicit.
  pushSlab(demands, slab(state.surface, landBeat, level, minLandingWidth() / UNITS_PER_BEAT, true, true));
  segments.push({
    verb: 'DROP',
    archetype,
    startBeat: from.beat,
    beats,
    surface: from.surface,
    startFeetY: startY,
    endFeetY: endY,
    runY: endY,
    airborne: true,
    airBeats: beats,
    apex: 0,
    lands: true,
    demands,
    hazards: [],
    note,
  });
  return {
    segments,
    next: { ...from, level, beat: landBeat, groundedSince: landBeat },
  };
}

// --------------------------------------------------------------------------

/**
 * Implement one verb, returning the segments it needs and the state they leave.
 *
 * `budget` is the beats the phrase can spend on this verb; verbs that need less
 * return early and the composer fills the remainder with running. Verbs never
 * exceed it -- if a verb's physics does not fit the budget, the composer drops
 * it rather than compressing it.
 */
function planVerb(
  verb: MotionVerb,
  state: PlanState,
  archetype: string,
  intensity: number,
  budget: number,
): VerbResult {
  const heavy = intensity > 0.55;
  switch (verb) {
    // ---- running --------------------------------------------------------
    case 'GROUND_RUN':
    case 'CEILING_RUN':
    case 'RELEASE_RUN': {
      // A corridor's running stretch is not empty track: the roof is what makes
      // it a corridor, so at speed the run carries a beam the player slides
      // under. The beam is a *posture* demand rather than a jump, which is what
      // gives CORRIDOR a second idea to say besides "duck".
      if (archetype === 'CORRIDOR' && heavy && verb !== 'RELEASE_RUN') {
        // The slide takes the run's *nominal slice*, exactly as the plain run
        // below does -- it used to take the whole remaining budget, which let
        // one authored `GROUND_RUN` turn the back half of an eight-beat climax
        // into a single unbroken crawl.
        return slideUnder(state, archetype, Math.min(budget, VERB_INFO[verb].beats), 'slide through the corridor');
      }
      // A run takes its *nominal* slice, not the whole remainder. Letting it
      // swallow the budget is what makes an archetype's shape meaningless: the
      // first GROUND_RUN in `GROOVE` would eat everything after it, and the
      // phrase would play as one jump and three beats of nothing however the
      // archetype was written. The composer fills whatever is genuinely left at
      // the end of the phrase, so nothing is lost by stopping early here.
      const beats = Math.min(budget, VERB_INFO[verb].beats);
      return {
        segments: [runSegment(state, beats, archetype, VERB_INFO[verb].description)],
        next: { ...state, beat: state.beat + beats },
      };
    }

    // ---- plain jumps ----------------------------------------------------
    case 'SHORT_JUMP':
      return hop(state, archetype, { hold: HOLD.SHORT, note: 'tap' });
    case 'MEDIUM_JUMP':
      return hop(state, archetype, { hold: HOLD.MEDIUM, note: 'half-hold' });
    case 'LONG_JUMP':
      // Always over something: the verb's name is a claim about the *flight*,
      // and a flight with nothing under it is a `MEDIUM_JUMP` held longer.
      return hop(state, archetype, {
        over: { kind: 'SPIKE', level: overHazardLevel(intensity, 0.07, 0.12) },
        note: 'full hold over a spike',
      });
    case 'HIGH_JUMP':
      return hop(state, archetype, { rise: HIGH_LEVEL, landOnSlab: true, lands: true, kind: 'HIGH_JUMP', note: 'up onto a slab' });

    // ---- rapid chains ---------------------------------------------------
    case 'QUICK_HOP':
      return hop(state, archetype, { hold: 0.2, kind: 'QUICK_HOP', note: 'half-beat hop' });
    case 'DOUBLE_HOP': {
      const a = hop(state, archetype, { hold: 0.22, kind: 'DOUBLE_HOP' });
      const b = hop(a.next, archetype, { hold: 0.22, kind: 'DOUBLE_HOP' });
      return { segments: [...a.segments, ...b.segments], next: b.next };
    }
    case 'TRIPLE_HOP': {
      let current = state;
      const segments: TrajectorySegment[] = [];
      for (let i = 0; i < 3; i++) {
        const r = hop(current, archetype, { hold: 0.2, kind: 'TRIPLE_HOP' });
        segments.push(...r.segments);
        current = r.next;
      }
      return { segments, next: current };
    }
    case 'LAND_AND_IMMEDIATE_REJUMP': {
      // Touch down and leave again with no running between: the landing slab is
      // the point, so the second jump starts from the beat the first one ended.
      const a = hop(state, archetype, { hold: HOLD.MEDIUM, landOnSlab: true, lands: true, kind: 'LAND_AND_IMMEDIATE_REJUMP', note: 'land' });
      const b = hop(a.next, archetype, { hold: HOLD.MEDIUM, kind: 'LAND_AND_IMMEDIATE_REJUMP', note: 'immediate rejump' });
      return { segments: [...a.segments, ...b.segments], next: b.next };
    }
    case 'SYNCOPATED_HOPS': {
      // Hops whose landings sit off the beat: a ~0.83-beat flight chained onto
      // itself takes off and lands *between* beats, which is what makes the
      // rhythm read as syncopation. The second hop used to be staged half a
      // beat after the first landed, but a player cannot take off in the
      // middle of nothing -- the staged gap broke the trajectory's contiguity
      // invariant, and against the verb that followed it, produced an overlap.
      const a = hop(state, archetype, { hold: 0.3, kind: 'SYNCOPATED_HOPS' });
      const b = hop(a.next, archetype, { hold: 0.3, kind: 'SYNCOPATED_HOPS', note: 'off-beat' });
      return { segments: [...a.segments, ...b.segments], next: b.next };
    }
    case 'AIRBORNE_ACCENT':
      return hop(state, archetype, {
        over: { kind: 'SPIKE', level: 0.11 },
        note: 'long slice over a hazard',
      });

    // ---- holes ----------------------------------------------------------
    case 'GAP_JUMP':
      return hop(state, archetype, { gap: true, note: 'jump the hole' });
    case 'LONG_GAP':
      // The hole is the primary threat and the spike sits inside it, so the
      // spike stays lower than a `LONG_JUMP`'s: two threats stacked at full
      // height would ask for one arc to answer both, which is the shape a
      // phrase should have to *earn* rather than get from a single verb.
      return hop(state, archetype, {
        gap: true,
        over: { kind: 'SPIKE', level: overHazardLevel(intensity, 0.055, 0.10) },
        note: 'hole near the arc limit',
      });

    // ---- vertical -------------------------------------------------------
    case 'DOUBLE_JUMP_MOUNT': {
      // A block above the single-jump ceiling: `DOUBLE_JUMP_LEVEL` sits past
      // `apexFor(1)`, so no ground jump lands on it. The flight is planned as
      // one piece -- full jump, ring at the apex, second impulse -- because
      // that is what the player experiences; the ring demand is what arms the
      // second press, Geometry-Dash-orb style, so the block *requires* the
      // mid-air jump rather than merely suggesting it.
      //
      // From a raised start the numbers stop being honest (the combined arc
      // would be planned from a height the block was not authored for), so the
      // verb falls back to a plain mount-and-step: still a real jump onto a
      // real slab, just not the double-jump idea.
      if (state.level > CORRIDOR_WALK) {
        return hop(state, archetype, { rise: HIGH_LEVEL, landOnSlab: true, lands: true, kind: 'HIGH_JUMP', note: 'too high for a double-jump block -- plain mount' });
      }
      const arc = doubleJumpArc();
      const endLevel = state.level + DOUBLE_JUMP_LEVEL;
      const airBeats = arc.beatsToRise(DOUBLE_JUMP_LEVEL)!;
      const landBeat = state.beat + airBeats;
      const startY = feetAt(state.surface, state.level);
      const endY = feetAt(state.surface, endLevel);
      const demands: TerrainDemandAny[] = [];
      pushSlab(demands, slab(state.surface, landBeat, endLevel));
      // The ring at the first arc's apex: its beat is when the player may
      // press again, its face is the height the press happens at.
      demands.push({
        kind: 'AIRJUMP',
        beat: state.beat + arc.pressBeats,
        faceY: startY - (state.surface === 'FLOOR' ? 1 : -1) * apexFor(1),
        surface: state.surface,
      });
      const segment: TrajectorySegment = {
        verb: 'DOUBLE_JUMP_MOUNT',
        archetype,
        startBeat: state.beat,
        beats: airBeats,
        surface: state.surface,
        startFeetY: startY,
        endFeetY: endY,
        runY: endY,
        airborne: true,
        airBeats,
        strength: 1,
        apex: arc.apex,
        lands: true,
        airJumpAt: arc.pressBeats,
        demands,
        hazards: [],
        note: 'jump, then jump again at the ring',
      };
      return { segments: [segment], next: { ...state, level: endLevel, beat: landBeat } };
    }
    case 'DROP':
      return drop(state, archetype, Math.max(0, state.level - STAIR_STEP * 2), 'run off the ledge');
    case 'DROP_AND_JUMP': {
      // One beat of drop, then one beat of jump: `VERB_INFO` gives the pair 1.5
      // beats, and the flight alone is 0.95 of that. Leaving the hop on the
      // default full hold made the verb 0.44 + 0.95 = 1.39 beats against a
      // nominal 1.5, so it never fit the slot it declared and was dropped from
      // every phrase that asked for it. The jump is a *medium* hold for the same
      // reason: the verb's name says the player leaves again at once, not that
      // they jump to the ceiling.
      const d = drop(state, archetype, Math.max(0, state.level - STAIR_STEP * 2));
      const j = hop(d.next, archetype, { hold: HOLD.MEDIUM, kind: 'DROP_AND_JUMP', note: 'leave again' });
      return { segments: [...d.segments, ...j.segments], next: j.next };
    }
    case 'SKY_STEPS': {
      // The pure "stepstone in the sky" read: consecutive full jumps, each
      // landing on a floating block with a hole under the flight, so a missed
      // beat is a fall and a made beat is a run of perfect touches. The steps
      // climb `SKY_STEP_RISE` each time -- under the single-jump apex, so
      // every block is reachable, and the *timing*, not the height, is the
      // test. The holes are sized to each flight's own airtime, the same
      // contract a GAP_JUMP signs.
      const out: TrajectorySegment[] = [];
      let current = state;
      for (let i = 0; i < 3; i++) {
        const r = hop(current, archetype, {
          rise: SKY_STEP_RISE,
          gap: true,
          gapScale: 0.6,
          landOnSlab: true,
          lands: true,
          kind: 'SKY_STEPS',
          note: `sky step ${i + 1}/3`,
        });
        out.push(...r.segments);
        current = r.next;
      }
      return { segments: out, next: current };
    }
    case 'STAIRCASE_UP':
      return stairs(state, archetype, 4, STAIR_STEP, 'STAIRCASE_UP');
    case 'STAIRCASE_DOWN':
      return stairs(state, archetype, 4, -STAIR_STEP, 'STAIRCASE_DOWN');
    case 'PLATFORM_ASCENT': {
      // Three steps to the top, then hold the high line. The steps are thirds of
      // the *distance to the top*, not of `ASCENT_LEVEL`: starting an ascent
      // from a walkway would otherwise ask the first step to climb more than a
      // jump can carry, and `hop` would quietly clamp it -- leaving an ascent
      // that reaches the top in two steps and looks like a bug.
      const steps: VerbResult[] = [];
      let current = state;
      const per = (ASCENT_LEVEL - current.level) / 3;
      for (let i = 0; i < 3; i++) {
        const r = hop(current, archetype, { rise: per, landOnSlab: true, lands: true, kind: 'PLATFORM_ASCENT', note: `ascent ${i + 1}/3` });
        steps.push(r);
        current = r.next;
      }
      return { segments: steps.flatMap((s) => s.segments), next: current };
    }
    case 'PLATFORM_DESCENT':
      return drop(state, archetype, 0, 'step down to the base surface');
    case 'HIGH_LOW_ALTERNATION': {
      // high -> low -> high -> low, alternating landing heights.
      const out: TrajectorySegment[] = [];
      let current = state;
      for (let i = 0; i < 4; i++) {
        const target = i % 2 === 0 ? HIGH_LEVEL : 0;
        const rise = target - current.level;
        const r = rise >= 0
          ? hop(current, archetype, { rise, landOnSlab: true, lands: true, kind: 'HIGH_LOW_ALTERNATION', note: i % 2 === 0 ? 'high' : 'low' })
          : drop(current, archetype, target, 'low');
        out.push(...r.segments);
        current = r.next;
      }
      return { segments: out, next: current };
    }
    case 'PLATFORM_HOP_CHAIN': {
      const out: TrajectorySegment[] = [];
      let current = state;
      for (let i = 0; i < 3; i++) {
        const r = hop(current, archetype, { landOnSlab: true, lands: true, kind: 'PLATFORM_HOP_CHAIN', note: `slab ${i + 1}` });
        out.push(...r.segments);
        current = r.next;
      }
      return { segments: out, next: current };
    }
    case 'RHYTHMIC_BOUNCE': {
      // Pads fire on contact, so the segment is the *flight* the pad buys and
      // the demand is the pad itself, sitting on the face the player lands on.
      const out: TrajectorySegment[] = [];
      let current = state;
      for (let i = 0; i < 4; i++) {
        const padBeat = current.beat;
        const r = hop(current, archetype, { strength: 1.35, note: 'pad launch' });
        const first = r.segments[0];
        first.demands = [
          { kind: 'PAD', beat: padBeat, faceY: feetAt(current.surface, current.level), surface: current.surface, strength: 1.35 },
          ...first.demands,
        ];
        first.verb = 'RHYTHMIC_BOUNCE';
        out.push(...r.segments);
        current = r.next;
      }
      return { segments: out, next: current };
    }

    // ---- ceiling --------------------------------------------------------
    case 'CEILING_HOP':
      return hop(state, archetype, { hold: HOLD.MEDIUM, note: 'hop along the ceiling' });
    case 'INVERTED_PLATFORM_CHAIN': {
      // Three slabs hanging further and further from the ceiling, so the chain
      // climbs *into* the field. The step is derived from the distance left to
      // the cap rather than fixed, so a chain that starts high does not walk
      // into the ceiling line.
      const out: TrajectorySegment[] = [];
      let current = state;
      const step = Math.min(STAIR_STEP, (MAX_LEVEL - current.level) / 3);
      for (let i = 0; i < 3; i++) {
        const r = hop(current, archetype, { rise: step, landOnSlab: true, lands: true, kind: 'INVERTED_PLATFORM_CHAIN', note: `hanging slab ${i + 1}` });
        out.push(...r.segments);
        current = r.next;
      }
      return { segments: out, next: current };
    }

    // ---- gravity --------------------------------------------------------
    case 'GRAVITY_FLIP_UP':
    case 'GRAVITY_FLIP_DOWN': {
      // A flip is a *snap*, and the planner models it as one because that is
      // literally what the mode does: `RunnerPlayer` sees the gravity direction
      // change, sets the feet on the new surface's line, and running continues.
      // The `visualSupportY` easing is what sells it as motion; the physics is a
      // hard cut.
      //
      // Modelling it as a jump was the bug worth avoiding here. A 0.95-beat arc
      // rises and comes back down, so the player would have been thrown at the
      // far surface and dropped back to where they started while the world
      // inverted underneath them. The flip is not a flight and does not want an
      // arc.
      //
      // This is the one place a trajectory is *discontinuous in world y*: the
      // segment before it ends on the old surface, this one begins on the new
      // one, and the distance between them is not travelled. That is the honest
      // description of a teleport, and `flipAt` is what marks it.
      const to = verb === 'GRAVITY_FLIP_UP' ? 'CEILING' : 'FLOOR';
      const y = feetAt(to, 0);
      const segments: TrajectorySegment[] = [{
        verb,
        archetype,
        startBeat: state.beat,
        beats: FLIP_BEATS,
        surface: to,
        startFeetY: y,
        endFeetY: y,
        runY: y,
        // The player really is off the surface for this beat -- `RunnerPlayer`
        // clears `grounded` on the flip -- so it is airborne even though it does
        // not travel. The next verb is free to be a real demand.
        airborne: true,
        airBeats: FLIP_BEATS,
        // The inversion lands on the segment's first frame, so the world is
        // already the right way up when the player starts reading the new route.
        flipAt: state.beat,
        lands: true,
        demands: [],
        hazards: [],
        note: `gravity inverts onto the ${to.toLowerCase()}`,
      }];
      // The far surface has to be solid where the player arrives, because a
      // course that flipped over a hole would drop them out of the world.
      //
      // The assertion is a *plate*, not an anchored block. At level 0 an
      // anchored slab is degenerate -- `faceY` and `backY` are both the base
      // line, so it is a zero-thickness marker -- and it is the only anchored
      // slab the planner ever emits. Every other "the ground is here" assertion
      // (`ensureGround`, a drop's landing, a landing slab) is a plate whose body
      // hangs out of the field and whose standable face sits exactly on the base
      // line, and the two forms do not merge: `coalesceSlabs` requires both
      // faces to agree, so a flip into a running stretch left two slabs sharing
      // y=0.28 over the same beats and the audit reported the world as
      // overlapping itself. Saying it the same way as everything else makes the
      // plate and the run's own ground one surface, which is what they are.
      pushSlab(segments[0].demands, slab(to, state.beat + FLIP_BEATS, 0, 2.4, true, true));
      return { segments, next: { surface: to, level: 0, beat: state.beat + FLIP_BEATS, flips: state.flips + 1 } };
    }
    case 'GRAVITY_ZIGZAG': {
      // Flip, play on the new surface, flip back. The playing segment is a real
      // run on the ceiling rather than a fixed pause, so the phrase stays
      // contiguous and the player gets a beat to read the inverted world.
      const up = planVerb('GRAVITY_FLIP_UP', state, archetype, intensity, budget);
      const play: VerbResult = {
        segments: [runSegment(up.next, Math.max(0.5, budget - up.segments[0].beats * 2), archetype, 'inverted running')],
        next: { ...up.next, beat: up.next.beat + Math.max(0.5, budget - up.segments[0].beats * 2) },
      };
      const down = planVerb('GRAVITY_FLIP_DOWN', play.next, archetype, intensity, budget);
      return {
        segments: [...up.segments, ...play.segments, ...down.segments],
        next: down.next,
      };
    }

    // ---- corridors ------------------------------------------------------
    case 'TOP_BOTTOM_CORRIDOR': {
      // The route is *defined* by a walkway and a roof together: the player runs
      // raised with a solid slab over their head. The roof is what makes it a
      // corridor, so the planner derives the *hold* from the headroom rather
      // than the other way round -- the jump has to fit under the roof.
      //
      // The hold is the key-hold whose apex leaves the head a margin below the
      // roof, and the headroom itself is capped by the ceiling line: a roof
      // whose body crosses it is a slab drawn through the other route. When the
      // cap bites, the corridor gets tighter rather than taller, and the jump
      // inside it gets shorter -- which is exactly the read a tight corridor is
      // supposed to have.
      const out: TrajectorySegment[] = [];
      let current = state;
      const walkStart = state.beat;
      const toWalk = hop(current, archetype, { rise: CORRIDOR_WALK, landOnSlab: true, lands: true, note: 'onto the walkway' });
      out.push(...toWalk.segments);
      current = toWalk.next;
      // The walkway is the level the entry hop *landed on*, not the constant it
      // asked for. Entering a corridor from ground that is already raised -- a
      // second corridor in the same phrase, or a walkway the previous verb left
      // behind -- puts the floor at `state.level + CORRIDOR_WALK`, while a roof
      // measured from the constant sits a whole `state.level` too low. That is
      // headroom the jump inside the corridor then spends, and the player's head
      // meets the roof on the way up.
      const walkLevel = levelOf(out[out.length - 1]);
      const headroom = corridorHeadroom(walkLevel, CORRIDOR_CLEARANCE);
      const hold = holdForApex(headroom - BODY_HEIGHT - CORRIDOR_APEX_MARGIN);
      // The roof begins where the *entry hop ends*, not where the corridor does.
      //
      // The entry is a full jump, and its apex is `jumpHeight` -- far above a
      // roof sized to be jumped under. Covering the entry with it means the
      // player's head meets the roof on the way up, the bonk kills the ascent,
      // and they come down early onto the walkway: a corridor whose own front
      // door is a ceiling. The corridor proper starts after that landing, and so
      // does its roof.
      const roofStart = current.beat;
      const hops = corridorHops(current, archetype, hold, state.beat + budget, 2, 'TOP_BOTTOM_CORRIDOR');
      out.push(...hops.segments);
      current = hops.next;
      // The walkway is laid *under the whole corridor*, not just under the
      // landing that opened it. Each hop inside the corridor lands back on the
      // walkway, so a walkway that stops one beat in leaves the second and third
      // hops landing on nothing -- the player drops to the floor line through a
      // platform drawn under them. One slab spanning the corridor is also what
      // the thing *is*: a corridor's floor, not a series of stepping stones.
      pushSlab(out[0].demands, slab(current.surface, (walkStart + current.beat) / 2, walkLevel, current.beat - walkStart, true, true));
      // A corridor whose hops did not fit has no roof to hang: a lid with no
      // floor under it is a ceiling to fly into, not a corridor.
      if (current.beat > roofStart + 1e-6) {
        pushSlab(out[0].demands, roof(current.surface, (roofStart + current.beat) / 2, walkLevel + headroom, current.beat - roofStart));
      }
      return { segments: out, next: current };
    }
    case 'TIGHT_VERTICAL_WINDOW': {
      // A corridor barely taller than the body plus the smallest deliberate tap:
      // the only way through is a short press, and the hold that buys it is
      // derived from the headroom rather than guessed. `holdForApex` returns 0
      // when even that overshoots, which is the planner saying "this roof is too
      // low" -- so the roof is set from the physics rather than from a round
      // number.
      const out: TrajectorySegment[] = [];
      let current = state;
      const walkStart = state.beat;
      const up = hop(current, archetype, { rise: CORRIDOR_WALK, landOnSlab: true, lands: true, note: 'into the window' });
      out.push(...up.segments);
      current = up.next;
      // The window's floor is where the entry hop landed, not the constant it
      // asked for -- see `TOP_BOTTOM_CORRIDOR`.
      const walkLevel = levelOf(out[out.length - 1]);
      const headroom = corridorHeadroom(walkLevel, TIGHT_CLEARANCE);
      const hold = holdForApex(headroom - BODY_HEIGHT - CORRIDOR_APEX_MARGIN);
      const roofStart = current.beat;
      const through = corridorHops(current, archetype, hold, state.beat + budget, 1, 'TIGHT_VERTICAL_WINDOW');
      out.push(...through.segments);
      current = through.next;
      // Same as `TOP_BOTTOM_CORRIDOR`: the walkway spans the whole window, so
      // the hop that ducks through it lands on the window's floor rather than
      // past the end of it, and the roof starts after the entry jump.
      pushSlab(out[0].demands, slab(current.surface, (walkStart + current.beat) / 2, walkLevel, current.beat - walkStart, true, true));
      if (current.beat > roofStart + 1e-6) {
        pushSlab(out[0].demands, roof(current.surface, (roofStart + current.beat) / 2, walkLevel + headroom, current.beat - roofStart));
      }
      return { segments: out, next: current };
    }

    // ---- set pieces -----------------------------------------------------
    // `BURST`, `WAVE`, `CORRIDOR` and friends are *archetypes*, not verbs:
    // `verbsFor` expands them before a verb ever reaches this function, so
    // there is nothing to do here for them.
  }
}

// --------------------------------------------------------------------------
// Phrases
// --------------------------------------------------------------------------

/**
 * Beats a verb *declares*: the musical slot it asks for.
 *
 * This is the shape length, not the truth. What a verb's geometry actually
 * spends is `verbCost`, measured from the segments it built, and the composer
 * budgets against that instead -- see `verbCost` for why the difference matters.
 */
function verbBeats(verb: MotionVerb, intensity: number): number {
  const info = VERB_INFO[verb];
  // High-intensity variations are the *same* geometry played denser, so the
  // nominal length is a floor and intensity only ever shortens the running
  // around them -- never the flight itself.
  void intensity;
  return info.beats;
}

/**
 * Beats a planned verb actually spends, measured from the segments it built.
 *
 * `VERB_INFO[verb].beats` is a *declared* length -- the musical slot a verb asks
 * for -- and for a long time it was also the number the composer budgeted
 * against. The two are not the same number, and the gap is not cosmetic:
 * `TOP_BOTTOM_CORRIDOR` declares four beats and builds 2.19, so a four-beat
 * phrase that entered a fifth of a beat short of its own length concluded the
 * corridor did not fit and dropped it whole, filling the bar with running
 * instead. That is how `runner_test_09` -- a level whose entire idea is the
 * corridor -- played as four beats of flat track three times over, and it is
 * what the zone audit reports as `FLAT_ENERGETIC_PHRASE` (spec §9).
 *
 * The rule this replaces was "does the declaration fit"; the rule that works is
 * "does what the verb *built* fit". A verb is planned once against the room the
 * phrase really has, and kept only if the geometry it produced is inside that
 * room. Nothing is squashed: a verb that overshoots is dropped whole, because
 * half a corridor is not half a corridor, it is a roof over a hole.
 */
function verbCost(result: VerbResult): number {
  return result.segments.reduce((sum, segment) => sum + segment.beats, 0);
}

/**
 * The verbs a phrase was explicitly authored with, if it named any.
 *
 * A phrase may carry `verbs` instead of relying on its archetype's default
 * sequence. The archetype still decides the phrase's *character* -- its role,
 * its motif, whether it is a calm phrase -- but the movement is the authored
 * list, verb for verb.
 *
 * Unknown names are dropped rather than rejected, and the phrase falls back to
 * its archetype when the list is empty. A typo in a level file should degrade to
 * the archetype's shape, not produce a section with no terrain at all: the load
 * validator already reports the bad name, so the planner's job here is to stay
 * useful while it does.
 */
function explicitVerbs(spec: PhraseSpec): MotionVerb[] | null {
  if (!Array.isArray(spec.verbs)) return null;
  const out = spec.verbs.filter(isMotionVerb);
  return out.length > 0 ? out : null;
}

/** Expand an archetype into the verbs that fill `beats`. */
function verbsFor(archetype: PhraseArchetype, beats: number): MotionVerb[] {
  const shape = ARCHETYPE_VERBS[archetype];
  const out: MotionVerb[] = [];
  let filled = 0;
  for (let i = 0; filled < beats - 1e-6; i++) {
    const verb = shape[i % shape.length];
    out.push(verb);
    filled += verbBeats(verb, 0.5);
    // One pass through the shape is the idea; repeating it is how a short
    // archetype fills a long phrase, which is what makes motifs recur.
    if (i > 32) break;
  }
  return out;
}

/** The role a phrase takes from its position, when the spec does not say. */
function roleFor(index: number, count: number): PhraseRole {
  if (count <= 1) return 'INTRO';
  const t = index / (count - 1);
  if (t < 0.15) return 'INTRO';
  if (t < 0.4) return 'REPEAT';
  if (t < 0.7) return 'VARIATION';
  if (t < 0.9) return 'CLIMAX';
  return 'RELEASE';
}

/**
 * Put the player on the surface a phrase asked for, if they are not there.
 *
 * A phrase's `inverted` flag is a *statement about where the phrase is played*,
 * not a reset. Without this, every phrase would restart on the floor and a
 * course that went to the ceiling would teleport back down at the next phrase
 * boundary -- the trajectory would still be "contiguous" in beats and utterly
 * wrong in world y. The flip is emitted here, at the phrase boundary, because
 * the archetype's verb list is a musical shape and cannot be relied on to close
 * a loop it never knew about.
 *
 * `level` restarts at 0 with the new surface: a phrase that flipped is on the
 * base line of the surface it arrives at, which is the only state the next
 * phrase's verbs can be planned against.
 */
function enterSurface(
  state: PlanState,
  want: TrackSurface,
  archetype: string,
  intensity: number,
): VerbResult {
  if (want === state.surface) return { segments: [], next: state };
  const verb: MotionVerb = want === 'CEILING' ? 'GRAVITY_FLIP_UP' : 'GRAVITY_FLIP_DOWN';
  return planVerb(verb, { ...state, level: 0 }, archetype, intensity, FLIP_BEATS);
}

/**
 * Plan one phrase.
 *
 * Verbs are planned in order against a shrinking budget; when a verb does not
 * fit what is left, the composer stops and fills the remainder with running.
 * The phrase therefore always occupies exactly `beats`, and no verb is ever
 * squashed.
 */
function planPhrase(
  spec: PhraseSpec,
  startBeat: number,
  defaultBeats: number,
  index: number,
  count: number,
  entry: PlanState,
): TrajectoryPhrase {
  const role = (spec.role as PhraseRole | undefined) ?? roleFor(index, count);
  const beats = spec.beats ?? defaultBeats;
  const intensity = spec.intensity ?? 0.5;
  const motif = spec.motif ?? `${role.toLowerCase()}-${index}`;
  const archetype: PhraseArchetype = isArchetype(spec.archetype)
    ? spec.archetype
    : pickArchetype(role, index);

  const authored = explicitVerbs(spec);
  const segments: TrajectorySegment[] = [];

  // Which surface the phrase is played on. `inverted` is a *statement*, not a
  // reset: absent means "carry on where the last phrase left off", which is the
  // only reading that keeps the course contiguous. A phrase that names a
  // different surface gets the flip it needs, emitted here rather than left to
  // the archetype -- an archetype's verb list is a musical shape, and it cannot
  // be relied on to close a loop it never knew about.
  const want: TrackSurface = spec.inverted === true ? 'CEILING' : spec.inverted === false ? 'FLOOR' : entry.surface;
  let state: PlanState = { ...entry, beat: startBeat, flips: 0 };
  const entryFlip = enterSurface(state, want, archetype, intensity);
  if (entryFlip.segments.length > 0) {
    segments.push(...entryFlip.segments);
    state = entryFlip.next;
  }
  // A phrase that carried a *height* over from the one before it -- a `WAVE`
  // that ended on a high platform, a corridor whose walkway is still under the
  // player -- has to come back down before its own verbs are planned. Otherwise
  // the phrase's first verb is planned from a level it is not standing at, and
  // the trajectory has a 0.16 discontinuity in world y at the boundary that the
  // simulator reports as the player having fallen through a platform.
  //
  // The descent is emitted as a real `PLATFORM_DESCENT`-shaped drop rather than
  // a teleport, so the beats it takes are accounted for and the arc is honest.
  //
  // Unless the phrase *opens with* a descent -- a `STAIRCASE_DOWN`, a
  // `PLATFORM_DESCENT`, a `DROP`. Descending is then the phrase's own first
  // idea, and the prelude would spend it before the list ever ran: the
  // staircase-down arrived at the floor with nothing left to descend, emitted
  // nothing, and the phrase collapsed into a settle run. Letting the authored
  // verb do the descending keeps the idea (and the height) in the phrase where
  // it was put.
  const opening = authored ?? verbsFor(archetype, beats);
  const opensWithDescent =
    opening[0] === 'STAIRCASE_DOWN' || opening[0] === 'PLATFORM_DESCENT' || opening[0] === 'DROP';
  if (state.level > 0.005 && !opensWithDescent) {
    // The descent is a *prelude*, and it is charged for what a fall costs.
    //
    // Planning it as a `PLATFORM_DESCENT` asked for four beats, and `planVerb`
    // happily spent all four: with an entry level of 0.27 the phrase's whole
    // budget went on coming down, so the authored verb list was never reached.
    // That is what emptied `TOP_BOTTOM_CORRIDOR`, `HIGH_LOW_ALTERNATION`,
    // `STAIRCASE_DOWN` and `PLATFORM_ASCENT` across the library -- the phrases
    // that need height most were the ones whose height got eaten.
    //
    // A `drop` is the same journey at the cost a fall actually takes (0.2 to
    // ~0.45 beats, from `dropBeats`), which is what the player experiences
    // anyway: nobody jumps down a staircase they could fall down.
    const step = drop(state, archetype, 0, 'descend to the base line');
    const room = startBeat + beats - state.beat;
    let used = 0;
    for (const segment of step.segments) {
      if (segment.beats > room - used + 1e-6) break;
      segments.push(segment);
      used += segment.beats;
    }
    if (used > 0) state = { ...step.next, beat: state.beat + used };
  }

  // A RELEASE phrase is the mode exhaling: the movement stays (that is what
  // makes it feel good) but nothing can hurt the player during it. §33's empty
  // space rule says calm has to be *intentional*, and this is what intentional
  // calm looks like -- running and jumping with the hazards switched off.
  const peaceful = archetype === 'RELEASE' || role === 'RELEASE';
  // "Has anything flown yet?" is a *phrase*-level fact, not a per-verb one.
  //
  // A grounded run has to re-assert the ground under itself when the base
  // line's solidity is not already free -- and what makes it not free is any
  // flight earlier in the phrase: a gap cut a hole, a boundary drop left the
  // walkway, a flip changed what "the ground" even is. Resetting that question
  // at every verb meant a run two verbs after a gap was planned as if the base
  // line had never been questioned, and emitted nothing -- which left whole
  // phrases with no world geometry at all once actual-cost budgeting let the
  // last verb consume the room the settle path used to be given. Seeded from
  // the prelude (entry flip, boundary descent) so the settle path and the verb
  // path answer it from the same history.
  let airborneSeen = segments.some((s) => s.airborne);
  for (const verb of opening) {
    const remaining = startBeat + beats - state.beat;
    // Budget against what the verb *builds*, not against what it declares.
    //
    // The old test was `remaining < verbBeats(verb)` -- the declared slot -- and
    // that single line is why the corridor levels played as flat track: a
    // four-beat phrase entered with 3.99 beats left, `TOP_BOTTOM_CORRIDOR`
    // declared 4, the verb was dropped, and the bar became `GROUND_RUN`. The
    // planner then spent the room it had saved by... running, which is the
    // emptiest thing it could have done with it.
    //
    // Planning the verb and *then* deciding is the honest order: the geometry is
    // the only thing that knows how long the verb is, and it is cheap to build.
    // A verb that overshoots the remaining room is still dropped whole -- see
    // `verbCost` -- so nothing is compressed and no phrase leaks into the next.
    const result = peaceful
      ? calm(planVerb(verb, state, archetype, intensity, remaining))
      : planVerb(verb, state, archetype, intensity, remaining);
    // A verb that would run past the phrase is trimmed to fit rather than
    // dropped, so a phrase never leaks into the next one.
    let consumed = 0;
    for (const segment of result.segments) {
      const room = startBeat + beats - (state.beat + consumed);
      if (segment.beats > room + 1e-6) break;
      // Every grounded segment asserts the ground under itself. A run emits no
      // terrain because the base line is solid for free -- but that is only true
      // *at the base line*, and a flight may have cut a hole in it or the run may
      // be raised onto a walkway. `ensureGround` is a no-op in the common case
      // and the difference between a corridor and a hole in the other two.
      segments.push(ensureGround(segment, airborneSeen));
      airborneSeen = airborneSeen || segment.airborne;
      consumed += segment.beats;
    }
    // A verb whose *first* segment already overshoots is the only case the
    // budget can legitimately refuse, and it is where the loop stops. A verb
    // that built *nothing at all* is a different case -- a `STAIRCASE_DOWN`
    // already at the floor has no step it can take -- and refusing the phrase
    // for it stranded whatever room was left with the settle run. Skip it and
    // let the rest of the list, or the archetype continuation, play.
    if (consumed === 0) {
      if (verbCost(result) === 0) continue;
      break;
    }
    const built = verbCost(result);
    if (built > consumed + 1e-6) {
      // A verb that was trimmed -- its tail did not fit -- leaves the phrase at
      // its own end, so there is nothing to plan after it. Stopping here rather
      // than looping keeps the "verbs are planned in order against a shrinking
      // budget" contract while letting a truncated verb still be *played*: a
      // corridor cut off by the bar line is far more of a corridor than the
      // running that replaced it.
      //
      // The state the phrase continues from is the end of the segments that
      // actually got *pushed*, not the verb's own end state. `result.next`
      // describes a player who finished the whole verb; a chain trimmed after
      // two of its three hops otherwise hands the next verb a level half a
      // step above where the trajectory really ends, and the player teleports
      // upward at the verb boundary.
      const last = segments[segments.length - 1];
      state = {
        ...state,
        beat: state.beat + consumed,
        surface: last.surface,
        level: levelOf(last),
        groundedSince: groundedSinceOf(last),
      };
      break;
    }
    state = { ...result.next, beat: state.beat + consumed };
  }

  // Fill whatever is left with running on the surface the phrase ended on, so
  // the next phrase starts from a known, stable state.
  const leftover = startBeat + beats - state.beat;
  if (leftover > 0.05) {
    const settle = runSegment(state, leftover, archetype, 'settle');
    segments.push(ensureGround(settle, airborneSeen));
  } else if (segments.length > 0) {
    // Absorb a sliver of overrun into the last segment rather than leaving a
    // gap: the trajectory's contiguity invariant is what everything else trusts.
    //
    // The segment's *demands* move with it. A landing slab is placed at the
    // beat the flight ends, so extending the flight by a sliver without moving
    // the slab leaves the slab ending a hair short of where the feet arrive --
    // and "there is nothing to land on at the end of this flight" is exactly
    // what `NO_SUPPORT` reports. Only the demands sitting on the old end beat
    // move; a mid-flight hazard stays where it is.
    const last = segments[segments.length - 1];
    const oldEnd = last.startBeat + last.beats;
    last.beats += leftover;
    for (const demand of last.demands) {
      if (demand.beat >= oldEnd - 1e-6) demand.beat += leftover;
    }
    for (const demand of last.hazards) {
      if (demand.beat >= oldEnd - 1e-6) demand.beat += leftover;
    }
  }

  return { archetype, role, startBeat, beats, motif, intensity, segments };
}

/** Which archetype a role should draw from, when the spec leaves it open. */
function pickArchetype(role: PhraseRole, index: number): PhraseArchetype {
  const options = ROLE_ARCHETYPES[role];
  return options[index % options.length];
}

/**
 * The headroom a corridor actually gets, given the walkway under it and the
 * headroom it would like.
 *
 * A roof is bounded by the ceiling line: past it, the corridor's body is drawn
 * through the route the player flips onto, and the level is lying about where
 * its geometry is. So the corridor is squeezed from above rather than the roof
 * crossing the line -- and the jump inside it gets shorter, which is the read a
 * tight corridor is for.
 *
 * The floor of `CORRIDOR_MIN_CLEARANCE` is the other side of the same
 * constraint: below it, the only jump that fits is one no hand can input, so the
 * planner raises the roof to the minimum and lets the cap be exceeded rather
 * than emitting a corridor nobody can traverse.
 */
function corridorHeadroom(walk: number, wanted: number): number {
  const ceilingCap = FIELD_GAP - walk - BODY_HEIGHT;
  return Math.max(CORRIDOR_MIN_CLEARANCE, Math.min(wanted, ceilingCap));
}

// --------------------------------------------------------------------------
// Entry point
// --------------------------------------------------------------------------

export interface PlanOptions {
  /** Absolute beat the section starts on. */
  startBeat: number;
  /** Default phrase length, in beats, when a phrase does not set one. */
  phraseBeats?: number;
}

/**
 * Plan a whole course.
 *
 * Phrases are laid end to end by *accumulating* their real lengths, not by
 * multiplying an index by the default. A course whose phrases are all four beats
 * cannot tell the two apart, which is exactly why the index-multiply version
 * survived as long as it did -- but the moment a phrase overrides `beats` (and
 * the showcase does, because a gravity section is longer than a groove) the
 * index-multiply version places it at the wrong beat and every phrase after it
 * overlaps its neighbour. The trajectory's contiguity invariant is the thing
 * everything downstream trusts, so it is enforced here by construction.
 *
 * The surface carries across phrases the same way the beat does: each phrase
 * starts on the surface the previous one finished on, and a phrase that names a
 * different one gets the flip it needs. Without that, a course that ever went
 * inverted would have every later phrase teleport back to the floor -- which is
 * exactly the bug that made the first showcase draft unplayable past beat 60.
 *
 * Deterministic: the same spec always produces the same trajectory, whatever
 * the seed, because nothing here is random yet. The seed is threaded through to
 * the *composer* (`composeCourse`) which is the only place controlled randomness
 * is allowed (spec §46).
 */
export function planCourse(spec: CourseSpec, options: PlanOptions): Trajectory {
  const defaultBeats = spec.phraseBeats ?? 4;
  const phrases: TrajectoryPhrase[] = [];
  let beat = options.startBeat;
  let state: PlanState = { surface: 'FLOOR', level: 0, beat: options.startBeat, flips: 0 };
  for (const [i, phrase] of spec.phrases.entries()) {
    const planned = planPhrase(phrase, beat, defaultBeats, i, spec.phrases.length, state);
    phrases.push(planned);
    beat += planned.beats;
    const last = planned.segments[planned.segments.length - 1];
    if (last) {
      state = {
        surface: last.surface,
        level: levelOf(last),
        beat,
        flips: 0,
        groundedSince: groundedSinceOf(last),
      };
    }
  }
  return flattenTrajectory(phrases);
}

/** Rise above its own surface of the feet at the end of a segment. */
function levelOf(segment: TrajectorySegment): number {
  return segment.surface === 'FLOOR' ? FLOOR_Y - segment.endFeetY : segment.endFeetY - CEILING_Y_CONST;
}

/**
 * The beat the grounded stretch a segment ends in began on.
 *
 * A segment that landed started one at its own landing; a segment that was
 * already running has been grounded since it started. Carried into the next
 * `PlanState` wherever a phrase rebuilds one from its last segment, so the
 * settle rule in `drop()` survives a phrase boundary and a trimmed verb.
 */
function groundedSinceOf(segment: TrajectorySegment): number {
  return segment.airborne ? segment.startBeat + segment.beats : segment.startBeat;
}

/**
 * Fill a course's phrases from an archetype sequence (spec §44-§48).
 *
 * This is the *procedural* path, and it is deliberately the smaller half: it
 * chooses phrase archetypes and their roles, and hands them to `planCourse`,
 * which is the same planner the handcrafted showcase uses. A generated course
 * is therefore exactly as physically valid as an authored one -- there is no
 * second code path to keep honest.
 *
 * Anti-repetition (spec §47): an archetype is never used twice in a row unless
 * the role changed. Anti-chaos (spec §48): every phrase declares a motif, and
 * motifs recur, so the section has musical memory rather than a sequence of
 * unrelated ideas.
 */
export interface ComposeOptions {
  /** Total beats to fill. */
  beats: number;
  phraseBeats?: number;
  seed: number;
  /** 0..1. Raises the density of hazardous archetypes and the intensity. */
  intensity?: number;
}

export function composeCourse(options: ComposeOptions): CourseSpec {
  const phraseBeats = options.phraseBeats ?? 4;
  const count = Math.max(1, Math.round(options.beats / phraseBeats));
  const rng = makeRng(options.seed);
  const intensity = options.intensity ?? 0.5;

  const phrases: PhraseSpec[] = [];
  let previous: string | null = null;
  let filled = 0;
  // Motifs are drawn from a small pool so they can recur; each one is a family
  // of archetypes rather than a single shape.
  const motifs = ['drive', 'climb', 'air', 'invert'];
  for (let i = 0; filled < options.beats - 1e-6; i++) {
    const role = roleFor(i, count);
    const options_ = ROLE_ARCHETYPES[role];
    let archetype = options_[Math.floor(rng() * options_.length)];
    // Anti-repetition: re-roll once if the same archetype just played.
    if (archetype === previous && options_.length > 1) {
      archetype = options_[(options_.indexOf(archetype) + 1) % options_.length];
    }
    // A flip pair needs room for both of its phrases; squeezed at the end of a
    // section it would strand the return.
    if (archetype === 'FLIP' && options.beats - filled < phraseBeats * 2) {
      archetype = options_[(options_.indexOf(archetype) + 1) % options_.length];
    }
    previous = archetype;
    // The I-R-V-C-R arc is also a dynamic arc: the middle is the loudest, and
    // the release is the quietest -- an exhale, not a verse. Leaving RELEASE at
    // full base intensity authored loud phrases whose content is a calm-down,
    // and the zone audit then read them as flat.
    let loudness = clamp01(
      intensity * (role === 'CLIMAX' ? 1.25 : role === 'INTRO' ? 0.7 : role === 'RELEASE' ? 0.6 : 1),
    );
    // Some archetypes are recovery shapes whatever role they landed in: a
    // DESCENT is three drops and a walk home, a RELEASE an open run. Loudly
    // labelled calm is still calm -- the composer caps them below the
    // energetic line so their label and their content agree.
    if (archetype === 'DESCENT' || archetype === 'RELEASE') loudness = Math.min(loudness, 0.4);
    const motif = motifs[Math.floor(rng() * motifs.length)];
    if (archetype === 'FLIP') {
      // §13: a gravity flip is a whole phrase idea, so the composer writes it
      // as the pair the planner can honor: over to the ceiling, play there,
      // and back. Each flip lives at a phrase boundary (`enterSurface`), where
      // it is charged to the phrase that asked for it -- a truncated verb
      // shape can never leave the course stranded on the far surface, which
      // is exactly what a `FLIP` phrase whose tail flip was trimmed used to
      // do. The return half declares `inverted: false` explicitly: absent
      // means "carry on where the last phrase left off", and carrying the
      // ceiling home is precisely the stranding this pair exists to prevent.
      // The ceiling half reaches into the field explicitly (`verbs`): a
      // ceiling phrase that only hops and runs is the ceiling-side of flat.
      phrases.push({
        archetype: 'INVERTED_GROOVE',
        role,
        beats: phraseBeats,
        intensity: loudness,
        motif,
        inverted: true,
        verbs: ['CEILING_HOP', 'INVERTED_PLATFORM_CHAIN'],
      });
      phrases.push({ archetype: 'GROOVE', role, beats: phraseBeats, intensity: loudness, motif, inverted: false });
      previous = 'GROOVE';
      filled += phraseBeats * 2;
    } else {
      phrases.push({ archetype, role, beats: phraseBeats, intensity: loudness, motif });
      filled += phraseBeats;
    }
  }
  return { phraseBeats, seed: options.seed, phrases };
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/** Track units of one beat -- re-exported so callers need one import, not two. */
export const PLANNER_UNITS_PER_BEAT = UNITS_PER_BEAT;

/** Apex of a full jump, re-exported for course dumps. */
export const PLANNER_JUMP_APEX = apexFor(1);

/** Gravity multiplier a flip zone applies, for the course mechanic. */
export const PLANNER_FLIP_SCALE = FLIP_SCALE;

/** Beats of hazard margin the planner leaves, for the validator to reuse. */
export const PLANNER_HAZARD_MARGIN = HAZARD_MARGIN_BEATS;

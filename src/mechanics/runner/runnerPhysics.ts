/**
 * RUNNER physics: the single source of truth for what a jump can do.
 *
 * Everything in RUNNER is denominated in beats, and so is the jump arc:
 * `TUNING.runner.jumpBeats` of airtime to return to the height you left, peaking
 * at `TUNING.runner.jumpHeight`. Because both are fixed in beats, the *shape* of
 * a jump is identical at 90 BPM and at 180 BPM -- only its duration in seconds
 * changes. That is what lets obstacle spacing be a rhythmic statement instead of
 * a distance re-tuned per song.
 *
 * This module exists because three consumers have to agree on that shape
 * *exactly*:
 *
 *   1. `RunnerPlayer`            -- integrates the real arc the player flies;
 *   2. the RUNNER course compiler -- places terrain the intended arc reaches;
 *   3. `tools/runner-check.ts`   -- proves analytically that it does.
 *
 * When those three disagree the level is unfair in a way no amount of
 * playtesting intuition catches, so all three read their numbers from here.
 *
 * Units: heights are field units (0..1 of the field's height), horizontal
 * distances are field units of track, and everything time-shaped is in beats.
 */

import { TUNING } from '../../tuning';

/** Beats of airtime for an unmodified jump, from take-off back to take-off height. */
export const JUMP_BEATS = TUNING.runner.jumpBeats;
/** Apex of an unmodified jump, in field units above the take-off surface. */
export const JUMP_HEIGHT = TUNING.runner.jumpHeight;
/** Field units of track travelled per beat. */
export const UNITS_PER_BEAT = TUNING.runner.unitsPerBeat;
/** Player body, used for clearance and landing-width maths. */
export const BODY_WIDTH = TUNING.runner.playerWidth;
export const BODY_HEIGHT = TUNING.runner.standingHeight;
export const SLIDE_HEIGHT = TUNING.runner.slidingHeight;
/** Surfaces this close above the feet are walked onto rather than jumped. */
export const STEP_UP = TUNING.runner.stepUpHeight;
/** How much of the upward speed survives releasing the jump key. */
export const JUMP_CUT = TUNING.runner.jumpCutFactor;

/**
 * The radius of the circle the mode probes the world with.
 *
 * Collision in RUNNER is *not* an AABB: `RunnerMode` places a circle of this
 * radius at the body's centre and asks whether it meets a hazard. That makes the
 * body's effective vertical extent `height/2 + PROBE_RADIUS` either side of the
 * feet rather than `height`, and the difference is not academic -- a beam sized
 * from the geometric body height is a beam the collision probe walks straight
 * through, so the player passes a hazard the level says is unavoidable.
 *
 * Anything that has to reason about whether a hazard can be *hit* has to use
 * this number, which is why it lives here rather than inside the mode.
 */
export const PROBE_RADIUS = Math.min(BODY_WIDTH, SLIDE_HEIGHT) / 2;

/** How far above the feet a *standing* body's collision circle reaches. */
export const STAND_TOP = BODY_HEIGHT / 2 + PROBE_RADIUS;
/** How far above the feet a *sliding* body's collision circle reaches. */
export const SLIDE_TOP = SLIDE_HEIGHT / 2 + PROBE_RADIUS;

/**
 * The band of clearances that make a beam mean something: the player fits under
 * it sliding, and does not fit under it standing.
 *
 * Derived from the collision probe, not from the drawn body. A beam whose
 * clearance sits outside this band is either scenery (too high to ever touch a
 * standing player) or a wall (too low for a sliding one), and both are bugs the
 * level cannot express its way out of.
 */
export const BEAM_CLEARANCE_BAND: readonly [number, number] = [SLIDE_TOP, STAND_TOP];

/** The clearance the planner gives a beam: the middle of the band, so neither
 *  edge of it is a single-frame read. */
export const BEAM_CLEARANCE = SLIDE_TOP + (STAND_TOP - SLIDE_TOP) * 0.5;

/**
 * Apex of a *full-hold* jump launched at `strength` times the normal impulse.
 *
 * A bounce pad scales the impulse linearly, so height scales with its square.
 * Strength 1.4 therefore buys a 0.63-unit apex -- comfortably more than the 0.44
 * between floor and ceiling, which is what makes a pad the natural way to reach
 * the far surface.
 */
export function apexFor(strength = 1): number {
  return JUMP_HEIGHT * strength * strength;
}

/** Airtime of a full-hold jump at `strength`, back to the take-off height. */
export function airBeatsFor(strength = 1): number {
  return JUMP_BEATS * strength;
}

/** Gravity in field-units per beat-squared, for a jump at `strength`. */
function gravityPerBeat(strength: number): number {
  return (8 * apexFor(strength)) / (airBeatsFor(strength) ** 2);
}

/** Take-off speed in field-units per beat, for a jump at `strength`. */
function takeoffSpeed(strength: number): number {
  return (4 * apexFor(strength)) / airBeatsFor(strength);
}

/**
 * A jump arc, resolved.
 *
 * `holdBeats` is how long the jump key stays down: releasing early multiplies
 * the remaining upward speed by `TUNING.runner.jumpCutFactor`, so a tap is a hop
 * and a hold is a full jump. Modelling the cut analytically (rather than only
 * inside the player) is what lets `SHORT_JUMP` and `QUICK_HOP` mean something
 * specific in the motion language instead of being decoration on a full arc.
 */
export interface Arc {
  /** Apex above the take-off surface. */
  apex: number;
  /** Beats from take-off back down to the take-off surface. */
  airBeats: number;
  /** Height above take-off at `beats` into the flight. */
  heightAt(beats: number): number;
  /**
   * Beats until the *descending* arc reaches `rise` above take-off, or null when
   * the arc never gets that high. `rise` may be negative (landing below).
   */
  beatsToRise(rise: number): number | null;
}

/** The arc of a jump at `strength`, with the key held for `holdBeats`. */
export function jumpArc(strength = 1, holdBeats = Infinity): Arc {
  const apex = apexFor(strength);
  const jb = airBeatsFor(strength);
  const g = gravityPerBeat(strength);
  const v0 = takeoffSpeed(strength);

  // The cut only applies while still rising, and only if the key really does
  // come up before the apex. Anything later is a full jump.
  const apexBeats = v0 / g; // == jb / 2
  const cut = Number.isFinite(holdBeats) && holdBeats < apexBeats ? Math.max(0, holdBeats) : null;

  const holdHeight = cut === null ? 0 : v0 * cut - 0.5 * g * cut * cut;
  const holdSpeed = cut === null ? 0 : (v0 - g * cut) * JUMP_CUT;
  const cutApex = cut === null ? apex : holdHeight + (holdSpeed * holdSpeed) / (2 * g);
  // Descending time from the cut point back to the take-off height.
  const fallBeats = cut === null
    ? apexBeats
    : (holdSpeed + Math.sqrt(holdSpeed * holdSpeed + 2 * g * holdHeight)) / g;
  const airBeats = cut === null ? jb : cut + fallBeats;

  const heightAt = (beats: number): number => {
    if (beats <= 0) return 0;
    if (cut === null) {
      if (beats >= jb) return 0;
      return v0 * beats - 0.5 * g * beats * beats;
    }
    if (beats <= cut) return v0 * beats - 0.5 * g * beats * beats;
    const t = beats - cut;
    if (t >= fallBeats) return 0;
    return holdHeight + holdSpeed * t - 0.5 * g * t * t;
  };

  const beatsToRise = (rise: number): number | null => {
    if (rise > cutApex) return null;
    // Always the *descending* crossing, and the same equation for every sign of
    // `rise`.
    //
    // Two bugs were fixed by removing special cases here. First, landing on the
    // way *up* is not a thing the mode can do -- the terrain probe only lands
    // the player while `velocity` points with gravity -- so returning the rising
    // crossing described a landing that never happens, and one that is earlier
    // than the apex, so every cut jump was planned to a shorter airtime than it
    // flew. Second, a *negative* rise (a hop down onto a lower slab) is not the
    // same as a rise of zero: the arc really does take longer, and returning
    // `airBeats` there planned every descending staircase to land too early.
    //
    // A cut changes where the descent *starts* (at the cut point, with the
    // remaining speed scaled), which is exactly what `start`/`base`/`speed`
    // below encode. Past the cut, cut and uncut jumps are the same equation, and
    // at rise 0 both reduce to the full airtime.
    const start = cut === null ? 0 : cut;
    const base = cut === null ? 0 : holdHeight;
    const speed = cut === null ? v0 : holdSpeed;
    const disc = speed * speed + 2 * g * (base - rise);
    if (disc < 0) return null;
    return start + (speed + Math.sqrt(disc)) / g;
  };

  return { apex: cutApex, airBeats, heightAt, beatsToRise };
}

/**
 * Height above the take-off surface at normalised time `u` in [0, 1] (full jump).
 */
export function arcHeightAt(u: number, strength = 1): number {
  const clamped = u <= 0 || u >= 1 ? 0 : u;
  return 4 * apexFor(strength) * clamped * (1 - clamped);
}

/**
 * The lowest apex any jump can have, at `strength`: what a zero-length tap buys.
 *
 * The jump cut only removes `1 - TUNING.runner.jumpCutFactor` of the upward
 * speed, so there is a floor under how small a hop can be. A corridor tighter
 * than this cannot be jumped through at all -- the player will bonk -- and the
 * planner has to know that number rather than assume a tap means "small".
 */
export function minJumpApex(strength = 1): number {
  const g = gravityPerBeat(strength);
  const v0 = takeoffSpeed(strength);
  const cutSpeed = v0 * JUMP_CUT;
  return (cutSpeed * cutSpeed) / (2 * g);
}

/**
 * The shortest key-hold a player can mean as a *deliberate tap*.
 *
 * 0.08 beats is 40ms at 120 BPM: two and a half frames at 60fps, and about the
 * shortest press a human hand produces on purpose. It matters because the jump
 * cut has a floor -- `minJumpApex()` is what a zero-length press buys, and a
 * corridor sized to that floor would demand a release inside a single frame.
 * Anything that has to be *released* to fit (a corridor, a tight window) is
 * sized from this number rather than from the mathematical minimum, so the
 * demanding version of a jump is demanding rather than impossible.
 */
export const MIN_TAP_BEATS = 0.08;

/**
 * The shortest key-hold whose jump apex is at most `apex`.
 *
 * Apex rises monotonically with hold length, so this is a bisection on
 * `jumpArc(strength, h).apex`. Used by the planner to fit a hop under a ceiling:
 * the corridor decides how high the player is *allowed* to go, and the hold is
 * derived from that rather than guessed.
 *
 * Returns 0 when even the smallest hop overshoots -- the caller then knows the
 * jump is impossible and must either raise the roof or ask for a slide.
 */
export function holdForApex(apex: number, strength = 1): number {
  if (apex <= 0) return 0;
  if (apex >= apexFor(strength)) return Infinity;
  let lo = 0;
  let hi = airBeatsFor(strength) / 2;
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    if (jumpArc(strength, mid).apex > apex) hi = mid;
    else lo = mid;
  }
  return lo;
}

/**
 * The apex a key-hold of `holdBeats` buys: the inverse of `holdForApex`.
 *
 * The planner needs it in the *forward* direction too. A corridor's headroom is
 * a distance, and the question "can a human-sized tap fit in this" is answered
 * by turning a hold into a height, not by searching for a hold and hoping the
 * answer is a number a hand can produce.
 */
export function apexForHold(holdBeats: number, strength = 1): number {
  return jumpArc(strength, holdBeats).apex;
}

/**
 * The slice of a *full-hold* jump spent at or above `height`, as
 * `[startBeat, endBeat]` measured from take-off. Empty (`start > end`) when the
 * arc never gets there.
 *
 * This is the number a spike's clearance is judged against: a spike is only
 * clearable if the arc is above it for at least as long as the spike takes to
 * cross the player's body.
 */
export function arcWindowBeats(height: number, strength = 1): [number, number] {
  const apex = apexFor(strength);
  if (height >= apex) return [Infinity, -Infinity];
  const root = Math.sqrt(Math.max(0, 1 - height / apex));
  const air = airBeatsFor(strength);
  return [((1 - root) / 2) * air, ((1 + root) / 2) * air];
}

/** Beats of a full-hold jump spent at or above `height`. */
export function beatsAbove(height: number, strength = 1): number {
  const [a, b] = arcWindowBeats(height, strength);
  return Math.max(0, b - a);
}

/**
 * Beats from take-off to touching a surface whose standable face is `rise` above
 * the take-off surface, for a full-hold jump. Negative `rise` is a drop.
 *
 * Returns `null` when the arc never gets that high -- the platform is
 * unreachable by a plain jump at this strength, and the level must either lower
 * it, add a bounce pad, or reach it in two hops.
 */
export function landingBeats(rise: number, strength = 1): number | null {
  return jumpArc(strength).beatsToRise(rise);
}

/**
 * Height of a block that only a mid-air second jump can reach.
 *
 * Above `apexFor(1)` (0.32) so a single full jump physically cannot land on it,
 * and low enough that a player standing on it keeps their head under the other
 * route's line (0.34 + body 0.09 = 0.43 of the 0.44 span). The whole feature
 * lives in this band; wider would need a different field.
 */
export const DOUBLE_JUMP_LEVEL = 0.34;

/**
 * How far above the press point the mid-air second jump rises.
 *
 * Deliberately much less than a ground jump: the press happens at the first
 * arc's apex, already 0.32 up, and the *combined* peak has to stay readable
 * against the ceiling route. A short, punchy boost is the Geometry-Dash read.
 * The size is also the player's error budget: a frame late or early lands
 * `(0.34 + this) - actual peak` short of the block, so the number is chosen
 * for forgiveness first and looks second.
 */
export const AIR_JUMP_APEX = 0.13;

/**
 * Velocity scale of the mid-air second jump relative to a ground jump.
 *
 * Same gravity, so apex scales with velocity squared: this is
 * `sqrt(AIR_JUMP_APEX / apexFor(1))`, derived rather than chosen, and it is the
 * number the live player, the simulator and this module's arc all share.
 */
export const AIR_JUMP_SCALE = Math.sqrt(AIR_JUMP_APEX / apexFor(1));

/**
 * The combined arc of a double-jump mount: a full jump, then -- at the first
 * arc's apex, where the ring passes -- a second, shorter impulse that resets
 * the rise.
 *
 * Piecewise by construction: phase one is the plain `jumpArc(1)`; phase two is
 * the same gravity with `AIR_JUMP_SCALE`-scaled initial velocity. One function
 * is the source of truth for the planner's airtime, the audit's reach and the
 * simulator's mid-flight impulse, so none of them can quietly disagree about
 * what a double jump is.
 */
export interface DoubleJumpArc extends Arc {
  /** Beats into the flight when the ring passes and the second press happens. */
  pressBeats: number;
}

export function doubleJumpArc(): DoubleJumpArc {
  const first = jumpArc(1);
  const pressBeats = first.airBeats / 2;
  const g = gravityPerBeat(1);
  const v2 = takeoffSpeed(1) * AIR_JUMP_SCALE;
  const air2 = (2 * v2) / g;
  const base = first.apex;

  const heightAt = (beats: number): number => {
    if (beats <= 0) return 0;
    if (beats < pressBeats) return first.heightAt(beats);
    const s = beats - pressBeats;
    if (s >= air2) return base;
    return base + v2 * s - 0.5 * g * s * s;
  };

  const beatsToRise = (rise: number): number | null => {
    // Only the second arc can be above the first one's apex; below it, the
    // descending crossing may also live in phase one.
    if (rise <= base) {
      const inFirst = first.beatsToRise(rise);
      const s = v2 >= 0 ? (v2 + Math.sqrt(Math.max(0, v2 * v2 - 2 * g * (rise - base)))) / g : 0;
      const inSecond = pressBeats + s;
      if (inFirst !== null && inSecond !== null) return Math.min(inFirst, inSecond);
      return inFirst ?? inSecond;
    }
    if (rise > base + AIR_JUMP_APEX) return null;
    const s = (v2 + Math.sqrt(v2 * v2 - 2 * g * (rise - base))) / g;
    return pressBeats + s;
  };

  return { apex: base + AIR_JUMP_APEX, airBeats: pressBeats + air2, heightAt, beatsToRise, pressBeats };
}

/**
 * Highest surface reachable by a jump at `strength`, as a rise above take-off.
 * A little under the apex: a landing exactly at the apex has a zero-width timing
 * window, so the planner is not allowed to aim there.
 */
export function maxRise(strength = 1, margin = 0.06): number {
  return Math.max(0, apexFor(strength) * (1 - margin));
}

/**
 * Beats from running off a ledge to landing `depth` below it, with no jump.
 * Falls are not jumps: the arc starts at zero velocity, so this is the pure
 * free-fall branch and is much shorter than a jump of the same drop.
 */
export function dropBeats(depth: number): number {
  return (JUMP_BEATS / 2) * Math.sqrt(Math.max(0, depth) / JUMP_HEIGHT);
}

/** Field units of track covered in `beats`. */
export function beatsToUnits(beats: number): number {
  return beats * UNITS_PER_BEAT;
}

/** Beats taken to travel `units` of track. */
export function unitsToBeats(units: number): number {
  return units / UNITS_PER_BEAT;
}

/**
 * How far a full-hold jump carries the player horizontally, in field units of
 * track.
 *
 * The player never moves horizontally -- the world moves past them -- so the
 * distance covered is simply airtime times track speed. This is why a *longer*
 * jump is also a *farther* jump, and why gap width and platform spacing are the
 * same measurement in different clothes.
 */
export function jumpDistance(strength = 1): number {
  return beatsToUnits(airBeatsFor(strength));
}

/**
 * Airtime a jump leaves unspent when it is asked to clear a hole.
 *
 * A gap the player clears with 0.00 beats to spare is technically passable and
 * practically not, so the widest hole a jump is credited with clearing is
 * `airBeats - this`. It is the single number the *planner* builds holes against
 * and the *audit* judges them by, so the two cannot drift into disagreeing about
 * what a clearable hole is.
 */
export const GAP_MARGIN_BEATS = 0.14;

/**
 * Widest gap a flight of `airBeats` clears, leaving `marginBeats` of the airtime
 * unspent so the landing is not a single-frame affair.
 *
 * Takes the airtime rather than a strength because not every flight is a
 * full-hold jump: a cut jump (`holdBeats`) is airborne for less than
 * `airBeatsFor(strength)`, and a hole built to the full-hold limit would be one
 * the actual flight does not carry. The player would take off, clear the near
 * edge, and drop into the far side of a hole the level said was jumpable.
 */
export function maxGapWidthForAirtime(airBeats: number, marginBeats = GAP_MARGIN_BEATS): number {
  return beatsToUnits(Math.max(0, airBeats - marginBeats));
}

/** Widest gap a full-hold jump at `strength` can clear. See `maxGapWidthForAirtime`. */
export function maxGapWidth(strength = 1, marginBeats = GAP_MARGIN_BEATS): number {
  return maxGapWidthForAirtime(airBeatsFor(strength), marginBeats);
}

/**
 * Narrowest landing the player can reliably hit: the body has to fit, plus
 * enough track that landing and re-taking-off are two distinct actions rather
 * than one held key.
 */
export function minLandingWidth(strength = 1): number {
  void strength;
  return Math.max(BODY_WIDTH * 2, beatsToUnits(0.4));
}

/**
 * Vertical clearance needed between a surface and anything overhead for a jump
 * at `strength` to be possible at all. A ceiling lower than this turns the jump
 * into a bonk -- a legitimate level feature, but one that has to be intended.
 */
export function minCeilingClearance(strength = 1): number {
  return apexFor(strength) + BODY_HEIGHT;
}

/** Gravity magnitude, in field units per second squared, at the current tempo. */
export function gravityFor(secondsPerBeat: number, strength = 1): number {
  const airSeconds = airBeatsFor(strength) * secondsPerBeat;
  return (8 * apexFor(strength)) / (airSeconds * airSeconds);
}

/** Take-off speed, in field units per second, at the current tempo. */
export function jumpVelocityFor(secondsPerBeat: number, strength = 1): number {
  const gravity = gravityFor(secondsPerBeat, strength);
  return (gravity * airBeatsFor(strength) * secondsPerBeat) / 2;
}

/**
 * Beats the player needs to clear a hazard of `hazardWidth` track units, given
 * the body has to pass it entirely. Used as the fairness floor for anything that
 * scrolls into view at track speed.
 */
export function reactionBeatsFor(hazardWidth: number): number {
  return unitsToBeats(hazardWidth + BODY_WIDTH);
}

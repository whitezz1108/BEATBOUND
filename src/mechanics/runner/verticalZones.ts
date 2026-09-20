/**
 * The five vertical zones of the RUNNER field (spec §9).
 *
 * A course is judged on the *screen*, so a zone is a band of the field, not a
 * height above whichever surface the player happens to be running on. That
 * distinction is the whole point of naming them:
 *
 *   - measured from the live surface, an inverted phrase would report the same
 *     numbers as a floor phrase at the same level, and the mode's single most
 *     distinctive idea -- that the ceiling is a *route* -- would be invisible to
 *     the validator. A course that spent half its time inverted would read as
 *     "half the time at BOTTOM", which is exactly backwards.
 *   - measured in the field, the ceiling route occupies the top band and the
 *     floor route the bottom one, and "does this course use the screen" becomes
 *     a question with one answer.
 *
 * The bands are equal fifths of the playable span between the two track lines,
 * so a zone means the same thing at any field size and there is no number here
 * to re-tune. `MAX_LEVEL` (0.27 of the 0.44 gap) puts a full floor-route ascent
 * at 61% of the way up -- squarely in HIGH -- and a full ceiling-route ascent
 * symmetrically in LOW. That symmetry is not an accident: the two routes are the
 * same field read from opposite ends, and the zones are what make that legible.
 */

import { CEILING_Y, GROUND_Y } from './runnerGeometry';
import { CEILING_Y_CONST, FLOOR_Y } from './trajectory';
import type { TrackSurface } from './surface';

/** The playable span, floor line minus ceiling line. */
export const PLAYABLE_SPAN = GROUND_Y - CEILING_Y;

export type VerticalZone = 'BOTTOM' | 'LOW' | 'MID' | 'HIGH' | 'CEILING';

/** Bottom to top. Screen order is the reverse; `describeZones` prints that way. */
export const VERTICAL_ZONES: readonly VerticalZone[] = ['BOTTOM', 'LOW', 'MID', 'HIGH', 'CEILING'];

/**
 * The zone a world y falls in.
 *
 * `y` outside the playable span is clamped rather than rejected: a player who
 * has fallen out of the world is still somewhere, and reporting them as BOTTOM
 * is more useful than a null the caller has to handle.
 */
export function zoneOfY(y: number): VerticalZone {
  // Measured down from the ceiling line, then flipped, because `VERTICAL_ZONES`
  // is ordered bottom-first for display: y grows *down* the screen, so index 0
  // of the field is the ceiling and index 0 of the list is the floor.
  const fromCeiling = (y - CEILING_Y) / PLAYABLE_SPAN;
  const fromTop = Math.floor(fromCeiling * VERTICAL_ZONES.length);
  const clamped = fromTop < 0 ? 0 : fromTop >= VERTICAL_ZONES.length ? VERTICAL_ZONES.length - 1 : fromTop;
  return VERTICAL_ZONES[VERTICAL_ZONES.length - 1 - clamped];
}

/** The zone the feet are in for a level above the given surface. */
export function zoneOfLevel(surface: TrackSurface, level: number): VerticalZone {
  const base = surface === 'FLOOR' ? FLOOR_Y : CEILING_Y_CONST;
  return zoneOfY(surface === 'FLOOR' ? base - level : base + level);
}

/** How far up the field, 0 at the ceiling line and 1 at the floor line. */
export function fieldFraction(y: number): number {
  return (y - CEILING_Y) / PLAYABLE_SPAN;
}

/**
 * Beats spent in each zone, and the ratios that make them comparable.
 *
 * A ratio rather than a count because the question the spec asks -- "does this
 * energetic section spend most of its duration at BOTTOM" -- is about proportion,
 * and a long course would otherwise always look like it used the screen more
 * than a short one.
 */
export interface ZoneUsage {
  beats: Record<VerticalZone, number>;
  ratios: Record<VerticalZone, number>;
  /** Fraction of the course at or below the LOW/MID boundary. */
  bottomHeavyRatio: number;
  /** How many of the five zones the course actually visited. */
  zonesUsed: number;
  /** The zone the course spent the most time in. */
  dominant: VerticalZone;
  /** Beats actually measured. Zero when nothing was sampled. */
  sampledBeats: number;
}

/** An empty usage record, so callers can accumulate into one. */
export function emptyZoneUsage(): ZoneUsage {
  const beats = {} as Record<VerticalZone, number>;
  const ratios = {} as Record<VerticalZone, number>;
  for (const zone of VERTICAL_ZONES) {
    beats[zone] = 0;
    ratios[zone] = 0;
  }
  return { beats, ratios, bottomHeavyRatio: 0, zonesUsed: 0, dominant: 'BOTTOM', sampledBeats: 0 };
}

/** Turn accumulated beats into ratios and the summary fields. */
export function summarizeZones(beats: Record<VerticalZone, number>): ZoneUsage {
  const total = VERTICAL_ZONES.reduce((sum, zone) => sum + (beats[zone] ?? 0), 0);
  const ratios = {} as Record<VerticalZone, number>;
  let dominant: VerticalZone = 'BOTTOM';
  for (const zone of VERTICAL_ZONES) {
    ratios[zone] = total > 0 ? (beats[zone] ?? 0) / total : 0;
    if (ratios[zone] > ratios[dominant]) dominant = zone;
  }
  // BOTTOM and LOW together are "the floor route", which is what a course that
  // never leaves the ground looks like. Counting BOTTOM alone would let a course
  // that hovers one slab up pass as varied.
  const bottomHeavy = ratios.BOTTOM + ratios.LOW;
  return {
    beats,
    ratios,
    bottomHeavyRatio: bottomHeavy,
    zonesUsed: VERTICAL_ZONES.filter((zone) => (beats[zone] ?? 0) > 0).length,
    dominant,
    sampledBeats: total,
  };
}

/** One-line summary for the course dumps and the check output. */
export function describeZones(usage: ZoneUsage): string {
  if (usage.sampledBeats <= 0) return 'not flown';
  const order = [...VERTICAL_ZONES].reverse();
  return order
    .map((zone) => `${zone.slice(0, 3)} ${(usage.ratios[zone] * 100).toFixed(0)}%`)
    .join(' · ');
}

/**
 * Beats fraction sitting in the two field-fifths nearest the given running
 * surface.
 *
 * This is the *flatness* side of the zone question, and it is deliberately
 * surface-relative while the zones themselves are absolute. The zones answer
 * "where in the field is this?" -- that reading must stay absolute or the
 * ceiling route disappears into BOTTOM. Flatness answers "did this phrase ever
 * leave its ground?" -- and the motion language is gravity-relative
 * (`GROUND_RUN` and `CEILING_RUN` are the same code path), so a phrase glued to
 * the ceiling is exactly as flat as one glued to the floor. A ceiling phrase
 * that only ever ceiling-runs reports 100% here; one whose hops reach into the
 * field reports the hops as far from its surface, which is what they are.
 */
export function surfaceSideRatio(
  beats: Record<VerticalZone, number>,
  surface: TrackSurface,
): number {
  const near: readonly VerticalZone[] = surface === 'FLOOR' ? ['BOTTOM', 'LOW'] : ['CEILING', 'HIGH'];
  const total = VERTICAL_ZONES.reduce((sum, zone) => sum + (beats[zone] ?? 0), 0);
  if (total <= 0) return 0;
  return near.reduce((sum, zone) => sum + (beats[zone] ?? 0), 0) / total;
}

/**
 * How much of an energetic phrase may sit in the two zones nearest its own
 * running surface before the course is using the screen badly (spec §9).
 *
 * A threshold rather than a rule, because the ground is where the mode has to
 * *start* and where a release belongs. What it catches is the failure the spec
 * names: a medium- or high-intensity section that never leaves the ground --
 * whichever surface that ground is.
 */
export const BOTTOM_HEAVY_LIMIT = 0.7;

/** Intensity at or above which a phrase is expected to use the field's height. */
export const ENERGETIC_INTENSITY = 0.45;

/**
 * Where a phrase's time is spent, sampled the way the audit and the debug view
 * both need it.
 *
 * Sampled per *segment* rather than on a beat grid: a hop chain is a run of
 * sub-beat segments, so any grid coarse enough to be cheap is coarse enough to
 * step straight over them and report the phrase as flat. A flight counts at its
 * *apex*, which is what "leaving the ground" means and what a frozen frame of
 * the phrase would show -- averaging take-off and landing heights would report
 * every symmetric hop as never having left the base line, which is exactly
 * backwards.
 *
 * The surface is the one the phrase played on: a phrase that flips is reported
 * by whichever surface its segments name, and callers that care about
 * single-surface semantics (the audit skips flipping phrases entirely) check
 * for the flip themselves.
 */
export function samplePhraseZones(phrase: {
  startBeat: number;
  beats: number;
  segments: ReadonlyArray<{
    startBeat: number;
    beats: number;
    surface: TrackSurface;
    airborne: boolean;
    apex?: number;
    startFeetY: number;
    endFeetY: number;
    runY: number;
  }>;
}): { beats: Record<VerticalZone, number>; surface: TrackSurface | null } {
  const beats = {} as Record<VerticalZone, number>;
  for (const zone of VERTICAL_ZONES) beats[zone] = 0;
  let surface: TrackSurface | null = null;
  for (const segment of phrase.segments) {
    const mid = segment.startBeat + segment.beats / 2;
    if (mid < phrase.startBeat || mid >= phrase.startBeat + phrase.beats) continue;
    const g = segment.surface === 'FLOOR' ? 1 : -1;
    const feet = segment.airborne && (segment.apex ?? 0) > 0
      ? segment.startFeetY - g * segment.apex!
      : segment.airborne ? Math.min(segment.startFeetY, segment.endFeetY) : segment.runY;
    beats[zoneOfY(feet)] += segment.beats;
    surface = segment.surface;
  }
  return { beats, surface };
}

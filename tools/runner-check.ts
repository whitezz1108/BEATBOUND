/**
 * RUNNER feasibility check: is every obstacle in every RUNNER pattern
 * physically clearable by a perfect player?
 *
 * The runner is the one mode where a pattern can be *impossible* rather than
 * merely hard, because two obstacles can demand contradictory states -- be
 * airborne here, be sliding on the ground 0.13 units later -- and no amount of
 * skill resolves that. This computes the windows analytically from the same
 * constants the mechanics use.
 *
 * Model
 * -----
 * The track scrolls at UNITS_PER_BEAT, so an obstacle's horizontal extent is a
 * window in beats:
 *
 *     dangerHalfBeats = (hazardHalfWidth + playerHalfWidth) / UNITS_PER_BEAT
 *
 * A jump taken at t0 is above height h for a contiguous window inside
 * [t0, t0 + jumpBeats]. A spike demands "above its height" across its window; a
 * low wall demands "sliding, on the ground" across its window; a gap demands
 * "airborne".
 *
 * The solver walks the obstacles in order keeping the earliest beat the player
 * can next be standing. Crucially one jump may clear several obstacles: it
 * greedily extends the group for as long as a single airborne window still
 * spans them all, which is how a half-beat "double spike" is meant to be read.
 * Within a group it takes off as early as still clears everything, because
 * landing soonest leaves the most room for whatever comes next. If the earliest
 * possible take-off is already too late, the pattern is impossible.
 *
 *   npm run runner-check
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { LevelLoader } from '../src/core/LevelLoader';
import { UNITS_PER_BEAT } from '../src/mechanics/runner/runnerGeometry';
import { SPIKE_BASE_HEIGHT, SPIKE_WIDTH } from '../src/mechanics/runner/SpikeMechanic';
import { WALL_WIDTH, WALL_CLEARANCE_SCALE } from '../src/mechanics/runner/LowWallMechanic';
import { GAP_BASE_WIDTH } from '../src/mechanics/runner/GapMechanic';
import { PLAYER_WIDTH, SLIDING_HEIGHT, STANDING_HEIGHT } from '../src/modes/runner/RunnerPlayer';
import { TUNING } from '../src/tuning';
import { DATA } from '../src/config';
import { clamp, lerp } from '../src/core/geometry';
import { readSurface, surfaceForGravity, type TrackSurface } from '../src/mechanics/runner/surface';

const LIBRARY_DIR = resolve(process.cwd(), 'beatbound_library_v1');
(globalThis as unknown as { fetch: unknown }).fetch = async (url: string) => ({
  ok: true, status: 200,
  json: async () => JSON.parse(readFileSync(resolve(LIBRARY_DIR, url.replace(/^\//, '')), 'utf8')),
});

/** RunnerMode probes with a circle of radius min(w,h)/2 at the body centre. */
const PROBE_RADIUS = Math.min(PLAYER_WIDTH, SLIDING_HEIGHT) / 2;
/**
 * Beats of slack below which a window stops being demanding and starts being
 * frame perfect. 0.10 beats is 50ms at 120 BPM -- about a rhythm game's "good"
 * window, and the floor this library is designed to stay above.
 */
const COMFORT_BEATS = 0.10;
const INTENSITIES = [0.2, 0.55, 0.9];

type Requirement = 'JUMP' | 'SLIDE' | 'AIRBORNE' | 'FREE';

interface Obstacle {
  mechanicId: string;
  beat: number;
  requirement: Requirement;
  /** Half-width of the danger window, in beats. */
  half: number;
  /** For JUMP: minimum height the body must reach. */
  clearHeight: number;
  /** Which running surface it belongs to. */
  surface: TrackSurface;
}

function numberOr(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** Mirror of each mechanic's constructor maths. */
function describe(mechanicId: string, params: Record<string, unknown>, intensity: number, beat: number): Obstacle | null {
  const halfOf = (hazardWidth: number) => (hazardWidth / 2 + PROBE_RADIUS) / UNITS_PER_BEAT;
  const surface = readSurface(params.surface);

  switch (mechanicId) {
    case 'R01': {
      const height = clamp(
        SPIKE_BASE_HEIGHT * numberOr(params.height, 1) * lerp(1, 1.3, intensity), 0.04, 0.16,
      );
      // Body centre must clear the spike tip by the probe radius.
      const clearHeight = height - (STANDING_HEIGHT / 2 - PROBE_RADIUS);
      return { mechanicId, beat, requirement: 'JUMP', half: halfOf(SPIKE_WIDTH), clearHeight: Math.max(0.001, clearHeight), surface };
    }
    case 'R03': {
      const clearance = clamp(
        numberOr(params.clearance, 0.5) * WALL_CLEARANCE_SCALE * lerp(1, 0.85, intensity), 0.062, 0.14,
      );
      // Sliding must physically fit; if it does not, no input clears the wall.
      const slidingTop = SLIDING_HEIGHT / 2 + PROBE_RADIUS;
      if (slidingTop > clearance) return { mechanicId, beat, requirement: 'SLIDE', half: halfOf(WALL_WIDTH), clearHeight: Infinity, surface };
      return { mechanicId, beat, requirement: 'SLIDE', half: halfOf(WALL_WIDTH), clearHeight: 0, surface };
    }
    case 'R02': {
      const width = clamp(GAP_BASE_WIDTH * numberOr(params.width, 1) * lerp(1, 1.25, intensity), 0.06, 0.22);
      return { mechanicId, beat, requirement: 'AIRBORNE', half: halfOf(width), clearHeight: 0.02, surface };
    }
    case 'R08':
    case 'R09':
      return { mechanicId, beat, requirement: 'FREE', half: 0, clearHeight: 0, surface };
    default:
      return null;
  }
}

/** Fraction of a jump spent above `height`, as [u0, u1] of the arc. */
function arcWindow(height: number): [number, number] | null {
  const H = TUNING.runner.jumpHeight;
  if (height >= H) return null;
  // h(u) = 4H u (1-u); solve for the crossings.
  const root = Math.sqrt(1 - height / H);
  return [(1 - root) / 2, (1 + root) / 2];
}

interface Finding {
  patternId: string;
  intensity: number;
  detail: string;
  slack: number;
}

function analyse(patternId: string, obstacles: Obstacle[], intensity: number): Finding[] {
  const J = TUNING.runner.jumpBeats;
  const findings: Finding[] = [];
  // Earliest beat the player can next be standing and free to act.
  let groundedFrom = -Infinity;

  for (let i = 0; i < obstacles.length; i++) {
    const o = obstacles[i];
    const windowStart = o.beat - o.half;
    const windowEnd = o.beat + o.half;

    if (o.requirement === 'FREE') continue;

    if (o.requirement === 'SLIDE') {
      if (!Number.isFinite(o.clearHeight)) {
        findings.push({ patternId, intensity, slack: -Infinity,
          detail: `${o.mechanicId} at beat ${o.beat.toFixed(2)}: clearance is lower than a sliding player -- unclearable at any timing` });
        continue;
      }
      const slack = windowStart - groundedFrom;
      if (slack < 0) {
        findings.push({ patternId, intensity, slack,
          detail: `${o.mechanicId} at beat ${o.beat.toFixed(2)} needs the player sliding from beat ${windowStart.toFixed(2)}, but they cannot land before ${groundedFrom.toFixed(2)} (short by ${(-slack).toFixed(2)} beats)` });
      } else if (slack < COMFORT_BEATS) {
        findings.push({ patternId, intensity, slack,
          detail: `${o.mechanicId} at beat ${o.beat.toFixed(2)}: only ${slack.toFixed(3)} beats between landing and the slide window` });
      }
      continue;
    }

    // JUMP / AIRBORNE. Extend the group while one jump still spans it all.
    let last = i;
    let coverStart = windowStart;
    let coverEnd = windowEnd;
    let threshold = o.clearHeight;
    let arc = arcWindow(threshold);
    if (!arc) {
      findings.push({ patternId, intensity, slack: -Infinity,
        detail: `${o.mechanicId} at beat ${o.beat.toFixed(2)}: needs ${o.clearHeight.toFixed(3)} clearance but the jump only reaches ${TUNING.runner.jumpHeight}` });
      continue;
    }

    for (let j = i + 1; j < obstacles.length; j++) {
      const next = obstacles[j];
      if (next.requirement !== 'JUMP' && next.requirement !== 'AIRBORNE') break;
      const tryThreshold = Math.max(threshold, next.clearHeight);
      const tryArc = arcWindow(tryThreshold);
      if (!tryArc) break;
      const tryEnd = next.beat + next.half;
      // Does one jump still cover from the first window's start to this one's end?
      if ((tryArc[1] - tryArc[0]) * J < tryEnd - coverStart) break;
      last = j;
      coverEnd = tryEnd;
      threshold = tryThreshold;
      arc = tryArc;
    }

    const [u0, u1] = arc;
    const clearWindow = (u1 - u0) * J;
    const t0Max = coverStart - u0 * J;
    const t0Min = coverEnd - u1 * J;
    const group = obstacles.slice(i, last + 1);
    const label = group.length > 1
      ? `${group.length} obstacles from beat ${group[0].beat.toFixed(2)} to ${group[group.length - 1].beat.toFixed(2)}`
      : `${o.mechanicId} at beat ${o.beat.toFixed(2)}`;

    if (t0Min > t0Max) {
      findings.push({ patternId, intensity, slack: t0Max - t0Min,
        detail: `${label}: spans ${(coverEnd - coverStart).toFixed(2)} beats but a jump is only clear for ${clearWindow.toFixed(2)} -- no single jump covers it, and they are too close to land between` });
      i = last;
      continue;
    }
    const t0 = Math.max(groundedFrom, t0Min);
    const slack = t0Max - t0;
    if (slack < 0) {
      findings.push({ patternId, intensity, slack,
        detail: `${label}: must take off by ${t0Max.toFixed(2)} but cannot be grounded before ${groundedFrom.toFixed(2)} (short by ${(-slack).toFixed(2)} beats)` });
    } else if (slack < COMFORT_BEATS) {
      findings.push({ patternId, intensity, slack,
        detail: `${label}: only a ${slack.toFixed(3)}-beat take-off window` });
    }
    groundedFrom = t0 + J;
    i = last;
  }
  return findings;
}

let loader: LevelLoader;

async function main(): Promise<void> {
  loader = new LevelLoader();
  await loader.loadLibraries(DATA.patterns, DATA.mechanics);
  const patterns = [...loader.patternLibrary.values()].filter((p) => p.mode === 'RUNNER');
  const beatsPerBar = 4;

  console.log('\nRUNNER feasibility -- can a perfect player clear every obstacle?\n');
  console.log(`jump ${TUNING.runner.jumpBeats} beats / ${TUNING.runner.jumpHeight} high · track ${UNITS_PER_BEAT} units per beat`);
  console.log(`spike window ${(((SPIKE_WIDTH / 2 + PROBE_RADIUS) * 2) / UNITS_PER_BEAT).toFixed(2)} beats · wall window ${(((WALL_WIDTH / 2 + PROBE_RADIUS) * 2) / UNITS_PER_BEAT).toFixed(2)} beats\n`);

  let impossible = 0;
  let tight = 0;

  for (const pattern of patterns) {
    // Two repeats back to back, so the seam between loops is checked too.
    const obstacles: Array<{ beat: number; mechanicId: string; params: Record<string, unknown> }> = [];
    for (let repeat = 0; repeat < 2; repeat++) {
      const base = repeat * pattern.lengthBars * beatsPerBar;
      for (const e of pattern.events) {
        obstacles.push({
          beat: base + (e.at.bar - 1) * beatsPerBar + (e.at.beat - 1) + (e.at.offsetBeats ?? 0),
          mechanicId: e.mechanicId,
          params: (e.params ?? {}) as Record<string, unknown>,
        });
      }
    }
    obstacles.sort((a, b) => a.beat - b.beat);

    // Gravity zones decide which surface is live; an obstacle on the other one
    // is scenery and must not be counted against the player.
    const gravitySpans: Array<[number, number]> = [];
    const flipDefinition = loader.mechanics.mechanics.find((m) => m.id === 'R09');
    const flipDuration = flipDefinition?.timing.durationBeats ?? 4;
    for (const o of obstacles) {
      if (o.mechanicId === 'R09') gravitySpans.push([o.beat, o.beat + flipDuration]);
    }
    const surfaceAt = (beat: number): TrackSurface => surfaceForGravity(
      gravitySpans.some(([a, b]) => beat >= a && beat < b) ? -1 : 1,
    );

    const rows: string[] = [];
    for (const intensity of INTENSITIES) {
      const described = obstacles
        .map((o) => describe(o.mechanicId, o.params, intensity, o.beat))
        .filter((o): o is Obstacle => o !== null)
        .filter((o) => o.requirement === 'FREE' || o.surface === surfaceAt(o.beat));
      for (const f of analyse(pattern.id, described, intensity)) {
        const fatal = f.slack < 0;
        if (fatal) impossible += 1; else tight += 1;
        rows.push(`    ${fatal ? 'IMPOSSIBLE' : 'tight     '} @intensity ${intensity.toFixed(2)}  ${f.detail}`);
      }
    }
    const verdict = rows.length === 0 ? 'ok' : `${rows.length} issue(s)`;
    console.log(`  ${pattern.id.padEnd(6)}${pattern.name.padEnd(22)}${verdict}`);
    for (const row of rows) console.log(row);
  }

  console.log(
    impossible === 0
      ? `\nEvery RUNNER pattern is clearable${tight > 0 ? ` (${tight} tight window(s) -- playable but demanding)` : ''}.\n`
      : `\n${impossible} impossible obstacle(s) across the RUNNER library.\n`,
  );
  process.exit(impossible === 0 ? 0 : 1);
}

void main();

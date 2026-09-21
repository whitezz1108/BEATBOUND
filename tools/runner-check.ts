/**
 * RUNNER feasibility check.
 *
 * Two questions, one tool (spec §29/§30 -- extend, do not duplicate):
 *
 *   1. **Patterns.** Is every obstacle in every RUNNER *pattern* physically
 *      clearable by a perfect player? The runner is the one mode where a
 *      pattern can be *impossible* rather than merely hard, because two
 *      obstacles can demand contradictory states -- be airborne here, be sliding
 *      on the ground 0.13 units later -- and no amount of skill resolves that.
 *      This computes the windows analytically from the same constants the
 *      mechanics use.
 *
 *   2. **Courses.** Is every authored RUNNER *course* both flyable and
 *      well-shaped? A course is planned as a trajectory, so it can be checked
 *      the way it was built: fly it with the real physics
 *      (`traversalSim.ts`) and audit its structure (`courseAudit.ts`). Both
 *      read `runnerPhysics.ts`, so neither can disagree with the planner about
 *      what a jump is.
 *
 * The two halves answer genuinely different questions. A pattern is a fixed
 * arrangement of hazards with no notion of a route; a course *is* a route, and
 * the interesting failure is not "can this be dodged" but "does the route the
 * designer intended actually exist in the geometry".
 *
 * ## Pattern model
 *
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
import { LevelLoader, type CompiledLevel, type CompiledSection } from '../src/core/LevelLoader';
import { MechanicRegistry } from '../src/core/MechanicRegistry';
import { registerRunnerMechanics } from '../src/mechanics/runner/index';
import {
  PLAYER_X,
  SCREEN_CROSSING_BEATS,
  SCROLL_LEAD_BEATS,
  UNITS_PER_BEAT,
  trackX,
} from '../src/mechanics/runner/runnerGeometry';
import { SPIKE_BASE_HEIGHT, SPIKE_INTENSITY_SCALE, SPIKE_WIDTH } from '../src/mechanics/runner/SpikeMechanic';
import { WALL_WIDTH, WALL_CLEARANCE_SCALE } from '../src/mechanics/runner/LowWallMechanic';
import { GAP_BASE_WIDTH, GAP_MAX_WIDTH } from '../src/mechanics/runner/GapMechanic';
import {
  FACE_DEPTH as PLATFORM_FACE_DEPTH,
  MAX_HEIGHT as PLATFORM_MAX_HEIGHT,
  PLATFORM_BASE_WIDTH,
} from '../src/mechanics/runner/PlatformMechanic';
import { PLAYER_WIDTH, SLIDING_HEIGHT, STANDING_HEIGHT } from '../src/modes/runner/RunnerPlayer';
import { auditCourse } from '../src/mechanics/runner/courseAudit';
import { buildCourseWorld } from '../src/mechanics/runner/courseWorld';
import { composeCourse, planCourse } from '../src/mechanics/runner/runnerPlanner';
import { courseWorldFor } from '../src/mechanics/runner/courseSchedule';
import { simulateCourse } from '../src/mechanics/runner/traversalSim';
import { describeZones } from '../src/mechanics/runner/verticalZones';
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
      // The scale factor here must be the one `SpikeMechanic` actually uses.
      // It was 1.3 against the mechanic's 1.15, so the checker was modelling a
      // taller spike than the game builds and reporting windows that were
      // narrower than the player will ever meet. A checker that disagrees with
      // the thing it checks is worse than no checker.
      const height = clamp(
        SPIKE_BASE_HEIGHT * numberOr(params.height, 1) * lerp(1, SPIKE_INTENSITY_SCALE, intensity), 0.04, 0.16,
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
      const width = clamp(GAP_BASE_WIDTH * numberOr(params.width, 1) * lerp(1, 1.25, intensity), 0.06, GAP_MAX_WIDTH);
      return { mechanicId, beat, requirement: 'AIRBORNE', half: halfOf(width), clearHeight: 0.02, surface };
    }
    case 'R04': {
      // Only the front face damages: jump over it and the block becomes terrain.
      // A platform at or below the step-up height is walked onto, so it is not
      // an obstacle at all -- the runner resolves it as a step.
      const height = clamp(numberOr(params.height, 0.12), 0.02, PLATFORM_MAX_HEIGHT);
      if (height <= TUNING.runner.stepUpHeight) return null;
      const clearHeight = height - (STANDING_HEIGHT / 2 - PROBE_RADIUS);
      // The face sits on the LEADING edge, so it reaches the player half a
      // block later than the obstacle's own beat. A spike is centred on its
      // beat; a platform is not, and pretending otherwise would misplace it.
      const width = clamp(numberOr(params.width, 1), 0.5, 2.5) * PLATFORM_BASE_WIDTH;
      const faceBeat = beat + (width / 2 - PLATFORM_FACE_DEPTH / 2) / UNITS_PER_BEAT;
      return { mechanicId, beat: faceBeat, requirement: 'JUMP', half: halfOf(PLATFORM_FACE_DEPTH), clearHeight: Math.max(0.001, clearHeight), surface };
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

/**
 * Every level in the library, for the course half of the report.
 *
 * The index is read rather than a list being hardcoded here, so a new level is
 * checked the moment it is added -- which is the only way a check stays run.
 */
function levelFiles(): string[] {
  const index = JSON.parse(readFileSync(resolve(LIBRARY_DIR, 'levels.index.json'), 'utf8')) as {
    levels: Array<{ file: string }>;
  };
  return index.levels.map((entry) => entry.file);
}

/** Fly and audit every course in a level. Returns the issue count. */
async function checkCourses(files: string[]): Promise<{ fatal: number; warnings: number; levels: CompiledLevel[] }> {
  let fatal = 0;
  let warnings = 0;
  let courses = 0;
  const rows: string[] = [];
  const levels: CompiledLevel[] = [];

  for (const file of files) {
    let level: CompiledLevel;
    try {
      level = await loader.load({
        levelUrl: `/${file}`,
        patternsUrl: DATA.patterns,
        mechanicsUrl: DATA.mechanics,
      });
    } catch (error) {
      rows.push(`  ${file.padEnd(46)}LOAD FAILED: ${(error as Error).message.split('\n')[0]}`);
      fatal += 1;
      continue;
    }
    levels.push(level);
    for (const section of level.sections) {
      if (!section.course) continue;
      courses += 1;
      const { trajectory } = section.course;
      const world = courseWorldFor(section.course);
      const bpm = level.song.bpm;

      const flight = simulateCourse(world, trajectory, { bpm });
      const audit = auditCourse(world, trajectory);
      const metrics = flight.metrics;

      const problems = [
        ...flight.issues.map((i) => `FLIGHT ${i.kind} @${i.beat.toFixed(2)} ${i.detail}`),
        ...audit.issues.map((i) => `SHAPE  ${i.kind} @${i.beat.toFixed(2)} ${i.detail}`),
      ];
      fatal += flight.issues.length + audit.issues.length;

      const verdict = problems.length === 0 ? 'ok' : `${problems.length} issue(s)`;
      // Padded to a width the longest library name fits in, with a gap: a name
      // longer than the constant used to push the verdict into the label with no
      // space at all ("... / R-Tok"), which reads as part of the section id.
      rows.push(`  ${`${file} / ${section.id}`.padEnd(52)}${verdict}`);
      for (const problem of problems) rows.push(`      ${problem}`);
      rows.push(
        `      metrics: ${metrics.jumps} jumps (${metrics.jumpsPerBar.toFixed(2)}/bar) · `
        + `${metrics.airborneRatio.toFixed(2)} airborne · v-range ${metrics.verticalRange.toFixed(3)} · `
        + `${metrics.gravityStateChanges} flip(s) · max flat ${metrics.maxFlatRunBeats.toFixed(1)} beats · `
        + `${metrics.phrases} phrase(s) · motif repeat ${(metrics.motifRepeatRate * 100).toFixed(0)}% · `
        + `hazards/bar ${metrics.hazardDensity.toFixed(2)} · structure/bar ${metrics.structuralDensity.toFixed(2)}`,
      );
      if (metrics.maxEmptyScreenBeats > 0) {
        warnings += 1;
        rows.push(`      NOTE   longest empty stretch ${metrics.maxEmptyScreenBeats.toFixed(2)} beats`);
      }
      rows.push(
        `      zones: ${describeZones(metrics.zones)}  (dominant ${metrics.zones.dominant}, `
        + `${metrics.zones.zonesUsed}/5 used, bottom-heavy ${(metrics.zones.bottomHeavyRatio * 100).toFixed(0)}%)`,
      );
    }
  }

  console.log(`\nRUNNER courses -- can the intended route actually be flown?\n`);
  if (courses === 0) {
    console.log('  (no section in the library declares a course)\n');
    return { fatal, warnings, levels };
  }
  for (const row of rows) console.log(row);
  console.log(
    fatal === 0
      ? `\n${courses} course(s) fly as planned.\n`
      : `\n${fatal} problem(s) across ${courses} course(s).\n`,
  );
  return { fatal, warnings, levels };
}

/**
 * Entry lead-in (spec §3): when RUNNER becomes live, has its first obstacle
 * already had its run-up?
 *
 * This is the failure a feasibility check structurally cannot see. Every
 * obstacle in a section can be individually clearable and the section can still
 * open with a spike already on the player, because the question is not "can
 * this be dodged" but "was the player given beats in which to read it". A mode
 * going live and an obstacle being *created* are two separate events, and the
 * distance between them is what this measures.
 *
 * Three assertions, in the order they can fail:
 *
 *   1. the mode is live before the first obstacle exists at all. Otherwise
 *      `ModeManager` parks the spawn in its pending map and delivers it on
 *      activation -- so the obstacle appears at the player rather than
 *      travelling to them. This is the bug this check exists to catch.
 *   2. the obstacle is on screen for its *whole* approach, not part of it, so
 *      it is legible as a thing that arrived rather than a thing that was
 *      always there.
 *   3. the resulting window clears the library's comfort reaction floor.
 *
 * The lead-in the loader derives must agree with the lead the runtime registry
 * gives the same mechanic; a section whose data says four beats while the
 * implementation asks for four from a different source can drift apart without
 * anything else noticing, so the drift is checked directly.
 */
interface EntryFinding {
  file: string;
  sectionId: string;
  detail: string;
  fatal: boolean;
}

/**
 * The first beat in a section that asks the player to do something, and how
 * much lead its mechanic needs to exist beforehand.
 *
 * Everything counts, including pads and gravity portals: those are `FREE` in
 * the feasibility model because they demand no input, but a flip portal is the
 * single most readability-critical thing in the mode, so "free" must not be
 * mistaken for "does not need to be seen".
 */
function firstDemand(
  section: CompiledSection,
  beatsPerBar: number,
  registry: MechanicRegistry,
): { beat: number; label: string; spawnLead: number } | null {
  if (section.course) {
    // A course is built as one world, created `leadInBeats` before its first
    // beat. The content that has to be readable is therefore its terrain, and
    // its first beat is where the reading starts.
    return {
      beat: section.course.startBeat,
      label: 'course terrain',
      spawnLead: section.course.leadInBeats,
    };
  }

  let best: { beat: number; label: string; spawnLead: number } | null = null;
  for (const placement of section.placements) {
    for (const event of placement.pattern.events) {
      const beat = (placement.startBar - 1 + event.at.bar - 1) * beatsPerBar
        + (event.at.beat - 1) + (event.at.offsetBeats ?? 0);
      if (best !== null && beat >= best.beat) continue;
      best = { beat, label: event.mechanicId, spawnLead: registry.spawnLeadBeats(event.mechanicId) };
    }
  }
  return best;
}

function checkEntry(
  files: string[],
  levels: CompiledLevel[],
  registry: MechanicRegistry,
): { fatal: number; warnings: number } {
  let fatal = 0;
  let warnings = 0;
  let entries = 0;
  const rows: string[] = [];

  for (let i = 0; i < levels.length; i++) {
    const level = levels[i];
    const file = files[i] ?? level.definition.id;
    const beatsPerBar = level.tempo.beatsPerBar;
    const bpm = level.song.bpm;

    for (let s = 0; s < level.sections.length; s++) {
      const section = level.sections[s];
      if (section.mode !== 'RUNNER') continue;
      // A RUNNER section that follows another RUNNER section is not an entry:
      // the mode is already live and already has terrain on screen. Only the
      // swap *into* the mode has to pay for a run-up.
      const previous = level.sections[s - 1];
      if (previous && previous.mode === 'RUNNER') continue;

      const demand = firstDemand(section, beatsPerBar, registry);
      if (demand === null) continue;
      entries += 1;

      const startBeat = (section.startBar - 1) * beatsPerBar;
      const modeLiveBeat = startBeat - section.leadInBeats;
      const spawnBeat = demand.beat - demand.spawnLead;
      const visibleBeats = demand.beat - modeLiveBeat;
      const reactionSeconds = (visibleBeats * 60) / bpm;
      const label = `${file} / ${section.id}`;
      const findings: EntryFinding[] = [];

      if (modeLiveBeat > spawnBeat + 1e-6) {
        findings.push({
          file, sectionId: section.id, fatal: true,
          detail: `${demand.label} at beat ${demand.beat.toFixed(2)} is created at ${spawnBeat.toFixed(2)}, `
            + `but RUNNER does not go live until ${modeLiveBeat.toFixed(2)} -- it is delivered on activation, `
            + `already at x=${trackX(demand.beat, modeLiveBeat).toFixed(3)} (player at ${PLAYER_X})`,
        });
      }
      if (visibleBeats < SCREEN_CROSSING_BEATS - 1e-6) {
        findings.push({
          file, sectionId: section.id, fatal: true,
          detail: `${demand.label} at beat ${demand.beat.toFixed(2)} has ${visibleBeats.toFixed(2)} beats of approach `
            + `from the mode going live; a full crossing is ${SCREEN_CROSSING_BEATS.toFixed(2)}`,
        });
      }
      if (reactionSeconds < TUNING.fairness.comfortReactionSeconds) {
        findings.push({
          file, sectionId: section.id, fatal: false,
          detail: `${demand.label} gives ${reactionSeconds.toFixed(2)}s of warning at ${bpm} BPM `
            + `(comfort floor ${TUNING.fairness.comfortReactionSeconds}s)`,
        });
      }

      for (const f of findings) {
        if (f.fatal) fatal += 1; else warnings += 1;
        rows.push(`  ${f.fatal ? 'UNREADABLE' : 'note      '} ${label}`);
        rows.push(`      ${f.detail}`);
      }
      if (findings.length === 0) {
        rows.push(
          `  ok         ${label.padEnd(52)}`
          + `${demand.label} @${demand.beat.toFixed(2)} · live ${section.leadInBeats.toFixed(1)} beats early · `
          + `${visibleBeats.toFixed(2)} beats / ${reactionSeconds.toFixed(2)}s of approach`,
        );
      }
    }
  }

  console.log(`\nRUNNER entry -- does the mode get a run-up when it becomes live? (spec §3)\n`);
  console.log(
    `screen crossing ${SCREEN_CROSSING_BEATS.toFixed(2)} beats · scroll lead ${SCROLL_LEAD_BEATS} beats\n`,
  );
  if (entries === 0) {
    console.log('  (no level in the library enters RUNNER from another mode)\n');
    return { fatal, warnings };
  }
  for (const row of rows) console.log(row);
  console.log(
    fatal === 0
      ? `\n${entries} RUNNER entry(ies) give the player a full approach.\n`
      : `\n${fatal} unreadable RUNNER entry(ies).\n`,
  );
  return { fatal, warnings };
}

/**
 * The data and the runtime must agree on how much lead a scrolled mechanic
 * needs, because they are read by different code at different times:
 * `PatternScheduler` asks the registry (runtime), while `LevelLoader` derives a
 * section's lead-in from the library (data). If only one of them says four, the
 * mode goes live too late or the obstacle is created too early, and the entry
 * check above reports a symptom rather than the cause.
 */
function checkScrollLead(registry: MechanicRegistry): { fatal: number } {
  const rows: string[] = [];
  let fatal = 0;

  if (SCROLL_LEAD_BEATS < SCREEN_CROSSING_BEATS) {
    fatal += 1;
    rows.push(
      `  SCROLL LEAD ${SCROLL_LEAD_BEATS} beats is shorter than the ${SCREEN_CROSSING_BEATS.toFixed(2)}-beat crossing: `
      + 'a scrolled mechanic would be created part-way across the screen',
    );
  }

  const runnerPatterns = [...loader.patternLibrary.values()].filter((p) => p.mode === 'RUNNER');
  const ids = new Set<string>();
  for (const pattern of runnerPatterns) for (const e of pattern.events) ids.add(e.mechanicId);

  for (const id of [...ids].sort()) {
    const library = loader.mechanics.mechanics.find((m) => m.id === id);
    const effective = registry.spawnLeadBeats(id);
    const declared = library?.timing.spawnLeadBeats ?? 0;
    const telegraph = library?.timing.telegraphBeats ?? 0;
    const ok = effective >= SCROLL_LEAD_BEATS;
    if (!ok) fatal += 1;
    rows.push(
      `  ${ok ? 'ok  ' : 'FAIL'} ${id.padEnd(5)} telegraph ${telegraph} · library spawn lead ${declared} `
      + `· effective ${effective}`,
    );
  }

  console.log(`\nRUNNER scroll lead -- do the data and the runtime agree? (spec §3)\n`);
  for (const row of rows) console.log(row);
  console.log(
    fatal === 0
      ? `\nEvery scrolled RUNNER mechanic declares the ${SCROLL_LEAD_BEATS}-beat lead its implementation asks for.\n`
      : `\n${fatal} scroll-lead disagreement(s).\n`,
  );
  return { fatal };
}

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

  const courses = await checkCourses(levelFiles());
  // The registry is built exactly as the game builds it, so `checkEntry` and
  // `checkScrollLead` see the lead the running game would use rather than a
  // second copy of the number that happens to live in this tool.
  const registry = new MechanicRegistry();
  // Library first: `register` warns when it cannot find the definition it is
  // registering, and an empty map here would print six warnings that say
  // nothing about the check.
  registry.loadLibrary(loader.mechanics);
  registerRunnerMechanics(registry);
  const scrollLead = checkScrollLead(registry);
  const entry = checkEntry(levelFiles(), courses.levels, registry);
  const procedural = checkProcedural();
  process.exit(
    impossible === 0 && courses.fatal === 0 && entry.fatal === 0
      && scrollLead.fatal === 0 && procedural.fatal === 0 ? 0 : 1,
  );
}

/**
 * Seeded composition, validated at multiple tempos (spec §52, §67).
 *
 * The authored library proves the planner on handcrafted courses; this block
 * proves the *composer* on generated ones. Every course here goes through the
 * same `planCourse` -> world -> flight-sim -> audit pipeline the library
 * levels use -- there is no second, looser path for procedural content. The
 * tempos are representative slow / medium / high values; the physics is
 * beat-based, so what this proves is that nothing downstream of the beat
 * (scheduling, telegraph beats, scroll speed assumptions) silently assumes
 * one tempo.
 *
 * §67 also asks that seeds differ *meaningfully* while staying valid, so the
 * archetype sequences are compared across seeds and every course is held to
 * the same flight/audit bar. Determinism is checked by composing twice.
 */
function checkProcedural(): { fatal: number } {
  const bpms = [90, 120, 150];
  const seeds = [1, 7, 13];
  const beats = 64;
  let fatal = 0;
  let courses = 0;
  const rows: string[] = [];
  const archetypeSequences = new Map<number, string>();

  for (const bpm of bpms) {
    for (const seed of seeds) {
      courses += 1;
      const problems: string[] = [];
      const spec = composeCourse({ beats, seed, intensity: 0.6 });
      // §46: same seed, same course. A composer that drifted would make every
      // other claim here unreproducible.
      const again = composeCourse({ beats, seed, intensity: 0.6 });
      if (JSON.stringify(spec) !== JSON.stringify(again)) {
        problems.push('DETERMINISM composing twice with one seed produced different phrase lists');
      }
      archetypeSequences.set(seed, spec.phrases.map((p) => p.archetype).join(','));

      const trajectory = planCourse(spec, { startBeat: 0 });
      const world = buildCourseWorld(trajectory);
      const flight = simulateCourse(world, trajectory, { bpm });
      const audit = auditCourse(world, trajectory);
      problems.push(
        ...flight.issues.map((i) => `FLIGHT ${i.kind} @${i.beat.toFixed(2)} ${i.detail}`),
        ...audit.issues.map((i) => `SHAPE  ${i.kind} @${i.beat.toFixed(2)} ${i.detail}`),
      );

      // The contiguity invariant, checked directly: the sim proves the course
      // is *flyable*, this proves the trajectory is still the connected path
      // everything downstream trusts.
      for (const phrase of trajectory.phrases) {
        for (let i = 0; i + 1 < phrase.segments.length; i++) {
          const a = phrase.segments[i];
          const b = phrase.segments[i + 1];
          const flip = a.flipAt !== undefined || b.flipAt !== undefined;
          const beatOk = Math.abs(a.startBeat + a.beats - b.startBeat) < 1e-6;
          const yOk = flip || Math.abs(a.endFeetY - b.startFeetY) < 1e-6;
          if (!beatOk || !yOk) {
            problems.push(`CONTIGUITY @${b.startBeat.toFixed(2)} ${a.verb}->${b.verb}`);
            break;
          }
        }
      }

      const m = flight.metrics;
      fatal += problems.length;
      const verdict = problems.length === 0 ? 'ok' : `${problems.length} issue(s)`;
      rows.push(
        `  ${`${bpm} BPM`.padEnd(8)}seed ${String(seed).padEnd(3)}${verdict}`
        + `   ${m.jumps} jumps · ${(m.airborneRatio * 100).toFixed(0)}% airborne · `
        + `${m.gravityStateChanges} flip(s) · ${m.zones.zonesUsed}/5 zones · `
        + `bottom-heavy ${(m.zones.bottomHeavyRatio * 100).toFixed(0)}% · `
        + `${m.phrases} phrase(s), motif repeat ${(m.motifRepeatRate * 100).toFixed(0)}%`,
      );
      for (const problem of problems) rows.push(`        ${problem}`);
    }
  }

  // §67: no seed may be a rerun of another. One shared archetype sequence
  // across seeds would mean the composer's randomness selects nothing.
  const distinct = new Set(archetypeSequences.values()).size;
  console.log(`\nRUNNER procedural -- seeded composition at three tempos (spec §52, §67)\n`);
  for (const row of rows) console.log(row);
  if (distinct < archetypeSequences.size) {
    fatal += 1;
    console.log(`  SEED VARIETY ${archetypeSequences.size} seeds produced ${distinct} distinct archetype sequence(s)`);
  }
  console.log(
    distinct === archetypeSequences.size && fatal === 0
      ? `\nEvery seeded course flies as planned, and the seeds compose differently.\n`
      : `\n${fatal} procedural problem(s) across ${courses} seeded course(s).\n`,
  );
  return { fatal };
}

void main();

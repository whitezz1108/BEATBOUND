/**
 * Turning a compiled RUNNER course into a scheduled spawn.
 *
 * A course is not a pattern event -- it has no library entry and no beat of its
 * own -- but it *is* a mechanic, and it should reach the mode by exactly the
 * same road every other mechanic does: created by `MechanicRegistry`, handed to
 * `ModeManager.route`, accepted by the live mode. That is what keeps
 * `RunnerMode` free of any knowledge that courses exist.
 *
 * So this module is the bridge, and it is deliberately tiny: it takes the
 * trajectory the level loader already planned, wraps it in a spawn context the
 * registry assembles, and schedules the spawn for one bar before the section
 * starts -- the same spatial lead every RUNNER obstacle gets, so the first slab
 * is already scrolling in when the section begins.
 */

import type { BeatClock } from '../../core/BeatClock';
import type { MechanicRegistry } from '../../core/MechanicRegistry';
import type { SpawnedMechanicInfo, MechanicSink } from '../../core/PatternScheduler';
import type { CompiledCourse, CompiledSection } from '../../core/LevelLoader';
import type { MechanicDefinition } from '../../core/types';
import { RunnerCourseMechanic } from './RunnerCourseMechanic';
import { buildCourseWorld, type CourseWorld } from './courseWorld';

/** Synthetic mechanic id every course reports. Never appears in JSON. */
export const COURSE_MECHANIC_ID = 'R-COURSE';

/**
 * The world a section's course describes.
 *
 * Exposed so the offline tools can ask the same questions the live mode asks
 * without constructing a mechanic, a clock or a renderer: a course's terrain is
 * a pure function of a beat, so validating it needs no runtime at all.
 */
export function courseWorldFor(course: CompiledCourse): CourseWorld {
  return buildCourseWorld(course.trajectory, course.startBeat - course.leadInBeats);
}

/**
 * Schedule one section's course.
 *
 * Returns the beat the spawn was scheduled for, or null when the section has no
 * course. The spawn beat is the mode's activation beat, so the course exists
 * from the first frame the mode is live.
 */
export function scheduleCourse(
  clock: BeatClock,
  registry: MechanicRegistry,
  section: CompiledSection,
  sink: MechanicSink,
): number | null {
  const course = section.course;
  if (!course) return null;

  const spawnBeat = course.startBeat - course.leadInBeats;
  clock.scheduleAtBeat(
    spawnBeat,
    () => {
      const mechanic = buildCourseMechanic(registry, clock, section, course);
      const definition = definitionFor(section, course);
      const info: SpawnedMechanicInfo = {
        mechanic,
        definition,
        mode: 'RUNNER',
        sectionId: section.id,
        patternId: COURSE_MECHANIC_ID,
        activationBeat: course.startBeat,
        role: 'SYSTEM',
        event: { at: { bar: section.startBar, beat: 1 }, mechanicId: COURSE_MECHANIC_ID },
      };
      sink(info);
    },
    `course:${section.id}`,
  );
  return spawnBeat;
}

function buildCourseMechanic(
  registry: MechanicRegistry,
  clock: BeatClock,
  section: CompiledSection,
  course: CompiledCourse,
): RunnerCourseMechanic {
  const context = registry.syntheticContext(COURSE_MECHANIC_ID, clock, {
    activationBeat: course.startBeat,
    mode: 'RUNNER',
    name: `Course ${section.id}`,
    intensity: section.definition.difficulty !== undefined ? (section.definition.difficulty - 1) / 4 : 0.5,
    difficulty: section.definition.difficulty ?? 2,
    durationBeats: course.trajectory.endBeat - course.trajectory.startBeat,
    // A stable seed per section, so a course that ever does use randomness
    // replays identically.
    seed: hashString(section.id),
  });
  return new RunnerCourseMechanic(context, course.trajectory);
}

/** The definition the mode and HUD see. A course is RUNNER, and it is terrain. */
function definitionFor(section: CompiledSection, course: CompiledCourse): MechanicDefinition {
  return {
    id: COURSE_MECHANIC_ID,
    name: `Course ${section.id}`,
    mode: 'RUNNER',
    status: 'MVP',
    difficulty: section.definition.difficulty ?? 2,
    timing: {
      durationBeats: course.trajectory.endBeat - course.trajectory.startBeat,
      telegraphBeats: 0,
    },
    defaults: {},
    notes: `${course.spec.phrases.length} phrase(s)`,
  };
}

/** FNV-1a, so a section id maps to a stable seed without a clock. */
function hashString(value: string): number {
  let h = 2166136261;
  for (let i = 0; i < value.length; i++) {
    h ^= value.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

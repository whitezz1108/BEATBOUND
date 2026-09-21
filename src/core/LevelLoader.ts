/**
 * Phase 4 -- LevelLoader.
 *
 * Fetches and validates the three JSON layers, then *compiles* them into an
 * absolute-bar timeline:
 *
 *   Song -> Sections -> Mode -> Patterns -> Mechanics
 *
 * Compilation is where "pattern AP01, repeat 2, starting in section S01" becomes
 * "AP01 occupies bars 1-2 and bars 3-4". Nothing about the prototype level is
 * hard-coded here; every level is laid out by the same rules.
 */

import { ConstantTempoMap, type TempoMap } from './TempoMap';
import { beatsForSeconds, TUNING } from '../tuning';
import type {
  CourseSpec,
  GameMode,
  LevelDefinition,
  MechanicLibrary,
  PatternDefinition,
  PatternLibrary,
  SectionDefinition,
  SongDefinition,
} from './types';
import { GAME_MODES } from './types';
import { composeCourse, planCourse } from '../mechanics/runner/runnerPlanner';
import { isArchetype, isMotionVerb } from '../mechanics/runner/motion';
import { SCROLL_LEAD_BEATS } from '../mechanics/runner/runnerGeometry';
import type { Trajectory } from '../mechanics/runner/trajectory';

/** One laid-out repetition of one pattern, at an absolute bar. */
export interface CompiledPlacement {
  sectionId: string;
  pattern: PatternDefinition;
  /** Absolute, 1-based bar where this repetition begins. */
  startBar: number;
  repeatIndex: number;
  intensity: number;
}

export interface CompiledSection {
  definition: SectionDefinition;
  id: string;
  mode: GameMode;
  /** Absolute, 1-based. */
  startBar: number;
  /** Absolute, 1-based, exclusive. */
  endBar: number;
  placements: CompiledPlacement[];
  /**
   * A RUNNER course, already planned into a trajectory.
   *
   * Planning happens here rather than at spawn time so a course that cannot be
   * built is a *load* error the author sees immediately, not a silent gap in the
   * middle of a run. When present, `placements` is empty and the section's
   * hazards come from the course instead.
   */
  course: CompiledCourse | null;
  /**
   * How many beats before the section starts its mode must already be live, so
   * a first-beat mechanic can show its telegraph. Derived from the mechanics
   * the section actually uses.
   */
  leadInBeats: number;
  transitionOut: string | null;
  /** Mode the song moves to next, or null at the end. */
  nextMode: GameMode | null;
  /**
   * Absolute beat from which this section stops spawning, because a mode change
   * is coming. Null when the next section is the same mode.
   *
   * A mode change is a context switch for the player -- different controls,
   * different camera, different read. Dropping them into it mid-barrage is the
   * one place the game can be unfair without any single hazard being unfair.
   */
  breatherFromBeat: number | null;
}

/** A course spec, planned. The trajectory is the artifact everything reads. */
export interface CompiledCourse {
  spec: CourseSpec;
  trajectory: Trajectory;
  /** Absolute beat the section's first phrase starts on. */
  startBeat: number;
  /** Beats of track the course needs to scroll in before its first phrase. */
  leadInBeats: number;
}

export interface CompiledLevel {
  definition: LevelDefinition;
  song: SongDefinition;
  tempo: TempoMap;
  sections: CompiledSection[];
  /** Absolute bar one past the end of the last section. */
  endBar: number;
  warnings: string[];
}

export class LevelValidationError extends Error {
  constructor(readonly issues: string[]) {
    super(`Level validation failed:\n  - ${issues.join('\n  - ')}`);
    this.name = 'LevelValidationError';
  }
}

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to load ${url}: HTTP ${res.status}`);
  return (await res.json()) as T;
}

export interface LevelSources {
  levelUrl: string;
  patternsUrl: string;
  mechanicsUrl: string;
}

export class LevelLoader {
  private patterns = new Map<string, PatternDefinition>();
  private mechanicLibrary: MechanicLibrary | null = null;

  get patternLibrary(): ReadonlyMap<string, PatternDefinition> {
    return this.patterns;
  }

  get mechanics(): MechanicLibrary {
    if (!this.mechanicLibrary) throw new Error('LevelLoader: mechanic library not loaded yet');
    return this.mechanicLibrary;
  }

  async load(sources: LevelSources): Promise<CompiledLevel> {
    const level = await fetchJson<LevelDefinition>(sources.levelUrl);
    await this.loadLibraries(sources.patternsUrl, sources.mechanicsUrl);
    return this.build(level);
  }

  /** Fetch the pattern and mechanic libraries without a level. */
  async loadLibraries(patternsUrl: string, mechanicsUrl: string): Promise<void> {
    if (this.mechanicLibrary && this.patterns.size > 0) return;
    const [patternLib, mechanicLib] = await Promise.all([
      fetchJson<PatternLibrary>(patternsUrl),
      fetchJson<MechanicLibrary>(mechanicsUrl),
    ]);
    this.patterns = new Map(patternLib.patterns.map((p) => [p.id, p]));
    this.mechanicLibrary = mechanicLib;
  }

  /**
   * Validate and compile a level that is already in memory.
   *
   * The Polish Lab builds its levels as objects rather than files, and they go
   * through exactly this path -- same validation, same compilation -- so a lab
   * can never drift from how a real level behaves.
   */
  build(level: LevelDefinition): CompiledLevel {
    if (!this.mechanicLibrary) throw new Error('LevelLoader: call loadLibraries() before build()');
    const errors: string[] = [];
    const warnings: string[] = [];
    this.validate(level, errors, warnings);
    if (errors.length > 0) throw new LevelValidationError(errors);
    return this.compile(level, warnings);
  }

  // ---- validation --------------------------------------------------------

  private validate(level: LevelDefinition, errors: string[], warnings: string[]): void {
    const song = level.song;
    if (!song) errors.push('level.song is missing');
    else {
      if (!(song.bpm > 0)) errors.push(`song.bpm must be > 0 (got ${song.bpm})`);
      if (!Array.isArray(song.timeSignature) || song.timeSignature.length !== 2) {
        errors.push('song.timeSignature must be a [numerator, denominator] pair');
      }
    }
    if (!Array.isArray(level.sections) || level.sections.length === 0) {
      errors.push('level.sections must be a non-empty array');
      return;
    }

    const mechanicIds = new Set((this.mechanicLibrary?.mechanics ?? []).map((m) => m.id));
    let previousEnd = 0;

    for (const section of level.sections) {
      const where = `section "${section.id}"`;
      if (!GAME_MODES.includes(section.mode)) {
        errors.push(`${where}: unknown mode "${section.mode}"`);
      }
      if (!(section.startBar >= 1)) errors.push(`${where}: startBar must be >= 1`);
      if (!(section.lengthBars >= 1)) errors.push(`${where}: lengthBars must be >= 1`);
      if (previousEnd > 0 && section.startBar < previousEnd) {
        errors.push(`${where}: starts at bar ${section.startBar}, overlapping the previous section which ends at bar ${previousEnd}`);
      }
      if (previousEnd > 0 && section.startBar > previousEnd) {
        warnings.push(`${where}: gap of ${section.startBar - previousEnd} bar(s) before it (bars ${previousEnd}-${section.startBar - 1} are empty)`);
      }
      previousEnd = section.startBar + section.lengthBars;

      if (!Array.isArray(section.patterns)) {
        errors.push(`${where}: patterns must be an array`);
        continue;
      }
      if (section.course) {
        this.validateCourse(section, where, errors, warnings);
        continue;
      }
      if (section.patterns.length === 0) {
        // Empty on purpose is a real case: a Polish Lab movement test, or a
        // deliberate rest. Report it, do not reject it.
        warnings.push(`${where}: has no patterns -- the mode runs with no hazards`);
        continue;
      }

      let barsUsed = 0;
      for (const placement of section.patterns) {
        const pattern = this.patterns.get(placement.patternId);
        if (!pattern) {
          errors.push(`${where}: references unknown patternId "${placement.patternId}"`);
          continue;
        }
        if (pattern.mode !== section.mode) {
          warnings.push(`${where}: pattern ${pattern.id} is a ${pattern.mode} pattern but the section mode is ${section.mode}`);
        }
        const repeat = placement.repeat ?? 1;
        if (repeat < 1) errors.push(`${where}: pattern ${pattern.id} has repeat ${repeat} (must be >= 1)`);
        const intensity = placement.intensity ?? 0.5;
        if (intensity < 0 || intensity > 1) {
          errors.push(`${where}: pattern ${pattern.id} intensity ${intensity} is outside 0..1`);
        }
        barsUsed += pattern.lengthBars * repeat;

        for (const [i, event] of pattern.events.entries()) {
          if (!mechanicIds.has(event.mechanicId)) {
            errors.push(`pattern ${pattern.id} event ${i}: unknown mechanicId "${event.mechanicId}"`);
          }
          if (event.at.bar < 1 || event.at.bar > Math.ceil(pattern.lengthBars)) {
            warnings.push(`pattern ${pattern.id} event ${i}: bar ${event.at.bar} is outside the pattern's ${pattern.lengthBars}-bar length`);
          }
        }
      }

      if (barsUsed > section.lengthBars) {
        warnings.push(`${where}: patterns occupy ${barsUsed} bars but the section is ${section.lengthBars} bars -- the overflow runs past the section`);
      } else if (barsUsed < section.lengthBars) {
        warnings.push(`${where}: patterns occupy ${barsUsed} of ${section.lengthBars} bars -- ${section.lengthBars - barsUsed} bar(s) will be silent`);
      }
    }
  }

  /**
   * Validate an authored RUNNER course.
   *
   * The physics is checked by `npm run runner-check` against the planned
   * trajectory; what is checked here is the *authoring*: that the phrases are
   * real archetypes, that they fill the section, and that a course is not asked
   * to run in a mode that has no way to carry it.
   */
  private validateCourse(section: SectionDefinition, where: string, errors: string[], warnings: string[]): void {
    const course = section.course;
    if (!course) return;
    if (section.mode !== 'RUNNER') {
      errors.push(`${where}: has a course but its mode is ${section.mode} -- courses are RUNNER-only`);
    }
    // A procedural course (spec §44-§48) has no authored phrase list to check:
    // the composer fills it at compile time, deterministically per seed. Its
    // *parameters* are what the authoring validator sees.
    const generate = course.generate;
    if (generate !== undefined && Array.isArray(course.phrases) && course.phrases.length > 0) {
      warnings.push(`${where}: declares both course.generate and an authored phrase list -- the authored list takes precedence and generate is ignored`);
    }
    if (generate !== undefined) {
      if (!(generate.beats > 0)) errors.push(`${where}: course.generate.beats must be > 0`);
      if (!Number.isInteger(generate.seed)) errors.push(`${where}: course.generate.seed must be an integer`);
      if (generate.intensity !== undefined && (generate.intensity < 0 || generate.intensity > 1)) {
        errors.push(`${where}: course.generate.intensity is outside 0..1`);
      }
      if (generate.phraseBeats !== undefined && !(generate.phraseBeats > 0)) {
        errors.push(`${where}: course.generate.phraseBeats must be > 0`);
      }
    }
    if (!Array.isArray(course.phrases) || course.phrases.length === 0) {
      // No authored list is fine when the composer owns the phrases -- but only
      // if its parameters were sane, which the block above has already judged.
      if (generate !== undefined && generate.beats > 0 && Number.isInteger(generate.seed)) return;
      errors.push(`${where}: course.phrases must be a non-empty array`);
      return;
    }
    if (section.patterns.length > 0) {
      warnings.push(`${where}: declares both patterns and a course -- the course takes precedence and the patterns are ignored`);
    }
    const phraseBeats = course.phraseBeats ?? 4;
    if (!(phraseBeats > 0)) errors.push(`${where}: course.phraseBeats must be > 0`);
    const totalBeats = course.phrases.reduce((sum, p) => sum + (p.beats ?? phraseBeats), 0);
    const sectionBeats = section.lengthBars * 4;
    if (totalBeats > sectionBeats) {
      warnings.push(`${where}: course is ${totalBeats} beats but the section is ${sectionBeats} -- the tail runs past the section`);
    } else if (totalBeats < sectionBeats) {
      warnings.push(`${where}: course is ${totalBeats} of ${sectionBeats} beats -- ${sectionBeats - totalBeats} beat(s) will have no terrain`);
    }
    for (const [i, phrase] of course.phrases.entries()) {
      if (!isArchetype(phrase.archetype)) {
        errors.push(`${where}: course phrase ${i} has unknown archetype "${phrase.archetype}"`);
      }
      if (phrase.beats !== undefined && !(phrase.beats > 0)) {
        errors.push(`${where}: course phrase ${i} has beats ${phrase.beats} (must be > 0)`);
      }
      if (phrase.intensity !== undefined && (phrase.intensity < 0 || phrase.intensity > 1)) {
        errors.push(`${where}: course phrase ${i} intensity ${phrase.intensity} is outside 0..1`);
      }
      if (phrase.verbs !== undefined) {
        if (!Array.isArray(phrase.verbs) || phrase.verbs.length === 0) {
          errors.push(`${where}: course phrase ${i} has an empty verbs list -- omit it to use the archetype`);
        } else {
          for (const verb of phrase.verbs) {
            if (!isMotionVerb(verb)) {
              errors.push(`${where}: course phrase ${i} has unknown verb "${verb}"`);
            }
          }
        }
      }
    }
  }

  // ---- compilation -------------------------------------------------------

  private compile(level: LevelDefinition, warnings: string[]): CompiledLevel {
    const timeSignature = (level.song.timeSignature ?? [4, 4]) as [number, number];
    const tempo = new ConstantTempoMap(level.song.bpm, timeSignature);
    const beatsPerBar = tempo.beatsPerBar;

    const sections: CompiledSection[] = level.sections.map((definition, index) => {
      const next = level.sections[index + 1] ?? null;
      const modeChanges = next !== null && next.mode !== definition.mode;
      const placements: CompiledPlacement[] = [];
      // Patterns are laid end to end inside the section, in declaration order.
      let cursorBar = definition.startBar;
      let maxTelegraph = 0;
      let maxSpawnLead = 0;

      for (const spec of definition.patterns) {
        const pattern = this.patterns.get(spec.patternId);
        if (!pattern) continue;
        const repeat = spec.repeat ?? 1;
        const intensity = spec.intensity ?? 0.5;
        for (let r = 0; r < repeat; r++) {
          placements.push({ sectionId: definition.id, pattern, startBar: cursorBar, repeatIndex: r, intensity });
          cursorBar += pattern.lengthBars;
        }
        for (const event of pattern.events) {
          const mech = this.mechanicLibrary?.mechanics.find((m) => m.id === event.mechanicId);
          if (!mech) continue;
          maxTelegraph = Math.max(maxTelegraph, mech.timing.telegraphBeats);
          maxSpawnLead = Math.max(maxSpawnLead, mech.timing.spawnLeadBeats ?? 0);
        }
      }

      // How early the mode has to be live for the section's first mechanic to be
      // readable at all. These are two different needs and not interchangeable:
      // a *telegraph* is a warning drawn on screen and needs the mode live for
      // `telegraphBeats`; a *scroll-in* is a warning that happens by the
      // mechanic travelling towards the player, needs no telegraph at all
      // (every RUNNER obstacle declares zero, for exactly this reason), and
      // needs the mode live for `spawnLeadBeats` instead.
      //
      // The one-bar cap below is a musicality rule -- a mode swap should not
      // start more than a bar early -- and it applies to the telegraph, which
      // is a presentation choice. It must *not* cut into the scroll-in: an
      // obstacle that has to be on screen for four beats is not on screen for
      // three, and capping it there is precisely the bug where a mode activates
      // with its first obstacle already at the player.
      const leadInBeats = Math.max(Math.min(maxTelegraph, beatsPerBar), maxSpawnLead);

      // A course replaces the pattern timeline for this section. It is planned
      // here, at load, so a course that cannot be planned fails loudly.
      const course = definition.course
        ? this.compileCourse(definition, beatsPerBar)
        : null;

      return {
        definition,
        id: definition.id,
        mode: definition.mode,
        startBar: definition.startBar,
        endBar: definition.startBar + definition.lengthBars,
        placements,
        course,
        leadInBeats: course ? course.leadInBeats : leadInBeats,
        transitionOut: definition.transitionOut ?? null,
        nextMode: next?.mode ?? null,
        // The breather is a *second* requirement (a full three-second
        // countdown, whatever the tempo), with the legacy beat count as a
        // floor so slow songs never cut it short.
        breatherFromBeat: modeChanges
          ? (definition.startBar - 1 + definition.lengthBars) * beatsPerBar
            - Math.max(TUNING.transition.breatherBeats, beatsForSeconds(level.song.bpm, TUNING.transition.countdownSeconds))
          : null,
      };
    });

    const endBar = sections.reduce((max, s) => Math.max(max, s.endBar), 1);
    return { definition: level, song: level.song, tempo, sections, endBar, warnings };
  }

  /**
   * Plan a section's course into a trajectory.
   *
   * The course is anchored to the section's first beat and every beat in it is
   * absolute, so nothing downstream has to add an offset. The lead-in is one bar
   * of scroll -- the same spatial warning every RUNNER obstacle gets -- so the
   * mode is live and the first slab is already on screen when the section starts
   * rather than materialising under the player.
   */
  private compileCourse(section: SectionDefinition, beatsPerBar: number): CompiledCourse {
    const course = section.course!;
    // A procedural course is expanded here, at load, by the same phrase
    // composer every seeded generator test uses (spec §44-§48). The expansion
    // is deterministic per seed, and what it produces is an ordinary
    // `CourseSpec` -- the planned, validated pipeline below cannot tell it from
    // an authored level, which is the point.
    if (course.generate !== undefined && (!Array.isArray(course.phrases) || course.phrases.length === 0)) {
      const generate = course.generate;
      const composed = composeCourse({
        beats: generate.beats,
        seed: generate.seed,
        intensity: generate.intensity,
        phraseBeats: generate.phraseBeats ?? course.phraseBeats,
      });
      course.phrases = composed.phrases;
      if (course.phraseBeats === undefined) course.phraseBeats = composed.phraseBeats;
      if (course.seed === undefined) course.seed = generate.seed;
    }
    const startBeat = (section.startBar - 1) * beatsPerBar;
    const trajectory = planCourse(course, { startBeat, phraseBeats: course.phraseBeats });
    return {
      spec: course,
      trajectory,
      startBeat,
      leadInBeats: Math.max(SCROLL_LEAD_BEATS, beatsPerBar),
    };
  }
}

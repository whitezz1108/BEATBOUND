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
import type {
  GameMode,
  LevelDefinition,
  MechanicLibrary,
  PatternDefinition,
  PatternLibrary,
  SectionDefinition,
  SongDefinition,
} from './types';
import { GAME_MODES } from './types';

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
   * How many beats before the section starts its mode must already be live, so
   * a first-beat mechanic can show its telegraph. Derived from the mechanics
   * the section actually uses.
   */
  leadInBeats: number;
  transitionOut: string | null;
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
    const [level, patternLib, mechanicLib] = await Promise.all([
      fetchJson<LevelDefinition>(sources.levelUrl),
      fetchJson<PatternLibrary>(sources.patternsUrl),
      fetchJson<MechanicLibrary>(sources.mechanicsUrl),
    ]);

    this.patterns = new Map(patternLib.patterns.map((p) => [p.id, p]));
    this.mechanicLibrary = mechanicLib;

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

      if (!Array.isArray(section.patterns) || section.patterns.length === 0) {
        errors.push(`${where}: patterns must be a non-empty array`);
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

  // ---- compilation -------------------------------------------------------

  private compile(level: LevelDefinition, warnings: string[]): CompiledLevel {
    const timeSignature = (level.song.timeSignature ?? [4, 4]) as [number, number];
    const tempo = new ConstantTempoMap(level.song.bpm, timeSignature);
    const beatsPerBar = tempo.beatsPerBar;

    const sections: CompiledSection[] = level.sections.map((definition) => {
      const placements: CompiledPlacement[] = [];
      // Patterns are laid end to end inside the section, in declaration order.
      let cursorBar = definition.startBar;
      let maxTelegraph = 0;

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
          if (mech) maxTelegraph = Math.max(maxTelegraph, mech.timing.telegraphBeats);
        }
      }

      return {
        definition,
        id: definition.id,
        mode: definition.mode,
        startBar: definition.startBar,
        endBar: definition.startBar + definition.lengthBars,
        placements,
        // Never lead in by more than a bar: a mode swap should stay musical.
        leadInBeats: Math.min(maxTelegraph, beatsPerBar),
        transitionOut: definition.transitionOut ?? null,
      };
    });

    const endBar = sections.reduce((max, s) => Math.max(max, s.endBar), 1);
    return { definition: level, song: level.song, tempo, sections, endBar, warnings };
  }
}

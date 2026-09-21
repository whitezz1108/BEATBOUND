/**
 * Runtime mirrors of the BeatBound Library v1 JSON schemas.
 *
 *   mechanics.schema.json -> MechanicDefinition / MechanicLibrary
 *   patterns.schema.json  -> PatternDefinition  / PatternLibrary
 *   level.schema.json     -> LevelDefinition
 *
 * These are *data* types only. Nothing here knows how a mechanic behaves.
 */

export const GAME_MODES = ['ARENA', 'RUNNER', 'VERTICAL', 'RADIAL', 'DUO'] as const;
export type GameMode = (typeof GAME_MODES)[number];

export const PATTERN_FUNCTIONS = [
  'TEACH', 'PRACTICE', 'VARIATION', 'COMBINE', 'CLIMAX', 'RECOVERY', 'TRANSITION', 'BOSS',
] as const;
export type PatternFunction = (typeof PATTERN_FUNCTIONS)[number];

/** DUO-ready from day one: every scheduled event carries a role. */
export const EVENT_ROLES = ['PLAYER_A', 'PLAYER_B', 'BOTH', 'SYSTEM'] as const;
export type EventRole = (typeof EVENT_ROLES)[number];

/** Free-form per-mechanic parameter bag out of JSON. */
export type ParamBag = Record<string, unknown>;

// --------------------------------------------------------------------------
// Mechanics
// --------------------------------------------------------------------------

export interface MechanicTiming {
  /** How long the mechanic stays dangerous, in beats. */
  durationBeats: number;
  /** How long the telegraph is shown *before* activation, in beats. */
  telegraphBeats: number;
  /** Post-active recovery/cooldown, in beats. */
  cooldownBeats?: number;
  /**
   * How long before activation this mechanic has to exist to be *readable*,
   * when that is longer than its telegraph.
   *
   * A telegraph is a warning drawn on screen; a scroll-in is a warning that
   * happens by the mechanic travelling towards the player from off-screen. The
   * second kind needs no telegraph at all -- which is why every RUNNER obstacle
   * declares `telegraphBeats: 0` -- but it still needs *time*, and the level
   * compiler has to know how much in order to make the mode live early enough
   * for the mechanic to be seen at all. Without it a section whose first
   * obstacle sits on its own first beat reads as zero warning: the mode
   * activates and the obstacle is already on top of the player.
   */
  spawnLeadBeats?: number;
}

export interface MechanicDefinition {
  id: string;
  name: string;
  mode: GameMode;
  status: 'MVP' | 'OPTIONAL' | 'STRETCH';
  difficulty: number;
  timing: MechanicTiming;
  musicTags?: Record<string, string[]>;
  playerSkills?: string[];
  compatibility?: { goodWith?: string[]; avoidWith?: string[] };
  defaults: ParamBag;
  notes?: string;
}

export interface MechanicLibrary {
  version: string;
  mechanics: MechanicDefinition[];
}

// --------------------------------------------------------------------------
// Patterns
// --------------------------------------------------------------------------

/** A musical position *relative to the start of its pattern*. bar/beat are 1-based. */
export interface MusicalPositionSpec {
  bar: number;
  beat: number;
  /** Fine nudge, in beats. Applied after bar/beat resolution. */
  offsetBeats?: number;
}

export interface PatternEvent {
  at: MusicalPositionSpec;
  mechanicId: string;
  params?: ParamBag;
  role?: EventRole;
}

export interface PatternDifficulty {
  overall: number;
  reaction: number;
  rhythmComplexity: number;
  spatialComplexity: number;
  inputComplexity: number;
  informationLoad: number;
}

export interface PatternConstraints {
  /** Floor on telegraph time. Intensity scaling must never push below this. */
  minReactionBeats?: number;
  maxSimultaneousThreats?: number;
  requiresMechanics?: string[];
}

export interface PatternDefinition {
  id: string;
  name: string;
  mode: GameMode;
  function: PatternFunction;
  difficulty: PatternDifficulty;
  lengthBars: number;
  musicTags?: Record<string, string[]>;
  events: PatternEvent[];
  constraints?: PatternConstraints;
  notes?: string;
}

export interface PatternLibrary {
  version: string;
  patterns: PatternDefinition[];
}

// --------------------------------------------------------------------------
// Level
// --------------------------------------------------------------------------

export interface SongDefinition {
  id: string;
  title?: string;
  audio: string;
  bpm: number;
  timeSignature: [number, number];
}

export interface PatternPlacementSpec {
  patternId: string;
  repeat?: number;
  /** 0..1. Mapped by mechanics onto count / speed / telegraph length. */
  intensity?: number;
}

export interface SectionDefinition {
  id: string;
  startBar: number;
  lengthBars: number;
  mode: GameMode;
  function?: string;
  difficulty?: number;
  patterns: PatternPlacementSpec[];
  transitionOut?: string | null;
  /**
   * RUNNER extension: an authored course, expressed as phrases of movement.
   *
   * The default RUNNER pipeline is pattern-based like every other mode -- a
   * section lists pattern ids and the scheduler places their events. That is the
   * right model for hazards that happen *at* a beat. It is the wrong model for
   * RUNNER, where the thing that matters is the shape of the player's motion
   * *across* beats (spec §2, §3).
   *
   * So a RUNNER section may instead carry `course`: a list of phrase specs the
   * RUNNER course compiler expands into a full trajectory and then into terrain
   * and hazards. When present, `course` takes precedence and `patterns` is
   * ignored for that section.
   *
   * This is additive and optional. Every existing level omits it and compiles
   * exactly as before, which is the migration path: old levels keep working,
   * new RUNNER levels are authored in motion.
   */
  course?: CourseSpec;
}

/** A RUNNER course: an ordered list of phrases, in beats from the section start. */
export interface CourseSpec {
  /** Beats per phrase. 2, 4, 8 or 16 -- the units spec §5 asks for. */
  phraseBeats?: number;
  /** Seed for the phrase composer's controlled randomness (spec §46). */
  seed?: number;
  phrases: PhraseSpec[];
  /**
   * Declare the course procedurally instead of authoring its phrase list
   * (spec §44-§48).
   *
   * When present, the loader expands it through the phrase composer
   * (`composeCourse`) at load time and the result flows through exactly the
   * same validation and `planCourse` pipeline an authored list does -- there is
   * no second runtime. Deterministic per seed. `phrases` is then optional: an
   * empty or absent list means "compose all of it"; a non-empty list is used
   * as authored and `generate` is ignored.
   */
  generate?: ProceduralCourseSpec;
}

/** Parameters for expanding a course with the phrase composer (spec §45-§48). */
export interface ProceduralCourseSpec {
  /** Total beats the generated phrases must fill. */
  beats: number;
  /** Deterministic seed for the composer's controlled randomness. */
  seed: number;
  /** 0..1 base intensity; roles reshape it (climax louder, intro quieter). */
  intensity?: number;
  /** Beats per generated phrase. Defaults to the course's `phraseBeats`. */
  phraseBeats?: number;
}

export interface PhraseSpec {
  /** Phrase archetype (GROOVE, ASCENT, FLIP, ...). */
  archetype: string;
  /** Musical role in the I-R-V-C-R arc. Defaults from position. */
  role?: string;
  /** Length override, in beats. */
  beats?: number;
  /** 0..1. Scales density, hazard height and jump length. */
  intensity?: number;
  /**
   * Motif id. Phrases sharing one are variations of the same idea, which is
   * what gives the mode musical memory (spec §23).
   */
  motif?: string;
  /** True to keep the player on the ceiling for this phrase. */
  inverted?: boolean;
  /**
   * Explicit motion verbs, overriding the archetype's default sequence.
   *
   * An archetype is a *shape* -- four verbs that say "this phrase is a groove" --
   * and for most phrases that is the right level to author at. But an archetype
   * cannot express everything the motion language can: `HIGH_LOW_ALTERNATION`,
   * `SYNCOPATED_HOPS`, `GRAVITY_ZIGZAG` and six others are real verbs that no
   * archetype happens to list, so without this field a third of the vocabulary
   * would be unreachable from level data and the mode would be shipping a
   * language it cannot speak.
   *
   * Spec §27 asks for the showcase to be "handcrafted / explicitly scripted",
   * and this is what that means in data: the composer still owns the *beats*
   * (verbs are trimmed and the remainder filled with running), so an explicit
   * list is exactly as physically valid as an archetype's.
   */
  verbs?: string[];
}

export interface LevelDefinition {
  version: string;
  song: SongDefinition;
  sections: SectionDefinition[];
}

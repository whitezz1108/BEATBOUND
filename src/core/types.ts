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
}

export interface LevelDefinition {
  version: string;
  song: SongDefinition;
  sections: SectionDefinition[];
}

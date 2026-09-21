/**
 * The RUNNER motion language.
 *
 * A verb here is not a label. Each one names a *movement idea* the player will
 * perform, and the planner in `runnerPlanner.ts` implements it as real geometry
 * derived from `runnerPhysics.ts`. If a verb cannot be expressed as a physically
 * valid trajectory it does not belong in this table.
 *
 * ## Why a language at all
 *
 * The old RUNNER generator picked an obstacle per beat: spike, spike, gap,
 * spike. Nothing said *how the player should move* -- so the result could only
 * ever be a hazard stream, never a course. Verbs invert that. "STAIRCASE_UP" is
 * a statement about the player's feet (four landings, each one step higher);
 * the four slabs are a consequence of it, not the point of it.
 *
 * ## Gravity-relative, not absolute
 *
 * Every verb is written relative to the surface the player is *on*. On the
 * ceiling, `rise` still means "further from the surface you are running on",
 * so GROUND_RUN and CEILING_RUN are the same idea and the same code, and an
 * inverted phrase is not a special case bolted on the side.
 */

/** The 31 movement ideas RUNNER can express. */
export const MOTION_VERBS = [
  'GROUND_RUN',
  'SHORT_JUMP',
  'MEDIUM_JUMP',
  'LONG_JUMP',
  'HIGH_JUMP',
  'QUICK_HOP',
  'DOUBLE_HOP',
  'TRIPLE_HOP',
  'LAND_AND_IMMEDIATE_REJUMP',
  'GAP_JUMP',
  'LONG_GAP',
  'DROP',
  'DROP_AND_JUMP',
  'STAIRCASE_UP',
  'STAIRCASE_DOWN',
  'PLATFORM_ASCENT',
  'PLATFORM_DESCENT',
  'HIGH_LOW_ALTERNATION',
  'PLATFORM_HOP_CHAIN',
  'RHYTHMIC_BOUNCE',
  'SYNCOPATED_HOPS',
  'AIRBORNE_ACCENT',
  'CEILING_RUN',
  'CEILING_HOP',
  'INVERTED_PLATFORM_CHAIN',
  'GRAVITY_FLIP_UP',
  'GRAVITY_FLIP_DOWN',
  'GRAVITY_ZIGZAG',
  'TOP_BOTTOM_CORRIDOR',
  'TIGHT_VERTICAL_WINDOW',
  'DOUBLE_JUMP_MOUNT',
  'SKY_STEPS',
  'RELEASE_RUN',
] as const;

export type MotionVerb = (typeof MOTION_VERBS)[number];

export interface VerbInfo {
  /** Nominal length in beats at intensity 0. The planner may scale it. */
  beats: number;
  /** Whether the verb reads as low, medium or high threat. */
  threat: 'NONE' | 'LOW' | 'MID' | 'HIGH';
  /** True when the verb only makes sense on the ceiling. */
  ceilingOnly?: boolean;
  /** True when the verb changes which surface the player is on. */
  flips?: boolean;
  /** One line for the debug view and for anyone reading a course dump. */
  description: string;
}

export const VERB_INFO: Record<MotionVerb, VerbInfo> = {
  GROUND_RUN: { beats: 2, threat: 'NONE', description: 'flat running on the current surface' },
  SHORT_JUMP: { beats: 1, threat: 'LOW', description: 'a tapped hop, key released early' },
  MEDIUM_JUMP: { beats: 1, threat: 'LOW', description: 'a half-held jump' },
  LONG_JUMP: { beats: 1, threat: 'MID', description: 'a full-airtime jump' },
  HIGH_JUMP: { beats: 1, threat: 'MID', description: 'a full jump landing on a raised slab' },
  QUICK_HOP: { beats: 0.5, threat: 'MID', description: 'a hop on the half-beat' },
  DOUBLE_HOP: { beats: 1, threat: 'MID', description: 'two hops inside one beat' },
  TRIPLE_HOP: { beats: 1.5, threat: 'HIGH', description: 'three hops inside two beats' },
  LAND_AND_IMMEDIATE_REJUMP: { beats: 1, threat: 'HIGH', description: 'touch down and leave again at once' },
  GAP_JUMP: { beats: 1, threat: 'MID', description: 'a hole in the surface, jumped' },
  LONG_GAP: { beats: 1, threat: 'HIGH', description: 'a hole close to the limit of the arc' },
  DROP: { beats: 1, threat: 'LOW', description: 'run off a ledge and fall to a lower slab' },
  DROP_AND_JUMP: { beats: 1.5, threat: 'MID', description: 'fall, land, leave again' },
  STAIRCASE_UP: { beats: 4, threat: 'MID', description: 'four landings, each a step higher' },
  STAIRCASE_DOWN: { beats: 4, threat: 'MID', description: 'four landings, each a step lower' },
  PLATFORM_ASCENT: { beats: 4, threat: 'MID', description: 'climb to a high platform over four beats' },
  PLATFORM_DESCENT: { beats: 4, threat: 'MID', description: 'step down to the base surface' },
  HIGH_LOW_ALTERNATION: { beats: 4, threat: 'MID', description: 'high, low, high, low landings' },
  PLATFORM_HOP_CHAIN: { beats: 3, threat: 'MID', description: 'slab to slab, one beat apart' },
  RHYTHMIC_BOUNCE: { beats: 4, threat: 'MID', description: 'pads that launch on the beat' },
  SYNCOPATED_HOPS: { beats: 2, threat: 'HIGH', description: 'hops landing off the beat' },
  AIRBORNE_ACCENT: { beats: 2, threat: 'MID', description: 'a long airborne slice over a hazard' },
  CEILING_RUN: { beats: 2, threat: 'NONE', description: 'flat running on the ceiling' },
  CEILING_HOP: { beats: 1, threat: 'LOW', description: 'a hop along the ceiling' },
  INVERTED_PLATFORM_CHAIN: { beats: 3, threat: 'MID', description: 'slabs hanging into the ceiling route' },
  GRAVITY_FLIP_UP: { beats: 2, threat: 'MID', flips: true, description: 'flip to the ceiling with a safe landing' },
  GRAVITY_FLIP_DOWN: { beats: 2, threat: 'MID', flips: true, description: 'flip back to the floor with a safe landing' },
  GRAVITY_ZIGZAG: { beats: 4, threat: 'HIGH', flips: true, description: 'flip, play, flip back' },
  TOP_BOTTOM_CORRIDOR: { beats: 4, threat: 'MID', description: 'floor and ceiling together define the route' },
  TIGHT_VERTICAL_WINDOW: { beats: 2, threat: 'HIGH', description: 'a corridor barely taller than the body' },
  DOUBLE_JUMP_MOUNT: { beats: 2, threat: 'HIGH', description: 'a block only a mid-air second jump can reach' },
  SKY_STEPS: { beats: 3, threat: 'MID', description: 'floating blocks over holes, one full jump apart' },
  RELEASE_RUN: { beats: 2, threat: 'NONE', description: 'open running, nothing to dodge' },
};

/** The 12 phrase archetypes: named sequences of verbs with a musical job. */
export const PHRASE_ARCHETYPES = [
  'GROOVE',
  'ASCENT',
  'DESCENT',
  'BOUNCE',
  'WAVE',
  'CLIMB_AND_DROP',
  'GAP_RUN',
  'FLIP',
  'INVERTED_GROOVE',
  'CORRIDOR',
  'BURST',
  'RELEASE',
] as const;

export type PhraseArchetype = (typeof PHRASE_ARCHETYPES)[number];

/**
 * Each archetype is a *shape*, not a fixed bar of notes: the planner repeats,
 * trims or extends the sequence to fill the beats it was given, so the same
 * archetype can be a two-beat accent or an eight-beat movement.
 */
export const ARCHETYPE_VERBS: Record<PhraseArchetype, MotionVerb[]> = {
  GROOVE: ['MEDIUM_JUMP', 'GROUND_RUN', 'MEDIUM_JUMP', 'SHORT_JUMP'],
  ASCENT: ['PLATFORM_ASCENT', 'HIGH_JUMP'],
  DESCENT: ['DROP', 'DROP', 'PLATFORM_DESCENT'],
  BOUNCE: ['QUICK_HOP', 'QUICK_HOP', 'DOUBLE_HOP', 'QUICK_HOP'],
  WAVE: ['HIGH_JUMP', 'GROUND_RUN', 'HIGH_JUMP', 'GROUND_RUN'],
  CLIMB_AND_DROP: ['STAIRCASE_UP', 'DROP'],
  GAP_RUN: ['GAP_JUMP', 'GAP_JUMP', 'LONG_GAP'],
  FLIP: ['GRAVITY_FLIP_UP', 'CEILING_HOP', 'CEILING_HOP', 'GRAVITY_FLIP_DOWN'],
  INVERTED_GROOVE: ['CEILING_HOP', 'CEILING_RUN', 'CEILING_HOP', 'INVERTED_PLATFORM_CHAIN'],
  CORRIDOR: ['TOP_BOTTOM_CORRIDOR', 'TIGHT_VERTICAL_WINDOW', 'GROUND_RUN'],
  BURST: ['DOUBLE_HOP', 'TRIPLE_HOP', 'LAND_AND_IMMEDIATE_REJUMP', 'QUICK_HOP'],
  RELEASE: ['RELEASE_RUN'],
};

/**
 * The archetype a phrase should be, given where it sits in a section.
 *
 * This is the I -> R -> V -> C -> R dramaturgy of spec §22 expressed as data:
 * the first phrase teaches, the next repeats it, the middle varies it, the
 * climax escalates, and the last one lets go.
 */
export type PhraseRole = 'INTRO' | 'REPEAT' | 'VARIATION' | 'CLIMAX' | 'RELEASE';

export const ROLE_ORDER: PhraseRole[] = ['INTRO', 'REPEAT', 'VARIATION', 'CLIMAX', 'RELEASE'];

/** Which archetypes a role may draw from. Variation and climax escalate. */
export const ROLE_ARCHETYPES: Record<PhraseRole, PhraseArchetype[]> = {
  INTRO: ['GROOVE', 'BOUNCE', 'RELEASE'],
  REPEAT: ['GROOVE', 'BOUNCE', 'WAVE', 'GAP_RUN'],
  VARIATION: ['WAVE', 'GAP_RUN', 'ASCENT', 'DESCENT', 'CORRIDOR'],
  CLIMAX: ['BURST', 'CLIMB_AND_DROP', 'CORRIDOR', 'GAP_RUN', 'FLIP'],
  RELEASE: ['RELEASE', 'DESCENT'],
};

export function isMotionVerb(value: unknown): value is MotionVerb {
  return typeof value === 'string' && (MOTION_VERBS as readonly string[]).includes(value);
}

export function isArchetype(value: unknown): value is PhraseArchetype {
  return typeof value === 'string' && (PHRASE_ARCHETYPES as readonly string[]).includes(value);
}

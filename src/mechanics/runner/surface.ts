/**
 * Which surface a RUNNER obstacle belongs to.
 *
 * With gravity inversion the track has two running surfaces, and an obstacle
 * only matters on the one the player is currently attached to. A floor spike
 * during a ceiling sequence is scenery; a ceiling spike during a floor sequence
 * is the same. Patterns say which they mean.
 */

export type TrackSurface = 'FLOOR' | 'CEILING';

/**
 * The colour of a surface, and therefore of everything standable on it.
 *
 * One colour per surface, used by *every* face the player can land on: the base
 * line, a raised slab, a staircase step. The hue means one thing and only one
 * thing -- "gravity pulls you onto this side, and this is where you land" -- so
 * a bright blue line answers the same question wherever it appears, and a level
 * can never use the colour decoratively without breaking the read.
 *
 * The two surfaces differ because which side is down is the one fact the player
 * has to re-establish after an inversion, and a hue they can catch in a glance
 * is cheaper than any icon.
 */
export const SURFACE_COLOUR: Record<TrackSurface, string> = {
  FLOOR: '#3f6fd8',
  CEILING: '#8a5fff',
};

/**
 * The same two hues, lifted toward white: the highlight on anything that is
 * *about* to put the player on a surface -- the arrow on a gravity gate, the
 * outline of a portal -- as opposed to the surface itself.
 */
export const SURFACE_TINT: Record<TrackSurface, string> = {
  FLOOR: '#a8c6ff',
  CEILING: '#c9bcff',
};

/**
 * The mass under a standable face.
 *
 * Every solid block in a course -- a course slab, a pattern platform, a
 * staircase step -- is this one dark fill with this one outline, whatever it
 * belongs to. The blocks are not the message; the *face* is, and the face is
 * `SURFACE_COLOUR`. Keeping the mass uniform is what stops the field filling up
 * with differently-coloured rectangles that all have to be re-read as "solid"
 * one at a time, and it is why the only bright horizontal line on screen is a
 * line you can land on.
 */
export const MASS_FILL = '#243050';
export const MASS_OUTLINE = '#3d4c75';

export function readSurface(value: unknown): TrackSurface {
  return String(value ?? 'FLOOR').toUpperCase() === 'CEILING' ? 'CEILING' : 'FLOOR';
}

/** The surface an obstacle sits on, defaulting to the floor. */
export function surfaceOf(mechanic: unknown): TrackSurface {
  return readSurface((mechanic as { surface?: unknown } | null)?.surface);
}

/** The surface the player is attached to, from the gravity direction. */
export function surfaceForGravity(gravityDirection: number): TrackSurface {
  return gravityDirection > 0 ? 'FLOOR' : 'CEILING';
}

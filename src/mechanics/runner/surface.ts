/**
 * Which surface a RUNNER obstacle belongs to.
 *
 * With gravity inversion the track has two running surfaces, and an obstacle
 * only matters on the one the player is currently attached to. A floor spike
 * during a ceiling sequence is scenery; a ceiling spike during a floor sequence
 * is the same. Patterns say which they mean.
 */

export type TrackSurface = 'FLOOR' | 'CEILING';

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

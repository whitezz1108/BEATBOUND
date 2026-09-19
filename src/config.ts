/**
 * Data locations.
 *
 * vite.config.ts serves `beatbound_library_v1/` as the web root, so these URLs
 * point straight at the library files the designers edit -- there is no copy of
 * the game data inside src/.
 */

export const DATA = {
  mechanics: '/mechanics.mvp.json',
  patterns: '/patterns.mvp.json',
  defaultLevel: '/arena_test.level.json',
} as const;

/** `?level=prototype_90s.level.json` swaps the level without touching code. */
export function levelUrlFromLocation(search = window.location.search): string {
  const requested = new URLSearchParams(search).get('level');
  if (!requested) return DATA.defaultLevel;
  return requested.startsWith('/') ? requested : `/${requested}`;
}

/** Beats of silence before bar 1, so the player can get ready. */
export const COUNT_IN_BEATS = 8;

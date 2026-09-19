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
  levels: '/levels.index.json',
  defaultLevel: '/arena_test.level.json',
} as const;

/** One entry of levels.index.json -- what the level picker lists. */
export interface LevelIndexEntry {
  id: string;
  file: string;
  title: string;
  blurb?: string;
}

export interface LevelIndex {
  version: string;
  levels: LevelIndexEntry[];
}

export async function loadLevelIndex(): Promise<LevelIndexEntry[]> {
  try {
    const res = await fetch(DATA.levels);
    if (!res.ok) return [];
    return ((await res.json()) as LevelIndex).levels ?? [];
  } catch {
    return [];
  }
}

/** `?level=prototype_90s.level.json` swaps the level without touching code. */
export function levelUrlFromLocation(search = window.location.search): string {
  const requested = new URLSearchParams(search).get('level');
  if (!requested) return DATA.defaultLevel;
  return requested.startsWith('/') ? requested : `/${requested}`;
}

/** Beats of silence before the start bar, so the player can get ready. */
export const COUNT_IN_BEATS = 8;

/** Dev-only URL switches for inspecting a level without playing it through. */
export interface DevOptions {
  /** 1-based bar to start playback at. */
  startBar: number;
  /** Hits still flash and count, but never end the run. */
  invincible: boolean;
}

/** `?startBar=17&invincible` */
export function devOptionsFromLocation(search = window.location.search): DevOptions {
  const params = new URLSearchParams(search);
  const startBar = Number(params.get('startBar'));
  return {
    startBar: Number.isFinite(startBar) && startBar >= 1 ? Math.floor(startBar) : 1,
    invincible: params.has('invincible'),
  };
}

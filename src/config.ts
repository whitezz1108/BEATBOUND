/**
 * Data locations.
 *
 * vite.config.ts serves `beatbound_library_v1/` as the web root, so these URLs
 * point straight at the library files the designers edit -- there is no copy of
 * the game data inside src/.
 */

// BASE_URL is '/' under `vite`/`vite preview` and '/BEATBOUND/' on GitHub
// Pages, so data URLs must be prefixed to work in both places.
//
// Read defensively, because this module is also bundled by esbuild into the
// headless tools (`npm run audit`, `fairness`, `level`, `runner-check`), which
// run under plain Node where `import.meta.env` does not exist. Vite still
// substitutes the real base in both dev and build; Node falls back to '/',
// which is what the tools' fetch shim resolves library paths against anyway.
const BASE = (import.meta as ImportMeta & { env?: { BASE_URL?: string } }).env?.BASE_URL ?? '/';

/**
 * Absolute URL for a path inside the library root (`beatbound_library_v1/`).
 *
 * Level JSON stores library-relative paths -- `audio/editor/song.mp3` -- because
 * the editor and the headless tools read those files off disk, where a
 * `/BEATBOUND/` prefix would be meaningless. The runtime is the only consumer
 * that needs a URL, so it is resolved here, at fetch time.
 */
export const libraryUrl = (path: string) => BASE + path.replace(/^\//, '');

/**
 * The inverse of `libraryUrl`: a URL back to the library-relative path that
 * `levels.index.json` and the level files themselves use.
 *
 * `?level=` and the level picker both speak library paths, but the URL in hand
 * is absolute (`/BEATBOUND/runner_showcase.level.json`), so the base has to come
 * off before it can be compared with, or written back into, an index entry.
 */
export function libraryPath(url: string): string {
  return (url.startsWith(BASE) ? url.slice(BASE.length) : url).replace(/^\//, '');
}

export const DATA = {
  mechanics: libraryUrl('/mechanics.mvp.json'),
  patterns: libraryUrl('/patterns.mvp.json'),
  levels: libraryUrl('/levels.index.json'),
  defaultLevel: libraryUrl('/toosie_slide_arena_primary.level.json'),
} as const;

/** One entry of levels.index.json -- what the level picker lists. */
export interface LevelIndexEntry {
  id: string;
  file: string;
  title: string;
  blurb?: string;
  /** Modes the level contains; the title screen filters its song list by these. */
  modes?: string[];
  /** Library-relative audio, for the song-select preview (absent = no music). */
  audio?: string;
  bpm?: number;
  duration?: number;
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
  return requested.startsWith('/') ? libraryUrl(requested) : libraryUrl(`/${requested}`);
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

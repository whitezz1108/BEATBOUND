/**
 * Resolving the world around the player, from geometry alone.
 *
 * This is the one function that decides what the player is standing on and what
 * stops their head. It lives here, in the mechanics layer, rather than inside
 * `RunnerMode`, because three consumers have to agree on it *exactly* (spec §8):
 *
 *   1. the live mode, every frame;
 *   2. the traversal simulator (`traversalSim.ts`), which replays a planned
 *      course to prove the intended route is flyable;
 *   3. `tools/runner-check.ts`, which reports on both.
 *
 * If the simulator resolved terrain even slightly differently from the mode, it
 * would be validating a game nobody plays. Sharing the function is what makes
 * its verdict mean something.
 *
 * ## Support and blocker, in one pass
 *
 * Both are world y, both may be null, and they are computed together so they can
 * never disagree about the same slab:
 *
 *   - *support*: the face nearest the player at or below the feet. Under FLOOR
 *     gravity that is the highest such face; under CEILING gravity, the lowest.
 *   - *blocker*: the face ahead of the head. A face the player is already
 *     inside of is not a blocker -- it would freeze them permanently.
 *
 * A slab anchored to the base line has its far face *on* that line, so it can
 * never block; a floating slab has both faces in mid-air, so it can be stood on
 * and can stop a jump. That is what makes a corridor expressible.
 */

import type { GroundGap, Platform } from '../../core/capabilities';
import type { TrackSurface } from './surface';

/** The world the player is standing in, resolved for one frame. */
export interface TerrainProbe {
  /** World y of the surface the feet land on, or null over a hole. */
  support: number | null;
  /** World y of a solid face the head hits while rising, or null. */
  blocker: number | null;
}

/** A probe with nothing but the base surface: used by labs and the simulator. */
export function flatProbe(surfaceY: number): TerrainProbe {
  return { support: surfaceY, blocker: null };
}

export interface ProbeOptions {
  /** True when gravity pulls down the screen (FLOOR). */
  gravityDown: boolean;
  /** World y of the running surface: the fallback support when nothing else is. */
  baseY: number;
  /** World y of the player's feet. */
  feet: number;
  /** World y of the player's head. */
  head: number;
  /**
   * How far above the feet a face can be and still be stepped onto rather than
   * jumped to. Zero while airborne, so a landing happens exactly on the face.
   */
  reach: number;
  /** True when the player is over a hole in the running surface. */
  overGap: boolean;
}

/**
 * Everything solid around the player, in world y.
 *
 * `platforms` is already filtered to the surface the player is on; this function
 * does not know what a surface is. Whether the player is over a hole arrives as
 * `overGap`, because that is a question about the running surface rather than
 * about any one slab.
 */
export function resolveProbe(
  platforms: readonly Platform[],
  options: ProbeOptions,
): TerrainProbe {
  const { gravityDown, baseY, feet, head, reach, overGap } = options;
  let support: number | null = overGap ? null : baseY;
  let blocker: number | null = null;

  for (const plat of platforms) {
    // The face the player would stand on, and the one they would hit.
    const standFace = gravityDown ? plat.top : plat.bottom;
    const blockFace = gravityDown ? plat.bottom : plat.top;

    const withinReach = gravityDown ? standFace >= feet - reach : standFace <= feet + reach;
    if (withinReach) {
      support = support === null
        ? standFace
        : (gravityDown ? Math.min(support, standFace) : Math.max(support, standFace));
    }

    // Only faces still ahead of the head count, so a block the player is
    // already inside of does not silently freeze them.
    const ahead = gravityDown ? blockFace < head : blockFace > head;
    if (ahead) {
      blocker = blocker === null
        ? blockFace
        : (gravityDown ? Math.max(blocker, blockFace) : Math.min(blocker, blockFace));
    }
  }
  return { support, blocker };
}

/** True when `x` falls inside any of the holes. */
export function xOverGap(gaps: readonly GroundGap[], x: number): boolean {
  for (const gap of gaps) {
    if (x > gap.x0 && x < gap.x1) return true;
  }
  return false;
}

/** Base surface y for a surface, given the two track lines. */
export function baseYFor(surface: TrackSurface, floorY: number, ceilingY: number): number {
  return surface === 'FLOOR' ? floorY : ceilingY;
}

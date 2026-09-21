/**
 * R04 -- Platform (RUNNER).
 *
 * A solid block rising from the running surface. The danger is the front face:
 * run into it and you take the hit; jump over the face and land on top, and the
 * block becomes terrain -- stand on it, hop between heights, run off the far
 * edge. Platforms small enough to step onto (<= TUNING.runner.stepUpHeight) are
 * walked over automatically, so the library can use them as steps without
 * demanding a jump for a 3cm ledge.
 *
 * On the ceiling (inverted gravity) the block hangs down and the player runs
 * along its underside.
 *
 * Params:
 *   surface  "FLOOR" | "CEILING"              default "FLOOR"
 *   height   rise above the surface           default 0.12 (0.02..0.24)
 *   width    platform width multiplier        default 1.0 (base 0.5 beats)
 */

import type { MechanicSpawnContext } from '../../core/Mechanic';
import type { Platform } from '../../core/capabilities';
import type { Rect, Shape } from '../../core/geometry';
import { clamp } from '../../core/geometry';
import type { Renderer } from '../../core/Renderer';
import { ScrollingObstacle } from './ScrollingObstacle';
import { CEILING_Y, GROUND_Y, UNITS_PER_BEAT } from './runnerGeometry';
import { MASS_FILL, MASS_OUTLINE, SURFACE_COLOUR, readSurface, type TrackSurface } from './surface';

/** A platform's base width: half a beat of track, scaled by `width`. */
export const PLATFORM_BASE_WIDTH = 0.5 * UNITS_PER_BEAT;
/**
 * Height bounds. The floor sits well under TUNING.runner.stepUpHeight so a
 * platform can be authored as a *step* -- walked onto, no jump needed. The old
 * floor of 0.06 was above the step-up height, which silently turned every low
 * step in the library into an obstacle the player had to jump.
 */
export const MIN_HEIGHT = 0.02;
export const MAX_HEIGHT = 0.24;
/** How deep the damaging front face is, in field units. */
export const FACE_DEPTH = 0.035;
/**
 * The block body is the shared mass fill and its standable edge is the colour
 * of its own surface, so a pattern platform and a course slab are the same
 * object as far as the player is concerned. The old edge colour was a third
 * blue that meant "platform" -- a distinction the player had no way to act on,
 * and one that made the landing face disagree with every other landing face in
 * the level about what "you can stand here" looks like.
 */
const BODY_COLOUR = MASS_FILL;
const EDGE_COLOUR = SURFACE_COLOUR;

export class PlatformMechanic extends ScrollingObstacle {
  override readonly damageSource = 'OBSTACLE' as const;

  readonly surface: TrackSurface;
  /** Height above the surface, field units. */
  private readonly height: number;
  private readonly width: number;
  /** World y of the standable face (top on FLOOR, underside on CEILING). */
  private readonly standY: number;

  constructor(spawn: MechanicSpawnContext) {
    super(spawn);
    this.surface = readSurface(this.params.surface);
    this.height = clamp(numberOr(this.params.height, 0.12), MIN_HEIGHT, MAX_HEIGHT);
    this.width = clamp(numberOr(this.params.width, 1), 0.5, 2.5) * PLATFORM_BASE_WIDTH;
    const base = this.surface === 'FLOOR' ? GROUND_Y : CEILING_Y;
    this.standY = this.surface === 'FLOOR' ? base - this.height : base + this.height;
  }

  /** Current horizontal extent, from the scrolling beat-derived x. */
  private extent(): { x0: number; x1: number } {
    const x = this.x;
    return { x0: x - this.width / 2, x1: x + this.width / 2 };
  }

  /** The terrain the player can stand on while the platform is under them. */
  platform(): Platform | null {
    const { x0, x1 } = this.extent();
    const base = this.surface === 'FLOOR' ? GROUND_Y : CEILING_Y;
    return this.surface === 'FLOOR'
      ? { x0, x1, top: this.standY, bottom: base }
      : { x0, x1, top: base, bottom: this.standY };
  }

  /**
   * The leading face: the only part of the block that damages.
   *
   * The track scrolls right-to-left, so the edge the player meets first is x1,
   * not x0. Putting the face on x0 (the trailing edge) meant the hazard was
   * behind the block the player could see coming -- they ran into a solid wall
   * whose damaging part was already past them.
   */
  private face(): Rect {
    const { x1 } = this.extent();
    return this.surface === 'FLOOR'
      ? { x: x1 - FACE_DEPTH, y: this.standY, w: FACE_DEPTH, h: GROUND_Y - this.standY }
      : { x: x1 - FACE_DEPTH, y: CEILING_Y, w: FACE_DEPTH, h: this.standY - CEILING_Y };
  }

  protected dangerShapes(): Shape[] {
    return [{ kind: 'rect', ...this.face() }];
  }

  render(r: Renderer): void {
    const { x0, x1 } = this.extent();
    const w = x1 - x0;
    const stand = this.standY;
    const body: Rect = this.surface === 'FLOOR'
      ? { x: x0, y: stand, w, h: GROUND_Y - stand }
      : { x: x0, y: CEILING_Y, w, h: stand - CEILING_Y };

    // Body + standable edge. The bright line on the edge is the "you can land
    // here" signal; the front face is marked as the part that hurts.
    r.fillRect(body, BODY_COLOUR, 0.95);
    r.line(x0, stand, x1, stand, EDGE_COLOUR[this.surface], 3, 0.95);
    const face = this.face();
    r.fillRect(face, '#ff5c5c', 0.35);
    // Vertical stripes inside the block give it a solid, fixed look against
    // the scrolling track.
    for (let u = 0.25; u < 1; u += 0.25) {
      const x = x0 + w * u;
      r.line(x, body.y + 0.006, x, body.y + body.h - 0.006, MASS_OUTLINE, 1, 0.5);
    }
  }
}

function numberOr(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

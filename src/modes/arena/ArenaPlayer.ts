/**
 * ARENA avatar: free 2D movement inside the unit-square field.
 *
 * Movement is in real seconds, not beats -- control should feel the same at 90
 * or 160 BPM. Only *threats* are beat-locked.
 *
 * There is a short acceleration ramp so starts and stops have weight, but it is
 * deliberately under a tenth of a second: the avatar leans into a direction, it
 * never slides past where the player let go.
 *
 * The class owns the *body* -- position, velocity and the collision circle --
 * and nothing else. How the body is drawn lives in Avatar.ts, behind a cosmetic
 * slot structure, so a skin can change the look without touching any of the
 * movement code (or, more importantly, the hitbox).
 */

import type { Circle } from '../../core/geometry';
import { clamp } from '../../core/geometry';
import type { Renderer } from '../../core/Renderer';
import { TUNING } from '../../tuning';
import { AVATAR_TRAIL_LENGTH, renderAvatar, type Cosmetics } from './Avatar';

const TRAIL_LENGTH = AVATAR_TRAIL_LENGTH;

export class ArenaPlayer {
  x = 0.5;
  y = 0.5;
  /** Collision radius. Deliberately smaller than what is drawn. */
  readonly radius = TUNING.arena.playerRadius;
  private readonly visualRadius = TUNING.arena.playerVisualRadius;
  /**
   * Walking speed. Mutable: a rhythm encounter (A12) damps it while it owns
   * the controls, and the mode restores it from TUNING every frame it does not.
   */
  speed: number = TUNING.arena.playerSpeed;

  /**
   * Cosmetic slots. Assigned once at load and never read by gameplay -- see
   * Avatar.ts. Left as a plain field so a future skin picker has somewhere
   * obvious to write.
   */
  cosmetics: Partial<Cosmetics> | undefined;

  private vx = 0;
  private vy = 0;
  /** Facing, held when stationary so the avatar does not spin on the spot. */
  private facing = -Math.PI / 2;
  private readonly trail: Array<{ x: number; y: number }> = [];

  reset(): void {
    this.x = 0.5;
    this.y = 0.5;
    this.vx = 0;
    this.vy = 0;
    this.facing = -Math.PI / 2;
    this.trail.length = 0;
  }

  update(deltaSeconds: number, axis: { x: number; y: number }): void {
    let { x: dx, y: dy } = axis;
    if (dx !== 0 && dy !== 0) {
      const inv = Math.SQRT1_2; // keep diagonal speed equal to cardinal speed
      dx *= inv;
      dy *= inv;
    }
    // Approach the requested velocity rather than snapping to it. The ramp is
    // short enough that input still feels direct.
    const ramp = deltaSeconds / Math.max(0.001, TUNING.arena.playerAccelSeconds);
    const blend = clamp(ramp, 0, 1);
    this.vx += (dx * this.speed - this.vx) * blend;
    this.vy += (dy * this.speed - this.vy) * blend;

    this.x = clamp(this.x + this.vx * deltaSeconds, this.radius, 1 - this.radius);
    this.y = clamp(this.y + this.vy * deltaSeconds, this.radius, 1 - this.radius);

    // Only re-aim once there is real movement to aim with: a resting avatar
    // that keeps its last heading reads as "waiting", one that snaps to the
    // last key pressed reads as "twitchy".
    if (Math.hypot(this.vx, this.vy) > this.speed * 0.12) {
      this.facing = Math.atan2(this.vy, this.vx);
    }

    this.trail.push({ x: this.x, y: this.y });
    if (this.trail.length > TRAIL_LENGTH) this.trail.shift();
  }

  get circle(): Circle {
    return { x: this.x, y: this.y, r: this.radius };
  }

  /** 0..1 -- how fast the avatar is actually moving. Drives lean and trail. */
  get speedFraction(): number {
    return Math.min(1, Math.hypot(this.vx, this.vy) / this.speed);
  }

  render(r: Renderer, invulnerable: boolean, beat: number): void {
    renderAvatar(r, {
      x: this.x,
      y: this.y,
      angle: this.facing,
      moving: this.speedFraction,
      radius: this.radius,
      visualRadius: this.visualRadius,
      invulnerable,
      beat,
      trail: this.trail,
      cosmetics: this.cosmetics,
    });
  }
}

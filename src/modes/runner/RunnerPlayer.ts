/**
 * RUNNER avatar: fixed x, jump and slide, gravity that can invert.
 *
 * Jump physics are expressed in *beats* and converted to seconds at the current
 * tempo, so a jump always lasts the same musical length -- an obstacle on the
 * next beat is clearable at 90 BPM and at 160 BPM alike. Vertical motion still
 * integrates in real seconds so it stays smooth between beats.
 */

import type { Rect } from '../../core/geometry';
import { clamp } from '../../core/geometry';
import type { Renderer } from '../../core/Renderer';
import { GROUND_Y, PLAYER_X } from '../../mechanics/runner/runnerGeometry';

const STANDING_HEIGHT = 0.13;
const SLIDING_HEIGHT = 0.06;
const WIDTH = 0.055;
/** Airtime of a normal jump, in beats. */
const JUMP_BEATS = 1.35;
/** Apex height of a normal jump, in field units. */
const JUMP_HEIGHT = 0.26;

export class RunnerPlayer {
  /** Distance from the surface the player is standing on (always >= 0). */
  height = 0;
  /** Vertical speed, positive = away from the surface. */
  private velocity = 0;
  private sliding = false;
  private grounded = true;
  /** +1 = normal (floor), -1 = flipped (ceiling). */
  gravityDirection = 1;

  reset(): void {
    this.height = 0;
    this.velocity = 0;
    this.sliding = false;
    this.grounded = true;
    this.gravityDirection = 1;
  }

  /** Surface the player currently stands on, in field y. */
  get surfaceY(): number {
    return this.gravityDirection > 0 ? GROUND_Y : 1 - GROUND_Y;
  }

  /** Body rect in field space. */
  get body(): Rect {
    const h = this.sliding && this.grounded ? SLIDING_HEIGHT : STANDING_HEIGHT;
    const offset = this.height;
    const top = this.gravityDirection > 0
      ? this.surfaceY - offset - h
      : this.surfaceY + offset;
    return { x: PLAYER_X - WIDTH / 2, y: top, w: WIDTH, h };
  }

  get isGrounded(): boolean {
    return this.grounded;
  }

  update(
    deltaSeconds: number,
    secondsPerBeat: number,
    input: { jump: boolean; slide: boolean },
    gravityDirection: number,
    hasFloor: boolean,
  ): void {
    if (gravityDirection !== this.gravityDirection) {
      // Flipping detaches the player from the old surface.
      this.gravityDirection = gravityDirection;
      this.grounded = false;
      this.velocity = Math.max(this.velocity, 0);
    }

    const airSeconds = JUMP_BEATS * secondsPerBeat;
    const gravity = (8 * JUMP_HEIGHT) / (airSeconds * airSeconds);
    const jumpVelocity = (gravity * airSeconds) / 2;

    this.sliding = input.slide && this.grounded;
    if (input.jump && this.grounded && hasFloor) {
      this.velocity = jumpVelocity;
      this.grounded = false;
    }

    if (!this.grounded || !hasFloor) {
      this.velocity -= gravity * deltaSeconds;
      this.height += this.velocity * deltaSeconds;
      if (hasFloor && this.height <= 0) {
        this.height = 0;
        this.velocity = 0;
        this.grounded = true;
      } else if (!hasFloor) {
        this.grounded = false;
      }
    }
    // Falling into a pit: clamp so the avatar leaves the screen rather than
    // shooting off to infinity while the mode decides it was a fall.
    this.height = clamp(this.height, -1.2, 1.2);
  }

  /** Called by a bounce pad. `strength` multiplies a normal jump. */
  launch(secondsPerBeat: number, strength: number): void {
    const airSeconds = JUMP_BEATS * secondsPerBeat;
    const gravity = (8 * JUMP_HEIGHT) / (airSeconds * airSeconds);
    this.velocity = ((gravity * airSeconds) / 2) * strength;
    this.grounded = false;
  }

  /** True once the player has fallen well below the track. */
  get hasFallenOut(): boolean {
    return this.height < -0.25;
  }

  render(r: Renderer, invulnerable: boolean, beat: number): void {
    const blink = invulnerable && Math.floor(beat * 8) % 2 === 0;
    const alpha = blink ? 0.35 : 1;
    const body = this.body;
    r.fillRect(body, '#ffffff', alpha);
    r.strokeRect(body, '#6de3ff', 2, alpha * 0.9);
  }
}

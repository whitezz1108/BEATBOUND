/**
 * RUNNER avatar: auto-run, timed jump, invertible gravity.
 *
 * The design target is a fast rhythm platformer, so the priorities are:
 *   - a jump arc the player can learn in three attempts and then trust,
 *   - inputs that are never eaten,
 *   - no float.
 *
 * The arc is defined in *beats* (TUNING.runner.jumpBeats/jumpHeight) and
 * converted to seconds at the current tempo, so a jump always occupies the same
 * musical length. Obstacle spacing is therefore a rhythmic statement, not a
 * distance that has to be re-tuned per song.
 *
 * Forgiveness comes from two standard platformer affordances rather than from a
 * loose arc:
 *   - input buffering: a jump pressed just before landing fires on touchdown;
 *   - coyote time: a jump just after leaving a surface still works.
 *
 * Releasing the jump key early cuts the rise, so a tap is a hop and a hold is a
 * full jump. That is what makes rapid chains playable without changing gravity.
 */

import type { Rect } from '../../core/geometry';
import { clamp } from '../../core/geometry';
import type { Renderer } from '../../core/Renderer';
import { easeOutCubic } from '../../feel/Easing';
import { CEILING_Y, GROUND_Y, PLAYER_X } from '../../mechanics/runner/runnerGeometry';
import { TUNING } from '../../tuning';

const STANDING_HEIGHT = 0.125;
const SLIDING_HEIGHT = 0.058;
const WIDTH = 0.052;
const TRAIL_LENGTH = 12;

export interface RunnerInput {
  /** True only on the frame the jump key went down. */
  jumpPressed: boolean;
  /** True while the jump key is held. */
  jumpHeld: boolean;
  slide: boolean;
}

export interface RunnerStepResult {
  jumped: boolean;
  landed: boolean;
}

export class RunnerPlayer {
  /** Distance from the surface the player is standing on (>= 0 while alive). */
  height = 0;
  /** Vertical speed, positive = away from the surface. */
  private velocity = 0;
  private sliding = false;
  private grounded = true;
  /** +1 = floor, -1 = ceiling. */
  gravityDirection = 1;

  private bufferedJumpSeconds = 0;
  private coyoteSeconds = 0;
  private jumpHeld = false;
  /** Seconds since the last landing, for the squash animation. */
  private sinceLanding = Infinity;
  private sinceJump = Infinity;
  /** Interpolation while snapping between floor and ceiling. */
  private flipProgress = 1;
  private readonly trail: Array<{ x: number; y: number }> = [];

  reset(): void {
    this.height = 0;
    this.velocity = 0;
    this.sliding = false;
    this.grounded = true;
    this.gravityDirection = 1;
    this.bufferedJumpSeconds = 0;
    this.coyoteSeconds = 0;
    this.sinceLanding = Infinity;
    this.sinceJump = Infinity;
    this.flipProgress = 1;
    this.trail.length = 0;
  }

  /** Surface the player currently stands on, in field y. */
  get surfaceY(): number {
    const target = this.gravityDirection > 0 ? GROUND_Y : CEILING_Y;
    const from = this.gravityDirection > 0 ? CEILING_Y : GROUND_Y;
    // Snap, but over a couple of frames, so the eye can follow the swap.
    return from + (target - from) * easeOutCubic(this.flipProgress);
  }

  get body(): Rect {
    const squash = this.squashScale();
    const height = (this.sliding && this.grounded ? SLIDING_HEIGHT : STANDING_HEIGHT) * squash.y;
    const width = WIDTH * squash.x;
    const surface = this.surfaceY;
    const top = this.gravityDirection > 0
      ? surface - this.height - height
      : surface + this.height;
    return { x: PLAYER_X - width / 2, y: top, w: width, h: height };
  }

  get isGrounded(): boolean {
    return this.grounded;
  }

  get isSliding(): boolean {
    return this.sliding && this.grounded;
  }

  /** Squash on landing, stretch on take-off. Purely cosmetic. */
  private squashScale(): { x: number; y: number } {
    if (this.sinceLanding < 0.16) {
      const t = 1 - this.sinceLanding / 0.16;
      return { x: 1 + 0.25 * t, y: 1 - 0.28 * t };
    }
    if (this.sinceJump < 0.14) {
      const t = 1 - this.sinceJump / 0.14;
      return { x: 1 - 0.16 * t, y: 1 + 0.22 * t };
    }
    return { x: 1, y: 1 };
  }

  /** Gravity and launch velocity for the current tempo. */
  private physics(secondsPerBeat: number): { gravity: number; jumpVelocity: number } {
    const airSeconds = TUNING.runner.jumpBeats * secondsPerBeat;
    const gravity = (8 * TUNING.runner.jumpHeight) / (airSeconds * airSeconds);
    return { gravity, jumpVelocity: (gravity * airSeconds) / 2 };
  }

  update(
    deltaSeconds: number,
    secondsPerBeat: number,
    input: RunnerInput,
    gravityDirection: number,
    hasFloor: boolean,
  ): RunnerStepResult {
    const result: RunnerStepResult = { jumped: false, landed: false };
    const dt = Math.min(deltaSeconds, 0.05);

    if (gravityDirection !== this.gravityDirection) {
      // Flipping keeps the player's distance from the surface, so momentum
      // carries through the inversion instead of being reset.
      this.gravityDirection = gravityDirection;
      this.flipProgress = 0;
      this.grounded = false;
      this.coyoteSeconds = TUNING.runner.coyoteSeconds;
      this.velocity = Math.max(this.velocity, 0);
    }
    if (this.flipProgress < 1) {
      this.flipProgress = clamp(
        this.flipProgress + dt / Math.max(0.01, TUNING.runner.gravitySnapBeats * secondsPerBeat),
        0, 1,
      );
    }

    const { gravity, jumpVelocity } = this.physics(secondsPerBeat);

    // --- input bookkeeping -------------------------------------------------
    if (input.jumpPressed) this.bufferedJumpSeconds = TUNING.runner.inputBufferSeconds;
    else this.bufferedJumpSeconds = Math.max(0, this.bufferedJumpSeconds - dt);
    this.coyoteSeconds = this.grounded && hasFloor
      ? TUNING.runner.coyoteSeconds
      : Math.max(0, this.coyoteSeconds - dt);

    const releasedJump = this.jumpHeld && !input.jumpHeld;
    this.jumpHeld = input.jumpHeld;
    this.sliding = input.slide && this.grounded;

    // --- jump --------------------------------------------------------------
    const canJump = (this.grounded && hasFloor) || this.coyoteSeconds > 0;
    if (this.bufferedJumpSeconds > 0 && canJump) {
      this.velocity = jumpVelocity;
      this.grounded = false;
      this.bufferedJumpSeconds = 0;
      this.coyoteSeconds = 0;
      this.sinceJump = 0;
      result.jumped = true;
    }

    // Variable height: letting go while rising cuts the arc short.
    if (releasedJump && this.velocity > 0) this.velocity *= TUNING.runner.jumpCutFactor;

    // --- integrate ---------------------------------------------------------
    if (!this.grounded || !hasFloor) {
      this.velocity -= gravity * dt;
      this.height += this.velocity * dt;
      if (hasFloor && this.height <= 0 && this.velocity <= 0) {
        this.height = 0;
        this.velocity = 0;
        if (!this.grounded) {
          result.landed = true;
          this.sinceLanding = 0;
        }
        this.grounded = true;
      } else if (!hasFloor) {
        this.grounded = false;
      }
    }
    this.height = clamp(this.height, -1.4, 1.4);

    this.sinceLanding += dt;
    this.sinceJump += dt;

    const body = this.body;
    this.trail.push({ x: body.x + body.w / 2, y: body.y + body.h / 2 });
    if (this.trail.length > TRAIL_LENGTH) this.trail.shift();
    return result;
  }

  /** Called by a bounce pad. `strength` multiplies a normal jump. */
  launch(secondsPerBeat: number, strength: number): void {
    this.velocity = this.physics(secondsPerBeat).jumpVelocity * strength;
    this.grounded = false;
    this.sinceJump = 0;
  }

  /** True once the player has fallen well past the track. */
  get hasFallenOut(): boolean {
    return this.height < -0.3;
  }

  render(r: Renderer, invulnerable: boolean, beat: number): void {
    const blink = invulnerable && Math.floor(beat * 8) % 2 === 0;
    const alpha = blink ? 0.35 : 1;
    const body = this.body;

    if (this.trail.length > 2) {
      r.polyline(this.trail, '#6de3ff', 4, 0.2 * alpha);
    }
    r.glow(body.x + body.w / 2, body.y + body.h / 2, 0.09, '#6de3ff', 0.18 * alpha);
    r.fillRect(body, '#ffffff', alpha);
    r.strokeRect(body, '#6de3ff', 2, alpha * 0.9);
  }
}

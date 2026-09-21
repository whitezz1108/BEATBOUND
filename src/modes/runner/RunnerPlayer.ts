/**
 * RUNNER avatar: auto-run, timed jump, invertible gravity, solid terrain.
 *
 * The design target is a fast rhythm platformer, so the priorities are:
 *   - a jump arc the player can learn in three attempts and then trust,
 *   - inputs that are never eaten,
 *   - no float.
 *
 * The arc is defined in *beats* (see `runnerPhysics.ts`) and converted to
 * seconds at the current tempo, so a jump always occupies the same musical
 * length and the same *shape*. Obstacle spacing is therefore a rhythmic
 * statement, not a distance that has to be re-tuned per song.
 *
 * ## World space, not height-above-a-surface
 *
 * The player's position is the world y of their feet. The previous model stored
 * "height above the surface I last stood on" and landed when that height hit
 * zero -- which made it *impossible to land on anything higher than where the
 * jump started*. A platform whose top was 0.12 above the ground could be jumped
 * over but never stood on: the feet crossed it while `height > 0`, and the only
 * zero-crossing was back at the take-off surface. That single modelling choice
 * is why the old RUNNER had no vertical structure at all.
 *
 * World space also gives head collisions for free, so a low ceiling can stop a
 * jump -- which is what makes a *corridor* a real thing rather than a texture.
 *
 * ## The terrain probe
 *
 * The mode resolves the world around the player each frame and hands it over as
 * a `TerrainProbe`: the surface the feet would land on (`support`), and the
 * solid face the head would hit while rising (`blocker`). Both are world y
 * values, both may be null. This class decides stand / fall / step / land /
 * bonk; it never asks which mechanic produced the terrain.
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
import { CEILING_Y, GROUND_Y, PLAYER_X } from '../../mechanics/runner/runnerGeometry';
import {
  BODY_HEIGHT,
  BODY_WIDTH,
  SLIDE_HEIGHT,
  gravityFor,
  jumpVelocityFor,
  AIR_JUMP_SCALE,
} from '../../mechanics/runner/runnerPhysics';
import type { TerrainProbe } from '../../mechanics/runner/terrainProbe';

/** Beats one double-jump somersault takes: near the second impulse's own airtime. */
const AIR_ROLL_BEATS = 0.5;
import { TUNING } from '../../tuning';

/** Body size lives in TUNING.runner; these exports keep older imports working. */
export const STANDING_HEIGHT = BODY_HEIGHT;
export const SLIDING_HEIGHT = SLIDE_HEIGHT;
/**
 * The avatar is slim on purpose: its half-width is added to every obstacle's
 * danger window, so width directly costs airborne budget in a rapid chain.
 */
export const PLAYER_WIDTH = BODY_WIDTH;
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
  /** The head met a solid face while rising. */
  bonked: boolean;
  /** The player ran off a ledge or out over a hole this frame. */
  leftGround: boolean;
}

export type { TerrainProbe } from '../../mechanics/runner/terrainProbe';

export class RunnerPlayer {
  /** World y of the feet -- the side of the body touching the surface. */
  private feetY = GROUND_Y;
  /** World y speed. Positive moves down the screen. */
  private velocity = 0;
  /**
   * True while the mid-air second jump is available.
   *
   * Every take-off carries exactly one: jump, then -- still airborne -- press
   * jump again for a shorter second impulse (the double jump). Spent by that
   * press, and re-earned on the next take-off; landing and gravity flips
   * clear it. A mid-air ring can re-arm a *spent* one, which is the ring's
   * whole job now: an extra jump the level hands you where it wants one.
   */
  private airJumpArmed = false;
  /**
   * True while the double jump's somersault is still playing out. The roll is
   * purely a read -- the physics is the second impulse -- but it is the whole
   * *point* of the move visually: one clean forward rotation per air jump,
   * started at the press and finished (or clamped) by the landing.
   */
  private airRollActive = false;
  private sliding = false;
  private grounded = true;
  /** +1 = floor, -1 = ceiling. */
  gravityDirection = 1;

  /** World y of the surface physically stood on (ground, ceiling, platform). */
  private supportY = GROUND_Y;
  /** Visual copy of supportY, easing behind so flips and landings read. */
  private visualSupportY = GROUND_Y;

  private bufferedJumpSeconds = 0;
  private coyoteSeconds = 0;
  private jumpHeld = false;
  /** Seconds since the last landing, for the squash animation. */
  private sinceLanding = Infinity;
  private sinceJump = Infinity;
  /** Beats since take-off, or Infinity while grounded. Used by the debug view. */
  private airborneBeats = Infinity;
  private readonly trail: Array<{ x: number; y: number }> = [];

  reset(surfaceY = GROUND_Y): void {
    this.feetY = surfaceY;
    this.velocity = 0;
    this.sliding = false;
    this.grounded = true;
    this.gravityDirection = 1;
    this.supportY = surfaceY;
    this.visualSupportY = surfaceY;
    this.bufferedJumpSeconds = 0;
    this.coyoteSeconds = 0;
    this.sinceLanding = Infinity;
    this.sinceJump = Infinity;
    this.airborneBeats = Infinity;
    this.trail.length = 0;
  }

  /** The surface the player stands on, in field y (visual, eased). */
  get surfaceY(): number {
    return this.visualSupportY;
  }

  /** The surface the player stands on, in field y (physical, exact). */
  get support(): number {
    return this.supportY;
  }

  /** World y of the feet side of the body. */
  get feet(): number {
    return this.feetY;
  }

  /** World y of the head side of the body. */
  get head(): number {
    return this.feetY - this.gravityDirection * this.bodyHeight;
  }

  /** Distance above the surface stood on. Negative once below it (falling). */
  get height(): number {
    return (this.supportY - this.feetY) * this.gravityDirection;
  }

  /** World y speed, positive down the screen. */
  get verticalSpeed(): number {
    return this.velocity;
  }

  /** Beats since take-off, or Infinity while grounded. */
  get beatsAirborne(): number {
    return this.airborneBeats;
  }

  private get bodyHeight(): number {
    return (this.sliding && this.grounded ? SLIDING_HEIGHT : STANDING_HEIGHT) * this.squashScale().y;
  }

  get body(): Rect {
    const squash = this.squashScale();
    const height = (this.sliding && this.grounded ? SLIDING_HEIGHT : STANDING_HEIGHT) * squash.y;
    const width = PLAYER_WIDTH * squash.x;
    const top = this.gravityDirection > 0 ? this.feetY - height : this.feetY;
    return { x: PLAYER_X - width / 2, y: top, w: width, h: height };
  }

  get isGrounded(): boolean {
    return this.grounded;
  }

  /**
   * Arm the mid-air jump: called while a ring is live under the player. The
   * player's own take-off already arms it, so what a ring really grants is a
   * *spent-again* jump -- an extra one, exactly where the level meant to hand
   * it out.
   */
  armAirJump(): void {
    this.airJumpArmed = true;
  }

  /** True while a ring has armed the mid-air second jump and it is unspent. */
  get isAirJumpArmed(): boolean {
    return this.airJumpArmed;
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

  /**
   * The whole step. `probe.support` is the world y of the surface under the
   * player (null over a hole); `probe.blocker` is the world y of a solid face
   * above the head (null when the sky is clear).
   */
  update(
    deltaSeconds: number,
    secondsPerBeat: number,
    input: RunnerInput,
    gravityDirection: number,
    probe: TerrainProbe,
  ): RunnerStepResult {
    const result: RunnerStepResult = { jumped: false, landed: false, bonked: false, leftGround: false };
    const dt = Math.min(deltaSeconds, 0.05);
    const stepUp = TUNING.runner.stepUpHeight;
    const g = gravityDirection;

    if (gravityDirection !== this.gravityDirection) {
      this.airJumpArmed = false;
      this.airRollActive = false;
      // Flipping keeps the player's distance from the surface, so momentum
      // carries through the inversion instead of being reset.
      this.gravityDirection = gravityDirection;
      this.grounded = false;
      this.coyoteSeconds = TUNING.runner.coyoteSeconds;
      this.velocity = 0;
      const base = g > 0 ? GROUND_Y : CEILING_Y;
      this.supportY = base;
      this.feetY = base;
      this.airborneBeats = 0;
      result.leftGround = true;
    }
    // The visual surface trails the physical one, so flips and platform
    // landings read as motion instead of teleports.
    const ease = dt / Math.max(0.01, TUNING.runner.gravitySnapBeats * secondsPerBeat);
    this.visualSupportY += (this.supportY - this.visualSupportY) * clamp(ease, 0, 1);

    const gravity = gravityFor(secondsPerBeat);
    const jumpVelocity = jumpVelocityFor(secondsPerBeat);

    // --- input bookkeeping -------------------------------------------------
    if (input.jumpPressed) this.bufferedJumpSeconds = TUNING.runner.inputBufferSeconds;
    else this.bufferedJumpSeconds = Math.max(0, this.bufferedJumpSeconds - dt);
    this.coyoteSeconds = this.grounded && probe.support !== null
      ? TUNING.runner.coyoteSeconds
      : Math.max(0, this.coyoteSeconds - dt);

    const releasedJump = this.jumpHeld && !input.jumpHeld;
    this.jumpHeld = input.jumpHeld;
    this.sliding = input.slide && this.grounded;

    // --- support tracking while grounded -----------------------------------
    if (this.grounded) {
      if (probe.support === null) {
        // Ran off a ledge over a gap: fall.
        this.grounded = false;
        this.velocity = 0;
        this.airborneBeats = 0;
        result.leftGround = true;
      } else if (Math.abs(probe.support - this.feetY) <= stepUp) {
        // A small step (a low platform, the edge of one): walk onto it.
        this.supportY = probe.support;
        this.feetY = probe.support;
      } else if ((probe.support - this.feetY) * g > stepUp) {
        // The surface under us dropped away (ran off a platform): fall.
        this.grounded = false;
        this.velocity = 0;
        this.airborneBeats = 0;
        result.leftGround = true;
      }
    }

    // --- jump --------------------------------------------------------------
    const canJump = (this.grounded && probe.support !== null) || this.coyoteSeconds > 0;
    if (this.bufferedJumpSeconds > 0 && canJump) {
      this.velocity = -g * jumpVelocity;
      this.grounded = false;
      this.bufferedJumpSeconds = 0;
      this.coyoteSeconds = 0;
      this.sinceJump = 0;
      this.airborneBeats = 0;
      // The take-off earns the double jump: one more press while airborne.
      this.airJumpArmed = true;
      result.jumped = true;
    } else if (this.bufferedJumpSeconds > 0 && this.airJumpArmed && !this.grounded) {
      // The second press of the double jump: a shorter impulse from mid-air,
      // the same scaled velocity the plan and the simulator used. The armed
      // flag is the whole gate -- one air jump per take-off, spent by it.
      this.velocity = -g * jumpVelocity * AIR_JUMP_SCALE;
      this.airJumpArmed = false;
      this.bufferedJumpSeconds = 0;
      this.sinceJump = 0;
      this.airborneBeats = 0;
      this.airRollActive = true;
      result.jumped = true;
    }

    // Variable height: letting go while rising cuts the arc short.
    if (releasedJump && this.velocity * g < 0) this.velocity *= TUNING.runner.jumpCutFactor;

    // --- integrate ---------------------------------------------------------
    if (!this.grounded) {
      const bodyH = STANDING_HEIGHT;
      this.velocity += g * gravity * dt;
      const nextFeet = this.feetY + this.velocity * dt;
      const falling = this.velocity * g > 0;

      // Head collision: stop the rise dead against a solid face. A bonk is not
      // a failure, it is the ceiling telling the player the corridor is tight.
      if (!falling && probe.blocker !== null) {
        const head = nextFeet - g * bodyH;
        if ((head - probe.blocker) * g <= 0) {
          this.feetY = probe.blocker + g * bodyH;
          this.velocity = 0;
          result.bonked = true;
        } else {
          this.feetY = nextFeet;
        }
      } else {
        this.feetY = nextFeet;
      }

      // Landing: the feet have reached a surface while moving with gravity.
      if (falling && probe.support !== null && (this.feetY - probe.support) * g >= 0) {
        this.feetY = probe.support;
        this.velocity = 0;
        this.supportY = probe.support;
        this.grounded = true;
        this.airborneBeats = Infinity;
        this.airJumpArmed = false;
        this.airRollActive = false;
        result.landed = true;
        this.sinceLanding = 0;
      } else {
        this.airborneBeats += dt / Math.max(1e-6, secondsPerBeat);
      }
    }
    this.feetY = clamp(this.feetY, -1.4, 2.4);

    this.sinceLanding += dt;
    this.sinceJump += dt;

    const body = this.body;
    this.trail.push({ x: body.x + body.w / 2, y: body.y + body.h / 2 });
    if (this.trail.length > TRAIL_LENGTH) this.trail.shift();
    return result;
  }

  /** Called by a bounce pad. `strength` multiplies a normal jump. */
  launch(secondsPerBeat: number, strength: number): void {
    this.velocity = -this.gravityDirection * jumpVelocityFor(secondsPerBeat, strength);
    this.grounded = false;
    this.sinceJump = 0;
    this.airborneBeats = 0;
  }

  /**
   * True once the player has fallen well past the track. Measured in world
   * space rather than against the last surface, so falling off a high platform
   * into a pit reads the same as falling into one from the ground.
   */
  get hasFallenOut(): boolean {
    return this.gravityDirection > 0 ? this.feetY > 1.02 : this.feetY < -0.02;
  }

  render(r: Renderer, invulnerable: boolean, beat: number): void {
    const blink = invulnerable && Math.floor(beat * 8) % 2 === 0;
    const alpha = blink ? 0.35 : 1;
    const body = this.body;

    if (this.trail.length > 2) {
      r.polyline(this.trail, '#6de3ff', 4, 0.2 * alpha);
    }
    const cx = body.x + body.w / 2;
    const cy = body.y + body.h / 2;
    r.glow(cx, cy, 0.09, '#6de3ff', 0.18 * alpha);
    // The double jump's somersault: one full forward rotation, timed to the
    // second impulse's own flight. The roll is direction-aware -- forward on
    // the floor route is forward on the ceiling route, read from gravity.
    const rollProgress = this.airRollActive
      ? Math.min(1, this.airborneBeats / AIR_ROLL_BEATS)
      : 0;
    if (rollProgress > 0 && rollProgress < 1) {
      const angle = rollProgress * Math.PI * 2 * this.gravityDirection;
      r.withRotation(cx, cy, angle, () => {
        r.fillRect(body, '#ffffff', alpha);
        r.strokeRect(body, '#6de3ff', 2, alpha * 0.9);
      });
    } else {
      r.fillRect(body, '#ffffff', alpha);
      r.strokeRect(body, '#6de3ff', 2, alpha * 0.9);
    }
  }
}

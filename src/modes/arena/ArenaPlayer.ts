/**
 * ARENA avatar: free 2D movement inside the unit-square field.
 *
 * Movement is in real seconds, not beats -- control should feel the same at 90
 * or 160 BPM. Only *threats* are beat-locked.
 *
 * There is a short acceleration ramp so starts and stops have weight, but it is
 * deliberately under a tenth of a second: the avatar leans into a direction, it
 * never slides past where the player let go.
 */

import type { Circle } from '../../core/geometry';
import { clamp } from '../../core/geometry';
import type { Renderer } from '../../core/Renderer';
import { TUNING } from '../../tuning';

const TRAIL_LENGTH = 10;

export class ArenaPlayer {
  x = 0.5;
  y = 0.5;
  /** Collision radius. Deliberately smaller than what is drawn. */
  readonly radius = TUNING.arena.playerRadius;
  private readonly visualRadius = TUNING.arena.playerVisualRadius;
  speed = TUNING.arena.playerSpeed;

  private vx = 0;
  private vy = 0;
  private readonly trail: Array<{ x: number; y: number }> = [];

  reset(): void {
    this.x = 0.5;
    this.y = 0.5;
    this.vx = 0;
    this.vy = 0;
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
    // Blink during i-frames, on the beat subdivision so feedback stays musical.
    const blink = invulnerable && Math.floor(beat * 8) % 2 === 0;
    const alpha = blink ? 0.35 : 1;
    const moving = this.speedFraction;

    if (this.trail.length > 2 && moving > 0.08) {
      r.polyline(this.trail, '#6de3ff', 3, 0.16 * moving * alpha);
    }

    // Squash along the direction of travel: a subtle lean, never a deformation
    // big enough to change how big the hitbox looks.
    const stretch = 1 + 0.16 * moving;
    const squash = 1 - 0.10 * moving;
    const angle = Math.atan2(this.vy, this.vx);
    const rx = this.visualRadius * (moving > 0.05 ? stretch : 1);
    const ry = this.visualRadius * (moving > 0.05 ? squash : 1);

    const c = r.ctx;
    c.save();
    c.globalAlpha = alpha;
    c.translate(r.px(this.x), r.py(this.y));
    c.rotate(angle);
    c.fillStyle = '#ffffff';
    c.beginPath();
    c.ellipse(0, 0, r.len(rx), r.len(ry), 0, 0, Math.PI * 2);
    c.fill();
    c.restore();

    r.strokeCircle(this.x, this.y, this.visualRadius + 0.006, '#6de3ff', 2, alpha * 0.9);
    // A faint ring at the true collision radius, so what kills you is visible.
    r.strokeCircle(this.x, this.y, this.radius, '#ffffff', 1, alpha * 0.35);
    r.glow(this.x, this.y, this.visualRadius * 3.4, '#6de3ff', 0.16 * alpha);
  }
}

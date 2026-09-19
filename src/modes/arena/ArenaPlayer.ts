/**
 * ARENA avatar: free 2D movement inside the unit-square field.
 *
 * Movement is in real seconds, not beats -- the player's control should feel
 * the same at 90 or 160 BPM. Only *threats* are beat-locked.
 */

import type { Circle } from '../../core/geometry';
import { clamp } from '../../core/geometry';
import type { Renderer } from '../../core/Renderer';

export class ArenaPlayer {
  x = 0.5;
  y = 0.5;
  readonly radius = 0.032;
  /** Field units per second. */
  speed = 0.62;

  reset(): void {
    this.x = 0.5;
    this.y = 0.5;
  }

  update(deltaSeconds: number, axis: { x: number; y: number }): void {
    let { x: dx, y: dy } = axis;
    if (dx !== 0 && dy !== 0) {
      const inv = Math.SQRT1_2; // keep diagonal speed equal to cardinal speed
      dx *= inv;
      dy *= inv;
    }
    this.x = clamp(this.x + dx * this.speed * deltaSeconds, this.radius, 1 - this.radius);
    this.y = clamp(this.y + dy * this.speed * deltaSeconds, this.radius, 1 - this.radius);
  }

  get circle(): Circle {
    return { x: this.x, y: this.y, r: this.radius };
  }

  render(r: Renderer, invulnerable: boolean, beat: number): void {
    // Blink during i-frames, on the beat subdivision so feedback stays musical.
    const blink = invulnerable && Math.floor(beat * 8) % 2 === 0;
    const alpha = blink ? 0.35 : 1;
    r.fillCircle(this.x, this.y, this.radius, '#ffffff', alpha);
    r.strokeCircle(this.x, this.y, this.radius + 0.008, '#6de3ff', 2, alpha * 0.9);
  }
}

/**
 * Fixed-capacity particle pool.
 *
 * One allocation up front, then nothing per emission: particles are recycled
 * from a free list, so a climax section does not start churning garbage. All
 * positions are field-space, so particles letterbox with everything else.
 */

import type { Renderer } from '../core/Renderer';
import { presetScale } from '../tuning';

export type ParticleShape = 'dot' | 'spark' | 'shard';

interface Particle {
  alive: boolean;
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** Seconds lived and total lifetime. */
  age: number;
  life: number;
  size: number;
  drag: number;
  gravity: number;
  spin: number;
  angle: number;
  colour: string;
  shape: ParticleShape;
  /** Drawn under gameplay rather than over it. */
  background: boolean;
}

export interface EmitOptions {
  count?: number;
  /** Mean speed in field units per second. */
  speed?: number;
  speedJitter?: number;
  life?: number;
  lifeJitter?: number;
  size?: number;
  colour?: string;
  shape?: ParticleShape;
  drag?: number;
  gravity?: number;
  /** Radians. Omit for a full circle. */
  direction?: number;
  /** Radians of spread around `direction`. */
  spread?: number;
  background?: boolean;
}

const CAPACITY = 900;

export class ParticlePool {
  private readonly particles: Particle[] = [];
  private cursor = 0;

  constructor() {
    for (let i = 0; i < CAPACITY; i++) {
      this.particles.push({
        alive: false, x: 0, y: 0, vx: 0, vy: 0, age: 0, life: 1, size: 0.01,
        drag: 2, gravity: 0, spin: 0, angle: 0, colour: '#fff', shape: 'dot', background: false,
      });
    }
  }

  get liveCount(): number {
    let n = 0;
    for (const p of this.particles) if (p.alive) n += 1;
    return n;
  }

  clear(): void {
    for (const p of this.particles) p.alive = false;
  }

  /** Emit a burst at a point. Counts are scaled by the polish preset. */
  emit(x: number, y: number, options: EmitOptions = {}): void {
    const scale = presetScale().particles;
    const count = Math.round((options.count ?? 8) * scale);
    const speed = options.speed ?? 0.5;
    const speedJitter = options.speedJitter ?? 0.5;
    const life = options.life ?? 0.45;
    const lifeJitter = options.lifeJitter ?? 0.4;
    const spread = options.spread ?? Math.PI * 2;
    const base = options.direction ?? 0;

    for (let i = 0; i < count; i++) {
      const p = this.take();
      const angle = options.direction === undefined
        ? Math.random() * Math.PI * 2
        : base + (Math.random() - 0.5) * spread;
      const v = speed * (1 + (Math.random() - 0.5) * 2 * speedJitter);
      p.alive = true;
      p.x = x;
      p.y = y;
      p.vx = Math.cos(angle) * v;
      p.vy = Math.sin(angle) * v;
      p.age = 0;
      p.life = life * (1 + (Math.random() - 0.5) * 2 * lifeJitter);
      p.size = (options.size ?? 0.007) * (0.6 + Math.random() * 0.8);
      p.drag = options.drag ?? 2.4;
      p.gravity = options.gravity ?? 0;
      p.angle = angle;
      p.spin = (Math.random() - 0.5) * 12;
      p.colour = options.colour ?? '#ffffff';
      p.shape = options.shape ?? 'dot';
      p.background = options.background ?? false;
    }
  }

  /** Emit along a line -- a chain whip's contact edge, a laser's beam. */
  emitLine(x1: number, y1: number, x2: number, y2: number, options: EmitOptions = {}): void {
    const scale = presetScale().particles;
    const count = Math.round((options.count ?? 10) * scale);
    for (let i = 0; i < count; i++) {
      const t = Math.random();
      this.emit(x1 + (x2 - x1) * t, y1 + (y2 - y1) * t, { ...options, count: 1 });
    }
  }

  update(deltaSeconds: number): void {
    const dt = Math.min(deltaSeconds, 0.05);
    for (const p of this.particles) {
      if (!p.alive) continue;
      p.age += dt;
      if (p.age >= p.life) {
        p.alive = false;
        continue;
      }
      const dragFactor = Math.max(0, 1 - p.drag * dt);
      p.vx *= dragFactor;
      p.vy = p.vy * dragFactor + p.gravity * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.angle += p.spin * dt;
    }
  }

  render(r: Renderer, background: boolean): void {
    for (const p of this.particles) {
      if (!p.alive || p.background !== background) continue;
      const t = p.age / p.life;
      const alpha = 1 - t * t;
      switch (p.shape) {
        case 'spark': {
          const len = p.size * 3;
          r.line(
            p.x - Math.cos(p.angle) * len, p.y - Math.sin(p.angle) * len,
            p.x, p.y, p.colour, 2, alpha,
          );
          break;
        }
        case 'shard': {
          const s = p.size * (1 - t * 0.5);
          r.fillPolygon([
            { x: p.x + Math.cos(p.angle) * s, y: p.y + Math.sin(p.angle) * s },
            { x: p.x + Math.cos(p.angle + 2.3) * s, y: p.y + Math.sin(p.angle + 2.3) * s },
            { x: p.x + Math.cos(p.angle - 2.3) * s, y: p.y + Math.sin(p.angle - 2.3) * s },
          ], p.colour, alpha);
          break;
        }
        default:
          r.fillCircle(p.x, p.y, p.size * (1 - t * 0.6), p.colour, alpha);
      }
    }
  }

  /** Round-robin so a huge burst degrades by replacing the oldest, not failing. */
  private take(): Particle {
    for (let i = 0; i < CAPACITY; i++) {
      this.cursor = (this.cursor + 1) % CAPACITY;
      if (!this.particles[this.cursor].alive) return this.particles[this.cursor];
    }
    this.cursor = (this.cursor + 1) % CAPACITY;
    return this.particles[this.cursor];
  }
}

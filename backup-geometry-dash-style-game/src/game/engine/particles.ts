/**
 * BeatBound — lightweight particle system (pooled, capped).
 */

export interface Particle {
  x: number
  y: number
  vx: number
  vy: number
  life: number
  maxLife: number
  size: number
  color: string
  gravity: number
  kind: 'spark' | 'dust' | 'confetti' | 'ambient'
  rot: number
  vr: number
}

const MAX = 420

export class Particles {
  pool: Particle[] = []

  private spawn(p: Particle): void {
    if (this.pool.length >= MAX) this.pool.shift()
    this.pool.push(p)
  }

  burst(x: number, y: number, color: string, n = 40, power = 14): void {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2
      const v = power * (0.25 + Math.random() * 0.75)
      const life = 0.5 + Math.random() * 0.7
      this.spawn({
        x,
        y,
        vx: Math.cos(a) * v,
        vy: Math.sin(a) * v + 4,
        life,
        maxLife: life,
        size: 2 + Math.random() * 5,
        color: Math.random() < 0.35 ? '#f7f3fb' : color,
        gravity: 26,
        kind: 'spark',
        rot: Math.random() * Math.PI,
        vr: (Math.random() - 0.5) * 12,
      })
    }
  }

  dust(x: number, y: number, color: string, n = 7): void {
    for (let i = 0; i < n; i++) {
      const life = 0.3 + Math.random() * 0.35
      this.spawn({
        x: x + (Math.random() - 0.5) * 0.6,
        y,
        vx: -2 - Math.random() * 4,
        vy: 1 + Math.random() * 3.5,
        life,
        maxLife: life,
        size: 2 + Math.random() * 3,
        color,
        gravity: -3,
        kind: 'dust',
        rot: 0,
        vr: 0,
      })
    }
  }

  confetti(x: number, y: number, colors: string[], n = 70): void {
    for (let i = 0; i < n; i++) {
      const a = -Math.PI / 2 + (Math.random() - 0.5) * 2.2
      const v = 9 + Math.random() * 14
      const life = 1 + Math.random() * 1.2
      this.spawn({
        x,
        y,
        vx: Math.cos(a) * v,
        vy: Math.sin(a) * v,
        life,
        maxLife: life,
        size: 3 + Math.random() * 4,
        color: colors[i % colors.length],
        gravity: 18,
        kind: 'confetti',
        rot: Math.random() * Math.PI,
        vr: (Math.random() - 0.5) * 16,
      })
    }
  }

  /** Beat-reactive ambient motes (rate scales with energy). */
  ambient(x: number, y: number, energy: number): void {
    const life = 0.8 + Math.random() * 0.9
    this.spawn({
      x: x + (Math.random() - 0.5) * 4,
      y: y + Math.random() * 6,
      vx: -1 - Math.random() * 2 * energy,
      vy: 0.5 + Math.random() * 1.5,
      life,
      maxLife: life,
      size: 1 + Math.random() * 2.2,
      color: Math.random() < 0.5 ? '#ff2e7e' : '#ffb02e',
      gravity: 0,
      kind: 'ambient',
      rot: 0,
      vr: 0,
    })
  }

  trail(x: number, y: number, color: string): void {
    const life = 0.22
    this.spawn({
      x,
      y,
      vx: 0,
      vy: 0,
      life,
      maxLife: life,
      size: 0.85,
      color,
      gravity: 0,
      kind: 'ambient',
      rot: 0,
      vr: 0,
    })
  }

  update(dt: number): void {
    const pool = this.pool
    for (let i = pool.length - 1; i >= 0; i--) {
      const p = pool[i]
      p.life -= dt
      if (p.life <= 0) {
        pool.splice(i, 1)
        continue
      }
      p.vy -= p.gravity * dt
      p.x += p.vx * dt
      p.y += p.vy * dt
      p.rot += p.vr * dt
      if (p.kind === 'dust' && p.y < 0.05) {
        p.y = 0.05
        p.vy = 0
        p.vx *= 0.9
      }
    }
  }

  clear(): void {
    this.pool.length = 0
  }
}

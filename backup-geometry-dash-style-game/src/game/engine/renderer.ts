/**
 * BeatBound — canvas renderer.
 * Logical resolution 1280×720, scaled to the element's pixel size.
 * World: x right, y up, y=0 = ground top. 1 unit = 48px.
 */

import type { BuiltLevel, GamePhase } from './types'
import {
  CELL,
  COLORS,
  GATE_BAR_H,
  GATE_BAR_Y,
  GATE_TIP_Y,
  HORIZON_Y,
  PULSE_DEADLY,
  PULSE_R_MAX,
  PULSE_R_MIN,
  SAW_CY,
  SAW_VR,
  VIEW_H,
  VIEW_W,
  VIEW_W_U,
} from './constants'
import { Particles } from './particles'

export interface RenderState {
  t: number
  camX: number
  playerX: number
  playerY: number
  playerRot: number
  squash: number // + = squash (landing), - = stretch (jump)
  grounded: boolean
  alive: boolean
  visible: boolean
  level: BuiltLevel | null
  sectionIdx: number
  bpm: number
  energy: number
  beatPhase: number
  pulse: number
  shake: number
  flash: number
  speedLines: number
  phase: GamePhase
  ambient: boolean
}

interface Deco {
  x: number
  y: number
  r: number
  sides: number
  rot: number
  vr: number
  depth: number
  filled: boolean
}

export class Renderer {
  private ctx: CanvasRenderingContext2D
  private scale = 1
  private vignette: CanvasGradient | null = null
  private far: Deco[] = []
  private mid: Deco[] = []
  private time = 0

  constructor(canvas: HTMLCanvasElement) {
    const c = canvas.getContext('2d', { alpha: false })
    if (!c) throw new Error('2d context unavailable')
    this.ctx = c
    this.initDeco()
  }

  private initDeco(): void {
    let seed = 1337
    const rnd = () => {
      seed = (seed * 16807) % 2147483647
      return seed / 2147483647
    }
    for (let i = 0; i < 12; i++) {
      this.far.push({
        x: rnd() * 1600,
        y: 60 + rnd() * 380,
        r: 26 + rnd() * 70,
        sides: 3 + Math.floor(rnd() * 4),
        rot: rnd() * Math.PI * 2,
        vr: (rnd() - 0.5) * 0.5,
        depth: 0.1 + rnd() * 0.08,
        filled: false,
      })
    }
    for (let i = 0; i < 16; i++) {
      this.mid.push({
        x: rnd() * 1600,
        y: 90 + rnd() * 330,
        r: 5 + rnd() * 13,
        sides: 3 + Math.floor(rnd() * 3),
        rot: rnd() * Math.PI * 2,
        vr: (rnd() - 0.5) * 1.4,
        depth: 0.25 + rnd() * 0.2,
        filled: rnd() < 0.5,
      })
    }
  }

  resize(cssW: number, cssH: number, dpr: number): void {
    const canvas = this.ctx.canvas
    canvas.width = Math.round(cssW * dpr)
    canvas.height = Math.round(cssH * dpr)
    this.scale = (canvas.width / VIEW_W + canvas.height / VIEW_H) / 2
    this.vignette = null
  }

  render(s: RenderState): void {
    const ctx = this.ctx
    this.time += 1 / 60
    ctx.setTransform(this.scale, 0, 0, this.scale, 0, 0)

    // screen shake
    if (s.shake > 0.001) {
      const m = s.shake * 9
      ctx.translate((Math.random() - 0.5) * m, (Math.random() - 0.5) * m)
    }

    this.drawBackground(s)
    this.drawGround(s)

    if (s.level && !s.ambient) {
      this.drawObstacles(s)
      this.drawFinish(s)
    }

    this.drawParticles(s)
    if (s.visible && s.alive) this.drawPlayer(s)

    // speed lines (transition / remix energy)
    if (s.speedLines > 0.01) this.drawSpeedLines(s)

    // flash + vignette
    if (s.flash > 0.01) {
      ctx.save()
      ctx.globalAlpha = Math.min(1, s.flash) * 0.8
      ctx.fillStyle = '#ffe9f2'
      ctx.fillRect(0, 0, VIEW_W, VIEW_H)
      ctx.restore()
    }
    this.drawVignette(s)
  }

  /* ────────────── background ────────────── */

  private drawBackground(s: RenderState): void {
    const ctx = this.ctx
    const e = Math.min(1.35, s.energy)
    const g = ctx.createLinearGradient(0, 0, 0, VIEW_H)
    g.addColorStop(0, COLORS.bg0)
    g.addColorStop(0.62 + e * 0.06, COLORS.bg1)
    g.addColorStop(1, '#241028')
    ctx.fillStyle = g
    ctx.fillRect(-20, -20, VIEW_W + 40, VIEW_H + 40)

    // far wireframe polygons
    ctx.save()
    ctx.lineWidth = 1.5
    for (const d of this.far) {
      const px = ((d.x - s.camX * CELL * d.depth) % (VIEW_W + 260) + VIEW_W + 260) % (VIEW_W + 260) - 130
      d.rot += d.vr * 0.016 * (0.6 + e)
      const r = d.r * (1 + s.pulse * 0.12 * e)
      ctx.globalAlpha = 0.05 + s.pulse * 0.09 * e
      ctx.strokeStyle = d.depth > 0.13 ? COLORS.primary : COLORS.amber
      this.poly(px, d.y, r, d.sides, d.rot)
      ctx.stroke()
    }
    ctx.restore()

    // mid shapes
    ctx.save()
    for (const d of this.mid) {
      const px = ((d.x - s.camX * CELL * d.depth) % (VIEW_W + 160) + VIEW_W + 160) % (VIEW_W + 160) - 80
      d.rot += d.vr * 0.016 * (0.6 + e)
      const py = d.y + Math.sin(this.time * 0.9 + d.x) * 7
      ctx.globalAlpha = 0.1 + s.pulse * 0.14
      ctx.fillStyle = d.filled ? COLORS.primary : COLORS.mint
      this.poly(px, py, d.r * (1 + s.pulse * 0.18), d.sides, d.rot)
      if (d.filled) ctx.fill()
      else {
        ctx.lineWidth = 1.6
        ctx.stroke()
      }
    }
    ctx.restore()
  }

  private poly(x: number, y: number, r: number, sides: number, rot: number): void {
    const ctx = this.ctx
    ctx.beginPath()
    for (let i = 0; i < sides; i++) {
      const a = rot + (i / sides) * Math.PI * 2
      const px = x + Math.cos(a) * r
      const py = y + Math.sin(a) * r
      if (i === 0) ctx.moveTo(px, py)
      else ctx.lineTo(px, py)
    }
    ctx.closePath()
  }

  /* ────────────── ground ────────────── */

  private drawGround(s: RenderState): void {
    const ctx = this.ctx
    const gy = HORIZON_Y

    // base fill
    ctx.fillStyle = COLORS.ground
    ctx.fillRect(-20, gy, VIEW_W + 40, VIEW_H - gy + 20)

    // scrolling grid
    ctx.save()
    ctx.beginPath()
    ctx.rect(-20, gy, VIEW_W + 40, VIEW_H - gy + 20)
    ctx.clip()
    const startU = Math.floor(s.camX) - 1
    for (let u = startU; u < s.camX + VIEW_W_U + 2; u++) {
      const sx = (u - s.camX) * CELL
      const isBeat = Math.abs(((u % 4) + 4) % 4) < 0.01
      ctx.strokeStyle = isBeat ? 'rgba(255,46,126,0.16)' : 'rgba(255,255,255,0.045)'
      ctx.lineWidth = isBeat ? 2 : 1
      ctx.beginPath()
      ctx.moveTo(sx, gy)
      ctx.lineTo(sx - 60, VIEW_H)
      ctx.stroke()
    }
    // horizontal scan pulse
    const scanY = gy + 26 + s.pulse * 10
    ctx.globalAlpha = 0.25 * s.pulse + 0.05
    ctx.fillStyle = COLORS.primary
    ctx.fillRect(-20, scanY, VIEW_W + 40, 2)
    ctx.restore()

    // gaps carve
    if (s.level) {
      for (const gap of s.level.gaps) {
        const x0 = (gap.x - s.camX) * CELL
        if (x0 > VIEW_W + 60 || x0 + gap.w * CELL < -60) continue
        const w = gap.w * CELL
        // void
        const gg = ctx.createLinearGradient(0, gy - 6, 0, gy + 90)
        gg.addColorStop(0, '#0b0710')
        gg.addColorStop(1, 'rgba(11,7,16,0)')
        ctx.fillStyle = gg
        ctx.fillRect(x0, gy - 6, w, 96)
        // glowing lips
        ctx.fillStyle = COLORS.danger
        ctx.shadowColor = COLORS.danger
        ctx.shadowBlur = 12
        ctx.fillRect(x0 - 3, gy - 2, 5, 10)
        ctx.fillRect(x0 + w - 2, gy - 2, 5, 10)
        ctx.shadowBlur = 0
      }
    }

    // horizon glow line
    ctx.save()
    ctx.strokeStyle = COLORS.white
    ctx.lineWidth = 2.5
    ctx.shadowColor = COLORS.primary
    ctx.shadowBlur = 14 + s.pulse * 16
    ctx.globalAlpha = 0.85
    ctx.beginPath()
    ctx.moveTo(0, gy + 0.5)
    ctx.lineTo(VIEW_W, gy + 0.5)
    ctx.stroke()
    ctx.restore()
  }

  /* ────────────── obstacles ────────────── */

  private drawObstacles(s: RenderState): void {
    if (!s.level) return
    const ctx = this.ctx
    const lo = s.camX - 3
    const hi = s.camX + VIEW_W_U + 3
    for (const o of s.level.obstacles) {
      if (o.x + o.w < lo) continue
      if (o.x > hi) break
      switch (o.kind) {
        case 'spike':
          this.drawSpike(s, o.x, 0, 1, 1, COLORS.primary)
          break
        case 'spikeSmall':
          this.drawSpike(s, o.x, 0, 1, 0.5, COLORS.primary)
          break
        case 'block':
          this.drawBlock(s, o.x, o.y, o.w, o.h)
          break
        case 'ceilGate':
          this.drawGate(s, o.x, o.w)
          break
        case 'saw':
          this.drawSaw(s, o)
          break
        case 'pulse':
          this.drawPulse(s, o)
          break
        default:
          break
      }
    }
  }

  private drawSpike(
    s: RenderState,
    wx: number,
    wy: number,
    w: number,
    h: number,
    color: string
  ): void {
    const ctx = this.ctx
    const x = (wx - s.camX) * CELL
    const y = HORIZON_Y - wy * CELL
    const pw = w * CELL
    const ph = h * CELL
    ctx.save()
    ctx.shadowColor = color
    ctx.shadowBlur = 12
    const grad = ctx.createLinearGradient(x, y - ph, x, y)
    grad.addColorStop(0, color)
    grad.addColorStop(1, 'rgba(255,46,126,0.25)')
    ctx.fillStyle = grad
    ctx.beginPath()
    ctx.moveTo(x + 1, y)
    ctx.lineTo(x + pw / 2, y - ph)
    ctx.lineTo(x + pw - 1, y)
    ctx.closePath()
    ctx.fill()
    ctx.shadowBlur = 0
    ctx.strokeStyle = COLORS.white
    ctx.globalAlpha = 0.75
    ctx.lineWidth = 1.4
    ctx.stroke()
    ctx.restore()
  }

  private drawBlock(s: RenderState, wx: number, wy: number, w: number, h: number): void {
    const ctx = this.ctx
    const x = (wx - s.camX) * CELL
    const y = HORIZON_Y - wy * CELL
    const pw = w * CELL
    const ph = h * CELL
    ctx.save()
    ctx.fillStyle = '#1c1022'
    ctx.fillRect(x, y - ph, pw, ph)
    ctx.strokeStyle = COLORS.mint
    ctx.lineWidth = 2
    ctx.shadowColor = COLORS.mint
    ctx.shadowBlur = 10
    ctx.strokeRect(x + 1, y - ph + 1, pw - 2, ph - 2)
    // bright landing edge
    ctx.shadowBlur = 0
    ctx.strokeStyle = COLORS.white
    ctx.lineWidth = 3
    ctx.beginPath()
    ctx.moveTo(x + 2, y - ph)
    ctx.lineTo(x + pw - 2, y - ph)
    ctx.stroke()
    // inner chevrons
    ctx.globalAlpha = 0.25
    ctx.strokeStyle = COLORS.mint
    ctx.lineWidth = 1.5
    for (let i = 0; i < w; i++) {
      ctx.beginPath()
      ctx.moveTo(x + i * CELL + 8, y - 8)
      ctx.lineTo(x + i * CELL + CELL / 2, y - ph + 8)
      ctx.lineTo(x + i * CELL + CELL - 8, y - 8)
      ctx.stroke()
    }
    ctx.restore()
  }

  private drawGate(s: RenderState, wx: number, w: number): void {
    const ctx = this.ctx
    const x = (wx - s.camX) * CELL
    const pw = w * CELL
    const barY = HORIZON_Y - GATE_BAR_Y * CELL
    ctx.save()
    // solid bar
    ctx.fillStyle = '#241028'
    ctx.fillRect(x, barY, pw, GATE_BAR_H * CELL)
    ctx.strokeStyle = COLORS.danger
    ctx.lineWidth = 2
    ctx.shadowColor = COLORS.danger
    ctx.shadowBlur = 10
    ctx.strokeRect(x + 1, barY + 1, pw - 2, GATE_BAR_H * CELL - 2)
    ctx.shadowBlur = 0
    // hanging spikes
    const n = Math.round(w)
    for (let i = 0; i < n; i++) {
      const sx = x + i * CELL
      const tip = HORIZON_Y - GATE_TIP_Y * CELL
      const grad = ctx.createLinearGradient(0, barY + GATE_BAR_H * CELL, 0, tip)
      grad.addColorStop(0, COLORS.danger)
      grad.addColorStop(1, 'rgba(255,75,62,0.2)')
      ctx.fillStyle = grad
      ctx.beginPath()
      ctx.moveTo(sx + 6, barY + GATE_BAR_H * CELL)
      ctx.lineTo(sx + CELL / 2, tip)
      ctx.lineTo(sx + CELL - 6, barY + GATE_BAR_H * CELL)
      ctx.closePath()
      ctx.fill()
    }
    // "no jump" shimmer on the ground below
    ctx.globalAlpha = 0.16 + s.pulse * 0.2
    ctx.fillStyle = COLORS.danger
    ctx.fillRect(x + 4, HORIZON_Y - 3, pw - 8, 3)
    ctx.restore()
  }

  private drawSaw(s: RenderState, o: { cx?: number; cy?: number; vr?: number }): void {
    if (o.cx == null || o.vr == null) return
    const ctx = this.ctx
    const cx = (o.cx - s.camX) * CELL
    const cy = HORIZON_Y - SAW_CY * CELL
    const r = o.vr * CELL
    const angle = s.t * 7
    ctx.save()
    ctx.translate(cx, cy)
    ctx.rotate(angle)
    // teeth
    ctx.fillStyle = COLORS.amber
    ctx.shadowColor = COLORS.amber
    ctx.shadowBlur = 14
    ctx.beginPath()
    const teeth = 8
    for (let i = 0; i < teeth * 2; i++) {
      const rr = i % 2 === 0 ? r : r * 0.74
      const a = (i / (teeth * 2)) * Math.PI * 2
      const px = Math.cos(a) * rr
      const py = Math.sin(a) * rr
      if (i === 0) ctx.moveTo(px, py)
      else ctx.lineTo(px, py)
    }
    ctx.closePath()
    ctx.fill()
    // hub
    ctx.shadowBlur = 0
    ctx.fillStyle = '#2a1524'
    ctx.beginPath()
    ctx.arc(0, 0, r * 0.4, 0, Math.PI * 2)
    ctx.fill()
    ctx.strokeStyle = COLORS.white
    ctx.globalAlpha = 0.7
    ctx.lineWidth = 2
    ctx.stroke()
    ctx.restore()
  }

  private drawPulse(s: RenderState, o: { cx?: number }): void {
    if (o.cx == null) return
    const ctx = this.ctx
    const cx = (o.cx - s.camX) * CELL
    const gy = HORIZON_Y
    // ring radius follows the beat envelope
    const env = Math.exp(-s.beatPhase * 4)
    const R = (PULSE_R_MIN + (PULSE_R_MAX - PULSE_R_MIN) * env) * CELL
    const danger = PULSE_R_MIN + (PULSE_R_MAX - PULSE_R_MIN) * env > PULSE_DEADLY
    const color = danger ? COLORS.danger : COLORS.primary
    ctx.save()
    ctx.shadowColor = color
    ctx.shadowBlur = 14
    ctx.strokeStyle = color
    ctx.lineWidth = 3.5
    ctx.globalAlpha = 0.9
    ctx.beginPath()
    ctx.arc(cx, gy, R, Math.PI, 0)
    ctx.stroke()
    // expanding echo
    ctx.globalAlpha = 0.35 * (1 - s.beatPhase)
    ctx.lineWidth = 2
    ctx.beginPath()
    ctx.arc(cx, gy, PULSE_R_MAX * CELL * (0.3 + s.beatPhase * 0.9), Math.PI, 0)
    ctx.stroke()
    // base plate
    ctx.globalAlpha = 0.9
    ctx.fillStyle = '#2a1524'
    ctx.beginPath()
    ctx.ellipse(cx, gy, 10, 4, 0, 0, Math.PI * 2)
    ctx.fill()
    ctx.restore()
  }

  private drawFinish(s: RenderState): void {
    if (!s.level) return
    const ctx = this.ctx
    const fx = (s.level.finishX - s.camX) * CELL
    if (fx > VIEW_W + 80 || fx < -80) return
    const gy = HORIZON_Y
    const top = gy - 3.4 * CELL
    ctx.save()
    ctx.shadowColor = COLORS.amber
    ctx.shadowBlur = 22 + s.pulse * 14
    ctx.strokeStyle = COLORS.amber
    ctx.lineWidth = 5
    ctx.beginPath()
    ctx.moveTo(fx, gy)
    ctx.lineTo(fx, top)
    ctx.stroke()
    ctx.lineWidth = 3
    ctx.globalAlpha = 0.85
    ctx.beginPath()
    ctx.ellipse(fx, gy - 1.7 * CELL, 26 + s.pulse * 8, 1.7 * CELL, 0, 0, Math.PI * 2)
    ctx.stroke()
    // orbiting sparks
    ctx.shadowBlur = 0
    ctx.fillStyle = COLORS.white
    for (let i = 0; i < 5; i++) {
      const a = s.t * 2.2 + (i / 5) * Math.PI * 2
      const px = fx + Math.cos(a) * 26
      const py = gy - 1.7 * CELL + Math.sin(a) * 1.7 * CELL
      ctx.globalAlpha = 0.8
      ctx.beginPath()
      ctx.arc(px, py, 2.6, 0, Math.PI * 2)
      ctx.fill()
    }
    ctx.restore()
  }

  /* ────────────── player ────────────── */

  private drawPlayer(s: RenderState): void {
    const ctx = this.ctx
    const px = (s.playerX - s.camX) * CELL
    const py = HORIZON_Y - s.playerY * CELL
    const size = CELL
    const sq = s.squash
    const sw = size * (1 + sq * 0.65)
    const sh = size * (1 - sq)

    ctx.save()
    ctx.translate(px, py - sh / 2)
    if (!s.grounded) ctx.rotate(s.playerRot)
    else ctx.rotate(s.playerRot)

    // glow
    ctx.shadowColor = COLORS.primary
    ctx.shadowBlur = 18
    const grad = ctx.createLinearGradient(-sw / 2, -sh / 2, sw / 2, sh / 2)
    grad.addColorStop(0, COLORS.primary)
    grad.addColorStop(1, COLORS.amber)
    ctx.fillStyle = grad
    const r = 7
    ctx.beginPath()
    ctx.roundRect(-sw / 2, -sh / 2, sw, sh, r)
    ctx.fill()
    ctx.shadowBlur = 0

    // inner face plate
    ctx.fillStyle = 'rgba(12,7,16,0.55)'
    ctx.beginPath()
    ctx.roundRect(-sw / 2 + 6, -sh / 2 + 6, sw - 12, sh - 12, 4)
    ctx.fill()

    // eyes
    ctx.fillStyle = COLORS.white
    ctx.beginPath()
    ctx.roundRect(-sw / 2 + sw * 0.18, -sh * 0.22, sw * 0.14, sh * 0.3, 2)
    ctx.roundRect(sw / 2 - sw * 0.32, -sh * 0.22, sw * 0.14, sh * 0.3, 2)
    ctx.fill()
    ctx.restore()
  }

  /* ────────────── particles & fx ────────────── */

  private drawParticles(s: RenderState): void {
    void s
  }

  drawParticlePool(particles: Particles, s: RenderState): void {
    const ctx = this.ctx
    ctx.save()
    for (const p of particles.pool) {
      const px = (p.x - s.camX) * CELL
      const py = HORIZON_Y - p.y * CELL
      if (px < -30 || px > VIEW_W + 30) continue
      const a = Math.max(0, p.life / p.maxLife)
      ctx.globalAlpha = a * 0.9
      ctx.fillStyle = p.color
      if (p.kind === 'confetti' || p.kind === 'spark') {
        ctx.save()
        ctx.translate(px, py)
        ctx.rotate(p.rot)
        ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size * (p.kind === 'confetti' ? 0.55 : 1))
        ctx.restore()
      } else {
        ctx.beginPath()
        ctx.arc(px, py, p.size, 0, Math.PI * 2)
        ctx.fill()
      }
    }
    ctx.restore()
  }

  private drawSpeedLines(s: RenderState): void {
    const ctx = this.ctx
    ctx.save()
    ctx.strokeStyle = COLORS.white
    ctx.lineWidth = 2
    for (let i = 0; i < 12; i++) {
      const seed = i * 97.13
      const y = ((Math.sin(seed) * 0.5 + 0.5) * (HORIZON_Y - 40) + 20) | 0
      const len = 90 + ((Math.cos(seed * 3) * 0.5 + 0.5) * 160) | 0
      const speed = 900 + i * 60
      const x = VIEW_W - (((this.time * speed + seed * 200) % (VIEW_W + 300)) | 0)
      ctx.globalAlpha = s.speedLines * (0.05 + (i % 4) * 0.035)
      ctx.beginPath()
      ctx.moveTo(x, y)
      ctx.lineTo(x + len, y)
      ctx.stroke()
    }
    ctx.restore()
  }

  private drawVignette(s: RenderState): void {
    const ctx = this.ctx
    if (!this.vignette) {
      const g = ctx.createRadialGradient(
        VIEW_W / 2,
        VIEW_H / 2,
        VIEW_H * 0.42,
        VIEW_W / 2,
        VIEW_H / 2,
        VIEW_H * 0.95
      )
      g.addColorStop(0, 'rgba(0,0,0,0)')
      g.addColorStop(1, 'rgba(5,2,8,0.55)')
      this.vignette = g
    }
    ctx.save()
    ctx.globalAlpha = 0.75 + s.pulse * 0.25 * Math.min(1, s.energy)
    ctx.fillStyle = this.vignette
    ctx.fillRect(0, 0, VIEW_W, VIEW_H)
    ctx.restore()
  }
}

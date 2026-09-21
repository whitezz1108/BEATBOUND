/**
 * BeatBound — core game engine.
 *
 * Auto-runner with jump-only control. Physics uses a fixed 1/240s timestep
 * driven by the audio clock (AudioContext.currentTime), so gameplay stays
 * locked to the music and freezes cleanly on pause.
 *
 * All song/level-specific data lives in src/game/levels — this engine only
 * understands world-space obstacles, gaps and sections.
 */

import type { BuiltLevel, BuiltSection, GameEvent, GamePhase } from './types'
import {
  CAM_ANCHOR,
  DEATH_Y,
  GATE_BAR_H,
  GATE_TIP_Y,
  GRAVITY,
  JUMP_BUFFER,
  JUMP_V,
  MAX_FRAME_DT,
  PLAYER_HALF,
  PLAYER_HIT,
  PLAYER_HAZ,
  PULSE_DEADLY,
  PULSE_R_MAX,
  PULSE_R_MIN,
  RETRY_LOCK,
  SPIKE_SMALL_TOP,
  SPIKE_TOP,
  STEP,
  SAW_R,
  SAW_CY,
  VIEW_W_U,
  storageKey,
} from './constants'
import { AudioEngine } from './audio'
import { Particles } from './particles'
import { Renderer, type RenderState } from './renderer'

interface PlayerState {
  x: number
  y: number
  vy: number
  rot: number
  grounded: boolean
  squash: number
}

export class GameEngine {
  private renderer: Renderer
  private audio: AudioEngine
  private onEvent: (e: GameEvent) => void
  private raf = 0
  private lastNow = 0
  private acc = 0

  level: BuiltLevel | null = null
  phase: GamePhase = 'idle'
  private player: PlayerState = { x: 0, y: 0, vy: 0, rot: 0, grounded: true, squash: 0 }
  private camX = 0
  private t = 0 // song time
  private attempt = 0
  private best = 0
  private totalAttempts = 0
  private progressPct = 0
  private lastEmittedPct = -1
  private held = false
  private buffer = 0
  private deadAt = 0
  private retryLockUntil = 0
  private shake = 0
  private flash = 0
  private speedLines = 0
  private sectionIdx = 0
  private textIdx = 0
  private ambient = false
  private isTutorial = false
  private finished = false
  private particles = new Particles()
  private trailTimer = 0
  private ambientTimer = 0

  constructor(
    canvas: HTMLCanvasElement,
    audio: AudioEngine,
    onEvent: (e: GameEvent) => void
  ) {
    this.renderer = new Renderer(canvas)
    this.audio = audio
    this.onEvent = onEvent
    this.raf = requestAnimationFrame(this.loop)
  }

  /* ────────────── public API ────────────── */

  resize(cssW: number, cssH: number): void {
    const dpr = Math.min(2, window.devicePixelRatio || 1)
    this.renderer.resize(cssW, cssH, dpr)
  }

  loadLevel(level: BuiltLevel, mode: 'level' | 'tutorial'): void {
    this.level = level
    this.isTutorial = mode === 'tutorial'
    this.best = Number(localStorage.getItem(storageKey(level.id, 'best')) ?? 0)
    this.totalAttempts = Number(localStorage.getItem(storageKey(level.id, 'attempts')) ?? 0)
  }

  getBest(): number {
    return this.best
  }
  getTotalAttempts(): number {
    return this.totalAttempts
  }

  start(): void {
    if (!this.level) return
    this.attempt += 1
    this.totalAttempts += 1
    localStorage.setItem(storageKey(this.level.id, 'attempts'), String(this.totalAttempts))
    this.finished = false
    this.sectionIdx = 0
    this.textIdx = 0
    this.progressPct = 0
    this.lastEmittedPct = -1
    this.resetPlayer()
    this.particles.clear()
    this.shake = 0
    this.flash = 0
    this.speedLines = 0
    this.ambient = false

    const s0 = this.level.sections[0]
    this.audio.startRun({
      durO: this.level.audioDur[0] ?? 60,
      durR: this.level.audioDur[1] ?? 40,
      bpmO: s0.bpm,
      bpmR: this.level.sections[this.level.sections.length - 1].bpm,
      transT: s0.endTime,
      leadIn: this.level.leadIn,
      totalDur: this.level.totalDuration,
    })

    this.t = -this.level.leadIn
    this.lastNow = this.audio.now()
    this.acc = 0
    this.setPhase('ready')
    this.emit({ type: 'attempt', attempt: this.attempt })
    this.emit({ type: 'section', index: 0, name: s0.name, label: s0.label })
    if (this.isTutorial && this.level.texts.length > 0) {
      this.emit({ type: 'text', text: this.level.texts[0].text })
    }
  }

  retry(): void {
    if (this.phase === 'dead' || this.phase === 'complete') this.start()
  }

  pause(): void {
    if (this.phase !== 'running' && this.phase !== 'ready') return
    void this.audio.pause()
    this.setPhase('paused')
  }

  resume(): void {
    if (this.phase !== 'paused') return
    void this.audio.resume()
    this.lastNow = this.audio.now()
    this.acc = 0
    this.setPhase(this.t < 0 ? 'ready' : 'running')
  }

  togglePause(): void {
    if (this.phase === 'paused') this.resume()
    else this.pause()
  }

  backToMenu(): void {
    this.audio.stopRun()
    this.level = null
    this.ambient = true
    this.setPhase('idle')
  }

  startAmbient(): void {
    this.level = null
    this.ambient = true
    this.setPhase('idle')
  }

  press(): void {
    if (this.phase === 'dead') {
      if (performance.now() >= this.retryLockUntil) this.start()
      return
    }
    this.buffer = JUMP_BUFFER
    this.held = true
  }

  release(): void {
    this.held = false
  }

  destroy(): void {
    cancelAnimationFrame(this.raf)
    this.audio.stopRun()
  }

  /* ────────────── internal ────────────── */

  /** true once the current run has ended (dead or complete). */
  private runEnded(): boolean {
    return this.phase === 'dead' || this.phase === 'complete'
  }

  private setPhase(p: GamePhase): void {
    this.phase = p
    this.emit({ type: 'phase', phase: p })
  }

  private emit(e: GameEvent): void {
    this.onEvent(e)
  }

  private resetPlayer(): void {
    this.player = { x: 2, y: 0, vy: 0, rot: 0, grounded: true, squash: 0 }
    this.camX = this.player.x - VIEW_W_U * CAM_ANCHOR
    this.held = false
    this.buffer = 0
  }

  private loop = (): void => {
    this.raf = requestAnimationFrame(this.loop)
    if (this.phase === 'paused') {
      this.render()
      return
    }
    const now =
      this.ambient || !this.audio.ready ? performance.now() / 1000 : this.audio.now()
    let dt = now - this.lastNow
    this.lastNow = now
    if (dt < 0) dt = 0
    if (dt > MAX_FRAME_DT) dt = MAX_FRAME_DT

    if (this.ambient || !this.level) {
      this.updateAmbient(dt)
    } else if (this.phase === 'running' || this.phase === 'ready') {
      this.acc += dt
      while (this.acc >= STEP) {
        this.step(STEP)
        this.acc -= STEP
        if (this.runEnded()) break
      }
    }
    this.updateFx(dt)
    this.render()
  }

  private updateAmbient(dt: number): void {
    this.t += dt
    this.ambientTimer -= dt
    if (this.ambientTimer <= 0) {
      this.ambientTimer = 0.12
      this.particles.ambient(this.camX + VIEW_W_U * (0.2 + Math.random() * 0.7), 1 + Math.random() * 4, 0.5)
    }
    this.particles.update(dt)
    this.camX += dt * 2.2
    this.player.x = this.camX + VIEW_W_U * CAM_ANCHOR
    this.player.y = 0
  }

  private updateFx(dt: number): void {
    this.shake = Math.max(0, this.shake - dt * 2.4)
    this.flash = Math.max(0, this.flash - dt * 2.2)
    if (this.level && this.sectionIdx >= 1) {
      const target = Math.min(0.5, this.speedLines + dt * 0.5)
      this.speedLines = target
    }
    this.player.squash *= Math.max(0, 1 - dt * 9)
  }

  /* ────────────── fixed-step simulation ────────────── */

  private step(dt: number): void {
    const level = this.level
    if (!level) return
    this.t += dt

    if (this.t < 0) return // lead-in

    if (this.phase === 'ready') this.setPhase('running')

    const sec = this.sectionAt(this.t)
    if (sec) {
      const idx = level.sections.indexOf(sec)
      if (idx !== this.sectionIdx) {
        this.sectionIdx = idx
        this.flash = 1
        this.shake = 0.6
        this.emit({ type: 'section', index: idx, name: sec.name, label: sec.label })
      }
    }

    const speed = sec ? sec.speed : 9
    const p = this.player
    const prevY = p.y

    // horizontal auto-run
    p.x += speed * dt

    // jump input (buffered + hold-to-rejump)
    this.buffer = Math.max(0, this.buffer - dt)
    if (p.grounded && (this.held || this.buffer > 0)) {
      p.vy = JUMP_V
      p.grounded = false
      this.buffer = 0
      p.squash = -0.22
      this.audio.sfxJump()
      this.particles.dust(p.x - 0.3, 0.1, '#ffb02e', 4)
    }

    // vertical integration
    if (!p.grounded) {
      p.vy -= GRAVITY * dt
      p.y += p.vy * dt
      p.rot += 6.0 * dt
    } else {
      p.rot = this.snapRot(p.rot, dt)
    }

    // tutorial floating texts
    while (
      this.isTutorial &&
      this.textIdx < level.texts.length &&
      p.x >= level.texts[this.textIdx].x
    ) {
      this.textIdx += 1
      if (this.textIdx < level.texts.length) {
        this.emit({ type: 'text', text: level.texts[this.textIdx].text })
      }
    }

    // collisions & landing
    this.collide(prevY, speed)
    if (this.phase !== 'running' && this.phase !== 'ready') return

    // fell into a gap
    if (p.y < DEATH_Y) {
      this.die()
      return
    }

    // finish
    if (!this.finished && p.x >= level.finishX) {
      this.finished = true
      this.complete()
      return
    }

    // progress
    const pct = Math.min(100, Math.max(0, Math.round((p.x / level.finishX) * 100)))
    this.progressPct = pct
    if (pct !== this.lastEmittedPct) {
      this.lastEmittedPct = pct
      this.emit({ type: 'progress', pct })
    }

    // trail + ambient particles
    this.trailTimer -= dt
    if (this.trailTimer <= 0) {
      this.trailTimer = 0.045
      if (!p.grounded) this.particles.trail(p.x - 0.4, p.y + 0.5, 'rgba(255,46,126,0.55)')
      const energy = sec?.energy ?? 0.6
      if (Math.random() < 0.3 + energy * 0.3) {
        this.particles.ambient(
          this.camX + VIEW_W_U + 0.5,
          0.5 + Math.random() * 5,
          energy
        )
      }
    }
  }

  private snapRot(rot: number, dt: number): number {
    const target = Math.round(rot / (Math.PI / 2)) * (Math.PI / 2)
    return rot + (target - rot) * Math.min(1, dt * 30)
  }

  private sectionAt(t: number): BuiltSection | null {
    const level = this.level
    if (!level) return null
    for (const s of level.sections) {
      if (t >= s.startTime && t < s.endTime) return s
    }
    return t >= level.sections[level.sections.length - 1].endTime
      ? level.sections[level.sections.length - 1]
      : null
  }

  private floorAt(x: number): number {
    const level = this.level
    if (!level) return 0
    const lo = x - 0.33
    const hi = x + 0.33
    let overGap = false
    for (const g of level.gaps) {
      if (g.x > hi) break
      if (g.x + g.w > lo && g.x < hi) {
        // player support overlaps this gap — still solid if part is on ground
        const solidLeft = lo < g.x
        const solidRight = hi > g.x + g.w
        if (!solidLeft && !solidRight) {
          overGap = true
          break
        }
      }
    }
    return overGap ? -Infinity : 0
  }

  private collide(prevY: number, _speed: number): void {
    const level = this.level
    const p = this.player
    if (!level) return

    // ground / gap landing
    const floor = this.floorAt(p.x)
    if (p.vy <= 0 && p.y <= floor) {
      if (!p.grounded) {
        const impact = -p.vy
        p.y = floor
        p.vy = 0
        p.grounded = true
        if (impact > 7) {
          p.squash = Math.min(0.35, impact / 55)
          this.particles.dust(p.x, p.y + 0.05, '#f7f3fb', 7)
        }
      } else {
        p.y = floor
      }
    } else if (p.y > floor + 0.001) {
      p.grounded = false
    }

    // obstacles near the player
    const lo = p.x - 2.5
    const hi = p.x + 2.5
    for (const o of level.obstacles) {
      if (o.x + o.w < lo) continue
      if (o.x > hi) break

      if (o.kind === 'block') {
        const overlapX =
          p.x + PLAYER_HALF > o.x && p.x - PLAYER_HALF < o.x + o.w
        if (!overlapX) continue
        const top = o.y + o.h
        if (prevY >= top - 0.06 && p.vy <= 0) {
          // land on top
          if (p.y <= top && top > floor) {
            p.y = top
            p.vy = 0
            p.grounded = true
            if (prevY - top > 0.3) this.particles.dust(p.x, top + 0.05, '#2ee6a8', 6)
          }
        } else if (p.y < top - 0.04 && p.y + PLAYER_HIT > o.y) {
          this.die()
          return
        }
        continue
      }

      if (o.kind === 'ceilGate') {
        // solid bar + hanging tips
        const overlapX =
          p.x + PLAYER_HAZ > o.x && p.x - PLAYER_HAZ < o.x + o.w
        if (!overlapX) continue
        const barBottom = o.y
        if (p.y + PLAYER_HIT > barBottom && p.y < barBottom + GATE_BAR_H) {
          this.die()
          return
        }
        if (p.y + PLAYER_HIT > GATE_TIP_Y && p.y < barBottom) {
          this.die()
          return
        }
        continue
      }

      if (o.kind === 'saw') {
        const cx = o.cx ?? o.x + o.w / 2
        const cy = SAW_CY
        // closest point on player hazard box to the circle
        const nx = Math.max(p.x - PLAYER_HAZ, Math.min(cx, p.x + PLAYER_HAZ))
        const ny = Math.max(p.y, Math.min(cy, p.y + PLAYER_HIT))
        const dx = cx - nx
        const dy = cy - ny
        if (dx * dx + dy * dy < SAW_R * SAW_R) {
          this.die()
          return
        }
        continue
      }

      if (o.kind === 'pulse') {
        const cx = o.cx ?? o.x + o.w / 2
        const beatDur = 60 / (this.sectionAt(this.t)?.bpm ?? 128)
        const phase = ((this.t / beatDur) % 1 + 1) % 1
        const R = PULSE_R_MIN + (PULSE_R_MAX - PULSE_R_MIN) * Math.exp(-phase * 4)
        if (R > PULSE_DEADLY) {
          const nx = Math.max(p.x - PLAYER_HAZ, Math.min(cx, p.x + PLAYER_HAZ))
          const ny = Math.max(p.y, Math.min(0, p.y + PLAYER_HIT))
          const dx = cx - nx
          const dy = 0 - ny
          if (dx * dx + dy * dy < R * R) {
            this.die()
            return
          }
        }
        continue
      }

      // spikes
      const top = o.kind === 'spikeSmall' ? SPIKE_SMALL_TOP : SPIKE_TOP
      const hx0 = o.x + 0.3
      const hx1 = o.x + 0.7
      if (
        p.x + PLAYER_HAZ > hx0 &&
        p.x - PLAYER_HAZ < hx1 &&
        p.y < top &&
        p.y + PLAYER_HIT > 0.02
      ) {
        this.die()
        return
      }
    }
  }

  private die(): void {
    if (this.phase === 'dead') return
    const level = this.level
    const pct = this.progressPct
    this.audio.stopRun()
    this.audio.sfxDeath()
    this.particles.burst(this.player.x, this.player.y + 0.5, '#ff2e7e', 55, 15)
    this.shake = 1
    this.flash = 0.5
    this.retryLockUntil = performance.now() + RETRY_LOCK * 1000
    this.deadAt = performance.now()

    let isBest = false
    if (level) {
      if (pct > this.best) {
        this.best = pct
        localStorage.setItem(storageKey(level.id, 'best'), String(pct))
        isBest = pct > 0
      }
    }
    this.setPhase('dead')
    this.emit({ type: 'death', pct, isBest, best: this.best })
  }

  private complete(): void {
    this.audio.stopRun()
    this.audio.sfxComplete()
    const level = this.level
    if (level) {
      this.best = 100
      localStorage.setItem(storageKey(level.id, 'best'), '100')
    }
    this.flash = 0.8
    this.particles.confetti(
      this.player.x,
      this.player.y + 2,
      ['#ff2e7e', '#ffb02e', '#2ee6a8', '#f7f3fb'],
      80
    )
    this.setPhase('complete')
    this.emit({ type: 'complete', attempt: this.attempt })
    if (this.isTutorial) {
      this.emit({ type: 'text', text: null })
      this.emit({ type: 'tutorialDone' })
    }
  }

  /* ────────────── render ────────────── */

  private render(): void {
    const level = this.level
    const sec = level && !this.ambient ? this.sectionAt(Math.max(0, this.t)) : null
    const bpm = sec?.bpm ?? 100
    const tRef = this.ambient ? performance.now() / 1000 : Math.max(0, this.t)
    const beatPhase = ((tRef * (bpm / 60)) % 1 + 1) % 1
    const pulse = Math.exp(-beatPhase * 5)
    const energy = this.ambient ? 0.35 : (sec?.energy ?? 0.5)

    const state: RenderState = {
      t: tRef,
      camX: this.camX,
      playerX: this.player.x,
      playerY: this.player.y,
      playerRot: this.player.rot,
      squash: this.player.squash,
      grounded: this.player.grounded,
      alive: this.phase !== 'dead',
      visible: !!level || this.ambient,
      level: this.ambient ? null : level,
      sectionIdx: this.sectionIdx,
      bpm,
      energy,
      beatPhase,
      pulse,
      shake: this.shake,
      flash: this.flash,
      speedLines: this.speedLines,
      phase: this.phase,
      ambient: this.ambient,
    }

    // camera follows player
    if (!this.ambient && level) {
      this.camX = this.player.x - VIEW_W_U * CAM_ANCHOR
    }

    this.renderer.render(state)
    this.renderer.drawParticlePool(this.particles, state)
  }
}

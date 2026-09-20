/**
 * The game-feel facade.
 *
 * Mechanics and modes describe *what happened* -- "a heavy impact here, pointing
 * that way" -- and this decides what the camera, particles, screen and audio do
 * about it. Nothing else in the codebase owns a shake timer or a flash, so the
 * whole game's response can be retuned from one place.
 *
 * The impact hierarchy (see TUNING.camera):
 *
 *   LIGHT   projectile spawn, floor warning arming, note hit
 *   MEDIUM  laser fire, floor activation, bounce pad
 *   HEAVY   chain slam, gravity flip, player hit, climax
 */

import type { AudioEngine } from '../core/AudioEngine';
import type { Renderer } from '../core/Renderer';
import { AudioFX, type SfxName } from './AudioFX';
import { CameraFX, type ImpactLevel } from './CameraFX';
import { ParticlePool } from './ParticlePool';
import { ScreenFX } from './ScreenFX';
import type { FeelSink } from './FeelSink';
import type { EmitOptions } from './ParticlePool';
import { presetScale, TUNING } from '../tuning';

export type { ImpactLevel };

export interface ImpactOptions {
  /** Field position the impact happened at. */
  x?: number;
  y?: number;
  /** Direction the force pushes, for camera kick and particle spray. */
  dirX?: number;
  dirY?: number;
  colour?: string;
  sfx?: SfxName;
  /** Emit a shockwave ring. Defaults on for MEDIUM and HEAVY. */
  shockwave?: boolean;
  /** Skip particles for effects that draw their own. */
  particles?: boolean;
}

interface Mote {
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  phase: number;
}

export class GameFeel implements FeelSink {
  readonly camera = new CameraFX();
  readonly screen = new ScreenFX();
  readonly particles = new ParticlePool();
  readonly audio: AudioFX;

  /** 0..1, driven by the current section's difficulty/intensity. */
  private energy = 0.5;
  private motes: Mote[] = [];
  private hitStopRemaining = 0;
  private beat = 0;

  constructor(engine: AudioEngine) {
    this.audio = new AudioFX(engine);
    this.rebuildMotes();
  }

  // ---- inputs from gameplay ---------------------------------------------

  /** Called once per whole beat. */
  onBeat(beat: number, beatsPerBar: number): void {
    const isDownbeat = ((beat % beatsPerBar) + beatsPerBar) % beatsPerBar === 0;
    this.camera.onBeat(beat, isDownbeat);
    for (const m of this.motes) {
      // Motes breathe with the music rather than drifting mechanically.
      m.phase += isDownbeat ? 0.9 : 0.35;
    }
  }

  /** How busy the scene should feel. Sections set this from their difficulty. */
  setEnergy(value: number): void {
    const next = Math.max(0, Math.min(1, value));
    if (Math.abs(next - this.energy) < 0.01) return;
    this.energy = next;
    this.rebuildMotes();
  }

  impact(level: ImpactLevel, options: ImpactOptions = {}): void {
    const x = options.x ?? 0.5;
    const y = options.y ?? 0.5;
    const colour = options.colour ?? '#ffffff';
    this.camera.impact(level, options.dirX ?? 0, options.dirY ?? 0);

    const wantWave = options.shockwave ?? level !== 'LIGHT';
    if (wantWave) {
      const radius = level === 'HEAVY' ? 0.42 : level === 'MEDIUM' ? 0.26 : 0.14;
      this.screen.shockwave(x, y, radius, colour, level === 'HEAVY' ? 0.5 : 0.35, level === 'HEAVY' ? 4 : 3);
    }

    if (options.particles !== false) {
      const count = level === 'HEAVY' ? 26 : level === 'MEDIUM' ? 14 : 7;
      const speed = level === 'HEAVY' ? 0.95 : level === 'MEDIUM' ? 0.6 : 0.4;
      const direction = options.dirX !== undefined || options.dirY !== undefined
        ? Math.atan2(options.dirY ?? 0, options.dirX ?? 0)
        : undefined;
      this.particles.emit(x, y, {
        count, speed, colour,
        shape: level === 'HEAVY' ? 'shard' : 'spark',
        size: level === 'HEAVY' ? 0.011 : 0.008,
        life: level === 'HEAVY' ? 0.6 : 0.4,
        direction,
        spread: direction === undefined ? undefined : Math.PI * 0.9,
      });
    }

    if (level === 'HEAVY') this.screen.vignette(colour, 0.22);
    if (options.sfx) this.audio.play(options.sfx);
  }

  /** Telegraph tick: a quiet, non-intrusive "something is coming". */
  telegraph(x: number, y: number, colour: string, progress: number): void {
    if (Math.random() > 0.12 * presetScale().particles) return;
    this.particles.emit(x, y, {
      count: 1,
      speed: 0.12 + 0.2 * progress,
      colour,
      size: 0.005,
      life: 0.3,
      shape: 'dot',
      background: true,
    });
  }

  /** Player took damage. Short freeze, hard kick, red vignette. */
  playerHit(x: number, y: number, dirX = 0, dirY = -1): void {
    this.hitStop(TUNING.hitStop.playerHitSeconds);
    this.impact('HEAVY', { x, y, dirX, dirY, colour: '#ff3355', sfx: 'player_hit' });
    this.screen.flash('#ff3355', 0.3, 0.2);
    this.screen.vignette('#ff1133', 0.5);
  }

  /** Threaded the needle. Celebrated, but never loud enough to obscure play. */
  perfectDodge(x: number, y: number): void {
    this.screen.shockwave(x, y, 0.16, '#9ffcff', 0.35, 2);
    this.particles.emit(x, y, {
      count: 12, speed: 0.55, colour: '#9ffcff', size: 0.006, life: 0.38, shape: 'spark',
    });
    this.camera.impact('LIGHT');
    this.audio.play('perfect_dodge');
  }

  sfx(name: SfxName, gainScale = 1): void {
    this.audio.play(name, gainScale);
  }

  /** Hold the drawn frame. Clamped, and never shortens a longer freeze. */
  hitStop(seconds: number): void {
    const capped = Math.min(Math.max(0, seconds), TUNING.hitStop.maxSeconds);
    this.hitStopRemaining = Math.max(this.hitStopRemaining, capped);
  }

  /** Direct particle access, for mechanics that shape their own debris. */
  emit(x: number, y: number, options: EmitOptions = {}): void {
    this.particles.emit(x, y, options);
  }

  shockwave(x: number, y: number, radius = 0.2, colour = '#ffffff', life = 0.35, width = 3): void {
    this.screen.shockwave(x, y, radius, colour, life, width);
  }

  // ---- frame ------------------------------------------------------------

  /** True while the brief post-hit freeze is running. */
  get isHitStopped(): boolean {
    return this.hitStopRemaining > 0;
  }

  update(deltaSeconds: number, beat: number): void {
    this.beat = beat;
    if (this.hitStopRemaining > 0) this.hitStopRemaining -= deltaSeconds;
    this.camera.update(deltaSeconds, beat);
    this.screen.update(deltaSeconds);
    this.particles.update(deltaSeconds);
    this.updateMotes(deltaSeconds);
  }

  /** Apply the camera for this frame. Called before anything is drawn. */
  applyCamera(r: Renderer): void {
    r.setCamera(this.camera.zoom, this.camera.offsetX, this.camera.offsetY);
  }

  /** Ambient layer, drawn beneath the arena/level geometry. */
  renderBackground(r: Renderer): void {
    const pulse = 1 - (((this.beat % 1) + 1) % 1);
    for (const m of this.motes) {
      const twinkle = 0.35 + 0.35 * Math.sin(m.phase);
      r.fillCircle(m.x, m.y, m.size * (1 + pulse * 0.25), '#2e3b5c', twinkle);
    }
    this.particles.render(r, true);
  }

  /** Impact layer, drawn above hazards but below the HUD. */
  renderForeground(r: Renderer): void {
    this.particles.render(r, false);
    this.screen.renderField(r);
  }

  renderScreen(r: Renderer, width: number, height: number): void {
    this.screen.renderScreen(r, width, height);
  }

  reset(): void {
    this.camera.reset();
    this.screen.reset();
    this.particles.clear();
    this.hitStopRemaining = 0;
  }

  // ---- ambient ----------------------------------------------------------

  private rebuildMotes(): void {
    const count = Math.round(
      (TUNING.ambient.density + TUNING.ambient.energyBonus * this.energy) * presetScale().ambient,
    );
    const next: Mote[] = [];
    for (let i = 0; i < count; i++) {
      next.push(this.motes[i] ?? {
        x: Math.random(),
        y: Math.random(),
        vx: (Math.random() - 0.5) * 0.02,
        vy: -0.008 - Math.random() * 0.02,
        size: 0.0025 + Math.random() * 0.004,
        phase: Math.random() * Math.PI * 2,
      });
    }
    this.motes = next;
  }

  private updateMotes(deltaSeconds: number): void {
    const dt = Math.min(deltaSeconds, 0.05);
    const drift = 1 + this.energy;
    for (const m of this.motes) {
      m.x += m.vx * dt * drift;
      m.y += m.vy * dt * drift;
      m.phase += dt * 1.5;
      if (m.y < -0.02) { m.y = 1.02; m.x = Math.random(); }
      if (m.x < -0.02) m.x = 1.02;
      if (m.x > 1.02) m.x = -0.02;
    }
  }
}

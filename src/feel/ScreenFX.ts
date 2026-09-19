/**
 * Screen-space effects: flashes, vignette pulses and shockwave rings.
 *
 * All of these are one-shot and decay to nothing. Nothing here is ever left
 * permanently on -- no constant bloom, no standing chromatic separation.
 */

import type { Renderer } from '../core/Renderer';
import { decay, easeOutExpo } from './Easing';
import { presetScale } from '../tuning';

interface Flash {
  age: number;
  life: number;
  colour: string;
  strength: number;
}

interface Shockwave {
  x: number;
  y: number;
  age: number;
  life: number;
  radius: number;
  colour: string;
  width: number;
}

const MAX_WAVES = 24;

export class ScreenFX {
  private flashes: Flash[] = [];
  private waves: Shockwave[] = [];
  private vignetteAge = Infinity;
  private vignetteStrength = 0;
  private vignetteColour = '#ff3355';

  flash(colour: string, strength = 0.25, life = 0.22): void {
    this.flashes.push({ age: 0, life, colour, strength: strength * presetScale().screen });
  }

  vignette(colour: string, strength = 0.4): void {
    this.vignetteAge = 0;
    this.vignetteColour = colour;
    this.vignetteStrength = strength * presetScale().screen;
  }

  /** Expanding ring in field space. The workhorse impact read. */
  shockwave(x: number, y: number, radius = 0.25, colour = '#ffffff', life = 0.4, width = 3): void {
    if (this.waves.length >= MAX_WAVES) this.waves.shift();
    this.waves.push({ x, y, age: 0, life, radius, colour, width });
  }

  update(deltaSeconds: number): void {
    const dt = Math.min(deltaSeconds, 0.05);
    this.vignetteAge += dt;
    for (let i = this.flashes.length - 1; i >= 0; i--) {
      this.flashes[i].age += dt;
      if (this.flashes[i].age >= this.flashes[i].life) this.flashes.splice(i, 1);
    }
    for (let i = this.waves.length - 1; i >= 0; i--) {
      this.waves[i].age += dt;
      if (this.waves[i].age >= this.waves[i].life) this.waves.splice(i, 1);
    }
  }

  /** Field-space layer: drawn with the gameplay, under the UI. */
  renderField(r: Renderer): void {
    for (const w of this.waves) {
      const t = w.age / w.life;
      const radius = w.radius * easeOutExpo(t);
      r.strokeCircle(w.x, w.y, radius, w.colour, w.width * (1 - t) + 1, (1 - t) * 0.85);
    }
  }

  /** Screen-space layer: flashes and vignette, over everything but the HUD. */
  renderScreen(r: Renderer, width: number, height: number): void {
    for (const f of this.flashes) {
      r.fillScreen(width, height, f.colour, f.strength * decay(f.age / f.life, 3));
    }
    const vignetteLife = 0.45;
    if (this.vignetteAge < vignetteLife) {
      const alpha = this.vignetteStrength * decay(this.vignetteAge / vignetteLife, 3);
      const c = r.ctx;
      const gradient = c.createRadialGradient(
        width / 2, height / 2, Math.min(width, height) * 0.25,
        width / 2, height / 2, Math.max(width, height) * 0.7,
      );
      gradient.addColorStop(0, 'transparent');
      gradient.addColorStop(1, this.vignetteColour);
      c.save();
      c.globalAlpha = Math.max(0, Math.min(1, alpha));
      c.fillStyle = gradient;
      c.fillRect(0, 0, width, height);
      c.restore();
    }
  }

  reset(): void {
    this.flashes = [];
    this.waves = [];
    this.vignetteAge = Infinity;
  }
}

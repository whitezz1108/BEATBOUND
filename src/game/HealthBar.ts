/**
 * The one health readout, shared by every mode.
 *
 * Drawn in screen space above the play field so it sits in the same place
 * whatever mode is running, and so it never competes with the gameplay area for
 * attention. Three reads, in order of urgency:
 *
 *   - the bar itself, which eases toward the true value rather than snapping,
 *     so the player can see *how much* a hit cost;
 *   - a pale "chip" left behind by recent damage, which drains a moment later;
 *   - a low-health pulse, which is the only thing here that moves on its own.
 */

import type { Renderer } from '../core/Renderer';
import type { RunStatus } from '../core/RunStatus';
import { clamp } from '../core/geometry';
import { easeOutCubic } from '../feel/Easing';
import { TUNING } from '../tuning';

const BAR_WIDTH_FRACTION = 0.34;
const BAR_HEIGHT = 12;
const TOP_MARGIN = 16;

export class HealthBar {
  /** Eased toward the real value. */
  private displayed = 1;
  /** Lags further behind, showing what was just lost. */
  private chip = 1;
  private flash = 0;
  private lastSeenDamageAt = -Infinity;

  reset(fraction = 1): void {
    this.displayed = fraction;
    this.chip = fraction;
    this.flash = 0;
    this.lastSeenDamageAt = -Infinity;
  }

  update(status: RunStatus, deltaSeconds: number): void {
    const dt = Math.min(deltaSeconds, 0.05);
    const target = status.health.fraction;

    const event = status.health.lastDamageEvent;
    if (event && event.at !== this.lastSeenDamageAt) {
      this.lastSeenDamageAt = event.at;
      this.flash = 1;
    }

    // The bar itself moves quickly; the chip trails so the loss stays legible.
    this.displayed += (target - this.displayed) * clamp(dt * 12, 0, 1);
    this.chip += (this.displayed - this.chip) * clamp(dt * 2.6, 0, 1);
    if (this.chip < this.displayed) this.chip = this.displayed;
    this.flash = Math.max(0, this.flash - dt * 3.2);
  }

  render(r: Renderer, status: RunStatus, width: number, beat: number): void {
    const c = r.ctx;
    const barWidth = Math.max(180, width * BAR_WIDTH_FRACTION);
    const x = (width - barWidth) / 2;
    const y = TOP_MARGIN;
    const fraction = status.health.fraction;
    const low = status.health.isLow;
    // Only the low-health state animates by itself; everything else is a
    // response to something the player did.
    const pulse = low ? 0.55 + 0.45 * Math.abs(Math.sin(beat * Math.PI)) : 1;

    c.save();

    // Track
    c.fillStyle = '#0d1320';
    c.fillRect(x - 2, y - 2, barWidth + 4, BAR_HEIGHT + 4);
    c.strokeStyle = low ? `rgba(255,84,112,${0.5 * pulse})` : '#2b3750';
    c.lineWidth = 1;
    c.strokeRect(x - 2.5, y - 2.5, barWidth + 5, BAR_HEIGHT + 5);

    // Chip: what was lost a moment ago.
    if (this.chip > this.displayed + 0.001) {
      c.fillStyle = 'rgba(255, 120, 140, 0.55)';
      c.fillRect(x + barWidth * this.displayed, y, barWidth * (this.chip - this.displayed), BAR_HEIGHT);
    }

    // Fill, coloured by remaining health rather than by a fixed palette.
    const fill = barWidth * Math.max(0, this.displayed);
    const colour = fraction > 0.6 ? '#4dffa6' : fraction > TUNING.health.lowFraction ? '#ffd479' : '#ff5470';
    c.globalAlpha = low ? pulse : 1;
    c.fillStyle = colour;
    c.fillRect(x, y, fill, BAR_HEIGHT);
    c.globalAlpha = 1;

    // Damage flash over the whole bar.
    if (this.flash > 0) {
      c.fillStyle = `rgba(255,255,255,${0.5 * easeOutCubic(this.flash)})`;
      c.fillRect(x, y, barWidth, BAR_HEIGHT);
    }

    // Segment ticks every 25%, so a number is readable without reading a number.
    c.strokeStyle = 'rgba(5,7,13,0.55)';
    for (let i = 1; i < 4; i++) {
      const tx = x + (barWidth * i) / 4;
      c.beginPath();
      c.moveTo(tx, y);
      c.lineTo(tx, y + BAR_HEIGHT);
      c.stroke();
    }

    c.fillStyle = low ? '#ff9db0' : '#8d99b5';
    c.font = '600 11px ui-monospace, SFMono-Regular, Menlo, monospace';
    c.textAlign = 'left';
    c.textBaseline = 'middle';
    c.fillText('HP', x - 28, y + BAR_HEIGHT / 2);
    c.textAlign = 'right';
    c.fillText(
      `${Math.round(status.health.currentHealth)}`,
      x + barWidth + 30, y + BAR_HEIGHT / 2,
    );

    if (status.invincible) {
      c.textAlign = 'center';
      c.fillStyle = '#6de3ff';
      c.fillText('INVINCIBLE', x + barWidth / 2, y + BAR_HEIGHT + 12);
    }
    c.restore();
  }
}

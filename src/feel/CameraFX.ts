/**
 * Camera reactions.
 *
 * Two rules this enforces:
 *   - every camera movement has a named cause (a beat, or an impact), so there
 *     is never ambient shake running for its own sake;
 *   - beat pulses are measured in *beats* and impacts in *seconds*, because a
 *     pulse belongs to the music and a kick belongs to the collision.
 */

import { decay, easeOutCubic } from './Easing';
import { presetScale, TUNING } from '../tuning';

export type ImpactLevel = 'LIGHT' | 'MEDIUM' | 'HEAVY';

export class CameraFX {
  /** Beat the last pulse started on, and its size. */
  private pulseBeat = -Infinity;
  private pulseAmount = 0;

  private shakeAge = Infinity;
  private shakeAmount = 0;

  private kickAge = Infinity;
  private kickAmount = 0;
  private kickX = 0;
  private kickY = 0;

  private currentBeat = 0;

  /** Called on every whole beat crossing. */
  onBeat(beat: number, isDownbeat: boolean): void {
    const t = TUNING.camera;
    this.pulseBeat = beat;
    this.pulseAmount = (isDownbeat ? t.downbeatPulse : t.beatPulse) * presetScale().camera;
  }

  /** Shake plus an optional directional kick. */
  impact(level: ImpactLevel, directionX = 0, directionY = 0): void {
    const t = TUNING.camera;
    const scale = presetScale().camera;
    const shake = level === 'HEAVY' ? t.shakeHeavy : level === 'MEDIUM' ? t.shakeMedium : t.shakeLight;
    const kick = level === 'HEAVY' ? t.kickHeavy : level === 'MEDIUM' ? t.kickMedium : t.kickLight;

    this.shakeAge = 0;
    this.shakeAmount = shake * scale;

    const length = Math.hypot(directionX, directionY);
    if (length > 1e-6) {
      this.kickAge = 0;
      this.kickAmount = kick * scale;
      this.kickX = directionX / length;
      this.kickY = directionY / length;
    }
  }

  update(deltaSeconds: number, beat: number): void {
    this.currentBeat = beat;
    this.shakeAge += deltaSeconds;
    this.kickAge += deltaSeconds;
  }

  /** Zoom factor for this frame. */
  get zoom(): number {
    const beatsSince = this.currentBeat - this.pulseBeat;
    if (beatsSince < 0 || beatsSince > TUNING.camera.pulseDecayBeats) return 1;
    // Snap in, ease out: the pulse lands on the beat and relaxes after it.
    const t = beatsSince / TUNING.camera.pulseDecayBeats;
    return 1 + this.pulseAmount * (1 - easeOutCubic(t));
  }

  /** Camera offset in field units for this frame. */
  get offsetX(): number {
    return this.shakeOffset(this.shakeAge, 0) + this.kickOffset() * this.kickX;
  }

  get offsetY(): number {
    return this.shakeOffset(this.shakeAge, 1) + this.kickOffset() * this.kickY;
  }

  private shakeOffset(age: number, axis: number): number {
    const duration = TUNING.camera.shakeSeconds;
    if (age >= duration) return 0;
    const envelope = decay(age / duration, 4);
    // Deterministic-ish oscillation rather than pure noise, so it reads as a
    // physical wobble instead of static.
    const frequency = axis === 0 ? 47 : 61;
    return Math.sin(age * frequency) * this.shakeAmount * envelope;
  }

  private kickOffset(): number {
    const duration = TUNING.camera.shakeSeconds * 1.4;
    if (this.kickAge >= duration) return 0;
    return this.kickAmount * decay(this.kickAge / duration, 5);
  }

  reset(): void {
    this.pulseBeat = -Infinity;
    this.shakeAge = Infinity;
    this.kickAge = Infinity;
  }
}

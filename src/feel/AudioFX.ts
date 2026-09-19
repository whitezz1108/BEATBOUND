/**
 * Named sound hooks, synthesized.
 *
 * The project has no audio assets, so every cue is generated: a small set of
 * voices (blip, thump, noise, sweep) driven by a table of named cues. Swapping
 * in real samples later means replacing `play()`, not hunting call sites.
 *
 * Everything sits on its own gain node well below the music. These are
 * confirmations, not instruments -- if a cue competes with the song it is
 * mixed wrong.
 */

import type { AudioEngine } from '../core/AudioEngine';

export type SfxName =
  // Arena
  | 'floor_warning' | 'floor_impact'
  | 'chain_rattle' | 'chain_whip' | 'chain_impact'
  | 'projectile_charge' | 'projectile_fire' | 'projectile_hit'
  | 'laser_charge' | 'laser_fire'
  | 'perfect_dodge' | 'player_hit'
  // Runner
  | 'jump' | 'land' | 'gravity_flip' | 'bounce' | 'runner_fail'
  // Vertical
  | 'tap_perfect' | 'tap_good' | 'hold_start' | 'hold_tick' | 'hold_complete'
  | 'drift_checkpoint' | 'miss'
  // Radial
  | 'direction_hit' | 'direction_perfect' | 'radial_combo' | 'radial_climax';

type Voice = 'blip' | 'thump' | 'noise' | 'sweep';

interface Cue {
  voice: Voice;
  /** Start frequency in Hz. */
  freq: number;
  /** End frequency for sweeps. */
  freq2?: number;
  gain: number;
  length: number;
  type?: OscillatorType;
}

const CUES: Record<SfxName, Cue> = {
  floor_warning: { voice: 'blip', freq: 420, gain: 0.03, length: 0.05, type: 'triangle' },
  floor_impact: { voice: 'thump', freq: 160, freq2: 48, gain: 0.10, length: 0.20 },
  chain_rattle: { voice: 'noise', freq: 2600, gain: 0.03, length: 0.09 },
  chain_whip: { voice: 'sweep', freq: 900, freq2: 180, gain: 0.09, length: 0.16 },
  chain_impact: { voice: 'thump', freq: 220, freq2: 60, gain: 0.12, length: 0.22 },
  projectile_charge: { voice: 'sweep', freq: 300, freq2: 800, gain: 0.03, length: 0.14 },
  projectile_fire: { voice: 'blip', freq: 760, gain: 0.05, length: 0.05, type: 'square' },
  projectile_hit: { voice: 'noise', freq: 1800, gain: 0.05, length: 0.08 },
  laser_charge: { voice: 'sweep', freq: 240, freq2: 1500, gain: 0.05, length: 0.3 },
  laser_fire: { voice: 'sweep', freq: 1500, freq2: 420, gain: 0.10, length: 0.18 },
  perfect_dodge: { voice: 'blip', freq: 1320, gain: 0.07, length: 0.10, type: 'sine' },
  player_hit: { voice: 'thump', freq: 180, freq2: 40, gain: 0.14, length: 0.26 },

  jump: { voice: 'sweep', freq: 380, freq2: 720, gain: 0.05, length: 0.09 },
  land: { voice: 'thump', freq: 150, freq2: 60, gain: 0.06, length: 0.10 },
  gravity_flip: { voice: 'sweep', freq: 200, freq2: 900, gain: 0.10, length: 0.30 },
  bounce: { voice: 'sweep', freq: 520, freq2: 1100, gain: 0.07, length: 0.14 },
  runner_fail: { voice: 'sweep', freq: 400, freq2: 90, gain: 0.12, length: 0.35 },

  tap_perfect: { voice: 'blip', freq: 1180, gain: 0.06, length: 0.06, type: 'sine' },
  tap_good: { voice: 'blip', freq: 860, gain: 0.05, length: 0.06, type: 'triangle' },
  hold_start: { voice: 'blip', freq: 640, gain: 0.05, length: 0.07, type: 'sine' },
  hold_tick: { voice: 'blip', freq: 980, gain: 0.020, length: 0.03, type: 'sine' },
  hold_complete: { voice: 'sweep', freq: 700, freq2: 1400, gain: 0.07, length: 0.16 },
  drift_checkpoint: { voice: 'blip', freq: 1040, gain: 0.035, length: 0.04, type: 'sine' },
  miss: { voice: 'thump', freq: 130, freq2: 70, gain: 0.07, length: 0.16 },

  direction_hit: { voice: 'blip', freq: 900, gain: 0.05, length: 0.06, type: 'triangle' },
  direction_perfect: { voice: 'blip', freq: 1400, gain: 0.06, length: 0.07, type: 'sine' },
  radial_combo: { voice: 'sweep', freq: 800, freq2: 1600, gain: 0.05, length: 0.12 },
  radial_climax: { voice: 'sweep', freq: 300, freq2: 1800, gain: 0.10, length: 0.28 },
};

export class AudioFX {
  private readonly bus: GainNode;
  private noiseBuffer: AudioBuffer | null = null;
  /** Prevents a chord of identical cues stacking into a click. */
  private readonly lastPlayed = new Map<SfxName, number>();

  constructor(private readonly engine: AudioEngine) {
    this.bus = engine.ctx.createGain();
    this.bus.gain.value = 0.85;
    this.bus.connect(engine.master);
  }

  setVolume(value: number): void {
    this.bus.gain.value = Math.max(0, Math.min(1, value));
  }

  play(name: SfxName, gainScale = 1): void {
    const cue = CUES[name];
    if (!cue) return;
    const now = this.engine.ctx.currentTime;
    // Same cue twice within 25ms is one event as far as the ear is concerned.
    if (now - (this.lastPlayed.get(name) ?? -1) < 0.025) return;
    this.lastPlayed.set(name, now);

    const gain = cue.gain * gainScale;
    switch (cue.voice) {
      case 'blip': return this.blip(now, cue.freq, gain, cue.length, cue.type ?? 'square');
      case 'thump': return this.sweepVoice(now, cue.freq, cue.freq2 ?? cue.freq * 0.3, gain, cue.length, 'sine');
      case 'sweep': return this.sweepVoice(now, cue.freq, cue.freq2 ?? cue.freq, gain, cue.length, 'sawtooth');
      case 'noise': return this.noise(now, cue.freq, gain, cue.length);
    }
  }

  private blip(at: number, frequency: number, gain: number, length: number, type: OscillatorType): void {
    const ctx = this.engine.ctx;
    const osc = ctx.createOscillator();
    const env = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(frequency, at);
    env.gain.setValueAtTime(0, at);
    env.gain.linearRampToValueAtTime(gain, at + 0.004);
    env.gain.exponentialRampToValueAtTime(0.0001, at + length);
    osc.connect(env).connect(this.bus);
    osc.start(at);
    osc.stop(at + length + 0.02);
  }

  private sweepVoice(
    at: number, from: number, to: number, gain: number, length: number, type: OscillatorType,
  ): void {
    const ctx = this.engine.ctx;
    const osc = ctx.createOscillator();
    const env = ctx.createGain();
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(Math.max(from, to) * 2.5 + 400, at);
    osc.type = type;
    osc.frequency.setValueAtTime(Math.max(20, from), at);
    osc.frequency.exponentialRampToValueAtTime(Math.max(20, to), at + length);
    env.gain.setValueAtTime(0, at);
    env.gain.linearRampToValueAtTime(gain, at + 0.006);
    env.gain.exponentialRampToValueAtTime(0.0001, at + length);
    osc.connect(filter).connect(env).connect(this.bus);
    osc.start(at);
    osc.stop(at + length + 0.02);
  }

  private noise(at: number, cutoff: number, gain: number, length: number): void {
    const ctx = this.engine.ctx;
    if (!this.noiseBuffer) {
      const frames = Math.floor(ctx.sampleRate * 0.5);
      this.noiseBuffer = ctx.createBuffer(1, frames, ctx.sampleRate);
      const data = this.noiseBuffer.getChannelData(0);
      for (let i = 0; i < frames; i++) data[i] = Math.random() * 2 - 1;
    }
    const source = ctx.createBufferSource();
    source.buffer = this.noiseBuffer;
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(cutoff, at);
    filter.Q.value = 1.2;
    const env = ctx.createGain();
    env.gain.setValueAtTime(0, at);
    env.gain.linearRampToValueAtTime(gain, at + 0.003);
    env.gain.exponentialRampToValueAtTime(0.0001, at + length);
    source.connect(filter).connect(env).connect(this.bus);
    source.start(at);
    source.stop(at + length + 0.02);
  }
}

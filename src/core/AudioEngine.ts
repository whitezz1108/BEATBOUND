/**
 * Audio playback + the authoritative wall clock for the whole game.
 *
 * Timing comes from `AudioContext.currentTime`, not `performance.now()` and not
 * frame counting: it is the same clock the audio hardware plays samples on, so
 * BeatClock cannot drift away from what the player hears even if frames stutter.
 */

import type { TempoMap } from './TempoMap';

export interface SongPlayer {
  /** Seconds into the song. Negative during the pre-roll before playback begins. */
  readonly playbackTime: number;
  readonly isPlaying: boolean;
  readonly isPaused: boolean;
  /** Song length in seconds; Infinity for a generated click track. */
  readonly duration: number;
  /** Human-readable source, for the HUD. */
  readonly sourceLabel: string;
  start(leadInSeconds?: number): void;
  stop(): void;
  /**
   * Freeze song time. Used when the page stops rendering so the run cannot
   * desync. `atSongTime` rewinds to a specific position -- after a frame stall
   * the game froze at the last beat it actually simulated, not at the audio
   * clock's (now further ahead) position.
   */
  pause(atSongTime?: number): void;
  /** Resume from exactly where pause() froze, re-anchored to the audio clock. */
  resume(): void;
  /** Called once per frame. Lets a player top up its own scheduling lookahead. */
  update(): void;
}

/** Shared AudioContext owner. */
export class AudioEngine {
  readonly ctx: AudioContext;
  readonly master: GainNode;

  constructor() {
    this.ctx = new AudioContext({ latencyHint: 'interactive' });
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.9;
    this.master.connect(this.ctx.destination);
  }

  async resume(): Promise<void> {
    if (this.ctx.state !== 'running') await this.ctx.resume();
  }

  /** Try to fetch+decode a song. Returns null when the asset is missing. */
  async loadBuffer(url: string): Promise<AudioBuffer | null> {
    try {
      const res = await fetch(url);
      if (!res.ok) return null;
      return await this.ctx.decodeAudioData(await res.arrayBuffer());
    } catch {
      return null;
    }
  }

  /** One-shot percussive blip, scheduled on the audio clock. */
  blip(atCtxTime: number, frequency: number, gain = 0.25, lengthSeconds = 0.05, destination: AudioNode = this.master): void {
    const osc = this.ctx.createOscillator();
    const env = this.ctx.createGain();
    osc.frequency.value = frequency;
    osc.type = 'square';
    env.gain.setValueAtTime(0, atCtxTime);
    env.gain.linearRampToValueAtTime(gain, atCtxTime + 0.002);
    env.gain.exponentialRampToValueAtTime(0.0001, atCtxTime + lengthSeconds);
    osc.connect(env).connect(destination);
    osc.start(atCtxTime);
    osc.stop(atCtxTime + lengthSeconds + 0.02);
  }
}

/** Base: everything about "where are we in the song" is identical for both players. */
abstract class ContextClockPlayer implements SongPlayer {
  /** Audio-clock time at which song time would read 0. */
  protected startCtxTime = 0;
  protected started = false;
  protected stopped = false;
  protected paused = false;
  private pausedSongTime = 0;

  constructor(protected readonly engine: AudioEngine) {}

  abstract readonly duration: number;
  abstract readonly sourceLabel: string;

  get playbackTime(): number {
    if (!this.started) return 0;
    if (this.paused) return this.pausedSongTime;
    return this.engine.ctx.currentTime - this.startCtxTime;
  }

  get isPlaying(): boolean {
    return this.started && !this.stopped && !this.paused && this.playbackTime < this.duration;
  }

  get isPaused(): boolean {
    return this.paused;
  }

  pause(atSongTime?: number): void {
    if (!this.started || this.stopped || this.paused) return;
    this.pausedSongTime = atSongTime ?? this.playbackTime;
    this.paused = true;
    this.onPause();
  }

  resume(): void {
    if (!this.paused) return;
    // Re-anchor to the audio clock so song time continues exactly where it froze.
    this.startCtxTime = this.engine.ctx.currentTime - this.pausedSongTime;
    this.paused = false;
    this.onResume(this.pausedSongTime);
  }

  start(leadInSeconds = 0.15): void {
    if (this.started) return;
    this.startCtxTime = this.engine.ctx.currentTime + leadInSeconds;
    this.started = true;
    this.onStart(this.startCtxTime);
  }

  stop(): void {
    if (!this.started || this.stopped) return;
    this.stopped = true;
    this.onStop();
  }

  update(): void {}

  protected abstract onStart(atCtxTime: number): void;
  protected abstract onStop(): void;
  protected abstract onPause(): void;
  protected abstract onResume(songTime: number): void;
}

/** Plays a decoded audio file. */
export class BufferSongPlayer extends ContextClockPlayer {
  private node: AudioBufferSourceNode | null = null;

  constructor(engine: AudioEngine, private readonly buffer: AudioBuffer, readonly sourceLabel: string) {
    super(engine);
  }

  get duration(): number {
    return this.buffer.duration;
  }

  protected onStart(atCtxTime: number): void {
    const node = this.engine.ctx.createBufferSource();
    node.buffer = this.buffer;
    node.connect(this.engine.master);
    node.start(atCtxTime);
    this.node = node;
  }

  protected onStop(): void {
    this.node?.stop();
    this.node = null;
  }

  protected onPause(): void {
    this.node?.stop();
    this.node = null;
  }

  protected onResume(songTime: number): void {
    // A source node cannot be restarted, so a fresh one is started at the
    // offset we froze at (or at song time 0 if we paused during the count-in).
    const node = this.engine.ctx.createBufferSource();
    node.buffer = this.buffer;
    node.connect(this.engine.master);
    node.start(Math.max(this.engine.ctx.currentTime, this.startCtxTime), Math.max(0, songTime));
    this.node = node;
  }
}

/**
 * Fallback "song": a metronome synthesized straight from the TempoMap.
 *
 * The level's audio asset is optional for development -- without it the game
 * still runs on a real audio clock with an audible beat, so BeatClock sync can
 * be verified before any music exists.
 */
export class ClickTrackPlayer extends ContextClockPlayer {
  readonly sourceLabel = 'click track (no audio asset)';
  /** Schedule this far ahead of the audio clock so clicks are never late. */
  private static readonly LOOKAHEAD_SECONDS = 0.35;
  private nextBeat = 0;

  /** Own output so already-scheduled clicks can be silenced instantly on pause. */
  private readonly out: GainNode;

  constructor(
    engine: AudioEngine,
    private readonly tempo: TempoMap,
    readonly duration = Infinity,
  ) {
    super(engine);
    this.out = engine.ctx.createGain();
    this.out.connect(engine.master);
  }

  protected onStart(_atCtxTime: number): void {
    this.nextBeat = 0;
  }

  protected onStop(): void {
    this.nextBeat = Infinity;
    this.out.gain.value = 0;
  }

  protected onPause(): void {
    // Clicks already queued inside the lookahead window would otherwise keep
    // sounding after the game froze.
    this.out.gain.value = 0;
  }

  protected onResume(songTime: number): void {
    this.out.gain.value = 1;
    this.nextBeat = Math.ceil(this.tempo.timeToBeats(songTime));
  }

  override update(): void {
    if (!this.started || this.stopped) return;
    const horizon = this.playbackTime + ClickTrackPlayer.LOOKAHEAD_SECONDS;
    // Emit every beat whose time falls inside the lookahead window.
    while (this.tempo.beatsToTime(this.nextBeat) < horizon) {
      const songTime = this.tempo.beatsToTime(this.nextBeat);
      const ctxTime = this.startCtxTime + songTime;
      if (ctxTime > this.engine.ctx.currentTime) {
        const downbeat = this.nextBeat % this.tempo.beatsPerBar === 0;
        this.engine.blip(ctxTime, downbeat ? 1320 : 880, downbeat ? 0.22 : 0.1, 0.05, this.out);
      }
      this.nextBeat += 1;
    }
  }
}

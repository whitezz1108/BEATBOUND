/**
 * Phase 1 -- BeatClock.
 *
 * The single rhythm authority. It reads playback time from the SongPlayer
 * (which reads the audio hardware clock), converts it to musical time through
 * the TempoMap, and lets any system schedule work in *beats* rather than
 * seconds.
 *
 * Rules this enforces for the rest of the codebase:
 *   - No gameplay system keeps its own rhythm timer.
 *   - No gameplay system counts frames to measure musical time.
 *   - Callbacks fire from `update()`, i.e. on the game thread, so mechanics can
 *     safely touch game state (unlike WebAudio's own scheduling callbacks).
 *
 * Drift control: `absoluteBeat` is *recomputed from playback time every frame*
 * rather than accumulated from frame deltas, so a dropped frame costs one late
 * callback, never a permanent offset.
 */

import type { SongPlayer } from './AudioEngine';
import type { TempoMap, MusicalPosition } from './TempoMap';
import { absoluteToPosition } from './TempoMap';

export interface ScheduleHandle {
  cancel(): void;
}

interface ScheduledEntry {
  beat: number;
  callback: (firedAtBeat: number) => void;
  label: string;
  cancelled: boolean;
  seq: number;
}

export interface BeatClockStats {
  /** Events fired so far. */
  fired: number;
  /** How late the most recent callback was, in ms of musical time. */
  lastLatencyMs: number;
  maxLatencyMs: number;
  meanLatencyMs: number;
}

export class BeatClock {
  private queue: ScheduledEntry[] = [];
  private seq = 0;
  private beatListeners = new Set<(wholeBeat: number, position: MusicalPosition) => void>();
  private lastWholeBeat = -1;

  private _absoluteBeat = 0;
  private _songTime = 0;
  private _deltaSeconds = 0;
  private latencySum = 0;
  private _stats: BeatClockStats = { fired: 0, lastLatencyMs: 0, maxLatencyMs: 0, meanLatencyMs: 0 };

  constructor(
    private readonly player: SongPlayer,
    readonly tempo: TempoMap,
  ) {}

  // ---- read-out ----------------------------------------------------------

  /** 0-based continuous beat since the first beat of the song. */
  get absoluteBeat(): number {
    return this._absoluteBeat;
  }

  get songTime(): number {
    return this._songTime;
  }

  /** Real seconds elapsed since the previous update (for smooth motion only). */
  get deltaSeconds(): number {
    return this._deltaSeconds;
  }

  get position(): MusicalPosition {
    return absoluteToPosition(this._absoluteBeat, this.tempo.beatsPerBar);
  }

  get beatsPerBar(): number {
    return this.tempo.beatsPerBar;
  }

  get secondsPerBeat(): number {
    return this.tempo.secondsPerBeatAt(this._absoluteBeat);
  }

  get stats(): Readonly<BeatClockStats> {
    return this._stats;
  }

  /** Convert a beat-denominated duration into seconds at the current tempo. */
  beatsToSeconds(beats: number): number {
    return beats * this.secondsPerBeat;
  }

  /** Absolute beat -> playback seconds (tempo-map aware). */
  beatToSongTime(beat: number): number {
    return this.tempo.beatsToTime(beat);
  }

  // ---- scheduling --------------------------------------------------------

  /**
   * Run `callback` when the song reaches `absoluteBeat`.
   * Beats already in the past fire on the next update (never silently dropped).
   */
  scheduleAtBeat(absoluteBeat: number, callback: (firedAtBeat: number) => void, label = ''): ScheduleHandle {
    const entry: ScheduledEntry = { beat: absoluteBeat, callback, label, cancelled: false, seq: this.seq++ };
    // Keep the queue sorted by beat (then insertion order) so update() is a cheap head pop.
    let lo = 0;
    let hi = this.queue.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (this.queue[mid].beat <= absoluteBeat) lo = mid + 1;
      else hi = mid;
    }
    this.queue.splice(lo, 0, entry);
    return { cancel: () => { entry.cancelled = true; } };
  }

  /** Convenience: schedule relative to now, in beats. */
  scheduleInBeats(deltaBeats: number, callback: (firedAtBeat: number) => void, label = ''): ScheduleHandle {
    return this.scheduleAtBeat(this._absoluteBeat + deltaBeats, callback, label);
  }

  /** Fires once each time the song crosses a whole beat. Useful for HUD/VFX only. */
  onBeat(listener: (wholeBeat: number, position: MusicalPosition) => void): () => void {
    this.beatListeners.add(listener);
    return () => this.beatListeners.delete(listener);
  }

  /** Drop every pending event (e.g. when a level is unloaded). */
  clearSchedule(): void {
    this.queue = [];
  }

  /**
   * Jump the schedule to `absoluteBeat`: discard everything already due and move
   * the beat cursor, so starting mid-song does not dump the skipped half of the
   * level into one frame. Returns how many events were dropped.
   */
  seekTo(absoluteBeat: number): number {
    const before = this.queue.length;
    this.queue = this.queue.filter((e) => e.beat >= absoluteBeat);
    this.lastWholeBeat = Math.max(this.lastWholeBeat, Math.floor(absoluteBeat) - 1);
    return before - this.queue.length;
  }

  get pendingCount(): number {
    return this.queue.length;
  }

  // ---- per-frame ---------------------------------------------------------

  update(): void {
    const previousTime = this._songTime;
    this._songTime = this.player.playbackTime;
    this._deltaSeconds = Math.max(0, this._songTime - previousTime);
    this._absoluteBeat = this.tempo.timeToBeats(this._songTime);

    this.fireDueEvents();
    this.fireBeatListeners();
  }

  private fireDueEvents(): void {
    while (this.queue.length > 0 && this.queue[0].beat <= this._absoluteBeat) {
      const entry = this.queue.shift()!;
      if (entry.cancelled) continue;
      this.recordLatency(entry.beat);
      entry.callback(entry.beat);
    }
  }

  private recordLatency(scheduledBeat: number): void {
    // How far past its musical position the callback actually ran. Bounded by
    // frame time; surfaced in the HUD as the sync-health number.
    const latencyMs = (this._songTime - this.tempo.beatsToTime(scheduledBeat)) * 1000;
    const s = this._stats;
    s.fired += 1;
    s.lastLatencyMs = latencyMs;
    s.maxLatencyMs = Math.max(s.maxLatencyMs, latencyMs);
    this.latencySum += latencyMs;
    s.meanLatencyMs = this.latencySum / s.fired;
  }

  private fireBeatListeners(): void {
    const whole = Math.floor(this._absoluteBeat);
    if (whole <= this.lastWholeBeat) return;
    // Catch up one beat at a time so listeners never miss a beat after a hitch.
    for (let b = this.lastWholeBeat + 1; b <= whole; b++) {
      const pos = absoluteToPosition(b, this.tempo.beatsPerBar);
      for (const l of this.beatListeners) l(b, pos);
    }
    this.lastWholeBeat = whole;
  }
}

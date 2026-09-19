/**
 * Musical-time <-> playback-time conversion.
 *
 * Everything downstream of BeatClock speaks in *absolute beats* (a 0-based
 * float counted from the first beat of the song). The TempoMap is the only
 * place that knows how a beat relates to a second, which is what keeps the
 * rest of the architecture from being welded to constant-BPM math: swapping in
 * BeatGridTempoMap (driven by analyzed beat timestamps, variable tempo) changes
 * nothing anywhere else.
 *
 * Conventions, matching beatbound_library_v1/README.md:
 *   - `bar` is 1-based.
 *   - `beat` is 1-based within a bar and may be fractional (1.5, 2.5, ...).
 *   - `absoluteBeat` is 0-based and continuous: bar 1 beat 1 == 0.0.
 */

import type { MusicalPositionSpec } from './types';

/** A resolved read-out of "where are we in the music right now". */
export interface MusicalPosition {
  /** 1-based bar number. */
  bar: number;
  /** 1-based beat within the bar (integer part of the current beat). */
  beat: number;
  /** 0..1 progress through the current beat. */
  beatProgress: number;
  /** 0-based continuous beat from song start. */
  absoluteBeat: number;
}

export interface TempoMap {
  readonly timeSignature: [number, number];
  readonly beatsPerBar: number;
  /** Playback seconds -> absolute beat (0-based, continuous). */
  timeToBeats(seconds: number): number;
  /** Absolute beat -> playback seconds. */
  beatsToTime(beats: number): number;
  /** Local beat length in seconds (constant for fixed BPM, varies for a beat grid). */
  secondsPerBeatAt(beats: number): number;
}

/** bar/beat (both 1-based) -> absolute 0-based beat. */
export function barBeatToAbsolute(bar: number, beat: number, beatsPerBar: number): number {
  return (bar - 1) * beatsPerBar + (beat - 1);
}

/** Resolve a pattern-relative `at` spec into an absolute beat offset from the pattern start. */
export function specToRelativeBeats(spec: MusicalPositionSpec, beatsPerBar: number): number {
  return barBeatToAbsolute(spec.bar, spec.beat, beatsPerBar) + (spec.offsetBeats ?? 0);
}

/** absolute 0-based beat -> readable bar/beat position. */
export function absoluteToPosition(absoluteBeat: number, beatsPerBar: number): MusicalPosition {
  const safe = Math.max(0, absoluteBeat);
  const bar = Math.floor(safe / beatsPerBar) + 1;
  const beatInBar = safe - (bar - 1) * beatsPerBar;
  return {
    bar,
    beat: Math.floor(beatInBar) + 1,
    beatProgress: beatInBar - Math.floor(beatInBar),
    absoluteBeat,
  };
}

/** Fixed-BPM tempo map. What the MVP levels use. */
export class ConstantTempoMap implements TempoMap {
  readonly beatsPerBar: number;
  private readonly secondsPerBeat: number;

  constructor(
    readonly bpm: number,
    readonly timeSignature: [number, number] = [4, 4],
  ) {
    if (bpm <= 0) throw new Error(`ConstantTempoMap: bpm must be > 0 (got ${bpm})`);
    this.beatsPerBar = timeSignature[0];
    // BPM is expressed in the time signature's denominator note (4/4 -> quarter notes).
    this.secondsPerBeat = 60 / bpm;
  }

  timeToBeats(seconds: number): number {
    return seconds / this.secondsPerBeat;
  }

  beatsToTime(beats: number): number {
    return beats * this.secondsPerBeat;
  }

  secondsPerBeatAt(_beats: number): number {
    return this.secondsPerBeat;
  }
}

/**
 * Variable-tempo map driven by an externally analyzed beat grid.
 *
 * Not used by the MVP levels -- it exists so the future audio-analysis pipeline
 * (Audio -> BPM/Beat/Downbeat -> AI Director -> Level JSON) can hand the runtime
 * exact beat timestamps instead of a single BPM, without touching BeatClock,
 * PatternScheduler or any mechanic.
 */
export class BeatGridTempoMap implements TempoMap {
  readonly beatsPerBar: number;
  /** Seconds at which each beat lands; index i == absolute beat i. */
  private readonly grid: readonly number[];

  constructor(beatTimesSeconds: readonly number[], readonly timeSignature: [number, number] = [4, 4]) {
    if (beatTimesSeconds.length < 2) {
      throw new Error('BeatGridTempoMap: need at least 2 beat timestamps');
    }
    this.grid = [...beatTimesSeconds].sort((a, b) => a - b);
    this.beatsPerBar = timeSignature[0];
  }

  private intervalAt(index: number): number {
    const i = Math.min(Math.max(index, 0), this.grid.length - 2);
    return this.grid[i + 1] - this.grid[i];
  }

  timeToBeats(seconds: number): number {
    const g = this.grid;
    if (seconds <= g[0]) return (seconds - g[0]) / this.intervalAt(0);
    const last = g.length - 1;
    if (seconds >= g[last]) return last + (seconds - g[last]) / this.intervalAt(last - 1);

    // Binary search for the bracketing beat, then interpolate inside it.
    let lo = 0;
    let hi = last;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (g[mid] <= seconds) lo = mid;
      else hi = mid;
    }
    return lo + (seconds - g[lo]) / (g[hi] - g[lo]);
  }

  beatsToTime(beats: number): number {
    const g = this.grid;
    const last = g.length - 1;
    if (beats <= 0) return g[0] + beats * this.intervalAt(0);
    if (beats >= last) return g[last] + (beats - last) * this.intervalAt(last - 1);
    const i = Math.floor(beats);
    return g[i] + (beats - i) * (g[i + 1] - g[i]);
  }

  secondsPerBeatAt(beats: number): number {
    return this.intervalAt(Math.floor(beats));
  }
}

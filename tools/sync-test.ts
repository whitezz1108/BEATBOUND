/**
 * Headless timing / scheduling test.
 *
 * Runs BeatClock + LevelLoader + PatternScheduler + MechanicRegistry against the
 * real JSON library, with a fake SongPlayer standing in for audio, and checks
 * that every mechanic activates on the musical position its pattern declares.
 *
 *   npm run test:timing
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { BeatClock } from '../src/core/BeatClock';
import { LevelLoader } from '../src/core/LevelLoader';
import { MechanicRegistry } from '../src/core/MechanicRegistry';
import { PatternScheduler, type SpawnedMechanicInfo } from '../src/core/PatternScheduler';
import { registerArenaMechanics } from '../src/mechanics/arena';
import { specToRelativeBeats } from '../src/core/TempoMap';
import type { SongPlayer } from '../src/core/AudioEngine';
import { COUNT_IN_BEATS } from '../src/config';

// Run from the project root (npm scripts always are).
const LIBRARY_DIR = resolve(process.cwd(), 'beatbound_library_v1');

// Serve the library files to LevelLoader's fetch() calls.
(globalThis as unknown as { fetch: unknown }).fetch = async (url: string) => ({
  ok: true,
  status: 200,
  json: async () => JSON.parse(readFileSync(resolve(LIBRARY_DIR, url.replace(/^\//, '')), 'utf8')),
});

/** Scriptable stand-in for BufferSongPlayer: playback time we advance by hand. */
class FakeSongPlayer implements SongPlayer {
  playbackTime = 0;
  isPlaying = true;
  isPaused = false;
  duration = Infinity;
  sourceLabel = 'fake';
  start(): void {}
  stop(): void { this.isPlaying = false; }
  pause(): void { this.isPaused = true; }
  resume(): void { this.isPaused = false; }
  update(): void {}
}

let failures = 0;
function check(name: string, ok: boolean, detail = ''): void {
  if (ok) {
    console.log(`  PASS  ${name}`);
  } else {
    failures += 1;
    console.log(`  FAIL  ${name}${detail ? ` -- ${detail}` : ''}`);
  }
}

function approx(a: number, b: number, tolerance = 1e-9): boolean {
  return Math.abs(a - b) <= tolerance;
}

async function main(): Promise<void> {
  const loader = new LevelLoader();
  const level = await loader.load({
    levelUrl: '/arena_test.level.json',
    patternsUrl: '/patterns.mvp.json',
    mechanicsUrl: '/mechanics.mvp.json',
  });

  console.log(`\nLevel: ${level.song.title} (${level.song.bpm} BPM, ${level.song.timeSignature.join('/')}), ${level.sections.length} sections, ends at bar ${level.endBar}`);
  for (const w of level.warnings) console.log(`  warn: ${w}`);

  const registry = new MechanicRegistry();
  registry.loadLibrary(loader.mechanics);
  registerArenaMechanics(registry);

  const player = new FakeSongPlayer();
  const clock = new BeatClock(player, level.tempo);
  const scheduler = new PatternScheduler(clock, registry);

  const spawns: SpawnedMechanicInfo[] = [];
  const firedAt: number[] = [];
  scheduler.onMechanicSpawned((info) => {
    spawns.push(info);
    firedAt.push(clock.absoluteBeat);
  });
  scheduler.scheduleLevel(level);

  // --- expected activation beats, recomputed straight from the JSON ---------
  const beatsPerBar = level.tempo.beatsPerBar;
  const expected: Array<{ beat: number; mechanicId: string; patternId: string }> = [];
  for (const section of level.sections) {
    for (const placement of section.placements) {
      const base = (placement.startBar - 1) * beatsPerBar;
      for (const event of placement.pattern.events) {
        expected.push({
          beat: base + specToRelativeBeats(event.at, beatsPerBar),
          mechanicId: event.mechanicId,
          patternId: placement.pattern.id,
        });
      }
    }
  }
  expected.sort((a, b) => a.beat - b.beat);

  // --- simulate playback with deliberately uneven frame times ---------------
  const endBeat = (level.endBar - 1) * beatsPerBar;
  const endTime = level.tempo.beatsToTime(endBeat) + 1;
  // Playback begins during the count-in (negative song time), exactly as the
  // game does -- otherwise a bar-1 telegraph would look "late" at time zero.
  player.playbackTime = -level.tempo.beatsToTime(COUNT_IN_BEATS);
  // Jitter between ~8ms and ~50ms so this also exercises hitching frames.
  const frameTimes = [0.0166, 0.0166, 0.0083, 0.05, 0.0166, 0.0333, 0.0166];
  let frame = 0;
  let maxFrameSeconds = 0;
  while (player.playbackTime < endTime) {
    const dt = frameTimes[frame++ % frameTimes.length];
    maxFrameSeconds = Math.max(maxFrameSeconds, dt);
    player.playbackTime += dt;
    clock.update();
  }

  console.log('\nScheduling');
  check('every scheduled event spawned a mechanic',
    scheduler.spawnedMechanicCount === scheduler.scheduledEventCount && spawns.length === expected.length,
    `scheduled=${scheduler.scheduledEventCount} spawned=${scheduler.spawnedMechanicCount} expected=${expected.length}`);
  check('scheduler queue fully drained', clock.pendingCount === 0, `${clock.pendingCount} left`);

  const actual = [...spawns].sort((a, b) => a.activationBeat - b.activationBeat);
  const beatsMatch = actual.every((s, i) => approx(s.activationBeat, expected[i].beat));
  check('activation beats match the JSON musical positions', beatsMatch,
    beatsMatch ? '' : firstMismatch(actual, expected));
  check('mechanic ids match the JSON order',
    actual.every((s, i) => s.mechanic.definitionId === expected[i].mechanicId));

  console.log('\nSynchronization');
  // Every mechanic must be alive (spawned) before its activation beat, so its
  // telegraph is actually visible.
  const telegraphRespected = spawns.every((s, i) => firedAt[i] <= s.activationBeat + 1e-9);
  check('every mechanic spawned at or before its activation beat', telegraphRespected);

  const maxLatencyBeats = clock.stats.maxLatencyMs / 1000 / level.tempo.secondsPerBeatAt(0);
  const frameBudgetBeats = maxFrameSeconds / level.tempo.secondsPerBeatAt(0);
  check('worst callback lateness stays within one frame',
    maxLatencyBeats <= frameBudgetBeats + 1e-6,
    `${clock.stats.maxLatencyMs.toFixed(2)}ms late vs ${(maxFrameSeconds * 1000).toFixed(1)}ms frame`);
  console.log(`        mean lateness ${clock.stats.meanLatencyMs.toFixed(2)}ms over ${clock.stats.fired} callbacks`);

  // Drift: musical time is derived from playback time, never accumulated.
  const derived = level.tempo.timeToBeats(player.playbackTime);
  check('no accumulated drift after the full run',
    approx(clock.absoluteBeat, derived, 1e-9),
    `clock=${clock.absoluteBeat} derived=${derived}`);

  console.log('\nAP01 Checkerboard');
  const ap01 = actual.filter((s) => s.patternId === 'AP01');
  const firstAp01 = ap01.slice(0, 4);
  check('fires on beats 1 and 3 of each bar',
    firstAp01.map((s) => s.activationBeat).join(',') === '0,2,4,6',
    firstAp01.map((s) => s.activationBeat).join(','));
  check('alternates checker_A / checker_B',
    firstAp01.map((s) => String(s.event.params?.layout)).join(',') === 'checker_A,checker_B,checker_A,checker_B');
  check('all AP01 events use A01', ap01.every((s) => s.mechanic.definitionId === 'A01'));

  console.log('\nAP03 Four Direction Chain');
  const ap03 = actual.filter((s) => s.patternId === 'AP03').slice(0, 4);
  check('one chain per beat across a bar',
    ap03.map((s) => s.activationBeat - ap03[0].activationBeat).join(',') === '0,1,2,3',
    ap03.map((s) => s.activationBeat).join(','));
  check('direction order is L2R, T2B, R2L, B2T',
    ap03.map((s) => String(s.event.params?.direction)).join(',')
      === 'LEFT_TO_RIGHT,TOP_TO_BOTTOM,RIGHT_TO_LEFT,BOTTOM_TO_TOP',
    ap03.map((s) => String(s.event.params?.direction)).join(','));
  check('all AP03 events use A05', ap03.every((s) => s.mechanic.definitionId === 'A05'));

  console.log('\nAP02 Side Volley');
  const ap02 = actual.filter((s) => s.patternId === 'AP02').slice(0, 4);
  check('spawn sides cycle LEFT, RIGHT, TOP, BOTTOM',
    ap02.map((s) => String(s.event.params?.spawnSide)).join(',') === 'LEFT,RIGHT,TOP,BOTTOM');
  check('all AP02 events use A03', ap02.every((s) => s.mechanic.definitionId === 'A03'));

  console.log(failures === 0 ? '\nAll timing checks passed.\n' : `\n${failures} check(s) failed.\n`);
  process.exit(failures === 0 ? 0 : 1);
}

function firstMismatch(
  actual: SpawnedMechanicInfo[],
  expected: Array<{ beat: number; mechanicId: string }>,
): string {
  for (let i = 0; i < actual.length; i++) {
    if (!approx(actual[i].activationBeat, expected[i].beat)) {
      return `index ${i}: got ${actual[i].activationBeat} expected ${expected[i].beat}`;
    }
  }
  return '';
}

void main();

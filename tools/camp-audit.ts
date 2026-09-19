/**
 * Camping audit: can a player beat a dodge section without moving?
 *
 * For every ARENA section it simulates the real mechanics and, for a grid of
 * standing positions, counts how many hits a motionless player would take
 * (using the same one-beat invulnerability the game applies). A section where
 * some position takes zero hits is trivially beatable by standing still --
 * exactly the flaw that made A05 chains pointless before their lanes tiled.
 *
 *   npm run audit
 *   npm run audit -- arena_showcase.level.json
 *
 * RUNNER, VERTICAL and RADIAL are skipped: the player cannot stand still in
 * them by construction (auto-run, or judged input).
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { BeatClock } from '../src/core/BeatClock';
import { LevelLoader, type CompiledLevel, type CompiledSection } from '../src/core/LevelLoader';
import { MechanicRegistry } from '../src/core/MechanicRegistry';
import { PatternScheduler } from '../src/core/PatternScheduler';
import { registerArenaMechanics } from '../src/mechanics/arena';
import { registerRunnerMechanics } from '../src/mechanics/runner';
import { registerVerticalMechanics } from '../src/mechanics/vertical';
import { registerRadialMechanics } from '../src/mechanics/radial';
import { circleIntersectsShape, type Shape } from '../src/core/geometry';
import type { RuntimeMechanic } from '../src/core/Mechanic';
import type { SongPlayer } from '../src/core/AudioEngine';
import { DATA, loadLevelIndex } from '../src/config';

const LIBRARY_DIR = resolve(process.cwd(), 'beatbound_library_v1');
(globalThis as unknown as { fetch: unknown }).fetch = async (url: string) => ({
  ok: true,
  status: 200,
  json: async () => JSON.parse(readFileSync(resolve(LIBRARY_DIR, url.replace(/^\//, '')), 'utf8')),
});

/** Must match ArenaPlayer. */
const PLAYER_RADIUS = 0.032;
const INVULNERABLE_BEATS = 1;
/** Standing positions sampled per axis. */
const GRID = 41;
/** Simulation resolution. */
const STEPS_PER_BEAT = 16;

class FakeSongPlayer implements SongPlayer {
  playbackTime = 0;
  isPlaying = true;
  isPaused = false;
  duration = Infinity;
  sourceLabel = 'audit';
  start(): void {}
  stop(): void {}
  pause(): void {}
  resume(): void {}
  update(): void {}
}

interface SectionResult {
  section: CompiledSection;
  /** Fewest hits any standing position takes. 0 means campable. */
  minHits: number;
  /** How many sampled positions take zero hits. */
  safeSpots: number;
  totalSpots: number;
  bestSpot: { x: number; y: number };
}

function registerAll(registry: MechanicRegistry): void {
  registerArenaMechanics(registry);
  registerRunnerMechanics(registry);
  registerVerticalMechanics(registry);
  registerRadialMechanics(registry);
}

function auditSection(level: CompiledLevel, section: CompiledSection): SectionResult {
  const loaderMechanics = (level as unknown as { mechanicLibrary?: never }); // unused; registry below owns data
  void loaderMechanics;

  const registry = new MechanicRegistry();
  registry.loadLibrary(auditSection.library!);
  registerAll(registry);

  const player = new FakeSongPlayer();
  const clock = new BeatClock(player, level.tempo);
  const scheduler = new PatternScheduler(clock, registry);
  const live: RuntimeMechanic[] = [];
  scheduler.onMechanicSpawned((info) => live.push(info.mechanic));
  scheduler.scheduleSection(section);

  const beatsPerBar = level.tempo.beatsPerBar;
  const startBeat = (section.startBar - 1) * beatsPerBar - beatsPerBar;
  const endBeat = (section.endBar - 1) * beatsPerBar + beatsPerBar;

  const spots = GRID * GRID;
  const hits = new Int32Array(spots);
  const invulnerableUntil = new Float64Array(spots).fill(-Infinity);

  const step = 1 / STEPS_PER_BEAT;
  for (let beat = startBeat; beat <= endBeat; beat += step) {
    player.playbackTime = level.tempo.beatsToTime(beat);
    clock.update();

    const shapes: Shape[] = [];
    for (const m of live) {
      m.update({ beat, deltaSeconds: level.tempo.beatsToTime(step), secondsPerBeat: level.tempo.secondsPerBeatAt(beat) });
      shapes.push(...m.hazards());
    }
    for (let i = live.length - 1; i >= 0; i--) {
      if (live[i].isFinished) live.splice(i, 1);
    }
    if (shapes.length === 0) continue;

    for (let gy = 0; gy < GRID; gy++) {
      const y = clampToField(gy / (GRID - 1));
      for (let gx = 0; gx < GRID; gx++) {
        const index = gy * GRID + gx;
        if (beat < invulnerableUntil[index]) continue;
        const x = clampToField(gx / (GRID - 1));
        const body = { x, y, r: PLAYER_RADIUS };
        for (const shape of shapes) {
          if (!circleIntersectsShape(body, shape)) continue;
          hits[index] += 1;
          invulnerableUntil[index] = beat + INVULNERABLE_BEATS;
          break;
        }
      }
    }
  }

  let minHits = Infinity;
  let safeSpots = 0;
  let best = { x: 0.5, y: 0.5 };
  for (let i = 0; i < spots; i++) {
    if (hits[i] === 0) safeSpots += 1;
    if (hits[i] < minHits) {
      minHits = hits[i];
      best = { x: clampToField((i % GRID) / (GRID - 1)), y: clampToField(Math.floor(i / GRID) / (GRID - 1)) };
    }
  }
  return { section, minHits, safeSpots, totalSpots: spots, bestSpot: best };
}
// Mechanic data is shared across sections; stashed here to keep the signature small.
auditSection.library = null as Parameters<MechanicRegistry['loadLibrary']>[0] | null;

/** The avatar cannot stand with its centre in the outer margin. */
function clampToField(v: number): number {
  return Math.min(Math.max(v, PLAYER_RADIUS), 1 - PLAYER_RADIUS);
}

async function main(): Promise<void> {
  const [levelArg] = process.argv.slice(2);
  const files = levelArg
    ? [levelArg.replace(/^\//, '')]
    : (await loadLevelIndex()).map((e) => e.file);

  let campable = 0;
  console.log('\nCamping audit -- hits taken by a player who never moves\n');
  console.log(`${'level'.padEnd(28)}${'section'.padEnd(10)}${'min hits'.padEnd(10)}${'safe spots'.padEnd(13)}verdict`);

  for (const file of files) {
    const loader = new LevelLoader();
    const level = await loader.load({
      levelUrl: `/${file}`,
      patternsUrl: DATA.patterns,
      mechanicsUrl: DATA.mechanics,
    });
    auditSection.library = loader.mechanics;

    const arena = level.sections.filter((s) => s.mode === 'ARENA');
    if (arena.length === 0) {
      console.log(`${file.padEnd(28)}${'-'.padEnd(10)}${'-'.padEnd(10)}${'-'.padEnd(13)}skipped (no ARENA sections)`);
      continue;
    }
    for (const section of arena) {
      const r = auditSection(level, section);
      const ok = r.minHits > 0;
      if (!ok) campable += 1;
      const verdict = ok
        ? `ok (must move)`
        : `CAMPABLE at (${r.bestSpot.x.toFixed(2)}, ${r.bestSpot.y.toFixed(2)})`;
      console.log(
        `${file.padEnd(28)}${r.section.id.padEnd(10)}${String(r.minHits).padEnd(10)}` +
        `${`${r.safeSpots}/${r.totalSpots}`.padEnd(13)}${verdict}`,
      );
    }
  }

  console.log(
    campable === 0
      ? '\nNo ARENA section can be beaten by standing still.\n'
      : `\n${campable} section(s) can be beaten by standing still.\n`,
  );
  process.exit(campable === 0 ? 0 : 1);
}

void main();

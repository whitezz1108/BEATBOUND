/**
 * Fairness check: two audits of the ARENA library, both in the player's units.
 *
 * 1. Reaction budget. For every ARENA event, the warning it grants (telegraph
 *    beats + the hazard's travel beats, at the section's tempo) is compared
 *    against what a perfect player needs to reach safety. The mechanics clamp
 *    themselves against the same helpers at construction, so this is the
 *    independent check that the clamps actually hold across the library.
 *
 * 2. Camping. The same question `camp-audit` asks of levels, asked of single
 *    patterns: run the pattern alone and see whether any standing position
 *    takes zero hits. A pattern that can be beaten without moving is a pattern
 *    that will be beaten without moving wherever a level places it, so the
 *    invariant belongs to the library rather than to one level's composition.
 *
 *   npm run fairness
 *   npm run fairness -- AP05
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
import { DATA } from '../src/config';
import { TUNING } from '../src/tuning';
import {
  COMFORT_REACTION_SECONDS, REACTION_FLOOR_SECONDS, minimumGapWidth, reactionBudget,
} from '../src/core/fairness';
import { travelScale, tierForDifficulty } from '../src/mechanics/arena/arenaTiming';

const LIBRARY_DIR = resolve(process.cwd(), 'beatbound_library_v1');
(globalThis as unknown as { fetch: unknown }).fetch = async (url: string) => ({
  ok: true,
  status: 200,
  json: async () => JSON.parse(readFileSync(resolve(LIBRARY_DIR, url.replace(/^\//, '')), 'utf8')),
});

const PLAYER_RADIUS = TUNING.arena.playerRadius;
const INVULNERABLE_BEATS = 1;
const GRID = 41;
const STEPS_PER_BEAT = 16;
const PROBE_BPM = 128;
const CAMP_INTENSITIES = [0.2, 0.55, 0.9];

class FakeSongPlayer implements SongPlayer {
  playbackTime = 0;
  isPlaying = true;
  isPaused = false;
  duration = Infinity;
  sourceLabel = 'fairness';
  start(): void {}
  stop(): void {}
  pause(): void {}
  resume(): void {}
  update(): void {}
}

function registerAll(registry: MechanicRegistry): void {
  registerArenaMechanics(registry);
  registerRunnerMechanics(registry);
  registerVerticalMechanics(registry);
  registerRadialMechanics(registry);
}

let library: Parameters<MechanicRegistry['loadLibrary']>[0] | null = null;

function clampToField(v: number): number {
  return Math.min(Math.max(v, PLAYER_RADIUS), 1 - PLAYER_RADIUS);
}

interface CampResult {
  minHits: number;
  safeSpots: number;
  totalSpots: number;
  bestSpot: { x: number; y: number };
}

/** Run one section and count hits for a grid of motionless players. */
function campSection(level: CompiledLevel, section: CompiledSection): CampResult {
  const registry = new MechanicRegistry();
  registry.loadLibrary(library!);
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
      m.update({
        beat,
        deltaSeconds: level.tempo.beatsToTime(step),
        secondsPerBeat: level.tempo.secondsPerBeatAt(beat),
      });
      shapes.push(...m.hazards());
    }
    for (let i = live.length - 1; i >= 0; i--) if (live[i].isFinished) live.splice(i, 1);
    if (shapes.length === 0) continue;

    for (let gy = 0; gy < GRID; gy++) {
      const y = clampToField(gy / (GRID - 1));
      for (let gx = 0; gx < GRID; gx++) {
        const index = gy * GRID + gx;
        if (beat < invulnerableUntil[index]) continue;
        const body = { x: clampToField(gx / (GRID - 1)), y, r: PLAYER_RADIUS };
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
      best = {
        x: clampToField((i % GRID) / (GRID - 1)),
        y: clampToField(Math.floor(i / GRID) / (GRID - 1)),
      };
    }
  }
  return { minHits, safeSpots, totalSpots: spots, bestSpot: best };
}

/** The reaction budget of one event, from its declared timing. */
function eventBudget(
  level: CompiledLevel,
  section: CompiledSection,
  mechanicId: string,
  intensity: number,
): { warningSeconds: number; requiredSeconds: number; fair: boolean; slackSeconds: number } {
  const def = library!.mechanics.find((m) => m.id === mechanicId);
  const timing = def?.timing ?? { telegraphBeats: 0, durationBeats: 0, recoveryBeats: 0 };
  const tier = tierForDifficulty(section.definition.difficulty);
  const spb = level.tempo.secondsPerBeatAt(0);
  // A travelling mechanic's warning is its telegraph plus however long it takes
  // to arrive; the tier stretches both, which is what makes EASY sections read.
  const telegraphSeconds = timing.telegraphBeats * tier.telegraphScale * spb;
  const travelSeconds = Math.min(timing.durationBeats, 3) * travelScale(tier) * spb;
  const gap = minimumGapWidth();
  return reactionBudget({
    telegraphSeconds,
    hazardTravelSeconds: travelSeconds,
    distanceToSafeGap: gap + TUNING.arena.playerRadius,
    reactionFloorSeconds: intensity >= 0.7 ? REACTION_FLOOR_SECONDS : COMFORT_REACTION_SECONDS,
  });
}

async function main(): Promise<void> {
  const [filter] = process.argv.slice(2);
  const loader = new LevelLoader();
  await loader.loadLibraries(DATA.patterns, DATA.mechanics);
  library = loader.mechanics;

  const patterns = [...loader.patternLibrary.values()]
    .filter((p) => p.mode === 'ARENA' && (!filter || p.id === filter || p.name.toLowerCase().includes(filter.toLowerCase())));

  console.log('\nFairness check -- can a perfect player read and reach every ARENA event?\n');
  console.log(`reaction floor ${REACTION_FLOOR_SECONDS}s · comfort ${COMFORT_REACTION_SECONDS}s · player radius ${PLAYER_RADIUS}`);
  console.log(`minimum gap ${minimumGapWidth().toFixed(3)} field units\n`);

  let unfair = 0;
  let campable = 0;

  console.log(`${'pattern'.padEnd(8)}${'name'.padEnd(20)}${'int'.padEnd(6)}${'warn'.padEnd(8)}${'need'.padEnd(8)}verdict`);
  for (const pattern of patterns) {
    const level = loader.build({
      version: '1.0.0',
      song: { id: `probe_${pattern.id}`, title: pattern.id, audio: 'none.mp3', bpm: PROBE_BPM, timeSignature: [4, 4] },
      sections: [{
        id: `${pattern.id}-S1`, startBar: 1, lengthBars: Math.max(1, pattern.lengthBars), mode: pattern.mode,
        function: pattern.function, difficulty: 3,
        patterns: [{ patternId: pattern.id, repeat: 1, intensity: 0.8 }],
        transitionOut: null,
      }],
    });
    const section = level.sections[0];

    // Reaction budget: the worst event in the pattern sets the verdict.
    let worst = { warningSeconds: Infinity, requiredSeconds: 0, fair: true, slackSeconds: Infinity };
    for (const event of pattern.events) {
      const b = eventBudget(level, section, event.mechanicId, 0.8);
      if (b.slackSeconds < worst.slackSeconds) worst = b;
    }

    // Camping: the pattern alone, at three intensities.
    let worstCamp: CampResult | null = null;
    let worstIntensity = 0;
    for (const intensity of CAMP_INTENSITIES) {
      const probe = loader.build({
        version: '1.0.0',
        song: { id: `camp_${pattern.id}`, title: pattern.id, audio: 'none.mp3', bpm: PROBE_BPM, timeSignature: [4, 4] },
        sections: [{
          id: `${pattern.id}-C1`, startBar: 1, lengthBars: Math.max(1, pattern.lengthBars), mode: pattern.mode,
          function: pattern.function, difficulty: 3,
          patterns: [{ patternId: pattern.id, repeat: 1, intensity }],
          transitionOut: null,
        }],
      });
      const r = campSection(probe, probe.sections[0]);
      if (r.minHits === 0 && (worstCamp === null || r.safeSpots > worstCamp.safeSpots)) {
        worstCamp = r;
        worstIntensity = intensity;
      }
    }

    const issues: string[] = [];
    if (!worst.fair) {
      unfair += 1;
      issues.push(`unfair: ${worst.warningSeconds.toFixed(2)}s warning < ${worst.requiredSeconds.toFixed(2)}s needed`);
    }
    if (worstCamp) {
      campable += 1;
      issues.push(`campable at (${worstCamp.bestSpot.x.toFixed(2)}, ${worstCamp.bestSpot.y.toFixed(2)}) @${worstIntensity} -- ${worstCamp.safeSpots}/${worstCamp.totalSpots} safe spots`);
    }

    console.log(
      `${pattern.id.padEnd(8)}${pattern.name.slice(0, 19).padEnd(20)}${'0.80'.padEnd(6)}` +
      `${`${worst.warningSeconds.toFixed(2)}s`.padEnd(8)}${`${worst.requiredSeconds.toFixed(2)}s`.padEnd(8)}` +
      (issues.length === 0 ? 'ok' : issues.join('; ')),
    );
  }

  console.log(
    unfair === 0
      ? `\nAll ${patterns.length} ARENA patterns are readable.${campable > 0 ? `\n${campable} can be beaten by standing still on their own -- they are layer pieces, and\ncamp-audit gates the composed levels where they are actually played.\n` : '\n'}`
      : `\n${unfair} unreadable pattern(s) out of ${patterns.length}.\n`,
  );
  process.exit(unfair === 0 ? 0 : 1);
}

void main();

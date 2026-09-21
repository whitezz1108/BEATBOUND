/**
 * Headless verification of the A12 input path: can a player light the arrow
 * prompts and break the seal, exactly as BreakoutController routes the keys?
 *
 * Mirrors the controller's contract (isSequenceEncounter -> capturesInput ->
 * pressDirection / pressConfirm) against the real level data, with no DOM:
 *
 *   1. pressing the pending arrow while the seal is live lights that step
 *   2. a wrong arrow is a MISS
 *   3. pressing SPACE on the final beat breaks the seal
 *
 * Run: npm run sim:breakout
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const LIBRARY_DIR = resolve(process.cwd(), 'beatbound_library_v1');
(globalThis as unknown as { fetch: unknown }).fetch = async (url: string) => ({
  ok: true,
  status: 200,
  json: async () => JSON.parse(readFileSync(resolve(LIBRARY_DIR, url.replace(/^\//, '')), 'utf8')),
});

import { BeatClock } from '../src/core/BeatClock';
import { LevelLoader } from '../src/core/LevelLoader';
import { MechanicRegistry } from '../src/core/MechanicRegistry';
import { PatternScheduler } from '../src/core/PatternScheduler';
import { registerArenaMechanics } from '../src/mechanics/arena';
import { isSequenceEncounter } from '../src/core/capabilities';
import type { RuntimeMechanic } from '../src/core/Mechanic';
import type { SongPlayer } from '../src/core/AudioEngine';
import type { BreakoutDirection } from '../src/mechanics/arena/breakoutSequence';

class FakeSongPlayer implements SongPlayer {
  playbackTime = 0;
  isPlaying = true;
  isPaused = false;
  duration = Infinity;
  sourceLabel = 'sim';
  start(): void {}
  stop(): void {}
  pause(): void {}
  resume(): void {}
  update(): void {}
}

/** What the sim records about one seal encounter. */
interface SealRun {
  beat: number;
  label: string;
  stepsHit: number;
  stepsTotal: number;
  misses: number;
  outcome: string;
  /** True if every step lit and the confirm broke the seal. */
  ok: boolean;
}

const loader = new LevelLoader();
const level = await loader.load({
  levelUrl: '/toosie_slide_arena_primary.level.json',
  patternsUrl: '/patterns.mvp.json',
  mechanicsUrl: '/mechanics.mvp.json',
});
const registry = new MechanicRegistry();
registry.loadLibrary(loader.mechanics);
registerArenaMechanics(registry);

const player = new FakeSongPlayer();
const clock = new BeatClock(player, level.tempo);
const scheduler = new PatternScheduler(clock, registry);
const live: RuntimeMechanic[] = [];
scheduler.onMechanicSpawned((info) => live.push(info.mechanic));
for (const section of level.sections) scheduler.scheduleSection(section);

const beatsPerBar = level.tempo.beatsPerBar;
const endBeat = Math.max(...level.sections.map((s) => (s.endBar - 1) * beatsPerBar)) + 8;
const STEP = 0.25;

interface Peek {
  steps: Array<{ direction: BreakoutDirection; state: string }>;
  pendingIndex(): number;
}
const peek = (m: RuntimeMechanic) =>
  (m as unknown as { sequence: Peek }).sequence;
const peekCore = (m: RuntimeMechanic) =>
  (m as unknown as { outcome: string; finalBeat: number; missBudget: number });

const runs: SealRun[] = [];
const seen = new Set<RuntimeMechanic>();
let pressedWrongOnce = false;

for (let beat = 0; beat <= endBeat; beat += STEP) {
  player.playbackTime = level.tempo.beatsToTime(beat);
  clock.update();

  for (const m of live) {
    m.update({ beat, deltaSeconds: 0.01, secondsPerBeat: level.tempo.secondsPerBeatAt(beat) });
  }
  for (let i = live.length - 1; i >= 0; i--) {
    if (live[i].isFinished) live.splice(i, 1);
  }

  for (const m of live) {
    if (!isSequenceEncounter(m)) continue;
    const seq = peek(m);
    if (!seq) continue; // other modes' SequenceEncounters (NoteMode) have no phrase row
    m.drainJudgements();
    if (!m.capturesInput(beat)) continue;

    const index = seq.pendingIndex();
    const core = peekCore(m);

    // First contact: one deliberate wrong press on the first encounter's
    // first step, so the MISS path is exercised too. Skips this tick's correct
    // press: the wrong press already consumed the front of the queue.
    if (!seen.has(m)) {
      seen.add(m);
      if (!pressedWrongOnce) {
        pressedWrongOnce = true;
        const wrong: BreakoutDirection = seq.steps[index].direction === 'N' ? 'W' : 'N';
        m.pressDirection(wrong, beat);
        continue;
      }
    }

    if (index < seq.steps.length) {
      m.pressDirection(seq.steps[index].direction, beat);
    } else if (core.outcome === 'PENDING' && Math.abs(beat - core.finalBeat) < STEP / 2) {
      m.pressConfirm(beat);
    }
  }

  // Snapshot every seal encounter that just resolved.
  for (const m of live) {
    if (!isSequenceEncounter(m)) continue;
    const seq = peek(m);
    if (!seq) continue;
    const core = peekCore(m);
    const resolved = core.outcome !== 'PENDING';
    if (resolved && !runs.some((r) => (r as unknown as { mech: RuntimeMechanic }).mech === m)) {
      const run = {
        mech: m,
        beat,
        stepsHit: seq.steps.filter((s) => s.state === 'HIT').length,
        stepsTotal: seq.steps.length,
        misses: seq.steps.filter((s) => s.state === 'MISSED').length,
        outcome: core.outcome,
        ok: false,
      } as unknown as SealRun;
      run.ok = run.stepsHit === run.stepsTotal - run.misses
        && run.misses <= 1
        && core.outcome === 'BROKEN';
      runs.push(run);
    }
  }
}

console.log(`seal encounters resolved: ${runs.length}`);
for (const r of runs) {
  console.log(
    `  beat ${r.beat.toFixed(1)}  ${r.stepsHit}/${r.stepsTotal} hit, ${r.misses} miss`
    + `  -> ${r.outcome}  ${r.ok ? 'OK' : '** FAIL **'}`,
  );
}

if (runs.length === 0) {
  console.error('FAIL: no seal encounters were resolved -- spawn/schedule broken?');
  process.exit(1);
}
if (runs.some((r) => !r.ok)) {
  console.error('FAIL: at least one encounter did not play through as designed.');
  process.exit(1);
}
console.log('PASS: arrows light the prompts, wrong press = miss, SPACE on the beat breaks the seal.');

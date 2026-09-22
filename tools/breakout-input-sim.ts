/**
 * Headless verification of the A12 input path: can a player light the arrow
 * prompts and break the seal, exactly as BreakoutController routes the keys,
 * and does each way of failing cost the health it is supposed to?
 *
 * Part one drives the real `BreakoutController` with a fake `Input` against
 * the real level data, with no DOM:
 *
 *   1. pressing the pending arrow while the seal is live lights that step
 *   2. a wrong arrow is a MISS
 *   3. pressing SPACE on the final beat breaks the seal
 *
 * Part two is the part that has to be checked rather than watched: a phrase
 * played perfectly, a phrase fumbled but saved on the beat, and an accent never
 * pressed must cost 0, `missDamage` and `accentMissDamage` respectively. Those
 * three numbers are the whole of the mechanic's fault tolerance, and the last
 * one is charged by a *collision* rather than by a rule, so it is the one most
 * likely to be silently wrong.
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
import { Input } from '../src/core/Input';
import { LevelLoader } from '../src/core/LevelLoader';
import { MechanicRegistry } from '../src/core/MechanicRegistry';
import { PatternScheduler } from '../src/core/PatternScheduler';
import { RunStatus } from '../src/core/RunStatus';
import { circleIntersectsShape } from '../src/core/geometry';
import { TUNING } from '../src/tuning';
import { registerArenaMechanics } from '../src/mechanics/arena';
import { isSequenceEncounter } from '../src/core/capabilities';
import { BreakoutController } from '../src/modes/arena/BreakoutController';
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

const beatsPerBar = level.tempo.beatsPerBar;
const STEP = 0.25;

interface Peek {
  steps: Array<{ direction: BreakoutDirection; state: string }>;
  pendingIndex(): number;
}
const peek = (m: RuntimeMechanic) => (m as unknown as { sequence: Peek }).sequence;
const peekCore = (m: RuntimeMechanic) =>
  (m as unknown as { outcome: string; finalBeat: number; missBudget: number; damageAmount: number });

// ---------------------------------------------------------------------------
// Part one: a full playthrough through the real controller.
// ---------------------------------------------------------------------------

/** The keys the controller reads, driven by hand instead of by a keyboard. */
function makeInput(): { input: Input; press(key: string): void; endFrame(): void } {
  const input = new Input();
  // `Input`'s own key handlers are DOM-bound, so the sim writes the same two
  // sets they write -- lowercase keys, press edge held for the frame only --
  // and the controller then reads the input exactly as it does in the game.
  const sets = input as unknown as { down: Set<string>; pressedThisFrame: Set<string> };
  return {
    input,
    press: (key) => {
      if (!sets.down.has(key)) sets.pressedThisFrame.add(key);
      sets.down.add(key);
    },
    // Every key lifts at the end of the frame. A sim that held keys down would
    // silently lose every repeat of a direction: `wasPressed` is an edge, and a
    // phrase of eight steps has directions in it more than once.
    endFrame: () => {
      input.endFrame();
      sets.down.clear();
    },
  };
}

/** The key a phrase step asks for. Arrows and WASD are the same press. */
const STEP_KEY: Record<BreakoutDirection, string> = { N: 'w', E: 'd', S: 's', W: 'a' };
const CONFIRM_KEY = ' ';

/**
 * The player, standing still at the encounter's own centre.
 *
 * The seal closes around wherever the player was when it spawned, so a player
 * who never moves is inside every one of its shapes. That is the worst case on
 * purpose: it is the one the damage numbers have to be right for.
 */
const BODY = { x: 0, y: 0, r: TUNING.arena.playerRadius };

const player = new FakeSongPlayer();
const clock = new BeatClock(player, level.tempo);
const scheduler = new PatternScheduler(clock, registry);
const live: RuntimeMechanic[] = [];
scheduler.onMechanicSpawned((info) => live.push(info.mechanic));
for (const section of level.sections) scheduler.scheduleSection(section);

const endBeat = Math.max(...level.sections.map((s) => (s.endBar - 1) * beatsPerBar)) + 8;

const status = new RunStatus();
const keyboard = makeInput();
const controller = new BreakoutController(keyboard.input, status);

const runs: SealRun[] = [];
const seen = new Set<RuntimeMechanic>();
let pressedWrongOnce = false;

for (let beat = 0; beat <= endBeat; beat += STEP) {
  const songTime = level.tempo.beatsToTime(beat);
  player.playbackTime = songTime;
  clock.update();
  keyboard.endFrame();

  for (const m of live) {
    m.update({ beat, deltaSeconds: 0.01, secondsPerBeat: level.tempo.secondsPerBeatAt(beat) });
  }
  for (let i = live.length - 1; i >= 0; i--) {
    if (live[i].isFinished) live.splice(i, 1);
  }

  // The player's decision for this frame, expressed as a key press. Edges only:
  // `Input.wasPressed` is what the controller reads, so the sim presses on the
  // frame and clears on the next one, exactly like a finger.
  for (const m of live) {
    if (!isSequenceEncounter(m)) continue;
    const seq = peek(m);
    if (!seq) continue; // other modes' SequenceEncounters (NoteMode) have no phrase row
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
        keyboard.press(STEP_KEY[seq.steps[index].direction === 'N' ? 'W' : 'N']);
        break;
      }
    }

    if (index < seq.steps.length) {
      keyboard.press(STEP_KEY[seq.steps[index].direction]);
    } else if (core.outcome === 'PENDING' && Math.abs(beat - core.finalBeat) < STEP / 2) {
      keyboard.press(CONFIRM_KEY);
    }
  }

  controller.update(live, beat, songTime, 0, 0);

  // Snapshot every seal encounter that just resolved.
  for (const m of live) {
    if (!isSequenceEncounter(m)) continue;
    const seq = peek(m);
    if (!seq) continue;
    const core = peekCore(m);
    if (core.outcome === 'PENDING') continue;
    if (runs.some((r) => (r as unknown as { mech: RuntimeMechanic }).mech === m)) continue;
    const run = {
      mech: m,
      beat,
      stepsHit: seq.steps.filter((s) => s.state === 'HIT').length,
      stepsTotal: seq.steps.length,
      misses: seq.steps.filter((s) => s.state === 'MISSED').length,
      outcome: core.outcome,
      ok: false,
    } as unknown as SealRun;
    run.ok = run.stepsHit + run.misses === run.stepsTotal && core.outcome === 'BROKEN';
    runs.push(run);
  }
}

console.log(`seal encounters resolved: ${runs.length}`);
for (const r of runs) {
  console.log(
    `  beat ${r.beat.toFixed(1)}  ${r.stepsHit}/${r.stepsTotal} hit, ${r.misses} miss`
    + `  -> ${r.outcome}  ${r.ok ? 'OK' : '** FAIL **'}`,
  );
}

let failures = 0;
const fail = (message: string) => { console.error(`FAIL: ${message}`); failures += 1; };

if (runs.length === 0) fail('no seal encounters were resolved -- spawn/schedule broken?');
if (runs.some((r) => !r.ok)) fail('at least one encounter did not play through as designed.');
console.log('PASS: arrows light the prompts, wrong press = miss, SPACE on the beat breaks the seal.');

// ---------------------------------------------------------------------------
// Part two: what a failed phrase costs.
//
// Each scenario replays one encounter from a fresh pool with a scripted policy,
// and asserts on the health the *run* lost -- not on anything the mechanic
// reports -- because the run is the only thing allowed to take health.
// ---------------------------------------------------------------------------

/** One scripted encounter: a policy for the arrows and one for the accent. */
interface Scenario {
  name: string;
  /** Which steps to play correctly. */
  arrows: 'all' | 'none';
  /** Whether SPACE is pressed on the beat. */
  accent: boolean;
}

interface ScenarioResult {
  lost: number;
  outcome: string;
  misses: number;
  accentMissDamage: number;
  missDamage: number;
  /** Every charge the run took, in order. A bare total hides which rule fired. */
  hits: Array<{ beat: number; source: string; amount: number }>;
}

async function playScenario(spec: Scenario): Promise<ScenarioResult> {
  const song = new FakeSongPlayer();
  const simClock = new BeatClock(song, level.tempo);
  const simScheduler = new PatternScheduler(simClock, registry);
  const simLive: RuntimeMechanic[] = [];
  simScheduler.onMechanicSpawned((info) => simLive.push(info.mechanic));
  for (const section of level.sections) simScheduler.scheduleSection(section);

  const simStatus = new RunStatus();
  const simKeyboard = makeInput();
  const simController = new BreakoutController(simKeyboard.input, simStatus);

  // One ledger for both charge paths: the encounter's own `drainDamage` goes
  // through the controller, and the collapse goes through the collision pass
  // below. Wrapping the run's `damage` is the only place that sees both, and
  // seeing both is the point -- a bare total hides which rule fired.
  const before = simStatus.health.currentHealth;
  const hits: Array<{ beat: number; source: string; amount: number }> = [];
  let nowBeat = 0;
  const realDamage = simStatus.damage.bind(simStatus);
  simStatus.damage = (source, songTime, amount) => {
    const event = realDamage(source, songTime, amount);
    if (event) hits.push({ beat: nowBeat, source: event.source, amount: event.amount });
    return event;
  };
  let result: ScenarioResult | null = null;

  for (let beat = 0; beat <= endBeat; beat += STEP) {
    nowBeat = beat;
    const songTime = level.tempo.beatsToTime(beat);
    song.playbackTime = songTime;
    simClock.update();
    simKeyboard.endFrame();

    for (const m of simLive) {
      m.update({ beat, deltaSeconds: 0.01, secondsPerBeat: level.tempo.secondsPerBeatAt(beat) });
    }
    for (let i = simLive.length - 1; i >= 0; i--) {
      if (simLive[i].isFinished) simLive.splice(i, 1);
    }

    for (const m of simLive) {
      if (!isSequenceEncounter(m)) continue;
      const seq = peek(m);
      if (!seq) continue;
      const core = peekCore(m);
      if (core.outcome !== 'PENDING') continue;
      if (!m.capturesInput(beat)) continue;

      // The two policies are independent, deliberately: a player who never
      // touched the arrows can still hit the accent, and that is exactly the
      // case the partial-damage rule exists for.
      if (spec.arrows === 'all') {
        const index = seq.pendingIndex();
        if (index < seq.steps.length) simKeyboard.press(STEP_KEY[seq.steps[index].direction]);
      }
      if (spec.accent && Math.abs(beat - core.finalBeat) < STEP / 2) {
        simKeyboard.press(CONFIRM_KEY);
      }
    }

    simController.update(simLive, beat, songTime, 0, 0);

    // The mode's collision pass, mirrored. The accent's penalty is delivered as
    // a *body* rather than as a rule -- the unbroken seal collapses through the
    // player -- so a sim that only drives the controller would report that the
    // worst failure in the encounter costs nothing.
    //
    // Scoped to the phrase encounters, unlike the mode's own pass: the level
    // has other ARENA mechanics whose hazards sweep the centre, and charging
    // those here would bury the numbers this sim exists to check.
    for (const m of simLive) {
      if (!isSequenceEncounter(m) || !peek(m)) continue;
      for (const shape of m.hazards()) {
        if (!circleIntersectsShape(BODY, shape)) continue;
        simStatus.damage(m.damageSource, songTime, m.damageAmount);
        break;
      }
    }

    if (result) continue;
    for (const m of simLive) {
      if (!isSequenceEncounter(m)) continue;
      const seq = peek(m);
      if (!seq) continue;
      const core = peekCore(m);
      if (core.outcome === 'PENDING') continue;
      // Let the collapse body actually reach the player before reading health:
      // the big penalty is a collision, and a collision needs a frame to land.
      result = {
        lost: 0, outcome: core.outcome, hits,
        misses: seq.steps.filter((s) => s.state === 'MISSED').length,
        accentMissDamage: core.damageAmount,
        missDamage: (m as unknown as { plan: { missDamage: number } }).plan.missDamage,
      };
    }
  }

  if (!result) throw new Error(`${spec.name}: no encounter resolved`);
  result.lost = before - simStatus.health.currentHealth;
  return result;
}

const scenarios: Scenario[] = [
  { name: 'clean phrase + SPACE', arrows: 'all', accent: true },
  { name: 'unplayed phrase + SPACE', arrows: 'none', accent: true },
  { name: 'clean phrase, no SPACE', arrows: 'all', accent: false },
];

const results: Array<{ spec: Scenario; got: ScenarioResult }> = [];
for (const spec of scenarios) results.push({ spec, got: await playScenario(spec) });

// The expected cost of each scenario is read off the encounter's own plan, not
// written down here: a second copy of the numbers in this file would agree with
// the mechanic right up until the day it stopped, and then agree with nothing.
const [clean, fumbled, missed] = results.map((r) => r.got);
const expected: number[] = [0, fumbled.missDamage, missed.accentMissDamage];

console.log('\nwhat a phrase costs:');
results.forEach(({ spec, got }, i) => {
  const want = expected[i];
  const ok = got.lost === want;
  const detail = got.hits.length === 0
    ? 'no charge'
    : got.hits.map((h) => `${h.source} -${h.amount}@${h.beat.toFixed(2)}`).join(', ');
  console.log(
    `  ${spec.name.padEnd(26)} -${got.lost} hp  (${got.outcome}, ${got.misses} miss)  [${detail}]`
    + `  ${ok ? 'OK' : `** FAIL, expected ${want} **`}`,
  );
  if (!ok) fail(`${spec.name}: lost ${got.lost}, expected ${want}`);
});

if (clean.lost !== 0) fail('a phrase played clean and broken on the beat must cost nothing');
if (fumbled.lost !== fumbled.missDamage) {
  fail(`an unplayed phrase that was saved cost ${fumbled.lost}, not \`missDamage\` (${fumbled.missDamage})`);
}
if (missed.lost !== missed.accentMissDamage) {
  fail(`a missed accent cost ${missed.lost}, not \`accentMissDamage\` (${missed.accentMissDamage})`);
}
if (missed.accentMissDamage <= fumbled.missDamage) {
  fail('missing the accent must be the dearer mistake, and the plan does not price it that way');
}
if (missed.accentMissDamage > 25) fail(`the accent costs ${missed.accentMissDamage}; the cap is 25`);
console.log(
  `PASS: clean ${clean.lost} hp, unplayed-but-saved ${fumbled.lost} hp, no accent ${missed.lost} hp`
  + ' -- and the accent is always the dearer mistake.',
);

process.exit(failures === 0 ? 0 : 1);

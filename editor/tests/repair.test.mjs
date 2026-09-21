/**
 * Repair loop tests.
 *
 * The loop's whole value is the rule it enforces: the model proposes, the
 * validator disposes. So these tests are mostly about what the loop *refuses*
 * -- a rewrite that is worse, a rewrite that loops, a rewrite that is not a
 * blueprint -- and about the budget it respects.
 *
 * `repair` is injected, so no test here touches a network.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { repairBlueprint, MAX_REPAIR_PASSES } from '../generation/repair.js';
import { validateBlueprint, breatherBeats } from '../generation/blueprint.js';
import { loadRulesWithTuning } from '../generation/rules.js';
import { buildGameplayContext } from '../generation/gameplayContext.js';

const { tuning } = loadRulesWithTuning();
// The real context, built the way the pipeline builds it -- a hand-written
// stub would let the validator pass on a shape production never produces.
const GAMEPLAY = buildGameplayContext({ allowedModes: ['ARENA', 'RUNNER', 'VERTICAL'], primaryMode: 'ARENA' });

const BPM = 120;
const BEATS_PER_BAR = 4;
const BAR_SEC = (60 / BPM) * BEATS_PER_BAR;

function makeDirectorContext(bars = 32) {
  return {
    schema_version: 'beatbound_director_context_v2',
    source: { song_id: 's', audio_file: 's.mp3', duration_sec: bars * BAR_SEC },
    timing: {
      bpm: BPM,
      meter: '4/4',
      beats_per_bar: BEATS_PER_BAR,
      bar_count: bars,
      bars: Array.from({ length: bars }, (_, i) => ({ bar: i + 1, start: i * BAR_SEC, end: (i + 1) * BAR_SEC })),
    },
    sections: [{ start_bar: 1, end_bar_exclusive: bars + 1 }],
  };
}



function makeBlueprint(dc, { cuts = [1, 17, 33], modes = ['ARENA', 'RUNNER'], sections = null } = {}) {
  const breather = breatherBeats(BPM, tuning);
  return {
    schema_version: 'beatbound_level_blueprint_v2',
    generator: { kind: 'ai_director', model: 'test', prompt_version: 'test' },
    song: {
      id: 's',
      title: 'S',
      bpm: BPM,
      timeSignature: [4, 4],
      barCount: dc.timing.bar_count,
      durationSec: dc.source.duration_sec,
      audio: 's.mp3',
    },
    global: { intent: 'x', arc: 'y', difficulty_curve: [] },
    request: {
      primary_mode: 'ARENA',
      allowed_modes: ['ARENA', 'RUNNER'],
      target_difficulty: 3,
      primary_mode_ratio: 0.5,
      seed: 1,
    },
    sections:
      sections ??
      cuts.slice(0, -1).map((start, i) => ({
        id: `section_${String(i + 1).padStart(2, '0')}`,
        start_bar: start,
        end_bar_exclusive: cuts[i + 1],
        mode: modes[i],
        function: 'BUILD',
        difficulty: 3,
        intensity: 0.5,
        rationale: 'because',
        ...(i < cuts.length - 2
          ? { transition_out: { kind: 'mode_change', reason: 'r', breather_beats: breather, scene: [] } }
          : {}),
      })),
    notes: [],
    sync_points: [],
  };
}

const run = (blueprint, dc, repair, extra = {}) =>
  repairBlueprint({ blueprint, directorContext: dc, gameplayContext: GAMEPLAY, tuning, repair, ...extra });

/**
 * Break something the *normalizer* will not fix.
 *
 * This matters for testing the model loop at all: an unknown mode, an off-grid
 * bar range or a bad difficulty are all repaired deterministically and for
 * free, so a blueprint broken that way never reaches the model. The generator
 * declaration is the kind of thing a normalizer must not invent on the
 * director's behalf -- guessing who wrote a blueprint would be a lie in the
 * provenance.
 */
function breakDeclaration(bp) {
  bp.generator.kind = 'wizard';
  return bp;
}

// ---------------------------------------------------------------------------
// Budget
// ---------------------------------------------------------------------------

test('MAX_REPAIR_PASSES is small and bounded', () => {
  assert.equal(MAX_REPAIR_PASSES, 2);
  assert.ok(Number.isInteger(MAX_REPAIR_PASSES) && MAX_REPAIR_PASSES >= 1);
});

test('a valid blueprint costs no model calls', async () => {
  const dc = makeDirectorContext();
  const bp = makeBlueprint(dc);
  assert.equal(validateBlueprint(bp, { directorContext: dc, gameplayContext: GAMEPLAY }).errors.length, 0);

  let calls = 0;
  const out = await run(bp, dc, async () => {
    calls++;
    return bp;
  });

  assert.equal(calls, 0, 'nothing to repair, nothing to ask');
  assert.equal(out.ok, true);
  assert.equal(out.passes, 0);
  assert.equal(out.repaired, false);
});

test('the model is called at most maxPasses times', async () => {
  const dc = makeDirectorContext();
  const bp = makeBlueprint(dc);
  breakDeclaration(bp);

  let calls = 0;
  const out = await run(bp, dc, async (current) => {
    calls++;
    // Return a *different* broken blueprint each time so the loop does not
    // stop early for looping -- this is the budget test.
    const next = JSON.parse(JSON.stringify(current));
    next.generator.kind = calls === 1 ? 'sorcerer' : 'wizard';
    return next;
  });

  assert.equal(calls, MAX_REPAIR_PASSES, 'the budget is respected exactly');
  assert.equal(out.passes, MAX_REPAIR_PASSES);
  assert.equal(out.ok, false, 'and it does not pretend the level is valid');
  assert.ok(out.validation.errors.length > 0);
});

test('an explicit maxPasses of 1 makes one call', async () => {
  const dc = makeDirectorContext();
  const bp = makeBlueprint(dc);
  breakDeclaration(bp);
  let calls = 0;
  await run(bp, dc, async (c) => {
    calls++;
    const n = JSON.parse(JSON.stringify(c));
    n.generator.kind = 'wizard';
    return n;
  }, { maxPasses: 1 });
  assert.equal(calls, 1);
});

test('deterministic mode makes no model calls at all', async () => {
  const dc = makeDirectorContext();
  const bp = makeBlueprint(dc);
  breakDeclaration(bp);
  const out = await run(bp, dc, undefined);
  assert.equal(out.passes, 0);
  assert.equal(out.ok, false);
  assert.ok(out.history.some((h) => h.stage === 'normalize'));
});

// ---------------------------------------------------------------------------
// The validator decides
// ---------------------------------------------------------------------------

test('a repair that fixes the errors is accepted', async () => {
  const dc = makeDirectorContext();
  const bp = makeBlueprint(dc);
  breakDeclaration(bp);
  const good = makeBlueprint(dc);

  const out = await run(bp, dc, async () => good);
  assert.equal(out.ok, true);
  assert.equal(out.repaired, true);
  assert.equal(out.validation.errors.length, 0);
  assert.ok(out.history.some((h) => h.stage === 'model-repair' && h.accepted === true));
});

test('a repair that is worse than what we hold is discarded', async () => {
  // The model returns a blueprint with *more* errors. Keeping it would be
  // strictly worse, so the loop must hold the original and say so.
  const dc = makeDirectorContext();
  const bp = makeBlueprint(dc);
  breakDeclaration(bp);
  const before = JSON.stringify(bp);

  const worse = makeBlueprint(dc);
  worse.generator.kind = 'wizard';
  worse.song.id = 'other';
  worse.global.intent = '';

  const out = await run(bp, dc, async () => worse);
  assert.equal(out.ok, false);
  assert.equal(out.repaired, false);
  assert.equal(JSON.stringify(out.blueprint), before, 'the original is untouched');
  assert.ok(out.history.some((h) => h.stage === 'model-repair' && h.accepted === false));
});

test('a repair that returns the same errors stops the loop as a loop', async () => {
  const dc = makeDirectorContext();
  const bp = makeBlueprint(dc);
  breakDeclaration(bp);

  let calls = 0;
  const out = await run(bp, dc, async () => {
    calls++;
    return JSON.parse(JSON.stringify(bp)); // identical every time
  });

  assert.equal(calls, 1, 'a second identical request would only cost tokens');
  assert.ok(out.history.some((h) => h.stage === 'stopped' && /looping/.test(h.reason)));
});

test('the loop never returns a worse blueprint than it started with', async () => {
  const dc = makeDirectorContext();
  const bp = makeBlueprint(dc);
  breakDeclaration(bp);
  const startErrors = validateBlueprint(bp, { directorContext: dc, gameplayContext: GAMEPLAY }).errors.length;

  // Each call returns something worse and different.
  let n = 0;
  const out = await run(bp, dc, async () => {
    n++;
    const w = makeBlueprint(dc);
    w.generator.kind = 'wizard';
    w.song.id = 'other';
    w.global.intent = '';
    return w;
  });

  assert.ok(
    out.validation.errors.length <= startErrors,
    `ended with ${out.validation.errors.length} errors, started with ${startErrors}`,
  );
});

test('a repair that throws stops the loop and is reported', async () => {
  const dc = makeDirectorContext();
  const bp = makeBlueprint(dc);
  breakDeclaration(bp);

  const out = await run(bp, dc, async () => {
    throw new Error('upstream 503 after 3 attempts');
  });
  assert.equal(out.ok, false);
  assert.equal(out.passes, 1);
  assert.ok(out.history.some((h) => h.stage === 'model-error' && /503/.test(h.error)));
});

test('a repair that returns nonsense is skipped, not crashed on', async () => {
  const dc = makeDirectorContext();
  const bp = makeBlueprint(dc);
  breakDeclaration(bp);

  for (const junk of [null, undefined, 'a string', 42]) {
    const out = await run(bp, dc, async () => junk);
    assert.equal(out.ok, false);
    assert.ok(
      out.history.some((h) => h.stage === 'model-invalid'),
      `junk ${JSON.stringify(junk)} should be reported as invalid`,
    );
  }
});

// ---------------------------------------------------------------------------
// Normalization runs first, for free
// ---------------------------------------------------------------------------

test('an off-grid tiling is fixed without spending a model call', async () => {
  // The director context tiles [1,33) in one piece; a section ending at 20 is
  // off-grid. Normalization snaps it, and if that alone validates, the model is
  // never asked.
  const dc = makeDirectorContext(32);
  const bp = makeBlueprint(dc, { cuts: [1, 20, 33], modes: ['ARENA', 'RUNNER'] });
  const before = validateBlueprint(bp, { directorContext: dc, gameplayContext: GAMEPLAY });

  let calls = 0;
  const out = await run(bp, dc, async () => {
    calls++;
    return bp;
  });

  if (before.errors.length > 0) {
    assert.equal(calls, 0, 'a deterministic fix must not cost a request');
  }
  assert.ok(out.normalized.length > 0 || out.ok, 'normalization reported what it changed');
});

test('normalization output is always itself valid when it claims to be', async () => {
  const dc = makeDirectorContext();
  const bp = makeBlueprint(dc);
  breakDeclaration(bp);
  const out = await run(bp, dc, undefined);

  // Whatever the loop hands back, re-validating it must agree with the verdict
  // it reported -- otherwise the pipeline would act on a stale judgement.
  const recheck = validateBlueprint(out.blueprint, { directorContext: dc, gameplayContext: GAMEPLAY });
  assert.equal(recheck.errors.length, out.validation.errors.length);
  assert.equal(out.ok, recheck.errors.length === 0);
});

// ---------------------------------------------------------------------------
// History
// ---------------------------------------------------------------------------

test('the history records every stage with its score', async () => {
  const dc = makeDirectorContext();
  const bp = makeBlueprint(dc);
  breakDeclaration(bp);
  const good = makeBlueprint(dc);

  const out = await run(bp, dc, async () => good);
  const stages = out.history.map((h) => h.stage);
  assert.equal(stages[0], 'director', 'the director blueprint is the baseline');
  assert.ok(stages.includes('normalize'));
  assert.ok(stages.includes('model-repair'));

  for (const h of out.history) {
    if (h.stage === 'director' || h.stage === 'normalize' || h.stage === 'model-repair') {
      assert.equal(typeof h.errors, 'number', `${h.stage} reports its error count`);
    }
  }
});

test('the progress hook sees every stage', async () => {
  const dc = makeDirectorContext();
  const bp = makeBlueprint(dc);
  breakDeclaration(bp);
  const events = [];
  await run(bp, dc, async () => makeBlueprint(dc), { onEvent: (e) => events.push(e) });

  assert.ok(events.some((e) => e.stage === 'director'));
  assert.ok(events.some((e) => e.stage === 'normalize'));
  assert.ok(events.some((e) => e.stage === 'model-repair' && e.accepted === true));
});

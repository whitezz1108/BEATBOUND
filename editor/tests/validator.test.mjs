/**
 * Validator wrapper tests.
 *
 * The parsers are tested against text captured from the real tools, so a change
 * to what `npm run level` / `runner-check` / `fairness` print shows up here
 * rather than as a silently-empty error list in the pipeline. The subprocess
 * half is tested against real library levels, including one deliberately broken
 * copy, because the whole point of this module is that it does not soften what
 * the runtime says.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, unlinkSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import {
  parseLevelReport,
  parseRunnerCheck,
  parseFairness,
  validateLevel,
  validateAll,
  summarize,
  runScript,
  PROJECT_ROOT,
} from '../generation/validator.js';

const LIB = path.join(PROJECT_ROOT, 'beatbound_library_v1');
const read = (p) => JSON.parse(readFileSync(p, 'utf8'));

// ---------------------------------------------------------------------------
// parseLevelReport
// ---------------------------------------------------------------------------

const LEVEL_OK = `
==============================================================================
Test   (test.level.json)
120 BPM · 4/4 · 105 bars · 210.0s · audio: test.mp3
==============================================================================
  ! section "S02": patterns occupy 15 of 16 bars -- 1 bar(s) will be silent
  ! section "S05": patterns occupy 19 of 20 bars -- 1 bar(s) will be silent

S01  ARENA  bars 1-12  (0.0s-24.0s)  INTRO  difficulty 1
  patterns: AP23@1

------------------------------------------------------------------------------
mechanics used: A02, A03, A05
every mechanic in this level has a runtime implementation.
jump to a bar in the browser:  ?startBar=<bar>&invincible
`;

test('level warnings are read from the header block', () => {
  const r = parseLevelReport(LEVEL_OK, '', 0);
  assert.equal(r.ok, true);
  assert.deepEqual(r.warnings, [
    'section "S02": patterns occupy 15 of 16 bars -- 1 bar(s) will be silent',
    'section "S05": patterns occupy 19 of 20 bars -- 1 bar(s) will be silent',
  ]);
  assert.deepEqual(r.errors, []);
  assert.deepEqual(r.mechanics, ['A02', 'A03', 'A05']);
  assert.deepEqual(r.missingMechanics, []);
});

test('mechanics with no runtime are reported separately', () => {
  const stdout = LEVEL_OK.replace(
    'every mechanic in this level has a runtime implementation.',
    'no runtime yet (these events are skipped at play time): V09, R02',
  );
  const r = parseLevelReport(stdout, '', 0);
  assert.deepEqual(r.missingMechanics, ['V09', 'R02']);
});

test('validation errors are read out of the thrown LevelValidationError', () => {
  // LevelLoader.build throws with the issues listed as "  - text"; node prints
  // the message followed by a stack trace that must not be mistaken for errors.
  const stderr = [
    'Level validation failed:',
    '  - section "S01": unknown mode "NOPE"',
    '  - section "S02": starts at bar 1, overlapping the previous section which ends at bar 9',
    '    at LevelLoader.build (file:///C:/x/src/core/LevelLoader.ts:161:26)',
    '    at main (file:///C:/x/tools/level-report.ts:58:22)',
    'Error: Level validation failed:',
    '    at LevelLoader.build (file:///C:/x/src/core/LevelLoader.ts:161:26)',
    '',
  ].join('\n');

  const r = parseLevelReport('', stderr, 1);
  assert.equal(r.ok, false);
  assert.deepEqual(r.errors, [
    'section "S01": unknown mode "NOPE"',
    'section "S02": starts at bar 1, overlapping the previous section which ends at bar 9',
  ]);
});

test('a non-zero exit with no validation marker still fails, with the cause', () => {
  // A missing file or a bundling failure is not a pass.
  const stderr = [
    'Error: ENOENT: no such file or directory, open \'C:\\x\\missing.level.json\'',
    '    at Object.json (file:///C:/x/node_modules/.cache/beatbound/level-report.mjs:6296:32)',
    '    at async LevelLoader.load (file:///C:/x/node_modules/.cache/beatbound/level-report.mjs:1302:19)',
    '',
  ].join('\n');

  const r = parseLevelReport('', stderr, 1);
  assert.equal(r.ok, false);
  assert.equal(r.errors.length, 1);
  assert.match(r.errors[0], /ENOENT/);
});

test('a clean run with no output is ok', () => {
  const r = parseLevelReport('', '', 0);
  assert.equal(r.ok, true);
  assert.deepEqual(r.errors, []);
});

// ---------------------------------------------------------------------------
// parseRunnerCheck
// ---------------------------------------------------------------------------

const RUNNER_OK = `
  RP01  Basic Jump            ok

RUNNER levels -- courses flown against the real physics

  runner_procedural.level.json / R-P                  ok
      metrics: 38 jumps (2.38/bar) · 0.52 airborne · 2 flip(s)
      zones: CEI 6% · HIG 15%
  runner_showcase.level.json                          ok
      metrics: 12 jumps

Every RUNNER pattern is clearable.
0 problem(s) across 2 course(s).

RUNNER procedural -- seeded composition at three tempos

  90 BPM  seed 1  ok   38 jumps
  120 BPM seed 7  ok   39 jumps
`;

test('runner-check reports per-level verdicts and metrics', () => {
  const r = parseRunnerCheck(RUNNER_OK, 0);
  assert.equal(r.ok, true);
  assert.equal(r.problems, 0);
  assert.equal(r.courses, 2);
  assert.equal(r.allPatternsClearable, true);
  assert.deepEqual(
    r.perLevel.map((l) => [l.file, l.ok]),
    [
      ['runner_procedural.level.json', true],
      ['runner_showcase.level.json', true],
    ],
  );
  assert.match(r.perLevel[0].metrics, /38 jumps/);
  assert.match(r.perLevel[0].metrics, /2 flip\(s\)/, 'the metrics line is read whole');
  assert.equal(r.procedural.length, 2);
  assert.ok(r.procedural.every((p) => p.ok));
  assert.equal(r.procedural[0].bpm, 90);
});

test('a level that fails to load is a failure, not a missing row', () => {
  const stdout = RUNNER_OK.replace(
    '  runner_showcase.level.json                          ok\n      metrics: 12 jumps\n',
    "  runner_showcase.level.json   LOAD FAILED: ENOENT: no such file or directory, open 'C:\\\\x\\\\runner_showcase.level.json'\n",
  );
  const r = parseRunnerCheck(stdout, 1);
  assert.equal(r.ok, false);
  const bad = r.perLevel.find((l) => l.file === 'runner_showcase.level.json');
  assert.equal(bad.ok, false);
  assert.match(bad.verdict, /LOAD FAILED/);
});

test('impossible RUNNER patterns are counted', () => {
  const stdout = '3 impossible obstacle(s) across the RUNNER library.\n0 problem(s) across 1 course(s).\n';
  const r = parseRunnerCheck(stdout, 1);
  assert.equal(r.impossiblePatterns, 3);
  assert.equal(r.allPatternsClearable, false);
  assert.equal(r.ok, false);
});

// ---------------------------------------------------------------------------
// parseFairness
// ---------------------------------------------------------------------------

test('fairness reads the all-readable summary', () => {
  const stdout = [
    'AP24    Quadrant Rotation   0.80  1.95s   0.60s   ok',
    'AP25    Chain Formation     0.80  1.22s   0.60s   campable at (0.01, 0.01) @0.2 -- 1135/1681 safe spots',
    '',
    'All 29 ARENA patterns are readable.',
    '13 can be beaten by standing still on their own -- they are layer pieces, and',
    'camp-audit gates the composed levels where they are actually played.',
    '',
  ].join('\n');
  const r = parseFairness(stdout, 0);
  assert.equal(r.ok, true);
  assert.equal(r.total, 29);
  assert.equal(r.readable, 29);
  assert.equal(r.unreadable, 0);
  assert.equal(r.campable, 13);
});

test('fairness reads the failure summary', () => {
  const stdout = '2 unreadable pattern(s) out of 29.\n';
  const r = parseFairness(stdout, 1);
  assert.equal(r.ok, false);
  assert.equal(r.unreadable, 2);
  assert.equal(r.total, 29);
  assert.equal(r.readable, 27);
});

// ---------------------------------------------------------------------------
// Subprocess safety
// ---------------------------------------------------------------------------

test('runScript refuses anything but a bare script name and safe arguments', () => {
  assert.throws(() => runScript('level; rm -rf /'), /refusing to run script/);
  assert.throws(() => runScript('level', ['a b']), /refusing to pass/);
  assert.throws(() => runScript('level', ['x && y']), /refusing to pass/);
  assert.throws(() => runScript('level', ['$(whoami)']), /refusing to pass/);
});

test('validateLevel refuses a path that escapes the library', () => {
  assert.throws(() => validateLevel('../../etc/passwd'), /refusing to validate/);
  assert.throws(() => validateLevel('a/../../b.level.json'), /refusing to validate/);
  assert.throws(() => validateLevel('nested/dir.level.json'), /refusing to validate/);
  assert.throws(() => validateLevel(''), /refusing to validate/);
  assert.throws(() => validateLevel(null), /refusing to validate/);
});

test('validateLevel reports a missing level without running the tool', () => {
  const r = validateLevel('definitely_not_here.level.json');
  assert.equal(r.ok, false);
  assert.match(r.errors[0], /not in beatbound_library_v1/);
  assert.equal(r.raw, null, 'no subprocess was spawned');
});

// ---------------------------------------------------------------------------
// Integration against the real tools
// ---------------------------------------------------------------------------

test('a real library level validates through the real loader', () => {
  const r = validateLevel('arkins_-_jangchung.level.json');
  assert.equal(r.ok, true, `expected ok, got ${JSON.stringify(r.errors)}`);
  assert.deepEqual(r.errors, []);
  assert.equal(r.raw.status, 0);
});

test('a deliberately broken level fails with the loader\'s own errors', () => {
  const source = read(path.join(LIB, '_archive', 'prototype_90s.level.json'));
  source.sections[0].mode = 'NOPE';
  source.sections[1].startBar = 1;
  const probe = path.join(LIB, '_probe_broken.level.json');
  writeFileSync(probe, JSON.stringify(source, null, 2));

  try {
    const r = validateLevel('_probe_broken.level.json');
    assert.equal(r.ok, false);
    assert.equal(r.raw.status, 1);
    assert.ok(
      r.errors.some((e) => /unknown mode "NOPE"/.test(e)),
      `expected the unknown-mode error, got ${JSON.stringify(r.errors)}`,
    );
    assert.ok(
      r.errors.some((e) => /overlapping the previous section/.test(e)),
      `expected the overlap error, got ${JSON.stringify(r.errors)}`,
    );
  } finally {
    if (existsSync(probe)) unlinkSync(probe);
  }
});

test('a broken probe level fails validation end to end and the summary says why', () => {
  const source = read(path.join(LIB, '_archive', 'prototype_90s.level.json'));
  source.sections[0].lengthBars = 0;
  const probe = path.join(LIB, '_probe_len.level.json');
  writeFileSync(probe, JSON.stringify(source, null, 2));

  try {
    const report = validateAll('_probe_len.level.json');
    assert.equal(report.ok, false);
    const text = summarize(report);
    assert.match(text, /^level: FAILED/);
    assert.match(text, /lengthBars must be >= 1/);
  } finally {
    if (existsSync(probe)) unlinkSync(probe);
  }
});

test('summarize names a candidate course failure but not other levels', () => {
  const report = {
    level: { ok: true, errors: [], warnings: ['a warning'], missingMechanics: [] },
    levelFile: 'mine.level.json',
    ok: false,
    courses: {
      ok: false,
      mine: [{ file: 'mine.level.json', ok: false, verdict: 'LOAD FAILED: nope' }],
      othersFailing: [{ file: 'other.level.json', ok: false, verdict: 'LOAD FAILED' }],
      procedural: [{ bpm: 120, seed: 3, ok: false, detail: 'IMPOSSIBLE @intensity 0.80' }],
    },
    fairness: null,
  };
  const text = summarize(report);
  assert.match(text, /level: ok/);
  assert.match(text, /warn: {2}a warning/);
  assert.match(text, /courses: FAILED/);
  assert.match(text, /error: mine\.level\.json: LOAD FAILED: nope/);
  assert.match(text, /error: procedural 120 BPM seed 3: IMPOSSIBLE/);
  assert.match(text, /note: {2}1 other level\(s\) in the library index failed to load \(other\.level\.json\)/);
});

test('summarize says when the candidate was never in the index', () => {
  const report = {
    level: { ok: true, errors: [], warnings: [], missingMechanics: [] },
    levelFile: 'mine.level.json',
    ok: true,
    courses: { ok: false, mine: [], othersFailing: [], procedural: [] },
    fairness: null,
  };
  assert.match(summarize(report), /not in the library index -- no course was checked/);
});

/**
 * Layer 4b -- the real validators, wrapped.
 *
 * The editor does not reimplement level validation. It shells out to the same
 * tools the repository already trusts and normalises what they print:
 *
 *   npm run level         LevelLoader.validate + the per-event timing report
 *   npm run runner-check  RUNNER courses flown against the real physics
 *   npm run fairness      can a perfect player read and reach every ARENA event
 *
 * Those tools are the authority. This module exists so the pipeline can ask
 * "is this candidate level playable?" and get back a structure it can act on,
 * rather than a wall of text. It never softens a verdict: a non-zero exit code
 * is a failure here, full stop, even if the parsing below recognises nothing.
 *
 * The parsers are pure functions of the tools' output so they can be tested
 * against captured text without spawning anything.
 */

import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

export const PROJECT_ROOT = fileURLToPath(new URL('../..', import.meta.url));
export const DEFAULT_TIMEOUT_MS = 180_000;

/** npm is a .cmd shim on Windows, and Node refuses to spawn .cmd without a
 *  shell (the CVE-2024-27980 mitigation), so the command is assembled as one
 *  string. Every argument is checked against a strict allowlist first -- there
 *  is no shell metacharacter in this module's vocabulary. */
const NPM = 'npm';
/** Arguments we are willing to put on a command line. */
const SAFE_ARG = /^[A-Za-z0-9_.\-]+$/;
/** A level file name we are willing to hand to a subprocess. */
const SAFE_FILE = /^[A-Za-z0-9_.\-]+\.level\.json$/;

// ---------------------------------------------------------------------------
// Running the tools
// ---------------------------------------------------------------------------

/**
 * Run one npm script and capture everything.
 *
 * @returns {{script: string, ok: boolean, status: number|null, signal: string|null,
 *            stdout: string, stderr: string, timedOut: boolean, error: string|null,
 *            durationMs: number}}
 */
export function runScript(script, args = [], opts = {}) {
  if (!SAFE_ARG.test(script)) throw new Error(`validator: refusing to run script ${JSON.stringify(script)}`);
  for (const a of args) {
    if (typeof a !== 'string' || !SAFE_ARG.test(a)) {
      throw new Error(`validator: refusing to pass ${JSON.stringify(a)} on a command line`);
    }
  }

  const command = [NPM, 'run', script, ...(args.length ? ['--', ...args] : [])].join(' ');
  const started = Date.now();
  const res = spawnSync(command, {
    cwd: opts.cwd ?? PROJECT_ROOT,
    encoding: 'utf8',
    shell: true,
    timeout: opts.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    maxBuffer: 32 * 1024 * 1024,
    env: { ...process.env, ...(opts.env ?? {}) },
  });
  const timedOut = res.error?.code === 'ETIMEDOUT' || res.signal === 'SIGTERM';
  return {
    script,
    ok: res.status === 0 && !res.error,
    status: res.status,
    signal: res.signal ?? null,
    stdout: res.stdout ?? '',
    stderr: res.stderr ?? '',
    timedOut,
    error: res.error ? String(res.error.message) : null,
    durationMs: Date.now() - started,
  };
}

// ---------------------------------------------------------------------------
// Parsers (pure)
// ---------------------------------------------------------------------------

/**
 * Parse `npm run level` output.
 *
 * Warnings are printed to stdout as `  ! text` under the level header. Errors
 * never reach stdout: `LevelLoader.build` throws `LevelValidationError`, whose
 * message lists the issues as `  - text`, and node prints that to stderr.
 */
export function parseLevelReport(stdout, stderr, status) {
  const warnings = [];
  for (const line of stdout.split(/\r?\n/)) {
    const m = line.match(/^ {2}! (.*)$/);
    if (m) warnings.push(m[1].trim());
  }

  const errors = [];
  const errText = `${stderr}\n${stdout}`;
  if (/Level validation failed:/.test(errText)) {
    // Take everything after the marker that looks like a listed issue, so the
    // stack trace below it is not mistaken for an error message.
    const after = errText.slice(errText.indexOf('Level validation failed:'));
    for (const line of after.split(/\r?\n/).slice(1)) {
      const m = line.match(/^ {2}- (.*)$/);
      if (m) errors.push(m[1].trim());
      else if (/^ {2}\S/.test(line) === false && line.trim() !== '' && errors.length > 0) break;
    }
  } else if (status !== 0) {
    // Something else went wrong -- a missing file, a bundling failure. Surface
    // the last meaningful stderr line rather than pretending it validated.
    const tail = stderr
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l !== '' && !/^\s*at /.test(l) && !/^\^+$/.test(l) && !/^code:/.test(l));
    errors.push(tail.length > 0 ? tail[tail.length - 1] : `npm run level exited with ${status}`);
  }

  const mechanics = [];
  const missingMechanics = [];
  for (const line of stdout.split(/\r?\n/)) {
    const used = line.match(/^mechanics used: (.*)$/);
    if (used) mechanics.push(...used[1].split(',').map((s) => s.trim()).filter(Boolean));
    const missing = line.match(/^no runtime yet \(these events are skipped at play time\): (.*)$/);
    if (missing) missingMechanics.push(...missing[1].split(',').map((s) => s.trim()).filter(Boolean));
  }

  return { ok: status === 0 && errors.length === 0, errors, warnings, mechanics, missingMechanics };
}

/** Parse `npm run runner-check` output. */
export function parseRunnerCheck(stdout, status) {
  const lines = stdout.split(/\r?\n/);

  // A level line is `  <file>.level.json[ / <tag>]<pad>ok|LOAD FAILED: ...`.
  // Its metrics sit on the following indented line, so they are read by
  // scanning forward rather than by a windowed regex -- the padding width
  // changes with the file name.
  const perLevel = [];
  for (const [i, line] of lines.entries()) {
    const m = line.match(/^ {2}(\S+\.level\.json)(?:\s+\/\s+\S+)?\s+(.+)$/);
    if (!m) continue;
    const verdict = m[2].trim();
    const metricsLine = lines[i + 1]?.match(/^\s+metrics: (.*)$/);
    perLevel.push({
      file: m[1],
      ok: verdict === 'ok',
      verdict,
      metrics: metricsLine ? metricsLine[1].trim() : null,
    });
  }

  const summary = stdout.match(/(\d+) problem\(s\) across (\d+) course\(s\)\./);
  const impossible = stdout.match(/(\d+) impossible obstacle\(s\) across the RUNNER library\./);

  const procedural = [];
  for (const line of lines) {
    const m = line.match(/^ {2}(\d+) BPM\s+seed (\d+)\s+(\S+)\s*(.*)$/);
    if (m) procedural.push({ bpm: Number(m[1]), seed: Number(m[2]), ok: m[3] === 'ok', detail: m[4].trim() });
  }

  return {
    ok: status === 0,
    problems: summary ? Number(summary[1]) : null,
    courses: summary ? Number(summary[2]) : null,
    impossiblePatterns: impossible ? Number(impossible[1]) : 0,
    allPatternsClearable: /Every RUNNER pattern is clearable/.test(stdout),
    perLevel,
    procedural,
  };
}

/** Parse `npm run fairness` output. */
export function parseFairness(stdout, status) {
  const all = stdout.match(/^All (\d+) ARENA patterns are readable\./m);
  const some = stdout.match(/^(\d+) unreadable pattern\(s\) out of (\d+)\./m);
  const campable = stdout.match(/^(\d+) can be beaten by standing still on their own/m);

  return {
    ok: status === 0,
    readable: all ? Number(all[1]) : some ? Number(some[2]) - Number(some[1]) : null,
    total: all ? Number(all[1]) : some ? Number(some[2]) : null,
    unreadable: some ? Number(some[1]) : 0,
    campable: campable ? Number(campable[1]) : 0,
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Validate one candidate level with the runtime's own loader.
 *
 * @param {string} levelFile  a file name inside beatbound_library_v1/
 */
export function validateLevel(levelFile, opts = {}) {
  assertSafeFile(levelFile);
  const abs = path.join(PROJECT_ROOT, 'beatbound_library_v1', levelFile);
  if (!existsSync(abs)) {
    return {
      ok: false,
      errors: [`${levelFile} is not in beatbound_library_v1/ -- the validator resolves level paths there`],
      warnings: [],
      mechanics: [],
      missingMechanics: [],
      raw: null,
    };
  }
  const run = runScript('level', [levelFile], opts);
  return { ...parseLevelReport(run.stdout, run.stderr, run.status), raw: run };
}

/**
 * Fly every RUNNER course in the library, including the candidate's.
 *
 * This is library-wide because `runner-check` reads `levels.index.json` -- the
 * candidate has to be registered to be checked, which is the same thing the
 * game needs in order to play it.
 */
export function validateCourses(opts = {}) {
  const run = runScript('runner-check', [], opts);
  return { ...parseRunnerCheck(run.stdout, run.status), raw: run };
}

/** Can a perfect player read and reach every ARENA event in the library. */
export function validateFairness(opts = {}) {
  const run = runScript('fairness', [], opts);
  return { ...parseFairness(run.stdout, run.status), raw: run };
}

/**
 * Run the whole gate for one candidate level.
 *
 * `level` always runs; the other two are library-wide and slower, so they are
 * opt-in via `courses` / `fairness`.
 */
export function validateAll(levelFile, opts = {}) {
  const level = validateLevel(levelFile, opts);
  const report = { level, levelFile, courses: null, fairness: null, ok: level.ok };

  if (opts.courses) {
    report.courses = validateCourses(opts);
    // `runner-check` reads the whole index, so its own `ok` is a verdict on the
    // library -- which is not what a caller checking *this* generation wants.
    // The raw value is kept as `libraryOk`, and `ok` is narrowed to the thing
    // that can actually be blamed on this run: the candidate's own courses and
    // the built-in procedural probes. Another level being broken, or listed in
    // the index but deleted from disk, is reported in `othersFailing` and does
    // not fail this generation.
    report.courses.libraryOk = report.courses.ok;
    report.courses.mine = report.courses.perLevel.filter((l) => l.file === levelFile);
    report.courses.othersFailing = report.courses.perLevel.filter((l) => !l.ok && l.file !== levelFile);
    report.courses.ok = !report.courses.mine.some((l) => !l.ok) && report.courses.procedural.every((p) => p.ok);
    if (!report.courses.ok) report.ok = false;
  }
  if (opts.fairness) {
    report.fairness = validateFairness(opts);
    if (!report.fairness.ok) report.ok = false;
  }
  return report;
}

/** A short human summary of a validation report, for logs and the manifest. */
export function summarize(report) {
  const lines = [];
  lines.push(`level: ${report.level.ok ? 'ok' : 'FAILED'} (${report.level.errors.length} error(s), ${report.level.warnings.length} warning(s))`);
  for (const e of report.level.errors) lines.push(`  error: ${e}`);
  for (const w of report.level.warnings) lines.push(`  warn:  ${w}`);
  if (report.level.missingMechanics.length > 0) {
    lines.push(`  no runtime implementation: ${report.level.missingMechanics.join(', ')}`);
  }
  if (report.courses) {
    const mine = report.courses.mine ?? [];
    const failed = mine.filter((l) => !l.ok);
    lines.push(
      mine.length === 0
        ? 'courses: not in the library index -- no course was checked'
        : `courses: ${failed.length === 0 ? 'ok' : 'FAILED'}`,
    );
    for (const l of failed) lines.push(`  error: ${l.file}: ${l.verdict}`);
    for (const p of report.courses.procedural.filter((p) => !p.ok)) {
      lines.push(`  error: procedural ${p.bpm} BPM seed ${p.seed}: ${p.detail}`);
    }
    // Say so, but do not imply the candidate caused it.
    if (report.courses.othersFailing?.length > 0) {
      const names = report.courses.othersFailing.map((l) => l.file);
      const shown = names.slice(0, 3).join(', ') + (names.length > 3 ? `, and ${names.length - 3} more` : '');
      lines.push(
        `  note:  ${names.length} other level(s) in the library index failed to load (${shown}) ` +
          `-- not this generation`,
      );
    }
  }
  if (report.fairness) {
    lines.push(
      `fairness: ${report.fairness.ok ? 'ok' : 'FAILED'} ` +
        `(${report.fairness.readable}/${report.fairness.total} ARENA patterns readable, ` +
        `${report.fairness.campable} campable alone)`,
    );
  }
  return lines.join('\n');
}

function assertSafeFile(levelFile) {
  if (typeof levelFile !== 'string' || !SAFE_FILE.test(levelFile) || levelFile.includes('..')) {
    throw new Error(`validator: refusing to validate ${JSON.stringify(levelFile)} -- expected <name>.level.json`);
  }
}

#!/usr/bin/env node
/**
 * `node editor/generation/cli.mjs` -- the generation pipeline from a shell.
 *
 * The editor UI is the normal way in; this exists for the cases a UI is bad at:
 * scripting a batch, reproducing a generation from its manifest, and running the
 * pipeline on a machine with no browser. It is a thin argument parser over
 * `generateLevel` -- no logic lives here, so the CLI and the server cannot
 * drift.
 *
 * Credentials come from the environment, exactly as in the server: this file
 * never accepts a key as an argument (arguments land in shell history and in
 * process listings) and never prints one.
 *
 * Usage:
 *   node editor/generation/cli.mjs --preset runner_primary --difficulty 4 --seed 7
 *   node editor/generation/cli.mjs --blueprint my_plan.json --dry-run
 *   node editor/generation/cli.mjs --list-presets
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';

import { PRESETS, PRESET_IDS } from './presets.js';
import { PROJECT_ROOT, generateLevel } from './pipeline.js';
import { describeConfig, loadLlmConfig } from './llm/config.js';

const USAGE = `
BeatBound AI level director -- generate a level from the analysed song.

  --preset <id>          one of: ${PRESET_IDS.join(', ')}
  --primary-mode <MODE>  ARENA | RUNNER | VERTICAL | RADIAL
  --allowed <MODE,...>   the modes the director may use
  --difficulty <1..5>
  --ratio <0..1>         share of the song the primary mode should own
  --seed <int>           default 1
  --model <id>           overrides BEATBOUND_LLM_MODEL for this run

  --blueprint <file>     compile this blueprint instead of calling the model
  --output-dir <dir>     where the manifest goes (default editor/output)
  --library-dir <dir>    default beatbound_library_v1

  --no-repair            do not let the model repair a rejected blueprint
  --no-courses           skip the RUNNER course check (much faster)
  --fairness             also run the ARENA fairness probe
  --dry-run              compile and report, write nothing at all
  --keep-on-failure      leave a level that failed validation in the library
  --quiet                only print the final verdict
  --list-presets         print the presets and exit
  --help

Credentials are read from the environment, never from an argument:
  BEATBOUND_LLM_API_KEY   required unless --blueprint is given
  BEATBOUND_LLM_MODEL     default deepseek-chat
  BEATBOUND_LLM_BASE_URL  default https://api.deepseek.com/v1
`;

const TAKES_VALUE = new Set([
  '--preset',
  '--primary-mode',
  '--allowed',
  '--difficulty',
  '--ratio',
  '--seed',
  '--model',
  '--blueprint',
  '--output-dir',
  '--library-dir',
]);

const BOOLEAN_FLAGS = new Set([
  '--no-repair',
  '--no-courses',
  '--fairness',
  '--dry-run',
  '--keep-on-failure',
  '--quiet',
  '--list-presets',
  '--help',
]);

/**
 * A minimal, explicit parser: every flag is known, anything else is an error.
 *
 * Accepting an unknown flag silently would mean a typo like `--dryrun` runs a
 * real generation and writes into the library. Failing loudly is the only safe
 * behaviour for a command whose side effects are files in the game's library.
 */
function parseArgs(argv) {
  const opts = { flags: new Set() };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith('--')) throw new Error(`unexpected argument ${JSON.stringify(arg)}`);
    if (TAKES_VALUE.has(arg)) {
      const value = argv[i + 1];
      if (value === undefined || value.startsWith('--')) throw new Error(`${arg} needs a value`);
      opts[arg.slice(2)] = value;
      i += 1;
    } else if (BOOLEAN_FLAGS.has(arg)) {
      opts.flags.add(arg.slice(2));
    } else {
      throw new Error(`unknown flag ${arg} -- run with --help for the list`);
    }
  }
  return opts;
}

function toNumber(raw, name) {
  if (raw === undefined) return undefined;
  const n = Number(raw);
  if (!Number.isFinite(n)) throw new Error(`${name} must be a number (got ${JSON.stringify(raw)})`);
  return n;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const flags = opts.flags;

  if (flags.has('help')) {
    process.stdout.write(USAGE);
    return 0;
  }

  if (flags.has('list-presets')) {
    for (const id of PRESET_IDS) {
      const p = PRESETS[id];
      process.stdout.write(
        `${id.padEnd(16)} ${p.name}\n` +
          `${' '.repeat(17)}${p.primary_mode} primary, ${p.allowed_modes.join('/')}, ` +
          `difficulty ${p.target_difficulty}, ratio ${p.primary_mode_ratio}\n` +
          `${' '.repeat(17)}${p.description}\n\n`,
      );
    }
    return 0;
  }

  const quiet = flags.has('quiet');
  const log = quiet ? () => {} : (line) => process.stdout.write(`${line}\n`);

  // `--model` is a convenience over the environment, applied before the config
  // is read so `describeConfig` reports the model that actually runs.
  if (opts.model) process.env.BEATBOUND_LLM_MODEL = opts.model;

  const config = loadLlmConfig();
  const llm = describeConfig(config);
  log(
    `LLM: ${llm.model} at ${llm.baseUrl} -- key ${llm.apiKeyPresent ? `present (${llm.apiKeyMask})` : 'absent'}`,
  );
  for (const problem of llm.problems) log(`  ! ${problem}`);

  const blueprintPath = opts.blueprint ? path.resolve(opts.blueprint) : null;
  const blueprint = blueprintPath ? JSON.parse(readFileSync(blueprintPath, 'utf8')) : undefined;
  if (blueprintPath) log(`blueprint: ${blueprintPath}`);

  const allowed = opts.allowed ? opts.allowed.split(',').map((s) => s.trim().toUpperCase()).filter(Boolean) : undefined;

  const result = await generateLevel({
    blueprint,
    preset: opts.preset,
    primaryMode: opts['primary-mode']?.toUpperCase(),
    allowedModes: allowed,
    difficulty: toNumber(opts.difficulty, '--difficulty'),
    ratio: toNumber(opts.ratio, '--ratio'),
    seed: toNumber(opts.seed, '--seed'),
    outputDir: opts['output-dir'] ? path.resolve(opts['output-dir']) : undefined,
    libraryDir: opts['library-dir'] ? path.resolve(opts['library-dir']) : undefined,
    repair: !flags.has('no-repair'),
    courses: !flags.has('no-courses'),
    fairness: flags.has('fairness'),
    dryRun: flags.has('dry-run'),
    keepOnFailure: flags.has('keep-on-failure'),
    onEvent: (e) => log(`  ${String(e.stage).padEnd(15)} ${e.message ?? ''}`),
  });

  const m = result.manifest;
  process.stdout.write('\n');
  process.stdout.write(`song      ${m.song_id}\n`);
  process.stdout.write(`request   ${m.request.primary_mode} primary, ${m.request.allowed_modes.join('/')}, ` +
    `difficulty ${m.request.target_difficulty}, ratio ${m.request.primary_mode_ratio}, seed ${m.request.seed}\n`);
  process.stdout.write(`sections  ${m.compile.sections}\n`);
  if (m.director) {
    process.stdout.write(`director  ${m.director.model}, ${m.director.usage?.total_tokens ?? '?'} tokens, ${m.director.latency_ms} ms\n`);
  }
  process.stdout.write(`repairs   ${m.blueprint.structural_repairs} structural, ${m.runtime_repair.passes} runtime\n`);
  process.stdout.write(`\n${m.validation.summary ?? `validation: ${m.validation.reason}`}\n`);
  if (m.compile.warnings.length > 0) {
    process.stdout.write('\ncompiler warnings:\n');
    for (const w of m.compile.warnings) process.stdout.write(`  ! ${w}\n`);
  }
  process.stdout.write(`\n${result.ok ? 'OK' : 'FAILED'}`);
  process.stdout.write(result.levelFile && result.ok ? ` -- beatbound_library_v1/${result.levelFile}\n` : '\n');
  if (result.files?.manifest) process.stdout.write(`manifest  ${result.files.manifest}\n`);

  return result.ok ? 0 : 1;
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    // Errors from the LLM layer are already scrubbed of secrets; anything else
    // is a local wiring mistake and safe to print.
    process.stderr.write(`\nerror: ${err?.message ?? err}\n`);
    process.exit(2);
  });

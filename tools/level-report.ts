/**
 * Bar-by-bar level report.
 *
 * Prints what a level actually schedules -- every mechanic, its musical
 * position, its resolved params and its telegraph/active window -- without
 * running the game.
 *
 *   npm run level                              # the default arena test level
 *   npm run level -- prototype_90s.level.json  # any level in the library
 *   npm run level -- arena_test.level.json 17  # only from bar 17 on
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { LevelLoader, type CompiledLevel } from '../src/core/LevelLoader';
import { MechanicRegistry } from '../src/core/MechanicRegistry';
import type { MechanicDefinition } from '../src/core/types';
import { registerArenaMechanics } from '../src/mechanics/arena';
import { registerRunnerMechanics } from '../src/mechanics/runner';
import { registerVerticalMechanics } from '../src/mechanics/vertical';
import { registerRadialMechanics } from '../src/mechanics/radial';
import { specToRelativeBeats, absoluteToPosition } from '../src/core/TempoMap';
import { scaleTelegraphBeats } from '../src/core/Intensity';
import { DATA } from '../src/config';
import { REACTION_FLOOR_SECONDS, minimumGapWidth } from '../src/core/fairness';
import { tierForDifficulty, travelScale } from '../src/mechanics/arena/arenaTiming';

const LIBRARY_DIR = resolve(process.cwd(), 'beatbound_library_v1');

(globalThis as unknown as { fetch: unknown }).fetch = async (url: string) => ({
  ok: true,
  status: 200,
  json: async () => JSON.parse(readFileSync(resolve(LIBRARY_DIR, url.replace(/^\//, '')), 'utf8')),
});

interface Row {
  bar: number;
  beat: number;
  sectionId: string;
  patternId: string;
  mechanicId: string;
  mechanicName: string;
  implemented: boolean;
  telegraphBeats: number;
  activeBeats: number;
  intensity: number;
  params: string;
  /** The mechanic's library definition, for the reaction-seconds column. */
  definition: MechanicDefinition | null;
}

async function main(): Promise<void> {
  const [levelArg, fromBarArg] = process.argv.slice(2);
  const levelUrl = levelArg ? (levelArg.startsWith('/') ? levelArg : `/${levelArg}`) : DATA.defaultLevel;
  const fromBar = Number(fromBarArg) >= 1 ? Math.floor(Number(fromBarArg)) : 1;

  const loader = new LevelLoader();
  const level = await loader.load({
    levelUrl,
    patternsUrl: DATA.patterns,
    mechanicsUrl: DATA.mechanics,
  });

  const registry = new MechanicRegistry();
  registry.loadLibrary(loader.mechanics);
  // Every mode, not just ARENA: the report claims which events the runtime will
  // actually spawn, so a mode left unregistered here reads as dead air.
  registerArenaMechanics(registry);
  registerRunnerMechanics(registry);
  registerVerticalMechanics(registry);
  registerRadialMechanics(registry);

  printHeader(level, levelUrl);

  const beatsPerBar = level.tempo.beatsPerBar;
  const usedMechanics = new Set<string>();

  for (const section of level.sections) {
    const rows: Row[] = [];
    for (const placement of section.placements) {
      const base = (placement.startBar - 1) * beatsPerBar;
      for (const event of placement.pattern.events) {
        const definition = registry.getDefinition(event.mechanicId);
        if (!definition) continue;
        usedMechanics.add(event.mechanicId);
        const absolute = base + specToRelativeBeats(event.at, beatsPerBar);
        const pos = absoluteToPosition(absolute, beatsPerBar);
        rows.push({
          bar: pos.bar,
          beat: absolute - (pos.bar - 1) * beatsPerBar + 1,
          sectionId: section.id,
          patternId: placement.pattern.id,
          mechanicId: event.mechanicId,
          mechanicName: definition.name,
          implemented: registry.hasImplementation(event.mechanicId),
          telegraphBeats: scaleTelegraphBeats(
            definition.timing.telegraphBeats,
            placement.intensity,
            placement.pattern.constraints?.minReactionBeats,
          ),
          activeBeats: definition.timing.durationBeats,
          intensity: placement.intensity,
          params: formatParams(event.params),
          definition,
        });
      }
    }
    rows.sort((a, b) => a.bar - b.bar || a.beat - b.beat);
    printSection(level, section, rows, fromBar);
  }

  printLegend(registry, usedMechanics);
}

function printHeader(level: CompiledLevel, levelUrl: string): void {
  const bars = level.endBar - 1;
  const seconds = level.tempo.beatsToTime(bars * level.tempo.beatsPerBar);
  console.log(`\n${'='.repeat(78)}`);
  console.log(`${level.song.title ?? level.song.id}   (${levelUrl.replace(/^\//, '')})`);
  console.log(
    `${level.song.bpm} BPM · ${level.song.timeSignature.join('/')} · ` +
    `${bars} bars · ${seconds.toFixed(1)}s · audio: ${level.song.audio}`,
  );
  console.log('='.repeat(78));
  for (const w of level.warnings) console.log(`  ! ${w}`);
}

function printSection(
  level: CompiledLevel,
  section: CompiledLevel['sections'][number],
  rows: Row[],
  fromBar: number,
): void {
  if (section.endBar <= fromBar) return;
  const beatsPerBar = level.tempo.beatsPerBar;
  const startSeconds = level.tempo.beatsToTime((section.startBar - 1) * beatsPerBar);
  const endSeconds = level.tempo.beatsToTime((section.endBar - 1) * beatsPerBar);

  console.log(
    `\n${section.id}  ${section.mode}  bars ${section.startBar}-${section.endBar - 1}  ` +
    `(${startSeconds.toFixed(1)}s-${endSeconds.toFixed(1)}s)  ` +
    `${section.definition.function ?? '-'}  difficulty ${section.definition.difficulty ?? '-'}` +
    (section.transitionOut ? `  -> ${section.transitionOut}` : ''),
  );

  // A course section has no placements by construction -- its terrain comes
  // from the planned trajectory -- so the pattern machinery below would report
  // it as an empty section. It is the *opposite* of empty: the trajectory is
  // the content. Print it as phrases instead, in the same shape the pattern
  // rows use, so a RUNNER level reads as a course rather than as dead air.
  if (section.course) {
    printCourse(level, section.course, fromBar);
    return;
  }

  const layout = section.placements
    .map((p) => `${p.pattern.id}@${p.startBar}`)
    .join(' ');
  console.log(`  patterns: ${layout || '(none)'}`);

  // Events per bar across the section. A '.' is a bar with nothing scheduled --
  // dead air the player just stands through.
  const perBar: number[] = [];
  for (let bar = section.startBar; bar < section.endBar; bar++) {
    perBar.push(rows.filter((row) => row.bar === bar).length);
  }
  const map = perBar.map((n) => (n === 0 ? '.' : n > 9 ? '+' : String(n))).join(' ');
  const empty = perBar.filter((n) => n === 0).length;
  console.log(`  bar map:  ${map}${empty > 0 ? `   <-- ${empty} empty bar(s)` : ''}`);
  console.log(`  ${'bar.beat'.padEnd(9)}${'time'.padEnd(8)}${'pattern'.padEnd(8)}${'mechanic'.padEnd(24)}${'telegraph'.padEnd(11)}${'active'.padEnd(9)}${'react'.padEnd(9)}params`);

  let lastBar = -1;
  for (const row of rows) {
    if (row.bar < fromBar) continue;
    if (lastBar !== -1 && row.bar !== lastBar) console.log(`  ${'-'.repeat(74)}`);
    lastBar = row.bar;
    const beatTime = level.tempo.beatsToTime((row.bar - 1) * beatsPerBar + row.beat - 1);
    const name = `${row.mechanicId} ${row.mechanicName}${row.implemented ? '' : ' (no runtime)'}`;
    console.log(
      `  ${`${row.bar}.${fmt(row.beat)}`.padEnd(9)}` +
      `${`${beatTime.toFixed(1)}s`.padEnd(8)}` +
      `${row.patternId.padEnd(8)}` +
      `${name.padEnd(24)}` +
      `${`${fmt(row.telegraphBeats)} beat`.padEnd(11)}` +
      `${`${fmt(row.activeBeats)} beat`.padEnd(9)}` +
      `${reactionCell(level, section, row).padEnd(9)}` +
      `${row.params}${row.intensity !== 0.5 ? `  intensity=${row.intensity}` : ''}`,
    );
  }
  if (rows.every((r) => r.bar < fromBar)) console.log('  (no events at or after the requested bar)');
}

/**
 * A RUNNER course, phrase by phrase.
 *
 * The interesting column is `bar.beat`, and it is absolute: a phrase starts on
 * the bar line it was authored on, so a course whose phrases drift off the bar
 * lines is visible here as a column that no longer lands on whole bars. The
 * verb list is the *planned* one -- what the planner actually built from the
 * authored verbs, after budgeting and trimming -- because that, not the authored
 * list, is what the player meets.
 */
function printCourse(
  level: CompiledLevel,
  course: NonNullable<CompiledLevel['sections'][number]['course']>,
  fromBar: number,
): void {
  const beatsPerBar = level.tempo.beatsPerBar;
  const phrases = course.trajectory.phrases;
  // Measured from the first phrase to the end of the last, not `endBeat` minus
  // `startBeat`: those bracket the *planned* span and a course that was trimmed
  // to fit its section ends earlier than the section does.
  const first = phrases[0]?.startBeat ?? course.startBeat;
  const beats = phrases.reduce((n, p) => Math.max(n, p.startBeat + p.beats - first), 0);
  const firstBar = Math.floor(first / beatsPerBar) + 1;
  console.log(
    `  course:   ${phrases.length} phrase(s) · ${fmt(beats)} beats · ` +
    `scroll lead ${fmt(course.leadInBeats)} beats`,
  );

  const perBar: number[] = [];
  for (let bar = firstBar; bar < firstBar + Math.ceil(beats / beatsPerBar); bar++) {
    const lo = (bar - 1) * beatsPerBar;
    perBar.push(phrases.filter((p) => p.startBeat < lo + beatsPerBar && p.startBeat + p.beats > lo).length);
  }
  const empty = perBar.filter((n) => n === 0).length;
  console.log(
    `  bar map:  ${perBar.map((n) => (n === 0 ? '.' : n > 9 ? '+' : String(n))).join(' ')}` +
    `${empty > 0 ? `   <-- ${empty} empty bar(s)` : ''}`,
  );
  console.log(`  ${'bar.beat'.padEnd(9)}${'time'.padEnd(8)}${'role'.padEnd(10)}${'archetype'.padEnd(18)}${'motif'.padEnd(9)}verbs`);

  let lastBar = -1;
  for (const phrase of phrases) {
    const bar = Math.floor(phrase.startBeat / beatsPerBar) + 1;
    if (bar < fromBar) continue;
    if (lastBar !== -1 && bar !== lastBar) console.log(`  ${'-'.repeat(74)}`);
    lastBar = bar;
    const beatInBar = (phrase.startBeat % beatsPerBar) + 1;
    const seconds = level.tempo.beatsToTime(phrase.startBeat);
    // Consecutive repeats of the same verb collapse to `VERB xN`, so a phrase
    // that is one idea played four times reads as that rather than as noise.
    const verbs: string[] = [];
    for (const segment of phrase.segments) {
      const last = verbs[verbs.length - 1];
      const base = last?.split(' x')[0];
      if (base === segment.verb) verbs[verbs.length - 1] = `${base} x${Number(last.split(' x')[1] ?? 1) + 1}`;
      else verbs.push(segment.verb);
    }
    console.log(
      `  ${`${bar}.${fmt(beatInBar)}`.padEnd(9)}` +
      `${`${seconds.toFixed(1)}s`.padEnd(8)}` +
      `${phrase.role.padEnd(10)}` +
      `${phrase.archetype.padEnd(18)}` +
      `${phrase.motif.padEnd(9)}` +
      `${verbs.join(' -> ')}`,
    );
  }
  if (phrases.every((p) => Math.floor(p.startBeat / beatsPerBar) + 1 < fromBar)) {
    console.log('  (no phrases at or after the requested bar)');
  }
}

/**
 * Seconds of warning this event gives, against the floor a player needs.
 *
 * ARENA only: the number is the telegraph plus the hazard's travel at the
 * section's tier, and it is the same arithmetic `npm run fairness` audits. It
 * is printed here so a designer reading a level can see the margin per event
 * rather than having to run a second tool.
 */
function reactionCell(
  level: CompiledLevel,
  section: CompiledLevel['sections'][number],
  row: Row,
): string {
  if (section.mode !== 'ARENA') return '-';
  const definition = row.definition;
  const tier = tierForDifficulty(section.definition.difficulty);
  const spb = level.tempo.secondsPerBeatAt(0);
  const telegraph = (definition?.timing.telegraphBeats ?? 0) * tier.telegraphScale;
  const travel = Math.min(definition?.timing.durationBeats ?? 0, 3) * travelScale(tier);
  const seconds = (telegraph + travel) * spb;
  const needed = REACTION_FLOOR_SECONDS + minimumGapWidth() / 2;
  return seconds >= needed ? `${seconds.toFixed(2)}s` : `${seconds.toFixed(2)}s!`;
}

function printLegend(registry: MechanicRegistry, used: Set<string>): void {
  const missing = [...used].filter((id) => !registry.hasImplementation(id)).sort();
  console.log(`\n${'-'.repeat(78)}`);
  console.log(`mechanics used: ${[...used].sort().join(', ')}`);
  console.log(
    missing.length > 0
      ? `no runtime yet (these events are skipped at play time): ${missing.join(', ')}`
      : 'every mechanic in this level has a runtime implementation.',
  );
  console.log('jump to a bar in the browser:  ?startBar=<bar>&invincible\n');
}

function formatParams(params: Record<string, unknown> | undefined): string {
  if (!params) return '';
  return Object.entries(params).map(([k, v]) => `${k}=${JSON.stringify(v)}`).join(' ');
}

function fmt(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/0$/, '');
}

void main();

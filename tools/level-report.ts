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
import { registerArenaMechanics } from '../src/mechanics/arena';
import { specToRelativeBeats, absoluteToPosition } from '../src/core/TempoMap';
import { scaleTelegraphBeats } from '../src/core/Intensity';
import { DATA } from '../src/config';

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
  registerArenaMechanics(registry);

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

  const layout = section.placements
    .map((p) => `${p.pattern.id}@${p.startBar}`)
    .join(' ');
  console.log(`  patterns: ${layout || '(none)'}`);
  console.log(`  ${'bar.beat'.padEnd(9)}${'time'.padEnd(8)}${'pattern'.padEnd(8)}${'mechanic'.padEnd(24)}${'telegraph'.padEnd(11)}${'active'.padEnd(9)}params`);

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
      `${row.params}${row.intensity !== 0.5 ? `  intensity=${row.intensity}` : ''}`,
    );
  }
  if (rows.every((r) => r.bar < fromBar)) console.log('  (no events at or after the requested bar)');
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

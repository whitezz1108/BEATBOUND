/**
 * RUNNER course dump -- what a planned course actually contains.
 *
 * `runner-check.ts` answers "is this course valid". This answers the question
 * that comes *before* that one when a course is being authored: "what did the
 * planner build from what I wrote?" A course spec is six fields of intent; the
 * trajectory it expands into is a hundred segments of geometry, and when a
 * section does not play the way it was meant to, the spec is not where the
 * answer is.
 *
 * Prints, per phrase: the archetype and role, the surface, the beats, and every
 * verb with the level it ran at. Then the terrain the planner derived from it.
 *
 *   npm run course-dump -- runner_showcase.level.json
 *   npm run course-dump -- runner_showcase.level.json --segments
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { LevelLoader, type CompiledLevel } from '../src/core/LevelLoader';
import { DATA } from '../src/config';

const LIBRARY_DIR = resolve(process.cwd(), 'beatbound_library_v1');
(globalThis as unknown as { fetch: unknown }).fetch = async (url: string) => ({
  ok: true, status: 200,
  json: async () => JSON.parse(readFileSync(resolve(LIBRARY_DIR, url.replace(/^\//, '')), 'utf8')),
});

async function main(): Promise<void> {
  const args = process.argv.slice(2).filter((a) => !a.startsWith('--'));
  const verbose = process.argv.includes('--segments');
  const files = args.length > 0 ? args : levelFiles();

  const loader = new LevelLoader();
  await loader.loadLibraries(DATA.patterns, DATA.mechanics);

  for (const file of files) {
    let level: CompiledLevel;
    try {
      level = await loader.load({ levelUrl: `/${file}`, patternsUrl: DATA.patterns, mechanicsUrl: DATA.mechanics });
    } catch (error) {
      console.log(`\n${file}: LOAD FAILED -- ${(error as Error).message}`);
      continue;
    }
    const secondsPerBeat = 60 / level.song.bpm;
    console.log(`\n=== ${file}  (${level.song.bpm} BPM, ${secondsPerBeat.toFixed(3)}s/beat) ===`);
    for (const section of level.sections) {
      if (!section.course) continue;
      const { trajectory } = section.course;
      const seconds = (trajectory.endBeat - trajectory.startBeat) * secondsPerBeat;
      console.log(
        `\n  section ${section.id}  bars ${section.startBar}..${section.endBar}  `
        + `${trajectory.phrases.length} phrases  ${(trajectory.endBeat - trajectory.startBeat)} beats  `
        + `${seconds.toFixed(1)}s`,
      );
      for (const phrase of trajectory.phrases) {
        const t = (phrase.startBeat - trajectory.startBeat) * secondsPerBeat;
        const surface = phrase.segments[0]?.surface ?? '-';
        const verbs = summarise(phrase.segments);
        console.log(
          `    ${pad(phrase.role, 10)}${pad(phrase.archetype, 18)}${pad(phrase.motif, 8)}`
          + `${pad(surface, 8)}b${pad(String(phrase.startBeat), 5)}${pad(`+${phrase.beats}`, 6)}`
          + `${pad(`${t.toFixed(1)}s`, 8)}${verbs}`,
        );
        if (verbose) {
          for (const segment of phrase.segments) {
            const level = (0.72 - segment.runY).toFixed(3);
            console.log(
              `        ${pad(segment.verb, 30)}b${pad(segment.startBeat.toFixed(2), 8)}`
              + `${pad(`+${segment.beats.toFixed(2)}`, 8)}${pad(segment.surface, 9)}`
              + `run ${pad(level, 8)}${segment.airborne ? ' AIR' : ''}${segment.slide ? ' SLIDE' : ''}`
              + `${segment.flipAt !== undefined ? ' FLIP' : ''}  ${segment.note ?? ''}`,
            );
          }
        }
      }
      const slabs = section.course.trajectory.segments.flatMap((s) => s.demands).filter((d) => d.kind === 'SLAB').length;
      const gaps = section.course.trajectory.segments.flatMap((s) => s.demands).filter((d) => d.kind === 'GAP').length;
      const pads = section.course.trajectory.segments.flatMap((s) => s.demands).filter((d) => d.kind === 'PAD').length;
      const hazards = section.course.trajectory.segments.flatMap((s) => s.hazards).length;
      console.log(`\n    terrain: ${slabs} slab demand(s), ${gaps} gap(s), ${pads} pad(s), ${hazards} hazard(s)`);
    }
  }
}

/** Verbs in order, with repeats collapsed: "MEDIUM_JUMP x3, GROUND_RUN". */
function summarise(segments: Array<{ verb: string }>): string {
  const out: string[] = [];
  for (const segment of segments) {
    const last = out[out.length - 1];
    if (last && last.startsWith(segment.verb)) {
      const match = / x(\d+)$/.exec(last);
      const n = match ? Number(match[1]) + 1 : 2;
      out[out.length - 1] = `${segment.verb} x${n}`;
    } else {
      out.push(segment.verb);
    }
  }
  return out.join(' -> ');
}

function pad(value: string, width: number): string {
  return value.length >= width ? `${value} ` : value.padEnd(width);
}

function levelFiles(): string[] {
  const index = JSON.parse(readFileSync(resolve(LIBRARY_DIR, 'levels.index.json'), 'utf8')) as {
    levels: Array<{ file: string }>;
  };
  return index.levels.map((entry) => entry.file);
}

void main();

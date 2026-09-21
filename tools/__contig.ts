/**
 * Scratch: does every phrase's segment list actually satisfy the trajectory's
 * contiguity invariant?
 *
 * `trajectory.ts` says: `segment[i].endBeat === segment[i+1].startBeat` and
 * `segment[i].endFeetY === segment[i+1].startFeetY`, and that everything
 * downstream may trust it. The composer has one place where it could break it:
 * a verb that was only *partly* consumed still hands the loop `result.next`,
 * which is the state at the end of the *whole* verb.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { LevelLoader } from '../src/core/LevelLoader';
import { DATA } from '../src/config';
import type { Trajectory } from '../src/mechanics/runner/trajectory';

const LIBRARY_DIR = resolve(process.cwd(), 'beatbound_library_v1');
(globalThis as unknown as { fetch: unknown }).fetch = async (url: string) => ({
  ok: true, status: 200,
  json: async () => JSON.parse(readFileSync(resolve(LIBRARY_DIR, url.replace(/^\//, '')), 'utf8')),
});

function check(label: string, t: Trajectory): number {
  let bad = 0;
  for (const phrase of t.phrases) {
    for (let i = 0; i + 1 < phrase.segments.length; i++) {
      const a = phrase.segments[i];
      const b = phrase.segments[i + 1];
      const aEnd = a.startBeat + a.beats;
      // A flip segment is the one place world y is *allowed* to be discontinuous.
      const flip = a.flipAt !== undefined || b.flipAt !== undefined;
      const beatOk = Math.abs(aEnd - b.startBeat) < 1e-6;
      const yOk = flip || Math.abs(a.endFeetY - b.startFeetY) < 1e-6;
      if (!beatOk || !yOk) {
        bad++;
        console.log(
          `  ${label} @${phrase.startBeat} [${i}] ${a.verb}->${b.verb} `
          + `beat ${aEnd.toFixed(3)}/${b.startBeat.toFixed(3)} y ${a.endFeetY.toFixed(4)}/${b.startFeetY.toFixed(4)}`,
        );
      }
    }
  }
  return bad;
}

async function main(): Promise<void> {
  const loader = new LevelLoader();
  await loader.loadLibraries(DATA.patterns, DATA.mechanics);
  const files: string[] = JSON.parse(readFileSync(resolve(LIBRARY_DIR, 'levels.index.json'), 'utf8'))
    .levels.map((e: { file: string }) => e.file);
  let total = 0;
  for (const file of files) {
    let level;
    try {
      level = await loader.load({ levelUrl: `/${file}`, patternsUrl: DATA.patterns, mechanicsUrl: DATA.mechanics });
    } catch { continue; }
    for (const section of level.sections) {
      if (!section.course) continue;
      total += check(file, section.course.trajectory);
    }
  }
  console.log(`contiguity violations: ${total}`);
}
void main();

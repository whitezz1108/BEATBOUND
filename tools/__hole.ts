/**
 * Scratch: is the per-verb `airborneSeen` scope a *correctness* bug or only a
 * cosmetic one?
 *
 * `ensureGround`'s contract is: a grounded segment that follows a flight
 * asserts the ground under itself, because a flight may have cut a hole in the
 * running surface. If the flag that carries "a flight just happened" is reset
 * at every authored verb, then a run written as its own verb after a
 * `GAP_JUMP` never asserts anything -- and the player is planned to run
 * straight through a hole.
 *
 * This walks every course in the library and reports any grounded segment that
 * overlaps a gap on its own surface with no slab covering it.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { LevelLoader } from '../src/core/LevelLoader';
import { DATA } from '../src/config';
import { courseWorldFor } from '../src/mechanics/runner/courseSchedule';
import { UNITS_PER_BEAT } from '../src/mechanics/runner/runnerGeometry';

const LIBRARY_DIR = resolve(process.cwd(), 'beatbound_library_v1');
(globalThis as unknown as { fetch: unknown }).fetch = async (url: string) => ({
  ok: true, status: 200,
  json: async () => JSON.parse(readFileSync(resolve(LIBRARY_DIR, url.replace(/^\//, '')), 'utf8')),
});

async function main(): Promise<void> {
  const loader = new LevelLoader();
  await loader.loadLibraries(DATA.patterns, DATA.mechanics);
  const files: string[] = JSON.parse(readFileSync(resolve(LIBRARY_DIR, 'levels.index.json'), 'utf8'))
    .levels.map((e: { file: string }) => e.file);
  let holes = 0;
  for (const file of files) {
    let level;
    try {
      level = await loader.load({ levelUrl: `/${file}`, patternsUrl: DATA.patterns, mechanicsUrl: DATA.mechanics });
    } catch { continue; }
    for (const section of level.sections) {
      if (!section.course) continue;
      const world = courseWorldFor(section.course);
      for (const segment of section.course.trajectory.segments) {
        if (segment.airborne) continue;
        const runY = segment.runY;
        for (const gap of world.gaps) {
          if (gap.surface !== segment.surface) continue;
          if (gap.endBeat <= segment.startBeat + 1e-6 || gap.startBeat >= segment.startBeat + segment.beats - 1e-6) continue;
          const half = (d: number): number => d;
          const covered = world.slabs.some((slab) =>
            slab.surface === segment.surface
            && Math.abs(slab.faceY - runY) < 1e-6
            && slab.startBeat <= segment.startBeat + 1e-6
            && slab.endBeat >= segment.startBeat + segment.beats - 1e-6);
          if (covered) continue;
          holes++;
          console.log(
            `${file} ${segment.verb} [${segment.startBeat.toFixed(2)}..${(segment.startBeat + segment.beats).toFixed(2)}] `
            + `over gap ${gap.startBeat.toFixed(2)}..${gap.endBeat.toFixed(2)} on ${gap.surface} `
            + `(gap ${((gap.endBeat - gap.startBeat) * UNITS_PER_BEAT).toFixed(3)} units) runY=${runY.toFixed(3)}`,
          );
          void half;
        }
      }
    }
  }
  console.log(`grounded runs over an uncovered hole: ${holes}`);
}
void main();

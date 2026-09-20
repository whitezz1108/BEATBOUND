/** Trace: what world objects exist per beat window in test_01, and why. */
import { readFileSync } from 'node:fs';
import { planCourse } from '../src/mechanics/runner/runnerPlanner';
import { buildCourseWorld } from '../src/mechanics/runner/courseWorld';
import type { CourseSpec } from '../src/core/types';

const file = process.argv[2] ?? 'beatbound_library_v1/runner_test_01_basic_chain.level.json';
const json = JSON.parse(readFileSync(file, 'utf8')) as {
  sections: Array<{ course?: CourseSpec }>;
};
const spec = json.sections[0].course!;
const traj = planCourse(spec, { startBeat: 0 });
const world = buildCourseWorld(traj);

console.log(`== ${file} ==`);
for (const [i, phrase] of traj.phrases.entries()) {
  const dem = phrase.segments.reduce((n, s) => n + s.demands.length, 0);
  console.log(
    `phrase ${i} @${phrase.startBeat.toFixed(2)} beats=${phrase.beats} ` +
    `segments=[${phrase.segments.map((s) => `${s.verb}:${s.beats.toFixed(2)}`).join(', ')}] demands=${dem}`,
  );
}

console.log('\nworld objects (slabs/gaps/hazards/pads):');
for (const s of world.slabs) console.log(`  SLAB @${s.startBeat.toFixed(2)}..${s.endBeat.toFixed(2)} faceY=${s.faceY.toFixed(3)} floating=${s.floating}`);
for (const g of world.gaps) console.log(`  GAP  @${g.startBeat.toFixed(2)}..${g.endBeat.toFixed(2)}`);
for (const h of world.hazards) console.log(`  HAZ  @${h.beat.toFixed(2)} ${h.kind}`);
for (const p of (world as unknown as { pads: Array<{ beat: number }> }).pads ?? []) console.log(`  PAD  @${p.beat.toFixed(2)}`);

console.log('\nempty stretches (0.25 grid):');
let emptyFrom: number | null = null;
for (let beat = 0; beat <= traj.endBeat; beat += 0.25) {
  const on = world.platformsAt(beat).length + world.hazardsAt(beat).length + world.padsAt(beat).length;
  if (on === 0 && emptyFrom === null) emptyFrom = beat;
  if (on > 0 && emptyFrom !== null) {
    console.log(`  empty ${emptyFrom.toFixed(2)}..${beat.toFixed(2)} (${(beat - emptyFrom).toFixed(2)} beats)`);
    emptyFrom = null;
  }
}
if (emptyFrom !== null) console.log(`  empty ${emptyFrom.toFixed(2)}..end`);

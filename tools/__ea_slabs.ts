/** Dump trajectory + world slabs in a beat window for one level. */
import { readFileSync } from 'node:fs';
import { planCourse } from '../src/mechanics/runner/runnerPlanner';
import { buildCourseWorld } from '../src/mechanics/runner/courseWorld';
import type { CourseSpec } from '../src/core/types';

const file = process.argv[2];
const from = Number(process.argv[3]);
const to = Number(process.argv[4]);
const json = JSON.parse(readFileSync(file, 'utf8')) as { sections: Array<{ course?: CourseSpec }> };
const traj = planCourse(json.sections[0].course!, { startBeat: 0 });
const world = buildCourseWorld(traj);
for (const s of traj.segments) {
  if (s.startBeat + s.beats < from || s.startBeat > to) continue;
  console.log(`SEG ${s.verb.padEnd(22)} @${s.startBeat.toFixed(3)} +${s.beats.toFixed(3)} air=${s.airborne ? 1 : 0} apex=${(s.apex ?? 0).toFixed(3)} startY=${s.startFeetY.toFixed(3)} endY=${s.endFeetY.toFixed(3)} flip=${s.flipAt ?? '-'}`);
  for (const d of s.demands) if (d.kind === 'SLAB') console.log(`   -> SLAB @${d.beat.toFixed(3)} w=${d.width.toFixed(3)} faceY=${d.faceY.toFixed(3)} backY=${d.backY.toFixed(3)} flt=${d.floating}`);
}
console.log('--- world slabs in window (post clip+coalesce) ---');
for (const s of world.slabs) {
  if (s.endBeat < from || s.startBeat > to) continue;
  console.log(`SLAB @${s.startBeat.toFixed(3)}..${s.endBeat.toFixed(3)} (${(s.endBeat - s.startBeat).toFixed(3)} beats) faceY=${s.faceY.toFixed(3)} backY=${s.backY.toFixed(3)} surf=${s.surface}`);
}

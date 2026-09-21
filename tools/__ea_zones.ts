/** Dump per-segment zone sampling for one level's phrases (mimics checkPhraseZones). */
import { readFileSync } from 'node:fs';
import { planCourse } from '../src/mechanics/runner/runnerPlanner';
import { zoneOfY } from '../src/mechanics/runner/verticalZones';
import type { CourseSpec } from '../src/core/types';

const file = process.argv[2] ?? 'beatbound_library_v1/runner_test_08_inverted_chain.level.json';
const want = Number(process.argv[3] ?? -1);
const json = JSON.parse(readFileSync(file, 'utf8')) as {
  sections: Array<{ course?: CourseSpec }>;
};
const spec = json.sections[0].course!;
const traj = planCourse(spec, { startBeat: 0 });
for (const phrase of traj.phrases) {
  if (want >= 0 && phrase.startBeat !== want) continue;
  if (phrase.intensity < 0.45) continue;
  console.log(`phrase @${phrase.startBeat} ${phrase.archetype} intensity=${phrase.intensity}`);
  let total = 0;
  const beats: Record<string, number> = {};
  for (const s of phrase.segments) {
    const mid = s.startBeat + s.beats / 2;
    if (mid < phrase.startBeat || mid >= phrase.startBeat + phrase.beats) { console.log(`  (outside) ${s.verb} @${s.startBeat.toFixed(2)} +${s.beats.toFixed(2)}`); continue; }
    const g = s.surface === 'FLOOR' ? 1 : -1;
    const feet = s.airborne && (s.apex ?? 0) > 0 ? s.startFeetY - g * s.apex! : s.airborne ? Math.min(s.startFeetY, s.endFeetY) : s.runY;
    const zone = zoneOfY(feet);
    beats[zone] = (beats[zone] ?? 0) + s.beats;
    total += s.beats;
    console.log(`  ${s.verb.padEnd(24)} @${s.startBeat.toFixed(2)} +${s.beats.toFixed(2)} surf=${s.surface} lvl=${(s.surface === 'FLOOR' ? 0.72 - s.startFeetY : s.startFeetY - 0.28).toFixed(3)} apex=${(s.apex ?? 0).toFixed(3)} feet=${feet.toFixed(3)} -> ${zone}`);
  }
  console.log(`  totals: ${JSON.stringify(beats)} of ${total.toFixed(2)}`);
}

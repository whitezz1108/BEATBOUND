import { composeCourse, planCourse } from '../src/mechanics/runner/runnerPlanner';
import { zoneOfY } from '../src/mechanics/runner/verticalZones';

const seed = Number(process.argv[2] ?? 7);
const spec = composeCourse({ beats: 64, seed, intensity: 0.6 });
const traj = planCourse(spec, { startBeat: 0 });
for (const p of traj.phrases) {
  if (p.intensity < 0.45) continue;
  const beats: Record<string, number> = {};
  let surf: string | null = null;
  const segs: string[] = [];
  for (const s of p.segments) {
    const mid = s.startBeat + s.beats / 2;
    if (mid < p.startBeat || mid >= p.startBeat + p.beats) continue;
    const g = s.surface === 'FLOOR' ? 1 : -1;
    const feet = s.airborne && (s.apex ?? 0) > 0 ? s.startFeetY - g * s.apex! : s.airborne ? Math.min(s.startFeetY, s.endFeetY) : s.runY;
    beats[zoneOfY(feet)] = (beats[zoneOfY(feet)] ?? 0) + s.beats;
    surf = s.surface;
    segs.push(`${s.verb}:${s.beats.toFixed(2)}`);
  }
  console.log(`@${p.startBeat.toFixed(0).padStart(3)} ${p.archetype.padEnd(16)} int=${p.intensity.toFixed(2)} surf=${surf} [${segs.join(', ')}] ${JSON.stringify(beats)}`);
}

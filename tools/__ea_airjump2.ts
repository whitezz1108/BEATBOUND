/** Universal double jump: no rings involved at all. */
import { RunnerPlayer } from '../src/modes/runner/RunnerPlayer';
import { GROUND_Y } from '../src/mechanics/runner/runnerGeometry';
import { apexFor } from '../src/mechanics/runner/runnerPhysics';

const p = new RunnerPlayer();
const spb = 0.5, dt = 1 / 60;
const probe = { support: GROUND_Y, blocker: null };
const frameOf = (beat: number) => Math.round((beat * spb) / dt);
let maxRise = 0, jumps = 0;
let thirdFired = false;

for (let f = 0; f <= frameOf(2.5); f++) {
  const beat = (f * dt) / spb;
  const first = f === 0;
  const second = f === frameOf(0.475);   // press again at the apex
  const third = f === frameOf(0.9);      // a THIRD press must NOT jump again
  const r = p.update(dt, spb, { jumpPressed: first || second || third, jumpHeld: true, slide: false }, 1, probe);
  maxRise = Math.max(maxRise, GROUND_Y - p.feet);
  if (r.jumped) jumps++;
  if (r.jumped && third) thirdFired = true;
}
console.log(`jumps fired: ${jumps} (expect 2)   third press fired: ${thirdFired} (expect false)`);
console.log(`max rise: ${maxRise.toFixed(3)} (single apex ${apexFor(1).toFixed(3)}, double-jump block at 0.34)`);
console.log(jumps === 2 && !thirdFired && maxRise > 0.34 ? 'PASS' : 'FAIL');

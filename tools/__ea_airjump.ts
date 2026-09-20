/** Headless repro v2: full timeline, second press inside the loop at the ring beat. */
import { RunnerPlayer } from '../src/modes/runner/RunnerPlayer';
import { GROUND_Y } from '../src/mechanics/runner/runnerGeometry';
import { apexFor, AIR_JUMP_SCALE, gravityFor, jumpVelocityFor } from '../src/mechanics/runner/runnerPhysics';

const p = new RunnerPlayer();
const spb = 0.5;              // 120 BPM
const dt = 1 / 60;
const probe = { support: GROUND_Y, blocker: null };
const frameOf = (beat: number) => Math.round((beat * spb) / dt);
const ringBeat = 0.475;       // planned: takeoff + pressBeats
let maxRise = 0;
let secondFired: number | null = null;

for (let f = 0; f <= frameOf(3); f++) {
  const beat = (f * dt) / spb;
  const jumpPressed = f === 0 || f === frameOf(ringBeat);
  const jumpHeld = f >= 0 && beat < 2;
  // mode-side arming: live while |beat - ringBeat| <= 0.25 and airborne
  if (f > 0 && Math.abs(beat - ringBeat) <= 0.25 && !p.isGrounded) p.armAirJump();
  const r = p.update(dt, spb, { jumpPressed, jumpHeld, slide: false }, 1, probe);
  maxRise = Math.max(maxRise, GROUND_Y - p.feet);
  if (r.jumped && f > 0 && secondFired === null) {
    secondFired = beat;
    const expected = -gravityFor(spb) * jumpVelocityFor(spb) * AIR_JUMP_SCALE;
    console.log(`second press FIRED at beat ${beat.toFixed(3)} velocity=${p.velocity.toFixed(2)} expected≈${expected.toFixed(2)}`);
  }
}
console.log(`secondFired=${secondFired}`);
console.log(`max rise = ${maxRise.toFixed(3)}  (single-jump apex ${apexFor(1).toFixed(3)}, double-jump block at 0.34)`);
console.log(maxRise > 0.34 ? 'PASS: can reach the double-jump block' : 'FAIL: cannot reach the block');

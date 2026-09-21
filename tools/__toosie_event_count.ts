// TEMPORARY probe -- delete after use.
// Counts authored vs runtime-kept events using the real compile + breather rules.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { LevelLoader } from '../src/core/LevelLoader';
import { specToRelativeBeats } from '../src/core/TempoMap';
import { DATA } from '../src/config';
import { TUNING, beatsForSeconds } from '../src/tuning';

const LIBRARY_DIR = resolve(process.cwd(), 'beatbound_library_v1');
(globalThis as unknown as { fetch: unknown }).fetch = async (url: string) => ({
  ok: true,
  status: 200,
  json: async () => JSON.parse(readFileSync(resolve(LIBRARY_DIR, url.replace(/^\//, '')), 'utf8')),
});

const file = process.argv[2] ?? 'toosie_slide_arena_primary.level.json';
const loader = new LevelLoader();
const level = await loader.load({
  levelUrl: `/${file}`,
  patternsUrl: DATA.patterns,
  mechanicsUrl: DATA.mechanics,
});

const bpm = level.song.bpm;
const beatsPerBar = level.song.timeSignature[0];
const runway = Math.max(TUNING.transition.breatherBeats, beatsForSeconds(bpm, 3));

console.log(`bpm=${bpm} beatsPerBar=${beatsPerBar} runwayBeats=${runway}`);

let authored = 0;
let kept = 0;
let suppressed = 0;

console.log('section  bars      mode      breatherFromBeat  authored  kept  supp');
for (const s of level.sections) {
  const cut = s.breatherFromBeat;
  let a = 0;
  let k = 0;
  for (const p of s.placements) {
    for (const e of p.pattern.events) {
      a += 1;
      const activationBeat =
        (p.startBar - 1) * beatsPerBar + specToRelativeBeats(e.at, beatsPerBar);
      if (cut !== null && activationBeat >= cut) suppressed += 1;
      else k += 1;
    }
  }
  authored += a;
  kept += k;
  console.log(
    `${s.id.padEnd(8)} ${String(s.startBar).padStart(2)}-${String(s.endBar - 1).padEnd(2)}` +
      `     ${s.mode.padEnd(8)} ${String(cut ?? '-').padStart(8)}` +
      `        ${String(a).padStart(4)}  ${String(k).padStart(4)}  ${String(a - k).padStart(4)}`,
  );
}
console.log(`\nauthored=${authored} kept=${kept} suppressed=${suppressed}`);

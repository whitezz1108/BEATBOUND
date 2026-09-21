// TEMPORARY probe -- delete after use.
// 1. Prints the section/mode/spawn picture at each required sync checkpoint bar.
// 2. Re-verifies every kept event against the analyzer's detected beat grid.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { LevelLoader } from '../src/core/LevelLoader';
import { specToRelativeBeats } from '../src/core/TempoMap';
import { DATA } from '../src/config';

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
const BPB = level.song.timeSignature[0];
const SPB = 60 / bpm;
const barTime = (bar: number, beat = 1) => (bar - 1) * BPB * SPB + (beat - 1) * SPB;
const fmt = (t: number) => `${t.toFixed(3)}s`;

// ---- kept events, with bar/beat -------------------------------------------
interface Kept {
  bar: number;
  beat: number;
  time: number;
  sectionId: string;
  mode: string;
  patternId: string;
  mechanicId: string;
}
const kept: Kept[] = [];
const suppressed: Kept[] = [];
for (const s of level.sections) {
  for (const p of s.placements) {
    for (const e of p.pattern.events) {
      const abs =
        (p.startBar - 1) * BPB + specToRelativeBeats(e.at, BPB);
      const bar = Math.floor(abs / BPB) + 1;
      const beat = abs - (bar - 1) * BPB + 1;
      const row: Kept = {
        bar,
        beat,
        time: barTime(bar, beat),
        sectionId: s.id,
        mode: s.mode,
        patternId: p.pattern.id,
        mechanicId: e.mechanicId,
      };
      if (s.breatherFromBeat !== null && abs >= s.breatherFromBeat) suppressed.push(row);
      else kept.push(row);
    }
  }
}
kept.sort((a, b) => a.time - b.time);

// ---- 1. checkpoints --------------------------------------------------------
const CHECKPOINTS = [1, 14, 18, 38, 41, 45, 52, 56, 61, 63, 69, 73, 75];
console.log('=== checkpoint bars ===');
console.log('bar   time      mode      section  what spawns here / nearest kept event');
for (const bar of CHECKPOINTS) {
  const sec = level.sections.find((s) => bar >= s.startBar && bar < s.endBar);
  const t = barTime(bar);
  const here = kept.filter((k) => k.bar === bar);
  const nearest =
    here.length > 0
      ? here
          .map((k) => `${k.bar}.${k.beat} ${k.patternId}/${k.mechanicId}`)
          .join(', ')
      : (() => {
          const n = kept.reduce((best, k) =>
            Math.abs(k.time - t) < Math.abs(best.time - t) ? k : best,
          );
          return `(no spawn) nearest ${n.bar}.${n.beat} ${n.patternId}/${n.mechanicId} @ ${fmt(n.time)} (Δ${(n.time - t).toFixed(3)}s)`;
        })();
  console.log(
    `${String(bar).padStart(3)}  ${fmt(t).padEnd(9)} ${(sec?.mode ?? '?').padEnd(9)} ${(sec?.id ?? '?').padEnd(8)} ${nearest}`,
  );
}

// ---- 2. analyzer beat-grid sync -------------------------------------------
const analysisPath = 'editor/output/toosie_slide/music_analysis_v2.json';
const analysis = JSON.parse(readFileSync(analysisPath, 'utf8')) as {
  durationSec: number;
  bpm: number;
  events: { time: number; type?: string; beatIndex?: number }[];
};
const beats = analysis.events
  .filter((e) => e.type === 'beat' || e.beatIndex !== undefined)
  .map((e) => e.time)
  .sort((a, b) => a - b);

console.log(`\n=== sync (${analysisPath}) ===`);
console.log(`duration=${analysis.durationSec}s bpm=${analysis.bpm} beat events=${beats.length}`);

let maxGridDrift = 0;
for (let i = 0; i < beats.length; i += 1) {
  maxGridDrift = Math.max(maxGridDrift, Math.abs(beats[i] - i * SPB));
}
console.log(`analyzer beats vs ideal 125.6 grid: max drift ${(maxGridDrift * 1000).toFixed(1)} ms`);

let offGrid = 0;
let maxHitDelta = 0;
for (const k of kept) {
  const d = beats.reduce((best, b) => (Math.abs(b - k.time) < Math.abs(best - k.time) ? b : best));
  const delta = Math.abs(d - k.time);
  if (delta > maxHitDelta) maxHitDelta = delta;
  if (delta > 0.030) offGrid += 1;
}
console.log(
  `kept events=${kept.length}  max |hit - nearest analyzer beat| = ${(maxHitDelta * 1000).toFixed(1)} ms  off-grid(>30ms)=${offGrid}`,
);

// half-beat check: every kept event on an integer beat?
const halfBeats = kept.filter((k) => Math.abs(k.beat - Math.round(k.beat)) > 1e-9);
console.log(`kept events off the integer beat: ${halfBeats.length}`);

console.log(`\nsuppressed (${suppressed.length}):`);
for (const s of suppressed) {
  console.log(`  ${s.sectionId} ${s.bar}.${s.beat} ${fmt(s.time)} ${s.patternId}/${s.mechanicId}`);
}

// ---- 3. per-bar density ----------------------------------------------------
console.log('\n=== kept events per bar ===');
const perBar = new Map<number, number>();
for (const k of kept) perBar.set(k.bar, (perBar.get(k.bar) ?? 0) + 1);
const bars = [...perBar.keys()].sort((a, b) => a - b);
console.log(bars.map((b) => `${b}:${perBar.get(b)}`).join(' '));

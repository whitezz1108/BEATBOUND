/**
 * BeatBound — Level 1: "See Tình" — Hoàng Thùy Linh
 *
 * Manually authored beatmap. Sections:
 *   1  original intro/hook (128 BPM)  — 8 bars  — teach the rhythm
 *   2  original build (128 BPM)       — 16 bars — blocks, saws, triple, gate
 *   3  transition runway (128 BPM)    — 8 bars  — breath before the drop
 *   4  fast remix (140 BPM)           — 26 bars — the drop → final climax
 *
 * All timings derive from BPM + speed below. If your audio files differ in
 * tempo, adjust the two BPM values and every obstacle re-aligns.
 *
 * Fairness: placements follow jump-arc spacing laws at this game's physics
 * (jump ≈ 4.6u @ 128bpm, ≈ 5.8u @ 140bpm): consecutive spikes ≥ ~1.2 beats,
 * doubles/triples/gates get extra clearance, nothing lands inside a gap.
 *
 * Audio files (drop them into public/audio/):
 *   /audio/seetinh-original.mp3   ← https://youtu.be/AKChFg7ku2A
 *   /audio/seetinh-remix.mp3      ← https://www.youtube.com/watch?v=bWOA5AxwfsM
 */

import type { LevelDef, ObstacleDef, GapDef } from '../engine/types'

// ── Tuning knobs ──────────────────────────────────────────────
export const SEE_TINH = {
  BPM_ORIGINAL: 128,
  BPM_REMIX: 140,
  SPEED_ORIGINAL: 9.0, // world units / second
  SPEED_REMIX: 11.3,
}

// ── Pattern helpers (beat = hitbox-start space) ───────────────
// Adjacent-spike gap in beats so doubles/triples read as one GD-style cluster
const DB_O = 1 / (SEE_TINH.SPEED_ORIGINAL * (60 / SEE_TINH.BPM_ORIGINAL)) // 0.237
const DB_R = 1 / (SEE_TINH.SPEED_REMIX * (60 / SEE_TINH.BPM_REMIX)) // 0.207
const S = (beat: number): ObstacleDef => ({ beat, kind: 'spike' })
const D = (beat: number, db = DB_O): ObstacleDef[] => [S(beat), S(beat + db)]
const T = (beat: number, db = DB_O): ObstacleDef[] => [
  S(beat),
  S(beat + db),
  S(beat + 2 * db),
]
const BH = (beat: number): ObstacleDef[] => [
  { beat, kind: 'block', h: 1, w: 1 }, // hop onto the block…
  S(beat + 2.7), // …then clear the spike from the top or the ground
]
const SW = (beat: number): ObstacleDef => ({ beat, kind: 'saw' }) // beat = blade center
const P = (beat: number): ObstacleDef => ({ beat, kind: 'pulse' }) // beat = ring center
const GATE = (beat: number): ObstacleDef => ({ beat, kind: 'ceilGate', w: 3 })
const G = (beat: number, beats = 0.6): GapDef => ({ beat, beats })

export const seetinhLevel: LevelDef = {
  id: 'seetinh',
  title: 'See Tình',
  artist: 'Hoàng Thùy Linh',
  audio: {
    original: '/audio/seetinh-original.mp3',
    remix: '/audio/seetinh-remix.mp3',
  },
  leadIn: 1.0,

  sections: [
    /* ════════ 1 · ORIGINAL — intro & hook (bars 0-8, beats 0-32) ════════ */
    {
      name: 'original-intro',
      label: 'SEE TÌNH — ORIGINAL',
      bars: 8,
      bpm: SEE_TINH.BPM_ORIGINAL,
      speed: SEE_TINH.SPEED_ORIGINAL,
      energy: 0.5,
      obstacles: [
        // bars 0-2: safe run-in, the song introduces itself
        S(10),
        S(14),
        // bars 4-7: the hook — one jump every two beats
        S(16),
        S(18),
        S(20),
        S(22),
      ],
      gaps: [G(27.5)],
    },

    /* ════════ 2 · ORIGINAL — build (bars 8-24, local beats 0-64) ════════ */
    {
      name: 'original-build',
      label: 'BUILD UP',
      bars: 16,
      bpm: SEE_TINH.BPM_ORIGINAL,
      speed: SEE_TINH.SPEED_ORIGINAL,
      energy: 0.75,
      obstacles: [
        S(1.5), //            (global beat 33.5)
        ...BH(6.5), //        first block hop
        ...D(13),
        S(25),
        ...D(30.5),
        S(36),
        SW(42.5), //          ground blade
        S(47),
        ...T(53.5), //        the original's triple — climax
        S(59),
        S(71),
        S(73),
        S(75),
      ],
      gaps: [G(18), G(63)],
    },

    /* ════════ 3 · TRANSITION runway (bars 24-32, local beats 0-32) ════════ */
    {
      name: 'original-outro',
      label: 'HERE IT COMES…',
      bars: 8,
      bpm: SEE_TINH.BPM_ORIGINAL,
      speed: SEE_TINH.SPEED_ORIGINAL,
      energy: 1.05,
      obstacles: [
        GATE(16), //          low ceiling — release, run, don't jump
        S(23), //             last original beat
        // beats 24-32: clear runway, riser FX, background ignites
      ],
      gaps: [],
    },

    /* ════════ 4 · FAST REMIX — the drop (26 bars, beats 0-104) ════════ */
    {
      name: 'remix',
      label: 'REMIX — FASTER!',
      bars: 26,
      bpm: SEE_TINH.BPM_REMIX,
      speed: SEE_TINH.SPEED_REMIX,
      energy: 1.25,
      obstacles: [
        // impact + tempo announcement
        S(4),
        S(6),
        // drop A: chains and doubles
        S(8.5),
        S(10),
        S(12),
        ...D(14, DB_R),
        ...D(16, DB_R),
        ...BH(21.5),
        // drop B: 1.5-beat chains
        S(26),
        S(27.5),
        S(29),
        SW(31),
        ...D(33.5, DB_R),
        S(37),
        S(38.5),
        S(40),
        P(42.5), //           pulsing ring — pass when it's dim
        // climax build
        ...D(45.5, DB_R),
        ...D(47.5, DB_R),
        ...T(54.5),
        S(58),
        S(59.5),
        S(61),
        SW(64),
        ...D(67, DB_R),
        // final stand
        S(70.5),
        S(72),
        S(73.5),
        ...D(76.5, DB_R),
        ...BH(83),
        S(87),
        S(88.5),
        S(90),
        ...D(93, DB_R),
        ...T(97, DB_R), //      the last triple
        P(100.5),
        // beats 101.5-104: clear runway → finish portal
      ],
      gaps: [G(18.5), G(51), G(80)],
    },
  ],
}

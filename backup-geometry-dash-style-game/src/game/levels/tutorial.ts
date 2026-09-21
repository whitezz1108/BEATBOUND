/**
 * BeatBound — Tutorial level (~25s).
 * Teaches through play: auto-run → jump → obstacles → rhythm → done.
 * Uses the original section tempo; plays the real song intro if available,
 * otherwise a metronome click (clearly labeled in the UI).
 */

import type { LevelDef, ObstacleDef } from '../engine/types'
import { SEE_TINH } from './seetinh'

const S = (beat: number): ObstacleDef => ({ beat, kind: 'spike' })
// adjacent double (1u apart) at the tutorial's slower speed
const DB_T = 1 / (8.2 * (60 / 128))
const D = (beat: number): ObstacleDef[] => [S(beat), S(beat + DB_T)]

export const tutorialLevel: LevelDef = {
  id: 'tutorial',
  title: 'Tutorial',
  artist: 'BeatBound',
  audio: {
    original: '/audio/seetinh-original.mp3',
    remix: '/audio/seetinh-remix.mp3',
  },
  leadIn: 1.0,
  texts: [
    { beat: 0.5, text: 'Your character runs automatically.' },
    { beat: 8, text: 'Press SPACE or ↑ to jump' },
    { beat: 20, text: 'Time your jumps to avoid obstacles.' },
    { beat: 38, text: 'Listen — the level follows the rhythm.' },
    { beat: 56, text: "You're ready." },
  ],
  sections: [
    {
      name: 'tutorial',
      label: 'TUTORIAL',
      bars: 16, // 64 beats ≈ 30s
      bpm: SEE_TINH.BPM_ORIGINAL,
      speed: 8.2, // a touch slower than the real level
      energy: 0.55,
      obstacles: [
        // step 2: first obvious spike, very generous spacing
        S(12),
        S(16),
        // step 3: simple obstacles, generous gaps
        S(24),
        S(26),
        S(28),
        ...D(31.8),
        S(35),
        // step 4: on-beat rhythm chains
        S(40),
        S(42),
        S(44),
        S(46),
        ...D(49),
        S(53),
        // step 5: clear runway to the finish
      ],
      gaps: [],
    },
  ],
}

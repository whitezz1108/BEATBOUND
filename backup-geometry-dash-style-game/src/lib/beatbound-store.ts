/**
 * BeatBound — client game state (UI mirror of the engine).
 */
import { create } from 'zustand'
import type { GamePhase } from '@/game/engine/types'

export type Screen = 'menu' | 'game'
export type Mode = 'level' | 'tutorial'

interface AudioStatus {
  checked: boolean
  original: boolean
  remix: boolean
}

interface BeatBoundState {
  screen: Screen
  mode: Mode
  phase: GamePhase
  progress: number
  attempt: number
  best: number
  totalAttempts: number
  sectionLabel: string
  sectionFlashKey: number
  deathInfo: { pct: number; isBest: boolean; best: number } | null
  completeInfo: { attempt: number } | null
  tutorialText: string | null
  tutorialDone: boolean
  audio: AudioStatus

  setScreen: (s: Screen) => void
  setMode: (m: Mode) => void
  setPhase: (p: GamePhase) => void
  setAttempt: (n: number) => void
  setBest: (b: number) => void
  setTotalAttempts: (n: number) => void
  setProgress: (pct: number) => void
  setSection: (label: string) => void
  setDeath: (d: BeatBoundState['deathInfo']) => void
  setComplete: (c: BeatBoundState['completeInfo']) => void
  setTutorialText: (t: string | null) => void
  setTutorialDone: (d: boolean) => void
  setAudio: (a: AudioStatus) => void
  resetRun: () => void
}

export const useGameStore = create<BeatBoundState>((set) => ({
  screen: 'menu',
  mode: 'level',
  phase: 'idle',
  progress: 0,
  attempt: 0,
  best: 0,
  totalAttempts: 0,
  sectionLabel: '',
  sectionFlashKey: 0,
  deathInfo: null,
  completeInfo: null,
  tutorialText: null,
  tutorialDone: false,
  audio: { checked: false, original: false, remix: false },

  setScreen: (screen) => set({ screen }),
  setMode: (mode) => set({ mode }),
  setPhase: (phase) => set({ phase }),
  setAttempt: (attempt) => set({ attempt }),
  setBest: (best) => set({ best }),
  setTotalAttempts: (totalAttempts) => set({ totalAttempts }),
  setProgress: (progress) => set({ progress }),
  setSection: (sectionLabel) =>
    set((st) => ({ sectionLabel, sectionFlashKey: st.sectionFlashKey + 1 })),
  setDeath: (deathInfo) => set({ deathInfo }),
  setComplete: (completeInfo) => set({ completeInfo }),
  setTutorialText: (tutorialText) => set({ tutorialText }),
  setTutorialDone: (tutorialDone) => set({ tutorialDone }),
  setAudio: (audio) => set({ audio }),
  resetRun: () =>
    set({
      phase: 'idle',
      progress: 0,
      attempt: 0,
      deathInfo: null,
      completeInfo: null,
      tutorialText: null,
      tutorialDone: false,
      sectionLabel: '',
    }),
}))

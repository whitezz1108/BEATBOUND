'use client'

/**
 * BeatBound — UI overlays (menu, HUD, death / pause / complete screens).
 */

import { AnimatePresence, motion } from 'framer-motion'
import {
  AlertTriangle,
  CheckCircle2,
  Home,
  Music2,
  Pause,
  Play,
  RotateCcw,
  Volume2,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { Mode } from '@/lib/beatbound-store'

interface AudioStatus {
  checked: boolean
  original: boolean
  remix: boolean
}

/* ────────────── main menu ────────────── */

export function MainMenu({
  onPlay,
  onTutorial,
  audio,
}: {
  onPlay: () => void
  onTutorial: () => void
  audio: AudioStatus
}) {
  const ready = audio.checked && audio.original && audio.remix
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center bg-gradient-to-b from-[#0b0710]/85 via-[#0b0710]/60 to-[#0b0710]/90 px-6 text-center">
      <motion.div
        initial={{ opacity: 0, y: 18 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.55, ease: 'easeOut' }}
        className="flex flex-col items-center"
      >
        <h1 className="bb-title bg-gradient-to-r from-[#ff2e7e] via-[#ffb02e] to-[#2ee6a8] bg-clip-text text-5xl font-black tracking-[0.18em] text-transparent sm:text-7xl">
          BEATBOUND
        </h1>
        <p className="mt-2 text-xs tracking-[0.35em] text-white/60 sm:text-sm">
          MUSIC BECOMES THE LEVEL
        </p>

        <div className="mt-7 flex flex-col items-center gap-3 sm:mt-9 sm:flex-row">
          <Button
            size="lg"
            onClick={onPlay}
            className="bb-glow h-12 w-44 rounded-xl bg-[#ff2e7e] text-base font-bold tracking-widest text-white hover:bg-[#ff4b93] sm:h-13 sm:w-52"
          >
            <Play className="mr-1 h-5 w-5 fill-current" /> PLAY
          </Button>
          <Button
            size="lg"
            variant="outline"
            onClick={onTutorial}
            className="h-12 w-44 rounded-xl border-white/25 bg-white/5 text-base font-semibold tracking-widest text-white/90 hover:bg-white/10 hover:text-white sm:h-13 sm:w-52"
          >
            <Music2 className="mr-1 h-5 w-5" /> TUTORIAL
          </Button>
        </div>

        <div className="mt-7 w-full max-w-md rounded-xl border border-white/10 bg-black/35 p-4 backdrop-blur-sm">
          <div className="flex items-center justify-between gap-2">
            <div className="text-left">
              <p className="text-sm font-bold tracking-[0.2em] text-white/90">SEE TÌNH</p>
              <p className="text-[11px] text-white/50">Hoàng Thùy Linh · ORIGINAL → REMIX · ~1:45</p>
            </div>
            {ready ? (
              <span className="flex items-center gap-1 rounded-full border border-[#2ee6a8]/40 bg-[#2ee6a8]/10 px-2.5 py-1 text-[10px] font-semibold text-[#2ee6a8]">
                <CheckCircle2 className="h-3 w-3" /> AUDIO READY
              </span>
            ) : (
              <span className="flex items-center gap-1 rounded-full border border-[#ffb02e]/40 bg-[#ffb02e]/10 px-2.5 py-1 text-[10px] font-semibold text-[#ffb02e]">
                <AlertTriangle className="h-3 w-3" /> TEST MODE
              </span>
            )}
          </div>
          {!ready && audio.checked && (
            <p className="mt-2 text-left text-[10px] leading-relaxed text-white/45">
              The real See Tình audio could not be bundled. Drop{' '}
              <code className="text-[#ffb02e]">seetinh-original.mp3</code> +{' '}
              <code className="text-[#ffb02e]">seetinh-remix.mp3</code> into{' '}
              <code className="text-[#ffb02e]">public/audio/</code> — until then a metronome
              click (not the song) keeps the rhythm playable.
            </p>
          )}
        </div>

        <p className="mt-5 text-[10px] tracking-[0.25em] text-white/35 sm:text-xs">
          SPACE / ↑ / CLICK — JUMP · ESC — PAUSE
        </p>
      </motion.div>
    </div>
  )
}

/* ────────────── HUD ────────────── */

export function GameHud({
  progress,
  attempt,
  sectionLabel,
  sectionFlashKey,
  onPause,
}: {
  progress: number
  attempt: number
  sectionLabel: string
  sectionFlashKey: number
  onPause: () => void
}) {
  return (
    <div className="pointer-events-none absolute inset-x-0 top-0 z-10">
      <div className="flex items-start justify-between p-3 sm:p-4">
        <div className="rounded-lg bg-black/40 px-3 py-1.5 backdrop-blur-sm">
          <p className="text-[9px] tracking-[0.25em] text-white/50">ATTEMPT</p>
          <p className="text-lg font-black leading-none text-white">{attempt}</p>
        </div>

        <div className="mt-1 w-40 sm:w-72">
          <div className="h-2.5 overflow-hidden rounded-full border border-white/15 bg-black/50">
            <div
              className="h-full rounded-full bg-gradient-to-r from-[#ff2e7e] to-[#ffb02e] transition-[width] duration-150"
              style={{ width: `${progress}%` }}
            />
          </div>
          <p className="mt-1 text-center text-[10px] font-bold tracking-widest text-white/70">
            {progress}%
          </p>
        </div>

        <button
          onClick={(e) => {
            e.stopPropagation()
            onPause()
          }}
          onPointerDown={(e) => e.stopPropagation()}
          aria-label="Pause"
          className="pointer-events-auto rounded-lg border border-white/15 bg-black/40 p-2 text-white/80 backdrop-blur-sm transition hover:bg-white/10 hover:text-white"
        >
          <Pause className="h-5 w-5" />
        </button>
      </div>

      <AnimatePresence>
        {sectionLabel && (
          <div key={sectionFlashKey} className="flex justify-center">
            <p className="bb-section-flash rounded-full border border-white/15 bg-black/50 px-5 py-1.5 text-xs font-bold tracking-[0.3em] text-white/90 backdrop-blur-sm sm:text-sm">
              {sectionLabel}
            </p>
          </div>
        )}
      </AnimatePresence>
    </div>
  )
}

/* ────────────── ready ────────────── */

export function ReadyOverlay() {
  return (
    <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
      <p className="bb-ready text-4xl font-black tracking-[0.3em] text-white/90 sm:text-6xl">
        GET READY
      </p>
    </div>
  )
}

/* ────────────── tutorial banner ────────────── */

export function TutorialBanner({ text }: { text: string }) {
  return (
    <div className="pointer-events-none absolute inset-x-0 top-[18%] flex justify-center px-6">
      <AnimatePresence mode="wait">
        <motion.p
          key={text}
          initial={{ opacity: 0, y: -12, scale: 0.96 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 8 }}
          transition={{ duration: 0.3 }}
          className="max-w-lg rounded-xl border border-white/15 bg-black/55 px-5 py-3 text-center text-sm font-semibold text-white/90 backdrop-blur-md sm:text-lg"
        >
          {text}
        </motion.p>
      </AnimatePresence>
    </div>
  )
}

/* ────────────── death ────────────── */

export function DeathOverlay({
  pct,
  isBest,
  best,
  onRetry,
  onMenu,
}: {
  pct: number
  isBest: boolean
  best: number
  onRetry: () => void
  onMenu: () => void
}) {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.25 }}
      className="absolute inset-0 flex flex-col items-center justify-center bg-[#0b0710]/72 backdrop-blur-[2px]"
    >
      <motion.div
        initial={{ scale: 0.9, y: 10 }}
        animate={{ scale: 1, y: 0 }}
        transition={{ delay: 0.12, duration: 0.25 }}
        className="flex flex-col items-center"
      >
        <p className="text-[10px] tracking-[0.4em] text-white/50">CRASHED AT</p>
        <p className="bb-title bg-gradient-to-r from-[#ff2e7e] to-[#ffb02e] bg-clip-text text-7xl font-black text-transparent sm:text-8xl">
          {pct}%
        </p>
        {isBest && (
          <p className="bb-pulse-soft mt-1 text-xs font-bold tracking-[0.3em] text-[#2ee6a8]">
            NEW BEST!
          </p>
        )}
        <p className="mt-2 text-xs text-white/45">BEST {best}%</p>

        <div className="mt-6 flex items-center gap-3">
          <Button
            onClick={onRetry}
            className="bb-glow h-11 w-40 rounded-xl bg-[#ff2e7e] font-bold tracking-widest text-white hover:bg-[#ff4b93]"
          >
            <RotateCcw className="mr-1 h-4 w-4" /> RETRY
          </Button>
          <Button
            variant="outline"
            onClick={onMenu}
            className="h-11 w-32 rounded-xl border-white/25 bg-white/5 font-semibold tracking-widest text-white/80 hover:bg-white/10 hover:text-white"
          >
            <Home className="mr-1 h-4 w-4" /> MENU
          </Button>
        </div>
        <p className="bb-pulse-soft mt-5 text-[11px] tracking-[0.3em] text-white/55">
          SPACE / TAP — INSTANT RETRY
        </p>
      </motion.div>
    </motion.div>
  )
}

/* ────────────── pause ────────────── */

export function PauseOverlay({
  mode,
  onResume,
  onRestart,
  onMenu,
}: {
  mode: Mode
  onResume: () => void
  onRestart: () => void
  onMenu: () => void
}) {
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center bg-[#0b0710]/80 backdrop-blur-sm">
      <p className="text-3xl font-black tracking-[0.35em] text-white/90">PAUSED</p>
      <div className="mt-6 flex flex-col gap-2.5">
        <Button
          onClick={onResume}
          className="bb-glow h-11 w-56 rounded-xl bg-[#ff2e7e] font-bold tracking-widest text-white hover:bg-[#ff4b93]"
        >
          <Play className="mr-1 h-4 w-4 fill-current" /> RESUME
        </Button>
        <Button
          variant="outline"
          onClick={onRestart}
          className="h-11 w-56 rounded-xl border-white/25 bg-white/5 font-semibold tracking-widest text-white/80 hover:bg-white/10 hover:text-white"
        >
          <RotateCcw className="mr-1 h-4 w-4" /> RESTART
        </Button>
        <Button
          variant="ghost"
          onClick={onMenu}
          className="h-11 w-56 rounded-xl font-semibold tracking-widest text-white/60 hover:bg-white/10 hover:text-white"
        >
          <Home className="mr-1 h-4 w-4" /> MENU
        </Button>
      </div>
      <p className="mt-6 text-[10px] tracking-[0.25em] text-white/40">
        {mode === 'tutorial' ? 'TUTORIAL' : 'SEE TÌNH'} · SPACE / ↑ JUMP · ESC RESUME
      </p>
    </div>
  )
}

/* ────────────── complete ────────────── */

export function CompleteOverlay({
  mode,
  attempt,
  onPlayLevel,
  onRetry,
  onMenu,
}: {
  mode: Mode
  attempt: number
  onPlayLevel: () => void
  onRetry: () => void
  onMenu: () => void
}) {
  const tutorial = mode === 'tutorial'
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="absolute inset-0 flex flex-col items-center justify-center bg-[#0b0710]/80 backdrop-blur-sm"
    >
      <motion.div
        initial={{ scale: 0.92, y: 12 }}
        animate={{ scale: 1, y: 0 }}
        transition={{ duration: 0.3 }}
        className="flex flex-col items-center text-center"
      >
        <Volume2 className="mb-3 h-6 w-6 text-[#ffb02e]" />
        <p className="bb-title bg-gradient-to-r from-[#ffb02e] via-[#ff2e7e] to-[#2ee6a8] bg-clip-text text-4xl font-black tracking-[0.12em] text-transparent sm:text-6xl">
          {tutorial ? "YOU'RE READY" : 'LEVEL COMPLETE'}
        </p>
        <p className="mt-3 max-w-sm text-sm leading-relaxed text-white/60">
          {tutorial
            ? 'You run, you jump, the music tells you when. Now play it for real.'
            : `You survived See Tình — original to remix — in ${attempt} ${attempt === 1 ? 'attempt' : 'attempts'}. The music is yours.`}
        </p>
        <div className="mt-7 flex flex-col items-center gap-3 sm:flex-row">
          {tutorial ? (
            <Button
              onClick={onPlayLevel}
              className="bb-glow h-12 w-52 rounded-xl bg-[#ff2e7e] text-base font-bold tracking-widest text-white hover:bg-[#ff4b93]"
            >
              <Play className="mr-1 h-5 w-5 fill-current" /> PLAY SEE TÌNH
            </Button>
          ) : (
            <Button
              onClick={onRetry}
              className="bb-glow h-12 w-44 rounded-xl bg-[#ff2e7e] text-base font-bold tracking-widest text-white hover:bg-[#ff4b93]"
            >
              <RotateCcw className="mr-1 h-5 w-5" /> RETRY
            </Button>
          )}
          <Button
            variant="outline"
            onClick={onMenu}
            className="h-12 w-36 rounded-xl border-white/25 bg-white/5 font-semibold tracking-widest text-white/80 hover:bg-white/10 hover:text-white"
          >
            <Home className="mr-1 h-5 w-5" /> MENU
          </Button>
        </div>
      </motion.div>
    </motion.div>
  )
}

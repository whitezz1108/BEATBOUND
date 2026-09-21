'use client'

/**
 * BeatBound — main app shell: canvas, engine lifecycle, input, overlays.
 */

import { useCallback, useEffect, useRef } from 'react'
import { AudioEngine } from '@/game/engine/audio'
import { GameEngine } from '@/game/engine/GameEngine'
import { buildLevel } from '@/game/levels/patterns'
import { seetinhLevel } from '@/game/levels/seetinh'
import { tutorialLevel } from '@/game/levels/tutorial'
import { useGameStore } from '@/lib/beatbound-store'
import {
  CompleteOverlay,
  DeathOverlay,
  GameHud,
  MainMenu,
  PauseOverlay,
  ReadyOverlay,
  TutorialBanner,
} from './overlays'

export function BeatBoundApp() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const wrapRef = useRef<HTMLDivElement | null>(null)
  const engineRef = useRef<GameEngine | null>(null)
  const audioRef = useRef<AudioEngine | null>(null)

  const screen = useGameStore((s) => s.screen)
  const phase = useGameStore((s) => s.phase)
  const mode = useGameStore((s) => s.mode)
  const progress = useGameStore((s) => s.progress)
  const attempt = useGameStore((s) => s.attempt)
  const sectionLabel = useGameStore((s) => s.sectionLabel)
  const sectionFlashKey = useGameStore((s) => s.sectionFlashKey)
  const deathInfo = useGameStore((s) => s.deathInfo)
  const completeInfo = useGameStore((s) => s.completeInfo)
  const tutorialText = useGameStore((s) => s.tutorialText)
  const tutorialDone = useGameStore((s) => s.tutorialDone)
  const audio = useGameStore((s) => s.audio)

  /* ── engine bootstrap ── */
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const audio = new AudioEngine()
    audioRef.current = audio
    const engine = new GameEngine(canvas, audio, (e) => {
      const st = useGameStore.getState()
      switch (e.type) {
        case 'phase':
          st.setPhase(e.phase)
          break
        case 'attempt':
          st.setAttempt(e.attempt)
          break
        case 'progress':
          st.setProgress(e.pct)
          break
        case 'section':
          st.setSection(e.label)
          break
        case 'death':
          st.setDeath({ pct: e.pct, isBest: e.isBest, best: e.best })
          break
        case 'complete':
          st.setComplete({ attempt: e.attempt })
          break
        case 'text':
          st.setTutorialText(e.text)
          break
        case 'tutorialDone':
          st.setTutorialDone(true)
          break
      }
    })
    engineRef.current = engine
    // debug/verification handle (safe: client-only)
    ;(window as unknown as { __bbEngine?: GameEngine }).__bbEngine = engine
    engine.startAmbient()

    // size canvas to its wrapper
    const wrap = wrapRef.current
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect
        engine.resize(width, height)
        // overlays are authored at 1280×720 and scale proportionally
        wrap?.style.setProperty('--bbscale', String(width / 1280))
      }
    })
    if (wrap) ro.observe(wrap)
    engine.resize(wrap?.offsetWidth ?? 640, wrap?.offsetHeight ?? 360)

    // preload audio in the background + surface status
    void (async () => {
      await audio.ensure()
      await audio.load(seetinhLevel.audio.original, seetinhLevel.audio.remix)
      useGameStore.getState().setAudio({
        checked: true,
        original: audio.hasOriginal,
        remix: audio.hasRemix,
      })
    })()

    return () => {
      ro.disconnect()
      engine.destroy()
      engineRef.current = null
      audioRef.current = null
    }
  }, [])

  /* ── navigation actions ── */
  const startLevel = useCallback((m: 'level' | 'tutorial') => {
    const engine = engineRef.current
    const audio = audioRef.current
    if (!engine || !audio) return
    void audio.ensure().then(() => {
      const def = m === 'level' ? seetinhLevel : tutorialLevel
      engine.loadLevel(buildLevel(def), m)
      const st = useGameStore.getState()
      st.resetRun()
      st.setMode(m)
      st.setScreen('game')
      st.setBest(engine.getBest())
      st.setTotalAttempts(engine.getTotalAttempts())
      engine.start()
    })
  }, [])

  const goMenu = useCallback(() => {
    const engine = engineRef.current
    if (!engine) return
    engine.backToMenu()
    const st = useGameStore.getState()
    st.resetRun()
    st.setScreen('menu')
  }, [])

  /* ── input ── */
  useEffect(() => {
    const st = () => useGameStore.getState()

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.repeat) return
      if (e.code === 'Space' || e.code === 'ArrowUp') {
        e.preventDefault()
        if (st().screen !== 'game') return
        engineRef.current?.press()
      } else if (e.code === 'Escape' || e.code === 'KeyP') {
        if (st().screen !== 'game') return
        engineRef.current?.togglePause()
      }
    }
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code === 'Space' || e.code === 'ArrowUp') {
        engineRef.current?.release()
      }
    }
    const onBlur = () => {
      if (st().screen === 'game') engineRef.current?.pause()
    }
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    window.addEventListener('blur', onBlur)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
      window.removeEventListener('blur', onBlur)
    }
  }, [])

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    e.preventDefault()
    if (useGameStore.getState().screen === 'game') engineRef.current?.press()
  }, [])
  const onPointerUp = useCallback(() => {
    engineRef.current?.release()
  }, [])

  return (
    <div className="flex min-h-dvh flex-col bg-[#0b0710]">
      <main className="flex min-h-0 flex-1 items-center justify-center p-2 sm:p-4">
        <div
          ref={wrapRef}
          className="relative aspect-video w-full overflow-hidden rounded-lg border border-white/10 shadow-[0_0_60px_rgba(255,46,126,0.12)]"
          style={{ maxWidth: 'min(100%, calc((100dvh - 88px) * 16 / 9))' }}
          onPointerDown={onPointerDown}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
        >
          <canvas ref={canvasRef} className="absolute inset-0 h-full w-full touch-none select-none" />

          {screen === 'menu' && (
            <div className="bb-ui-frame">
              <MainMenu
                onPlay={() => startLevel('level')}
                onTutorial={() => startLevel('tutorial')}
                audio={audio}
              />
            </div>
          )}

          {screen === 'game' && (
            <div className="bb-ui-frame">
              <GameHud
                progress={progress}
                attempt={attempt}
                sectionLabel={sectionLabel}
                sectionFlashKey={sectionFlashKey}
                onPause={() => engineRef.current?.togglePause()}
              />
              {tutorialText && !tutorialDone && <TutorialBanner text={tutorialText} />}
              {phase === 'ready' && <ReadyOverlay />}
              {phase === 'dead' && deathInfo && (
                <DeathOverlay
                  pct={deathInfo.pct}
                  isBest={deathInfo.isBest}
                  best={deathInfo.best}
                  onRetry={() => engineRef.current?.retry()}
                  onMenu={goMenu}
                />
              )}
              {phase === 'paused' && (
                <PauseOverlay
                  mode={mode}
                  onResume={() => engineRef.current?.resume()}
                  onRestart={() => {
                    const st = useGameStore.getState()
                    st.resetRun()
                    engineRef.current?.retry()
                  }}
                  onMenu={goMenu}
                />
              )}
              {(phase === 'complete' || tutorialDone) && (
                <CompleteOverlay
                  mode={mode}
                  attempt={completeInfo?.attempt ?? attempt}
                  onPlayLevel={() => startLevel('level')}
                  onRetry={() => {
                    const st = useGameStore.getState()
                    st.resetRun()
                    engineRef.current?.retry()
                  }}
                  onMenu={goMenu}
                />
              )}
            </div>
          )}
        </div>
      </main>

      <footer className="mt-auto border-t border-white/5 px-4 py-2 text-center text-[10px] text-white/40 sm:text-xs">
        <span className="font-semibold tracking-widest text-white/60">BEATBOUND</span>
        <span className="mx-2">·</span>
        <span>Music becomes the level</span>
        <span className="mx-2 hidden sm:inline">·</span>
        <span className="hidden sm:inline">
          Space / ↑ / click to jump — Esc to pause
        </span>
        <span className="mx-2">·</span>
        <span>
          {audio.checked && audio.original && audio.remix
            ? 'See Tình audio ready'
            : 'TEST MODE — add See Tình audio to public/audio/ (see README)'}
        </span>
      </footer>
    </div>
  )
}

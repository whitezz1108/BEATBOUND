/**
 * BeatBound — shared engine types.
 * Level definitions are authored on a musical beat grid and compiled into
 * world-space objects by the level builder (see levels/patterns.ts).
 */

export type ObstacleKind =
  | 'spike'      // full ground spike (1u wide) — jump over
  | 'spikeSmall' // half-height spike — jump over
  | 'block'      // solid box: land on top, die on side/underside
  | 'ceilGate'   // low ceiling with hanging spikes — DO NOT jump under it
  | 'saw'        // half-buried spinning blade — jump over (wider than spike)
  | 'pulse'      // beat-synced pulsing ground ring — jump it while calm
  | 'finish'     // finish portal (not deadly)

/** Authoring-space obstacle: `beat` is section-local (hitbox-start space). */
export interface ObstacleDef {
  beat: number
  kind: ObstacleKind
  /** block height in units (default 1) */
  h?: number
  /** block/gate width in units (default 1 / 3) */
  w?: number
}

/** Authoring-space ground gap. `beat` = left edge, `beats` = width in beats. */
export interface GapDef {
  beat: number
  beats?: number // default 0.6, hard-capped for fairness
}

/** Floating tutorial / section text shown while playing. */
export interface TextDef {
  beat: number
  text: string
}

export interface SectionDef {
  name: string
  label: string
  bars: number // 4/4 bars
  bpm: number
  speed: number // world units / second
  energy: number // visual intensity 0..1.3
  obstacles: ObstacleDef[]
  gaps: GapDef[]
}

export interface LevelDef {
  id: string
  title: string
  artist: string
  audio: { original: string; remix: string }
  leadIn: number // seconds of "get ready" before t=0
  sections: SectionDef[] // sequential; last section defines the end
  texts?: TextDef[]
  onFinishText?: string
}

/* ────────────── Compiled (world-space) structures ────────────── */

export interface Obstacle {
  id: number
  kind: ObstacleKind
  x: number // left edge (world units)
  y: number // bottom edge (0 = ground top)
  w: number // width (world units)
  h: number // height (world units)
  // saw extras
  cx?: number // center x
  cy?: number // center y
  r?: number // deadly radius
  vr?: number // visual radius
}

export interface Gap {
  x: number
  w: number
}

export interface BuiltSection {
  name: string
  label: string
  startTime: number
  endTime: number
  bpm: number
  speed: number
  startX: number
  endX: number
  energy: number
}

export interface BuiltText {
  x: number
  text: string
}

export interface BuiltLevel {
  id: string
  title: string
  artist: string
  audio: { original: string; remix: string }
  leadIn: number
  sections: BuiltSection[]
  obstacles: Obstacle[] // sorted by x
  gaps: Gap[] // sorted by x
  finishX: number
  totalDuration: number
  texts: BuiltText[]
  /** duration of each section's audio (derived from bars/bpm) */
  audioDur: number[]
}

/* ────────────── Engine events → React ────────────── */

export type GameEvent =
  | { type: 'phase'; phase: GamePhase }
  | { type: 'attempt'; attempt: number }
  | { type: 'progress'; pct: number }
  | { type: 'section'; index: number; name: string; label: string }
  | { type: 'death'; pct: number; isBest: boolean; best: number }
  | { type: 'complete'; attempt: number }
  | { type: 'text'; text: string | null }
  | { type: 'tutorialDone' }

export type GamePhase = 'idle' | 'ready' | 'running' | 'dead' | 'complete' | 'paused'

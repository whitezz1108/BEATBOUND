/**
 * BeatBound — level builder.
 *
 * Compiles a LevelDef (authored on musical beat grids) into world-space data:
 *   worldX = sectionStartX + beat * (speed * 60 / bpm)
 *
 * Obstacles are authored in "hitbox-start space": for spikes, the authored
 * beat is where the deadly box begins. This keeps every placement a pure
 * musical decision — the engine never contains song-specific timing.
 */

import type {
  BuiltLevel,
  BuiltSection,
  BuiltText,
  Gap,
  LevelDef,
  Obstacle,
  ObstacleDef,
} from '../engine/types'
import {
  GATE_BAR_H,
  GATE_BAR_Y,
  PULSE_R_MAX,
  SAW_CY,
  SAW_R,
  SAW_VR,
} from '../engine/constants'

let idCounter = 1

function placeObstacle(def: ObstacleDef, startX: number, beatDX: number): Obstacle {
  const x = startX + def.beat * beatDX
  switch (def.kind) {
    case 'spike':
      return { id: idCounter++, kind: 'spike', x: x - 0.3, y: 0, w: 1, h: 1 }
    case 'spikeSmall':
      return { id: idCounter++, kind: 'spikeSmall', x: x - 0.3, y: 0, w: 1, h: 0.5 }
    case 'block':
      return {
        id: idCounter++,
        kind: 'block',
        x,
        y: 0,
        w: def.w ?? 1,
        h: def.h ?? 1,
      }
    case 'ceilGate':
      return {
        id: idCounter++,
        kind: 'ceilGate',
        x,
        y: GATE_BAR_Y,
        w: def.w ?? 3,
        h: GATE_BAR_H,
      }
    case 'saw':
      return {
        id: idCounter++,
        kind: 'saw',
        x: x - SAW_VR,
        y: SAW_CY - SAW_VR,
        w: SAW_VR * 2,
        h: SAW_VR * 2,
        cx: x,
        cy: SAW_CY,
        r: SAW_R,
        vr: SAW_VR,
      }
    case 'pulse':
      return {
        id: idCounter++,
        kind: 'pulse',
        x: x - PULSE_R_MAX,
        y: 0,
        w: PULSE_R_MAX * 2,
        h: PULSE_R_MAX,
        cx: x,
        r: PULSE_R_MAX,
      }
    case 'finish':
      return { id: idCounter++, kind: 'finish', x, y: 0, w: 1.4, h: 3.4 }
  }
}

export function buildLevel(def: LevelDef): BuiltLevel {
  const obstacles: Obstacle[] = []
  const gaps: Gap[] = []
  const sections: BuiltSection[] = []
  const audioDur: number[] = []
  let x = 0
  let t = 0

  for (const s of def.sections) {
    const beatDur = 60 / s.bpm
    const beatDX = s.speed * beatDur
    const startX = x
    const startTime = t
    const lengthBeats = s.bars * 4

    for (const o of s.obstacles) obstacles.push(placeObstacle(o, startX, beatDX))

    for (const g of s.gaps) {
      const w = Math.min(g.beats ?? 0.6, 0.68) * beatDX
      gaps.push({ x: startX + g.beat * beatDX, w })
    }

    x += lengthBeats * beatDX
    t += lengthBeats * beatDur
    audioDur.push(t - startTime)
    sections.push({
      name: s.name,
      label: s.label,
      startTime,
      endTime: t,
      bpm: s.bpm,
      speed: s.speed,
      startX,
      endX: x,
      energy: s.energy,
    })
  }

  obstacles.sort((a, b) => a.x - b.x)
  gaps.sort((a, b) => a.x - b.x)

  const last = sections[sections.length - 1]
  const runout = last.speed * 1.4
  const finishX = last.endX + runout

  // Authoring texts live in section-0 beat space
  const texts: BuiltText[] = (def.texts ?? []).map((tx) => ({
    x: sections[0].startX + tx.beat * (60 / sections[0].bpm) * sections[0].speed,
    text: tx.text,
  }))

  return {
    id: def.id,
    title: def.title,
    artist: def.artist,
    audio: def.audio,
    leadIn: def.leadIn,
    sections,
    obstacles,
    gaps,
    finishX,
    totalDuration: last.endTime + runout / last.speed,
    texts,
    audioDur,
  }
}

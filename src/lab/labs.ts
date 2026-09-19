/**
 * Polish Lab definitions.
 *
 * Each lab is an isolated test: one mode, one mechanic or one pattern family,
 * looping forever at a tunable BPM and intensity. Labs build their level as an
 * in-memory `LevelDefinition` and hand it to the same LevelLoader the JSON
 * levels use, so a lab exercises the real compile/schedule/spawn path rather
 * than a parallel shortcut.
 */

import type { GameMode, LevelDefinition, PatternPlacementSpec, SectionDefinition } from '../core/types';

export type LabGroup = 'ARENA' | 'RUNNER' | 'VERTICAL' | 'RADIAL' | 'GLOBAL';

export interface LabBuildContext {
  bpm: number;
  intensity: number;
  variantIndex: number;
  /** Bars a pattern occupies, from the loaded library. */
  lengthOf(patternId: string): number;
}

export interface LabDefinition {
  id: string;
  index: number;
  group: LabGroup;
  title: string;
  hint: string;
  /** Cycled with [ and ]. */
  variants?: string[];
  /** What the Space key fires. */
  trigger?: { mechanicId: string; params?: Record<string, unknown> };
  /** Null means "not a lab level" -- the full demo entry. */
  build: ((ctx: LabBuildContext) => LevelDefinition) | null;
}

/** Bars of loop before the lab restarts. Long enough not to feel choppy. */
const TARGET_BARS = 32;

/**
 * Build a looping single-mode level from a list of patterns.
 *
 * The section length is computed from the real pattern lengths so the level
 * compiles without gaps or overflow, which keeps lab levels honest against the
 * same empty-bar checks the shipped levels face.
 */
function loop(
  ctx: LabBuildContext,
  id: string,
  title: string,
  mode: GameMode,
  patternIds: string[],
  difficulty = 2,
): LevelDefinition {
  const cycleBars = patternIds.reduce((sum, p) => sum + ctx.lengthOf(p), 0);
  const cycles = cycleBars > 0 ? Math.max(1, Math.round(TARGET_BARS / cycleBars)) : 1;

  const patterns: PatternPlacementSpec[] = patternIds.map((patternId) => ({
    patternId, repeat: cycles, intensity: ctx.intensity,
  }));
  // Repeat each pattern `cycles` times in turn; the section is exactly that long.
  const lengthBars = Math.max(1, cycleBars * cycles);

  const section: SectionDefinition = {
    id: `${id.toUpperCase()}-S1`,
    startBar: 1,
    lengthBars,
    mode,
    function: 'PRACTICE',
    difficulty,
    patterns,
    transitionOut: null,
  };

  return {
    version: '1.0.0',
    song: {
      id: `lab_${id}`,
      title,
      audio: `audio/lab_${id}.mp3`,
      bpm: ctx.bpm,
      timeSignature: [4, 4],
    },
    sections: [section],
  };
}

/** A multi-section lab: each entry becomes its own section, in order. */
function sequence(
  ctx: LabBuildContext,
  id: string,
  title: string,
  mode: GameMode,
  steps: Array<{ patterns: string[]; repeat?: number; intensity?: number; label: string }>,
): LevelDefinition {
  const sections: SectionDefinition[] = [];
  let bar = 1;
  steps.forEach((step, i) => {
    const repeat = step.repeat ?? 1;
    const bars = step.patterns.reduce((sum, p) => sum + ctx.lengthOf(p) * repeat, 0);
    if (bars <= 0) return;
    sections.push({
      id: `${id.toUpperCase()}-${i + 1}-${step.label}`,
      startBar: bar,
      lengthBars: bars,
      mode,
      function: 'PRACTICE',
      difficulty: Math.min(5, 1 + i),
      patterns: step.patterns.map((patternId) => ({
        patternId, repeat, intensity: step.intensity ?? ctx.intensity,
      })),
      transitionOut: null,
    });
    bar += bars;
  });

  return {
    version: '1.0.0',
    song: {
      id: `lab_${id}`, title, audio: `audio/lab_${id}.mp3`,
      bpm: ctx.bpm, timeSignature: [4, 4],
    },
    sections,
  };
}

/** A mode with no hazards at all -- for tuning movement on its own. */
function empty(ctx: LabBuildContext, id: string, title: string, mode: GameMode): LevelDefinition {
  return {
    version: '1.0.0',
    song: { id: `lab_${id}`, title, audio: `audio/lab_${id}.mp3`, bpm: ctx.bpm, timeSignature: [4, 4] },
    sections: [{
      id: `${id.toUpperCase()}-S1`, startBar: 1, lengthBars: TARGET_BARS, mode,
      function: 'TEACH', difficulty: 1, patterns: [], transitionOut: null,
    }],
  };
}

/** Pick from a variant list, wrapping. */
function pick<T>(list: T[], index: number): T {
  return list[((index % list.length) + list.length) % list.length];
}

export const LABS: LabDefinition[] = [
  // ---- ARENA ----------------------------------------------------------
  {
    index: 1, id: 'arena-movement', group: 'ARENA', title: 'Player Movement',
    hint: 'Acceleration, lean, trail. No hazards.',
    build: (c) => empty(c, 'arena-movement', 'Arena Movement', 'ARENA'),
  },
  {
    index: 2, id: 'arena-floor', group: 'ARENA', title: 'Floor Warning',
    hint: 'A01 telegraph, vibration, eruption.',
    variants: ['AP01 checkerboard', 'AP05 safe ground'],
    trigger: { mechanicId: 'A01', params: { layout: 'checker_A' } },
    build: (c) => loop(c, 'arena-floor', 'Floor Warning', 'ARENA', [pick(['AP01', 'AP05'], c.variantIndex)]),
  },
  {
    index: 3, id: 'arena-projectile', group: 'ARENA', title: 'Projectile',
    hint: 'A03 spread vs wall, A04 radial burst.',
    variants: ['AP02 wall volley', 'AP06 radial gap', 'AP08 spiral'],
    trigger: { mechanicId: 'A03', params: { spawnSide: 'LEFT', formation: 'wall', gaps: 2 } },
    build: (c) => loop(c, 'arena-projectile', 'Projectile', 'ARENA', [pick(['AP02', 'AP06', 'AP08'], c.variantIndex)]),
  },
  {
    index: 4, id: 'arena-chain', group: 'ARENA', title: 'Chain',
    hint: 'A05 rattle, whip, links, recoil.',
    variants: ['AP03 four direction', 'AP12 layered'],
    trigger: { mechanicId: 'A05', params: { direction: 'LEFT_TO_RIGHT' } },
    build: (c) => loop(c, 'arena-chain', 'Chain', 'ARENA', [pick(['AP03', 'AP12'], c.variantIndex)]),
  },
  {
    index: 5, id: 'arena-laser', group: 'ARENA', title: 'Laser',
    hint: 'A06 aim, charge, fire, stabilise.',
    variants: ['AP04 cross laser', 'AP07 rotating fan', 'AP11 call and response'],
    trigger: { mechanicId: 'A06', params: { orientation: 'HORIZONTAL', position: 0.5 } },
    build: (c) => loop(c, 'arena-laser', 'Laser', 'ARENA', [pick(['AP04', 'AP07', 'AP11'], c.variantIndex)]),
  },
  {
    index: 6, id: 'arena-patterns', group: 'ARENA', title: 'Pattern Lab',
    hint: 'Cycle every ARENA pattern with [ and ].',
    variants: ['AP01', 'AP02', 'AP03', 'AP04', 'AP05', 'AP06', 'AP07', 'AP08', 'AP09', 'AP10', 'AP11', 'AP12', 'AP13'],
    build: (c) => loop(c, 'arena-patterns', 'Arena Pattern Lab', 'ARENA',
      [pick(['AP01', 'AP02', 'AP03', 'AP04', 'AP05', 'AP06', 'AP07', 'AP08', 'AP09', 'AP10', 'AP11', 'AP12', 'AP13'], c.variantIndex)]),
  },
  {
    index: 7, id: 'arena-combined', group: 'ARENA', title: 'Combined Test',
    hint: 'Radial, fan, spiral, floor+projectile, chain+gap, laser, climax.',
    build: (c) => sequence(c, 'arena-combined', 'Arena Combined', 'ARENA', [
      { patterns: ['AP06'], repeat: 1, intensity: 0.3, label: 'radial' },
      { patterns: ['AP07'], repeat: 2, intensity: 0.4, label: 'fan' },
      { patterns: ['AP08'], repeat: 2, intensity: 0.5, label: 'spiral' },
      { patterns: ['AP12'], repeat: 1, intensity: 0.55, label: 'layered' },
      { patterns: ['AP09'], repeat: 2, intensity: 0.6, label: 'sweep' },
      { patterns: ['AP10'], repeat: 2, intensity: 0.7, label: 'ring' },
      { patterns: ['AP13'], repeat: 1, intensity: 0.85, label: 'climax' },
    ]),
  },

  // ---- RUNNER ---------------------------------------------------------
  {
    index: 8, id: 'runner-basic-jump', group: 'RUNNER', title: 'Basic Jump',
    hint: 'Arc, buffering, coyote time, jump cut.',
    variants: ['RP01 basic', 'RP02 double', 'RP06 gap and slide'],
    trigger: { mechanicId: 'R01', params: {} },
    build: (c) => loop(c, 'runner-basic-jump', 'Runner Basic Jump', 'RUNNER',
      [pick(['RP01', 'RP02', 'RP06'], c.variantIndex)], 1),
  },
  {
    index: 9, id: 'runner-rapid', group: 'RUNNER', title: 'Rapid Sequence',
    hint: 'Beat, half-beat and stair chains.',
    variants: ['RP04 triple chain', 'RP08 half beats', 'RP09 rapid stair', 'RP12 climax'],
    trigger: { mechanicId: 'R01', params: {} },
    build: (c) => loop(c, 'runner-rapid', 'Runner Rapid', 'RUNNER',
      [pick(['RP04', 'RP08', 'RP09', 'RP12'], c.variantIndex)], 4),
  },
  {
    index: 10, id: 'runner-gravity', group: 'RUNNER', title: 'Gravity Flip',
    hint: 'Portal, snap, ceiling running, return.',
    variants: ['RP10 entry', 'RP11 alternation'],
    trigger: { mechanicId: 'R09', params: {} },
    build: (c) => loop(c, 'runner-gravity', 'Runner Gravity', 'RUNNER',
      [pick(['RP10', 'RP11'], c.variantIndex)], 3),
  },
  {
    index: 11, id: 'runner-patterns', group: 'RUNNER', title: 'Obstacle Pattern Lab',
    hint: 'Cycle every RUNNER pattern with [ and ].',
    variants: ['RP01', 'RP02', 'RP03', 'RP04', 'RP05', 'RP06', 'RP07', 'RP08', 'RP09', 'RP10', 'RP11', 'RP12'],
    build: (c) => loop(c, 'runner-patterns', 'Runner Pattern Lab', 'RUNNER',
      [pick(['RP01', 'RP02', 'RP03', 'RP04', 'RP05', 'RP06', 'RP07', 'RP08', 'RP09', 'RP10', 'RP11', 'RP12'], c.variantIndex)]),
  },
  {
    index: 12, id: 'runner-combined', group: 'RUNNER', title: 'Combined Test',
    hint: 'Basic, double, rapid, half-beat, flip, ceiling, return, climax.',
    build: (c) => sequence(c, 'runner-combined', 'Runner Combined', 'RUNNER', [
      { patterns: ['RP01'], repeat: 4, intensity: 0.25, label: 'basic' },
      { patterns: ['RP02'], repeat: 4, intensity: 0.35, label: 'double' },
      { patterns: ['RP04'], repeat: 4, intensity: 0.45, label: 'rapid' },
      { patterns: ['RP08'], repeat: 4, intensity: 0.55, label: 'halfbeat' },
      { patterns: ['RP10'], repeat: 2, intensity: 0.5, label: 'flip' },
      { patterns: ['RP11'], repeat: 1, intensity: 0.6, label: 'ceiling' },
      { patterns: ['RP12'], repeat: 2, intensity: 0.8, label: 'climax' },
    ]),
  },

  // ---- VERTICAL -------------------------------------------------------
  {
    index: 13, id: 'vertical-tap', group: 'VERTICAL', title: 'Tap',
    hint: 'Judgement windows, lane response.',
    variants: ['VP01 stair', 'VP03 alternating', 'VP04 doubles'],
    trigger: { mechanicId: 'V01', params: { lane: 1 } },
    build: (c) => loop(c, 'vertical-tap', 'Vertical Tap', 'VERTICAL',
      [pick(['VP01', 'VP03', 'VP04'], c.variantIndex)], 1),
  },
  {
    index: 14, id: 'vertical-hold', group: 'VERTICAL', title: 'Hold',
    hint: 'Head, body energy, tail completion.',
    variants: ['VP02 sustain', 'VP05 taps into hold', 'VP08 hold plus taps'],
    trigger: { mechanicId: 'V02', params: { lane: 2, holdBeats: 3 } },
    build: (c) => loop(c, 'vertical-hold', 'Vertical Hold', 'VERTICAL',
      [pick(['VP02', 'VP05', 'VP08'], c.variantIndex)], 2),
  },
  {
    index: 15, id: 'vertical-drift', group: 'VERTICAL', title: 'Drift Hold',
    hint: 'Lane path, checkpoints, drift tolerance.',
    variants: ['VP06 drift up', 'VP07 drift zigzag'],
    trigger: { mechanicId: 'V04', params: { path: [[0, 1], [2, 2], [4, 3], [6, 4]], holdBeats: 6 } },
    build: (c) => loop(c, 'vertical-drift', 'Vertical Drift', 'VERTICAL',
      [pick(['VP06', 'VP07'], c.variantIndex)], 3),
  },
  {
    index: 16, id: 'vertical-patterns', group: 'VERTICAL', title: 'Pattern Lab',
    hint: 'Cycle every VERTICAL pattern with [ and ].',
    variants: ['VP01', 'VP02', 'VP03', 'VP04', 'VP05', 'VP06', 'VP07', 'VP08', 'VP09'],
    build: (c) => loop(c, 'vertical-patterns', 'Vertical Pattern Lab', 'VERTICAL',
      [pick(['VP01', 'VP02', 'VP03', 'VP04', 'VP05', 'VP06', 'VP07', 'VP08', 'VP09'], c.variantIndex)]),
  },
  {
    index: 17, id: 'vertical-combined', group: 'VERTICAL', title: 'Combined Test',
    hint: 'Tap, hold, tap+hold, drift, drift+taps, climax.',
    build: (c) => sequence(c, 'vertical-combined', 'Vertical Combined', 'VERTICAL', [
      { patterns: ['VP01'], repeat: 4, intensity: 0.25, label: 'tap' },
      { patterns: ['VP02'], repeat: 2, intensity: 0.3, label: 'hold' },
      { patterns: ['VP05'], repeat: 2, intensity: 0.4, label: 'taphold' },
      { patterns: ['VP06'], repeat: 2, intensity: 0.5, label: 'drift' },
      { patterns: ['VP08'], repeat: 2, intensity: 0.6, label: 'driftteaps' },
      { patterns: ['VP09'], repeat: 1, intensity: 0.8, label: 'climax' },
    ]),
  },

  // ---- RADIAL ---------------------------------------------------------
  {
    index: 18, id: 'radial-8dir-input', group: 'RADIAL', title: '8-Direction Input',
    hint: 'Cardinals, diagonals, then mixed. Diagonals are two keys.',
    variants: ['DP01 cardinals', 'DP03 diagonals', 'DP07 mixed'],
    trigger: { mechanicId: 'D01', params: { direction: 'NE' } },
    build: (c) => loop(c, 'radial-8dir-input', 'Radial 8-Direction Input', 'RADIAL',
      [pick(['DP01', 'DP03', 'DP07'], c.variantIndex)], 2),
  },
  {
    index: 19, id: 'radial-8dir-patterns', group: 'RADIAL', title: '8-Direction Patterns',
    hint: 'Clockwise, counterclockwise, pairs, spiral, star.',
    variants: ['DP04 clockwise 8', 'DP05 counterclockwise 8', 'DP08 diagonal pairs', 'DP09 spiral 8', 'DP10 star'],
    build: (c) => loop(c, 'radial-8dir-patterns', 'Radial 8-Direction Patterns', 'RADIAL',
      [pick(['DP04', 'DP05', 'DP08', 'DP09', 'DP10'], c.variantIndex)], 3),
  },
  {
    index: 20, id: 'radial-combined', group: 'RADIAL', title: 'Combined Test',
    hint: 'Cardinals, diagonals, CW 8, CCW 8, pairs, spiral, climax.',
    build: (c) => sequence(c, 'radial-combined', 'Radial Combined', 'RADIAL', [
      { patterns: ['DP01'], repeat: 4, intensity: 0.25, label: 'cardinal' },
      { patterns: ['DP03'], repeat: 4, intensity: 0.35, label: 'diagonal' },
      { patterns: ['DP04'], repeat: 2, intensity: 0.45, label: 'cw8' },
      { patterns: ['DP05'], repeat: 2, intensity: 0.5, label: 'ccw8' },
      { patterns: ['DP08'], repeat: 4, intensity: 0.6, label: 'pairs' },
      { patterns: ['DP09'], repeat: 4, intensity: 0.7, label: 'spiral' },
      { patterns: ['DP11'], repeat: 2, intensity: 0.85, label: 'climax' },
    ]),
  },

  // ---- GLOBAL ---------------------------------------------------------
  {
    index: 21, id: 'camera-beat-fx', group: 'GLOBAL', title: 'Camera and Beat FX',
    hint: 'Beat pulse, downbeat pulse, ambient energy. Compare with , and .',
    build: (c) => loop(c, 'camera-beat-fx', 'Camera and Beat FX', 'ARENA', ['AP01'], 1),
  },
  {
    index: 22, id: 'hit-perfect-feedback', group: 'GLOBAL', title: 'Hit and Perfect Feedback',
    hint: 'Graze a chain for PERFECT; take one for the hit-stop.',
    variants: ['AP03 chains', 'AP10 ring collapse'],
    build: (c) => loop(c, 'hit-perfect-feedback', 'Hit and Perfect Feedback', 'ARENA',
      [pick(['AP03', 'AP10'], c.variantIndex)], 3),
  },
  {
    index: 23, id: 'full-demo', group: 'GLOBAL', title: 'Full Demo',
    hint: 'The complete multi-mode song. Not a lab.',
    build: null,
  },
];

export function findLab(id: string | null): LabDefinition | null {
  if (!id) return null;
  return LABS.find((l) => l.id === id) ?? null;
}

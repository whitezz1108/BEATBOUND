/**
 * Key bindings, single source of truth.
 *
 * Modes import the exact key lists they read, and the count-in / mode-change
 * UI imports the same lists to print them, so a binding change here updates
 * gameplay and on-screen hints together. The UI never hardcodes its own copy.
 *
 * RADIAL reuses `CARDINAL_KEYS` from direction8.ts, which already names the
 * arrows + WASD mapping the radial mode reads.
 */

import type { GameMode } from './types';

/** ARENA movement: axis keys, shared with Input.axis(). */
export const ARENA_MOVE_KEYS = {
  up: ['w', 'arrowup'],
  down: ['s', 'arrowdown'],
  left: ['a', 'arrowleft'],
  right: ['d', 'arrowright'],
} as const;

export const RUNNER_JUMP_KEYS: readonly string[] = ['w', 'arrowup', ' '];
export const RUNNER_SLIDE_KEYS: readonly string[] = ['s', 'arrowdown'];
/** RUNNER manual gravity flip (GD-ball style): invert your side of the field. */
export const RUNNER_FLIP_KEYS: readonly string[] = ['shift', 'f'];

/** VERTICAL lanes 1-6: left hand A S D, right hand J K L. */
export const VERTICAL_LANE_KEYS: readonly (readonly string[])[] = [
  ['a'],
  ['s'],
  ['d'],
  ['j'],
  ['k'],
  ['l'],
];

export interface ControlHint {
  /** What the keys do. */
  label: string;
  /** Display form of the keys, e.g. ['W','A','S','D']. */
  keys: string[];
}

/** Per-mode control summaries, for the count-in and transition UI. */
export const MODE_CONTROLS: Record<GameMode, ControlHint[]> = {
  ARENA: [
    { label: 'MOVE', keys: ['W', 'A', 'S', 'D'] },
    { label: 'or', keys: ['↑', '←', '↓', '→'] },
  ],
  RUNNER: [
    { label: 'JUMP', keys: ['W', '↑', 'SPACE'] },
    { label: 'SLIDE', keys: ['S', '↓'] },
  ],
  VERTICAL: [{ label: 'LANES', keys: ['A', 'S', 'D', '·', 'J', 'K', 'L'] }],
  RADIAL: [
    { label: 'DIRECT', keys: ['↑', '←', '↓', '→'] },
    { label: 'or', keys: ['W', 'A', 'S', 'D'] },
  ],
  DUO: [],
};

/** One display line like "JUMP  [W][↑][SPACE]" for a mode's hints. */
export function controlLines(mode: GameMode): string[] {
  return MODE_CONTROLS[mode].map((hint) => `${hint.label}  ${hint.keys.join(' ')}`);
}

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

/** An axis binding: which keys push which way. Read by Input.axisFrom(). */
export interface AxisKeys {
  up: readonly string[];
  down: readonly string[];
  left: readonly string[];
  right: readonly string[];
}

/** ARENA movement: axis keys, shared with Input.axis(). */
export const ARENA_MOVE_KEYS: AxisKeys = {
  up: ['w', 'arrowup'],
  down: ['s', 'arrowdown'],
  left: ['a', 'arrowleft'],
  right: ['d', 'arrowright'],
};

/**
 * ARENA movement while a rhythm encounter (A12) owns the directional keys.
 *
 * The encounter reads *both* key families as the phrase -- it is a dance pad,
 * and the player uses whichever hand position they prefer -- so for its length
 * there is nothing left to steer with. That is deliberate: the seal has no
 * gap, so no position is safer than another and walking has no answer to give.
 * The mode picks this map per frame rather than latching anything, which is
 * what makes the restore automatic when the encounter ends.
 */
export const ARENA_MOVE_KEYS_CAPTURED: AxisKeys = {
  up: [],
  down: [],
  left: [],
  right: [],
};

/**
 * The directional phrase alphabet: arrows *and* WASD, each meaning its
 * cardinal. Both families press the same step, so the phrase can be played
 * with either hand layout or a mix of the two.
 */
export const ARENA_SEQUENCE_KEYS: Record<'N' | 'E' | 'S' | 'W', readonly string[]> = {
  N: ['arrowup', 'w'],
  E: ['arrowright', 'd'],
  S: ['arrowdown', 's'],
  W: ['arrowleft', 'a'],
};

/** The final accent of a rhythm encounter. ARENA binds nothing else to Space. */
export const ARENA_CONFIRM_KEYS: readonly string[] = [' '];

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
    { label: 'SEAL', keys: ['WASD/↑←↓→', '+', 'SPACE'] },
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

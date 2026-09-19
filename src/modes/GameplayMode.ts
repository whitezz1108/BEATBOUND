/**
 * What a BeatBound game mode is.
 *
 * ARENA implements this today; RUNNER, VERTICAL, RADIAL and DUO implement the
 * same interface later. ModeManager only ever talks to this surface, which is
 * what keeps mode-specific logic out of every other system.
 */

import type { BeatClock } from '../core/BeatClock';
import type { Input } from '../core/Input';
import type { MechanicUpdate } from '../core/Mechanic';
import type { Renderer } from '../core/Renderer';
import type { RunStatus } from '../core/RunStatus';
import type { SpawnedMechanicInfo } from '../core/PatternScheduler';
import type { GameMode } from '../core/types';
import type { FeelSink } from '../feel/FeelSink';

export interface ModeContext {
  clock: BeatClock;
  input: Input;
  status: RunStatus;
  feel: FeelSink;
}

export interface GameplayMode {
  readonly mode: GameMode;
  /** Called when this mode becomes the active environment. */
  activate(atBeat: number): void;
  /** Called when the mode is swapped out. Should drop its mechanics. */
  deactivate(atBeat: number): void;
  /** Receive a mechanic created by PatternScheduler. */
  accept(info: SpawnedMechanicInfo): void;
  update(u: MechanicUpdate): void;
  render(r: Renderer): void;
  readonly activeMechanicCount: number;
  /** Short HUD string describing mode state. */
  readonly statusLine: string;
}

export type ModeFactory = (ctx: ModeContext) => GameplayMode;

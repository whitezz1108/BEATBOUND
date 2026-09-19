/**
 * Stand-in for a mode that has data but no runtime yet (RUNNER / VERTICAL /
 * RADIAL / DUO today). Keeps a multi-mode level playable end to end while those
 * modes are built, and makes the gap visible rather than silent.
 */

import type { MechanicUpdate } from '../core/Mechanic';
import type { Renderer } from '../core/Renderer';
import type { SpawnedMechanicInfo } from '../core/PatternScheduler';
import type { GameMode } from '../core/types';
import type { GameplayMode } from './GameplayMode';

export class PlaceholderMode implements GameplayMode {
  private skipped = 0;

  constructor(readonly mode: GameMode) {}

  activate(): void { this.skipped = 0; }
  deactivate(): void {}

  clearHazards(): void {}

  accept(_info: SpawnedMechanicInfo): void { this.skipped += 1; }

  update(_u: MechanicUpdate): void {}

  render(r: Renderer): void {
    r.fillRect({ x: 0, y: 0, w: 1, h: 1 }, '#0c1018');
    r.strokeRect({ x: 0.02, y: 0.02, w: 0.96, h: 0.96 }, '#2a3550', 2, 1, [8, 8]);
    r.text(`${this.mode} MODE`, 0.5, 0.45, '#5f6f95', 26);
    r.text('not implemented yet', 0.5, 0.53, '#3f4b6b', 15);
    r.text(`${this.skipped} event(s) skipped`, 0.5, 0.59, '#3f4b6b', 12);
  }

  get activeMechanicCount(): number { return 0; }
  get statusLine(): string { return `${this.mode}: placeholder (${this.skipped} skipped)`; }
}

/**
 * Phase 5 -- ModeManager.
 *
 * Owns which gameplay environment is live and is the only place a mode swap
 * happens. Modes are registered by id, so no other system contains a
 * `if (mode === 'ARENA')` branch.
 *
 * Mode changes are requested in *musical* time through BeatClock, so a section
 * boundary lands on a bar line rather than whenever a frame happens to run.
 */

import type { BeatClock } from './BeatClock';
import type { MechanicUpdate } from './Mechanic';
import type { Renderer } from './Renderer';
import type { SpawnedMechanicInfo } from './PatternScheduler';
import type { GameMode } from './types';
import type { GameplayMode, ModeContext, ModeFactory } from '../modes/GameplayMode';
import { PlaceholderMode } from '../modes/PlaceholderMode';

interface TransitionState {
  id: string;
  from: GameMode | null;
  to: GameMode;
  startBeat: number;
  lengthBeats: number;
}

export class ModeManager {
  private readonly factories = new Map<GameMode, ModeFactory>();
  private readonly instances = new Map<GameMode, GameplayMode>();
  private current: GameplayMode | null = null;
  private transition: TransitionState | null = null;
  /** Mechanics that arrived for a mode that was not live. Surfaced in the HUD. */
  private droppedSpawns = 0;

  constructor(
    private readonly clock: BeatClock,
    private readonly context: ModeContext,
    /** How long a mode transition animates, in beats. */
    private readonly transitionBeats = 1,
  ) {}

  register(mode: GameMode, factory: ModeFactory): void {
    this.factories.set(mode, factory);
  }

  isImplemented(mode: GameMode): boolean {
    return this.factories.has(mode);
  }

  get activeMode(): GameplayMode | null {
    return this.current;
  }

  get activeModeId(): GameMode | null {
    return this.current?.mode ?? null;
  }

  get droppedSpawnCount(): number {
    return this.droppedSpawns;
  }

  get isTransitioning(): boolean {
    return this.transition !== null;
  }

  /** Switch modes at a future musical position (e.g. a section's first bar). */
  scheduleMode(mode: GameMode, atBeat: number, transitionId: string | null = null): void {
    this.clock.scheduleAtBeat(atBeat, (firedBeat) => this.setMode(mode, firedBeat, transitionId), `mode:${mode}`);
  }

  setMode(mode: GameMode, atBeat: number, transitionId: string | null = null): void {
    if (this.current?.mode === mode) return;
    const previous = this.current?.mode ?? null;
    this.current?.deactivate(atBeat);

    const next = this.instanceFor(mode);
    next.activate(atBeat);
    this.current = next;
    this.transition = {
      id: transitionId ?? `${previous ?? 'NONE'}_TO_${mode}`,
      from: previous,
      to: mode,
      startBeat: atBeat,
      lengthBeats: this.transitionBeats,
    };
  }

  /**
   * PatternScheduler sink. Routes purely on the mechanic's declared mode --
   * ModeManager never inspects mechanic ids or params.
   */
  route = (info: SpawnedMechanicInfo): void => {
    if (!this.current || this.current.mode !== info.mode) {
      this.droppedSpawns += 1;
      return;
    }
    this.current.accept(info);
  };

  update(u: MechanicUpdate): void {
    if (this.transition && u.beat >= this.transition.startBeat + this.transition.lengthBeats) {
      this.transition = null;
    }
    this.current?.update(u);
  }

  render(r: Renderer): void {
    this.current?.render(r);
    this.renderTransition(r);
  }

  /** Placeholder wipe. Real per-mode transition animations slot in here. */
  private renderTransition(r: Renderer): void {
    const t = this.transition;
    if (!t) return;
    const progress = Math.min(1, Math.max(0, (this.clock.absoluteBeat - t.startBeat) / t.lengthBeats));
    r.fillRect({ x: 0, y: 0, w: 1, h: 1 }, '#05070d', 1 - progress);
    r.text(t.id.replace(/_/g, ' '), 0.5, 0.5, '#e8ecf8', 20, 'center', 1 - progress);
  }

  private instanceFor(mode: GameMode): GameplayMode {
    const existing = this.instances.get(mode);
    if (existing) return existing;
    const factory = this.factories.get(mode);
    // Unimplemented modes still "run": the level keeps playing and the screen
    // says which mode is missing, instead of the run dying at a section change.
    const instance = factory ? factory(this.context) : new PlaceholderMode(mode);
    this.instances.set(mode, instance);
    return instance;
  }
}

/**
 * Phase 2 -- MechanicRegistry.
 *
 * Maps a mechanic id from JSON ("A01", "A03", "A05", ...) onto a runtime
 * implementation, and owns parameter/timing resolution:
 *
 *   mechanics.mvp.json defaults  +  pattern event params  +  section intensity
 *      -> MechanicSpawnContext -> new RuntimeMechanic
 *
 * Adding a mechanic is one `register()` call. PatternScheduler never changes,
 * and never learns what any mechanic does.
 */

import type { BeatClock } from './BeatClock';
import type { MechanicSpawnContext, ResolvedTiming, RuntimeMechanic } from './Mechanic';
import { scaleTelegraphBeats } from './Intensity';
import type { EventRole, GameMode, MechanicDefinition, MechanicLibrary, ParamBag, PatternConstraints } from './types';

export type MechanicFactory = (ctx: MechanicSpawnContext) => RuntimeMechanic;

/** What PatternScheduler hands the registry. Contains no mechanic-specific logic. */
export interface SpawnRequest {
  mechanicId: string;
  /** Absolute beat at which the mechanic becomes dangerous. */
  activationBeat: number;
  params?: ParamBag;
  intensity: number;
  role: EventRole;
  /** Deterministic per-event seed. */
  seed: number;
  /** Pattern constraints that clamp intensity scaling. */
  constraints?: PatternConstraints;
}

export class MechanicRegistry {
  private readonly definitions = new Map<string, MechanicDefinition>();
  private readonly factories = new Map<string, MechanicFactory>();
  private readonly missingWarned = new Set<string>();

  /** Load mechanic *data*. Implementations are registered separately. */
  loadLibrary(library: MechanicLibrary): void {
    for (const def of library.mechanics) this.definitions.set(def.id, def);
  }

  /** Bind a mechanic id to its runtime implementation. */
  register(id: string, factory: MechanicFactory): void {
    if (!this.definitions.has(id)) {
      console.warn(`[MechanicRegistry] registering "${id}" with no definition in the mechanic library`);
    }
    this.factories.set(id, factory);
  }

  getDefinition(id: string): MechanicDefinition | undefined {
    return this.definitions.get(id);
  }

  hasImplementation(id: string): boolean {
    return this.factories.has(id);
  }

  /** Ids that have data but no runtime yet -- surfaced by LevelLoader validation. */
  unimplementedIn(mode?: GameMode): string[] {
    const out: string[] = [];
    for (const [id, def] of this.definitions) {
      if (mode && def.mode !== mode) continue;
      if (!this.factories.has(id)) out.push(id);
    }
    return out.sort();
  }

  /**
   * Build a runtime mechanic. Returns null (with one warning per id) when the
   * mechanic has data but no implementation, so a level containing future
   * mechanics still plays everything it can.
   */
  create(request: SpawnRequest, clock: BeatClock): RuntimeMechanic | null {
    const definition = this.definitions.get(request.mechanicId);
    const factory = this.factories.get(request.mechanicId);
    if (!definition || !factory) {
      if (!this.missingWarned.has(request.mechanicId)) {
        this.missingWarned.add(request.mechanicId);
        console.warn(
          `[MechanicRegistry] no ${definition ? 'implementation' : 'definition'} for "${request.mechanicId}" -- skipping its events`,
        );
      }
      return null;
    }

    return factory({
      definition,
      // Event params override library defaults; neither is mutated.
      params: { ...definition.defaults, ...(request.params ?? {}) },
      timing: this.resolveTiming(definition, request),
      activationBeat: request.activationBeat,
      intensity: request.intensity,
      role: request.role,
      seed: request.seed,
      clock,
    });
  }

  private resolveTiming(definition: MechanicDefinition, request: SpawnRequest): ResolvedTiming {
    const base = definition.timing;
    // Event params may override library timing directly (authoring escape hatch).
    const p = request.params ?? {};
    const telegraphBase = numberParam(p.telegraphBeats, base.telegraphBeats);
    return {
      telegraphBeats: scaleTelegraphBeats(
        telegraphBase,
        request.intensity,
        request.constraints?.minReactionBeats,
      ),
      durationBeats: numberParam(p.durationBeats, base.durationBeats),
      recoveryBeats: numberParam(p.cooldownBeats, base.cooldownBeats ?? 0),
    };
  }
}

function numberParam(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

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
import { tierForDifficulty } from '../mechanics/arena/arenaTiming';
import type { EventRole, GameMode, MechanicDefinition, MechanicLibrary, ParamBag, PatternConstraints } from './types';
import { NULL_FEEL, type FeelSink } from '../feel/FeelSink';

export type MechanicFactory = (ctx: MechanicSpawnContext) => RuntimeMechanic;

export interface MechanicRegistration {
  /**
   * Extra beats of lead the *implementation* needs before its activation beat,
   * beyond the library's `telegraphBeats`.
   *
   * RUNNER obstacles are the reason this exists: their library telegraph is 0
   * because the warning is spatial -- the obstacle scrolling in from the right
   * edge -- so the runtime must exist well before it is due at the player.
   */
  spawnLeadBeats?: number;
}

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
  /** Section difficulty, 1-5. Selects the readability tier. */
  difficulty?: number;
}

export class MechanicRegistry {
  private readonly definitions = new Map<string, MechanicDefinition>();
  private readonly factories = new Map<string, MechanicFactory>();
  private readonly registrations = new Map<string, MechanicRegistration>();
  private readonly missingWarned = new Set<string>();
  /** No-op until the game hands over a real one; the headless tools never do. */
  private feel: FeelSink = NULL_FEEL;

  useFeel(feel: FeelSink): void {
    this.feel = feel;
  }

  /** Load mechanic *data*. Implementations are registered separately. */
  loadLibrary(library: MechanicLibrary): void {
    for (const def of library.mechanics) this.definitions.set(def.id, def);
  }

  /** Bind a mechanic id to its runtime implementation. */
  register(id: string, factory: MechanicFactory, registration: MechanicRegistration = {}): void {
    if (!this.definitions.has(id)) {
      console.warn(`[MechanicRegistry] registering "${id}" with no definition in the mechanic library`);
    }
    this.factories.set(id, factory);
    this.registrations.set(id, registration);
  }

  /**
   * How far ahead of its activation beat a mechanic must be created. The
   * scheduler asks this instead of reading `telegraphBeats` directly, so a mode
   * can need more lead than the data declares without the scheduler knowing why.
   *
   * Three sources, in increasing order of specificity, and the largest wins:
   * the library's temporal telegraph, the library's `spawnLeadBeats` (the
   * spatial scroll-in a mechanic needs instead of a telegraph), and the
   * runtime registration's own override.
   */
  spawnLeadBeats(id: string): number {
    const timing = this.definitions.get(id)?.timing;
    return Math.max(
      timing?.telegraphBeats ?? 0,
      timing?.spawnLeadBeats ?? 0,
      this.registrations.get(id)?.spawnLeadBeats ?? 0,
    );
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
      feel: this.feel,
      tier: tierForDifficulty(request.difficulty),
    });
  }

  private resolveTiming(definition: MechanicDefinition, request: SpawnRequest): ResolvedTiming {
    const base = definition.timing;
    // Event params may override library timing directly (authoring escape hatch).
    const p = request.params ?? {};
    const telegraphBase = numberParam(p.telegraphBeats, base.telegraphBeats);
    // Easier tiers buy the player more warning; harder ones spend some of it.
    const tier = tierForDifficulty(request.difficulty);
    return {
      telegraphBeats: scaleTelegraphBeats(
        telegraphBase * (telegraphBase > 0 ? tier.telegraphScale : 1),
        request.intensity,
        request.constraints?.minReactionBeats,
      ),
      durationBeats: numberParam(p.durationBeats, base.durationBeats),
      recoveryBeats: numberParam(p.cooldownBeats, base.cooldownBeats ?? 0),
    };
  }

  /**
   * A spawn context for a mechanic that has no JSON definition.
   *
   * RUNNER courses are the reason this exists. A course is not a hazard at a
   * beat, so it has no library entry, no telegraph and no intensity-scaled
   * timing -- it *is* the level for the stretch it covers. But it still needs
   * the same `feel` sink and readability tier every other mechanic gets, and
   * those live here, so the context is assembled here rather than at the call
   * site. The registry never learns what a course is: it just hands out the
   * same shape of context it hands out for everything else.
   */
  syntheticContext(
    id: string,
    clock: BeatClock,
    options: {
      activationBeat: number;
      mode: GameMode;
      name?: string;
      intensity?: number;
      difficulty?: number;
      durationBeats?: number;
      params?: ParamBag;
      role?: EventRole;
      seed?: number;
    },
  ): MechanicSpawnContext {
    const definition: MechanicDefinition = {
      id,
      name: options.name ?? id,
      mode: options.mode,
      status: 'MVP',
      difficulty: options.difficulty ?? 2,
      // No telegraph: a course is visible from the moment its first slab
      // scrolls in, which is the same spatial warning every RUNNER obstacle
      // uses. There is nothing to warn about earlier than that.
      timing: { durationBeats: options.durationBeats ?? 1, telegraphBeats: 0 },
      defaults: {},
    };
    return {
      definition,
      params: options.params ?? {},
      timing: { telegraphBeats: 0, durationBeats: options.durationBeats ?? 1, recoveryBeats: 0 },
      activationBeat: options.activationBeat,
      intensity: options.intensity ?? 0.5,
      role: options.role ?? 'SYSTEM',
      seed: options.seed ?? 0,
      clock,
      feel: this.feel,
      tier: tierForDifficulty(options.difficulty),
    };
  }
}

function numberParam(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

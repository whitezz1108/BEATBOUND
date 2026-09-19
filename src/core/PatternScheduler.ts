/**
 * Phase 3 -- PatternScheduler.
 *
 * Turns pattern events into BeatClock callbacks:
 *
 *   pattern event { at: { bar, beat }, mechanicId }
 *     + placement start bar
 *     -> absolute activation beat
 *     -> spawn scheduled at (activation - telegraph)
 *     -> MechanicRegistry.create(...)
 *     -> handed to whoever is listening (ModeManager -> active mode)
 *
 * Deliberately knows nothing about any individual mechanic. It never inspects
 * `params`, never branches on a mechanic id, and never draws anything. Adding
 * A06 or R01 later requires no edit to this file.
 */

import type { BeatClock } from './BeatClock';
import type { CompiledLevel, CompiledPlacement, CompiledSection } from './LevelLoader';
import type { RuntimeMechanic } from './Mechanic';
import type { MechanicRegistry } from './MechanicRegistry';
import { specToRelativeBeats } from './TempoMap';
import type { EventRole, GameMode, MechanicDefinition, PatternEvent } from './types';

/** Context handed out with every spawned mechanic. */
export interface SpawnedMechanicInfo {
  mechanic: RuntimeMechanic;
  definition: MechanicDefinition;
  /** Mode the mechanic belongs to -- the receiver routes on this, not on id. */
  mode: GameMode;
  sectionId: string;
  patternId: string;
  activationBeat: number;
  role: EventRole;
  /** The pattern event this came from -- useful for debug HUDs and replay tools. */
  event: PatternEvent;
}

export type MechanicSink = (info: SpawnedMechanicInfo) => void;

export class PatternScheduler {
  private sinks = new Set<MechanicSink>();
  private scheduled = 0;
  private spawned = 0;

  constructor(
    private readonly clock: BeatClock,
    private readonly registry: MechanicRegistry,
  ) {}

  /** Receivers (normally ModeManager) get every mechanic the scheduler creates. */
  onMechanicSpawned(sink: MechanicSink): () => void {
    this.sinks.add(sink);
    return () => this.sinks.delete(sink);
  }

  get scheduledEventCount(): number { return this.scheduled; }
  get spawnedMechanicCount(): number { return this.spawned; }

  scheduleLevel(level: CompiledLevel): void {
    for (const section of level.sections) this.scheduleSection(section);
  }

  scheduleSection(section: CompiledSection): void {
    for (const placement of section.placements) this.schedulePlacement(placement, section);
  }

  /**
   * Schedule one repetition of one pattern.
   *
   * Pattern-relative bar/beat is resolved against the placement's absolute start
   * bar, so the same pattern JSON can be reused anywhere in any song.
   */
  schedulePlacement(placement: CompiledPlacement, section: CompiledSection): void {
    const beatsPerBar = this.clock.beatsPerBar;
    const patternStartBeat = (placement.startBar - 1) * beatsPerBar;
    const pattern = placement.pattern;

    for (const [eventIndex, event] of pattern.events.entries()) {
      const definition = this.registry.getDefinition(event.mechanicId);
      if (!definition) continue; // already reported by LevelLoader validation

      // Fractional beats (2.5) and offsetBeats fall out of this for free.
      const activationBeat = patternStartBeat + specToRelativeBeats(event.at, beatsPerBar);

      // The mechanic must exist early enough to render its telegraph. Use the
      // library telegraph as the *upper bound* -- intensity can only shorten it,
      // so spawning this early is always safe.
      const spawnBeat = activationBeat - definition.timing.telegraphBeats;
      const seed = hashSeed(pattern.id, placement.startBar, placement.repeatIndex, eventIndex);

      this.scheduled += 1;
      this.clock.scheduleAtBeat(
        spawnBeat,
        () => {
          const mechanic = this.registry.create(
            {
              mechanicId: event.mechanicId,
              activationBeat,
              params: event.params,
              intensity: placement.intensity,
              role: event.role ?? 'SYSTEM',
              seed,
              constraints: pattern.constraints,
            },
            this.clock,
          );
          if (!mechanic) return;
          this.spawned += 1;
          const info: SpawnedMechanicInfo = {
            mechanic,
            definition,
            mode: definition.mode,
            sectionId: section.id,
            patternId: pattern.id,
            activationBeat,
            role: event.role ?? 'SYSTEM',
            event,
          };
          for (const sink of this.sinks) sink(info);
        },
        `${pattern.id}#${eventIndex}->${event.mechanicId}`,
      );
    }
  }

  reset(): void {
    this.scheduled = 0;
    this.spawned = 0;
  }
}

/** Stable seed so "random" mechanic choices replay identically every run. */
function hashSeed(patternId: string, startBar: number, repeatIndex: number, eventIndex: number): number {
  let h = 2166136261;
  const key = `${patternId}:${startBar}:${repeatIndex}:${eventIndex}`;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

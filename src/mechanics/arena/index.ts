/**
 * ARENA mechanic registrations.
 *
 * This file is the *only* place that knows "A01 means Floor Warning". Adding a
 * mechanic = one line here plus its implementation file. Nothing in BeatClock,
 * PatternScheduler, LevelLoader or ModeManager changes.
 */

import type { MechanicRegistry } from '../../core/MechanicRegistry';
import { FloorWarningMechanic } from './FloorWarningMechanic';
import { ProjectileMechanic } from './ProjectileMechanic';
import { ChainMechanic } from './ChainMechanic';

export function registerArenaMechanics(registry: MechanicRegistry): void {
  registry.register('A01', (ctx) => new FloorWarningMechanic(ctx));
  registry.register('A03', (ctx) => new ProjectileMechanic(ctx));
  registry.register('A05', (ctx) => new ChainMechanic(ctx));
  // A02 Safe Tile, A06 Laser, and the RUNNER / VERTICAL / RADIAL / DUO
  // mechanics register here (or in their own mode module) as they land.
}

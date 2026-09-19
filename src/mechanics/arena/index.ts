/**
 * ARENA mechanic registrations.
 *
 * This file is the *only* place that knows "A01 means Floor Warning". Adding a
 * mechanic = one line here plus its implementation file. Nothing in BeatClock,
 * PatternScheduler, LevelLoader or ModeManager changes.
 */

import type { MechanicRegistry } from '../../core/MechanicRegistry';
import { FloorWarningMechanic } from './FloorWarningMechanic';
import { SafeTileMechanic } from './SafeTileMechanic';
import { ProjectileMechanic } from './ProjectileMechanic';
import { RadialBurstMechanic } from './RadialBurstMechanic';
import { ChainMechanic } from './ChainMechanic';
import { LaserMechanic } from './LaserMechanic';
import { RotatingFanMechanic } from './RotatingFanMechanic';
import { SpiralMechanic } from './SpiralMechanic';
import { WaveSweepMechanic } from './WaveSweepMechanic';
import { RingMechanic } from './RingMechanic';

export function registerArenaMechanics(registry: MechanicRegistry): void {
  registry.register('A01', (ctx) => new FloorWarningMechanic(ctx));
  registry.register('A02', (ctx) => new SafeTileMechanic(ctx));
  registry.register('A03', (ctx) => new ProjectileMechanic(ctx));
  registry.register('A04', (ctx) => new RadialBurstMechanic(ctx));
  registry.register('A05', (ctx) => new ChainMechanic(ctx));
  registry.register('A06', (ctx) => new LaserMechanic(ctx));
  registry.register('A07', (ctx) => new RotatingFanMechanic(ctx));
  registry.register('A08', (ctx) => new SpiralMechanic(ctx));
  registry.register('A09', (ctx) => new WaveSweepMechanic(ctx));
  registry.register('A10', (ctx) => new RingMechanic(ctx));
}

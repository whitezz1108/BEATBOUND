/** RADIAL mechanic registrations. */

import type { MechanicRegistry } from '../../core/MechanicRegistry';
import { DirectionNoteMechanic } from './DirectionNoteMechanic';
import { ClockwiseMechanic } from './ClockwiseMechanic';

export function registerRadialMechanics(registry: MechanicRegistry): void {
  registry.register('D01', (ctx) => new DirectionNoteMechanic(ctx));
  // D02 Opposite Double is the same note with two directions.
  registry.register('D02', (ctx) => new DirectionNoteMechanic(ctx));
  registry.register('D06', (ctx) => new ClockwiseMechanic(ctx));
}

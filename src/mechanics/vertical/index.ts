/** VERTICAL mechanic registrations. */

import type { MechanicRegistry } from '../../core/MechanicRegistry';
import { LaneNoteMechanic } from './LaneNoteMechanic';
import { HoldNoteMechanic } from './HoldNoteMechanic';

export function registerVerticalMechanics(registry: MechanicRegistry): void {
  registry.register('V01', (ctx) => new LaneNoteMechanic(ctx));
  registry.register('V02', (ctx) => new HoldNoteMechanic(ctx));
  // V03 Double is a tap with more than one lane; the lane list does the work.
  registry.register('V03', (ctx) => new LaneNoteMechanic(ctx));
}

/**
 * RUNNER mechanic registrations.
 *
 * All of these declare `telegraphBeats: 0` in the library -- their warning is
 * the scroll-in, so they ask the registry for spatial lead instead.
 */

import type { MechanicRegistry } from '../../core/MechanicRegistry';
import { SpikeMechanic } from './SpikeMechanic';
import { GapMechanic } from './GapMechanic';
import { LowWallMechanic } from './LowWallMechanic';
import { PlatformMechanic } from './PlatformMechanic';
import { BouncePadMechanic } from './BouncePadMechanic';
import { GravityFlipMechanic } from './GravityFlipMechanic';
import { SCROLL_LEAD_BEATS } from './runnerGeometry';

export function registerRunnerMechanics(registry: MechanicRegistry): void {
  const scrolled = { spawnLeadBeats: SCROLL_LEAD_BEATS };
  registry.register('R01', (ctx) => new SpikeMechanic(ctx), scrolled);
  registry.register('R02', (ctx) => new GapMechanic(ctx), scrolled);
  registry.register('R03', (ctx) => new LowWallMechanic(ctx), scrolled);
  registry.register('R04', (ctx) => new PlatformMechanic(ctx), scrolled);
  registry.register('R08', (ctx) => new BouncePadMechanic(ctx), scrolled);
  // The portal scrolls in like an obstacle even though its effect is a zone.
  registry.register('R09', (ctx) => new GravityFlipMechanic(ctx), scrolled);
}

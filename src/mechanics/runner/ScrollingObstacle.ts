/**
 * Base for RUNNER obstacles that physically scroll past the player.
 *
 * These differ from telegraphed hazards in two ways, both handled here:
 *
 *  - They are dangerous the whole time they exist, not only during an ACTIVE
 *    window. A spike does not "activate"; you either hit it or you don't.
 *  - Their lifetime is spatial. The beat-phase lifecycle would retire them the
 *    instant they reached the player (their library duration is 0), so they
 *    live until they have scrolled off the left edge instead.
 */

import { BaseMechanic } from '../../core/Mechanic';
import type { Shape } from '../../core/geometry';
import { SCROLL_TAIL_BEATS, trackX } from './runnerGeometry';

export abstract class ScrollingObstacle extends BaseMechanic {
  /** Current x on the track, derived purely from the beat. */
  protected get x(): number {
    return trackX(this.activationBeat, this.spawn.clock.absoluteBeat);
  }

  override get isFinished(): boolean {
    return this.spawn.clock.absoluteBeat > this.activationBeat + SCROLL_TAIL_BEATS;
  }

  override hazards(): Shape[] {
    return this.dangerShapes();
  }
}

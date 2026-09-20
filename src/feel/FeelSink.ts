/**
 * The narrow surface mechanics use to ask for presentation.
 *
 * Mechanics depend on this, not on GameFeel, for two reasons: it keeps the
 * vocabulary small (a mechanic can request an impact, it cannot reach in and
 * move the camera), and it lets the headless tools -- which have no
 * AudioContext and no canvas -- run the exact same mechanic code against
 * NULL_FEEL.
 */

import type { SfxName } from './AudioFX';
import type { ImpactLevel, ImpactOptions } from './GameFeel';
import type { EmitOptions } from './ParticlePool';

export interface FeelSink {
  impact(level: ImpactLevel, options?: ImpactOptions): void;
  telegraph(x: number, y: number, colour: string, progress: number): void;
  perfectDodge(x: number, y: number): void;
  playerHit(x: number, y: number, dirX?: number, dirY?: number): void;
  sfx(name: SfxName, gainScale?: number): void;
  /**
   * Freeze what is drawn for a moment. The audio timeline, the schedule and
   * collision all keep running -- only the visual beat is held -- so a freeze
   * can never desynchronise the song from the game.
   *
   * Requested in seconds and clamped by the sink against
   * `TUNING.hitStop.maxSeconds`; the longest outstanding request wins.
   */
  hitStop(seconds: number): void;
  emit(x: number, y: number, options?: EmitOptions): void;
  shockwave(x: number, y: number, radius?: number, colour?: string, life?: number, width?: number): void;
}

/** Used by the headless tools and by anything constructed before audio exists. */
export const NULL_FEEL: FeelSink = {
  impact() {},
  telegraph() {},
  perfectDodge() {},
  playerHit() {},
  sfx() {},
  hitStop() {},
  emit() {},
  shockwave() {},
};

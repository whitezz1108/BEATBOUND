/**
 * Outcome and scoring for one run.
 *
 * Health itself lives in HealthManager; this owns the *run*: whether it is
 * still going, how many hits and notes it has seen, and the transition to
 * FAILED or COMPLETE. Modes talk to this, never to the health pool directly,
 * so "what does this cost" and "is the run over" stay in one place.
 */

import { HealthManager, type DamageEvent, type DamageSource } from './HealthManager';

export type RunOutcome = 'PLAYING' | 'FAILED' | 'COMPLETE';

export class RunStatus {
  readonly health = new HealthManager();
  outcome: RunOutcome = 'PLAYING';
  /** Collisions taken (not missed notes). */
  hits = 0;
  notesHit = 0;
  notesMissed = 0;

  get invincible(): boolean {
    return this.health.invincible;
  }

  set invincible(value: boolean) {
    this.health.invincible = value;
  }

  isInvulnerable(songTime: number): boolean {
    return this.health.isInvulnerable(songTime);
  }

  /**
   * Something hurt the player. Returns the event when health changed, or null
   * when invulnerability absorbed it -- callers use that to decide whether to
   * fire feedback, so a hazard the player is standing in does not strobe.
   */
  damage(source: DamageSource, songTime: number): DamageEvent | null {
    if (this.outcome !== 'PLAYING') return null;
    const event = this.health.takeDamage(source, songTime);
    if (!event) return null;
    if (source === 'MISS') this.notesMissed += 1;
    else this.hits += 1;
    if (this.health.isDead()) this.outcome = 'FAILED';
    return event;
  }

  registerNoteHit(): void {
    this.notesHit += 1;
  }

  /**
   * A timed input the player did not land, counted but not charged for.
   *
   * VERTICAL and RADIAL reach `notesMissed` through `damage('MISS')`, because
   * there the miss *is* the punishment. An ARENA rhythm encounter punishes
   * differently -- the seal it failed to break collapses on the player, and
   * that collision is charged once through the ordinary path -- so the tally
   * needs a way to move without a second charge on top.
   */
  registerNoteMiss(): void {
    this.notesMissed += 1;
  }

  complete(): void {
    if (this.outcome === 'PLAYING') this.outcome = 'COMPLETE';
  }

  reset(): void {
    this.health.reset();
    this.outcome = 'PLAYING';
    this.hits = 0;
    this.notesHit = 0;
    this.notesMissed = 0;
  }
}

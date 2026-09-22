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
   *
   * `amount` overrides the shared table, for mechanics whose cost is authored
   * rather than looked up (see `RuntimeMechanic.damageAmount`). The *source*
   * still decides everything else -- immunity, and whether the hit is filed as
   * a collision or as a missed note.
   */
  damage(source: DamageSource, songTime: number, amount?: number): DamageEvent | null {
    if (this.outcome !== 'PLAYING') return null;
    const event = this.health.takeDamage(source, songTime, amount);
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
   * differently -- what a fumbled phrase costs is decided by the encounter and
   * charged through its own path -- so the tally needs a way to move without a
   * second charge on top.
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

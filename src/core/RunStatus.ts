/**
 * Player health / run outcome, shared across modes.
 *
 * Invulnerability is measured in beats (not seconds) so the grace window scales
 * with the song instead of feeling different at every tempo.
 */

export type RunOutcome = 'PLAYING' | 'FAILED' | 'COMPLETE';

export class RunStatus {
  hp: number;
  hits = 0;
  outcome: RunOutcome = 'PLAYING';
  private invulnerableUntilBeat = -Infinity;

  constructor(readonly maxHp = 3, readonly invulnerableBeats = 1) {
    this.hp = maxHp;
  }

  isInvulnerable(beat: number): boolean {
    return beat < this.invulnerableUntilBeat;
  }

  /** Returns true if the hit actually landed (i.e. not during i-frames). */
  registerHit(beat: number): boolean {
    if (this.outcome !== 'PLAYING' || this.isInvulnerable(beat)) return false;
    this.hits += 1;
    this.hp -= 1;
    this.invulnerableUntilBeat = beat + this.invulnerableBeats;
    if (this.hp <= 0) {
      this.hp = 0;
      this.outcome = 'FAILED';
    }
    return true;
  }

  complete(): void {
    if (this.outcome === 'PLAYING') this.outcome = 'COMPLETE';
  }

  reset(): void {
    this.hp = this.maxHp;
    this.hits = 0;
    this.outcome = 'PLAYING';
    this.invulnerableUntilBeat = -Infinity;
  }
}

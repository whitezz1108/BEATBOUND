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
  notesHit = 0;
  notesMissed = 0;
  outcome: RunOutcome = 'PLAYING';
  /** Dev flag: still counts and flashes hits, but never loses health. */
  invincible = false;
  private invulnerableUntilBeat = -Infinity;

  constructor(
    readonly maxHp = 3,
    readonly invulnerableBeats = 1,
    /**
     * Missed rhythm notes are far cheaper than collisions.
     *
     * VERTICAL and RADIAL fire roughly one note per beat, so charging a heart
     * per miss would fail an idle player in about two seconds. Spending a heart
     * every Nth miss turns the same three hearts into a miss allowance -- with
     * the default, a run survives 18 missed notes, i.e. ~80% accuracy on a
     * practice level.
     */
    readonly missesPerHeart = 6,
  ) {
    this.hp = maxHp;
  }

  isInvulnerable(beat: number): boolean {
    return beat < this.invulnerableUntilBeat;
  }

  /** Returns true if the hit actually landed (i.e. not during i-frames). */
  registerHit(beat: number): boolean {
    if (this.outcome !== 'PLAYING' || this.isInvulnerable(beat)) return false;
    this.hits += 1;
    this.invulnerableUntilBeat = beat + this.invulnerableBeats;
    if (this.invincible) return true; // counted and flashed, but survivable
    this.hp -= 1;
    if (this.hp <= 0) {
      this.hp = 0;
      this.outcome = 'FAILED';
    }
    return true;
  }

  /**
   * A rhythm note the player failed to hit. Always counted for accuracy; costs
   * a heart only once every `missesPerHeart` misses. Note misses deliberately
   * do not use the collision invulnerability window -- a run of missed notes
   * should register as a run of missed notes.
   */
  registerMiss(_beat: number): boolean {
    if (this.outcome !== 'PLAYING') return false;
    this.notesMissed += 1;
    if (this.invincible) return true;
    if (this.notesMissed % this.missesPerHeart !== 0) return false;
    this.hp -= 1;
    if (this.hp <= 0) {
      this.hp = 0;
      this.outcome = 'FAILED';
    }
    return true;
  }

  /** Misses remaining before the next heart is spent. */
  get missesUntilNextHeart(): number {
    return this.missesPerHeart - (this.notesMissed % this.missesPerHeart);
  }

  registerNoteHit(): void {
    this.notesHit += 1;
  }

  complete(): void {
    if (this.outcome === 'PLAYING') this.outcome = 'COMPLETE';
  }

  reset(): void {
    this.hp = this.maxHp;
    this.hits = 0;
    this.notesHit = 0;
    this.notesMissed = 0;
    this.outcome = 'PLAYING';
    this.invulnerableUntilBeat = -Infinity;
  }
}

/**
 * The game's single health pool.
 *
 * One instance lives for a whole song and is shared by all four modes, so
 * damage taken dodging in ARENA still matters when the song hands the player to
 * RUNNER. Modes never subtract health themselves; they name what happened and
 * this decides what it costs.
 *
 * Time is in *seconds of song time* rather than beats, because the
 * invulnerability window is a physiological allowance (how fast can a person
 * re-react) rather than a musical one.
 */

import { TUNING } from '../tuning';

export type DamageSource = 'MISS' | 'COLLISION' | 'PROJECTILE' | 'OBSTACLE';

export interface DamageEvent {
  source: DamageSource;
  amount: number;
  /** Song time the hit landed. */
  at: number;
  /** Health remaining afterwards. */
  remaining: number;
  fatal: boolean;
}

export class HealthManager {
  readonly maxHealth: number;
  private health: number;
  private invulnerableUntil = -Infinity;
  private lastDamage: DamageEvent | null = null;
  /** Dev flag: damage is still reported and flashed, but never applied. */
  invincible = false;

  constructor(maxHealth = TUNING.health.max) {
    this.maxHealth = maxHealth;
    this.health = maxHealth;
  }

  get currentHealth(): number {
    return this.health;
  }

  get fraction(): number {
    return this.maxHealth > 0 ? this.health / this.maxHealth : 0;
  }

  get isLow(): boolean {
    return this.fraction <= TUNING.health.lowFraction;
  }

  get lastDamageEvent(): DamageEvent | null {
    return this.lastDamage;
  }

  isDead(): boolean {
    return this.health <= 0;
  }

  /**
   * Collision immunity. Rhythm misses do not consult this -- they are discrete
   * events, and swallowing the second of two missed notes would misreport what
   * the player actually did.
   */
  isInvulnerable(atSeconds: number): boolean {
    return atSeconds < this.invulnerableUntil;
  }

  /**
   * Apply damage from a named source. Returns the event when health actually
   * changed, or null when it was absorbed by invulnerability.
   */
  takeDamage(source: DamageSource, atSeconds: number, amountOverride?: number): DamageEvent | null {
    const collision = source !== 'MISS';
    if (collision && this.isInvulnerable(atSeconds)) return null;
    if (this.isDead()) return null;

    const amount = amountOverride ?? TUNING.health.damage[source];
    if (collision) this.invulnerableUntil = atSeconds + TUNING.health.invulnerableSeconds;

    if (!this.invincible) this.health = Math.max(0, this.health - amount);
    const event: DamageEvent = {
      source,
      amount,
      at: atSeconds,
      remaining: this.health,
      fatal: this.health <= 0,
    };
    this.lastDamage = event;
    return event;
  }

  heal(amount: number): void {
    this.health = Math.min(this.maxHealth, this.health + Math.max(0, amount));
  }

  reset(): void {
    this.health = this.maxHealth;
    this.invulnerableUntil = -Infinity;
    this.lastDamage = null;
  }
}

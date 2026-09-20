/**
 * Centralised tuning.
 *
 * Every number a designer is likely to want to change lives here rather than
 * being buried in a mechanic. Mechanics read these at construction, so editing a
 * value and reloading is enough to feel the difference.
 *
 * `POLISH_PRESET` scales the *presentation* only -- never gameplay geometry or
 * timing. SUBTLE and MAX exist to compare against STANDARD, which is the
 * intended production level.
 */

export type PolishPreset = 'SUBTLE' | 'STANDARD' | 'MAX';

interface PresetScale {
  /** Camera zoom pulse and shake. */
  camera: number;
  /** Particle counts. */
  particles: number;
  /** Screen flashes, vignettes, shockwaves. */
  screen: number;
  /** Ambient background motes. */
  ambient: number;
}

const PRESETS: Record<PolishPreset, PresetScale> = {
  SUBTLE: { camera: 0.35, particles: 0.35, screen: 0.3, ambient: 0.3 },
  STANDARD: { camera: 1, particles: 1, screen: 1, ambient: 1 },
  MAX: { camera: 2.2, particles: 2.4, screen: 1.9, ambient: 2 },
};

let preset: PolishPreset = 'MAX';

export function setPolishPreset(next: PolishPreset): void {
  preset = next;
}

export function polishPreset(): PolishPreset {
  return preset;
}

export function presetScale(): PresetScale {
  return PRESETS[preset];
}

export const TUNING = {
  /**
   * One health pool for the whole song, shared by all four modes.
   *
   * Damage is looked up by source rather than passed in at the call site, so
   * rebalancing "how much does a projectile hurt" is one edit here and not a
   * hunt through four modes.
   */
  health: {
    max: 100,
    /**
     * Collision damage grants this many seconds of immunity. Without it a
     * hazard the player is standing inside drains the whole bar in a few
     * frames. Missed rhythm notes are discrete events and deliberately bypass
     * it -- three missed notes should cost three notes' worth of health.
     */
    invulnerableSeconds: 0.8,
    damage: {
      /** A missed rhythm note in VERTICAL or RADIAL. */
      MISS: 8,
      /** Touching a telegraphed floor, chain, laser or sweep. */
      COLLISION: 10,
      /** Being hit by something that was fired at you. */
      PROJECTILE: 12,
      /** A RUNNER obstacle, or falling out of the world. */
      OBSTACLE: 15,
    },
    /** Below this fraction the UI starts warning. */
    lowFraction: 0.3,
  },

  /** How long a gameplay-mode change takes, and how much it calms down first. */
  transition: {
    /**
     * Seconds the mode-change countdown runs for. The beat count is derived at
     * load from the song's tempo (see beatsForSeconds), so the player always
     * gets a full three seconds to read what is coming regardless of BPM.
     */
    countdownSeconds: 3,
    /**
     * Beats of reduced hazard density before a mode change -- the legacy
     * floor, kept as a minimum so slow songs never cut the breather short.
     */
    breatherBeats: 6,
    /** Beats the visual scene transition runs for. */
    sceneBeats: 2,
  },

  /**
   * Fairness floors, in seconds. These are absolute: no difficulty tier, no
   * intensity, no pattern is allowed to push a hazard below them. See
   * src/core/fairness.ts -- the mechanics and the fairness-check tool both
   * clamp against these numbers.
   */
  fairness: {
    /** Warning below which a hazard is physically unreactable. */
    reactionFloorSeconds: 0.6,
    /** Warning below which a hazard stops being comfortable. */
    comfortReactionSeconds: 0.9,
  },

  camera: {
    /** Zoom added on an ordinary beat. Deliberately almost subliminal. */
    beatPulse: 0.010,
    /** Zoom added on a downbeat. */
    downbeatPulse: 0.022,
    /** How quickly a pulse decays, in beats. */
    pulseDecayBeats: 0.55,
    /** Shake amplitude in field units, per impact level. */
    shakeLight: 0.004,
    shakeMedium: 0.010,
    shakeHeavy: 0.022,
    /** Shake duration in seconds. */
    shakeSeconds: 0.22,
    /** Directional kick amplitude in field units, per impact level. */
    kickLight: 0.004,
    kickMedium: 0.012,
    kickHeavy: 0.026,
  },

  hitStop: {
    /** Visual freeze on a player hit. The audio timeline is never paused. */
    playerHitSeconds: 0.06,
    heavySeconds: 0.08,
  },

  arena: {
    playerSpeed: 0.62,
    /**
     * Collision radius. Smaller than the drawn avatar on purpose: a dodge that
     * looks like it grazed should read as a graze, not a hit.
     *
     * Both radii were cut ~30% in the polish pass -- the avatar was the same
     * size as a projectile, which made every near-miss feel arbitrary. The
     * smaller body is what the fairness system's gap floors are built around.
     */
    playerRadius: 0.014,
    /** Drawn radius. Collision is ~75% of this. */
    playerVisualRadius: 0.018,
    /**
     * Global multiplier on how long arena hazards take to travel. Above 1 means
     * slower. Difficulty is meant to come from pattern design -- layering, safe
     * gaps, timing -- rather than from projectiles the player cannot read.
     */
    hazardTravelScale: 1.55,
    /** Acceleration/deceleration smoothing, in seconds to reach full speed. */
    playerAccelSeconds: 0.07,
    /**
     * How fast a projectile crosses the arena, at `speed: 1`.
     *
     * Cut from 1.0 in the projectile pass. The brief's complaint was "a few very
     * large high-speed generic circles"; this is the high-speed half of that.
     * Slower crossings mean more of the field is legible at once, which is what
     * lets the pattern library carry *more* bullets rather than faster ones.
     */
    projectileSpeed: 0.85,
    /**
     * Bullet radii, by source.
     *
     * `projectileRadius` was 0.03 -- more than twice the player's 0.014 body, so
     * a bullet was a bigger object than the thing dodging it, and its sprite hid
     * the very gaps it was asking the player to find. Both are cut here.
     *
     * The two families differ on purpose: a centre emitter is a *thing* in the
     * arena the player can look at, while an edge bullet is an interruption
     * arriving from off-screen, so it is drawn smaller and given a pointed
     * silhouette to compensate. See `mechanics/arena/bullets.ts`.
     */
    projectileRadius: 0.019,
    edgeProjectileRadius: 0.015,
    /** Trail samples kept per projectile. */
    projectileTrail: 6,
    /** A dodge this close to a hazard edge counts as perfect. */
    perfectDodgeMargin: 0.020,
    /** Cooldown between perfect-dodge awards, in beats. */
    perfectDodgeCooldownBeats: 0.5,
  },

  /**
   * ARENA difficulty tiers, chosen from a section's `difficulty` (1-5).
   *
   * Difficulty is expressed as *readability budget*, not velocity: an INTENSE
   * section still telegraphs, still leaves a safe gap, and still travels slowly
   * enough to read. What changes is how much margin there is.
   *
   *   travelScale     multiplies hazard travel time. Higher = slower.
   *   telegraphScale  multiplies warning length.
   *   gapScale        multiplies the size of safe gaps and arcs.
   *   densityScale    reserved for pattern-level density decisions.
   */
  arenaTiers: {
    EASY: { travelScale: 1.35, telegraphScale: 1.5, gapScale: 1.35, densityScale: 0.7 },
    MEDIUM: { travelScale: 1.18, telegraphScale: 1.25, gapScale: 1.18, densityScale: 0.85 },
    HARD: { travelScale: 1.0, telegraphScale: 1.05, gapScale: 1.0, densityScale: 1.0 },
    INTENSE: { travelScale: 0.9, telegraphScale: 0.9, gapScale: 0.9, densityScale: 1.15 },
  },

  runner: {
    /** Field units of track per beat. Raise for a faster-feeling run. */
    unitsPerBeat: 0.26,
    /**
     * Body size. The avatar was cut ~25% in the polish pass -- the old body was
     * the same width as the gaps between obstacles, so every dodge that looked
     * clear clipped. The smaller body gives the clearance numbers in the
     * mechanics (wall clearance, spike width) real headroom instead of pixel
     * perfection. See RunnerPlayer for the exported constants.
     */
    standingHeight: 0.094,
    slidingHeight: 0.044,
    playerWidth: 0.030,
    /** Platforms up to this height auto-step instead of needing a jump. */
    stepUpHeight: 0.045,
    /**
     * Airtime of a standard jump, in beats.
     *
     * This number decides what obstacle spacing is *possible*, not merely hard,
     * and it is squeezed from both sides:
     *
     *   - A jump longer than the obstacle spacing cannot be sustained. At one
     *     spike per beat, every jump that lasts 1.05 beats puts the player
     *     0.05 beats further behind, and a long chain eventually becomes
     *     unclearable. So it has to stay under 1.0.
     *   - Two spikes half a beat apart cannot be two jumps -- the second would
     *     start before the first has landed -- so one jump has to span both.
     *     That needs the airborne window to exceed 0.5 plus a spike's danger
     *     window, which pushes it up.
     *
     * 0.95 satisfies both with room to spare. `npm run runner-check` proves it
     * against the whole RUNNER library at three intensities.
     */
    jumpBeats: 0.95,
    /** Apex height of a standard jump, in field units. */
    jumpHeight: 0.32,
    /** Jump pressed this long before landing still fires on touchdown. */
    inputBufferSeconds: 0.12,
    /** Grace after leaving a surface during which a jump still works. */
    coyoteSeconds: 0.09,
    /** Releasing the jump key cuts upward velocity by this factor. */
    jumpCutFactor: 0.45,
    /** Beats of warning before a gravity flip lands. */
    gravityTelegraphBeats: 1,
    /** Beats a gravity flip takes to snap the player to the new surface. */
    gravitySnapBeats: 0.18,
    /** Parallax layer speeds, as a fraction of track speed. */
    parallax: [0.12, 0.28, 0.55],
  },

  vertical: {
    /** Beats of travel from the top of the board to the judgement line. */
    approachBeats: 2,
    /** World units a note covers per beat on the 3D highway (see Highway.ts). */
    worldUnitsPerBeat: 0.9,
    perfectWindowBeats: 0.09,
    niceWindowBeats: 0.16,
    goodWindowBeats: 0.25,
    /** A hold survives this long un-held before it breaks. */
    holdToleranceBeats: 0.12,
    /** A drift hold survives this long on the wrong lane before it breaks. */
    driftToleranceBeats: 0.18,
  },

  radial: {
    /** Beats a prompt takes to travel from the rim to the judgement ring. */
    approachBeats: 2,
    perfectWindowBeats: 0.09,
    niceWindowBeats: 0.16,
    goodWindowBeats: 0.25,
    /**
     * Diagonals are entered as two cardinals at once, which never land on the
     * same frame. A diagonal stays "pressed" for this long so the second key
     * can still complete it.
     */
    diagonalToleranceSeconds: 0.09,
  },

  ambient: {
    /** Motes drifting in the background. */
    density: 26,
    /** Extra motes at full section energy. */
    energyBonus: 18,
  },
} as const;

/**
 * Whole beats spanning at least `seconds` at the given BPM.
 *
 * Count-ins and mode-change countdowns are *second* requirements (the player
 * needs three real seconds, not six musical beats), so they are converted to
 * beats from the song's tempo everywhere they are consumed.
 */
export function beatsForSeconds(bpm: number, seconds: number): number {
  return Math.max(1, Math.round((seconds * bpm) / 60));
}

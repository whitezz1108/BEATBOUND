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

let preset: PolishPreset = 'STANDARD';

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
    playerRadius: 0.032,
    /** Acceleration/deceleration smoothing, in seconds to reach full speed. */
    playerAccelSeconds: 0.07,
    projectileSpeed: 1.0,
    projectileRadius: 0.03,
    /** Trail samples kept per projectile. */
    projectileTrail: 6,
    /** A dodge this close to a hazard edge counts as perfect. */
    perfectDodgeMargin: 0.028,
    /** Cooldown between perfect-dodge awards, in beats. */
    perfectDodgeCooldownBeats: 0.5,
  },

  runner: {
    /** Field units of track per beat. Raise for a faster-feeling run. */
    unitsPerBeat: 0.26,
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
    perfectWindowBeats: 0.09,
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

/**
 * Easing curves.
 *
 * The presentation grammar this project uses:
 *
 *   telegraph -> easeIn      (slow build, late commitment)
 *   attack    -> easeOutQuad (immediate, decelerating)
 *   impact    -> easeOutBack (overshoot, then settle)
 *   recovery  -> easeInOut   (calm return)
 *
 * All take and return 0..1.
 */

export function clamp01(t: number): number {
  return t < 0 ? 0 : t > 1 ? 1 : t;
}

export function linear(t: number): number {
  return clamp01(t);
}

export function easeIn(t: number): number {
  const x = clamp01(t);
  return x * x;
}

export function easeInCubic(t: number): number {
  const x = clamp01(t);
  return x * x * x;
}

export function easeOut(t: number): number {
  const x = clamp01(t);
  return 1 - (1 - x) * (1 - x);
}

export function easeOutCubic(t: number): number {
  const x = clamp01(t);
  return 1 - Math.pow(1 - x, 3);
}

export function easeOutExpo(t: number): number {
  const x = clamp01(t);
  return x >= 1 ? 1 : 1 - Math.pow(2, -9 * x);
}

export function easeInOut(t: number): number {
  const x = clamp01(t);
  return x < 0.5 ? 2 * x * x : 1 - Math.pow(-2 * x + 2, 2) / 2;
}

/** Overshoots past 1 then settles. The impact curve. */
export function easeOutBack(t: number, overshoot = 1.7): number {
  const x = clamp01(t);
  const c3 = overshoot + 1;
  return 1 + c3 * Math.pow(x - 1, 3) + overshoot * Math.pow(x - 1, 2);
}

/** Pulls back before launching. The anticipation curve. */
export function easeInBack(t: number, overshoot = 1.7): number {
  const x = clamp01(t);
  const c3 = overshoot + 1;
  return c3 * x * x * x - overshoot * x * x;
}

/** Use sparingly; reads as comic if applied to gameplay-critical motion. */
export function easeOutElastic(t: number): number {
  const x = clamp01(t);
  if (x === 0 || x === 1) return x;
  const period = (2 * Math.PI) / 3;
  return Math.pow(2, -10 * x) * Math.sin((x * 10 - 0.75) * period) + 1;
}

/** 0 -> 1 -> 0. A one-shot pulse envelope. */
export function pulse(t: number): number {
  const x = clamp01(t);
  return Math.sin(x * Math.PI);
}

/** Exponential decay from 1 to 0, for shake and flash envelopes. */
export function decay(t: number, sharpness = 6): number {
  return Math.exp(-sharpness * clamp01(t));
}

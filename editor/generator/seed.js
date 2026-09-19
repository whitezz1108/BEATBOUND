/**
 * Deterministic randomness for the Level Director.
 *
 * Every random decision in the generator flows through one seeded PRNG
 * (mulberry32) so the same song + analysis + rules + seed always yields the
 * same blueprint and level. No Math.random() anywhere in the generator.
 */

/** mulberry32: tiny, fast, high-quality-enough for level design decisions. */
export function createRng(seed) {
  let a = seed >>> 0;
  return function rng() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Hash a string to a 32-bit int (stable across Node versions). */
export function hashString(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** rng() in [min, max), integer or float. */
export function randRange(rng, min, max) {
  return min + rng() * (max - min);
}

/** Random integer in [min, max] inclusive. */
export function randInt(rng, min, max) {
  return Math.floor(randRange(rng, min, max + 1));
}

/** Pick one element uniformly. */
export function pick(rng, arr) {
  return arr[Math.floor(rng() * arr.length)];
}

/** Weighted pick: entries are [item, weight]. Total weight must be > 0. */
export function pickWeighted(rng, entries) {
  let total = 0;
  for (const [, w] of entries) total += w;
  let roll = rng() * total;
  for (const [item, w] of entries) {
    roll -= w;
    if (roll <= 0) return item;
  }
  return entries[entries.length - 1][0];
}

/** Seeded Fisher-Yates shuffle (copies the array). */
export function shuffle(rng, arr) {
  const out = [...arr];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** Clamp x into [lo, hi]. */
export function clamp(x, lo, hi) {
  return Math.min(Math.max(x, lo), hi);
}

/** Round to 2 decimals (JSON-friendly). */
export function round2(x) {
  return Math.round(x * 100) / 100;
}

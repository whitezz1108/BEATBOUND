/**
 * PatternGenerator -- fills a section's bars with placements from the live
 * pattern library. The Level Director decides *what kind* of gameplay
 * (mode, difficulty, function, family preferences); this module turns that
 * into an ordered, repeat-capped, family-diverse placement list that exactly
 * covers the section's bars.
 */

import { clamp, randInt, pickWeighted } from './seed.js';
import { energyRank, recoveryPatterns, teachPatterns } from './patternIndex.js';

/**
 * Pick one pattern for a placement using a weighted score:
 *  - difficulty closeness (weight 3)
 *  - function match (weight from rules.patternMatch.functionMatchBonus)
 *  - energy tag match (weight from rules.patternMatch.energyTagMatchBonus)
 *  - family diversity: penalty when the family repeats within the history
 *  - tail/head roles force recovery/teach patterns
 */
export function scoreCandidates(pool, opts, rng) {
  const { difficulty, functionName, energy, familyHistory, role } = opts;
  const maxSame = opts.maxConsecutiveSameFamily ?? 2;
  const entries = [];

  for (const p of pool) {
    let score = 3 * (5 - Math.abs(p.difficulty - difficulty)) / 5;
    if (p.function === functionName) score += 3;
    if (energyRank(p.energy) <= energyRank(energy) + 1) score += 1;
    // Family diversity: counting backwards, consecutive same-family repeats
    // are strongly discouraged past the cap.
    let sameRun = 0;
    for (let i = familyHistory.length - 1; i >= 0 && familyHistory[i] === p.family; i--) {
      sameRun++;
    }
    if (sameRun >= maxSame) score -= 4;
    else if (sameRun === maxSame - 1) score -= 1;
    // Length preference: shorter patterns pack more variety into a section.
    score += p.lengthBars <= 2 ? 0.5 : 0;
    // Role overrides: recovery/teach pools are pre-filtered; give them a
    // nudge so the role genuinely changes gameplay.
    if (role === 'TRANSITION_TAIL' && p.recovery) score += 2;
    if (role === 'TRANSITION_HEAD' && p.teach) score += 2;
    // Squared weight concentrates probability on the genuinely best matches
    // while keeping the seeded variety that makes different sections feel
    // different.
    entries.push([p, Math.max(0.05, score) ** 2]);
  }
  return pickWeighted(rng, entries);
}

/**
 * Fill `lengthBars` bars of `mode` gameplay. Returns placements
 * [{patternId, family, repeat, intensity, role}] plus the tail of the family
 * history for continuity with the next section.
 *
 * opts:
 *   index            merged pattern index
 *   rules            gameplay-rules.json (patterns block)
 *   difficulty       1..5 target
 *   functionName     TEACH / PRACTICE / ... / RECOVERY
 *   energy           LOW/MID/HIGH/PEAK band name
 *   intensity        0..1 base intensity
 *   familyHistory    recent family names (most recent last)
 *   role             MAIN | TRANSITION_TAIL | TRANSITION_HEAD
 *   roleBars         how many bars at the END of the section are role bars
 *                    (tails); role bars at the START are handled by the
 *                    transition generator directly.
 *   rng              seeded PRNG
 */
export function fillSectionBars(lengthBars, mode, opts) {
  const {
    index,
    rules,
    difficulty,
    functionName,
    energy,
    intensity,
    familyHistory = [],
    role = 'MAIN',
    roleBars = 0,
    rng,
    usableBeatsInLastBar,
    beatsPerBar = 4,
  } = opts;

  // This fill covers `lengthBars` bars exactly. When that zone ends at the
  // section's fill boundary under a mode-change breather, `usableBeatsInLastBar`
  // says how many beats of the last bar still spawn; a pattern may only end
  // there if it activates within the window, or the bar plays as dead air.
  const usable = Math.min(usableBeatsInLastBar ?? beatsPerBar, beatsPerBar);

  const pool = index.byMode.get(mode);
  const rolePool = role === 'TRANSITION_TAIL' ? recoveryPatterns(index, mode) : pool;
  const placements = [];
  const history = [...familyHistory];
  let remaining = lengthBars;
  let cursor = 0;
  let consecutive = 0;
  let lastId = null;

  const baseIntensity =
    role === 'TRANSITION_TAIL'
      ? intensity * (rules.transition.tailIntensityScale ?? 0.6)
      : intensity;

  // A pattern that ends in the final fill bar must activate before the
  // breather closes the bar; a straddling pattern is the designed hand-off --
  // the runtime holds back the beats past the boundary. Only cut a pattern
  // whose final bar would play nothing at all in the window
  // (remaining % length === 0 means it reaches that bar).
  const finalBarCut = (p) =>
    usable < beatsPerBar &&
    p.lengthBars > 0 &&
    remaining % p.lengthBars === 0 &&
    p.finalBarFirstOffset >= usable;

  while (remaining > 0) {
    // Bars left in the role zone (tail occupies the LAST roleBars bars of the
    // fill region).
    const inRoleZone = role === 'TRANSITION_TAIL' && cursor >= lengthBars - roleBars;
    const usePool = inRoleZone ? rolePool : pool;

    // Never overrun the section: filter to patterns that fit, and keep only
    // patterns whose bars all contain a mechanic activation -- the runtime's
    // timing test treats an activation-less bar as dead air.
    const fit = usePool.filter(
      (p) =>
        p.fullCoverage &&
        p.lengthBars <= remaining &&
        !(rules.patterns.avoidImmediateRepeat && p.id === lastId) &&
        !finalBarCut(p)
    );
    if (fit.length === 0) break;

    const chosen = scoreCandidates(fit, {
      difficulty: inRoleZone ? Math.min(difficulty, 2) : difficulty,
      functionName: inRoleZone ? rules.transition.tailFunction : functionName,
      energy,
      familyHistory: history,
      role: inRoleZone ? 'TRANSITION_TAIL' : role,
    }, rng);

    const maxRepeat = rules.patterns.maxConsecutiveRepeats;
    const repeat = Math.min(
      Math.floor(remaining / chosen.lengthBars),
      chosen.id === lastId ? Math.max(1, maxRepeat - consecutive) : maxRepeat
    );

    placements.push({
      patternId: chosen.id,
      family: chosen.family,
      repeat,
      intensity: round2(inRoleZone ? baseIntensity : intensity),
      role: inRoleZone ? 'TRANSITION_TAIL' : role,
    });
    history.push(chosen.family);
    consecutive = chosen.id === lastId ? consecutive + repeat : repeat;
    lastId = chosen.id;
    cursor += chosen.lengthBars * repeat;
    remaining -= chosen.lengthBars * repeat;
  }

  // Fill any remainder with the lowest-difficulty pattern that actually
  // fits (preferring exact divisors), at reduced intensity. Every mode has
  // 1-bar patterns so this normally covers odd remainders exactly.
  const maxFill = rules.filler?.maxFillBars ?? 2;
  while (remaining > 0 && remaining <= maxFill) {
    const byFit = [...pool]
      .filter(
        (p) =>
          p.fullCoverage &&
          p.lengthBars <= remaining &&
          !finalBarCut(p)
      )
      .sort(
        (a, b) =>
          (remaining % a.lengthBars) - (remaining % b.lengthBars) || // exact divisor first
          a.difficulty - b.difficulty || // then easiest
          a.lengthBars - b.lengthBars // then shortest
      );
    const filler = byFit[0];
    if (!filler) break;
    const reps = Math.max(1, Math.floor(remaining / filler.lengthBars));
    placements.push({
      patternId: filler.id,
      family: filler.family,
      repeat: reps,
      intensity: round2(baseIntensity * 0.8),
      role,
    });
    remaining -= filler.lengthBars * reps;
  }

  return { placements, familyHistory: history, unfilledBars: remaining };
}

/** Transition head: TEACH patterns covering the first headBars of a section. */
export function fillTransitionHead(headBars, mode, opts) {
  const { index, rules, intensity, rng } = opts;
  const pool = teachPatterns(index, mode);
  const placements = [];
  let remaining = headBars;
  const headIntensity = intensity * (rules.transition.headIntensityScale ?? 0.7);

  while (remaining > 0 && pool.length > 0) {
    // Only patterns that FIT the head window. Forcing a longer one would push
    // every following zone one bar further and the section's tail would spill
    // past its fill boundary (into the mode-change breather, when there is one).
    const fit = pool.filter((p) => p.lengthBars <= remaining);
    if (fit.length === 0) break;
    const chosen = fit.slice().sort((a, b) => a.difficulty - b.difficulty)[0];
    const repeat = Math.max(1, Math.floor(remaining / chosen.lengthBars));
    placements.push({
      patternId: chosen.id,
      family: chosen.family,
      repeat,
      intensity: round2(headIntensity),
      role: 'TRANSITION_HEAD',
    });
    remaining -= chosen.lengthBars * repeat;
    if (remaining > 0 && pool.length === 1) break;
  }
  return { placements, unfilledBars: remaining };
}

function round2(x) {
  return Math.round(x * 100) / 100;
}

/** Compact summary line for logs / notes. */
export function describePlacements(placements) {
  return placements
    .map((p) => `${p.patternId}${p.repeat > 1 ? `x${p.repeat}` : ''}@${round2(p.intensity)}`)
    .join(' ');
}

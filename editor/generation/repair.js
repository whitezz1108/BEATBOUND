/**
 * Layer 4c -- bounded repair.
 *
 * When the blueprint the director wrote does not pass `validateBlueprint`, the
 * pipeline may ask the model to fix it. This module owns that loop and, more
 * importantly, the rule that governs it:
 *
 *   **the model proposes, the validator disposes.**
 *
 * Every candidate -- the director's original, the normalizer's deterministic
 * repair, and each model rewrite -- is scored by the same validator, and the
 * loop keeps the best one. A model rewrite that is worse than what we already
 * had is discarded, and the run ends with the errors it could not fix rather
 * than with a plausible-looking level nobody checked.
 *
 * The loop is bounded twice over: `MAX_REPAIR_PASSES` model calls, and an early
 * exit as soon as a candidate validates. Deterministic normalization runs first
 * and for free, so the model is only asked about things it can actually change
 * -- an off-grid bar range or a section in an unoffered mode is fixed without
 * spending a request.
 */

import { normalizeBlueprint, validateBlueprint } from './blueprint.js';

/** Model calls per generation. A third pass has never been worth the tokens. */
export const MAX_REPAIR_PASSES = 2;

/**
 * Score a blueprint: errors are the only thing that matters, warnings are the
 * tie-break so a repair that fixes one error and introduces two warnings does
 * not look like an improvement.
 */
function score(result) {
  return { errors: result.errors.length, warnings: result.warnings.length };
}

function better(a, b) {
  if (a.errors !== b.errors) return a.errors < b.errors;
  return a.warnings < b.warnings;
}

/** A stable identity for an error list, so "the same errors" is comparable. */
function errorKey(errors) {
  return [...errors].sort().join('\n');
}

/**
 * Repair a blueprint until it validates or the passes run out.
 *
 * @param {object} args
 * @param {object} args.blueprint
 * @param {object} args.directorContext
 * @param {object} [args.gameplayContext]
 * @param {object} [args.patternIndex]
 * @param {object} [args.tuning]
 * @param {(blueprint: object, errors: string[]) => Promise<object>} [args.repair]
 *   called with the current blueprint and the validator's errors; returns a
 *   candidate blueprint. Omit it to run normalization only (deterministic mode).
 * @param {number} [args.maxPasses]
 * @param {(event: object) => void} [args.onEvent] progress hook, for logs
 * @returns {Promise<{blueprint: object, validation: object, passes: number,
 *                    history: object[], normalized: object[], repaired: boolean}>}
 */
export async function repairBlueprint(args) {
  const {
    directorContext,
    gameplayContext,
    patternIndex,
    tuning,
    repair,
    maxPasses = MAX_REPAIR_PASSES,
    onEvent,
  } = args;

  const validate = (bp) => validateBlueprint(bp, { directorContext, gameplayContext, patternIndex, tuning });

  const history = [];
  let current = args.blueprint;
  let currentValidation = validate(current);
  history.push({ stage: 'director', ...score(currentValidation), messages: currentValidation.errors });
  onEvent?.({ stage: 'director', ...score(currentValidation) });

  // ---- 1. deterministic normalization, for free ---------------------------
  const normalized = normalizeBlueprint(current, { directorContext, gameplayContext, patternIndex, tuning });
  const normalizedValidation = validate(normalized.blueprint);
  history.push({
    stage: 'normalize',
    fixes: normalized.fixes,
    ...score(normalizedValidation),
    messages: normalizedValidation.errors,
  });
  onEvent?.({ stage: 'normalize', fixes: normalized.fixes.length, ...score(normalizedValidation) });

  if (better(score(normalizedValidation), score(currentValidation))) {
    current = normalized.blueprint;
    currentValidation = normalizedValidation;
  } else if (normalized.fixes.length > 0) {
    // The normalizer changed things without improving the score. Keep the
    // original: a repair that does not help is not a repair.
    history.push({ stage: 'normalize-rejected', reason: 'no improvement over the director blueprint' });
  }

  // ---- 2. bounded model repair -------------------------------------------
  let passes = 0;
  let repaired = false;
  let lastSent = errorKey(currentValidation.errors);

  while (currentValidation.errors.length > 0 && repair && passes < maxPasses) {
    passes++;
    let candidate;
    try {
      candidate = await repair(current, currentValidation.errors);
    } catch (err) {
      history.push({ stage: 'model-error', pass: passes, error: String(err?.message ?? err) });
      onEvent?.({ stage: 'model-error', pass: passes, error: String(err?.message ?? err) });
      break; // A model failure is not something a second call will fix.
    }

    if (!candidate || typeof candidate !== 'object') {
      history.push({ stage: 'model-invalid', pass: passes, reason: 'the model did not return a blueprint object' });
      onEvent?.({ stage: 'model-invalid', pass: passes });
      continue;
    }

    // Normalize the model's answer too: it will make the same class of
    // off-grid, out-of-order mistakes the director did, and those are free to
    // fix. Then validate, because the model's own claims mean nothing.
    const cleaned = normalizeBlueprint(candidate, { directorContext, gameplayContext, patternIndex, tuning });
    const candidateValidation = validate(cleaned.blueprint);

    const accepted = better(score(candidateValidation), score(currentValidation));
    history.push({
      stage: 'model-repair',
      pass: passes,
      accepted,
      fixes: cleaned.fixes,
      ...score(candidateValidation),
      messages: candidateValidation.errors,
    });
    onEvent?.({ stage: 'model-repair', pass: passes, accepted, ...score(candidateValidation) });

    if (accepted) {
      current = cleaned.blueprint;
      currentValidation = candidateValidation;
      repaired = true;
      lastSent = errorKey(currentValidation.errors);
      continue;
    }

    // Not an improvement. Whether to try again depends on whether the model
    // actually said anything new: an identical error list means it is looping
    // on the same answer, and a second identical request would only cost
    // tokens. A different error list means it moved, so one more pass is worth
    // asking for -- still against the best blueprint we hold, never the worse
    // candidate.
    const nextKey = errorKey(candidateValidation.errors);
    if (nextKey === lastSent) {
      history.push({ stage: 'stopped', reason: 'the model returned the same errors -- it is looping' });
      onEvent?.({ stage: 'stopped', reason: 'looping' });
      break;
    }
    lastSent = nextKey;
    if (passes >= maxPasses) {
      history.push({ stage: 'stopped', reason: `reached the ${maxPasses}-pass limit without a valid blueprint` });
    }
  }

  return {
    blueprint: current,
    validation: currentValidation,
    passes,
    history,
    normalized: normalized.fixes,
    repaired,
    ok: currentValidation.errors.length === 0,
  };
}

/**
 * Request-body -> generation-request resolution for the editor server.
 *
 * This lives apart from server.mjs for one reason: importing server.mjs starts
 * an HTTP listener, so anything defined there is untestable without binding a
 * port. This is the part of `/api/generate-level` that is a pure decision, and
 * it is the part worth testing -- every check here runs *before* the model is
 * called, so a typo in a preset id costs nothing instead of costing a request.
 */

import { getPreset, buildRequest, validatePreset } from '../generation/presets.js';

/**
 * Turn a request body into the generation request the pipeline will run.
 *
 * Precedence is the pipeline's, restated here so the streamed events describe
 * the run that is actually about to happen: an explicit `request`, then the
 * blueprint's own request (it is part of the artifact -- overriding it would
 * make a replay generate something the manifest does not describe), then the
 * preset.
 *
 * @param {object} opts a parsed request body
 * @throws on an unknown preset or an invalid request shape
 */
export function resolveGenerationRequest(opts = {}) {
  let request;
  if (opts.request) {
    request = opts.request;
  } else {
    const preset = opts.preset ?? 'arena_primary';
    getPreset(preset); // throws on an unknown id, before anything is spent
    request = buildRequest({
      preset,
      primaryMode: opts.primary_mode,
      allowedModes: opts.allowed_modes,
      difficulty: opts.difficulty,
      ratio: opts.ratio,
      seed: opts.seed,
    });
  }

  if (opts.blueprint !== undefined && (opts.blueprint === null || typeof opts.blueprint !== 'object')) {
    throw new Error('blueprint must be a JSON object');
  }
  if (opts.blueprint) {
    request = opts.blueprint.request ?? request;
  }

  validatePreset({
    primary_mode: request.primary_mode,
    allowed_modes: request.allowed_modes,
    target_difficulty: request.target_difficulty,
    primary_mode_ratio: request.primary_mode_ratio,
  });
  return request;
}

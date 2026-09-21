/**
 * A small OpenAI-compatible chat-completions client.
 *
 * Deliberately minimal: the pipeline needs one call shape (send messages, get
 * text back) with a timeout, a bounded retry, and a way to cancel. Everything
 * else -- prompting, validation, repair -- lives in the layers above, so this
 * file stays small enough to audit for the thing that actually matters here:
 * **a key must never appear in a log, an error, or a generated document.**
 *
 * `fetchImpl` is injectable so the test suite can exercise retries, timeouts
 * and malformed responses without a network or a key.
 */

import { loadLlmConfig, requireApiKey, scrubSecrets } from './config.js';

/** Statuses worth retrying: transient, and the server is telling us so. */
const RETRYABLE_STATUS = new Set([408, 409, 425, 429, 500, 502, 503, 504, 529]);

const DEFAULT_MAX_ATTEMPTS = 3;
const BASE_BACKOFF_MS = 1_000;
const MAX_BACKOFF_MS = 30_000;

/** An error from the LLM layer, already scrubbed of anything secret. */
export class LlmError extends Error {
  constructor(message, { status = null, retryable = false, attempts = 1, cause = null } = {}) {
    super(scrubSecrets(message));
    this.name = 'LlmError';
    this.status = status;
    this.retryable = retryable;
    this.attempts = attempts;
    if (cause) this.cause = new Error(scrubSecrets(String(cause.message ?? cause)));
  }
}

export class LlmCancelledError extends LlmError {
  constructor(message = 'the LLM call was cancelled') {
    super(message);
    this.name = 'LlmCancelledError';
  }
}

export class LlmTimeoutError extends LlmError {
  constructor(timeoutMs, attempts) {
    super(`the LLM call timed out after ${timeoutMs} ms (${attempts} attempt(s))`);
    this.name = 'LlmTimeoutError';
    this.timeoutMs = timeoutMs;
  }
}

/**
 * Create a client.
 *
 * @param {object} [opts]
 * @param {object} [opts.config]     pre-loaded config (defaults to loadLlmConfig())
 * @param {Function} [opts.fetchImpl] fetch implementation, for tests
 * @param {(ms: number) => Promise<void>} [opts.sleep] backoff sleeper, for tests
 * @param {number} [opts.maxAttempts]
 */
export function createLlmClient({
  config,
  fetchImpl = globalThis.fetch,
  sleep = (ms) => new Promise((r) => setTimeout(r, ms)),
  maxAttempts = DEFAULT_MAX_ATTEMPTS,
} = {}) {
  const cfg = config || loadLlmConfig();
  const doFetch = fetchImpl;
  if (typeof doFetch !== 'function') {
    throw new LlmError('no fetch implementation available (node >= 18 required)');
  }

  /**
   * One chat completion.
   *
   * @param {object} opts
   * @param {Array<{role: string, content: string}>} opts.messages
   * @param {string} [opts.system]      prepended as a system message
   * @param {number} [opts.temperature]
   * @param {number} [opts.maxTokens]
   * @param {boolean} [opts.json]       request a JSON object response
   * @param {AbortSignal} [opts.signal]
   * @returns {Promise<{text: string, usage: object|null, model: string|null,
   *                    attempts: number, latencyMs: number, finishReason: string|null}>}
   */
  async function complete({
    messages,
    system,
    temperature = 0.7,
    maxTokens,
    json = false,
    signal,
  } = {}) {
    const key = requireApiKey(cfg);

    const full = system ? [{ role: 'system', content: system }, ...messages] : [...messages];
    const body = {
      model: cfg.model,
      messages: full,
      temperature,
      max_tokens: maxTokens ?? cfg.maxTokens,
      stream: false,
    };
    if (json) body.response_format = { type: 'json_object' };
    if (cfg.reasoningEffort) body.reasoning_effort = cfg.reasoningEffort;

    const url = `${cfg.baseUrl}/chat/completions`;
    const started = Date.now();
    let lastError = null;

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      if (signal?.aborted) throw new LlmCancelledError();

      // The timeout is per attempt, and it is composed with the caller's
      // signal so cancelling the generation aborts an in-flight request too.
      const timeoutController = new AbortController();
      const timer = setTimeout(() => timeoutController.abort(new Error('timeout')), cfg.timeoutMs);
      const composed = composeSignals(signal, timeoutController.signal);

      let response;
      try {
        response = await doFetch(url, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            authorization: `Bearer ${key}`,
          },
          body: JSON.stringify(body),
          signal: composed.signal,
        });
      } catch (err) {
        clearTimeout(timer);
        if (signal?.aborted) throw new LlmCancelledError();

        const timedOut = timeoutController.signal.aborted;
        // `fetch` reports almost every transport problem as the bare string
        // "fetch failed" and hides the real one in `err.cause`. That is exactly
        // the information a caller needs -- ENOTFOUND (the host does not exist),
        // ECONNREFUSED and CERT_HAS_EXPIRED are three different fixes -- so the
        // cause's code is carried into the message rather than left behind.
        const causeCode = err?.cause?.code ?? err?.cause?.errno ?? null;
        const detail = causeCode ? `${err?.message ?? err} (${causeCode})` : `${err?.message ?? err}`;
        const wrapped = timedOut
          ? new LlmTimeoutError(cfg.timeoutMs, attempt)
          : new LlmError(`the LLM request failed: ${detail}`, { retryable: true, cause: err });

        // A timeout or a network blip is worth another try; the last attempt's
        // error is what the caller sees.
        if (attempt < maxAttempts) {
          lastError = wrapped;
          await sleep(backoffMs(attempt, null));
          continue;
        }
        throw wrapped;
      } finally {
        clearTimeout(timer);
        composed.dispose();
      }

      if (!response.ok) {
        const detail = await readErrorDetail(response);
        const retryable = RETRYABLE_STATUS.has(response.status);
        const error = new LlmError(
          `the LLM returned HTTP ${response.status}${detail ? `: ${detail}` : ''}`,
          { status: response.status, retryable },
        );
        // 400/401/403/404 mean the request or the key is wrong -- retrying
        // would just spend the same failure again.
        if (!retryable || attempt === maxAttempts) throw error;
        lastError = error;
        await sleep(backoffMs(attempt, response.headers?.get?.('retry-after')));
        continue;
      }

      let payload;
      try {
        payload = await response.json();
      } catch (err) {
        throw new LlmError(`the LLM response was not valid JSON: ${err?.message ?? err}`);
      }

      const choice = payload?.choices?.[0];
      const text = choice?.message?.content;
      if (typeof text !== 'string') {
        throw new LlmError('the LLM response contained no message content');
      }

      return {
        text,
        usage: payload.usage ?? null,
        model: payload.model ?? null,
        attempts: attempt,
        latencyMs: Date.now() - started,
        finishReason: choice?.finish_reason ?? null,
      };
    }

    throw lastError ?? new LlmError('the LLM call failed for an unknown reason');
  }

  /**
   * A completion whose content is parsed as JSON.
   *
   * Models wrap JSON in prose or code fences often enough that treating that as
   * a hard failure would make the repair loop thrash. Extraction is attempted
   * in order of confidence: the whole string, a fenced block, then the first
   * balanced `{...}`. If none of them parse, the error carries a *truncated*
   * excerpt so a human can see what happened.
   */
  async function completeJson(opts) {
    const result = await complete({ ...opts, json: opts?.json ?? true });
    const { value, strategy } = extractJson(result.text);
    if (value === undefined) {
      throw new LlmError(
        `the LLM did not return parseable JSON (${strategy}); response began: ${excerpt(result.text)}`,
      );
    }
    return { ...result, json: value, extraction: strategy };
  }

  return { complete, completeJson, config: cfg, describe: () => ({ ...cfg, apiKey: undefined }) };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Exponential backoff with jitter, capped; `Retry-After` wins when present. */
export function backoffMs(attempt, retryAfterHeader) {
  if (retryAfterHeader) {
    const seconds = Number(retryAfterHeader);
    if (Number.isFinite(seconds) && seconds >= 0) {
      return Math.min(seconds * 1000, MAX_BACKOFF_MS);
    }
    const date = Date.parse(retryAfterHeader);
    if (Number.isFinite(date)) {
      return Math.min(Math.max(date - Date.now(), 0), MAX_BACKOFF_MS);
    }
  }
  const base = Math.min(BASE_BACKOFF_MS * 2 ** (attempt - 1), MAX_BACKOFF_MS);
  // Jitter so a batch of retries does not synchronise into a thundering herd.
  return Math.round(base * (0.5 + Math.random() * 0.5));
}

/**
 * Pull the useful part out of an error response without leaking anything.
 *
 * The body is capped and scrubbed: an upstream gateway that echoes the request
 * (including the Authorization header) back in its error must not be able to
 * write the key into our logs.
 */
async function readErrorDetail(response) {
  try {
    const text = await response.text();
    if (!text) return null;
    let message = text;
    try {
      const parsed = JSON.parse(text);
      message = parsed?.error?.message ?? parsed?.message ?? text;
    } catch {
      // Not JSON -- use the raw body.
    }
    return excerpt(String(message));
  } catch {
    return null;
  }
}

function excerpt(text, limit = 300) {
  const flat = String(text).replace(/\s+/g, ' ').trim();
  const clipped = flat.length > limit ? `${flat.slice(0, limit)}...` : flat;
  return scrubSecrets(clipped);
}

/**
 * Extract a JSON object from model output.
 *
 * @returns {{value: any, strategy: string}}
 */
export function extractJson(text) {
  if (typeof text !== 'string') return { value: undefined, strategy: 'not a string' };

  const trimmed = text.trim();
  if (trimmed.length === 0) return { value: undefined, strategy: 'empty response' };

  // 1. The whole thing is JSON.
  const direct = tryParse(trimmed);
  if (direct.ok) return { value: direct.value, strategy: 'direct' };

  // 2. A fenced block, with or without a language tag.
  const fence = trimmed.match(/```(?:json|JSON)?\s*\n?([\s\S]*?)```/);
  if (fence) {
    const inner = tryParse(fence[1].trim());
    if (inner.ok) return { value: inner.value, strategy: 'code fence' };
  }

  // 3. The first balanced object, scanning with string-awareness so a brace
  //    inside a rationale string does not end the object early.
  const balanced = firstBalancedObject(trimmed);
  if (balanced !== null) {
    const parsed = tryParse(balanced);
    if (parsed.ok) return { value: parsed.value, strategy: 'first balanced object' };
  }

  return { value: undefined, strategy: 'no JSON object found' };
}

function tryParse(text) {
  try {
    const value = JSON.parse(text);
    // A bare array or scalar is valid JSON but not a blueprint; the callers
    // all want an object.
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
      return { ok: false };
    }
    return { ok: true, value };
  } catch {
    return { ok: false };
  }
}

function firstBalancedObject(text) {
  const start = text.indexOf('{');
  if (start === -1) return null;

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = start; i < text.length; i += 1) {
    const ch = text[i];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (ch === '\\') {
      if (inString) escaped = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (ch === '{') depth += 1;
    else if (ch === '}') {
      depth -= 1;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null;
}

/** Combine two abort signals into one, with a `dispose` to release listeners. */
function composeSignals(a, b) {
  if (!a) return { signal: b, dispose: () => {} };
  if (typeof AbortSignal.any === 'function') {
    return { signal: AbortSignal.any([a, b]), dispose: () => {} };
  }
  const controller = new AbortController();
  const onAbort = (signal) => () => controller.abort(signal.reason);
  const fromA = onAbort(a);
  const fromB = onAbort(b);
  if (a.aborted) controller.abort(a.reason);
  else if (b.aborted) controller.abort(b.reason);
  else {
    a.addEventListener('abort', fromA, { once: true });
    b.addEventListener('abort', fromB, { once: true });
  }
  return {
    signal: controller.signal,
    dispose: () => {
      a.removeEventListener('abort', fromA);
      b.removeEventListener('abort', fromB);
    },
  };
}

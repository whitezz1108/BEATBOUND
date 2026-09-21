/**
 * LLM configuration -- read from the environment, never from source.
 *
 * The rules this file exists to enforce (spec §13, §14, §38):
 *   - the API key is read from the environment only; it is never a literal in
 *     this repo, never written into a generated document, and never printed;
 *   - a missing key is not an error until a call is actually attempted, so the
 *     deterministic half of the pipeline (analysis -> context -> compile ->
 *     validate) keeps working on a machine with no credentials at all;
 *   - everything is overridable by environment variable so a different
 *     provider, gateway or model needs no code change.
 *
 * Nothing here reads a file or makes a request -- `describeConfig` is what the
 * editor UI calls to show *whether* a key is present without ever showing it.
 */

/** Default endpoint: DeepSeek's OpenAI-compatible API. */
const DEFAULT_BASE_URL = 'https://api.deepseek.com/v1';
const DEFAULT_MODEL = 'deepseek-chat';
const DEFAULT_TIMEOUT_MS = 120_000;
const DEFAULT_MAX_TOKENS = 8_192;

export const LLM_ENV_VARS = [
  'BEATBOUND_LLM_PROVIDER',
  'BEATBOUND_LLM_BASE_URL',
  'BEATBOUND_LLM_API_KEY',
  'BEATBOUND_LLM_MODEL',
  'BEATBOUND_LLM_TIMEOUT_MS',
  'BEATBOUND_LLM_REASONING_EFFORT',
  'BEATBOUND_LLM_MAX_TOKENS',
];

/** Providers we know how to talk to. All speak the OpenAI chat-completions shape. */
export const KNOWN_PROVIDERS = ['deepseek', 'openai', 'openai_compatible', 'local'];

/**
 * The last four characters of a secret, for diagnostics.
 *
 * Four is enough to tell two keys apart in a log line and far too few to be
 * useful to anyone who reads the log.
 */
export function maskSecret(value) {
  if (typeof value !== 'string' || value.length === 0) return null;
  if (value.length <= 8) return '*'.repeat(value.length);
  return `${'*'.repeat(8)}${value.slice(-4)}`;
}

/** Remove anything that looks like a bearer token from a string. */
export function scrubSecrets(text) {
  if (typeof text !== 'string') return text;
  return (
    text
      // An Authorization header value, however it was spelled and whoever
      // echoed it back. The optional quotes matter: the commonest leak is a
      // gateway serialising the request back as JSON, where the header name
      // arrives as `"authorization":"Bearer sk-..."`.
      .replace(
        /(authorization"?\s*[:=]\s*)(?:"|')?(?:bearer\s+)?[A-Za-z0-9._\-+/=]{8,}/gi,
        '$1[redacted]',
      )
      // A bare bearer token with no header around it.
      .replace(/\bBearer\s+[A-Za-z0-9._\-]{8,}/gi, 'Bearer [redacted]')
      // OpenAI-shaped keys, whatever the provider calls them.
      .replace(/\bsk-[A-Za-z0-9._\-]{8,}/g, 'sk-[redacted]')
  );
}

/**
 * Read the LLM configuration from an environment object.
 *
 * @param {Record<string, string|undefined>} [env]
 * @returns {{
 *   provider: string, baseUrl: string, model: string, apiKey: string|null,
 *   timeoutMs: number, maxTokens: number, reasoningEffort: string|null,
 *   configured: boolean, problems: string[],
 * }}
 */
export function loadLlmConfig(env = process.env) {
  const problems = [];

  const provider = (env.BEATBOUND_LLM_PROVIDER || 'deepseek').trim().toLowerCase();
  if (!KNOWN_PROVIDERS.includes(provider)) {
    problems.push(
      `BEATBOUND_LLM_PROVIDER ${JSON.stringify(provider)} is not one of ${KNOWN_PROVIDERS.join(', ')}`,
    );
  }

  const baseUrl = (env.BEATBOUND_LLM_BASE_URL || DEFAULT_BASE_URL).trim().replace(/\/+$/, '');
  if (!/^https?:\/\//i.test(baseUrl)) {
    problems.push(`BEATBOUND_LLM_BASE_URL ${JSON.stringify(baseUrl)} must be an http(s) URL`);
  }

  const model = (env.BEATBOUND_LLM_MODEL || DEFAULT_MODEL).trim();
  if (model.length === 0) problems.push('BEATBOUND_LLM_MODEL must not be empty');

  // Trim only: a key with a trailing newline is a common copy-paste injury and
  // would otherwise produce a confusing 401.
  const rawKey = env.BEATBOUND_LLM_API_KEY;
  const apiKey = typeof rawKey === 'string' && rawKey.trim().length > 0 ? rawKey.trim() : null;

  const timeoutMs = readPositiveInt(env.BEATBOUND_LLM_TIMEOUT_MS, DEFAULT_TIMEOUT_MS, 'BEATBOUND_LLM_TIMEOUT_MS', problems);
  const maxTokens = readPositiveInt(env.BEATBOUND_LLM_MAX_TOKENS, DEFAULT_MAX_TOKENS, 'BEATBOUND_LLM_MAX_TOKENS', problems);

  const effort = env.BEATBOUND_LLM_REASONING_EFFORT;
  const reasoningEffort =
    typeof effort === 'string' && effort.trim().length > 0 ? effort.trim().toLowerCase() : null;
  if (reasoningEffort !== null && !['low', 'medium', 'high'].includes(reasoningEffort)) {
    problems.push('BEATBOUND_LLM_REASONING_EFFORT must be one of low, medium, high');
  }

  return {
    provider,
    baseUrl,
    model,
    apiKey,
    timeoutMs,
    maxTokens,
    reasoningEffort,
    // A missing key is deliberately NOT a problem here: the pipeline's
    // deterministic half must run without credentials.
    configured: apiKey !== null,
    problems,
    // Recorded from the env this config was built from -- not from
    // `process.env` at describe time, which may be a different object (the
    // editor server builds one config per request, and tests build their own).
    envVarsPresent: LLM_ENV_VARS.filter((name) => {
      const v = env[name];
      return typeof v === 'string' && v.trim().length > 0;
    }),
  };
}

function readPositiveInt(raw, fallback, name, problems) {
  if (raw === undefined || raw === null || String(raw).trim() === '') return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0 || !Number.isInteger(n)) {
    problems.push(`${name} must be a positive integer (got ${JSON.stringify(raw)})`);
    return fallback;
  }
  return n;
}

/**
 * A description of the configuration that is safe to log, print or serve.
 *
 * The key is reported as a mask and a boolean; the value itself never leaves
 * `loadLlmConfig`.
 */
export function describeConfig(config) {
  return {
    provider: config.provider,
    baseUrl: config.baseUrl,
    model: config.model,
    apiKeyPresent: config.apiKey !== null,
    apiKeyMask: maskSecret(config.apiKey),
    timeoutMs: config.timeoutMs,
    maxTokens: config.maxTokens,
    reasoningEffort: config.reasoningEffort,
    configured: config.configured,
    problems: config.problems,
    /** Which env vars this config saw set -- names only, never values. */
    envVarsPresent: config.envVarsPresent ?? [],
  };
}

/** Throw a clear, secret-free error when a call is attempted without a key. */
export function requireApiKey(config) {
  if (config.apiKey === null) {
    throw new Error(
      'no LLM API key configured: set BEATBOUND_LLM_API_KEY in the environment ' +
        '(the deterministic pipeline -- analysis, director context, compile, validate -- ' +
        'runs without one; only AI level direction needs it)',
    );
  }
  return config.apiKey;
}

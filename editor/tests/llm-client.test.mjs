/**
 * The LLM client.
 *
 * Two things are being protected here. The first is behaviour: a transient
 * failure should be retried, a permanent one should not, a timeout should be a
 * timeout, and cancelling should actually stop. The second matters more --
 * **no path may leak the API key**. That includes the paths nobody tests by
 * hand: an upstream gateway echoing the Authorization header back in its error
 * body, a key embedded in a fetch exception, a key in a malformed response.
 * Those get explicit tests.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  createLlmClient,
  extractJson,
  backoffMs,
  LlmError,
  LlmCancelledError,
  LlmTimeoutError,
} from '../generation/llm/client.js';
import {
  loadLlmConfig,
  describeConfig,
  maskSecret,
  scrubSecrets,
  requireApiKey,

} from '../generation/llm/config.js';

const KEY = 'sk-test-abcdefghijklmnopqrstuvwxyz012345';

function testConfig(overrides = {}) {
  return loadLlmConfig({
    BEATBOUND_LLM_API_KEY: KEY,
    BEATBOUND_LLM_BASE_URL: 'https://example.test/v1',
    BEATBOUND_LLM_MODEL: 'test-model',
    BEATBOUND_LLM_TIMEOUT_MS: '5000',
    ...overrides,
  });
}

/** A fetch stub that returns the given responses in order. */
function stubFetch(responses) {
  const calls = [];
  const impl = async (url, init) => {
    calls.push({ url, init, body: JSON.parse(init.body) });
    const next = responses[Math.min(calls.length - 1, responses.length - 1)];
    if (typeof next === 'function') return next(url, init);
    return next;
  };
  impl.calls = calls;
  return impl;
}

function jsonResponse(payload, { status = 200, headers = {} } = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name) => headers[name.toLowerCase()] ?? null },
    json: async () => payload,
    text: async () => JSON.stringify(payload),
  };
}

function textResponse(text, { status = 200, headers = {} } = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name) => headers[name.toLowerCase()] ?? null },
    json: async () => JSON.parse(text),
    text: async () => text,
  };
}

const okPayload = (content) => ({
  model: 'test-model',
  choices: [{ message: { role: 'assistant', content }, finish_reason: 'stop' }],
  usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 },
});

const noSleep = async () => {};

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

test('config falls back to DeepSeek defaults with no environment at all', () => {
  const cfg = loadLlmConfig({});
  assert.equal(cfg.provider, 'deepseek');
  assert.equal(cfg.baseUrl, 'https://api.deepseek.com/v1');
  assert.equal(cfg.model, 'deepseek-chat');
  assert.equal(cfg.apiKey, null);
  assert.equal(cfg.configured, false);
  assert.deepEqual(cfg.problems, [], 'a missing key is not a configuration problem');
});

test('config reads every documented environment variable', () => {
  const cfg = loadLlmConfig({
    BEATBOUND_LLM_PROVIDER: 'openai_compatible',
    BEATBOUND_LLM_BASE_URL: 'https://gateway.internal/v1/',
    BEATBOUND_LLM_API_KEY: KEY,
    BEATBOUND_LLM_MODEL: 'my-model',
    BEATBOUND_LLM_TIMEOUT_MS: '9000',
    BEATBOUND_LLM_MAX_TOKENS: '1234',
    BEATBOUND_LLM_REASONING_EFFORT: 'high',
  });
  assert.equal(cfg.provider, 'openai_compatible');
  assert.equal(cfg.baseUrl, 'https://gateway.internal/v1', 'trailing slash is stripped');
  assert.equal(cfg.model, 'my-model');
  assert.equal(cfg.timeoutMs, 9000);
  assert.equal(cfg.maxTokens, 1234);
  assert.equal(cfg.reasoningEffort, 'high');
  assert.equal(cfg.configured, true);
  assert.deepEqual(cfg.problems, []);
});

test('a key with surrounding whitespace is trimmed, not rejected', () => {
  const cfg = loadLlmConfig({ BEATBOUND_LLM_API_KEY: `  ${KEY}\n` });
  assert.equal(cfg.apiKey, KEY);
});

test('a whitespace-only key counts as absent', () => {
  const cfg = loadLlmConfig({ BEATBOUND_LLM_API_KEY: '   ' });
  assert.equal(cfg.apiKey, null);
  assert.equal(cfg.configured, false);
});

test('bad configuration is reported as problems, not thrown', () => {
  const cfg = loadLlmConfig({
    BEATBOUND_LLM_PROVIDER: 'gemini',
    BEATBOUND_LLM_BASE_URL: 'ftp://nope',
    BEATBOUND_LLM_TIMEOUT_MS: '-5',
    BEATBOUND_LLM_MAX_TOKENS: 'lots',
    BEATBOUND_LLM_REASONING_EFFORT: 'maximum',
  });
  assert.equal(cfg.problems.length, 5);
  assert.ok(cfg.problems.some((p) => p.includes('BEATBOUND_LLM_PROVIDER')));
  assert.ok(cfg.problems.some((p) => p.includes('must be an http(s) URL')));
  assert.ok(cfg.problems.some((p) => p.includes('BEATBOUND_LLM_TIMEOUT_MS')));
  assert.ok(cfg.problems.some((p) => p.includes('BEATBOUND_LLM_MAX_TOKENS')));
  assert.ok(cfg.problems.some((p) => p.includes('REASONING_EFFORT')));
  // The fallbacks are still usable so the caller can report and continue.
  assert.equal(cfg.timeoutMs, 120_000);
});

test('requireApiKey explains what to do and never echoes a key', () => {
  const cfg = loadLlmConfig({});
  assert.throws(
    () => requireApiKey(cfg),
    (err) => {
      assert.match(err.message, /BEATBOUND_LLM_API_KEY/);
      assert.match(err.message, /runs without one/);
      return true;
    },
  );
});

// ---------------------------------------------------------------------------
// Secret handling
// ---------------------------------------------------------------------------

test('maskSecret keeps only the last four characters', () => {
  assert.equal(maskSecret(KEY), `********${KEY.slice(-4)}`);
  assert.equal(maskSecret('short'), '*****');
  assert.equal(maskSecret(''), null);
  assert.equal(maskSecret(null), null);
});

test('scrubSecrets removes bearer tokens however they are spelled', () => {
  assert.equal(scrubSecrets(`authorization: Bearer ${KEY}`), 'authorization: [redacted]');
  assert.equal(scrubSecrets(`Authorization=${KEY}`), 'Authorization=[redacted]');
  assert.equal(scrubSecrets(`Bearer ${KEY}`), 'Bearer [redacted]');
  assert.equal(scrubSecrets(`key is ${KEY} ok`), 'key is sk-[redacted] ok');
});

test('describeConfig never includes the key, only a mask', () => {
  const described = describeConfig(loadLlmConfig({ BEATBOUND_LLM_API_KEY: KEY }));
  const serialised = JSON.stringify(described);
  assert.ok(!serialised.includes(KEY), 'the raw key must not appear anywhere in the description');
  assert.equal(described.apiKeyPresent, true);
  assert.equal(described.apiKeyMask, `********${KEY.slice(-4)}`);
});

test('describeConfig reports which env vars are set, by name only', () => {
  const described = describeConfig(
    loadLlmConfig({ BEATBOUND_LLM_API_KEY: KEY, BEATBOUND_LLM_MODEL: 'm' }),
  );
  assert.deepEqual(
    described.envVarsPresent,
    ['BEATBOUND_LLM_API_KEY', 'BEATBOUND_LLM_MODEL'],
    'exactly the vars that were set, in the documented order',
  );
});

test('envVarsPresent reflects the env the config was built from, not process.env', () => {
  // The editor server builds one config per request from a merged env; a
  // description that quietly consulted process.env instead would report vars
  // the caller never supplied.
  const described = describeConfig(loadLlmConfig({ BEATBOUND_LLM_PROVIDER: 'local' }));
  assert.deepEqual(described.envVarsPresent, ['BEATBOUND_LLM_PROVIDER']);
});

// ---------------------------------------------------------------------------
// Request shape
// ---------------------------------------------------------------------------

test('a successful call sends the right request and returns the text', async () => {
  const fetchImpl = stubFetch([jsonResponse(okPayload('hello'))]);
  const client = createLlmClient({ config: testConfig(), fetchImpl, sleep: noSleep });

  const result = await client.complete({
    system: 'you are a director',
    messages: [{ role: 'user', content: 'plan this' }],
  });

  assert.equal(result.text, 'hello');
  assert.equal(result.model, 'test-model');
  assert.equal(result.attempts, 1);
  assert.equal(result.finishReason, 'stop');
  assert.deepEqual(result.usage, { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 });

  const [call] = fetchImpl.calls;
  assert.equal(call.url, 'https://example.test/v1/chat/completions');
  assert.equal(call.init.method, 'POST');
  assert.equal(call.init.headers.authorization, `Bearer ${KEY}`);
  assert.equal(call.body.model, 'test-model');
  assert.equal(call.body.stream, false);
  assert.deepEqual(call.body.messages.map((m) => m.role), ['system', 'user']);
});

test('json mode sets response_format', async () => {
  const fetchImpl = stubFetch([jsonResponse(okPayload('{}'))]);
  const client = createLlmClient({ config: testConfig(), fetchImpl, sleep: noSleep });
  await client.complete({ messages: [{ role: 'user', content: 'x' }], json: true });
  assert.deepEqual(fetchImpl.calls[0].body.response_format, { type: 'json_object' });
});

test('reasoning_effort is only sent when configured', async () => {
  const fetchImpl = stubFetch([jsonResponse(okPayload('x'))]);
  const client = createLlmClient({ config: testConfig(), fetchImpl, sleep: noSleep });
  await client.complete({ messages: [{ role: 'user', content: 'x' }] });
  assert.equal(fetchImpl.calls[0].body.reasoning_effort, undefined);

  const fetchImpl2 = stubFetch([jsonResponse(okPayload('x'))]);
  const client2 = createLlmClient({
    config: testConfig({ BEATBOUND_LLM_REASONING_EFFORT: 'high' }), fetchImpl: fetchImpl2, sleep: noSleep,
  });
  await client2.complete({ messages: [{ role: 'user', content: 'x' }] });
  assert.equal(fetchImpl2.calls[0].body.reasoning_effort, 'high');
});

test('calling without a key throws before any request is made', async () => {
  const fetchImpl = stubFetch([jsonResponse(okPayload('x'))]);
  const client = createLlmClient({ config: loadLlmConfig({}), fetchImpl, sleep: noSleep });
  await assert.rejects(
    () => client.complete({ messages: [{ role: 'user', content: 'x' }] }),
    /no LLM API key configured/,
  );
  assert.equal(fetchImpl.calls.length, 0, 'no request should have been attempted');
});

// ---------------------------------------------------------------------------
// Retries
// ---------------------------------------------------------------------------

test('a 429 is retried and can succeed on a later attempt', async () => {
  const fetchImpl = stubFetch([
    jsonResponse({ error: { message: 'rate limited' } }, { status: 429 }),
    jsonResponse(okPayload('finally')),
  ]);
  const client = createLlmClient({ config: testConfig(), fetchImpl, sleep: noSleep });
  const result = await client.complete({ messages: [{ role: 'user', content: 'x' }] });
  assert.equal(result.text, 'finally');
  assert.equal(result.attempts, 2);
  assert.equal(fetchImpl.calls.length, 2);
});

test('a 500 is retried', async () => {
  const fetchImpl = stubFetch([
    jsonResponse({ error: { message: 'boom' } }, { status: 500 }),
    jsonResponse(okPayload('ok')),
  ]);
  const client = createLlmClient({ config: testConfig(), fetchImpl, sleep: noSleep });
  assert.equal((await client.complete({ messages: [] })).attempts, 2);
});

test('a 401 is not retried -- the key is wrong, retrying spends the same failure', async () => {
  const fetchImpl = stubFetch([jsonResponse({ error: { message: 'invalid key' } }, { status: 401 })]);
  const client = createLlmClient({ config: testConfig(), fetchImpl, sleep: noSleep });
  await assert.rejects(
    () => client.complete({ messages: [] }),
    (err) => {
      assert.ok(err instanceof LlmError);
      assert.equal(err.status, 401);
      assert.equal(err.retryable, false);
      return true;
    },
  );
  assert.equal(fetchImpl.calls.length, 1);
});

test('a 400 is not retried', async () => {
  const fetchImpl = stubFetch([jsonResponse({ error: { message: 'bad request' } }, { status: 400 })]);
  const client = createLlmClient({ config: testConfig(), fetchImpl, sleep: noSleep });
  await assert.rejects(() => client.complete({ messages: [] }), /HTTP 400/);
  assert.equal(fetchImpl.calls.length, 1);
});

test('retries stop at maxAttempts and surface the last error', async () => {
  const fetchImpl = stubFetch([jsonResponse({ error: { message: 'down' } }, { status: 503 })]);
  const client = createLlmClient({ config: testConfig(), fetchImpl, sleep: noSleep, maxAttempts: 3 });
  await assert.rejects(() => client.complete({ messages: [] }), /HTTP 503/);
  assert.equal(fetchImpl.calls.length, 3);
});

test('a network error is retried and then reported', async () => {
  let n = 0;
  const fetchImpl = async () => {
    n += 1;
    throw new Error('ECONNRESET');
  };
  const client = createLlmClient({ config: testConfig(), fetchImpl, sleep: noSleep, maxAttempts: 2 });
  await assert.rejects(() => client.complete({ messages: [] }), /ECONNRESET/);
  assert.equal(n, 2);
});

test('backoff honours Retry-After and stays under the cap', () => {
  assert.equal(backoffMs(1, '2'), 2000);
  assert.equal(backoffMs(1, '9999'), 30_000, 'capped');
  assert.ok(backoffMs(1, null) > 0);
  assert.ok(backoffMs(1, null) <= 1000, 'first backoff is at most the base');
  assert.ok(backoffMs(4, null) <= 30_000);
  // A garbage Retry-After falls back to exponential.
  assert.ok(backoffMs(1, 'soon') > 0);
});

// ---------------------------------------------------------------------------
// Timeout and cancellation
// ---------------------------------------------------------------------------

test('a request that outlives the timeout raises a timeout error', async () => {
  const fetchImpl = (url, init) =>
    new Promise((_, reject) => {
      init.signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
    });
  const client = createLlmClient({
    config: testConfig({ BEATBOUND_LLM_TIMEOUT_MS: '20' }),
    fetchImpl,
    sleep: noSleep,
    maxAttempts: 1,
  });
  await assert.rejects(() => client.complete({ messages: [] }), (err) => {
    assert.ok(err instanceof LlmTimeoutError);
    assert.match(err.message, /timed out after 20 ms/);
    return true;
  });
});

test('cancelling via AbortSignal raises a cancellation error', async () => {
  const controller = new AbortController();
  const fetchImpl = (url, init) =>
    new Promise((_, reject) => {
      init.signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
    });
  const client = createLlmClient({ config: testConfig(), fetchImpl, sleep: noSleep, maxAttempts: 3 });

  const pending = client.complete({ messages: [], signal: controller.signal });
  controller.abort();
  await assert.rejects(() => pending, (err) => {
    assert.ok(err instanceof LlmCancelledError);
    return true;
  });
});

test('an already-aborted signal fails without making a request', async () => {
  const controller = new AbortController();
  controller.abort();
  const fetchImpl = stubFetch([jsonResponse(okPayload('x'))]);
  const client = createLlmClient({ config: testConfig(), fetchImpl, sleep: noSleep });
  await assert.rejects(
    () => client.complete({ messages: [], signal: controller.signal }),
    (err) => err instanceof LlmCancelledError,
  );
  assert.equal(fetchImpl.calls.length, 0);
});

// ---------------------------------------------------------------------------
// Secret leakage through error paths
// ---------------------------------------------------------------------------

test('an upstream error that echoes the Authorization header does not leak the key', async () => {
  // The realistic version of this: a proxy in front of the model rejects the
  // request and helpfully includes the whole request in its error body.
  const echoed = JSON.stringify({
    error: { message: `Unauthorized. Request headers: {"authorization":"Bearer ${KEY}"}` },
  });
  const fetchImpl = stubFetch([textResponse(echoed, { status: 401 })]);
  const client = createLlmClient({ config: testConfig(), fetchImpl, sleep: noSleep });

  await assert.rejects(
    () => client.complete({ messages: [] }),
    (err) => {
      assert.ok(!err.message.includes(KEY), `the key leaked into the error: ${err.message}`);
      assert.ok(!JSON.stringify(err).includes(KEY), 'the key leaked into the serialised error');
      assert.match(err.message, /\[redacted\]/);
      return true;
    },
  );
});

test('a key embedded in a fetch exception does not leak', async () => {
  const fetchImpl = async () => {
    throw new Error(`failed to connect using Bearer ${KEY}`);
  };
  const client = createLlmClient({ config: testConfig(), fetchImpl, sleep: noSleep, maxAttempts: 1 });
  await assert.rejects(
    () => client.complete({ messages: [] }),
    (err) => {
      assert.ok(!err.message.includes(KEY));
      assert.ok(!String(err.cause?.message ?? '').includes(KEY), 'the key leaked into the cause');
      return true;
    },
  );
});

test('an error body is truncated before it reaches the message', async () => {
  const huge = 'x'.repeat(5000);
  const fetchImpl = stubFetch([textResponse(JSON.stringify({ error: { message: huge } }), { status: 500 })]);
  const client = createLlmClient({ config: testConfig(), fetchImpl, sleep: noSleep, maxAttempts: 1 });
  await assert.rejects(
    () => client.complete({ messages: [] }),
    (err) => {
      assert.ok(err.message.length < 500, `the error body was not truncated (${err.message.length} chars)`);
      return true;
    },
  );
});

// ---------------------------------------------------------------------------
// JSON extraction
// ---------------------------------------------------------------------------

test('a plain JSON object is parsed directly', () => {
  assert.deepEqual(extractJson('{"a":1}'), { value: { a: 1 }, strategy: 'direct' });
});

test('a fenced JSON block is unwrapped', () => {
  assert.deepEqual(extractJson('```json\n{"a":1}\n```'), { value: { a: 1 }, strategy: 'code fence' });
  assert.deepEqual(extractJson('```\n{"a":1}\n```'), { value: { a: 1 }, strategy: 'code fence' });
});

test('JSON surrounded by prose is extracted', () => {
  const text = 'Here is the plan you asked for:\n{"a":1}\nLet me know if you want changes.';
  assert.deepEqual(extractJson(text), { value: { a: 1 }, strategy: 'first balanced object' });
});

test('braces inside strings do not end the object early', () => {
  const text = 'sure: {"rationale":"the {drop} hits hard","n":1} done';
  assert.deepEqual(extractJson(text), {
    value: { rationale: 'the {drop} hits hard', n: 1 },
    strategy: 'first balanced object',
  });
});

test('escaped quotes inside strings are handled', () => {
  const text = '{"a":"he said \\"hi\\" {x}"}';
  assert.deepEqual(extractJson(text).value, { a: 'he said "hi" {x}' });
});

test('a bare array is not accepted as a blueprint', () => {
  assert.equal(extractJson('[1,2,3]').value, undefined);
});

test('a bare scalar is not accepted', () => {
  assert.equal(extractJson('42').value, undefined);
});

test('prose with no JSON reports why', () => {
  const { value, strategy } = extractJson('I cannot help with that.');
  assert.equal(value, undefined);
  assert.equal(strategy, 'no JSON object found');
});

test('unterminated JSON is reported rather than half-parsed', () => {
  const { value, strategy } = extractJson('{"a": 1, "b":');
  assert.equal(value, undefined);
  assert.equal(strategy, 'no JSON object found');
});

test('completeJson returns the parsed object alongside the usage', async () => {
  const fetchImpl = stubFetch([jsonResponse(okPayload('```json\n{"sections":[]}\n```'))]);
  const client = createLlmClient({ config: testConfig(), fetchImpl, sleep: noSleep });
  const result = await client.completeJson({ messages: [{ role: 'user', content: 'x' }] });
  assert.deepEqual(result.json, { sections: [] });
  assert.equal(result.extraction, 'code fence');
  assert.equal(result.usage.total_tokens, 150);
});

test('completeJson on unparseable output fails with a scrubbed excerpt', async () => {
  const fetchImpl = stubFetch([jsonResponse(okPayload('I refuse.'))]);
  const client = createLlmClient({ config: testConfig(), fetchImpl, sleep: noSleep });
  await assert.rejects(
    () => client.completeJson({ messages: [] }),
    (err) => {
      assert.match(err.message, /did not return parseable JSON/);
      assert.match(err.message, /I refuse\./);
      return true;
    },
  );
});

test('a response with no choices is an error, not a crash', async () => {
  const fetchImpl = stubFetch([jsonResponse({ model: 'm', choices: [] })]);
  const client = createLlmClient({ config: testConfig(), fetchImpl, sleep: noSleep });
  await assert.rejects(() => client.complete({ messages: [] }), /contained no message content/);
});

test('a non-JSON 200 response is an error, not a crash', async () => {
  const fetchImpl = stubFetch([
    {
      ok: true, status: 200,
      headers: { get: () => null },
      json: async () => { throw new Error('Unexpected token <'); },
      text: async () => '<html>',
    },
  ]);
  const client = createLlmClient({ config: testConfig(), fetchImpl, sleep: noSleep });
  await assert.rejects(() => client.complete({ messages: [] }), /was not valid JSON/);
});

test('the client exposes its config with the key stripped', () => {
  const client = createLlmClient({ config: testConfig(), fetchImpl: stubFetch([]), sleep: noSleep });
  assert.equal(client.describe().apiKey, undefined);
  assert.ok(!JSON.stringify(client.describe()).includes(KEY));
});

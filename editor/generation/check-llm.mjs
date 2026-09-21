/**
 * Connectivity check for the LLM director: `npm run llm-check`.
 *
 * Sends the smallest possible request to the configured endpoint and reports
 * what came back. It exists because the failure modes here are indistinguishable
 * from each other by their surface symptoms -- a wrong host, a wrong model id, a
 * bad key and a blocked network all surface as "the generation did not work".
 * This says which one it is, in one call, without spending a real generation.
 *
 * It never prints the key: only whether one is present and its last four
 * characters.
 *
 * Usage:
 *   npm run llm-check
 *   npm run llm-check -- --model some-other-model
 */

import { loadLlmConfig, describeConfig } from './llm/config.js';
import { createLlmClient } from './llm/client.js';

const args = process.argv.slice(2);
const modelArg = args.indexOf('--model');
if (modelArg !== -1 && args[modelArg + 1]) {
  process.env.BEATBOUND_LLM_MODEL = args[modelArg + 1];
}

const config = loadLlmConfig();
const shown = describeConfig(config);

console.log('Configuration');
console.log(`  provider   ${shown.provider}`);
console.log(`  base URL   ${shown.baseUrl}`);
console.log(`  model      ${shown.model}`);
console.log(`  key        ${shown.apiKeyPresent ? `present (${shown.apiKeyMask})` : 'MISSING'}`);
console.log(`  env vars   ${shown.envVarsPresent.join(', ') || '(none)'}`);
for (const problem of shown.problems) console.log(`  problem    ${problem}`);
console.log('');

if (!shown.apiKeyPresent) {
  console.log('No key. Set BEATBOUND_LLM_API_KEY in .env (see .env.example).');
  process.exit(1);
}

console.log(`POST ${shown.baseUrl}/chat/completions`);
console.log('');

const client = createLlmClient({ config });

try {
  const res = await client.complete({
    messages: [{ role: 'user', content: 'Reply with exactly the word: PONG' }],
    temperature: 0,
    // Deliberately generous for a one-word answer. Reasoning models bill their
    // thinking against max_tokens, so a tight cap here is spent before the
    // first output token and comes back as an empty reply with
    // finish_reason "length" -- which reads like a failure but is not one.
    maxTokens: 2000,
  });
  console.log('OK -- the endpoint answered.');
  console.log(`  model      ${res.model}`);
  console.log(`  reply      ${JSON.stringify(res.text.trim().slice(0, 120))}`);
  console.log(`  latency    ${res.latencyMs}ms (attempts: ${res.attempts})`);
  console.log(`  finish     ${res.finishReason}`);

  const reasoning = res.usage?.completion_tokens_details?.reasoning_tokens;
  if (res.finishReason === 'length' && res.text.trim() === '') {
    console.log('');
    console.log('  Note: the reply is empty because the model used its whole budget');
    console.log(`  thinking (${reasoning ?? '?'} reasoning tokens). The endpoint and key are`);
    console.log('  fine -- this only means BEATBOUND_LLM_MAX_TOKENS is too low for a');
    console.log('  real generation, which needs ~32000.');
  }
  console.log('');
  console.log('The director is ready. Generate a level from the editor, or:');
  console.log('  npm run generate -- --preset arena_primary --seed 5');
} catch (err) {
  const message = String(err?.message ?? err);
  const cause = err?.cause?.code ?? err?.cause?.message ?? '';
  console.log('FAILED.');
  console.log(`  ${message}`);
  if (cause) console.log(`  underlying: ${cause}`);
  console.log('');
  if (/ENOTFOUND|EAI_AGAIN/.test(message + cause)) {
    console.log('The hostname in BEATBOUND_LLM_BASE_URL does not resolve.');
    console.log('Check the exact host in your provider console -- it is usually');
    console.log('shown next to the API key, and is easy to mistype.');
  } else if (/401|403|Unauthorized|invalid.*key/i.test(message)) {
    console.log('The endpoint is reachable but rejected the key.');
    console.log('Check BEATBOUND_LLM_API_KEY is the whole key, with no quotes');
    console.log('and no trailing spaces.');
  } else if (/404|model/i.test(message)) {
    console.log('The endpoint is reachable but did not accept the model id.');
    console.log(`Try: npm run llm-check -- --model <exact-id-from-console>`);
  } else if (/timeout|ETIMEDOUT|aborted/i.test(message)) {
    console.log('The endpoint did not answer in time.');
    console.log('Raise BEATBOUND_LLM_TIMEOUT_MS, or check for a proxy.');
  }
  process.exit(1);
}

/**
 * The editor server's HTTP contract with its own UI.
 *
 * The UI is vanilla JS with no build step and no tests, so a route that quietly
 * changes shape breaks the panel with nothing to catch it. These tests bind the
 * real server on an ephemeral port and assert on what each route the panel
 * calls actually returns -- the fields it reads, by name.
 *
 * They also pin the two security-relevant behaviours that are easy to lose in a
 * refactor: a key is never echoed, and a level id cannot walk out of
 * editor/output/.
 */

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const PORT = 5399; // deliberately not the editor's 5174, so a running editor is untouched
const BASE = `http://127.0.0.1:${PORT}`;
const PROBE_KEY = 'sk-probe0000000000000000000000wxyz';

let child;

/** Poll until the server answers, so a slow start is not a test failure. */
async function waitForServer(timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${BASE}/api/state`);
      if (res.ok) return;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 150));
  }
  throw new Error('the editor server did not come up');
}

before(async () => {
  child = spawn(process.execPath, ['editor/server/server.mjs'], {
    cwd: ROOT,
    env: {
      ...process.env,
      EDITOR_PORT: String(PORT),
      // A fake key: what matters is that the server sees one, so the masking
      // path is exercised. It authenticates against nothing.
      BEATBOUND_LLM_API_KEY: PROBE_KEY,
      BEATBOUND_LLM_MODEL: 'probe-model',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stderr.on('data', (d) => process.stderr.write(`[server] ${d}`));
  await waitForServer();
});

after(() => {
  child?.kill();
});

const getJson = async (path) => {
  const res = await fetch(`${BASE}${path}`);
  return { status: res.status, body: await res.json() };
};

// ---------------------------------------------------------------------------
// The routes the panel calls
// ---------------------------------------------------------------------------

test('/api/state carries what the V2 panel reads', async () => {
  const { status, body } = await getJson('/api/state');
  assert.equal(status, 200);
  for (const key of ['hasDirectorContextV2', 'tuningMirror', 'tuning', 'consistencyNotes']) {
    assert.ok(key in body, `/api/state is missing ${key}`);
  }
  // The mirror keeps the flat shape the UI reads, plus the resolved tuning.
  assert.equal(typeof body.tuningMirror.breatherBeats, 'number');
  assert.equal(typeof body.tuning.breatherBeats, 'number');
  assert.equal(body.tuning.breatherBeats, body.tuningMirror.breatherBeats);
});

// The canvases read these off whatever `/api/state` last put in `state.analysis`.
// It used to send a *summary* -- `bars` was the bar COUNT -- so `for (const b of
// state.analysis.bars)` in drawTimeline() threw "number 0 is not iterable" and
// the whole AI GENERATE run was reported as failed. Pin the real shape.
test('/api/state and /api/analysis agree on the analysis shape the canvases read', async () => {
  const { body: st } = await getJson('/api/state');
  const { body: full } = await getJson('/api/analysis');
  assert.ok(st.analysis, '/api/state reported no analysis; the editor has none loaded');
  assert.deepEqual(st.analysis, full, '/api/state must serve the same object as /api/analysis');

  assert.ok(Array.isArray(st.analysis.bars), 'analysis.bars must be the per-bar array, not a count');
  assert.ok(st.analysis.bars.length > 0);
  assert.equal(typeof st.analysis.bars[0].energy, 'number', 'the timeline heat strip reads bars[].energy');
  assert.ok(Array.isArray(st.analysis.tempo.timeSignature), 'the canvases read tempo.timeSignature[0]');
  assert.ok(Array.isArray(st.analysis.sections), 'the canvases iterate sections');
  assert.equal(typeof st.analysis.song.durationSec, 'number');
});

test('/api/presets lists presets the panel can render', async () => {
  const { status, body } = await getJson('/api/presets');
  assert.equal(status, 200);
  assert.ok(Array.isArray(body.presets) && body.presets.length > 0);
  for (const preset of body.presets) {
    for (const key of ['id', 'name', 'description', 'primary_mode', 'allowed_modes', 'target_difficulty', 'primary_mode_ratio']) {
      assert.ok(key in preset, `preset ${preset.id} is missing ${key}`);
    }
  }
  assert.deepEqual(body.ids, body.presets.map((p) => p.id));
});

test('/api/llm/status reports the key as a mask, never the key', async () => {
  const { status, body } = await getJson('/api/llm/status');
  assert.equal(status, 200);
  assert.equal(body.apiKeyPresent, true, 'the probe key should be seen');
  assert.equal(body.apiKeyMask, '********wxyz');
  assert.equal(body.model, 'probe-model');
  // The whole response, serialised, must not contain the key.
  assert.ok(!JSON.stringify(body).includes(PROBE_KEY), 'the API key leaked into /api/llm/status');
});

test('/api/gameplay-context answers for a mode pair', async () => {
  const { status, body } = await getJson('/api/gameplay-context?primary_mode=ARENA&allowed_modes=ARENA,RUNNER');
  assert.equal(status, 200);
  assert.equal(body.schema_version, 'beatbound_gameplay_generation_context_v1');
});

test('/api/manifest refuses a path that escapes the output directory', async () => {
  for (const id of ['../../package.json', '..%2F..%2Fpackage.json', '..\\..\\package.json']) {
    const res = await fetch(`${BASE}/api/manifest?level_id=${id}`);
    assert.equal(res.status, 404, `${id} should not resolve to a file`);
  }
});

test('/api/manifest requires an id', async () => {
  const { status, body } = await getJson('/api/manifest');
  assert.equal(status, 400);
  assert.match(body.error, /level_id/);
});

test('an unknown route is a 404, not a crash', async () => {
  const res = await fetch(`${BASE}/api/nope`);
  assert.equal(res.status, 404);
});

// ---------------------------------------------------------------------------
// generate-level: the streaming contract
// ---------------------------------------------------------------------------

test('generate-level streams a structured error for a bad request, and spends nothing', async () => {
  const res = await fetch(`${BASE}/api/generate-level`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ preset: 'no_such_preset' }),
  });
  assert.equal(res.status, 200); // the stream itself opened
  assert.match(res.headers.get('content-type'), /ndjson/);

  const lines = (await res.text()).trim().split('\n').map((l) => JSON.parse(l));
  const error = lines.find((l) => l.type === 'error');
  assert.ok(error, 'a bad preset should come back as an error event');
  assert.match(error.error, /no_such_preset/);
  // Refused before the model: no director event, no result.
  assert.ok(!lines.some((l) => l.stage === 'director'));
  assert.ok(!lines.some((l) => l.type === 'result'));
});

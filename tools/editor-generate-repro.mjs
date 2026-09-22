/**
 * Reproduce the editor's AI GENERATE click in headless Chrome and capture the
 * real stack trace of anything it throws.
 *
 * The panel reports a failed run as `generate-level failed: <message>`, and a
 * message alone has been misleading: several different call sites can produce
 * `number N is not iterable`, and only the stack says which. So this drives the
 * genuine button click -- form state, NDJSON parsing, result handling, the
 * refresh that follows -- and pauses the debugger on the throw.
 *
 * The model call is bypassed by injecting a `blueprint` into the request body:
 * `/api/generate-level` then takes the "supplied blueprint -- layer 3 skipped"
 * path. Everything downstream of the model is still exercised, which is where
 * the failure lives. Pass --live to call the model for real.
 *
 *   node tools/editor-generate-repro.mjs [url] [--live]
 */

import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const args = process.argv.slice(2);
const LIVE = args.includes('--live');
const URL_TO_LOAD = args.find((a) => a.startsWith('http')) ?? 'http://127.0.0.1:5174/';
const CHROME =
  process.env.CHROME_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PORT = 9334;

const profile = mkdtempSync(join(tmpdir(), 'bb-generate-repro-'));
const chrome = spawn(
  CHROME,
  [
    '--headless=new',
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${profile}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-gpu',
    'about:blank',
  ],
  { stdio: 'ignore' },
);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function targetUrl() {
  for (let i = 0; i < 100; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      const page = list.find((t) => t.type === 'page');
      if (page?.webSocketDebuggerUrl) return page.webSocketDebuggerUrl;
    } catch {
      // not up yet
    }
    await sleep(100);
  }
  throw new Error('headless Chrome never exposed a page target');
}

const ws = new WebSocket(await targetUrl());
await new Promise((resolve, reject) => {
  ws.onopen = resolve;
  ws.onerror = reject;
});

let nextId = 1;
const pending = new Map();
const consoleErrors = [];
const pageErrors = [];
/** Every throw the debugger paused on, with its stack. */
const throws = [];

ws.onmessage = (event) => {
  const msg = JSON.parse(event.data);
  if (msg.id && pending.has(msg.id)) {
    pending.get(msg.id)(msg.result);
    pending.delete(msg.id);
    return;
  }
  if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') {
    consoleErrors.push(msg.params.args.map((a) => a.value ?? a.description).join(' '));
  }
  if (msg.method === 'Runtime.exceptionThrown') {
    const d = msg.params.exceptionDetails;
    pageErrors.push(d.exception?.description ?? d.text);
  }
  if (msg.method === 'Debugger.paused') {
    const p = msg.params;
    const desc = p.data?.description ?? p.data?.value ?? '';
    throws.push({
      reason: p.data?.className ? `${p.data.className}: ${desc}` : String(desc),
      frames: p.callFrames.slice(0, 8).map((f) => {
        const url = (f.url || '').replace(URL_TO_LOAD.replace(/\/$/, ''), '');
        return `${f.functionName || '(anonymous)'} @ ${url || f.location?.scriptId}:${(f.location?.lineNumber ?? 0) + 1}`;
      }),
    });
    ws.send(JSON.stringify({ id: nextId++, method: 'Debugger.resume', params: {} }));
  }
};

const send = (method, params = {}, timeoutMs = 15_000) =>
  new Promise((resolve) => {
    const id = nextId++;
    const timer = setTimeout(() => {
      pending.delete(id);
      resolve({ __timeout: `${method} did not answer within ${timeoutMs}ms` });
    }, timeoutMs);
    pending.set(id, (result) => {
      clearTimeout(timer);
      resolve(result);
    });
    ws.send(JSON.stringify({ id, method, params }));
  });

const evaluate = async (expression, awaitPromise = true) => {
  const reply = await send('Runtime.evaluate', {
    expression,
    returnByValue: true,
    awaitPromise,
  });
  if (reply.__timeout) return { __error: reply.__timeout };
  if (reply.exceptionDetails) {
    return { __error: reply.exceptionDetails.exception?.description ?? 'eval failed' };
  }
  return reply.result.value;
};

await send('Runtime.enable');
await send('Debugger.enable');
await send('Page.enable');
await send('Page.navigate', { url: URL_TO_LOAD });
await sleep(4000);

// Pause on every throw so the TypeError's stack is captured before the panel's
// catch swallows it.
await send('Debugger.setPauseOnExceptions', { state: 'all' });

console.log('mode:', LIVE ? 'live -- the model will be called' : 'blueprint injected -- the model is skipped');

if (!LIVE) {
  // Give the request a blueprint so layer 3 is skipped: the model is not the
  // suspect, and a real call costs minutes.
  const injected = await evaluate(`(async () => {
    const bp = await (await fetch('/api/blueprint')).json().catch(() => null);
    if (!bp || !bp.sections) return 'no blueprint available at /api/blueprint';
    const orig = window.fetch;
    window.fetch = (input, init) => {
      const url = typeof input === 'string' ? input : input.url;
      if (url.includes('/api/generate-level') && init?.body) {
        const body = JSON.parse(init.body);
        body.blueprint = bp;
        init = { ...init, body: JSON.stringify(body) };
      }
      return orig(input, init);
    };
    return 'blueprint injected (' + bp.sections.length + ' sections)';
  })()`);
  console.log('setup:', JSON.stringify(injected));
}

// The real thing: click the button the user clicks.
const clicked = await evaluate(
  `(() => {
    const b = document.getElementById('v2-generate');
    if (!b) return 'no #v2-generate button';
    if (b.disabled) return 'button is disabled: ' + (document.getElementById('v2-status')?.textContent ?? '');
    b.click();
    return 'clicked';
  })()`,
  false,
);
console.log('click:', JSON.stringify(clicked));

// Poll the panel's own status line rather than guessing a duration.
let status = null;
for (let i = 0; i < 240; i++) {
  await sleep(1000);
  status = await evaluate(`document.getElementById('status-msg')?.textContent ?? null`, false);
  if (typeof status === 'string' && /failed|ready to playtest|generated/.test(status)) break;
}

const log = await evaluate(
  `[...(document.getElementById('v2-log')?.children ?? [])].map((d) => d.textContent).join('\\n')`,
  false,
);

ws.close();
chrome.kill();
await sleep(500);
try {
  rmSync(profile, { recursive: true, force: true });
} catch {
  // best effort
}

console.log('');
console.log('status:', JSON.stringify(status));
console.log('');
console.log('--- panel log ---');
console.log(log || '(empty)');
console.log('');
console.log('--- throws seen ---');
console.log(JSON.stringify(throws, null, 2));
console.log('');
console.log('consoleErrors:', JSON.stringify(consoleErrors, null, 2));
console.log('pageErrors:', JSON.stringify(pageErrors, null, 2));

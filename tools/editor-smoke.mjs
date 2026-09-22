/**
 * Editor UI smoke test: load the panel in headless Chrome, let it settle, and
 * report anything the page threw or failed to fetch.
 *
 * The panel is vanilla JS with no build step, so a server/UI shape mismatch
 * shows up only as a runtime TypeError in the browser. This drives the real
 * page over the DevTools protocol -- `--dump-dom` captures the DOM before the
 * async init() finishes and reports a false all-clear.
 *
 *   node tools/editor-smoke.mjs [url]
 */

import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const URL_TO_LOAD = process.argv[2] ?? 'http://127.0.0.1:5174/';
const CHROME =
  process.env.CHROME_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PORT = 9333;

const profile = mkdtempSync(join(tmpdir(), 'bb-editor-smoke-'));
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

/** The DevTools websocket URL for the first page target. */
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
const failedRequests = [];

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
  if (msg.method === 'Network.loadingFailed') {
    failedRequests.push(`${msg.params.type} ${msg.params.errorText}`);
  }
  if (msg.method === 'Network.responseReceived' && msg.params.response.status >= 400) {
    // The browser probes /favicon.ico on its own; the editor has never served one.
    if (!msg.params.response.url.endsWith('/favicon.ico')) {
      failedRequests.push(`HTTP ${msg.params.response.status} ${msg.params.response.url}`);
    }
  }
};

// Every call is bounded: a page that blocks its own JS thread (an infinite
// redraw loop, say) never answers, and an unbounded await here would hang the
// whole check with no output at all.
const send = (method, params = {}, timeoutMs = 10_000) =>
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

await send('Runtime.enable');
await send('Network.enable');
await send('Page.enable');
await send('Page.navigate', { url: URL_TO_LOAD });
await sleep(4000); // init() awaits five API calls, then draws the canvases
const evaluate = async (expression) => {
  const reply = await send('Runtime.evaluate', {
    expression,
    returnByValue: true,
    awaitPromise: true,
  });
  if (reply.__timeout) return { error: reply.__timeout };
  const { result, exceptionDetails } = reply;
  if (exceptionDetails) throw new Error(exceptionDetails.exception?.description ?? 'eval failed');
  return result.value;
};

const report = await evaluate(`(() => {
  const cv = document.getElementById('timeline-canvas');
  let painted = 0;
  if (cv) {
    const ctx = cv.getContext('2d');
    const d = ctx.getImageData(0, 0, cv.width, cv.height).data;
    for (let i = 3; i < d.length; i += 4) if (d[i] > 0) painted++;
  }
  return {
    status: document.getElementById('status-msg')?.textContent ?? null,
    songStats: document.getElementById('song-stats')?.textContent ?? null,
    bpmLabel: document.getElementById('song-bpm-label')?.textContent ?? null,
    timelinePainted: painted,
    timelinePixels: cv ? cv.width * cv.height : 0,
  };
})()`);

ws.close();
chrome.kill();

console.log(JSON.stringify({ ...report, consoleErrors, pageErrors, failedRequests }, null, 2));

// Chrome still holds the profile open for a moment after SIGTERM; a leftover
// temp dir is not a test failure.
await sleep(500);
try {
  rmSync(profile, { recursive: true, force: true });
} catch {
  // best effort
}

const bad =
  pageErrors.length > 0 ||
  consoleErrors.length > 0 ||
  failedRequests.length > 0 ||
  report.timelinePainted === 0;
process.exit(bad ? 1 : 0);

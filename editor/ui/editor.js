/**
 * BeatBound Level Editor UI.
 *
 * Vanilla JS: renders the timeline (waveform, energy, sections, transitions),
 * drives the edit panel, and talks to editor/server/server.mjs. All
 * generation happens server-side -- this file only moves and edits JSON.
 */

const $ = (id) => document.getElementById(id);

const MODES = ['ARENA', 'RUNNER', 'VERTICAL', 'RADIAL'];
const MODE_COLORS = {
  ARENA: '#e05555',
  RUNNER: '#58b368',
  VERTICAL: '#5a8dee',
  RADIAL: '#a56bd6',
};
const EFFECT_DEFAULTS = {
  cameraZoom: { zoom: 1.15, ease: 'easeOutBack' },
  cameraPan: { direction: 'followMode' },
  paletteShift: { target: 'modePalette' },
  particles: { burst: 'boundaryCrossing' },
  wipe: { direction: 'radial' },
  bgChange: { target: 'modeBackdrop' },
  envMovement: { kind: 'drift' },
  lightFlash: { color: '#ffffff', decay: 0.25 },
};
const ALL_EFFECTS = Object.keys(EFFECT_DEFAULTS);

const state = {
  song: null, // {id, title, audioPath, audioUrl}
  analysis: null, // music_analysis.json
  blueprint: null, // level_blueprint.json
  patterns: [], // {id, name, mode, function, difficulty, lengthBars, family, energy, recovery, teach, mechanicIds}
  mechanics: [], // {id, mode, telegraphBeats, durationBeats}
  tuningMirror: null, // {breatherBeats, countdownSeconds, sceneBeats, source, missing[]} from src/tuning.ts
  consistencyNotes: [],
  selection: { type: 'section', id: null },
  levelFile: null,
  hasDirectorContext: false, // director_context.json (v1) exists on the server
  hasDirectorContextV2: false, // director_context_v2.json -- what the pipeline reads
  hasFullAnalysis: false, // music_analysis_v2.json exists on the server
  presets: [], // generation presets, from /api/presets
  llm: null, // masked LLM config from /api/llm/status -- never holds a key value
  lastManifestLevelId: null, // level_id of the last pipeline run, for the manifest button
};

// ---------------------------------------------------------------------------
// API
// ---------------------------------------------------------------------------

async function api(path, opts) {
  const res = await fetch(path, opts);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    // Some routes explain themselves with a single `error` string, but the
    // compile routes reject with the validator's `errors` array -- /api/generate
    // answers 422 with the real reasons. Reporting only `${path}: HTTP 422` threw
    // those away and left the panel saying nothing useful.
    const detail = data.error
      ?? (Array.isArray(data.errors) && data.errors.length ? data.errors.join(' | ') : null);
    throw new Error(detail ?? `${path}: HTTP ${res.status}`);
  }
  return data;
}

function postJson(path, body) {
  return api(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body ?? {}),
  });
}

function setStatus(msg, isError = false) {
  const el = $('status-msg');
  el.textContent = msg;
  el.style.color = isError ? 'var(--err)' : 'var(--dim)';
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

async function uploadSong(file) {
  setStatus(`uploading ${file.name}…`);
  try {
    const res = await fetch('/api/upload?filename=' + encodeURIComponent(file.name), {
      method: 'POST',
      body: file,
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'upload failed');
    state.song = data.song;
    state.analysis = null;
    state.blueprint = null;
    state.levelFile = null;
    state.hasDirectorContext = false; // stale exports were cleared server-side
    state.hasFullAnalysis = false;
    state.selection = { type: 'section', id: null };
    refresh();
    setStatus(`uploaded ${state.song.title} — ready to analyse`);
  } catch (err) {
    setStatus(String(err.message), true);
  }
}

async function analyze() {
  const bpm = parseFloat($('bpm-override').value);
  setStatus('analysing (V2: rhythm, energy, tonal, structure, stems, melody — this can take a minute)…');
  $('btn-analyze').disabled = true;
  try {
    const data = await postJson('/api/analyze', { bpm: Number.isFinite(bpm) ? bpm : undefined });
    state.analysis = data.analysis;
    state.hasDirectorContext = Boolean(data.directorContext);
    state.hasFullAnalysis = true; // a successful run always writes the V2 doc
    refresh();
    const r = data.report;
    let msg =
      `analysed: ${r.bpm_override ? 'bpm override' : 'detected'} ${data.analysis.tempo.bpm} BPM · ` +
      `${r.bars} bars · ${r.sections} sections · ${r.onsets} onsets`;
    if (data.directorContext) {
      const d = data.directorContext;
      msg += ` · director context ready (${d.phrases} phrases, ${d.repeat_groups} repeat groups, ${d.important_events} events)`;
    }
    setStatus(msg);
  } catch (err) {
    setStatus(`analysis failed: ${err.message}`, true);
  } finally {
    $('btn-analyze').disabled = false;
    refresh();
  }
}

/** Trigger a browser download of one of the server-side analysis exports. */
function downloadExport(endpoint, filename) {
  const a = document.createElement('a');
  a.href = `${endpoint}?download=1`;
  a.download = filename; // the Content-Disposition header names it too
  document.body.appendChild(a);
  a.click();
  a.remove();
  setStatus(`downloading ${filename}…`);
}

/**
 * A blueprint from the director always has `sections`; `transitions` is
 * optional and the session's stored copy omits it entirely. Every reader walks
 * both as arrays, and `state.blueprint?.transitions.find(...)` does not save
 * them: `?.` short-circuits on a missing *blueprint*, not on a missing
 * *transitions*, so the call still landed on `undefined.find` and took
 * `refresh()` -- and with it the whole panel -- down on load. Normalize once
 * where the blueprint enters, rather than guarding a dozen call sites.
 */
function normalizeBlueprint(bp) {
  if (!bp || typeof bp !== 'object') return null;
  return {
    ...bp,
    sections: Array.isArray(bp.sections) ? bp.sections : [],
    transitions: Array.isArray(bp.transitions) ? bp.transitions : [],
  };
}

async function direct() {
  const seed = Math.max(1, parseInt($('seed-input').value) || 42);
  setStatus(`running the level director (seed ${seed})…`);
  try {
    const data = await postJson('/api/direct', { seed });
    state.blueprint = normalizeBlueprint(data.blueprint);
    state.selection = { type: 'section', id: state.blueprint.sections[0]?.id ?? null };
    refresh();
    setStatus(`blueprint generated: ${state.blueprint.sections.length} sections, ` +
      `${state.blueprint.transitions.length} transitions`);
  } catch (err) {
    setStatus(`director failed: ${err.message}`, true);
  }
}

async function saveBlueprint() {
  return postJson('/api/blueprint', state.blueprint);
}

async function regenerateSection() {
  const section = selectedSection();
  if (!section) return;
  applySectionFromPanel();
  try {
    await saveBlueprint();
    setStatus(`regenerating ${section.id}…`);
    const data = await postJson('/api/regenerate', { sectionId: section.id });
    state.blueprint = normalizeBlueprint(data.blueprint);
    refresh();
    setStatus(`section ${section.id} regenerated (variant ${section.variant})`);
  } catch (err) {
    setStatus(`regenerate failed: ${err.message}`, true);
  }
}

async function applySection() {
  const section = selectedSection();
  if (!section) return;
  applySectionFromPanel();
  try {
    await saveBlueprint();
    refresh();
    setStatus(`section ${section.id} saved`);
  } catch (err) {
    setStatus(`save failed: ${err.message}`, true);
  }
}

async function applyTransition() {
  const t = selectedTransition();
  if (!t) return;
  const from = state.blueprint.sections.find((s) => s.id === t.fromSection);
  const to = state.blueprint.sections.find((s) => s.id === t.toSection);
  if (!from || !to) return;

  const beats = Math.max(2, Math.min(16, parseInt($('tr-beats').value) || 4));
  const bpb = state.blueprint.song.timeSignature[0];
  // Mirror transitionGenerator's tail/head derivation. The tail must end
  // inside the section's fillable region (fillBars already ends exactly at
  // the runtime's breather boundary), never inside the no-spawn window.
  const fromFill = from.fillBars ?? from.lengthBars;
  let tail = Math.min(Math.max(0, Math.floor(beats / bpb)), 2, Math.max(0, fromFill - 2));
  let head = Math.min(Math.max(0, Math.ceil(beats / bpb) - tail), 2, to.lengthBars);

  const checked = [...$('tr-scene').querySelectorAll('input:checked')].map(
    (i) => i.dataset.effect
  );
  t.lengthBeats = beats;
  t.tailBars = tail;
  t.headBars = head;
  t.hazardReduction = tail > 0 && head > 0 ? 'both' : tail > 0 ? 'recovery_tail' : 'calm_head';
  t.scene = checked.map((effect) => ({
    effect,
    params: { ...EFFECT_DEFAULTS[effect] },
    durationBeats: 4,
  }));
  try {
    await saveBlueprint();
    refresh();
    setStatus(
      `transition ${t.id} saved — if the section patterns no longer match the ` +
        `tail/head bars, regenerate ${from.id} and ${to.id}`
    );
  } catch (err) {
    setStatus(`save failed: ${err.message}`, true);
  }
}

async function generateLevel() {
  setStatus('compiling level.json…');
  try {
    const data = await postJson('/api/generate', {});
    state.levelFile = data.levelFile;
    refresh();
    if (data.warnings.length > 0) {
      setStatus(`level written to ${data.levelFile} — ${data.warnings.length} warning(s): ` +
        data.warnings.join(' | ').slice(0, 300));
    } else {
      setStatus(`level written to ${data.levelFile} — clean, ready to playtest`);
    }
  } catch (err) {
    setStatus(`generate failed: ${err.message}`, true);
  }
}

async function runChecks() {
  setStatus('running the runtime LevelLoader report…');
  try {
    const data = await postJson('/api/check', {});
    $('report-body').textContent = data.output;
    $('report-overlay').classList.remove('hidden');
    setStatus('checks done');
  } catch (err) {
    setStatus(`checks failed: ${err.message}`, true);
  }
}

function playtest() {
  if (!state.levelFile) return;
  const base = $('game-url').value.trim().replace(/\/?$/, '/');
  window.open(base + '?level=' + state.levelFile, '_blank');
  setStatus(`opened playtest: ${base}?level=${state.levelFile}`);
}

// ---------------------------------------------------------------------------
// V2 generation panel
//
// This drives /api/generate-level, which streams NDJSON: one line per pipeline
// event, then a `result` or an `error`. The panel's job is to show which layer
// is running and to report the outcome honestly -- a run that failed validation
// must not read as success just because the request completed.
// ---------------------------------------------------------------------------

function v2Log(line, cls = '') {
  const el = $('v2-log');
  if (el.dataset.fresh !== '1') {
    el.textContent = '';
    el.dataset.fresh = '1';
  }
  const div = document.createElement('div');
  if (cls) div.className = cls;
  div.textContent = line;
  el.appendChild(div);
  el.scrollTop = el.scrollHeight;
}

// True while a run is in flight, so a background refresh cannot re-enable the
// button out from under it.
let v2Busy = false;

// The pipeline reports stages, not a percentage, so the bar is an indeterminate
// sweep -- a progress bar that invented a number would be a lie. The elapsed
// clock is real, and it is what tells the user a long model call is still alive.
let v2ProgressTimer = null;
let v2ProgressText = '';

function v2RenderProgress() {
  const secs = v2ProgressTimer ? Math.round((Date.now() - v2ProgressStartedAt) / 1000) : 0;
  const elapsed = v2ProgressTimer ? `  (${secs}s)` : '';
  $('v2-progress-text').textContent = `${v2ProgressText}${elapsed}`;
}

let v2ProgressStartedAt = 0;

function v2SetProgress(text) {
  $('v2-progress').classList.remove('hidden');
  if (text !== undefined) v2ProgressText = text;
  if (v2ProgressTimer === null) {
    v2ProgressStartedAt = Date.now();
    v2ProgressTimer = setInterval(v2RenderProgress, 1000);
  }
  v2RenderProgress();
}

function v2EndProgress() {
  if (v2ProgressTimer !== null) clearInterval(v2ProgressTimer);
  v2ProgressTimer = null;
  v2ProgressText = '';
  $('v2-progress').classList.add('hidden');
  $('v2-progress-text').textContent = '';
}

function v2SelectedModes() {
  return [...$('v2-allowed').querySelectorAll('input:checked')].map((i) => i.value);
}

function renderV2Modes() {
  const box = $('v2-allowed');
  const primary = $('v2-primary').value;
  const preset = state.presets.find((p) => p.id === $('v2-preset').value);
  const allowed = new Set(preset?.allowed_modes ?? MODES);
  allowed.add(primary);

  box.innerHTML = '';
  for (const mode of MODES) {
    if (!allowed.has(mode)) continue;
    const pinned = mode === primary;
    const label = document.createElement('label');
    label.className = pinned ? 'on locked' : 'on';
    label.innerHTML =
      `<input type="checkbox" value="${mode}" ${pinned ? 'checked disabled' : 'checked'} />` +
      `${mode}${pinned ? ' <span class="pin">primary</span>' : ''}`;
    label.querySelector('input').addEventListener('change', (e) => {
      label.classList.toggle('on', e.target.checked);
    });
    box.appendChild(label);
  }
}

/** Show what the pipeline needs before the button is worth pressing. */
function renderV2Status() {
  const el = $('v2-status');
  const llm = state.llm ?? {};
  const lines = [
    state.hasDirectorContextV2
      ? { cls: 'ok', text: `director context <b>v2</b> ready` }
      : { cls: 'miss', text: `director context <b>v2</b> missing — run Analyze` },
    llm.apiKeyPresent
      ? { cls: 'ok', text: `director <b>${llm.model}</b> via ${llm.provider} · key ${llm.apiKeyMask ?? 'set'}` }
      : { cls: 'warn', text: `no API key — the model cannot be asked (set BEATBOUND_LLM_API_KEY)` },
    { cls: 'ok', text: `game tuning breather <b>${state.tuningMirror?.breatherBeats ?? '?'}b</b> live` },
  ];
  el.innerHTML = lines.map((l) => `<div class="v2-line ${l.cls}">${l.text}</div>`).join('');
  // A background refresh must not hand the button back mid-run.
  $('v2-generate').disabled = v2Busy || !state.hasDirectorContextV2;
}

// The stage that can take minutes. Saying so is the difference between "is this
// frozen?" and "this is the part that takes minutes".
const V2_SLOW_STAGE = 'director';

/** One pipeline event -> one line in the log, plus the live progress caption. */
function renderV2Event(ev) {
  // Every event carries its own human-readable message; prefer it over the
  // stage id so the caption says what is actually happening.
  const caption = ev.message ?? `${ev.stage}…`;
  v2SetProgress(ev.stage === V2_SLOW_STAGE ? `${caption} — this can take a few minutes` : caption);
  const detail = [];
  if (ev.levelId) detail.push(ev.levelId);
  if (ev.ok === true) detail.push('ok');
  if (Array.isArray(ev.errors) && ev.errors.length) detail.push(`${ev.errors.length} error(s)`);
  if (ev.message) detail.push(ev.message);
  const head = `<span class="stage">${ev.stage}</span>`;
  v2Log(`${head}  ${detail.join(' · ')}`, ev.ok === true ? 'ok' : '');
  // Only a list of strings is iterable here. `errors` is a list on every event
  // except the repair progress ones, which carry counts under `errorCount` --
  // and iterating a count is exactly what threw "number 0 is not iterable" and
  // failed the run. A malformed event must cost a log line, not the whole panel.
  if (Array.isArray(ev.errors)) {
    for (const err of ev.errors) v2Log(`    ${err}`, 'err');
  }
}

async function v2Generate() {
  const request = {
    preset: $('v2-preset').value,
    primary_mode: $('v2-primary').value,
    allowed_modes: v2SelectedModes(),
    difficulty: Number($('v2-difficulty').value),
    ratio: Number($('v2-ratio').value),
    seed: Math.max(1, parseInt($('v2-seed').value) || 1),
  };
  const body = { ...request, dry_run: $('v2-dry-run').checked, courses: true };

  v2Busy = true;
  $('v2-generate').disabled = true;
  $('v2-generate').classList.add('busy');
  $('v2-generate').textContent = '⏳ Generating…';
  $('v2-log').dataset.fresh = '0';
  v2SetProgress('starting — this can take a few minutes if the model is called');
  v2Log(`request: ${request.primary_mode} primary · ${request.allowed_modes.join('/')} · ` +
    `difficulty ${request.difficulty} · seed ${request.seed}`);
  setStatus('generating — this may take a few minutes if the model is called…');

  try {
    const res = await fetch('/api/generate-level', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    // NDJSON: read line by line so each event lands as it happens. A final
    // partial line without a newline is still a complete JSON object.
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = '';
    let result = null;
    let failure = null;

    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const lines = buf.split('\n');
      buf = lines.pop();
      for (const line of lines) {
        if (!line.trim()) continue;
        let msg;
        try {
          msg = JSON.parse(line);
        } catch {
          continue; // a truncated line is not worth failing the run over
        }
        if (msg.type === 'event') renderV2Event(msg);
        else if (msg.type === 'result') result = msg;
        else if (msg.type === 'error') failure = msg.error;
      }
    }

    if (failure) throw new Error(failure);
    if (!result) throw new Error('the server closed the stream without a result');

    // Report the verdict, not the request status: a level that compiled but
    // failed validation is a failed run, and the log says so.
    // Two different reports with two different shapes, and both are nested:
    // `validation` is validateAll()'s -- `{ok, level: {errors, warnings}, ...}`
    // -- and `structural` is repairBlueprint()'s, whose verdicts live under
    // `.validation`. Reading either at the wrong level yields `undefined`, and
    // `?? []` turns that into a confident "0 error(s), 0 warning(s)" for a run
    // that failed. The panel said exactly that while the validate stage in the
    // same log listed four warnings.
    const errors = result.validation?.level?.errors ?? [];
    const warnings = result.validation?.level?.warnings ?? [];
    const structuralErrors = result.structural?.validation?.errors ?? [];
    for (const err of structuralErrors) v2Log(`blueprint: ${err}`, 'err');
    for (const warn of result.structural?.validation?.warnings ?? []) v2Log(`blueprint: ${warn}`);
    for (const warn of warnings) v2Log(`warning: ${warn}`);

    if (result.ok) {
      v2Log(`level written to ${result.levelFile} — ${errors.length} error(s), ${warnings.length} warning(s)`, 'ok');
      setStatus(`generated ${result.levelFile} — ready to playtest`);
    } else {
      v2Log(`generation failed — the level was not kept`, 'err');
      setStatus(`generation failed: ${[...structuralErrors, ...errors][0] ?? 'see the log'}`, true);
    }

    state.levelFile = result.files?.level ? result.levelFile : state.levelFile;
    state.lastManifestLevelId = result.manifest?.level_id ?? null;
    $('v2-manifest').disabled = !state.lastManifestLevelId;
    refresh();
  } catch (err) {
    v2Log(`error: ${err.message}`, 'err');
    setStatus(`generate-level failed: ${err.message}`, true);
  } finally {
    v2Busy = false;
    $('v2-generate').disabled = !state.hasDirectorContextV2;
    $('v2-generate').classList.remove('busy');
    $('v2-generate').textContent = '⚡ AI GENERATE';
    v2EndProgress();
  }
}

async function v2ShowManifest() {
  if (!state.lastManifestLevelId) return;
  try {
    const data = await api(`/api/manifest?level_id=${encodeURIComponent(state.lastManifestLevelId)}`);
    $('report-body').textContent = JSON.stringify(data, null, 2);
    $('report-overlay').classList.remove('hidden');
  } catch (err) {
    setStatus(`manifest: ${err.message}`, true);
  }
}

function wireV2Panel() {
  $('v2-difficulty').addEventListener('input', (e) => {
    $('v2-diff-label').textContent = e.target.value;
  });
  $('v2-ratio').addEventListener('input', (e) => {
    $('v2-ratio-label').textContent = Number(e.target.value).toFixed(2);
  });
  $('v2-primary').addEventListener('change', renderV2Modes);
  $('v2-preset').addEventListener('change', () => {
    // A preset is a starting point, not a lock: apply it, then let the user
    // move any control. The seed is deliberately left alone so a re-run with a
    // different preset is still comparable.
    const preset = state.presets.find((p) => p.id === $('v2-preset').value);
    if (!preset) return;
    $('v2-primary').value = preset.primary_mode;
    $('v2-difficulty').value = preset.target_difficulty;
    $('v2-diff-label').textContent = preset.target_difficulty;
    $('v2-ratio').value = preset.primary_mode_ratio;
    $('v2-ratio-label').textContent = Number(preset.primary_mode_ratio).toFixed(2);
    renderV2Modes();
  });
  $('v2-generate').addEventListener('click', v2Generate);
  $('v2-manifest').addEventListener('click', v2ShowManifest);
}

// ---------------------------------------------------------------------------
// Edit panel
// ---------------------------------------------------------------------------

function selectedSection() {
  return state.blueprint?.sections.find((s) => s.id === state.selection.id) ?? null;
}

function selectedTransition() {
  return state.blueprint?.transitions.find((t) => t.id === state.selection.id) ?? null;
}

function patternOptions(mode, selected) {
  const list = state.patterns
    .filter((p) => p.mode === mode)
    .sort((a, b) => a.id.localeCompare(b.id));
  return list
    .map(
      (p) =>
        `<option value="${p.id}"${p.id === selected ? ' selected' : ''}>` +
        `${p.id} ${p.name} · d${p.difficulty} · ${p.lengthBars}b</option>`
    )
    .join('');
}

function familyOf(patternId) {
  return state.patterns.find((p) => p.id === patternId)?.family ?? 'manual';
}

function renderPatternRows(section) {
  const ul = $('sec-patterns');
  ul.innerHTML = '';
  const keepRole = $('sec-keep-role').checked;

  // A v1 blueprint section carries its `patterns`; a v2 one does not, because
  // the compiler derives them from the director's section description. Absent
  // is a real state here, not a bug to report -- but iterating it threw
  // "Cannot read properties of undefined (reading 'forEach')" and took the
  // whole refresh down, so the run was reported as failed after it had in fact
  // compiled, published and validated.
  const patterns = Array.isArray(section.patterns) ? section.patterns : [];

  patterns.forEach((p, i) => {
    const li = document.createElement('li');
    const locked = Boolean(p.role && keepRole);
    li.innerHTML = `
      <select class="pat-id" ${locked ? 'disabled' : ''}>${patternOptions(section.mode, p.patternId)}</select>
      <input class="pat-repeat" type="number" min="1" value="${p.repeat}" title="repeat" ${locked ? 'disabled' : ''} />
      <input class="pat-intensity" type="range" min="0" max="1" step="0.01" value="${p.intensity}" title="intensity" ${locked ? 'disabled' : ''} />
      <span class="pat-intensity-label">${Number(p.intensity).toFixed(2)}</span>
      ${p.role ? `<span class="role-tag ${p.role === 'TRANSITION_TAIL' ? 'tail' : 'head'}">${p.role.replace('TRANSITION_', '')}</span>` : ''}
      <button class="pat-del" title="remove" ${locked ? 'disabled' : ''}>✕</button>`;
    li.querySelector('.pat-intensity').addEventListener('input', (e) => {
      li.querySelector('.pat-intensity-label').textContent = Number(e.target.value).toFixed(2);
    });
    li.querySelector('.pat-del').addEventListener('click', () => {
      section.patterns.splice(i, 1);
      renderPatternRows(section);
    });
    ul.appendChild(li);
  });
}

function populateSectionEditor(section) {
  $('panel-empty').classList.add('hidden');
  $('transition-editor').classList.add('hidden');
  $('section-editor').classList.remove('hidden');

  $('sec-id').textContent = section.id;
  $('sec-mode').value = section.mode;
  $('sec-function').value = section.function;
  $('sec-difficulty').value = section.difficulty;
  $('sec-diff-label').textContent = section.difficulty;
  // v1 spells these `startBar`/`endBar` (endBar inclusive); a v2 blueprint uses
  // `start_bar`/`end_bar_exclusive`. Read whichever is present rather than
  // rendering the string "undefined" into the field.
  $('sec-start').value = section.startBar ?? section.start_bar ?? '';
  $('sec-end').value = section.endBar ?? section.end_bar_exclusive ?? '';
  $('sec-breather').textContent =
    section.breatherFromBeat != null
      ? `breather: beats ≥ ${section.breatherFromBeat} do not spawn (mode change next)`
      : '';
  renderPatternRows(section);
}

function populateTransitionEditor(t) {
  $('panel-empty').classList.add('hidden');
  $('section-editor').classList.add('hidden');
  $('transition-editor').classList.remove('hidden');

  $('tr-id').textContent = t.id;
  $('tr-kind').textContent = t.kind;
  $('tr-beats').value = t.lengthBeats;

  const have = new Set((t.scene ?? []).map((e) => e.effect));
  $('tr-scene').innerHTML = ALL_EFFECTS.map(
    (effect) =>
      `<li><label><input type="checkbox" data-effect="${effect}"${have.has(effect) ? ' checked' : ''} />` +
      ` ${effect}</label></li>`
  ).join('');
}

function applySectionFromPanel() {
  const section = selectedSection();
  if (!section) return;
  const keepRole = $('sec-keep-role').checked;

  section.mode = $('sec-mode').value;
  section.function = $('sec-function').value;
  section.difficulty = parseInt($('sec-difficulty').value);
  section.startBar = Math.max(1, parseInt($('sec-start').value) || 1);
  section.endBar = Math.max(section.startBar, parseInt($('sec-end').value) || section.startBar);
  section.lengthBars = section.endBar - section.startBar + 1;
  section.source = 'manual';

  const rolePlacements = keepRole ? section.patterns.filter((p) => p.role) : [];
  const rows = [...$('sec-patterns').querySelectorAll('li')].map((li) => {
    const patternId = li.querySelector('.pat-id').value;
    return {
      patternId,
      family: familyOf(patternId),
      repeat: Math.max(1, parseInt(li.querySelector('.pat-repeat').value) || 1),
      intensity: Math.max(0, Math.min(1, parseFloat(li.querySelector('.pat-intensity').value) || 0.5)),
    };
  });
  section.patterns = [...rolePlacements, ...rows];
}

function selectSection(id) {
  state.selection = { type: 'section', id };
  refresh();
}

function selectTransition(id) {
  state.selection = { type: 'transition', id };
  refresh();
}

// ---------------------------------------------------------------------------
// Timeline rendering
// ---------------------------------------------------------------------------

function xScale(width) {
  const bars = state.analysis?.bars.length ?? 16;
  return (width - PAD_L - PAD_R) / Math.max(bars, 12);
}

const PAD_L = 42;
const PAD_R = 8;
const LANE_TOP = 20;

function xForBar(bar, pxPerBar) {
  return PAD_L + (bar - 1) * pxPerBar;
}

function hatch(ctx, x, y, w, h, color, spacing = 7) {
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.clip();
  ctx.strokeStyle = color;
  ctx.globalAlpha = 0.35;
  ctx.lineWidth = 1;
  for (let off = -h; off < w + h; off += spacing) {
    ctx.beginPath();
    ctx.moveTo(x + off, y + h);
    ctx.lineTo(x + off + h, y);
    ctx.stroke();
  }
  ctx.restore();
}

function drawTimeline() {
  const canvas = $('timeline-canvas');
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth || 600;
  const h = canvas.clientHeight || 200;
  canvas.width = Math.round(w * dpr);
  canvas.height = Math.round(h * dpr);
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);

  if (!state.analysis) return;

  const bars = state.analysis.bars.length;
  const pxPerBar = xScale(w);
  const bpb = state.analysis.tempo.timeSignature[0];
  const laneH = h - LANE_TOP - 6;

  // Energy heat per bar.
  for (const b of state.analysis.bars) {
    const x = xForBar(b.bar, pxPerBar);
    ctx.fillStyle = `rgba(255, 170, 80, ${(0.06 + b.energy * 0.4).toFixed(3)})`;
    ctx.fillRect(x, LANE_TOP, pxPerBar + 1, laneH);
  }

  // Analysis section boundaries (visible until a blueprint exists, or faintly
  // behind it once it does).
  ctx.strokeStyle = 'rgba(255,255,255,0.22)';
  ctx.setLineDash([4, 4]);
  ctx.font = '10px Consolas, monospace';
  ctx.fillStyle = '#8a93b0';
  ctx.textAlign = 'left';
  for (const s of state.analysis.sections) {
    const x = xForBar(s.startBar, pxPerBar);
    ctx.beginPath();
    ctx.moveTo(x, LANE_TOP);
    ctx.lineTo(x, h);
    ctx.stroke();
    if (!state.blueprint) ctx.fillText(s.label, x + 3, LANE_TOP + 12);
  }
  ctx.setLineDash([]);

  // Sections.
  const sel = state.selection;
  for (const s of state.blueprint?.sections ?? []) {
    const x = xForBar(s.startBar, pxPerBar);
    const wSec = (s.endBar - s.startBar + 1) * pxPerBar;
    const color = MODE_COLORS[s.mode] || '#888';
    const isSel = sel.type === 'section' && sel.id === s.id;

    ctx.fillStyle = color + '2e';
    ctx.fillRect(x, LANE_TOP + 4, wSec, laneH - 8);
    ctx.strokeStyle = isSel ? '#ffffff' : color;
    ctx.lineWidth = isSel ? 2.5 : 1;
    ctx.strokeRect(x, LANE_TOP + 4, wSec, laneH - 8);

    ctx.textAlign = 'left';
    ctx.fillStyle = color;
    ctx.font = 'bold 12px Consolas, monospace';
    ctx.fillText(`${s.id} ${s.mode}`, x + 6, LANE_TOP + 20);
    ctx.fillStyle = '#dfe5f5';
    ctx.font = '11px Consolas, monospace';
    ctx.fillText(`d${s.difficulty} ${s.function}`, x + 6, LANE_TOP + 34);
    if (wSec > 150 && s.patterns.length > 0) {
      ctx.fillStyle = '#8a93b0';
      ctx.fillText(
        s.patterns.map((p) => `${p.patternId}x${p.repeat}`).join(' '),
        x + 6,
        LANE_TOP + 48
      );
    }
  }

  // Transitions: labels in the strip, hatched zones over the sections.
  for (const t of state.blueprint?.transitions ?? []) {
    const to = state.blueprint.sections.find((s) => s.id === t.toSection);
    if (!to) continue;
    const bx = xForBar(to.startBar, pxPerBar);
    const tailW = t.tailBars * pxPerBar;
    const headW = t.headBars * pxPerBar;
    if (tailW > 0) hatch(ctx, bx - tailW, LANE_TOP + 4, tailW, laneH - 8, '#ffffff');
    if (headW > 0) hatch(ctx, bx, LANE_TOP + 4, headW, laneH - 8, MODE_COLORS[to.mode] || '#fff');

    ctx.textAlign = 'center';
    ctx.fillStyle = '#ffffff';
    ctx.font = '10px Consolas, monospace';
    ctx.fillText(`${t.kind.replace(/_TO_/, ' → ')} · ${t.lengthBeats}b`, bx, 12);

    if (sel.type === 'transition' && sel.id === t.id) {
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 2.5;
      ctx.strokeRect(bx - tailW, LANE_TOP + 4, tailW + headW, laneH - 8);
    }
  }

  // Breather zones -- a separate runtime fact from the transition: from
  // breatherFromBeat to the section end, nothing spawns at all. Beat-precise
  // (the boundary may cut mid-bar); drawn with its own colour so it never
  // reads as part of the transition hatch.
  const beatX = (beat) => PAD_L + (beat / bpb) * pxPerBar;
  for (const s of state.blueprint?.sections ?? []) {
    if (s.breatherFromBeat == null) continue;
    const bx = beatX(s.breatherFromBeat);
    const ex = xForBar(s.endBar + 1, pxPerBar);
    hatch(ctx, bx, LANE_TOP + 4, Math.max(0, ex - bx), laneH - 8, '#b8aef0', 9);
    ctx.strokeStyle = '#b8aef0';
    ctx.setLineDash([5, 4]);
    ctx.beginPath();
    ctx.moveTo(bx, LANE_TOP + 4);
    ctx.lineTo(bx, h);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.textAlign = 'left';
    ctx.fillStyle = '#b8aef0';
    ctx.font = '10px Consolas, monospace';
    ctx.fillText('breather', bx + 3, LANE_TOP + 12);
  }

  // Mode-swap tick + colour wipe: the mode becomes live at
  // sectionStart - leadInBeats (longest mechanic telegraph in the incoming
  // section, capped at one bar) and the wipe runs sceneBeats from there.
  // Both come from the live game source via /api/state, never from here.
  const sceneBeats = state.tuningMirror?.sceneBeats ?? null;
  const mechTelegraph = new Map(state.mechanics.map((m) => [m.id, m.telegraphBeats ?? 0]));
  for (const t of state.blueprint?.transitions ?? []) {
    const to = state.blueprint.sections.find((s) => s.id === t.toSection);
    if (!to) continue;
    const startBeat = (to.startBar - 1) * bpb;
    let maxTelegraph = 0;
    for (const pl of to.patterns ?? []) {
      const entry = state.patterns.find((p) => p.id === pl.patternId);
      for (const mid of entry?.mechanicIds ?? []) {
        maxTelegraph = Math.max(maxTelegraph, mechTelegraph.get(mid) ?? 0);
      }
    }
    const leadIn = Math.min(maxTelegraph, bpb);
    const swapBeat = startBeat - leadIn;
    ctx.strokeStyle = '#ffffff';
    ctx.globalAlpha = 0.85;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(beatX(swapBeat), 6);
    ctx.lineTo(beatX(swapBeat), LANE_TOP);
    ctx.stroke();
    ctx.globalAlpha = 1;
    if (Number.isFinite(sceneBeats) && sceneBeats > 0) {
      const ww = (sceneBeats / bpb) * pxPerBar;
      ctx.fillStyle = MODE_COLORS[to.mode] + '88';
      ctx.fillRect(beatX(swapBeat), LANE_TOP - 4, ww, 4);
    }
  }

  // Bar grid + labels.
  const labelEvery = bars <= 48 ? 1 : bars <= 96 ? 2 : 4;
  for (let b = 1; b <= bars + 1; b++) {
    const x = xForBar(b, pxPerBar);
    const isDown = (b - 1) % bpb === 0;
    ctx.strokeStyle = isDown ? 'rgba(255,255,255,0.18)' : 'rgba(255,255,255,0.06)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x, LANE_TOP);
    ctx.lineTo(x, h);
    ctx.stroke();
    if (b <= bars && (b - 1) % labelEvery === 0) {
      ctx.fillStyle = '#8a93b0';
      ctx.font = '10px Consolas, monospace';
      ctx.textAlign = 'center';
      ctx.fillText(String(b), x + pxPerBar / 2, h - 3);
    }
  }
}

function drawWaveform() {
  const canvas = $('wave-canvas');
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth || 600;
  const h = canvas.clientHeight || 64;
  canvas.width = Math.round(w * dpr);
  canvas.height = Math.round(h * dpr);
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);

  if (!state.analysis) return;

  const pxPerBar = xScale(w);
  const bpb = state.analysis.tempo.timeSignature[0];
  const secsPerBar = (60 / state.analysis.tempo.bpm) * bpb;
  const pxPerSec = pxPerBar / secsPerBar;

  const env = state.analysis.waveformEnvelope;
  if (env && env.times.length > 1) {
    ctx.beginPath();
    ctx.moveTo(PAD_L, h);
    for (let i = 0; i < env.times.length; i++) {
      const x = PAD_L + env.times[i] * pxPerSec;
      const y = 6 + (1 - env.values[i]) * (h - 14);
      ctx.lineTo(x, y);
    }
    ctx.lineTo(PAD_L + env.times[env.times.length - 1] * pxPerSec, h);
    ctx.closePath();
    ctx.fillStyle = 'rgba(110, 168, 255, 0.35)';
    ctx.fill();
  }

  // Onsets.
  ctx.fillStyle = 'rgba(255,255,255,0.5)';
  for (const o of state.analysis.onsets ?? []) {
    const x = PAD_L + o.time * pxPerSec;
    ctx.fillRect(x, h - 8 - o.strength * 6, 2, 2);
  }

  // Section boundaries.
  ctx.strokeStyle = 'rgba(255,255,255,0.35)';
  ctx.font = '10px Consolas, monospace';
  ctx.fillStyle = '#8a93b0';
  ctx.textAlign = 'left';
  for (const s of state.analysis.sections) {
    const x = PAD_L + s.startTime * pxPerSec;
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, h);
    ctx.stroke();
    ctx.fillText(s.label, x + 3, 10);
  }
}

// ---------------------------------------------------------------------------
// Hit testing / interaction
// ---------------------------------------------------------------------------

function timelineHit(ev, canvas) {
  const rect = canvas.getBoundingClientRect();
  const x = ev.clientX - rect.left;
  const pxPerBar = xScale(rect.width);
  const bar = Math.max(1, Math.min(state.analysis?.bars.length ?? 1, Math.floor((x - PAD_L) / pxPerBar) + 1));
  return { bar, x, pxPerBar, y: ev.clientY - rect.top };
}

function onTimelineClick(ev) {
  if (!state.analysis) return;
  const { bar } = timelineHit(ev, $('timeline-canvas'));

  // Transitions take priority over sections (their zones overlap).
  for (const t of state.blueprint?.transitions ?? []) {
    const to = state.blueprint.sections.find((s) => s.id === t.toSection);
    if (!to) continue;
    const lo = to.startBar - t.tailBars;
    const hi = to.startBar + t.headBars - 1;
    if (bar >= lo && bar <= hi) {
      selectTransition(t.id);
      return;
    }
  }
  for (const s of state.blueprint?.sections ?? []) {
    if (bar >= s.startBar && bar <= s.endBar) {
      selectSection(s.id);
      return;
    }
  }
  selectSection(null);
}

function onWaveClick(ev) {
  if (!state.analysis || !state.song) return;
  const rect = $('wave-canvas').getBoundingClientRect();
  const pxPerBar = xScale(rect.width);
  const bpb = state.analysis.tempo.timeSignature[0];
  const secsPerBar = (60 / state.analysis.tempo.bpm) * bpb;
  const time = ((ev.clientX - rect.left - PAD_L) / pxPerBar) * secsPerBar;
  const preview = $('preview');
  if (time >= 0) {
    preview.currentTime = Math.max(0, Math.min(time, state.analysis.song.durationSec - 0.1));
    preview.play().catch(() => {});
  }
}

// ---------------------------------------------------------------------------
// Refresh
// ---------------------------------------------------------------------------

function refresh() {
  // Song meta.
  if (state.song) {
    $('song-name').textContent = state.song.title;
    $('song-stats').textContent = state.analysis
      ? `${state.analysis.bars.length} bars · ${state.analysis.song.durationSec.toFixed(1)}s · ` +
        `${state.analysis.sections.length} sections`
      : 'not analysed yet';
    $('song-bpm-label').textContent = state.analysis
      ? `${state.analysis.tempo.bpm} BPM ${state.analysis.tempo.timeSignature[0]}/${state.analysis.tempo.timeSignature[1]}`
      : '';
    $('preview').src = state.song.audioUrl;
  } else {
    $('song-name').textContent = 'no song loaded';
    $('song-stats').textContent = '';
    $('song-bpm-label').textContent = '';
  }

  // Buttons.
  $('btn-analyze').disabled = !state.song;
  $('btn-direct').disabled = !state.analysis;
  $('btn-generate').disabled = !state.blueprint;
  $('btn-check').disabled = !state.levelFile;
  $('btn-playtest').disabled = !state.levelFile;
  $('btn-download-director').disabled = !state.hasDirectorContext;
  $('btn-download-full').disabled = !state.hasFullAnalysis;
  $('playtest-file').textContent = state.levelFile ?? '—';
  $('timeline-hint').classList.toggle('hidden', Boolean(state.analysis));
  $('timeline-legend').classList.toggle('hidden', !Boolean(state.blueprint));

  // Tuning mirror + consistency notes from the live game source.
  const warnEl = $('consistency-warn');
  const lines = [...state.consistencyNotes];
  if (state.tuningMirror?.breatherBeats != null) {
    lines.push(
      `game tuning: breather ${state.tuningMirror.breatherBeats}b · scene wipe ` +
      `${state.tuningMirror.sceneBeats ?? '?'}b (live from ${state.tuningMirror.source ?? 'src/tuning.ts'})`
    );
  }
  warnEl.innerHTML = lines
    .map((l) => `<div>⚠ ${String(l).replace(/&/g, '&amp;').replace(/</g, '&lt;')}</div>`)
    .join('');
  warnEl.classList.toggle('hidden', lines.length === 0);

  drawWaveform();
  drawTimeline();
  renderV2Status();

  // Panel.
  const section = selectedSection();
  const transition = selectedTransition();
  if (section) populateSectionEditor(section);
  else if (transition) populateTransitionEditor(transition);
  else {
    $('section-editor').classList.add('hidden');
    $('transition-editor').classList.add('hidden');
    $('panel-empty').classList.remove('hidden');
  }
}

// ---------------------------------------------------------------------------
// Wiring + init
// ---------------------------------------------------------------------------

function wireEvents() {
  $('song-file').addEventListener('change', (e) => {
    const file = e.target.files?.[0];
    if (file) uploadSong(file);
  });

  // Drag & drop upload.
  document.addEventListener('dragover', (e) => {
    e.preventDefault();
    $('drop-overlay').classList.remove('hidden');
  });
  document.addEventListener('dragleave', (e) => {
    if (!e.relatedTarget) $('drop-overlay').classList.add('hidden');
  });
  document.addEventListener('drop', (e) => {
    e.preventDefault();
    $('drop-overlay').classList.add('hidden');
    const file = e.dataTransfer?.files?.[0];
    const isAudio =
      file &&
      (file.type.startsWith('audio/') || /\.(mp3|wav|ogg|m4a|flac)$/i.test(file.name));
    if (isAudio) {
      uploadSong(file);
    } else if (file) {
      setStatus('that does not look like an audio file', true);
    }
  });

  $('btn-analyze').addEventListener('click', analyze);
  $('btn-download-director').addEventListener('click', () => {
    downloadExport('/api/director-context', 'director_context.json');
  });
  $('btn-download-full').addEventListener('click', () => {
    downloadExport('/api/analysis-v2', 'music_analysis_v2.json');
  });
  $('btn-direct').addEventListener('click', direct);
  $('btn-generate').addEventListener('click', generateLevel);
  $('btn-check').addEventListener('click', runChecks);
  $('btn-playtest').addEventListener('click', playtest);

  $('timeline-canvas').addEventListener('click', onTimelineClick);
  $('wave-canvas').addEventListener('click', onWaveClick);

  $('sec-difficulty').addEventListener('input', (e) => {
    $('sec-diff-label').textContent = e.target.value;
  });
  $('sec-mode').addEventListener('change', () => {
    const section = selectedSection();
    if (!section) return;
    section.mode = $('sec-mode').value;
    // Patterns of the old mode no longer apply; reset to one sensible row.
    const first = state.patterns
      .filter((p) => p.mode === section.mode)
      .sort((a, b) => a.id.localeCompare(b.id))[0];
    section.patterns = first
      ? [{ patternId: first.id, family: first.family, repeat: 1, intensity: 0.5 }]
      : [];
    renderPatternRows(section);
  });
  $('sec-keep-role').addEventListener('change', () => {
    const section = selectedSection();
    if (section) renderPatternRows(section);
  });
  $('sec-add-pattern').addEventListener('click', () => {
    const section = selectedSection();
    if (!section) return;
    const first = state.patterns
      .filter((p) => p.mode === section.mode)
      .sort((a, b) => a.id.localeCompare(b.id))[0];
    if (!first) return;
    section.patterns.push({ patternId: first.id, family: first.family, repeat: 1, intensity: 0.5 });
    renderPatternRows(section);
  });
  $('sec-apply').addEventListener('click', applySection);
  $('sec-regenerate').addEventListener('click', regenerateSection);
  $('tr-apply').addEventListener('click', applyTransition);

  $('report-close').addEventListener('click', () => {
    $('report-overlay').classList.add('hidden');
  });
  $('report-overlay').addEventListener('click', (e) => {
    if (e.target === $('report-overlay')) $('report-overlay').classList.add('hidden');
  });

  window.addEventListener('resize', () => {
    drawWaveform();
    drawTimeline();
  });
}

async function init() {
  wireEvents();
  wireV2Panel();
  try {
    const [st, pats, mechs, presets, llm] = await Promise.all([
      api('/api/state'),
      api('/api/patterns'),
      api('/api/mechanics'),
      api('/api/presets'),
      api('/api/llm/status'),
    ]);
    state.song = st.song;
    state.levelFile = st.levelFile;
    state.hasDirectorContext = Boolean(st.hasDirectorContext);
    state.hasDirectorContextV2 = Boolean(st.hasDirectorContextV2);
    state.hasFullAnalysis = Boolean(st.hasFullAnalysis);
    state.patterns = pats.entries;
    state.mechanics = mechs;
    state.tuningMirror = st.tuningMirror ?? null;
    state.consistencyNotes = st.consistencyNotes ?? [];
    state.presets = presets.presets ?? [];
    state.llm = llm;
    $('seed-input').value = st.seed;

    // Populate the V2 panel's selects, then apply the default preset.
    $('v2-preset').innerHTML = state.presets
      .map((p) => `<option value="${p.id}" title="${p.description}">${p.name}</option>`)
      .join('');
    $('v2-primary').innerHTML = MODES.map((m) => `<option>${m}</option>`).join('');
    if (state.presets.length > 0) {
      const first = state.presets[0];
      $('v2-primary').value = first.primary_mode;
      $('v2-difficulty').value = first.target_difficulty;
      $('v2-diff-label').textContent = first.target_difficulty;
      $('v2-ratio').value = first.primary_mode_ratio;
      $('v2-ratio-label').textContent = Number(first.primary_mode_ratio).toFixed(2);
    }
    renderV2Modes();
    if (st.hasAnalysis) state.analysis = await api('/api/analysis');
    if (st.hasBlueprint) {
      state.blueprint = normalizeBlueprint(await api('/api/blueprint'));
      state.selection = { type: 'section', id: state.blueprint.sections[0]?.id ?? null };
    }
    setStatus(
      state.blueprint
        ? `session restored: ${state.blueprint.song.title} · ${state.blueprint.sections.length} sections`
        : state.song
          ? `song loaded: ${state.song.title} — run analysis next`
          : 'ready — upload a song to begin'
    );
  } catch (err) {
    setStatus(`failed to reach the editor server: ${err.message}`, true);
  }
  refresh();
}

init();

// Module scope is otherwise unreachable from outside, which makes the panel's
// own state and redraw path impossible to inspect when a render goes wrong --
// exactly what made the /api/state shape mismatch hard to see. Expose them.
window.__editor = { state, refresh, drawTimeline, drawWaveform };

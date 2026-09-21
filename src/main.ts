import { BeatBoundGame } from './game/BeatBoundGame';
import { DATA, devOptionsFromLocation, libraryPath, loadLevelIndex, levelUrlFromLocation, type LevelIndexEntry } from './config';
import { findLab, LABS, type LabDefinition, type LabGroup } from './lab/labs';
import { LabController } from './lab/LabController';

const canvas = document.getElementById('stage') as HTMLCanvasElement;
const hudRoot = document.getElementById('hud') as HTMLElement;
const labPanel = document.getElementById('lab-panel') as HTMLElement;
const overlay = document.getElementById('overlay') as HTMLElement;
const startButton = document.getElementById('start') as HTMLButtonElement;
const subtitle = document.getElementById('overlay-subtitle') as HTMLElement;
const levelSelect = document.getElementById('level-select') as HTMLSelectElement;
const startBarInput = document.getElementById('start-bar') as HTMLInputElement;
const invincibleInput = document.getElementById('invincible') as HTMLInputElement;
const labList = document.getElementById('lab-list') as HTMLElement;
const levelSetup = document.getElementById('setup') as HTMLElement;

const game = new BeatBoundGame(canvas, hudRoot);
const params = new URLSearchParams(window.location.search);
const lab = findLab(params.get('lab'));
const dev = devOptionsFromLocation();

renderLabMenu(lab);

if (lab && lab.build) {
  void startLab(lab);
} else {
  void startLevelFlow();
}

// --------------------------------------------------------------------------

async function startLab(definition: LabDefinition): Promise<void> {
  // A lab is the tuning environment: no menu, straight into the loop.
  overlay.classList.add('hidden');
  labPanel.classList.remove('hidden');
  const controller = new LabController(game, definition, labPanel, Number(params.get('bpm')) || 120);
  try {
    await controller.launch();
  } catch (error: unknown) {
    overlay.classList.remove('hidden');
    subtitle.innerHTML = `<span class="error">${message(error)}</span>`;
    console.error('[BeatBound] lab failed', error);
  }
}

/** True once a run has been started, so the button knows to rebuild. */
let hasRun = false;

/**
 * Back to the menu.
 *
 * The game is stopped rather than reloaded: a reload would also tear down the
 * AudioContext, and the player would have to re-unlock audio with another
 * click before anything could start.
 */
function showMenu(): void {
  if (lab) {
    // A lab's menu is the lab list, which lives at the bare URL.
    window.location.search = '';
    return;
  }
  game.stop();
  overlay.classList.remove('hidden');
  startButton.disabled = false;
  startButton.textContent = hasRun ? 'Play again' : 'Start';
}

async function startLevelFlow(): Promise<void> {
  const levelUrl = levelUrlFromLocation();
  startBarInput.value = String(dev.startBar);
  invincibleInput.checked = dev.invincible;

  levelSelect.addEventListener('change', () => {
    const next = new URLSearchParams(window.location.search);
    next.delete('lab');
    next.set('level', levelSelect.value);
    next.set('startBar', '1');
    window.location.search = next.toString();
  });

  populateLevels(await loadLevelIndex(), levelUrl);

  try {
    const level = await game.load({ levelUrl, patternsUrl: DATA.patterns, mechanicsUrl: DATA.mechanics });
    const modes = [...new Set(level.sections.map((s) => s.mode))].join(' → ');
    const bars = level.endBar - 1;
    const seconds = level.tempo.beatsToTime(bars * level.tempo.beatsPerBar);
    startBarInput.max = String(bars);
    subtitle.textContent = `${level.song.bpm} BPM · ${bars} bars · ${seconds.toFixed(0)}s · ${modes}`;
    startButton.disabled = false;
    startButton.textContent = 'Start';
  } catch (error: unknown) {
    subtitle.innerHTML = `<span class="error">${message(error).replace(/\n/g, '<br>')}</span>`;
    startButton.textContent = 'Load failed';
    return;
  }

  startButton.addEventListener('click', () => {
    const options = {
      startBar: Math.max(1, Number(startBarInput.value) || 1),
      invincible: invincibleInput.checked,
    };
    const next = new URLSearchParams(window.location.search);
    next.set('level', levelSelect.value || libraryPath(levelUrl));
    next.set('startBar', String(options.startBar));
    if (options.invincible) next.set('invincible', '1');
    else next.delete('invincible');
    window.history.replaceState(null, '', `?${next.toString()}`);

    overlay.classList.add('hidden');
    // After the first run the level's systems are spent, so a fresh one has to
    // be built rather than started again.
    const launch = hasRun ? game.restart(options) : game.start(options);
    hasRun = true;
    launch.catch((error: unknown) => {
      overlay.classList.remove('hidden');
      subtitle.innerHTML = `<span class="error">${message(error)}</span>`;
      startButton.textContent = 'Start failed';
      console.error('[BeatBound] start failed', error);
    });
  });
}

window.addEventListener('keydown', (e) => {
  if (document.activeElement instanceof HTMLInputElement) return;
  const key = e.key.toLowerCase();
  // In a lab, R is the lab's own instant reset. Outside one it restarts the
  // level in place -- a full reload would also throw away the audio context.
  if (key === 'r' && !lab) {
    hasRun = true;
    void game.restartLevel();
    return;
  }
  if (key === 'escape' || key === 'm') {
    e.preventDefault();
    showMenu();
  }
});

function renderLabMenu(active: LabDefinition | null): void {
  const groups: LabGroup[] = ['ARENA', 'RUNNER', 'VERTICAL', 'RADIAL', 'GLOBAL'];
  labList.innerHTML = groups.map((group) => {
    const items = LABS.filter((l) => l.group === group).map((l) => {
      const href = l.build ? `?lab=${l.id}` : '?level=prototype_90s.level.json';
      const current = active?.id === l.id ? ' class="current"' : '';
      return `<li><a href="${href}"${current}><span class="lab-no">${l.index}</span>${escapeHtml(l.title)}</a></li>`;
    }).join('');
    return `<div class="lab-group"><h4>${group}</h4><ul>${items}</ul></div>`;
  }).join('');
  if (active) levelSetup.classList.add('hidden');
}

function populateLevels(entries: LevelIndexEntry[], levelUrl: string): void {
  // The index stores library paths (`runner_showcase.level.json`); `levelUrl` is
  // the absolute URL we fetched, so strip the deploy base before comparing.
  const current = libraryPath(levelUrl);
  if (entries.length === 0) {
    levelSelect.innerHTML = `<option value="${current}">${current}</option>`;
    return;
  }
  levelSelect.innerHTML = entries
    .map((e) => `<option value="${e.file}"${e.file === current ? ' selected' : ''}>${escapeHtml(e.title)}</option>`)
    .join('');
  const entry = entries.find((e) => e.file === current);
  if (entry?.blurb) levelSelect.title = entry.blurb;
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c] ?? c);
}

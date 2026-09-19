import { BeatBoundGame } from './game/BeatBoundGame';
import { DATA, devOptionsFromLocation, loadLevelIndex, levelUrlFromLocation, type LevelIndexEntry } from './config';

const canvas = document.getElementById('stage') as HTMLCanvasElement;
const hudRoot = document.getElementById('hud') as HTMLElement;
const overlay = document.getElementById('overlay') as HTMLElement;
const startButton = document.getElementById('start') as HTMLButtonElement;
const subtitle = document.getElementById('overlay-subtitle') as HTMLElement;
const levelSelect = document.getElementById('level-select') as HTMLSelectElement;
const startBarInput = document.getElementById('start-bar') as HTMLInputElement;
const invincibleInput = document.getElementById('invincible') as HTMLInputElement;

const game = new BeatBoundGame(canvas, hudRoot);
const levelUrl = levelUrlFromLocation();
const dev = devOptionsFromLocation();

startBarInput.value = String(dev.startBar);
invincibleInput.checked = dev.invincible;

// Changing the level reloads with a new query string, so every configuration
// stays a shareable link.
levelSelect.addEventListener('change', () => {
  const params = new URLSearchParams(window.location.search);
  params.set('level', levelSelect.value);
  params.set('startBar', '1');
  window.location.search = params.toString();
});

void (async () => {
  populateLevels(await loadLevelIndex());

  try {
    const level = await game.load({ levelUrl, patternsUrl: DATA.patterns, mechanicsUrl: DATA.mechanics });
    const modes = [...new Set(level.sections.map((s) => s.mode))].join(' → ');
    const bars = level.endBar - 1;
    const seconds = level.tempo.beatsToTime(bars * level.tempo.beatsPerBar);
    startBarInput.max = String(bars);
    subtitle.textContent =
      `${level.song.bpm} BPM · ${bars} bars · ${seconds.toFixed(0)}s · ${modes}`;
    startButton.disabled = false;
    startButton.textContent = 'Start';
  } catch (error: unknown) {
    subtitle.innerHTML = `<span class="error">${message(error).replace(/\n/g, '<br>')}</span>`;
    startButton.textContent = 'Load failed';
  }
})();

startButton.addEventListener('click', () => {
  const options = {
    startBar: Math.max(1, Number(startBarInput.value) || 1),
    invincible: invincibleInput.checked,
  };
  // Keep the address bar in step so the current run can be linked or reloaded.
  const params = new URLSearchParams(window.location.search);
  params.set('level', levelSelect.value || fileFromUrl(levelUrl));
  params.set('startBar', String(options.startBar));
  if (options.invincible) params.set('invincible', '1');
  else params.delete('invincible');
  window.history.replaceState(null, '', `?${params.toString()}`);

  overlay.classList.add('hidden');
  game.start(options).catch((error: unknown) => {
    overlay.classList.remove('hidden');
    subtitle.innerHTML = `<span class="error">${message(error)}</span>`;
    startButton.textContent = 'Start failed';
    console.error('[BeatBound] start failed', error);
  });
});

window.addEventListener('keydown', (e) => {
  // Ignore the restart key while a form field has focus.
  if (document.activeElement instanceof HTMLInputElement) return;
  if (e.key.toLowerCase() === 'r') window.location.reload();
});

function populateLevels(entries: LevelIndexEntry[]): void {
  const current = fileFromUrl(levelUrl);
  if (entries.length === 0) {
    levelSelect.innerHTML = `<option value="${current}">${current}</option>`;
    return;
  }
  levelSelect.innerHTML = entries
    .map((e) => `<option value="${e.file}"${e.file === current ? ' selected' : ''}>${e.title}</option>`)
    .join('');
  const entry = entries.find((e) => e.file === current);
  if (entry?.blurb) levelSelect.title = entry.blurb;
}

function fileFromUrl(url: string): string {
  return url.replace(/^\//, '');
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

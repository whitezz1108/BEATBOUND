import { BeatBoundGame } from './game/BeatBoundGame';
import { DATA, devOptionsFromLocation, libraryPath, libraryUrl, loadLevelIndex, levelUrlFromLocation, type LevelIndexEntry } from './config';
import { findLab, LABS, type LabDefinition, type LabGroup } from './lab/labs';
import { LabController } from './lab/LabController';
import { MODE_COLOURS } from './core/ModeManager';
import type { GameMode } from './core/types';
import { createMenuBackdrop } from './menu/MenuBackdrop';

/** An index entry enriched with the fields the song-select screen needs. */
type SongEntry = LevelIndexEntry;

const canvas = document.getElementById('stage') as HTMLCanvasElement;
const hudRoot = document.getElementById('hud') as HTMLElement;
const labPanel = document.getElementById('lab-panel') as HTMLElement;
const overlay = document.getElementById('overlay') as HTMLElement;
const startButton = document.getElementById('start') as HTMLButtonElement;
const subtitle = document.getElementById('overlay-subtitle') as HTMLElement;
const songList = document.getElementById('song-list') as HTMLElement;
const startBarInput = document.getElementById('start-bar') as HTMLInputElement;
const invincibleInput = document.getElementById('invincible') as HTMLInputElement;
const labList = document.getElementById('lab-list') as HTMLElement;
const levelSetup = document.getElementById('setup') as HTMLElement;

const game = new BeatBoundGame(canvas, hudRoot);
const backdrop = createMenuBackdrop(
  document.getElementById('menu-bg') as HTMLCanvasElement,
  document.getElementById('hero') as HTMLCanvasElement,
);
const params = new URLSearchParams(window.location.search);
const lab = findLab(params.get('lab'));
const dev = devOptionsFromLocation();

/** The whole library; entries without a mode list only show under MIXED. */
let songs: SongEntry[] = [];
let selectedMode = 'MIXED';
/** Library path of the tile the player highlighted. */
let selectedFile = '';
/** Library path of the level currently loaded into the game. */
let loadedFile = '';
/** True once a run has been started, so the button knows to rebuild. */
let hasRun = false;

/** Song-select preview. Browsers block playback until the first user
 * gesture, so early `play()` calls reject and are dropped. */
const songPreview = new Audio();
songPreview.volume = 0.4;
songPreview.loop = true;
// In the DOM (controlless, invisible) so debug tooling can inspect it.
document.body.appendChild(songPreview);

renderLabMenu(lab);
// The page loads straight onto the title screen; this also starts the
// backdrop animation.
setMenuVisible(true);

/**
 * Title screen vs. run. Hiding the menu also parks the backdrop animation and
 * the music preview, and hands the window back to the game + debug panel.
 */
function setMenuVisible(visible: boolean): void {
  overlay.classList.toggle('hidden', !visible);
  document.body.classList.toggle('menu-open', visible);
  if (visible) {
    backdrop.start();
    // Back on song select: let the highlighted track play again.
    updatePreview();
  } else {
    backdrop.stop();
    songPreview.pause();
  }
}

if (lab && lab.build) {
  void startLab(lab);
} else {
  void startLevelFlow();
}

// --------------------------------------------------------------------------

async function startLab(definition: LabDefinition): Promise<void> {
  // A lab is the tuning environment: no menu, straight into the loop.
  setMenuVisible(false);
  labPanel.classList.remove('hidden');
  const controller = new LabController(game, definition, labPanel, Number(params.get('bpm')) || 120);
  try {
    await controller.launch();
  } catch (error: unknown) {
    setMenuVisible(true);
    subtitle.innerHTML = `<span class="error">${message(error)}</span>`;
    console.error('[BeatBound] lab failed', error);
  }
}

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
  setMenuVisible(true);
  startButton.disabled = false;
  startButton.textContent = hasRun ? 'Play again' : 'Start';
}

async function startLevelFlow(): Promise<void> {
  startBarInput.value = String(dev.startBar);
  invincibleInput.checked = dev.invincible;
  selectedFile = libraryPath(levelUrlFromLocation());

  songs = await loadLevelIndex();
  // A `?level=` pointing outside the index (e.g. an archived tuning level)
  // still has to be selectable, or the URL would silently start something else.
  if (!songs.some((e) => e.file === selectedFile)) {
    songs.unshift({ id: selectedFile, file: selectedFile, title: selectedFile });
  }

  wireModeFilter();
  renderSongList();

  try {
    await loadSelectedLevel();
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
    next.set('level', selectedFile);
    next.set('startBar', String(options.startBar));
    if (options.invincible) next.set('invincible', '1');
    else next.delete('invincible');
    window.history.replaceState(null, '', `?${next.toString()}`);

    setMenuVisible(false);
    // A newly picked level is loaded here rather than on tile click, so
    // browsing the list never stutters. After the first run the level's
    // systems are spent, so a same-level replay has to rebuild (restart).
    const launch = (async () => {
      if (selectedFile !== loadedFile) {
        startButton.disabled = true;
        startButton.textContent = 'Loading…';
        await loadSelectedLevel();
        startButton.disabled = false;
        await game.start(options);
      } else {
        await (hasRun ? game.restart(options) : game.start(options));
      }
      hasRun = true;
    })();
    launch.catch((error: unknown) => {
      setMenuVisible(true);
      subtitle.innerHTML = `<span class="error">${message(error)}</span>`;
      startButton.textContent = 'Start failed';
      hasRun = true;
      console.error('[BeatBound] start failed', error);
    });
  });
}

/** Load (or reload) whatever the highlighted tile points at. */
async function loadSelectedLevel(): Promise<void> {
  const level = await game.load({
    levelUrl: libraryUrl(selectedFile),
    patternsUrl: DATA.patterns,
    mechanicsUrl: DATA.mechanics,
  });
  loadedFile = selectedFile;
  const modes = [...new Set(level.sections.map((s) => s.mode))].join(' → ');
  const bars = level.endBar - 1;
  const seconds = level.tempo.beatsToTime(bars * level.tempo.beatsPerBar);
  startBarInput.max = String(bars);
  subtitle.textContent = `${level.song.bpm} BPM · ${bars} bars · ${seconds.toFixed(0)}s · ${modes}`;
  startButton.disabled = false;
  startButton.textContent = hasRun ? 'Play again' : 'Start';
}

/**
 * Mode cards double as song-list filters. MIXED shows the whole library; a
 * mode shows only the levels that contain it and highlights the first match.
 */
function wireModeFilter(): void {
  const cards = [...document.querySelectorAll<HTMLButtonElement>('#modes .mode-card')];
  for (const card of cards) {
    card.addEventListener('click', () => {
      selectedMode = card.dataset.mode ?? 'MIXED';
      const colour = selectedMode === 'MIXED' ? '#6de3ff' : MODE_COLOURS[selectedMode as GameMode] ?? '#6de3ff';
      backdrop.setAccent(colour);
      for (const other of cards) other.classList.toggle('selected', other === card);
      renderSongList();
    });
  }
  document.querySelector<HTMLButtonElement>('.mode-card[data-mode="MIXED"]')?.classList.add('selected');
}

function renderSongList(): void {
  const visible = songs.filter((e) => selectedMode === 'MIXED' || e.modes?.includes(selectedMode));
  if (!visible.some((e) => e.file === selectedFile)) {
    selectedFile = visible[0]?.file ?? '';
  }
  songList.replaceChildren();
  for (const entry of visible) {
    const tile = document.createElement('button');
    tile.type = 'button';
    tile.className = entry.file === selectedFile ? 'song-tile selected' : 'song-tile';
    tile.dataset.file = entry.file;

    // Album art slot: `covers/<id>.jpg` once real art lands, the song name
    // until then.
    const cover = document.createElement('span');
    cover.className = 'song-cover';
    cover.textContent = entry.title.replace(/\s*\[[^\]]*\]\s*$/, '');
    if (entry.id) {
      const img = document.createElement('img');
      img.alt = '';
      img.src = libraryUrl(`covers/${entry.id}.jpg`);
      img.addEventListener('load', () => cover.classList.add('has-img'));
      img.addEventListener('error', () => img.remove());
      cover.appendChild(img);
    }

    const info = document.createElement('span');
    info.className = 'song-info';
    const title = document.createElement('span');
    title.className = 'song-title';
    title.textContent = entry.title;
    title.title = entry.blurb ?? entry.title;
    const meta = document.createElement('span');
    meta.className = 'song-meta';
    meta.textContent = [
      entry.bpm ? `${entry.bpm} BPM` : '',
      entry.duration ? `${entry.duration}s` : '',
    ].filter(Boolean).join(' · ');
    info.append(title, meta);

    if (entry.modes?.length) {
      const chips = document.createElement('span');
      chips.className = 'song-modes';
      for (const mode of entry.modes) {
        const chip = document.createElement('span');
        chip.className = 'mode-chip';
        chip.textContent = mode;
        const colour = MODE_COLOURS[mode as GameMode] ?? '#8d99b5';
        chip.style.color = colour;
        chip.style.borderColor = colour;
        chips.appendChild(chip);
      }
      info.appendChild(chips);
    }

    tile.append(cover, info);
    tile.addEventListener('click', () => {
      selectedFile = entry.file;
      for (const other of [...songList.children] as HTMLElement[]) {
        other.classList.toggle('selected', other.dataset.file === selectedFile);
      }
      updatePreview();
    });
    songList.appendChild(tile);
  }
  updatePreview();
}

/** Start (or switch) the preview for the highlighted tile. */
function updatePreview(): void {
  const entry = songs.find((e) => e.file === selectedFile);
  if (!entry?.audio) {
    songPreview.pause();
    return;
  }
  const url = libraryUrl(entry.audio);
  if (!songPreview.src.endsWith(url)) {
    songPreview.src = url;
  }
  void songPreview.play().catch(() => {
    // No user gesture yet -- the first click anywhere unlocks it.
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
      const href = l.build ? `?lab=${l.id}` : '?level=_archive/prototype_90s.level.json';
      const current = active?.id === l.id ? ' class="current"' : '';
      return `<li><a href="${href}"${current}><span class="lab-no">${l.index}</span>${escapeHtml(l.title)}</a></li>`;
    }).join('');
    return `<div class="lab-group"><h4>${group}</h4><ul>${items}</ul></div>`;
  }).join('');
  if (active) levelSetup.classList.add('hidden');
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c] ?? c);
}

import { BeatBoundGame } from './game/BeatBoundGame';
import { DATA, levelUrlFromLocation } from './config';

const canvas = document.getElementById('stage') as HTMLCanvasElement;
const hudRoot = document.getElementById('hud') as HTMLElement;
const overlay = document.getElementById('overlay') as HTMLElement;
const startButton = document.getElementById('start') as HTMLButtonElement;
const subtitle = document.getElementById('overlay-subtitle') as HTMLElement;

const game = new BeatBoundGame(canvas, hudRoot);

// Audio may only start from a user gesture, so loading happens up front and
// playback waits for the click.
game
  .load({ levelUrl: levelUrlFromLocation(), patternsUrl: DATA.patterns, mechanicsUrl: DATA.mechanics })
  .then((level) => {
    const modes = [...new Set(level.sections.map((s) => s.mode))].join(', ');
    subtitle.textContent = `${level.song.title ?? level.song.id} · ${level.song.bpm} BPM · ${level.sections.length} sections · ${modes}`;
    startButton.disabled = false;
    startButton.textContent = 'Start';
  })
  .catch((error: unknown) => {
    subtitle.innerHTML = `<span class="error">${String(error instanceof Error ? error.message : error).replace(/\n/g, '<br>')}</span>`;
    startButton.textContent = 'Load failed';
  });

startButton.addEventListener('click', () => {
  overlay.classList.add('hidden');
  void game.start();
});

window.addEventListener('keydown', (e) => {
  if (e.key.toLowerCase() === 'r') window.location.reload();
});

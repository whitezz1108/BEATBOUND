/**
 * Runs one Polish Lab and owns its developer controls.
 *
 * The lab rebuilds its level whenever a tuning value changes, which keeps the
 * loop honest: a new BPM produces a genuinely re-compiled level rather than a
 * time-scaled one, so what is being tuned is what would ship.
 */

import type { BeatBoundGame } from '../game/BeatBoundGame';
import { polishPreset, setPolishPreset, TUNING, type PolishPreset } from '../tuning';
import type { LabDefinition } from './labs';

const PRESETS: PolishPreset[] = ['SUBTLE', 'STANDARD', 'MAX'];
const INTENSITY_PRESETS = [0.25, 0.55, 0.9];
const BPM_STEP = 5;
const BPM_MIN = 60;
const BPM_MAX = 200;

export class LabController {
  private bpm: number;
  private intensity = INTENSITY_PRESETS[1];
  private variantIndex = 0;
  private detach: (() => void) | null = null;
  private busy = false;

  constructor(
    private readonly game: BeatBoundGame,
    private readonly lab: LabDefinition,
    private readonly panel: HTMLElement,
    defaultBpm = 120,
  ) {
    this.bpm = defaultBpm;
  }

  get currentBpm(): number {
    return this.bpm;
  }

  async launch(): Promise<void> {
    // Pattern lengths must be available before the level is built.
    await this.game.prepareLibraries();
    await this.game.loadDefinition(this.buildLevel(), { loop: true });
    // Labs skip most of the count-in: the point is to be testing within a bar.
    await this.game.start({ countInBeats: 4, invincible: true });
    this.detach = this.attachKeys();
    this.renderPanel();
  }

  dispose(): void {
    this.detach?.();
    this.detach = null;
  }

  private buildLevel() {
    return this.lab.build!({
      bpm: this.bpm,
      intensity: this.intensity,
      variantIndex: this.variantIndex,
      lengthOf: (id) => this.game.lengthOfPattern(id),
    });
  }

  private async rebuild(): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    try {
      await this.game.swapDefinition(this.buildLevel(), { countInBeats: 2, invincible: true });
    } finally {
      this.busy = false;
    }
    this.renderPanel();
  }

  private attachKeys(): () => void {
    const onKey = (e: KeyboardEvent) => {
      if (document.activeElement instanceof HTMLInputElement) return;
      const key = e.key.toLowerCase();
      switch (key) {
        case 'r':
          e.preventDefault();
          void this.game.restart({ countInBeats: 2, invincible: true });
          return;
        case ' ':
          e.preventDefault();
          if (this.lab.trigger) {
            this.game.labTrigger(this.lab.trigger.mechanicId, this.lab.trigger.params ?? {}, this.intensity);
          }
          return;
        case '1': case '2': case '3':
          this.intensity = INTENSITY_PRESETS[Number(key) - 1];
          void this.rebuild();
          return;
        case '-': case '_':
          this.bpm = Math.max(BPM_MIN, this.bpm - BPM_STEP);
          void this.rebuild();
          return;
        case '=': case '+':
          this.bpm = Math.min(BPM_MAX, this.bpm + BPM_STEP);
          void this.rebuild();
          return;
        case '[':
          this.variantIndex -= 1;
          void this.rebuild();
          return;
        case ']':
          this.variantIndex += 1;
          void this.rebuild();
          return;
        case ',': case '.': {
          const step = key === '.' ? 1 : -1;
          const next = (PRESETS.indexOf(polishPreset()) + step + PRESETS.length) % PRESETS.length;
          setPolishPreset(PRESETS[next]);
          this.renderPanel();
          return;
        }
        case 'tab':
          e.preventDefault();
          window.location.search = '';
          return;
        default:
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }

  renderPanel(): void {
    // Say how many variants exist and how to reach them. A lab loops one
    // pattern forever by design, so without this it reads as "that is all it
    // does" rather than "this is one of four".
    const variants = this.lab.variants ?? [];
    const position = variants.length > 0
      ? ((this.variantIndex % variants.length) + variants.length) % variants.length
      : 0;
    const variant = variants.length > 0
      ? `${variants[position]}  (${position + 1}/${variants.length}, [ ] to cycle)`
      : 'none — this lab has one pattern';
    const t = TUNING;

    const rows: Array<[string, string]> = [
      ['LAB', `${this.lab.index}. ${this.lab.title}`],
      ['GROUP', this.lab.group],
      ['BPM', `${this.bpm}`],
      ['INTENSITY', this.intensity.toFixed(2)],
      ['VARIANT', variant],
      ['POLISH', polishPreset()],
    ];

    // Only show the tuning values this lab is actually about.
    if (this.lab.group === 'RUNNER') {
      rows.push(['JUMP', `${t.runner.jumpBeats} beats · h ${t.runner.jumpHeight}`]);
      rows.push(['BUFFER', `${(t.runner.inputBufferSeconds * 1000).toFixed(0)}ms · coyote ${(t.runner.coyoteSeconds * 1000).toFixed(0)}ms`]);
      rows.push(['SPEED', `${t.runner.unitsPerBeat} units/beat`]);
    } else if (this.lab.group === 'VERTICAL') {
      rows.push(['WINDOWS', `perfect ${t.vertical.perfectWindowBeats} · good ${t.vertical.goodWindowBeats} beats`]);
      rows.push(['HOLD TOL', `${t.vertical.holdToleranceBeats} · drift ${t.vertical.driftToleranceBeats}`]);
      rows.push(['APPROACH', `${t.vertical.approachBeats} beats`]);
    } else if (this.lab.group === 'RADIAL') {
      rows.push(['WINDOWS', `perfect ${t.radial.perfectWindowBeats} · good ${t.radial.goodWindowBeats} beats`]);
      rows.push(['DIAGONAL', `${(t.radial.diagonalToleranceSeconds * 1000).toFixed(0)}ms tolerance`]);
      rows.push(['APPROACH', `${t.radial.approachBeats} beats`]);
    } else {
      rows.push(['CAMERA', `beat ${t.camera.beatPulse} · down ${t.camera.downbeatPulse}`]);
      rows.push(['DODGE', `perfect margin ${t.arena.perfectDodgeMargin}`]);
    }

    this.panel.innerHTML = `
      <div class="lab-title">POLISH LAB</div>
      <div class="lab-hint">${escapeHtml(this.lab.hint)}</div>
      ${rows.map(([k, v]) => `<div class="hud-row"><span class="hud-label">${k}</span><span class="hud-value">${escapeHtml(v)}</span></div>`).join('')}
      <div class="lab-keys">
        <p><kbd>R</kbd> reset &nbsp; <kbd>Space</kbd> trigger &nbsp; <kbd>1</kbd><kbd>2</kbd><kbd>3</kbd> intensity</p>
        <p><kbd>-</kbd><kbd>=</kbd> BPM &nbsp; <kbd>[</kbd><kbd>]</kbd> variant &nbsp; <kbd>,</kbd><kbd>.</kbd> polish</p>
        <p><kbd>Tab</kbd> back to the lab menu</p>
      </div>`;
  }
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c] ?? c);
}

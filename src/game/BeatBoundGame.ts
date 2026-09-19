/**
 * Wiring + the frame loop.
 *
 * The dependency direction the architecture requires:
 *
 *   BeatClock -> LevelLoader -> PatternScheduler -> MechanicRegistry -> Runtime Mechanic
 *                     |
 *                     +-> ModeManager (owns the active gameplay environment)
 *
 * This class only connects those systems and pumps them once per frame. It
 * contains no mechanic behaviour, no pattern timing and no level specifics.
 */

import { AudioEngine, BufferSongPlayer, ClickTrackPlayer, type SongPlayer } from '../core/AudioEngine';
import { BeatClock } from '../core/BeatClock';
import { Input } from '../core/Input';
import { LevelLoader, type CompiledLevel, type CompiledSection, type LevelSources } from '../core/LevelLoader';
import { MechanicRegistry } from '../core/MechanicRegistry';
import { ModeManager } from '../core/ModeManager';
import { PatternScheduler } from '../core/PatternScheduler';
import { Renderer } from '../core/Renderer';
import { RunStatus } from '../core/RunStatus';
import { ArenaMode } from '../modes/arena/ArenaMode';
import { registerArenaMechanics } from '../mechanics/arena';
import { COUNT_IN_BEATS } from '../config';
import { Hud } from './Hud';

export class BeatBoundGame {
  private readonly audio = new AudioEngine();
  private readonly input = new Input();
  private readonly registry = new MechanicRegistry();
  private readonly loader = new LevelLoader();
  private readonly status = new RunStatus(3, 1);
  private readonly renderer: Renderer;

  private clock!: BeatClock;
  private scheduler!: PatternScheduler;
  private modes!: ModeManager;
  private songPlayer!: SongPlayer;
  private level!: CompiledLevel;
  private hud: Hud | null = null;

  private detachInput: (() => void) | null = null;
  private detachLifecycle: (() => void) | null = null;
  private rafHandle = 0;
  private running = false;
  private paused = false;
  private pauseReason: 'MANUAL' | 'STALL' = 'MANUAL';
  /** False until the clock has run once, so the initial lead-in is not a "stall". */
  private hasTicked = false;
  /**
   * A frame gap larger than this means the browser stopped rendering (hidden
   * window, occluded tab, heavy GC). Playing on would fire every missed beat in
   * one frame, so the run pauses and rewinds to the last beat it simulated.
   */
  private static readonly STALL_SECONDS = 0.35;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly hudRoot: HTMLElement,
  ) {
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('2D canvas context unavailable');
    this.renderer = new Renderer(ctx);
  }

  /** Load data and build every system. Does not start playback. */
  async load(sources: LevelSources): Promise<CompiledLevel> {
    this.level = await this.loader.load(sources);
    this.registry.loadLibrary(this.loader.mechanics);
    registerArenaMechanics(this.registry);

    this.songPlayer = await this.createSongPlayer();
    this.clock = new BeatClock(this.songPlayer, this.level.tempo);
    this.scheduler = new PatternScheduler(this.clock, this.registry);

    const modeContext = { clock: this.clock, input: this.input, status: this.status };
    this.modes = new ModeManager(this.clock, modeContext);
    // Only ARENA has a runtime today; every other mode falls back to a
    // placeholder until its module registers here.
    this.modes.register('ARENA', (ctx) => new ArenaMode(ctx));

    this.scheduler.onMechanicSpawned(this.modes.route);
    this.scheduleSections();
    this.scheduler.scheduleLevel(this.level);

    this.hud = new Hud(this.hudRoot, {
      clock: this.clock,
      level: this.level,
      modes: this.modes,
      scheduler: this.scheduler,
      status: this.status,
      player: this.songPlayer,
      currentSection: () => this.currentSection(),
    });

    this.reportReadiness();
    return this.level;
  }

  /** Mode changes happen on the section's bar line, minus its telegraph lead-in. */
  private scheduleSections(): void {
    const beatsPerBar = this.clock.beatsPerBar;
    let previousTransition: string | null = null;

    for (const section of this.level.sections) {
      const startBeat = (section.startBar - 1) * beatsPerBar;
      // Negative switch beats are fine and intended: the count-in runs at
      // negative song time, so bar 1's mode is already live (and its transition
      // already finished) by the time beat 0 arrives.
      const switchBeat = startBeat - section.leadInBeats;
      this.modes.scheduleMode(section.mode, switchBeat, previousTransition);
      previousTransition = section.transitionOut;
    }
  }

  private async createSongPlayer(): Promise<SongPlayer> {
    const buffer = await this.audio.loadBuffer(this.level.song.audio);
    if (buffer) return new BufferSongPlayer(this.audio, buffer, this.level.song.audio);
    // No audio asset -> synthesize a metronome so the rhythm systems still run
    // on the real audio clock. Drop the mp3 in and it is used automatically.
    console.info(`[BeatBound] audio "${this.level.song.audio}" not found -- using a generated click track.`);
    const lengthSeconds = this.level.tempo.beatsToTime((this.level.endBar - 1) * this.level.tempo.beatsPerBar + 4);
    return new ClickTrackPlayer(this.audio, this.level.tempo, lengthSeconds);
  }

  async start(): Promise<void> {
    if (this.running) return;
    await this.audio.resume();
    this.detachInput = this.input.attach();
    this.detachLifecycle = this.attachLifecycle();
    this.status.reset();
    this.hasTicked = false;
    // Count-in is musical: N beats of lead before bar 1, whatever the tempo.
    this.songPlayer.start(this.level.tempo.beatsToTime(COUNT_IN_BEATS));
    this.running = true;
    this.rafHandle = requestAnimationFrame(this.frame);
  }

  stop(): void {
    this.running = false;
    cancelAnimationFrame(this.rafHandle);
    this.songPlayer?.stop();
    this.detachInput?.();
    this.detachLifecycle?.();
    this.detachInput = null;
    this.detachLifecycle = null;
  }

  /**
   * requestAnimationFrame stops in a hidden tab while the audio clock keeps
   * running. Without this, returning to the tab would dump every missed beat
   * into a single frame. Freezing song time keeps the run honest instead.
   */
  private attachLifecycle(): () => void {
    const onVisibility = () => { if (document.hidden) this.pause(); };
    const onKey = (e: KeyboardEvent) => { if (e.key.toLowerCase() === 'p') this.togglePause(); };
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('keydown', onKey);
    };
  }

  pause(atSongTime?: number, reason: 'MANUAL' | 'STALL' = 'MANUAL'): void {
    if (!this.running || this.paused) return;
    this.paused = true;
    this.pauseReason = reason;
    this.songPlayer.pause(atSongTime);
  }

  resumePlay(): void {
    if (!this.running || !this.paused) return;
    this.paused = false;
    this.songPlayer.resume();
  }

  togglePause(): void {
    if (this.paused) this.resumePlay();
    else this.pause();
  }

  private frame = (): void => {
    if (!this.running) return;
    if (this.paused) {
      // Hold everything: no clock update means no callbacks and no drift.
      this.draw();
      this.hud?.render();
      this.rafHandle = requestAnimationFrame(this.frame);
      return;
    }
    this.songPlayer.update();

    // Detect a rendering stall before advancing musical time.
    const gap = this.songPlayer.playbackTime - this.clock.songTime;
    if (this.hasTicked && gap > BeatBoundGame.STALL_SECONDS) {
      this.pause(this.clock.songTime, 'STALL');
      this.draw();
      this.hud?.render();
      this.rafHandle = requestAnimationFrame(this.frame);
      return;
    }

    this.clock.update();
    this.hasTicked = true;

    const update = {
      beat: this.clock.absoluteBeat,
      deltaSeconds: this.clock.deltaSeconds,
      secondsPerBeat: this.clock.secondsPerBeat,
    };
    this.modes.update(update);

    this.checkRunEnd();
    this.draw();
    this.hud?.render();
    this.rafHandle = requestAnimationFrame(this.frame);
  };

  private checkRunEnd(): void {
    const endBeat = (this.level.endBar - 1) * this.clock.beatsPerBar;
    if (this.clock.absoluteBeat >= endBeat && this.status.outcome === 'PLAYING') {
      this.status.complete();
    }
  }

  private draw(): void {
    const { canvas, renderer } = this;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const cssWidth = canvas.clientWidth;
    const cssHeight = canvas.clientHeight;
    if (canvas.width !== Math.round(cssWidth * dpr) || canvas.height !== Math.round(cssHeight * dpr)) {
      canvas.width = Math.round(cssWidth * dpr);
      canvas.height = Math.round(cssHeight * dpr);
    }
    renderer.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    renderer.clear(cssWidth, cssHeight, '#05070d');
    renderer.layout(cssWidth, cssHeight);

    this.modes.render(renderer);
    this.drawOverlays(renderer);
  }

  private drawOverlays(r: Renderer): void {
    if (this.paused) {
      r.fillRect({ x: 0, y: 0, w: 1, h: 1 }, '#05070d', 0.75);
      r.text('PAUSED', 0.5, 0.46, '#e8ecf8', 30);
      r.text(
        this.pauseReason === 'STALL' ? 'rendering stalled — press P to resume' : 'press P to resume',
        0.5, 0.54, '#9aa4bd', 14,
      );
      return;
    }
    if (this.clock.songTime < 0) {
      const beatsLeft = Math.ceil(-this.clock.absoluteBeat);
      r.fillRect({ x: 0, y: 0, w: 1, h: 1 }, '#05070d', 0.55);
      r.text('GET READY', 0.5, 0.44, '#e8ecf8', 30);
      r.text(`${beatsLeft}`, 0.5, 0.54, '#6de3ff', 44);
      return;
    }
    if (this.status.outcome === 'FAILED') {
      r.fillRect({ x: 0, y: 0, w: 1, h: 1 }, '#180509', 0.7);
      r.text('FAILED', 0.5, 0.46, '#ff5470', 34);
      r.text('press R to restart', 0.5, 0.54, '#9aa4bd', 14);
    } else if (this.status.outcome === 'COMPLETE') {
      r.fillRect({ x: 0, y: 0, w: 1, h: 1 }, '#05120d', 0.7);
      r.text('LEVEL COMPLETE', 0.5, 0.46, '#7dffb0', 30);
      r.text(`hits taken: ${this.status.hits}`, 0.5, 0.54, '#9aa4bd', 14);
    }
  }

  private currentSection(): CompiledSection | null {
    const bar = Math.floor(Math.max(0, this.clock.absoluteBeat) / this.clock.beatsPerBar) + 1;
    return this.level.sections.find((s) => bar >= s.startBar && bar < s.endBar) ?? null;
  }

  /** One consolidated console report: data problems and missing implementations. */
  private reportReadiness(): void {
    for (const w of this.level.warnings) console.warn(`[LevelLoader] ${w}`);
    const missing = new Set<string>();
    for (const section of this.level.sections) {
      for (const placement of section.placements) {
        for (const event of placement.pattern.events) {
          if (!this.registry.hasImplementation(event.mechanicId)) missing.add(event.mechanicId);
        }
      }
    }
    if (missing.size > 0) {
      console.info(`[BeatBound] level references mechanics without runtimes yet: ${[...missing].sort().join(', ')}`);
    }
  }
}

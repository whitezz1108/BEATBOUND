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
 *
 * It runs two kinds of session through the identical path:
 *   - a level loaded from JSON (the full demo), and
 *   - a Polish Lab, whose level is built in memory but still compiled and
 *     scheduled exactly like a file-backed one.
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
import type { GameMode, LevelDefinition } from '../core/types';
import { GameFeel } from '../feel/GameFeel';
import { ArenaMode } from '../modes/arena/ArenaMode';
import { RunnerMode } from '../modes/runner/RunnerMode';
import { VerticalMode } from '../modes/vertical/VerticalMode';
import { RadialMode } from '../modes/radial/RadialMode';
import { registerArenaMechanics } from '../mechanics/arena';
import { registerRunnerMechanics } from '../mechanics/runner';
import { scheduleCourse } from '../mechanics/runner/courseSchedule';
import { registerVerticalMechanics } from '../mechanics/vertical';
import { registerRadialMechanics } from '../mechanics/radial';
import { COUNT_IN_BEATS, DATA, type DevOptions } from '../config';
import { MODE_CONTROLS } from '../core/controls';
import { MODE_COLOURS } from '../core/ModeManager';
import { beatsForSeconds, TUNING } from '../tuning';
import { Hud } from './Hud';
import { HealthBar } from './HealthBar';

export interface StartOptions extends Partial<DevOptions> {
  /** Labs loop forever and skip the long count-in. */
  countInBeats?: number;
}

export class BeatBoundGame {
  private readonly audio = new AudioEngine();
  readonly feel = new GameFeel(this.audio);
  private readonly input = new Input();
  private readonly registry = new MechanicRegistry();
  private readonly loader = new LevelLoader();
  private readonly status = new RunStatus();
  private readonly healthBar = new HealthBar();
  private readonly renderer: Renderer;

  private clock!: BeatClock;
  private scheduler!: PatternScheduler;
  private modes!: ModeManager;
  private songPlayer!: SongPlayer;
  private level!: CompiledLevel;
  private hud: Hud | null = null;
  private songBuffer: AudioBuffer | null = null;
  private unsubscribeBeat: (() => void) | null = null;

  private detachInput: (() => void) | null = null;
  private detachLifecycle: (() => void) | null = null;
  private rafHandle = 0;
  private running = false;
  private paused = false;
  private pauseReason: 'MANUAL' | 'STALL' = 'MANUAL';
  private hasTicked = false;
  private startBar = 1;
  /** Set once when health hits zero, so the death sequence runs a single time. */
  private deathHandled = false;
  private lastDevOptions: StartOptions = {};
  private countInBeats = COUNT_IN_BEATS;
  /** Labs restart instead of ending, so a failure costs a beat not a session. */
  private loopOnEnd = false;

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
    this.registry.useFeel(this.feel);
  }

  get compiledLevel(): CompiledLevel {
    return this.level;
  }

  get runStatus(): RunStatus {
    return this.status;
  }

  /**
   * Load the pattern and mechanic libraries without a level.
   *
   * Labs need this first: they size their own sections from real pattern
   * lengths, so asking before the library exists silently produces one-bar
   * sections.
   */
  async prepareLibraries(): Promise<void> {
    await this.loader.loadLibraries(DATA.patterns, DATA.mechanics);
  }

  /** Bars a pattern occupies, for labs that size their own sections. */
  lengthOfPattern(patternId: string): number {
    return this.loader.patternLibrary.get(patternId)?.lengthBars ?? 0;
  }

  /** Fire one mechanic on the next beat. The Polish Lab's trigger key. */
  labTrigger(mechanicId: string, params: Record<string, unknown>, intensity: number): boolean {
    if (!this.scheduler) return false;
    const nextBeat = Math.floor(this.clock.absoluteBeat) + 1;
    return this.scheduler.spawnOneShot(mechanicId, params, intensity, nextBeat);
  }

  // ---- loading ----------------------------------------------------------

  /** Load a level from JSON. */
  async load(sources: LevelSources): Promise<CompiledLevel> {
    await this.loader.loadLibraries(sources.patternsUrl, sources.mechanicsUrl);
    const definition = await fetchLevel(sources.levelUrl);
    this.songBuffer = await this.audio.loadBuffer(definition.song.audio);
    if (!this.songBuffer) {
      console.info(`[BeatBound] audio "${definition.song.audio}" not found -- using a generated click track.`);
    }
    return this.adopt(this.loader.build(definition), false);
  }

  /** Load a level built in memory (the Polish Lab path). */
  async loadDefinition(definition: LevelDefinition, options: { loop?: boolean } = {}): Promise<CompiledLevel> {
    await this.loader.loadLibraries(DATA.patterns, DATA.mechanics);
    // Labs run on the click track: they change BPM constantly, which no
    // recorded song would survive.
    this.songBuffer = null;
    return this.adopt(this.loader.build(definition), options.loop ?? false);
  }

  private adopt(level: CompiledLevel, loop: boolean): CompiledLevel {
    this.level = level;
    this.loopOnEnd = loop;

    this.registry.loadLibrary(this.loader.mechanics);
    registerArenaMechanics(this.registry);
    registerRunnerMechanics(this.registry);
    registerVerticalMechanics(this.registry);
    registerRadialMechanics(this.registry);

    this.buildSystems();
    this.reportReadiness();
    return level;
  }

  /** (Re)create every per-run system. Called on load and on a lab rebuild. */
  private buildSystems(): void {
    this.unsubscribeBeat?.();
    this.songPlayer?.stop();

    this.songPlayer = this.makeSongPlayer();
    this.clock = new BeatClock(this.songPlayer, this.level.tempo);
    this.scheduler = new PatternScheduler(this.clock, this.registry);

    const modeContext = { clock: this.clock, input: this.input, status: this.status, feel: this.feel };
    this.modes = new ModeManager(this.clock, modeContext);
    // One line per mode. DUO has no mechanics or patterns in the library yet,
    // so it still falls through to the placeholder.
    this.modes.register('ARENA', (ctx) => new ArenaMode(ctx));
    this.modes.register('RUNNER', (ctx) => new RunnerMode(ctx));
    this.modes.register('VERTICAL', (ctx) => new VerticalMode(ctx));
    this.modes.register('RADIAL', (ctx) => new RadialMode(ctx));

    this.scheduler.onMechanicSpawned(this.modes.route);
    this.scheduleSections();
    this.scheduler.scheduleLevel(this.level);
    this.scheduleCourses();

    this.unsubscribeBeat = this.clock.onBeat((wholeBeat) => {
      this.feel.onBeat(wholeBeat, this.clock.beatsPerBar);
    });

    this.hud = new Hud(this.hudRoot, {
      clock: this.clock,
      level: this.level,
      modes: this.modes,
      scheduler: this.scheduler,
      status: this.status,
      player: this.songPlayer,
      currentSection: () => this.currentSection(),
      countIn: () => this.isCountingIn,
    });
  }

  /** Mode changes happen on the section's bar line, minus its telegraph lead-in. */
  private scheduleSections(): void {
    const beatsPerBar = this.clock.beatsPerBar;
    let previousTransition: string | null = null;
    for (const section of this.level.sections) {
      const startBeat = (section.startBar - 1) * beatsPerBar;
      // Negative switch beats are fine and intended: the count-in runs at
      // negative song time, so bar 1's mode is already live by beat 0.
      this.modes.scheduleMode(section.mode, startBeat - section.leadInBeats, previousTransition);
      previousTransition = section.transitionOut;
    }
  }

  /**
   * RUNNER courses go through the scheduler like everything else.
   *
   * A course has no pattern and no library entry, so the pattern timeline cannot
   * produce it -- but it still has to arrive as a mechanic so the mode accepts it
   * through the one road it knows. This schedules that spawn, one bar early, on
   * the same clock and through the same sink as every pattern event.
   */
  private scheduleCourses(): void {
    for (const section of this.level.sections) {
      scheduleCourse(this.clock, this.registry, section, this.modes.route);
    }
  }

  /**
   * The song, or a click track when the level has no audio asset.
   *
   * The buffer is decoded during load, before any system is built, because the
   * scheduler, modes and HUD are all wired to a specific BeatClock -- swapping
   * the player in afterwards would leave them driving a clock nothing reads.
   */
  private makeSongPlayer(): SongPlayer {
    if (this.songBuffer) {
      return new BufferSongPlayer(this.audio, this.songBuffer, this.level.song.audio);
    }
    const lengthSeconds = this.level.tempo.beatsToTime(
      (this.level.endBar - 1) * this.level.tempo.beatsPerBar + 8,
    );
    return new ClickTrackPlayer(this.audio, this.level.tempo, lengthSeconds);
  }

  // ---- session ----------------------------------------------------------

  async start(dev: StartOptions = {}): Promise<void> {
    if (this.running) return;
    await this.audio.resume();
    this.detachInput = this.input.attach();
    this.detachLifecycle = this.attachLifecycle();
    // The count-in is three real seconds, converted to beats at this tempo.
    this.countInBeats = dev.countInBeats
      ?? Math.max(4, beatsForSeconds(this.level.song.bpm, TUNING.transition.countdownSeconds));
    this.status.reset();
    this.status.invincible = dev.invincible ?? false;
    this.healthBar.reset();
    this.feel.reset();
    this.hasTicked = false;
    this.paused = false;
    this.deathHandled = false;
    this.lastDevOptions = dev;

    const startBeat = this.applyStartBar(dev.startBar ?? 1);
    this.songPlayer.start(
      this.level.tempo.beatsToTime(this.countInBeats),
      this.level.tempo.beatsToTime(startBeat),
    );
    this.running = true;
    this.rafHandle = requestAnimationFrame(this.frame);
  }

  /**
   * Rebuild and relaunch with a new level definition, keeping the session
   * alive. The lab uses this for BPM, intensity and variant changes.
   */
  async swapDefinition(definition: LevelDefinition, dev: StartOptions = {}): Promise<void> {
    const wasRunning = this.running;
    this.running = false;
    cancelAnimationFrame(this.rafHandle);
    this.level = this.loader.build(definition);
    this.buildSystems();
    if (wasRunning) {
      this.detachInput?.();
      this.detachLifecycle?.();
      this.detachInput = null;
      this.detachLifecycle = null;
      await this.start(dev);
    }
  }

  /** Instant restart -- the lab's R key, and what a looping lab does at the end. */
  async restart(dev: StartOptions = {}): Promise<void> {
    this.running = false;
    cancelAnimationFrame(this.rafHandle);
    this.detachInput?.();
    this.detachLifecycle?.();
    this.detachInput = null;
    this.detachLifecycle = null;
    this.buildSystems();
    await this.start(dev);
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

  private attachLifecycle(): () => void {
    const onVisibility = () => { if (document.hidden) this.pause(); };
    const onKey = (e: KeyboardEvent) => {
      if (document.activeElement instanceof HTMLInputElement) return;
      if (e.key.toLowerCase() === 'p') this.togglePause();
    };
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

  /** Absolute beat the run begins at (after any dev seek). */
  private get startBeat(): number {
    return (this.startBar - 1) * this.clock.beatsPerBar;
  }

  get isCountingIn(): boolean {
    return this.clock.absoluteBeat < this.startBeat;
  }

  private applyStartBar(startBar: number): number {
    const lastBar = Math.max(1, this.level.endBar - 1);
    const bar = Math.min(Math.max(1, Math.floor(startBar)), lastBar);
    this.startBar = bar;
    if (bar === 1) return 0;

    const startBeat = (bar - 1) * this.clock.beatsPerBar;
    const dropped = this.clock.seekTo(startBeat);
    const section = this.level.sections.find((s) => bar >= s.startBar && bar < s.endBar);
    if (section) this.modes.setMode(section.mode, startBeat, null);
    console.info(`[BeatBound] starting at bar ${bar}; skipped ${dropped} scheduled event(s).`);
    return startBeat;
  }

  // ---- frame ------------------------------------------------------------

  private frame = (): void => {
    if (!this.running) return;
    if (this.paused) {
      this.draw();
      this.hud?.render();
      this.rafHandle = requestAnimationFrame(this.frame);
      return;
    }
    this.songPlayer.update();

    const gap = this.songPlayer.playbackTime - this.clock.songTime;
    if (this.hasTicked && gap > BeatBoundGame.STALL_SECONDS) {
      this.pause(this.clock.songTime, 'STALL');
      this.draw();
      this.hud?.render();
      this.rafHandle = requestAnimationFrame(this.frame);
      return;
    }

    // A hit-stop freezes what is drawn, never the schedule or the music.
    if (this.feel.isHitStopped) this.clock.holdVisual(1 / 60);
    this.clock.update();
    this.hasTicked = true;

    const update = {
      beat: this.clock.absoluteBeat,
      songTime: this.clock.songTime,
      deltaSeconds: this.clock.deltaSeconds,
      secondsPerBeat: this.clock.secondsPerBeat,
    };
    this.modes.update(update);
    this.input.endFrame();
    this.healthBar.update(this.status, this.clock.deltaSeconds);
    if (this.status.outcome === 'FAILED' && !this.deathHandled) this.onDeath();
    this.feel.update(this.clock.deltaSeconds, this.clock.visualBeat);
    this.feel.setEnergy(this.sectionEnergy());

    this.checkRunEnd();
    this.draw();
    this.hud?.render();
    this.rafHandle = requestAnimationFrame(this.frame);
  };

  /** Section difficulty drives how busy the ambient layer is. */
  private sectionEnergy(): number {
    const section = this.currentSection();
    if (!section) return 0.3;
    const difficulty = section.definition.difficulty ?? 2;
    const intensity = section.placements[0]?.intensity ?? 0.5;
    return Math.min(1, (difficulty - 1) / 4 * 0.6 + intensity * 0.4);
  }

  /**
   * Death. Input is already refused by the modes; this makes the world safe and
   * stops anything new arriving, so the player can look at what killed them.
   */
  private onDeath(): void {
    this.deathHandled = true;
    this.clock.clearSchedule();
    this.modes.clearHazards();
    this.feel.impact('HEAVY', { colour: '#ff2547', sfx: 'runner_fail' });
    this.feel.screen.vignette('#ff1133', 0.75);
  }

  /** Restart the current level from the top, keeping the same dev options. */
  async restartLevel(): Promise<void> {
    await this.restart(this.lastDevOptions);
  }

  get isFailed(): boolean {
    return this.status.outcome === 'FAILED';
  }

  private checkRunEnd(): void {
    const endBeat = (this.level.endBar - 1) * this.clock.beatsPerBar;
    if (this.status.outcome === 'FAILED') return;
    if (this.clock.absoluteBeat < endBeat) return;
    if (this.loopOnEnd) {
      void this.restart({ invincible: this.status.invincible, countInBeats: this.countInBeats });
      return;
    }
    if (this.status.outcome === 'PLAYING') this.status.complete();
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
    renderer.resetCamera();
    renderer.clear(cssWidth, cssHeight, '#05070d');
    renderer.layout(cssWidth, cssHeight);

    // Rendering priority (see the architecture notes): background, ambient,
    // level geometry + telegraph + hazards, player, feedback, then UI.
    this.feel.applyCamera(renderer);
    renderer.withFieldClip(() => this.feel.renderBackground(renderer));
    this.modes.render(renderer);
    renderer.withFieldClip(() => this.feel.renderForeground(renderer));
    renderer.resetCamera();
    this.feel.renderScreen(renderer, cssWidth, cssHeight);
    this.drawOverlays(renderer);
    // The health bar sits above the overlays: it stays readable on the death
    // screen, which is where the player most wants to see what happened.
    this.healthBar.render(renderer, this.status, cssWidth, this.clock.visualBeat);
  }

  /**
   * Countdown into a mode change.
   *
   * The scheduler has already stopped spawning by this point, so the arena is
   * emptying; this says why, what is arriving, and which keys the player will
   * need. The numbers are a three-second 3-2-1, mapped onto the breather's
   * beats at the current tempo.
   */
  private drawBreather(r: Renderer): void {
    const section = this.currentSection();
    if (!section?.breatherFromBeat || !section.nextMode) return;
    const beat = this.clock.visualBeat;
    const sectionEnd = (section.endBar - 1) * this.clock.beatsPerBar;
    if (beat < section.breatherFromBeat || beat > sectionEnd) return;

    const alpha = Math.min(1, (beat - section.breatherFromBeat) / 1.5);
    const colour = MODE_COLOURS[section.nextMode] ?? '#6de3ff';
    r.text(`NEXT: ${section.nextMode}`, 0.5, 0.08, colour, 16, 'center', alpha * 0.9);
    const hints = MODE_CONTROLS[section.nextMode] ?? [];
    hints.forEach((hint, i) => {
      r.text(`${hint.label}  ${hint.keys.join('  ')}`, 0.5, 0.135 + i * 0.03, '#9aa4bd', 12, 'center', alpha * 0.8);
    });
    const remainingSeconds = (sectionEnd - beat) * this.clock.secondsPerBeat;
    const count = Math.min(3, Math.max(1, Math.ceil(remainingSeconds / (TUNING.transition.countdownSeconds / 3))));
    r.text(`${count}`, 0.5, 0.16 + hints.length * 0.03, '#e8ecf8', 26, 'center', alpha * 0.9);
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
    if (this.isCountingIn) {
      // Three real seconds, displayed as 3-2-1: mode name, its controls from
      // the shared binding table, then the count itself.
      r.fillRect({ x: 0, y: 0, w: 1, h: 1 }, '#05070d', 0.55);
      r.text('GET READY', 0.5, 0.34, '#e8ecf8', 28);
      const mode = this.modeAtBeat(Math.max(0, this.startBeat));
      if (mode) {
        r.text(mode, 0.5, 0.41, MODE_COLOURS[mode] ?? '#6de3ff', 20, 'center');
        const hints = MODE_CONTROLS[mode] ?? [];
        hints.forEach((hint, i) => {
          r.text(`${hint.label}  ${hint.keys.join('  ')}`, 0.5, 0.47 + i * 0.03, '#9aa4bd', 13, 'center');
        });
      }
      const remainingSeconds = (this.startBeat - this.clock.absoluteBeat) * this.clock.secondsPerBeat;
      const count = Math.min(3, Math.max(1, Math.ceil(remainingSeconds / (TUNING.transition.countdownSeconds / 3))));
      r.text(`${count}`, 0.5, 0.62, '#6de3ff', 40, 'center');
      if (this.startBar > 1) r.text(`starting at bar ${this.startBar}`, 0.5, 0.7, '#9aa4bd', 13);
      return;
    }
    this.drawBreather(r);

    if (this.status.outcome === 'FAILED') {
      r.fillRect({ x: 0, y: 0, w: 1, h: 1 }, '#180509', 0.72);
      r.text('GAME OVER', 0.5, 0.43, '#ff5470', 34);
      const cause = this.status.health.lastDamageEvent?.source ?? null;
      if (cause) r.text(`finished by: ${cause.toLowerCase()}`, 0.5, 0.50, '#9aa4bd', 13);
      r.text(`hits taken: ${this.status.hits}   notes missed: ${this.status.notesMissed}`, 0.5, 0.55, '#6b7691', 12);
      r.text('press R to restart the level', 0.5, 0.62, '#e8ecf8', 14);
      r.text('press Esc for the menu', 0.5, 0.67, '#9aa4bd', 13);
    } else if (this.status.outcome === 'COMPLETE') {
      r.fillRect({ x: 0, y: 0, w: 1, h: 1 }, '#05120d', 0.7);
      r.text('LEVEL COMPLETE', 0.5, 0.44, '#7dffb0', 30);
      r.text(
        `hits taken: ${this.status.hits}   notes missed: ${this.status.notesMissed}   HP left: ${Math.round(this.status.health.currentHealth)}`,
        0.5, 0.51, '#9aa4bd', 13,
      );
      r.text('press R to play again', 0.5, 0.60, '#e8ecf8', 14);
      r.text('press Esc for the menu', 0.5, 0.65, '#9aa4bd', 13);
    }
  }

  private currentSection(): CompiledSection | null {
    const bar = Math.floor(Math.max(0, this.clock.absoluteBeat) / this.clock.beatsPerBar) + 1;
    return this.level.sections.find((s) => bar >= s.startBar && bar < s.endBar) ?? null;
  }

  /** Mode of the section containing `beat`, for the count-in overlay. */
  private modeAtBeat(beat: number): GameMode | null {
    const bar = Math.floor(Math.max(0, beat) / this.clock.beatsPerBar) + 1;
    return this.level.sections.find((s) => bar >= s.startBar && bar < s.endBar)?.mode ?? null;
  }

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

async function fetchLevel(url: string): Promise<LevelDefinition> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to load ${url}: HTTP ${res.status}`);
  return (await res.json()) as LevelDefinition;
}

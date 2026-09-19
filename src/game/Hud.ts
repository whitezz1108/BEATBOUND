/** DOM debug/status panel. Read-only view over the running systems. */

import type { BeatClock } from '../core/BeatClock';
import type { CompiledLevel, CompiledSection } from '../core/LevelLoader';
import type { ModeManager } from '../core/ModeManager';
import type { PatternScheduler } from '../core/PatternScheduler';
import type { RunStatus } from '../core/RunStatus';
import type { SongPlayer } from '../core/AudioEngine';

export interface HudSources {
  clock: BeatClock;
  level: CompiledLevel;
  modes: ModeManager;
  scheduler: PatternScheduler;
  status: RunStatus;
  player: SongPlayer;
  currentSection: () => CompiledSection | null;
}

export class Hud {
  constructor(private readonly root: HTMLElement, private readonly sources: HudSources) {}

  render(): void {
    const { clock, level, modes, scheduler, status, player } = this.sources;
    const pos = clock.position;
    const section = this.sources.currentSection();
    const stats = clock.stats;
    const countIn = clock.songTime < 0;

    this.root.innerHTML = [
      row('SONG', `${level.song.title ?? level.song.id} · ${level.song.bpm} BPM · ${level.song.timeSignature.join('/')}`),
      row('AUDIO', player.sourceLabel),
      row('TIME', `${countIn ? 'count-in ' : ''}${clock.songTime.toFixed(2)}s${player.isPaused ? '  [PAUSED]' : ''}`),
      row('BAR/BEAT', `${pos.bar}.${pos.beat} ${progressBar(pos.beatProgress)}`),
      row('SECTION', section ? `${section.id} · ${section.mode} · bars ${section.startBar}-${section.endBar - 1}` : '—'),
      row('MODE', `${modes.activeModeId ?? '—'}${modes.isTransitioning ? ' (transition)' : ''}`),
      row('STATE', modes.activeMode?.statusLine ?? '—'),
      row('SCHEDULER', `queued:${clock.pendingCount} scheduled:${scheduler.scheduledEventCount} spawned:${scheduler.spawnedMechanicCount} dropped:${modes.droppedSpawnCount}`),
      row('SYNC', `last ${stats.lastLatencyMs.toFixed(1)}ms · mean ${stats.meanLatencyMs.toFixed(1)}ms · max ${stats.maxLatencyMs.toFixed(1)}ms`),
      row('RUN', `${'♥'.repeat(status.hp)}${'·'.repeat(Math.max(0, status.maxHp - status.hp))}  hits:${status.hits}  ${status.outcome}`),
    ].join('');
  }
}

function row(label: string, value: string): string {
  return `<div class="hud-row"><span class="hud-label">${label}</span><span class="hud-value">${escapeHtml(value)}</span></div>`;
}

function progressBar(t: number): string {
  const slots = 8;
  const filled = Math.round(t * slots);
  return `[${'#'.repeat(filled)}${'-'.repeat(slots - filled)}]`;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c] ?? c);
}

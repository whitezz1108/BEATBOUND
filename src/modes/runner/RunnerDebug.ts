/**
 * RUNNER developer debug view (spec §63).
 *
 * Toggled with the backtick key. It draws the things that are invisible in
 * normal play but decide whether a level is fair:
 *
 *   - the beat grid, so a jump can be read against the music;
 *   - every solid face the mode resolved (support in cyan, blocker in amber),
 *     which is *literally* the collision world rather than a redrawn guess;
 *   - the jump envelope from the current surface -- the apex line and the
 *     horizontal reach -- so "can I make that platform" is answerable by eye;
 *   - the head clearance left under the nearest blocker;
 *   - where the player has actually been, as a fading breadcrumb trail, which
 *     is the only way to see whether the intended line matches the flown line;
 *   - the phrase and motif currently playing, when the course runner knows.
 *
 * It is deliberately cheap: it draws in field space with the same Renderer the
 * game uses, allocates nothing per frame beyond the strings it prints, and is
 * skipped entirely when off.
 */

import { hasTerrain, platformsOf } from '../../core/capabilities';
import type { RuntimeMechanic } from '../../core/Mechanic';
import type { Renderer } from '../../core/Renderer';
import { CEILING_Y, GROUND_Y, PLAYER_X, UNITS_PER_BEAT } from '../../mechanics/runner/runnerGeometry';
import { apexFor, beatsToUnits } from '../../mechanics/runner/runnerPhysics';
import { zoneOfY } from '../../mechanics/runner/verticalZones';
import type { RunnerPlayer } from './RunnerPlayer';

/** What the course mechanic can say about the phrase in play, for the legend. */
export interface DebugPhrase {
  label: string;
  motif: string;
  /** Authored loudness of the phrase, 0..1. */
  intensity: number;
  /** Fraction of the phrase in the two zones nearest its own surface. */
  groundRatio: number;
}

export interface RunnerDebugPayload {
  probe: { support: number | null; blocker: number | null };
  gravityDirection: number;
  player: RunnerPlayer;
  breadcrumbs: ReadonlyArray<{ x: number; y: number }>;
  beat: number;
  beatsPerBar: number;
  mechanics: readonly RuntimeMechanic[];
  /** Name of the motion phrase currently being flown, if the runner knows. */
  phrase?: string;
  /** Motif the phrase belongs to, if the runner knows. */
  motif?: string;
  /** Loudness and ground-hugging of the current phrase, when known. */
  phraseIntensity?: number;
  groundRatio?: number;
}

const SUPPORT_COLOUR = '#6de3ff';
const BLOCKER_COLOUR = '#ffb648';
const GRID_COLOUR = '#5b6b8f';

export function renderRunnerDebug(r: Renderer, payload: RunnerDebugPayload): void {
  const { probe, gravityDirection, player, beat, beatsPerBar, mechanics } = payload;
  const g = gravityDirection;

  drawBeatGrid(r, beat, beatsPerBar);
  drawFaces(r, mechanics, g);
  drawEnvelope(r, probe.support, g);
  drawClearance(r, probe, player, g);
  drawBreadcrumbs(r, payload.breadcrumbs);
  drawLegend(r, payload);
}

/** Vertical beat lines with bar numbers on the live surface. */
function drawBeatGrid(r: Renderer, beat: number, beatsPerBar: number): void {
  for (let i = -2; i < 12; i++) {
    const tickBeat = Math.floor(beat) + i;
    const x = PLAYER_X + (tickBeat - beat) * UNITS_PER_BEAT;
    if (x < -0.05 || x > 1.05) continue;
    const downbeat = ((tickBeat % beatsPerBar) + beatsPerBar) % beatsPerBar === 0;
    r.line(x, 0, x, 1, GRID_COLOUR, 1, downbeat ? 0.32 : 0.14);
    if (downbeat) {
      const bar = Math.floor(tickBeat / beatsPerBar) + 1;
      r.text(String(bar), x + 0.008, 0.014, GRID_COLOUR, 11, 'left', 0.75);
    }
  }
}

/** Every solid face the mode resolved, coloured by role. */
function drawFaces(r: Renderer, mechanics: readonly RuntimeMechanic[], g: number): void {
  for (const m of mechanics) {
    if (!hasTerrain(m)) continue;
    // Read through the plural accessor: a course contributes many slabs at once
    // and the singular one would show only the legacy obstacles, which is
    // exactly the view that hides the thing being debugged.
    for (const plat of platformsOf(m)) {
      const supportFace = g > 0 ? plat.top : plat.bottom;
      const blockFace = g > 0 ? plat.bottom : plat.top;
      r.line(plat.x0, supportFace, plat.x1, supportFace, SUPPORT_COLOUR, 2, 0.85);
      // A face sitting on the base line is not a real blocker; do not draw it as
      // one or the view lies about what will stop a jump.
      const onBase = Math.abs(blockFace - (g > 0 ? GROUND_Y : CEILING_Y)) < 1e-6;
      if (!onBase) r.line(plat.x0, blockFace, plat.x1, blockFace, BLOCKER_COLOUR, 2, 0.7);
      r.line(plat.x0, plat.top, plat.x0, plat.bottom, '#7d86a3', 1, 0.35);
      r.line(plat.x1, plat.top, plat.x1, plat.bottom, '#7d86a3', 1, 0.35);
    }
  }
}

/** Apex line and horizontal reach from the surface the player is on. */
function drawEnvelope(r: Renderer, support: number | null, g: number): void {
  if (support === null) {
    r.text('NO SUPPORT', PLAYER_X + 0.02, 0.5, '#ff5c5c', 13, 'left', 0.9);
    return;
  }
  const apex = support - g * apexFor(1);
  r.line(0, apex, 1, apex, SUPPORT_COLOUR, 1, 0.4);
  r.text('apex', 0.995, apex - g * 0.02, SUPPORT_COLOUR, 10, 'right', 0.7);
  // Reach marks at whole beats of airtime, so the arc's length is legible.
  for (let b = 1; b <= 1; b++) {
    const x = PLAYER_X + beatsToUnits(b * 0.95);
    r.line(x, support - g * 0.02, x, support - g * 0.005, '#9ffcff', 2, 0.7);
  }
}

/** Head clearance under the nearest blocker. */
function drawClearance(
  r: Renderer,
  probe: { support: number | null; blocker: number | null },
  player: RunnerPlayer,
  g: number,
): void {
  if (probe.blocker === null) return;
  const head = player.head;
  const clearance = (head - probe.blocker) * g;
  if (clearance < 0) return;
  const x = PLAYER_X + 0.05;
  r.line(x, head, x, probe.blocker, BLOCKER_COLOUR, 1, 0.8);
  r.text(`${clearance.toFixed(3)}`, x + 0.012, (head + probe.blocker) / 2, BLOCKER_COLOUR, 10, 'left', 0.85);
}

/** Where the player actually was, fading with age. */
function drawBreadcrumbs(r: Renderer, crumbs: ReadonlyArray<{ x: number; y: number }>): void {
  for (let i = 1; i < crumbs.length; i++) {
    const a = crumbs[i - 1];
    const b = crumbs[i];
    // Breadcrumbs are recorded in *screen* space at the moment they were made;
    // they scroll with the track, so they read as a path through the level.
    const age = (crumbs.length - i) / crumbs.length;
    r.line(a.x, a.y, b.x, b.y, '#ffffff', 1, 0.22 * (1 - age));
  }
}

function drawLegend(r: Renderer, payload: RunnerDebugPayload): void {
  const g = payload.gravityDirection > 0 ? 'FLOOR' : 'CEILING';
  // Where the player's feet are in the field, so a "why is this phrase flat"
  // question is answerable from the screen rather than from a rerun of the
  // audit. The ground ratio is the same number the audit judges, shown live.
  const feet = payload.player.feet;
  const zone = zoneOfY(feet);
  const level = Math.abs(feet - (payload.gravityDirection > 0 ? GROUND_Y : CEILING_Y));
  const phraseLine = payload.phrase
    ? `phrase:${payload.phrase}`
      + `${payload.phraseIntensity !== undefined ? ` ${(payload.phraseIntensity * 100).toFixed(0)}%` : ''}`
      + `${payload.groundRatio !== undefined ? `  ground:${(payload.groundRatio * 100).toFixed(0)}%` : ''}`
    : 'phrase:-';
  const rows = [
    `DEBUG  gravity:${g}  beat:${payload.beat.toFixed(2)}`,
    `support:${fmt(payload.probe.support)}  blocker:${fmt(payload.probe.blocker)}`,
    `airborne:${payload.player.isGrounded ? 'no' : 'yes'}  zone:${zone}  level:${level.toFixed(3)}`
      + `${payload.player.isAirJumpArmed ? '  ◎ARMED' : ''}`,
    phraseLine,
    payload.motif ? `motif:${payload.motif}` : 'motif:-',
    '` to hide',
  ];
  rows.forEach((row, i) => {
    r.text(row, 0.012, 0.03 + i * 0.026, '#cfe3ff', 11, 'left', 0.85);
  });
}

function fmt(value: number | null): string {
  return value === null ? 'none' : value.toFixed(3);
}

/**
 * RADIAL -- four-direction rhythm.
 *
 * Notes converge on a ring at the centre and must be met with the matching
 * direction key on their beat. Same judging as VERTICAL (both extend NoteMode);
 * only the geometry and the key mapping differ.
 */

import { RADIAL_DIRECTIONS, type NoteTarget, type RadialDirection } from '../../core/capabilities';
import type { Renderer } from '../../core/Renderer';
import type { GameMode } from '../../core/types';
import { HIT_WINDOW_BEATS, NoteMode } from '../rhythm/NoteMode';

const CENTRE = 0.5;
/** Radius a note is judged at. */
const RING_RADIUS = 0.13;
/** Radius a note enters at. */
const SPAWN_RADIUS = 0.46;
/** Beats of travel from the outer edge to the ring. */
const APPROACH_BEATS = 2;

const DIRECTION_KEYS: Record<RadialDirection, string[]> = {
  UP: ['arrowup', 'w'],
  RIGHT: ['arrowright', 'd'],
  DOWN: ['arrowdown', 's'],
  LEFT: ['arrowleft', 'a'],
};

const DIRECTION_VECTORS: Record<RadialDirection, { x: number; y: number }> = {
  UP: { x: 0, y: -1 },
  RIGHT: { x: 1, y: 0 },
  DOWN: { x: 0, y: 1 },
  LEFT: { x: -1, y: 0 },
};

const DIRECTION_GLYPHS: Record<RadialDirection, string> = {
  UP: '▲',
  RIGHT: '▶',
  DOWN: '▼',
  LEFT: '◀',
};

const DIRECTION_COLOURS: Record<RadialDirection, string> = {
  UP: '#6de3ff',
  RIGHT: '#ffc46d',
  DOWN: '#ff8ec4',
  LEFT: '#9a8cff',
};

export class RadialMode extends NoteMode {
  readonly mode: GameMode = 'RADIAL';

  protected keysFor(target: NoteTarget): string[] {
    return DIRECTION_KEYS[target.direction ?? 'UP'];
  }

  /** Distance from centre for a note due on `noteBeat`, at `beat`. */
  private radiusAt(noteBeat: number, beat: number): number {
    const beatsAway = noteBeat - beat;
    return RING_RADIUS + (beatsAway / APPROACH_BEATS) * (SPAWN_RADIUS - RING_RADIUS);
  }

  protected renderStage(r: Renderer, beat: number): void {
    // Approach guides out to each direction.
    for (const direction of RADIAL_DIRECTIONS) {
      const v = DIRECTION_VECTORS[direction];
      const held = this.ctx.input.isDown(...DIRECTION_KEYS[direction]);
      const colour = DIRECTION_COLOURS[direction];
      r.line(
        CENTRE + v.x * RING_RADIUS, CENTRE + v.y * RING_RADIUS,
        CENTRE + v.x * SPAWN_RADIUS, CENTRE + v.y * SPAWN_RADIUS,
        colour, held ? 3 : 1, held ? 0.5 : 0.15,
      );
      // Target marker sitting on the ring.
      r.text(
        DIRECTION_GLYPHS[direction],
        CENTRE + v.x * (RING_RADIUS + 0.055),
        CENTRE + v.y * (RING_RADIUS + 0.055),
        colour, 16, 'center', held ? 1 : 0.45,
      );
    }

    // The ring pulses on the beat: the moment to press.
    const pulse = 1 - (((beat % 1) + 1) % 1);
    r.strokeCircle(CENTRE, CENTRE, RING_RADIUS, '#e8ecf8', 3, 0.35 + 0.45 * pulse);
    r.fillCircle(CENTRE, CENTRE, RING_RADIUS * 0.25, '#ffffff', 0.1 + 0.2 * pulse);
  }

  protected renderNote(r: Renderer, target: NoteTarget, beat: number): void {
    const direction = target.direction ?? 'UP';
    const v = DIRECTION_VECTORS[direction];
    const colour = DIRECTION_COLOURS[direction];

    if (target.state === 'HIT' || target.state === 'MISSED' || target.state === 'BROKEN') {
      const age = beat - (target.hitBeat ?? target.beat);
      if (age > 0.5) return;
      const alpha = 1 - age / 0.5;
      const flash = target.state === 'HIT' ? colour : '#ff5470';
      r.strokeCircle(
        CENTRE + v.x * RING_RADIUS, CENTRE + v.y * RING_RADIUS,
        0.025 + age * 0.06, flash, 3, alpha,
      );
      return;
    }

    const radius = this.radiusAt(target.beat, beat);
    if (radius > SPAWN_RADIUS + 0.05) return;
    const x = CENTRE + v.x * radius;
    const y = CENTRE + v.y * radius;
    const inWindow = Math.abs(target.beat - beat) <= HIT_WINDOW_BEATS;

    r.fillCircle(x, y, 0.028, colour, inWindow ? 1 : 0.75);
    r.strokeCircle(x, y, 0.034, '#ffffff', 2, inWindow ? 0.9 : 0.25);
  }
}

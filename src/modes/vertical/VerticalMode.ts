/**
 * VERTICAL -- four-lane falling-note rhythm.
 *
 * Notes enter at the top and reach the hit line exactly on their beat. Travel
 * is a pure function of the beat, so the approach *is* the countdown: a note
 * halfway down is half a telegraph away.
 */

import type { NoteTarget } from '../../core/capabilities';
import type { Renderer } from '../../core/Renderer';
import type { GameMode } from '../../core/types';
import { clamp } from '../../core/geometry';
import { LANE_COUNT } from '../../mechanics/vertical/LaneNoteMechanic';
import { HIT_WINDOW_BEATS, NoteMode } from '../rhythm/NoteMode';

/** Where a note is judged. */
const HIT_LINE_Y = 0.82;
/** Beats of travel from the top of the board to the hit line. */
const APPROACH_BEATS = 2;
const NOTE_HEIGHT = 0.045;

/** Lane 1..4 -> the keys that play it. Home-row style, plus the number row. */
const LANE_KEYS: Record<number, string[]> = {
  1: ['d', '1'],
  2: ['f', '2'],
  3: ['j', '3'],
  4: ['k', '4'],
};

const LANE_COLOURS = ['#6de3ff', '#9a8cff', '#ff8ec4', '#ffc46d'];

export class VerticalMode extends NoteMode {
  readonly mode: GameMode = 'VERTICAL';

  protected keysFor(target: NoteTarget): string[] {
    return LANE_KEYS[target.lane ?? 1] ?? LANE_KEYS[1];
  }

  private laneCentre(lane: number): number {
    return (clamp(lane, 1, LANE_COUNT) - 0.5) / LANE_COUNT;
  }

  /** y of a note due on `noteBeat`, at `beat`. Reaches the hit line on time. */
  private noteY(noteBeat: number, beat: number): number {
    const beatsAway = noteBeat - beat;
    return HIT_LINE_Y - (beatsAway / APPROACH_BEATS) * HIT_LINE_Y;
  }

  protected renderStage(r: Renderer, beat: number): void {
    const laneWidth = 1 / LANE_COUNT;
    for (let lane = 1; lane <= LANE_COUNT; lane++) {
      const x = (lane - 1) * laneWidth;
      const held = this.ctx.input.isDown(...LANE_KEYS[lane]);
      r.fillRect({ x, y: 0, w: laneWidth, h: 1 }, LANE_COLOURS[lane - 1], held ? 0.12 : 0.04);
      r.line(x, 0, x, 1, '#1c2434', 1);
      // Key hint under the hit line.
      r.text(LANE_KEYS[lane][0].toUpperCase(), x + laneWidth / 2, 0.92, '#5f6f95', 16);
    }

    // Hit line, pulsing on the beat so the target moment is unmistakable.
    const pulse = 1 - (((beat % 1) + 1) % 1);
    r.line(0, HIT_LINE_Y, 1, HIT_LINE_Y, '#e8ecf8', 3, 0.35 + 0.45 * pulse);
    r.fillRect(
      { x: 0, y: HIT_LINE_Y - NOTE_HEIGHT / 2, w: 1, h: NOTE_HEIGHT },
      '#ffffff',
      0.05 + 0.08 * pulse,
    );
  }

  protected renderNote(r: Renderer, target: NoteTarget, beat: number): void {
    const laneWidth = 1 / LANE_COUNT;
    const lane = target.lane ?? 1;
    const colour = LANE_COLOURS[clamp(lane, 1, LANE_COUNT) - 1];
    const cx = this.laneCentre(lane);
    const y = this.noteY(target.beat, beat);
    if (y < -0.1) return;

    if (target.state === 'HIT' || target.state === 'MISSED' || target.state === 'BROKEN') {
      // Brief resolution flash at the hit line rather than a note still falling.
      const age = beat - (target.hitBeat ?? target.beat);
      if (age > 0.5) return;
      const alpha = 1 - age / 0.5;
      const flash = target.state === 'HIT' ? colour : '#ff5470';
      r.strokeCircle(cx, HIT_LINE_Y, 0.03 + age * 0.06, flash, 3, alpha);
      return;
    }

    const body = { x: cx - laneWidth / 2 + 0.012, y: y - NOTE_HEIGHT / 2, w: laneWidth - 0.024, h: NOTE_HEIGHT };

    if (target.state === 'HOLDING') {
      // Draw the remaining tail the player still has to keep held.
      const tailTop = this.noteY(target.beat + target.holdBeats, beat);
      r.fillRect({ x: body.x, y: tailTop, w: body.w, h: HIT_LINE_Y - tailTop }, colour, 0.5);
      r.fillRect({ ...body, y: HIT_LINE_Y - NOTE_HEIGHT / 2 }, colour, 0.95);
      return;
    }

    if (target.holdBeats > 0) {
      const tailTop = this.noteY(target.beat + target.holdBeats, beat);
      r.fillRect({ x: body.x, y: tailTop, w: body.w, h: y - tailTop }, colour, 0.35);
    }

    // Inside the judging window the note brightens: press now.
    const inWindow = Math.abs(target.beat - beat) <= HIT_WINDOW_BEATS;
    r.fillRect(body, colour, inWindow ? 1 : 0.8);
    r.strokeRect(body, '#ffffff', 2, inWindow ? 0.9 : 0.3);
  }
}

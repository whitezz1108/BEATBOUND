/**
 * VERTICAL -- four-lane falling-note rhythm.
 *
 * Notes enter at the top and reach the hit line exactly on their beat. Travel
 * is a pure function of the beat, so the approach *is* the countdown: a note
 * halfway down is half a telegraph away.
 *
 * Three note families share the board:
 *   TAP    one press on the line
 *   HOLD   press, keep holding, release at the tail
 *   DRIFT  press, keep holding, and move across lanes while you hold
 *
 * The highway stays deliberately clean. Feedback is allowed at the judgement
 * line and above the note, never scattered through the approach lanes, because
 * timing readability outranks decoration here.
 */

import type { NoteTarget } from '../../core/capabilities';
import type { Renderer } from '../../core/Renderer';
import type { GameMode } from '../../core/types';
import { clamp } from '../../core/geometry';
import { easeOutCubic } from '../../feel/Easing';
import { LANE_COUNT } from '../../mechanics/vertical/LaneNoteMechanic';
import { TUNING } from '../../tuning';
import { NoteMode } from '../rhythm/NoteMode';

/** Where a note is judged. */
const HIT_LINE_Y = 0.82;
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

  private keysFor(target: NoteTarget, beat: number): string[] {
    return LANE_KEYS[this.laneOf(target, beat)] ?? LANE_KEYS[1];
  }

  protected justPressed(target: NoteTarget, beat: number): boolean {
    return this.ctx.input.wasPressed(...this.keysFor(target, beat));
  }

  protected isHeld(target: NoteTarget, beat: number): boolean {
    return this.ctx.input.isDown(...this.keysFor(target, beat));
  }

  protected judgementAnchor(target: NoteTarget, beat: number): { x: number; y: number } {
    return { x: this.laneCentre(this.laneOf(target, beat)), y: HIT_LINE_Y - 0.06 };
  }

  protected isOffscreen(target: NoteTarget, beat: number): boolean {
    // The whole note, tail included, has to be past the bottom edge.
    return this.noteY(target.beat + target.holdBeats, beat) > 1.08;
  }

  private laneCentre(lane: number): number {
    return (clamp(lane, 1, LANE_COUNT) - 0.5) / LANE_COUNT;
  }

  /** y of a note due on `noteBeat`, at `beat`. Reaches the hit line on time. */
  private noteY(noteBeat: number, beat: number): number {
    const beatsAway = noteBeat - beat;
    return HIT_LINE_Y - (beatsAway / TUNING.vertical.approachBeats) * HIT_LINE_Y;
  }

  protected renderStage(r: Renderer, beat: number): void {
    const laneWidth = 1 / LANE_COUNT;
    for (let lane = 1; lane <= LANE_COUNT; lane++) {
      const x = (lane - 1) * laneWidth;
      const held = this.ctx.input.isDown(...LANE_KEYS[lane]);
      r.fillRect({ x, y: 0, w: laneWidth, h: 1 }, LANE_COLOURS[lane - 1], held ? 0.14 : 0.04);
      r.line(x, 0, x, 1, '#1c2434', 1);
      if (held) {
        // Pressed lanes glow from the judgement line, not the whole column.
        r.glow(x + laneWidth / 2, HIT_LINE_Y, laneWidth * 1.1, LANE_COLOURS[lane - 1], 0.3);
      }
      r.text(LANE_KEYS[lane][0].toUpperCase(), x + laneWidth / 2, 0.92, held ? '#e8ecf8' : '#5f6f95', 16);
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
    const headLane = target.path?.[0].lane ?? target.lane ?? 1;
    const colour = LANE_COLOURS[clamp(headLane, 1, LANE_COUNT) - 1];

    if (target.state === 'EXPIRED') return;

    if (target.state === 'HIT') {
      // A played note is consumed: it bursts at the line instead of falling on.
      const age = beat - (target.hitBeat ?? target.beat);
      if (age > 0.5) return;
      const alpha = 1 - age / 0.5;
      const cx = this.laneCentre(this.laneOf(target, beat));
      r.strokeCircle(cx, HIT_LINE_Y, 0.03 + easeOutCubic(age / 0.5) * 0.07, colour, 3, alpha);
      return;
    }

    if (target.state === 'MISSED' || target.state === 'BROKEN') {
      // Scored, inert, and still falling. Drawn hollow and red so it cannot be
      // confused with something still playable.
      const cx = this.laneCentre(this.laneOf(target, beat));
      const y = this.noteY(target.beat, beat);
      const body = {
        x: cx - laneWidth / 2 + 0.012, y: y - NOTE_HEIGHT / 2,
        w: laneWidth - 0.024, h: NOTE_HEIGHT,
      };
      const fade = clamp(1 - (beat - (target.hitBeat ?? target.beat)) / 2.5, 0.25, 1);
      r.strokeRect(body, '#ff5470', 2, 0.7 * fade);
      r.fillRect(body, '#ff5470', 0.12 * fade);
      if (target.holdBeats > 0) {
        const tailTop = this.noteY(target.beat + target.holdBeats, beat);
        r.strokeRect({ x: body.x, y: tailTop, w: body.w, h: y - tailTop }, '#ff5470', 1, 0.3 * fade);
      }
      return;
    }

    if (target.path && target.path.length > 1) {
      this.renderDrift(r, target, beat, colour, laneWidth);
      return;
    }

    const cx = this.laneCentre(headLane);
    const y = this.noteY(target.beat, beat);
    if (y < -0.12) return;
    const body = { x: cx - laneWidth / 2 + 0.012, y: y - NOTE_HEIGHT / 2, w: laneWidth - 0.024, h: NOTE_HEIGHT };

    if (target.holdBeats > 0) {
      const tailTop = this.noteY(target.beat + target.holdBeats, beat);
      const bodyTop = target.state === 'HOLDING' ? HIT_LINE_Y : y;
      // Energy flows along a held body so it reads as sustaining, not sitting.
      r.fillRect({ x: body.x, y: tailTop, w: body.w, h: bodyTop - tailTop }, colour,
        target.state === 'HOLDING' ? 0.55 : 0.3);
      if (target.state === 'HOLDING') this.renderHoldEnergy(r, body.x, body.w, tailTop, bodyTop, colour, beat);
    }

    if (target.state === 'HOLDING') {
      r.fillRect({ ...body, y: HIT_LINE_Y - NOTE_HEIGHT / 2 }, colour, 0.95);
      return;
    }

    // Inside the judging window the note brightens: press now.
    const inWindow = Math.abs(target.beat - beat) <= this.hitWindow;
    r.fillRect(body, colour, inWindow ? 1 : 0.8);
    r.strokeRect(body, '#ffffff', 2, inWindow ? 0.9 : 0.3);
  }

  /**
   * A drift hold draws the whole lane path as a ribbon: the player can see the
   * next lane change coming before it arrives, which is the entire skill.
   */
  private renderDrift(
    r: Renderer, target: NoteTarget, beat: number, colour: string, laneWidth: number,
  ): void {
    const path = target.path!;
    const holding = target.state === 'HOLDING';
    const points: Array<{ x: number; y: number }> = [];
    for (const segment of path) {
      const y = this.noteY(target.beat + segment.beatOffset, beat);
      const x = this.laneCentre(segment.lane);
      // Square the corner so the ribbon shows *when* the lane changes.
      if (points.length > 0) points.push({ x: points[points.length - 1].x, y });
      points.push({ x, y });
    }
    const tailY = this.noteY(target.beat + target.holdBeats, beat);
    if (points.length > 0) points.push({ x: points[points.length - 1].x, y: tailY });
    if (points.every((p) => p.y < -0.15)) return;

    r.polyline(points, colour, r.len(laneWidth - 0.03), holding ? 0.5 : 0.28);
    r.polyline(points, '#ffffff', 2, holding ? 0.55 : 0.28);

    // Checkpoint markers: the beats where the hand has to move.
    for (const segment of path) {
      const y = this.noteY(target.beat + segment.beatOffset, beat);
      if (y < -0.1 || y > 1.05) continue;
      const x = this.laneCentre(segment.lane);
      const imminent = Math.abs(target.beat + segment.beatOffset - beat) < 0.3;
      r.fillCircle(x, y, imminent ? 0.016 : 0.011, '#ffffff', imminent ? 0.95 : 0.55);
    }

    const headY = holding ? HIT_LINE_Y : this.noteY(target.beat, beat);
    const headX = this.laneCentre(this.laneOf(target, beat));
    const inWindow = !holding && Math.abs(target.beat - beat) <= this.hitWindow;
    r.fillRect(
      { x: headX - laneWidth / 2 + 0.012, y: headY - NOTE_HEIGHT / 2, w: laneWidth - 0.024, h: NOTE_HEIGHT },
      colour, holding || inWindow ? 1 : 0.8,
    );
    if (holding) {
      // A travelling marker shows which lane is live right now.
      r.strokeCircle(headX, HIT_LINE_Y, 0.032, '#ffffff', 3, 0.85);
      const lapse = (target.offBeats ?? 0) / TUNING.vertical.driftToleranceBeats;
      if (lapse > 0.05) r.strokeCircle(headX, HIT_LINE_Y, 0.045, '#ff5470', 2, clamp(lapse, 0, 1));
    }
  }

  private renderHoldEnergy(
    r: Renderer, x: number, w: number, top: number, bottom: number, colour: string, beat: number,
  ): void {
    for (let i = 0; i < 3; i++) {
      const phase = ((beat * 2 + i / 3) % 1);
      const y = bottom - (bottom - top) * phase;
      if (y < top || y > bottom) continue;
      r.fillRect({ x, y: y - 0.006, w, h: 0.012 }, colour, 0.5 * (1 - phase) + 0.2);
    }
  }
}

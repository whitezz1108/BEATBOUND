/**
 * RADIAL -- eight-direction rhythm.
 *
 * Prompts converge on a ring at the centre and must be met with the matching
 * direction on their beat. Judging is shared with VERTICAL through NoteMode;
 * only the geometry and the input model differ.
 *
 * Input model (§30 Option B): four cardinal keys, with a diagonal entered by
 * holding two at once. Two keys never land on the same frame, so a diagonal
 * counts as entered when both components are down and the *second* one arrived
 * within `diagonalToleranceSeconds`. A cardinal prompt refuses a press that is
 * part of a diagonal, so the eight directions stay genuinely distinct.
 */

import type { NoteTarget } from '../../core/capabilities';
import {
  CARDINAL_KEYS, DIRECTION8, DIRECTION_ANGLE, DIRECTION_COLOUR, DIRECTION_COMPONENTS,
  DIRECTION_GLYPH, DIRECTION_VECTOR, isDiagonal, type Direction8,
} from '../../core/direction8';
import type { Renderer } from '../../core/Renderer';
import type { GameMode } from '../../core/types';
import type { MechanicUpdate } from '../../core/Mechanic';
import { clamp } from '../../core/geometry';
import { easeOutCubic } from '../../feel/Easing';
import { TUNING } from '../../tuning';
import { NoteMode } from '../rhythm/NoteMode';
import type { ModeContext } from '../GameplayMode';

const CENTRE = 0.5;
/** Radius a prompt is judged at. */
const RING_RADIUS = 0.13;
/** Radius a prompt enters at. */
const SPAWN_RADIUS = 0.46;

type Cardinal = 'N' | 'E' | 'S' | 'W';
const CARDINAL_LIST: Cardinal[] = ['N', 'E', 'S', 'W'];

export class RadialMode extends NoteMode {
  readonly mode: GameMode = 'RADIAL';

  /** Seconds-clock timestamp of the last press of each cardinal. */
  private readonly pressedAt: Record<Cardinal, number> = { N: -1, E: -1, S: -1, W: -1 };
  private now = 0;
  /** Cardinals that went down on this frame. */
  private readonly freshThisFrame = new Set<Cardinal>();

  constructor(ctx: ModeContext) {
    super(ctx);
  }

  override update(u: MechanicUpdate): void {
    // Sample the cardinal edges once per frame, before any target is judged,
    // so every prompt in a chord sees the same input snapshot.
    this.now += u.deltaSeconds;
    this.freshThisFrame.clear();
    for (const c of CARDINAL_LIST) {
      if (this.ctx.input.wasPressed(...CARDINAL_KEYS[c])) {
        this.pressedAt[c] = this.now;
        this.freshThisFrame.add(c);
      }
    }
    super.update(u);
  }

  private isCardinalDown(c: Cardinal): boolean {
    return this.ctx.input.isDown(...CARDINAL_KEYS[c]);
  }

  private directionOf(target: NoteTarget): Direction8 {
    return (target.direction as Direction8) ?? 'N';
  }

  protected justPressed(target: NoteTarget): boolean {
    const direction = this.directionOf(target);
    const components = DIRECTION_COMPONENTS[direction] as Cardinal[];
    const tolerance = TUNING.radial.diagonalToleranceSeconds;

    if (components.length === 2) {
      const [a, b] = components;
      if (!this.isCardinalDown(a) || !this.isCardinalDown(b)) return false;
      // One of the pair must be new this frame, and they must be close enough
      // together to read as a single two-key gesture.
      if (!this.freshThisFrame.has(a) && !this.freshThisFrame.has(b)) return false;
      return Math.abs(this.pressedAt[a] - this.pressedAt[b]) <= tolerance;
    }

    const c = components[0];
    if (!this.freshThisFrame.has(c)) return false;
    // A press that is half of a diagonal must not satisfy a cardinal prompt.
    return !CARDINAL_LIST.some(
      (other) => other !== c && this.isCardinalDown(other)
        && Math.abs(this.pressedAt[other] - this.pressedAt[c]) <= tolerance,
    );
  }

  protected isHeld(target: NoteTarget): boolean {
    const components = DIRECTION_COMPONENTS[this.directionOf(target)] as Cardinal[];
    return components.every((c) => this.isCardinalDown(c));
  }

  protected judgementAnchor(target: NoteTarget): { x: number; y: number } {
    const v = DIRECTION_VECTOR[this.directionOf(target)];
    return { x: CENTRE + v.x * RING_RADIUS, y: CENTRE + v.y * RING_RADIUS };
  }

  protected isOffscreen(target: NoteTarget, beat: number): boolean {
    // Missed prompts keep converging and expire once they reach the middle.
    return this.radiusAt(target.beat, beat) <= 0.012;
  }

  /** Distance from centre for a prompt due on `noteBeat`, at `beat`. */
  private radiusAt(noteBeat: number, beat: number): number {
    const beatsAway = noteBeat - beat;
    return RING_RADIUS + (beatsAway / TUNING.radial.approachBeats) * (SPAWN_RADIUS - RING_RADIUS);
  }

  /** True when the player is currently entering this direction. */
  private isDirectionActive(direction: Direction8): boolean {
    const components = DIRECTION_COMPONENTS[direction] as Cardinal[];
    if (!components.every((c) => this.isCardinalDown(c))) return false;
    if (components.length === 2) return true;
    // Highlight a cardinal only when it is not part of a diagonal being entered.
    return !CARDINAL_LIST.some((other) => other !== components[0] && this.isCardinalDown(other));
  }

  protected renderStage(r: Renderer, beat: number): void {
    // Eight anchors. Diagonals are drawn at a shorter radius with a lighter
    // guide so they stay visually separable from the cardinals.
    for (const direction of DIRECTION8) {
      const v = DIRECTION_VECTOR[direction];
      const diagonal = isDiagonal(direction);
      const active = this.isDirectionActive(direction);
      const colour = DIRECTION_COLOUR[direction];
      const outer = diagonal ? SPAWN_RADIUS * 0.88 : SPAWN_RADIUS;

      r.line(
        CENTRE + v.x * RING_RADIUS, CENTRE + v.y * RING_RADIUS,
        CENTRE + v.x * outer, CENTRE + v.y * outer,
        colour, active ? 3 : 1, active ? 0.55 : diagonal ? 0.10 : 0.18,
      );

      // Marker sitting just outside the ring, at the direction's own angle.
      const markerRadius = RING_RADIUS + 0.052;
      r.text(
        DIRECTION_GLYPH[direction],
        CENTRE + v.x * markerRadius, CENTRE + v.y * markerRadius,
        colour, diagonal ? 14 : 17, 'center', active ? 1 : diagonal ? 0.35 : 0.5,
      );
      if (active) r.glow(CENTRE + v.x * markerRadius, CENTRE + v.y * markerRadius, 0.05, colour, 0.5);
    }

    // A faint arc ties the eight anchors together as one dial.
    r.strokeCircle(CENTRE, CENTRE, RING_RADIUS + 0.052, '#1c2434', 1, 0.5);

    // The judgement ring pulses on the beat: the moment to press.
    const pulse = 1 - (((beat % 1) + 1) % 1);
    r.strokeCircle(CENTRE, CENTRE, RING_RADIUS, '#e8ecf8', 3, 0.35 + 0.45 * pulse);
    r.fillCircle(CENTRE, CENTRE, RING_RADIUS * 0.22, '#ffffff', 0.1 + 0.2 * pulse);
  }

  protected renderNote(r: Renderer, target: NoteTarget, beat: number): void {
    const direction = this.directionOf(target);
    const v = DIRECTION_VECTOR[direction];
    const colour = DIRECTION_COLOUR[direction];
    const diagonal = isDiagonal(direction);

    if (target.state === 'EXPIRED') return;

    if (target.state === 'HIT') {
      const age = beat - (target.hitBeat ?? target.beat);
      if (age > 0.5) return;
      r.strokeCircle(
        CENTRE + v.x * RING_RADIUS, CENTRE + v.y * RING_RADIUS,
        0.025 + easeOutCubic(age / 0.5) * 0.07, colour, 3, 1 - age / 0.5,
      );
      return;
    }

    if (target.state === 'MISSED' || target.state === 'BROKEN') {
      // Carries on through the ring toward the centre, hollow and red.
      const missedRadius = Math.max(0.012, this.radiusAt(target.beat, beat));
      const fade = clamp(missedRadius / RING_RADIUS, 0.2, 1);
      r.strokeCircle(CENTRE + v.x * missedRadius, CENTRE + v.y * missedRadius, 0.026, '#ff5470', 2, 0.75 * fade);
      return;
    }

    const radius = this.radiusAt(target.beat, beat);
    if (radius > SPAWN_RADIUS + 0.06) return;
    const x = CENTRE + v.x * radius;
    const y = CENTRE + v.y * radius;
    const inWindow = Math.abs(target.beat - beat) <= this.hitWindow;

    // Approach trail back along the arm.
    const tail = clamp(radius + 0.05, 0, SPAWN_RADIUS + 0.06);
    r.line(CENTRE + v.x * tail, CENTRE + v.y * tail, x, y, colour, 2, 0.2);

    // Diagonals are drawn as squares, cardinals as discs, so an eight-way board
    // never becomes eight identical dots.
    if (diagonal) {
      const s = 0.024;
      const a = DIRECTION_ANGLE[direction];
      const corners = [0, 1, 2, 3].map((i) => {
        const t = a + Math.PI / 4 + (i * Math.PI) / 2;
        return { x: x + Math.cos(t) * s, y: y + Math.sin(t) * s };
      });
      r.fillPolygon(corners, colour, inWindow ? 1 : 0.75);
    } else {
      r.fillCircle(x, y, 0.027, colour, inWindow ? 1 : 0.75);
    }
    r.strokeCircle(x, y, 0.034, '#ffffff', 2, inWindow ? 0.9 : 0.25);
    if (inWindow) r.glow(x, y, 0.07, colour, 0.35);
  }
}

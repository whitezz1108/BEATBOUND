/**
 * A12 Rhythm Breakout -- the prompt interface.
 *
 * Drawn low and wide, in the strip under the arena's working area, for one
 * reason: the encounter happens in the *middle* of the screen and the player
 * has to keep watching it. A prompt row that sat near the centre would ask
 * them to choose between reading the sequence and reading the seal, and they
 * would lose either way.
 *
 * LAYOUT (one row: the phrase and its accent are one object)
 *   +0.300    the row -- one diamond per arrow prompt, the SPACE target at
 *             its right end, all of them on the same line
 *
 * That offset is measured *from the player*, not from the screen. The seal is
 * closed around the body, so the row that answers it is closed around the body
 * too: the player reads "these arrows" and "that ring" as one composed object
 * centred on themselves, and a hit's particles land on the glyph that produced
 * them wherever the player happens to be standing. With the player at the
 * middle of the board -- which is where a locked encounter puts them, and where
 * ARENA starts them -- the offset resolves to y 0.80, the strip this file has
 * always drawn.
 *
 * The anchor is clamped into a readable band rather than followed absolutely.
 * A row can be nearly a full board wide, so a player pinned against a wall
 * would otherwise drag half the phrase off the screen; the band keeps the row
 * whole while still letting it track the body across the middle of the arena.
 * An encounter that locks the player at the centre never touches the clamp.
 *
 * There is no judgement track. There used to be -- a line of beat ticks under
 * the arrows with a playhead walking it -- and it was a lie. Direction presses
 * are untimed (see `breakoutSequence.ts`): a step may be played any time after
 * the encounter starts and before the accent, so a tick sitting under an arrow
 * claimed a deadline that does not exist, and a playhead sweeping past it
 * implied the press had been missed when it had not. The phrase only has to be
 * *finished* before the accent, and the accent is the one beat-locked press in
 * the encounter -- so the timing cue lives on the accent, where it belongs.
 * The SPACE circle's converging ring closes onto the beat and is the only clock
 * on the row. Progress through the phrase is carried by the row's own colours
 * (played diamonds go green, the front of the queue burns yellow) and by the
 * tally above it, both of which say the true thing: how much is left, not when.
 *
 * The row scales to the sequence length, so a three-step phrase and a
 * ten-step one both stay inside the same strip and the diamonds never collide.
 */

import type { Renderer } from '../../core/Renderer';
import { clamp } from '../../core/geometry';
import { DIRECTION_GLYPH } from '../../core/direction8';
import { easeOutBack, easeOutCubic } from '../../feel/Easing';
import type { SequenceStep } from './breakoutSequence';

/** The prompt row: the arrows and the SPACE target, on one line. */
export const ROW_Y = 0.80;

/** The player position the row composes itself around. */
export interface RowAnchor {
  x: number;
  y: number;
}

/** How far below the player the row sits. */
const ROW_DROP = ROW_Y - 0.5;

// The band the row is allowed to occupy. Wide enough that a centred player is
// never clamped, tight enough that the strip never climbs into the seal's
// working area -- the row is below the body, and the seal is around it.
const ROW_MIN_X = 0.36;
const ROW_MAX_X = 0.64;
const ROW_MIN_Y = 0.70;
const ROW_MAX_Y = 0.82;

/** Half-diagonal of a prompt diamond at rest, in field units. */
const SLOT_SIZE = 0.034;
/** The peak the "next" heartbeat scales a diamond to. */
const SLOT_PULSE = 1.26;

// The row is laid out to a fixed width budget rather than to a fixed diamond
// size. Phrases are authored data with no length cap -- the library ships a
// ten-step one -- and at the design size that row is wider than the board, so
// the diamonds shrink to fit instead of the capsule running off the edge.
/** The widest the whole row -- diamonds, padding and capsule ends -- may be. */
const ROW_BUDGET = 0.96;
/** Hair of daylight kept between neighbours at the peak heartbeat. */
const SLOT_GAP = 0.004;
/** Capsule padding past the outer slot centres, as a multiple of the diamond. */
const CAPSULE_PAD = 1.45;
/** Capsule half-height, and the radius of its rounded ends, likewise. */
const CAPSULE_RADIUS = 1.7;

/**
 * Glyph size, as a multiple of the diamond's half-diagonal.
 *
 * Expressed in field units rather than pixels, deliberately: the diamond is
 * drawn in field space and so grows with the window, but a fixed pixel size
 * made the arrow shrink inside its own diamond as the board grew -- on a 1080p
 * board the glyph filled under a third of it, which is what made the direction
 * hard to read. Sized through the camera and tied to the diamond, the arrow
 * keeps the same share of it at every window size and every phrase length.
 */
const GLYPH_RATIO = 1.41;

/** Where the row actually lands for a player standing at `anchor`. */
interface RowFrame {
  /** Centre of the row. */
  cx: number;
  rowY: number;
}

function frameFor(anchor: RowAnchor): RowFrame {
  return {
    cx: clamp(anchor.x, ROW_MIN_X, ROW_MAX_X),
    rowY: clamp(anchor.y + ROW_DROP, ROW_MIN_Y, ROW_MAX_Y),
  };
}

const COLOUR = {
  upcoming: '#c3cee8',
  active: '#ffd76d',
  hit: '#7dffb0',
  miss: '#ff5470',
  seal: '#9d7bff',
  edge: '#e6dcff',
} as const;

/**
 * Diamond size for a row of `count` slots: the design size whenever it fits,
 * shrinking only once the phrase is long enough to need it. Solving the budget
 * for `s` in
 *
 *   span * (2 * s * SLOT_PULSE + SLOT_GAP) + 2 * CAPSULE_PAD * s
 *     + 2 * CAPSULE_RADIUS * s  <=  ROW_BUDGET
 *
 * so the row is never wider than the board at any length.
 */
function slotSize(count: number): number {
  const span = Math.max(0, count - 1);
  const ends = 2 * (CAPSULE_PAD + CAPSULE_RADIUS);
  const room = ROW_BUDGET - SLOT_GAP * span;
  return Math.min(SLOT_SIZE, room / Math.max(1e-6, 2 * SLOT_PULSE * span + ends));
}

/**
 * Slot spacing: roomy while the phrase is short, tightening to the no-overlap
 * floor once it is long. The floor keeps the peak heartbeat on the front
 * diamond from touching its neighbour.
 */
function spacingFor(count: number): number {
  const n = Math.max(1, count);
  if (n < 2) return 0;
  return clamp(0.80 / n, slotSize(n) * 2 * SLOT_PULSE + SLOT_GAP, 0.105);
}

/**
 * Where an arrow slot sits, in field space.
 *
 * `count` is the whole row *including* the SPACE slot, so the arrows centre
 * themselves against it, and `anchor` is the player the row belongs to. The
 * mechanic calls this too, so a hit's particles land exactly on the glyph that
 * produced them -- which only works if both sides agree on where the row is.
 */
export function slotPosition(index: number, count: number, anchor: RowAnchor): { x: number; y: number } {
  const frame = frameFor(anchor);
  return { x: frame.cx + (index - (count - 1) / 2) * spacingFor(count), y: frame.rowY };
}

/** Everything the row needs: the phrase, the accent, and how the run is going. */
export interface PromptRowState {
  /** The player the row is composed around. */
  anchor: RowAnchor;
  steps: SequenceStep[];
  beat: number;
  /** Absolute beat the phrase starts on, and the beat the accent lands on. */
  startBeat: number;
  finalBeat: number;
  /** 0..1 fade-in during the prep window. */
  reveal: number;
  /** 0..1 -- how close the accent is. 1 at the beat itself. */
  charge: number;
  /** What the accent is doing right now. */
  finalState: 'WAITING' | 'READY' | 'HIT' | 'MISSED';
  /** Beat the accent state last changed, for the hit/miss animation. */
  finalChangedBeat: number;
  /** False once the seal has taken more misses than it tolerates. */
  breakable: boolean;
  /** Key name printed inside the target circle. */
  keyLabel: string;
}

/**
 * A soft scrim behind the strip.
 *
 * The seal is a full circle, so at most radii some of it passes straight
 * through the prompt row. Both are legible on their own and illegible on top
 * of each other, so the strip gets its own ground: two gradients feathered
 * into the board, dark enough to separate the layers and soft enough that the
 * arena does not appear to have a letterbox across it.
 */
function renderStripScrim(r: Renderer, frame: RowFrame, size: number): void {
  const half = CAPSULE_RADIUS * size;
  r.gradientRect(
    { x: 0, y: frame.rowY - half - 0.06, w: 1, h: 0.06 },
    [[0, 'rgba(5, 7, 13, 0)'], [1, 'rgba(5, 7, 13, 0.7)']],
  );
  r.gradientRect(
    { x: 0, y: frame.rowY + half, w: 1, h: 0.06 },
    [[0, 'rgba(5, 7, 13, 0.7)'], [1, 'rgba(5, 7, 13, 0)']],
  );
}

/**
 * The capsule that frames the whole row -- arrows and SPACE target as one
 * object. This is the dance-game read: a single bar carrying everything the
 * encounter asks of you, not a scatter of widgets. Two discs and a rect make
 * the fill; two half-arcs and two lines make the rim.
 *
 * Its ends and its padding are sized from the diamond rather than fixed, so the
 * frame stays a frame when a long phrase shrinks the row inside it.
 */
function renderCapsule(r: Renderer, frame: RowFrame, left: number, right: number, size: number): void {
  const radius = CAPSULE_RADIUS * size;
  const top = frame.rowY - radius;
  const bottom = frame.rowY + radius;
  const cy = frame.rowY;

  r.fillCircle(left, cy, radius, '#0b0f1c', 0.62);
  r.fillCircle(right, cy, radius, '#0b0f1c', 0.62);
  r.fillRect({ x: left, y: top, w: right - left, h: bottom - top }, '#0b0f1c', 0.62);

  // Rim: half circle each end, straight top and bottom between them.
  const rim = (cx: number, a0: number, a1: number) =>
    r.strokeArc(cx, cy, radius, a0, a1, COLOUR.active, 1.5, 0.3);
  rim(left, Math.PI / 2, (3 * Math.PI) / 2);
  rim(right, -Math.PI / 2, Math.PI / 2);
  r.line(left, top, right, top, COLOUR.active, 1.5, 0.3);
  r.line(left, bottom, right, bottom, COLOUR.active, 1.5, 0.3);
}

/** The whole prompt: the arrows, and the SPACE target at their far end. */
export function renderPromptRow(r: Renderer, s: PromptRowState): void {
  const count = s.steps.length;
  if (count === 0) return;
  const total = count + 1; // arrows + the SPACE slot
  const frame = frameFor(s.anchor);

  const size = slotSize(total);

  r.withAlpha(clamp(s.reveal, 0, 1), () => {
    renderStripScrim(r, frame, size);
    renderCapsule(
      r, frame,
      slotPosition(0, total, s.anchor).x - CAPSULE_PAD * size,
      finalSlot(total, frame).x + CAPSULE_PAD * size,
      size,
    );

    // Once every arrow has been played the accent is the only question left,
    // so the phrase dims to hand the eye to the target circle.
    const phraseDone = s.steps.every((st) => st.state === 'HIT' || st.state === 'MISSED');
    const dim = phraseDone ? 0.55 : 1;

    // Only the front of the queue is being asked for. `press` resolves the
    // first unplayed step whatever the beat, so every diamond behind it is a
    // preview rather than a second live prompt -- and the sequence's own ACTIVE
    // flag cannot express that, because no step ever expires and so `update`
    // marks them all. Left to the flag, the whole row lit the same yellow and
    // the player had to guess which arrow came first.
    const next = nextIndex(s.steps);
    for (let i = 0; i < count; i++) {
      renderSlot(r, s, s.steps[i], i, total, dim, frame, size, i === next);
    }
    renderFinalSlot(r, s, total, frame, size);
  });
}

/** Index of the step being asked for, or `steps.length` once the queue drains. */
function nextIndex(steps: SequenceStep[]): number {
  for (let i = 0; i < steps.length; i++) {
    const state = steps[i].state;
    if (state !== 'HIT' && state !== 'MISSED') return i;
  }
  return steps.length;
}

/**
 * Where the SPACE target sits: the far end of the row, on the arrows' own line.
 *
 * Computed from the frame rather than by re-deriving an anchor from it, so the
 * row is never clamped twice.
 */
function finalSlot(total: number, frame: RowFrame): { x: number; y: number } {
  return { x: frame.cx + ((total - 1) / 2) * spacingFor(total), y: frame.rowY };
}

/**
 * The SPACE target.
 *
 * A circle, not a diamond: it is the one slot that is not a direction, and it
 * should read as the *place the phrase is going* rather than as one more
 * prompt. Its charge behaviours -- the converging ring, the ready glow, the
 * break burst -- all anchor here.
 *
 * It is also the encounter's only clock. The arrows are untimed, so the ring
 * closing onto this circle is the one thing on the row that means "now": its
 * radius is the time left, and it lands exactly on the beat. That is why it is
 * drawn more insistently than the rest of the row -- everything else here is a
 * checklist, and this is the deadline.
 */
function renderFinalSlot(r: Renderer, s: PromptRowState, total: number, frame: RowFrame, size: number): void {
  const { x, y } = finalSlot(total, frame);
  const age = s.beat - s.finalChangedBeat;

  if (s.finalState === 'HIT') {
    if (age > 0.9) return;
    const t = clamp(age / 0.9, 0, 1);
    r.strokeCircle(x, y, 0.03 + 0.22 * easeOutCubic(t), COLOUR.hit, 3, 1 - t);
    r.text('BREAK', x, y - 0.05, COLOUR.hit, 18, 'center', 1 - t);
    return;
  }
  if (s.finalState === 'MISSED') {
    if (age > 0.9) return;
    const t = clamp(age / 0.9, 0, 1);
    r.text('SEAL HOLDS', x, y - 0.05, COLOUR.miss, 15, 'center', 1 - t);
    return;
  }

  const ready = s.finalState === 'READY';
  const colour = !s.breakable ? COLOUR.miss : ready ? COLOUR.hit : COLOUR.active;
  const pulse = 0.5 - 0.5 * Math.cos(Math.PI * 2 * s.beat);
  const radius = size * 0.9 * (1 + 0.3 * s.charge + 0.12 * pulse);

  // Converging ring: its radius is the time left, so it lands on the circle
  // exactly on the beat. It fades in with the charge rather than sitting at
  // full size through the whole phrase -- a ring that is always there is
  // furniture, and the player stops reading it as a countdown.
  //
  // Since the track came out this is the encounter's only timing cue, so it is
  // drawn further out and brighter than it used to be: it has to carry the
  // countdown that the playhead used to share.
  const convergence = 0.19 * (1 - s.charge);
  if (convergence > 0.001 && s.charge > 0.02) {
    r.strokeCircle(x, y, radius + convergence, colour, 2, 0.2 + 0.75 * s.charge);
    // Four lines racing in with it, which is what makes the ring read as
    // *arriving* rather than as merely shrinking.
    for (let i = 0; i < 4; i++) {
      const angle = (i * Math.PI) / 2 + Math.PI / 4;
      const from = { x: x + Math.cos(angle) * (radius + convergence * 1.6), y: y + Math.sin(angle) * (radius + convergence * 1.6) };
      const to = { x: x + Math.cos(angle) * (radius + convergence), y: y + Math.sin(angle) * (radius + convergence) };
      r.line(from.x, from.y, to.x, to.y, colour, 2, 0.12 + 0.6 * s.charge);
    }
  }

  r.fillCircle(x, y, radius, colour, 0.2 + 0.5 * s.charge);
  r.strokeCircle(x, y, radius, colour, 2, 0.5 + 0.5 * s.charge);
  if (ready) r.glow(x, y, 0.09, colour, 0.35 + 0.3 * pulse);

  r.text(s.keyLabel, x, y, colour, r.len(0.017), 'center', 0.6 + 0.4 * s.charge);
  if (!s.breakable) r.text('UNSTABLE', x, y + 0.075, COLOUR.miss, r.len(0.015), 'center', 0.8);
}

function renderSlot(
  r: Renderer, s: PromptRowState, step: SequenceStep, index: number, total: number, dim: number,
  frame: RowFrame, size: number, isNext: boolean,
): void {
  const at = { x: slotPosition(index, total, s.anchor).x, y: frame.rowY };
  const age = step.resolvedBeat === undefined ? Infinity : s.beat - step.resolvedBeat;

  let scale = 0.9;
  let alpha = 0.7;
  let colour: string = COLOUR.upcoming;
  let shake = 0;

  switch (step.state) {
    case 'ACTIVE': {
      // No beat-closeness ramp here, deliberately. A direction press is not due
      // on any particular beat, so an arrow that swelled as its beat came round
      // taught the opposite of the rule -- it made players wait for a cue that
      // was never being judged. What the front of the queue gets instead is a
      // steady heartbeat: "this one is live", with no claim about when.
      if (isNext) {
        const pulse = 0.5 - 0.5 * Math.cos(Math.PI * 2 * s.beat);
        scale = 1.2 + (SLOT_PULSE - 1.2) * pulse;
        alpha = 1;
        colour = COLOUR.active;
      } else {
        scale = 0.95;
        alpha = 0.9;
      }
      break;
    }
    case 'HIT': {
      const punch = age < 0.5 ? easeOutBack(clamp(age / 0.5, 0, 1)) : 1;
      scale = 1.35 - 0.35 * punch;
      alpha = 1;
      colour = COLOUR.hit;
      break;
    }
    case 'MISSED': {
      scale = 0.95;
      alpha = 0.85;
      colour = COLOUR.miss;
      // A short, decaying shudder. Legible as an error without being noise.
      if (age < 0.35) shake = Math.sin(age * 90) * 0.006 * (1 - age / 0.35);
      break;
    }
    default:
      break;
  }

  alpha *= dim;
  const x = at.x + shake;
  const y = at.y;
  const radius = size * scale;

  if (isNext && step.state === 'ACTIVE') r.glow(x, y, radius * 2.6, colour, 0.34);
  if (step.state === 'HIT' && age < 0.45) {
    r.strokeCircle(x, y, radius * (1 + 1.6 * (age / 0.45)), COLOUR.hit, 2, 0.7 * (1 - age / 0.45));
  }

  // The slot itself: a diamond, so the row never reads as note heads borrowed
  // from VERTICAL, and a direction glyph inside it. The glyph is the thing the
  // player actually reads, so it is sized in field units and takes about half
  // the diamond's height at every window size.
  const corners = [0, 1, 2, 3].map((i) => {
    const angle = (i * Math.PI) / 2;
    return { x: x + Math.cos(angle) * radius, y: y + Math.sin(angle) * radius };
  });
  r.fillPolygon(corners, colour, alpha * 0.22);
  r.polyline([...corners, corners[0]], colour, step.state === 'UPCOMING' ? 1 : 2, alpha);
  r.text(DIRECTION_GLYPH[step.direction], x, y, colour, r.len(GLYPH_RATIO * size) * scale, 'center', alpha);
}

/**
 * The player's own charge.
 *
 * Drawn over the avatar, growing into the final accent, so the shockwave that
 * follows has somewhere to have come from. Without it the explosion is
 * something that happens to the arena; with it, the player was holding it.
 */
export function renderPlayerCharge(r: Renderer, x: number, y: number, charge: number, beat: number): void {
  if (charge <= 0.01) return;
  const t = clamp(charge, 0, 1);
  const pulse = 0.5 - 0.5 * Math.cos(Math.PI * 2 * beat * 2);
  r.glow(x, y, 0.035 + 0.05 * t, COLOUR.seal, 0.2 * t + 0.15 * t * pulse);
  r.strokeCircle(x, y, 0.028 + 0.022 * (1 - t) + 0.004 * pulse, COLOUR.edge, 2, 0.25 + 0.5 * t);
  // Motes drawn inward, gathering into the body.
  const spokes = 6;
  for (let i = 0; i < spokes; i++) {
    const angle = (i / spokes) * Math.PI * 2 + beat * 2.2;
    const outer = 0.075 - 0.04 * t;
    const inner = 0.032;
    r.line(
      x + Math.cos(angle) * outer, y + Math.sin(angle) * outer,
      x + Math.cos(angle) * inner, y + Math.sin(angle) * inner,
      COLOUR.seal, 2, 0.15 + 0.35 * t,
    );
  }
}

/**
 * Heading above the row: what this encounter is, and how it is going.
 *
 * The tally is the encounter's scoreboard. ARENA has no combo counter of its
 * own -- it is a dodge mode, and nothing else in it is scored per input -- so
 * the one stretch of the song that *is* played rather than dodged carries its
 * own readout, and it disappears with the seal.
 */
export function renderEncounterLabel(
  r: Renderer, text: string, colour: string, alpha: number, anchor: RowAnchor, tally?: string,
): void {
  const { cx, rowY } = frameFor(anchor);
  r.text(text, cx, rowY - 0.115, colour, r.len(0.018), 'center', alpha);
  if (tally) r.text(tally, cx, rowY - 0.086, COLOUR.upcoming, r.len(0.015), 'center', alpha * 0.85);
}

/**
 * The movement lock, drawn at the player's feet.
 *
 * An encounter may own the player's movement outright -- a seal has no gap, so
 * there is nowhere to walk to, and a level is free to say so by authoring a
 * movement scale of zero. A frozen avatar with no explanation reads as a bug,
 * so the lock announces itself: a ring planted on the floor with four brackets
 * driven into it, fading in as the encounter takes hold and out as it lets go.
 *
 * Deliberately small. It is an explanation, not an effect.
 */
export function renderMovementLock(r: Renderer, x: number, y: number, alpha: number, beat: number): void {
  if (alpha <= 0.01) return;
  const a = clamp(alpha, 0, 1);
  const pulse = 0.5 - 0.5 * Math.cos(Math.PI * 2 * beat);

  r.strokeCircle(x, y, 0.052, COLOUR.seal, 1.5, 0.35 * a);
  r.fillCircle(x, y, 0.052, COLOUR.seal, 0.07 * a);

  // Four brackets, closed inward onto the body: the ring is holding, not loose.
  for (let i = 0; i < 4; i++) {
    const angle = (i * Math.PI) / 2 + Math.PI / 4;
    const ca = Math.cos(angle);
    const sa = Math.sin(angle);
    const outer = 0.078;
    const inner = 0.052 + 0.006 * pulse;
    r.line(x + ca * outer, y + sa * outer, x + ca * inner, y + sa * inner, COLOUR.seal, 2, 0.6 * a);
  }
}

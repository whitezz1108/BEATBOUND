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
 * Progress through the phrase is carried by the row's own colours (played
 * diamonds go green, the front of the queue burns yellow) and by the tally
 * above it, both of which say the true thing: how much is left, not when.
 *
 * THE ACCENT'S CLOCK
 * ------------------
 * The accent is the only timed press, so it carries every cue that means
 * "now", and it carries them in three channels on purpose -- because the
 * player is watching the seal close around them, not the row, and one cue in
 * one channel is a cue that gets missed:
 *
 *   - an *approach ring*, closing on the target over the whole encounter and
 *     landing exactly on the beat. Its radius is time, which is why it starts
 *     as soon as the phrase does: a clock that appears one beat before the
 *     deadline is not a clock, it is a jump scare. A faint track ring marks
 *     where it began, so the closing motion reads as arriving somewhere.
 *   - a *countdown arc* around the target, depleting over the last
 *     `COUNTDOWN_BEATS` beats. Distance says "soon"; this says "three beats",
 *     and it says it to someone who has just looked up.
 *   - the *window itself*, drawn as a state rather than as geometry: inside
 *     the judging window the target goes white, swells and stops saying SPACE
 *     and starts saying NOW. The window is ±`finalGoodBeats` around the beat
 *     and that is far too thin a band to draw as a band -- so it is drawn as
 *     the one thing it actually is, a moment.
 *
 * `breakoutPlan.ts`'s judgement is what these three agree with; the audible
 * ticks in `RhythmBreakoutMechanic` are the fourth channel and count the same
 * beats as the arc.
 *
 * WHAT A PHRASE COSTS, ON SCREEN
 * ------------------------------
 * The encounter charges health for a fumbled phrase and for a missed accent
 * (see `PARTIAL_DAMAGE` / `ACCENT_DAMAGE`). A price the player only discovers
 * by watching their bar drop is a price that reads as a bug, so the row says
 * it: the target prints what missing it costs while the accent is still
 * coming, and prints what a break cost in the moment it happens.
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

/** How far out the approach ring starts, in field units. */
const APPROACH_LEAD = 0.22;

/**
 * Beats before the accent the countdown arc covers, and the mechanic's ticks
 * count. One number, two channels: the arc is drawn from it and the ticks are
 * played from it, so what is seen and what is heard cannot drift apart.
 */
export const COUNTDOWN_BEATS = 4;

/** How long the snap flash and the aftermath readouts last, in beats. */
const SNAP_BEATS = 0.28;
const COST_BEATS = 1.1;

/**
 * How long a direction press stays lit as a *recent* event, in beats.
 *
 * Every part of the hit flash -- the overshoot, the white core, the fast ring --
 * is timed off this one number, so the press reads as one gesture rather than
 * as three effects that happen to start together.
 */
const HIT_FLASH_BEATS = 0.32;

/** How long the arrow-to-SPACE handoff sweep takes to cross the row, in beats. */
const HANDOFF_BEATS = 0.42;

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
  /** Half-width of the accent's judging window, in beats. */
  finalGoodBeats: number;
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
  /** What missing the accent costs, printed on the target before it lands. */
  accentMissDamage: number;
  /** What a fumbled phrase costs, printed when a break carries that price. */
  missDamage: number;
  /** Beat the accent landed on a fumbled phrase, and what it cost. */
  partialBeat: number;
  partialAmount: number;
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
    if (phraseDone) renderHandoff(r, s, frame, size, total);
    renderFinalSlot(r, s, total, frame, size);
  });
}

/**
 * The sweep that carries the eye from the last arrow to the SPACE target.
 *
 * The row is the one place where the encounter's two demands are told apart by
 * position, and the accent is the demand that actually costs health -- but it
 * sits at the far end of the row from the arrows the player has been staring
 * at, and it is the only one of the two that has a deadline. A phrase that
 * ends with nothing at all happening at the moment it ends leaves the player
 * looking in the wrong place at the moment that matters.
 *
 * Runs once, on the beat the last step resolves, so it reads as the phrase
 * *closing* rather than as another thing to react to. Green if the phrase came
 * out clean, red if it did not -- the same line either way, so the player is
 * not being told two different stories about what to do next.
 */
function renderHandoff(r: Renderer, s: PromptRowState, frame: RowFrame, size: number, total: number): void {
  const doneBeat = Math.max(...s.steps.map((st) => st.resolvedBeat ?? 0));
  const age = s.beat - doneBeat;
  if (age < 0 || age >= HANDOFF_BEATS) return;
  const clean = s.steps.every((st) => st.state === 'HIT');
  const colour = clean ? COLOUR.hit : COLOUR.miss;
  const t = clamp(age / HANDOFF_BEATS, 0, 1);
  const from = slotPosition(0, total, s.anchor).x;
  const to = finalSlot(total, frame).x;
  const head = from + (to - from) * t;
  const tail = from + (to - from) * Math.max(0, t - 0.45);
  const fade = 1 - t;
  r.polyline([{ x: tail, y: frame.rowY }, { x: head, y: frame.rowY }], colour, 3, 0.8 * fade);
  r.glow(head, frame.rowY, size * 1.8, colour, 0.55 * fade);
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
 * prompt. Its charge behaviours -- the approach ring, the countdown arc, the
 * ready glow, the break burst -- all anchor here.
 *
 * It is also the encounter's only clock, and since the judgement track came out
 * it is the encounter's only *timing cue* as well, so it is drawn more
 * insistently than anything else on the row. Everything here is one of the
 * three channels described in the file header, and they are deliberately
 * redundant: the ring is a clock you have to watch, the arc is a count you can
 * drop in on, and the window is a state you cannot miss.
 */
function renderFinalSlot(r: Renderer, s: PromptRowState, total: number, frame: RowFrame, size: number): void {
  const { x, y } = finalSlot(total, frame);
  const age = s.beat - s.finalChangedBeat;
  const radius = size * 0.9;
  /** Inside the judging window: the only moment the accent will answer. */
  const open = Math.abs(s.beat - s.finalBeat) <= s.finalGoodBeats;

  if (s.finalState === 'HIT') {
    if (age > COST_BEATS) return;
    const t = clamp(age / 0.9, 0, 1);
    r.strokeCircle(x, y, 0.03 + 0.22 * easeOutCubic(t), COLOUR.hit, 3, 1 - t);
    r.glow(x, y, 0.1 * (1 - t), '#ffffff', 0.6 * (1 - t));
    r.text('BREAK', x, y - 0.05, COLOUR.hit, 18, 'center', 1 - t);
    // A break that carried a price says so, in the same breath as the reward.
    if (s.partialAmount > 0 && age < COST_BEATS) {
      const cost = clamp(age / COST_BEATS, 0, 1);
      r.text(`-${s.partialAmount}`, x, y + 0.055 + 0.02 * cost, COLOUR.miss, 17, 'center', 1 - cost);
    }
    return;
  }
  if (s.finalState === 'MISSED') {
    if (age > COST_BEATS) return;
    const t = clamp(age / COST_BEATS, 0, 1);
    r.text('SEAL HOLDS', x, y - 0.055, COLOUR.miss, 15, 'center', 1 - t);
    r.text(`-${s.accentMissDamage}`, x, y + 0.045 + 0.02 * t, COLOUR.miss, 20, 'center', 1 - t);
    return;
  }

  const ready = s.finalState === 'READY';
  const live = s.breakable;
  const pulse = 0.5 - 0.5 * Math.cos(Math.PI * 2 * s.beat);
  const colour = !live ? COLOUR.miss : open ? '#ffffff' : ready ? COLOUR.hit : COLOUR.active;
  const swell = 1 + 0.3 * s.charge + 0.12 * pulse + (open ? 0.2 : 0);
  const at = radius * swell;

  // ---- channel one: the approach ring ----
  //
  // The track marks where the ring started, so the closing motion has
  // somewhere to be arriving *from* -- without it a lone shrinking ring is
  // just a shape getting smaller. Both are held back once the ring has landed,
  // so the window reads as a state rather than as the end of a slide.
  const convergence = APPROACH_LEAD * (1 - clamp(s.charge, 0, 1));
  if (live && convergence > 0.004) {
    r.strokeCircle(x, y, radius + APPROACH_LEAD, colour, 1, 0.14 + 0.1 * s.charge);
    r.strokeCircle(x, y, at + convergence, colour, 2, 0.25 + 0.7 * s.charge);
    // A dimmer ring trailing it, which is what makes the pair read as
    // *arriving* rather than as merely shrinking.
    r.strokeCircle(x, y, at + convergence * 1.55, colour, 2, 0.1 + 0.35 * s.charge);
    for (let i = 0; i < 4; i++) {
      const angle = (i * Math.PI) / 2 + Math.PI / 4;
      const cos = Math.cos(angle);
      const sin = Math.sin(angle);
      const from = at + convergence * 1.9;
      const to = at + convergence;
      r.line(x + cos * from, y + sin * from, x + cos * to, y + sin * to, colour, 2, 0.12 + 0.6 * s.charge);
    }
  }

  // ---- channel two: the countdown arc ----
  //
  // A timer that empties clockwise over the run-in, counting the same beats the
  // mechanic ticks. It starts full and ends exactly on the accent, so "how much
  // of the arc is left" and "how many ticks are left" are the same question.
  const beatsLeft = s.finalBeat - s.beat;
  if (live && beatsLeft > 0 && beatsLeft <= COUNTDOWN_BEATS) {
    const remain = clamp(beatsLeft / COUNTDOWN_BEATS, 0, 1);
    r.strokeArc(
      x, y, radius + 0.028, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * remain,
      colour, 3, 0.4 + 0.6 * (1 - remain),
    );
    // The pip that expires with each beat, so the arc's end is legible even
    // when the arc itself is nearly gone.
    const pip = -Math.PI / 2 + Math.PI * 2 * remain;
    r.fillCircle(x + Math.cos(pip) * (radius + 0.028), y + Math.sin(pip) * (radius + 0.028), 0.006, colour, 0.9);
  }

  // ---- channel three: the window ----
  const sinceBeat = s.beat - s.finalBeat;
  if (live && Math.abs(sinceBeat) <= SNAP_BEATS) {
    // The beat itself: a hard white snap, so a press that was late still
    // shows the player exactly where the line was.
    const t = 1 - Math.abs(sinceBeat) / SNAP_BEATS;
    r.strokeCircle(x, y, at + 0.025 + 0.05 * (1 - t), '#ffffff', 4, 0.9 * t);
    r.glow(x, y, at * 2.6, '#ffffff', 0.45 * t);
  }
  if (open) {
    r.strokeCircle(x, y, at + 0.055, '#ffffff', 2, 0.5 + 0.4 * pulse);
    r.glow(x, y, at * 2.2, '#ffffff', 0.3 + 0.25 * pulse);
  }

  r.fillCircle(x, y, at, colour, 0.2 + 0.5 * s.charge + (open ? 0.15 : 0));
  r.strokeCircle(x, y, at, colour, 2, 0.5 + 0.5 * s.charge);
  if (ready && live) r.glow(x, y, 0.1, colour, 0.35 + 0.3 * pulse);

  // The label answers the question the player is asking. Before the window it
  // is *which key*; inside it, the only question left is *when*, so it says
  // that instead -- and says it in the one word that cannot be misread.
  r.text(
    open ? 'NOW' : s.keyLabel, x, y,
    colour, r.len(open ? 0.021 : 0.017), 'center', 0.6 + 0.4 * s.charge,
  );
  if (!live) {
    r.text('UNSTABLE', x, y + 0.075, COLOUR.miss, r.len(0.015), 'center', 0.8);
    r.text(`-${s.accentMissDamage}`, x, y + 0.105, COLOUR.miss, r.len(0.018), 'center', 0.9);
  } else if (ready) {
    // The price of the press that is about to be asked for. Shown as the
    // accent turns ready rather than through the whole phrase: it is a warning
    // about the next beat, and a permanent label stops being read.
    r.text(`-${s.accentMissDamage}`, x, y + 0.085, COLOUR.miss, r.len(0.016), 'center', 0.75);
  }
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
  /**
   * 1 at the instant of a hit, falling to 0 over `HIT_FLASH_BEATS`.
   *
   * The diamond's own state change is a colour, and a colour is easy to miss
   * on a row the player is reading out of the corner of their eye while the
   * seal closes on them. This drives the parts that are not colours: the white
   * core, the second ring, and the overshoot.
   */
  let flash = 0;

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
      // A bigger overshoot than the row used to have, and a white core on top
      // of it: the press has to register from the middle of the board, where
      // the player is actually looking.
      const punch = age < HIT_FLASH_BEATS ? easeOutBack(clamp(age / HIT_FLASH_BEATS, 0, 1)) : 1;
      scale = 1.5 - 0.5 * punch;
      alpha = 1;
      colour = COLOUR.hit;
      flash = clamp(1 - age / HIT_FLASH_BEATS, 0, 1);
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
  if (step.state === 'HIT') {
    // Two rings leaving the glyph: a white one that goes fast and a green one
    // that lingers, so the hit has a snap *and* an aftermath.
    const white = clamp(age / (HIT_FLASH_BEATS * 0.7), 0, 1);
    if (white < 1) {
      r.strokeCircle(x, y, radius * (1 + 2.1 * white), '#ffffff', 3, 0.85 * (1 - white));
    }
    const green = clamp(age / 0.6, 0, 1);
    if (green < 1) {
      r.strokeCircle(x, y, radius * (1 + 1.5 * green), COLOUR.hit, 2, 0.7 * (1 - green));
    }
    if (flash > 0) r.glow(x, y, radius * 3.2, COLOUR.hit, 0.5 * flash);
  }

  // The slot itself: a diamond, so the row never reads as note heads borrowed
  // from VERTICAL, and a direction glyph inside it. The glyph is the thing the
  // player actually reads, so it is sized in field units and takes about half
  // the diamond's height at every window size.
  const corners = [0, 1, 2, 3].map((i) => {
    const angle = (i * Math.PI) / 2;
    return { x: x + Math.cos(angle) * radius, y: y + Math.sin(angle) * radius };
  });
  r.fillPolygon(corners, colour, alpha * (0.22 + 0.5 * flash));
  if (flash > 0) r.fillPolygon(corners, '#ffffff', alpha * 0.55 * flash * flash);
  r.polyline([...corners, corners[0]], colour, step.state === 'UPCOMING' ? 1 : 2, alpha);
  // The glyph burns white first and settles into its colour, which is what
  // makes the press read as an event rather than as a state.
  r.text(
    DIRECTION_GLYPH[step.direction], x, y,
    flash > 0.5 ? '#ffffff' : colour,
    r.len(GLYPH_RATIO * size) * scale, 'center', alpha,
  );
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

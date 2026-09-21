/**
 * A12 Rhythm Breakout -- the prompt interface.
 *
 * Drawn low and wide, in the strip under the arena's working area, for one
 * reason: the encounter happens in the *middle* of the screen and the player
 * has to keep watching it. A prompt row that sat near the centre would ask
 * them to choose between reading the sequence and reading the seal, and they
 * would lose either way.
 *
 * LAYOUT (dance-game row: the phrase and its accent are one object)
 *   y 0.760   the direction row -- one diamond per arrow prompt
 *   y 0.825   the judgement track -- beat ticks and a playhead that travels
 *             left to right, arriving at the far end exactly on the accent
 *
 * The SPACE target is a circle at the right end of the track, in line with
 * the arrows: the player reads one row -- "these arrows, then SPACE when the
 * ball reaches the ring" -- instead of a phrase here and a timing widget
 * somewhere else. The playhead *is* the timing: it is the beat, walking the
 * same line the arrows sit on.
 *
 * The row scales to the sequence length, so a three-step phrase and a
 * ten-step one both stay inside the same strip and the glyphs never collide.
 */

import type { Renderer } from '../../core/Renderer';
import { clamp, lerp } from '../../core/geometry';
import { DIRECTION_GLYPH } from '../../core/direction8';
import { easeOutBack, easeOutCubic } from '../../feel/Easing';
import type { SequenceStep } from './breakoutSequence';

/** The arrow row. */
export const ROW_Y = 0.76;
/** The judgement track, with the playhead and the SPACE target on it. */
export const TRACK_Y = 0.825;

const COLOUR = {
  upcoming: '#8d99b5',
  active: '#f7d774',
  hit: '#7dffb0',
  miss: '#ff5470',
  seal: '#9d7bff',
  edge: '#e6dcff',
} as const;

/** Slot spacing, chosen so the row always fits the strip. */
function spacingFor(count: number): number {
  return clamp(0.66 / Math.max(1, count), 0.052, 0.094);
}

/**
 * Where an arrow slot sits, in field space.
 *
 * `count` is the whole row *including* the SPACE slot, so the arrows centre
 * themselves against it. The mechanic calls this too, so a hit's particles
 * land exactly on the glyph that produced them.
 */
export function slotPosition(index: number, count: number): { x: number; y: number } {
  const spacing = spacingFor(count);
  return { x: 0.5 + (index - (count - 1) / 2) * spacing, y: ROW_Y };
}

/** Everything the row needs: the phrase, the accent, and how the run is going. */
export interface PromptRowState {
  steps: SequenceStep[];
  beat: number;
  /** Judging window in beats -- the active pulse is scaled to it. */
  goodBeats: number;
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
function renderStripScrim(r: Renderer): void {
  r.gradientRect(
    { x: 0, y: 0.66, w: 1, h: 0.12 },
    [[0, 'rgba(5, 7, 13, 0)'], [1, 'rgba(5, 7, 13, 0.7)']],
  );
  r.gradientRect(
    { x: 0, y: 0.87, w: 1, h: 0.13 },
    [[0, 'rgba(5, 7, 13, 0.7)'], [1, 'rgba(5, 7, 13, 0)']],
  );
}

/**
 * The capsule that frames the whole row -- arrows, track and SPACE target as
 * one object. This is the dance-game read: a single bar carrying everything
 * the encounter asks of you, not a scatter of widgets. Two discs and a rect
 * make the fill; two half-arcs and two lines make the rim.
 */
function renderCapsule(r: Renderer, left: number, right: number): void {
  const top = ROW_Y - 0.058;
  const bottom = TRACK_Y + 0.052;
  const radius = (bottom - top) / 2;
  const cy = (top + bottom) / 2;

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

/** The whole prompt: arrows, track, playhead and the SPACE target. */
export function renderPromptRow(r: Renderer, s: PromptRowState): void {
  const count = s.steps.length;
  if (count === 0) return;
  const total = count + 1; // arrows + the SPACE slot

  r.withAlpha(clamp(s.reveal, 0, 1), () => {
    renderStripScrim(r);
    renderCapsule(r, slotPosition(0, total).x - 0.048, finalSlot(total).x + 0.048);

    // Once every arrow has been played the accent is the only question left,
    // so the phrase dims to hand the eye to the target circle.
    const phraseDone = s.steps.every((st) => st.state === 'HIT' || st.state === 'MISSED');
    const dim = phraseDone ? 0.55 : 1;

    for (let i = 0; i < count; i++) renderSlot(r, s, s.steps[i], i, total, dim);
    renderTrack(r, s, total);
  });
}

/**
 * The judgement track: a line under the arrows, one tick per intended beat,
 * a playhead walking it, and the SPACE target waiting at the far end.
 *
 * The playhead reaches the target circle exactly on the accent beat -- that
 * arrival is the timing cue, so the track and the accent are one widget.
 */
function renderTrack(r: Renderer, s: PromptRowState, total: number): void {
  const span = Math.max(0.001, s.finalBeat - s.startBeat);
  const left = slotPosition(0, total).x - 0.03;
  const right = finalSlot(total).x;
  const at = (beat: number) => lerp(left, right, clamp((beat - s.startBeat) / span, 0, 1));
  const resolved = s.finalState === 'HIT' || s.finalState === 'MISSED';

  r.line(left, TRACK_Y, right, TRACK_Y, '#2a3350', 2, 0.9);
  for (const step of s.steps) {
    const x = at(step.beat);
    const played = step.state === 'HIT';
    const missed = step.state === 'MISSED';
    r.line(
      x, TRACK_Y - 0.008, x, TRACK_Y + 0.008,
      played ? COLOUR.hit : missed ? COLOUR.miss : COLOUR.upcoming,
      2, played || missed ? 0.9 : 0.5,
    );
  }

  // The playhead: the beat itself, walking to the target. Frozen once the
  // accent has resolved -- the burst or the collapse takes over from here.
  if (!resolved && s.beat >= s.startBeat - 0.5) {
    const head = at(s.beat);
    r.fillCircle(head, TRACK_Y, 0.007, COLOUR.edge, 0.95);
    r.glow(head, TRACK_Y, 0.03, COLOUR.active, 0.35);
  }

  renderFinalSlot(r, s, total);
}

/** Where the SPACE target sits: the far end of the track, in line with the row. */
function finalSlot(total: number): { x: number; y: number } {
  return { x: slotPosition(total - 1, total).x, y: TRACK_Y };
}

/**
 * The SPACE target.
 *
 * A circle, not a diamond: it is the one slot that is not a direction, and it
 * should read as the *place the playhead is going* rather than as one more
 * prompt. Its charge behaviours -- the converging ring, the ready glow, the
 * break burst -- all anchor here, on the same line the arrows live on.
 */
function renderFinalSlot(r: Renderer, s: PromptRowState, total: number): void {
  const { x, y } = finalSlot(total);
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
  const radius = 0.026 * (1 + 0.3 * s.charge + 0.12 * pulse);

  // Converging ring: its radius is the time left, so it lands on the circle
  // exactly on the beat. It fades in with the charge rather than sitting at
  // full size through the whole phrase -- a ring that is always there is
  // furniture, and the player stops reading it as a countdown.
  const convergence = 0.15 * (1 - s.charge);
  if (convergence > 0.001 && s.charge > 0.02) {
    r.strokeCircle(x, y, radius + convergence, colour, 2, 0.15 + 0.6 * s.charge);
    // Four lines racing in with it, which is what makes the ring read as
    // *arriving* rather than as merely shrinking.
    for (let i = 0; i < 4; i++) {
      const angle = (i * Math.PI) / 2 + Math.PI / 4;
      const from = { x: x + Math.cos(angle) * (radius + convergence * 1.6), y: y + Math.sin(angle) * (radius + convergence * 1.6) };
      const to = { x: x + Math.cos(angle) * (radius + convergence), y: y + Math.sin(angle) * (radius + convergence) };
      r.line(from.x, from.y, to.x, to.y, colour, 2, 0.1 + 0.5 * s.charge);
    }
  }

  r.fillCircle(x, y, radius, colour, 0.2 + 0.5 * s.charge);
  r.strokeCircle(x, y, radius, colour, 2, 0.5 + 0.5 * s.charge);
  if (ready) r.glow(x, y, 0.09, colour, 0.35 + 0.3 * pulse);

  r.text(s.keyLabel, x, y, colour, 9, 'center', 0.6 + 0.4 * s.charge);
  if (!s.breakable) r.text('UNSTABLE', x, y + 0.045, COLOUR.miss, 9, 'center', 0.8);
}

function renderSlot(
  r: Renderer, s: PromptRowState, step: SequenceStep, index: number, total: number, dim: number,
): void {
  const at = slotPosition(index, total);
  const size = 0.028;
  const age = step.resolvedBeat === undefined ? Infinity : s.beat - step.resolvedBeat;

  let scale = 0.86;
  let alpha = 0.45;
  let colour: string = COLOUR.upcoming;
  let shake = 0;

  switch (step.state) {
    case 'ACTIVE': {
      // Tightens onto the beat: biggest exactly when the press is due.
      const closeness = 1 - clamp(Math.abs(s.beat - step.beat) / Math.max(0.01, s.goodBeats), 0, 1);
      scale = 1 + 0.3 * closeness;
      alpha = 0.75 + 0.25 * closeness;
      colour = COLOUR.active;
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

  if (step.state === 'ACTIVE') r.glow(x, y, radius * 2.4, colour, 0.28);
  if (step.state === 'HIT' && age < 0.45) {
    r.strokeCircle(x, y, radius * (1 + 1.6 * (age / 0.45)), COLOUR.hit, 2, 0.7 * (1 - age / 0.45));
  }

  // The slot itself: a diamond, so the row never reads as note heads borrowed
  // from VERTICAL, and a direction glyph inside it.
  const corners = [0, 1, 2, 3].map((i) => {
    const angle = (i * Math.PI) / 2;
    return { x: x + Math.cos(angle) * radius, y: y + Math.sin(angle) * radius };
  });
  r.fillPolygon(corners, colour, alpha * 0.22);
  r.polyline([...corners, corners[0]], colour, step.state === 'UPCOMING' ? 1 : 2, alpha);
  r.text(DIRECTION_GLYPH[step.direction], x, y, colour, 17 * scale, 'center', alpha);

  if (step.state === 'HIT' && step.verdict === 'PERFECT' && age < 0.6) {
    r.text('PERFECT', x, y - 0.045, COLOUR.hit, 9, 'center', 1 - age / 0.6);
  }
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
  r: Renderer, text: string, colour: string, alpha: number, tally?: string,
): void {
  r.text(text, 0.5, ROW_Y - 0.108, colour, 12, 'center', alpha);
  if (tally) r.text(tally, 0.5, ROW_Y - 0.082, COLOUR.upcoming, 10, 'center', alpha * 0.85);
}

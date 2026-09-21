/**
 * A12 Rhythm Breakout -- the prompt interface.
 *
 * Drawn low and wide, in the strip under the arena's working area, for one
 * reason: the encounter happens in the *middle* of the screen and the player
 * has to keep watching it. A prompt row that sat near the centre would ask
 * them to choose between reading the sequence and reading the seal, and they
 * would lose either way.
 *
 * LAYOUT
 *   y 0.735   the phrase timeline, with a playhead moving left to right
 *   y 0.785   the direction row
 *   y 0.880   the final accent
 *
 * The row scales to the sequence length, so a three-step phrase and a ten-step
 * one both stay inside the same strip and the glyphs never collide. Once the
 * phrase is played the row *collapses* toward the final accent -- the same
 * elements, converging -- rather than being replaced by a new widget, so the
 * player's eye is carried to the one thing that still matters.
 */

import type { Renderer } from '../../core/Renderer';
import { clamp, lerp } from '../../core/geometry';
import { DIRECTION_GLYPH } from '../../core/direction8';
import { easeOutBack, easeOutCubic } from '../../feel/Easing';
import type { SequenceStep } from './breakoutSequence';

export const ROW_Y = 0.785;
export const TIMELINE_Y = 0.735;
export const FINAL_Y = 0.88;

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
 * Where a slot sits, in field space.
 *
 * `collapse` is 0 while the phrase is being played and runs to 1 during the
 * anticipation, pulling the row into the final accent. The mechanic calls this
 * too, so a hit's particles land exactly on the glyph that produced them.
 */
export function slotPosition(index: number, count: number, collapse = 0): { x: number; y: number } {
  const spacing = spacingFor(count);
  const x = 0.5 + (index - (count - 1) / 2) * spacing;
  const t = easeOutCubic(clamp(collapse, 0, 1));
  return { x: lerp(x, 0.5, t), y: lerp(ROW_Y, FINAL_Y, t) };
}

export interface SequenceUIState {
  steps: SequenceStep[];
  beat: number;
  /** Judging window in beats -- the active pulse is scaled to it. */
  goodBeats: number;
  /** Absolute beat the phrase starts on, and the beat it resolves on. */
  startBeat: number;
  finalBeat: number;
  /** 0..1 fade-in during the prep window. */
  reveal: number;
  /** 0..1 collapse toward the final accent. */
  collapse: number;
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
    { x: 0, y: 0.67, w: 1, h: 0.14 },
    [[0, 'rgba(5, 7, 13, 0)'], [1, 'rgba(5, 7, 13, 0.7)']],
  );
  r.gradientRect(
    { x: 0, y: 0.81, w: 1, h: 0.19 },
    [[0, 'rgba(5, 7, 13, 0.7)'], [1, 'rgba(5, 7, 13, 0)']],
  );
}

/** The timeline and the direction row. */
export function renderSequenceRow(r: Renderer, s: SequenceUIState): void {
  const count = s.steps.length;
  if (count === 0) return;

  r.withAlpha(clamp(s.reveal, 0, 1), () => {
    renderStripScrim(r);
    renderTimeline(r, s);
    for (let i = 0; i < count; i++) {
      renderSlot(r, s, s.steps[i], i, count);
    }
  });
}

/**
 * The phrase as a line, with a playhead.
 *
 * This is what makes the encounter read as *rhythm* rather than as a queue of
 * button prompts: the gaps between the ticks are the gaps between the beats,
 * so a phrase with a half-beat in it looks like one before it is played.
 */
function renderTimeline(r: Renderer, s: SequenceUIState): void {
  const count = s.steps.length;
  const span = Math.max(0.001, s.finalBeat - s.startBeat);
  const left = slotPosition(0, count).x - 0.03;
  const right = slotPosition(count - 1, count).x + 0.03;
  const at = (beat: number) => lerp(left, right, clamp((beat - s.startBeat) / span, 0, 1));

  r.line(left, TIMELINE_Y, right, TIMELINE_Y, '#2a3350', 2, 0.9 * (1 - s.collapse));
  for (const step of s.steps) {
    const x = at(step.beat);
    const played = step.state === 'HIT';
    const missed = step.state === 'MISSED';
    r.line(
      x, TIMELINE_Y - 0.008, x, TIMELINE_Y + 0.008,
      played ? COLOUR.hit : missed ? COLOUR.miss : COLOUR.upcoming,
      2, (played || missed ? 0.9 : 0.5) * (1 - s.collapse),
    );
  }
  // The accent's own tick, taller, at the end of the run.
  r.line(right, TIMELINE_Y - 0.014, right, TIMELINE_Y + 0.014, COLOUR.active, 2, 0.8 * (1 - s.collapse));

  const head = at(s.beat);
  if (s.beat >= s.startBeat - 0.5) {
    r.fillCircle(head, TIMELINE_Y, 0.007, COLOUR.edge, 0.95 * (1 - s.collapse));
    r.glow(head, TIMELINE_Y, 0.03, COLOUR.active, 0.35 * (1 - s.collapse));
  }
}

function renderSlot(r: Renderer, s: SequenceUIState, step: SequenceStep, index: number, count: number): void {
  const at = slotPosition(index, count, s.collapse);
  const size = 0.028 * (1 - 0.35 * s.collapse);
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

export interface FinalUIState {
  beat: number;
  finalBeat: number;
  /** 0..1 -- how close the accent is. 1 at the beat itself. */
  charge: number;
  /** What the accent is doing right now. */
  state: 'WAITING' | 'READY' | 'HIT' | 'MISSED';
  /** Beat the state last changed, for the hit/miss animation. */
  changedBeat: number;
  /** False once the seal has taken more misses than it tolerates. */
  breakable: boolean;
  /** Key name to print under the prompt. */
  keyLabel: string;
}

/**
 * The final accent.
 *
 * Deliberately not a 3-2-1 countdown: numbers tell the player *when*, but they
 * do it in the language of a stopwatch, and the thing being asked for is a
 * musical placement. So the cue is a ring converging on a diamond, on the
 * beat, at the tempo of the song -- when the ring meets the diamond, the
 * player is meant to already be pressing.
 */
export function renderFinalIndicator(r: Renderer, s: FinalUIState): void {
  const age = s.beat - s.changedBeat;

  if (s.state === 'HIT') {
    if (age > 0.9) return;
    const t = clamp(age / 0.9, 0, 1);
    r.strokeCircle(0.5, FINAL_Y, 0.03 + 0.22 * easeOutCubic(t), COLOUR.hit, 3, 1 - t);
    r.text('BREAK', 0.5, FINAL_Y, COLOUR.hit, 18, 'center', 1 - t);
    return;
  }
  if (s.state === 'MISSED') {
    if (age > 0.9) return;
    const t = clamp(age / 0.9, 0, 1);
    r.text('SEAL HOLDS', 0.5, FINAL_Y, COLOUR.miss, 15, 'center', 1 - t);
    return;
  }

  const ready = s.state === 'READY';
  const colour = !s.breakable ? COLOUR.miss : ready ? COLOUR.hit : COLOUR.active;
  const pulse = 0.5 - 0.5 * Math.cos(Math.PI * 2 * s.beat);
  const size = 0.026 * (1 + 0.35 * s.charge + 0.12 * pulse);

  // Converging ring: its radius is the time left, so it lands on the diamond
  // exactly on the beat. It fades in with the charge rather than sitting at
  // full size through the whole phrase -- a ring that is always there is
  // furniture, and the player stops reading it as a countdown.
  const convergence = 0.17 * (1 - s.charge);
  if (convergence > 0.001 && s.charge > 0.02) {
    r.strokeCircle(0.5, FINAL_Y, size + convergence, colour, 2, 0.15 + 0.6 * s.charge);
    // Four lines racing in with it, which is what makes the ring read as
    // *arriving* rather than as merely shrinking.
    for (let i = 0; i < 4; i++) {
      const angle = (i * Math.PI) / 2 + Math.PI / 4;
      const from = { x: 0.5 + Math.cos(angle) * (size + convergence * 1.6), y: FINAL_Y + Math.sin(angle) * (size + convergence * 1.6) };
      const to = { x: 0.5 + Math.cos(angle) * (size + convergence), y: FINAL_Y + Math.sin(angle) * (size + convergence) };
      r.line(from.x, from.y, to.x, to.y, colour, 2, 0.1 + 0.5 * s.charge);
    }
  }

  const corners = [0, 1, 2, 3].map((i) => {
    const angle = (i * Math.PI) / 2;
    return { x: 0.5 + Math.cos(angle) * size, y: FINAL_Y + Math.sin(angle) * size };
  });
  r.fillPolygon(corners, colour, 0.2 + 0.5 * s.charge);
  r.polyline([...corners, corners[0]], colour, 2, 0.5 + 0.5 * s.charge);
  if (ready) r.glow(0.5, FINAL_Y, 0.09, colour, 0.35 + 0.3 * pulse);

  const label = !s.breakable ? 'SEAL UNSTABLE' : ready ? s.keyLabel : 'FINAL';
  r.text(label, 0.5, FINAL_Y + 0.052, colour, 11, 'center', 0.45 + 0.45 * s.charge);
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
  r.text(text, 0.5, TIMELINE_Y - 0.062, colour, 12, 'center', alpha);
  if (tally) r.text(tally, 0.5, TIMELINE_Y - 0.036, COLOUR.upcoming, 10, 'center', alpha * 0.85);
}

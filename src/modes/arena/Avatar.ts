/**
 * ARENA avatar -- the player's body.
 *
 * The old avatar was a glowing ellipse: readable as *a thing*, not as *a
 * character*, and at heavy bullet density it was hard to pick out because it was
 * the same kind of mark as everything else on screen. This replaces it with a
 * small top-down mascot -- head, shoulders, arms, facing -- built from four
 * independent cosmetic slots so a later pass can ship skins without touching any
 * of this.
 *
 * Two rules hold the whole file together:
 *
 *   1. COLLISION IS NOT DRAWING. The hitbox is `radius`, owned by `ArenaPlayer`
 *      and by `TUNING`. Nothing here may change it. The sprite is drawn *inside*
 *      a circle of `visualRadius`, and `visualRadius` is only ever slightly
 *      larger than the body -- a character that looks much bigger than it hits
 *      teaches the player to dodge things that cannot hurt them.
 *   2. IT MUST BE FINDABLE. Under a screen full of purple bullets, the avatar
 *      has to be the brightest, highest-contrast mark in the arena. Every part
 *      is drawn with a dark outline, and the collision circle is always visible
 *      as a thin bright ring, so "where am I" and "how big am I" are both
 *      answerable in one glance.
 *
 * The parts are drawn in a fixed back-to-front order (shadow, trail, body, arms,
 * head, ears, hat, facing, collision ring, glow) so a cosmetic can never
 * accidentally cover the thing that tells the player where they are.
 */

import type { Renderer } from '../../core/Renderer';
import { clamp } from '../../core/geometry';

// ---- cosmetic slots ------------------------------------------------------

/**
 * The slots a future skin system fills in.
 *
 * Deliberately a closed union per slot rather than free-form numbers: a cosmetic
 * is a *named variant*, so adding one is a case in a switch and can never
 * produce a half-configured avatar. `DEFAULT_COSMETICS` is the shipped look, and
 * every field has a sane fallback, so a partial or unknown skin still renders.
 */
export type BodyStyle = 'CHIBI' | 'ROBOT' | 'BEAST';
export type HatStyle = 'NONE' | 'CAP' | 'CROWN' | 'HELMET' | 'LEAF';
export type EarStyle = 'NONE' | 'CAT' | 'ROUND' | 'ANTENNA';
export type TrailStyle = 'RIBBON' | 'SPARKS' | 'NONE';

export interface AvatarPalette {
  /** Torso and limbs. */
  body: string;
  /** Head / face plate. */
  head: string;
  /** Hats, ears, facing marker -- the colour that reads as "this is mine". */
  accent: string;
  /** Shared dark outline. This is what makes the avatar findable. */
  outline: string;
}

export interface Cosmetics {
  body: BodyStyle;
  hat: HatStyle;
  ears: EarStyle;
  trail: TrailStyle;
  palette: AvatarPalette;
}

/**
 * The shipped look: a small cyan chibi with round ears and a ribbon trail.
 *
 * Cyan is the mode's player colour everywhere else (HUD, perfect-dodge effects,
 * the old avatar's ring), and it is deliberately the one hue no hazard uses --
 * hazards are pink, red, amber and violet.
 */
export const DEFAULT_COSMETICS: Cosmetics = {
  body: 'CHIBI',
  hat: 'NONE',
  ears: 'ROUND',
  trail: 'RIBBON',
  palette: {
    body: '#6de3ff',
    head: '#f2fbff',
    accent: '#3fd0f5',
    outline: '#08222e',
  },
};

export interface AvatarDraw {
  x: number;
  y: number;
  /** Facing, radians. */
  angle: number;
  /** 0..1 -- how fast the avatar is moving. Drives lean and the walk cycle. */
  moving: number;
  /** Collision radius. Never derived from anything drawn here. */
  radius: number;
  /** Drawn radius. Always >= radius, always close to it. */
  visualRadius: number;
  /** Blink out during i-frames. */
  invulnerable: boolean;
  /** Beat, for the walk cycle and the i-frame blink. */
  beat: number;
  /** Recent positions, oldest first. Used by the trail slot. */
  trail: Array<{ x: number; y: number }>;
  cosmetics?: Partial<Cosmetics>;
}

const TRAIL_LENGTH = 10;

export function renderAvatar(r: Renderer, o: AvatarDraw): void {
  const skin = resolveCosmetics(o.cosmetics);
  // Blink during i-frames, on the beat subdivision so feedback stays musical.
  const blink = o.invulnerable && Math.floor(o.beat * 8) % 2 === 0;
  const alpha = blink ? 0.35 : 1;

  renderShadow(r, o, alpha);
  renderTrail(r, o, skin, alpha);

  const c = r.ctx;
  c.save();
  c.globalAlpha = alpha;
  c.translate(r.px(o.x), r.py(o.y));
  c.rotate(o.angle);
  const unit = r.len(o.visualRadius);

  renderArms(r, o, skin, unit);
  renderBody(r, o, skin, unit);
  renderHead(r, skin, unit);
  renderEars(r, skin, unit);
  renderHat(r, skin, unit);
  renderFacing(r, skin, unit);

  c.restore();

  // Drawn last, in field space so it is never rotated or scaled by the body:
  // the one mark that means "this is exactly what can be hit".
  r.strokeCircle(o.x, o.y, o.radius, '#ffffff', 1, alpha * 0.35);
  r.glow(o.x, o.y, o.visualRadius * 3.4, skin.palette.body, 0.16 * alpha);
}

/** Fill in anything a partial skin left out. */
export function resolveCosmetics(skin: Partial<Cosmetics> | undefined): Cosmetics {
  if (!skin) return DEFAULT_COSMETICS;
  return {
    body: skin.body ?? DEFAULT_COSMETICS.body,
    hat: skin.hat ?? DEFAULT_COSMETICS.hat,
    ears: skin.ears ?? DEFAULT_COSMETICS.ears,
    trail: skin.trail ?? DEFAULT_COSMETICS.trail,
    palette: { ...DEFAULT_COSMETICS.palette, ...(skin.palette ?? {}) },
  };
}

/** How far the trail reaches back. Exported so the player can size its buffer. */
export const AVATAR_TRAIL_LENGTH = TRAIL_LENGTH;

// ---- parts ---------------------------------------------------------------

/**
 * A contact shadow, offset down-right rather than straight down.
 *
 * The camera is top-down but the light is not directly overhead, and the offset
 * is what stops the avatar reading as a flat sticker on the floor. It also gives
 * the sprite a floor to sit on during heavy patterns, when everything else is
 * unmoored.
 */
function renderShadow(r: Renderer, o: AvatarDraw, alpha: number): void {
  const c = r.ctx;
  c.save();
  c.globalAlpha = alpha * 0.35;
  c.fillStyle = '#020509';
  c.beginPath();
  c.ellipse(
    r.px(o.x + 0.004), r.py(o.y + 0.006),
    r.len(o.visualRadius) * 1.05, r.len(o.visualRadius) * 0.9,
    0, 0, Math.PI * 2,
  );
  c.fill();
  c.restore();
}

function renderTrail(r: Renderer, o: AvatarDraw, skin: Cosmetics, alpha: number): void {
  if (skin.trail === 'NONE' || o.trail.length < 3 || o.moving <= 0.08) return;
  const strength = o.moving * alpha;
  switch (skin.trail) {
    case 'RIBBON':
      r.polyline(o.trail, skin.palette.accent, 3, 0.18 * strength);
      break;
    case 'SPARKS': {
      // Discrete pips rather than a line, so the trail reads as something being
      // thrown off rather than as a path being painted.
      for (let i = 1; i < o.trail.length; i += 2) {
        const t = i / o.trail.length;
        r.fillCircle(o.trail[i].x, o.trail[i].y, 0.0035 * t, skin.palette.accent, 0.4 * strength * t);
      }
      break;
    }
    default:
      break;
  }
}

/**
 * Two arms, swinging on a walk cycle.
 *
 * The cycle is driven by `beat`, not by real time, so the swing stays in step
 * with the music even when the frame rate is not -- which is the same rule the
 * rest of the game follows, and it makes the avatar look like it is dancing.
 */
function renderArms(r: Renderer, o: AvatarDraw, skin: Cosmetics, unit: number): void {
  const swing = o.moving > 0.05 ? Math.sin(o.beat * Math.PI * 2) * 0.55 * o.moving : 0;
  const armRadius = unit * 0.34;
  const reach = unit * 0.72;
  for (const side of [-1, 1]) {
    const along = swing * side;
    const ax = along * reach * 0.6 - unit * 0.12;
    const ay = side * reach;
    fillWithOutline(r, () => {
      r.ctx.beginPath();
      r.ctx.arc(ax, ay, armRadius, 0, Math.PI * 2);
      r.ctx.fill();
    }, skin.palette.body, skin.palette.outline, 1.5);
  }
}

/**
 * The torso, seen from above: wider across than along, so the avatar's facing is
 * legible from the silhouette alone even before the head is drawn.
 */
function renderBody(r: Renderer, o: AvatarDraw, skin: Cosmetics, unit: number): void {
  const along = unit * (0.86 + 0.12 * o.moving);
  const across = unit * (0.96 - 0.08 * o.moving);
  fillWithOutline(r, () => {
    r.ctx.beginPath();
    r.ctx.ellipse(0, 0, along, across, 0, 0, Math.PI * 2);
    r.ctx.fill();
  }, skin.palette.body, skin.palette.outline, 2);

  if (skin.body === 'ROBOT') {
    // A chest vent: two dark slits across the shoulders.
    r.line(o.x, o.y, o.x, o.y, skin.palette.outline, 1, 0);
    strokeLocal(r, () => {
      r.ctx.beginPath();
      r.ctx.moveTo(-unit * 0.3, -unit * 0.4);
      r.ctx.lineTo(-unit * 0.3, unit * 0.4);
      r.ctx.stroke();
    }, skin.palette.outline, 1.5, 0.7);
  } else if (skin.body === 'BEAST') {
    // A fur ruff: a lighter ring around the shoulders.
    strokeLocal(r, () => {
      r.ctx.beginPath();
      r.ctx.ellipse(0, 0, along * 0.62, across * 0.66, 0, 0, Math.PI * 2);
      r.ctx.stroke();
    }, skin.palette.head, 2, 0.55);
  }
}

/**
 * The head, pushed forward of the body centre.
 *
 * The offset is what makes a top-down sprite read as a character rather than as
 * a disc: the eye reads the head as "front" and everything else falls into place.
 */
function renderHead(r: Renderer, skin: Cosmetics, unit: number): void {
  const forward = unit * 0.34;
  const headRadius = unit * 0.62;
  const c = r.ctx;
  c.save();
  c.translate(forward, 0);
  fillWithOutline(r, () => {
    c.beginPath();
    c.arc(0, 0, headRadius, 0, Math.PI * 2);
    c.fill();
  }, skin.palette.head, skin.palette.outline, 2);
  // A hair/plate cap over the back half, so the head has a front and a back.
  strokeLocal(r, () => {
    c.beginPath();
    c.arc(0, 0, headRadius * 0.62, Math.PI * 0.42, Math.PI * 1.58);
    c.stroke();
  }, skin.palette.accent, Math.max(2, headRadius * 0.42), 0.9);
  c.restore();
}

function renderEars(r: Renderer, skin: Cosmetics, unit: number): void {
  if (skin.ears === 'NONE') return;
  const forward = unit * 0.34;
  const headRadius = unit * 0.62;
  const c = r.ctx;
  c.save();
  c.translate(forward, 0);
  for (const side of [-1, 1]) {
    switch (skin.ears) {
      case 'CAT': {
        // A triangle, tilted back off the head.
        fillWithOutline(r, () => {
          c.beginPath();
          c.moveTo(-headRadius * 0.15, side * headRadius * 0.72);
          c.lineTo(headRadius * 0.35, side * headRadius * 1.05);
          c.lineTo(headRadius * 0.30, side * headRadius * 0.20);
          c.closePath();
          c.fill();
        }, skin.palette.accent, skin.palette.outline, 1.5);
        break;
      }
      case 'ROUND': {
        fillWithOutline(r, () => {
          c.beginPath();
          c.arc(-headRadius * 0.05, side * headRadius * 0.95, headRadius * 0.34, 0, Math.PI * 2);
          c.fill();
        }, skin.palette.accent, skin.palette.outline, 1.5);
        break;
      }
      case 'ANTENNA': {
        strokeLocal(r, () => {
          c.beginPath();
          c.moveTo(0, side * headRadius * 0.5);
          c.lineTo(-headRadius * 0.5, side * headRadius * 1.5);
          c.stroke();
        }, skin.palette.outline, 1.5, 0.9);
        fillWithOutline(r, () => {
          c.beginPath();
          c.arc(-headRadius * 0.5, side * headRadius * 1.5, headRadius * 0.2, 0, Math.PI * 2);
          c.fill();
        }, skin.palette.accent, skin.palette.outline, 1);
        break;
      }
      default:
        break;
    }
  }
  c.restore();
}

/**
 * The hat slot.
 *
 * Drawn over the head, and deliberately kept *inside* the visual radius: a hat
 * that pokes out past the drawn body would make the avatar look bigger than it
 * is, which is the one thing this file must not do.
 */
function renderHat(r: Renderer, skin: Cosmetics, unit: number): void {
  if (skin.hat === 'NONE') return;
  const forward = unit * 0.34;
  const headRadius = unit * 0.62;
  const c = r.ctx;
  c.save();
  c.translate(forward, 0);
  switch (skin.hat) {
    case 'CAP':
      // A brim in front, a low dome behind it.
      fillWithOutline(r, () => {
        c.beginPath();
        c.ellipse(headRadius * 0.55, 0, headRadius * 0.62, headRadius * 0.42, 0, 0, Math.PI * 2);
        c.fill();
      }, skin.palette.accent, skin.palette.outline, 1.5);
      fillWithOutline(r, () => {
        c.beginPath();
        c.arc(0, 0, headRadius * 0.86, Math.PI * 0.5, Math.PI * 1.5);
        c.closePath();
        c.fill();
      }, skin.palette.accent, skin.palette.outline, 1.5);
      break;
    case 'CROWN': {
      const points = 5;
      fillWithOutline(r, () => {
        c.beginPath();
        for (let i = 0; i <= points; i++) {
          const t = i / points;
          const radius = i % 2 === 0 ? headRadius * 1.0 : headRadius * 0.72;
          const a = Math.PI * 0.5 + t * Math.PI;
          const px = Math.cos(a) * radius;
          const py = Math.sin(a) * radius;
          if (i === 0) c.moveTo(px, py); else c.lineTo(px, py);
        }
        c.closePath();
        c.fill();
      }, skin.palette.accent, skin.palette.outline, 1.5);
      break;
    }
    case 'HELMET':
      fillWithOutline(r, () => {
        c.beginPath();
        c.arc(0, 0, headRadius * 1.02, Math.PI * 0.42, Math.PI * 1.58);
        c.closePath();
        c.fill();
      }, skin.palette.accent, skin.palette.outline, 2);
      break;
    case 'LEAF':
      // The brief's "fruit hat": a leaf sprouting off the crown.
      fillWithOutline(r, () => {
        c.beginPath();
        c.moveTo(0, 0);
        c.quadraticCurveTo(headRadius * 0.2, -headRadius * 1.5, headRadius * 0.95, -headRadius * 1.1);
        c.quadraticCurveTo(headRadius * 0.5, -headRadius * 0.5, 0, 0);
        c.closePath();
        c.fill();
      }, '#7dffb0', skin.palette.outline, 1.5);
      break;
    default:
      break;
  }
  c.restore();
}

/**
 * The facing marker.
 *
 * One bright wedge at the very front of the head. It is the smallest thing drawn
 * and the most important: without it a symmetric top-down sprite has no readable
 * direction, and the player cannot tell whether they are leaning into a dodge or
 * away from one.
 */
function renderFacing(r: Renderer, skin: Cosmetics, unit: number): void {
  const forward = unit * 0.34;
  const headRadius = unit * 0.62;
  const c = r.ctx;
  c.save();
  c.translate(forward, 0);
  fillWithOutline(r, () => {
    c.beginPath();
    c.moveTo(headRadius * 1.15, 0);
    c.lineTo(headRadius * 0.45, -headRadius * 0.34);
    c.lineTo(headRadius * 0.45, headRadius * 0.34);
    c.closePath();
    c.fill();
  }, skin.palette.accent, skin.palette.outline, 1.5);
  c.restore();
}

// ---- drawing helpers -----------------------------------------------------

/**
 * Fill the current path, then stroke it with the shared outline.
 *
 * The outline is not decoration: it is what separates the avatar from a bullet
 * field made of the same bright saturated shapes. Everything the avatar is made
 * of goes through here so the outline weight stays consistent.
 */
function fillWithOutline(
  r: Renderer,
  fill: () => void,
  colour: string,
  outline: string,
  widthPx: number,
): void {
  const c = r.ctx;
  c.fillStyle = colour;
  fill();
  c.strokeStyle = outline;
  c.lineWidth = widthPx;
  c.lineJoin = 'round';
  c.stroke();
}

/** Stroke a path built in the avatar's local (already translated/rotated) space. */
function strokeLocal(
  r: Renderer,
  build: () => void,
  colour: string,
  widthPx: number,
  alpha: number,
): void {
  const c = r.ctx;
  c.save();
  c.globalAlpha *= clamp(alpha, 0, 1);
  c.strokeStyle = colour;
  c.lineWidth = widthPx;
  c.lineCap = 'round';
  build();
  c.restore();
}

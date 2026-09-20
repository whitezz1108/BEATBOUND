/**
 * ARENA stage -- the environment, the board, and the boundary.
 *
 * The mode used to draw a debug room: a flat fill, a 4x4 grid, three guide
 * rings and a thin rectangle. It was legible, but it read as a test harness --
 * there was no *place*, and nothing on screen said "this bright square is the
 * arena and everything past it is not your problem".
 *
 * This file draws three things, in this order:
 *
 *   ENVIRONMENT  a themed, non-collidable backdrop covering the whole viewport,
 *                including the letterbox. Purely atmospheric: it is drawn dark,
 *                desaturated and low-contrast so it can never be mistaken for a
 *                hazard, and it lives entirely *outside* the arena floor.
 *   BOARD        the arena floor -- a rounded-rect board with its markings. The
 *                guide rings and spokes stay, because most ARENA pattern
 *                families are radial and the player genuinely needs to read
 *                CENTRE, RADIUS and the current SAFE ARC at a glance; they are
 *                restyled as floor paint rather than as debug overlay.
 *   BOUNDARY     the rim. This is the one thing that must never be ambiguous,
 *                so it is drawn twice: a hairline exactly on the playable
 *                square, and a luminous rounded rim just inside it. Decoration
 *                is allowed to be pretty; the boundary is not allowed to lie.
 *
 * THE BOUNDARY RULE
 * -----------------
 * Gameplay clamps the avatar to the unit square (see ArenaPlayer), so the unit
 * square is the truth. The rounded rim cuts the four corners, which means the
 * drawn board is very slightly *smaller* than the playable area at the corners
 * -- the safe direction to be wrong in, since it can never lure the player into
 * a spot that looks blocked. The corner brackets and the exact hairline close
 * that gap: the player is told the true limit by a mark that is not decorative.
 *
 * FUTURE ARTWORK
 * --------------
 * Everything themeable is in `ArenaTheme`, and `artwork` is a hook for a later
 * song-specific backdrop. Adding a theme is adding a record; no drawing code
 * changes. The stage never reads gameplay state beyond the beat and a pulse
 * value, so a theme cannot accidentally encode a hazard.
 */

import type { Rect } from '../../core/geometry';
import type { Renderer } from '../../core/Renderer';
import { ARENA_CENTRE, polarToField } from '../../mechanics/arena/polar';

/** Radii of the composition guide rings. */
const GUIDE_RINGS = [0.18, 0.34, 0.5];

/** Corner radius of the drawn board. Small enough to stay inside the hitbox. */
const CORNER = 0.045;

/**
 * Field-space extent the environment is painted over.
 *
 * Generously larger than any viewport: a 32:9 canvas reaches about -0.86, and
 * overdrawing a solid rect costs nothing, so this errs wide rather than trying
 * to derive the visible bounds from a renderer that does not expose them.
 */
const ENV_MIN = -1.2;
const ENV_SPAN = 3.4;

export interface ArenaTheme {
  id: string;
  /** Screen-wide backdrop, far layer. */
  voidFar: string;
  /** Backdrop near the arena. Slightly warmer, so the board sits in a pool of light. */
  voidNear: string;
  /** Distant environment silhouettes. */
  skyline: string;
  skylineLit: string;
  /** The board. */
  floorOuter: string;
  floorInner: string;
  /** Floor paint: rings, spokes, tile grid. */
  floorLine: string;
  floorMark: string;
  /** The rim. Three passes, dim to bright. */
  rimGlow: string;
  rimBody: string;
  rimCore: string;
  /** Exact playable boundary hairline and corner brackets. */
  boundary: string;
  /** Reactive flash on a hit or a perfect dodge. */
  reactHit: string;
  reactPerfect: string;
  /** Hook for later song-specific artwork, drawn behind the board. */
  artwork?: (r: Renderer, info: { beat: number; pulse: number }) => void;
}

/**
 * The shipped theme.
 *
 * Cyan-and-indigo, matching the avatar and the HUD. The environment is
 * deliberately *blue-dark* and the board is *blue-dark but brighter*: the only
 * saturated warm colours anywhere in ARENA are hazards (amber, orange, pink,
 * red), so "is this warm?" is a usable proxy for "can this hurt me?".
 */
export const NEON_VOID: ArenaTheme = {
  id: 'NEON_VOID',
  voidFar: '#04060b',
  voidNear: '#0a1226',
  skyline: '#070c18',
  skylineLit: '#122044',
  floorOuter: '#0a1120',
  floorInner: '#101b33',
  floorLine: '#1a2745',
  floorMark: '#243558',
  rimGlow: '#1b6f9c',
  rimBody: '#2fa8d8',
  rimCore: '#a8ecff',
  boundary: '#3b4f7a',
  reactHit: '#ff4d6d',
  reactPerfect: '#9ffcff',
};

export const THEMES: Record<string, ArenaTheme> = { NEON_VOID };

/** Per-frame inputs the stage needs. All presentation; none of it is gameplay. */
export interface StageInfo {
  beat: number;
  beatsPerBar: number;
  /** 0..1, decaying. Rises on a hit. */
  hitPulse: number;
  /** 0..1, decaying. Rises on a perfect dodge. */
  perfectPulse: number;
}

export class ArenaStage {
  theme: ArenaTheme;

  constructor(theme: ArenaTheme = NEON_VOID) {
    this.theme = theme;
  }

  render(r: Renderer, info: StageInfo): void {
    const pulse = downbeatPulse(info.beat, info.beatsPerBar);
    const beatPulse = subBeatPulse(info.beat);

    this.renderEnvironment(r, info, pulse);
    this.renderBoard(r, beatPulse);
    this.renderBoundary(r, info, pulse);
    this.renderVignette(r, info);
  }

  // ---- environment -------------------------------------------------------

  /**
   * The world outside the arena.
   *
   * Two jobs: give the arena somewhere to sit, and give the eye something to
   * rest on that is *not* the bullet field. Everything here is dark, hard-edged
   * and static -- a distant skyline, not a light show, because the arena has to
   * stay the brightest thing on screen.
   */
  private renderEnvironment(r: Renderer, info: StageInfo, pulse: number): void {
    const t = this.theme;
    const all: Rect = { x: ENV_MIN, y: ENV_MIN, w: ENV_SPAN, h: ENV_SPAN };

    // Far backdrop, then a pool of light behind the board so the arena reads as
    // lit rather than as a sticker on black.
    r.fillRect(all, t.voidFar);
    r.glow(ARENA_CENTRE.x, ARENA_CENTRE.y, 0.95, t.voidNear, 0.55 + 0.15 * pulse);

    this.renderSkyline(r, pulse);

    // Two light strips running out of the arena on the long axis: they frame the
    // board and give the wide letterbox somewhere to lead the eye.
    for (const side of [-1, 1]) {
      r.line(
        ARENA_CENTRE.x + side * 0.5, ARENA_CENTRE.y,
        ARENA_CENTRE.x + side * 1.15, ARENA_CENTRE.y,
        t.rimGlow, 2, 0.10 + 0.06 * pulse,
      );
    }

    t.artwork?.(r, { beat: info.beat, pulse });
  }

  /**
   * Distant structures around the arena.
   *
   * Laid out from a fixed hash of the slot index rather than from an rng, so the
   * skyline is identical on every replay and across sessions -- a background that
   * reshuffles on death would read as a bug.
   */
  private renderSkyline(r: Renderer, pulse: number): void {
    const t = this.theme;
    const slots = 44;
    for (let i = 0; i < slots; i++) {
      const u = hash01(i * 7 + 1);
      const v = hash01(i * 13 + 5);
      const w = hash01(i * 29 + 11);
      // Push everything out past the board: the environment is a frame, and a
      // structure overlapping the arena floor would compete with the hazards.
      const ring = 0.62 + hash01(i * 17 + 3) * 0.5;
      const angle = (i / slots) * Math.PI * 2 + u * 0.3;
      const x = ARENA_CENTRE.x + Math.cos(angle) * ring * 1.35;
      const y = ARENA_CENTRE.y + Math.sin(angle) * ring * 1.35;
      if (Math.abs(x - 0.5) < 0.56 && Math.abs(y - 0.5) < 0.56) continue;

      const bw = 0.05 + w * 0.09;
      const bh = 0.03 + v * 0.07;
      r.fillRect({ x: x - bw / 2, y: y - bh / 2, w: bw, h: bh }, t.skyline, 0.75);
      // A single lit window band per structure, on the downbeat. The pulse is
      // what keeps a static backdrop from looking like a frozen frame.
      const lit = 0.10 + 0.22 * pulse * hash01(i * 31 + 7);
      r.fillRect(
        { x: x - bw / 2, y: y - bh / 2, w: bw, h: Math.max(0.002, bh * 0.12) },
        t.skylineLit, lit,
      );
    }
  }

  // ---- board -------------------------------------------------------------

  private renderBoard(r: Renderer, beatPulse: number): void {
    const t = this.theme;
    const board: Rect = { x: 0, y: 0, w: 1, h: 1 };
    const c = r.ctx;

    // Floor: darker at the rim, brighter toward the middle, so the centre of the
    // arena is where the eye already is.
    const g = c.createRadialGradient(
      r.px(ARENA_CENTRE.x), r.py(ARENA_CENTRE.y), r.len(0.05),
      r.px(ARENA_CENTRE.x), r.py(ARENA_CENTRE.y), r.len(0.72),
    );
    g.addColorStop(0, t.floorInner);
    g.addColorStop(1, t.floorOuter);
    c.save();
    c.fillStyle = g;
    roundRectPath(r, board, CORNER);
    c.fill();
    c.restore();

    // The 4x4 tile guide stays: several chain and floor layouts are authored on
    // quarters, and the player reads their spacing off it.
    for (let i = 1; i < 4; i++) {
      r.line(i / 4, 0.006, i / 4, 0.994, t.floorLine, 1, 0.35);
      r.line(0.006, i / 4, 0.994, i / 4, t.floorLine, 1, 0.35);
    }

    // Radial composition guides. Kept because the pattern families are mostly
    // radial and these are how the player judges how far out an attack reaches.
    for (const radius of GUIDE_RINGS) {
      r.strokeCircle(ARENA_CENTRE.x, ARENA_CENTRE.y, radius, t.floorLine, 1, 0.5 + 0.3 * beatPulse);
    }
    for (let i = 0; i < 8; i++) {
      const angle = (i * Math.PI) / 4;
      const from = polarToField(angle, GUIDE_RINGS[0]);
      const to = polarToField(angle, 0.78);
      r.line(from.x, from.y, to.x, to.y, t.floorLine, 1, 0.4);
    }
    r.strokeCircle(ARENA_CENTRE.x, ARENA_CENTRE.y, 0.012, t.floorMark, 1, 0.55);

    // Inner inset line: a second rounded rect just inside the rim. This is what
    // actually makes the board read as a *board* rather than as a coloured
    // square -- a single outline looks like a border, a nested pair looks like a
    // surface with a bevel.
    strokeRoundRect(r, { x: 0.022, y: 0.022, w: 0.956, h: 0.956 }, CORNER * 0.7, t.floorLine, 1, 0.5);

    // Corner wedges, aimed at the four true corners, so the eye is told the
    // board is square even though the rim is rounded.
    for (const sx of [-1, 1]) {
      for (const sy of [-1, 1]) {
        const cx = ARENA_CENTRE.x + sx * 0.5;
        const cy = ARENA_CENTRE.y + sy * 0.5;
        r.line(cx - sx * 0.10, cy - sy * 0.012, cx - sx * 0.012, cy - sy * 0.012, t.floorMark, 2, 0.35);
        r.line(cx - sx * 0.012, cy - sy * 0.10, cx - sx * 0.012, cy - sy * 0.012, t.floorMark, 2, 0.35);
      }
    }
  }

  // ---- boundary ----------------------------------------------------------

  /**
   * The rim, in four passes.
   *
   * The hairline and brackets come first and are drawn *exactly* on the playable
   * square -- they are the promise. The glowing rounded rim is drawn after, on
   * top, because it is the thing the player will actually look at, and a bright
   * mark under a dim one reads as noise.
   */
  private renderBoundary(r: Renderer, info: StageInfo, pulse: number): void {
    const t = this.theme;
    const board: Rect = { x: 0, y: 0, w: 1, h: 1 };

    // 1. The exact playable limit.
    r.strokeRect(board, t.boundary, 1, 0.3 + 0.15 * pulse);
    for (const sx of [-1, 1]) {
      for (const sy of [-1, 1]) {
        const cx = ARENA_CENTRE.x + sx * 0.5;
        const cy = ARENA_CENTRE.y + sy * 0.5;
        r.line(cx - sx * 0.055, cy, cx, cy, t.boundary, 3, 0.6);
        r.line(cx, cy - sy * 0.055, cx, cy, t.boundary, 3, 0.6);
      }
    }

    // 2. The luminous rim: a wide soft glow, a body, and a bright core.
    const reactivity = Math.max(info.hitPulse, info.perfectPulse);
    const glow = 0.16 + 0.20 * pulse + 0.35 * reactivity;
    const body = 0.55 + 0.25 * pulse + 0.4 * reactivity;
    strokeRoundRect(r, board, CORNER, t.rimGlow, 14, glow * 0.35);
    strokeRoundRect(r, board, CORNER, t.rimGlow, 6, glow);
    strokeRoundRect(r, board, CORNER, t.rimBody, 2.5, body);
    strokeRoundRect(r, board, CORNER, t.rimCore, 1, 0.35 + 0.3 * pulse + 0.35 * reactivity);

    // 3. A reactive flash on the rim itself, in the colour of what just
    //    happened -- red for a hit, cyan for a clean dodge. The rim is the one
    //    part of the stage that is allowed to carry gameplay feedback, because
    //    it is already the brightest thing on screen and it is never in the way.
    if (info.hitPulse > 0.01) {
      strokeRoundRect(r, board, CORNER, t.reactHit, 5, info.hitPulse * 0.9);
    }
    if (info.perfectPulse > 0.01) {
      strokeRoundRect(r, board, CORNER, t.reactPerfect, 4, info.perfectPulse * 0.9);
    }
  }

  /**
   * Screen-edge darkening.
   *
   * The arena is a bright board in a dark room, and this is what sells that: it
   * pulls the letterbox down so the eye is not asked to look at the environment
   * while dodging. Drawn in field space over the whole extent, so it also dims
   * the far parts of the skyline.
   */
  private renderVignette(r: Renderer, info: StageInfo): void {
    const c = r.ctx;
    const reactivity = Math.max(info.hitPulse, info.perfectPulse);
    const strength = 0.55 + 0.2 * reactivity;
    const g = c.createRadialGradient(
      r.px(ARENA_CENTRE.x), r.py(ARENA_CENTRE.y), r.len(0.62),
      r.px(ARENA_CENTRE.x), r.py(ARENA_CENTRE.y), r.len(1.5),
    );
    g.addColorStop(0, 'rgba(0,0,0,0)');
    g.addColorStop(1, `rgba(0,0,0,${strength.toFixed(3)})`);
    c.save();
    c.fillStyle = g;
    c.fillRect(r.px(ENV_MIN), r.py(ENV_MIN), r.len(ENV_SPAN), r.len(ENV_SPAN));
    c.restore();
  }
}

// ---- helpers -------------------------------------------------------------

/**
 * A rounded-rect path in pixel space.
 *
 * Built here rather than added to `Renderer` on purpose: ARENA is the only mode
 * with a rectangular board, and a shared primitive that one mode uses is a
 * shared primitive the other three have to keep working. The renderer already
 * exposes `px/py/len` and its context, which is enough.
 */
function roundRectPath(r: Renderer, rect: Rect, radius: number): void {
  const c = r.ctx;
  const x = r.px(rect.x);
  const y = r.py(rect.y);
  const w = r.len(rect.w);
  const h = r.len(rect.h);
  const rad = Math.max(0, Math.min(r.len(radius), Math.min(w, h) / 2));
  c.beginPath();
  c.moveTo(x + rad, y);
  c.lineTo(x + w - rad, y);
  c.arcTo(x + w, y, x + w, y + rad, rad);
  c.lineTo(x + w, y + h - rad);
  c.arcTo(x + w, y + h, x + w - rad, y + h, rad);
  c.lineTo(x + rad, y + h);
  c.arcTo(x, y + h, x, y + h - rad, rad);
  c.lineTo(x, y + rad);
  c.arcTo(x, y, x + rad, y, rad);
  c.closePath();
}

function strokeRoundRect(
  r: Renderer,
  rect: Rect,
  radius: number,
  style: string,
  widthPx: number,
  alpha: number,
): void {
  if (alpha <= 0.001) return;
  r.withAlpha(alpha, () => {
    const c = r.ctx;
    c.strokeStyle = style;
    c.lineWidth = widthPx;
    c.lineJoin = 'round';
    roundRectPath(r, rect, radius);
    c.stroke();
  });
}

/** 1 on the downbeat, decaying over the bar. */
function downbeatPulse(beat: number, beatsPerBar: number): number {
  const intoBar = ((beat % beatsPerBar) + beatsPerBar) % beatsPerBar;
  return Math.max(0, 1 - intoBar / Math.max(0.25, beatsPerBar * 0.5));
}

/** 1 on every beat, decaying over it. */
function subBeatPulse(beat: number): number {
  const intoBeat = ((beat % 1) + 1) % 1;
  return Math.max(0, 1 - intoBeat);
}

/** Stable 0..1 from an integer. Same input, same skyline, every session. */
function hash01(n: number): number {
  const x = Math.sin(n * 12.9898) * 43758.5453;
  return x - Math.floor(x);
}

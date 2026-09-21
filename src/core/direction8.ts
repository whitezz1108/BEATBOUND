/**
 * Eight-direction abstraction.
 *
 * One place converts a direction to an angle, a vector, a glyph and the keys
 * that enter it. Nothing else in the codebase is allowed to compute a direction
 * angle by hand -- that is how a system quietly ends up assuming four.
 *
 * Angles are radians in canvas convention (x right, y *down*), so:
 *
 *        N (-90)
 *   NW        NE
 * W (180)        E (0)
 *   SW        SE
 *        S (+90)
 */

export const DIRECTION8 = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'] as const;
export type Direction8 = (typeof DIRECTION8)[number];

export const CARDINALS: readonly Direction8[] = ['N', 'E', 'S', 'W'];
export const DIAGONALS: readonly Direction8[] = ['NE', 'SE', 'SW', 'NW'];

const DEG: Record<Direction8, number> = {
  N: -90, NE: -45, E: 0, SE: 45, S: 90, SW: 135, W: 180, NW: 225,
};

export const DIRECTION_ANGLE: Record<Direction8, number> = Object.fromEntries(
  DIRECTION8.map((d) => [d, (DEG[d] * Math.PI) / 180]),
) as Record<Direction8, number>;

export const DIRECTION_VECTOR: Record<Direction8, { x: number; y: number }> = Object.fromEntries(
  DIRECTION8.map((d) => {
    const a = DIRECTION_ANGLE[d];
    // Snap the near-zero components so cardinals are exactly axis-aligned.
    const round = (v: number) => (Math.abs(v) < 1e-9 ? 0 : v);
    return [d, { x: round(Math.cos(a)), y: round(Math.sin(a)) }];
  }),
) as Record<Direction8, { x: number; y: number }>;

export const DIRECTION_GLYPH: Record<Direction8, string> = {
  N: '↑', NE: '↗', E: '→', SE: '↘',
  S: '↓', SW: '↙', W: '←', NW: '↖',
};

export const DIRECTION_COLOUR: Record<Direction8, string> = {
  N: '#6de3ff', NE: '#7cf5d0', E: '#ffc46d', SE: '#ff9e6d',
  S: '#ff8ec4', SW: '#d18cff', W: '#9a8cff', NW: '#8cb8ff',
};

/** The cardinal components a direction is entered with. */
export const DIRECTION_COMPONENTS: Record<Direction8, Direction8[]> = {
  N: ['N'], E: ['E'], S: ['S'], W: ['W'],
  NE: ['N', 'E'], SE: ['S', 'E'], SW: ['S', 'W'], NW: ['N', 'W'],
};

/** Keys that enter each cardinal. Diagonals are two of these at once. */
export const CARDINAL_KEYS: Record<'N' | 'E' | 'S' | 'W', string[]> = {
  N: ['arrowup', 'w'],
  E: ['arrowright', 'd'],
  S: ['arrowdown', 's'],
  W: ['arrowleft', 'a'],
};

export function isDiagonal(direction: Direction8): boolean {
  return DIRECTION_COMPONENTS[direction].length > 1;
}

/**
 * True when two cardinals sit adjacent on the compass, so holding both enters
 * a diagonal (N+E -> NE). Opposite cardinals (N+S, E+W) enter no direction at
 * all: each press stays an ordinary cardinal press of its own.
 */
export function isDiagonalPair(a: Direction8, b: Direction8): boolean {
  const diff = Math.abs(DIRECTION8.indexOf(a) - DIRECTION8.indexOf(b));
  return diff === 2 || diff === 6; // 6 is the wrap-around: W+N -> NW
}

/**
 * Parse a direction from pattern data.
 *
 * Accepts the eight names and the legacy four-direction spellings the original
 * library used, so existing patterns keep working unchanged.
 */
export function parseDirection(value: unknown): Direction8 | null {
  const raw = String(value ?? '').trim().toUpperCase();
  switch (raw) {
    case 'UP': case 'NORTH': return 'N';
    case 'RIGHT': case 'EAST': return 'E';
    case 'DOWN': case 'SOUTH': return 'S';
    case 'LEFT': case 'WEST': return 'W';
    case 'UP_RIGHT': case 'NORTH_EAST': return 'NE';
    case 'DOWN_RIGHT': case 'SOUTH_EAST': return 'SE';
    case 'DOWN_LEFT': case 'SOUTH_WEST': return 'SW';
    case 'UP_LEFT': case 'NORTH_WEST': return 'NW';
    default:
      return (DIRECTION8 as readonly string[]).includes(raw) ? (raw as Direction8) : null;
  }
}

/** Step `count` positions clockwise around the eight-point compass. */
export function rotate(direction: Direction8, count: number): Direction8 {
  const index = DIRECTION8.indexOf(direction);
  const next = ((index + count) % 8 + 8) % 8;
  return DIRECTION8[next];
}

export function opposite(direction: Direction8): Direction8 {
  return rotate(direction, 4);
}

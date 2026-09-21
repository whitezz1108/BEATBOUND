/**
 * BeatBound — engine constants.
 * World unit "u" = one grid cell. Player is ~1u wide/tall like a cube.
 */

// Logical view (canvas is scaled to fit a 16:9 box)
export const VIEW_W = 1280
export const VIEW_H = 720
export const CELL = 48 // px per world unit
export const HORIZON_Y = 512 // screen y of the ground line
export const VIEW_W_U = VIEW_W / CELL

// Player
export const PLAYER_SIZE = 1.0 // visual size (u)
export const PLAYER_HIT = 0.9 // deadly/landing hitbox size (u)
export const PLAYER_HALF = PLAYER_HIT / 2
export const PLAYER_HAZ = 0.28 // half-width of the hitbox used vs hazards (forgiving, GD-style)
export const GROUND_SUPPORT = 0.33 // half-width of ground support check

// Physics (units/second) — tuned for a GD-like jump: ~2u high, ~0.51s air
export const GRAVITY = 60
export const JUMP_V = 15.4
export const JUMP_AIR = (2 * JUMP_V) / GRAVITY // 0.513s
export const JUMP_DIST = (speed: number) => JUMP_AIR * speed

// Fixed timestep
export const STEP = 1 / 240
export const MAX_FRAME_DT = 0.06

// Gameplay
export const DEATH_Y = -0.6 // fell into a gap (below-ground threshold)
export const JUMP_BUFFER = 0.09 // seconds of input buffering
export const RETRY_LOCK = 0.45 // ignore retry input briefly after death
export const CAM_ANCHOR = 0.3 // player sits at 30% of the view width

// Hitbox insets (forgiving, GD-style)
export const SPIKE_INSET_X = 0.3 // spike deadly box: x+0.3 .. x+0.7
export const SPIKE_TOP = 0.62 // spike deadly height
export const SPIKE_SMALL_TOP = 0.36

// Ceiling gate geometry
export const GATE_BAR_Y = 2.55 // solid bar bottom
export const GATE_BAR_H = 0.62
export const GATE_TIP_Y = 1.75 // hanging spike tips (deadly zone below bar)

// Saw / pulse
export const SAW_R = 0.42 // deadly radius
export const SAW_VR = 0.52 // visual radius
export const SAW_CY = 0.05 // mostly buried in the ground
export const PULSE_R_MIN = 0.3
export const PULSE_R_MAX = 0.82
export const PULSE_DEADLY = 0.55 // deadly when expanded above this radius

// Palette — neon on dark plum (no default blues/indigos)
export const COLORS = {
  bg0: '#0b0710',
  bg1: '#170b20',
  primary: '#ff2e7e', // neon pink
  primarySoft: 'rgba(255,46,126,0.35)',
  amber: '#ffb02e',
  mint: '#2ee6a8',
  danger: '#ff4b3e',
  white: '#f7f3fb',
  ground: '#150b1c',
} as const

export const storageKey = (id: string, kind: 'best' | 'attempts') => `beatbound-${id}-${kind}`

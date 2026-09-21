/**
 * The VERTICAL highway: a perspective 3D stage drawn through the 2D renderer.
 *
 * World space: x runs across the road (0 = centre, one lane = LANE_W units),
 * z runs away from the player (z = Z_HIT is the judgement line, larger z is
 * further away) and h runs up from the road surface. One perspective divide
 * turns (x, z, h) into field coordinates, so notes, pads, grid lines and the
 * scenery all share a single camera -- and the camera itself performs: the
 * horizon dips on downbeats, the road slowly curves left and right, speed
 * streaks tear past the rails, and the whole scene heats up (sky, sun, rails)
 * as the player's combo grows.
 *
 * Everything here is presentation. Judgement still lives in NoteMode and
 * travel is still a pure function of the beat; zOf() is the only bridge.
 */

import { clamp, lerp, makeRng, type Vec2 } from '../../core/geometry';
import type { Renderer } from '../../core/Renderer';
import { LANE_COUNT } from '../../mechanics/vertical/LaneNoteMechanic';
import { TUNING } from '../../tuning';

/** z of the judgement line -- the plane notes are hit on. */
export const Z_HIT = 1;
/** The road is drawn from here (under the field edge) to the horizon. */
const Z_NEAR = 0.55;
const Z_FAR = 5.6;
/** World width of one lane. Total road width stays fixed as lanes are added. */
export const LANE_W = 1.08 / LANE_COUNT;
const ROAD_HALF = (LANE_W * LANE_COUNT) / 2;
/** Notes retire once their tail slides this far past the camera. */
export const Z_EXIT = 0.72;

/** Where the road vanishes and where the hit line sits, in field y. */
const BASE_HORIZON_Y = 0.16;
const HIT_Y = 0.87;

/** Note slab geometry, world units. Shared with VerticalMode's drawing. */
export const NOTE_HEIGHT = 0.09;
export const NOTE_DEPTH = 0.15;

export interface Projected {
  x: number;
  y: number;
  /** Perspective scale at this point (k/z); 1 unit of world size -> s field. */
  s: number;
}

interface Star { x: number; y: number; size: number; phase: number }
interface Building { x: number; w: number; h: number }
interface SkylineLayer { parallax: number; colour: string; buildings: Building[] }
interface Streak { x: number; z: number; len: number; speed: number; width: number }

const STREAK_COUNT = 42;

/** Mix two #rrggbb colours. */
export function lerpColour(a: string, b: string, t: number): string {
  const mix = clamp(t, 0, 1);
  const ar = parseInt(a.slice(1, 3), 16), ag = parseInt(a.slice(3, 5), 16), ab = parseInt(a.slice(5, 7), 16);
  const br = parseInt(b.slice(1, 3), 16), bg = parseInt(b.slice(3, 5), 16), bb = parseInt(b.slice(5, 7), 16);
  const r = Math.round(lerp(ar, br, mix)), g = Math.round(lerp(ag, bg, mix)), bl = Math.round(lerp(ab, bb, mix));
  return `#${((r << 16) | (g << 8) | bl).toString(16).padStart(6, '0')}`;
}

function frac(beat: number): number {
  return ((beat % 1) + 1) % 1;
}

export class Highway {
  /** 0..1 -- how hot the performance is. Drives sky, sun, rails, streaks. */
  private heat = 0;
  private heatTarget = 0;

  // Camera state, re-derived every frame from the beat.
  private horizonY = BASE_HORIZON_Y;
  private k = 0;
  private vpX = 0.5;
  private curve = 0;
  private beat = 0;
  private lastBeat = NaN;
  /** 0..1 ramp right after each downbeat, reused by several layers. */
  private downbeat = 0;

  private readonly stars: Star[] = [];
  private readonly skylines: SkylineLayer[] = [];
  private readonly streaks: Streak[] = [];

  constructor() {
    const rng = makeRng(20260920);
    for (let i = 0; i < 64; i++) {
      this.stars.push({
        x: rng(), y: rng() * BASE_HORIZON_Y * 0.94,
        size: 0.0012 + rng() * 0.0022, phase: rng() * Math.PI * 2,
      });
    }
    this.skylines = [
      { parallax: 0.35, colour: '#151b31', buildings: makeSkyline(makeRng(777), 0.05, 0.075) },
      { parallax: 1, colour: '#0d1223', buildings: makeSkyline(makeRng(1337), 0.04, 0.115) },
    ];
    for (let i = 0; i < STREAK_COUNT; i++) {
      this.streaks.push({
        x: 0, z: 0, len: 0, speed: 0, width: 0,
      });
      this.respawnStreak(this.streaks[i], 0.8 + (i / STREAK_COUNT) * 4);
    }
  }

  // ---- projection ---------------------------------------------------------

  /** World x of a lane's centre (lane 1..LANE_COUNT). */
  laneX(lane: number): number {
    return (lane - (LANE_COUNT + 1) / 2) * LANE_W;
  }

  /** Distance of a note that is `beatsAway` from its judgement beat. */
  zOf(beatsAway: number): number {
    return Z_HIT + beatsAway * TUNING.vertical.worldUnitsPerBeat;
  }

  /**
   * Perspective projection. The camera sits behind the hit line, above the
   * road, looking at the vanishing point. h lifts the point off the road
   * plane, which is how notes get their 3D slabs and light beams.
   */
  project(wx: number, z: number, h = 0): Projected {
    const zz = Math.max(0.18, z);
    const s = this.k / zz;
    const bend = wx + this.curve * (zz - Z_HIT);
    return { x: this.vpX + bend * s, y: this.horizonY + s * (1 - h), s };
  }

  /** Field-space centre of a lane's receptor, for judgement anchors. */
  receptorFieldPos(lane: number): Vec2 {
    const p = this.project(this.laneX(lane), Z_HIT);
    return { x: p.x, y: p.y };
  }

  // ---- frame --------------------------------------------------------------

  /** Target heat, 0..1. VerticalMode feeds this from the live combo. */
  setHeat(value: number): void {
    this.heatTarget = clamp(value, 0, 1);
  }

  /** Advance the camera and ambience. Call once per frame before drawing. */
  update(beat: number): void {
    let dt = beat - this.lastBeat;
    if (!(dt >= 0) || dt > 2) dt = 0; // restarts, seeks, first frame
    this.lastBeat = beat;
    this.beat = beat;
    this.heat += (this.heatTarget - this.heat) * Math.min(1, dt * (this.heatTarget > this.heat ? 6 : 1.4));

    const beatPulse = 1 - frac(beat);
    const barFrac = ((beat % 4) + 4) % 4;
    const downbeat = Math.max(0, 1 - barFrac * 2.4);

    this.vpX = 0.5 + Math.sin(beat * 0.21) * 0.01;
    this.curve = Math.sin(beat * 0.077) * 0.045;
    this.downbeat = downbeat;
    // Downbeats pull the horizon down and lift the viewer -- a wide-screen kick.
    this.horizonY = BASE_HORIZON_Y - 0.016 * downbeat * (0.45 + 0.55 * this.heat) - 0.003 * beatPulse;
    this.k = (HIT_Y - this.horizonY) * Z_HIT;

    const flow = TUNING.vertical.worldUnitsPerBeat * (1.55 + this.heat * 1.1);
    for (const st of this.streaks) {
      st.z -= flow * st.speed * dt;
      if (st.z < 0.62) this.respawnStreak(st, 3.4 + Math.random() * 1.6);
    }
  }

  private respawnStreak(st: Streak, z: number): void {
    const side = Math.random() < 0.5 ? -1 : 1;
    st.x = side * (ROAD_HALF + 0.16 + Math.random() * 1.15);
    st.z = z;
    st.len = 0.22 + Math.random() * 0.5;
    st.speed = 0.8 + Math.random() * 0.7;
    st.width = 0.6 + Math.random() * 1.6;
  }

  // ---- backdrop: sky, sun, skyline ----------------------------------------

  renderBackdrop(r: Renderer): void {
    const beat = this.beat;
    const beatPulse = 1 - frac(beat);
    const heat = this.heat;

    // Sky: cold indigo when calm, blazing magenta as the combo climbs.
    const skyTop = lerpColour('#0a0d1f', '#1a0b2e', heat * 0.7);
    const skyMid = lerpColour('#141a38', '#3c1140', heat);
    const skyLow = lerpColour('#23305e', '#7a1f4e', heat);
    r.gradientRect(
      { x: 0, y: 0, w: 1, h: this.horizonY + 0.02 },
      [[0, skyTop], [0.62, skyMid], [1, skyLow]],
    );

    for (const s of this.stars) {
      const twinkle = 0.25 + 0.55 * Math.abs(Math.sin(beat * 1.6 + s.phase));
      r.fillCircle(s.x, s.y, s.size * (1 + 0.4 * beatPulse), '#c8d6ff', twinkle * (0.5 + 0.5 * (1 - heat * 0.4)));
    }

    this.renderSun(r, beatPulse);

    const sway = Math.sin(beat * 0.21) * 0.01;
    for (const layer of this.skylines) {
      const shift = sway * layer.parallax * 2.4;
      for (const b of layer.buildings) {
        r.fillRect(
          { x: b.x + shift, y: this.horizonY - b.h, w: b.w, h: b.h + 0.006 },
          layer.colour, 1,
        );
      }
    }
  }

  private renderSun(r: Renderer, beatPulse: number): void {
    const heat = this.heat;
    const barFrac = ((this.beat % 4) + 4) % 4;
    const downbeat = Math.max(0, 1 - barFrac * 2.4);
    const colour = lerpColour('#ff7eb6', '#ffae57', heat);
    const coreR = 0.072 * (1 + 0.05 * beatPulse + 0.06 * downbeat + 0.22 * heat);
    const cx = this.vpX;
    const cy = this.horizonY - 0.052;

    r.glow(cx, cy, coreR * 3.1 * (1 + 0.12 * downbeat), colour, 0.34 + 0.3 * heat + 0.1 * downbeat);
    r.fillCircle(cx, cy, coreR, colour, 0.9);
    r.fillCircle(cx, cy, coreR * 0.66, lerpColour(colour, '#fff3e0', 0.55), 0.8);

    // Retro slit bands across the sun's lower half -- chord-width rects that
    // match the sky at that height, so they read as cut-outs.
    const skyTop = lerpColour('#0a0d1f', '#1a0b2e', this.heat * 0.7);
    const skyLow = lerpColour('#23305e', '#7a1f4e', this.heat);
    for (let i = 0; i < 4; i++) {
      const dy = coreR * (0.18 + i * 0.22);
      const half = Math.sqrt(Math.max(0, coreR * coreR - dy * dy));
      if (half <= 0.001) continue;
      const bandH = coreR * (0.075 - i * 0.008);
      const sky = lerpColour(skyTop, skyLow, clamp((cy + dy) / (this.horizonY + 0.02), 0, 1));
      r.fillRect({ x: cx - half, y: cy + dy, w: half * 2, h: bandH }, sky, 0.95);
    }
  }

  // ---- road ---------------------------------------------------------------

  /** Ground, road surface, lane lines, beat grid, rails, beacons, spawn arch. */
  renderRoad(r: Renderer, heldLanes: boolean[]): void {
    const beat = this.beat;
    const heat = this.heat;
    const beatPulse = 1 - frac(beat);

    // Ground either side of the road.
    r.fillRect({ x: 0, y: this.horizonY, w: 1, h: 1 - this.horizonY }, '#080b16');

    // Road surface, in depth slices so it lightens toward the horizon haze.
    const slices: Array<[number, number]> = [[Z_NEAR, 1.35], [1.35, 2.3], [2.3, Z_FAR * 0.86]];
    const sliceColours = ['#0a0e1d', '#0f142b', '#1d2547'];
    for (let i = 0; i < slices.length; i++) {
      r.fillPolygon(this.roadQuad(slices[i][0], slices[i][1]), sliceColours[i], 1);
    }

    // Held lanes light up as translucent strips running toward the horizon.
    for (let lane = 1; lane <= LANE_COUNT; lane++) {
      if (!heldLanes[lane - 1]) continue;
      const x = this.laneX(lane);
      const hw = LANE_W * 0.44;
      const colour = LANE_STRIP_COLOURS[lane - 1];
      r.fillPolygon(this.laneQuad(x, hw, 0.62, 2.4), colour, 0.045);
      r.fillPolygon(this.laneQuad(x, hw, 0.62, 1.15), colour, 0.06);
    }

    // Lane dividers warm up with the combo.
    for (let b = 1; b < LANE_COUNT; b++) {
      const x = -ROAD_HALF + b * LANE_W;
      r.polyline(this.roadLine(x, Z_NEAR, 4.6), lerpColour('#33406b', '#5d76c9', heat * 0.7), 1, 0.32 + 0.3 * heat);
    }

    // Beat grid: one transverse line per beat, bars accented. The grid IS the
    // metronome -- each line reaching the hit line exactly on its beat.
    for (let i = Math.floor(beat) - 1; i <= beat + 5; i++) {
      const t = i - beat;
      if (t < -0.45 || t > 4.7) continue;
      const z = this.zOf(t);
      if (z > Z_FAR * 0.93) continue;
      const fade = clamp((Z_FAR * 0.93 - z) * 1.4, 0, 1) * clamp((z - Z_NEAR) * 3, 0, 1);
      const bar = (((i % 4) + 4) % 4) === 0;
      if (bar) {
        r.polyline(this.roadSpan(z, ROAD_HALF), '#6f82c9', 2, (0.3 + 0.22 * heat) * fade + 0.18 * beatPulse * fade);
        this.renderBeacons(r, z, fade * (0.55 + 0.45 * beatPulse));
      } else {
        r.polyline(this.roadSpan(z, ROAD_HALF), '#3b4874', 1, 0.2 * fade);
      }
    }

    // Side rails, pulsing with the beat and warming with the combo.
    const railColour = lerpColour('#8ea0ff', '#ff9d66', heat * 0.55);
    for (const side of [-1, 1]) {
      const pts = this.roadEdge(side);
      r.polyline(pts, railColour, 6, 0.09 + 0.07 * heat);
      r.polyline(pts, railColour, 2.2, 0.42 + 0.24 * heat + 0.18 * beatPulse * heat);
    }

    // Horizon haze spilling over the far road, flaring on every downbeat.
    const haze = lerpColour('#3a4a8f', '#b04a7a', heat);
    r.gradientRect(
      { x: 0, y: this.horizonY - 0.05, w: 1, h: 0.14 },
      [[0, 'rgba(0,0,0,0)'], [0.5, haze], [1, 'rgba(0,0,0,0)']],
      0.4 * (1 + 0.7 * this.downbeat),
    );

    // The spawn arch: notes materialise passing through this neon gate.
    const zSpawn = this.zOf(TUNING.vertical.approachBeats);
    const span = ROAD_HALF + 0.07;
    const arch: Vec2[] = [];
    for (let i = 0; i <= 14; i++) {
      const f = (i / 14) * 2 - 1;
      const h = 0.5 * Math.sqrt(Math.max(0, 1 - f * f));
      arch.push(this.project(f * span, zSpawn, h));
    }
    r.polyline(arch, '#8f7bff', 6, 0.06);
    r.polyline(arch, '#a996ff', 2.2, 0.3 + 0.3 * beatPulse);
  }

  private renderBeacons(r: Renderer, z: number, strength: number): void {
    if (z > 4.3 || z < 0.95 || strength <= 0.02) return;
    const heat = this.heat;
    const colour = lerpColour('#6de3ff', '#ffc46d', heat * 0.7);
    for (const side of [-1, 1]) {
      const p = this.project(side * (ROAD_HALF + 0.1), z);
      r.glow(p.x, p.y, 0.02 + 0.012 * strength, colour, 0.5 * strength);
      r.fillCircle(p.x, p.y, 0.0035, '#ffffff', 0.7 * strength);
    }
  }

  // ---- streaks ------------------------------------------------------------

  /** Speed streaks tearing past the rails: pure forward-motion feedback. */
  renderStreaks(r: Renderer): void {
    const heat = this.heat;
    const colour = lerpColour('#9fb4ff', '#ffd9a8', heat * 0.5);
    for (const st of this.streaks) {
      const a = this.project(st.x, st.z);
      const b = this.project(st.x, st.z + st.len);
      const near = clamp((st.z - 0.7) * 2.2, 0, 1);
      const fade = clamp((4.6 - st.z) * 0.9, 0, 1);
      r.line(a.x, a.y, b.x, b.y, colour, clamp(st.width * a.s * 3.2, 0.6, 2.6), (0.14 + 0.4 * heat) * near * fade);
    }
  }

  // ---- receptors ----------------------------------------------------------

  /**
   * The four judgement pads and, above them, the hit line. `flashes` (0..1)
   * pop the pad on a fresh hit; `anticipation` (0..1) lets an incoming note
   * breathe the pad brighter before it lands.
   */
  renderReceptors(
    r: Renderer, heldLanes: boolean[], flashes: number[], anticipation: number[],
  ): void {
    const beat = this.beat;
    const beatPulse = 1 - frac(beat);
    for (let lane = 1; lane <= LANE_COUNT; lane++) {
      const x = this.laneX(lane);
      const colour = LANE_STRIP_COLOURS[lane - 1];
      const held = heldLanes[lane - 1];
      const flash = clamp(flashes[lane - 1] ?? 0, 0, 1);
      const expect = clamp(anticipation[lane - 1] ?? 0, 0, 1);
      const hw = LANE_W * 0.42;
      const pad = [
        this.project(x - hw, Z_HIT + 0.075, 0.012),
        this.project(x + hw, Z_HIT + 0.075, 0.012),
        this.project(x + hw, Z_HIT - 0.075, 0.012),
        this.project(x - hw, Z_HIT - 0.075, 0.012),
      ];

      const glowStrength = (held ? 0.55 : 0.22 + 0.2 * beatPulse) + expect * 0.5 + flash * 0.8;
      const centre = this.project(x, Z_HIT, 0.02);
      r.glow(centre.x, centre.y, 0.08 + 0.06 * glowStrength, colour, 0.3 * glowStrength + 0.18);
      // Neutral underlay first, so all four hues read at one brightness.
      r.fillPolygon(pad, '#cdd9ff', 0.09);
      r.fillPolygon(pad, colour, (held ? 0.38 : 0.18) + expect * 0.2 + flash * 0.4);
      r.polyline(pad, held || flash > 0.05 ? '#ffffff' : '#aab8e8', held ? 2.2 : 1.4, held ? 0.85 : 0.5);

      if (held) this.renderBeam(r, x, Z_HIT, hw * 0.85, colour, 0.4 + 0.25 * this.heat);
      if (flash > 0.02) this.renderBeam(r, x, Z_HIT, hw, colour, flash);
    }

    // The hit line itself, pulsing on the beat.
    r.polyline(this.roadSpan(Z_HIT, ROAD_HALF + 0.06), '#e8ecf8', 2.6, 0.3 + 0.5 * beatPulse);
  }

  /** Lane key letters, above everything -- the pads they label must never be
   * hidden by the note currently landing on them. */
  renderKeyLabels(r: Renderer, keys: readonly string[], heldLanes: boolean[]): void {
    for (let lane = 1; lane <= LANE_COUNT; lane++) {
      const held = heldLanes[lane - 1];
      const p = this.project(this.laneX(lane), Z_HIT, 0.02);
      if (held) r.glow(p.x, HIT_Y + 0.052, 0.03, '#dfe6ff', 0.5);
      r.text(keys[lane - 1], p.x, HIT_Y + 0.052, held ? '#f2f5ff' : '#9fb0d8', 15);
    }
  }

  /**
   * A vertical light beam rising from the road at (wx, z) -- stacked, tapering
   * quads, since each layer's alpha has to fall with height by hand.
   */
  renderBeam(r: Renderer, wx: number, z: number, hw: number, colour: string, strength: number): void {
    if (strength <= 0.02) return;
    const layers: Array<[number, number]> = [[0.12, 0.22], [0.26, 0.12], [0.44, 0.06]];
    for (const [h, a] of layers) {
      r.fillPolygon([
        this.project(wx - hw, z, 0.01),
        this.project(wx + hw, z, 0.01),
        this.project(wx + hw * 0.45, z, h),
        this.project(wx - hw * 0.45, z, h),
      ], colour, a * strength);
    }
  }

  // ---- shared geometry helpers --------------------------------------------

  /** Edge-to-edge span of the road at distance z. */
  private roadSpan(z: number, half: number): Vec2[] {
    return [this.project(-half, z), this.project(half, z)];
  }

  /** Road-edge polyline (sampled, so the highway's curve bends it). */
  private roadEdge(side: number): Vec2[] {
    const xs = [Z_NEAR, 1.1, 2.0, 3.1, 4.3, 5.3];
    return xs.map((z) => this.project(side * ROAD_HALF, z));
  }

  /** Same, for any world x -- lane dividers and strips. */
  private roadLine(x: number, z0: number, z1: number): Vec2[] {
    return [z0, z0 + (z1 - z0) * 0.38, z0 + (z1 - z0) * 0.72, z1].map((z) => this.project(x, z));
  }

  /** Road quad between two distances (3 samples per edge for the curve). */
  private roadQuad(z0: number, z1: number): Vec2[] {
    const left: Vec2[] = [];
    const right: Vec2[] = [];
    for (const z of [z0, (z0 + z1) / 2, z1]) {
      left.push(this.project(-ROAD_HALF, z));
      right.push(this.project(ROAD_HALF, z));
    }
    return [...left, ...right.reverse()];
  }

  /** Lane-width quad along the road between two distances. */
  laneQuad(x: number, hw: number, z0: number, z1: number): Vec2[] {
    return [
      this.project(x - hw, z0, 0.01),
      this.project(x + hw, z0, 0.01),
      this.project(x + hw, z1, 0.01),
      this.project(x - hw, z1, 0.01),
    ];
  }
}

/** Lane colours, shared with the note drawing in VerticalMode. Six neon hues
 * ordered cool-warm so adjacent lanes always contrast. */
export const LANE_STRIP_COLOURS = [
  '#6de3ff', '#9a8cff', '#ff8ec4', '#ffc46d', '#7bff9e', '#ff9d76',
];

function makeSkyline(rng: () => number, minW: number, maxH: number): Building[] {
  const buildings: Building[] = [];
  let x = -0.15;
  while (x < 1.2) {
    const w = minW + rng() * 0.05;
    const h = maxH * (0.3 + rng() * 0.7);
    buildings.push({ x, w, h });
    if (rng() < 0.18) buildings.push({ x: x + w * 0.35, w: w * 0.14, h: h * 1.35 }); // antenna
    x += w + rng() * 0.015;
  }
  return buildings;
}

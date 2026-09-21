/**
 * A05 -- Chain (ARENA).
 *
 * A Helltaker-inspired chain whip. Three families live here:
 *
 *  - PATH families (PARALLEL, X_CROSS, FAN, SWEEP, CURVE_C, CURVE_S, ARC,
 *    SPIRAL, ROTATING_CHAINS): a *thin* chain that extends along a generated
 *    polyline. The chain itself is the danger -- dodging means being off the
 *    line, not out of a band -- and because the line is thin, the play is
 *    precise positioning rather than lane-leaving. The shapes are pure
 *    generators in `chainPaths.ts`; this file only walks them, draws them and
 *    exposes them to the collision system.
 *
 *  - LINE layouts (SLASH, BACKSLASH, CROSS, ZIGZAG, SNAKE, CORRIDOR, POLYLINE):
 *    the original hand-placed paths, unchanged. CORRIDOR draws two parallel
 *    chains around a safe channel the player has to be inside; the channel is
 *    floored by the fairness system's minimum gap.
 *
 *  - LANE (legacy `direction`): the chain claims one lane of a lane tiling and
 *    sweeps it. The tiling is deliberate -- see below -- and this layout is
 *    what the sync-test's AP03 checks against, so its event contract is frozen.
 *
 * Params:
 *   layout    "LANE" | "SLASH" | "BACKSLASH" | "CROSS" | "ZIGZAG" | "SNAKE"
 *             | "CORRIDOR" | "POLYLINE"
 *             | "PARALLEL" | "X_CROSS" | "FAN" | "SWEEP" | "CURVE_C"
 *             | "CURVE_S" | "ARC" | "SPIRAL" | "ROTATING_CHAINS"   default "LANE"
 *   chains    how many chains the path family draws (default per family)
 *   complexity 0..1, how far the family leans into its own idea   default 0.5
 *   rotationPerBeat  path families: radians/beat about the centre, clamped
 *   direction legacy lane whip direction         (LANE)
 *   travel    "FORWARD" | "BACKWARD"              (line + path layouts)
 *   width     lane span, in lanes                 (LANE, default 1)
 *   laneCount lanes the field is divided into     (LANE, default 4)
 *   thickness chain link diameter 0.01..0.03      (line layouts, default 0.016)
 *   corridorWidth  safe channel width             (CORRIDOR, default 0.16)
 *   gap       channel centre 0..1                 (CORRIDOR, default 0.5)
 *   axis      "VERTICAL" | "HORIZONTAL"           (CORRIDOR / CURVE_S)
 *   points    [[x,y], ...] explicit path          (POLYLINE)
 *   segments  zig-zag segment count 2..5          (ZIGZAG, default 3)
 *   amplitude sine amplitude 0.1..0.45            (SNAKE / CURVE_S, default 0.28)
 *
 * ANTICIPATION: the ghost path lights up and the origin edge charges.
 * ACTION:       the chain whips along the path, head bright, links trailing.
 * IMPACT:       a heavy kick along the travel direction.
 */

import { BaseMechanic, type MechanicPhase, type MechanicSpawnContext } from '../../core/Mechanic';
import type { Rect, Shape } from '../../core/geometry';
import { clamp, lerp, makeRng } from '../../core/geometry';
import { ensureWarningFloor } from '../../core/fairness';
import type { Renderer } from '../../core/Renderer';
import { easeOutExpo } from '../../feel/Easing';
import { ARENA_CENTRE } from './polar';
import { buildChainPaths, PATH_FAMILIES, type ChainPathSpec, type PathFamily } from './chainPaths';

export const CHAIN_DIRECTIONS = ['LEFT_TO_RIGHT', 'RIGHT_TO_LEFT', 'TOP_TO_BOTTOM', 'BOTTOM_TO_TOP'] as const;
export type ChainDirection = (typeof CHAIN_DIRECTIONS)[number];

const LINE_LAYOUTS = ['SLASH', 'BACKSLASH', 'CROSS', 'ZIGZAG', 'SNAKE', 'CORRIDOR', 'POLYLINE'] as const;
const LAYOUTS = ['LANE', ...LINE_LAYOUTS, ...PATH_FAMILIES] as const;
type ChainLayout = (typeof LAYOUTS)[number];

const ARROW: Record<ChainDirection, string> = {
  LEFT_TO_RIGHT: '→',
  RIGHT_TO_LEFT: '←',
  TOP_TO_BOTTOM: '↓',
  BOTTOM_TO_TOP: '↑',
};

/**
 * Lanes must TILE the arena.
 *
 * The first version used a fixed band thickness (0.13) on lane centres spaced
 * 0.25 apart, which left uncovered strips between lanes -- 19% of the field,
 * including dead centre and all four edges, was safe from every chain forever.
 * A chain now claims whole lanes, so wherever the player stands some lane
 * covers them and standing still is never an answer.
 */
const DEFAULT_LANE_COUNT = 4;
/** Hard cap on collision links per mechanic, for the shape test budget. */
const MAX_LINKS = 240;

export class ChainMechanic extends BaseMechanic {
  private readonly layout: ChainLayout;
  private readonly direction: ChainDirection;
  /** Start of the claimed band, 0..1 -- LANE only. */
  private readonly laneStart: number;
  private readonly thickness: number;
  /** How long the whip takes to reach the far end, in beats. */
  private readonly extendBeats: number;
  /** Line- and path-layout polylines, in unrotated field space. */
  private readonly paths: ChainPathSpec[] = [];
  /** Corridor safe channel, CORRIDOR only. */
  private readonly corridor: { centre: number; width: number; vertical: boolean } | null = null;
  /** Link radius, line + path layouts only. */
  private readonly linkRadius: number;
  /** Precomputed link positions along each path, oldest first. */
  private readonly links: Array<Array<{ x: number; y: number; t: number }>> = [];

  constructor(spawn: MechanicSpawnContext) {
    super(spawn);
    const requested = String(this.params.direction ?? 'LEFT_TO_RIGHT').toUpperCase();
    this.direction = (CHAIN_DIRECTIONS as readonly string[]).includes(requested)
      ? (requested as ChainDirection)
      : 'LEFT_TO_RIGHT';
    const layoutParam = String(this.params.layout ?? 'LANE').toUpperCase();
    this.layout = (LAYOUTS as readonly string[]).includes(layoutParam)
      ? (layoutParam as ChainLayout)
      : 'LANE';

    const laneCount = Math.max(2, Math.round(numberOr(this.params.laneCount, DEFAULT_LANE_COUNT)));
    // `width` is now measured in lanes. One lane is the default; the arena is
    // never fully covered, so there is always somewhere to go.
    const span = clamp(Math.round(numberOr(this.params.width, 1)), 1, laneCount - 1);
    this.thickness = span / laneCount;
    const explicitLane = this.params.lane;
    const laneIndex = typeof explicitLane === 'number'
      ? clamp(Math.round(explicitLane), 0, laneCount - span)
      : Math.floor(makeRng(this.seed)() * (laneCount - span + 1));
    this.laneStart = laneIndex / laneCount;

    this.linkRadius = clamp(numberOr(this.params.thickness, 0.016) / 2, 0.005, 0.015);

    // Layout geometry -------------------------------------------------------
    // Path families are generated; the hand-placed layouts below are unchanged.
    if ((PATH_FAMILIES as readonly string[]).includes(this.layout)) {
      this.paths.push(...buildChainPaths({
        family: this.layout as PathFamily,
        params: this.params,
        seed: this.seed,
        secondsPerBeat: Math.max(0.01, this.spawn.clock.secondsPerBeat),
      }));
    }
    if (this.layout === 'SLASH') this.paths.push({ points: [{ x: 0, y: 0 }, { x: 1, y: 1 }], rotationPerBeat: 0 });
    if (this.layout === 'BACKSLASH') this.paths.push({ points: [{ x: 1, y: 0 }, { x: 0, y: 1 }], rotationPerBeat: 0 });
    if (this.layout === 'CROSS') {
      this.paths.push({ points: [{ x: 0, y: 0 }, { x: 1, y: 1 }], rotationPerBeat: 0 });
      this.paths.push({ points: [{ x: 1, y: 0 }, { x: 0, y: 1 }], rotationPerBeat: 0 });
    }
    if (this.layout === 'ZIGZAG') {
      const segments = clamp(Math.round(numberOr(this.params.segments, 3)), 2, 5);
      const points: Array<{ x: number; y: number }> = [];
      for (let k = 0; k <= segments; k++) {
        points.push({ x: k / segments, y: k % 2 === 0 ? 0.28 : 0.72 });
      }
      this.paths.push({ points, rotationPerBeat: 0 });
    }
    if (this.layout === 'SNAKE') {
      const amplitude = clamp(numberOr(this.params.amplitude, 0.28), 0.1, 0.45);
      const segments = 6;
      const points: Array<{ x: number; y: number }> = [];
      for (let k = 0; k <= segments; k++) {
        const x = k / segments;
        points.push({ x, y: 0.5 + Math.sin(x * Math.PI * 2) * amplitude });
      }
      this.paths.push({ points, rotationPerBeat: 0 });
    }
    if (this.layout === 'POLYLINE') {
      const raw = Array.isArray(this.params.points) ? this.params.points : null;
      if (Array.isArray(raw) && raw.length >= 2
        && raw.every((p) => Array.isArray(p) && p.length >= 2
          && typeof p[0] === 'number' && typeof p[1] === 'number')) {
        this.paths.push({
          points: (raw as Array<[number, number]>).map(([x, y]) => ({ x: clamp(x, 0, 1), y: clamp(y, 0, 1) })),
          rotationPerBeat: 0,
        });
      } else {
        this.paths.push({ points: [{ x: 0.5, y: 0 }, { x: 0.5, y: 1 }], rotationPerBeat: 0 });
      }
    }
    if (this.layout === 'CORRIDOR') {
      const vertical = String(this.params.axis ?? 'VERTICAL').toUpperCase() !== 'HORIZONTAL';
      const centre = clamp(numberOr(this.params.gap, 0.5), 0.1, 0.9);
      const width = clamp(numberOr(this.params.corridorWidth, 0.16), 0.07, 0.4);
      this.corridor = { centre, width, vertical };
      // Two parallel chains draw the channel: the walls are the danger, the
      // strip between them is the only safe place to be.
      const half = width / 2;
      if (vertical) {
        this.paths.push({ points: [{ x: centre - half, y: 0 }, { x: centre - half, y: 1 }], rotationPerBeat: 0 });
        this.paths.push({ points: [{ x: centre + half, y: 0 }, { x: centre + half, y: 1 }], rotationPerBeat: 0 });
      } else {
        this.paths.push({ points: [{ x: 0, y: centre - half }, { x: 1, y: centre - half }], rotationPerBeat: 0 });
        this.paths.push({ points: [{ x: 0, y: centre + half }, { x: 1, y: centre + half }], rotationPerBeat: 0 });
      }
    }
    if (this.layout === 'LANE') {
      this.corridor = null;
    }

    // Link positions along each line path ------------------------------------
    for (const path of this.paths) {
      const along: Array<{ x: number; y: number; t: number }> = [];
      let total = 0;
      for (let i = 0; i < path.points.length - 1; i++) {
        total += Math.hypot(path.points[i + 1].x - path.points[i].x, path.points[i + 1].y - path.points[i].y);
      }
      // Overlapping links read as a continuous chain and leave no slits.
      let spacing = this.linkRadius * 1.9;
      if (total / spacing > MAX_LINKS / Math.max(1, this.paths.length)) {
        spacing = total / (MAX_LINKS / Math.max(1, this.paths.length));
      }
      let walked = 0;
      for (let i = 0; i < path.points.length - 1 && along.length < MAX_LINKS; i++) {
        const a = path.points[i];
        const b = path.points[i + 1];
        const segLen = Math.hypot(b.x - a.x, b.y - a.y);
        const steps = Math.max(1, Math.ceil(segLen / Math.max(1e-4, spacing)));
        for (let s = 0; s < steps; s++) {
          const u = s / steps;
          along.push({ x: a.x + (b.x - a.x) * u, y: a.y + (b.y - a.y) * u, t: (walked + u * segLen) / Math.max(0.0001, total) });
        }
        walked += segLen;
      }
      this.links.push(along);
    }

    // Timing -----------------------------------------------------------------
    // Intensity cannot thicken the band without breaking the tiling, so it
    // sharpens the whip instead: the same lane, arriving faster.
    const sweep = this.timing.durationBeats * lerp(0.45, 0.28, this.intensity);
    const legacy = Math.max(0.12, Math.min(0.4, sweep));
    // Fairness: the telegraph plus the whip's travel is the total warning, and
    // it may never drop below the comfort floor. At fast tempos that stretches
    // the travel; the tier scaling has already stretched the active window.
    const spb = Math.max(0.01, this.spawn.clock.secondsPerBeat);
    this.extendBeats = ensureWarningFloor(this.timing.telegraphBeats, legacy, spb);
  }

  /** 0..1 along the whip's travel. */
  private extend(beat: number): number {
    return clamp((beat - this.activationBeat) / this.extendBeats, 0, 1);
  }

  private travelForward(): boolean {
    return String(this.params.travel ?? 'FORWARD').toUpperCase() !== 'BACKWARD';
  }

  /**
   * How far the whole path has turned, in radians.
   *
   * A rotating chain turns rigidly -- revealed links rotate with the head --
   * which is what makes it read as a fan made of joints rather than as a trail
   * being painted on the floor. The rate was already clamped to the player's
   * speed in `chainPaths`, against the path's own reach.
   */
  private rotationAt(beat: number, pathIndex: number): number {
    const perBeat = this.paths[pathIndex]?.rotationPerBeat ?? 0;
    if (perBeat === 0) return 0;
    return perBeat * (beat - this.activationBeat);
  }

  /** Rotate a point about the arena centre. */
  private spin(p: { x: number; y: number }, angle: number): { x: number; y: number } {
    if (angle === 0) return p;
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const dx = p.x - ARENA_CENTRE.x;
    const dy = p.y - ARENA_CENTRE.y;
    return { x: ARENA_CENTRE.x + dx * cos - dy * sin, y: ARENA_CENTRE.y + dx * sin + dy * cos };
  }

  /** The full corridor the chain will occupy once fully extended -- LANE. */
  private laneRect(): Rect {
    const t = this.thickness;
    return this.direction === 'LEFT_TO_RIGHT' || this.direction === 'RIGHT_TO_LEFT'
      ? { x: 0, y: this.laneStart, w: 1, h: t }
      : { x: this.laneStart, y: 0, w: t, h: 1 };
  }

  /** The portion currently swept, growing from the origin edge -- LANE. */
  private sweptRect(beat: number): Rect {
    const lane = this.laneRect();
    const extend = this.extend(beat);
    switch (this.direction) {
      case 'LEFT_TO_RIGHT': return { ...lane, w: extend };
      case 'RIGHT_TO_LEFT': return { ...lane, x: 1 - extend, w: extend };
      case 'TOP_TO_BOTTOM': return { ...lane, h: extend };
      case 'BOTTOM_TO_TOP': return { ...lane, y: 1 - extend, h: extend };
    }
  }

  protected override onPhaseChange(_from: MechanicPhase, to: MechanicPhase): void {
    if (to === 'TELEGRAPH') {
      this.feel.sfx('chain_rattle');
      return;
    }
    if (to === 'ACTIVE') {
      const dir = this.travelVector();
      const centre = this.impactCentre();
      this.feel.impact('HEAVY', {
        x: centre.x, y: centre.y, dirX: dir.x, dirY: dir.y, colour: '#a68bff', sfx: 'chain_whip',
      });
      this.feel.emit(
        centre.x, centre.y,
        { count: 18, speed: 1.4, colour: '#d8ccff', size: 0.008, shape: 'spark',
          direction: Math.atan2(dir.y, dir.x), spread: Math.PI * 0.5, life: 0.35 },
      );
      return;
    }
    if (to === 'RECOVERY') this.feel.sfx('chain_impact', 0.5);
  }

  private impactCentre(): { x: number; y: number } {
    if (this.layout === 'LANE') {
      const lane = this.laneRect();
      return { x: lane.x + lane.w / 2, y: lane.y + lane.h / 2 };
    }
    const pts = this.paths[0]?.points ?? [{ x: 0.5, y: 0.5 }];
    return { x: pts[0].x, y: pts[0].y };
  }

  private travelVector(): { x: number; y: number } {
    if (this.layout === 'LANE') {
      switch (this.direction) {
        case 'LEFT_TO_RIGHT': return { x: 1, y: 0 };
        case 'RIGHT_TO_LEFT': return { x: -1, y: 0 };
        case 'TOP_TO_BOTTOM': return { x: 0, y: 1 };
        case 'BOTTOM_TO_TOP': return { x: 0, y: -1 };
      }
    }
    const pts = this.paths[0]?.points;
    if (pts && pts.length >= 2) {
      const a = this.travelForward() ? pts[0] : pts[pts.length - 1];
      const b = this.travelForward() ? pts[pts.length - 1] : pts[0];
      const len = Math.max(0.0001, Math.hypot(b.x - a.x, b.y - a.y));
      return { x: (b.x - a.x) / len, y: (b.y - a.y) / len };
    }
    return { x: 0, y: 0 };
  }

  protected dangerShapes(): Shape[] {
    if (this.layout === 'LANE') {
      return [{ kind: 'rect', ...this.sweptRect(this.spawn.clock.absoluteBeat) }];
    }
    const beat = this.spawn.clock.absoluteBeat;
    const extend = this.extend(beat);
    const shapes: Shape[] = [];
    for (let i = 0; i < this.links.length; i++) {
      const angle = this.rotationAt(beat, i);
      for (const link of this.links[i]) {
        const t = this.travelForward() ? link.t : 1 - link.t;
        if (t > extend) break;
        const p = this.spin(link, angle);
        shapes.push({ kind: 'circle', x: p.x, y: p.y, r: this.linkRadius });
      }
    }
    return shapes;
  }

  render(r: Renderer): void {
    const beat = this.spawn.clock.visualBeat;

    if (this.phase === 'TELEGRAPH') {
      const p = this.telegraphProgress(beat);
      if (this.layout === 'LANE') {
        const lane = this.laneRect();
        // The whole claimed lane lights up, so "leave this strip" is the reading.
        r.fillRect(lane, '#8c6bff', 0.12 + 0.3 * p * p);
        r.strokeRect(lane, '#b9a4ff', 3, 0.5 + 0.45 * p, [12, 7]);
        this.renderIncomingEdge(r, lane, p);
        this.renderArrows(r, lane, 0.45 + 0.55 * p);
        return;
      }
      // Ghost the full path and charge the origin.
      for (let i = 0; i < this.paths.length; i++) {
        const path = this.paths[i];
        const angle = this.rotationAt(this.activationBeat, i);
        r.polyline(path.points.map((pt) => this.spin(pt, angle)), '#8c6bff', 2, 0.15 + 0.35 * p);
      }
      if (this.corridor) this.renderCorridorMarkers(r, p);
      const first = this.paths[0]?.points;
      const originRaw = first ? (this.travelForward() ? first[0] : first[first.length - 1]) : undefined;
      if (originRaw) {
        const origin = this.spin(originRaw, this.rotationAt(this.activationBeat, 0));
        r.glow(origin.x, origin.y, 0.045 + 0.05 * p, '#d8ccff', 0.3 + 0.5 * p);
        r.fillCircle(origin.x, origin.y, 0.012 + 0.018 * p, '#d8ccff', 0.5 + 0.5 * p);
      }
      return;
    }

    if (this.phase === 'ACTIVE') {
      if (this.layout === 'LANE') {
        const lane = this.laneRect();
        const swept = this.sweptRect(beat);
        r.fillRect(lane, '#3b2e6b', 0.3);
        r.fillRect(swept, '#a68bff', 0.95);
        this.renderLinks(r, swept, beat);
        // Bright head at the leading edge sells the whip direction.
        this.renderHead(r, swept);
        return;
      }
      const extend = this.extend(beat);
      const settle = easeOutExpo(Math.min(1, (beat - this.activationBeat) / 0.35));
      for (let i = 0; i < this.links.length; i++) {
        const angle = this.rotationAt(beat, i);
        for (const link of this.links[i]) {
          const t = this.travelForward() ? link.t : 1 - link.t;
          if (t > extend) break;
          const wobble = (1 - settle) * 0.01 * Math.sin(link.t * 14 + beat * 22);
          const p = this.spin({ x: link.x, y: link.y + wobble }, angle);
          r.fillCircle(p.x, p.y, this.linkRadius, '#a68bff', 0.95);
        }
      }
      // Bright head at the leading end.
      const head = this.headPosition(extend, beat);
      if (head) {
        r.glow(head.x, head.y, 0.035, '#ffffff', 0.5);
        r.fillCircle(head.x, head.y, this.linkRadius * 1.4, '#ffffff', 0.95);
      }
      return;
    }

    if (this.phase === 'RECOVERY') {
      const span = Math.max(0.0001, this.recoveryEndBeat - this.activeEndBeat);
      const fade = clamp(1 - (beat - this.activeEndBeat) / span, 0, 1);
      if (this.layout === 'LANE') {
        const lane = this.laneRect();
        r.fillRect(lane, '#6a58b5', 0.35 * fade);
      } else {
        for (let i = 0; i < this.links.length; i++) {
          const angle = this.rotationAt(this.activeEndBeat, i);
          for (const link of this.links[i]) {
            const p = this.spin(link, angle);
            r.fillCircle(p.x, p.y, this.linkRadius, '#6a58b5', 0.35 * fade);
          }
        }
      }
    }
  }

  /** The chain head's position at travel `extend`. */
  private headPosition(extend: number, beat: number): { x: number; y: number } | null {
    const path = this.paths[0];
    if (!path || path.points.length < 2) return null;
    // Walk the polyline to the travelled distance.
    let total = 0;
    for (let i = 0; i < path.points.length - 1; i++) {
      total += Math.hypot(path.points[i + 1].x - path.points[i].x, path.points[i + 1].y - path.points[i].y);
    }
    let walked = 0;
    const pts = this.travelForward() ? path.points : [...path.points].reverse();
    const angle = this.rotationAt(beat, 0);
    for (let i = 0; i < pts.length - 1; i++) {
      const seg = Math.hypot(pts[i + 1].x - pts[i].x, pts[i + 1].y - pts[i].y);
      const target = extend * total;
      if (walked + seg >= target || i === pts.length - 2) {
        const u = seg <= 0 ? 1 : clamp((target - walked) / seg, 0, 1);
        return this.spin({
          x: pts[i].x + (pts[i + 1].x - pts[i].x) * u,
          y: pts[i].y + (pts[i + 1].y - pts[i].y) * u,
        }, angle);
      }
      walked += seg;
    }
    return this.spin(pts[0], angle);
  }

  /** The safe channel, drawn positively during CORRIDOR telegraphs. */
  private renderCorridorMarkers(r: Renderer, progress: number): void {
    const { centre, width, vertical } = this.corridor!;
    const half = width / 2;
    if (vertical) {
      r.fillRect({ x: centre - half, y: 0, w: width, h: 1 }, '#7dffb0', 0.06 + 0.1 * progress);
      r.line(centre - half, 0.2, centre - half, 0.8, '#7dffb0', 2, 0.25 + 0.4 * progress, [4, 4]);
      r.line(centre + half, 0.2, centre + half, 0.8, '#7dffb0', 2, 0.25 + 0.4 * progress, [4, 4]);
    } else {
      r.fillRect({ x: 0, y: centre - half, w: 1, h: width }, '#7dffb0', 0.06 + 0.1 * progress);
      r.line(0.2, centre - half, 0.8, centre - half, '#7dffb0', 2, 0.25 + 0.4 * progress, [4, 4]);
      r.line(0.2, centre + half, 0.8, centre + half, '#7dffb0', 2, 0.25 + 0.4 * progress, [4, 4]);
    }
  }

  /**
   * Chain links along the swept body, each lagging the head slightly, so the
   * whip reads as a jointed object rather than a growing rectangle -- LANE.
   */
  private renderLinks(r: Renderer, swept: Rect, beat: number): void {
    const horizontal = this.direction === 'LEFT_TO_RIGHT' || this.direction === 'RIGHT_TO_LEFT';
    const along = horizontal ? swept.w : swept.h;
    const links = Math.max(2, Math.floor(along / 0.05));
    const settle = easeOutExpo(Math.min(1, (beat - this.activationBeat) / 0.35));
    for (let i = 0; i < links; i++) {
      const t = (i + 0.5) / links;
      // Segment delay: links near the tail are still catching up.
      const wobble = (1 - settle) * 0.012 * Math.sin(i * 1.7 + beat * 22);
      const cx = horizontal
        ? (this.direction === 'RIGHT_TO_LEFT' ? swept.x + swept.w * (1 - t) : swept.x + swept.w * t)
        : swept.x + swept.w / 2 + wobble;
      const cy = horizontal
        ? swept.y + swept.h / 2 + wobble
        : (this.direction === 'BOTTOM_TO_TOP' ? swept.y + swept.h * (1 - t) : swept.y + swept.h * t);
      r.strokeCircle(cx, cy, this.thickness * 0.22, '#e6dcff', 2, 0.35);
    }
  }

  private renderHead(r: Renderer, swept: Rect): void {
    switch (this.direction) {
      case 'LEFT_TO_RIGHT': r.line(swept.x + swept.w, swept.y, swept.x + swept.w, swept.y + swept.h, '#ffffff', 3, 0.9); break;
      case 'RIGHT_TO_LEFT': r.line(swept.x, swept.y, swept.x, swept.y + swept.h, '#ffffff', 3, 0.9); break;
      case 'TOP_TO_BOTTOM': r.line(swept.x, swept.y + swept.h, swept.x + swept.w, swept.y + swept.h, '#ffffff', 3, 0.9); break;
      case 'BOTTOM_TO_TOP': r.line(swept.x, swept.y, swept.x + swept.w, swept.y, '#ffffff', 3, 0.9); break;
    }
  }

  /** Arrows repeated along the lane, so the travel direction reads from anywhere. */
  private renderArrows(r: Renderer, lane: Rect, alpha: number): void {
    const glyph = ARROW[this.direction];
    const horizontal = this.direction === 'LEFT_TO_RIGHT' || this.direction === 'RIGHT_TO_LEFT';
    const steps = 5;
    for (let i = 0; i < steps; i++) {
      const t = (i + 0.5) / steps;
      const x = horizontal ? t : lane.x + lane.w / 2;
      const y = horizontal ? lane.y + lane.h / 2 : t;
      r.text(glyph, x, y, '#d8ccff', 20, 'center', alpha);
    }
  }

  /** A bright sliver at the origin edge, growing as the strike approaches. */
  private renderIncomingEdge(r: Renderer, lane: Rect, progress: number): void {
    const depth = 0.03 + 0.05 * progress;
    const edge: Rect =
      this.direction === 'LEFT_TO_RIGHT' ? { ...lane, w: depth }
      : this.direction === 'RIGHT_TO_LEFT' ? { ...lane, x: 1 - depth, w: depth }
      : this.direction === 'TOP_TO_BOTTOM' ? { ...lane, h: depth }
      : { ...lane, y: 1 - depth, h: depth };
    r.fillRect(edge, '#d8ccff', 0.3 + 0.5 * progress);
  }
}

function numberOr(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

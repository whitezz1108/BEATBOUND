/**
 * A02 -- Safe Tile (ARENA).
 *
 * The inverse of A01: the whole floor becomes dangerous *except* a small safe
 * patch. The telegraph shows where to stand rather than where not to.
 *
 * Three safe-zone forms, and the default is the original one, so every existing
 * pattern is untouched:
 *
 *   STATIC    the patch is placed once, from the event seed, and stays put. The
 *             question is "can you get there", and the answer never changes.
 *   MOVING    the patch travels a closed path as a pure function of the beat. The
 *             question becomes "can you keep up", which is a different verb --
 *             the player is tracking a target rather than reading a position.
 *   QUADRANT  the arena is halved or quartered and the safe part *rotates* on a
 *             beat grid. Coarse and rhythmic: the player crosses from one part to
 *             the next on the pulse rather than steering continuously.
 *
 * Fairness for the advanced forms is the same geometry the rest of the arena
 * uses. A moving patch may not travel faster than the player (`maxGapShiftPerBeat`
 * is the clamp, so the target can never outrun its pursuer), and a rotating one
 * owes a full walk to the next safe part before that part becomes the only
 * option -- `minimumWarningBeats` on the crossing distance, which is why a
 * quadrant rotation is several beats per step rather than one.
 *
 * Params:
 *   safeAreaCount  how many safe patches          default 1
 *   safeAreaSize   patch side length, 0..1        default 0.25
 *   safeAreas      explicit [[x, y], ...] centres (overrides the above)
 *   safeZone       "STATIC" | "MOVING" | "QUADRANT"  default "STATIC"
 *   movePath       "CIRCLE" | "LINE_X" | "LINE_Y"    (MOVING, default CIRCLE)
 *   moveRadius     how far the patch travels      (MOVING, default 0.24)
 *   moveSpeed      laps per second                (MOVING, default 0.25)
 *   moveStartDeg   where the path starts          (MOVING, default -90)
 *   quadrantCount  2 or 4 safe parts              (QUADRANT, default 4)
 *   quadrantBeats  beats each part stays safe     (QUADRANT, default 4)
 *   quadrantDirection "CW" | "CCW"                (QUADRANT, default CW)
 */

import { BaseMechanic, type MechanicPhase, type MechanicSpawnContext } from '../../core/Mechanic';
import type { Rect, Shape } from '../../core/geometry';
import { clamp, lerp, makeRng } from '../../core/geometry';
import { maxGapShiftPerBeat, minimumWarningBeats } from '../../core/fairness';
import type { Renderer } from '../../core/Renderer';
import { ARENA_CENTRE, degToRad } from './polar';
import { slowed } from './arenaTiming';

/** The player is ~0.064 wide; a patch must comfortably contain them. */
const MIN_SAFE_SIZE = 0.16;
/** How finely the dangerous complement is diced before merging into strips. */
const GRID = 12;

export type SafeZoneForm = 'STATIC' | 'MOVING' | 'QUADRANT';
const FORMS: SafeZoneForm[] = ['STATIC', 'MOVING', 'QUADRANT'];

type MovePath = 'CIRCLE' | 'LINE_X' | 'LINE_Y';

export class SafeTileMechanic extends BaseMechanic {
  private readonly form: SafeZoneForm;
  private readonly size: number;
  /** STATIC only: the placed patches. The advanced forms compute theirs. */
  private readonly staticAreas: Rect[];
  /** STATIC only: the danger complement, precomputed once. */
  private readonly staticDanger: Rect[];

  private readonly movePath: MovePath;
  private readonly moveRadius: number;
  private readonly moveBeatsPerLap: number;
  private readonly moveStart: number;

  private readonly quadrants: number;
  private readonly quadrantBeats: number;
  private readonly quadrantDir: number;
  private readonly startQuadrant: number;

  constructor(spawn: MechanicSpawnContext) {
    super(slowed(spawn));

    const formName = String(this.params.safeZone ?? 'STATIC').toUpperCase();
    this.form = (FORMS as string[]).includes(formName) ? (formName as SafeZoneForm) : 'STATIC';

    // Intensity shrinks the refuge, but never below a size the player fits in.
    this.size = clamp(
      numberOr(this.params.safeAreaSize, 0.25) * lerp(1, 0.75, this.intensity),
      MIN_SAFE_SIZE,
      1,
    );

    const spb = Math.max(0.01, this.spawn.clock.secondsPerBeat);

    // MOVING. The patch is a target, not a hazard, so the floor is the player's
    // own speed: at the outer end of its path the patch may not cover more
    // ground per beat than the player can, or "keep up" becomes "lose".
    const pathName = String(this.params.movePath ?? 'CIRCLE').toUpperCase();
    this.movePath = (['CIRCLE', 'LINE_X', 'LINE_Y'] as string[]).includes(pathName)
      ? (pathName as MovePath)
      : 'CIRCLE';
    const requestedRadius = clamp(numberOr(this.params.moveRadius, 0.24), 0, 0.4);
    // Only a CIRCLE's radius is a *rate* limit; a line's is a distance limit and
    // is already bounded by the field. Clamping the circle keeps the patch's
    // angular speed inside the player's.
    const lapSeconds = 1 / Math.max(0.02, numberOr(this.params.moveSpeed, 0.25));
    const budget = maxGapShiftPerBeat(spb) * lapSeconds / (Math.PI * 2);
    this.moveRadius = this.movePath === 'CIRCLE' ? Math.min(requestedRadius, budget) : requestedRadius;
    // A lap is floored at four beats so the patch can never become the hard part
    // of the read -- the same floor the moving emitters use.
    this.moveBeatsPerLap = Math.max(4, lapSeconds / spb);
    this.moveStart = degToRad(numberOr(this.params.moveStartDeg, -90));

    // QUADRANT. `quadrantBeats` is floored against the crossing itself: the
    // player has to walk from the middle of one safe part to the middle of the
    // next, which is half the field for a rotation, plus the worst-case offset
    // inside the part they are leaving.
    this.quadrants = clamp(Math.round(numberOr(this.params.quadrantCount, 4)) === 2 ? 2 : 4, 2, 4);
    this.quadrantDir = String(this.params.quadrantDirection ?? 'CW').toUpperCase() === 'CCW' ? -1 : 1;
    this.startQuadrant = 0;
    const crossing = this.quadrants === 4 ? 0.5 * Math.SQRT2 : 0.5;
    const needed = minimumWarningBeats(crossing + 0.25, spb);
    this.quadrantBeats = Math.max(numberOr(this.params.quadrantBeats, 4), needed);
    if (this.form === 'QUADRANT') {
      // The opening part has to be reachable from wherever the player is
      // standing, which is a full crossing at worst -- so the telegraph owes
      // that walk, exactly as a ring's does.
      const approach = minimumWarningBeats(1, spb);
      if (approach > this.timing.telegraphBeats) {
        (this.timing as { telegraphBeats: number }).telegraphBeats = approach;
      }
      // One lap of the arena's parts, so every part gets its turn.
      (this.timing as { durationBeats: number }).durationBeats =
        Math.max(this.timing.durationBeats, this.quadrantBeats * this.quadrants);
    }

    this.staticAreas = this.form === 'STATIC' ? this.buildStaticAreas() : [];
    this.staticDanger = this.form === 'STATIC' ? buildDanger(this.staticAreas) : [];
  }

  private buildStaticAreas(): Rect[] {
    const explicit = this.params.safeAreas;
    if (Array.isArray(explicit)) {
      return explicit
        .filter((c): c is [number, number] => Array.isArray(c) && c.length >= 2)
        .map(([cx, cy]) => centred(Number(cx), Number(cy), this.size));
    }

    const count = Math.max(1, Math.round(numberOr(this.params.safeAreaCount, 1)));
    const rng = makeRng(this.seed);
    const areas: Rect[] = [];
    for (let i = 0; i < count; i++) {
      // Deterministic placement, kept clear of the field edges.
      const cx = lerp(this.size / 2, 1 - this.size / 2, rng());
      const cy = lerp(this.size / 2, 1 - this.size / 2, rng());
      areas.push(centred(cx, cy, this.size));
    }
    return areas;
  }

  // ---- the safe zone, at a beat ------------------------------------------

  /**
   * Where the refuge is at `beat`.
   *
   * A pure function of the beat in all three forms, so a replay is identical and
   * the telegraph can preview a later position by asking this rather than by
   * duplicating the motion.
   */
  private safeAreasAt(beat: number): Rect[] {
    if (this.form === 'STATIC') return this.staticAreas;

    if (this.form === 'MOVING') {
      const turns = (beat - this.activationBeat) / this.moveBeatsPerLap;
      const t = this.moveStart + turns * Math.PI * 2;
      const cx = this.movePath === 'LINE_Y' ? ARENA_CENTRE.x : ARENA_CENTRE.x + Math.cos(t) * this.moveRadius;
      const cy = this.movePath === 'LINE_X' ? ARENA_CENTRE.y : ARENA_CENTRE.y + Math.sin(t) * this.moveRadius;
      // `centred` clamps the patch whole inside the field, so a path that would
      // run off an edge flattens against it instead of half-leaving.
      return [centred(cx, cy, this.size)];
    }

    return [this.quadrantRect(this.safeQuadrantAt(beat))];
  }

  /** Index of the safe part at `beat`, or -1 outside the sequence. */
  private safeQuadrantAt(beat: number): number {
    const index = Math.floor((beat - this.activationBeat) / this.quadrantBeats);
    if (index < 0 || index >= this.quadrants) return -1;
    return (((this.startQuadrant + index * this.quadrantDir) % this.quadrants) + this.quadrants) % this.quadrants;
  }

  private quadrantRect(index: number): Rect {
    if (index < 0) return { x: 0, y: 0, w: 0, h: 0 };
    return this.quadrants === 4
      ? { x: (index % 2) * 0.5, y: Math.floor(index / 2) * 0.5, w: 0.5, h: 0.5 }
      : { x: index * 0.5, y: 0, w: 0.5, h: 1 };
  }

  // ---- lifecycle ---------------------------------------------------------

  protected override onPhaseChange(_from: MechanicPhase, to: MechanicPhase): void {
    if (to === 'TELEGRAPH') {
      this.feel.sfx('floor_warning');
      return;
    }
    if (to !== 'ACTIVE') return;
    this.feel.impact('MEDIUM', { colour: '#ff2547', sfx: 'floor_impact', shockwave: false });
    // Ring each refuge so the eye is pulled to safety, not to the danger.
    for (const a of this.safeAreasAt(this.activationBeat)) {
      this.feel.shockwave(a.x + a.w / 2, a.y + a.h / 2, a.w * 1.6, '#4dffa6', 0.35, 2);
    }
  }

  private lastStep = -1;

  protected override onUpdate(u: { beat: number }): void {
    if (this.phase !== 'ACTIVE' || this.form !== 'QUADRANT') return;
    const index = Math.floor((u.beat - this.activationBeat) / this.quadrantBeats);
    if (index !== this.lastStep && index >= 0 && index < this.quadrants) {
      this.lastStep = index;
      this.feel.sfx('floor_warning', 0.35);
    }
  }

  protected dangerShapes(): Shape[] {
    if (this.form === 'STATIC') return this.staticDanger.map((rect) => ({ kind: 'rect' as const, ...rect }));
    return buildDanger(this.safeAreasAt(this.spawn.clock.absoluteBeat))
      .map((rect) => ({ kind: 'rect' as const, ...rect }));
  }

  // ---- presentation ------------------------------------------------------

  render(r: Renderer): void {
    const beat = this.spawn.clock.visualBeat;
    const areas = this.safeAreasAt(beat);
    const danger = this.form === 'STATIC' ? this.staticDanger : buildDanger(areas);

    if (this.phase === 'TELEGRAPH') {
      const p = this.telegraphProgress(beat);
      for (const strip of danger) r.fillRect(strip, '#ff4d6d', 0.06 + 0.2 * p * p);
      for (const area of areas) {
        r.fillRect(area, '#4dffa6', 0.10 + 0.14 * p);
        r.strokeRect(area, '#8affd0', 3, 0.5 + 0.5 * p, [8, 5]);
      }
      // Advanced forms move, so the telegraph has to show *where the refuge is
      // going*: the whole path for MOVING, the order of parts for QUADRANT. A
      // refuge that relocates without preview is the unreadable case.
      if (this.form === 'MOVING') this.renderPathPreview(r, p);
      if (this.form === 'QUADRANT') this.renderQuadrantPreview(r, p);
      return;
    }

    if (this.phase === 'ACTIVE') {
      for (const strip of danger) r.fillRect(strip, '#ff2547', 0.88);
      for (const area of areas) {
        r.fillRect(area, '#0d2018', 1);
        r.strokeRect(area, '#4dffa6', 3, 0.95);
      }
      // The next safe part, outlined while it is still safe to leave this one.
      if (this.form === 'QUADRANT') {
        const next = this.quadrantRect(this.safeQuadrantAt(beat + this.quadrantBeats));
        if (next.w > 0) r.strokeRect(next, '#8affd0', 3, 0.4, [10, 6]);
      }
      return;
    }

    if (this.phase === 'RECOVERY') {
      const span = Math.max(0.0001, this.recoveryEndBeat - this.activeEndBeat);
      const fade = clamp(1 - (beat - this.activeEndBeat) / span, 0, 1);
      for (const strip of danger) r.fillRect(strip, '#7a2038', 0.35 * fade);
    }
  }

  private renderPathPreview(r: Renderer, progress: number): void {
    const points: Array<{ x: number; y: number }> = [];
    const steps = 48;
    for (let i = 0; i <= steps; i++) {
      const at = this.safeAreasAt(this.activationBeat + (i / steps) * this.moveBeatsPerLap)[0];
      points.push({ x: at.x + at.w / 2, y: at.y + at.h / 2 });
    }
    r.polyline(points, '#8affd0', 1, 0.15 + 0.25 * progress);
  }

  private renderQuadrantPreview(r: Renderer, progress: number): void {
    for (let k = 0; k < this.quadrants; k++) {
      const index = (this.startQuadrant + k * this.quadrantDir + this.quadrants) % this.quadrants;
      const rect = this.quadrantRect(index);
      // The first part solid, the rest fading with their distance in the order,
      // so the rotation reads as a sequence rather than as a set.
      const alpha = (k === 0 ? 0.12 + 0.2 * progress : 0.08) / (k + 1);
      r.fillRect(rect, '#4dffa6', alpha);
      r.strokeRect(rect, k === 0 ? '#8affd0' : '#4dffa6', k === 0 ? 3 : 2, 0.4 + 0.4 * progress, [8, 5]);
    }
  }
}

/**
 * Everything outside the safe patches. Diced on a grid, then merged into
 * horizontal strips so collision walks a handful of rects, not 144 cells.
 *
 * Called per frame by the advanced forms -- 144 cell tests is nothing next to
 * the collision walk the strips save.
 */
function buildDanger(areas: Rect[]): Rect[] {
  const cell = 1 / GRID;
  const strips: Rect[] = [];
  const isSafe = (x: number, y: number): boolean => areas.some(
    (a) => x >= a.x - 1e-9 && y >= a.y - 1e-9 && x + cell <= a.x + a.w + 1e-9 && y + cell <= a.y + a.h + 1e-9,
  );
  for (let row = 0; row < GRID; row++) {
    let runStart = -1;
    for (let col = 0; col <= GRID; col++) {
      const inside = col < GRID && !isSafe(col * cell, row * cell);
      if (inside && runStart === -1) runStart = col;
      if (!inside && runStart !== -1) {
        strips.push({ x: runStart * cell, y: row * cell, w: (col - runStart) * cell, h: cell });
        runStart = -1;
      }
    }
  }
  return strips;
}

function centred(cx: number, cy: number, size: number): Rect {
  const x = clamp(cx, size / 2, 1 - size / 2) - size / 2;
  const y = clamp(cy, size / 2, 1 - size / 2) - size / 2;
  return { x, y, w: size, h: size };
}

function numberOr(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

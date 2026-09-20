/**
 * A08 -- Spiral (ARENA).
 *
 * An emitter whose angle advances a fixed step every subdivision, so the shots
 * lay down a spiral arm. Dense on screen, but the rule behind it is one line,
 * which is what keeps it readable at sixteenth-note rates.
 *
 * This is the CENTRE emitter of the arena's three projectile sources, and the
 * one that fires over time rather than in volleys -- so it is also where the
 * brief's four centre patterns live:
 *
 *   SPIRAL         one arm, angle advances every subdivision. The baseline.
 *   DOUBLE_SPIRAL  two arms winding opposite ways out of the same emitter. The
 *                  safe space is the narrow seam between the two winds, which
 *                  closes and reopens as they cross -- so it is a *moving* gap
 *                  rather than a static one, and the player rides it.
 *   FLOWER         arms in tight groups, each group rotated by a large step, so
 *                  the shots draw discrete petals instead of a continuous arm.
 *                  Reads as a repeating shape, not as a stream.
 *   PULSE          a whole ring at once, on the beat, each ring rotated from the
 *                  last. Concentric rather than continuous, so the player reads
 *                  rings arriving instead of a line being drawn.
 *
 * Params:
 *   pattern        "SPIRAL" | "DOUBLE_SPIRAL" | "FLOWER" | "PULSE"  default "SPIRAL"
 *   arms           simultaneous emitters                  default 2
 *   stepDeg        angle added per emission               default 26
 *   subdivision    beats between emissions                default 0.25
 *   direction      "CW" | "CCW" | "ALTERNATE"             default "CW"
 *   speed          travel-speed multiplier                default 0.9
 *   startAngleDeg  first emission angle                   default -90
 *   expand         true fires outward, false inward       default true
 *   shape          bullet silhouette, see bullets.ts      default "SPARK"
 *   petalArms      bullets per petal                      (FLOWER, default 5)
 *   petals         lobes around the circle                (FLOWER, default 6)
 */

import { BaseMechanic, type MechanicSpawnContext, type MechanicPhase } from '../../core/Mechanic';
import type { Shape } from '../../core/geometry';
import { clamp } from '../../core/geometry';
import { minimumAngularGap } from '../../core/fairness';
import { easeIn } from '../../feel/Easing';
import type { Renderer } from '../../core/Renderer';
import { TUNING } from '../../tuning';
import { ARENA_CENTRE, ARENA_OUTER_RADIUS, degToRad, polarToField } from './polar';
import { travelScale } from './arenaTiming';
import { bulletHitCircles, drawBullet, readShape, type BulletShape } from './bullets';

interface Shot {
  angle: number;
  /** Beat this shot left the emitter. */
  bornBeat: number;
  /** Signed winding rate of the arm that fired it, radians per emission. */
  wind: number;
}

export type EmitterPattern = 'SPIRAL' | 'DOUBLE_SPIRAL' | 'FLOWER' | 'PULSE';
const PATTERNS: EmitterPattern[] = ['SPIRAL', 'DOUBLE_SPIRAL', 'FLOWER', 'PULSE'];

const COLOUR = '#c08bff';
const EDGE = '#8f5fff';

/** Radius the angular-gap floor is measured at, for the PULSE ring. */
const REFERENCE_RADIUS = 0.32;

export class SpiralMechanic extends BaseMechanic {
  override readonly damageSource = 'PROJECTILE' as const;

  private readonly pattern: EmitterPattern;
  private readonly arms: number;
  private readonly stepAngle: number;
  private readonly subdivision: number;
  private readonly alternate: boolean;
  private readonly expand: boolean;
  private readonly travelBeats: number;
  private readonly startAngle: number;
  private readonly bulletRadius: number;
  private readonly bulletShape: BulletShape;
  /** FLOWER only: bullets per petal and lobes around the circle. */
  private readonly petalArms: number;
  private readonly petals: number;
  private shots: Shot[] = [];
  private emitted = 0;

  constructor(spawn: MechanicSpawnContext) {
    super(spawn);
    const patternName = String(this.params.pattern ?? 'SPIRAL').toUpperCase();
    this.pattern = (PATTERNS as string[]).includes(patternName)
      ? (patternName as EmitterPattern)
      : 'SPIRAL';

    const dir = String(this.params.direction ?? 'CW').toUpperCase();
    this.alternate = dir === 'ALTERNATE';
    const sign = dir === 'CCW' ? -1 : 1;
    this.stepAngle = degToRad(clamp(numberOr(this.params.stepDeg, 26), 4, 90)) * sign;
    this.subdivision = clamp(numberOr(this.params.subdivision, 0.25), 0.125, 1);
    this.expand = this.params.expand !== false;
    this.startAngle = degToRad(numberOr(this.params.startAngleDeg, -90));
    this.bulletRadius = TUNING.arena.projectileRadius * 0.75;
    this.bulletShape = readShape(this.params.shape, 'SPARK');

    // FLOWER fires in tight groups and jumps between them, so `arms` is the
    // group size rather than a stream count.
    this.petalArms = clamp(Math.round(numberOr(this.params.petalArms, 5)), 2, 8);
    this.petals = clamp(Math.round(numberOr(this.params.petals, 6)), 3, 12);

    // PULSE is the one pattern whose shots must fit the player *at the moment
    // they appear* -- a ring arriving all at once has no sweep to walk along, so
    // its spacing is a fairness floor rather than an authoring choice. The other
    // patterns lay down arms the player walks between, and their spacing comes
    // from `stepDeg` instead.
    const requestedArms = Math.round(numberOr(this.params.arms, 2));
    if (this.pattern === 'PULSE') {
      const minGap = minimumAngularGap(TUNING.arena.playerRadius, REFERENCE_RADIUS);
      const maxArms = Math.max(2, Math.floor((Math.PI * 2) / Math.max(1e-3, minGap)));
      this.arms = clamp(requestedArms, 2, Math.min(12, maxArms));
    } else {
      this.arms = clamp(requestedArms, 1, 4);
    }

    const speed = numberOr(this.params.speed, 0.9) * (1 + 0.2 * this.intensity);
    // Shots outlive the ACTIVE window on purpose -- isFinished waits for them.
    this.travelBeats = Math.max(0.75, (2.2 * travelScale(this.tier)) / Math.max(0.3, speed));
  }

  /** Beats between emissions, after the pattern's own pacing is applied. */
  private get emissionStep(): number {
    // PULSE emits on the beat by definition: that is what makes it read as
    // rings rather than as a spiral that happens to be sampled coarsely.
    return this.pattern === 'PULSE' ? 1 : this.subdivision;
  }

  /** How many bullets one emission produces. */
  private get emissionSize(): number {
    switch (this.pattern) {
      case 'PULSE': return this.arms;
      case 'FLOWER': return this.petalArms;
      default: return this.arms;
    }
  }

  /**
   * The angle offset of bullet `b` within emission `index`.
   *
   * The four patterns differ only here, which is the point: the emitter, the
   * timing and the collision code are shared, so a new centre pattern is a
   * handful of lines rather than a new mechanic.
   */
  private angleOf(index: number, b: number): number {
    const step = this.emissionStep;
    const flip = this.alternate && Math.floor(index * step) % 2 === 1 ? -1 : 1;
    const base = this.startAngle + this.stepAngle * index * flip;

    switch (this.pattern) {
      case 'PULSE':
        // A full ring: `arms` bullets evenly around the circle, the whole ring
        // rotated by one step per pulse.
        return base + (b * Math.PI * 2) / this.arms;
      case 'FLOWER':
        // Petals: a tight group of `petalArms` at the same angle, then the next
        // group a whole petal further around. The group spacing is what makes
        // the lobes read as lobes.
        return base + b * this.stepAngle * 0.35
          + (index % this.petals) * ((Math.PI * 2) / this.petals);
      case 'DOUBLE_SPIRAL':
        // Two winds from one emitter, one mirrored, so the seam between them
        // sweeps around the arena as they cross.
        return base + (b === 0 ? 0 : Math.PI) - this.stepAngle * index * (b === 0 ? 0 : 2) * flip;
      case 'SPIRAL':
      default:
        return base + (b * Math.PI * 2) / this.arms;
    }
  }

  /** The signed winding rate to record on a shot, for the telegraph's arrow. */
  private windOf(b: number): number {
    if (this.pattern === 'DOUBLE_SPIRAL') return b === 0 ? this.stepAngle : -2 * this.stepAngle;
    return this.stepAngle;
  }

  protected override onUpdate(u: { beat: number }): void {
    if (this.phase === 'ACTIVE') {
      const step = this.emissionStep;
      // Emit every subdivision that has come due since the last frame.
      const due = Math.floor((u.beat - this.activationBeat) / step) + 1;
      while (this.emitted < due) {
        const index = this.emitted;
        const bornBeat = this.activationBeat + index * step;
        for (let b = 0; b < this.emissionSize; b++) {
          this.shots.push({ angle: this.angleOf(index, b), bornBeat, wind: this.windOf(b) });
        }
        this.emitted += 1;
        if (this.emitted > 400) break;
      }
      if (this.emitted % 4 === 0) this.feel.sfx('projectile_fire', 0.35);
    }
    // Retire shots that have finished their travel.
    this.shots = this.shots.filter((s) => u.beat - s.bornBeat <= this.travelBeats);
  }

  override get isFinished(): boolean {
    const beat = this.spawn.clock.visualBeat;
    return beat > this.recoveryEndBeat && this.shots.length === 0;
  }

  protected override onPhaseChange(_from: MechanicPhase, to: MechanicPhase): void {
    if (to === 'ACTIVE') {
      this.feel.impact('LIGHT', { x: 0.5, y: 0.5, colour: COLOUR, shockwave: true });
    }
  }

  private radiusOf(shot: Shot, beat: number): number {
    const t = clamp((beat - shot.bornBeat) / this.travelBeats, 0, 1);
    return this.expand
      ? 0.05 + t * ARENA_OUTER_RADIUS
      : ARENA_OUTER_RADIUS - t * (ARENA_OUTER_RADIUS - 0.03);
  }

  protected dangerShapes(): Shape[] {
    const beat = this.spawn.clock.visualBeat;
    const shapes: Shape[] = [];
    for (const s of this.shots) {
      const p = polarToField(s.angle, this.radiusOf(s, beat));
      // The travel direction is radial, so an elongated silhouette is oriented
      // along the radius -- outward when expanding, inward when collapsing.
      const angle = this.expand ? s.angle : s.angle + Math.PI;
      for (const c of bulletHitCircles(this.bulletShape, p.x, p.y, this.bulletRadius, angle)) {
        shapes.push({ kind: 'circle' as const, ...c });
      }
    }
    return shapes;
  }

  render(r: Renderer): void {
    const beat = this.spawn.clock.visualBeat;

    if (this.phase === 'TELEGRAPH') {
      const t = this.telegraphProgress(beat);
      const grow = easeIn(t);

      // Show the opening arm angles and which way the pattern will wind. The
      // ghosted arms are drawn from the *actual* angle function, so a FLOWER
      // telegraphs as petals and a PULSE telegraphs as a ring -- the player sees
      // the shape they are about to get, not a generic spoke diagram.
      for (let b = 0; b < Math.min(this.emissionSize, 10); b++) {
        const angle = this.angleOf(0, b);
        const tip = polarToField(angle, 0.2 + 0.3 * grow);
        r.line(ARENA_CENTRE.x, ARENA_CENTRE.y, tip.x, tip.y, EDGE, 2, 0.25 + 0.5 * t);
        const next = polarToField(this.angleOf(3, b), 0.24);
        r.line(tip.x, tip.y, next.x, next.y, EDGE, 1.5, 0.15 + 0.35 * t);
      }
      if (this.pattern === 'PULSE') {
        // The ring that is about to arrive, drawn where it will arrive.
        r.strokeCircle(
          ARENA_CENTRE.x, ARENA_CENTRE.y,
          REFERENCE_RADIUS * (0.6 + 0.4 * grow),
          EDGE, 2, 0.15 + 0.3 * t,
        );
      }
      r.glow(ARENA_CENTRE.x, ARENA_CENTRE.y, 0.08, COLOUR, 0.2 + 0.4 * t);
      return;
    }

    for (const s of this.shots) {
      const radius = this.radiusOf(s, beat);
      const p = polarToField(s.angle, radius);
      const fade = clamp(1 - (beat - s.bornBeat) / this.travelBeats, 0, 1);
      drawBullet(r, {
        x: p.x,
        y: p.y,
        radius: this.bulletRadius,
        shape: this.bulletShape,
        angle: this.expand ? s.angle : s.angle + Math.PI,
        colour: COLOUR,
        alpha: 0.55 + 0.45 * fade,
        glow: false,
      });
    }
    if (this.phase === 'ACTIVE') r.fillCircle(ARENA_CENTRE.x, ARENA_CENTRE.y, 0.018, '#efe3ff', 0.55);
  }
}

function numberOr(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

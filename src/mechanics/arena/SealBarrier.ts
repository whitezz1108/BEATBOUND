/**
 * The sealed barrier of A12 Rhythm Breakout.
 *
 * Everything the ring *looks like* lives here; everything it *means* lives in
 * the mechanic. The mechanic pushes a radius and a phase in each frame and the
 * barrier decides how to draw that -- which is what keeps the encounter's state
 * machine readable, and what makes a new variant a new entry in `SEAL_SKINS`
 * rather than a second copy of the mechanic.
 *
 * READING THE SEAL
 * ----------------
 * This is not another A10. A10 is a ring with a gap you stand in; this one has
 * no gap at all, and the whole point of its visual language is to say so
 * before the player wastes the encounter looking for one:
 *
 *   - an unbroken luminous band, with no stretch of it ever left unpainted,
 *   - inward-pointing teeth all the way round, so the enclosure reads as a
 *     cage rather than as a wave passing through,
 *   - a violet/gold identity, distinct from A10's pink and from the cyan of
 *     the note modes,
 *   - a filled inner wash that deepens as the seal closes, so the shrinking
 *     space is felt rather than measured.
 *
 * SILHOUETTES
 * -----------
 * A skin picks a real shape, not a palette: `HEX_SEAL` and `RUNE_SEAL` are
 * genuinely a hexagon and an octagon, and they damage in the shape they are
 * drawn in, because both come from the same samples in `sealGeometry.ts`. All
 * their radii are inradii, so every silhouette is exactly as fair as the
 * circle at the same numbers.
 *
 * The shatter is the payoff, and it is drawn as real fragments -- chunks of the
 * band with their own velocity and spin, keeping the flat edges a polygon had
 * -- because a seal that fades out cannot carry the moment a seal that breaks
 * can.
 *
 * WHAT THE SEAL IS CLOSED AROUND
 * ------------------------------
 * The centre arrives with every state push and is not assumed. A seal is a
 * cage around a *body*, so it is drawn around the body's position, not the
 * arena's -- see `SealState.centre`. The shatter freezes that centre, because
 * debris belongs to the place it came from.
 */

import type { Renderer } from '../../core/Renderer';
import type { Vec2 } from '../../core/geometry';
import { clamp } from '../../core/geometry';
import { easeOutCubic } from '../../feel/Easing';
import { ARENA_CENTRE, polarToField } from './polar';
import {
  bandSamples, isRound, outlinePoints, radiusAt, segmentQuad, type SealShape,
} from './sealGeometry';

export type SealPhase =
  | 'DORMANT'
  | 'SPAWN'
  | 'FORMING'
  | 'CLOSING'
  | 'CRITICAL'
  | 'SHATTER'
  | 'COLLAPSE'
  | 'GONE';

export interface SealSkin {
  /** Silhouette. Fewer than three sides is a circle. */
  shape: SealShape;
  /** Main band. */
  ring: string;
  /** Rim highlight and teeth. */
  edge: string;
  /** Charge, runes and the critical flare. */
  energy: string;
  /** Teeth around the inner face. */
  teeth: number;
  /** Concentric bands. The outer ones are decoration; the first is the hazard. */
  bands: number;
  /** Chunk count for the shatter. */
  fragments: number;
}

export const SEAL_SKINS = {
  /** The default: one heavy circular band, closely toothed. */
  SINGLE_RING: {
    shape: { sides: 0, spinPerBeat: 0 },
    ring: '#9d7bff', edge: '#e6dcff', energy: '#f7d774', teeth: 36, bands: 1, fragments: 22,
  },
  /** Two concentric circular bands, so the seal reads as layered. */
  DOUBLE_RING: {
    shape: { sides: 0, spinPerBeat: 0 },
    ring: '#8c6bff', edge: '#e6dcff', energy: '#7df0ff', teeth: 28, bands: 2, fragments: 26,
  },
  /** A hexagon, turning slowly. Flat walls read as built rather than grown. */
  HEX_SEAL: {
    shape: { sides: 6, spinPerBeat: 0.02 },
    ring: '#7d8cff', edge: '#dfe4ff', energy: '#f7d774', teeth: 24, bands: 1, fragments: 18,
  },
  /** An octagon, colder and sparser -- for a seal that should feel ancient. */
  RUNE_SEAL: {
    shape: { sides: 8, spinPerBeat: -0.015 },
    ring: '#6ba8ff', edge: '#dceaff', energy: '#f7d774', teeth: 16, bands: 1, fragments: 16,
  },
} as const satisfies Record<string, SealSkin>;

export type SealSkinName = keyof typeof SEAL_SKINS;

export interface SealState {
  /**
   * What the seal is closed around.
   *
   * The seal belongs to the player, not to the arena: it is drawn around the
   * body it is holding, so the same point the hazard is built from is the point
   * the picture is built from. A seal centred on the arena while the player
   * stands somewhere else is a seal that is not enclosing anybody.
   */
  centre: Vec2;
  /** Circumradius of the hazard band, in field units. */
  radius: number;
  /** Rotation of the silhouette, radians. */
  spin: number;
  phase: SealPhase;
  /** 0..1 -- how far the encounter has closed. Drives glow, teeth and wash. */
  pressure: number;
  /** 0..1 -- charge toward the final accent. Drives the flare. */
  charge: number;
}

interface Fragment {
  angle: number;
  /** Angular half-width of this chunk. */
  half: number;
  /** Band radius at each edge of the chunk, frozen at the break. */
  r0: number;
  r1: number;
  /** Field units per second, outward. */
  speed: number;
  drift: number;
  spin: number;
  age: number;
  life: number;
}

export class SealBarrier {
  private state: SealState = {
    centre: ARENA_CENTRE, radius: 0, spin: 0, phase: 'DORMANT', pressure: 0, charge: 0,
  };
  private fragments: Fragment[] = [];
  /**
   * Where the seal was when it broke.
   *
   * Frozen at the shatter, because debris is thrown from a place, not carried
   * around. A player who keeps walking after the break should leave the pieces
   * behind them.
   */
  private fragmentCentre: Vec2 = ARENA_CENTRE;
  /** Seconds since the shatter, for the flash that rides on top of it. */
  private shatterAge = Infinity;

  constructor(
    private readonly skin: SealSkin,
    private readonly thickness: number,
  ) {}

  get phase(): SealPhase { return this.state.phase; }
  get radius(): number { return this.state.radius; }
  /** Where the seal is closed around right now. */
  get centre(): Vec2 { return this.state.centre; }

  set(state: SealState): void {
    this.state = state;
  }

  /** Fragment physics runs in real seconds: it is debris, not choreography. */
  update(deltaSeconds: number): void {
    const dt = Math.min(deltaSeconds, 0.05);
    this.shatterAge += dt;
    if (this.fragments.length === 0) return;
    for (const f of this.fragments) {
      f.age += dt;
      f.r0 += f.speed * dt;
      f.r1 += f.speed * dt;
      f.angle += f.drift * dt;
      f.half += f.spin * dt;
      f.speed *= 1 - Math.min(0.9, 2.2 * dt);
    }
    this.fragments = this.fragments.filter((f) => f.age < f.life);
  }

  /**
   * Break the seal apart at `circumradius`.
   *
   * Each piece inherits the band's geometry at its own angle -- including the
   * flat edges of a polygon -- so the explosion visibly comes out of the thing
   * that was there, rather than being a generic burst played on top of a seal
   * that quietly disappeared.
   */
  shatter(circumradius: number, spin: number, rng: () => number): void {
    this.fragmentCentre = this.state.centre;
    const count = this.skin.fragments;
    const step = (Math.PI * 2) / count;
    this.fragments = Array.from({ length: count }, (_, i) => {
      const angle = i * step + (rng() - 0.5) * step * 0.3;
      const half = step * (0.3 + rng() * 0.18);
      return {
        angle,
        half,
        r0: radiusAt(this.skin.shape, circumradius, angle - half, spin),
        r1: radiusAt(this.skin.shape, circumradius, angle + half, spin),
        speed: 0.55 + rng() * 0.75,
        drift: (rng() - 0.5) * 1.6,
        spin: (rng() - 0.5) * 1.2,
        age: 0,
        life: 0.5 + rng() * 0.45,
      };
    });
    this.shatterAge = 0;
  }

  render(r: Renderer, beat: number): void {
    const { phase } = this.state;
    if (phase === 'DORMANT') return;
    if (phase === 'SHATTER' || phase === 'GONE') {
      this.renderFragments(r);
      this.renderShatterFlash(r);
      return;
    }
    this.renderBand(r, beat);
  }

  // ---- the intact seal ---------------------------------------------------

  private renderBand(r: Renderer, beat: number): void {
    const { centre, radius, spin, phase, pressure, charge } = this.state;
    if (radius <= 0.001) return;

    const critical = phase === 'CRITICAL' || phase === 'COLLAPSE';
    const forming = phase === 'SPAWN' || phase === 'FORMING';
    // Pulse rate doubles once the seal turns critical: same beat, twice the
    // urgency, which is the cheapest way to make a timer feel like a threat.
    const pulse = 0.5 - 0.5 * Math.cos(Math.PI * 2 * beat * (critical ? 2 : 1));
    const colour = critical ? this.skin.energy : this.skin.ring;
    const alpha = forming ? 0.35 + 0.4 * pressure : 0.85;
    const round = isRound(this.skin.shape);

    // The enclosed space darkens as the walls come in -- the room shrinking,
    // rather than a number going up.
    const wash = 0.05 + 0.16 * pressure + 0.06 * charge;
    this.fillInterior(r, centre, radius, spin, wash * 0.45);
    r.glow(centre.x, centre.y, radius * 1.05, this.skin.ring, wash * 0.5);

    // Concentric bands. Only the first is the hazard; the others trail it.
    for (let band = 0; band < this.skin.bands; band++) {
      const offset = band * this.thickness * 1.9;
      const bandAlpha = alpha * (band === 0 ? 1 : 0.35);
      const bandRadius = radius + offset;
      const fill = bandAlpha * (0.55 + 0.25 * pulse);
      if (round) {
        r.fillAnnulusSector(
          centre.x, centre.y,
          Math.max(0, bandRadius - this.thickness / 2), bandRadius + this.thickness / 2,
          0, Math.PI * 2, colour, fill,
        );
      } else {
        for (const sample of bandSamples(this.skin.shape, bandRadius, spin)) {
          r.fillPolygon(
            segmentQuad(this.skin.shape, sample, this.thickness, bandRadius, spin, centre), colour, fill,
          );
        }
      }
      this.strokeOutline(r, centre, bandRadius, spin, this.thickness / 2, this.skin.edge, bandAlpha * 0.6);
      this.strokeOutline(r, centre, bandRadius, spin, -this.thickness / 2, this.skin.edge, bandAlpha * 0.8);
    }

    this.renderTeeth(r, centre, radius, spin, pulse, alpha, critical);

    // Forming reads as the seal locking into place: spokes converge inward.
    if (forming) this.renderFormingSpokes(r, centre, radius, spin, pressure);
    if (critical) {
      r.glow(centre.x, centre.y, radius * 1.3, this.skin.energy, 0.10 + 0.14 * pulse);
    }
  }

  /** The safe space inside the seal, in the seal's own shape. */
  private fillInterior(r: Renderer, centre: Vec2, radius: number, spin: number, alpha: number): void {
    const inner = radius - this.thickness / 2;
    if (inner <= 0.001) return;
    if (isRound(this.skin.shape)) {
      r.fillCircle(centre.x, centre.y, inner, this.skin.ring, alpha);
      return;
    }
    r.fillPolygon(
      outlinePoints(this.skin.shape, radius, spin, -this.thickness / 2, centre), this.skin.ring, alpha,
    );
  }

  private strokeOutline(
    r: Renderer, centre: Vec2, radius: number, spin: number, offset: number,
    colour: string, alpha: number,
  ): void {
    if (isRound(this.skin.shape)) {
      r.strokeCircle(centre.x, centre.y, Math.max(0, radius + offset), colour, 2, alpha);
      return;
    }
    const points = outlinePoints(this.skin.shape, radius, spin, offset, centre);
    r.polyline([...points, points[0]], colour, 2, alpha);
  }

  /**
   * Inward teeth.
   *
   * These carry the whole "there is no gap" message. A plain band is what a
   * collapsing A10 ring looks like between its openings, so the player's
   * trained reaction is to start hunting round the circle for the arc that is
   * missing. Teeth pointing at the middle say *the enclosure is the point* --
   * every one of them aims at the player, and none of them ever stops.
   */
  private renderTeeth(
    r: Renderer, centre: Vec2, radius: number, spin: number, pulse: number,
    alpha: number, critical: boolean,
  ): void {
    const length = this.thickness * (0.55 + 0.35 * pulse) * (critical ? 1.35 : 1);
    for (let i = 0; i < this.skin.teeth; i++) {
      const angle = spin + (i / this.skin.teeth) * Math.PI * 2;
      const inner = radiusAt(this.skin.shape, radius, angle, spin) - this.thickness / 2;
      const from = polarToField(angle, Math.max(0.01, inner), centre);
      const to = polarToField(angle, Math.max(0.005, inner - length), centre);
      r.line(from.x, from.y, to.x, to.y, this.skin.edge, critical ? 2 : 1, alpha * (0.35 + 0.35 * pulse));
    }
  }

  private renderFormingSpokes(
    r: Renderer, centre: Vec2, radius: number, spin: number, pressure: number,
  ): void {
    const t = easeOutCubic(clamp(pressure, 0, 1));
    for (let i = 0; i < 8; i++) {
      const angle = spin + (i / 8) * Math.PI * 2;
      const at = radiusAt(this.skin.shape, radius, angle, spin);
      const from = polarToField(angle, at + 0.1 * (1 - t), centre);
      const to = polarToField(angle, at, centre);
      r.line(from.x, from.y, to.x, to.y, this.skin.energy, 2, 0.35 * (1 - t));
    }
  }

  // ---- the broken seal ---------------------------------------------------

  private renderFragments(r: Renderer): void {
    const half = this.thickness / 2;
    const centre = this.fragmentCentre;
    for (const f of this.fragments) {
      const fade = 1 - f.age / f.life;
      const a0 = f.angle - f.half;
      const a1 = f.angle + f.half;
      const quad: Vec2[] = [
        polarToField(a0, Math.max(0, f.r0 - half), centre),
        polarToField(a1, Math.max(0, f.r1 - half), centre),
        polarToField(a1, f.r1 + half, centre),
        polarToField(a0, f.r0 + half, centre),
      ];
      r.fillPolygon(quad, this.skin.ring, 0.85 * fade);
      r.polyline([quad[3], quad[2]], this.skin.edge, 2, 0.7 * fade);
      // A streak trailing back toward where the band was, so the pieces read
      // as thrown outward rather than as simply floating apart.
      const tip = polarToField(f.angle, (f.r0 + f.r1) / 2 + half, centre);
      const tail = polarToField(
        f.angle, Math.max(0.02, (f.r0 + f.r1) / 2 - half - f.speed * 0.08), centre,
      );
      r.line(tail.x, tail.y, tip.x, tip.y, this.skin.energy, 2, 0.3 * fade);
    }
  }

  private renderShatterFlash(r: Renderer): void {
    if (this.shatterAge > 0.35) return;
    const t = 1 - this.shatterAge / 0.35;
    const { x, y } = this.fragmentCentre;
    r.glow(x, y, 0.2 + 0.5 * (1 - t), this.skin.energy, 0.5 * t);
  }
}

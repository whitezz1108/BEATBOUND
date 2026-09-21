/**
 * VERTICAL -- four-lane falling-note rhythm, on a 3D perspective highway.
 *
 * Notes ride the highway toward the player and reach the hit line exactly on
 * their beat. Travel is still a pure function of the beat (see Highway.zOf),
 * so the approach *is* the countdown -- but drawn in depth: notes pop through
 * the spawn arch at the horizon, rush down the neon road and burst on the
 * receptor pads at the front of the screen.
 *
 * Three note families share the board:
 *   TAP    one press on the line
 *   HOLD   press, keep holding, release at the tail
 *   DRIFT  press, keep holding, and move across lanes while you hold
 *
 * Judgement lives in NoteMode and is untouched here; this class only decides
 * what the stage and its notes look like (see Highway.ts for the camera).
 */

import type { NoteTarget } from '../../core/capabilities';
import { VERTICAL_LANE_KEYS } from '../../core/controls';
import type { MechanicUpdate } from '../../core/Mechanic';
import type { Renderer } from '../../core/Renderer';
import type { GameMode } from '../../core/types';
import { clamp, lerp, type Vec2 } from '../../core/geometry';
import { easeOutCubic } from '../../feel/Easing';
import { LANE_COUNT } from '../../mechanics/vertical/LaneNoteMechanic';
import { TUNING } from '../../tuning';
import { NoteMode } from '../rhythm/NoteMode';
import {
  Highway, lerpColour, LANE_STRIP_COLOURS, LANE_W, NOTE_DEPTH, NOTE_HEIGHT, Z_EXIT, Z_HIT,
} from './Highway';

/** Lane -> the keys that play it, derived from the shared binding table, so
 * adding a lane there is all it takes to widen the board. */
const LANE_KEYS: Record<number, string[]> = Object.fromEntries(
  VERTICAL_LANE_KEYS.map((keys, i) => [i + 1, [...keys]]),
);
/** 1..LANE_COUNT, wherever lane indexes are enumerated. */
const LANE_INDEXES = VERTICAL_LANE_KEYS.map((_, i) => i + 1);

const LANE_COLOURS = LANE_STRIP_COLOURS;

/** One display key per lane, for the receptor labels. */
const KEY_LABELS = VERTICAL_LANE_KEYS.map((keys) => keys[0].toUpperCase());

export class VerticalMode extends NoteMode {
  readonly mode: GameMode = 'VERTICAL';

  private readonly highway = new Highway();
  /** Hits whose pad-spark celebration has already fired. */
  private readonly celebrated = new WeakSet<NoteTarget>();

  private keysFor(target: NoteTarget, beat: number): string[] {
    return LANE_KEYS[this.laneOf(target, beat)] ?? LANE_KEYS[1];
  }

  protected justPressed(target: NoteTarget, beat: number): boolean {
    return this.ctx.input.wasPressed(...this.keysFor(target, beat));
  }

  protected isHeld(target: NoteTarget, beat: number): boolean {
    return this.ctx.input.isDown(...this.keysFor(target, beat));
  }

  protected judgementAnchor(target: NoteTarget, beat: number): { x: number; y: number } {
    // Above the lane's receptor: where the eye already is when the note lands.
    const pos = this.highway.receptorFieldPos(this.laneOf(target, beat));
    return { x: pos.x, y: pos.y - 0.17 };
  }

  protected isOffscreen(target: NoteTarget, beat: number): boolean {
    // The whole note, tail included, has to be past the camera plane.
    return this.highway.zOf(target.beat + target.holdBeats - beat) < Z_EXIT;
  }

  /**
   * Full-frame override: the highway is a depth scene, so receptors need their
   * hit-flash computed up front and notes must draw far-to-near to overlap
   * correctly. Everything else follows the base order.
   */
  override update(u: MechanicUpdate): void {
    super.update(u);
    // Every fresh hit throws sparks off its pad, on top of the shared impact
    // burst -- the road itself answers the player.
    for (const t of this.allTargets()) {
      if (t.state !== 'HIT' || this.celebrated.has(t)) continue;
      const age = u.beat - (t.hitBeat ?? t.beat);
      if (age < 0) continue;
      this.celebrated.add(t);
      if (age > 0.3) continue; // resumed/seeked runs: too late to celebrate
      const lane = clamp(this.laneOf(t, u.beat), 1, LANE_COUNT);
      const p = this.highway.receptorFieldPos(lane);
      this.ctx.feel.emit(p.x, p.y - 0.05, {
        count: 12, speed: 0.55, colour: LANE_COLOURS[lane - 1],
        shape: 'spark', size: 0.008, life: 0.5,
        direction: -Math.PI / 2, spread: Math.PI * 0.75, gravity: 0.5,
      });
    }
  }

  override render(r: Renderer): void {
    const beat = this.ctx.clock.visualBeat;
    const targets = this.allTargets();

    const flashes = new Array<number>(LANE_COUNT).fill(0);
    const anticipation = new Array<number>(LANE_COUNT).fill(0);
    for (const t of targets) {
      const lane = clamp(this.laneOf(t, beat), 1, LANE_COUNT);
      if (t.state === 'HIT') {
        const age = beat - (t.hitBeat ?? t.beat);
        if (age >= 0 && age < 0.3) flashes[lane - 1] = Math.max(flashes[lane - 1], 1 - age / 0.3);
      } else if (t.state === 'PENDING') {
        // An incoming note breathes its pad brighter: the last half beat of
        // approach reads as "this one, now".
        const beatsAway = t.beat - beat;
        if (beatsAway > 0 && beatsAway < 0.6) {
          const laneOfHead = clamp(t.path?.[0].lane ?? t.lane ?? 1, 1, LANE_COUNT);
          anticipation[laneOfHead - 1] = Math.max(anticipation[laneOfHead - 1], 1 - beatsAway / 0.6);
        }
      }
    }

    // The scene heats up with the combo: sky, sun, rails and streaks intensify.
    this.highway.setHeat(clamp(this.combo / 60, 0, 1));
    this.highway.update(beat);

    r.fillRect({ x: 0, y: 0, w: 1, h: 1 }, '#0b0f18');
    r.withFieldClip(() => {
      this.renderStage(r, beat);
      const held = LANE_INDEXES.map((lane) => this.ctx.input.isDown(...LANE_KEYS[lane]));
      this.highway.renderReceptors(r, held, flashes, anticipation);
      // Far notes first: near slabs overlap the ones behind them.
      for (let i = targets.length - 1; i >= 0; i--) this.renderNote(r, targets[i], beat);
      // Keys label the pads from above, so a landing note can never hide them.
      this.highway.renderKeyLabels(r, KEY_LABELS, held);
      this.renderHitPulses(r, targets, beat);
      this.renderJudgement(r, beat);
      this.renderCombo(r);
    });
  }

  /**
   * Every fresh hit throws a light pulse back up its lane -- the road itself
   * answers the player, which is where the punch of a streak comes from.
   */
  private renderHitPulses(r: Renderer, targets: NoteTarget[], beat: number): void {
    for (const t of targets) {
      if (t.state !== 'HIT') continue;
      const age = beat - (t.hitBeat ?? t.beat);
      if (age < 0 || age > 0.5) continue;
      const lane = clamp(this.laneOf(t, beat), 1, LANE_COUNT);
      const wx = this.highway.laneX(lane);
      const z = Z_HIT + easeOutCubic(age / 0.5) * 1.5;
      const strength = 1 - age / 0.5;
      const colour = LANE_COLOURS[lane - 1];
      r.fillPolygon(this.highway.laneQuad(wx, LANE_W * 0.4, z - 0.05, z + 0.05), colour, 0.35 * strength);
      r.fillPolygon(this.highway.laneQuad(wx, LANE_W * 0.18, z - 0.05, z + 0.05), '#ffffff', 0.3 * strength);
    }
  }

  protected renderStage(r: Renderer, beat: number): void {
    void beat;
    this.highway.renderBackdrop(r);
    const held = LANE_INDEXES.map((lane) => this.ctx.input.isDown(...LANE_KEYS[lane]));
    this.highway.renderRoad(r, held);
    this.highway.renderStreaks(r);
  }

  /**
   * The side panel: a live scoreboard in the sky, left of the road. Big
   * combo number on top, per-verdict tallies beneath, accuracy at the foot.
   */
  protected override renderCombo(r: Renderer): void {
    const beat = this.ctx.clock.visualBeat;
    if (this.combo !== this.lastComboSeen) {
      this.lastComboSeen = this.combo;
      this.comboPopBeat = beat;
    }
    const pop = Math.max(0, 1 - (beat - this.comboPopBeat) * 5);

    const x = 0.105;
    const y0 = 0.058;
    r.glow(x, y0 + 0.01, 0.055 + pop * 0.02, '#6de3ff', 0.16 + pop * 0.3);
    r.text(`${this.combo}`, x, y0, '#f0f6ff', 31 + pop * 9, 'center', this.combo > 0 ? 0.95 : 0.35);
    r.text('COMBO', x, y0 + 0.043, '#8d99b5', 9, 'center', 0.7);

    const counts = this.verdictCounts;
    const rows: Array<[string, number, string]> = [
      ['PERFECT', counts.PERFECT, '#6de3ff'],
      ['NICE', counts.NICE, '#ffd76d'],
      ['GOOD', counts.GOOD, '#9affc0'],
      ['MISS', counts.MISS, '#ff5470'],
    ];
    let y = y0 + 0.086;
    for (const [label, n, colour] of rows) {
      r.text(label, x - 0.036, y, colour, 10, 'left', 0.85);
      r.text(`${n}`, x + 0.052, y, '#e8ecf8', 11, 'right', 0.95);
      y += 0.031;
    }
    const s = this.ctx.status;
    const total = s.notesHit + s.notesMissed;
    const acc = total > 0 ? Math.round((s.notesHit / total) * 100) : 100;
    r.text(`ACC ${acc}%`, x, y + 0.004, '#8d99b5', 10, 'center', 0.75);
  }

  protected renderNote(r: Renderer, target: NoteTarget, beat: number): void {
    if (target.state === 'EXPIRED') return;
    const headLane = clamp(target.path?.[0].lane ?? target.lane ?? 1, 1, LANE_COUNT);
    const colour = LANE_COLOURS[headLane - 1];

    if (target.state === 'HIT') {
      this.renderHitBurst(r, target, beat, colour);
      return;
    }
    if (target.state === 'MISSED' || target.state === 'BROKEN') {
      this.renderMissed(r, target, beat, headLane);
      return;
    }
    if (target.path && target.path.length > 1) {
      this.renderDrift(r, target, beat, colour);
      return;
    }

    const beatsAway = target.beat - beat;
    const z = this.highway.zOf(beatsAway);
    const wx = this.highway.laneX(headLane);
    const inWindow = Math.abs(beatsAway) <= this.hitWindow;

    if (target.holdBeats > 0) {
      const holding = target.state === 'HOLDING';
      const headZ = holding ? Z_HIT : z;
      const tailZ = this.highway.zOf(target.beat + target.holdBeats - beat);
      if (tailZ > headZ + 0.02) {
        const hw = LANE_W * 0.36;
        const body = this.highway.laneQuad(wx, hw, headZ, tailZ);
        r.fillPolygon(body, colour, holding ? 0.42 : 0.22);
        r.polyline(body, '#ffffff', 1.5, holding ? 0.4 : 0.2);
        if (holding) {
          // Energy flows down the body toward the player: it reads as
          // sustaining, not sitting.
          for (let i = 0; i < 3; i++) {
            const phase = ((beat * 1.5 + i / 3) % 1 + 1) % 1;
            const zb = lerp(tailZ, headZ, phase);
            if (zb - 0.03 < headZ) continue;
            r.fillPolygon(this.highway.laneQuad(wx, hw * 0.8, zb - 0.03, zb + 0.03), colour, 0.5 * (1 - phase) + 0.15);
          }
        }
      }
      this.renderSlab(r, wx, headZ, colour, {
        w: LANE_W * (holding ? 0.62 : 0.8), fill: holding || inWindow ? 1 : 0.9, flash: holding || inWindow,
      });
      if (holding) {
        // The pad stays lit while the note sustains on it.
        const p = this.highway.project(wx, Z_HIT, NOTE_HEIGHT * 0.6);
        r.strokeCircle(p.x, p.y, 0.05 * p.s, '#ffffff', 2.5, 0.8);
      }
      return;
    }

    // Close approach gets a flame trail above the slab -- pure speed feedback.
    if (beatsAway < 0.55 && beatsAway > -0.1) {
      const urgency = (0.55 - beatsAway) / 0.55;
      this.highway.renderBeam(r, wx, z + NOTE_DEPTH / 2, LANE_W * 0.42, colour, 0.12 + 0.3 * urgency);
    }
    this.renderSlab(r, wx, z, colour, { w: LANE_W * 0.8, fill: inWindow ? 1 : 0.88, flash: inWindow });
  }

  /**
   * A played note bursts at the receptor: an expanding ring on the road plane
   * plus a light column, on top of the sparks NoteMode's impact already emits.
   */
  private renderHitBurst(r: Renderer, target: NoteTarget, beat: number, colour: string): void {
    const age = beat - (target.hitBeat ?? target.beat);
    if (age < 0 || age > 0.5) return;
    const strength = 1 - age / 0.5;
    const wx = this.highway.laneX(clamp(this.laneOf(target, beat), 1, LANE_COUNT));
    const radius = 0.05 + easeOutCubic(age / 0.5) * 0.2;

    const ring: Vec2[] = [];
    for (let i = 0; i <= 18; i++) {
      const a = (i / 18) * Math.PI * 2;
      ring.push(this.highway.project(wx + radius * Math.cos(a), Z_HIT + radius * 0.55 * Math.sin(a), 0.012));
    }
    r.polyline(ring, colour, 2.5, strength * 0.9);
    if (age < 0.22) {
      const inner: Vec2[] = [];
      const ir = radius * 0.5;
      for (let i = 0; i <= 18; i++) {
        const a = (i / 18) * Math.PI * 2;
        inner.push(this.highway.project(wx + ir * Math.cos(a), Z_HIT + ir * 0.55 * Math.sin(a), 0.012));
      }
      r.polyline(inner, '#ffffff', 2, (1 - age / 0.22) * 0.9);
    }
    // The pad's own flash beam covers the column; the burst keeps only the ring.
  }

  /**
   * Missed notes slide past the camera: inert, hollow and red, so they cannot
   * be confused with something still playable.
   */
  private renderMissed(r: Renderer, target: NoteTarget, beat: number, lane: number): void {
    const z = this.highway.zOf(target.beat - beat);
    if (z < 0.6) return;
    const fade = clamp(1 - (beat - target.beat - 0.35) / 1.1, 0.12, 1);
    const wx = this.highway.laneX(lane);
    const hw = LANE_W * 0.36;

    const outline: Vec2[] = [];
    const tailZ = this.highway.zOf(target.beat + target.holdBeats - beat);
    const topZ = Math.max(z, Math.min(tailZ, this.highway.zOf(TUNING.vertical.approachBeats)));
    for (const pz of [z, (z + topZ) / 2, topZ]) {
      outline.push(this.highway.project(wx - hw, pz, 0.02));
    }
    const back = [topZ, (z + topZ) / 2, z].map((pz) => this.highway.project(wx + hw, pz, 0.02));
    r.fillPolygon([...outline, ...back], '#ff5470', 0.08 * fade);
    r.polyline([...outline, ...back.reverse(), outline[0]], '#ff5470', 1.5, 0.55 * fade);
  }

  /**
   * A drift hold draws its whole lane path as a ribbon lying on the road: the
   * player can see the next lane change coming before it arrives, which is
   * the entire skill.
   */
  private renderDrift(r: Renderer, target: NoteTarget, beat: number, colour: string): void {
    const path = target.path!;
    const holding = target.state === 'HOLDING';
    const hw = LANE_W * 0.34;

    // Centre polyline in world space, corners squared so the ribbon shows
    // *when* the lane changes.
    const spine: Array<{ x: number; z: number }> = [];
    for (const segment of path) {
      const z = this.highway.zOf(target.beat + segment.beatOffset - beat);
      const x = this.highway.laneX(segment.lane);
      if (spine.length > 0) spine.push({ x: spine[spine.length - 1].x, z });
      spine.push({ x, z });
    }
    const tailZ = this.highway.zOf(target.beat + target.holdBeats - beat);
    if (spine.length > 0) spine.push({ x: spine[spine.length - 1].x, z: tailZ });

    const left: Vec2[] = [];
    const right: Vec2[] = [];
    const centre: Vec2[] = [];
    for (const p of spine) {
      left.push(this.highway.project(p.x - hw, p.z, 0.02));
      right.push(this.highway.project(p.x + hw, p.z, 0.02));
      centre.push(this.highway.project(p.x, p.z, 0.02));
    }
    r.fillPolygon([...left, ...right.reverse()], colour, holding ? 0.4 : 0.2);
    r.polyline(centre, '#ffffff', 1.5, holding ? 0.45 : 0.22);

    // Checkpoint markers: the beats where the hand has to move.
    for (const segment of path) {
      const z = this.highway.zOf(target.beat + segment.beatOffset - beat);
      if (z < 0.75 || z > 3.4) continue;
      const p = this.highway.project(this.highway.laneX(segment.lane), z, 0.05);
      const imminent = Math.abs(target.beat + segment.beatOffset - beat) < 0.3;
      r.fillCircle(p.x, p.y, imminent ? 0.014 : 0.009, '#ffffff', imminent ? 0.95 : 0.5);
      if (imminent) r.glow(p.x, p.y, 0.03, '#ffffff', 0.4);
    }

    const headZ = holding ? Z_HIT : this.highway.zOf(target.beat - beat);
    const headX = this.highway.laneX(this.laneOf(target, beat));
    const inWindow = !holding && Math.abs(target.beat - beat) <= this.hitWindow;
    this.renderSlab(r, headX, headZ, colour, {
      w: LANE_W * (holding ? 0.62 : 0.8), fill: holding || inWindow ? 1 : 0.88, flash: holding || inWindow,
    });
    if (holding) {
      // A travelling marker shows which lane is live right now.
      const p = this.highway.project(headX, Z_HIT, NOTE_HEIGHT * 0.6);
      r.strokeCircle(p.x, p.y, 0.05 * p.s, '#ffffff', 3, 0.85);
      const lapse = (target.offBeats ?? 0) / TUNING.vertical.driftToleranceBeats;
      if (lapse > 0.05) r.strokeCircle(p.x, p.y, 0.07 * p.s, '#ff5470', 2, clamp(lapse, 0, 1));
    }
  }

  /** A note head: a slab sitting on the road, with a lit top face and sides. */
  private renderSlab(
    r: Renderer, wx: number, z: number, colour: string,
    o: { w: number; d?: number; h?: number; fill?: number; flash?: boolean },
  ): void {
    const d = o.d ?? NOTE_DEPTH;
    const h = o.h ?? NOTE_HEIGHT;
    const zn = Math.max(0.5, z - d / 2);
    const zf = z + d / 2;
    const x0 = wx - o.w / 2;
    const x1 = wx + o.w / 2;

    const pA = this.highway.project(x0, zf, h);
    const pB = this.highway.project(x1, zf, h);
    const pC = this.highway.project(x1, zn, h);
    const pD = this.highway.project(x0, zn, h);
    const pE = this.highway.project(x1, zn, 0);
    const pF = this.highway.project(x0, zn, 0);

    // Light spilling onto the road around the slab.
    const g = this.highway.project(wx, z, 0);
    r.glow(g.x, g.y, 0.1 * g.s, colour, 0.2);

    const fill = o.fill ?? 0.9;
    // Front face, shaded, then the lit top.
    r.fillPolygon([pD, pC, pE, pF], lerpColour(colour, '#05070d', 0.55), fill);
    r.fillPolygon([pA, pB, pC, pD], colour, fill);
    // A sheen along the top face's near edge gives the slab its gloss.
    r.polyline([pD, pC], '#ffffff', 1.5, 0.4 + (o.flash ? 0.5 : 0));
    if (o.flash) r.polyline([pA, pB, pC, pD, pA], '#ffffff', 2, 0.9);
  }
}

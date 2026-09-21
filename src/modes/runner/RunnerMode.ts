/**
 * RUNNER -- fast auto-running rhythm platforming.
 *
 * The player is pinned at a fixed x while the track scrolls past, so an
 * obstacle scheduled on a beat arrives exactly on that beat. Jump and slide are
 * the input vocabulary; the mode resolves them against generic hazard shapes
 * plus the RunnerTerrain capability (gaps, pads, slabs, gravity), never against
 * specific mechanic ids.
 *
 * ## Terrain is geometry, not a surface tag
 *
 * Every terrain mechanic reports a solid block as a `Platform`: the x range it
 * occupies and the world y of its two faces. From that the mode derives, for the
 * gravity it is currently under:
 *
 *   - the *support* -- the highest face at or below the feet, which is what the
 *     player stands on and lands on;
 *   - the *blocker* -- the lowest face above the head, which is what stops a
 *     rising jump.
 *
 * A block anchored to the floor has its lower face on the floor line, so it can
 * never block; a block anchored to the ceiling has its upper face on the ceiling
 * line and can never support. A *floating* block does both, which is what makes
 * a corridor (a raised walkway with a slab over it) expressible at all.
 *
 * Because support and blocker are read from the same two numbers, a level can
 * never disagree with itself about whether something is standable or solid.
 *
 * The presentation exists to sell speed and to keep the *running surface*
 * obvious at all times -- especially through a gravity inversion, where the
 * player needs to know within a frame which way is down.
 */

import { gapsOf, hasTerrain, padsOf, platformsOf, surfaceFor, type Platform } from '../../core/capabilities';
import { circleIntersectsShape, clamp, type Circle } from '../../core/geometry';
import { RUNNER_FLIP_KEYS, RUNNER_JUMP_KEYS, RUNNER_SLIDE_KEYS } from '../../core/controls';
import type { MechanicUpdate, RuntimeMechanic } from '../../core/Mechanic';
import type { Renderer } from '../../core/Renderer';
import type { SpawnedMechanicInfo } from '../../core/PatternScheduler';
import type { GameMode } from '../../core/types';
import { CEILING_Y, GROUND_Y, PLAYER_X, UNITS_PER_BEAT } from '../../mechanics/runner/runnerGeometry';
import { BODY_HEIGHT, beatsToUnits } from '../../mechanics/runner/runnerPhysics';
import { resolveProbe, xOverGap, type TerrainProbe } from '../../mechanics/runner/terrainProbe';
import { SURFACE_COLOUR, surfaceForGravity, surfaceOf, type TrackSurface } from '../../mechanics/runner/surface';
import { TUNING } from '../../tuning';
import type { GameplayMode, ModeContext } from '../GameplayMode';
import { RunnerPlayer } from './RunnerPlayer';
import { renderRunnerDebug, type DebugPhrase } from './RunnerDebug';

/** How close the feet must be to a pad's face for it to fire. */
const PAD_CAPTURE = 0.03;

/**
 * The two skies. Which way is down is the fact the player has to re-establish
 * after every inversion, so the environment answers it as well as the track
 * does: the field behind a floor run is a cold navy, behind a ceiling run a
 * violet, and the whole backdrop changes side with the gravity.
 */
const SKY_FLOOR = '#0b0f18';
const SKY_CEILING = '#150d1c';

/** The mass of both running surfaces. One colour, both sides, always. */
const TRACK_BODY = '#141b29';

/**
 * The band of the field a phrase mark may use.
 *
 * It is the dead space between the two routes -- above the floor's platforms and
 * below the ceiling's -- and it is the *only* band of the screen that is never a
 * surface. A mark there cannot be mistaken for a standable face.
 */
const MARK_TOP = CEILING_Y + 0.12;
const MARK_BOTTOM = GROUND_Y - 0.12;

/**
 * The phrase mark's colour: the one hue the backdrop is allowed, shared with the
 * drift dashes.
 *
 * It is deliberately *not* a per-motif colour. Six motif hues used to wash the
 * background, and before that the floor itself; both were the same mistake in
 * two places -- a recurring hue the player has to decide whether to act on, and
 * cannot. The backdrop's whole vocabulary is now one blue-grey plus the sky, so
 * every colour left on screen is one the player can do something about.
 */
const MARK_COLOUR = '#8fa6d8';

/**
 * How far off the running plane the nearest skyline layer is allowed to come.
 *
 * 1.5x the player's standing height (see `BODY_HEIGHT` in runnerPhysics). Below
 * that the backdrop overlaps the player's own silhouette as they run, and a
 * block behind the player at the height of their head reads as a ceiling
 * whether or not it can be collided with.
 */
const SKYLINE_CLEAR = BODY_HEIGHT * 1.5;

/**
 * What a course says about the phrase in play.
 *
 * The debug view's fields, plus the beat the phrase begins on -- the only thing
 * the backdrop still asks of a phrase. Read through a duck-typed `phraseAt`, so
 * the mode still knows nothing about courses -- a mechanic either answers the
 * question or it does not.
 */
interface PhraseReadout extends DebugPhrase {
  startBeat: number;
}

export class RunnerMode implements GameplayMode {
  readonly mode: GameMode = 'RUNNER';
  readonly player = new RunnerPlayer();
  private mechanics: RuntimeMechanic[] = [];
  private lastHitBeat = -Infinity;
  private lastPatternId = '-';
  private gravityDirection = 1;
  /**
   * The player's own inversion, set by the flip key while grounded.
   * Multiplies the course's gravity, so a manual flip mirrors whichever
   * route the course is currently playing -- and the next authored flip
   * flips both together. The other base line is solid wherever the level
   * has no hole, so a manual flip is safe exactly as often as it looks.
   */
  private manualFlip = false;
  private jumps = 0;
  /** Last probe handed to the player, kept for the debug view. */
  private probe: TerrainProbe = { support: GROUND_Y, blocker: null };
  private debug = false;
  /** Rolling record of where the player actually was, for the debug view. */
  private readonly breadcrumbs: Array<{ x: number; y: number }> = [];
  /** Last phrase the course reported: the debug view's read, plus the backdrop's. */
  private phrase: PhraseReadout | null = null;

  constructor(private readonly ctx: ModeContext) {}

  activate(_atBeat: number): void {
    this.player.reset();
    this.mechanics = [];
    this.gravityDirection = 1;
    this.manualFlip = false;
    this.breadcrumbs.length = 0;
  }

  deactivate(_atBeat: number): void {
    this.mechanics = [];
  }

  clearHazards(): void {
    this.mechanics = [];
  }

  accept(info: SpawnedMechanicInfo): void {
    this.mechanics.push(info.mechanic);
    this.lastPatternId = info.patternId;
  }

  update(u: MechanicUpdate): void {
    if (this.ctx.input.wasPressed('`')) this.debug = !this.debug;

    for (const m of this.mechanics) m.update(u);

    const alive = this.ctx.status.outcome === 'PLAYING';
    // A manual flip is chosen on the ground, mid-run: the GD-ball read. It
    // toggles which side of the field the player is riding; the course's own
    // flip timeline keeps running underneath and flips both sides together.
    if (alive && this.player.isGrounded && this.ctx.input.wasPressed(...RUNNER_FLIP_KEYS)) {
      this.manualFlip = !this.manualFlip;
    }
    const courseGravity = this.currentGravityDirection();
    const nextGravity = courseGravity * (this.manualFlip ? -1 : 1);
    if (nextGravity !== this.gravityDirection) {
      // The flip itself is the event, not the zone: one heavy cue, no pause.
      // It fires for the course's authored flips and for the player's own
      // manual flip alike -- the world inverting is the world inverting.
      const body = this.player.body;
      this.ctx.feel.impact('HEAVY', {
        x: body.x + body.w / 2, y: body.y + body.h / 2,
        dirX: 0, dirY: nextGravity > 0 ? 1 : -1,
        colour: '#c9bcff', sfx: 'gravity_flip',
      });
      this.ctx.feel.emit(body.x + body.w / 2, body.y + body.h / 2, {
        count: 22, speed: 1.1, colour: '#c9bcff', size: 0.009, shape: 'shard', life: 0.5,
      });
      this.gravityDirection = nextGravity;
    }
    this.probe = this.resolveTerrain();
    this.phrase = this.currentPhrase();
    // A live ring arms one mid-air jump; the second press is still the
    // player's. Armed mid-air only, disarmed on landing and on flips.
    if (alive && !this.player.isGrounded && this.airJumpLive()) this.player.armAirJump();
    const step = this.player.update(
      u.deltaSeconds,
      u.secondsPerBeat,
      {
        jumpPressed: alive && this.ctx.input.wasPressed(...RUNNER_JUMP_KEYS),
        jumpHeld: alive && this.ctx.input.isDown(...RUNNER_JUMP_KEYS),
        slide: alive && this.ctx.input.isDown(...RUNNER_SLIDE_KEYS),
      },
      this.gravityDirection,
      this.probe,
    );

    if (step.jumped) {
      this.jumps += 1;
      this.ctx.feel.sfx('jump');
      const body = this.player.body;
      this.ctx.feel.emit(body.x + body.w / 2, body.y + body.h * (this.gravityDirection > 0 ? 1 : 0), {
        count: 5, speed: 0.4, colour: '#9fdcff', size: 0.005, life: 0.25, shape: 'dot',
        direction: this.gravityDirection > 0 ? Math.PI / 2 : -Math.PI / 2, spread: Math.PI * 0.7,
      });
    }
    if (step.landed) {
      this.ctx.feel.sfx('land');
      this.ctx.feel.impact('LIGHT', { shockwave: false, particles: false });
      const body = this.player.body;
      this.ctx.feel.emit(body.x + body.w / 2, this.player.surfaceY, {
        count: 7, speed: 0.55, colour: '#8aa0c9', size: 0.005, life: 0.3, shape: 'spark',
        direction: this.gravityDirection > 0 ? -Math.PI / 2 : Math.PI / 2, spread: Math.PI * 0.8,
      });
    }
    if (step.bonked) {
      // A bonk is information, not damage: the corridor is tighter than the
      // jump. A short click and a puff of dust sell it without punishing.
      const body = this.player.body;
      this.ctx.feel.emit(body.x + body.w / 2, body.y, {
        count: 6, speed: 0.35, colour: '#9fb0d0', size: 0.005, life: 0.25, shape: 'spark',
        direction: this.gravityDirection > 0 ? -Math.PI / 2 : Math.PI / 2, spread: Math.PI * 0.6,
      });
    }

    this.applyBouncePads(u.secondsPerBeat);
    if (alive) this.resolveCollisions(u);

    if (this.mechanics.some((m) => m.isFinished)) {
      this.mechanics = this.mechanics.filter((m) => !m.isFinished);
    }

    const body = this.player.body;
    this.breadcrumbs.push({ x: body.x + body.w / 2, y: body.y + body.h / 2 });
    if (this.breadcrumbs.length > 180) this.breadcrumbs.shift();
  }

  /** Last active gravity mechanic wins; absent any, gravity is normal. */
  private currentGravityDirection(): number {
    for (const m of this.mechanics) {
      if (!hasTerrain(m)) continue;
      const scale = m.gravityScale?.() ?? null;
      if (scale !== null && scale !== 0) return Math.sign(scale);
    }
    return 1;
  }

  /**
   * The phrase the course says is playing, for the debug view.
   *
   * Read off the mechanic that owns the phrase timeline rather than tracked
   * here, so the mode still knows nothing about courses: a mechanic either
   * answers the question or it does not.
   */
  private currentPhrase(): PhraseReadout | null {
    for (const m of this.mechanics) {
      const owner = m as { phraseAt?: (beat: number) => PhraseReadout | null };
      if (typeof owner.phraseAt !== 'function') continue;
      const phrase = owner.phraseAt(this.ctx.clock.absoluteBeat);
      if (phrase) return phrase;
    }
    return null;
  }

  /** True while the course has an air-jump ring live under the player. */
  private airJumpLive(): boolean {
    for (const m of this.mechanics) {
      const owner = m as { airJumpLive?: (beat: number) => boolean };
      if (typeof owner.airJumpLive !== 'function') continue;
      if (owner.airJumpLive(this.ctx.clock.absoluteBeat)) return true;
    }
    return false;
  }

  private isOverGap(surface: TrackSurface = surfaceForGravity(this.gravityDirection)): boolean {    for (const m of this.mechanics) {
      if (!hasTerrain(m)) continue;
      if (surfaceFor(m, surfaceOf(m)) !== surface) continue;
      if (xOverGap(gapsOf(m), PLAYER_X)) return true;
    }
    return false;
  }

  /**
   * Everything solid around the player right now.
   *
   * The work is done by `resolveProbe` in the mechanics layer, so the live mode
   * and the traversal simulator resolve terrain with *the same code* rather than
   * two implementations that have to be kept in step by hand (spec §8). All this
   * does is gather the slabs on the player's current surface and hand them over.
   */
  private resolveTerrain(): TerrainProbe {
    const gravityDown = this.gravityDirection > 0;
    const surface = surfaceForGravity(this.gravityDirection);
    const platforms: Platform[] = [];
    for (const m of this.mechanics) {
      if (!hasTerrain(m)) continue;
      // A slab belongs to the surface the *mechanic* is on, which for a course
      // is whatever its own flip timeline says right now.
      if (surfaceFor(m, surfaceOf(m)) !== surface) continue;
      for (const plat of platformsOf(m)) {
        if (PLAYER_X < plat.x0 || PLAYER_X > plat.x1) continue;
        platforms.push(plat);
      }
    }
    return resolveProbe(platforms, {
      gravityDown,
      baseY: gravityDown ? GROUND_Y : CEILING_Y,
      feet: this.player.feet,
      head: this.player.head,
      reach: this.player.isGrounded ? TUNING.runner.stepUpHeight : 0,
      overGap: this.isOverGap(surface),
    });
  }

  /**
   * Pads fire on contact with the face they sit on, whichever surface that is.
   * Reading the pad's own y rather than the base surface means a pad can sit on
   * a platform -- which is how a chain climbs past a single jump's apex.
   */
  private applyBouncePads(secondsPerBeat: number): void {
    const g = this.gravityDirection;
    const gravityDown = g > 0;
    const surface = surfaceForGravity(g);
    const feet = this.player.feet;
    const body = this.player.body;
    for (const m of this.mechanics) {
      if (!hasTerrain(m)) continue;
      if (surfaceFor(m, surfaceOf(m)) !== surface) continue;
      for (const pad of padsOf(m)) {
        const padFace = gravityDown ? pad.rect.y : pad.rect.y + pad.rect.h;
        if (Math.abs(feet - padFace) > PAD_CAPTURE) continue;
        const overlapsX = body.x < pad.rect.x + pad.rect.w && body.x + body.w > pad.rect.x;
        if (!overlapsX) continue;
        this.player.launch(secondsPerBeat, pad.strength);
        this.ctx.feel.impact('MEDIUM', {
          x: pad.rect.x + pad.rect.w / 2, y: pad.rect.y,
          dirX: 0, dirY: gravityDown ? -1 : 1, colour: '#4dffd0', sfx: 'bounce',
        });
        return;
      }
    }
  }

  private resolveCollisions(u: MechanicUpdate): void {
    const beat = u.beat;
    // Falling out of the world counts as a hit, same as touching a spike.
    if (this.player.hasFallenOut) {
      if (this.ctx.status.damage('OBSTACLE', u.songTime)) {
        this.lastHitBeat = beat;
        this.ctx.feel.playerHit(PLAYER_X, this.player.surfaceY);
        this.ctx.feel.sfx('runner_fail');
      }
      this.player.reset(this.gravityDirection > 0 ? GROUND_Y : CEILING_Y);
      return;
    }

    const body = this.player.body;
    // Approximate the body with a circle so it reuses the shared shape tests.
    const probe: Circle = {
      x: body.x + body.w / 2,
      y: body.y + body.h / 2,
      r: Math.min(body.w, body.h) / 2,
    };
    const surface = surfaceForGravity(this.gravityDirection);
    for (const m of this.mechanics) {
      // An obstacle on the surface the player is not attached to is scenery.
      // A course declares its own live surface, so ask the mechanic rather than
      // trusting a static `surface` param.
      if (hasTerrain(m) && surfaceFor(m, surfaceOf(m)) !== surface) continue;
      if (!hasTerrain(m) && surfaceOf(m) !== surface) continue;
      for (const shape of m.hazards()) {
        if (!circleIntersectsShape(probe, shape)) continue;
        if (this.ctx.status.damage(m.damageSource, u.songTime)) {
          this.lastHitBeat = beat;
          this.ctx.feel.playerHit(probe.x, probe.y, -1, 0);
        }
        return;
      }
    }
  }

  render(r: Renderer): void {
    const beat = this.ctx.clock.visualBeat;
    const flipped = this.gravityDirection < 0;
    r.fillRect({ x: 0, y: 0, w: 1, h: 1 }, flipped ? SKY_CEILING : SKY_FLOOR);

    r.withFieldClip(() => {
      this.renderBackdrop(r, beat);
      this.renderTrack(r, beat);
      for (const m of this.mechanics) m.render(r);
      this.renderSpeedStreaks(r, beat);
      this.player.render(r, this.ctx.status.isInvulnerable(this.ctx.clock.songTime), beat);
      if (this.debug) {
        renderRunnerDebug(r, {
          probe: this.probe,
          gravityDirection: this.gravityDirection,
          player: this.player,
          breadcrumbs: this.breadcrumbs,
          beat,
          beatsPerBar: this.ctx.clock.beatsPerBar,
          mechanics: this.mechanics,
          phrase: this.phrase?.label,
          motif: this.phrase?.motif,
          phraseIntensity: this.phrase?.intensity,
          groundRatio: this.phrase?.groundRatio,
        });
      }
      const since = beat - this.lastHitBeat;
      if (since >= 0 && since <= 0.5) {
        r.fillRect({ x: 0, y: 0, w: 1, h: 1 }, '#ff3355', 0.25 * (1 - since / 0.5));
      }
    });
  }

  /**
   * The backdrop: everything the player is not allowed to read as geometry.
   *
   * The layers below are ordered by distance, and each is confined to what it can
   * safely do. The phrase mark is the farthest thing on screen and lives in the
   * dead band between the routes. The skyline hangs a fixed distance off the
   * running plane and is faded out before it reaches it. The drift dashes are the
   * nearest, and they carry the one piece of information the background is
   * allowed to state as fact: which way the world is pulling.
   *
   * None of them may use a surface colour, and none of them may use a colour of
   * its own. That is the whole contract between the two layers -- a colour the
   * player has learned means "you can land here" is never spent on anything they
   * cannot, and a colour that changes every four beats teaches them to stop
   * reading colour altogether.
   */
  private renderBackdrop(r: Renderer, beat: number): void {
    this.renderPhraseMark(r, beat);
    this.renderSkyline(r, beat);
    this.renderGravityDrift(r, beat);
  }

  /**
   * Where the current phrase begins, as one hairline.
   *
   * This is all that is left of the phrase's visual identity, and it is on
   * purpose. A motif used to be a *colour*: first a band along the running
   * surface, then a wash behind the level. Both asked the player to spend
   * attention on a hue that never changed what they should do -- and the second
   * one still repainted the screen up to six times a minute, which is the same
   * noise at lower volume.
   *
   * What survives is the part that is actually information: the downbeat of a
   * new phrase is a real event, it lands on a beat, and it is worth one mark.
   * The mark states *when*, never *which*, so it needs no palette at all.
   */
  private renderPhraseMark(r: Renderer, beat: number): void {
    const phrase = this.phrase;
    if (!phrase) return;
    const x = PLAYER_X + (phrase.startBeat - beat) * UNITS_PER_BEAT;
    if (x <= -0.02 || x >= 1.02) return;
    r.line(x, MARK_TOP, x, MARK_BOTTOM, MARK_COLOUR, 1.5, 0.22);
  }

  /**
   * The parallax skyline, hanging off the running plane rather than standing on
   * it.
   *
   * The old layers were rows of blocks whose bottom edge sat exactly *on* the
   * live surface, aligned with real geometry and lit from the same direction, so
   * the decoration stood on the floor in the same posture as a platform and read
   * as something to jump. They now start a fixed distance above the plane, shrink
   * and dim with depth, and fade to nothing at the bottom, so there is no edge
   * anywhere near the surface to mistake for one.
   *
   * The layer with the fastest scroll is the nearest, so it is the largest,
   * the brightest and the closest to the plane -- and because the whole skyline
   * is measured from the *live* surface, an inversion turns the backdrop over
   * with the world.
   */
  private renderSkyline(r: Renderer, beat: number): void {
    const dir = this.gravityDirection > 0 ? -1 : 1;
    const surface = this.gravityDirection > 0 ? GROUND_Y : CEILING_Y;
    const shades = ['#141d31', '#1a2440', '#22304f'];
    const fastest = Math.max(...TUNING.runner.parallax);
    TUNING.runner.parallax.forEach((factor, layer) => {
      // `parallax` is ordered slowest-first, and scroll speed *is* depth: the
      // fastest layer is the nearest one, so it is the largest, the brightest
      // and the closest to the plane. Everything below is derived from that one
      // number rather than from the array index, so the two can never drift
      // apart into a layer that scrolls like a backdrop and is lit like a ledge.
      const near = factor / fastest;
      const spacing = 0.24 + near * 0.1;
      const offset = ((beat * UNITS_PER_BEAT * factor) % spacing + spacing) % spacing;
      const height = 0.05 + near * 0.05;
      // How far the base of this layer sits off the running plane. `SKYLINE_CLEAR`
      // is 1.5x the player's standing height: far enough that nothing in the
      // backdrop can be inside the player's own silhouette while they run, which
      // is what makes a block read as scenery instead of as an obstacle.
      const back = SKYLINE_CLEAR + (1 - near) * 0.06;
      const base = surface + dir * back;
      const alpha = 0.2 + near * 0.22;
      const top = dir < 0 ? base - height : base;
      const body = { y: top, w: spacing * 0.42, h: height };
      // Fade out toward the running plane, so a layer ends in the dark rather
      // than at a line the player could read as an edge to land on.
      const stops: Array<[number, string]> = dir < 0
        ? [[0, shades[layer]], [0.55, shades[layer]], [1, 'transparent']]
        : [[0, 'transparent'], [0.45, shades[layer]], [1, shades[layer]]];
      for (let x = -offset; x < 1.05; x += spacing) {
        r.gradientRect({ ...body, x }, stops, alpha);
      }
    });
  }

  /**
   * Which way the world is pulling, as motion.
   *
   * The track already says it with colour and the flip gate says it with an
   * arrow, but both are statements about the *world*; this is the only cue that
   * is a statement about the player -- the field itself streaming past them in
   * the direction they are about to fall. Cheap, and it inverts with gravity.
   */
  private renderGravityDrift(r: Renderer, beat: number): void {
    const dir = this.gravityDirection;
    const surface = dir > 0 ? GROUND_Y : CEILING_Y;
    for (let i = 0; i < 7; i++) {
      const phase = (beat * 1.5 + i * 0.31) % 1;
      const y = surface - dir * (0.08 + phase * 0.34);
      if (y < CEILING_Y || y > GROUND_Y) continue;
      const x = 0.06 + ((i * 0.137 + beat * 0.02) % 1) * 0.88;
      r.line(x, y, x, y + dir * 0.03, MARK_COLOUR, 1, 0.16 * (1 - phase));
    }
  }

  /**
   * The two running surfaces, and the rhythm ruler laid along the live one.
   *
   * The floor and the ceiling are one body colour, one edge colour and one
   * thickness each, all frame, every frame. Nothing in the level may recolour
   * either of them: the hue is `SURFACE_COLOUR` for the surface, which is also
   * the colour every slab's landing face is drawn in, so a bright blue line
   * means "gravity puts you here" and never anything else. Which of the two is
   * bright is the whole gravity read.
   */
  private renderTrack(r: Renderer, beat: number): void {
    const flipped = this.gravityDirection < 0;
    // The *live* surface is bright; the inactive one is a ghost. This is the
    // single most important read during a flip.
    const groundAlpha = flipped ? 0.3 : 1;
    const ceilingAlpha = flipped ? 1 : 0.3;

    r.fillRect({ x: 0, y: GROUND_Y, w: 1, h: 1 - GROUND_Y }, TRACK_BODY, groundAlpha);
    r.line(0, GROUND_Y, 1, GROUND_Y, SURFACE_COLOUR.FLOOR, flipped ? 1.5 : 3, groundAlpha);
    r.fillRect({ x: 0, y: 0, w: 1, h: CEILING_Y }, TRACK_BODY, ceilingAlpha);
    r.line(0, CEILING_Y, 1, CEILING_Y, SURFACE_COLOUR.CEILING, flipped ? 3 : 1.5, ceilingAlpha);

    // Beat ticks scrolling with the track: a visible metronome on the surface.
    // They are drawn *into* the body of the live surface, below its edge, so
    // they read as a ruler on the ground rather than as marks standing on it --
    // which is the whole difference between rhythm feedback and an obstacle.
    const beatsPerBar = this.ctx.clock.beatsPerBar;
    const surface = this.gravityDirection > 0 ? GROUND_Y : CEILING_Y;
    const dir = this.gravityDirection > 0 ? 1 : -1;
    for (let i = -1; i < 10; i++) {
      const tickBeat = Math.floor(beat) + i;
      const x = PLAYER_X + (tickBeat - beat) * UNITS_PER_BEAT;
      if (x < -0.05 || x > 1.05) continue;
      const downbeat = ((tickBeat % beatsPerBar) + beatsPerBar) % beatsPerBar === 0;
      r.line(x, surface, x, surface + dir * (downbeat ? 0.055 : 0.028), '#4a5a80', downbeat ? 2 : 1, 0.8);
    }

    // The player's lane, so timing reads against a fixed reference.
    r.line(PLAYER_X, 0, PLAYER_X, 1, '#6de3ff', 1, 0.12);

    // The reachable envelope: how high a jump from the current surface gets.
    // This is the single most useful read in a platforming sequence -- it says
    // "this is the highest thing you can land on from here" without a tutorial.
    if (this.debug) {
      const apex = this.probe.support === null
        ? null
        : this.probe.support - this.gravityDirection * (TUNING.runner.jumpHeight + BODY_HEIGHT);
      if (apex !== null) {
        r.line(0, apex, 1, apex, '#6de3ff', 1, 0.3);
        r.text('jump apex', 0.99, apex - 0.022, '#6de3ff', 10, 'right', 0.5);
      }
    }
  }

  /** Horizontal streaks behind the player while airborne -- pure speed cue. */
  private renderSpeedStreaks(r: Renderer, beat: number): void {
    const body = this.player.body;
    const cy = body.y + body.h / 2;
    for (let i = 0; i < 5; i++) {
      const phase = (beat * 3 + i * 0.37) % 1;
      const x = PLAYER_X - 0.04 - phase * 0.4;
      if (x < -0.05) continue;
      const y = clamp(cy + (i - 2) * 0.022, 0.02, 0.98);
      r.line(x, y, x + 0.05, y, '#6de3ff', 1, 0.14 * (1 - phase));
    }
  }

  get activeMechanicCount(): number {
    return this.mechanics.length;
  }

  get statusLine(): string {
    const g = this.gravityDirection < 0 ? 'CEILING' : 'FLOOR';
    const air = this.player.isGrounded ? 'ground' : 'air';
    return `RUNNER  obstacles:${this.mechanics.length}  jumps:${this.jumps}  ${air}  gravity:${g}  last:${this.lastPatternId}`;
  }
}

/** Track units one beat of scroll covers -- re-exported for the debug view. */
export const RUNNER_UNITS_PER_BEAT = beatsToUnits(1);

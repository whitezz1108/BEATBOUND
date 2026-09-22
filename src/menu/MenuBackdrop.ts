/**
 * Title-screen backdrop.
 *
 * A dimmed, looping montage of the game's own patterns -- one vignette per
 * mode, cross-fading every few bars -- drawn behind the menu, plus the hero
 * character in its own small canvas above the logotype. Pure canvas 2D; it
 * reads nothing from and writes nothing to the running game.
 */

import { MODE_COLOURS } from '../core/ModeManager';

/** How long each mode's vignette stays on screen. */
const SCENE_SECONDS = 9;
const FADE_SECONDS = 1.4;
/** Visual-only tempo for the pulse; the menu plays no audio. */
const BPM = 124;

interface Scene {
  colour: string;
  draw(c: CanvasRenderingContext2D, w: number, h: number, t: number, beat: number, mx: number, my: number): void;
}

/** Sharp attack, fast decay -- reads as a kick drum. */
function pulse(beat: number): number {
  return (1 - beat) * (1 - beat);
}

function arenaScene(): Scene {
  const bullets = Array.from({ length: 16 }, (_, i) => ({
    y: ((i * 0.618) % 1) * 0.84 + 0.08,
    speed: 0.055 + ((i * 0.37) % 0.075),
    x0: (i * 0.317) % 1,
    r: 1.6 + (i % 3),
  }));
  return {
    colour: MODE_COLOURS.ARENA,
    draw(c, w, h, t, beat, mx, my) {
      const cx = w / 2 + mx * 0.4;
      const cy = h * 0.52 + my * 0.4;
      // Two dashed field rings rotating in opposite directions.
      for (const [radius, phase, dash, dir] of [
        [h * 0.17, 0, 26, 1],
        [h * 0.27, 1.7, 44, -1],
      ] as const) {
        c.save();
        c.translate(cx, cy);
        c.rotate(t * 0.14 * dir + phase);
        c.setLineDash([dash, dash * 0.62]);
        c.globalAlpha = 0.2;
        c.strokeStyle = this.colour;
        c.lineWidth = 1.5;
        c.beginPath();
        c.arc(0, 0, radius, 0, Math.PI * 2);
        c.stroke();
        c.restore();
      }
      // A ring that expands away on every beat.
      c.globalAlpha = 0.28 * (1 - beat);
      c.strokeStyle = this.colour;
      c.lineWidth = 2;
      c.beginPath();
      c.arc(cx, cy, h * 0.13 + beat * h * 0.11, 0, Math.PI * 2);
      c.stroke();
      // Bullet streams crossing the field.
      c.fillStyle = this.colour;
      for (const b of bullets) {
        const x = (((b.x0 + t * b.speed) % 1.2) - 0.1) * w;
        c.globalAlpha = 0.42;
        c.beginPath();
        c.arc(x, b.y * h + my * 0.2, b.r, 0, Math.PI * 2);
        c.fill();
      }
    },
  };
}

function runnerScene(): Scene {
  const SPEED = 180; // px/s scroll
  const SPACING = 260; // px between low walls
  const PERIOD = SPACING / SPEED; // one hop per wall
  const JUMP_HEIGHT = 58;
  return {
    colour: MODE_COLOURS.RUNNER,
    draw(c, w, h, t, _beat, mx, my) {
      const groundY = h * 0.72 + my * 0.2;
      const jumperX = w * 0.42 + mx * 0.3;
      // Ground line with scrolling tick marks.
      c.strokeStyle = this.colour;
      c.lineWidth = 1.5;
      c.globalAlpha = 0.3;
      c.beginPath();
      c.moveTo(0, groundY);
      c.lineTo(w, groundY);
      c.stroke();
      c.globalAlpha = 0.18;
      const tickOffset = ((t * SPEED) % 80 + 80) % 80;
      for (let x = -tickOffset; x < w; x += 80) {
        c.beginPath();
        c.moveTo(x, groundY + 6);
        c.lineTo(x + 14, groundY + 6);
        c.stroke();
      }
      // Low walls, and the ghost runner hopping exactly one per wall.
      const p = ((t / PERIOD) % 1 + 1) % 1;
      c.globalAlpha = 0.42;
      c.fillStyle = this.colour;
      for (let n = -1; n <= Math.ceil(w / SPACING) + 1; n++) {
        const x = jumperX + 30 + (0.5 - p + n) * SPACING;
        if (x < -30 || x > w + 30) continue;
        c.fillRect(x - 9, groundY - 34, 18, 34);
      }
      const size = 15;
      const airborne = p > 0.5 && p < 1;
      const jump = airborne ? Math.sin((Math.PI * (p - 0.5)) / 0.5) * JUMP_HEIGHT : 0;
      const jy = groundY - jump - size;
      c.globalAlpha = 0.16;
      c.fillRect(jumperX - size / 2, jy, size, size);
      c.globalAlpha = 0.6;
      c.strokeStyle = '#ffffff';
      c.lineWidth = 2;
      c.strokeRect(jumperX - size / 2, jy, size, size);
    },
  };
}

function verticalScene(): Scene {
  const LANES = 7;
  const CYCLE = 2.3; // seconds for a note to cross the screen
  return {
    colour: MODE_COLOURS.VERTICAL,
    draw(c, w, h, t, beat, _mx, my) {
      const left = w * 0.2;
      const right = w * 0.8;
      const laneW = (right - left) / LANES;
      const hitY = h * 0.78 + my * 0.2;
      // Lanes.
      c.strokeStyle = this.colour;
      c.lineWidth = 1;
      c.globalAlpha = 0.12;
      for (let i = 0; i <= LANES; i++) {
        const x = left + i * laneW;
        c.beginPath();
        c.moveTo(x, 0);
        c.lineTo(x, hitY);
        c.stroke();
      }
      // Falling notes, three per lane, staggered.
      c.fillStyle = this.colour;
      for (let i = 0; i < LANES; i++) {
        for (let k = 0; k < 3; k++) {
          const p = ((t / CYCLE + i * 0.13 + k / 3) % 1 + 1) % 1;
          const y = p * hitY;
          c.globalAlpha = 0.3 * Math.min(1, (1 - p) * 6 + 0.4);
          c.fillRect(left + i * laneW + laneW * 0.22, y - 6, laneW * 0.56, 11);
        }
      }
      // Judgment line, glowing on the beat.
      c.globalAlpha = 0.3 + 0.5 * pulse(beat);
      c.lineWidth = 2;
      c.beginPath();
      c.moveTo(left, hitY);
      c.lineTo(right, hitY);
      c.stroke();
    },
  };
}

function radialScene(): Scene {
  return {
    colour: MODE_COLOURS.RADIAL,
    draw(c, w, h, t, beat, mx, my) {
      const cx = w / 2 + mx * 0.4;
      const cy = h * 0.52 + my * 0.4;
      const r = h * 0.2;
      c.strokeStyle = this.colour;
      c.globalAlpha = 0.26;
      c.lineWidth = 1.5;
      c.beginPath();
      c.arc(cx, cy, r, 0, Math.PI * 2);
      c.stroke();
      // Eight spokes, slowly rotating.
      c.globalAlpha = 0.3;
      for (let i = 0; i < 8; i++) {
        const a = (i * Math.PI) / 4 + t * 0.12;
        c.beginPath();
        c.moveTo(cx + Math.cos(a) * r * 0.45, cy + Math.sin(a) * r * 0.45);
        c.lineTo(cx + Math.cos(a) * r * 0.85, cy + Math.sin(a) * r * 0.85);
        c.stroke();
      }
      // Dots orbiting the ring in both directions.
      c.fillStyle = this.colour;
      for (const [radius, count, speed, phase] of [
        [r * 0.65, 3, 0.55, 0],
        [r * 1.05, 3, -0.38, 1.1],
      ] as const) {
        for (let i = 0; i < count; i++) {
          const a = (i * Math.PI * 2) / count + t * speed + phase;
          c.globalAlpha = 0.5;
          c.beginPath();
          c.arc(cx + Math.cos(a) * radius, cy + Math.sin(a) * radius, 2.5, 0, Math.PI * 2);
          c.fill();
        }
      }
      // Centre core pulsing on the beat.
      c.globalAlpha = 0.4 + 0.4 * pulse(beat);
      c.beginPath();
      c.arc(cx, cy, 4 + beat * 3, 0, Math.PI * 2);
      c.fill();
    },
  };
}

export interface MenuBackdrop {
  /** Tint the hero + accents (switched by the selected mode card). */
  setAccent(colour: string): void;
  start(): void;
  stop(): void;
}

/**
 * @param bg full-bleed backdrop canvas (sized to its offset parent)
 * @param hero the small hero-character canvas above the logotype
 */
export function createMenuBackdrop(bg: HTMLCanvasElement, hero: HTMLCanvasElement): MenuBackdrop {
  const bgCtx = bg.getContext('2d');
  const heroCtx = hero.getContext('2d');
  if (!bgCtx || !heroCtx) return { setAccent() {}, start() {}, stop() {} };
  const c: CanvasRenderingContext2D = bgCtx;
  const hc: CanvasRenderingContext2D = heroCtx;

  const scenes: Scene[] = [arenaScene(), runnerScene(), verticalScene(), radialScene()];
  const HERO = 108;

  let raf = 0;
  let running = false;
  let accent = MODE_COLOURS.ARENA;
  let w = 0;
  let h = 0;
  let mx = 0;
  let my = 0;
  let tx = 0;
  let ty = 0;
  const trail: { x: number; y: number }[] = [];

  const dpr = () => Math.min(2, window.devicePixelRatio || 1);

  function resize(): void {
    const parent = bg.parentElement;
    const cw = parent?.clientWidth ?? window.innerWidth;
    const ch = parent?.clientHeight ?? window.innerHeight;
    const ratio = dpr();
    bg.width = Math.max(1, Math.round(cw * ratio));
    bg.height = Math.max(1, Math.round(ch * ratio));
    c.setTransform(ratio, 0, 0, ratio, 0, 0);
    w = cw;
    h = ch;
    hero.width = Math.round(HERO * ratio);
    hero.height = Math.round(HERO * ratio);
    hc.setTransform(ratio, 0, 0, ratio, 0, 0);
  }

  function drawGrid(): void {
    c.save();
    c.strokeStyle = '#182238';
    c.globalAlpha = 0.32;
    c.lineWidth = 1;
    const step = 56;
    const ox = ((mx * 0.5) % step + step) % step;
    for (let x = -step + ox; x < w + step; x += step) {
      c.beginPath();
      c.moveTo(x, 0);
      c.lineTo(x, h);
      c.stroke();
    }
    for (let y = -step + oy(); y < h + step; y += step) {
      c.beginPath();
      c.moveTo(0, y);
      c.lineTo(w, y);
      c.stroke();
    }
    c.restore();
  }

  function oy(): number {
    return ((my * 0.5) % 56 + 56) % 56;
  }

  function drawVignette(): void {
    const g = c.createRadialGradient(w / 2, h * 0.45, h * 0.2, w / 2, h * 0.45, Math.max(w, h) * 0.72);
    g.addColorStop(0, 'rgba(5, 7, 13, 0)');
    g.addColorStop(1, 'rgba(5, 7, 13, 0.88)');
    c.fillStyle = g;
    c.fillRect(0, 0, w, h);
  }

  function drawScenes(t: number, beat: number): void {
    const total = scenes.length * SCENE_SECONDS;
    const tt = ((t % total) + total) % total;
    const idx = Math.floor(tt / SCENE_SECONDS);
    const local = tt % SCENE_SECONDS;
    const render = (scene: Scene, fade: number) => {
      c.save();
      c.globalAlpha = fade;
      scene.draw(c, w, h, t, beat, mx, my);
      c.restore();
    };
    render(scenes[idx]!, 1);
    if (local > SCENE_SECONDS - FADE_SECONDS) {
      const k = (local - (SCENE_SECONDS - FADE_SECONDS)) / FADE_SECONDS;
      render(scenes[(idx + 1) % scenes.length]!, k);
    }
  }

  function drawHero(t: number, beat: number): void {
    hc.clearRect(0, 0, HERO, HERO);
    const bob = Math.sin(t * 2.1) * 5;
    const sway = Math.sin(t * 0.7) * 12;
    const cx = HERO / 2 + sway;
    const cy = HERO / 2 + 4 + bob;
    trail.push({ x: cx, y: cy });
    if (trail.length > 14) trail.shift();
    // Motion trail of fading ghosts, then the glow, then the body -- the same
    // white square with a coloured stroke the runner draws in-game.
    const size = 26 * (1 + pulse(beat) * 0.05);
    hc.fillStyle = accent;
    for (let i = 0; i < trail.length - 1; i++) {
      const p = trail[i]!;
      hc.globalAlpha = (i / trail.length) * 0.16;
      hc.fillRect(p.x - size / 2, p.y - size / 2, size, size);
    }
    const g = hc.createRadialGradient(cx, cy, 2, cx, cy, 44);
    g.addColorStop(0, accent);
    g.addColorStop(1, 'rgba(5, 7, 13, 0)');
    hc.globalAlpha = 0.35 + pulse(beat) * 0.25;
    hc.fillStyle = g;
    hc.beginPath();
    hc.arc(cx, cy, 44, 0, Math.PI * 2);
    hc.fill();
    hc.globalAlpha = 1;
    hc.fillStyle = '#ffffff';
    hc.fillRect(cx - size / 2, cy - size / 2, size, size);
    hc.strokeStyle = accent;
    hc.lineWidth = 3;
    hc.strokeRect(cx - size / 2, cy - size / 2, size, size);
  }

  function frame(now: number): void {
    const t = now / 1000;
    const beat = ((t * BPM) / 60) % 1;
    mx += (tx - mx) * 0.04;
    my += (ty - my) * 0.04;
    c.fillStyle = '#05070d';
    c.fillRect(0, 0, w, h);
    drawGrid();
    drawScenes(t, beat);
    drawVignette();
    drawHero(t, beat);
    raf = requestAnimationFrame(frame);
  }

  function onMouseMove(e: MouseEvent): void {
    tx = (e.clientX / window.innerWidth - 0.5) * 26;
    ty = (e.clientY / window.innerHeight - 0.5) * 18;
  }

  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

  return {
    setAccent(colour: string): void {
      accent = colour;
    },
    start(): void {
      if (running) return;
      running = true;
      resize();
      window.addEventListener('resize', resize);
      window.addEventListener('mousemove', onMouseMove);
      if (reducedMotion.matches) {
        // One static composition instead of the loop.
        c.fillStyle = '#05070d';
        c.fillRect(0, 0, w, h);
        drawGrid();
        drawScenes(6, 0);
        drawVignette();
        drawHero(1.2, 0);
        running = false;
        return;
      }
      raf = requestAnimationFrame(frame);
    },
    stop(): void {
      if (!running) return;
      running = false;
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', resize);
      window.removeEventListener('mousemove', onMouseMove);
    },
  };
}

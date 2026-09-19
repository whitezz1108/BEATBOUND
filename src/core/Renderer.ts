/**
 * Canvas drawing in field space (see geometry.ts).
 *
 * Every mode and mechanic draws through this, so none of them ever touch pixel
 * coordinates or the canvas element directly.
 */

import type { Rect } from './geometry';

export class Renderer {
  /** Pixels per field unit. */
  scale = 1;
  /** Pixel offset of field origin (0,0). */
  originX = 0;
  originY = 0;

  constructor(readonly ctx: CanvasRenderingContext2D) {}

  /** Recompute the letterboxed square viewport for the current canvas size. */
  layout(canvasWidth: number, canvasHeight: number, marginPx = 24): void {
    const size = Math.max(32, Math.min(canvasWidth, canvasHeight) - marginPx * 2);
    this.scale = size;
    this.originX = (canvasWidth - size) / 2;
    this.originY = (canvasHeight - size) / 2;
  }

  px(fx: number): number { return this.originX + fx * this.scale; }
  py(fy: number): number { return this.originY + fy * this.scale; }
  len(f: number): number { return f * this.scale; }

  /**
   * Run `draw` clipped to the field square. Mechanics legitimately position
   * things just outside the field (a projectile about to enter), and without
   * this they would paint over the letterbox.
   */
  withFieldClip(draw: () => void): void {
    const c = this.ctx;
    c.save();
    c.beginPath();
    c.rect(this.originX, this.originY, this.scale, this.scale);
    c.clip();
    draw();
    c.restore();
  }

  clear(width: number, height: number, style: string): void {
    this.ctx.fillStyle = style;
    this.ctx.fillRect(0, 0, width, height);
  }

  fillRect(r: Rect, style: string, alpha = 1): void {
    const c = this.ctx;
    c.save();
    c.globalAlpha *= alpha;
    c.fillStyle = style;
    c.fillRect(this.px(r.x), this.py(r.y), this.len(r.w), this.len(r.h));
    c.restore();
  }

  strokeRect(r: Rect, style: string, widthPx = 2, alpha = 1, dash: number[] = []): void {
    const c = this.ctx;
    c.save();
    c.globalAlpha *= alpha;
    c.strokeStyle = style;
    c.lineWidth = widthPx;
    c.setLineDash(dash);
    c.strokeRect(this.px(r.x), this.py(r.y), this.len(r.w), this.len(r.h));
    c.restore();
  }

  fillCircle(x: number, y: number, r: number, style: string, alpha = 1): void {
    const c = this.ctx;
    c.save();
    c.globalAlpha *= alpha;
    c.fillStyle = style;
    c.beginPath();
    c.arc(this.px(x), this.py(y), this.len(r), 0, Math.PI * 2);
    c.fill();
    c.restore();
  }

  strokeCircle(x: number, y: number, r: number, style: string, widthPx = 2, alpha = 1): void {
    const c = this.ctx;
    c.save();
    c.globalAlpha *= alpha;
    c.strokeStyle = style;
    c.lineWidth = widthPx;
    c.beginPath();
    c.arc(this.px(x), this.py(y), this.len(r), 0, Math.PI * 2);
    c.stroke();
    c.restore();
  }

  line(x1: number, y1: number, x2: number, y2: number, style: string, widthPx = 2, alpha = 1): void {
    const c = this.ctx;
    c.save();
    c.globalAlpha *= alpha;
    c.strokeStyle = style;
    c.lineWidth = widthPx;
    c.beginPath();
    c.moveTo(this.px(x1), this.py(y1));
    c.lineTo(this.px(x2), this.py(y2));
    c.stroke();
    c.restore();
  }

  /** Text positioned in field space, sized in pixels. */
  text(
    value: string,
    fx: number,
    fy: number,
    style: string,
    sizePx = 14,
    align: CanvasTextAlign = 'center',
    alpha = 1,
  ): void {
    const c = this.ctx;
    c.save();
    c.globalAlpha *= alpha;
    c.fillStyle = style;
    c.font = `600 ${sizePx}px ui-monospace, SFMono-Regular, Menlo, monospace`;
    c.textAlign = align;
    c.textBaseline = 'middle';
    c.fillText(value, this.px(fx), this.py(fy));
    c.restore();
  }
}

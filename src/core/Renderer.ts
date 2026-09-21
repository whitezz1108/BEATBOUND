/**
 * Canvas drawing in field space (see geometry.ts).
 *
 * Every mode and mechanic draws through this, so none of them ever touch pixel
 * coordinates or the canvas element directly.
 *
 * The renderer also owns the camera: a zoom/offset applied around the field
 * centre. Modes and mechanics keep drawing in plain field coordinates and the
 * camera moves underneath them, so a beat pulse or an impact kick never has to
 * be threaded through gameplay code.
 */

import type { Rect } from './geometry';

export class Renderer {
  /** Pixels per field unit, before camera zoom. */
  scale = 1;
  /** Pixel offset of field origin (0,0), before camera. */
  originX = 0;
  originY = 0;

  /** Camera state, applied by px()/py()/len(). */
  private zoom = 1;
  private shakeX = 0;
  private shakeY = 0;
  /** Global alpha multiplier for the current layer. */
  private layerAlpha = 1;

  constructor(readonly ctx: CanvasRenderingContext2D) {}

  /** Recompute the letterboxed square viewport for the current canvas size. */
  layout(canvasWidth: number, canvasHeight: number, marginPx = 24): void {
    const size = Math.max(32, Math.min(canvasWidth, canvasHeight) - marginPx * 2);
    this.scale = size;
    this.originX = (canvasWidth - size) / 2;
    this.originY = (canvasHeight - size) / 2;
  }

  /** Set the camera for this frame. `shake` is in field units. */
  setCamera(zoom: number, shakeXField: number, shakeYField: number): void {
    this.zoom = zoom;
    this.shakeX = shakeXField;
    this.shakeY = shakeYField;
  }

  resetCamera(): void {
    this.setCamera(1, 0, 0);
  }

  /** Field x -> pixels, through the camera (zoom is about the field centre). */
  px(fx: number): number {
    return this.originX + (0.5 + (fx + this.shakeX - 0.5) * this.zoom) * this.scale;
  }

  py(fy: number): number {
    return this.originY + (0.5 + (fy + this.shakeY - 0.5) * this.zoom) * this.scale;
  }

  len(f: number): number {
    return f * this.scale * this.zoom;
  }

  /** Multiply alpha for everything drawn inside `draw`. */
  withAlpha(alpha: number, draw: () => void): void {
    const previous = this.layerAlpha;
    this.layerAlpha *= alpha;
    draw();
    this.layerAlpha = previous;
  }

  private a(alpha: number): number {
    return Math.max(0, Math.min(1, alpha * this.layerAlpha));
  }

  clear(width: number, height: number, style: string): void {
    this.ctx.fillStyle = style;
    this.ctx.fillRect(0, 0, width, height);
  }

  /**
   * Run `draw` clipped to the field square. Mechanics legitimately position
   * things just outside the field (a projectile about to enter), and without
   * this they would paint over the letterbox.
   */
  withFieldClip(draw: () => void): void {
    const c = this.ctx;
    c.save();
    c.beginPath();
    c.rect(this.px(0), this.py(0), this.len(1), this.len(1));
    c.clip();
    draw();
    c.restore();
  }

  /**
   * Run `draw` rotated by `angle` radians about the field point `(cx, cy)`.
   *
   * The callback still draws in ordinary field coordinates, so a rotated body
   * is the same `fillRect` call wrapped, not a second coordinate system the
   * caller has to reason about. Rotation is rare (a somersault, a spinning
   * hazard), which is why it is a wrapper rather than a parameter on
   * everything.
   */
  withRotation(cx: number, cy: number, angle: number, draw: () => void): void {
    const c = this.ctx;
    c.save();
    c.translate(this.px(cx), this.py(cy));
    c.rotate(angle);
    c.translate(-this.px(cx), -this.py(cy));
    draw();
    c.restore();
  }

  fillRect(r: Rect, style: string, alpha = 1): void {
    const c = this.ctx;
    c.save();
    c.globalAlpha = this.a(alpha);
    c.fillStyle = style;
    c.fillRect(this.px(r.x), this.py(r.y), this.len(r.w), this.len(r.h));
    c.restore();
  }

  strokeRect(r: Rect, style: string, widthPx = 2, alpha = 1, dash: number[] = []): void {
    const c = this.ctx;
    c.save();
    c.globalAlpha = this.a(alpha);
    c.strokeStyle = style;
    c.lineWidth = widthPx;
    c.setLineDash(dash);
    c.strokeRect(this.px(r.x), this.py(r.y), this.len(r.w), this.len(r.h));
    c.restore();
  }

  fillCircle(x: number, y: number, r: number, style: string, alpha = 1): void {
    const c = this.ctx;
    c.save();
    c.globalAlpha = this.a(alpha);
    c.fillStyle = style;
    c.beginPath();
    c.arc(this.px(x), this.py(y), Math.max(0, this.len(r)), 0, Math.PI * 2);
    c.fill();
    c.restore();
  }

  strokeCircle(x: number, y: number, r: number, style: string, widthPx = 2, alpha = 1, dash: number[] = []): void {
    const c = this.ctx;
    c.save();
    c.globalAlpha = this.a(alpha);
    c.strokeStyle = style;
    c.lineWidth = widthPx;
    c.setLineDash(dash);
    c.beginPath();
    c.arc(this.px(x), this.py(y), Math.max(0, this.len(r)), 0, Math.PI * 2);
    c.stroke();
    c.restore();
  }

  /** Stroked arc. Angles in radians, 0 = +x, increasing clockwise on screen. */
  strokeArc(
    cx: number, cy: number, radius: number,
    startAngle: number, endAngle: number,
    style: string, widthPx = 2, alpha = 1,
  ): void {
    const c = this.ctx;
    c.save();
    c.globalAlpha = this.a(alpha);
    c.strokeStyle = style;
    c.lineWidth = widthPx;
    c.lineCap = 'butt';
    c.beginPath();
    c.arc(this.px(cx), this.py(cy), Math.max(0, this.len(radius)), startAngle, endAngle);
    c.stroke();
    c.restore();
  }

  /** Filled annular sector -- the shape radial attacks are made of. */
  fillAnnulusSector(
    cx: number, cy: number,
    innerRadius: number, outerRadius: number,
    startAngle: number, endAngle: number,
    style: string, alpha = 1,
  ): void {
    const c = this.ctx;
    c.save();
    c.globalAlpha = this.a(alpha);
    c.fillStyle = style;
    c.beginPath();
    c.arc(this.px(cx), this.py(cy), Math.max(0, this.len(outerRadius)), startAngle, endAngle);
    c.arc(this.px(cx), this.py(cy), Math.max(0, this.len(innerRadius)), endAngle, startAngle, true);
    c.closePath();
    c.fill();
    c.restore();
  }

  line(x1: number, y1: number, x2: number, y2: number, style: string, widthPx = 2, alpha = 1, dash: number[] = []): void {
    const c = this.ctx;
    c.save();
    c.globalAlpha = this.a(alpha);
    c.strokeStyle = style;
    c.lineWidth = widthPx;
    c.setLineDash(dash);
    c.lineCap = 'round';
    c.beginPath();
    c.moveTo(this.px(x1), this.py(y1));
    c.lineTo(this.px(x2), this.py(y2));
    c.stroke();
    c.restore();
  }

  /** Closed polygon from field-space points. */
  fillPolygon(points: Array<{ x: number; y: number }>, style: string, alpha = 1): void {
    if (points.length < 3) return;
    const c = this.ctx;
    c.save();
    c.globalAlpha = this.a(alpha);
    c.fillStyle = style;
    c.beginPath();
    c.moveTo(this.px(points[0].x), this.py(points[0].y));
    for (let i = 1; i < points.length; i++) c.lineTo(this.px(points[i].x), this.py(points[i].y));
    c.closePath();
    c.fill();
    c.restore();
  }

  /** Open polyline -- note trails, drift-hold paths, chain links. */
  polyline(points: Array<{ x: number; y: number }>, style: string, widthPx = 2, alpha = 1): void {
    if (points.length < 2) return;
    const c = this.ctx;
    c.save();
    c.globalAlpha = this.a(alpha);
    c.strokeStyle = style;
    c.lineWidth = widthPx;
    c.lineJoin = 'round';
    c.lineCap = 'round';
    c.beginPath();
    c.moveTo(this.px(points[0].x), this.py(points[0].y));
    for (let i = 1; i < points.length; i++) c.lineTo(this.px(points[i].x), this.py(points[i].y));
    c.stroke();
    c.restore();
  }

  /** Linear-gradient fill of a field-space rect, running top-to-bottom (or left-to-right). */
  gradientRect(
    r: Rect, stops: Array<[offset: number, colour: string]>, alpha = 1, horizontal = false,
  ): void {
    const c = this.ctx;
    const x0 = this.px(r.x);
    const y0 = this.py(r.y);
    const x1 = horizontal ? this.px(r.x + r.w) : x0;
    const y1 = horizontal ? y0 : this.py(r.y + r.h);
    const gradient = c.createLinearGradient(x0, y0, x1, y1);
    for (const [at, colour] of stops) gradient.addColorStop(at, colour);
    c.save();
    c.globalAlpha = this.a(alpha);
    c.fillStyle = gradient;
    c.fillRect(x0, y0, this.len(r.w), this.len(r.h));
    c.restore();
  }

  /** Soft radial glow. Used sparingly -- it is the most expensive call here. */
  glow(x: number, y: number, radius: number, style: string, alpha = 1): void {
    const c = this.ctx;
    const r = Math.max(1, this.len(radius));
    const gx = this.px(x);
    const gy = this.py(y);
    const gradient = c.createRadialGradient(gx, gy, 0, gx, gy, r);
    gradient.addColorStop(0, style);
    gradient.addColorStop(1, 'transparent');
    c.save();
    c.globalAlpha = this.a(alpha);
    c.fillStyle = gradient;
    c.beginPath();
    c.arc(gx, gy, r, 0, Math.PI * 2);
    c.fill();
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
    c.globalAlpha = this.a(alpha);
    c.fillStyle = style;
    c.font = `600 ${sizePx}px ui-monospace, SFMono-Regular, Menlo, monospace`;
    c.textAlign = align;
    c.textBaseline = 'middle';
    c.fillText(value, this.px(fx), this.py(fy));
    c.restore();
  }

  /** Screen-space fill, ignoring the camera. For flashes and vignettes. */
  fillScreen(width: number, height: number, style: string, alpha = 1): void {
    const c = this.ctx;
    c.save();
    c.globalAlpha = this.a(alpha);
    c.fillStyle = style;
    c.fillRect(0, 0, width, height);
    c.restore();
  }
}

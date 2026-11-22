import { PixelBuffer } from "../document/PixelBuffer.ts";
import type { Point } from "./pixelAlgos.ts";

export interface SelectionBounds {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface FloatingSelection {
  pixels: PixelBuffer;
  offsetX: number;
  offsetY: number;
  sourceLayerId: string;
  sourceFrameIndex: number;
  liftedFromCel: boolean;
}

export class SelectionMask {
  readonly width: number;
  readonly height: number;
  readonly mask: Uint8Array;

  constructor(width: number, height: number, mask?: Uint8Array) {
    this.width = width;
    this.height = height;
    const expected = width * height;
    if (mask) {
      if (mask.length !== expected) {
        throw new Error(
          `SelectionMask expected ${expected} bytes, got ${mask.length}`
        );
      }
      this.mask = new Uint8Array(mask);
    } else {
      this.mask = new Uint8Array(expected);
    }
  }

  contains(x: number, y: number): boolean {
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return false;
    return this.mask[y * this.width + x] !== 0;
  }

  set(x: number, y: number, selected: boolean): void {
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return;
    this.mask[y * this.width + x] = selected ? 1 : 0;
  }

  isEmpty(): boolean {
    for (let i = 0; i < this.mask.length; i++) {
      if (this.mask[i] !== 0) return false;
    }
    return true;
  }

  getBounds(): SelectionBounds | null {
    let minX = this.width;
    let minY = this.height;
    let maxX = -1;
    let maxY = -1;

    for (let y = 0; y < this.height; y++) {
      const rowOffset = y * this.width;
      for (let x = 0; x < this.width; x++) {
        if (this.mask[rowOffset + x] !== 0) {
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
      }
    }

    if (maxX < minX || maxY < minY) return null;
    return {
      x: minX,
      y: minY,
      w: maxX - minX + 1,
      h: maxY - minY + 1,
    };
  }

  clone(): SelectionMask {
    return new SelectionMask(this.width, this.height, this.mask);
  }

  translate(dx: number, dy: number): SelectionMask {
    const next = new SelectionMask(this.width, this.height);
    for (let y = 0; y < this.height; y++) {
      const ny = y + dy;
      if (ny < 0 || ny >= this.height) continue;
      for (let x = 0; x < this.width; x++) {
        const nx = x + dx;
        if (nx < 0 || nx >= this.width) continue;
        if (this.mask[y * this.width + x] !== 0) {
          next.mask[ny * this.width + nx] = 1;
        }
      }
    }
    return next;
  }
}

export function createRectSelection(
  width: number,
  height: number,
  x0: number,
  y0: number,
  x1: number,
  y1: number
): SelectionMask {
  const mask = new SelectionMask(width, height);
  const minX = Math.max(0, Math.min(x0, x1) | 0);
  const maxX = Math.min(width - 1, Math.max(x0, x1) | 0);
  const minY = Math.max(0, Math.min(y0, y1) | 0);
  const maxY = Math.min(height - 1, Math.max(y0, y1) | 0);

  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      mask.set(x, y, true);
    }
  }
  return mask;
}

export function createLassoSelection(
  width: number,
  height: number,
  polygon: Point[]
): SelectionMask {
  const mask = new SelectionMask(width, height);
  if (polygon.length < 3) return mask;

  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  for (const pt of polygon) {
    if (pt.x < minX) minX = pt.x;
    if (pt.x > maxX) maxX = pt.x;
    if (pt.y < minY) minY = pt.y;
    if (pt.y > maxY) maxY = pt.y;
  }

  minX = Math.max(0, minX | 0);
  minY = Math.max(0, minY | 0);
  maxX = Math.min(width - 1, maxX | 0);
  maxY = Math.min(height - 1, maxY | 0);

  // Scanline even-odd test at pixel centers (x + 0.5, y + 0.5)
  for (let y = minY; y <= maxY; y++) {
    const py = y + 0.5;
    const intersections: number[] = [];

    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
      const y1 = polygon[i].y + 0.5;
      const y2 = polygon[j].y + 0.5;
      if ((y1 > py) !== (y2 > py)) {
        const x1 = polygon[i].x + 0.5;
        const x2 = polygon[j].x + 0.5;
        const ix = x1 + ((py - y1) * (x2 - x1)) / (y2 - y1);
        intersections.push(ix);
      }
    }

    intersections.sort((a, b) => a - b);
    for (let k = 0; k + 1 < intersections.length; k += 2) {
      const startX = Math.max(minX, Math.floor(intersections[k]));
      const endX = Math.min(maxX, Math.floor(intersections[k + 1]));
      for (let x = startX; x <= endX; x++) {
        mask.set(x, y, true);
      }
    }
  }

  return mask;
}

export function createMagicWandSelection(
  buffer: PixelBuffer,
  startX: number,
  startY: number,
  contiguous: boolean
): SelectionMask {
  const { width, height, data } = buffer;
  const mask = new SelectionMask(width, height);
  if (startX < 0 || startY < 0 || startX >= width || startY >= height) {
    return mask;
  }

  const [tr, tg, tb, ta] = buffer.getPixel(startX, startY);
  const matches = (idx: number) =>
    data[idx] === tr &&
    data[idx + 1] === tg &&
    data[idx + 2] === tb &&
    data[idx + 3] === ta;

  if (!contiguous) {
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const idx = (y * width + x) * 4;
        if (matches(idx)) mask.set(x, y, true);
      }
    }
    return mask;
  }

  const visited = new Uint8Array(width * height);
  const queue = new Int32Array(width * height);
  let head = 0;
  let tail = 0;
  const startFlat = startY * width + startX;
  queue[tail++] = startFlat;
  visited[startFlat] = 1;

  while (head < tail) {
    const flat = queue[head++];
    const x = flat % width;
    const y = (flat - x) / width;
    if (!matches(flat * 4)) continue;

    mask.set(x, y, true);

    if (x > 0 && !visited[flat - 1]) {
      visited[flat - 1] = 1;
      queue[tail++] = flat - 1;
    }
    if (x + 1 < width && !visited[flat + 1]) {
      visited[flat + 1] = 1;
      queue[tail++] = flat + 1;
    }
    if (y > 0 && !visited[flat - width]) {
      visited[flat - width] = 1;
      queue[tail++] = flat - width;
    }
    if (y + 1 < height && !visited[flat + width]) {
      visited[flat + width] = 1;
      queue[tail++] = flat + width;
    }
  }

  return mask;
}

export function createFullSelection(
  width: number,
  height: number
): SelectionMask {
  const mask = new SelectionMask(width, height);
  mask.mask.fill(1);
  return mask;
}

export function buildSelectionSvgPath(mask: SelectionMask): string {
  const parts: string[] = [];
  const { width, height } = mask;

  // Horizontal boundary runs (top & bottom edges)
  for (let y = 0; y < height; y++) {
    let x = 0;
    while (x < width) {
      if (mask.contains(x, y) && !mask.contains(x, y - 1)) {
        const start = x;
        while (x < width && mask.contains(x, y) && !mask.contains(x, y - 1)) {
          x++;
        }
        parts.push(`M${start} ${y}h${x - start}`);
      } else {
        x++;
      }
    }

    x = 0;
    while (x < width) {
      if (mask.contains(x, y) && !mask.contains(x, y + 1)) {
        const start = x;
        while (x < width && mask.contains(x, y) && !mask.contains(x, y + 1)) {
          x++;
        }
        parts.push(`M${start} ${y + 1}h${x - start}`);
      } else {
        x++;
      }
    }
  }

  // Vertical boundary runs (left & right edges)
  for (let x = 0; x < width; x++) {
    let y = 0;
    while (y < height) {
      if (mask.contains(x, y) && !mask.contains(x - 1, y)) {
        const start = y;
        while (y < height && mask.contains(x, y) && !mask.contains(x - 1, y)) {
          y++;
        }
        parts.push(`M${x} ${start}v${y - start}`);
      } else {
        y++;
      }
    }

    y = 0;
    while (y < height) {
      if (mask.contains(x, y) && !mask.contains(x + 1, y)) {
        const start = y;
        while (y < height && mask.contains(x, y) && !mask.contains(x + 1, y)) {
          y++;
        }
        parts.push(`M${x + 1} ${start}v${y - start}`);
      } else {
        y++;
      }
    }
  }

  return parts.join("");
}

export function extractMaskedRegion(
  source: PixelBuffer,
  mask: SelectionMask
): { pixels: PixelBuffer; x: number; y: number } | null {
  const bounds = mask.getBounds();
  if (!bounds) return null;

  const pixels = new PixelBuffer(bounds.w, bounds.h);
  for (let dy = 0; dy < bounds.h; dy++) {
    for (let dx = 0; dx < bounds.w; dx++) {
      const sx = bounds.x + dx;
      const sy = bounds.y + dy;
      if (!mask.contains(sx, sy)) continue;
      const [r, g, b, a] = source.getPixel(sx, sy);
      if (a > 0) {
        pixels.setPixel(dx, dy, r, g, b, a);
      }
    }
  }
  return { pixels, x: bounds.x, y: bounds.y };
}

export function clearMaskedRegion(
  source: PixelBuffer,
  mask: SelectionMask,
  onBeforeWrite?: (x: number, y: number) => void
): number {
  const bounds = mask.getBounds();
  if (!bounds) return 0;

  let cleared = 0;
  for (let y = bounds.y; y < bounds.y + bounds.h; y++) {
    for (let x = bounds.x; x < bounds.x + bounds.w; x++) {
      if (!mask.contains(x, y)) continue;
      const [, , , a] = source.getPixel(x, y);
      if (a === 0) continue;
      onBeforeWrite?.(x, y);
      if (source.setPixel(x, y, 0, 0, 0, 0)) {
        cleared++;
      }
    }
  }
  return cleared;
}

export function stampFloatingPixels(
  target: PixelBuffer,
  floating: PixelBuffer,
  offsetX: number,
  offsetY: number,
  onBeforeWrite?: (x: number, y: number) => void
): void {
  for (let sy = 0; sy < floating.height; sy++) {
    const ty = offsetY + sy;
    if (ty < 0 || ty >= target.height) continue;
    for (let sx = 0; sx < floating.width; sx++) {
      const tx = offsetX + sx;
      if (tx < 0 || tx >= target.width) continue;

      const [sr, sg, sb, sa] = floating.getPixel(sx, sy);
      if (sa === 0) continue;

      onBeforeWrite?.(tx, ty);
      if (sa === 255) {
        target.setPixel(tx, ty, sr, sg, sb, 255);
      } else {
        const [dr, dg, db, da] = target.getPixel(tx, ty);
        const sAlpha = sa / 255;
        const dAlpha = da / 255;
        const outA = sAlpha + dAlpha * (1 - sAlpha);
        if (outA <= 0) continue;
        const r = Math.round((sr * sAlpha + dr * dAlpha * (1 - sAlpha)) / outA);
        const g = Math.round((sg * sAlpha + dg * dAlpha * (1 - sAlpha)) / outA);
        const b = Math.round((sb * sAlpha + db * dAlpha * (1 - sAlpha)) / outA);
        target.setPixel(tx, ty, r, g, b, Math.round(outA * 255));
      }
    }
  }
}

export function flipBufferHorizontal(buf: PixelBuffer): PixelBuffer {
  const out = new PixelBuffer(buf.width, buf.height);
  for (let y = 0; y < buf.height; y++) {
    for (let x = 0; x < buf.width; x++) {
      const [r, g, b, a] = buf.getPixel(x, y);
      if (a > 0) out.setPixel(buf.width - 1 - x, y, r, g, b, a);
    }
  }
  return out;
}

export function flipBufferVertical(buf: PixelBuffer): PixelBuffer {
  const out = new PixelBuffer(buf.width, buf.height);
  for (let y = 0; y < buf.height; y++) {
    for (let x = 0; x < buf.width; x++) {
      const [r, g, b, a] = buf.getPixel(x, y);
      if (a > 0) out.setPixel(x, buf.height - 1 - y, r, g, b, a);
    }
  }
  return out;
}

export function rotateBuffer90CW(buf: PixelBuffer): PixelBuffer {
  const out = new PixelBuffer(buf.height, buf.width);
  for (let y = 0; y < buf.height; y++) {
    for (let x = 0; x < buf.width; x++) {
      const [r, g, b, a] = buf.getPixel(x, y);
      if (a > 0) out.setPixel(buf.height - 1 - y, x, r, g, b, a);
    }
  }
  return out;
}

export function rotateBuffer90CCW(buf: PixelBuffer): PixelBuffer {
  const out = new PixelBuffer(buf.height, buf.width);
  for (let y = 0; y < buf.height; y++) {
    for (let x = 0; x < buf.width; x++) {
      const [r, g, b, a] = buf.getPixel(x, y);
      if (a > 0) out.setPixel(y, buf.width - 1 - x, r, g, b, a);
    }
  }
  return out;
}

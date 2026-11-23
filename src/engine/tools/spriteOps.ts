import { PixelBuffer } from "../document/PixelBuffer.ts";
import { scale2xEPX } from "./rotsprite.ts";
import type { PixelMask } from "./filters.ts";

export interface BoundsRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type ScaleSpriteAlgorithm = "nearest" | "scale2x" | "rotsprite";

function posMod(n: number, m: number): number {
  return ((n % m) + m) % m;
}

export function computeTightBounds(
  buffers: readonly PixelBuffer[]
): BoundsRect | null {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (let b = 0; b < buffers.length; b++) {
    const buf = buffers[b];
    const w = buf.width;
    const h = buf.height;
    const data = buf.data;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (data[(y * w + x) * 4 + 3] > 0) {
          if (x < minX) minX = x;
          if (y < minY) minY = y;
          if (x > maxX) maxX = x;
          if (y > maxY) maxY = y;
        }
      }
    }
  }

  if (maxX < minX || maxY < minY) {
    return null;
  }

  return {
    x: minX,
    y: minY,
    width: maxX - minX + 1,
    height: maxY - minY + 1,
  };
}

export function cropBufferToBounds(
  buf: PixelBuffer,
  bounds: BoundsRect
): PixelBuffer {
  const targetW = Math.max(1, Math.round(bounds.width));
  const targetH = Math.max(1, Math.round(bounds.height));
  const bx = Math.round(bounds.x);
  const by = Math.round(bounds.y);

  const out = new PixelBuffer(targetW, targetH);
  const srcData = buf.data;
  const dstData = out.data;

  for (let y = 0; y < targetH; y++) {
    const sy = by + y;
    if (sy < 0 || sy >= buf.height) continue;
    for (let x = 0; x < targetW; x++) {
      const sx = bx + x;
      if (sx < 0 || sx >= buf.width) continue;
      const sIdx = (sy * buf.width + sx) * 4;
      const dIdx = (y * targetW + x) * 4;
      dstData[dIdx] = srcData[sIdx];
      dstData[dIdx + 1] = srcData[sIdx + 1];
      dstData[dIdx + 2] = srcData[sIdx + 2];
      dstData[dIdx + 3] = srcData[sIdx + 3];
    }
  }

  out.markAllDirty();
  return out;
}

export function offsetWrapBuffer(
  buf: PixelBuffer,
  dx: number,
  dy: number,
  mask?: PixelMask
): PixelBuffer {
  const w = buf.width;
  const h = buf.height;
  if (w === 0 || h === 0) return buf.clone();

  const shiftX = Math.round(dx);
  const shiftY = Math.round(dy);

  if (!mask) {
    if (posMod(shiftX, w) === 0 && posMod(shiftY, h) === 0) {
      return buf.clone();
    }
    const out = new PixelBuffer(w, h);
    const srcData = buf.data;
    const dstData = out.data;

    for (let y = 0; y < h; y++) {
      const sy = posMod(y - shiftY, h);
      for (let x = 0; x < w; x++) {
        const sx = posMod(x - shiftX, w);
        const sIdx = (sy * w + sx) * 4;
        const dIdx = (y * w + x) * 4;
        dstData[dIdx] = srcData[sIdx];
        dstData[dIdx + 1] = srcData[sIdx + 1];
        dstData[dIdx + 2] = srcData[sIdx + 2];
        dstData[dIdx + 3] = srcData[sIdx + 3];
      }
    }

    out.markAllDirty();
    return out;
  }

  // Compute bounding box of mask pixels inside buffer
  let minX = w;
  let minY = h;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (mask.contains(x, y)) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }

  if (maxX < minX || maxY < minY) {
    return buf.clone();
  }

  const bw = maxX - minX + 1;
  const bh = maxY - minY + 1;
  if (posMod(shiftX, bw) === 0 && posMod(shiftY, bh) === 0) {
    return buf.clone();
  }

  const out = buf.clone();
  const srcData = buf.data;
  const dstData = out.data;

  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      if (!mask.contains(x, y)) continue;
      const sx = minX + posMod(x - minX - shiftX, bw);
      const sy = minY + posMod(y - minY - shiftY, bh);
      const dIdx = (y * w + x) * 4;
      if (mask.contains(sx, sy)) {
        const sIdx = (sy * w + sx) * 4;
        dstData[dIdx] = srcData[sIdx];
        dstData[dIdx + 1] = srcData[sIdx + 1];
        dstData[dIdx + 2] = srcData[sIdx + 2];
        dstData[dIdx + 3] = srcData[sIdx + 3];
      } else {
        dstData[dIdx] = 0;
        dstData[dIdx + 1] = 0;
        dstData[dIdx + 2] = 0;
        dstData[dIdx + 3] = 0;
      }
    }
  }

  out.markAllDirty();
  return out;
}

export function scaleBufferAlgorithm(
  buf: PixelBuffer,
  targetW: number,
  targetH: number,
  algorithm: ScaleSpriteAlgorithm
): PixelBuffer {
  const dstW = Math.max(1, Math.min(2048, Math.round(targetW)));
  const dstH = Math.max(1, Math.min(2048, Math.round(targetH)));

  if (buf.width === 0 || buf.height === 0) {
    return new PixelBuffer(dstW, dstH);
  }
  if (dstW === buf.width && dstH === buf.height) {
    return buf.clone();
  }

  let sampleSrc = buf;
  if (
    (algorithm === "scale2x" || algorithm === "rotsprite") &&
    (dstW > buf.width || dstH > buf.height)
  ) {
    const maxRatio = Math.max(dstW / buf.width, dstH / buf.height);
    const passes = maxRatio > 2 ? 2 : 1;
    for (let i = 0; i < passes; i++) {
      if (sampleSrc.width * 2 > 4096 || sampleSrc.height * 2 > 4096) break;
      sampleSrc = scale2xEPX(sampleSrc);
    }
  }

  const out = new PixelBuffer(dstW, dstH);
  const sData = sampleSrc.data;
  const dData = out.data;
  const sW = sampleSrc.width;
  const sH = sampleSrc.height;

  for (let y = 0; y < dstH; y++) {
    const sy = Math.min(sH - 1, Math.floor(((y + 0.5) * sH) / dstH));
    for (let x = 0; x < dstW; x++) {
      const sx = Math.min(sW - 1, Math.floor(((x + 0.5) * sW) / dstW));
      const sIdx = (sy * sW + sx) * 4;
      const dIdx = (y * dstW + x) * 4;
      dData[dIdx] = sData[sIdx];
      dData[dIdx + 1] = sData[sIdx + 1];
      dData[dIdx + 2] = sData[sIdx + 2];
      dData[dIdx + 3] = sData[sIdx + 3];
    }
  }

  out.markAllDirty();
  return out;
}

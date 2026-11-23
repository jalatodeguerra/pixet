import { PixelBuffer } from "../document/PixelBuffer.ts";

function readClampedIdx(w: number, h: number, x: number, y: number): number {
  const cx = x < 0 ? 0 : x >= w ? w - 1 : x;
  const cy = y < 0 ? 0 : y >= h ? h - 1 : y;
  return (cy * w + cx) * 4;
}

function rgbaEqual(
  data: Uint8ClampedArray,
  i1: number,
  i2: number
): boolean {
  return (
    data[i1] === data[i2] &&
    data[i1 + 1] === data[i2 + 1] &&
    data[i1 + 2] === data[i2 + 2] &&
    data[i1 + 3] === data[i2 + 3]
  );
}

function writePixelFromIdx(
  srcData: Uint8ClampedArray,
  srcIdx: number,
  dstData: Uint8ClampedArray,
  dstIdx: number
): void {
  dstData[dstIdx] = srcData[srcIdx];
  dstData[dstIdx + 1] = srcData[srcIdx + 1];
  dstData[dstIdx + 2] = srcData[srcIdx + 2];
  dstData[dstIdx + 3] = srcData[srcIdx + 3];
}

/**
 * Classic EPX / Scale2x pixel-art 2x upscaler.
 * Out-of-bounds neighbors clamp to the edge pixel so solid borders remain sharp.
 */
export function scale2xEPX(src: PixelBuffer): PixelBuffer {
  const w = src.width;
  const h = src.height;
  const outW = w * 2;
  const outH = h * 2;
  const out = new PixelBuffer(outW, outH);
  if (w === 0 || h === 0) return out;

  const s = src.data;
  const d = out.data;

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const p = (y * w + x) * 4;
      const a = readClampedIdx(w, h, x, y - 1);
      const b = readClampedIdx(w, h, x + 1, y);
      const c = readClampedIdx(w, h, x - 1, y);
      const dIdx = readClampedIdx(w, h, x, y + 1);

      const p1 =
        rgbaEqual(s, c, a) && !rgbaEqual(s, c, dIdx) && !rgbaEqual(s, a, b)
          ? a
          : p;
      const p2 =
        rgbaEqual(s, a, b) && !rgbaEqual(s, a, c) && !rgbaEqual(s, b, dIdx)
          ? b
          : p;
      const p3 =
        rgbaEqual(s, dIdx, c) && !rgbaEqual(s, dIdx, b) && !rgbaEqual(s, c, a)
          ? c
          : p;
      const p4 =
        rgbaEqual(s, b, dIdx) && !rgbaEqual(s, b, a) && !rgbaEqual(s, dIdx, c)
          ? dIdx
          : p;

      const ox = x * 2;
      const oy = y * 2;
      writePixelFromIdx(s, p1, d, (oy * outW + ox) * 4);
      writePixelFromIdx(s, p2, d, (oy * outW + ox + 1) * 4);
      writePixelFromIdx(s, p3, d, ((oy + 1) * outW + ox) * 4);
      writePixelFromIdx(s, p4, d, ((oy + 1) * outW + ox + 1) * 4);
    }
  }

  out.markAllDirty();
  return out;
}

function normalizeAngleDeg180(angleDeg: number): number {
  let a = ((angleDeg % 360) + 360) % 360;
  if (a > 180) a -= 360;
  return a === 0 ? 0 : a;
}

/**
 * RotSprite-style pixel-art rotation:
 * Upscales 4x via two passes of EPX/Scale2x, computes tight rotated bounding box,
 * and inverse-samples nearest-neighbor through -angleDeg.
 * Right-angle multiples (0, ±90, 180) preserve pixels losslessly.
 */
export function rotSpriteRotate(
  src: PixelBuffer,
  angleDeg: number
): PixelBuffer {
  const norm = normalizeAngleDeg180(angleDeg);
  if (Math.abs(norm) < 1e-6 || src.width === 0 || src.height === 0) {
    return src.clone();
  }

  const w = src.width;
  const h = src.height;
  const s = src.data;

  // Exact right-angle fast paths for 100% lossless pixel conservation
  if (Math.abs(norm - 90) < 1e-6) {
    const out = new PixelBuffer(h, w);
    const d = out.data;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const sIdx = (y * w + x) * 4;
        if (s[sIdx + 3] === 0) continue;
        const dx = h - 1 - y;
        const dy = x;
        writePixelFromIdx(s, sIdx, d, (dy * h + dx) * 4);
      }
    }
    out.markAllDirty();
    return out;
  }

  if (Math.abs(norm + 90) < 1e-6) {
    const out = new PixelBuffer(h, w);
    const d = out.data;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const sIdx = (y * w + x) * 4;
        if (s[sIdx + 3] === 0) continue;
        const dx = y;
        const dy = w - 1 - x;
        writePixelFromIdx(s, sIdx, d, (dy * h + dx) * 4);
      }
    }
    out.markAllDirty();
    return out;
  }

  if (Math.abs(norm - 180) < 1e-6) {
    const out = new PixelBuffer(w, h);
    const d = out.data;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const sIdx = (y * w + x) * 4;
        if (s[sIdx + 3] === 0) continue;
        const dx = w - 1 - x;
        const dy = h - 1 - y;
        writePixelFromIdx(s, sIdx, d, (dy * w + dx) * 4);
      }
    }
    out.markAllDirty();
    return out;
  }

  const up4 = scale2xEPX(scale2xEPX(src));
  const upData = up4.data;
  const upW = up4.width;
  const upH = up4.height;

  const rad = (norm * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);

  const spanX = w * Math.abs(cos) + h * Math.abs(sin);
  const spanY = w * Math.abs(sin) + h * Math.abs(cos);
  const outW = Math.max(1, Math.ceil(spanX - 1e-9));
  const outH = Math.max(1, Math.ceil(spanY - 1e-9));

  const out = new PixelBuffer(outW, outH);
  const outData = out.data;

  const srcCx = w / 2;
  const srcCy = h / 2;
  const outCx = outW / 2;
  const outCy = outH / 2;

  for (let dy = 0; dy < outH; dy++) {
    const oy = dy + 0.5 - outCy;
    for (let dx = 0; dx < outW; dx++) {
      const ox = dx + 0.5 - outCx;
      const sx = ox * cos + oy * sin + srcCx;
      const sy = -ox * sin + oy * cos + srcCy;

      if (sx < 0 || sy < 0 || sx >= w || sy >= h) continue;

      const ux = Math.min(upW - 1, Math.floor(sx * 4));
      const uy = Math.min(upH - 1, Math.floor(sy * 4));
      const uIdx = (uy * upW + ux) * 4;
      if (upData[uIdx + 3] === 0) continue;

      writePixelFromIdx(upData, uIdx, outData, (dy * outW + dx) * 4);
    }
  }

  out.markAllDirty();
  return out;
}

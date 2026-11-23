import type { PixelBuffer, RGBA } from "../document/PixelBuffer.ts";
import type { CustomBrushData } from "./brush.ts";
import type { Point } from "./pixelAlgos.ts";

export function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function generateSprayPoints(
  cx: number,
  cy: number,
  radius: number,
  density: number,
  seed: number
): Point[] {
  const r = Math.max(0, radius);
  const d = Math.max(0, Math.min(100, density));
  if (d === 0) return [];
  if (r === 0) {
    return [{ x: Math.round(cx), y: Math.round(cy) }];
  }

  const area = Math.PI * r * r;
  const count = Math.max(1, Math.round((area * d) / 100));
  const rng = mulberry32(seed);
  const points: Point[] = [];
  const seen = new Set<string>();

  for (let i = 0; i < count; i++) {
    const angle = rng() * Math.PI * 2;
    const dist = Math.sqrt(rng()) * r;
    const px = Math.round(cx + Math.cos(angle) * dist);
    const py = Math.round(cy + Math.sin(angle) * dist);
    const key = `${px},${py}`;
    if (!seen.has(key)) {
      seen.add(key);
      points.push({ x: px, y: py });
    }
  }

  return points;
}

export function applyJumbleFootprint(
  buf: PixelBuffer,
  cx: number,
  cy: number,
  radius: number,
  seed: number,
  alphaLock: boolean,
  onBeforeWrite?: (x: number, y: number) => void,
  mask?: { contains(x: number, y: number): boolean } | null
): number {
  const r = Math.max(0, Math.floor(radius));
  if (r <= 0) return 0;

  const icx = Math.round(cx);
  const icy = Math.round(cy);
  const r2 = r * r;
  const candidates: Point[] = [];

  for (let dy = -r; dy <= r; dy++) {
    const py = icy + dy;
    if (py < 0 || py >= buf.height) continue;
    for (let dx = -r; dx <= r; dx++) {
      if (dx * dx + dy * dy > r2) continue;
      const px = icx + dx;
      if (px < 0 || px >= buf.width) continue;
      if (mask && !mask.contains(px, py)) continue;
      if (alphaLock) {
        const [, , , a] = buf.getPixel(px, py);
        if (a === 0) continue;
      }
      candidates.push({ x: px, y: py });
    }
  }

  if (candidates.length < 2) return 0;

  const rng = mulberry32(seed);
  const swaps = Math.max(1, Math.floor(candidates.length / 2));
  let modified = 0;

  for (let i = 0; i < swaps; i++) {
    const idxA = Math.floor(rng() * candidates.length);
    const idxB = Math.floor(rng() * candidates.length);
    if (idxA === idxB) continue;

    const ptA = candidates[idxA];
    const ptB = candidates[idxB];
    const colA: RGBA = buf.getPixel(ptA.x, ptA.y);
    const colB: RGBA = buf.getPixel(ptB.x, ptB.y);

    if (
      colA[0] === colB[0] &&
      colA[1] === colB[1] &&
      colA[2] === colB[2] &&
      colA[3] === colB[3]
    ) {
      continue;
    }

    onBeforeWrite?.(ptA.x, ptA.y);
    onBeforeWrite?.(ptB.x, ptB.y);

    // Swap directly (preserving alpha channel if alphaLock is active by writing original alpha)
    const writeA = buf.setPixel(
      ptA.x,
      ptA.y,
      colB[0],
      colB[1],
      colB[2],
      alphaLock ? colA[3] : colB[3],
      false
    );
    const writeB = buf.setPixel(
      ptB.x,
      ptB.y,
      colA[0],
      colA[1],
      colA[2],
      alphaLock ? colB[3] : colA[3],
      false
    );
    if (writeA) modified++;
    if (writeB) modified++;
  }

  return modified;
}

export function captureCustomBrush(
  buf: PixelBuffer,
  mask: {
    contains(x: number, y: number): boolean;
    getBounds(): { minX: number; minY: number; maxX: number; maxY: number } | null;
  },
  name: string,
  colorMode: "rgba" | "mask"
): CustomBrushData | null {
  const bounds = mask.getBounds();
  if (!bounds) return null;

  const minX = Math.max(0, bounds.minX);
  const minY = Math.max(0, bounds.minY);
  const maxX = Math.min(buf.width - 1, bounds.maxX);
  const maxY = Math.min(buf.height - 1, bounds.maxY);

  const width = maxX - minX + 1;
  const height = maxY - minY + 1;
  if (width <= 0 || height <= 0) return null;

  const pixels = new Uint8ClampedArray(width * height * 4);
  let hasOpaque = false;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const sx = minX + x;
      const sy = minY + y;
      if (!mask.contains(sx, sy)) continue;
      const [r, g, b, a] = buf.getPixel(sx, sy);
      if (a === 0) continue;
      hasOpaque = true;
      const idx = (y * width + x) * 4;
      pixels[idx] = r;
      pixels[idx + 1] = g;
      pixels[idx + 2] = b;
      pixels[idx + 3] = a;
    }
  }

  if (!hasOpaque) return null;

  return {
    id: `custom-${Date.now()}-${width}x${height}`,
    name,
    width,
    height,
    pixels,
    colorMode,
  };
}

export function flipCustomBrushH(brush: CustomBrushData): CustomBrushData {
  const { width, height, pixels } = brush;
  const out = new Uint8ClampedArray(pixels.length);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const srcIdx = (y * width + x) * 4;
      const dstIdx = (y * width + (width - 1 - x)) * 4;
      out[dstIdx] = pixels[srcIdx];
      out[dstIdx + 1] = pixels[srcIdx + 1];
      out[dstIdx + 2] = pixels[srcIdx + 2];
      out[dstIdx + 3] = pixels[srcIdx + 3];
    }
  }
  return { ...brush, pixels: out };
}

export function flipCustomBrushV(brush: CustomBrushData): CustomBrushData {
  const { width, height, pixels } = brush;
  const out = new Uint8ClampedArray(pixels.length);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const srcIdx = (y * width + x) * 4;
      const dstIdx = ((height - 1 - y) * width + x) * 4;
      out[dstIdx] = pixels[srcIdx];
      out[dstIdx + 1] = pixels[srcIdx + 1];
      out[dstIdx + 2] = pixels[srcIdx + 2];
      out[dstIdx + 3] = pixels[srcIdx + 3];
    }
  }
  return { ...brush, pixels: out };
}

export function rotateCustomBrushCW(brush: CustomBrushData): CustomBrushData {
  const { width, height, pixels } = brush;
  const newWidth = height;
  const newHeight = width;
  const out = new Uint8ClampedArray(newWidth * newHeight * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const srcIdx = (y * width + x) * 4;
      const nx = height - 1 - y;
      const ny = x;
      const dstIdx = (ny * newWidth + nx) * 4;
      out[dstIdx] = pixels[srcIdx];
      out[dstIdx + 1] = pixels[srcIdx + 1];
      out[dstIdx + 2] = pixels[srcIdx + 2];
      out[dstIdx + 3] = pixels[srcIdx + 3];
    }
  }
  return {
    ...brush,
    width: newWidth,
    height: newHeight,
    pixels: out,
  };
}

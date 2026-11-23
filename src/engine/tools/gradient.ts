import type { PixelBuffer, RGBA } from "../document/PixelBuffer.ts";
import { shouldPlotDither, type DitherPattern } from "./dither.ts";

export type GradientMode = "linear" | "radial";

export interface GradientOptions {
  mode: GradientMode;
  dither: DitherPattern | "none";
  paletteSnap?: readonly RGBA[];
}

function clamp01(v: number): number {
  return v <= 0 ? 0 : v >= 1 ? 1 : v;
}

function clampByte(v: number): number {
  return Math.max(0, Math.min(255, Math.round(v)));
}

function lerpRgba(a: RGBA, b: RGBA, t: number): RGBA {
  return [
    clampByte(a[0] + (b[0] - a[0]) * t),
    clampByte(a[1] + (b[1] - a[1]) * t),
    clampByte(a[2] + (b[2] - a[2]) * t),
    clampByte(a[3] + (b[3] - a[3]) * t),
  ];
}

function findNearestPaletteColor(
  rgba: RGBA,
  palette: readonly RGBA[]
): RGBA {
  let best = palette[0];
  let bestDist = Infinity;
  for (let i = 0; i < palette.length; i++) {
    const p = palette[i];
    const dr = rgba[0] - p[0];
    const dg = rgba[1] - p[1];
    const db = rgba[2] - p[2];
    const da = rgba[3] - p[3];
    const dist = dr * dr + dg * dg + db * db + da * da;
    if (dist < bestDist) {
      bestDist = dist;
      best = p;
    }
  }
  return [best[0], best[1], best[2], best[3]];
}

function findTwoClosestPaletteStops(
  rgba: RGBA,
  palette: readonly RGBA[]
): { first: RGBA; second: RGBA; mix: number } {
  let idx1 = 0;
  let dist1 = Infinity;
  let idx2 = 0;
  let dist2 = Infinity;

  for (let i = 0; i < palette.length; i++) {
    const p = palette[i];
    const dr = rgba[0] - p[0];
    const dg = rgba[1] - p[1];
    const db = rgba[2] - p[2];
    const da = rgba[3] - p[3];
    const dist = dr * dr + dg * dg + db * db + da * da;
    if (dist < dist1) {
      dist2 = dist1;
      idx2 = idx1;
      dist1 = dist;
      idx1 = i;
    } else if (dist < dist2) {
      dist2 = dist;
      idx2 = i;
    }
  }

  const c1 = palette[idx1];
  const c2 = palette[idx2];
  if (idx1 === idx2 || dist1 === 0) {
    return {
      first: [c1[0], c1[1], c1[2], c1[3]],
      second: [c1[0], c1[1], c1[2], c1[3]],
      mix: 0,
    };
  }

  // Project target color onto segment c1 -> c2 for smooth ordered dithering
  const vx = c2[0] - c1[0];
  const vy = c2[1] - c1[1];
  const vz = c2[2] - c1[2];
  const vw = c2[3] - c1[3];
  const lenSq = vx * vx + vy * vy + vz * vz + vw * vw;
  if (lenSq <= 0) {
    return {
      first: [c1[0], c1[1], c1[2], c1[3]],
      second: [c1[0], c1[1], c1[2], c1[3]],
      mix: 0,
    };
  }
  const dot =
    (rgba[0] - c1[0]) * vx +
    (rgba[1] - c1[1]) * vy +
    (rgba[2] - c1[2]) * vz +
    (rgba[3] - c1[3]) * vw;
  const mix = clamp01(dot / lenSq);

  return {
    first: [c1[0], c1[1], c1[2], c1[3]],
    second: [c2[0], c2[1], c2[2], c2[3]],
    mix,
  };
}

export function renderGradientToBuffer(
  buf: PixelBuffer,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  startRgba: RGBA,
  endRgba: RGBA,
  opts: GradientOptions,
  alphaLock: boolean,
  onBeforeWrite?: (x: number, y: number) => void,
  selectionMask?: { contains(x: number, y: number): boolean } | null
): number {
  const { width, height } = buf;
  const dx = x1 - x0;
  const dy = y1 - y0;
  const lenSq = dx * dx + dy * dy;
  const radius = Math.hypot(dx, dy);

  const palette =
    opts.paletteSnap && opts.paletteSnap.length > 0 ? opts.paletteSnap : null;

  let modified = 0;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (selectionMask && !selectionMask.contains(x, y)) continue;

      let t = 0;
      if (opts.mode === "linear") {
        if (lenSq > 0) {
          t = clamp01(((x - x0) * dx + (y - y0) * dy) / lenSq);
        }
      } else {
        if (radius > 0) {
          t = clamp01(Math.hypot(x - x0, y - y0) / radius);
        }
      }

      let color: RGBA;
      if (opts.dither !== "none") {
        if (palette) {
          if (palette.length === 1) {
            color = [
              palette[0][0],
              palette[0][1],
              palette[0][2],
              palette[0][3],
            ];
          } else {
            const target = lerpRgba(startRgba, endRgba, t);
            const stops = findTwoClosestPaletteStops(target, palette);
            color = shouldPlotDither(x, y, stops.mix, opts.dither)
              ? stops.second
              : stops.first;
          }
        } else {
          color = shouldPlotDither(x, y, t, opts.dither) ? endRgba : startRgba;
        }
      } else {
        const lerped = lerpRgba(startRgba, endRgba, t);
        color = palette ? findNearestPaletteColor(lerped, palette) : lerped;
      }

      const [prevR, prevG, prevB, prevA] = buf.getPixel(x, y);
      let nextA = color[3];
      if (alphaLock) {
        if (prevA === 0 || color[3] === 0) continue;
        nextA = Math.round((color[3] / 255) * prevA);
      }
      if (
        prevR === color[0] &&
        prevG === color[1] &&
        prevB === color[2] &&
        prevA === nextA
      ) {
        continue;
      }

      onBeforeWrite?.(x, y);
      if (
        buf.setPixel(x, y, color[0], color[1], color[2], color[3], alphaLock)
      ) {
        modified++;
      }
    }
  }

  return modified;
}

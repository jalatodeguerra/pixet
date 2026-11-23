import { shouldPlotDither, type DitherPattern } from "./dither.ts";

export type InkMode =
  | "simple"
  | "alphaBlend"
  | "shadingRamp"
  | "replaceColor"
  | "lockAlpha"
  | "dither";

export interface InkContext {
  opacity?: number;
  secondaryRgba?: [number, number, number, number];
  shadingRamp?: [number, number, number, number][];
  shadingDirection?: 1 | -1;
  ditherThreshold?: number;
  ditherPattern?: DitherPattern;
}

function clampByte(v: number): number {
  return Math.max(0, Math.min(255, Math.round(v)));
}

function rgbaEqual(
  a: readonly [number, number, number, number],
  b: readonly [number, number, number, number]
): boolean {
  return a[0] === b[0] && a[1] === b[1] && a[2] === b[2] && a[3] === b[3];
}

export function applyInkPixel(
  dst: [number, number, number, number],
  src: [number, number, number, number],
  x: number,
  y: number,
  mode: InkMode,
  ctx: InkContext = {}
): [number, number, number, number] | null {
  const opacity = Math.max(0, Math.min(100, ctx.opacity ?? 100)) / 100;

  switch (mode) {
    case "simple": {
      const out: [number, number, number, number] = [
        src[0],
        src[1],
        src[2],
        clampByte(src[3] * opacity),
      ];
      return rgbaEqual(out, dst) ? null : out;
    }

    case "alphaBlend": {
      const sa = Math.max(0, Math.min(1, (src[3] / 255) * opacity));
      if (sa <= 0) return null;
      const da = Math.max(0, Math.min(1, dst[3] / 255));
      const outA = sa + da * (1 - sa);
      if (outA <= 0) return null;

      const invSa = 1 - sa;
      const out: [number, number, number, number] = [
        clampByte((src[0] * sa + dst[0] * da * invSa) / outA),
        clampByte((src[1] * sa + dst[1] * da * invSa) / outA),
        clampByte((src[2] * sa + dst[2] * da * invSa) / outA),
        clampByte(outA * 255),
      ];
      return rgbaEqual(out, dst) ? null : out;
    }

    case "shadingRamp": {
      if (dst[3] === 0) return null;
      const ramp = ctx.shadingRamp;
      if (!ramp || ramp.length === 0) return null;

      let bestIdx = 0;
      let bestDist = Infinity;
      for (let i = 0; i < ramp.length; i++) {
        const c = ramp[i];
        const dr = dst[0] - c[0];
        const dg = dst[1] - c[1];
        const db = dst[2] - c[2];
        const dist = dr * dr + dg * dg + db * db;
        if (dist < bestDist) {
          bestDist = dist;
          bestIdx = i;
        }
      }

      const dir = ctx.shadingDirection ?? 1;
      const nextIdx = Math.max(0, Math.min(ramp.length - 1, bestIdx + dir));
      const target = ramp[nextIdx];
      const out: [number, number, number, number] = [
        target[0],
        target[1],
        target[2],
        dst[3],
      ];
      return rgbaEqual(out, dst) ? null : out;
    }

    case "replaceColor": {
      const sec = ctx.secondaryRgba;
      if (!sec || !rgbaEqual(dst, sec)) return null;
      const out: [number, number, number, number] = [
        src[0],
        src[1],
        src[2],
        clampByte(src[3] * opacity),
      ];
      return rgbaEqual(out, dst) ? null : out;
    }

    case "lockAlpha": {
      if (dst[3] === 0) return null;
      const sa = Math.max(0, Math.min(1, (src[3] / 255) * opacity));
      if (sa <= 0) return null;

      const out: [number, number, number, number] =
        sa >= 1
          ? [src[0], src[1], src[2], dst[3]]
          : [
              clampByte(src[0] * sa + dst[0] * (1 - sa)),
              clampByte(src[1] * sa + dst[1] * (1 - sa)),
              clampByte(src[2] * sa + dst[2] * (1 - sa)),
              dst[3],
            ];
      return rgbaEqual(out, dst) ? null : out;
    }

    case "dither": {
      const threshold = ctx.ditherThreshold ?? 0.5;
      const pattern = ctx.ditherPattern ?? "bayer4";
      if (!shouldPlotDither(x, y, threshold, pattern)) return null;

      const out: [number, number, number, number] = [
        src[0],
        src[1],
        src[2],
        clampByte(src[3] * opacity),
      ];
      return rgbaEqual(out, dst) ? null : out;
    }
  }
}

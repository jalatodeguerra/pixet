import type { Point } from "./pixelAlgos.ts";

export type ViewCheckOptions = {
  grayscale: boolean;
  silhouette: boolean;
  silhouetteColor?: [number, number, number];
};

export function mapFlippedPoint(
  pt: Point,
  width: number,
  height: number,
  flipH: boolean,
  flipV: boolean
): Point {
  return {
    x: flipH ? width - 1 - pt.x : pt.x,
    y: flipV ? height - 1 - pt.y : pt.y,
  };
}

export function applyViewCheckFilter(
  src: Uint8ClampedArray,
  opts: ViewCheckOptions
): Uint8ClampedArray {
  const out = new Uint8ClampedArray(src);
  if (!opts.silhouette && !opts.grayscale) {
    return out;
  }

  if (opts.silhouette) {
    const [sr, sg, sb] = opts.silhouetteColor ?? [20, 20, 20];
    for (let i = 0; i + 3 < out.length; i += 4) {
      if (out[i + 3] > 0) {
        out[i] = sr;
        out[i + 1] = sg;
        out[i + 2] = sb;
      }
    }
    return out;
  }

  for (let i = 0; i + 3 < out.length; i += 4) {
    if (out[i + 3] > 0) {
      const l = Math.round(
        0.2126 * out[i] + 0.7152 * out[i + 1] + 0.0722 * out[i + 2]
      );
      out[i] = l;
      out[i + 1] = l;
      out[i + 2] = l;
    }
  }
  return out;
}

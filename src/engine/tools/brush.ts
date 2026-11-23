import {
  expandBrushFootprint,
  plotBresenhamLine,
  type Point,
} from "./pixelAlgos.ts";

export type BrushShape =
  | "circle"
  | "square"
  | "diamond"
  | "diagonalL"
  | "diagonalR"
  | "custom";

export interface CustomBrushData {
  id: string;
  name: string;
  width: number;
  height: number;
  pixels: Uint8ClampedArray;
  colorMode: "rgba" | "mask";
}

export interface BrushConfig {
  shape: BrushShape;
  size: number;
  opacity: number;
  pixelPerfect: boolean;
  spacing: number;
  customBrush?: CustomBrushData | null;
}

export interface BrushPixel {
  x: number;
  y: number;
  alpha: number;
  rgba?: [number, number, number, number];
}

export function getBrushFootprint(
  cx: number,
  cy: number,
  cfg: BrushConfig
): BrushPixel[] {
  const x0 = Math.round(cx);
  const y0 = Math.round(cy);
  const s = Math.max(1, Math.min(64, Math.round(cfg.size)));
  const opacityNorm = Math.max(0, Math.min(100, cfg.opacity)) / 100;

  if (cfg.shape === "custom") {
    const brush = cfg.customBrush;
    if (!brush || brush.width <= 0 || brush.height <= 0) {
      return [];
    }
    const offsetX = -Math.floor((brush.width - 1) / 2);
    const offsetY = -Math.floor((brush.height - 1) / 2);
    const out: BrushPixel[] = [];

    for (let by = 0; by < brush.height; by++) {
      for (let bx = 0; bx < brush.width; bx++) {
        const idx = (by * brush.width + bx) * 4;
        if (idx + 3 >= brush.pixels.length) continue;
        const a = brush.pixels[idx + 3];
        if (a === 0) continue;

        const alpha = (a / 255) * opacityNorm;
        const px = x0 + offsetX + bx;
        const py = y0 + offsetY + by;

        if (brush.colorMode === "rgba") {
          out.push({
            x: px,
            y: py,
            alpha,
            rgba: [
              brush.pixels[idx],
              brush.pixels[idx + 1],
              brush.pixels[idx + 2],
              a,
            ],
          });
        } else {
          out.push({ x: px, y: py, alpha });
        }
      }
    }
    return out;
  }

  if (cfg.shape === "circle") {
    return expandBrushFootprint(x0, y0, s).map((pt) => ({
      x: pt.x,
      y: pt.y,
      alpha: opacityNorm,
    }));
  }

  const minOffset = -Math.floor((s - 1) / 2);
  const maxOffset = Math.ceil((s - 1) / 2);

  if (cfg.shape === "square") {
    const out: BrushPixel[] = [];
    for (let dy = minOffset; dy <= maxOffset; dy++) {
      for (let dx = minOffset; dx <= maxOffset; dx++) {
        out.push({ x: x0 + dx, y: y0 + dy, alpha: opacityNorm });
      }
    }
    return out;
  }

  if (cfg.shape === "diamond") {
    const out: BrushPixel[] = [];
    const radius = s / 2;
    const centerShift = s % 2 === 0 ? 0.5 : 0;
    for (let dy = minOffset; dy <= maxOffset; dy++) {
      for (let dx = minOffset; dx <= maxOffset; dx++) {
        const dist = Math.abs(dx - centerShift) + Math.abs(dy - centerShift);
        if (dist <= radius) {
          out.push({ x: x0 + dx, y: y0 + dy, alpha: opacityNorm });
        }
      }
    }
    return out;
  }

  if (cfg.shape === "diagonalL") {
    const out: BrushPixel[] = [];
    for (let i = 0; i < s; i++) {
      out.push({
        x: x0 + minOffset + i,
        y: y0 + minOffset + i,
        alpha: opacityNorm,
      });
    }
    return out;
  }

  // diagonalR ('/'): bottom-left to top-right
  const out: BrushPixel[] = [];
  for (let i = 0; i < s; i++) {
    out.push({
      x: x0 + minOffset + i,
      y: y0 + maxOffset - i,
      alpha: opacityNorm,
    });
  }
  return out;
}

export function sampleStrokePoints(
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  spacing: number
): Point[] {
  const line = plotBresenhamLine(x0, y0, x1, y1);
  if (line.length <= 1) return line;

  const step = Math.max(1, Math.round(spacing));
  if (step === 1) return line;

  const sampled: Point[] = [];
  for (let i = 0; i < line.length; i += step) {
    sampled.push(line[i]);
  }
  const last = line[line.length - 1];
  const prev = sampled[sampled.length - 1];
  if (prev.x !== last.x || prev.y !== last.y) {
    sampled.push(last);
  }
  return sampled;
}

import type { PixelBuffer, RGBA } from "../document/PixelBuffer.ts";
import { shouldPlotDither, type DitherPattern } from "./dither.ts";

export interface Point {
  x: number;
  y: number;
}

export interface FloodFillOptions {
  tolerance?: number;
  diagonal8?: boolean;
  ditherPattern?: DitherPattern | "none";
  sampleBuffer?: PixelBuffer;
}

export function constrainAngle(
  x0: number,
  y0: number,
  x1: number,
  y1: number
): Point {
  const dx = x1 - x0;
  const dy = y1 - y0;
  if (dx === 0 && dy === 0) return { x: x1, y: y1 };
  const angle = Math.atan2(dy, dx);
  const snapped = Math.round(angle / (Math.PI / 4)) * (Math.PI / 4);
  const dist = Math.hypot(dx, dy);
  return {
    x: x0 + Math.round(Math.cos(snapped) * dist),
    y: y0 + Math.round(Math.sin(snapped) * dist),
  };
}

export function constrainSquareBounds(
  x0: number,
  y0: number,
  x1: number,
  y1: number
): Point {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const side = Math.max(Math.abs(dx), Math.abs(dy));
  return {
    x: x0 + (dx < 0 ? -side : side),
    y: y0 + (dy < 0 ? -side : side),
  };
}

export function plotBresenhamLine(
  x0: number,
  y0: number,
  x1: number,
  y1: number
): Point[] {
  const points: Point[] = [];
  let cx = x0 | 0;
  let cy = y0 | 0;
  const tx = x1 | 0;
  const ty = y1 | 0;

  const dx = Math.abs(tx - cx);
  const dy = Math.abs(ty - cy);
  const sx = cx < tx ? 1 : -1;
  const sy = cy < ty ? 1 : -1;
  let err = dx - dy;

  while (true) {
    points.push({ x: cx, y: cy });
    if (cx === tx && cy === ty) break;
    const e2 = 2 * err;
    if (e2 > -dy) {
      err -= dy;
      cx += sx;
    }
    if (e2 < dx) {
      err += dx;
      cy += sy;
    }
  }
  return points;
}

export function plotRect(
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  filled: boolean
): Point[] {
  const minX = Math.min(x0, x1) | 0;
  const maxX = Math.max(x0, x1) | 0;
  const minY = Math.min(y0, y1) | 0;
  const maxY = Math.max(y0, y1) | 0;

  const points: Point[] = [];
  if (filled) {
    for (let y = minY; y <= maxY; y++) {
      for (let x = minX; x <= maxX; x++) {
        points.push({ x, y });
      }
    }
    return points;
  }

  for (let x = minX; x <= maxX; x++) {
    points.push({ x, y: minY });
    if (maxY !== minY) points.push({ x, y: maxY });
  }
  for (let y = minY + 1; y < maxY; y++) {
    points.push({ x: minX, y });
    if (maxX !== minX) points.push({ x: maxX, y });
  }
  return points;
}

export function plotEllipse(
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  filled: boolean
): Point[] {
  let xa = Math.min(x0, x1) | 0;
  let xb = Math.max(x0, x1) | 0;
  let ya = Math.min(y0, y1) | 0;
  let yb = Math.max(y0, y1) | 0;

  if (xa === xb || ya === yb) {
    return plotRect(xa, ya, xb, yb, true);
  }

  // Integer bounding-box midpoint ellipse (Zingl's algorithm)
  const seen = new Set<string>();
  const points: Point[] = [];
  const push = (px: number, py: number) => {
    const key = `${px},${py}`;
    if (!seen.has(key)) {
      seen.add(key);
      points.push({ x: px, y: py });
    }
  };

  let a = Math.abs(xb - xa);
  const b = Math.abs(yb - ya);
  let b1 = b & 1;
  let dx = 4 * (1 - a) * b * b;
  let dy = 4 * (b1 + 1) * a * a;
  let err = dx + dy + b1 * a * a;

  let yTop = ya + Math.floor((b + 1) / 2);
  let yBot = yTop - b1;
  a *= 8 * a;
  b1 = 8 * b * b;

  const spanRow = (left: number, right: number, rowY: number) => {
    for (let x = left; x <= right; x++) push(x, rowY);
  };

  do {
    if (filled) {
      spanRow(xa, xb, yTop);
      spanRow(xa, xb, yBot);
    } else {
      push(xb, yTop);
      push(xa, yTop);
      push(xa, yBot);
      push(xb, yBot);
    }

    const e2 = 2 * err;
    if (e2 <= dy) {
      yTop++;
      yBot--;
      dy += a;
      err += dy;
    }
    if (e2 >= dx || 2 * err > dy) {
      xa++;
      xb--;
      dx += b1;
      err += dx;
    }
  } while (xa <= xb);

  while (yTop - yBot < b) {
    const lx = xa - 1;
    const rx = xb + 1;
    if (filled) {
      spanRow(lx, rx, yTop);
      spanRow(lx, rx, yBot);
    } else {
      push(lx, yTop);
      push(rx, yTop);
      push(lx, yBot);
      push(rx, yBot);
    }
    yTop++;
    yBot--;
  }

  return points;
}

/**
 * Removes L-shaped corners from a 1px pixel path:
 * whenever 3 consecutive points (a, b, c) form two 4-connected steps
 * and `a` and `c` are 8-connected diagonals, `b` is redundant.
 */
export function applyPixelPerfectFilter(points: Point[]): Point[] {
  if (points.length < 3) return points.slice();

  const out: Point[] = [];
  let i = 0;
  while (i < points.length) {
    out.push(points[i]);
    if (i + 2 < points.length) {
      const a = points[i];
      const b = points[i + 1];
      const c = points[i + 2];

      const abManhattan = Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
      const bcManhattan = Math.abs(b.x - c.x) + Math.abs(b.y - c.y);
      const acDiag = Math.abs(a.x - c.x) === 1 && Math.abs(a.y - c.y) === 1;

      if (abManhattan === 1 && bcManhattan === 1 && acDiag) {
        // Skip L-corner point `b`
        i += 2;
        continue;
      }
    }
    i += 1;
  }
  return out;
}

export function expandBrushFootprint(
  cx: number,
  cy: number,
  size: number
): Point[] {
  const s = Math.max(1, Math.round(size));
  if (s === 1) return [{ x: cx, y: cy }];
  if (s === 2) {
    return [
      { x: cx, y: cy },
      { x: cx + 1, y: cy },
      { x: cx, y: cy + 1 },
      { x: cx + 1, y: cy + 1 },
    ];
  }

  const radius = s / 2;
  const r2 = radius * radius;
  const minOffset = -Math.floor((s - 1) / 2);
  const maxOffset = Math.ceil((s - 1) / 2);
  const centerShift = s % 2 === 0 ? 0.5 : 0;

  const points: Point[] = [];
  for (let dy = minOffset; dy <= maxOffset; dy++) {
    for (let dx = minOffset; dx <= maxOffset; dx++) {
      const distX = dx - centerShift;
      const distY = dy - centerShift;
      if (distX * distX + distY * distY <= r2 + 0.05) {
        points.push({ x: cx + dx, y: cy + dy });
      }
    }
  }
  return points;
}

export function expandSymmetry(
  pt: Point,
  width: number,
  height: number,
  symX: boolean,
  symY: boolean
): Point[] {
  const result: Point[] = [{ x: pt.x, y: pt.y }];
  const mx = width - 1 - pt.x;
  const my = height - 1 - pt.y;

  const addUnique = (x: number, y: number) => {
    for (const existing of result) {
      if (existing.x === x && existing.y === y) return;
    }
    result.push({ x, y });
  };

  if (symX) addUnique(mx, pt.y);
  if (symY) addUnique(pt.x, my);
  if (symX && symY) addUnique(mx, my);

  return result;
}

export function floodFill(
  buffer: PixelBuffer,
  startX: number,
  startY: number,
  fillRgba: RGBA,
  contiguous: boolean,
  alphaLock: boolean,
  onBeforeWrite?: (x: number, y: number) => void,
  selectionMask?: { contains(x: number, y: number): boolean } | null,
  opts?: FloodFillOptions
): number {
  const { width, height } = buffer;
  if (startX < 0 || startY < 0 || startX >= width || startY >= height) {
    return 0;
  }
  if (selectionMask && !selectionMask.contains(startX, startY)) {
    return 0;
  }

  const sampleBuf =
    opts?.sampleBuffer &&
    opts.sampleBuffer.width === width &&
    opts.sampleBuffer.height === height
      ? opts.sampleBuffer
      : buffer;
  const sampleData = sampleBuf.data;

  const [tr, tg, tb, ta] = sampleBuf.getPixel(startX, startY);
  const [fr, fg, fb, fa] = fillRgba;

  const tolerance = Math.max(0, opts?.tolerance ?? 0);
  const diagonal8 = opts?.diagonal8 ?? false;
  const ditherPattern = opts?.ditherPattern ?? "none";

  // Preserve fast early-out when reading and writing same buffer with exact target color
  if (
    sampleBuf === buffer &&
    tolerance === 0 &&
    tr === fr &&
    tg === fg &&
    tb === fb &&
    ta === fa
  ) {
    return 0;
  }

  const matchesTarget = (idx: number): boolean => {
    if (tolerance === 0) {
      return (
        sampleData[idx] === tr &&
        sampleData[idx + 1] === tg &&
        sampleData[idx + 2] === tb &&
        sampleData[idx + 3] === ta
      );
    }
    return (
      Math.max(
        Math.abs(sampleData[idx] - tr),
        Math.abs(sampleData[idx + 1] - tg),
        Math.abs(sampleData[idx + 2] - tb),
        Math.abs(sampleData[idx + 3] - ta)
      ) <= tolerance
    );
  };

  const tryWrite = (x: number, y: number): boolean => {
    if (ditherPattern !== "none" && !shouldPlotDither(x, y, 0.5, ditherPattern)) {
      return false;
    }
    const [pr, pg, pb, pa] = buffer.getPixel(x, y);
    let nextA = fa;
    if (alphaLock) {
      if (pa === 0 || fa === 0) return false;
      nextA = Math.round((fa / 255) * pa);
    }
    if (pr === fr && pg === fg && pb === fb && pa === nextA) {
      return false;
    }
    onBeforeWrite?.(x, y);
    return buffer.setPixel(x, y, fr, fg, fb, fa, alphaLock);
  };

  let modified = 0;

  if (!contiguous) {
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        if (selectionMask && !selectionMask.contains(x, y)) continue;
        const idx = (y * width + x) * 4;
        if (matchesTarget(idx)) {
          if (tryWrite(x, y)) {
            modified++;
          }
        }
      }
    }
    return modified;
  }

  const visited = new Uint8Array(width * height);
  const queue = new Int32Array(width * height);
  let head = 0;
  let tail = 0;

  const startFlat = startY * width + startX;
  queue[tail++] = startFlat;
  visited[startFlat] = 1;

  const enqueue = (nx: number, ny: number) => {
    if (nx < 0 || ny < 0 || nx >= width || ny >= height) return;
    const n = ny * width + nx;
    if (!visited[n]) {
      visited[n] = 1;
      queue[tail++] = n;
    }
  };

  while (head < tail) {
    const flat = queue[head++];
    const x = flat % width;
    const y = (flat - x) / width;
    if (selectionMask && !selectionMask.contains(x, y)) continue;
    const idx = flat * 4;

    if (!matchesTarget(idx)) continue;

    if (tryWrite(x, y)) {
      modified++;
    }

    enqueue(x - 1, y);
    enqueue(x + 1, y);
    enqueue(x, y - 1);
    enqueue(x, y + 1);
    if (diagonal8) {
      enqueue(x - 1, y - 1);
      enqueue(x + 1, y - 1);
      enqueue(x - 1, y + 1);
      enqueue(x + 1, y + 1);
    }
  }

  return modified;
}

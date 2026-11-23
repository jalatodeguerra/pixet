import { getBrushFootprint, type BrushConfig } from "./brush.ts";
import { expandSymmetry, type Point } from "./pixelAlgos.ts";

export interface FootprintOutlineResult {
  cells: Point[];
  outlinePath: string;
}

function wrapCoord(v: number, size: number): number {
  return ((v % size) + size) % size;
}

export function buildFootprintOutlinePath(cells: ReadonlyArray<Point>): string {
  if (cells.length === 0) return "";
  const cellSet = new Set<string>();
  const unique: Point[] = [];
  for (const pt of cells) {
    const key = `${pt.x},${pt.y}`;
    if (!cellSet.has(key)) {
      cellSet.add(key);
      unique.push(pt);
    }
  }

  const parts: string[] = [];
  for (const { x, y } of unique) {
    if (!cellSet.has(`${x},${y - 1}`)) parts.push(`M${x} ${y}h1`);
    if (!cellSet.has(`${x},${y + 1}`)) parts.push(`M${x} ${y + 1}h1`);
    if (!cellSet.has(`${x - 1},${y}`)) parts.push(`M${x} ${y}v1`);
    if (!cellSet.has(`${x + 1},${y}`)) parts.push(`M${x + 1} ${y}v1`);
  }
  return parts.join("");
}

export function computeBrushOverlayFootprint(
  cx: number,
  cy: number,
  cfg: BrushConfig,
  canvasWidth: number,
  canvasHeight: number,
  symX: boolean,
  symY: boolean,
  seamlessWrap: boolean
): FootprintOutlineResult {
  const footprint = getBrushFootprint(cx, cy, cfg);
  const seen = new Set<string>();
  const cells: Point[] = [];

  for (const fp of footprint) {
    const syms = expandSymmetry(
      { x: fp.x, y: fp.y },
      canvasWidth,
      canvasHeight,
      symX,
      symY
    );
    for (const rawSp of syms) {
      const sp = seamlessWrap
        ? {
            x: wrapCoord(rawSp.x, canvasWidth),
            y: wrapCoord(rawSp.y, canvasHeight),
          }
        : rawSp;
      if (sp.x < 0 || sp.y < 0 || sp.x >= canvasWidth || sp.y >= canvasHeight) {
        continue;
      }
      const key = `${sp.x},${sp.y}`;
      if (seen.has(key)) continue;
      seen.add(key);
      cells.push(sp);
    }
  }

  return {
    cells,
    outlinePath: buildFootprintOutlinePath(cells),
  };
}

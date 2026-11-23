import type { Point } from "./pixelAlgos.ts";

export type GuideAxis = "x" | "y";

export type GuideLine = {
  id: string;
  axis: GuideAxis;
  pos: number;
};

export function snapCoordToGuides(
  value: number,
  axis: GuideAxis,
  guides: readonly GuideLine[],
  threshold = 2
): number {
  let bestPos = value;
  let bestDist = Infinity;

  for (const g of guides) {
    if (g.axis !== axis) continue;
    const dist = Math.abs(g.pos - value);
    if (dist <= threshold && dist < bestDist) {
      bestDist = dist;
      bestPos = g.pos;
    }
  }

  return bestPos;
}

export function snapPointToGuides(
  pt: Point,
  guides: readonly GuideLine[],
  threshold = 2
): Point {
  return {
    x: snapCoordToGuides(pt.x, "x", guides, threshold),
    y: snapCoordToGuides(pt.y, "y", guides, threshold),
  };
}

export function buildCustomGridLines(
  width: number,
  height: number,
  gridW: number,
  gridH: number,
  offsetX = 0,
  offsetY = 0
): { verticals: number[]; horizontals: number[] } {
  const stepW = Math.max(1, gridW);
  const stepH = Math.max(1, gridH);

  const verticals: number[] = [];
  for (let x = 1; x < width; x++) {
    if ((((x - offsetX) % stepW) + stepW) % stepW === 0) {
      verticals.push(x);
    }
  }

  const horizontals: number[] = [];
  for (let y = 1; y < height; y++) {
    if ((((y - offsetY) % stepH) + stepH) % stepH === 0) {
      horizontals.push(y);
    }
  }

  return { verticals, horizontals };
}

/**
 * Pure screen-space picking of mesh sub-elements (Blender-style): the nearest
 * projected vertex / segment to the cursor within a pixel radius. Callers
 * project world positions to CSS pixels and supply an occlusion callback, so
 * this module needs no three.js.
 */

/** A vertex projected to viewport CSS pixels; `depth` is the distance along the view ray. */
export interface ScreenPoint {
  x: number;
  y: number;
  depth: number;
}

/** Null when the vertex cannot be projected (behind the camera). */
export type MaybeScreenPoint = ScreenPoint | null;

export const VERTEX_PICK_RADIUS_PX = 12;
export const EDGE_PICK_RADIUS_PX = 10;

/** Distance in pixels from (px,py) to the segment a-b, plus the closest parameter t in 0..1. */
export function pointSegmentDistance(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number
): { dist: number; t: number } {
  const abx = bx - ax;
  const aby = by - ay;
  const lenSq = abx * abx + aby * aby;
  let t = 0;
  if (lenSq > 1e-12) {
    t = ((px - ax) * abx + (py - ay) * aby) / lenSq;
    t = Math.max(0, Math.min(1, t));
  }
  const cx = ax + abx * t;
  const cy = ay + aby * t;
  return { dist: Math.hypot(px - cx, py - cy), t };
}

/**
 * Nearest vertex within `radius` px of the cursor. Candidates are tried nearest
 * first; the first one `isVisible` accepts wins (no callback means all visible).
 * Returns -1 when nothing qualifies.
 */
export function pickNearestVertex(
  projected: ReadonlyArray<MaybeScreenPoint>,
  cursorX: number,
  cursorY: number,
  radius: number = VERTEX_PICK_RADIUS_PX,
  isVisible?: (vertexIndex: number) => boolean
): number {
  const cands: Array<{ i: number; d: number }> = [];
  for (let i = 0; i < projected.length; i++) {
    const p = projected[i];
    if (!p) continue;
    const d = Math.hypot(p.x - cursorX, p.y - cursorY);
    if (d <= radius) cands.push({ i, d });
  }
  cands.sort((a, b) => a.d - b.d || a.i - b.i);
  for (const c of cands) {
    if (!isVisible || isVisible(c.i)) return c.i;
  }
  return -1;
}

/**
 * Nearest segment within `radius` px of the cursor. `isVisible` is asked about
 * the segment index (callers typically test its midpoint). Returns -1 when
 * nothing qualifies.
 */
export function pickNearestSegment(
  projected: ReadonlyArray<MaybeScreenPoint>,
  edges: ReadonlyArray<readonly [number, number]>,
  cursorX: number,
  cursorY: number,
  radius: number = EDGE_PICK_RADIUS_PX,
  isVisible?: (edgeIndex: number) => boolean
): number {
  const cands: Array<{ i: number; d: number }> = [];
  for (let i = 0; i < edges.length; i++) {
    const a = projected[edges[i][0]];
    const b = projected[edges[i][1]];
    if (!a || !b) continue;
    const { dist } = pointSegmentDistance(cursorX, cursorY, a.x, a.y, b.x, b.y);
    if (dist <= radius) cands.push({ i, d: dist });
  }
  cands.sort((a, b) => a.d - b.d || a.i - b.i);
  for (const c of cands) {
    if (!isVisible || isVisible(c.i)) return c.i;
  }
  return -1;
}

/** Depth tolerance for "is this point on the front surface": grows with distance. */
export function occlusionEpsilon(hitDistance: number): number {
  return 0.01 + hitDistance * 0.003;
}

/** A point is visible when nothing is hit along its ray, or it is not behind the first hit. */
export function isDepthVisible(pointDepth: number, hitDistance: number | null): boolean {
  if (hitDistance === null) return true;
  return pointDepth <= hitDistance + occlusionEpsilon(hitDistance);
}

/** Toggle `value` in a list (shift-click): remove when present, append otherwise. */
export function toggleInList<T>(
  list: ReadonlyArray<T>,
  value: T,
  equals: (a: T, b: T) => boolean = (a, b) => a === b
): T[] {
  const idx = list.findIndex((x) => equals(x, value));
  if (idx >= 0) return list.filter((_, i) => i !== idx);
  return [...list, value];
}

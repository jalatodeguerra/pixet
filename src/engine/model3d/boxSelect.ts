import type { PolyFace, PolyMeshData, Vec2 } from "./types.ts";

/**
 * Pure helpers for Blender-style box select (B) and element-set selection
 * (select all / invert). Callers project world positions to screen pixels;
 * everything here works on those projected points, so occlusion is ignored
 * (X-ray style).
 */

export interface ScreenRect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export type BoxSelectMode = "replace" | "add" | "subtract";

/** A projected point in viewport pixels, or null when it cannot be projected (behind camera). */
export type ProjectedPoint = Vec2 | null;

export function normalizeRect(ax: number, ay: number, bx: number, by: number): ScreenRect {
  return {
    x0: Math.min(ax, bx),
    y0: Math.min(ay, by),
    x1: Math.max(ax, bx),
    y1: Math.max(ay, by),
  };
}

export function pointInRect(p: ProjectedPoint, rect: ScreenRect): boolean {
  if (!p) return false;
  return p[0] >= rect.x0 && p[0] <= rect.x1 && p[1] >= rect.y0 && p[1] <= rect.y1;
}

/** Shift adds, Ctrl subtracts (Ctrl wins), otherwise the hit set replaces the selection. */
export function boxSelectMode(shift: boolean, ctrl: boolean): BoxSelectMode {
  if (ctrl) return "subtract";
  if (shift) return "add";
  return "replace";
}

export function selectVerticesInRect(
  projected: ReadonlyArray<ProjectedPoint>,
  rect: ScreenRect
): number[] {
  const hits: number[] = [];
  for (let i = 0; i < projected.length; i++) {
    if (pointInRect(projected[i], rect)) hits.push(i);
  }
  return hits;
}

export function edgeKey(a: number, b: number): string {
  return a < b ? `${a}:${b}` : `${b}:${a}`;
}

/** Unique canonical `[min, max]` edges of a mesh, in first-seen order. */
export function collectUniqueEdges(mesh: PolyMeshData): Array<[number, number]> {
  const seen = new Set<string>();
  const edges: Array<[number, number]> = [];
  for (const face of mesh.faces) {
    const n = face.verts.length;
    for (let i = 0; i < n; i++) {
      const a = face.verts[i];
      const b = face.verts[(i + 1) % n];
      if (a === b) continue;
      const k = edgeKey(a, b);
      if (seen.has(k)) continue;
      seen.add(k);
      edges.push(a < b ? [a, b] : [b, a]);
    }
  }
  return edges;
}

/** Edges whose two endpoints both project inside the rectangle. */
export function selectEdgesInRect(
  projected: ReadonlyArray<ProjectedPoint>,
  edges: ReadonlyArray<readonly [number, number]>,
  rect: ScreenRect
): Array<[number, number]> {
  const hits: Array<[number, number]> = [];
  for (const [a, b] of edges) {
    if (pointInRect(projected[a] ?? null, rect) && pointInRect(projected[b] ?? null, rect)) {
      hits.push(a < b ? [a, b] : [b, a]);
    }
  }
  return hits;
}

/** Faces whose projected centroid lies inside the rectangle. */
export function selectFacesInRect(
  projected: ReadonlyArray<ProjectedPoint>,
  faces: ReadonlyArray<Pick<PolyFace, "id" | "verts">>,
  rect: ScreenRect
): string[] {
  const hits: string[] = [];
  for (const face of faces) {
    let sx = 0;
    let sy = 0;
    let count = 0;
    let missing = false;
    for (const vi of face.verts) {
      const p = projected[vi];
      if (!p) {
        missing = true;
        break;
      }
      sx += p[0];
      sy += p[1];
      count += 1;
    }
    if (missing || count === 0) continue;
    if (pointInRect([sx / count, sy / count], rect)) hits.push(face.id);
  }
  return hits;
}

/** Nodes whose projected anchor point lies inside the rectangle. */
export function selectNodesInRect(
  nodes: ReadonlyArray<{ id: string; point: ProjectedPoint }>,
  rect: ScreenRect
): string[] {
  return nodes.filter((n) => pointInRect(n.point, rect)).map((n) => n.id);
}

/** Combines an existing selection with box-select hits according to the mode. */
export function combineSelection<T>(
  existing: ReadonlyArray<T>,
  hits: ReadonlyArray<T>,
  mode: BoxSelectMode,
  keyOf: (item: T) => string = (item) => String(item)
): T[] {
  if (mode === "replace") return [...hits];
  if (mode === "add") {
    const have = new Set(existing.map(keyOf));
    const out = [...existing];
    for (const h of hits) {
      const k = keyOf(h);
      if (!have.has(k)) {
        have.add(k);
        out.push(h);
      }
    }
    return out;
  }
  const remove = new Set(hits.map(keyOf));
  return existing.filter((e) => !remove.has(keyOf(e)));
}

/** Elements of `all` that are not in `selected` (invert selection). */
export function invertSelection<T>(
  all: ReadonlyArray<T>,
  selected: ReadonlyArray<T>,
  keyOf: (item: T) => string = (item) => String(item)
): T[] {
  const sel = new Set(selected.map(keyOf));
  return all.filter((a) => !sel.has(keyOf(a)));
}

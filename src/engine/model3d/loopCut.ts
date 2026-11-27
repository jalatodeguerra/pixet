import { clonePolyMeshData } from "./Model3DEngine.ts";
import { edgeKey } from "./boxSelect.ts";
import { subdivideFacesOrLoopCut } from "./meshOps.ts";
import type { PolyFace, PolyMeshData } from "./types.ts";

/**
 * Loop cut driven by a selected edge (Blender Ctrl+R): the new loop crosses the
 * selected edge at its midpoint and continues around the quad ring it belongs to.
 *
 * Each ring quad is rotated so its entry edge becomes `v0-v1`; a single call to
 * `subdivideFacesOrLoopCut(..., "u")` then splits all of them, sharing midpoint
 * vertices between neighbours so the cut stays watertight. Non-quad neighbours
 * are never split, so a ring ending against a triangle leaves a T-junction.
 */

interface RingEntry {
  faceId: string;
  /** Index of the entry edge (verts[i] -> verts[i+1]) within the quad. */
  entryIndex: number;
}

function rotateArray<T>(arr: ReadonlyArray<T>, k: number): T[] {
  const n = arr.length;
  return arr.map((_, i) => arr[(i + k) % n]);
}

/** Quads of the ring crossed by `edge`, each with the index of its crossing edge. */
export function collectEdgeRing(
  mesh: PolyMeshData,
  edge: readonly [number, number]
): RingEntry[] {
  const edgeFaces = new Map<string, PolyFace[]>();
  for (const face of mesh.faces) {
    const n = face.verts.length;
    for (let i = 0; i < n; i++) {
      const k = edgeKey(face.verts[i], face.verts[(i + 1) % n]);
      const list = edgeFaces.get(k);
      if (list) list.push(face);
      else edgeFaces.set(k, [face]);
    }
  }

  const entryIndexOf = (face: PolyFace, key: string): number => {
    for (let i = 0; i < 4; i++) {
      if (edgeKey(face.verts[i], face.verts[(i + 1) % 4]) === key) return i;
    }
    return -1;
  };

  const startKey = edgeKey(edge[0], edge[1]);
  const startFaces = (edgeFaces.get(startKey) ?? []).filter((f) => f.verts.length === 4);
  const visited = new Set<string>();
  const ring: RingEntry[] = [];

  for (const first of startFaces) {
    let current: PolyFace | undefined = first;
    let entryKey = startKey;
    while (current && !visited.has(current.id)) {
      const entryIndex = entryIndexOf(current, entryKey);
      if (entryIndex < 0) break;
      visited.add(current.id);
      ring.push({ faceId: current.id, entryIndex });
      const oppIndex = (entryIndex + 2) % 4;
      const oppKey = edgeKey(
        current.verts[oppIndex],
        current.verts[(oppIndex + 1) % 4]
      );
      const cur: PolyFace = current;
      const next: PolyFace | undefined = (edgeFaces.get(oppKey) ?? []).find(
        (f) => f.id !== cur.id && f.verts.length === 4
      );
      current = next;
      entryKey = oppKey;
    }
  }
  return ring;
}

/**
 * Cuts one loop through each given edge's ring. Returns the new mesh and the new
 * loop's edges (the segments joining each pair of new midpoints).
 */
export function loopCutEdges(
  mesh: PolyMeshData,
  edges: ReadonlyArray<readonly [number, number]>
): { mesh: PolyMeshData; newEdges: Array<[number, number]>; cutFaceCount: number } {
  const claimed = new Map<string, number>();
  for (const e of edges) {
    for (const entry of collectEdgeRing(mesh, e)) {
      if (!claimed.has(entry.faceId)) claimed.set(entry.faceId, entry.entryIndex);
    }
  }
  if (claimed.size === 0) {
    return { mesh: clonePolyMeshData(mesh), newEdges: [], cutFaceCount: 0 };
  }

  const prepared = clonePolyMeshData(mesh);
  for (const face of prepared.faces) {
    const k = claimed.get(face.id);
    if (k === undefined || k === 0) continue;
    face.verts = rotateArray(face.verts, k);
    face.uvs = rotateArray(face.uvs, k);
    if (face.colors && face.colors.length === 4) face.colors = rotateArray(face.colors, k);
    if (k % 2 === 1) face.triSplit = (face.triSplit ?? "02") === "02" ? "13" : "02";
  }

  const cut = subdivideFacesOrLoopCut(prepared, Array.from(claimed.keys()), "u");

  // The first sub-quad of a "u" split is [v0, m01, m32, v3] and keeps the face id.
  const newEdges: Array<[number, number]> = [];
  const byId = new Map(cut.faces.map((f) => [f.id, f]));
  const seen = new Set<string>();
  for (const id of claimed.keys()) {
    const f = byId.get(id);
    if (!f || f.verts.length !== 4) continue;
    const a = f.verts[1];
    const b = f.verts[2];
    const k = edgeKey(a, b);
    if (seen.has(k)) continue;
    seen.add(k);
    newEdges.push(a < b ? [a, b] : [b, a]);
  }
  return { mesh: cut, newEdges, cutFaceCount: claimed.size };
}

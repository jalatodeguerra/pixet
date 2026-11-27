// Non-destructive, Blender-style modifier stack for low-poly meshes. Pure and React-free.
//
// COORDINATE SPACE
// ----------------
// PolyMeshData vertices are stored in scene pixel units, and the viewport / exporter build
// geometry as `(vertex - node.transform.pivot) / ppu` (see sceneSync.buildPolyMeshGeometry).
// The node pivot is therefore the node's local origin. Mirror reflects across the plane
// through the PIVOT (axis coordinate == pivot[axis]), and array offsets are in the same pixel
// space (translation-invariant). Callers pass `opts.pivot = node.transform.pivot`;
// `getEvaluatedMesh` / `applyModifier` do this automatically. `pivot` defaults to [0,0,0].
//
// Callers (viewport, glTF/OBJ export, sprite bake) should simply call
// `getEvaluatedMesh(node, "viewport" | "export")` instead of reading `node.mesh`.

import { cloneModelNode, clonePolyFace, clonePolyMeshData } from "./Model3DEngine.ts";
import { bevelEdges, computeFaceNormal } from "./meshOps.ts";
import { cloneModifiers } from "./modifierTypes.ts";
import type {
  ArrayModifier,
  BevelModifier,
  MirrorModifier,
  ModelModifier,
  SolidifyModifier,
  SubdivideModifier,
} from "./modifierTypes.ts";
import type { ModelNode, PolyFace, PolyMeshData, Vec2, Vec3 } from "./types.ts";

export {
  MODIFIER_LABELS,
  MODIFIER_LIMITS,
  MODIFIER_TYPES,
  cloneModifier,
  cloneModifiers,
  createModifier,
  duplicateModifier,
  moveModifier,
  removeModifier,
  sanitizeModifiers,
  updateModifier,
} from "./modifierTypes.ts";
export type {
  ArrayModifier,
  BevelModifier,
  MirrorModifier,
  ModelModifier,
  ModifierType,
  SolidifyModifier,
  SubdivideModifier,
  TriangulateModifier,
} from "./modifierTypes.ts";

export const MAX_MODIFIER_FACES = 200_000;

export type ModifierContext = "viewport" | "export";

export interface EvaluateModifierOptions {
  context: ModifierContext;
  /** Node pivot (mirror plane origin). Default [0,0,0]. */
  pivot?: Vec3;
  /** Output face cap; default MAX_MODIFIER_FACES. */
  maxFaces?: number;
}

export interface EvaluateModifierResult {
  mesh: PolyMeshData;
  /** True when a modifier was skipped (and the rest abandoned) because it would exceed the cap. */
  truncated: boolean;
  /** Face count after each APPLIED modifier, keyed by modifier id. */
  perModifierFaceCount: Record<string, number>;
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function isModifierActive(m: ModelModifier, context: ModifierContext): boolean {
  return context === "viewport" ? m.enabled && m.showInViewport : m.enabled;
}

function edgeKey(a: number, b: number): string {
  return a < b ? `${a}_${b}` : `${b}_${a}`;
}

function parseHex(c: string): [number, number, number, number] | null {
  const m = /^#([0-9a-f]{6})([0-9a-f]{2})?$/i.exec(c);
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255, m[2] ? parseInt(m[2], 16) : 255];
}

function avgColors(cols: string[]): string {
  const parsed = cols.map(parseHex);
  if (parsed.some((p) => !p)) return cols[0];
  const acc = [0, 0, 0, 0];
  for (const p of parsed as number[][]) for (let i = 0; i < 4; i++) acc[i] += p[i];
  const h = (v: number) =>
    Math.max(0, Math.min(255, Math.round(v / cols.length)))
      .toString(16)
      .padStart(2, "0");
  const hasAlpha = cols.some((c) => c.length === 9);
  return `#${h(acc[0])}${h(acc[1])}${h(acc[2])}${hasAlpha ? h(acc[3]) : ""}`;
}

function avgUv(uvs: Vec2[]): Vec2 {
  let x = 0;
  let y = 0;
  for (const uv of uvs) {
    x += uv[0];
    y += uv[1];
  }
  return [x / uvs.length, y / uvs.length];
}

function meshBounds(vertices: ReadonlyArray<Vec3>): { min: Vec3; max: Vec3 } {
  const min: Vec3 = [Infinity, Infinity, Infinity];
  const max: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (const v of vertices) {
    for (let a = 0; a < 3; a++) {
      if (v[a] < min[a]) min[a] = v[a];
      if (v[a] > max[a]) max[a] = v[a];
    }
  }
  if (!Number.isFinite(min[0])) return { min: [0, 0, 0], max: [0, 0, 0] };
  return { min, max };
}

/** Remaps face vertices, collapses repeated corners (quad -> tri), drops degenerate faces, compacts vertices. */
function remapAndCompact(
  vertices: Vec3[],
  faces: PolyFace[],
  remap: ReadonlyArray<number>
): PolyMeshData {
  const outFaces: PolyFace[] = [];
  for (const f of faces) {
    const keep: number[] = [];
    const verts = f.verts.map((v) => remap[v] ?? v);
    for (let i = 0; i < verts.length; i++) {
      if (verts[i] !== verts[(i + 1) % verts.length]) keep.push(i);
    }
    // also collapse non-adjacent repeats (bow-tie) conservatively by dropping the face
    const kept = keep.map((i) => verts[i]);
    if (kept.length < 3 || new Set(kept).size !== kept.length) continue;
    const nf = clonePolyFace(f);
    nf.verts = kept;
    nf.uvs = keep.map((i) => f.uvs[i] ?? [0, 0]);
    if (f.colors) nf.colors = keep.map((i) => f.colors![i] ?? "#ffffff");
    if (kept.length === 3) nf.triSplit = undefined;
    outFaces.push(nf);
  }
  const newIndex = new Map<number, number>();
  const outVerts: Vec3[] = [];
  for (const f of outFaces) {
    f.verts = f.verts.map((v) => {
      let ni = newIndex.get(v);
      if (ni === undefined) {
        ni = outVerts.length;
        newIndex.set(v, ni);
        outVerts.push([vertices[v][0], vertices[v][1], vertices[v][2]]);
      }
      return ni;
    });
  }
  return { vertices: outVerts, faces: outFaces };
}

function reverseFace(f: PolyFace): PolyFace {
  const n = clonePolyFace(f);
  const rev = <T,>(arr: T[]): T[] => [arr[0], ...arr.slice(1).reverse()];
  n.verts = rev(n.verts);
  n.uvs = rev(n.uvs);
  if (n.colors) n.colors = rev(n.colors);
  return n;
}

// ---------------------------------------------------------------------------
// Mirror
// ---------------------------------------------------------------------------

function mirrorOnce(
  mesh: PolyMeshData,
  axis: 0 | 1 | 2,
  plane: number,
  merge: boolean,
  thr: number,
  prefix: string
): PolyMeshData {
  const n = mesh.vertices.length;
  const vertices: Vec3[] = mesh.vertices.map((v) => [v[0], v[1], v[2]]);
  const remap: number[] = [];
  for (let i = 0; i < n; i++) remap.push(i);
  for (let i = 0; i < n; i++) {
    const m: Vec3 = [vertices[i][0], vertices[i][1], vertices[i][2]];
    m[axis] = 2 * plane - m[axis];
    vertices.push(m);
    remap.push(n + i);
  }
  if (merge) {
    for (let i = 0; i < n; i++) {
      if (Math.abs(vertices[i][axis] - plane) <= thr) {
        vertices[i][axis] = plane;
        remap[n + i] = i;
      }
    }
  }
  const faces: PolyFace[] = mesh.faces.map(clonePolyFace);
  for (const f of mesh.faces) {
    const r = reverseFace(f);
    r.id = `${prefix}${f.id}`;
    r.verts = r.verts.map((v) => v + n);
    faces.push(r);
  }
  return remapAndCompact(vertices, faces, remap);
}

function applyMirror(mesh: PolyMeshData, m: MirrorModifier, pivot: Vec3, maxFaces: number): PolyMeshData | null {
  let cur = mesh;
  const axes: Array<[0 | 1 | 2, boolean, string]> = [
    [0, m.axes.x, "x"],
    [1, m.axes.y, "y"],
    [2, m.axes.z, "z"],
  ];
  for (const [axis, on, label] of axes) {
    if (!on) continue;
    if (cur.faces.length * 2 > maxFaces) return null;
    cur = mirrorOnce(cur, axis, pivot[axis], m.mergeSeam, Math.max(0, m.mergeThresholdPx), `${m.id}.m${label}.`);
  }
  return cur === mesh ? clonePolyMeshData(mesh) : cur;
}

// ---------------------------------------------------------------------------
// Array
// ---------------------------------------------------------------------------

function applyArray(mesh: PolyMeshData, m: ArrayModifier, maxFaces: number): PolyMeshData | null {
  const count = Math.max(1, Math.round(m.count));
  if (mesh.faces.length * count > maxFaces) return null;
  const { min, max } = meshBounds(mesh.vertices);
  const step: Vec3 = [0, 1, 2].map(
    (a) => m.relativeOffset[a] * (max[a] - min[a]) + m.constantOffsetPx[a]
  ) as Vec3;
  const n = mesh.vertices.length;
  const vertices: Vec3[] = [];
  const faces: PolyFace[] = [];
  for (let c = 0; c < count; c++) {
    for (const v of mesh.vertices) {
      vertices.push([v[0] + step[0] * c, v[1] + step[1] * c, v[2] + step[2] * c]);
    }
    for (const f of mesh.faces) {
      const nf = clonePolyFace(f);
      if (c > 0) {
        nf.id = `${m.id}.${c}.${f.id}`;
        nf.verts = nf.verts.map((v) => v + c * n);
      }
      faces.push(nf);
    }
  }
  const remap: number[] = vertices.map((_, i) => i);
  if (m.mergeAdjacent && count > 1 && n > 0) {
    const thr = Math.max(0, m.mergeThresholdPx);
    const cell = Math.max(thr, 1e-4);
    for (let c = 1; c < count; c++) {
      const grid = new Map<string, number[]>();
      const key = (x: number, y: number, z: number) =>
        `${Math.floor(x / cell)},${Math.floor(y / cell)},${Math.floor(z / cell)}`;
      const base = (c - 1) * n;
      for (let i = 0; i < n; i++) {
        const v = vertices[base + i];
        const k = key(v[0], v[1], v[2]);
        const bucket = grid.get(k);
        if (bucket) bucket.push(base + i);
        else grid.set(k, [base + i]);
      }
      for (let i = 0; i < n; i++) {
        const v = vertices[c * n + i];
        const cx = Math.floor(v[0] / cell);
        const cy = Math.floor(v[1] / cell);
        const cz = Math.floor(v[2] / cell);
        let found = -1;
        for (let dx = -1; dx <= 1 && found < 0; dx++)
          for (let dy = -1; dy <= 1 && found < 0; dy++)
            for (let dz = -1; dz <= 1 && found < 0; dz++) {
              const b = grid.get(`${cx + dx},${cy + dy},${cz + dz}`);
              if (!b) continue;
              for (const j of b) {
                const w = vertices[j];
                const d = Math.hypot(w[0] - v[0], w[1] - v[1], w[2] - v[2]);
                if (d <= Math.max(thr, 1e-6)) {
                  found = j;
                  break;
                }
              }
            }
        if (found >= 0) remap[c * n + i] = remap[found];
      }
    }
  }
  return remapAndCompact(vertices, faces, remap);
}

// ---------------------------------------------------------------------------
// Subdivide (linear; tris -> 4 tris, quads -> 4 quads, shared edge midpoints)
// ---------------------------------------------------------------------------

function subdivideOnce(mesh: PolyMeshData): PolyMeshData {
  const vertices: Vec3[] = mesh.vertices.map((v) => [v[0], v[1], v[2]]);
  const mids = new Map<string, number>();
  const midpoint = (a: number, b: number): number => {
    const k = edgeKey(a, b);
    let idx = mids.get(k);
    if (idx === undefined) {
      const va = vertices[a];
      const vb = vertices[b];
      idx = vertices.length;
      vertices.push([(va[0] + vb[0]) / 2, (va[1] + vb[1]) / 2, (va[2] + vb[2]) / 2]);
      mids.set(k, idx);
    }
    return idx;
  };
  const out: PolyFace[] = [];
  for (const f of mesh.faces) {
    const k = f.verts.length;
    if (k !== 3 && k !== 4) {
      out.push(clonePolyFace(f));
      continue;
    }
    const uvs: Vec2[] = f.verts.map((_, i) => f.uvs[i] ?? [0, 0]);
    const cols = f.colors && f.colors.length === k ? f.colors : undefined;
    const mv = f.verts.map((_, i) => midpoint(f.verts[i], f.verts[(i + 1) % k]));
    const mu = f.verts.map((_, i) => avgUv([uvs[i], uvs[(i + 1) % k]]));
    const mc = cols ? f.verts.map((_, i) => avgColors([cols[i], cols[(i + 1) % k]])) : undefined;
    const pieces: Array<{ v: number[]; uv: Vec2[]; c?: string[] }> = [];
    if (k === 4) {
      const centerIdx = vertices.length;
      const p = f.verts.map((v) => vertices[v]);
      vertices.push([
        (p[0][0] + p[1][0] + p[2][0] + p[3][0]) / 4,
        (p[0][1] + p[1][1] + p[2][1] + p[3][1]) / 4,
        (p[0][2] + p[1][2] + p[2][2] + p[3][2]) / 4,
      ]);
      const cu = avgUv(uvs);
      const cc = cols ? avgColors(cols) : undefined;
      for (let i = 0; i < 4; i++) {
        const prev = (i + 3) % 4;
        pieces.push({
          v: [f.verts[i], mv[i], centerIdx, mv[prev]],
          uv: [uvs[i], mu[i], cu, mu[prev]],
          c: cols && mc && cc ? [cols[i], mc[i], cc, mc[prev]] : undefined,
        });
      }
    } else {
      for (let i = 0; i < 3; i++) {
        const prev = (i + 2) % 3;
        pieces.push({
          v: [f.verts[i], mv[i], mv[prev]],
          uv: [uvs[i], mu[i], mu[prev]],
          c: cols && mc ? [cols[i], mc[i], mc[prev]] : undefined,
        });
      }
      pieces.push({ v: [mv[0], mv[1], mv[2]], uv: [mu[0], mu[1], mu[2]], c: mc ? [mc[0], mc[1], mc[2]] : undefined });
    }
    pieces.forEach((pc, i) => {
      const nf = clonePolyFace(f);
      nf.id = i === 0 ? f.id : `${f.id}-s${i}`;
      nf.verts = pc.v;
      nf.uvs = pc.uv;
      nf.colors = pc.c;
      nf.triSplit = k === 4 ? "02" : undefined;
      out.push(nf);
    });
  }
  return { vertices, faces: out };
}

function applySubdivide(mesh: PolyMeshData, m: SubdivideModifier, maxFaces: number): PolyMeshData | null {
  const levels = Math.max(1, Math.min(3, Math.round(m.levels)));
  let cur = mesh;
  for (let l = 0; l < levels; l++) {
    if (cur.faces.length * 4 > maxFaces) return null;
    cur = subdivideOnce(cur);
  }
  return cur;
}

// ---------------------------------------------------------------------------
// Solidify
// ---------------------------------------------------------------------------

function applySolidify(mesh: PolyMeshData, m: SolidifyModifier, maxFaces: number): PolyMeshData | null {
  const t = Math.abs(m.thicknessPx); // sign ignored; use `offset` to pick the side
  if (!Number.isFinite(t) || Math.abs(t) < 1e-6 || mesh.faces.length === 0) return clonePolyMeshData(mesh);
  const n = mesh.vertices.length;
  const normals: Vec3[] = mesh.vertices.map(() => [0, 0, 0]);
  for (const f of mesh.faces) {
    const fn = computeFaceNormal(mesh.vertices, f);
    for (const vi of f.verts) {
      normals[vi][0] += fn[0];
      normals[vi][1] += fn[1];
      normals[vi][2] += fn[2];
    }
  }
  for (const nv of normals) {
    const len = Math.hypot(nv[0], nv[1], nv[2]);
    if (len > 1e-9) {
      nv[0] /= len;
      nv[1] /= len;
      nv[2] /= len;
    }
  }
  const off = Math.max(-1, Math.min(1, m.offset));
  const outer = (off + 1) / 2;
  const vertices: Vec3[] = [];
  for (let i = 0; i < n; i++) {
    const v = mesh.vertices[i];
    const k = t * outer;
    vertices.push([v[0] + normals[i][0] * k, v[1] + normals[i][1] * k, v[2] + normals[i][2] * k]);
  }
  for (let i = 0; i < n; i++) {
    const a = vertices[i];
    vertices.push([a[0] - normals[i][0] * t, a[1] - normals[i][1] * t, a[2] - normals[i][2] * t]);
  }

  // boundary edges: directed edges whose reverse is absent
  const edgeUse = new Map<string, number>();
  for (const f of mesh.faces) {
    for (let i = 0; i < f.verts.length; i++) {
      const k = edgeKey(f.verts[i], f.verts[(i + 1) % f.verts.length]);
      edgeUse.set(k, (edgeUse.get(k) ?? 0) + 1);
    }
  }
  const faces: PolyFace[] = mesh.faces.map(clonePolyFace);
  for (const f of mesh.faces) {
    const inner = reverseFace(f);
    inner.id = `${m.id}.in.${f.id}`;
    inner.verts = inner.verts.map((v) => v + n);
    faces.push(inner);
  }
  if (m.rim) {
    for (const f of mesh.faces) {
      const k = f.verts.length;
      for (let i = 0; i < k; i++) {
        const a = f.verts[i];
        const b = f.verts[(i + 1) % k];
        if (edgeUse.get(edgeKey(a, b)) !== 1) continue;
        const ua = f.uvs[i] ?? [0, 0];
        const ub = f.uvs[(i + 1) % k] ?? [0, 0];
        const rim: PolyFace = {
          id: `${m.id}.rim.${f.id}.${i}`,
          verts: [a, a + n, b + n, b],
          uvs: [[ua[0], ua[1]], [ua[0], ua[1]], [ub[0], ub[1]], [ub[0], ub[1]]],
          colors: f.colors ? [f.colors[i], f.colors[i], f.colors[(i + 1) % k], f.colors[(i + 1) % k]] : undefined,
          triSplit: "02",
          flatShading: f.flatShading,
          materialId: f.materialId,
        };
        faces.push(rim);
      }
    }
  }
  if (faces.length > maxFaces) return null;
  return { vertices, faces };
}

// ---------------------------------------------------------------------------
// Bevel (sharp edges). bevelEdges() leaves edges that share a vertex with an already
// processed edge untouched, so only a maximal vertex-disjoint subset (greedy, stable order)
// of the sharp edges is passed in. Adjacent sharp edges are therefore NOT all beveled.
// ---------------------------------------------------------------------------

function applyBevel(mesh: PolyMeshData, m: BevelModifier, maxFaces: number): PolyMeshData | null {
  if (m.widthPx <= 1e-6) return clonePolyMeshData(mesh);
  const edgeFaces = new Map<string, number[]>();
  mesh.faces.forEach((f, fi) => {
    for (let i = 0; i < f.verts.length; i++) {
      const a = f.verts[i];
      const b = f.verts[(i + 1) % f.verts.length];
      const k = edgeKey(a, b);
      const list = edgeFaces.get(k);
      if (list) list.push(fi);
      else edgeFaces.set(k, [fi]);
    }
  });
  const cosLimit = Math.cos((Math.max(0, Math.min(180, m.angleDeg)) * Math.PI) / 180);
  const normals = mesh.faces.map((f) => computeFaceNormal(mesh.vertices, f));
  const used = new Set<number>();
  const edges: Array<[number, number]> = [];
  for (const [k, fl] of edgeFaces) {
    if (fl.length !== 2) continue;
    const na = normals[fl[0]];
    const nb = normals[fl[1]];
    const dot = na[0] * nb[0] + na[1] * nb[1] + na[2] * nb[2];
    if (dot >= cosLimit) continue; // angle <= threshold
    const [a, b] = k.split("_").map(Number);
    if (used.has(a) || used.has(b)) continue;
    used.add(a);
    used.add(b);
    edges.push([a, b]);
  }
  if (edges.length === 0) return clonePolyMeshData(mesh);
  const res = bevelEdges(mesh, edges, m.widthPx).mesh;
  if (res.faces.length > maxFaces) return null;
  const prefix = `${m.id}.`;
  const seen = new Set(mesh.faces.map((f) => f.id));
  for (const f of res.faces) {
    if (!seen.has(f.id)) f.id = prefix + f.id;
  }
  return res;
}

// ---------------------------------------------------------------------------
// Triangulate
// ---------------------------------------------------------------------------

function applyTriangulate(mesh: PolyMeshData, id: string, maxFaces: number): PolyMeshData | null {
  const out: PolyFace[] = [];
  for (const f of mesh.faces) {
    if (f.verts.length !== 4) {
      out.push(clonePolyFace(f));
      continue;
    }
    const tris: Array<[number, number, number]> =
      f.triSplit === "13"
        ? [[0, 1, 3], [1, 2, 3]]
        : f.triSplit === "02"
          ? [[0, 1, 2], [0, 2, 3]]
          : (() => {
              const d = (a: number, b: number) => {
                const p = mesh.vertices[f.verts[a]];
                const q = mesh.vertices[f.verts[b]];
                return (p[0] - q[0]) ** 2 + (p[1] - q[1]) ** 2 + (p[2] - q[2]) ** 2;
              };
              return d(0, 2) <= d(1, 3)
                ? ([[0, 1, 2], [0, 2, 3]] as Array<[number, number, number]>)
                : ([[0, 1, 3], [1, 2, 3]] as Array<[number, number, number]>);
            })();
    tris.forEach((t, i) => {
      const nf = clonePolyFace(f);
      nf.id = i === 0 ? f.id : `${id}.${f.id}-t`;
      nf.verts = t.map((c) => f.verts[c]);
      nf.uvs = t.map((c) => f.uvs[c] ?? [0, 0]);
      nf.colors = f.colors ? t.map((c) => f.colors![c]) : undefined;
      nf.triSplit = undefined;
      out.push(nf);
    });
  }
  if (out.length > maxFaces) return null;
  return { vertices: mesh.vertices.map((v) => [v[0], v[1], v[2]]), faces: out };
}

// ---------------------------------------------------------------------------
// Stack evaluation
// ---------------------------------------------------------------------------

function applyOne(mesh: PolyMeshData, m: ModelModifier, pivot: Vec3, maxFaces: number): PolyMeshData | null {
  switch (m.type) {
    case "mirror":
      return applyMirror(mesh, m, pivot, maxFaces);
    case "array":
      return applyArray(mesh, m, maxFaces);
    case "subdivide":
      return applySubdivide(mesh, m, maxFaces);
    case "solidify":
      return applySolidify(mesh, m, maxFaces);
    case "bevel":
      return applyBevel(mesh, m, maxFaces);
    case "triangulate":
      return applyTriangulate(mesh, m.id, maxFaces);
  }
}

function ensureUniqueFaceIds(mesh: PolyMeshData): void {
  const seen = new Set<string>();
  for (const f of mesh.faces) {
    let id = f.id;
    let s = 1;
    while (seen.has(id)) id = `${f.id}~${s++}`;
    seen.add(id);
    f.id = id;
  }
}

export function evaluateModifierStackDetailed(
  mesh: PolyMeshData,
  modifiers: ReadonlyArray<ModelModifier>,
  opts: EvaluateModifierOptions
): EvaluateModifierResult {
  const pivot = opts.pivot ?? [0, 0, 0];
  const maxFaces = opts.maxFaces ?? MAX_MODIFIER_FACES;
  const perModifierFaceCount: Record<string, number> = {};
  let cur: PolyMeshData | null = null; // lazily cloned so the input is never aliased
  let truncated = false;
  for (const m of modifiers) {
    if (!isModifierActive(m, opts.context)) continue;
    const src: PolyMeshData = cur ?? mesh;
    const next = applyOne(src, m, pivot, maxFaces);
    if (!next || next.faces.length > maxFaces) {
      truncated = true;
      break;
    }
    cur = next;
    perModifierFaceCount[m.id] = next.faces.length;
  }
  const result = cur ?? clonePolyMeshData(mesh);
  ensureUniqueFaceIds(result);
  return { mesh: result, truncated, perModifierFaceCount };
}

/** Applies the active modifiers in order and returns a NEW mesh; the input is never mutated. */
export function evaluateModifierStack(
  mesh: PolyMeshData,
  modifiers: ReadonlyArray<ModelModifier>,
  opts: EvaluateModifierOptions
): PolyMeshData {
  return evaluateModifierStackDetailed(mesh, modifiers, opts).mesh;
}

// ---------------------------------------------------------------------------
// Node-level API
// ---------------------------------------------------------------------------

/**
 * Bakes the modifier stack prefix up to and including `modifierId` into node.mesh and removes
 * those modifiers (Blender applies a non-first modifier with a warning; here the earlier
 * modifiers are baked too so the result is well defined). Disabled modifiers in the prefix are
 * removed without effect; `showInViewport` is ignored. Returns a new node; unknown id or a node
 * without a mesh returns the node unchanged.
 */
export function applyModifier(node: ModelNode, modifierId: string): ModelNode {
  const list = node.modifiers ?? [];
  const idx = list.findIndex((m) => m.id === modifierId);
  if (idx < 0 || !node.mesh) return node;
  return bakePrefix(node, idx + 1);
}

export function applyAllModifiers(node: ModelNode): ModelNode {
  const list = node.modifiers ?? [];
  if (list.length === 0 || !node.mesh) return node;
  return bakePrefix(node, list.length);
}

function bakePrefix(node: ModelNode, count: number): ModelNode {
  const list = node.modifiers ?? [];
  const prefix = list.slice(0, count);
  const rest = list.slice(count);
  const mesh = evaluateModifierStack(node.mesh as PolyMeshData, prefix, {
    context: "export",
    pivot: node.transform.pivot,
  });
  const next = cloneModelNode(node);
  next.mesh = mesh;
  if (rest.length > 0) next.modifiers = cloneModifiers(rest);
  else delete next.modifiers;
  return next;
}

// ---- cached evaluation ------------------------------------------------------

interface CacheEntry {
  key: string;
  mesh: PolyMeshData;
}
const evalCache = new WeakMap<PolyMeshData, Partial<Record<ModifierContext, CacheEntry>>>();

function meshFingerprint(mesh: PolyMeshData): string {
  // Cheap guard against in-place vertex edits that keep object identity.
  let s = 0;
  for (let i = 0; i < mesh.vertices.length; i++) {
    const v = mesh.vertices[i];
    s += (v[0] * 31 + v[1] * 17 + v[2] * 7) * ((i % 13) + 1);
  }
  let fs = 0;
  for (const f of mesh.faces) fs += f.verts.length + f.verts[0] * 3;
  return `${mesh.vertices.length}:${mesh.faces.length}:${s}:${fs}`;
}

/** Drops cached evaluations for a mesh (call after mutating it in place if needed). */
export function invalidateEvaluatedMesh(mesh: PolyMeshData): void {
  evalCache.delete(mesh);
}

/**
 * Returns node.mesh with the active modifier stack applied. Returns `node.mesh` itself (same
 * reference) when there is nothing to apply; otherwise a cached evaluated mesh keyed by
 * (mesh identity + fingerprint, pivot, modifier JSON, context). Treat the result as read-only.
 */
export function getEvaluatedMesh(node: ModelNode, context: ModifierContext): PolyMeshData | undefined {
  const mesh = node.mesh;
  const mods = node.modifiers;
  if (!mesh || !mods || mods.length === 0) return mesh;
  if (!mods.some((m) => isModifierActive(m, context))) return mesh;
  const key = `${meshFingerprint(mesh)}|${node.transform.pivot.join(",")}|${JSON.stringify(mods)}`;
  const bucket = evalCache.get(mesh) ?? {};
  const hit = bucket[context];
  if (hit && hit.key === key) return hit.mesh;
  const evaluated = evaluateModifierStack(mesh, mods, { context, pivot: node.transform.pivot });
  bucket[context] = { key, mesh: evaluated };
  evalCache.set(mesh, bucket);
  return evaluated;
}

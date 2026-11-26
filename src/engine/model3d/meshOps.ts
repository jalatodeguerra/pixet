import {
  cloneCuboidData,
  cloneModelNode,
  clonePolyFace,
  clonePolyMeshData,
} from "./Model3DEngine.ts";
import {
  eulerDegToQuat,
  quatRotateVec3,
  vec3Add,
  vec3Cross,
  vec3Dot,
  vec3Length,
  vec3Normalize,
  vec3Scale,
  vec3Sub,
} from "./quatMath.ts";
import type {
  CuboidData,
  CuboidFaceName,
  ModelNode,
  PolyFace,
  PolyMeshData,
  Quat,
  SelectionGranularity,
  Transform3D,
  Vec2,
  Vec3,
} from "./types.ts";
import { CUBOID_FACE_NAMES, cuboidFaceUvToCorners } from "./uvOps.ts";

function cleanZero(n: number): number {
  const cleaned = Math.round(n * 1e6) / 1e6;
  return Object.is(cleaned, -0) ? 0 : cleaned;
}

function cleanVec3(v: Vec3): Vec3 {
  return [cleanZero(v[0]), cleanZero(v[1]), cleanZero(v[2])];
}

function cleanVec2(v: Vec2): Vec2 {
  return [cleanZero(v[0]), cleanZero(v[1])];
}

function lerpVec3(a: Vec3, b: Vec3, t: number): Vec3 {
  return [
    a[0] + (b[0] - a[0]) * t,
    a[1] + (b[1] - a[1]) * t,
    a[2] + (b[2] - a[2]) * t,
  ];
}

function lerpVec2(a: Vec2, b: Vec2, t: number): Vec2 {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
}

function allocateUniqueFaceId(prefix: string, usedIds: Set<string>): string {
  let seq = 1;
  let candidate = `${prefix}-${seq}`;
  while (usedIds.has(candidate)) {
    seq += 1;
    candidate = `${prefix}-${seq}`;
  }
  usedIds.add(candidate);
  return candidate;
}

function collectUsedFaceIds(faces: ReadonlyArray<PolyFace>): Set<string> {
  const ids = new Set<string>();
  for (const face of faces) {
    ids.add(face.id);
  }
  return ids;
}

function reverseFaceKeepingAnchor(face: PolyFace): PolyFace {
  const cloned = clonePolyFace(face);
  if (cloned.verts.length < 3) return cloned;
  cloned.verts = [cloned.verts[0], ...cloned.verts.slice(1).reverse()];
  if (cloned.uvs.length === cloned.verts.length) {
    cloned.uvs = [cloned.uvs[0], ...cloned.uvs.slice(1).reverse()];
  } else if (cloned.uvs.length > 1) {
    cloned.uvs = [cloned.uvs[0], ...cloned.uvs.slice(1).reverse()];
  }
  if (cloned.colors && cloned.colors.length > 1) {
    cloned.colors = [cloned.colors[0], ...cloned.colors.slice(1).reverse()];
  }
  return cloned;
}

function compactUnusedVertices(mesh: PolyMeshData): PolyMeshData {
  const used = new Set<number>();
  for (const face of mesh.faces) {
    for (const vi of face.verts) {
      if (vi >= 0 && vi < mesh.vertices.length) {
        used.add(vi);
      }
    }
  }

  if (used.size === mesh.vertices.length) {
    return mesh;
  }

  const remap = new Map<number, number>();
  const newVertices: Vec3[] = [];
  for (let i = 0; i < mesh.vertices.length; i++) {
    if (used.has(i)) {
      remap.set(i, newVertices.length);
      newVertices.push([
        mesh.vertices[i][0],
        mesh.vertices[i][1],
        mesh.vertices[i][2],
      ]);
    }
  }

  const newFaces = mesh.faces.map((face) => {
    const next = clonePolyFace(face);
    next.verts = next.verts.map((vi) => remap.get(vi) ?? 0);
    return next;
  });

  return {
    vertices: newVertices,
    faces: newFaces,
  };
}

function parseHexByte(hex: string, offset: number): number {
  return parseInt(hex.slice(offset, offset + 2), 16);
}

function toHexByte(n: number): string {
  const clamped = Math.max(0, Math.min(255, Math.round(n)));
  return clamped.toString(16).padStart(2, "0");
}

function lerpColor(a: string, b: string, t: number): string {
  const hexRe = /^#([0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;
  const ma = hexRe.exec(a.trim());
  const mb = hexRe.exec(b.trim());
  if (!ma || !mb) {
    return t < 0.5 ? a : b;
  }
  const ha = ma[1];
  const hb = mb[1];
  const r = parseHexByte(ha, 0) + (parseHexByte(hb, 0) - parseHexByte(ha, 0)) * t;
  const g = parseHexByte(ha, 2) + (parseHexByte(hb, 2) - parseHexByte(ha, 2)) * t;
  const bl = parseHexByte(ha, 4) + (parseHexByte(hb, 4) - parseHexByte(ha, 4)) * t;
  if (ha.length === 8 || hb.length === 8) {
    const aa = ha.length === 8 ? parseHexByte(ha, 6) : 255;
    const ab = hb.length === 8 ? parseHexByte(hb, 6) : 255;
    const alpha = aa + (ab - aa) * t;
    return `#${toHexByte(r)}${toHexByte(g)}${toHexByte(bl)}${toHexByte(alpha)}`;
  }
  return `#${toHexByte(r)}${toHexByte(g)}${toHexByte(bl)}`;
}

// ============================================================================
// 1. Face Geometry Helpers
// ============================================================================

/**
 * Computes the unit face normal using Newell's method (CCW outward winding).
 * Handles both triangles and quads (including slightly non-planar quads).
 */
export function computeFaceNormal(
  vertices: ReadonlyArray<Vec3>,
  face: PolyFace
): Vec3 {
  const n = face.verts.length;
  if (n < 3) return [0, 0, 0];

  let nx = 0;
  let ny = 0;
  let nz = 0;

  for (let i = 0; i < n; i++) {
    const curr = vertices[face.verts[i]];
    const next = vertices[face.verts[(i + 1) % n]];
    if (!curr || !next) return [0, 0, 0];
    nx += (curr[1] - next[1]) * (curr[2] + next[2]);
    ny += (curr[2] - next[2]) * (curr[0] + next[0]);
    nz += (curr[0] - next[0]) * (curr[1] + next[1]);
  }

  const normalized = vec3Normalize([nx, ny, nz]);
  if (vec3Length(normalized) > 1e-12) {
    return normalized;
  }

  // Fallback for degenerate edge sequences
  const v0 = vertices[face.verts[0]];
  const v1 = vertices[face.verts[1]];
  const v2 = vertices[face.verts[2]];
  if (!v0 || !v1 || !v2) return [0, 0, 0];
  return vec3Normalize(vec3Cross(vec3Sub(v1, v0), vec3Sub(v2, v0)));
}

/**
 * Computes the arithmetic centroid of a face's vertices.
 */
export function computeFaceCentroid(
  vertices: ReadonlyArray<Vec3>,
  face: PolyFace
): Vec3 {
  let sx = 0;
  let sy = 0;
  let sz = 0;
  let count = 0;
  for (const vi of face.verts) {
    const v = vertices[vi];
    if (!v) continue;
    sx += v[0];
    sy += v[1];
    sz += v[2];
    count += 1;
  }
  if (count === 0) return [0, 0, 0];
  return [sx / count, sy / count, sz / count];
}

// ============================================================================
// 2. Cuboid -> PolyMeshData Conversion
// ============================================================================

const CUBOID_FACE_CORNER_INDICES: Record<
  CuboidFaceName,
  readonly [number, number, number, number]
> = {
  // Ordered [bottomLeft, bottomRight, topRight, topLeft] when viewed from outside (CCW)
  south: [4, 5, 6, 7], // +Z
  north: [1, 0, 3, 2], // -Z
  east: [5, 1, 2, 6], // +X
  west: [0, 4, 7, 3], // -X
  up: [7, 6, 2, 3], // +Y
  down: [0, 1, 5, 4], // -Y
};

function getCuboidWorldVertices(cuboid: CuboidData): Vec3[] {
  const inflate = Number.isFinite(cuboid.inflate) ? cuboid.inflate : 0;
  const minX = Math.min(cuboid.from[0], cuboid.to[0]) - inflate;
  const maxX = Math.max(cuboid.from[0], cuboid.to[0]) + inflate;
  const minY = Math.min(cuboid.from[1], cuboid.to[1]) - inflate;
  const maxY = Math.max(cuboid.from[1], cuboid.to[1]) + inflate;
  const minZ = Math.min(cuboid.from[2], cuboid.to[2]) - inflate;
  const maxZ = Math.max(cuboid.from[2], cuboid.to[2]) + inflate;

  return [
    cleanVec3([minX, minY, minZ]), // 0: back-bottom-left
    cleanVec3([maxX, minY, minZ]), // 1: back-bottom-right
    cleanVec3([maxX, maxY, minZ]), // 2: back-top-right
    cleanVec3([minX, maxY, minZ]), // 3: back-top-left
    cleanVec3([minX, minY, maxZ]), // 4: front-bottom-left
    cleanVec3([maxX, minY, maxZ]), // 5: front-bottom-right
    cleanVec3([maxX, maxY, maxZ]), // 6: front-top-right
    cleanVec3([minX, maxY, maxZ]), // 7: front-top-left
  ];
}

/**
 * Converts a parametric `CuboidData` (including `inflate`, skipping faces with `hidden === true`,
 * and preserving exact per-face pixel UVs via `cuboidFaceUvToCorners`) into an 8-vertex `PolyMeshData`.
 */
export function convertCuboidToMesh(cuboid: CuboidData): PolyMeshData {
  const vertices = getCuboidWorldVertices(cuboid);
  const faces: PolyFace[] = [];

  for (const faceName of CUBOID_FACE_NAMES) {
    const faceUv = cuboid.faces[faceName];
    if (!faceUv || faceUv.hidden) continue;
    const cornerIndices = CUBOID_FACE_CORNER_INDICES[faceName];
    const cornerUvs = cuboidFaceUvToCorners(faceUv);
    faces.push({
      id: `cuboid-${faceName}`,
      verts: [
        cornerIndices[0],
        cornerIndices[1],
        cornerIndices[2],
        cornerIndices[3],
      ],
      uvs: cornerUvs.map((uv): Vec2 => [uv[0], uv[1]]),
      triSplit: "02",
      flatShading: true,
      materialId: faceUv.materialId,
    });
  }

  return { vertices, faces };
}

/**
 * Transitions a `cuboid` `ModelNode` into a `mesh` `ModelNode` while preserving
 * identity, hierarchy, transform, and collider settings.
 */
export function convertNodeCuboidToMesh(node: ModelNode): ModelNode {
  const cloned = cloneModelNode(node);
  if (cloned.kind !== "cuboid" || !cloned.cuboid) {
    return cloned;
  }
  const mesh = convertCuboidToMesh(cloned.cuboid);
  cloned.kind = "mesh";
  cloned.mesh = mesh;
  cloned.cuboid = undefined;
  return cloned;
}

// ============================================================================
// 3. Region Face Extrusion
// ============================================================================

function undirectedEdgeKey(a: number, b: number): string {
  return a < b ? `${a}:${b}` : `${b}:${a}`;
}

/**
 * Extrudes a single face or connected region of faces along vertex-averaged selected face normals.
 * Shared interior edges between selected faces do not spawn internal walls; boundary edges
 * generate outward-CCW quad side walls with pixel-proportional UVs.
 */
export function extrudeFaces(
  mesh: PolyMeshData,
  faceIds: ReadonlyArray<string>,
  distancePx: number
): { mesh: PolyMeshData; extrudedFaceIds: string[]; sideFaceIds: string[] } {
  const outMesh = clonePolyMeshData(mesh);
  const targetSet = new Set(faceIds);
  const selectedFaces = outMesh.faces.filter((f) => targetSet.has(f.id));
  if (selectedFaces.length === 0) {
    return { mesh: outMesh, extrudedFaceIds: [], sideFaceIds: [] };
  }

  const dist = Number.isFinite(distancePx) ? distancePx : 0;
  const usedIds = collectUsedFaceIds(outMesh.faces);

  // Track which vertices are referenced by unselected faces
  const usedByUnselected = new Set<number>();
  for (const face of outMesh.faces) {
    if (targetSet.has(face.id)) continue;
    for (const vi of face.verts) {
      usedByUnselected.add(vi);
    }
  }

  // Count undirected edge occurrences among selected faces to distinguish boundary vs interior edges
  interface SelectedHalfEdge {
    face: PolyFace;
    cornerIdx: number;
    a: number;
    b: number;
  }
  const edgeMap = new Map<string, SelectedHalfEdge[]>();
  const vertNormalAccum = new Map<number, Vec3>();
  let regionNormalAccum: Vec3 = [0, 0, 0];

  for (const face of selectedFaces) {
    const fn = computeFaceNormal(outMesh.vertices, face);
    regionNormalAccum = vec3Add(regionNormalAccum, fn);
    for (const vi of face.verts) {
      const prev = vertNormalAccum.get(vi) ?? [0, 0, 0];
      vertNormalAccum.set(vi, vec3Add(prev, fn));
    }

    const n = face.verts.length;
    for (let i = 0; i < n; i++) {
      const a = face.verts[i];
      const b = face.verts[(i + 1) % n];
      const key = undirectedEdgeKey(a, b);
      const list = edgeMap.get(key);
      const entry: SelectedHalfEdge = { face, cornerIdx: i, a, b };
      if (list) {
        list.push(entry);
      } else {
        edgeMap.set(key, [entry]);
      }
    }
  }

  const fallbackRegionNormal =
    vec3Length(regionNormalAccum) > 1e-12
      ? vec3Normalize(regionNormalAccum)
      : ([0, 1, 0] as Vec3);

  const boundaryEdges: SelectedHalfEdge[] = [];
  const boundaryVerts = new Set<number>();
  for (const entries of edgeMap.values()) {
    if (entries.length === 1) {
      const he = entries[0];
      boundaryEdges.push(he);
      boundaryVerts.add(he.a);
      boundaryVerts.add(he.b);
    }
  }

  // Map each selected vertex index to its extruded vertex index
  const extrudedVertMap = new Map<number, number>();
  for (const [vi, accumNormal] of vertNormalAccum.entries()) {
    const unitNormal =
      vec3Length(accumNormal) > 1e-12
        ? vec3Normalize(accumNormal)
        : fallbackRegionNormal;
    const basePos = outMesh.vertices[vi];
    const nextPos = cleanVec3(vec3Add(basePos, vec3Scale(unitNormal, dist)));

    if (!boundaryVerts.has(vi) && !usedByUnselected.has(vi)) {
      // Interior vertex of selected region: move in-place so no orphan vertex remains
      outMesh.vertices[vi] = nextPos;
      extrudedVertMap.set(vi, vi);
    } else {
      const newIdx = outMesh.vertices.length;
      outMesh.vertices.push(nextPos);
      extrudedVertMap.set(vi, newIdx);
    }
  }

  // Remap selected cap faces to extruded vertices
  const extrudedFaceIds: string[] = [];
  for (const face of selectedFaces) {
    face.verts = face.verts.map((vi) => extrudedVertMap.get(vi) ?? vi);
    extrudedFaceIds.push(face.id);
  }

  // Stitch quad side walls along every boundary edge
  const sideFaceIds: string[] = [];
  const absDist = cleanZero(Math.abs(dist));
  for (const he of boundaryEdges) {
    const aNew = extrudedVertMap.get(he.a) ?? he.a;
    const bNew = extrudedVertMap.get(he.b) ?? he.b;
    if (aNew === he.a && bNew === he.b) continue;

    const edgeLen = cleanZero(
      Math.max(1e-6, vec3Length(vec3Sub(outMesh.vertices[he.b], outMesh.vertices[he.a])))
    );
    const sideId = allocateUniqueFaceId("extrude-side", usedIds);
    const nextIdx = (he.cornerIdx + 1) % he.face.verts.length;
    const colors =
      he.face.colors && he.face.colors.length === he.face.verts.length
        ? [
            he.face.colors[he.cornerIdx],
            he.face.colors[nextIdx],
            he.face.colors[nextIdx],
            he.face.colors[he.cornerIdx],
          ]
        : undefined;

    outMesh.faces.push({
      id: sideId,
      verts: [he.a, he.b, bNew, aNew],
      uvs: [
        [0, absDist],
        [edgeLen, absDist],
        [edgeLen, 0],
        [0, 0],
      ],
      colors,
      triSplit: "02",
      flatShading: he.face.flatShading ?? true,
      materialId: he.face.materialId,
    });
    sideFaceIds.push(sideId);
  }

  return {
    mesh: outMesh,
    extrudedFaceIds,
    sideFaceIds,
  };
}

// ============================================================================
// 4. Face Inset
// ============================================================================

/**
 * Insets each selected face inward toward its centroid by `insetPx` (safely clamped
 * so the inner polygon never inverts) and optionally offsets by `depthPx` along its normal,
 * replacing each target face with surrounding frame quads plus an inner face with interpolated UVs.
 */
export function insetFaces(
  mesh: PolyMeshData,
  faceIds: ReadonlyArray<string>,
  insetPx: number,
  depthPx = 0
): { mesh: PolyMeshData; innerFaceIds: string[] } {
  const outMesh = clonePolyMeshData(mesh);
  const safeInset = Number.isFinite(insetPx) ? Math.max(0, insetPx) : 0;
  const safeDepth = Number.isFinite(depthPx) ? depthPx : 0;

  if (safeInset <= 0 && Math.abs(safeDepth) <= 1e-9) {
    return { mesh: outMesh, innerFaceIds: [] };
  }

  const targetSet = new Set(faceIds);
  const usedIds = collectUsedFaceIds(outMesh.faces);
  const nextFaces: PolyFace[] = [];
  const innerFaceIds: string[] = [];

  for (const face of outMesh.faces) {
    if (!targetSet.has(face.id) || face.verts.length < 3) {
      nextFaces.push(face);
      continue;
    }

    const n = face.verts.length;
    const centroid = computeFaceCentroid(outMesh.vertices, face);
    const normal = computeFaceNormal(outMesh.vertices, face);

    let minCornerDist = Infinity;
    for (const vi of face.verts) {
      const d = vec3Length(vec3Sub(centroid, outMesh.vertices[vi]));
      if (d < minCornerDist) minCornerDist = d;
    }

    if (!Number.isFinite(minCornerDist) || minCornerDist <= 1e-9) {
      nextFaces.push(face);
      continue;
    }

    // Clamp homothety factor t in [0, 0.95] so inner polygon strictly shrinks and never inverts
    const t =
      safeInset > 0 ? Math.max(0, Math.min(0.95, safeInset / minCornerDist)) : 0;

    let uvCentroid: Vec2 = [0, 0];
    if (face.uvs.length === n) {
      let su = 0;
      let sv = 0;
      for (const [u, v] of face.uvs) {
        su += u;
        sv += v;
      }
      uvCentroid = [su / n, sv / n];
    }

    const innerIndices: number[] = [];
    const innerUvs: Vec2[] = [];
    const depthOffset = vec3Scale(normal, safeDepth);

    for (let i = 0; i < n; i++) {
      const outerPos = outMesh.vertices[face.verts[i]];
      const innerPos = cleanVec3(
        vec3Add(lerpVec3(outerPos, centroid, t), depthOffset)
      );
      const innerIdx = outMesh.vertices.length;
      outMesh.vertices.push(innerPos);
      innerIndices.push(innerIdx);

      const outerUv: Vec2 = face.uvs[i] ?? [0, 0];
      innerUvs.push(cleanVec2(lerpVec2(outerUv, uvCentroid, t)));
    }

    // Surrounding frame quads
    for (let i = 0; i < n; i++) {
      const next = (i + 1) % n;
      const frameId = allocateUniqueFaceId("inset-frame", usedIds);
      const outerUvA: Vec2 = face.uvs[i] ?? [0, 0];
      const outerUvB: Vec2 = face.uvs[next] ?? [0, 0];
      const frameColors =
        face.colors && face.colors.length === n
          ? [face.colors[i], face.colors[next], face.colors[next], face.colors[i]]
          : undefined;

      nextFaces.push({
        id: frameId,
        verts: [
          face.verts[i],
          face.verts[next],
          innerIndices[next],
          innerIndices[i],
        ],
        uvs: [
          [outerUvA[0], outerUvA[1]],
          [outerUvB[0], outerUvB[1]],
          [innerUvs[next][0], innerUvs[next][1]],
          [innerUvs[i][0], innerUvs[i][1]],
        ],
        colors: frameColors,
        triSplit: "02",
        flatShading: face.flatShading ?? true,
        materialId: face.materialId,
      });
    }

    // Inner face (reuses original face ID)
    const innerFace = clonePolyFace(face);
    innerFace.verts = innerIndices;
    innerFace.uvs = innerUvs;
    nextFaces.push(innerFace);
    innerFaceIds.push(innerFace.id);
  }

  outMesh.faces = nextFaces;
  return {
    mesh: outMesh,
    innerFaceIds,
  };
}

// ============================================================================
// 5. Subdivide / Loop Cut Quads
// ============================================================================

/**
 * Splits target quad faces (all quads if `faceIds` is omitted) into 2 quads (`"u"` or `"v"`)
 * or 4 quads (`"both"`), sharing midpoint vertices along shared edges so topology stays watertight,
 * while linearly interpolating 3D vertex positions, pixel UVs, and optional vertex colors.
 */
export function subdivideFacesOrLoopCut(
  mesh: PolyMeshData,
  faceIds?: ReadonlyArray<string>,
  axis: "u" | "v" | "both" = "both"
): PolyMeshData {
  const outMesh = clonePolyMeshData(mesh);
  const targetSet = faceIds ? new Set(faceIds) : null;
  const usedIds = collectUsedFaceIds(outMesh.faces);
  const midpointCache = new Map<string, number>();

  const getEdgeMidpoint = (a: number, b: number): number => {
    const key = undirectedEdgeKey(a, b);
    const cached = midpointCache.get(key);
    if (cached !== undefined) return cached;
    const va = outMesh.vertices[a];
    const vb = outMesh.vertices[b];
    const mid = cleanVec3(lerpVec3(va, vb, 0.5));
    const midIdx = outMesh.vertices.length;
    outMesh.vertices.push(mid);
    midpointCache.set(key, midIdx);
    return midIdx;
  };

  const buildSubQuad = (
    id: string,
    verts: [number, number, number, number],
    uvs: [Vec2, Vec2, Vec2, Vec2],
    colors: [string, string, string, string] | undefined,
    template: PolyFace
  ): PolyFace => ({
    id,
    verts,
    uvs: uvs.map(cleanVec2),
    colors,
    triSplit: template.triSplit ?? "02",
    flatShading: template.flatShading ?? true,
    materialId: template.materialId,
    tileSource: template.tileSource ? { ...template.tileSource } : undefined,
  });

  const nextFaces: PolyFace[] = [];

  for (const face of outMesh.faces) {
    const isTarget =
      face.verts.length === 4 && (targetSet === null || targetSet.has(face.id));
    if (!isTarget) {
      nextFaces.push(face);
      continue;
    }

    const [v0, v1, v2, v3] = face.verts;
    const uv0: Vec2 = face.uvs[0] ?? [0, 0];
    const uv1: Vec2 = face.uvs[1] ?? [0, 0];
    const uv2: Vec2 = face.uvs[2] ?? [0, 0];
    const uv3: Vec2 = face.uvs[3] ?? [0, 0];
    const cols =
      face.colors && face.colors.length === 4 ? face.colors : undefined;

    if (axis === "u") {
      const m01 = getEdgeMidpoint(v0, v1);
      const m32 = getEdgeMidpoint(v3, v2);
      const uv01 = lerpVec2(uv0, uv1, 0.5);
      const uv32 = lerpVec2(uv3, uv2, 0.5);
      const c01 = cols ? lerpColor(cols[0], cols[1], 0.5) : undefined;
      const c32 = cols ? lerpColor(cols[3], cols[2], 0.5) : undefined;

      nextFaces.push(
        buildSubQuad(
          face.id,
          [v0, m01, m32, v3],
          [uv0, uv01, uv32, uv3],
          cols && c01 && c32 ? [cols[0], c01, c32, cols[3]] : undefined,
          face
        ),
        buildSubQuad(
          allocateUniqueFaceId(`${face.id}-sub`, usedIds),
          [m01, v1, v2, m32],
          [uv01, uv1, uv2, uv32],
          cols && c01 && c32 ? [c01, cols[1], cols[2], c32] : undefined,
          face
        )
      );
      continue;
    }

    if (axis === "v") {
      const m12 = getEdgeMidpoint(v1, v2);
      const m03 = getEdgeMidpoint(v0, v3);
      const uv12 = lerpVec2(uv1, uv2, 0.5);
      const uv03 = lerpVec2(uv0, uv3, 0.5);
      const c12 = cols ? lerpColor(cols[1], cols[2], 0.5) : undefined;
      const c03 = cols ? lerpColor(cols[0], cols[3], 0.5) : undefined;

      nextFaces.push(
        buildSubQuad(
          face.id,
          [v0, v1, m12, m03],
          [uv0, uv1, uv12, uv03],
          cols && c12 && c03 ? [cols[0], cols[1], c12, c03] : undefined,
          face
        ),
        buildSubQuad(
          allocateUniqueFaceId(`${face.id}-sub`, usedIds),
          [m03, m12, v2, v3],
          [uv03, uv12, uv2, uv3],
          cols && c12 && c03 ? [c03, c12, cols[2], cols[3]] : undefined,
          face
        )
      );
      continue;
    }

    // axis === "both"
    const m01 = getEdgeMidpoint(v0, v1);
    const m12 = getEdgeMidpoint(v1, v2);
    const m23 = getEdgeMidpoint(v2, v3);
    const m30 = getEdgeMidpoint(v3, v0);

    const p0 = outMesh.vertices[v0];
    const p1 = outMesh.vertices[v1];
    const p2 = outMesh.vertices[v2];
    const p3 = outMesh.vertices[v3];
    const centerPos = cleanVec3([
      (p0[0] + p1[0] + p2[0] + p3[0]) * 0.25,
      (p0[1] + p1[1] + p2[1] + p3[1]) * 0.25,
      (p0[2] + p1[2] + p2[2] + p3[2]) * 0.25,
    ]);
    const mc = outMesh.vertices.length;
    outMesh.vertices.push(centerPos);

    const uv01 = lerpVec2(uv0, uv1, 0.5);
    const uv12 = lerpVec2(uv1, uv2, 0.5);
    const uv23 = lerpVec2(uv2, uv3, 0.5);
    const uv30 = lerpVec2(uv3, uv0, 0.5);
    const uvc: Vec2 = [
      (uv0[0] + uv1[0] + uv2[0] + uv3[0]) * 0.25,
      (uv0[1] + uv1[1] + uv2[1] + uv3[1]) * 0.25,
    ];

    const c01 = cols ? lerpColor(cols[0], cols[1], 0.5) : undefined;
    const c12 = cols ? lerpColor(cols[1], cols[2], 0.5) : undefined;
    const c23 = cols ? lerpColor(cols[2], cols[3], 0.5) : undefined;
    const c30 = cols ? lerpColor(cols[3], cols[0], 0.5) : undefined;
    const cc =
      c01 && c23 ? lerpColor(c01, c23, 0.5) : undefined;

    nextFaces.push(
      buildSubQuad(
        face.id,
        [v0, m01, mc, m30],
        [uv0, uv01, uvc, uv30],
        cols && c01 && cc && c30 ? [cols[0], c01, cc, c30] : undefined,
        face
      ),
      buildSubQuad(
        allocateUniqueFaceId(`${face.id}-sub`, usedIds),
        [m01, v1, m12, mc],
        [uv01, uv1, uv12, uvc],
        cols && c01 && c12 && cc ? [c01, cols[1], c12, cc] : undefined,
        face
      ),
      buildSubQuad(
        allocateUniqueFaceId(`${face.id}-sub`, usedIds),
        [mc, m12, v2, m23],
        [uvc, uv12, uv2, uv23],
        cols && cc && c12 && c23 ? [cc, c12, cols[2], c23] : undefined,
        face
      ),
      buildSubQuad(
        allocateUniqueFaceId(`${face.id}-sub`, usedIds),
        [m30, mc, m23, v3],
        [uv30, uvc, uv23, uv3],
        cols && c30 && cc && c23 ? [c30, cc, c23, cols[3]] : undefined,
        face
      )
    );
  }

  outMesh.faces = nextFaces;
  return outMesh;
}

// ============================================================================
// 6. Merge & Weld Vertices
// ============================================================================

function remapFacesAfterVertexMerge(
  faces: ReadonlyArray<PolyFace>,
  remap: ReadonlyArray<number>,
  averageUvsOnCollapse: boolean
): PolyFace[] {
  const result: PolyFace[] = [];

  for (const face of faces) {
    const n = face.verts.length;
    if (n < 3) continue;

    interface CornerItem {
      vert: number;
      uv: Vec2;
      color?: string;
      count: number;
    }

    const mapped: CornerItem[] = [];
    for (let i = 0; i < n; i++) {
      const oldVi = face.verts[i];
      const newVi = remap[oldVi] ?? oldVi;
      const uv: Vec2 = face.uvs[i] ? [face.uvs[i][0], face.uvs[i][1]] : [0, 0];
      const color = face.colors?.[i];

      const prev = mapped[mapped.length - 1];
      if (prev && prev.vert === newVi) {
        if (averageUvsOnCollapse) {
          prev.uv = [prev.uv[0] + uv[0], prev.uv[1] + uv[1]];
          prev.count += 1;
        }
      } else {
        mapped.push({ vert: newVi, uv, color, count: 1 });
      }
    }

    // Wrap-around consecutive duplicate collapse
    if (mapped.length >= 2 && mapped[mapped.length - 1].vert === mapped[0].vert) {
      const tail = mapped.pop()!;
      if (averageUvsOnCollapse) {
        mapped[0].uv = [mapped[0].uv[0] + tail.uv[0], mapped[0].uv[1] + tail.uv[1]];
        mapped[0].count += tail.count;
      }
    }

    if (mapped.length < 3) continue;

    const collapsedVerts = mapped.map((c) => c.vert);
    if (new Set(collapsedVerts).size !== collapsedVerts.length) {
      // Non-adjacent pinch produced degenerate topology
      continue;
    }

    const collapsedUvs = mapped.map((c): Vec2 =>
      cleanVec2(
        averageUvsOnCollapse && c.count > 1
          ? [c.uv[0] / c.count, c.uv[1] / c.count]
          : c.uv
      )
    );

    const nextFace = clonePolyFace(face);
    nextFace.verts = collapsedVerts;
    nextFace.uvs = collapsedUvs;
    if (face.colors) {
      nextFace.colors = mapped.map((c) => c.color ?? "#ffffff");
    }
    nextFace.triSplit =
      collapsedVerts.length === 4 ? (face.triSplit ?? "02") : undefined;
    result.push(nextFace);
  }

  return result;
}

/**
 * Merges `vertexIndices` to either their centroid (`"center"`) or the last selected vertex
 * (`"last"`), remapping faces (collapsing quads cleanly into triangles when an edge collapses,
 * dropping `< 3`-vertex degenerate faces) and compacting unused vertices.
 */
export function mergeVertices(
  mesh: PolyMeshData,
  vertexIndices: ReadonlyArray<number>,
  mode: "center" | "last" = "center"
): PolyMeshData {
  const outMesh = clonePolyMeshData(mesh);
  const vCount = outMesh.vertices.length;
  const uniqueTargets: number[] = [];
  const targetSet = new Set<number>();

  for (const vi of vertexIndices) {
    if (Number.isInteger(vi) && vi >= 0 && vi < vCount && !targetSet.has(vi)) {
      targetSet.add(vi);
      uniqueTargets.push(vi);
    }
  }

  if (uniqueTargets.length < 2) {
    return compactUnusedVertices(outMesh);
  }

  const keepIdx =
    mode === "last"
      ? uniqueTargets[uniqueTargets.length - 1]
      : uniqueTargets[0];

  if (mode === "center") {
    let sx = 0;
    let sy = 0;
    let sz = 0;
    for (const vi of uniqueTargets) {
      sx += outMesh.vertices[vi][0];
      sy += outMesh.vertices[vi][1];
      sz += outMesh.vertices[vi][2];
    }
    outMesh.vertices[keepIdx] = cleanVec3([
      sx / uniqueTargets.length,
      sy / uniqueTargets.length,
      sz / uniqueTargets.length,
    ]);
  }

  const remap = outMesh.vertices.map((_, i) => (targetSet.has(i) ? keepIdx : i));
  outMesh.faces = remapFacesAfterVertexMerge(
    outMesh.faces,
    remap,
    mode === "center"
  );
  return compactUnusedVertices(outMesh);
}

/**
 * Welds any vertices within `epsilonPx` distance of each other into cluster centroids,
 * remapping faces, removing degenerates, and compacting unused vertices.
 */
export function weldVerticesByDistance(
  mesh: PolyMeshData,
  epsilonPx = 1e-4
): { mesh: PolyMeshData; weldedCount: number } {
  const outMesh = clonePolyMeshData(mesh);
  const n = outMesh.vertices.length;
  const eps = Number.isFinite(epsilonPx) ? Math.max(0, epsilonPx) : 1e-4;

  if (n < 2) {
    const compacted = compactUnusedVertices(outMesh);
    return { mesh: compacted, weldedCount: 0 };
  }

  const parent = Array.from({ length: n }, (_, i) => i);
  const find = (x: number): number => {
    let cur = x;
    while (parent[cur] !== cur) {
      parent[cur] = parent[parent[cur]];
      cur = parent[cur];
    }
    return cur;
  };
  const union = (a: number, b: number): void => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) {
      if (ra < rb) parent[rb] = ra;
      else parent[ra] = rb;
    }
  };

  // Spatial hash grid for fast O(n) neighbor lookup
  const cellSize = Math.max(eps, 1e-3);
  const invCell = 1 / cellSize;
  const grid = new Map<string, number[]>();

  for (let i = 0; i < n; i++) {
    const [vx, vy, vz] = outMesh.vertices[i];
    const cx = Math.floor(vx * invCell);
    const cy = Math.floor(vy * invCell);
    const cz = Math.floor(vz * invCell);

    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        for (let dz = -1; dz <= 1; dz++) {
          const bucket = grid.get(`${cx + dx}:${cy + dy}:${cz + dz}`);
          if (!bucket) continue;
          for (const j of bucket) {
            const dist = vec3Length(
              vec3Sub(outMesh.vertices[i], outMesh.vertices[j])
            );
            if (dist <= eps) {
              union(i, j);
            }
          }
        }
      }
    }

    const key = `${cx}:${cy}:${cz}`;
    const bucket = grid.get(key);
    if (bucket) {
      bucket.push(i);
    } else {
      grid.set(key, [i]);
    }
  }

  const components = new Map<number, number[]>();
  for (let i = 0; i < n; i++) {
    const root = find(i);
    const list = components.get(root);
    if (list) list.push(i);
    else components.set(root, [i]);
  }

  let weldedCount = 0;
  const remap = new Array<number>(n);

  for (const [root, members] of components.entries()) {
    if (members.length > 1) {
      weldedCount += members.length - 1;
      let sx = 0;
      let sy = 0;
      let sz = 0;
      for (const m of members) {
        sx += outMesh.vertices[m][0];
        sy += outMesh.vertices[m][1];
        sz += outMesh.vertices[m][2];
      }
      outMesh.vertices[root] = cleanVec3([
        sx / members.length,
        sy / members.length,
        sz / members.length,
      ]);
    }
    for (const m of members) {
      remap[m] = root;
    }
  }

  if (weldedCount === 0) {
    return { mesh: compactUnusedVertices(outMesh), weldedCount: 0 };
  }

  outMesh.faces = remapFacesAfterVertexMerge(outMesh.faces, remap, true);
  return {
    mesh: compactUnusedVertices(outMesh),
    weldedCount,
  };
}

// ============================================================================
// 7. Flip Quad Diagonal (Ctrl+T)
// ============================================================================

/**
 * Toggles `face.triSplit` between `"02"` and `"13"` on the specified quad faces.
 */
export function flipQuadDiagonal(
  mesh: PolyMeshData,
  faceIds: ReadonlyArray<string>
): PolyMeshData {
  const outMesh = clonePolyMeshData(mesh);
  const targetSet = new Set(faceIds);
  for (const face of outMesh.faces) {
    if (face.verts.length === 4 && targetSet.has(face.id)) {
      face.triSplit = face.triSplit === "13" ? "02" : "13";
    }
  }
  return outMesh;
}

// ============================================================================
// 8. Flip & Recalculate Normals
// ============================================================================

/**
 * Reverses vertex, UV, and color ordering on targeted faces (all faces if `faceIds` is omitted),
 * flipping face normals without rotating UVs out of sync with their vertices.
 */
export function flipFaceNormals(
  mesh: PolyMeshData,
  faceIds?: ReadonlyArray<string>
): PolyMeshData {
  const outMesh = clonePolyMeshData(mesh);
  const targetSet = faceIds ? new Set(faceIds) : null;
  outMesh.faces = outMesh.faces.map((face) => {
    if (targetSet === null || targetSet.has(face.id)) {
      return reverseFaceKeepingAnchor(face);
    }
    return face;
  });
  return outMesh;
}

/**
 * Orients all faces outward relative to the mesh centroid.
 */
export function recalculateOutwardNormals(mesh: PolyMeshData): PolyMeshData {
  const outMesh = clonePolyMeshData(mesh);
  if (outMesh.faces.length === 0 || outMesh.vertices.length === 0) {
    return outMesh;
  }

  const referencedVerts = new Set<number>();
  for (const face of outMesh.faces) {
    for (const vi of face.verts) {
      if (vi >= 0 && vi < outMesh.vertices.length) {
        referencedVerts.add(vi);
      }
    }
  }

  const vertsToAverage =
    referencedVerts.size > 0
      ? Array.from(referencedVerts)
      : outMesh.vertices.map((_, i) => i);

  let cx = 0;
  let cy = 0;
  let cz = 0;
  for (const vi of vertsToAverage) {
    cx += outMesh.vertices[vi][0];
    cy += outMesh.vertices[vi][1];
    cz += outMesh.vertices[vi][2];
  }
  const centroid: Vec3 = [
    cx / vertsToAverage.length,
    cy / vertsToAverage.length,
    cz / vertsToAverage.length,
  ];

  outMesh.faces = outMesh.faces.map((face) => {
    const normal = computeFaceNormal(outMesh.vertices, face);
    const faceCenter = computeFaceCentroid(outMesh.vertices, face);
    const dot = vec3Dot(normal, vec3Sub(faceCenter, centroid));
    if (dot < -1e-9) {
      return reverseFaceKeepingAnchor(face);
    }
    return face;
  });

  return outMesh;
}

// ============================================================================
// 9. Cull Internal Coplanar Faces
// ============================================================================

function applyLocalTransform(p: Vec3, t: Transform3D): Vec3 {
  const delta = vec3Sub(p, t.pivot);
  const scaled: Vec3 = [
    delta[0] * t.scale[0],
    delta[1] * t.scale[1],
    delta[2] * t.scale[2],
  ];
  const rotated = quatRotateVec3(eulerDegToQuat(t.rotation), scaled);
  return vec3Add(vec3Add(t.pivot, t.position), rotated);
}

function transformPointToWorld(
  nodeId: string,
  point: Vec3,
  byId: ReadonlyMap<string, ModelNode>
): Vec3 {
  let cur: Vec3 = point;
  let id: string | null = nodeId;
  const visited = new Set<string>();
  while (id !== null && !visited.has(id)) {
    visited.add(id);
    const node = byId.get(id);
    if (!node) break;
    cur = applyLocalTransform(cur, node.transform);
    id = node.parentId;
  }
  return cur;
}

function computePolygonNormalFromPoints(points: ReadonlyArray<Vec3>): Vec3 {
  const n = points.length;
  if (n < 3) return [0, 0, 0];
  let nx = 0;
  let ny = 0;
  let nz = 0;
  for (let i = 0; i < n; i++) {
    const curr = points[i];
    const next = points[(i + 1) % n];
    nx += (curr[1] - next[1]) * (curr[2] + next[2]);
    ny += (curr[2] - next[2]) * (curr[0] + next[0]);
    nz += (curr[0] - next[0]) * (curr[1] + next[1]);
  }
  return vec3Normalize([nx, ny, nz]);
}

function computeCentroidFromPoints(points: ReadonlyArray<Vec3>): Vec3 {
  if (points.length === 0) return [0, 0, 0];
  let sx = 0;
  let sy = 0;
  let sz = 0;
  for (const p of points) {
    sx += p[0];
    sy += p[1];
    sz += p[2];
  }
  return [sx / points.length, sy / points.length, sz / points.length];
}

function areOpposingIdenticalFaces(
  cornersA: ReadonlyArray<Vec3>,
  normalA: Vec3,
  centroidA: Vec3,
  cornersB: ReadonlyArray<Vec3>,
  normalB: Vec3,
  centroidB: Vec3,
  eps: number
): boolean {
  if (cornersA.length !== cornersB.length || cornersA.length < 3) return false;
  if (vec3Length(normalA) < 1e-6 || vec3Length(normalB) < 1e-6) return false;

  // Opposing normals
  if (vec3Dot(normalA, normalB) > -1 + Math.max(1e-4, eps)) return false;

  // Coplanar check
  if (Math.abs(vec3Dot(normalA, vec3Sub(centroidB, centroidA))) > eps) {
    return false;
  }

  // Bijective corner match within eps
  const usedB = new Array<boolean>(cornersB.length).fill(false);
  for (let i = 0; i < cornersA.length; i++) {
    let matched = false;
    for (let j = 0; j < cornersB.length; j++) {
      if (usedB[j]) continue;
      if (vec3Length(vec3Sub(cornersA[i], cornersB[j])) <= eps) {
        usedB[j] = true;
        matched = true;
        break;
      }
    }
    if (!matched) return false;
  }
  return true;
}

/**
 * Detects opposing coplanar equal-bounds faces between touching unlocked cuboids
 * (setting `face.hidden = true`) and opposing identical coplanar faces within/across
 * unlocked meshes (removing internal hidden faces), returning updated nodes + `culledCount`.
 */
export function cullInternalCoplanarFaces(
  nodes: ReadonlyArray<ModelNode>,
  epsilonPx = 1e-3
): { nodes: ModelNode[]; culledCount: number } {
  const eps = Number.isFinite(epsilonPx) ? Math.max(1e-6, epsilonPx) : 1e-3;
  const clonedNodes = nodes.map(cloneModelNode);
  const byId = new Map(clonedNodes.map((n) => [n.id, n]));
  let culledCount = 0;

  // 1. Touching unlocked cuboids
  interface CuboidWorldFace {
    nodeIdx: number;
    faceName: CuboidFaceName;
    corners: Vec3[];
    normal: Vec3;
    centroid: Vec3;
    culled: boolean;
  }
  const cuboidFaces: CuboidWorldFace[] = [];

  for (let ni = 0; ni < clonedNodes.length; ni++) {
    const node = clonedNodes[ni];
    if (!node.visible || node.locked || node.kind !== "cuboid" || !node.cuboid) {
      continue;
    }
    const localVerts = getCuboidWorldVertices(node.cuboid);
    const worldVerts = localVerts.map((v) =>
      transformPointToWorld(node.id, v, byId)
    );

    for (const faceName of CUBOID_FACE_NAMES) {
      const faceUv = node.cuboid.faces[faceName];
      if (!faceUv || faceUv.hidden) continue;
      const idx = CUBOID_FACE_CORNER_INDICES[faceName];
      const corners = [
        worldVerts[idx[0]],
        worldVerts[idx[1]],
        worldVerts[idx[2]],
        worldVerts[idx[3]],
      ];
      cuboidFaces.push({
        nodeIdx: ni,
        faceName,
        corners,
        normal: computePolygonNormalFromPoints(corners),
        centroid: computeCentroidFromPoints(corners),
        culled: false,
      });
    }
  }

  for (let i = 0; i < cuboidFaces.length; i++) {
    const a = cuboidFaces[i];
    if (a.culled) continue;
    for (let j = i + 1; j < cuboidFaces.length; j++) {
      const b = cuboidFaces[j];
      if (b.culled || a.nodeIdx === b.nodeIdx) continue;
      if (
        areOpposingIdenticalFaces(
          a.corners,
          a.normal,
          a.centroid,
          b.corners,
          b.normal,
          b.centroid,
          eps
        )
      ) {
        a.culled = true;
        b.culled = true;
        const nodeA = clonedNodes[a.nodeIdx];
        const nodeB = clonedNodes[b.nodeIdx];
        if (nodeA.cuboid) nodeA.cuboid.faces[a.faceName].hidden = true;
        if (nodeB.cuboid) nodeB.cuboid.faces[b.faceName].hidden = true;
        culledCount += 2;
        break;
      }
    }
  }

  // 2. Opposing identical coplanar faces within/across unlocked meshes
  interface MeshWorldFace {
    nodeIdx: number;
    faceIdx: number;
    corners: Vec3[];
    normal: Vec3;
    centroid: Vec3;
    culled: boolean;
  }
  const meshFaces: MeshWorldFace[] = [];

  for (let ni = 0; ni < clonedNodes.length; ni++) {
    const node = clonedNodes[ni];
    if (!node.visible || node.locked || node.kind !== "mesh" || !node.mesh) {
      continue;
    }
    const worldVerts = node.mesh.vertices.map((v) =>
      transformPointToWorld(node.id, v, byId)
    );
    for (let fi = 0; fi < node.mesh.faces.length; fi++) {
      const face = node.mesh.faces[fi];
      if (face.verts.length < 3) continue;
      const corners = face.verts.map((vi) => worldVerts[vi]);
      if (corners.some((c) => !c)) continue;
      meshFaces.push({
        nodeIdx: ni,
        faceIdx: fi,
        corners,
        normal: computePolygonNormalFromPoints(corners),
        centroid: computeCentroidFromPoints(corners),
        culled: false,
      });
    }
  }

  const removedByNode = new Map<number, Set<number>>();
  for (let i = 0; i < meshFaces.length; i++) {
    const a = meshFaces[i];
    if (a.culled) continue;
    for (let j = i + 1; j < meshFaces.length; j++) {
      const b = meshFaces[j];
      if (b.culled) continue;
      if (
        areOpposingIdenticalFaces(
          a.corners,
          a.normal,
          a.centroid,
          b.corners,
          b.normal,
          b.centroid,
          eps
        )
      ) {
        a.culled = true;
        b.culled = true;
        let setA = removedByNode.get(a.nodeIdx);
        if (!setA) {
          setA = new Set<number>();
          removedByNode.set(a.nodeIdx, setA);
        }
        setA.add(a.faceIdx);

        let setB = removedByNode.get(b.nodeIdx);
        if (!setB) {
          setB = new Set<number>();
          removedByNode.set(b.nodeIdx, setB);
        }
        setB.add(b.faceIdx);

        culledCount += 2;
        break;
      }
    }
  }

  for (const [nodeIdx, removedSet] of removedByNode.entries()) {
    const node = clonedNodes[nodeIdx];
    if (!node.mesh) continue;
    node.mesh.faces = node.mesh.faces.filter((_, fi) => !removedSet.has(fi));
    node.mesh = compactUnusedVertices(node.mesh);
  }

  return {
    nodes: clonedNodes,
    culledCount,
  };
}

// ============================================================================
// 10. Mirror Node (X / Y / Z Symmetry)
// ============================================================================

function computeMeshUvWidth(mesh: PolyMeshData): number {
  let minU = Infinity;
  let maxU = -Infinity;
  for (const face of mesh.faces) {
    for (const [u] of face.uvs) {
      if (u < minU) minU = u;
      if (u > maxU) maxU = u;
    }
  }
  if (!Number.isFinite(minU) || !Number.isFinite(maxU)) return 16;
  return Math.max(1, Math.ceil(maxU - minU));
}

function computeCuboidUvWidth(cuboid: CuboidData): number {
  let minU = Infinity;
  let maxU = -Infinity;
  for (const faceName of CUBOID_FACE_NAMES) {
    const face = cuboid.faces[faceName];
    if (!face) continue;
    minU = Math.min(minU, face.uv[0], face.uv[2]);
    maxU = Math.max(maxU, face.uv[0], face.uv[2]);
  }
  if (!Number.isFinite(minU) || !Number.isFinite(maxU)) return 16;
  return Math.max(1, Math.ceil(maxU - minU));
}

/**
 * Mirrors a `cuboid` or `mesh` `ModelNode` across the `0` plane on `axis` (`"x" | "y" | "z"`).
 * Reverses mesh face winding so normals stay outward-pointing (never inside-out),
 * and either keeps UVs shared (`shareSourceUv = true`, horizontally mirroring U on X-mirror)
 * or offsets UVs onto a non-overlapping island (`shareSourceUv = false`).
 */
export function mirrorNode(
  node: ModelNode,
  axis: "x" | "y" | "z",
  shareSourceUv = true
): ModelNode {
  const cloned = cloneModelNode(node);
  const axisIdx = axis === "x" ? 0 : axis === "y" ? 1 : 2;

  cloned.transform.position[axisIdx] = cleanZero(
    -cloned.transform.position[axisIdx]
  );
  cloned.transform.pivot[axisIdx] = cleanZero(-cloned.transform.pivot[axisIdx]);

  if (axis === "x") {
    cloned.transform.rotation[1] = cleanZero(-cloned.transform.rotation[1]);
    cloned.transform.rotation[2] = cleanZero(-cloned.transform.rotation[2]);
  } else if (axis === "y") {
    cloned.transform.rotation[0] = cleanZero(-cloned.transform.rotation[0]);
    cloned.transform.rotation[2] = cleanZero(-cloned.transform.rotation[2]);
  } else {
    cloned.transform.rotation[0] = cleanZero(-cloned.transform.rotation[0]);
    cloned.transform.rotation[1] = cleanZero(-cloned.transform.rotation[1]);
  }

  if (cloned.kind === "cuboid" && cloned.cuboid) {
    const cuboid = cloneCuboidData(cloned.cuboid);
    const a = cleanZero(-cuboid.from[axisIdx]);
    const b = cleanZero(-cuboid.to[axisIdx]);
    cuboid.from[axisIdx] = Math.min(a, b);
    cuboid.to[axisIdx] = Math.max(a, b);

    const swapFaces = (f1: CuboidFaceName, f2: CuboidFaceName): void => {
      const tmp = cuboid.faces[f1];
      cuboid.faces[f1] = cuboid.faces[f2];
      cuboid.faces[f2] = tmp;
    };

    if (axis === "x") {
      swapFaces("east", "west");
      cuboid.mirrorUvX = !cuboid.mirrorUvX;
      for (const fn of CUBOID_FACE_NAMES) {
        cuboid.faces[fn].flipX = !cuboid.faces[fn].flipX;
      }
    } else if (axis === "y") {
      swapFaces("up", "down");
      for (const fn of CUBOID_FACE_NAMES) {
        cuboid.faces[fn].flipY = !cuboid.faces[fn].flipY;
      }
    } else {
      swapFaces("north", "south");
      for (const fn of ["north", "south", "east", "west"] as const) {
        cuboid.faces[fn].flipX = !cuboid.faces[fn].flipX;
      }
      cuboid.faces.up.flipY = !cuboid.faces.up.flipY;
      cuboid.faces.down.flipY = !cuboid.faces.down.flipY;
    }

    if (!shareSourceUv) {
      const offsetU = computeCuboidUvWidth(cuboid);
      cuboid.boxUvOrigin = [
        cleanZero(cuboid.boxUvOrigin[0] + offsetU),
        cuboid.boxUvOrigin[1],
      ];
      for (const fn of CUBOID_FACE_NAMES) {
        const uv = cuboid.faces[fn].uv;
        cuboid.faces[fn].uv = [
          cleanZero(uv[0] + offsetU),
          uv[1],
          cleanZero(uv[2] + offsetU),
          uv[3],
        ];
      }
    }

    cloned.cuboid = cuboid;
    return cloned;
  }

  if (cloned.kind === "mesh" && cloned.mesh) {
    const mesh = clonePolyMeshData(cloned.mesh);
    const offsetU = shareSourceUv ? 0 : computeMeshUvWidth(mesh);

    for (const v of mesh.vertices) {
      v[axisIdx] = cleanZero(-v[axisIdx]);
    }

    mesh.faces = mesh.faces.map((face) => {
      const reversed = reverseFaceKeepingAnchor(face);
      if (!shareSourceUv && offsetU !== 0) {
        reversed.uvs = reversed.uvs.map(([u, v]): Vec2 => [
          cleanZero(u + offsetU),
          v,
        ]);
      }
      return reversed;
    });

    cloned.mesh = mesh;
    return cloned;
  }

  return cloned;
}

// ============================================================================
// Sub-Element Selection, Transform, Delete, Bevel, Fill/Bridge, Loop, Separate/Join
// ============================================================================

function canonicalEdgeKey(a: number, b: number): string {
  return a < b ? `${a}:${b}` : `${b}:${a}`;
}

/**
 * Collects unique, valid vertex indices affected by the current sub-element selection.
 */
export function collectAffectedVertexIndices(
  mesh: PolyMeshData,
  granularity: SelectionGranularity,
  selectedVertices: ReadonlyArray<number>,
  selectedEdges: ReadonlyArray<readonly [number, number]>,
  selectedFaces: ReadonlyArray<string>
): number[] {
  const maxV = mesh.vertices.length;
  const set = new Set<number>();

  if (granularity === "vertex") {
    for (const vi of selectedVertices) {
      if (vi >= 0 && vi < maxV) set.add(vi);
    }
  } else if (granularity === "edge") {
    for (const [a, b] of selectedEdges) {
      if (a >= 0 && a < maxV) set.add(a);
      if (b >= 0 && b < maxV) set.add(b);
    }
  } else if (granularity === "face") {
    const faceSet = new Set(selectedFaces);
    for (const f of mesh.faces) {
      if (!faceSet.has(f.id)) continue;
      for (const vi of f.verts) {
        if (vi >= 0 && vi < maxV) set.add(vi);
      }
    }
  }

  return Array.from(set).sort((a, b) => a - b);
}

/**
 * Computes the arithmetic centroid of the given vertex indices in local mesh pixel space.
 */
export function computeVerticesCentroid(
  vertices: ReadonlyArray<Vec3>,
  indices: ReadonlyArray<number>
): Vec3 | null {
  let sx = 0;
  let sy = 0;
  let sz = 0;
  let count = 0;
  for (const vi of indices) {
    const v = vertices[vi];
    if (!v) continue;
    sx += v[0];
    sy += v[1];
    sz += v[2];
    count += 1;
  }
  if (count === 0) return null;
  return cleanVec3([sx / count, sy / count, sz / count]);
}

export interface VertexTransformOptions {
  translation?: Vec3;
  rotationQuat?: Quat;
  scale?: Vec3;
  pivot?: Vec3;
  snapPx?: number;
}

/**
 * Transforms a subset of mesh vertices around `pivot` (defaults to their centroid).
 * Order: scale -> rotate -> translate, with optional grid snapping on final positions.
 */
export function transformMeshVertices(
  mesh: PolyMeshData,
  vertexIndices: ReadonlyArray<number>,
  opts: VertexTransformOptions
): PolyMeshData {
  const out = clonePolyMeshData(mesh);
  const valid = vertexIndices.filter((vi) => vi >= 0 && vi < out.vertices.length);
  if (valid.length === 0) return out;

  const pivot = opts.pivot ?? computeVerticesCentroid(out.vertices, valid) ?? [0, 0, 0];
  const tx = opts.translation?.[0] ?? 0;
  const ty = opts.translation?.[1] ?? 0;
  const tz = opts.translation?.[2] ?? 0;
  const sx = opts.scale?.[0] ?? 1;
  const sy = opts.scale?.[1] ?? 1;
  const sz = opts.scale?.[2] ?? 1;
  const rot = opts.rotationQuat;
  const snap = opts.snapPx && opts.snapPx > 0 ? opts.snapPx : 0;

  const snapCoord = (v: number): number =>
    snap > 0 ? cleanZero(Math.round(v / snap) * snap) : cleanZero(v);

  for (const vi of valid) {
    const orig = out.vertices[vi];
    let rel: Vec3 = [
      (orig[0] - pivot[0]) * sx,
      (orig[1] - pivot[1]) * sy,
      (orig[2] - pivot[2]) * sz,
    ];
    if (rot) {
      rel = quatRotateVec3(rot, rel);
    }
    out.vertices[vi] = [
      snapCoord(pivot[0] + rel[0] + tx),
      snapCoord(pivot[1] + rel[1] + ty),
      snapCoord(pivot[2] + rel[2] + tz),
    ];
  }

  return out;
}

/**
 * Deletes selected faces, edges (and their incident faces), or vertices (and their incident faces),
 * compacting unused vertices afterwards.
 */
export function deleteSelectedElements(
  mesh: PolyMeshData,
  granularity: SelectionGranularity,
  selectedVertices: ReadonlyArray<number>,
  selectedEdges: ReadonlyArray<readonly [number, number]>,
  selectedFaces: ReadonlyArray<string>
): { mesh: PolyMeshData; deletedFaceCount: number } {
  const cloned = clonePolyMeshData(mesh);
  const beforeCount = cloned.faces.length;

  if (granularity === "face") {
    const faceSet = new Set(selectedFaces);
    cloned.faces = cloned.faces.filter((f) => !faceSet.has(f.id));
  } else if (granularity === "vertex") {
    const vertSet = new Set(selectedVertices);
    cloned.faces = cloned.faces.filter((f) => !f.verts.some((vi) => vertSet.has(vi)));
  } else if (granularity === "edge") {
    const edgeSet = new Set(selectedEdges.map(([a, b]) => canonicalEdgeKey(a, b)));
    cloned.faces = cloned.faces.filter((f) => {
      const n = f.verts.length;
      for (let i = 0; i < n; i++) {
        if (edgeSet.has(canonicalEdgeKey(f.verts[i], f.verts[(i + 1) % n]))) {
          return false;
        }
      }
      return true;
    });
  }

  const deletedFaceCount = beforeCount - cloned.faces.length;
  return {
    mesh: compactUnusedVertices(cloned),
    deletedFaceCount,
  };
}

/**
 * Walks an edge loop across quad faces starting from `seedEdge`.
 * Returns canonical `[min, max]` edges in the loop (always includes `seedEdge`).
 */
export function selectEdgeLoop(
  mesh: PolyMeshData,
  seedEdge: readonly [number, number]
): [number, number][] {
  const normEdge = (a: number, b: number): [number, number] =>
    a < b ? [a, b] : [b, a];
  const seed = normEdge(seedEdge[0], seedEdge[1]);
  const seedKey = canonicalEdgeKey(seed[0], seed[1]);

  const edgeToQuads = new Map<string, PolyFace[]>();
  for (const face of mesh.faces) {
    if (face.verts.length !== 4) continue;
    for (let i = 0; i < 4; i++) {
      const k = canonicalEdgeKey(face.verts[i], face.verts[(i + 1) % 4]);
      const list = edgeToQuads.get(k);
      if (list) list.push(face);
      else edgeToQuads.set(k, [face]);
    }
  }

  const visited = new Set<string>([seedKey]);
  const result: [number, number][] = [seed];

  const getOppositeEdgeInQuad = (
    quad: PolyFace,
    edgeKey: string
  ): [number, number] | null => {
    for (let i = 0; i < 4; i++) {
      const a = quad.verts[i];
      const b = quad.verts[(i + 1) % 4];
      if (canonicalEdgeKey(a, b) === edgeKey) {
        const oa = quad.verts[(i + 2) % 4];
        const ob = quad.verts[(i + 3) % 4];
        return normEdge(oa, ob);
      }
    }
    return null;
  };

  const walk = (startQuad: PolyFace) => {
    let curKey = seedKey;
    let curQuad: PolyFace | undefined = startQuad;
    let safety = mesh.faces.length + 2;
    while (curQuad && safety-- > 0) {
      const opp = getOppositeEdgeInQuad(curQuad, curKey);
      if (!opp) break;
      const oppKey = canonicalEdgeKey(opp[0], opp[1]);
      if (visited.has(oppKey)) break;
      visited.add(oppKey);
      result.push(opp);
      const adj = edgeToQuads.get(oppKey) ?? [];
      curQuad = adj.find((q) => q.id !== curQuad!.id);
      curKey = oppKey;
    }
  };

  const startQuads = edgeToQuads.get(seedKey) ?? [];
  for (const q of startQuads) {
    walk(q);
  }

  return result;
}

/**
 * Splits a polygon with >= 3 vertices into valid PolyFaces (3-vert tris and/or 4-vert quads).
 */
function emitPolygonAsQuadsAndTris(
  verts: number[],
  uvs: Vec2[],
  template: PolyFace,
  usedIds: Set<string>,
  prefix: string,
  reuseTemplateId: boolean
): PolyFace[] {
  const cleanV: number[] = [];
  const cleanUv: Vec2[] = [];
  for (let i = 0; i < verts.length; i++) {
    const v = verts[i];
    const prev = cleanV[cleanV.length - 1];
    if (v !== prev) {
      cleanV.push(v);
      cleanUv.push(uvs[i] ?? [0, 0]);
    }
  }
  if (cleanV.length > 1 && cleanV[0] === cleanV[cleanV.length - 1]) {
    cleanV.pop();
    cleanUv.pop();
  }
  if (cleanV.length < 3) return [];

  const makeFace = (fv: number[], fuv: Vec2[], useOrigId: boolean): PolyFace => ({
    id: useOrigId ? template.id : allocateUniqueFaceId(prefix, usedIds),
    verts: fv,
    uvs: fuv.map((u) => cleanVec2(u)),
    materialId: template.materialId,
    flatShading: template.flatShading ?? true,
    ...(fv.length === 4 ? { triSplit: template.triSplit ?? "02" } : {}),
  });

  if (cleanV.length === 3 || cleanV.length === 4) {
    return [makeFace(cleanV, cleanUv, reuseTemplateId)];
  }

  const out: PolyFace[] = [];
  let idx = 1;
  while (idx < cleanV.length - 1) {
    const remaining = cleanV.length - idx;
    if (remaining >= 3) {
      out.push(
        makeFace(
          [cleanV[0], cleanV[idx], cleanV[idx + 1], cleanV[idx + 2]],
          [cleanUv[0], cleanUv[idx], cleanUv[idx + 1], cleanUv[idx + 2]],
          reuseTemplateId && out.length === 0
        )
      );
      idx += 2;
    } else {
      out.push(
        makeFace(
          [cleanV[0], cleanV[idx], cleanV[idx + 1]],
          [cleanUv[0], cleanUv[idx], cleanUv[idx + 1]],
          reuseTemplateId && out.length === 0
        )
      );
      idx += 1;
    }
  }
  return out;
}

/**
 * Bevels (chamfers) the selected edges by `widthPx` (clamped safely to 45% of adjacent edge lengths).
 * Produces valid 3/4-vertex faces with interpolated UVs.
 */
export function bevelEdges(
  mesh: PolyMeshData,
  edges: ReadonlyArray<readonly [number, number]>,
  widthPx: number
): { mesh: PolyMeshData; bevelFaceIds: string[] } {
  const safeWidth = Number.isFinite(widthPx) ? Math.max(0, widthPx) : 0;
  if (safeWidth <= 1e-6 || edges.length === 0) {
    return { mesh: clonePolyMeshData(mesh), bevelFaceIds: [] };
  }

  const current = clonePolyMeshData(mesh);
  const bevelFaceIds: string[] = [];

  const uniqueEdges: [number, number][] = [];
  const seen = new Set<string>();
  for (const [a, b] of edges) {
    if (a === b || a < 0 || b < 0 || a >= current.vertices.length || b >= current.vertices.length) {
      continue;
    }
    const k = canonicalEdgeKey(a, b);
    if (!seen.has(k)) {
      seen.add(k);
      uniqueEdges.push(a < b ? [a, b] : [b, a]);
    }
  }

  const usedIds = collectUsedFaceIds(current.faces);

  for (const [ea, eb] of uniqueEdges) {
    const eKey = canonicalEdgeKey(ea, eb);
    const incidentFaces: Array<{ faceIdx: number; aPos: number; bPos: number; forward: boolean }> = [];

    for (let fi = 0; fi < current.faces.length; fi++) {
      const f = current.faces[fi];
      const n = f.verts.length;
      for (let i = 0; i < n; i++) {
        const v0 = f.verts[i];
        const v1 = f.verts[(i + 1) % n];
        if (canonicalEdgeKey(v0, v1) === eKey) {
          incidentFaces.push({
            faceIdx: fi,
            aPos: v0 === ea ? i : (i + 1) % n,
            bPos: v0 === eb ? i : (i + 1) % n,
            forward: v0 === ea && v1 === eb,
          });
          break;
        }
      }
    }

    if (incidentFaces.length !== 2) continue;

    const [inc0, inc1] = incidentFaces;
    const f0 = current.faces[inc0.faceIdx];
    const f1 = current.faces[inc1.faceIdx];

    const moveAlongFace = (
      face: PolyFace,
      vPos: number,
      otherVert: number
    ): { newVertIdx: number; newUv: Vec2 } => {
      const n = face.verts.length;
      const vIdx = face.verts[vPos];
      const prevIdx = face.verts[(vPos - 1 + n) % n];
      const neighborPos = prevIdx === otherVert ? (vPos + 1) % n : (vPos - 1 + n) % n;
      const neighborVert = face.verts[neighborPos];
      const p0 = current.vertices[vIdx];
      const p1 = current.vertices[neighborVert];
      const len = vec3Length(vec3Sub(p1, p0));
      const t = len > 1e-6 ? Math.min(0.45, safeWidth / len) : 0;
      const newPos = cleanVec3(lerpVec3(p0, p1, t));
      const newVertIdx = current.vertices.length;
      current.vertices.push(newPos);
      const uv0 = face.uvs[vPos] ?? [0, 0];
      const uv1 = face.uvs[neighborPos] ?? uv0;
      return { newVertIdx, newUv: cleanVec2(lerpVec2(uv0, uv1, t)) };
    };

    const a0 = moveAlongFace(f0, inc0.aPos, eb);
    const b0 = moveAlongFace(f0, inc0.bPos, ea);
    const a1 = moveAlongFace(f1, inc1.aPos, eb);
    const b1 = moveAlongFace(f1, inc1.bPos, ea);

    f0.verts[inc0.aPos] = a0.newVertIdx;
    f0.uvs[inc0.aPos] = a0.newUv;
    f0.verts[inc0.bPos] = b0.newVertIdx;
    f0.uvs[inc0.bPos] = b0.newUv;

    f1.verts[inc1.aPos] = a1.newVertIdx;
    f1.uvs[inc1.aPos] = a1.newUv;
    f1.verts[inc1.bPos] = b1.newVertIdx;
    f1.uvs[inc1.bPos] = b1.newUv;

    const nextFaces: PolyFace[] = [];
    for (let fi = 0; fi < current.faces.length; fi++) {
      const f = current.faces[fi];
      if (fi === inc0.faceIdx || fi === inc1.faceIdx) {
        nextFaces.push(f);
        continue;
      }
      const touchesA = f.verts.includes(ea);
      const touchesB = f.verts.includes(eb);
      if (!touchesA && !touchesB) {
        nextFaces.push(f);
        continue;
      }

      const newVerts: number[] = [];
      const newUvs: Vec2[] = [];
      const n = f.verts.length;
      for (let i = 0; i < n; i++) {
        const vi = f.verts[i];
        const uvi = f.uvs[i] ?? [0, 0];
        if (vi === ea || vi === eb) {
          const prevV = f.verts[(i - 1 + n) % n];
          const nextV = f.verts[(i + 1) % n];
          const c0 = vi === ea ? a0.newVertIdx : b0.newVertIdx;
          const c1 = vi === ea ? a1.newVertIdx : b1.newVertIdx;
          const pPrev = current.vertices[prevV];
          const pNext = current.vertices[nextV];
          const pc0 = current.vertices[c0];
          const pc1 = current.vertices[c1];
          const d0Prev = vec3Length(vec3Sub(pc0, pPrev)) + vec3Length(vec3Sub(pc1, pNext));
          const d1Prev = vec3Length(vec3Sub(pc1, pPrev)) + vec3Length(vec3Sub(pc0, pNext));
          if (d0Prev <= d1Prev) {
            newVerts.push(c0, c1);
          } else {
            newVerts.push(c1, c0);
          }
          newUvs.push(uvi, uvi);
        } else {
          newVerts.push(vi);
          newUvs.push(uvi);
        }
      }
      nextFaces.push(...emitPolygonAsQuadsAndTris(newVerts, newUvs, f, usedIds, "bevel-cap", true));
    }

    const bevelId = allocateUniqueFaceId("bevel", usedIds);
    const bevelVerts = inc0.forward
      ? [a0.newVertIdx, b0.newVertIdx, b1.newVertIdx, a1.newVertIdx]
      : [b0.newVertIdx, a0.newVertIdx, a1.newVertIdx, b1.newVertIdx];
    const bevelUvs: Vec2[] = inc0.forward
      ? [a0.newUv, b0.newUv, b1.newUv, a1.newUv]
      : [b0.newUv, a0.newUv, a1.newUv, b1.newUv];

    const bevelFace: PolyFace = {
      id: bevelId,
      verts: bevelVerts,
      uvs: bevelUvs,
      triSplit: "02",
      flatShading: true,
      materialId: f0.materialId,
    };

    const n0 = computeFaceNormal(current.vertices, f0);
    const n1 = computeFaceNormal(current.vertices, f1);
    const avgN = vec3Add(n0, n1);
    const bn = computeFaceNormal(current.vertices, bevelFace);
    if (vec3Dot(bn, avgN) < 0) {
      nextFaces.push(reverseFaceKeepingAnchor(bevelFace));
    } else {
      nextFaces.push(bevelFace);
    }
    bevelFaceIds.push(bevelId);
    current.faces = nextFaces;
  }

  return { mesh: compactUnusedVertices(current), bevelFaceIds };
}

/**
 * Bevels (truncates) selected vertices by `widthPx`, creating a chamfer cap at each corner.
 */
export function bevelVertices(
  mesh: PolyMeshData,
  vertexIndices: ReadonlyArray<number>,
  widthPx: number
): { mesh: PolyMeshData; bevelFaceIds: string[] } {
  const safeWidth = Number.isFinite(widthPx) ? Math.max(0, widthPx) : 0;
  if (safeWidth <= 1e-6 || vertexIndices.length === 0) {
    return { mesh: clonePolyMeshData(mesh), bevelFaceIds: [] };
  }

  const current = clonePolyMeshData(mesh);
  const usedIds = collectUsedFaceIds(current.faces);
  const bevelFaceIds: string[] = [];

  const uniqueVerts = Array.from(
    new Set(vertexIndices.filter((vi) => vi >= 0 && vi < current.vertices.length))
  );

  for (const vIdx of uniqueVerts) {
    const vPos = current.vertices[vIdx];
    const edgeVertMap = new Map<number, number>();
    const incidentFaces = current.faces.filter((f) => f.verts.includes(vIdx));
    if (incidentFaces.length < 3) continue;

    for (const f of incidentFaces) {
      const n = f.verts.length;
      const pos = f.verts.indexOf(vIdx);
      const prevV = f.verts[(pos - 1 + n) % n];
      const nextV = f.verts[(pos + 1) % n];
      for (const nb of [prevV, nextV]) {
        if (!edgeVertMap.has(nb)) {
          const pNb = current.vertices[nb];
          const len = vec3Length(vec3Sub(pNb, vPos));
          const t = len > 1e-6 ? Math.min(0.45, safeWidth / len) : 0;
          const newIdx = current.vertices.length;
          current.vertices.push(cleanVec3(lerpVec3(vPos, pNb, t)));
          edgeVertMap.set(nb, newIdx);
        }
      }
    }

    const nextFaces: PolyFace[] = [];
    const capEdges: Array<[number, number]> = [];
    let avgNormal: Vec3 = [0, 0, 0];

    for (const f of current.faces) {
      const pos = f.verts.indexOf(vIdx);
      if (pos < 0) {
        nextFaces.push(f);
        continue;
      }
      avgNormal = vec3Add(avgNormal, computeFaceNormal(current.vertices, f));
      const n = f.verts.length;
      const prevV = f.verts[(pos - 1 + n) % n];
      const nextV = f.verts[(pos + 1) % n];
      const sPrev = edgeVertMap.get(prevV)!;
      const sNext = edgeVertMap.get(nextV)!;
      capEdges.push([sNext, sPrev]);

      const newVerts: number[] = [];
      const newUvs: Vec2[] = [];
      for (let i = 0; i < n; i++) {
        if (i === pos) {
          const uvCenter = f.uvs[pos] ?? [0, 0];
          const uvPrev = f.uvs[(pos - 1 + n) % n] ?? uvCenter;
          const uvNext = f.uvs[(pos + 1) % n] ?? uvCenter;
          newVerts.push(sPrev, sNext);
          newUvs.push(
            cleanVec2(lerpVec2(uvCenter, uvPrev, 0.25)),
            cleanVec2(lerpVec2(uvCenter, uvNext, 0.25))
          );
        } else {
          newVerts.push(f.verts[i]);
          newUvs.push(f.uvs[i] ?? [0, 0]);
        }
      }
      nextFaces.push(...emitPolygonAsQuadsAndTris(newVerts, newUvs, f, usedIds, "vbevel", true));
    }

    const nextMap = new Map<number, number>();
    for (const [a, b] of capEdges) nextMap.set(a, b);
    const loopVerts: number[] = [];
    if (capEdges.length > 0) {
      let cur = capEdges[0][0];
      const seenLoop = new Set<number>();
      while (!seenLoop.has(cur) && loopVerts.length <= capEdges.length) {
        seenLoop.add(cur);
        loopVerts.push(cur);
        const nxt = nextMap.get(cur);
        if (nxt === undefined) break;
        cur = nxt;
      }
    }

    if (loopVerts.length >= 3) {
      const capUvs: Vec2[] = loopVerts.map((_, i) => [
        i % 2 === 0 ? 0 : 4,
        i >= 2 ? 4 : 0,
      ]);
      const template = incidentFaces[0];
      const capFaces = emitPolygonAsQuadsAndTris(
        loopVerts,
        capUvs,
        template,
        usedIds,
        "vbevel-cap",
        false
      );
      for (const cf of capFaces) {
        const cn = computeFaceNormal(current.vertices, cf);
        const finalCf = vec3Dot(cn, avgNormal) < 0 ? reverseFaceKeepingAnchor(cf) : cf;
        nextFaces.push(finalCf);
        bevelFaceIds.push(finalCf.id);
      }
    }

    current.faces = nextFaces;
  }

  return { mesh: compactUnusedVertices(current), bevelFaceIds };
}

/**
 * Fills 3–4 selected vertices into a new face, or bridges 2 selected edges into a quad face.
 */
export function fillOrBridgeSelection(
  mesh: PolyMeshData,
  granularity: SelectionGranularity,
  selectedVertices: ReadonlyArray<number>,
  selectedEdges: ReadonlyArray<readonly [number, number]>,
  materialId: string
): { mesh: PolyMeshData; createdFaceIds: string[] } {
  const out = clonePolyMeshData(mesh);
  const usedIds = collectUsedFaceIds(out.faces);
  const maxV = out.vertices.length;

  let quadOrTri: number[] | null = null;

  if (granularity === "edge" && selectedEdges.length === 2) {
    const [a0, b0] = selectedEdges[0];
    const [a1, b1] = selectedEdges[1];
    const uniq = new Set([a0, b0, a1, b1]);
    if (
      uniq.size === 4 &&
      a0 >= 0 && a0 < maxV && b0 >= 0 && b0 < maxV &&
      a1 >= 0 && a1 < maxV && b1 >= 0 && b1 < maxV
    ) {
      const dir0 = vec3Sub(out.vertices[b0], out.vertices[a0]);
      const dir1 = vec3Sub(out.vertices[b1], out.vertices[a1]);
      quadOrTri = vec3Dot(dir0, dir1) >= 0 ? [a0, b0, b1, a1] : [a0, b0, a1, b1];
    }
  } else if (granularity === "vertex") {
    const uniq = Array.from(
      new Set(selectedVertices.filter((vi) => vi >= 0 && vi < maxV))
    );
    if (uniq.length === 3) {
      quadOrTri = uniq;
    } else if (uniq.length === 4) {
      const centroid = computeVerticesCentroid(out.vertices, uniq) ?? [0, 0, 0];
      const p0 = vec3Sub(out.vertices[uniq[0]], centroid);
      const p1 = vec3Sub(out.vertices[uniq[1]], centroid);
      const p2 = vec3Sub(out.vertices[uniq[2]], centroid);
      let normal = vec3Normalize(vec3Cross(vec3Sub(p1, p0), vec3Sub(p2, p0)));
      if (vec3Length(normal) < 1e-6) normal = [0, 1, 0];
      const uAxis = vec3Normalize(p0);
      const vAxis = vec3Normalize(vec3Cross(normal, uAxis));
      quadOrTri = [...uniq].sort((ia, ib) => {
        const ra = vec3Sub(out.vertices[ia], centroid);
        const rb = vec3Sub(out.vertices[ib], centroid);
        const angA = Math.atan2(vec3Dot(ra, vAxis), vec3Dot(ra, uAxis));
        const angB = Math.atan2(vec3Dot(rb, vAxis), vec3Dot(rb, uAxis));
        return angA - angB;
      });
    }
  }

  if (!quadOrTri) {
    return { mesh: out, createdFaceIds: [] };
  }

  const faceId = allocateUniqueFaceId("fill", usedIds);
  const defaultUvs: Vec2[] =
    quadOrTri.length === 4
      ? [[0, 0], [16, 0], [16, 16], [0, 16]]
      : [[0, 0], [16, 0], [8, 16]];

  out.faces.push({
    id: faceId,
    verts: quadOrTri,
    uvs: defaultUvs,
    ...(quadOrTri.length === 4 ? { triSplit: "02" as const } : {}),
    flatShading: true,
    materialId,
  });

  return { mesh: out, createdFaceIds: [faceId] };
}

/**
 * Separates selected faces of a mesh node into a new sibling mesh node.
 */
export function separateSelectedFaces(
  node: ModelNode,
  faceIds: ReadonlyArray<string>,
  newNodeId: string
): { remaining: ModelNode; separated: ModelNode | null } {
  if (node.kind !== "mesh" || !node.mesh || faceIds.length === 0) {
    return { remaining: cloneModelNode(node), separated: null };
  }
  const faceSet = new Set(faceIds);
  const keptFaces = node.mesh.faces.filter((f) => !faceSet.has(f.id));
  const movedFaces = node.mesh.faces.filter((f) => faceSet.has(f.id));
  if (movedFaces.length === 0) {
    return { remaining: cloneModelNode(node), separated: null };
  }

  const remaining = cloneModelNode(node);
  remaining.mesh = compactUnusedVertices({
    vertices: node.mesh.vertices.map((v): Vec3 => [v[0], v[1], v[2]]),
    faces: keptFaces.map(clonePolyFace),
  });

  const separated = cloneModelNode(node);
  separated.id = newNodeId;
  separated.name = `${node.name} (Part)`;
  separated.mesh = compactUnusedVertices({
    vertices: node.mesh.vertices.map((v): Vec3 => [v[0], v[1], v[2]]),
    faces: movedFaces.map(clonePolyFace),
  });

  return { remaining, separated };
}

function nodeLocalPointToWorld(pt: Vec3, tr: Transform3D): Vec3 {
  const rel: Vec3 = [
    (pt[0] - tr.pivot[0]) * tr.scale[0],
    (pt[1] - tr.pivot[1]) * tr.scale[1],
    (pt[2] - tr.pivot[2]) * tr.scale[2],
  ];
  const q = eulerDegToQuat(tr.rotation);
  const rotated = quatRotateVec3(q, rel);
  return [
    rotated[0] + tr.pivot[0] + tr.position[0],
    rotated[1] + tr.pivot[1] + tr.position[1],
    rotated[2] + tr.pivot[2] + tr.position[2],
  ];
}

function worldPointToNodeLocal(pt: Vec3, tr: Transform3D): Vec3 {
  const shifted: Vec3 = [
    pt[0] - tr.pivot[0] - tr.position[0],
    pt[1] - tr.pivot[1] - tr.position[1],
    pt[2] - tr.pivot[2] - tr.position[2],
  ];
  const q = eulerDegToQuat(tr.rotation);
  const invQ: Quat = [-q[0], -q[1], -q[2], q[3]];
  const unrot = quatRotateVec3(invQ, shifted);
  const sx = Math.abs(tr.scale[0]) > 1e-6 ? tr.scale[0] : 1;
  const sy = Math.abs(tr.scale[1]) > 1e-6 ? tr.scale[1] : 1;
  const sz = Math.abs(tr.scale[2]) > 1e-6 ? tr.scale[2] : 1;
  return cleanVec3([
    unrot[0] / sx + tr.pivot[0],
    unrot[1] / sy + tr.pivot[1],
    unrot[2] / sz + tr.pivot[2],
  ]);
}

/**
 * Joins multiple mesh/cuboid nodes into `targetNodeId`'s local space as a single PolyMeshData node.
 */
export function joinMeshNodes(
  nodes: ReadonlyArray<ModelNode>,
  targetNodeId: string
): ModelNode | null {
  const targetOrig = nodes.find((n) => n.id === targetNodeId);
  if (!targetOrig) return null;

  const target =
    targetOrig.kind === "cuboid"
      ? convertNodeCuboidToMesh(targetOrig)
      : cloneModelNode(targetOrig);
  if (target.kind !== "mesh" || !target.mesh) return null;

  const usedIds = collectUsedFaceIds(target.mesh.faces);
  const mergedVerts = target.mesh.vertices.map((v): Vec3 => [v[0], v[1], v[2]]);
  const mergedFaces = target.mesh.faces.map(clonePolyFace);

  for (const src of nodes) {
    if (src.id === targetNodeId) continue;
    const srcMesh =
      src.kind === "cuboid" && src.cuboid
        ? convertCuboidToMesh(src.cuboid)
        : src.kind === "mesh" && src.mesh
        ? src.mesh
        : null;
    if (!srcMesh) continue;

    const baseOffset = mergedVerts.length;
    for (const v of srcMesh.vertices) {
      const worldPt = nodeLocalPointToWorld(v, src.transform);
      mergedVerts.push(worldPointToNodeLocal(worldPt, target.transform));
    }
    for (const f of srcMesh.faces) {
      const clonedF = clonePolyFace(f);
      clonedF.id = usedIds.has(clonedF.id)
        ? allocateUniqueFaceId("join", usedIds)
        : (usedIds.add(clonedF.id), clonedF.id);
      clonedF.verts = clonedF.verts.map((vi) => vi + baseOffset);
      mergedFaces.push(clonedF);
    }
  }

  target.mesh = { vertices: mergedVerts, faces: mergedFaces };
  return target;
}

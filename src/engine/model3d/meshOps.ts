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

import {
  clonePolyFace,
  clonePolyMeshData,
  Model3DEngine,
} from "./Model3DEngine.ts";
import { vec3Add, vec3Scale } from "./quatMath.ts";
import type {
  ModelNode,
  PolyFace,
  PolyMeshData,
  TileCursor3D,
  TileCursorPlane,
  TilePrefab3D,
  Vec2,
  Vec3,
} from "./types.ts";

export type TileCursorStepDir =
  | "left"
  | "right"
  | "forward"
  | "backward"
  | "up"
  | "down";

export type TileSlopeKind =
  | "slope45"
  | "cornerInner"
  | "cornerOuter"
  | "stair2";

function cleanZero(n: number): number {
  const cleaned = Math.round(n * 1e6) / 1e6;
  return Object.is(cleaned, -0) ? 0 : cleaned;
}

function cleanVec3(x: number, y: number, z: number): Vec3 {
  return [cleanZero(x), cleanZero(y), cleanZero(z)];
}

function cloneCursor(cursor: TileCursor3D): TileCursor3D {
  return {
    ...cursor,
    position: [cursor.position[0], cursor.position[1], cursor.position[2]],
  };
}

function effectiveStep(cursor: TileCursor3D): number {
  return Number.isFinite(cursor.stepPx) && cursor.stepPx > 0
    ? cursor.stepPx
    : 16;
}

function allocateFaceId(mesh: PolyMeshData, prefix = "tile-face"): string {
  const existing = new Set(mesh.faces.map((f) => f.id));
  let idx = mesh.faces.length + 1;
  let candidate = `${prefix}-${idx}`;
  while (existing.has(candidate)) {
    idx += 1;
    candidate = `${prefix}-${idx}`;
  }
  return candidate;
}

function buildCursorTileSource(
  cursor: TileCursor3D
): NonNullable<PolyFace["tileSource"]> {
  return {
    tilesetId: cursor.tilesetId,
    tileUid: cursor.tileUid,
    cachedTileId: cursor.cachedTileId,
    rotation: cursor.rotation,
    flipX: cursor.flipX,
    flipY: cursor.flipY,
  };
}

function getPlaneNormal(plane: TileCursorPlane): Vec3 {
  switch (plane) {
    case "xz":
      return [0, 1, 0];
    case "xy":
      return [0, 0, 1];
    case "zy":
      return [1, 0, 0];
  }
}

function bilerpUv(
  uvs: readonly [Vec2, Vec2, Vec2, Vec2],
  s: number,
  t: number
): Vec2 {
  const [bl, br, tr, tl] = uvs;
  const bx = bl[0] + (br[0] - bl[0]) * s;
  const by = bl[1] + (br[1] - bl[1]) * s;
  const tx = tl[0] + (tr[0] - tl[0]) * s;
  const ty = tl[1] + (tr[1] - tl[1]) * s;
  return [cleanZero(bx + (tx - bx) * t), cleanZero(by + (ty - by) * t)];
}

/**
 * Steps `cursor.position` by `cursor.stepPx` along the active plane axes
 * (`left`/`right`, `forward`/`backward`) or the plane's normal depth (`up`/`down`).
 */
export function stepTileCursor(
  cursor: TileCursor3D,
  dir: TileCursorStepDir
): TileCursor3D {
  const next = cloneCursor(cursor);
  const s = effectiveStep(cursor);
  const [x, y, z] = cursor.position;

  switch (cursor.plane) {
    case "xz": {
      if (dir === "left") next.position = cleanVec3(x - s, y, z);
      else if (dir === "right") next.position = cleanVec3(x + s, y, z);
      else if (dir === "forward") next.position = cleanVec3(x, y, z - s);
      else if (dir === "backward") next.position = cleanVec3(x, y, z + s);
      else if (dir === "up") next.position = cleanVec3(x, y + s, z);
      else next.position = cleanVec3(x, y - s, z);
      break;
    }
    case "xy": {
      if (dir === "left") next.position = cleanVec3(x - s, y, z);
      else if (dir === "right") next.position = cleanVec3(x + s, y, z);
      else if (dir === "forward") next.position = cleanVec3(x, y + s, z);
      else if (dir === "backward") next.position = cleanVec3(x, y - s, z);
      else if (dir === "up") next.position = cleanVec3(x, y, z + s);
      else next.position = cleanVec3(x, y, z - s);
      break;
    }
    case "zy": {
      if (dir === "left") next.position = cleanVec3(x, y, z - s);
      else if (dir === "right") next.position = cleanVec3(x, y, z + s);
      else if (dir === "forward") next.position = cleanVec3(x, y + s, z);
      else if (dir === "backward") next.position = cleanVec3(x, y - s, z);
      else if (dir === "up") next.position = cleanVec3(x + s, y, z);
      else next.position = cleanVec3(x - s, y, z);
      break;
    }
  }

  return next;
}

/**
 * Cycles the 3D tile cursor plane: `"xz" -> "xy" -> "zy" -> "xz"`.
 */
export function cycleTileCursorPlane(cursor: TileCursor3D): TileCursor3D {
  const next = cloneCursor(cursor);
  if (cursor.plane === "xz") next.plane = "xy";
  else if (cursor.plane === "xy") next.plane = "zy";
  else next.plane = "xz";
  return next;
}

/**
 * Rotates the tile cursor clockwise by 90° (`0 -> 90 -> 180 -> 270 -> 0`).
 */
export function rotateTileCursorCW(cursor: TileCursor3D): TileCursor3D {
  const next = cloneCursor(cursor);
  next.rotation = (((cursor.rotation + 90) % 360) as 0 | 90 | 180 | 270);
  return next;
}

/**
 * Toggles horizontal (`"x"`) or vertical (`"y"`) tile cursor mirroring.
 */
export function flipTileCursor(
  cursor: TileCursor3D,
  axis: "x" | "y"
): TileCursor3D {
  const next = cloneCursor(cursor);
  if (axis === "x") next.flipX = !cursor.flipX;
  else next.flipY = !cursor.flipY;
  return next;
}

/**
 * Computes the 4 CCW corners `[bottomLeft, bottomRight, topRight, topLeft]` of the
 * cursor quad spanning `cursor.position` to `cursor.position + [tw, th]` on `cursor.plane`.
 */
export function getTileCursorQuadCorners(
  cursor: TileCursor3D,
  tileWidthPx?: number,
  tileHeightPx?: number,
  flipNormal = false
): [Vec3, Vec3, Vec3, Vec3] {
  const step = effectiveStep(cursor);
  const tw =
    typeof tileWidthPx === "number" && Number.isFinite(tileWidthPx) && tileWidthPx > 0
      ? tileWidthPx
      : step;
  const th =
    typeof tileHeightPx === "number" && Number.isFinite(tileHeightPx) && tileHeightPx > 0
      ? tileHeightPx
      : step;

  const [x, y, z] = cursor.position;
  let corners: [Vec3, Vec3, Vec3, Vec3];

  switch (cursor.plane) {
    case "xz":
      corners = [
        cleanVec3(x, y, z + th),
        cleanVec3(x + tw, y, z + th),
        cleanVec3(x + tw, y, z),
        cleanVec3(x, y, z),
      ];
      break;
    case "xy":
      corners = [
        cleanVec3(x, y, z),
        cleanVec3(x + tw, y, z),
        cleanVec3(x + tw, y + th, z),
        cleanVec3(x, y + th, z),
      ];
      break;
    case "zy":
      corners = [
        cleanVec3(x, y, z + tw),
        cleanVec3(x, y, z),
        cleanVec3(x, y + th, z),
        cleanVec3(x, y + th, z + tw),
      ];
      break;
  }

  if (flipNormal) {
    return [corners[1], corners[0], corners[3], corners[2]];
  }
  return corners;
}

/**
 * Finds an existing vertex in `mesh.vertices` within `weldEpsilon` Euclidean distance,
 * or appends a new vertex and returns its index.
 */
export function addOrWeldVertex(
  mesh: PolyMeshData,
  v: Vec3,
  weldEpsilon = 1e-3
): number {
  const eps = Math.max(0, weldEpsilon);
  for (let i = 0; i < mesh.vertices.length; i++) {
    const ev = mesh.vertices[i];
    const dist = Math.hypot(ev[0] - v[0], ev[1] - v[1], ev[2] - v[2]);
    if (dist <= eps) {
      return i;
    }
  }
  mesh.vertices.push(cleanVec3(v[0], v[1], v[2]));
  return mesh.vertices.length - 1;
}

/**
 * Reuses `preferredNodeId` if it points to an unlocked `"mesh"` node, otherwise
 * creates and selects a new `"mesh"` node named `"Tile Scene"` in `engine`.
 */
export function ensureStampTargetMeshNode(
  engine: Model3DEngine,
  materialId: string,
  preferredNodeId?: string | null
): ModelNode {
  void materialId;
  if (preferredNodeId) {
    const existing = engine.getNode(preferredNodeId);
    if (existing && existing.kind === "mesh" && !existing.locked) {
      if (!existing.mesh) {
        existing.mesh = { vertices: [], faces: [] };
      }
      return existing;
    }
  }
  return engine.addNode({
    kind: "mesh",
    name: "Tile Scene",
    mesh: { vertices: [], faces: [] },
  });
}

function findMatchingQuadFace(
  mesh: PolyMeshData,
  corners: readonly [Vec3, Vec3, Vec3, Vec3],
  eps = 1e-3
): { face: PolyFace; matchedVertIndices: [number, number, number, number] } | null {
  for (const face of mesh.faces) {
    if (face.verts.length !== 4) continue;
    const used = [false, false, false, false];
    const matched: number[] = [];
    let allMatched = true;

    for (let ci = 0; ci < 4; ci++) {
      const targetPos = corners[ci];
      let foundIdx = -1;
      for (let fi = 0; fi < 4; fi++) {
        if (used[fi]) continue;
        const vi = face.verts[fi];
        const v = mesh.vertices[vi];
        if (!v) continue;
        const dist = Math.hypot(
          v[0] - targetPos[0],
          v[1] - targetPos[1],
          v[2] - targetPos[2]
        );
        if (dist <= eps) {
          used[fi] = true;
          foundIdx = vi;
          break;
        }
      }
      if (foundIdx === -1) {
        allMatched = false;
        break;
      }
      matched.push(foundIdx);
    }

    if (allMatched && matched.length === 4) {
      return {
        face,
        matchedVertIndices: [matched[0], matched[1], matched[2], matched[3]],
      };
    }
  }
  return null;
}

/**
 * Stamps a tile quad at `cursor` onto `mesh`.
 * When `replaceCoplanar` (default `true`) finds an existing quad sharing the same 4 corner
 * positions (regardless of winding), updates it in-place to prevent duplicate Z-fighting quads.
 */
export function stampTileQuadOnMesh(
  mesh: PolyMeshData,
  cursor: TileCursor3D,
  options: {
    materialId: string;
    uvs: [Vec2, Vec2, Vec2, Vec2];
    tileWidthPx?: number;
    tileHeightPx?: number;
    autoWeld?: boolean;
    flipNormal?: boolean;
    replaceCoplanar?: boolean;
  }
): { faceId: string; replaced: boolean } {
  const autoWeld = options.autoWeld ?? true;
  const flipNormal = options.flipNormal ?? false;
  const replaceCoplanar = options.replaceCoplanar ?? true;

  const corners = getTileCursorQuadCorners(
    cursor,
    options.tileWidthPx,
    options.tileHeightPx,
    flipNormal
  );
  const clonedUvs: Vec2[] = options.uvs.map(([u, v]): Vec2 => [u, v]);
  const tileSource = buildCursorTileSource(cursor);

  if (replaceCoplanar) {
    const match = findMatchingQuadFace(mesh, corners);
    if (match) {
      const { face, matchedVertIndices } = match;
      face.verts = autoWeld
        ? corners.map((c) => addOrWeldVertex(mesh, c))
        : [...matchedVertIndices];
      face.uvs = clonedUvs;
      face.materialId = options.materialId;
      face.tileSource = tileSource;
      face.triSplit = "02";
      face.flatShading = true;
      return { faceId: face.id, replaced: true };
    }
  }

  const vertIndices = corners.map((c) => {
    if (autoWeld) return addOrWeldVertex(mesh, c);
    mesh.vertices.push(cleanVec3(c[0], c[1], c[2]));
    return mesh.vertices.length - 1;
  });

  const faceId = allocateFaceId(mesh);
  mesh.faces.push({
    id: faceId,
    verts: vertIndices,
    uvs: clonedUvs,
    triSplit: "02",
    flatShading: true,
    materialId: options.materialId,
    tileSource,
  });

  return { faceId, replaced: false };
}

/**
 * Fills a rectangular grid of tiles from `startCursor.position` to `endPosition`
 * stepped by `[tileWidthPx, tileHeightPx]` along `startCursor.plane`, welding shared inner vertices.
 */
export function dragFillTilePlane(
  mesh: PolyMeshData,
  startCursor: TileCursor3D,
  endPosition: Vec3,
  options: {
    materialId: string;
    uvs: [Vec2, Vec2, Vec2, Vec2];
    tileWidthPx?: number;
    tileHeightPx?: number;
    autoWeld?: boolean;
    flipNormal?: boolean;
  }
): string[] {
  const step = effectiveStep(startCursor);
  const tw =
    typeof options.tileWidthPx === "number" &&
    Number.isFinite(options.tileWidthPx) &&
    options.tileWidthPx > 0
      ? options.tileWidthPx
      : step;
  const th =
    typeof options.tileHeightPx === "number" &&
    Number.isFinite(options.tileHeightPx) &&
    options.tileHeightPx > 0
      ? options.tileHeightPx
      : step;

  const [sx, sy, sz] = startCursor.position;
  const [ex, ey, ez] = endPosition;

  let deltaU = 0;
  let deltaV = 0;
  switch (startCursor.plane) {
    case "xz":
      deltaU = ex - sx;
      deltaV = ez - sz;
      break;
    case "xy":
      deltaU = ex - sx;
      deltaV = ey - sy;
      break;
    case "zy":
      deltaU = ez - sz;
      deltaV = ey - sy;
      break;
  }

  const countU = Math.floor(Math.abs(deltaU) / tw + 1e-6);
  const countV = Math.floor(Math.abs(deltaV) / th + 1e-6);
  const signU = deltaU < -1e-6 ? -1 : 1;
  const signV = deltaV < -1e-6 ? -1 : 1;

  const faceIds: string[] = [];
  for (let iv = 0; iv <= countV; iv++) {
    for (let iu = 0; iu <= countU; iu++) {
      const du = iu * signU * tw;
      const dv = iv * signV * th;
      const cellCursor = cloneCursor(startCursor);
      if (startCursor.plane === "xz") {
        cellCursor.position = cleanVec3(sx + du, sy, sz + dv);
      } else if (startCursor.plane === "xy") {
        cellCursor.position = cleanVec3(sx + du, sy + dv, sz);
      } else {
        cellCursor.position = cleanVec3(sx, sy + dv, sz + du);
      }

      const res = stampTileQuadOnMesh(mesh, cellCursor, {
        materialId: options.materialId,
        uvs: options.uvs,
        tileWidthPx: tw,
        tileHeightPx: th,
        autoWeld: options.autoWeld ?? true,
        flipNormal: options.flipNormal ?? false,
        replaceCoplanar: true,
      });
      faceIds.push(res.faceId);
    }
  }

  return faceIds;
}

/**
 * Extrudes a 3D prism/block from the cursor quad along the plane's normal by `depthPx`,
 * creating the top cap, optional bottom cap, and 4 textured side quads with outward CCW normals.
 */
export function extrudeTileBlockOnMesh(
  mesh: PolyMeshData,
  cursor: TileCursor3D,
  depthPx: number,
  options: {
    materialId: string;
    capUvs: [Vec2, Vec2, Vec2, Vec2];
    sideUvs?: [Vec2, Vec2, Vec2, Vec2];
    tileWidthPx?: number;
    tileHeightPx?: number;
    includeBottomCap?: boolean;
    autoWeld?: boolean;
  }
): string[] {
  if (!Number.isFinite(depthPx) || Math.abs(depthPx) < 1e-6) {
    return [];
  }

  const autoWeld = options.autoWeld ?? true;
  const includeBottomCap = options.includeBottomCap ?? false;
  const sideUvs = options.sideUvs ?? options.capUvs;

  const base = getTileCursorQuadCorners(
    cursor,
    options.tileWidthPx,
    options.tileHeightPx,
    false
  );
  const normal = getPlaneNormal(cursor.plane);
  const offset = vec3Scale(normal, depthPx);
  const top: [Vec3, Vec3, Vec3, Vec3] = [
    vec3Add(base[0], offset),
    vec3Add(base[1], offset),
    vec3Add(base[2], offset),
    vec3Add(base[3], offset),
  ];

  const getVert = (v: Vec3): number => {
    if (autoWeld) return addOrWeldVertex(mesh, v);
    mesh.vertices.push(cleanVec3(v[0], v[1], v[2]));
    return mesh.vertices.length - 1;
  };

  const bIdx = base.map(getVert);
  const tIdx = top.map(getVert);
  const tileSource = buildCursorTileSource(cursor);

  const pushQuad = (
    verts: [number, number, number, number],
    uvs: readonly [Vec2, Vec2, Vec2, Vec2]
  ): string => {
    const faceId = allocateFaceId(mesh);
    mesh.faces.push({
      id: faceId,
      verts,
      uvs: uvs.map(([u, v]): Vec2 => [u, v]),
      triSplit: "02",
      flatShading: true,
      materialId: options.materialId,
      tileSource: { ...tileSource },
    });
    return faceId;
  };

  const created: string[] = [];
  if (depthPx > 0) {
    // Top cap (+normal)
    created.push(pushQuad([tIdx[0], tIdx[1], tIdx[2], tIdx[3]], options.capUvs));
    // Optional bottom cap (-normal)
    if (includeBottomCap) {
      created.push(pushQuad([bIdx[1], bIdx[0], bIdx[3], bIdx[2]], options.capUvs));
    }
    // 4 side quads (outward CCW)
    for (let i = 0; i < 4; i++) {
      const next = (i + 1) % 4;
      created.push(pushQuad([bIdx[i], bIdx[next], tIdx[next], tIdx[i]], sideUvs));
    }
  } else {
    // Negative extrusion: extruded cap faces -normal, start cap faces +normal
    created.push(pushQuad([tIdx[1], tIdx[0], tIdx[3], tIdx[2]], options.capUvs));
    if (includeBottomCap) {
      created.push(pushQuad([bIdx[0], bIdx[1], bIdx[2], bIdx[3]], options.capUvs));
    }
    for (let i = 0; i < 4; i++) {
      const next = (i + 1) % 4;
      created.push(pushQuad([tIdx[i], tIdx[next], bIdx[next], bIdx[i]], sideUvs));
    }
  }

  return created;
}

function rotateLocalXZ(v: Vec3, sx: number, sz: number, rot: 0 | 90 | 180 | 270): Vec3 {
  if (rot === 0) return v;
  const cx = sx * 0.5;
  const cz = sz * 0.5;
  const dx = v[0] - cx;
  const dz = v[2] - cz;
  if (rot === 90) return cleanVec3(cx - dz, v[1], cz + dx);
  if (rot === 180) return cleanVec3(cx - dx, v[1], cz - dz);
  return cleanVec3(cx + dz, v[1], cz - dx);
}

function mapLocalToCursorPlane(
  v: Vec3,
  sx: number,
  sz: number,
  cursor: TileCursor3D
): Vec3 {
  const rotated = rotateLocalXZ(v, sx, sz, cursor.rotation);
  const [u, h, w] = rotated;
  const [ox, oy, oz] = cursor.position;

  switch (cursor.plane) {
    case "xz":
      return cleanVec3(ox + u, oy + h, oz + w);
    case "xy":
      // Proper rotation -90° around X keeping bounds in [0..sx, 0..sy, 0..sz]
      return cleanVec3(ox + u, oy + (sz - w), oz + h);
    case "zy":
      // Proper orientation (U=+Z, N=+X, V=+Y) keeping bounds in [0..sy, 0..sz, 0..sx]
      return cleanVec3(ox + h, oy + w, oz + u);
  }
}

/**
 * Generates Crocotile-style architectural shapes (`slope45`, `cornerInner`, `cornerOuter`,
 * `stair2`) with outward CCW normals and tile-mapped UVs oriented at `cursor`.
 */
export function buildTileSlopeMesh(
  cursor: TileCursor3D,
  kind: TileSlopeKind,
  options: {
    materialId: string;
    uvs: [Vec2, Vec2, Vec2, Vec2];
    sizePx?: Vec3;
  }
): PolyMeshData {
  const step = effectiveStep(cursor);
  const sx =
    typeof options.sizePx?.[0] === "number" &&
    Number.isFinite(options.sizePx[0]) &&
    options.sizePx[0] > 0
      ? options.sizePx[0]
      : step;
  const sy =
    typeof options.sizePx?.[1] === "number" &&
    Number.isFinite(options.sizePx[1]) &&
    options.sizePx[1] > 0
      ? options.sizePx[1]
      : step;
  const sz =
    typeof options.sizePx?.[2] === "number" &&
    Number.isFinite(options.sizePx[2]) &&
    options.sizePx[2] > 0
      ? options.sizePx[2]
      : step;

  const tileSource = buildCursorTileSource(cursor);
  const uvFull: [Vec2, Vec2, Vec2, Vec2] = [
    bilerpUv(options.uvs, 0, 0),
    bilerpUv(options.uvs, 1, 0),
    bilerpUv(options.uvs, 1, 1),
    bilerpUv(options.uvs, 0, 1),
  ];

  const makeFace = (
    id: string,
    verts: number[],
    uvs: Vec2[]
  ): PolyFace => ({
    id,
    verts,
    uvs,
    triSplit: verts.length === 4 ? "02" : undefined,
    flatShading: true,
    materialId: options.materialId,
    tileSource: { ...tileSource },
  });

  let localVerts: Vec3[] = [];
  let faces: PolyFace[] = [];

  if (kind === "slope45") {
    localVerts = [
      [0, 0, sz], // 0: front-bottom-left
      [sx, 0, sz], // 1: front-bottom-right
      [sx, 0, 0], // 2: back-bottom-right
      [0, 0, 0], // 3: back-bottom-left
      [sx, sy, 0], // 4: back-top-right
      [0, sy, 0], // 5: back-top-left
    ];
    faces = [
      makeFace("slope-ramp", [0, 1, 4, 5], [...uvFull]),
      makeFace("slope-back", [2, 3, 5, 4], [...uvFull]),
      makeFace("slope-bottom", [3, 2, 1, 0], [...uvFull]),
      makeFace("slope-left", [3, 0, 5], [
        bilerpUv(options.uvs, 0, 0),
        bilerpUv(options.uvs, 1, 0),
        bilerpUv(options.uvs, 0, 1),
      ]),
      makeFace("slope-right", [1, 2, 4], [
        bilerpUv(options.uvs, 0, 0),
        bilerpUv(options.uvs, 1, 0),
        bilerpUv(options.uvs, 1, 1),
      ]),
    ];
  } else if (kind === "cornerOuter") {
    localVerts = [
      [0, 0, 0], // 0: bottom back-left
      [sx, 0, 0], // 1: bottom back-right
      [0, 0, sz], // 2: bottom front-left
      [0, sy, 0], // 3: top back-left
      [sx, sy, 0], // 4: top back-right
      [0, sy, sz], // 5: top front-left
    ];
    faces = [
      makeFace("corner-outer-bottom", [0, 1, 2], [
        bilerpUv(options.uvs, 0, 1),
        bilerpUv(options.uvs, 1, 1),
        bilerpUv(options.uvs, 0, 0),
      ]),
      makeFace("corner-outer-top", [3, 5, 4], [
        bilerpUv(options.uvs, 0, 1),
        bilerpUv(options.uvs, 0, 0),
        bilerpUv(options.uvs, 1, 1),
      ]),
      makeFace("corner-outer-back", [1, 0, 3, 4], [...uvFull]),
      makeFace("corner-outer-left", [0, 2, 5, 3], [...uvFull]),
      makeFace("corner-outer-chamfer", [2, 1, 4, 5], [...uvFull]),
    ];
  } else if (kind === "cornerInner") {
    localVerts = [
      [0, 0, sz], // 0: bottom front-left
      [sx, 0, sz], // 1: bottom front-right
      [sx, 0, 0], // 2: bottom back-right
      [0, 0, 0], // 3: bottom back-left
      [0, sy, 0], // 4: top back-left
      [sx, sy, 0], // 5: top back-right
      [0, sy, sz], // 6: top front-left
    ];
    faces = [
      makeFace("corner-inner-bottom", [3, 2, 1, 0], [...uvFull]),
      makeFace("corner-inner-back", [2, 3, 4, 5], [...uvFull]),
      makeFace("corner-inner-left", [3, 0, 6, 4], [...uvFull]),
      makeFace("corner-inner-right", [1, 2, 5], [
        bilerpUv(options.uvs, 0, 0),
        bilerpUv(options.uvs, 1, 0),
        bilerpUv(options.uvs, 1, 1),
      ]),
      makeFace("corner-inner-front", [0, 1, 6], [
        bilerpUv(options.uvs, 0, 0),
        bilerpUv(options.uvs, 1, 0),
        bilerpUv(options.uvs, 0, 1),
      ]),
      makeFace("corner-inner-top", [4, 6, 5], [
        bilerpUv(options.uvs, 0, 1),
        bilerpUv(options.uvs, 0, 0),
        bilerpUv(options.uvs, 1, 1),
      ]),
      makeFace("corner-inner-slope", [6, 1, 5], [
        bilerpUv(options.uvs, 0, 1),
        bilerpUv(options.uvs, 0.5, 0),
        bilerpUv(options.uvs, 1, 1),
      ]),
    ];
  } else {
    // "stair2": 2-step block with zero T-junctions
    const hm = sy * 0.5;
    const dm = sz * 0.5;
    localVerts = [
      [0, 0, sz], // 0: bottom front-left
      [sx, 0, sz], // 1: bottom front-right
      [sx, 0, 0], // 2: bottom back-right
      [0, 0, 0], // 3: bottom back-left
      [0, hm, sz], // 4: step1 front-left
      [sx, hm, sz], // 5: step1 front-right
      [sx, hm, dm], // 6: step1 mid-right
      [0, hm, dm], // 7: step1 mid-left
      [sx, sy, dm], // 8: step2 mid-right
      [0, sy, dm], // 9: step2 mid-left
      [sx, sy, 0], // 10: step2 back-right
      [0, sy, 0], // 11: step2 back-left
      [0, 0, dm], // 12: bottom mid-left
      [sx, 0, dm], // 13: bottom mid-right
      [0, hm, 0], // 14: mid-height back-left
      [sx, hm, 0], // 15: mid-height back-right
    ];
    const uvHalfBot: Vec2[] = [
      bilerpUv(options.uvs, 0, 0),
      bilerpUv(options.uvs, 1, 0),
      bilerpUv(options.uvs, 1, 0.5),
      bilerpUv(options.uvs, 0, 0.5),
    ];
    const uvHalfTop: Vec2[] = [
      bilerpUv(options.uvs, 0, 0.5),
      bilerpUv(options.uvs, 1, 0.5),
      bilerpUv(options.uvs, 1, 1),
      bilerpUv(options.uvs, 0, 1),
    ];
    faces = [
      makeFace("stair-bot-front", [12, 13, 1, 0], uvHalfBot),
      makeFace("stair-bot-back", [3, 2, 13, 12], uvHalfTop),
      makeFace("stair-riser-1", [0, 1, 5, 4], uvHalfBot),
      makeFace("stair-tread-1", [4, 5, 6, 7], uvHalfBot),
      makeFace("stair-riser-2", [7, 6, 8, 9], uvHalfTop),
      makeFace("stair-tread-2", [9, 8, 10, 11], uvHalfTop),
      makeFace("stair-left-front", [12, 0, 4, 7], [
        bilerpUv(options.uvs, 0.5, 0),
        bilerpUv(options.uvs, 1, 0),
        bilerpUv(options.uvs, 1, 0.5),
        bilerpUv(options.uvs, 0.5, 0.5),
      ]),
      makeFace("stair-left-back-low", [3, 12, 7, 14], [
        bilerpUv(options.uvs, 0, 0),
        bilerpUv(options.uvs, 0.5, 0),
        bilerpUv(options.uvs, 0.5, 0.5),
        bilerpUv(options.uvs, 0, 0.5),
      ]),
      makeFace("stair-left-back-high", [14, 7, 9, 11], [
        bilerpUv(options.uvs, 0, 0.5),
        bilerpUv(options.uvs, 0.5, 0.5),
        bilerpUv(options.uvs, 0.5, 1),
        bilerpUv(options.uvs, 0, 1),
      ]),
      makeFace("stair-right-front", [1, 13, 6, 5], [
        bilerpUv(options.uvs, 0, 0),
        bilerpUv(options.uvs, 0.5, 0),
        bilerpUv(options.uvs, 0.5, 0.5),
        bilerpUv(options.uvs, 0, 0.5),
      ]),
      makeFace("stair-right-back-low", [13, 2, 15, 6], [
        bilerpUv(options.uvs, 0.5, 0),
        bilerpUv(options.uvs, 1, 0),
        bilerpUv(options.uvs, 1, 0.5),
        bilerpUv(options.uvs, 0.5, 0.5),
      ]),
      makeFace("stair-right-back-high", [6, 15, 10, 8], [
        bilerpUv(options.uvs, 0.5, 0.5),
        bilerpUv(options.uvs, 1, 0.5),
        bilerpUv(options.uvs, 1, 1),
        bilerpUv(options.uvs, 0.5, 1),
      ]),
      makeFace("stair-back-low", [2, 3, 14, 15], uvHalfBot),
      makeFace("stair-back-high", [15, 14, 11, 10], uvHalfTop),
    ];
  }

  const vertices = localVerts.map((v) =>
    mapLocalToCursorPlane(v, sx, sz, cursor)
  );
  return { vertices, faces };
}

/**
 * Appends `sub` into `target` at `offsetPx`, optionally welding vertices to existing ones,
 * and returns the newly appended face IDs.
 */
export function appendSubMesh(
  target: PolyMeshData,
  sub: PolyMeshData,
  offsetPx: Vec3 = [0, 0, 0],
  autoWeld = true
): string[] {
  const vertMap: number[] = sub.vertices.map((v) => {
    const shifted = cleanVec3(
      v[0] + offsetPx[0],
      v[1] + offsetPx[1],
      v[2] + offsetPx[2]
    );
    if (autoWeld) {
      return addOrWeldVertex(target, shifted);
    }
    target.vertices.push(shifted);
    return target.vertices.length - 1;
  });

  const addedFaceIds: string[] = [];
  for (const face of sub.faces) {
    const cloned = clonePolyFace(face);
    cloned.id = allocateFaceId(target, "sub-face");
    cloned.verts = face.verts.map((vi) => vertMap[vi] ?? 0);
    target.faces.push(cloned);
    addedFaceIds.push(cloned.id);
  }
  return addedFaceIds;
}

/**
 * Extracts selected faces and their referenced vertices from `mesh`, normalized so the
 * prefab's minimum bounds lie at `[0, 0, 0]`, into a reusable `TilePrefab3D`.
 */
export function capturePrefabFromFaces(
  mesh: PolyMeshData,
  faceIds: ReadonlyArray<string>,
  name: string
): TilePrefab3D | null {
  const wanted = new Set(faceIds);
  const selectedFaces = mesh.faces.filter((f) => wanted.has(f.id));
  if (selectedFaces.length === 0) return null;

  const vertRemap = new Map<number, number>();
  const rawVerts: Vec3[] = [];
  for (const face of selectedFaces) {
    for (const vi of face.verts) {
      if (!vertRemap.has(vi)) {
        const v = mesh.vertices[vi];
        if (!v) continue;
        vertRemap.set(vi, rawVerts.length);
        rawVerts.push([v[0], v[1], v[2]]);
      }
    }
  }
  if (rawVerts.length === 0) return null;

  let minX = Infinity;
  let minY = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let maxZ = -Infinity;
  for (const [x, y, z] of rawVerts) {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (z < minZ) minZ = z;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
    if (z > maxZ) maxZ = z;
  }

  const normalizedVerts: Vec3[] = rawVerts.map(([x, y, z]) =>
    cleanVec3(x - minX, y - minY, z - minZ)
  );
  const clonedFaces: PolyFace[] = selectedFaces.map((face) => {
    const cloned = clonePolyFace(face);
    cloned.verts = face.verts.map((vi) => vertRemap.get(vi) ?? 0);
    return cloned;
  });

  const cleanName = name.trim() || "Prefab";
  const slug = cleanName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "tile";

  return {
    id: `prefab-${slug}-${Date.now().toString(36)}`,
    name: cleanName,
    mesh: {
      vertices: normalizedVerts,
      faces: clonedFaces,
    },
    sizePx: cleanVec3(maxX - minX, maxY - minY, maxZ - minZ),
  };
}

function rotatePointY(v: Vec3, rotationYDeg: 0 | 90 | 180 | 270): Vec3 {
  const [x, y, z] = v;
  switch (rotationYDeg) {
    case 0:
      return cleanVec3(x, y, z);
    case 90:
      // Right-handed +90° Y rotation: +X -> -Z, +Z -> +X
      return cleanVec3(z, y, -x);
    case 180:
      return cleanVec3(-x, y, -z);
    case 270:
      return cleanVec3(-z, y, x);
  }
}

/**
 * Stamps a `TilePrefab3D` onto `target` at `positionPx`, rotated around Y by
 * `rotationYDeg` (`0 | 90 | 180 | 270`), returning the newly created face IDs.
 */
export function stampPrefabOntoMesh(
  target: PolyMeshData,
  prefab: TilePrefab3D,
  positionPx: Vec3,
  rotationYDeg: 0 | 90 | 180 | 270 = 0,
  autoWeld = true
): string[] {
  const cloned = clonePolyMeshData(prefab.mesh);
  cloned.vertices = cloned.vertices.map((v) => rotatePointY(v, rotationYDeg));
  return appendSubMesh(target, cloned, positionPx, autoWeld);
}

/**
 * Sets per-corner vertex color on `faceId` (`cornerIndex` for one corner, or all corners
 * when `cornerIndex` is omitted).
 */
export function paintFaceCornerColors(
  mesh: PolyMeshData,
  faceId: string,
  colorHex: string,
  cornerIndex?: number
): boolean {
  const face = mesh.faces.find((f) => f.id === faceId);
  if (!face) return false;
  const count = face.verts.length;
  if (count === 0) return false;

  if (cornerIndex !== undefined) {
    if (!Number.isInteger(cornerIndex) || cornerIndex < 0 || cornerIndex >= count) {
      return false;
    }
    const existing = face.colors;
    const nextColors = Array.from({ length: count }, (_, i) =>
      existing && existing[i] ? existing[i] : "#ffffff"
    );
    nextColors[cornerIndex] = colorHex;
    face.colors = nextColors;
    return true;
  }

  face.colors = Array.from({ length: count }, () => colorHex);
  return true;
}

/**
 * Applies automatic floor-contact ambient occlusion vertex colors across `mesh`:
 * corners at `y <= floorY + 0.01` receive `shadowHex`, while upper corners receive `baseHex`.
 * Returns the number of faces whose `colors` were updated.
 */
export function applyFloorContactAo(
  mesh: PolyMeshData,
  floorY = 0,
  shadowHex = "#7a7a88",
  baseHex = "#ffffff"
): number {
  let updated = 0;
  const threshold = floorY + 0.01;

  for (const face of mesh.faces) {
    const count = face.verts.length;
    if (count === 0) continue;

    const nextColors = face.verts.map((vi) => {
      const v = mesh.vertices[vi];
      return v && v[1] <= threshold ? shadowHex : baseHex;
    });

    const prev = face.colors;
    const changed =
      !prev ||
      prev.length !== nextColors.length ||
      nextColors.some((c, i) => prev[i] !== c);

    face.colors = nextColors;
    if (changed) {
      updated += 1;
    }
  }

  return updated;
}

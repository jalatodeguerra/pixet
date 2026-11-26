import * as THREE from "three";
import { DEFAULT_MODEL3D_MATERIAL_ID, type Model3DEngine } from "../../../engine/model3d/Model3DEngine";
import type { EvaluatedNodePose } from "../../../engine/model3d/animEval";
import {
  buildPaddedTilesetAtlas,
  getTileQuadPixelUvs,
  type PaddedTilesetAtlas,
} from "../../../engine/model3d/tilesetAtlas";
import type {
  CuboidData,
  CuboidFaceName,
  CuboidFaceUV,
  ModelNode,
  PolyFace,
  PolyMeshData,
  Vec2,
  Vec3,
} from "../../../engine/model3d/types";
import type { Tileset } from "../../../engine/tiles/Tileset";
import type { MaterialTextureInfo } from "./retroMaterials";

const DEG_TO_RAD = Math.PI / 180;
const UV_MICRO_INSET = 1e-4;

export interface MeshLookupUserData {
  nodeId: string;
  triToFaceIndex: Uint32Array;
  faceIds: string[];
}

export interface SyncedSceneResult {
  rootGroup: THREE.Group;
  nodeObjectById: Map<string, THREE.Object3D>;
  pickableMeshes: THREE.Mesh[];
  triangleCount: number;
  nodeCount: number;
}

export interface SyncSceneOptions {
  wireframeOverlay: boolean;
  materialById: Map<string, THREE.Material>;
  textureSizeByMaterialId: Map<string, MaterialTextureInfo>;
  defaultTextureWidth: number;
  defaultTextureHeight: number;
  poses?: ReadonlyMap<string, EvaluatedNodePose>;
  tileElapsedMs?: number;
  tilesets?: ReadonlyArray<Tileset>;
  activeTileset?: Tileset;
}

interface BuiltGeometryResult {
  geometry: THREE.BufferGeometry;
  materialGroups: Array<{ start: number; count: number; materialIndex: number }>;
  materialIds: string[];
  triToFaceIndex: Uint32Array;
  faceIds: string[];
  triangleCount: number;
}

function parseColorRgb(colorStr: string | undefined): [number, number, number] {
  if (!colorStr) return [1, 1, 1];
  const s = colorStr.trim();
  if (s.startsWith("#")) {
    const hex = s.slice(1);
    if (hex.length === 3) {
      const r = parseInt(hex[0] + hex[0], 16);
      const g = parseInt(hex[1] + hex[1], 16);
      const b = parseInt(hex[2] + hex[2], 16);
      if (!Number.isNaN(r) && !Number.isNaN(g) && !Number.isNaN(b)) {
        return [r / 255, g / 255, b / 255];
      }
    } else if (hex.length >= 6) {
      const r = parseInt(hex.slice(0, 2), 16);
      const g = parseInt(hex.slice(2, 4), 16);
      const b = parseInt(hex.slice(4, 6), 16);
      if (!Number.isNaN(r) && !Number.isNaN(g) && !Number.isNaN(b)) {
        return [r / 255, g / 255, b / 255];
      }
    }
  } else if (s.startsWith("rgb")) {
    const match = s.match(/rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)/i);
    if (match) {
      return [
        Math.max(0, Math.min(1, Number(match[1]) / 255)),
        Math.max(0, Math.min(1, Number(match[2]) / 255)),
        Math.max(0, Math.min(1, Number(match[3]) / 255)),
      ];
    }
  }
  return [1, 1, 1];
}

function computeNormalizedUvWithInset(
  pxUvs: readonly Vec2[],
  texW: number,
  texH: number
): Vec2[] {
  const safeW = Math.max(1, texW);
  const safeH = Math.max(1, texH);
  const norm: Vec2[] = pxUvs.map(([u, v]) => [u / safeW, 1 - v / safeH]);
  if (norm.length === 0) return norm;

  let cx = 0;
  let cy = 0;
  for (const [u, v] of norm) {
    cx += u;
    cy += v;
  }
  cx /= norm.length;
  cy /= norm.length;

  return norm.map(([u, v]) => {
    const du = cx - u;
    const dv = cy - v;
    const len = Math.hypot(du, dv);
    if (len <= 1e-9) return [u, v];
    const step = Math.min(UV_MICRO_INSET, len * 0.25);
    return [u + (du / len) * step, v + (dv / len) * step];
  });
}

function computeCuboidFaceCornerUvs(face: CuboidFaceUV): [Vec2, Vec2, Vec2, Vec2] {
  const [u0, v0, u1, v1] = face.uv;
  let corners: [Vec2, Vec2, Vec2, Vec2] = [
    [u0, v0], // top-left
    [u1, v0], // top-right
    [u1, v1], // bottom-right
    [u0, v1], // bottom-left
  ];

  if (face.flipX) {
    corners = [corners[1], corners[0], corners[3], corners[2]];
  }
  if (face.flipY) {
    corners = [corners[3], corners[2], corners[1], corners[0]];
  }

  const steps = ((face.rotation / 90) % 4 + 4) % 4;
  for (let i = 0; i < steps; i++) {
    corners = [corners[3], corners[0], corners[1], corners[2]];
  }
  return corners;
}

function computeQuadNormal(
  a: Vec3,
  b: Vec3,
  c: Vec3
): [number, number, number] {
  const abx = b[0] - a[0];
  const aby = b[1] - a[1];
  const abz = b[2] - a[2];
  const acx = c[0] - a[0];
  const acy = c[1] - a[1];
  const acz = c[2] - a[2];
  const nx = aby * acz - abz * acy;
  const ny = abz * acx - abx * acz;
  const nz = abx * acy - aby * acx;
  const len = Math.hypot(nx, ny, nz);
  if (len <= 1e-12) return [0, 1, 0];
  return [nx / len, ny / len, nz / len];
}

function distSq3(a: Vec3, b: Vec3): number {
  const dx = a[0] - b[0];
  const dy = a[1] - b[1];
  const dz = a[2] - b[2];
  return dx * dx + dy * dy + dz * dz;
}

interface RawFaceEmit {
  faceId: string;
  materialId: string;
  tris: Array<{
    pos: [Vec3, Vec3, Vec3];
    uv: [Vec2, Vec2, Vec2];
    col: [[number, number, number], [number, number, number], [number, number, number]];
    norm: [number, number, number];
  }>;
}

function resolveMaterialTexSize(
  materialId: string,
  opts: SyncSceneOptions
): MaterialTextureInfo {
  return (
    opts.textureSizeByMaterialId.get(materialId) ?? {
      width: opts.defaultTextureWidth,
      height: opts.defaultTextureHeight,
    }
  );
}

function buildCuboidGeometry(
  cuboid: CuboidData,
  pivot: Vec3,
  ppu: number,
  opts: SyncSceneOptions
): BuiltGeometryResult {
  const minX = Math.min(cuboid.from[0], cuboid.to[0]) - cuboid.inflate;
  const minY = Math.min(cuboid.from[1], cuboid.to[1]) - cuboid.inflate;
  const minZ = Math.min(cuboid.from[2], cuboid.to[2]) - cuboid.inflate;
  const maxX = Math.max(cuboid.from[0], cuboid.to[0]) + cuboid.inflate;
  const maxY = Math.max(cuboid.from[1], cuboid.to[1]) + cuboid.inflate;
  const maxZ = Math.max(cuboid.from[2], cuboid.to[2]) + cuboid.inflate;

  const toLocal = (x: number, y: number, z: number): Vec3 => [
    (x - pivot[0]) / ppu,
    (y - pivot[1]) / ppu,
    (z - pivot[2]) / ppu,
  ];

  // CCW outer-facing quad corners: [top-left, top-right, bottom-right, bottom-left]
  // Matching standard UV orientation: (u0,v0) top-left -> (u1,v1) bottom-right
  const faceSpecs: Array<{
    name: CuboidFaceName;
    corners: [Vec3, Vec3, Vec3, Vec3];
    normal: [number, number, number];
  }> = [
    {
      // -Z (North, looking from -Z toward origin: left is +X, right is -X)
      name: "north",
      corners: [
        toLocal(maxX, maxY, minZ),
        toLocal(minX, maxY, minZ),
        toLocal(minX, minY, minZ),
        toLocal(maxX, minY, minZ),
      ],
      normal: [0, 0, -1],
    },
    {
      // +Z (South, front face looking from +Z toward origin: left is -X, right is +X)
      name: "south",
      corners: [
        toLocal(minX, maxY, maxZ),
        toLocal(maxX, maxY, maxZ),
        toLocal(maxX, minY, maxZ),
        toLocal(minX, minY, maxZ),
      ],
      normal: [0, 0, 1],
    },
    {
      // +X (East, looking from +X toward origin: left is +Z, right is -Z)
      name: "east",
      corners: [
        toLocal(maxX, maxY, maxZ),
        toLocal(maxX, maxY, minZ),
        toLocal(maxX, minY, minZ),
        toLocal(maxX, minY, maxZ),
      ],
      normal: [1, 0, 0],
    },
    {
      // -X (West, looking from -X toward origin: left is -Z, right is +Z)
      name: "west",
      corners: [
        toLocal(minX, maxY, minZ),
        toLocal(minX, maxY, maxZ),
        toLocal(minX, minY, maxZ),
        toLocal(minX, minY, minZ),
      ],
      normal: [-1, 0, 0],
    },
    {
      // +Y (Up, looking down from +Y: top is -Z, bottom is +Z)
      name: "up",
      corners: [
        toLocal(minX, maxY, minZ),
        toLocal(maxX, maxY, minZ),
        toLocal(maxX, maxY, maxZ),
        toLocal(minX, maxY, maxZ),
      ],
      normal: [0, 1, 0],
    },
    {
      // -Y (Down, looking up from -Y: top is +Z, bottom is -Z)
      name: "down",
      corners: [
        toLocal(minX, minY, maxZ),
        toLocal(maxX, minY, maxZ),
        toLocal(maxX, minY, minZ),
        toLocal(minX, minY, minZ),
      ],
      normal: [0, -1, 0],
    },
  ];

  const emits: RawFaceEmit[] = [];
  for (const spec of faceSpecs) {
    const faceData = cuboid.faces[spec.name];
    if (!faceData || faceData.hidden) continue;

    const matId = faceData.materialId || DEFAULT_MODEL3D_MATERIAL_ID;
    const texSize = resolveMaterialTexSize(matId, opts);
    const pxCorners = computeCuboidFaceCornerUvs(faceData);
    const normUvs = computeNormalizedUvWithInset(
      pxCorners,
      texSize.width,
      texSize.height
    );
    const c: [number, number, number] = [1, 1, 1];
    const [p0, p1, p2, p3] = spec.corners;
    const [u0, u1, u2, u3] = normUvs;

    emits.push({
      faceId: spec.name,
      materialId: matId,
      tris: [
        {
          pos: [p0, p2, p1],
          uv: [u0, u2, u1],
          col: [c, c, c],
          norm: spec.normal,
        },
        {
          pos: [p0, p3, p2],
          uv: [u0, u3, u2],
          col: [c, c, c],
          norm: spec.normal,
        },
      ],
    });
  }

  return assembleGeometry(emits);
}

function buildPolyMeshGeometry(
  mesh: PolyMeshData,
  pivot: Vec3,
  ppu: number,
  opts: SyncSceneOptions,
  atlasByTilesetId?: Map<string, { tileset: Tileset; atlas: PaddedTilesetAtlas }>
): BuiltGeometryResult {
  const localVerts: Vec3[] = mesh.vertices.map((v) => [
    (v[0] - pivot[0]) / ppu,
    (v[1] - pivot[1]) / ppu,
    (v[2] - pivot[2]) / ppu,
  ]);

  const emits: RawFaceEmit[] = [];

  for (const face of mesh.faces) {
    if (face.verts.length < 3) continue;
    const matId = face.materialId || DEFAULT_MODEL3D_MATERIAL_ID;
    const texSize = resolveMaterialTexSize(matId, opts);
    let sourceUvs: readonly Vec2[] = face.uvs;
    if (
      face.tileSource &&
      opts.tileElapsedMs !== undefined &&
      atlasByTilesetId &&
      face.verts.length === 4
    ) {
      const entry = atlasByTilesetId.get(face.tileSource.tilesetId);
      if (entry) {
        const meta = entry.tileset.getMeta(face.tileSource.cachedTileId);
        const byUidMeta = face.tileSource.tileUid
          ? entry.atlas.byUid.get(face.tileSource.tileUid)
          : undefined;
        const baseMeta = byUidMeta
          ? entry.tileset.getMeta(byUidMeta.tileId)
          : meta;
        if (baseMeta?.animation?.frames && baseMeta.animation.frames.length > 0) {
          sourceUvs = getTileQuadPixelUvs(
            entry.atlas,
            entry.tileset,
            face.tileSource.tileUid,
            face.tileSource.cachedTileId,
            face.tileSource.rotation,
            face.tileSource.flipX,
            face.tileSource.flipY,
            opts.tileElapsedMs
          );
        }
      }
    }
    const normUvs = computeNormalizedUvWithInset(
      sourceUvs,
      texSize.width,
      texSize.height
    );

    const getVert = (cornerIdx: number): Vec3 => {
      const vIdx = face.verts[cornerIdx];
      return localVerts[vIdx] ?? [0, 0, 0];
    };
    const getUv = (cornerIdx: number): Vec2 => {
      return normUvs[cornerIdx] ?? [0, 0];
    };
    const getCol = (cornerIdx: number): [number, number, number] => {
      return parseColorRgb(face.colors?.[cornerIdx]);
    };

    if (face.verts.length === 3) {
      const p0 = getVert(0);
      const p1 = getVert(1);
      const p2 = getVert(2);
      const norm = computeQuadNormal(p0, p1, p2);
      emits.push({
        faceId: face.id,
        materialId: matId,
        tris: [
          {
            pos: [p0, p1, p2],
            uv: [getUv(0), getUv(1), getUv(2)],
            col: [getCol(0), getCol(1), getCol(2)],
            norm,
          },
        ],
      });
    } else {
      const p0 = getVert(0);
      const p1 = getVert(1);
      const p2 = getVert(2);
      const p3 = getVert(3);

      let split: "02" | "13";
      if (face.triSplit === "02" || face.triSplit === "13") {
        split = face.triSplit;
      } else {
        split = distSq3(p0, p2) <= distSq3(p1, p3) ? "02" : "13";
      }

      if (split === "02") {
        const n1 = computeQuadNormal(p0, p1, p2);
        const n2 = computeQuadNormal(p0, p2, p3);
        emits.push({
          faceId: face.id,
          materialId: matId,
          tris: [
            {
              pos: [p0, p1, p2],
              uv: [getUv(0), getUv(1), getUv(2)],
              col: [getCol(0), getCol(1), getCol(2)],
              norm: n1,
            },
            {
              pos: [p0, p2, p3],
              uv: [getUv(0), getUv(2), getUv(3)],
              col: [getCol(0), getCol(2), getCol(3)],
              norm: n2,
            },
          ],
        });
      } else {
        const n1 = computeQuadNormal(p0, p1, p3);
        const n2 = computeQuadNormal(p1, p2, p3);
        emits.push({
          faceId: face.id,
          materialId: matId,
          tris: [
            {
              pos: [p0, p1, p3],
              uv: [getUv(0), getUv(1), getUv(3)],
              col: [getCol(0), getCol(1), getCol(3)],
              norm: n1,
            },
            {
              pos: [p1, p2, p3],
              uv: [getUv(1), getUv(2), getUv(3)],
              col: [getCol(1), getCol(2), getCol(3)],
              norm: n2,
            },
          ],
        });
      }
    }
  }

  return assembleGeometry(emits);
}

function assembleGeometry(emits: RawFaceEmit[]): BuiltGeometryResult {
  // Group faces by materialId so multi-material meshes preserve materialIndex groups cleanly
  const materialOrder: string[] = [];
  const byMat = new Map<string, Array<{ faceIndex: number; emit: RawFaceEmit }>>();
  const faceIds: string[] = [];

  for (let fi = 0; fi < emits.length; fi++) {
    const emit = emits[fi];
    faceIds.push(emit.faceId);
    let bucket = byMat.get(emit.materialId);
    if (!bucket) {
      bucket = [];
      byMat.set(emit.materialId, bucket);
      materialOrder.push(emit.materialId);
    }
    bucket.push({ faceIndex: fi, emit });
  }

  let totalTris = 0;
  for (const emit of emits) {
    totalTris += emit.tris.length;
  }

  const vertCount = totalTris * 3;
  const positions = new Float32Array(vertCount * 3);
  const normals = new Float32Array(vertCount * 3);
  const uvs = new Float32Array(vertCount * 2);
  const colors = new Float32Array(vertCount * 3);
  const triToFaceIndex = new Uint32Array(totalTris);
  const materialGroups: Array<{
    start: number;
    count: number;
    materialIndex: number;
  }> = [];

  let vCursor = 0;
  let triCursor = 0;

  for (let matIdx = 0; matIdx < materialOrder.length; matIdx++) {
    const matId = materialOrder[matIdx];
    const bucket = byMat.get(matId)!;
    const groupStart = vCursor;

    for (const item of bucket) {
      for (const tri of item.emit.tris) {
        triToFaceIndex[triCursor++] = item.faceIndex;
        for (let k = 0; k < 3; k++) {
          const p = tri.pos[k];
          const uv = tri.uv[k];
          const col = tri.col[k];
          const pOff = vCursor * 3;
          const uOff = vCursor * 2;
          positions[pOff] = p[0];
          positions[pOff + 1] = p[1];
          positions[pOff + 2] = p[2];
          normals[pOff] = tri.norm[0];
          normals[pOff + 1] = tri.norm[1];
          normals[pOff + 2] = tri.norm[2];
          colors[pOff] = col[0];
          colors[pOff + 1] = col[1];
          colors[pOff + 2] = col[2];
          uvs[uOff] = uv[0];
          uvs[uOff + 1] = uv[1];
          vCursor++;
        }
      }
    }

    const groupCount = vCursor - groupStart;
    if (groupCount > 0) {
      materialGroups.push({
        start: groupStart,
        count: groupCount,
        materialIndex: matIdx,
      });
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("normal", new THREE.BufferAttribute(normals, 3));
  geometry.setAttribute("uv", new THREE.BufferAttribute(uvs, 2));
  geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  geometry.clearGroups();
  for (const g of materialGroups) {
    geometry.addGroup(g.start, g.count, g.materialIndex);
  }
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();

  return {
    geometry,
    materialGroups,
    materialIds: materialOrder,
    triToFaceIndex,
    faceIds,
    triangleCount: totalTris,
  };
}

function createPivotMarker(): THREE.Group {
  const marker = new THREE.Group();
  marker.name = "__m3d_pivot_marker__";
  const arm = 0.14;
  const pts = [
    new THREE.Vector3(-arm, 0, 0),
    new THREE.Vector3(arm, 0, 0),
    new THREE.Vector3(0, -arm, 0),
    new THREE.Vector3(0, arm, 0),
    new THREE.Vector3(0, 0, -arm),
    new THREE.Vector3(0, 0, arm),
  ];
  const lineGeo = new THREE.BufferGeometry().setFromPoints(pts);
  const lineMat = new THREE.LineBasicMaterial({
    color: 0xf5b041,
    depthTest: false,
    transparent: true,
    opacity: 0.95,
  });
  const cross = new THREE.LineSegments(lineGeo, lineMat);
  cross.renderOrder = 10;
  marker.add(cross);

  const dotGeo = new THREE.BoxGeometry(0.055, 0.055, 0.055);
  const dotMat = new THREE.MeshBasicMaterial({
    color: 0xffffff,
    depthTest: false,
  });
  const dot = new THREE.Mesh(dotGeo, dotMat);
  dot.renderOrder = 11;
  marker.add(dot);
  return marker;
}

export function disposeSyncedObjectTree(root: THREE.Object3D): void {
  root.traverse((obj) => {
    if (obj instanceof THREE.Mesh || obj instanceof THREE.LineSegments) {
      obj.geometry?.dispose();
      if (obj.userData?.isOverlayHelper) {
        if (Array.isArray(obj.material)) {
          for (const m of obj.material) m.dispose();
        } else if (obj.material) {
          obj.material.dispose();
        }
      }
    }
  });
}

export function syncModel3DScene(
  engine: Model3DEngine,
  opts: SyncSceneOptions
): SyncedSceneResult {
  const rootGroup = new THREE.Group();
  rootGroup.name = "__m3d_scene_root__";

  const ppu = Math.max(1, engine.pixelsPerUnit);
  const nodeById = new Map<string, ModelNode>();
  for (const n of engine.nodes) {
    nodeById.set(n.id, n);
  }

  const selectedSet = new Set(engine.selectedNodeIds);
  const nodeObjectById = new Map<string, THREE.Object3D>();
  const pickableMeshes: THREE.Mesh[] = [];
  let triangleCount = 0;

  const fallbackMaterial =
    opts.materialById.values().next().value ??
    new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });

  const atlasByTilesetId =
    opts.tileElapsedMs !== undefined && (opts.tilesets || opts.activeTileset)
      ? new Map<string, { tileset: Tileset; atlas: PaddedTilesetAtlas }>()
      : undefined;
  if (atlasByTilesetId) {
    if (opts.activeTileset) {
      atlasByTilesetId.set(opts.activeTileset.id, {
        tileset: opts.activeTileset,
        atlas: buildPaddedTilesetAtlas(opts.activeTileset),
      });
    }
    if (opts.tilesets) {
      for (const ts of opts.tilesets) {
        if (!atlasByTilesetId.has(ts.id)) {
          atlasByTilesetId.set(ts.id, {
            tileset: ts,
            atlas: buildPaddedTilesetAtlas(ts),
          });
        }
      }
    }
  }

  // Create Three.js Object3D for every node
  for (const node of engine.nodes) {
    let obj: THREE.Object3D;
    let built: BuiltGeometryResult | null = null;

    if (node.kind === "cuboid" && node.cuboid) {
      built = buildCuboidGeometry(node.cuboid, node.transform.pivot, ppu, opts);
    } else if (node.kind === "mesh" && node.mesh) {
      built = buildPolyMeshGeometry(
        node.mesh,
        node.transform.pivot,
        ppu,
        opts,
        atlasByTilesetId
      );
    }

    if (built && built.triangleCount > 0) {
      const resolvedMats = built.materialIds.map(
        (id) => opts.materialById.get(id) ?? fallbackMaterial
      );
      const meshMat: THREE.Material | THREE.Material[] =
        resolvedMats.length === 1 ? resolvedMats[0] : resolvedMats;

      const mesh = new THREE.Mesh(built.geometry, meshMat);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      const userData: MeshLookupUserData = {
        nodeId: node.id,
        triToFaceIndex: built.triToFaceIndex,
        faceIds: built.faceIds,
      };
      mesh.userData = userData;
      triangleCount += built.triangleCount;

      if (selectedSet.has(node.id)) {
        const edgesGeo = new THREE.EdgesGeometry(built.geometry, 1);
        const edgesMat = new THREE.LineBasicMaterial({
          color: node.id === engine.activeNodeId ? 0x4c8bf5 : 0x7aa7f7,
          depthTest: true,
        });
        const edges = new THREE.LineSegments(edgesGeo, edgesMat);
        edges.userData = { isOverlayHelper: true };
        edges.renderOrder = 2;
        mesh.add(edges);
      } else if (opts.wireframeOverlay) {
        const edgesGeo = new THREE.EdgesGeometry(built.geometry, 1);
        const edgesMat = new THREE.LineBasicMaterial({
          color: 0x3b4454,
          transparent: true,
          opacity: 0.7,
        });
        const edges = new THREE.LineSegments(edgesGeo, edgesMat);
        edges.userData = { isOverlayHelper: true };
        edges.renderOrder = 1;
        mesh.add(edges);
      }

      if (node.visible) {
        pickableMeshes.push(mesh);
      }
      obj = mesh;
    } else {
      if (built) {
        built.geometry.dispose();
      }
      obj = new THREE.Group();
    }

    obj.name = node.name;
    obj.visible = node.visible;
    obj.userData = { ...obj.userData, nodeId: node.id };

    if (node.id === engine.activeNodeId && node.visible) {
      const pivotMarker = createPivotMarker();
      pivotMarker.traverse((c) => {
        c.userData = { isOverlayHelper: true };
      });
      obj.add(pivotMarker);
    }

    nodeObjectById.set(node.id, obj);
  }

  // Wire parent-child hierarchy with pivot-relative transforms
  for (const node of engine.nodes) {
    const obj = nodeObjectById.get(node.id);
    if (!obj) continue;

    const parentNode = node.parentId ? nodeById.get(node.parentId) : undefined;
    const parentObj = parentNode ? nodeObjectById.get(parentNode.id) : undefined;
    const pose = opts.poses?.get(node.id);
    const parentPose = parentNode ? opts.poses?.get(parentNode.id) : undefined;
    const nodePivot: Vec3 = pose ? pose.pivot : node.transform.pivot;
    const parentPivot: Vec3 = parentPose
      ? parentPose.pivot
      : parentNode
        ? parentNode.transform.pivot
        : [0, 0, 0];
    const localPos: Vec3 = pose ? pose.position : node.transform.position;
    const localScale: Vec3 = pose ? pose.scale : node.transform.scale;

    obj.position.set(
      (nodePivot[0] - parentPivot[0] + localPos[0]) / ppu,
      (nodePivot[1] - parentPivot[1] + localPos[1]) / ppu,
      (nodePivot[2] - parentPivot[2] + localPos[2]) / ppu
    );
    if (pose) {
      obj.quaternion.set(
        pose.quaternion[0],
        pose.quaternion[1],
        pose.quaternion[2],
        pose.quaternion[3]
      );
    } else {
      obj.rotation.set(
        node.transform.rotation[0] * DEG_TO_RAD,
        node.transform.rotation[1] * DEG_TO_RAD,
        node.transform.rotation[2] * DEG_TO_RAD,
        "XYZ"
      );
    }
    obj.scale.set(localScale[0], localScale[1], localScale[2]);

    if (parentObj) {
      parentObj.add(obj);
    } else {
      rootGroup.add(obj);
    }
  }

  rootGroup.updateMatrixWorld(true);

  return {
    rootGroup,
    nodeObjectById,
    pickableMeshes,
    triangleCount,
    nodeCount: engine.nodes.length,
  };
}

/**
 * Rebuilds a mesh node's BufferGeometry (and any wireframe LineSegments child) in place
 * so sub-element gizmo drags deform the mesh at 60fps without detaching TransformControls.
 */
export function updateMeshNodeGeometryInPlace(
  nodeObj: THREE.Object3D,
  node: ModelNode,
  ppu: number,
  opts: {
    textureSizeByMaterialId: Map<string, MaterialTextureInfo>;
    defaultTextureWidth: number;
    defaultTextureHeight: number;
  }
): void {
  if (!(nodeObj instanceof THREE.Mesh) || node.kind !== "mesh" || !node.mesh) return;
  const syncOpts: SyncSceneOptions = {
    materialById: new Map(),
    textureSizeByMaterialId: opts.textureSizeByMaterialId,
    defaultTextureWidth: opts.defaultTextureWidth,
    defaultTextureHeight: opts.defaultTextureHeight,
    wireframeOverlay: false,
  };
  const built = buildPolyMeshGeometry(
    node.mesh,
    node.transform.pivot,
    Math.max(1, ppu),
    syncOpts
  );
  if (built.triangleCount <= 0) {
    built.geometry.dispose();
    return;
  }
  const oldGeo = nodeObj.geometry;
  nodeObj.geometry = built.geometry;
  oldGeo?.dispose();

  const ud = nodeObj.userData as MeshLookupUserData;
  ud.triToFaceIndex = built.triToFaceIndex;
  ud.faceIds = built.faceIds;

  for (const child of nodeObj.children) {
    if (child instanceof THREE.LineSegments && child.userData?.isOverlayHelper) {
      const oldEdges = child.geometry;
      child.geometry = new THREE.EdgesGeometry(built.geometry, 1);
      oldEdges?.dispose();
    }
  }
}

/**
 * Converts a Three.js Object3D local transform back into ModelNode.transform
 * position/rotation/scale (in pixel units relative to parent pivot).
 */
export function objectTransformToNodeTransform(
  obj: THREE.Object3D,
  node: ModelNode,
  parentNode: ModelNode | undefined,
  ppu: number
): {
  position: Vec3;
  rotation: Vec3;
  scale: Vec3;
} {
  const parentPivot: Vec3 = parentNode ? parentNode.transform.pivot : [0, 0, 0];
  const RAD_TO_DEG = 180 / Math.PI;
  const euler = new THREE.Euler().setFromQuaternion(obj.quaternion, "XYZ");
  const round3 = (n: number) => Math.round(n * 1000) / 1000;

  return {
    position: [
      round3(obj.position.x * ppu - (node.transform.pivot[0] - parentPivot[0])),
      round3(obj.position.y * ppu - (node.transform.pivot[1] - parentPivot[1])),
      round3(obj.position.z * ppu - (node.transform.pivot[2] - parentPivot[2])),
    ],
    rotation: [
      round3(euler.x * RAD_TO_DEG),
      round3(euler.y * RAD_TO_DEG),
      round3(euler.z * RAD_TO_DEG),
    ],
    scale: [
      round3(obj.scale.x),
      round3(obj.scale.y),
      round3(obj.scale.z),
    ],
  };
}

function buildNodeWorldMatrices(
  engine: Model3DEngine
): Map<string, THREE.Matrix4> {
  const ppu = Math.max(1, engine.pixelsPerUnit);
  const byId = new Map<string, ModelNode>();
  for (const n of engine.nodes) byId.set(n.id, n);

  const localById = new Map<string, THREE.Matrix4>();
  for (const n of engine.nodes) {
    const parentNode = n.parentId ? byId.get(n.parentId) : undefined;
    const parentPivot: Vec3 = parentNode ? parentNode.transform.pivot : [0, 0, 0];
    const pos = new THREE.Vector3(
      (n.transform.pivot[0] - parentPivot[0] + n.transform.position[0]) / ppu,
      (n.transform.pivot[1] - parentPivot[1] + n.transform.position[1]) / ppu,
      (n.transform.pivot[2] - parentPivot[2] + n.transform.position[2]) / ppu
    );
    const quat = new THREE.Quaternion().setFromEuler(
      new THREE.Euler(
        n.transform.rotation[0] * DEG_TO_RAD,
        n.transform.rotation[1] * DEG_TO_RAD,
        n.transform.rotation[2] * DEG_TO_RAD,
        "XYZ"
      )
    );
    const scale = new THREE.Vector3(
      n.transform.scale[0],
      n.transform.scale[1],
      n.transform.scale[2]
    );
    localById.set(n.id, new THREE.Matrix4().compose(pos, quat, scale));
  }

  const worldById = new Map<string, THREE.Matrix4>();
  const resolveWorld = (id: string, visiting: Set<string>): THREE.Matrix4 => {
    const cached = worldById.get(id);
    if (cached) return cached;
    const node = byId.get(id);
    const local = localById.get(id);
    if (!node || !local) return new THREE.Matrix4();
    if (!node.parentId || visiting.has(id)) {
      const m = local.clone();
      worldById.set(id, m);
      return m;
    }
    visiting.add(id);
    const parentWorld = resolveWorld(node.parentId, visiting);
    const world = new THREE.Matrix4().multiplyMatrices(parentWorld, local);
    worldById.set(id, world);
    return world;
  };

  for (const n of engine.nodes) {
    resolveWorld(n.id, new Set());
  }
  return worldById;
}

/**
 * Collects world-space vertex positions (in Three.js meters/units) for all visible
 * nodes not in `excludeNodeIds`, used by `Hold V` magnetic vertex snapping.
 */
export function collectWorldSnapVertices(
  engine: Model3DEngine,
  excludeNodeIds: readonly string[] | Set<string>
): THREE.Vector3[] {
  const excluded =
    excludeNodeIds instanceof Set ? excludeNodeIds : new Set(excludeNodeIds);
  const ppu = Math.max(1, engine.pixelsPerUnit);
  const worldMatrices = buildNodeWorldMatrices(engine);
  const out: THREE.Vector3[] = [];

  for (const node of engine.nodes) {
    if (!node.visible || excluded.has(node.id)) continue;
    const worldMat = worldMatrices.get(node.id);
    if (!worldMat) continue;
    const pivot = node.transform.pivot;

    if (node.kind === "cuboid" && node.cuboid) {
      const c = node.cuboid;
      const minX = Math.min(c.from[0], c.to[0]) - c.inflate;
      const minY = Math.min(c.from[1], c.to[1]) - c.inflate;
      const minZ = Math.min(c.from[2], c.to[2]) - c.inflate;
      const maxX = Math.max(c.from[0], c.to[0]) + c.inflate;
      const maxY = Math.max(c.from[1], c.to[1]) + c.inflate;
      const maxZ = Math.max(c.from[2], c.to[2]) + c.inflate;
      const xs = [minX, maxX];
      const ys = [minY, maxY];
      const zs = [minZ, maxZ];
      for (const x of xs) {
        for (const y of ys) {
          for (const z of zs) {
            out.push(
              new THREE.Vector3(
                (x - pivot[0]) / ppu,
                (y - pivot[1]) / ppu,
                (z - pivot[2]) / ppu
              ).applyMatrix4(worldMat)
            );
          }
        }
      }
    } else if (node.kind === "mesh" && node.mesh) {
      for (const v of node.mesh.vertices) {
        out.push(
          new THREE.Vector3(
            (v[0] - pivot[0]) / ppu,
            (v[1] - pivot[1]) / ppu,
            (v[2] - pivot[2]) / ppu
          ).applyMatrix4(worldMat)
        );
      }
    } else if (node.kind === "group") {
      out.push(new THREE.Vector3(0, 0, 0).applyMatrix4(worldMat));
    }
  }

  return out;
}

/**
 * Helper to compute world-space positions of a node's vertices/edges/faces for
 * sub-object selection highlight rendering.
 */
export function collectSelectedSubObjectPositions(
  node: ModelNode,
  nodeObj: THREE.Object3D,
  ppu: number
): {
  vertices: THREE.Vector3[];
  facesById: Map<string, PolyFace>;
} {
  const vertices: THREE.Vector3[] = [];
  const facesById = new Map<string, PolyFace>();
  if (node.kind !== "mesh" || !node.mesh) {
    return { vertices, facesById };
  }
  nodeObj.updateMatrixWorld(true);
  const pivot = node.transform.pivot;
  for (const v of node.mesh.vertices) {
    vertices.push(
      new THREE.Vector3(
        (v[0] - pivot[0]) / ppu,
        (v[1] - pivot[1]) / ppu,
        (v[2] - pivot[2]) / ppu
      ).applyMatrix4(nodeObj.matrixWorld)
    );
  }
  for (const f of node.mesh.faces) {
    facesById.set(f.id, f);
  }
  return { vertices, facesById };
}

import {
  cloneAnimationClip,
  cloneModelMaterial,
  cloneModelNode,
  cloneTilePrefab3D,
  createDefaultCuboidData,
  createDefaultMaterial,
  createDefaultTileCursor,
  createDefaultTransform,
  DEFAULT_MODEL3D_MATERIAL_ID,
} from "./Model3DEngine.ts";
import { sanitizeModifiers } from "./modifierTypes.ts";
import type {
  ColliderKind,
  CuboidData,
  CuboidFaceName,
  CuboidFaceUV,
  Model3DSceneSnapshot,
  ModelAnimationClip,
  ModelKeyframe,
  ModelKeyframeEasing,
  ModelKeyframeProperty,
  ModelMaterial,
  ModelMaterialSource,
  ModelNode,
  PolyFace,
  PolyMeshData,
  SelectionGranularity,
  TileCursor3D,
  TileCursorPlane,
  TilePrefab3D,
  Vec2,
  Vec3,
} from "./types.ts";

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function asFiniteNumber(v: unknown, fallback: number): number {
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}

function asString(v: unknown, fallback: string): string {
  return typeof v === "string" ? v : fallback;
}

function asBoolean(v: unknown, fallback: boolean): boolean {
  return typeof v === "boolean" ? v : fallback;
}

function asVec2(v: unknown, fallback: Vec2): Vec2 {
  if (!Array.isArray(v) || v.length < 2) return [...fallback];
  return [
    asFiniteNumber(v[0], fallback[0]),
    asFiniteNumber(v[1], fallback[1]),
  ];
}

function asVec3(v: unknown, fallback: Vec3): Vec3 {
  if (!Array.isArray(v) || v.length < 3) return [...fallback];
  return [
    asFiniteNumber(v[0], fallback[0]),
    asFiniteNumber(v[1], fallback[1]),
    asFiniteNumber(v[2], fallback[2]),
  ];
}

function asRotation90(v: unknown): 0 | 90 | 180 | 270 {
  if (v === 90 || v === 180 || v === 270) return v;
  return 0;
}

function parseMaterialSource(raw: unknown): ModelMaterialSource {
  if (!isRecord(raw)) return { kind: "draw-canvas" };
  switch (raw.kind) {
    case "draw-canvas":
      return typeof raw.layerId === "string" && raw.layerId.length > 0
        ? { kind: "draw-canvas", layerId: raw.layerId }
        : { kind: "draw-canvas" };
    case "tileset":
      return {
        kind: "tileset",
        tilesetId: asString(raw.tilesetId, ""),
      };
    case "node-graph":
      return {
        kind: "node-graph",
        graphId: asString(raw.graphId, ""),
      };
    case "embedded":
      return {
        kind: "embedded",
        width: Math.max(1, Math.round(asFiniteNumber(raw.width, 16))),
        height: Math.max(1, Math.round(asFiniteNumber(raw.height, 16))),
        pngBase64: asString(raw.pngBase64, ""),
      };
    default:
      return { kind: "draw-canvas" };
  }
}

function parseMaterial(raw: unknown, idx: number): ModelMaterial | null {
  if (!isRecord(raw)) return null;
  const id = asString(raw.id, `mat-${idx + 1}`).trim() || `mat-${idx + 1}`;
  return {
    id,
    name: asString(raw.name, `Material ${idx + 1}`),
    source: parseMaterialSource(raw.source),
    doubleSided: asBoolean(raw.doubleSided, false),
    alphaTest: Math.max(0, Math.min(1, asFiniteNumber(raw.alphaTest, 0.5))),
    usePbrMaps: asBoolean(raw.usePbrMaps, true),
  };
}

function parseCuboidFaceUV(
  raw: unknown,
  fallback: CuboidFaceUV
): CuboidFaceUV {
  if (!isRecord(raw)) return { ...fallback, uv: [...fallback.uv] };
  const uvArr = Array.isArray(raw.uv) ? raw.uv : fallback.uv;
  return {
    uv: [
      asFiniteNumber(uvArr[0], fallback.uv[0]),
      asFiniteNumber(uvArr[1], fallback.uv[1]),
      asFiniteNumber(uvArr[2], fallback.uv[2]),
      asFiniteNumber(uvArr[3], fallback.uv[3]),
    ],
    rotation: asRotation90(raw.rotation),
    flipX: typeof raw.flipX === "boolean" ? raw.flipX : undefined,
    flipY: typeof raw.flipY === "boolean" ? raw.flipY : undefined,
    materialId: asString(raw.materialId, fallback.materialId),
    hidden: typeof raw.hidden === "boolean" ? raw.hidden : undefined,
  };
}

function parseCuboid(raw: unknown): CuboidData {
  if (!isRecord(raw)) return createDefaultCuboidData();
  const from = asVec3(raw.from, [-4, 0, -4]);
  const to = asVec3(raw.to, [4, 8, 4]);
  const base = createDefaultCuboidData(from, to);
  const rawFaces = isRecord(raw.faces) ? raw.faces : {};
  const faceNames: CuboidFaceName[] = [
    "north",
    "south",
    "east",
    "west",
    "up",
    "down",
  ];
  const faces = {} as Record<CuboidFaceName, CuboidFaceUV>;
  for (const name of faceNames) {
    faces[name] = parseCuboidFaceUV(rawFaces[name], base.faces[name]);
  }
  return {
    from,
    to,
    inflate: asFiniteNumber(raw.inflate, 0),
    uvMode: raw.uvMode === "per-face" ? "per-face" : "box",
    uvLock: asBoolean(raw.uvLock, false),
    mirrorUvX: typeof raw.mirrorUvX === "boolean" ? raw.mirrorUvX : undefined,
    boxUvOrigin: asVec2(raw.boxUvOrigin, [0, 0]),
    faces,
  };
}

function parsePolyFace(raw: unknown, idx: number, vertCount: number): PolyFace | null {
  if (!isRecord(raw) || !Array.isArray(raw.verts)) return null;
  const verts = raw.verts
    .map((v) => (typeof v === "number" && Number.isInteger(v) ? v : -1))
    .filter((v) => v >= 0 && v < vertCount);
  if (verts.length < 3) return null;
  const clampedVerts = verts.slice(0, 4);

  const rawUvs = Array.isArray(raw.uvs) ? raw.uvs : [];
  const uvs: Vec2[] = clampedVerts.map((_, i) => asVec2(rawUvs[i], [0, 0]));

  let colors: string[] | undefined;
  if (Array.isArray(raw.colors)) {
    const rawColors = raw.colors;
    colors = clampedVerts.map((_, i) => asString(rawColors[i], "#ffffff"));
  }

  let tileSource: PolyFace["tileSource"];
  if (isRecord(raw.tileSource)) {
    tileSource = {
      tilesetId: asString(raw.tileSource.tilesetId, ""),
      tileUid: asString(raw.tileSource.tileUid, ""),
      cachedTileId: Math.max(
        0,
        Math.round(asFiniteNumber(raw.tileSource.cachedTileId, 0))
      ),
      rotation: asRotation90(raw.tileSource.rotation),
      flipX: asBoolean(raw.tileSource.flipX, false),
      flipY: asBoolean(raw.tileSource.flipY, false),
    };
  }

  return {
    id: asString(raw.id, `face-${idx + 1}`),
    verts: clampedVerts,
    uvs,
    colors,
    triSplit:
      raw.triSplit === "02" || raw.triSplit === "13"
        ? raw.triSplit
        : undefined,
    flatShading:
      typeof raw.flatShading === "boolean" ? raw.flatShading : undefined,
    materialId: asString(raw.materialId, DEFAULT_MODEL3D_MATERIAL_ID),
    tileSource,
  };
}

function parsePolyMesh(raw: unknown): PolyMeshData {
  if (!isRecord(raw)) return { vertices: [], faces: [] };
  const vertices: Vec3[] = Array.isArray(raw.vertices)
    ? raw.vertices.map((v) => asVec3(v, [0, 0, 0]))
    : [];
  const faces: PolyFace[] = [];
  if (Array.isArray(raw.faces)) {
    for (let i = 0; i < raw.faces.length; i++) {
      const f = parsePolyFace(raw.faces[i], i, vertices.length);
      if (f) faces.push(f);
    }
  }
  return { vertices, faces };
}

function parseCollider(v: unknown): ColliderKind {
  if (v === "box" || v === "convex" || v === "trimesh") return v;
  return "none";
}

function parseNode(raw: unknown, idx: number): ModelNode | null {
  if (!isRecord(raw)) return null;
  const kind =
    raw.kind === "group" || raw.kind === "cuboid" || raw.kind === "mesh"
      ? raw.kind
      : null;
  if (!kind) return null;
  const id = asString(raw.id, `node-${idx + 1}`).trim() || `node-${idx + 1}`;
  const rawTr = isRecord(raw.transform) ? raw.transform : {};
  const transform = createDefaultTransform({
    position: asVec3(rawTr.position, [0, 0, 0]),
    rotation: asVec3(rawTr.rotation, [0, 0, 0]),
    scale: asVec3(rawTr.scale, [1, 1, 1]),
    pivot: asVec3(rawTr.pivot, [0, 0, 0]),
  });

  return {
    id,
    name: asString(raw.name, `${kind}-${idx + 1}`),
    kind,
    parentId: typeof raw.parentId === "string" ? raw.parentId : null,
    visible: asBoolean(raw.visible, true),
    locked: asBoolean(raw.locked, false),
    colorTag: typeof raw.colorTag === "string" ? raw.colorTag : undefined,
    collider: parseCollider(raw.collider),
    transform,
    cuboid: kind === "cuboid" ? parseCuboid(raw.cuboid) : undefined,
    mesh: kind === "mesh" ? parsePolyMesh(raw.mesh) : undefined,
    ...(kind === "mesh" && sanitizeModifiers(raw.modifiers).length > 0
      ? { modifiers: sanitizeModifiers(raw.modifiers) }
      : {}),
  };
}

function parseTilePrefab(raw: unknown, idx: number): TilePrefab3D | null {
  if (!isRecord(raw)) return null;
  const id = asString(raw.id, `prefab-${idx + 1}`).trim() || `prefab-${idx + 1}`;
  return {
    id,
    name: asString(raw.name, `Prefab ${idx + 1}`),
    mesh: parsePolyMesh(raw.mesh),
    sizePx: asVec3(raw.sizePx, [16, 16, 16]),
  };
}

const VALID_KF_PROPS = new Set<ModelKeyframeProperty>([
  "posX",
  "posY",
  "posZ",
  "rotX",
  "rotY",
  "rotZ",
  "scaleX",
  "scaleY",
  "scaleZ",
]);

const VALID_KF_EASINGS = new Set<ModelKeyframeEasing>([
  "linear",
  "step",
  "easeIn",
  "easeOut",
  "easeInOut",
]);

function parseKeyframe(raw: unknown): ModelKeyframe | null {
  if (!isRecord(raw)) return null;
  if (typeof raw.nodeId !== "string" || raw.nodeId.length === 0) return null;
  if (!VALID_KF_PROPS.has(raw.property as ModelKeyframeProperty)) return null;
  const easing = VALID_KF_EASINGS.has(raw.easing as ModelKeyframeEasing)
    ? (raw.easing as ModelKeyframeEasing)
    : "linear";
  return {
    frame: Math.max(0, Math.round(asFiniteNumber(raw.frame, 0))),
    nodeId: raw.nodeId,
    property: raw.property as ModelKeyframeProperty,
    value: asFiniteNumber(raw.value, 0),
    easing,
  };
}

function parseClip(raw: unknown, idx: number): ModelAnimationClip | null {
  if (!isRecord(raw)) return null;
  const id = asString(raw.id, `clip-${idx + 1}`).trim() || `clip-${idx + 1}`;
  const keyframes: ModelKeyframe[] = [];
  if (Array.isArray(raw.keyframes)) {
    for (const kf of raw.keyframes) {
      const parsed = parseKeyframe(kf);
      if (parsed) keyframes.push(parsed);
    }
  }
  return {
    id,
    name: asString(raw.name, `Clip ${idx + 1}`),
    frameCount: Math.max(1, Math.round(asFiniteNumber(raw.frameCount, 12))),
    fps: Math.max(1, Math.round(asFiniteNumber(raw.fps, 12))),
    loop: asBoolean(raw.loop, true),
    keyframes,
  };
}

function parseTileCursor(raw: unknown): TileCursor3D {
  const def = createDefaultTileCursor();
  if (!isRecord(raw)) return def;
  const plane: TileCursorPlane =
    raw.plane === "xy" || raw.plane === "zy" ? raw.plane : "xz";
  return {
    position: asVec3(raw.position, def.position),
    plane,
    stepPx: Math.max(1, asFiniteNumber(raw.stepPx, def.stepPx)),
    rotation: asRotation90(raw.rotation),
    flipX: asBoolean(raw.flipX, false),
    flipY: asBoolean(raw.flipY, false),
    tilesetId: asString(raw.tilesetId, ""),
    tileUid: asString(raw.tileUid, ""),
    cachedTileId: Math.max(
      0,
      Math.round(asFiniteNumber(raw.cachedTileId, def.cachedTileId))
    ),
  };
}

function parseGranularity(v: unknown): SelectionGranularity {
  if (v === "vertex" || v === "edge" || v === "face") return v;
  return "object";
}

export function createEmptyModel3DSceneSnapshot(): Model3DSceneSnapshot {
  return {
    version: 1,
    pixelsPerUnit: 16,
    nodes: [],
    materials: [createDefaultMaterial()],
    prefabs: [],
    clips: [],
    activeClipId: null,
    tileCursor: createDefaultTileCursor(),
    selectedNodeIds: [],
    activeNodeId: null,
    selectionGranularity: "object",
    selectedVertices: {},
    selectedEdges: {},
    selectedFaces: {},
  };
}

export function serializeModel3DScene(
  snap: Model3DSceneSnapshot
): Model3DSceneSnapshot {
  return {
    version: 1,
    pixelsPerUnit: snap.pixelsPerUnit,
    nodes: snap.nodes.map(cloneModelNode),
    materials: snap.materials.map(cloneModelMaterial),
    prefabs: snap.prefabs.map(cloneTilePrefab3D),
    clips: snap.clips.map(cloneAnimationClip),
    activeClipId: snap.activeClipId,
    tileCursor: {
      ...snap.tileCursor,
      position: [...snap.tileCursor.position],
    },
    selectedNodeIds: [...snap.selectedNodeIds],
    activeNodeId: snap.activeNodeId,
    selectionGranularity: snap.selectionGranularity,
    selectedVertices: Object.fromEntries(
      Object.entries(snap.selectedVertices).map(([k, v]) => [k, [...v]])
    ),
    selectedEdges: Object.fromEntries(
      Object.entries(snap.selectedEdges).map(([k, v]) => [
        k,
        v.map(([a, b]): [number, number] => [a, b]),
      ])
    ),
    selectedFaces: Object.fromEntries(
      Object.entries(snap.selectedFaces).map(([k, v]) => [k, [...v]])
    ),
  };
}

export function deserializeModel3DScene(raw: unknown): Model3DSceneSnapshot {
  if (!isRecord(raw)) {
    return createEmptyModel3DSceneSnapshot();
  }

  const pixelsPerUnit = Math.max(
    1,
    Math.min(128, Math.round(asFiniteNumber(raw.pixelsPerUnit, 16)))
  );

  const materials: ModelMaterial[] = [];
  if (Array.isArray(raw.materials)) {
    for (let i = 0; i < raw.materials.length; i++) {
      const mat = parseMaterial(raw.materials[i], i);
      if (mat) materials.push(mat);
    }
  }
  if (materials.length === 0) {
    materials.push(createDefaultMaterial());
  }

  const nodes: ModelNode[] = [];
  const seenNodeIds = new Set<string>();
  if (Array.isArray(raw.nodes)) {
    for (let i = 0; i < raw.nodes.length; i++) {
      const node = parseNode(raw.nodes[i], i);
      if (node && !seenNodeIds.has(node.id)) {
        seenNodeIds.add(node.id);
        nodes.push(node);
      }
    }
  }
  // Clear dangling parentIds
  for (const node of nodes) {
    if (
      node.parentId !== null &&
      (!seenNodeIds.has(node.parentId) || node.parentId === node.id)
    ) {
      node.parentId = null;
    }
  }

  const prefabs: TilePrefab3D[] = [];
  if (Array.isArray(raw.prefabs)) {
    for (let i = 0; i < raw.prefabs.length; i++) {
      const prefab = parseTilePrefab(raw.prefabs[i], i);
      if (prefab) prefabs.push(prefab);
    }
  }

  const clips: ModelAnimationClip[] = [];
  if (Array.isArray(raw.clips)) {
    for (let i = 0; i < raw.clips.length; i++) {
      const clip = parseClip(raw.clips[i], i);
      if (clip) clips.push(clip);
    }
  }

  const activeClipId =
    typeof raw.activeClipId === "string" &&
    clips.some((c) => c.id === raw.activeClipId)
      ? raw.activeClipId
      : (clips[0]?.id ?? null);

  const selectedNodeIds = Array.isArray(raw.selectedNodeIds)
    ? raw.selectedNodeIds.filter(
        (id): id is string => typeof id === "string" && seenNodeIds.has(id)
      )
    : [];

  const activeNodeId =
    typeof raw.activeNodeId === "string" && seenNodeIds.has(raw.activeNodeId)
      ? raw.activeNodeId
      : (selectedNodeIds[0] ?? null);

  const selectedVertices: Record<string, number[]> = {};
  if (isRecord(raw.selectedVertices)) {
    for (const [k, val] of Object.entries(raw.selectedVertices)) {
      if (seenNodeIds.has(k) && Array.isArray(val)) {
        selectedVertices[k] = val.filter(
          (n): n is number => typeof n === "number" && Number.isInteger(n)
        );
      }
    }
  }

  const selectedEdges: Record<string, Array<[number, number]>> = {};
  if (isRecord(raw.selectedEdges)) {
    for (const [k, val] of Object.entries(raw.selectedEdges)) {
      if (seenNodeIds.has(k) && Array.isArray(val)) {
        const pairs: Array<[number, number]> = [];
        for (const item of val) {
          if (
            Array.isArray(item) &&
            item.length >= 2 &&
            typeof item[0] === "number" &&
            typeof item[1] === "number"
          ) {
            pairs.push([item[0], item[1]]);
          }
        }
        selectedEdges[k] = pairs;
      }
    }
  }

  const selectedFaces: Record<string, string[]> = {};
  if (isRecord(raw.selectedFaces)) {
    for (const [k, val] of Object.entries(raw.selectedFaces)) {
      if (seenNodeIds.has(k) && Array.isArray(val)) {
        selectedFaces[k] = val.filter((s): s is string => typeof s === "string");
      }
    }
  }

  return {
    version: 1,
    pixelsPerUnit,
    nodes,
    materials,
    prefabs,
    clips,
    activeClipId,
    tileCursor: parseTileCursor(raw.tileCursor),
    selectedNodeIds,
    activeNodeId,
    selectionGranularity: parseGranularity(raw.selectionGranularity),
    selectedVertices,
    selectedEdges,
    selectedFaces,
  };
}

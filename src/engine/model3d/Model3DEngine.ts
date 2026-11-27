import { cloneModifiers } from "./modifierTypes.ts";
import type {
  ColliderKind,
  CuboidData,
  CuboidFaceName,
  CuboidFaceUV,
  Model3DSceneSnapshot,
  ModelAnimationClip,
  ModelMaterial,
  ModelNode,
  PolyFace,
  PolyMeshData,
  SelectionGranularity,
  TileCursor3D,
  TilePrefab3D,
  Transform3D,
  Vec2,
  Vec3,
} from "./types.ts";

export const DEFAULT_MODEL3D_MATERIAL_ID = "mat-draw-default";

export function createDefaultMaterial(): ModelMaterial {
  return {
    id: DEFAULT_MODEL3D_MATERIAL_ID,
    name: "Draw Canvas",
    source: { kind: "draw-canvas" },
    doubleSided: false,
    alphaTest: 0.5,
    usePbrMaps: true,
  };
}

export function createDefaultTileCursor(): TileCursor3D {
  return {
    position: [0, 0, 0],
    plane: "xz",
    stepPx: 16,
    rotation: 0,
    flipX: false,
    flipY: false,
    tilesetId: "",
    tileUid: "",
    cachedTileId: 1,
  };
}

export function createDefaultTransform(
  patch?: Partial<Transform3D>
): Transform3D {
  return {
    position: patch?.position ? [...patch.position] : [0, 0, 0],
    rotation: patch?.rotation ? [...patch.rotation] : [0, 0, 0],
    scale: patch?.scale ? [...patch.scale] : [1, 1, 1],
    pivot: patch?.pivot ? [...patch.pivot] : [0, 0, 0],
  };
}

function cloneFaceUV(face: CuboidFaceUV): CuboidFaceUV {
  return {
    uv: [face.uv[0], face.uv[1], face.uv[2], face.uv[3]],
    rotation: face.rotation,
    flipX: face.flipX,
    flipY: face.flipY,
    materialId: face.materialId,
    hidden: face.hidden,
  };
}

export function createDefaultCuboidData(
  from: Vec3 = [-4, 0, -4],
  to: Vec3 = [4, 8, 4],
  materialId = DEFAULT_MODEL3D_MATERIAL_ID
): CuboidData {
  const dx = Math.max(1, Math.round(Math.abs(to[0] - from[0])));
  const dy = Math.max(1, Math.round(Math.abs(to[1] - from[1])));
  const dz = Math.max(1, Math.round(Math.abs(to[2] - from[2])));
  const makeFace = (w: number, h: number): CuboidFaceUV => ({
    uv: [0, 0, w, h],
    rotation: 0,
    materialId,
  });
  return {
    from: [...from],
    to: [...to],
    inflate: 0,
    uvMode: "box",
    uvLock: false,
    mirrorUvX: false,
    boxUvOrigin: [0, 0],
    faces: {
      north: makeFace(dx, dy),
      south: makeFace(dx, dy),
      east: makeFace(dz, dy),
      west: makeFace(dz, dy),
      up: makeFace(dx, dz),
      down: makeFace(dx, dz),
    },
  };
}

export function cloneCuboidData(c: CuboidData): CuboidData {
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
    faces[name] = cloneFaceUV(c.faces[name]);
  }
  return {
    from: [c.from[0], c.from[1], c.from[2]],
    to: [c.to[0], c.to[1], c.to[2]],
    inflate: c.inflate,
    uvMode: c.uvMode,
    uvLock: c.uvLock,
    mirrorUvX: c.mirrorUvX,
    boxUvOrigin: [c.boxUvOrigin[0], c.boxUvOrigin[1]],
    faces,
  };
}

export function clonePolyFace(f: PolyFace): PolyFace {
  return {
    id: f.id,
    verts: [...f.verts],
    uvs: f.uvs.map((uv): Vec2 => [uv[0], uv[1]]),
    colors: f.colors ? [...f.colors] : undefined,
    triSplit: f.triSplit,
    flatShading: f.flatShading,
    materialId: f.materialId,
    tileSource: f.tileSource ? { ...f.tileSource } : undefined,
  };
}

export function clonePolyMeshData(m: PolyMeshData): PolyMeshData {
  return {
    vertices: m.vertices.map((v): Vec3 => [v[0], v[1], v[2]]),
    faces: m.faces.map(clonePolyFace),
  };
}

export function cloneModelNode(n: ModelNode): ModelNode {
  return {
    id: n.id,
    name: n.name,
    kind: n.kind,
    parentId: n.parentId,
    visible: n.visible,
    locked: n.locked,
    colorTag: n.colorTag,
    collider: n.collider,
    transform: createDefaultTransform(n.transform),
    cuboid: n.cuboid ? cloneCuboidData(n.cuboid) : undefined,
    mesh: n.mesh ? clonePolyMeshData(n.mesh) : undefined,
    ...(n.modifiers && n.modifiers.length > 0
      ? { modifiers: cloneModifiers(n.modifiers) }
      : {}),
  };
}

export function cloneModelMaterial(m: ModelMaterial): ModelMaterial {
  return {
    id: m.id,
    name: m.name,
    source: { ...m.source },
    doubleSided: m.doubleSided,
    alphaTest: m.alphaTest,
    usePbrMaps: m.usePbrMaps,
  };
}

export function cloneTilePrefab3D(p: TilePrefab3D): TilePrefab3D {
  return {
    id: p.id,
    name: p.name,
    mesh: clonePolyMeshData(p.mesh),
    sizePx: [p.sizePx[0], p.sizePx[1], p.sizePx[2]],
  };
}

export function cloneAnimationClip(c: ModelAnimationClip): ModelAnimationClip {
  return {
    id: c.id,
    name: c.name,
    frameCount: c.frameCount,
    fps: c.fps,
    loop: c.loop,
    keyframes: c.keyframes.map((k) => ({ ...k })),
  };
}

function cloneRecordArrayNum(
  rec: Record<string, number[]>
): Record<string, number[]> {
  const out: Record<string, number[]> = {};
  for (const [k, v] of Object.entries(rec)) {
    out[k] = [...v];
  }
  return out;
}

function cloneRecordEdges(
  rec: Record<string, Array<[number, number]>>
): Record<string, Array<[number, number]>> {
  const out: Record<string, Array<[number, number]>> = {};
  for (const [k, v] of Object.entries(rec)) {
    out[k] = v.map(([a, b]) => [a, b]);
  }
  return out;
}

function cloneRecordStrings(
  rec: Record<string, string[]>
): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const [k, v] of Object.entries(rec)) {
    out[k] = [...v];
  }
  return out;
}

export interface AddNodeOptions {
  id?: string;
  name?: string;
  kind: ModelNode["kind"];
  parentId?: string | null;
  visible?: boolean;
  locked?: boolean;
  colorTag?: string;
  collider?: ColliderKind;
  transform?: Partial<Transform3D>;
  cuboid?: CuboidData;
  mesh?: PolyMeshData;
}

export class Model3DEngine {
  pixelsPerUnit = 16;
  nodes: ModelNode[] = [];
  materials: ModelMaterial[] = [createDefaultMaterial()];
  prefabs: TilePrefab3D[] = [];
  clips: ModelAnimationClip[] = [];
  activeClipId: string | null = null;
  tileCursor: TileCursor3D = createDefaultTileCursor();

  selectedNodeIds: string[] = [];
  activeNodeId: string | null = null;
  selectionGranularity: SelectionGranularity = "object";
  selectedVertices: Record<string, number[]> = {};
  selectedEdges: Record<string, Array<[number, number]>> = {};
  selectedFaces: Record<string, string[]> = {};

  version = 0;
  private nextId = 1;
  private listeners = new Set<() => void>();

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private bumpVersion(): void {
    this.version += 1;
    for (const listener of this.listeners) {
      listener();
    }
  }

  private allocateId(prefix: string): string {
    const existing = new Set<string>([
      ...this.nodes.map((n) => n.id),
      ...this.materials.map((m) => m.id),
      ...this.prefabs.map((p) => p.id),
      ...this.clips.map((c) => c.id),
    ]);
    let candidate = `${prefix}-${this.nextId++}`;
    while (existing.has(candidate)) {
      candidate = `${prefix}-${this.nextId++}`;
    }
    return candidate;
  }

  reset(): void {
    this.pixelsPerUnit = 16;
    this.nodes = [];
    this.materials = [createDefaultMaterial()];
    this.prefabs = [];
    this.clips = [];
    this.activeClipId = null;
    this.tileCursor = createDefaultTileCursor();
    this.selectedNodeIds = [];
    this.activeNodeId = null;
    this.selectionGranularity = "object";
    this.selectedVertices = {};
    this.selectedEdges = {};
    this.selectedFaces = {};
    this.nextId = 1;
    this.bumpVersion();
  }

  isEmptyDefault(): boolean {
    return (
      this.pixelsPerUnit === 16 &&
      this.nodes.length === 0 &&
      this.prefabs.length === 0 &&
      this.clips.length === 0 &&
      this.materials.length === 1 &&
      this.materials[0]?.id === DEFAULT_MODEL3D_MATERIAL_ID
    );
  }

  getNode(id: string): ModelNode | undefined {
    return this.nodes.find((n) => n.id === id);
  }

  addGroup(options?: {
    id?: string;
    name?: string;
    parentId?: string | null;
    transform?: Partial<Transform3D>;
    collider?: ColliderKind;
    colorTag?: string;
  }): ModelNode {
    return this.addNode({
      id: options?.id,
      name: options?.name ?? `Group ${this.nodes.length + 1}`,
      kind: "group",
      parentId: options?.parentId ?? null,
      transform: options?.transform,
      collider: options?.collider,
      colorTag: options?.colorTag,
    });
  }

  addNode(options: AddNodeOptions): ModelNode {
    const id = options.id?.trim() || this.allocateId(options.kind);
    const parentId =
      options.parentId && this.nodes.some((n) => n.id === options.parentId)
        ? options.parentId
        : null;
    const defaultMatId =
      this.materials[0]?.id ?? DEFAULT_MODEL3D_MATERIAL_ID;

    const node: ModelNode = {
      id,
      name: options.name?.trim() || `${options.kind}-${id}`,
      kind: options.kind,
      parentId,
      visible: options.visible ?? true,
      locked: options.locked ?? false,
      colorTag: options.colorTag,
      collider: options.collider ?? "none",
      transform: createDefaultTransform(options.transform),
      cuboid:
        options.kind === "cuboid"
          ? cloneCuboidData(
              options.cuboid ??
                createDefaultCuboidData([-4, 0, -4], [4, 8, 4], defaultMatId)
            )
          : undefined,
      mesh:
        options.kind === "mesh"
          ? clonePolyMeshData(options.mesh ?? { vertices: [], faces: [] })
          : undefined,
    };

    this.nodes.push(node);
    this.selectNodes([node.id], node.id);
    return node;
  }

  updateNode(
    id: string,
    patch: Partial<Omit<ModelNode, "id" | "kind">>
  ): boolean {
    const node = this.getNode(id);
    if (!node) return false;

    if (patch.name !== undefined) {
      const trimmed = patch.name.trim();
      if (trimmed.length > 0) node.name = trimmed;
    }
    if (patch.parentId !== undefined) {
      if (patch.parentId === null) {
        node.parentId = null;
      } else if (!this.wouldCreateCycle(id, patch.parentId)) {
        node.parentId = patch.parentId;
      }
    }
    if (patch.visible !== undefined) node.visible = patch.visible;
    if (patch.locked !== undefined) node.locked = patch.locked;
    if (patch.colorTag !== undefined) node.colorTag = patch.colorTag;
    if (patch.collider !== undefined) node.collider = patch.collider;
    if (patch.transform !== undefined) {
      node.transform = createDefaultTransform({
        ...node.transform,
        ...patch.transform,
      });
    }
    if (patch.cuboid !== undefined && node.kind === "cuboid") {
      node.cuboid = cloneCuboidData(patch.cuboid);
    }
    if (patch.mesh !== undefined && node.kind === "mesh") {
      node.mesh = clonePolyMeshData(patch.mesh);
    }
    if (patch.modifiers !== undefined && node.kind === "mesh") {
      if (patch.modifiers.length > 0) node.modifiers = cloneModifiers(patch.modifiers);
      else delete node.modifiers;
    }

    this.bumpVersion();
    return true;
  }

  private collectSubtreeIds(rootIds: readonly string[]): Set<string> {
    const toDelete = new Set<string>();
    const byId = new Map(this.nodes.map((n) => [n.id, n]));
    const queue = rootIds.filter((id) => byId.has(id));
    for (const id of queue) toDelete.add(id);

    let changed = true;
    while (changed) {
      changed = false;
      for (const node of this.nodes) {
        if (
          !toDelete.has(node.id) &&
          node.parentId !== null &&
          toDelete.has(node.parentId)
        ) {
          toDelete.add(node.id);
          changed = true;
        }
      }
    }
    return toDelete;
  }

  deleteNodes(ids: readonly string[]): string[] {
    if (ids.length === 0) return [];
    const deleteSet = this.collectSubtreeIds(ids);
    if (deleteSet.size === 0) return [];

    this.nodes = this.nodes.filter((n) => !deleteSet.has(n.id));
    for (const id of deleteSet) {
      delete this.selectedVertices[id];
      delete this.selectedEdges[id];
      delete this.selectedFaces[id];
    }
    this.selectedNodeIds = this.selectedNodeIds.filter(
      (id) => !deleteSet.has(id)
    );
    if (this.activeNodeId && deleteSet.has(this.activeNodeId)) {
      this.activeNodeId = this.selectedNodeIds[0] ?? null;
    }
    this.bumpVersion();
    return Array.from(deleteSet);
  }

  duplicateNodes(ids: readonly string[]): ModelNode[] {
    if (ids.length === 0) return [];
    const sourceSet = this.collectSubtreeIds(ids);
    if (sourceSet.size === 0) return [];

    // Preserve document order for duplicated subtree nodes
    const originals = this.nodes.filter((n) => sourceSet.has(n.id));
    const idMap = new Map<string, string>();
    for (const orig of originals) {
      idMap.set(orig.id, this.allocateId(orig.kind));
    }

    const created: ModelNode[] = [];
    for (const orig of originals) {
      const cloned = cloneModelNode(orig);
      const newId = idMap.get(orig.id)!;
      cloned.id = newId;
      cloned.name = `${orig.name} Copy`;
      if (orig.parentId !== null && idMap.has(orig.parentId)) {
        cloned.parentId = idMap.get(orig.parentId)!;
      } else {
        cloned.parentId = orig.parentId;
      }
      this.nodes.push(cloned);
      created.push(cloned);
    }

    const newTopIds = ids
      .map((id) => idMap.get(id))
      .filter((id): id is string => Boolean(id));
    this.selectNodes(
      newTopIds,
      newTopIds[newTopIds.length - 1] ?? created[0]?.id ?? null
    );
    return created;
  }

  private wouldCreateCycle(nodeId: string, targetParentId: string): boolean {
    if (nodeId === targetParentId) return true;
    const byId = new Map(this.nodes.map((n) => [n.id, n]));
    if (!byId.has(targetParentId)) return true;

    const visited = new Set<string>([nodeId]);
    let cur: string | null = targetParentId;
    while (cur !== null) {
      if (visited.has(cur)) return true;
      visited.add(cur);
      const parent = byId.get(cur);
      cur = parent ? parent.parentId : null;
    }
    return false;
  }

  reparentNode(id: string, newParentId: string | null): boolean {
    const node = this.getNode(id);
    if (!node) return false;
    if (newParentId === null) {
      if (node.parentId === null) return true;
      node.parentId = null;
      this.bumpVersion();
      return true;
    }
    if (this.wouldCreateCycle(id, newParentId)) {
      return false;
    }
    node.parentId = newParentId;
    this.bumpVersion();
    return true;
  }

  addMaterial(
    options: Omit<ModelMaterial, "id"> & { id?: string }
  ): ModelMaterial {
    const id = options.id?.trim() || this.allocateId("mat");
    const mat: ModelMaterial = {
      id,
      name: options.name.trim() || `Material ${this.materials.length + 1}`,
      source: { ...options.source },
      doubleSided: options.doubleSided,
      alphaTest: options.alphaTest,
      usePbrMaps: options.usePbrMaps,
    };
    this.materials.push(mat);
    this.bumpVersion();
    return mat;
  }

  updateMaterial(
    id: string,
    patch: Partial<Omit<ModelMaterial, "id">>
  ): boolean {
    const mat = this.materials.find((m) => m.id === id);
    if (!mat) return false;
    if (patch.name !== undefined) {
      const trimmed = patch.name.trim();
      if (trimmed.length > 0) mat.name = trimmed;
    }
    if (patch.source !== undefined) mat.source = { ...patch.source };
    if (patch.doubleSided !== undefined) mat.doubleSided = patch.doubleSided;
    if (patch.alphaTest !== undefined) {
      mat.alphaTest = Math.max(0, Math.min(1, patch.alphaTest));
    }
    if (patch.usePbrMaps !== undefined) mat.usePbrMaps = patch.usePbrMaps;
    this.bumpVersion();
    return true;
  }

  removeMaterial(id: string): boolean {
    if (this.materials.length <= 1) return false;
    const idx = this.materials.findIndex((m) => m.id === id);
    if (idx === -1) return false;
    this.materials.splice(idx, 1);
    const fallbackId = this.materials[0].id;
    for (const node of this.nodes) {
      if (node.cuboid) {
        const faces = node.cuboid.faces;
        (Object.keys(faces) as CuboidFaceName[]).forEach((fn) => {
          if (faces[fn].materialId === id) {
            faces[fn].materialId = fallbackId;
          }
        });
      }
      if (node.mesh) {
        for (const face of node.mesh.faces) {
          if (face.materialId === id) {
            face.materialId = fallbackId;
          }
        }
      }
    }
    this.bumpVersion();
    return true;
  }

  patchTileCursor(patch: Partial<TileCursor3D>): void {
    this.tileCursor = {
      ...this.tileCursor,
      ...patch,
      position: patch.position
        ? [patch.position[0], patch.position[1], patch.position[2]]
        : [...this.tileCursor.position],
    };
    this.bumpVersion();
  }

  selectNodes(ids: readonly string[], activeId?: string | null): void {
    const valid = new Set(this.nodes.map((n) => n.id));
    const unique: string[] = [];
    for (const id of ids) {
      if (valid.has(id) && !unique.includes(id)) {
        unique.push(id);
      }
    }
    this.selectedNodeIds = unique;
    if (activeId !== undefined) {
      this.activeNodeId =
        activeId !== null && valid.has(activeId)
          ? activeId
          : (unique[0] ?? null);
    } else {
      this.activeNodeId = unique[0] ?? null;
    }
    this.bumpVersion();
  }

  clearSelection(): void {
    this.selectedNodeIds = [];
    this.activeNodeId = null;
    this.selectedVertices = {};
    this.selectedEdges = {};
    this.selectedFaces = {};
    this.bumpVersion();
  }

  setSelectionGranularity(granularity: SelectionGranularity): void {
    this.selectionGranularity = granularity;
    this.bumpVersion();
  }

  setPixelsPerUnit(ppu: number): void {
    const clamped = Math.max(1, Math.min(128, Math.round(ppu)));
    if (clamped !== this.pixelsPerUnit) {
      this.pixelsPerUnit = clamped;
      this.bumpVersion();
    }
  }

  toSnapshot(): Model3DSceneSnapshot {
    return {
      version: 1,
      pixelsPerUnit: this.pixelsPerUnit,
      nodes: this.nodes.map(cloneModelNode),
      materials: this.materials.map(cloneModelMaterial),
      prefabs: this.prefabs.map(cloneTilePrefab3D),
      clips: this.clips.map(cloneAnimationClip),
      activeClipId: this.activeClipId,
      tileCursor: {
        ...this.tileCursor,
        position: [...this.tileCursor.position],
      },
      selectedNodeIds: [...this.selectedNodeIds],
      activeNodeId: this.activeNodeId,
      selectionGranularity: this.selectionGranularity,
      selectedVertices: cloneRecordArrayNum(this.selectedVertices),
      selectedEdges: cloneRecordEdges(this.selectedEdges),
      selectedFaces: cloneRecordStrings(this.selectedFaces),
    };
  }

  loadSnapshot(snap: Model3DSceneSnapshot): void {
    this.pixelsPerUnit =
      typeof snap.pixelsPerUnit === "number" && snap.pixelsPerUnit > 0
        ? snap.pixelsPerUnit
        : 16;
    this.nodes = snap.nodes.map(cloneModelNode);
    this.materials =
      snap.materials.length > 0
        ? snap.materials.map(cloneModelMaterial)
        : [createDefaultMaterial()];
    this.prefabs = snap.prefabs.map(cloneTilePrefab3D);
    this.clips = snap.clips.map(cloneAnimationClip);
    this.activeClipId = snap.activeClipId;
    this.tileCursor = {
      ...snap.tileCursor,
      position: [...snap.tileCursor.position],
    };

    const validIds = new Set(this.nodes.map((n) => n.id));
    this.selectedNodeIds = snap.selectedNodeIds.filter((id) => validIds.has(id));
    this.activeNodeId =
      snap.activeNodeId && validIds.has(snap.activeNodeId)
        ? snap.activeNodeId
        : (this.selectedNodeIds[0] ?? null);
    this.selectionGranularity = snap.selectionGranularity;
    this.selectedVertices = cloneRecordArrayNum(snap.selectedVertices);
    this.selectedEdges = cloneRecordEdges(snap.selectedEdges);
    this.selectedFaces = cloneRecordStrings(snap.selectedFaces);

    this.bumpVersion();
  }
}

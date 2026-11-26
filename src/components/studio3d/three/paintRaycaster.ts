import * as THREE from "three";
import { hexToRgba, rgbaToHex, type PixelBuffer, type RGBA } from "../../../engine/document/PixelBuffer";
import { pixelEngine } from "../../../engine/document/PixelEngine";
import { syncHistoryAndCelState } from "../../../engine/document/historyActions";
import {
  DEFAULT_MODEL3D_MATERIAL_ID,
  type Model3DEngine,
} from "../../../engine/model3d/Model3DEngine";
import { convertNodeCuboidToMesh } from "../../../engine/model3d/meshOps";
import {
  buildPaddedTilesetAtlas,
  type PaddedTileEntry,
  type PaddedTilesetAtlas,
} from "../../../engine/model3d/tilesetAtlas";
import { paintFaceCornerColors } from "../../../engine/model3d/tileStamp";
import type {
  CuboidFaceName,
  ModelMaterial,
  ModelNode,
  PolyFace,
  Vec2,
} from "../../../engine/model3d/types";
import { normalizedUvToPixel } from "../../../engine/model3d/uvOps";
import {
  captureTilemapHistorySnapshot,
  type TilemapHistorySnapshot,
} from "../../../engine/tiles/TilemapHistory";
import type { Tileset } from "../../../engine/tiles/Tileset";
import { getBrushFootprint } from "../../../engine/tools/brush";
import { applyInkPixel } from "../../../engine/tools/ink";
import { plotBresenhamLine } from "../../../engine/tools/pixelAlgos";
import { isLayerEffectivelyLocked, useEditorStore, type LayerItem } from "../../../store/editorStore";
import type { MaterialTextureInfo } from "./retroMaterials";
import type { MeshLookupUserData } from "./sceneSync";

export type Paint3DTool =
  | "brush"
  | "eraser"
  | "fillFace"
  | "eyedropper"
  | "vertexColor";

export interface Paint3DRayHit {
  nodeId: string;
  faceId: string;
  faceIndex: number;
  materialId: string;
  uv: [number, number];
  pixel: [number, number];
  cornerIndex: number;
  worldPoint: THREE.Vector3;
}

export interface Paint3DRaycastParams {
  clientX: number;
  clientY: number;
  rect: DOMRect | { left: number; top: number; width: number; height: number };
  camera: THREE.Camera;
  pickableMeshes: readonly THREE.Object3D[];
  engine?: Model3DEngine;
  textureSizeByMaterialId?: ReadonlyMap<string, MaterialTextureInfo>;
  defaultTextureWidth?: number;
  defaultTextureHeight?: number;
  raycaster?: THREE.Raycaster;
}

export interface Paint3DStrokeOptions {
  tool: Paint3DTool;
  brushSize?: number;
  brushShape?: "square" | "circle";
  brushOpacity?: number;
  primaryColor?: string;
  primaryAlpha?: number;
  lockToInitialFace?: boolean;
  shiftKey?: boolean;
  textureSizeByMaterialId?: ReadonlyMap<string, MaterialTextureInfo>;
  defaultTextureWidth?: number;
  defaultTextureHeight?: number;
  onTextureDirty?: () => void;
  onModelDirty?: () => void;
}

interface FaceUvPolygonMask {
  nodeId: string;
  faceId: string;
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  polygon: Vec2[] | null;
  isRect: boolean;
}

type ActiveTargetState =
  | {
      kind: "draw-canvas";
      layerId: string;
      frameIndex: number;
      cel: PixelBuffer;
      alphaLock: boolean;
      changed: boolean;
    }
  | {
      kind: "tileset";
      tilesetId: string;
      tileset: Tileset;
      atlas: PaddedTilesetAtlas;
      beforeSnap: TilemapHistorySnapshot;
      changed: boolean;
    }
  | {
      kind: "vertexColor";
      beforeSnap: string;
      changed: boolean;
    };

function isCuboidFaceName(faceId: string): faceId is CuboidFaceName {
  return (
    faceId === "north" ||
    faceId === "south" ||
    faceId === "east" ||
    faceId === "west" ||
    faceId === "up" ||
    faceId === "down"
  );
}

function getMaterialTextureSize(
  materialId: string,
  engine: Model3DEngine,
  textureSizeByMaterialId?: ReadonlyMap<string, MaterialTextureInfo>,
  defaultW = 32,
  defaultH = 32
): { width: number; height: number } {
  const fromMap = textureSizeByMaterialId?.get(materialId);
  if (fromMap && fromMap.width > 0 && fromMap.height > 0) {
    return { width: fromMap.width, height: fromMap.height };
  }

  const mat = engine.materials.find((m) => m.id === materialId);
  if (mat) {
    if (mat.source.kind === "draw-canvas") {
      return {
        width: Math.max(1, pixelEngine.width),
        height: Math.max(1, pixelEngine.height),
      };
    }
    if (mat.source.kind === "tileset") {
      const ts = resolveTilesetById(mat.source.tilesetId);
      const count = Math.max(1, ts.count);
      const cols = Math.max(1, Math.ceil(Math.sqrt(count)));
      const rows = Math.max(1, Math.ceil(count / cols));
      return {
        width: cols * ts.tileWidth,
        height: rows * ts.tileHeight,
      };
    }
    if (mat.source.kind === "embedded") {
      return {
        width: Math.max(1, mat.source.width),
        height: Math.max(1, mat.source.height),
      };
    }
  }

  return {
    width: Math.max(1, Math.round(defaultW)),
    height: Math.max(1, Math.round(defaultH)),
  };
}

function resolveTilesetById(tilesetId: string): Tileset {
  const registry = pixelEngine.tilesetRegistry as unknown as {
    getById?: (id: string) => Tileset | undefined;
    tilesets: Tileset[];
  };
  if (typeof registry.getById === "function") {
    const found = registry.getById(tilesetId);
    if (found) return found;
  }
  return (
    registry.tilesets.find((ts) => ts.id === tilesetId) ?? pixelEngine.tileset
  );
}

function resolveHitFaceMaterialId(node: ModelNode, faceId: string): string {
  if (node.kind === "cuboid" && node.cuboid && isCuboidFaceName(faceId)) {
    return (
      node.cuboid.faces[faceId]?.materialId || DEFAULT_MODEL3D_MATERIAL_ID
    );
  }
  if (node.kind === "mesh" && node.mesh) {
    const face = node.mesh.faces.find((f) => f.id === faceId);
    if (face?.materialId) return face.materialId;
  }
  return DEFAULT_MODEL3D_MATERIAL_ID;
}

function computeCuboidCornerWorldPositions(
  node: ModelNode,
  faceName: CuboidFaceName,
  ppu: number,
  objectMatrixWorld: THREE.Matrix4
): THREE.Vector3[] {
  if (!node.cuboid) return [];
  const c = node.cuboid;
  const pivot = node.transform.pivot;
  const minX = Math.min(c.from[0], c.to[0]) - c.inflate;
  const minY = Math.min(c.from[1], c.to[1]) - c.inflate;
  const minZ = Math.min(c.from[2], c.to[2]) - c.inflate;
  const maxX = Math.max(c.from[0], c.to[0]) + c.inflate;
  const maxY = Math.max(c.from[1], c.to[1]) + c.inflate;
  const maxZ = Math.max(c.from[2], c.to[2]) + c.inflate;

  const toWorld = (x: number, y: number, z: number): THREE.Vector3 =>
    new THREE.Vector3(
      (x - pivot[0]) / ppu,
      (y - pivot[1]) / ppu,
      (z - pivot[2]) / ppu
    ).applyMatrix4(objectMatrixWorld);

  switch (faceName) {
    case "north":
      return [
        toWorld(maxX, maxY, minZ),
        toWorld(minX, maxY, minZ),
        toWorld(minX, minY, minZ),
        toWorld(maxX, minY, minZ),
      ];
    case "south":
      return [
        toWorld(minX, maxY, maxZ),
        toWorld(maxX, maxY, maxZ),
        toWorld(maxX, minY, maxZ),
        toWorld(minX, minY, maxZ),
      ];
    case "east":
      return [
        toWorld(maxX, maxY, maxZ),
        toWorld(maxX, maxY, minZ),
        toWorld(maxX, minY, minZ),
        toWorld(maxX, minY, maxZ),
      ];
    case "west":
      return [
        toWorld(minX, maxY, minZ),
        toWorld(minX, maxY, maxZ),
        toWorld(minX, minY, maxZ),
        toWorld(minX, minY, minZ),
      ];
    case "up":
      return [
        toWorld(minX, maxY, minZ),
        toWorld(maxX, maxY, minZ),
        toWorld(maxX, maxY, maxZ),
        toWorld(minX, maxY, maxZ),
      ];
    case "down":
      return [
        toWorld(minX, minY, maxZ),
        toWorld(maxX, minY, maxZ),
        toWorld(maxX, minY, minZ),
        toWorld(minX, minY, minZ),
      ];
  }
}

function findNearestCornerIndex(
  node: ModelNode,
  faceId: string,
  worldPoint: THREE.Vector3,
  ppu: number,
  objectMatrixWorld: THREE.Matrix4
): number {
  if (node.kind === "mesh" && node.mesh) {
    const face = node.mesh.faces.find((f) => f.id === faceId);
    if (!face || face.verts.length === 0) return 0;

    const pivot = node.transform.pivot;
    let bestIdx = 0;
    let bestDistSq = Infinity;
    const tmp = new THREE.Vector3();

    for (let i = 0; i < face.verts.length; i++) {
      const v = node.mesh.vertices[face.verts[i]];
      if (!v) continue;
      tmp
        .set(
          (v[0] - pivot[0]) / ppu,
          (v[1] - pivot[1]) / ppu,
          (v[2] - pivot[2]) / ppu
        )
        .applyMatrix4(objectMatrixWorld);
      const dSq = tmp.distanceToSquared(worldPoint);
      if (dSq < bestDistSq) {
        bestDistSq = dSq;
        bestIdx = i;
      }
    }
    return bestIdx;
  }

  if (node.kind === "cuboid" && node.cuboid && isCuboidFaceName(faceId)) {
    const corners = computeCuboidCornerWorldPositions(
      node,
      faceId,
      ppu,
      objectMatrixWorld
    );
    let bestIdx = 0;
    let bestDistSq = Infinity;
    for (let i = 0; i < corners.length; i++) {
      const dSq = corners[i].distanceToSquared(worldPoint);
      if (dSq < bestDistSq) {
        bestDistSq = dSq;
        bestIdx = i;
      }
    }
    return bestIdx;
  }

  return 0;
}

/**
 * Raycasts from screen coordinates against `pickableMeshes`, inspects `MeshLookupUserData`,
 * resolves the hit node, face, material, quantized pixel `[px, py]`, and nearest corner index.
 */
export function raycastModel3DPaintHit(
  params: Paint3DRaycastParams
): Paint3DRayHit | null {
  const { rect, camera, pickableMeshes } = params;
  if (rect.width <= 0 || rect.height <= 0 || pickableMeshes.length === 0) {
    return null;
  }

  const ndc = new THREE.Vector2(
    ((params.clientX - rect.left) / rect.width) * 2 - 1,
    -((params.clientY - rect.top) / rect.height) * 2 + 1
  );

  const raycaster = params.raycaster ?? new THREE.Raycaster();
  raycaster.setFromCamera(ndc, camera);
  const hits = raycaster.intersectObjects(
    pickableMeshes as THREE.Object3D[],
    false
  );
  if (hits.length === 0) return null;

  const engine = params.engine ?? pixelEngine.model3d;
  const ppu = Math.max(1, engine.pixelsPerUnit);

  for (const hit of hits) {
    const ud = hit.object.userData as Partial<MeshLookupUserData> | undefined;
    if (!ud?.nodeId || !ud.triToFaceIndex || !ud.faceIds) continue;
    if (hit.faceIndex === undefined || hit.faceIndex === null) continue;
    if (hit.faceIndex < 0 || hit.faceIndex >= ud.triToFaceIndex.length) {
      continue;
    }

    const node = engine.getNode(ud.nodeId);
    if (!node || !node.visible) continue;

    const faceIndex = ud.triToFaceIndex[hit.faceIndex];
    const faceId = ud.faceIds[faceIndex];
    if (!faceId) continue;

    const materialId = resolveHitFaceMaterialId(node, faceId);
    const texSize = getMaterialTextureSize(
      materialId,
      engine,
      params.textureSizeByMaterialId,
      params.defaultTextureWidth ?? pixelEngine.width,
      params.defaultTextureHeight ?? pixelEngine.height
    );

    const uvX = hit.uv ? hit.uv.x : 0;
    const uvY = hit.uv ? hit.uv.y : 0;
    const pixel = normalizedUvToPixel(
      uvX,
      uvY,
      texSize.width,
      texSize.height
    );

    hit.object.updateMatrixWorld(true);
    const cornerIndex = findNearestCornerIndex(
      node,
      faceId,
      hit.point,
      ppu,
      hit.object.matrixWorld
    );

    return {
      nodeId: node.id,
      faceId,
      faceIndex,
      materialId,
      uv: [uvX, uvY],
      pixel: [pixel[0], pixel[1]],
      cornerIndex,
      worldPoint: hit.point.clone(),
    };
  }

  return null;
}

function isLayerVisibleInTree(
  layers: readonly LayerItem[],
  layerId: string
): boolean {
  const byId = new Map(layers.map((l) => [l.id, l]));
  let cur = byId.get(layerId);
  const visited = new Set<string>();
  while (cur) {
    if (!cur.visible) return false;
    if (!cur.parentId || visited.has(cur.id)) break;
    visited.add(cur.id);
    cur = byId.get(cur.parentId);
  }
  return true;
}

function resolveTargetDrawLayer(preferredLayerId?: string): LayerItem | null {
  const state = useEditorStore.getState();
  const layers = state.layers;

  const isWritableRaster = (l: LayerItem | undefined): l is LayerItem =>
    Boolean(
      l &&
        l.kind === "raster" &&
        !isLayerEffectivelyLocked(layers, l.id)
    );

  if (preferredLayerId) {
    const preferred = layers.find((l) => l.id === preferredLayerId);
    if (isWritableRaster(preferred)) {
      return preferred;
    }
  }

  const active = layers.find((l) => l.id === state.activeLayerId);
  if (isWritableRaster(active)) {
    return active;
  }

  const visibleUnlocked = layers.find(
    (l) => isWritableRaster(l) && isLayerVisibleInTree(layers, l.id)
  );
  if (visibleUnlocked) return visibleUnlocked;

  return layers.find((l) => isWritableRaster(l)) ?? null;
}

function buildFaceUvMask(
  node: ModelNode,
  faceId: string
): FaceUvPolygonMask | null {
  if (node.kind === "cuboid" && node.cuboid && isCuboidFaceName(faceId)) {
    const faceUv = node.cuboid.faces[faceId];
    if (!faceUv) return null;
    const minU = Math.min(faceUv.uv[0], faceUv.uv[2]);
    const maxU = Math.max(faceUv.uv[0], faceUv.uv[2]);
    const minV = Math.min(faceUv.uv[1], faceUv.uv[3]);
    const maxV = Math.max(faceUv.uv[1], faceUv.uv[3]);
    const x0 = Math.floor(minU);
    const y0 = Math.floor(minV);
    const x1 = Math.max(x0, Math.ceil(maxU) - 1);
    const y1 = Math.max(y0, Math.ceil(maxV) - 1);
    return {
      nodeId: node.id,
      faceId,
      minX: x0,
      maxX: x1,
      minY: y0,
      maxY: y1,
      polygon: null,
      isRect: true,
    };
  }

  if (node.kind === "mesh" && node.mesh) {
    const face = node.mesh.faces.find((f) => f.id === faceId);
    if (!face || face.uvs.length < 3) return null;

    let minU = Infinity;
    let maxU = -Infinity;
    let minV = Infinity;
    let maxV = -Infinity;
    for (const [u, v] of face.uvs) {
      if (u < minU) minU = u;
      if (u > maxU) maxU = u;
      if (v < minV) minV = v;
      if (v > maxV) maxV = v;
    }

    const x0 = Math.floor(minU);
    const y0 = Math.floor(minV);
    const x1 = Math.max(x0, Math.ceil(maxU) - 1);
    const y1 = Math.max(y0, Math.ceil(maxV) - 1);

    return {
      nodeId: node.id,
      faceId,
      minX: x0,
      maxX: x1,
      minY: y0,
      maxY: y1,
      polygon: face.uvs.map(([u, v]): Vec2 => [u, v]),
      isRect: false,
    };
  }

  return null;
}

function pointInPolygon2D(
  px: number,
  py: number,
  poly: ReadonlyArray<Vec2>
): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i][0];
    const yi = poly[i][1];
    const xj = poly[j][0];
    const yj = poly[j][1];
    const intersects =
      yi > py !== yj > py &&
      px < ((xj - xi) * (py - yi)) / (yj - yi) + xi;
    if (intersects) inside = !inside;
  }
  return inside;
}

function isPixelInsideFaceMask(
  px: number,
  py: number,
  mask: FaceUvPolygonMask | null
): boolean {
  if (!mask) return true;
  if (px < mask.minX || px > mask.maxX || py < mask.minY || py > mask.maxY) {
    return false;
  }
  if (mask.isRect || !mask.polygon) {
    return true;
  }
  if (pointInPolygon2D(px + 0.5, py + 0.5, mask.polygon)) {
    return true;
  }
  // Allow slight edge-center tolerance so boundary pixels on slanted triangles still receive strokes
  return (
    pointInPolygon2D(px + 0.25, py + 0.5, mask.polygon) ||
    pointInPolygon2D(px + 0.75, py + 0.5, mask.polygon) ||
    pointInPolygon2D(px + 0.5, py + 0.25, mask.polygon) ||
    pointInPolygon2D(px + 0.5, py + 0.75, mask.polygon)
  );
}

function mapAtlasPixelToTileCoord(
  atlas: PaddedTilesetAtlas,
  tileset: Tileset,
  hitNode: ModelNode | undefined,
  hitFaceId: string,
  px: number,
  py: number,
  texWidth?: number,
  texHeight?: number
): { tileId: number; tileX: number; tileY: number } | null {
  const tw = Math.max(1, tileset.tileWidth);
  const th = Math.max(1, tileset.tileHeight);
  const slotW = tw + 2;
  const slotH = th + 2;
  const isPaddedAtlas =
    texWidth === undefined ||
    texHeight === undefined ||
    (texWidth === atlas.width && texHeight === atlas.height);

  if (
    isPaddedAtlas &&
    atlas.width > 0 &&
    atlas.height > 0 &&
    px >= 0 &&
    py >= 0 &&
    px < atlas.width &&
    py < atlas.height
  ) {
    const col = Math.floor(px / slotW);
    const row = Math.floor(py / slotH);
    const tileId = row * atlas.columns + col + 1;
    const entry: PaddedTileEntry | undefined = atlas.byTileId.get(tileId);
    if (entry) {
      const lx = px - entry.innerX;
      const ly = py - entry.innerY;
      if (lx >= -1 && lx <= entry.width && ly >= -1 && ly <= entry.height) {
        return {
          tileId: entry.tileId,
          tileX: Math.max(0, Math.min(entry.width - 1, lx)),
          tileY: Math.max(0, Math.min(entry.height - 1, ly)),
        };
      }
    }
  }

  // Fallback for unpadded grid UVs or tileSource-bound faces
  if (hitNode?.kind === "mesh" && hitNode.mesh) {
    const face: PolyFace | undefined = hitNode.mesh.faces.find(
      (f) => f.id === hitFaceId
    );
    if (face?.tileSource) {
      const byUid = face.tileSource.tileUid
        ? atlas.byUid.get(face.tileSource.tileUid)
        : undefined;
      const entry = byUid ?? atlas.byTileId.get(face.tileSource.cachedTileId);
      if (entry) {
        return {
          tileId: entry.tileId,
          tileX: Math.max(0, Math.min(entry.width - 1, px % entry.width)),
          tileY: Math.max(0, Math.min(entry.height - 1, py % entry.height)),
        };
      }
    }
  }

  const unpaddedCols = Math.max(1, Math.ceil(Math.sqrt(Math.max(1, tileset.count))));
  const col = Math.floor(px / tw);
  const row = Math.floor(py / th);
  const tileId = row * unpaddedCols + col + 1;
  if (tileset.getTile(tileId)) {
    return {
      tileId,
      tileX: Math.max(0, Math.min(tw - 1, px % tw)),
      tileY: Math.max(0, Math.min(th - 1, py % th)),
    };
  }

  return null;
}

function scanlineFillFaceOnDrawBuffer(
  mask: FaceUvPolygonMask,
  buf: PixelBuffer,
  rgba: RGBA,
  opacityPct: number,
  alphaLock: boolean
): boolean {
  const x0 = Math.max(0, mask.minX);
  const x1 = Math.min(buf.width - 1, mask.maxX);
  const y0 = Math.max(0, mask.minY);
  const y1 = Math.min(buf.height - 1, mask.maxY);
  if (x0 > x1 || y0 > y1) return false;

  let changed = false;
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      if (!isPixelInsideFaceMask(x, y, mask)) continue;
      pixelEngine.history.capturePixelTile(buf, x, y);
      const dst = buf.getPixel(x, y);
      const next =
        opacityPct >= 100
          ? applyInkPixel(dst, rgba, x, y, "simple", { opacity: 100 })
          : applyInkPixel(dst, rgba, x, y, "alphaBlend", {
              opacity: opacityPct,
            });
      if (!next) continue;
      if (buf.setPixel(x, y, next[0], next[1], next[2], next[3], alphaLock)) {
        changed = true;
      }
    }
  }
  return changed;
}

function scanlineFillFaceOnTileset(
  mask: FaceUvPolygonMask,
  tileset: Tileset,
  atlas: PaddedTilesetAtlas,
  hitNode: ModelNode | undefined,
  hitFaceId: string,
  rgba: RGBA,
  opacityPct: number,
  texWidth?: number,
  texHeight?: number
): boolean {
  let changed = false;
  for (let y = mask.minY; y <= mask.maxY; y++) {
    for (let x = mask.minX; x <= mask.maxX; x++) {
      if (!isPixelInsideFaceMask(x, y, mask)) continue;
      const mapped = mapAtlasPixelToTileCoord(
        atlas,
        tileset,
        hitNode,
        hitFaceId,
        x,
        y,
        texWidth,
        texHeight
      );
      if (!mapped) continue;
      const tileBuf = tileset.getTile(mapped.tileId);
      if (!tileBuf) continue;
      const dst = tileBuf.getPixel(mapped.tileX, mapped.tileY);
      const next =
        opacityPct >= 100
          ? applyInkPixel(dst, rgba, mapped.tileX, mapped.tileY, "simple", {
              opacity: 100,
            })
          : applyInkPixel(
              dst,
              rgba,
              mapped.tileX,
              mapped.tileY,
              "alphaBlend",
              { opacity: opacityPct }
            );
      if (!next) continue;
      if (
        tileBuf.setPixel(
          mapped.tileX,
          mapped.tileY,
          next[0],
          next[1],
          next[2],
          next[3]
        )
      ) {
        changed = true;
      }
    }
  }
  return changed;
}

function resolveMaterialForHit(
  engine: Model3DEngine,
  materialId: string
): ModelMaterial {
  return (
    engine.materials.find((m) => m.id === materialId) ??
    engine.materials[0] ?? {
      id: DEFAULT_MODEL3D_MATERIAL_ID,
      name: "Draw Canvas",
      source: { kind: "draw-canvas" },
      doubleSided: false,
      alphaTest: 0.5,
      usePbrMaps: true,
    }
  );
}

/**
 * Stateful 3D viewport painting controller implementing:
 * - 2px screen-space sub-stepping across curved/slanted geometry
 * - Same-face Bresenham interpolation guard (prevents UV island seam streaking)
 * - Face-clipped wide brush masks when `lockToInitialFace` is active
 * - Coalesced `requestAnimationFrame` texture refresh callbacks
 * - Single chronological undo commit via `pixelEngine.undoCoordinator`
 */
export class Paint3DStrokeController {
  private active = false;
  private strokeOpts: Paint3DStrokeOptions | null = null;
  private activeTarget: ActiveTargetState | null = null;
  private initialFace: { nodeId: string; faceId: string } | null = null;
  private initialFaceMask: FaceUvPolygonMask | null = null;
  private lastHit: Paint3DRayHit | null = null;
  private lastClientX = 0;
  private lastClientY = 0;
  private lastVertexPaintKey = "";
  private rafFlushPending = false;
  private rafId: number | null = null;

  isPainting(): boolean {
    return this.active;
  }

  private scheduleTextureFlush(): void {
    const cb = this.strokeOpts?.onTextureDirty;
    if (!cb) return;
    if (this.rafFlushPending) return;
    this.rafFlushPending = true;
    if (typeof requestAnimationFrame === "function") {
      this.rafId = requestAnimationFrame(() => {
        this.rafFlushPending = false;
        this.rafId = null;
        this.flushPendingVisuals();
      });
    } else {
      this.rafFlushPending = false;
      this.flushPendingVisuals();
    }
  }

  private flushPendingVisuals(): void {
    if (!this.activeTarget) return;
    if (this.activeTarget.kind === "draw-canvas") {
      this.strokeOpts?.onTextureDirty?.();
      pixelEngine.emitChange();
    } else if (this.activeTarget.kind === "tileset") {
      useEditorStore.getState().bumpTilesetVersion();
      this.strokeOpts?.onTextureDirty?.();
      pixelEngine.emitChange();
    } else if (this.activeTarget.kind === "vertexColor") {
      this.strokeOpts?.onModelDirty?.();
    }
  }

  private resolveInkColor(opts: Paint3DStrokeOptions): {
    rgba: RGBA;
    opacityPct: number;
    hex: string;
  } {
    const st = useEditorStore.getState();
    const hex = opts.primaryColor ?? st.primaryColor;
    const alphaByte = opts.primaryAlpha ?? st.primaryAlpha ?? 255;
    const opacityPct = Math.max(
      1,
      Math.min(100, Math.round(opts.brushOpacity ?? st.brushOpacity ?? 100))
    );
    const rgba = hexToRgba(hex, alphaByte);
    return { rgba, opacityPct, hex };
  }

  beginStroke(
    clientX: number,
    clientY: number,
    rayParams: Omit<Paint3DRaycastParams, "clientX" | "clientY">,
    opts: Paint3DStrokeOptions
  ): boolean {
    this.cancelStroke();

    const engine = rayParams.engine ?? pixelEngine.model3d;
    const hit = raycastModel3DPaintHit({
      ...rayParams,
      clientX,
      clientY,
      engine,
      textureSizeByMaterialId:
        opts.textureSizeByMaterialId ?? rayParams.textureSizeByMaterialId,
      defaultTextureWidth:
        opts.defaultTextureWidth ?? rayParams.defaultTextureWidth,
      defaultTextureHeight:
        opts.defaultTextureHeight ?? rayParams.defaultTextureHeight,
    });
    if (!hit) return false;

    const hitNode = engine.getNode(hit.nodeId);
    if (!hitNode || hitNode.locked) return false;

    this.strokeOpts = opts;
    this.lastClientX = clientX;
    this.lastClientY = clientY;
    this.initialFace = { nodeId: hit.nodeId, faceId: hit.faceId };
    this.initialFaceMask = buildFaceUvMask(hitNode, hit.faceId);
    this.lastHit = hit;
    this.lastVertexPaintKey = "";

    // Eyedropper is immediate (no undo entry)
    if (opts.tool === "eyedropper") {
      this.runEyedropper(hit, engine);
      return true;
    }

    // Vertex Color painting modifies Model3DEngine directly
    if (opts.tool === "vertexColor") {
      const beforeSnap = pixelEngine.model3dHistory.captureSnapshot(engine);
      this.active = true;
      this.activeTarget = {
        kind: "vertexColor",
        beforeSnap,
        changed: false,
      };
      this.applyVertexColorAtHit(hit, engine, Boolean(opts.shiftKey));
      return true;
    }

    // Material-backed pixel painting ("brush" | "eraser" | "fillFace")
    const mat = resolveMaterialForHit(engine, hit.materialId);
    if (mat.source.kind === "draw-canvas") {
      const targetLayer = resolveTargetDrawLayer(mat.source.layerId);
      if (!targetLayer) {
        useEditorStore
          .getState()
          .setStatusMessage("No unlocked raster layer available for 3D paint");
        return false;
      }
      const frameIndex = useEditorStore.getState().currentFrame;
      const cel = pixelEngine.getOrCreateCel(targetLayer.id, frameIndex);
      pixelEngine.history.beginTransaction(
        targetLayer.id,
        frameIndex,
        opts.tool === "eraser"
          ? "3D Erase"
          : opts.tool === "fillFace"
            ? "3D Fill Face"
            : "3D Paint"
      );

      this.active = true;
      this.activeTarget = {
        kind: "draw-canvas",
        layerId: targetLayer.id,
        frameIndex,
        cel,
        alphaLock: targetLayer.alphaLock,
        changed: false,
      };

      if (opts.tool === "fillFace") {
        this.applyFillFace(hit, engine);
        this.endStroke();
        return true;
      }

      this.stampAtHit(hit, engine);
      return true;
    }

    if (mat.source.kind === "tileset") {
      const tileset = resolveTilesetById(mat.source.tilesetId);
      const atlas = buildPaddedTilesetAtlas(tileset);
      const beforeSnap = captureTilemapHistorySnapshot(pixelEngine);

      this.active = true;
      this.activeTarget = {
        kind: "tileset",
        tilesetId: tileset.id,
        tileset,
        atlas,
        beforeSnap,
        changed: false,
      };

      if (opts.tool === "fillFace") {
        this.applyFillFace(hit, engine);
        this.endStroke();
        return true;
      }

      this.stampAtHit(hit, engine);
      return true;
    }

    useEditorStore
      .getState()
      .setStatusMessage(
        `Material "${mat.name}" (${mat.source.kind}) is read-only in 3D Paint`
      );
    return false;
  }

  continueStroke(
    clientX: number,
    clientY: number,
    rayParams: Omit<Paint3DRaycastParams, "clientX" | "clientY">
  ): void {
    if (!this.active || !this.strokeOpts || !this.activeTarget) return;
    if (
      this.strokeOpts.tool === "eyedropper" ||
      this.strokeOpts.tool === "fillFace"
    ) {
      return;
    }

    const engine = rayParams.engine ?? pixelEngine.model3d;
    const dx = clientX - this.lastClientX;
    const dy = clientY - this.lastClientY;
    const dist = Math.hypot(dx, dy);
    const steps = Math.max(1, Math.ceil(dist / 2));

    for (let s = 1; s <= steps; s++) {
      const t = s / steps;
      const sx = this.lastClientX + dx * t;
      const sy = this.lastClientY + dy * t;
      const hit = raycastModel3DPaintHit({
        ...rayParams,
        clientX: sx,
        clientY: sy,
        engine,
        textureSizeByMaterialId:
          this.strokeOpts.textureSizeByMaterialId ??
          rayParams.textureSizeByMaterialId,
        defaultTextureWidth:
          this.strokeOpts.defaultTextureWidth ?? rayParams.defaultTextureWidth,
        defaultTextureHeight:
          this.strokeOpts.defaultTextureHeight ??
          rayParams.defaultTextureHeight,
      });

      if (!hit) {
        this.lastHit = null;
        continue;
      }

      const hitNode = engine.getNode(hit.nodeId);
      if (!hitNode || hitNode.locked) {
        this.lastHit = null;
        continue;
      }

      if (
        this.strokeOpts.lockToInitialFace &&
        this.initialFace &&
        (hit.nodeId !== this.initialFace.nodeId ||
          hit.faceId !== this.initialFace.faceId)
      ) {
        this.lastHit = null;
        continue;
      }

      if (this.activeTarget.kind === "vertexColor") {
        this.applyVertexColorAtHit(
          hit,
          engine,
          Boolean(this.strokeOpts.shiftKey)
        );
        this.lastHit = hit;
        continue;
      }

      if (
        this.lastHit &&
        this.lastHit.nodeId === hit.nodeId &&
        this.lastHit.faceId === hit.faceId
      ) {
        const line = plotBresenhamLine(
          this.lastHit.pixel[0],
          this.lastHit.pixel[1],
          hit.pixel[0],
          hit.pixel[1]
        );
        for (const pt of line) {
          this.stampPixelCoord(hit, pt.x, pt.y, engine);
        }
      } else {
        // Crossed onto a new face/node: start a fresh stamp without bridging UV seams
        this.stampAtHit(hit, engine);
      }

      this.lastHit = hit;
    }

    this.lastClientX = clientX;
    this.lastClientY = clientY;
  }

  endStroke(): boolean {
    if (this.rafId !== null && typeof cancelAnimationFrame === "function") {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
    this.rafFlushPending = false;

    if (!this.active || !this.activeTarget) {
      this.resetStrokeState();
      return false;
    }

    const target = this.activeTarget;
    const opts = this.strokeOpts;
    let committed = false;

    if (target.kind === "draw-canvas") {
      if (target.changed && pixelEngine.history.commitTransaction(target.cel)) {
        // TileHistory.onCommit automatically records "pixels" into pixelEngine.undoCoordinator
        syncHistoryAndCelState(target.layerId, target.frameIndex);
        useEditorStore.getState().setCelPopulated(
          target.layerId,
          target.frameIndex,
          !target.cel.isEmpty()
        );
        pixelEngine.emitChange();
        opts?.onTextureDirty?.();
        committed = true;
      } else {
        pixelEngine.history.cancelTransaction();
      }
    } else if (target.kind === "tileset") {
      if (target.changed) {
        const afterSnap = captureTilemapHistorySnapshot(pixelEngine);
        const label =
          opts?.tool === "eraser"
            ? "3D Tile Erase"
            : opts?.tool === "fillFace"
              ? "3D Tile Fill Face"
              : "3D Tile Paint";
        // TilemapHistory.onCommit automatically records "tileset" into pixelEngine.undoCoordinator
        pixelEngine.tilemapHistory.pushTilesetSnapshot(
          label,
          target.beforeSnap,
          afterSnap
        );
        useEditorStore.getState().bumpTilesetVersion();
        syncHistoryAndCelState();
        pixelEngine.emitChange();
        opts?.onTextureDirty?.();
        committed = true;
      }
    } else if (target.kind === "vertexColor") {
      if (target.changed) {
        const engine = pixelEngine.model3d;
        const afterSnap = pixelEngine.model3dHistory.captureSnapshot(engine);
        if (afterSnap !== target.beforeSnap) {
          pixelEngine.model3dHistory.pushUndo(
            target.beforeSnap,
            "3D Vertex Color"
          );
          pixelEngine.undoCoordinator.record("model3d", "3D Vertex Color");
          useEditorStore.getState().bumpModel3DVersion();
          pixelEngine.emitChange();
          syncHistoryAndCelState();
          opts?.onModelDirty?.();
          committed = true;
        }
      }
    }

    this.resetStrokeState();
    return committed;
  }

  cancelStroke(): void {
    if (this.rafId !== null && typeof cancelAnimationFrame === "function") {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
    this.rafFlushPending = false;
    if (this.activeTarget?.kind === "draw-canvas") {
      pixelEngine.history.cancelTransaction();
    }
    this.resetStrokeState();
  }

  private resetStrokeState(): void {
    this.active = false;
    this.strokeOpts = null;
    this.activeTarget = null;
    this.initialFace = null;
    this.initialFaceMask = null;
    this.lastHit = null;
    this.lastVertexPaintKey = "";
  }

  private runEyedropper(hit: Paint3DRayHit, engine: Model3DEngine): void {
    const mat = resolveMaterialForHit(engine, hit.materialId);
    const st = useEditorStore.getState();
    let sample: RGBA = [0, 0, 0, 0];

    if (mat.source.kind === "draw-canvas") {
      if (mat.source.layerId) {
        const cel = pixelEngine.getCel(mat.source.layerId, st.currentFrame);
        if (cel) {
          sample = cel.getPixel(hit.pixel[0], hit.pixel[1]);
        }
      } else {
        const albedoLayers = st.layers.filter(
          (l) => l.kind === "group" || (l.mapRole ?? "albedo") === "albedo"
        );
        const rgba = pixelEngine.compositeFrame(albedoLayers, st.currentFrame);
        const w = Math.max(1, pixelEngine.width);
        const h = Math.max(1, pixelEngine.height);
        if (
          hit.pixel[0] >= 0 &&
          hit.pixel[0] < w &&
          hit.pixel[1] >= 0 &&
          hit.pixel[1] < h
        ) {
          const idx = (hit.pixel[1] * w + hit.pixel[0]) * 4;
          sample = [rgba[idx], rgba[idx + 1], rgba[idx + 2], rgba[idx + 3]];
        }
      }
    } else if (mat.source.kind === "tileset") {
      const tileset = resolveTilesetById(mat.source.tilesetId);
      const atlas = buildPaddedTilesetAtlas(tileset);
      const hitNode = engine.getNode(hit.nodeId);
      const texSize = getMaterialTextureSize(
        hit.materialId,
        engine,
        this.strokeOpts?.textureSizeByMaterialId,
        this.strokeOpts?.defaultTextureWidth ?? pixelEngine.width,
        this.strokeOpts?.defaultTextureHeight ?? pixelEngine.height
      );
      const mapped = mapAtlasPixelToTileCoord(
        atlas,
        tileset,
        hitNode,
        hit.faceId,
        hit.pixel[0],
        hit.pixel[1],
        texSize.width,
        texSize.height
      );
      if (mapped) {
        const tileBuf = tileset.getTile(mapped.tileId);
        if (tileBuf) {
          sample = tileBuf.getPixel(mapped.tileX, mapped.tileY);
        }
      }
    }

    if (sample[3] > 0) {
      const hex = rgbaToHex(sample[0], sample[1], sample[2]);
      st.setPrimaryColor(hex);
      st.setStatusMessage(`Picked 3D color ${hex.toUpperCase()}`);
    } else {
      st.setStatusMessage("3D Eyedropper: transparent pixel");
    }
  }

  private applyVertexColorAtHit(
    hit: Paint3DRayHit,
    engine: Model3DEngine,
    allCorners: boolean
  ): void {
    if (!this.strokeOpts || this.activeTarget?.kind !== "vertexColor") return;

    const node = engine.getNode(hit.nodeId);
    if (!node || node.locked) return;

    const { hex } = this.resolveInkColor(this.strokeOpts);
    const dedupeKey = `${hit.nodeId}:${hit.faceId}:${allCorners ? "all" : hit.cornerIndex}:${hex}`;
    if (this.lastVertexPaintKey === dedupeKey) return;
    this.lastVertexPaintKey = dedupeKey;

    let targetFaceId = hit.faceId;
    if (node.kind === "cuboid" && node.cuboid) {
      const converted = convertNodeCuboidToMesh(node);
      if (converted.kind === "mesh" && converted.mesh) {
        node.kind = "mesh";
        node.mesh = converted.mesh;
        node.cuboid = undefined;
        targetFaceId = `cuboid-${hit.faceId}`;
      }
    }

    if (node.kind !== "mesh" || !node.mesh) return;

    const cornerArg = allCorners ? undefined : hit.cornerIndex;
    const painted = paintFaceCornerColors(
      node.mesh,
      targetFaceId,
      hex,
      cornerArg
    );
    if (painted) {
      this.activeTarget.changed = true;
      useEditorStore.getState().bumpModel3DVersion();
      this.scheduleTextureFlush();
    }
  }

  private applyFillFace(hit: Paint3DRayHit, engine: Model3DEngine): void {
    if (!this.strokeOpts || !this.activeTarget) return;
    const node = engine.getNode(hit.nodeId);
    if (!node) return;
    const mask = buildFaceUvMask(node, hit.faceId);
    if (!mask) return;

    const { rgba, opacityPct } = this.resolveInkColor(this.strokeOpts);

    if (this.activeTarget.kind === "draw-canvas") {
      const changed = scanlineFillFaceOnDrawBuffer(
        mask,
        this.activeTarget.cel,
        rgba,
        opacityPct,
        this.activeTarget.alphaLock
      );
      if (changed) {
        this.activeTarget.changed = true;
        this.flushPendingVisuals();
      }
      return;
    }

    if (this.activeTarget.kind === "tileset") {
      const texSize = getMaterialTextureSize(
        hit.materialId,
        engine,
        this.strokeOpts.textureSizeByMaterialId,
        this.strokeOpts.defaultTextureWidth ?? pixelEngine.width,
        this.strokeOpts.defaultTextureHeight ?? pixelEngine.height
      );
      const changed = scanlineFillFaceOnTileset(
        mask,
        this.activeTarget.tileset,
        this.activeTarget.atlas,
        node,
        hit.faceId,
        rgba,
        opacityPct,
        texSize.width,
        texSize.height
      );
      if (changed) {
        this.activeTarget.changed = true;
        this.flushPendingVisuals();
      }
    }
  }

  private stampAtHit(hit: Paint3DRayHit, engine: Model3DEngine): void {
    this.stampPixelCoord(hit, hit.pixel[0], hit.pixel[1], engine);
  }

  private stampPixelCoord(
    hit: Paint3DRayHit,
    cx: number,
    cy: number,
    engine: Model3DEngine
  ): void {
    if (!this.strokeOpts || !this.activeTarget) return;

    const size = Math.max(
      1,
      Math.min(
        8,
        Math.round(
          this.strokeOpts.brushSize ?? useEditorStore.getState().brushSize ?? 1
        )
      )
    );
    const shape =
      this.strokeOpts.brushShape ??
      (useEditorStore.getState().brushShape === "square" ? "square" : "circle");
    const isEraser = this.strokeOpts.tool === "eraser";
    const { rgba, opacityPct } = this.resolveInkColor(this.strokeOpts);

    const footprint = getBrushFootprint(cx, cy, {
      shape,
      size,
      opacity: opacityPct,
      pixelPerfect: false,
      spacing: 1,
    });

    const hitNode = engine.getNode(hit.nodeId);
    const faceMask =
      this.strokeOpts.lockToInitialFace && this.initialFaceMask
        ? this.initialFaceMask
        : size > 1 && hitNode
          ? buildFaceUvMask(hitNode, hit.faceId)
          : null;

    let anyChanged = false;

    if (this.activeTarget.kind === "draw-canvas") {
      const buf = this.activeTarget.cel;
      const alphaLock = this.activeTarget.alphaLock;

      for (const fp of footprint) {
        if (fp.x < 0 || fp.y < 0 || fp.x >= buf.width || fp.y >= buf.height) {
          continue;
        }
        if (faceMask && !isPixelInsideFaceMask(fp.x, fp.y, faceMask)) {
          continue;
        }
        pixelEngine.history.capturePixelTile(buf, fp.x, fp.y);
        if (isEraser) {
          if (buf.setPixel(fp.x, fp.y, 0, 0, 0, 0, alphaLock)) {
            anyChanged = true;
          }
        } else {
          const dst = buf.getPixel(fp.x, fp.y);
          const next =
            opacityPct >= 100
              ? applyInkPixel(dst, rgba, fp.x, fp.y, "simple", { opacity: 100 })
              : applyInkPixel(dst, rgba, fp.x, fp.y, "alphaBlend", {
                  opacity: opacityPct,
                });
          if (!next) continue;
          if (
            buf.setPixel(fp.x, fp.y, next[0], next[1], next[2], next[3], alphaLock)
          ) {
            anyChanged = true;
          }
        }
      }

      if (anyChanged) {
        this.activeTarget.changed = true;
        this.scheduleTextureFlush();
      }
      return;
    }

    if (this.activeTarget.kind === "tileset") {
      const { tileset, atlas } = this.activeTarget;
      const texSize = getMaterialTextureSize(
        hit.materialId,
        engine,
        this.strokeOpts.textureSizeByMaterialId,
        this.strokeOpts.defaultTextureWidth ?? pixelEngine.width,
        this.strokeOpts.defaultTextureHeight ?? pixelEngine.height
      );

      for (const fp of footprint) {
        if (faceMask && !isPixelInsideFaceMask(fp.x, fp.y, faceMask)) {
          continue;
        }
        const mapped = mapAtlasPixelToTileCoord(
          atlas,
          tileset,
          hitNode,
          hit.faceId,
          fp.x,
          fp.y,
          texSize.width,
          texSize.height
        );
        if (!mapped) continue;

        const tileBuf = tileset.getTile(mapped.tileId);
        if (!tileBuf) continue;

        if (isEraser) {
          if (tileBuf.setPixel(mapped.tileX, mapped.tileY, 0, 0, 0, 0)) {
            anyChanged = true;
          }
        } else {
          const dst = tileBuf.getPixel(mapped.tileX, mapped.tileY);
          const next =
            opacityPct >= 100
              ? applyInkPixel(dst, rgba, mapped.tileX, mapped.tileY, "simple", {
                  opacity: 100,
                })
              : applyInkPixel(
                  dst,
                  rgba,
                  mapped.tileX,
                  mapped.tileY,
                  "alphaBlend",
                  { opacity: opacityPct }
                );
          if (!next) continue;
          if (
            tileBuf.setPixel(
              mapped.tileX,
              mapped.tileY,
              next[0],
              next[1],
              next[2],
              next[3]
            )
          ) {
            anyChanged = true;
          }
        }
      }

      if (anyChanged) {
        this.activeTarget.changed = true;
        this.scheduleTextureFlush();
      }
    }
  }
}

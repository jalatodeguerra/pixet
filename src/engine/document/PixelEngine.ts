import { PixelBuffer, type RGBA } from "./PixelBuffer.ts";
import { generateGemSample, type SampleDocument } from "./samples.ts";
import { TileHistory } from "../history/TileHistory.ts";
import { UndoCoordinator } from "../history/UndoCoordinator.ts";
import {
  type AutoTileMode,
  type AutoTileRuleset,
  generate16TileAutoTileSet,
  paintAutoTileCell,
  remapAutoTileRuleset,
} from "../tiles/autoTile.ts";
import { type AutoMapRule } from "../tiles/automap.ts";
import { unpackCell } from "../tiles/cell.ts";
import { renderIsometricTilemapToBuffer } from "../tiles/isometric.ts";
import {
  generateBlob47AutoTileSet,
  remapTerrainSets,
  type TerrainSet,
} from "../tiles/terrain.ts";
import { mergeDuplicateTiles } from "../tiles/tileAuthoring.ts";
import {
  captureTilemapHistorySnapshot,
  TilemapHistory,
} from "../tiles/TilemapHistory.ts";
import {
  type BlendModeName,
  compositeSourceOnto,
  renderTilemapToBuffer,
  TilemapData,
  Tileset,
  TilesetRegistry,
} from "../tiles/TilemapEngine.ts";
import {
  type Bone,
  type RigRenderOptions,
  RigState,
  warpLayerByBone3D,
} from "../rig/RigEngine.ts";
import {
  applyPixelCleanup,
  hasPixelCleanup,
  packRgba,
} from "../rig/pixelCleanup.ts";
import {
  buildBoneTransformMap,
  skinLayerPixels,
  weightsAreHard,
} from "../rig/skinning.ts";
import { renderRigMesh } from "../rig/mesh.ts";
import { GameDataState } from "../gamedev/GameDataEngine.ts";
import { Model3DEngine } from "../model3d/Model3DEngine.ts";
import { Model3DHistory } from "../model3d/Model3DHistory.ts";
import { NodeGraphManager } from "../nodes/NodeGraph.ts";
import { NodeHistory } from "../nodes/NodeHistory.ts";
import {
  type LayerMapRole,
  type Light2DOptions,
  apply2DLighting,
  applyPaletteSwapLut,
} from "../gamedev/shaderPreview.ts";
import type {
  FloatingSelection,
  SelectionMask,
} from "../tools/selection.ts";
import {
  cloneObjectLayers,
  objectLayersEqual,
  type ObjectLayerMap,
  type TileObject,
} from "../tiles/objects.ts";
import { resolveOnionSkinFrames } from "../tools/animationHelpers.ts";
import {
  mat3ExtractEulerDeg,
  mat3Mul,
  mat3Transpose,
} from "../tools/math3d.ts";

export interface OnionSkinOptions {
  tint?: boolean;
  baseOpacity?: number;
  inFront?: boolean;
  loopWrap?: boolean;
}

export interface LayerCompositingInfo {
  id: string;
  kind: string;
  visible: boolean;
  opacity: number; // 0..100
  blendMode: BlendModeName;
  parentId?: string | null;
  clipped?: boolean;
  mapRole?: LayerMapRole;
}

function resolveLayerEffective(
  layer: LayerCompositingInfo,
  byId: Map<string, LayerCompositingInfo>
): { visible: boolean; opacity: number } {
  let visible = layer.visible;
  let opacity = Math.max(0, Math.min(1, layer.opacity / 100));
  const visited = new Set<string>([layer.id]);
  let parentId = layer.parentId ?? null;

  while (parentId) {
    if (visited.has(parentId)) break;
    visited.add(parentId);
    const parent = byId.get(parentId);
    if (!parent) break;
    if (!parent.visible) visible = false;
    opacity *= Math.max(0, Math.min(1, parent.opacity / 100));
    parentId = parent.parentId ?? null;
  }

  return { visible, opacity };
}

function splitCelKey(key: string): { layerId: string; frameIndex: number } {
  const sep = key.lastIndexOf(":");
  return {
    layerId: key.slice(0, sep),
    frameIndex: Number(key.slice(sep + 1)),
  };
}

function blendTintedScratchOver(
  dst: Uint8ClampedArray,
  scratch: Uint8ClampedArray,
  tintR: number,
  tintG: number,
  tintB: number,
  alphaScale: number
): void {
  for (let i = 0; i < scratch.length; i += 4) {
    const rawA = scratch[i + 3];
    if (rawA === 0) continue;

    const sa = (rawA / 255) * alphaScale;
    const da = dst[i + 3] / 255;
    const outA = sa + da * (1 - sa);
    if (outA <= 0) continue;

    dst[i] = Math.round((tintR * sa + dst[i] * da * (1 - sa)) / outA);
    dst[i + 1] = Math.round((tintG * sa + dst[i + 1] * da * (1 - sa)) / outA);
    dst[i + 2] = Math.round((tintB * sa + dst[i + 2] * da * (1 - sa)) / outA);
    dst[i + 3] = Math.round(outA * 255);
  }
}

function blendOriginalScratchOver(
  dst: Uint8ClampedArray,
  scratch: Uint8ClampedArray,
  alphaScale: number
): void {
  for (let i = 0; i < scratch.length; i += 4) {
    const rawA = scratch[i + 3];
    if (rawA === 0) continue;

    const sa = (rawA / 255) * alphaScale;
    const da = dst[i + 3] / 255;
    const outA = sa + da * (1 - sa);
    if (outA <= 0) continue;

    dst[i] = Math.round((scratch[i] * sa + dst[i] * da * (1 - sa)) / outA);
    dst[i + 1] = Math.round((scratch[i + 1] * sa + dst[i + 1] * da * (1 - sa)) / outA);
    dst[i + 2] = Math.round((scratch[i + 2] * sa + dst[i + 2] * da * (1 - sa)) / outA);
    dst[i + 3] = Math.round(outA * 255);
  }
}

export class PixelEngine {
  width: number;
  height: number;
  readonly cels = new Map<string, PixelBuffer>();
  readonly celLinks = new Map<string, number>();
  readonly tilesetRegistry = new TilesetRegistry();
  readonly tilemaps = new Map<string, TilemapData>();
  readonly rig = new RigState();
  readonly gameData = new GameDataState();
  readonly model3d = new Model3DEngine();
  readonly nodes = new NodeGraphManager();
  readonly history = new TileHistory(100);
  readonly tilemapHistory = new TilemapHistory(100, 50);
  readonly model3dHistory = new Model3DHistory(100);
  readonly nodesHistory = new NodeHistory(100);
  readonly undoCoordinator = new UndoCoordinator(200, [
    // Mirror each domain history's own cap so the coordinator never keeps an
    // entry whose payload the domain history already dropped.
    { kinds: ["pixels"], limit: 100 },
    { kinds: ["cells"], limit: 100 },
    { kinds: ["tileset"], limit: 50 },
    { kinds: ["model3d"], limit: 100 },
    { kinds: ["rig"], limit: 100 },
    { kinds: ["nodes"], limit: 100 },
  ]);

  get tileset(): Tileset {
    return this.tilesetRegistry.tilesets[0];
  }
  compositeBuffer: Uint8ClampedArray;
  overlayBuffer: PixelBuffer;
  onionBuffer: Uint8ClampedArray;
  private onionScratch: Uint8ClampedArray;

  selection: SelectionMask | null = null;
  floating: FloatingSelection | null = null;
  clipboard: PixelBuffer | null = null;
  autoTileRuleset: AutoTileRuleset | null = null;
  terrainSets: TerrainSet[] = [];
  autoMapRules: AutoMapRule[] = [];
  /** Object layers (T5): layer id -> objects in pixel coordinates. */
  objectLayers: ObjectLayerMap = new Map();
  tileProjection: "orthogonal" | "isometric" = "orthogonal";
  tileAnimationElapsedMs: number | undefined = undefined;

  private listeners = new Set<() => void>();
  /** R6 deformed-layer cache keyed by (frame, rig revision, cel revision, ...). */
  private rigDeformCache = new Map<string, PixelBuffer>();

  constructor(width = 32, height = 32) {
    this.width = width;
    this.height = height;
    const byteLen = width * height * 4;
    this.compositeBuffer = new Uint8ClampedArray(byteLen);
    this.overlayBuffer = new PixelBuffer(width, height);
    this.onionBuffer = new Uint8ClampedArray(byteLen);
    this.onionScratch = new Uint8ClampedArray(byteLen);
    this.history.onCommit = (label) =>
      this.undoCoordinator.record("pixels", label);
    this.tilemapHistory.onCommit = (kind, label) =>
      this.undoCoordinator.record(kind, label);
    this.nodesHistory.onCommit = (label, graphId) =>
      this.undoCoordinator.record("nodes", label, graphId);
    this.undoCoordinator.onRedoCleared(() => this.nodesHistory.clearRedo());
    this.tileset.seedStarterTiles();
  }

  resetForDocument(width: number, height: number): void {
    this.width = width;
    this.height = height;
    const byteLen = width * height * 4;
    this.compositeBuffer = new Uint8ClampedArray(byteLen);
    this.overlayBuffer = new PixelBuffer(width, height);
    this.onionBuffer = new Uint8ClampedArray(byteLen);
    this.onionScratch = new Uint8ClampedArray(byteLen);
    this.cels.clear();
    this.celLinks.clear();
    this.tilemaps.clear();
    this.tilesetRegistry.resetDefault();
    this.autoTileRuleset = null;
    this.terrainSets = [];
    this.autoMapRules = [];
    this.objectLayers = new Map();
    this.rig.reset();
    this.gameData.reset();
    this.model3d.reset();
    this.nodes.reset();
    this.history.clear();
    this.tilemapHistory.clear();
    this.model3dHistory.clear();
    this.nodesHistory.clear();
    this.undoCoordinator.clear();
    this.rigDeformCache.clear();
    this.selection = null;
    this.floating = null;
  }

  resizeCanvas(
    newWidth: number,
    newHeight: number,
    anchorX: 0 | 1 | 2 = 1,
    anchorY: 0 | 1 | 2 = 1
  ): void {
    const w = Math.max(1, Math.min(1024, Math.round(newWidth)));
    const h = Math.max(1, Math.min(1024, Math.round(newHeight)));
    if (w === this.width && h === this.height) return;

    const dx =
      anchorX === 0
        ? 0
        : anchorX === 1
          ? Math.floor((w - this.width) / 2)
          : w - this.width;
    const dy =
      anchorY === 0
        ? 0
        : anchorY === 1
          ? Math.floor((h - this.height) / 2)
          : h - this.height;

    for (const [key, oldCel] of this.cels.entries()) {
      const nextCel = new PixelBuffer(w, h);
      for (let sy = 0; sy < oldCel.height; sy++) {
        const ty = sy + dy;
        if (ty < 0 || ty >= h) continue;
        for (let sx = 0; sx < oldCel.width; sx++) {
          const tx = sx + dx;
          if (tx < 0 || tx >= w) continue;
          const [r, g, b, a] = oldCel.getPixel(sx, sy);
          if (a > 0) {
            nextCel.setPixel(tx, ty, r, g, b, a);
          }
        }
      }
      nextCel.markAllDirty();
      this.cels.set(key, nextCel);
    }

    const cols = Math.max(1, Math.ceil(w / this.tileset.tileWidth));
    const rows = Math.max(1, Math.ceil(h / this.tileset.tileHeight));
    for (const tm of this.tilemaps.values()) {
      tm.resize(cols, rows);
    }

    this.width = w;
    this.height = h;
    const byteLen = w * h * 4;
    this.compositeBuffer = new Uint8ClampedArray(byteLen);
    this.overlayBuffer = new PixelBuffer(w, h);
    this.onionBuffer = new Uint8ClampedArray(byteLen);
    this.onionScratch = new Uint8ClampedArray(byteLen);
    this.selection = null;
    this.floating = null;
    this.history.clear();
    this.rigDeformCache.clear();
    this.emitChange();
  }

  applyResizedCanvasDimensions(newWidth: number, newHeight: number): void {
    const w = Math.max(1, Math.min(2048, Math.round(newWidth)));
    const h = Math.max(1, Math.min(2048, Math.round(newHeight)));

    const cols = Math.max(1, Math.ceil(w / this.tileset.tileWidth));
    const rows = Math.max(1, Math.ceil(h / this.tileset.tileHeight));
    for (const tm of this.tilemaps.values()) {
      tm.resize(cols, rows);
    }

    this.width = w;
    this.height = h;
    const byteLen = w * h * 4;
    this.compositeBuffer = new Uint8ClampedArray(byteLen);
    this.overlayBuffer = new PixelBuffer(w, h);
    this.onionBuffer = new Uint8ClampedArray(byteLen);
    this.onionScratch = new Uint8ClampedArray(byteLen);
    this.selection = null;
    this.floating = null;
    this.history.clear();
    this.undoCoordinator.clear();
    this.rigDeformCache.clear();
    this.emitChange();
  }

  private celKey(layerId: string, frameIndex: number): string {
    return `${layerId}:${frameIndex}`;
  }

  resolveCelFrame(layerId: string, frameIndex: number): number {
    let cur = frameIndex;
    const visited = new Set<number>([cur]);
    while (true) {
      const target = this.celLinks.get(this.celKey(layerId, cur));
      if (target === undefined || visited.has(target)) break;
      visited.add(target);
      cur = target;
    }
    return cur;
  }

  isCelLinked(layerId: string, frameIndex: number): boolean {
    return this.celLinks.has(this.celKey(layerId, frameIndex));
  }

  getCel(layerId: string, frameIndex: number): PixelBuffer | undefined {
    const owner = this.resolveCelFrame(layerId, frameIndex);
    return this.cels.get(this.celKey(layerId, owner));
  }

  getOrCreateCel(layerId: string, frameIndex: number): PixelBuffer {
    const owner = this.resolveCelFrame(layerId, frameIndex);
    const key = this.celKey(layerId, owner);
    let buf = this.cels.get(key);
    if (!buf) {
      buf = new PixelBuffer(this.width, this.height);
      this.cels.set(key, buf);
    }
    return buf;
  }

  linkCel(
    layerId: string,
    frameIndex: number,
    targetFrameIndex: number
  ): boolean {
    const owner = this.resolveCelFrame(layerId, targetFrameIndex);
    if (owner === frameIndex) return false;

    this.getOrCreateCel(layerId, owner);
    this.cels.delete(this.celKey(layerId, frameIndex));

    // Repoint any cel that previously linked to `frameIndex` so no chains break
    for (const [k, target] of this.celLinks.entries()) {
      const parsed = splitCelKey(k);
      if (parsed.layerId === layerId && target === frameIndex) {
        this.celLinks.set(k, owner);
      }
    }

    this.celLinks.set(this.celKey(layerId, frameIndex), owner);
    return true;
  }

  unlinkCel(layerId: string, frameIndex: number): boolean {
    const key = this.celKey(layerId, frameIndex);
    if (!this.celLinks.has(key)) return false;

    const owner = this.resolveCelFrame(layerId, frameIndex);
    const ownerBuf = this.cels.get(this.celKey(layerId, owner));
    this.celLinks.delete(key);
    this.cels.set(
      key,
      ownerBuf ? ownerBuf.clone() : new PixelBuffer(this.width, this.height)
    );
    return true;
  }

  private remapFrameIndices(oldToNew: Map<number, number>): void {
    const nextCels = new Map<string, PixelBuffer>();
    for (const [k, buf] of this.cels.entries()) {
      const { layerId, frameIndex } = splitCelKey(k);
      const mapped = oldToNew.get(frameIndex);
      if (mapped !== undefined) {
        nextCels.set(this.celKey(layerId, mapped), buf);
      }
    }
    this.cels.clear();
    for (const [k, buf] of nextCels.entries()) {
      this.cels.set(k, buf);
    }

    const nextLinks = new Map<string, number>();
    for (const [k, target] of this.celLinks.entries()) {
      const { layerId, frameIndex } = splitCelKey(k);
      const mappedFrame = oldToNew.get(frameIndex);
      const mappedTarget = oldToNew.get(target);
      if (
        mappedFrame !== undefined &&
        mappedTarget !== undefined &&
        mappedFrame !== mappedTarget
      ) {
        nextLinks.set(this.celKey(layerId, mappedFrame), mappedTarget);
      }
    }
    this.celLinks.clear();
    for (const [k, target] of nextLinks.entries()) {
      this.celLinks.set(k, target);
    }

    const nextTilemaps = new Map<string, TilemapData>();
    for (const [k, tm] of this.tilemaps.entries()) {
      const { layerId, frameIndex } = splitCelKey(k);
      const mapped = oldToNew.get(frameIndex);
      if (mapped !== undefined) {
        nextTilemaps.set(this.celKey(layerId, mapped), tm);
      }
    }
    this.tilemaps.clear();
    for (const [k, tm] of nextTilemaps.entries()) {
      this.tilemaps.set(k, tm);
    }
  }

  getTilemap(layerId: string, frameIndex: number): TilemapData | undefined {
    const owner = this.resolveCelFrame(layerId, frameIndex);
    return this.tilemaps.get(this.celKey(layerId, owner));
  }

  getOrCreateTilemap(layerId: string, frameIndex: number): TilemapData {
    const owner = this.resolveCelFrame(layerId, frameIndex);
    const key = this.celKey(layerId, owner);
    let tm = this.tilemaps.get(key);
    if (!tm) {
      const cols = Math.max(1, Math.ceil(this.width / this.tileset.tileWidth));
      const rows = Math.max(1, Math.ceil(this.height / this.tileset.tileHeight));
      tm = new TilemapData(cols, rows);
      this.tilemaps.set(key, tm);
    }
    return tm;
  }

  setTilemapCell(
    layerId: string,
    frameIndex: number,
    col: number,
    row: number,
    tileId: number
  ): boolean {
    const tm = this.getOrCreateTilemap(layerId, frameIndex);
    return tm.setCell(col, row, tileId);
  }

  editTilePixelAtCanvasCoord(
    layerId: string,
    frameIndex: number,
    px: number,
    py: number,
    rgba: RGBA,
    alphaLock: boolean,
    activeTileId: number
  ): { tileId: number; changed: boolean } {
    if (px < 0 || py < 0 || px >= this.width || py >= this.height) {
      return { tileId: 0, changed: false };
    }
    const tw = this.tileset.tileWidth;
    const th = this.tileset.tileHeight;
    const col = Math.floor(px / tw);
    const row = Math.floor(py / th);
    const lx = px % tw;
    const ly = py % th;

    const tm = this.getOrCreateTilemap(layerId, frameIndex);
    const cellVal = tm.getCell(col, row);
    const unpacked = unpackCell(cellVal);
    let cellTileId = unpacked.localId;
    const tsIndex = unpacked.localId > 0 ? unpacked.tilesetIndex : 0;
    const ts = this.tilesetRegistry.get(tsIndex) ?? this.tileset;

    if (cellTileId === 0) {
      if (rgba[3] === 0) {
        return { tileId: 0, changed: false };
      }
      if (activeTileId > 0 && ts.getTile(activeTileId)) {
        cellTileId = activeTileId;
      } else {
        cellTileId = ts.addTile();
      }
      tm.setCell(col, row, cellTileId);
    }

    const tileBuf = ts.getTile(cellTileId);
    if (!tileBuf) return { tileId: 0, changed: false };

    const changed = tileBuf.setPixel(
      lx,
      ly,
      rgba[0],
      rgba[1],
      rgba[2],
      rgba[3],
      alphaLock
    );
    return { tileId: cellTileId, changed };
  }

  deleteTileFromTileset(tileId: number, tilesetIndex = 0): boolean {
    const ts = this.tilesetRegistry.get(tilesetIndex);
    if (!ts) return false;
    const remap = ts.deleteTileWithRemap(tileId);
    if (!remap) return false;
    for (const tm of this.tilemaps.values()) {
      tm.remapTileIds(tilesetIndex, remap);
    }
    if (tilesetIndex === 0 && this.autoTileRuleset) {
      if (!remapAutoTileRuleset(this.autoTileRuleset, remap)) {
        this.autoTileRuleset = null;
      }
    }
    remapTerrainSets(this.terrainSets, tilesetIndex, remap);
    this.emitChange();
    return true;
  }

  reorderTilesInTileset(newOrder: number[], tilesetIndex = 0): boolean {
    const ts = this.tilesetRegistry.get(tilesetIndex);
    if (!ts) return false;
    const remap = ts.reorderTiles(newOrder);
    if (!remap) return false;
    for (const tm of this.tilemaps.values()) {
      tm.remapTileIds(tilesetIndex, remap);
    }
    if (tilesetIndex === 0 && this.autoTileRuleset) {
      if (!remapAutoTileRuleset(this.autoTileRuleset, remap)) {
        this.autoTileRuleset = null;
      }
    }
    remapTerrainSets(this.terrainSets, tilesetIndex, remap);
    this.emitChange();
    return true;
  }

  getObjects(layerId: string): TileObject[] {
    return this.objectLayers.get(layerId) ?? [];
  }

  /** Run an object-layer edit as one undoable step (Ctrl+Z via tilemapHistory). */
  recordObjectOp<T>(label: string, fn: () => T): T {
    const before = cloneObjectLayers(this.objectLayers);
    const result = fn();
    this.pushObjectHistory(label, before);
    return result;
  }

  /** Push an undo entry for edits already applied since `before` was captured. */
  pushObjectHistory(label: string, before: ObjectLayerMap): void {
    if (objectLayersEqual(before, this.objectLayers)) return;
    this.tilemapHistory.pushObjectSnapshot(label, before, this.objectLayers);
    this.emitChange();
  }

  recordTilesetOp<T>(label: string, fn: () => T): T {
    const before = captureTilemapHistorySnapshot(this);
    const result = fn();
    const after = captureTilemapHistorySnapshot(this);
    this.tilemapHistory.pushTilesetSnapshot(label, before, after);
    return result;
  }

  setTileProjection(proj: "orthogonal" | "isometric"): void {
    this.tileProjection = proj;
    this.emitChange();
  }

  generateAutoTileTerrain(): AutoTileRuleset {
    const ruleset = generate16TileAutoTileSet(this.tileset);
    this.autoTileRuleset = ruleset;
    this.emitChange();
    return ruleset;
  }

  generateBlob47Terrain(tilesetIndex = 0): TerrainSet {
    const ts = this.tilesetRegistry.get(tilesetIndex) ?? this.tileset;
    const set = generateBlob47AutoTileSet(ts, tilesetIndex);
    this.terrainSets.push(set);
    this.emitChange();
    return set;
  }

  hasAnimatedTiles(): boolean {
    for (const ts of this.tilesetRegistry.tilesets) {
      for (let i = 1; i < ts.meta.length; i++) {
        if ((ts.meta[i]?.animation?.frames.length ?? 0) > 1) {
          return true;
        }
      }
    }
    return false;
  }

  mergeDuplicateTilesInTileset(tilesetIndex = 0): number {
    const ts = this.tilesetRegistry.get(tilesetIndex);
    if (!ts) return 0;
    const { remap, mergedCount } = mergeDuplicateTiles(ts);
    if (mergedCount === 0) return 0;
    for (const tm of this.tilemaps.values()) {
      tm.remapTileIds(tilesetIndex, remap);
    }
    if (tilesetIndex === 0 && this.autoTileRuleset) {
      if (!remapAutoTileRuleset(this.autoTileRuleset, remap)) {
        this.autoTileRuleset = null;
      }
    }
    remapTerrainSets(this.terrainSets, tilesetIndex, remap);
    this.emitChange();
    return mergedCount;
  }

  paintAutoTileAtCell(
    layerId: string,
    frameIndex: number,
    col: number,
    row: number,
    erase: boolean,
    modeOverride?: AutoTileMode
  ): number {
    if (!this.autoTileRuleset) return 0;
    const tm = this.getOrCreateTilemap(layerId, frameIndex);
    return paintAutoTileCell(
      tm,
      col,
      row,
      this.autoTileRuleset,
      erase,
      modeOverride
    );
  }

  resizeTileset(tileWidth: number, tileHeight: number): void {
    this.tileset.resizeTiles(tileWidth, tileHeight);
    const cols = Math.max(1, Math.ceil(this.width / this.tileset.tileWidth));
    const rows = Math.max(1, Math.ceil(this.height / this.tileset.tileHeight));
    for (const tm of this.tilemaps.values()) {
      tm.resize(cols, rows);
    }
    this.emitChange();
  }

  insertEmptyFrame(atIndex: number, totalFramesBefore: number): void {
    const map = new Map<number, number>();
    for (let i = 0; i < totalFramesBefore; i++) {
      map.set(i, i >= atIndex ? i + 1 : i);
    }
    this.remapFrameIndices(map);
  }

  duplicateFrame(sourceIndex: number, totalFramesBefore: number): void {
    const map = new Map<number, number>();
    for (let i = 0; i < totalFramesBefore; i++) {
      map.set(i, i > sourceIndex ? i + 1 : i);
    }
    this.remapFrameIndices(map);

    const layerIds = new Set<string>();
    for (const k of this.cels.keys()) {
      layerIds.add(splitCelKey(k).layerId);
    }
    for (const k of this.celLinks.keys()) {
      layerIds.add(splitCelKey(k).layerId);
    }

    for (const layerId of layerIds) {
      const srcBuf = this.getCel(layerId, sourceIndex);
      if (srcBuf) {
        this.cels.set(this.celKey(layerId, sourceIndex + 1), srcBuf.clone());
      }
    }

    const tmLayerIds = new Set<string>();
    for (const k of this.tilemaps.keys()) {
      tmLayerIds.add(splitCelKey(k).layerId);
    }
    for (const layerId of tmLayerIds) {
      const srcTm = this.getTilemap(layerId, sourceIndex);
      if (srcTm) {
        this.tilemaps.set(this.celKey(layerId, sourceIndex + 1), srcTm.clone());
      }
    }
  }

  deleteFrame(frameIndex: number, totalFramesBefore: number): void {
    if (totalFramesBefore <= 1) return;

    const layerIds = new Set<string>();
    for (const k of this.cels.keys()) {
      layerIds.add(splitCelKey(k).layerId);
    }
    for (const k of this.celLinks.keys()) {
      layerIds.add(splitCelKey(k).layerId);
    }

    // Promote any cel linked to `frameIndex` so linked frames preserve pixels
    for (const layerId of layerIds) {
      const dependents: number[] = [];
      for (const [k, target] of this.celLinks.entries()) {
        const parsed = splitCelKey(k);
        if (parsed.layerId === layerId && target === frameIndex && parsed.frameIndex !== frameIndex) {
          dependents.push(parsed.frameIndex);
        }
      }
      if (dependents.length > 0) {
        dependents.sort((a, b) => a - b);
        const promoter = dependents[0];
        const srcBuf = this.cels.get(this.celKey(layerId, frameIndex));
        this.celLinks.delete(this.celKey(layerId, promoter));
        if (srcBuf) {
          this.cels.set(this.celKey(layerId, promoter), srcBuf.clone());
        }
        for (let i = 1; i < dependents.length; i++) {
          this.celLinks.set(this.celKey(layerId, dependents[i]), promoter);
        }
      }
    }

    const map = new Map<number, number>();
    for (let i = 0; i < totalFramesBefore; i++) {
      if (i < frameIndex) map.set(i, i);
      else if (i > frameIndex) map.set(i, i - 1);
    }
    this.remapFrameIndices(map);
  }

  reorderFrame(fromIndex: number, toIndex: number, totalFrames: number): void {
    if (
      fromIndex === toIndex ||
      fromIndex < 0 ||
      toIndex < 0 ||
      fromIndex >= totalFrames ||
      toIndex >= totalFrames
    ) {
      return;
    }

    const perm = Array.from({ length: totalFrames }, (_, i) => i);
    const [moved] = perm.splice(fromIndex, 1);
    perm.splice(toIndex, 0, moved);

    const map = new Map<number, number>();
    for (let newIdx = 0; newIdx < perm.length; newIdx++) {
      map.set(perm[newIdx], newIdx);
    }
    this.remapFrameIndices(map);
  }

  reverseFrameRange(fromFrame: number, toFrame: number, totalFrames: number): void {
    const lo = Math.max(0, Math.min(totalFrames - 1, Math.min(fromFrame, toFrame)));
    const hi = Math.max(0, Math.min(totalFrames - 1, Math.max(fromFrame, toFrame)));
    if (lo >= hi) return;

    const map = new Map<number, number>();
    for (let i = 0; i < totalFrames; i++) {
      if (i >= lo && i <= hi) {
        map.set(i, hi - (i - lo));
      } else {
        map.set(i, i);
      }
    }
    this.remapFrameIndices(map);
  }

  duplicateLayerCels(sourceLayerId: string, targetLayerId: string): void {
    const prefix = `${sourceLayerId}:`;
    const additions: Array<[string, PixelBuffer]> = [];
    for (const [key, buf] of this.cels.entries()) {
      if (key.startsWith(prefix)) {
        const framePart = key.slice(prefix.length);
        additions.push([`${targetLayerId}:${framePart}`, buf.clone()]);
      }
    }
    for (const [newKey, cloned] of additions) {
      this.cels.set(newKey, cloned);
    }

    const linkAdditions: Array<[string, number]> = [];
    for (const [key, target] of this.celLinks.entries()) {
      if (key.startsWith(prefix)) {
        const framePart = key.slice(prefix.length);
        linkAdditions.push([`${targetLayerId}:${framePart}`, target]);
      }
    }
    for (const [newKey, target] of linkAdditions) {
      this.celLinks.set(newKey, target);
    }

    const tmAdditions: Array<[string, TilemapData]> = [];
    for (const [key, tm] of this.tilemaps.entries()) {
      if (key.startsWith(prefix)) {
        const framePart = key.slice(prefix.length);
        tmAdditions.push([`${targetLayerId}:${framePart}`, tm.clone()]);
      }
    }
    for (const [newKey, cloned] of tmAdditions) {
      this.tilemaps.set(newKey, cloned);
    }

    this.emitChange();
  }

  setSelection(mask: SelectionMask | null): void {
    this.selection = mask && !mask.isEmpty() ? mask : null;
    this.emitChange();
  }

  clearSelection(): void {
    this.selection = null;
    this.emitChange();
  }

  private compositeLayersInto(
    dst: Uint8ClampedArray,
    layers: readonly LayerCompositingInfo[],
    frameIndex: number,
    includeFloating: boolean
  ): void {
    dst.fill(0);

    const byId = new Map<string, LayerCompositingInfo>();
    for (const l of layers) {
      byId.set(l.id, l);
    }

    const activeFloat =
      includeFloating &&
      this.floating &&
      this.floating.sourceFrameIndex === frameIndex
        ? this.floating
        : null;
    let floatingComposited = false;
    let clipBaseAlpha: Uint8Array | null = null;
    const pixelCount = this.width * this.height;

    // `layers` is ordered top-to-bottom in UI; composite bottom-to-top.
    for (let li = layers.length - 1; li >= 0; li--) {
      const layer = layers[li];
      if (layer.kind === "group") continue;

      const effective = resolveLayerEffective(layer, byId);
      const isClipped = Boolean(layer.clipped);
      if (!effective.visible || effective.opacity <= 0) {
        if (!isClipped && (layer.kind === "raster" || layer.kind === "tilemap")) {
          clipBaseAlpha = null;
        }
        if (activeFloat && activeFloat.sourceLayerId === layer.id) {
          floatingComposited = true;
        }
        continue;
      }

      if (isClipped && !clipBaseAlpha) {
        if (activeFloat && activeFloat.sourceLayerId === layer.id) {
          floatingComposited = true;
        }
        continue;
      }

      const activeClipMask = isClipped ? clipBaseAlpha : null;

      if (!isClipped && (layer.kind === "raster" || layer.kind === "tilemap")) {
        const baseAlpha = new Uint8Array(pixelCount);
        if (layer.kind === "tilemap") {
          const tm = this.getTilemap(layer.id, frameIndex);
          if (tm) {
            const scratch = new Uint8ClampedArray(pixelCount * 4);
            if (this.tileProjection === "isometric") {
              renderIsometricTilemapToBuffer(
                tm,
                this.tilesetRegistry,
                scratch,
                this.width,
                this.height,
                effective.opacity,
                "Normal",
                this.tileAnimationElapsedMs
              );
            } else {
              renderTilemapToBuffer(
                tm,
                this.tilesetRegistry,
                scratch,
                this.width,
                this.height,
                effective.opacity,
                "Normal",
                this.tileAnimationElapsedMs
              );
            }
            for (let p = 0; p < pixelCount; p++) {
              baseAlpha[p] = scratch[p * 4 + 3];
            }
          }
        } else {
          const cel = this.getCel(layer.id, frameIndex);
          if (cel) {
            for (let p = 0; p < pixelCount; p++) {
              const a = cel.data[p * 4 + 3];
              if (a > 0) {
                baseAlpha[p] = Math.round(a * effective.opacity);
              }
            }
          }
          if (activeFloat && activeFloat.sourceLayerId === layer.id) {
            const fBuf = activeFloat.pixels;
            for (let sy = 0; sy < fBuf.height; sy++) {
              const dy = activeFloat.offsetY + sy;
              if (dy < 0 || dy >= this.height) continue;
              for (let sx = 0; sx < fBuf.width; sx++) {
                const dx = activeFloat.offsetX + sx;
                if (dx < 0 || dx >= this.width) continue;
                const fa = fBuf.data[(sy * fBuf.width + sx) * 4 + 3];
                if (fa === 0) continue;
                const p = dy * this.width + dx;
                const sa = (fa / 255) * effective.opacity;
                const da = baseAlpha[p] / 255;
                baseAlpha[p] = Math.round((sa + da * (1 - sa)) * 255);
              }
            }
          }
        }
        clipBaseAlpha = baseAlpha;
      }

      if (layer.kind === "tilemap") {
        const tm = this.getTilemap(layer.id, frameIndex);
        if (tm) {
          if (this.tileProjection === "isometric") {
            renderIsometricTilemapToBuffer(
              tm,
              this.tilesetRegistry,
              dst,
              this.width,
              this.height,
              effective.opacity,
              layer.blendMode,
              this.tileAnimationElapsedMs,
              activeClipMask
            );
          } else {
            renderTilemapToBuffer(
              tm,
              this.tilesetRegistry,
              dst,
              this.width,
              this.height,
              effective.opacity,
              layer.blendMode,
              this.tileAnimationElapsedMs,
              activeClipMask
            );
          }
        }
      } else {
        const cel = this.getCel(layer.id, frameIndex);
        if (cel) {
          compositeSourceOnto(
            dst,
            this.width,
            this.height,
            cel,
            0,
            0,
            effective.opacity,
            layer.blendMode,
            activeClipMask
          );
        }
      }

      if (activeFloat && activeFloat.sourceLayerId === layer.id) {
        compositeSourceOnto(
          dst,
          this.width,
          this.height,
          activeFloat.pixels,
          activeFloat.offsetX,
          activeFloat.offsetY,
          effective.opacity,
          layer.blendMode,
          activeClipMask
        );
        floatingComposited = true;
      }
    }

    if (activeFloat && !floatingComposited) {
      compositeSourceOnto(
        dst,
        this.width,
        this.height,
        activeFloat.pixels,
        activeFloat.offsetX,
        activeFloat.offsetY,
        1,
        "Normal"
      );
    }
  }

  compositeFrame(
    layers: readonly LayerCompositingInfo[],
    frameIndex: number
  ): Uint8ClampedArray {
    this.compositeLayersInto(this.compositeBuffer, layers, frameIndex, true);
    return this.compositeBuffer;
  }

  compositeRigFrame(
    layers: readonly LayerCompositingInfo[],
    frameIndex: number,
    opts: RigRenderOptions,
    useOverrides = true
  ): Uint8ClampedArray {
    if (this.rig.bones.length === 0) {
      return this.compositeFrame(layers, frameIndex);
    }

    const dst = this.compositeBuffer;
    dst.fill(0);

    const byId = new Map<string, LayerCompositingInfo>();
    for (const l of layers) {
      byId.set(l.id, l);
    }

    const rootOrbit = opts.rootOrbit ?? null;
    const restMap = this.rig.computeFlatRestTransforms();
    const poseMap =
      opts.mode === "rest"
        ? this.rig.computeWorldTransforms(frameIndex, "rest", false, rootOrbit)
        : this.rig.computeWorldTransforms(
            frameIndex,
            "pose",
            useOverrides,
            rootOrbit
          );

    const boneById = new Map<string, Bone>();
    const layerToBoneId = new Map<string, string>();
    for (const bone of this.rig.bones) {
      boneById.set(bone.id, bone);
      if (bone.boundLayerId) {
        layerToBoneId.set(bone.boundLayerId, bone.id);
      }
    }

    let has3dBoneActivity = Boolean(
      rootOrbit &&
        (Math.abs(rootOrbit.yawDeg) > 0.05 ||
          Math.abs(rootOrbit.pitchDeg) > 0.05)
    );
    if (!has3dBoneActivity) {
      for (const bone of this.rig.bones) {
        if ((bone.extrudeDepth ?? 0) > 0) {
          has3dBoneActivity = true;
          break;
        }
        const rest = restMap.get(bone.id);
        const posed = poseMap.get(bone.id);
        if (!rest || !posed) continue;
        if (
          posed.facingZ < 0 ||
          Math.abs(posed.z) > 1e-4 ||
          Math.abs(posed.tipZ) > 1e-4
        ) {
          has3dBoneActivity = true;
          break;
        }
        const rDelta = mat3Mul(posed.worldMatrix, mat3Transpose(rest.worldMatrix));
        const { yawDeg, pitchDeg } = mat3ExtractEulerDeg(rDelta);
        if (Math.abs(yawDeg) > 0.05 || Math.abs(pitchDeg) > 0.05) {
          has3dBoneActivity = true;
          break;
        }
      }
    }

    const resolveBackSource = (bone: Bone | undefined): PixelBuffer | null => {
      const backId = bone?.backLayerId;
      if (!backId) return null;
      let backCel = this.getCel(backId, frameIndex);
      if ((!backCel || backCel.isEmpty()) && frameIndex > 0) {
        const fallback = this.getCel(backId, 0);
        if (fallback && !fallback.isEmpty()) {
          backCel = fallback;
        }
      }
      return backCel && !backCel.isEmpty() ? backCel : null;
    };

    const orbitKey = rootOrbit
      ? `${rootOrbit.yawDeg},${rootOrbit.pitchDeg},${rootOrbit.rollDeg},${rootOrbit.originX},${rootOrbit.originY}`
      : "0";
    const render3dKey = `${opts.perspective3d ?? 0.2}|${opts.directionalLighting ? 1 : 0}|${opts.lightAzimuthDeg ?? -35}|${opts.lightElevationDeg ?? 45}|${orbitKey}`;

    // R6 soft skinning + mesh deformation share the same bone transforms.
    const weights = this.rig.getBoneWeights();
    const boneTransforms = buildBoneTransformMap(restMap, poseMap);
    const activeClip = this.rig.getActiveClip();
    const rigRevision = this.rig.revisionId;
    const slotLayerIds = this.rig.getSlotLayerIds();

    type RigDrawItem =
      | {
          kind: "buffer";
          buffer: PixelBuffer;
          opacity: number;
          blendMode: BlendModeName;
          z: number;
          order: number;
        }
      | {
          kind: "tilemap";
          tilemap: TilemapData;
          opacity: number;
          blendMode: BlendModeName;
          z: number;
          order: number;
        };

    const drawItems: RigDrawItem[] = [];
    let drawOrder = 0;

    for (let li = layers.length - 1; li >= 0; li--) {
      const layer = layers[li];
      if (layer.kind === "group" || slotLayerIds.has(layer.id)) continue;

      const effective = resolveLayerEffective(layer, byId);
      if (!effective.visible || effective.opacity <= 0) continue;

      if (layer.kind === "tilemap") {
        const tm = this.getTilemap(layer.id, frameIndex);
        if (tm) {
          drawItems.push({
            kind: "tilemap",
            tilemap: tm,
            opacity: effective.opacity,
            blendMode: layer.blendMode,
            z: 0,
            order: drawOrder++,
          });
        }
        continue;
      }

      let cel = this.getCel(layer.id, frameIndex);
      if ((!cel || cel.isEmpty()) && frameIndex > 0) {
        // Allow 1-frame drawn parts bound to bones to animate across all frames
        const fallback = this.getCel(layer.id, 0);
        if (fallback && !fallback.isEmpty()) {
          cel = fallback;
        }
      }
      if (!cel) continue;
      const sourceCel = cel;
      const celWeights =
        weights &&
        weights.width === sourceCel.width &&
        weights.height === sourceCel.height
          ? weights
          : null;
      const mesh = this.rig.getMeshForLayer(layer.id);
      const deformKey = `${layer.id}|${frameIndex}|${rigRevision}|${sourceCel.revision}|${opts.mode ?? "pose"}|${useOverrides ? 1 : 0}|${opts.pixelSnap ? 1 : 0}|${opts.rotSprite ? 1 : 0}|${render3dKey}`;

      // R6 mesh deformation (FFD + skin weights) via inverse triangles.
      if (mesh) {
        const warped = this.getRigDeformedBuffer(
          `${deformKey}|mesh:${mesh.id}`,
          () =>
            renderRigMesh(sourceCel, mesh, {
              transforms: boneTransforms,
              weights: celWeights,
              track: activeClip.meshTracks?.[mesh.id] ?? null,
              frame: frameIndex,
              pixelSnap: opts.pixelSnap,
            })
        );
        drawItems.push({
          kind: "buffer",
          buffer: warped,
          opacity: effective.opacity,
          blendMode: layer.blendMode,
          z: 0,
          order: drawOrder++,
        });
        continue;
      }

      // R6 soft weights use LBS (inverse-mapped lattice, hole-free sampling).
      // When any bone has 3D tilt/extrusion/depth, partition by dominant bone
      // and route through warpLayerByBone3D so 3D rotation, extrusion, and Z-sort work.
      if (celWeights && !weightsAreHard(celWeights)) {
        if (!has3dBoneActivity) {
          const warped = this.getRigDeformedBuffer(`${deformKey}|lbs`, () =>
            skinLayerPixels(sourceCel, celWeights, boneTransforms, {
              pixelSnap: opts.pixelSnap,
            })
          );
          drawItems.push({
            kind: "buffer",
            buffer: warped,
            opacity: effective.opacity,
            blendMode: layer.blendMode,
            z: 0,
            order: drawOrder++,
          });
          continue;
        }

        const pxCount = sourceCel.width * sourceCel.height;
        const unweighted = new PixelBuffer(sourceCel.width, sourceCel.height);
        const boneSlices = new Map<string, PixelBuffer>();

        for (let i = 0; i < pxCount; i++) {
          const pIdx = i * 4;
          const a = sourceCel.data[pIdx + 3];
          if (a === 0) continue;

          const infs = celWeights.entries.get(i);
          let bestBoneId: string | null = null;
          let bestW = 0;
          if (infs) {
            for (const inf of infs) {
              if (inf.w <= bestW) continue;
              const candidate = boneById.get(inf.boneId);
              if (!candidate) continue;
              if (candidate.boundLayerId && candidate.boundLayerId !== layer.id) {
                continue;
              }
              bestW = inf.w;
              bestBoneId = inf.boneId;
            }
          }

          if (!bestBoneId) {
            unweighted.data[pIdx] = sourceCel.data[pIdx];
            unweighted.data[pIdx + 1] = sourceCel.data[pIdx + 1];
            unweighted.data[pIdx + 2] = sourceCel.data[pIdx + 2];
            unweighted.data[pIdx + 3] = a;
            continue;
          }

          let slice = boneSlices.get(bestBoneId);
          if (!slice) {
            slice = new PixelBuffer(sourceCel.width, sourceCel.height);
            boneSlices.set(bestBoneId, slice);
          }
          slice.data[pIdx] = sourceCel.data[pIdx];
          slice.data[pIdx + 1] = sourceCel.data[pIdx + 1];
          slice.data[pIdx + 2] = sourceCel.data[pIdx + 2];
          slice.data[pIdx + 3] = a;
        }

        if (!unweighted.isEmpty()) {
          drawItems.push({
            kind: "buffer",
            buffer: unweighted,
            opacity: effective.opacity,
            blendMode: layer.blendMode,
            z: 0,
            order: drawOrder++,
          });
        }

        for (const [bId, slice] of boneSlices.entries()) {
          const b = boneById.get(bId);
          const rest = restMap.get(bId);
          const posed = poseMap.get(bId);
          const backSource = resolveBackSource(b);
          const backKey = backSource
            ? `${b?.backLayerId ?? ""}:${backSource.revision}`
            : "none";
          const warped =
            rest && posed
              ? this.getRigDeformedBuffer(
                  `${deformKey}|soft3d:${bId}|back:${backKey}`,
                  () =>
                    warpLayerByBone3D(slice, rest, posed, opts, {
                      extrudeDepth: b?.extrudeDepth,
                      depthProfile: b?.depthProfile,
                      backSource,
                    })
                )
              : slice;
          const z = posed ? (posed.z + posed.tipZ) * 0.5 : 0;
          drawItems.push({
            kind: "buffer",
            buffer: warped,
            opacity: effective.opacity,
            blendMode: layer.blendMode,
            z,
            order: drawOrder++,
          });
        }
        continue;
      }

      const boneId = layerToBoneId.get(layer.id);
      const matchingMaskedBones = this.rig.hasAnyBoneMask()
        ? this.rig.bones.filter((b) => {
            if (b.boundLayerId && b.boundLayerId !== layer.id) return false;
            const m = this.rig.getBoneMask(b.id);
            return Boolean(m && m.width === cel.width && m.height === cel.height);
          })
        : [];

      if (matchingMaskedBones.length > 0) {
        const pxCount = cel.width * cel.height;
        const anyMasked = new Uint8Array(pxCount);
        for (const b of matchingMaskedBones) {
          const m = this.rig.getBoneMask(b.id)!;
          for (let i = 0; i < pxCount; i++) {
            if (m.data[i] > 0) anyMasked[i] = 1;
          }
        }

        // Collect unmasked pixels stationary at z = 0
        const unmasked = new PixelBuffer(cel.width, cel.height);
        for (let i = 0; i < pxCount; i++) {
          if (anyMasked[i] > 0) continue;
          const pIdx = i * 4;
          if (cel.data[pIdx + 3] === 0) continue;
          unmasked.data[pIdx] = cel.data[pIdx];
          unmasked.data[pIdx + 1] = cel.data[pIdx + 1];
          unmasked.data[pIdx + 2] = cel.data[pIdx + 2];
          unmasked.data[pIdx + 3] = cel.data[pIdx + 3];
        }
        if (!unmasked.isEmpty()) {
          drawItems.push({
            kind: "buffer",
            buffer: unmasked,
            opacity: effective.opacity,
            blendMode: layer.blendMode,
            z: 0,
            order: drawOrder++,
          });
        }

        // Collect each bone's masked pixels warped by that bone
        for (const b of matchingMaskedBones) {
          const m = this.rig.getBoneMask(b.id)!;
          const slice = new PixelBuffer(cel.width, cel.height);
          let hasOpaque = false;
          for (let i = 0; i < pxCount; i++) {
            if (m.data[i] === 0) continue;
            const pIdx = i * 4;
            const a = cel.data[pIdx + 3];
            if (a === 0) continue;
            hasOpaque = true;
            slice.data[pIdx] = cel.data[pIdx];
            slice.data[pIdx + 1] = cel.data[pIdx + 1];
            slice.data[pIdx + 2] = cel.data[pIdx + 2];
            slice.data[pIdx + 3] = a;
          }
          if (!hasOpaque) continue;

          const rest = restMap.get(b.id);
          const posed = poseMap.get(b.id);
          const backSource = resolveBackSource(b);
          const warped =
            rest && posed
              ? warpLayerByBone3D(slice, rest, posed, opts, {
                  extrudeDepth: b.extrudeDepth,
                  depthProfile: b.depthProfile,
                  backSource,
                })
              : slice;
          const z = posed ? (posed.z + posed.tipZ) * 0.5 : 0;
          drawItems.push({
            kind: "buffer",
            buffer: warped,
            opacity: effective.opacity,
            blendMode: layer.blendMode,
            z,
            order: drawOrder++,
          });
        }
        continue;
      }

      let sourceBuf = cel;
      let itemZ = 0;
      if (boneId) {
        const bone = boneById.get(boneId);
        const rest = restMap.get(boneId);
        const posed = poseMap.get(boneId);
        if (rest && posed) {
          const backSource = resolveBackSource(bone);
          const backKey = backSource
            ? `${bone?.backLayerId ?? ""}:${backSource.revision}`
            : "none";
          sourceBuf = this.getRigDeformedBuffer(
            `${deformKey}|warp:${boneId}|back:${backKey}`,
            () =>
              warpLayerByBone3D(sourceCel, rest, posed, opts, {
                extrudeDepth: bone?.extrudeDepth,
                depthProfile: bone?.depthProfile,
                backSource,
              })
          );
          itemZ = (posed.z + posed.tipZ) * 0.5;
        }
      }

      drawItems.push({
        kind: "buffer",
        buffer: sourceBuf,
        opacity: effective.opacity,
        blendMode: layer.blendMode,
        z: itemZ,
        order: drawOrder++,
      });
    }

    // R5 Sprite swapping: collect slots in draw order.
    for (const slot of this.rig.slots) {
      const att = this.rig.resolveSlotAttachment(
        slot,
        frameIndex,
        useOverrides,
        opts.mode ?? "pose"
      );
      if (!att) continue;
      const sourceCel = this.getCel(att.layerId, att.frame);
      if (!sourceCel || sourceCel.isEmpty()) continue;

      const attLayer = byId.get(att.layerId);
      const attEff = attLayer
        ? resolveLayerEffective(attLayer, byId)
        : { visible: true, opacity: 1 };
      if (!attEff.visible || attEff.opacity <= 0) continue;

      const bone = boneById.get(slot.boneId);
      const rest = restMap.get(slot.boneId);
      const posed = poseMap.get(slot.boneId);
      let warped = sourceCel;
      let slotZ = 0;
      if (rest && posed) {
        const backSource = resolveBackSource(bone);
        const backKey = backSource
          ? `${bone?.backLayerId ?? ""}:${backSource.revision}`
          : "none";
        warped = this.getRigDeformedBuffer(
          `slot:${slot.id}|${att.name}|${frameIndex}|${rigRevision}|${sourceCel.revision}|${opts.mode ?? "pose"}|${useOverrides ? 1 : 0}|${opts.pixelSnap ? 1 : 0}|${opts.rotSprite ? 1 : 0}|${render3dKey}|back:${backKey}`,
          () =>
            warpLayerByBone3D(sourceCel, rest, posed, opts, {
              extrudeDepth: bone?.extrudeDepth,
              depthProfile: bone?.depthProfile,
              backSource,
            })
        );
        slotZ = (posed.z + posed.tipZ) * 0.5;
      }

      drawItems.push({
        kind: "buffer",
        buffer: warped,
        opacity: attEff.opacity,
        blendMode: attLayer?.blendMode ?? "Normal",
        z: slotZ,
        order: drawOrder++,
      });
    }

    // Dynamic Z-sorting (far-to-near: smaller/more-negative z draws first).
    // When all items have z ≈ 0, skip sorting to preserve exact 2D draw order.
    if (
      opts.autoZSort !== false &&
      drawItems.some((item) => Math.abs(item.z) > 1e-4)
    ) {
      drawItems.sort((a, b) => {
        const dz = a.z - b.z;
        return Math.abs(dz) > 1e-6 ? dz : a.order - b.order;
      });
    }

    for (const item of drawItems) {
      if (item.kind === "tilemap") {
        if (this.tileProjection === "isometric") {
          renderIsometricTilemapToBuffer(
            item.tilemap,
            this.tilesetRegistry,
            dst,
            this.width,
            this.height,
            item.opacity,
            item.blendMode,
            this.tileAnimationElapsedMs
          );
        } else {
          renderTilemapToBuffer(
            item.tilemap,
            this.tilesetRegistry,
            dst,
            this.width,
            this.height,
            item.opacity,
            item.blendMode,
            this.tileAnimationElapsedMs
          );
        }
      } else {
        compositeSourceOnto(
          dst,
          this.width,
          this.height,
          item.buffer,
          0,
          0,
          item.opacity,
          item.blendMode
        );
      }
    }

    const cleanup = opts.cleanup;
    if (cleanup && hasPixelCleanup(cleanup)) {
      const source = new PixelBuffer(this.width, this.height, this.compositeBuffer);
      const cleaned = applyPixelCleanup(source, cleanup, {
        palette: this.collectRigSourcePalette(layers, frameIndex),
      });
      this.compositeBuffer.set(cleaned.data);
    }

    return this.compositeBuffer;
  }

  /** Caches a deformed layer buffer keyed by frame + rig + cel revision. */
  private getRigDeformedBuffer(
    key: string,
    build: () => PixelBuffer
  ): PixelBuffer {
    const cached = this.rigDeformCache.get(key);
    if (cached) return cached;
    const buffer = build();
    this.rigDeformCache.set(key, buffer);
    while (this.rigDeformCache.size > 48) {
      const oldest = this.rigDeformCache.keys().next().value;
      if (oldest === undefined) break;
      this.rigDeformCache.delete(oldest);
    }
    return buffer;
  }

  /** Merged opaque palette of the source cels (R6 palette lock + outline). */
  private collectRigSourcePalette(
    layers: readonly LayerCompositingInfo[],
    frameIndex: number
  ): RGBA[] {
    const palette = new Map<number, RGBA>();
    for (const layer of layers) {
      if (layer.kind === "group" || layer.kind === "tilemap") continue;
      const cel =
        this.getCel(layer.id, frameIndex) ?? this.getCel(layer.id, 0);
      if (!cel) continue;
      const data = cel.data;
      for (let i = 0; i < data.length; i += 4) {
        if (data[i + 3] === 0) continue;
        const packed = packRgba(data[i], data[i + 1], data[i + 2], data[i + 3]);
        if (!palette.has(packed)) {
          palette.set(packed, [data[i], data[i + 1], data[i + 2], data[i + 3]]);
        }
      }
    }
    return Array.from(palette.values());
  }

  compositeFrameWithShaderPreview(
    layers: readonly LayerCompositingInfo[],
    frameIndex: number,
    opts: {
      rigOpts?: RigRenderOptions;
      useRig?: boolean;
      light2d?: Light2DOptions;
      paletteLut?: {
        enabled: boolean;
        sourcePalette: readonly string[];
        targetPalette: readonly string[];
      };
    }
  ): Uint8ClampedArray {
    const useRig = Boolean(opts.useRig && this.rig.bones.length > 0);
    const rigOpts: RigRenderOptions = opts.rigOpts ?? {
      pixelSnap: true,
      rotSprite: true,
    };

    const renderList = (subset: readonly LayerCompositingInfo[]): Uint8ClampedArray =>
      useRig
        ? this.compositeRigFrame(subset, frameIndex, rigOpts)
        : this.compositeFrame(subset, frameIndex);

    let result: Uint8ClampedArray;

    if (opts.light2d?.enabled) {
      const albedoLayers = layers.filter(
        (l) => l.kind === "group" || !l.mapRole || l.mapRole === "albedo"
      );
      const hasNormal = layers.some(
        (l) => l.kind !== "group" && l.mapRole === "normal" && l.visible
      );
      const hasEmission = layers.some(
        (l) => l.kind !== "group" && l.mapRole === "emission" && l.visible
      );
      const hasHeight = layers.some(
        (l) => l.kind !== "group" && l.mapRole === "height" && l.visible
      );
      const hasDepth = layers.some(
        (l) => l.kind !== "group" && l.mapRole === "depth" && l.visible
      );

      const albedo = new Uint8ClampedArray(renderList(albedoLayers));
      let normal: Uint8ClampedArray | null = null;
      let emission: Uint8ClampedArray | null = null;
      let heightMap: Uint8ClampedArray | null = null;
      let depthMap: Uint8ClampedArray | null = null;

      if (hasNormal) {
        const normalLayers = layers.filter(
          (l) => l.kind === "group" || l.mapRole === "normal"
        );
        normal = new Uint8ClampedArray(this.compositeFrame(normalLayers, frameIndex));
      }
      if (hasEmission) {
        const emissionLayers = layers.filter(
          (l) => l.kind === "group" || l.mapRole === "emission"
        );
        emission = new Uint8ClampedArray(
          this.compositeFrame(emissionLayers, frameIndex)
        );
      }
      if (hasHeight) {
        const heightLayers = layers.filter(
          (l) => l.kind === "group" || l.mapRole === "height"
        );
        heightMap = new Uint8ClampedArray(
          this.compositeFrame(heightLayers, frameIndex)
        );
      }
      if (hasDepth) {
        const depthLayers = layers.filter(
          (l) => l.kind === "group" || l.mapRole === "depth"
        );
        depthMap = new Uint8ClampedArray(
          this.compositeFrame(depthLayers, frameIndex)
        );
      }

      result = apply2DLighting(
        albedo,
        normal,
        emission,
        this.width,
        this.height,
        opts.light2d,
        heightMap,
        depthMap
      );
    } else {
      result = new Uint8ClampedArray(renderList(layers));
    }

    if (
      opts.paletteLut?.enabled &&
      opts.paletteLut.targetPalette.length > 0
    ) {
      result = applyPaletteSwapLut(
        result,
        opts.paletteLut.sourcePalette,
        opts.paletteLut.targetPalette
      );
    }

    this.compositeBuffer.set(result);
    return this.compositeBuffer;
  }

  compositeOnionSkin(
    layers: readonly LayerCompositingInfo[],
    currentFrame: number,
    totalFrames: number,
    prevCount: number,
    nextCount: number,
    opacity: number,
    onionOpts?: OnionSkinOptions
  ): Uint8ClampedArray {
    this.onionBuffer.fill(0);

    const tint = onionOpts?.tint !== false;
    const baseOpacity = onionOpts?.baseOpacity ?? opacity;
    const loopWrap = Boolean(onionOpts?.loopWrap);
    const entries = resolveOnionSkinFrames(
      currentFrame,
      totalFrames,
      prevCount,
      nextCount,
      loopWrap,
      baseOpacity
    );

    for (const entry of entries) {
      this.compositeLayersInto(this.onionScratch, layers, entry.frame, false);
      if (tint) {
        if (entry.kind === "prev") {
          blendTintedScratchOver(
            this.onionBuffer,
            this.onionScratch,
            235,
            85,
            110,
            entry.opacity
          );
        } else {
          blendTintedScratchOver(
            this.onionBuffer,
            this.onionScratch,
            80,
            175,
            255,
            entry.opacity
          );
        }
      } else {
        blendOriginalScratchOver(
          this.onionBuffer,
          this.onionScratch,
          entry.opacity
        );
      }
    }

    return this.onionBuffer;
  }

  sampleCompositedPixel(x: number, y: number): RGBA {
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) {
      return [0, 0, 0, 0];
    }
    const idx = (y * this.width + x) * 4;
    return [
      this.compositeBuffer[idx],
      this.compositeBuffer[idx + 1],
      this.compositeBuffer[idx + 2],
      this.compositeBuffer[idx + 3],
    ];
  }

  clearOverlay(): void {
    this.overlayBuffer.data.fill(0);
    this.overlayBuffer.markAllDirty();
  }

  undo(): { layerId: string; frameIndex: number; label: string } | null {
    const res = this.history.undo((layerId, frameIndex) =>
      this.getOrCreateCel(layerId, frameIndex)
    );
    if (res) this.emitChange();
    return res;
  }

  redo(): { layerId: string; frameIndex: number; label: string } | null {
    const res = this.history.redo((layerId, frameIndex) =>
      this.getOrCreateCel(layerId, frameIndex)
    );
    if (res) this.emitChange();
    return res;
  }

  seedStarterCanvas(): void {
    this.applySampleCels(generateGemSample(this.width, this.height));
  }

  /** Writes a sample document's cels into the engine (sizes must match). */
  applySampleCels(sample: SampleDocument): void {
    for (const c of sample.cels) {
      const cel = this.getOrCreateCel(c.layerId, c.frameIndex);
      cel.data.set(c.data);
      cel.markAllDirty();
    }
    this.emitChange();
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  emitChange(): void {
    for (const listener of this.listeners) {
      listener();
    }
  }
}

export const pixelEngine = new PixelEngine(32, 32);
pixelEngine.seedStarterCanvas();

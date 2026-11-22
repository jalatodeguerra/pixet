import { PixelBuffer, type RGBA } from "./PixelBuffer.ts";
import { TileHistory } from "../history/TileHistory.ts";
import {
  type AutoTileMode,
  type AutoTileRuleset,
  generate16TileAutoTileSet,
  paintAutoTileCell,
} from "../tiles/autoTile.ts";
import { renderIsometricTilemapToBuffer } from "../tiles/isometric.ts";
import {
  type BlendModeName,
  compositeSourceOnto,
  renderTilemapToBuffer,
  TilemapData,
  Tileset,
} from "../tiles/TilemapEngine.ts";
import type {
  FloatingSelection,
  SelectionMask,
} from "../tools/selection.ts";

export interface LayerCompositingInfo {
  id: string;
  kind: string;
  visible: boolean;
  opacity: number; // 0..100
  blendMode: BlendModeName;
  parentId?: string | null;
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

export class PixelEngine {
  width: number;
  height: number;
  readonly cels = new Map<string, PixelBuffer>();
  readonly celLinks = new Map<string, number>();
  readonly tileset = new Tileset("tileset-default", "Main Tileset", 16, 16);
  readonly tilemaps = new Map<string, TilemapData>();
  readonly history = new TileHistory(100);
  compositeBuffer: Uint8ClampedArray;
  overlayBuffer: PixelBuffer;
  onionBuffer: Uint8ClampedArray;
  private onionScratch: Uint8ClampedArray;

  selection: SelectionMask | null = null;
  floating: FloatingSelection | null = null;
  clipboard: PixelBuffer | null = null;
  autoTileRuleset: AutoTileRuleset | null = null;
  tileProjection: "orthogonal" | "isometric" = "orthogonal";

  private listeners = new Set<() => void>();

  constructor(width = 32, height = 32) {
    this.width = width;
    this.height = height;
    const byteLen = width * height * 4;
    this.compositeBuffer = new Uint8ClampedArray(byteLen);
    this.overlayBuffer = new PixelBuffer(width, height);
    this.onionBuffer = new Uint8ClampedArray(byteLen);
    this.onionScratch = new Uint8ClampedArray(byteLen);
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
    this.history.clear();
    this.selection = null;
    this.floating = null;
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
    let cellTileId = tm.getCell(col, row);

    if (cellTileId === 0) {
      if (rgba[3] === 0) {
        return { tileId: 0, changed: false };
      }
      if (activeTileId > 0 && this.tileset.getTile(activeTileId)) {
        cellTileId = activeTileId;
      } else {
        cellTileId = this.tileset.addTile();
      }
      tm.setCell(col, row, cellTileId);
    }

    const tileBuf = this.tileset.getTile(cellTileId);
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

  deleteTileFromTileset(tileId: number): boolean {
    if (!this.tileset.deleteTile(tileId)) return false;
    for (const tm of this.tilemaps.values()) {
      tm.replaceTileId(tileId);
    }
    if (this.autoTileRuleset) {
      this.autoTileRuleset = null;
    }
    this.emitChange();
    return true;
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

    // `layers` is ordered top-to-bottom in UI; composite bottom-to-top.
    for (let li = layers.length - 1; li >= 0; li--) {
      const layer = layers[li];
      if (layer.kind === "group") continue;

      const effective = resolveLayerEffective(layer, byId);
      if (!effective.visible || effective.opacity <= 0) {
        if (activeFloat && activeFloat.sourceLayerId === layer.id) {
          floatingComposited = true;
        }
        continue;
      }

      if (layer.kind === "tilemap") {
        const tm = this.getTilemap(layer.id, frameIndex);
        if (tm) {
          if (this.tileProjection === "isometric") {
            renderIsometricTilemapToBuffer(
              tm,
              this.tileset,
              dst,
              this.width,
              this.height,
              effective.opacity,
              layer.blendMode
            );
          } else {
            renderTilemapToBuffer(
              tm,
              this.tileset,
              dst,
              this.width,
              this.height,
              effective.opacity,
              layer.blendMode
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
            layer.blendMode
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
          layer.blendMode
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

  compositeOnionSkin(
    layers: readonly LayerCompositingInfo[],
    currentFrame: number,
    totalFrames: number,
    prevCount: number,
    nextCount: number,
    opacity: number
  ): Uint8ClampedArray {
    this.onionBuffer.fill(0);

    for (let d = prevCount; d >= 1; d--) {
      const f = currentFrame - d;
      if (f < 0 || f >= totalFrames) continue;
      this.compositeLayersInto(this.onionScratch, layers, f, false);
      blendTintedScratchOver(
        this.onionBuffer,
        this.onionScratch,
        235,
        85,
        110,
        opacity / d
      );
    }

    for (let d = nextCount; d >= 1; d--) {
      const f = currentFrame + d;
      if (f < 0 || f >= totalFrames) continue;
      this.compositeLayersInto(this.onionScratch, layers, f, false);
      blendTintedScratchOver(
        this.onionBuffer,
        this.onionScratch,
        80,
        175,
        255,
        opacity / d
      );
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
    const cx = Math.floor(this.width / 2);
    const cy = Math.floor(this.height / 2);

    for (let frameIndex = 0; frameIndex < 4; frameIndex++) {
      const base = this.getOrCreateCel("layer-base", frameIndex);
      const shading = this.getOrCreateCel("layer-shading", frameIndex);
      const outline = this.getOrCreateCel("layer-outline", frameIndex);

      base.clear();
      shading.clear();
      outline.clear();

      const bobOffset = frameIndex % 2 === 1 ? -1 : 0;
      const pulse = frameIndex === 2 ? 1 : 0;
      const r = 6 + pulse;

      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          const dist = Math.abs(dx) + Math.abs(dy);
          const px = cx + dx;
          const py = cy + dy + bobOffset;

          if (dist === r) {
            outline.setPixel(px, py, 15, 15, 23, 255);
          } else if (dist < r) {
            if (dx <= -2 && dy <= -2) {
              base.setPixel(px, py, 216, 230, 255, 255);
            } else {
              base.setPixel(px, py, 91, 140, 255, 255);
            }
            if (dy > 1 || dx > 1) {
              shading.setPixel(px, py, 128, 145, 200, 255);
            }
          }
        }
      }
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

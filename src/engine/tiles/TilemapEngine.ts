import { PixelBuffer } from "../document/PixelBuffer.ts";
import { type BlendMode, blendRgb } from "../document/blendModes.ts";
import {
  type CellFlags,
  packCell,
  transformTileCoord,
  unpackCell,
} from "./cell.ts";
import { Tileset, TilesetRegistry } from "./Tileset.ts";
import { resolveAnimatedTileId } from "./tileAuthoring.ts";

export * from "./cell.ts";
export * from "./Tileset.ts";

export type BlendModeName = BlendMode;

export function compositeSourceOnto(
  dst: Uint8ClampedArray,
  dstWidth: number,
  dstHeight: number,
  src: PixelBuffer,
  offsetX: number,
  offsetY: number,
  layerOpacity: number,
  mode: BlendModeName,
  clipBaseAlpha?: Uint8Array | null
): void {
  for (let sy = 0; sy < src.height; sy++) {
    const dy = offsetY + sy;
    if (dy < 0 || dy >= dstHeight) continue;
    for (let sx = 0; sx < src.width; sx++) {
      const dx = offsetX + sx;
      if (dx < 0 || dx >= dstWidth) continue;

      const sIdx = (sy * src.width + sx) * 4;
      const rawSrcA = src.data[sIdx + 3];
      if (rawSrcA === 0) continue;

      const pIdx = dy * dstWidth + dx;
      const clipFactor = clipBaseAlpha ? clipBaseAlpha[pIdx] / 255 : 1;
      if (clipFactor <= 0) continue;

      const dIdx = pIdx * 4;
      const sa = (rawSrcA / 255) * layerOpacity * clipFactor;
      const da = dst[dIdx + 3] / 255;
      const outA = sa + da * (1 - sa);
      if (outA <= 0) continue;

      const sr = src.data[sIdx];
      const sg = src.data[sIdx + 1];
      const sb = src.data[sIdx + 2];

      let br = sr;
      let bg = sg;
      let bb = sb;

      if (mode !== "Normal" && da > 0) {
        const [mr, mg, mb] = blendRgb(
          dst[dIdx] / 255,
          dst[dIdx + 1] / 255,
          dst[dIdx + 2] / 255,
          sr / 255,
          sg / 255,
          sb / 255,
          mode
        );
        const mixedR = mr * 255;
        const mixedG = mg * 255;
        const mixedB = mb * 255;
        br = mixedR * da + sr * (1 - da);
        bg = mixedG * da + sg * (1 - da);
        bb = mixedB * da + sb * (1 - da);
      }

      dst[dIdx] = Math.round((br * sa + dst[dIdx] * da * (1 - sa)) / outA);
      dst[dIdx + 1] = Math.round(
        (bg * sa + dst[dIdx + 1] * da * (1 - sa)) / outA
      );
      dst[dIdx + 2] = Math.round(
        (bb * sa + dst[dIdx + 2] * da * (1 - sa)) / outA
      );
      dst[dIdx + 3] = Math.round(outA * 255);
    }
  }
}

export function blitTileTransformed(
  dst: Uint8ClampedArray,
  dstWidth: number,
  dstHeight: number,
  src: PixelBuffer,
  offsetX: number,
  offsetY: number,
  flags: CellFlags,
  layerOpacity: number,
  mode: BlendModeName,
  clipBaseAlpha?: Uint8Array | null
): void {
  if (!flags.flipH && !flags.flipV && !flags.flipD) {
    compositeSourceOnto(
      dst,
      dstWidth,
      dstHeight,
      src,
      offsetX,
      offsetY,
      layerOpacity,
      mode,
      clipBaseAlpha
    );
    return;
  }

  for (let ly = 0; ly < src.height; ly++) {
    const dy = offsetY + ly;
    if (dy < 0 || dy >= dstHeight) continue;
    for (let lx = 0; lx < src.width; lx++) {
      const dx = offsetX + lx;
      if (dx < 0 || dx >= dstWidth) continue;

      const { sx, sy } = transformTileCoord(lx, ly, src.width, src.height, flags);
      const sIdx = (sy * src.width + sx) * 4;
      const rawSrcA = src.data[sIdx + 3];
      if (rawSrcA === 0) continue;

      const pIdx = dy * dstWidth + dx;
      const clipFactor = clipBaseAlpha ? clipBaseAlpha[pIdx] / 255 : 1;
      if (clipFactor <= 0) continue;

      const dIdx = pIdx * 4;
      const sa = (rawSrcA / 255) * layerOpacity * clipFactor;
      const da = dst[dIdx + 3] / 255;
      const outA = sa + da * (1 - sa);
      if (outA <= 0) continue;

      const sr = src.data[sIdx];
      const sg = src.data[sIdx + 1];
      const sb = src.data[sIdx + 2];

      let br = sr;
      let bg = sg;
      let bb = sb;

      if (mode !== "Normal" && da > 0) {
        const [mr, mg, mb] = blendRgb(
          dst[dIdx] / 255,
          dst[dIdx + 1] / 255,
          dst[dIdx + 2] / 255,
          sr / 255,
          sg / 255,
          sb / 255,
          mode
        );
        const mixedR = mr * 255;
        const mixedG = mg * 255;
        const mixedB = mb * 255;
        br = mixedR * da + sr * (1 - da);
        bg = mixedG * da + sg * (1 - da);
        bb = mixedB * da + sb * (1 - da);
      }

      dst[dIdx] = Math.round((br * sa + dst[dIdx] * da * (1 - sa)) / outA);
      dst[dIdx + 1] = Math.round(
        (bg * sa + dst[dIdx + 1] * da * (1 - sa)) / outA
      );
      dst[dIdx + 2] = Math.round(
        (bb * sa + dst[dIdx + 2] * da * (1 - sa)) / outA
      );
      dst[dIdx + 3] = Math.round(outA * 255);
    }
  }
}

export class TilemapData {
  cols: number;
  rows: number;
  grid: Uint32Array;

  constructor(
    cols: number,
    rows: number,
    grid?: Uint32Array | Uint16Array | number[]
  ) {
    this.cols = Math.max(1, cols);
    this.rows = Math.max(1, rows);
    const len = this.cols * this.rows;
    if (grid) {
      if (grid.length !== len) {
        throw new Error(`TilemapData expected ${len} cells, got ${grid.length}`);
      }
      this.grid = new Uint32Array(grid);
    } else {
      this.grid = new Uint32Array(len);
    }
  }

  getCell(col: number, row: number): number {
    if (col < 0 || row < 0 || col >= this.cols || row >= this.rows) return 0;
    return this.grid[row * this.cols + col] >>> 0;
  }

  setCell(col: number, row: number, tileId: number): boolean {
    if (col < 0 || row < 0 || col >= this.cols || row >= this.rows) {
      return false;
    }
    const idx = row * this.cols + col;
    const next = tileId >>> 0;
    if (this.grid[idx] === next) return false;
    this.grid[idx] = next;
    return true;
  }

  clearCell(col: number, row: number): boolean {
    return this.setCell(col, row, 0);
  }

  replaceTileId(deletedId: number, tilesetIndex = 0): void {
    for (let i = 0; i < this.grid.length; i++) {
      const val = this.grid[i] >>> 0;
      if (val === 0) continue;
      const u = unpackCell(val);
      if (u.localId === 0 || u.tilesetIndex !== tilesetIndex) continue;
      if (u.localId === deletedId) {
        this.grid[i] = 0;
      } else if (u.localId > deletedId) {
        this.grid[i] = packCell(tilesetIndex, u.localId - 1, u);
      }
    }
  }

  remapTileIds(tilesetIndex: number, remap: Map<number, number>): void {
    for (let i = 0; i < this.grid.length; i++) {
      const val = this.grid[i] >>> 0;
      if (val === 0) continue;
      const u = unpackCell(val);
      if (u.localId === 0 || u.tilesetIndex !== tilesetIndex) continue;
      const nextId = remap.get(u.localId);
      if (nextId === undefined) continue;
      this.grid[i] = nextId === 0 ? 0 : packCell(tilesetIndex, nextId, u);
    }
  }

  resize(newCols: number, newRows: number): void {
    const c = Math.max(1, newCols);
    const r = Math.max(1, newRows);
    if (c === this.cols && r === this.rows) return;
    const next = new Uint32Array(c * r);
    const mc = Math.min(c, this.cols);
    const mr = Math.min(r, this.rows);
    for (let y = 0; y < mr; y++) {
      for (let x = 0; x < mc; x++) {
        next[y * c + x] = this.grid[y * this.cols + x];
      }
    }
    this.cols = c;
    this.rows = r;
    this.grid = next;
  }

  clone(): TilemapData {
    return new TilemapData(this.cols, this.rows, this.grid);
  }
}

export function resolveTileFromSource(
  tilesetOrRegistry: Tileset | TilesetRegistry,
  cell: number,
  elapsedMs?: number
): { buf: PixelBuffer; flags: CellFlags; tileWidth: number; tileHeight: number } | null {
  if (tilesetOrRegistry instanceof TilesetRegistry) {
    const u = unpackCell(cell);
    if (u.localId === 0) return null;
    const ts = tilesetOrRegistry.get(u.tilesetIndex);
    if (!ts) return null;
    const effectiveId =
      elapsedMs !== undefined
        ? resolveAnimatedTileId(ts, u.localId, elapsedMs)
        : u.localId;
    const buf = ts.getTile(effectiveId);
    if (!buf) return null;
    return {
      buf,
      flags: { flipH: u.flipH, flipV: u.flipV, flipD: u.flipD },
      tileWidth: ts.tileWidth,
      tileHeight: ts.tileHeight,
    };
  }
  const u = unpackCell(cell);
  if (u.localId === 0 || u.tilesetIndex !== 0) return null;
  const effectiveId =
    elapsedMs !== undefined
      ? resolveAnimatedTileId(tilesetOrRegistry, u.localId, elapsedMs)
      : u.localId;
  const buf = tilesetOrRegistry.getTile(effectiveId);
  if (!buf) return null;
  return {
    buf,
    flags: { flipH: u.flipH, flipV: u.flipV, flipD: u.flipD },
    tileWidth: tilesetOrRegistry.tileWidth,
    tileHeight: tilesetOrRegistry.tileHeight,
  };
}

export function renderTilemapToBuffer(
  tilemap: TilemapData,
  tilesetOrRegistry: Tileset | TilesetRegistry,
  dst: Uint8ClampedArray,
  dstW: number,
  dstH: number,
  opacity: number,
  blendMode: BlendModeName,
  elapsedMs?: number,
  clipBaseAlpha?: Uint8Array | null
): void {
  const baseTs =
    tilesetOrRegistry instanceof TilesetRegistry
      ? tilesetOrRegistry.get(0)
      : tilesetOrRegistry;
  const baseW = baseTs?.tileWidth ?? 16;
  const baseH = baseTs?.tileHeight ?? 16;

  for (let row = 0; row < tilemap.rows; row++) {
    for (let col = 0; col < tilemap.cols; col++) {
      const cell = tilemap.getCell(col, row);
      if (cell === 0) continue;
      const resolved = resolveTileFromSource(tilesetOrRegistry, cell, elapsedMs);
      if (!resolved) continue;
      blitTileTransformed(
        dst,
        dstW,
        dstH,
        resolved.buf,
        col * baseW,
        row * baseH,
        resolved.flags,
        opacity,
        blendMode,
        clipBaseAlpha
      );
    }
  }
}

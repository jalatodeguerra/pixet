import { PixelBuffer } from "../document/PixelBuffer.ts";
import {
  type CellFlags,
  packCell,
  transformTileCoord,
  unpackCell,
} from "./cell.ts";
import { Tileset, TilesetRegistry } from "./Tileset.ts";

export * from "./cell.ts";
export * from "./Tileset.ts";

export type BlendModeName =
  | "Normal"
  | "Multiply"
  | "Screen"
  | "Overlay"
  | "Add";

export function blendChannel(
  dst: number,
  src: number,
  mode: BlendModeName
): number {
  const d = dst / 255;
  const s = src / 255;
  switch (mode) {
    case "Multiply":
      return d * s * 255;
    case "Screen":
      return (1 - (1 - d) * (1 - s)) * 255;
    case "Overlay":
      return (d < 0.5 ? 2 * d * s : 1 - 2 * (1 - d) * (1 - s)) * 255;
    case "Add":
      return Math.min(1, d + s) * 255;
    case "Normal":
    default:
      return src;
  }
}

export function compositeSourceOnto(
  dst: Uint8ClampedArray,
  dstWidth: number,
  dstHeight: number,
  src: PixelBuffer,
  offsetX: number,
  offsetY: number,
  layerOpacity: number,
  mode: BlendModeName
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

      const dIdx = (dy * dstWidth + dx) * 4;
      const sa = (rawSrcA / 255) * layerOpacity;
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
        const mixedR = blendChannel(dst[dIdx], sr, mode);
        const mixedG = blendChannel(dst[dIdx + 1], sg, mode);
        const mixedB = blendChannel(dst[dIdx + 2], sb, mode);
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
  mode: BlendModeName
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
      mode
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

      const dIdx = (dy * dstWidth + dx) * 4;
      const sa = (rawSrcA / 255) * layerOpacity;
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
        const mixedR = blendChannel(dst[dIdx], sr, mode);
        const mixedG = blendChannel(dst[dIdx + 1], sg, mode);
        const mixedB = blendChannel(dst[dIdx + 2], sb, mode);
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
  cell: number
): { buf: PixelBuffer; flags: CellFlags; tileWidth: number; tileHeight: number } | null {
  if (tilesetOrRegistry instanceof TilesetRegistry) {
    const resolved = tilesetOrRegistry.resolve(cell);
    if (!resolved) return null;
    return {
      buf: resolved.buf,
      flags: resolved.flags,
      tileWidth: resolved.tileset.tileWidth,
      tileHeight: resolved.tileset.tileHeight,
    };
  }
  const u = unpackCell(cell);
  if (u.localId === 0 || u.tilesetIndex !== 0) return null;
  const buf = tilesetOrRegistry.getTile(u.localId);
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
  blendMode: BlendModeName
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
      const resolved = resolveTileFromSource(tilesetOrRegistry, cell);
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
        blendMode
      );
    }
  }
}

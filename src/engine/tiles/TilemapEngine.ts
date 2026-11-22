import { PixelBuffer } from "../document/PixelBuffer.ts";

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

export class Tileset {
  readonly id: string;
  name: string;
  tileWidth: number;
  tileHeight: number;
  /** Index 0 is reserved empty tile; editable tiles start at index 1. */
  tiles: PixelBuffer[];

  constructor(
    id = "tileset-default",
    name = "Main Tileset",
    tileWidth = 16,
    tileHeight = 16
  ) {
    this.id = id;
    this.name = name;
    this.tileWidth = Math.max(4, tileWidth);
    this.tileHeight = Math.max(4, tileHeight);
    this.tiles = [new PixelBuffer(this.tileWidth, this.tileHeight)];
  }

  get count(): number {
    return Math.max(0, this.tiles.length - 1);
  }

  getTile(tileId: number): PixelBuffer | undefined {
    if (tileId <= 0 || tileId >= this.tiles.length) return undefined;
    return this.tiles[tileId];
  }

  addTile(initial?: PixelBuffer): number {
    const next = new PixelBuffer(this.tileWidth, this.tileHeight);
    if (initial) {
      const mw = Math.min(this.tileWidth, initial.width);
      const mh = Math.min(this.tileHeight, initial.height);
      for (let y = 0; y < mh; y++) {
        for (let x = 0; x < mw; x++) {
          const [r, g, b, a] = initial.getPixel(x, y);
          if (a > 0) next.setPixel(x, y, r, g, b, a);
        }
      }
    }
    this.tiles.push(next);
    return this.tiles.length - 1;
  }

  duplicateTile(tileId: number): number | null {
    const src = this.getTile(tileId);
    if (!src) return null;
    return this.addTile(src);
  }

  deleteTile(tileId: number): boolean {
    if (tileId <= 0 || tileId >= this.tiles.length) return false;
    this.tiles.splice(tileId, 1);
    return true;
  }

  resizeTiles(newW: number, newH: number): void {
    const w = Math.max(4, Math.min(64, Math.round(newW)));
    const h = Math.max(4, Math.min(64, Math.round(newH)));
    if (w === this.tileWidth && h === this.tileHeight) return;

    this.tiles = this.tiles.map((oldBuf) => {
      const next = new PixelBuffer(w, h);
      const mw = Math.min(w, oldBuf.width);
      const mh = Math.min(h, oldBuf.height);
      for (let y = 0; y < mh; y++) {
        for (let x = 0; x < mw; x++) {
          const [r, g, b, a] = oldBuf.getPixel(x, y);
          if (a > 0) next.setPixel(x, y, r, g, b, a);
        }
      }
      return next;
    });
    this.tileWidth = w;
    this.tileHeight = h;
  }

  seedStarterTiles(): void {
    this.tiles = [new PixelBuffer(this.tileWidth, this.tileHeight)];

    // Tile 1: Grass Top
    const grassId = this.addTile();
    const grass = this.getTile(grassId)!;
    for (let y = 0; y < this.tileHeight; y++) {
      for (let x = 0; x < this.tileWidth; x++) {
        if (y === 0) {
          grass.setPixel(x, y, 153, 229, 80, 255);
        } else if (y < 4 + ((x * 3) % 2)) {
          grass.setPixel(x, y, 55, 148, 110, 255);
        } else if (y === 4 + ((x * 3) % 2)) {
          grass.setPixel(x, y, 35, 92, 68, 255);
        } else {
          const speck = (x * 7 + y * 13) % 11 === 0;
          grass.setPixel(
            x,
            y,
            speck ? 110 : 143,
            speck ? 65 : 86,
            speck ? 43 : 59,
            255
          );
        }
      }
    }

    // Tile 2: Brick Wall
    const brickId = this.addTile();
    const brick = this.getTile(brickId)!;
    for (let y = 0; y < this.tileHeight; y++) {
      const row = Math.floor(y / 4);
      const isMortarY = y % 4 === 0;
      const offset = (row % 2) * 4;
      for (let x = 0; x < this.tileWidth; x++) {
        const isMortarX = (x + offset) % 8 === 0;
        if (isMortarY || isMortarX) {
          brick.setPixel(x, y, 52, 46, 62, 255);
        } else if (y % 4 === 1) {
          brick.setPixel(x, y, 217, 102, 92, 255);
        } else {
          brick.setPixel(x, y, 178, 74, 72, 255);
        }
      }
    }

    // Tile 3: Stone Floor
    const stoneId = this.addTile();
    const stone = this.getTile(stoneId)!;
    for (let y = 0; y < this.tileHeight; y++) {
      for (let x = 0; x < this.tileWidth; x++) {
        const edge =
          x === 0 ||
          y === 0 ||
          x === this.tileWidth - 1 ||
          y === this.tileHeight - 1;
        if (edge) {
          stone.setPixel(x, y, 66, 68, 86, 255);
        } else if (x === 1 || y === 1) {
          stone.setPixel(x, y, 148, 152, 176, 255);
        } else {
          const grit = (x * 5 + y * 11) % 9 === 0;
          stone.setPixel(
            x,
            y,
            grit ? 94 : 114,
            grit ? 98 : 118,
            grit ? 118 : 140,
            255
          );
        }
      }
    }
  }
}

export class TilemapData {
  cols: number;
  rows: number;
  grid: Uint16Array;

  constructor(cols: number, rows: number, grid?: Uint16Array) {
    this.cols = Math.max(1, cols);
    this.rows = Math.max(1, rows);
    const len = this.cols * this.rows;
    if (grid) {
      if (grid.length !== len) {
        throw new Error(`TilemapData expected ${len} cells, got ${grid.length}`);
      }
      this.grid = new Uint16Array(grid);
    } else {
      this.grid = new Uint16Array(len);
    }
  }

  getCell(col: number, row: number): number {
    if (col < 0 || row < 0 || col >= this.cols || row >= this.rows) return 0;
    return this.grid[row * this.cols + col];
  }

  setCell(col: number, row: number, tileId: number): boolean {
    if (col < 0 || row < 0 || col >= this.cols || row >= this.rows) {
      return false;
    }
    const idx = row * this.cols + col;
    if (this.grid[idx] === tileId) return false;
    this.grid[idx] = tileId;
    return true;
  }

  clearCell(col: number, row: number): boolean {
    return this.setCell(col, row, 0);
  }

  replaceTileId(deletedId: number): void {
    for (let i = 0; i < this.grid.length; i++) {
      const val = this.grid[i];
      if (val === deletedId) {
        this.grid[i] = 0;
      } else if (val > deletedId) {
        this.grid[i] = val - 1;
      }
    }
  }

  resize(newCols: number, newRows: number): void {
    const c = Math.max(1, newCols);
    const r = Math.max(1, newRows);
    if (c === this.cols && r === this.rows) return;
    const next = new Uint16Array(c * r);
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

export function renderTilemapToBuffer(
  tilemap: TilemapData,
  tileset: Tileset,
  dst: Uint8ClampedArray,
  dstW: number,
  dstH: number,
  opacity: number,
  blendMode: BlendModeName
): void {
  for (let row = 0; row < tilemap.rows; row++) {
    for (let col = 0; col < tilemap.cols; col++) {
      const tileId = tilemap.getCell(col, row);
      if (tileId === 0) continue;
      const tileBuf = tileset.getTile(tileId);
      if (!tileBuf) continue;
      compositeSourceOnto(
        dst,
        dstW,
        dstH,
        tileBuf,
        col * tileset.tileWidth,
        row * tileset.tileHeight,
        opacity,
        blendMode
      );
    }
  }
}

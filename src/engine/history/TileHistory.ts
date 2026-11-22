import type { PixelBuffer, RGBA } from "../document/PixelBuffer.ts";

export const TILE_SIZE = 64;

export interface TileDelta {
  tx: number;
  ty: number;
  x: number;
  y: number;
  w: number;
  h: number;
  before: Uint8ClampedArray;
  after: Uint8ClampedArray;
}

export interface HistoryEntry {
  label: string;
  layerId: string;
  frameIndex: number;
  tiles: TileDelta[];
}

interface PendingTile {
  tx: number;
  ty: number;
  x: number;
  y: number;
  w: number;
  h: number;
  before: Uint8ClampedArray;
}

interface ActiveTransaction {
  label: string;
  layerId: string;
  frameIndex: number;
  tiles: Map<string, PendingTile>;
}

function copyRegion(
  buffer: PixelBuffer,
  x: number,
  y: number,
  w: number,
  h: number
): Uint8ClampedArray {
  const out = new Uint8ClampedArray(w * h * 4);
  for (let row = 0; row < h; row++) {
    const srcStart = ((y + row) * buffer.width + x) * 4;
    const srcEnd = srcStart + w * 4;
    out.set(buffer.data.subarray(srcStart, srcEnd), row * w * 4);
  }
  return out;
}

function writeRegion(
  buffer: PixelBuffer,
  x: number,
  y: number,
  w: number,
  h: number,
  bytes: Uint8ClampedArray
): void {
  for (let row = 0; row < h; row++) {
    const dstStart = ((y + row) * buffer.width + x) * 4;
    const srcStart = row * w * 4;
    buffer.data.set(bytes.subarray(srcStart, srcStart + w * 4), dstStart);
  }
  buffer.markAllDirty();
}

function buffersEqual(a: Uint8ClampedArray, b: Uint8ClampedArray): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

export class TileHistory {
  private undoStack: HistoryEntry[] = [];
  private redoStack: HistoryEntry[] = [];
  private activeTx: ActiveTransaction | null = null;
  private readonly maxEntries: number;
  onCommit?: () => void;

  constructor(maxEntries = 100) {
    this.maxEntries = maxEntries;
  }

  get canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  get canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  get hasActiveTransaction(): boolean {
    return this.activeTx !== null;
  }

  beginTransaction(layerId: string, frameIndex: number, label: string): void {
    this.activeTx = {
      label,
      layerId,
      frameIndex,
      tiles: new Map(),
    };
  }

  capturePixelTile(buffer: PixelBuffer, x: number, y: number): void {
    if (!this.activeTx) return;
    if (x < 0 || y < 0 || x >= buffer.width || y >= buffer.height) return;

    const tx = Math.floor(x / TILE_SIZE);
    const ty = Math.floor(y / TILE_SIZE);
    const key = `${tx},${ty}`;
    if (this.activeTx.tiles.has(key)) return;

    const tileX = tx * TILE_SIZE;
    const tileY = ty * TILE_SIZE;
    const w = Math.min(TILE_SIZE, buffer.width - tileX);
    const h = Math.min(TILE_SIZE, buffer.height - tileY);
    const before = copyRegion(buffer, tileX, tileY, w, h);

    this.activeTx.tiles.set(key, {
      tx,
      ty,
      x: tileX,
      y: tileY,
      w,
      h,
      before,
    });
  }

  captureAllTiles(buffer: PixelBuffer): void {
    if (!this.activeTx) return;
    for (let ty = 0; ty * TILE_SIZE < buffer.height; ty++) {
      for (let tx = 0; tx * TILE_SIZE < buffer.width; tx++) {
        this.capturePixelTile(buffer, tx * TILE_SIZE, ty * TILE_SIZE);
      }
    }
  }

  /**
   * Returns the pre-transaction RGBA value for `(x, y)` if its tile was captured.
   * Used by Pixel-Perfect strokes to restore L-corner pixels cleanly.
   */
  getOriginalPixel(x: number, y: number): RGBA | null {
    if (!this.activeTx) return null;
    const tx = Math.floor(x / TILE_SIZE);
    const ty = Math.floor(y / TILE_SIZE);
    const tile = this.activeTx.tiles.get(`${tx},${ty}`);
    if (!tile) return null;

    const lx = x - tile.x;
    const ly = y - tile.y;
    if (lx < 0 || ly < 0 || lx >= tile.w || ly >= tile.h) return null;

    const idx = (ly * tile.w + lx) * 4;
    return [
      tile.before[idx],
      tile.before[idx + 1],
      tile.before[idx + 2],
      tile.before[idx + 3],
    ];
  }

  commitTransaction(buffer: PixelBuffer): boolean {
    if (!this.activeTx) return false;
    const tx = this.activeTx;
    this.activeTx = null;

    const changedTiles: TileDelta[] = [];
    for (const pending of tx.tiles.values()) {
      const after = copyRegion(buffer, pending.x, pending.y, pending.w, pending.h);
      if (!buffersEqual(pending.before, after)) {
        changedTiles.push({
          ...pending,
          after,
        });
      }
    }

    if (changedTiles.length === 0) return false;

    this.undoStack.push({
      label: tx.label,
      layerId: tx.layerId,
      frameIndex: tx.frameIndex,
      tiles: changedTiles,
    });

    if (this.undoStack.length > this.maxEntries) {
      this.undoStack.shift();
    }

    this.redoStack.length = 0;
    this.onCommit?.();
    return true;
  }

  cancelTransaction(): void {
    this.activeTx = null;
  }

  undo(
    getBuffer: (layerId: string, frameIndex: number) => PixelBuffer
  ): { layerId: string; frameIndex: number; label: string } | null {
    const entry = this.undoStack.pop();
    if (!entry) return null;

    const buffer = getBuffer(entry.layerId, entry.frameIndex);
    for (const tile of entry.tiles) {
      writeRegion(buffer, tile.x, tile.y, tile.w, tile.h, tile.before);
    }

    this.redoStack.push(entry);
    return {
      layerId: entry.layerId,
      frameIndex: entry.frameIndex,
      label: entry.label,
    };
  }

  redo(
    getBuffer: (layerId: string, frameIndex: number) => PixelBuffer
  ): { layerId: string; frameIndex: number; label: string } | null {
    const entry = this.redoStack.pop();
    if (!entry) return null;

    const buffer = getBuffer(entry.layerId, entry.frameIndex);
    for (const tile of entry.tiles) {
      writeRegion(buffer, tile.x, tile.y, tile.w, tile.h, tile.after);
    }

    this.undoStack.push(entry);
    return {
      layerId: entry.layerId,
      frameIndex: entry.frameIndex,
      label: entry.label,
    };
  }

  clear(): void {
    this.undoStack.length = 0;
    this.redoStack.length = 0;
    this.activeTx = null;
  }
}

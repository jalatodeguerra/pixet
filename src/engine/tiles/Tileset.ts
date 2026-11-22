import { PixelBuffer } from "../document/PixelBuffer.ts";
import { type CellFlags, unpackCell } from "./cell.ts";

export type TileProperty =
  | { type: "bool"; value: boolean }
  | { type: "int" | "float"; value: number }
  | { type: "string" | "color" | "file"; value: string }
  | { type: "enum"; value: string; options: string[] };

export type CollisionShape =
  | { kind: "rect"; x: number; y: number; w: number; h: number }
  | { kind: "polygon"; points: Array<[number, number]> }
  | {
      kind: "preset";
      preset:
        | "full"
        | "halfTop"
        | "halfBottom"
        | "slopeL"
        | "slopeR"
        | "slopeL2a"
        | "slopeL2b"
        | "slopeR2a"
        | "slopeR2b";
    };

export interface TileAnimationFrame {
  localId: number;
  durationMs: number;
}

export interface TileMeta {
  uid: string;
  name?: string;
  tags?: string[];
  properties?: Record<string, TileProperty>;
  collision?: CollisionShape[];
  oneWay?: boolean;
  collisionLayer?: number;
  animation?: { frames: TileAnimationFrame[] };
  probability?: number;
}

let uidCounter = 1;
function nextTileUid(): string {
  return `tile-${Date.now().toString(36)}-${(uidCounter++).toString(36)}`;
}

function cloneMeta(m: TileMeta): TileMeta {
  return {
    uid: m.uid,
    ...(m.name !== undefined ? { name: m.name } : {}),
    ...(m.tags !== undefined ? { tags: [...m.tags] } : {}),
    ...(m.properties !== undefined
      ? {
          properties: Object.fromEntries(
            Object.entries(m.properties).map(([k, v]) => [
              k,
              v.type === "enum"
                ? { ...v, options: [...v.options] }
                : { ...v },
            ])
          ),
        }
      : {}),
    ...(m.collision !== undefined
      ? {
          collision: m.collision.map((s) =>
            s.kind === "polygon"
              ? { kind: "polygon", points: s.points.map(([x, y]) => [x, y]) }
              : { ...s }
          ),
        }
      : {}),
    ...(m.oneWay !== undefined ? { oneWay: m.oneWay } : {}),
    ...(m.collisionLayer !== undefined
      ? { collisionLayer: m.collisionLayer }
      : {}),
    ...(m.animation !== undefined
      ? {
          animation: {
            frames: m.animation.frames.map((f) => ({ ...f })),
          },
        }
      : {}),
    ...(m.probability !== undefined ? { probability: m.probability } : {}),
  };
}

export function bytesToBase64(bytes: Uint8ClampedArray): string {
  const chunkSize = 8192;
  let binary = "";
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const slice = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...slice);
  }
  return btoa(binary);
}

export function base64ToBytes(b64: string): Uint8ClampedArray {
  const binary = atob(b64);
  const out = new Uint8ClampedArray(binary.length);
  for (let i = 0; i < binary.length; i++) {
    out[i] = binary.charCodeAt(i);
  }
  return out;
}

export interface TilesetSnapshot {
  id: string;
  name: string;
  tileWidth: number;
  tileHeight: number;
  margin: number;
  spacing: number;
  tiles: string[];
  meta: TileMeta[];
}

export interface TilesetRegistrySnapshot {
  tilesets: TilesetSnapshot[];
}

export interface TilesetExt0 {
  margin: number;
  spacing: number;
  meta: TileMeta[];
}

export interface TilesetRegistryExtSnapshot {
  tileset0: TilesetExt0;
  extraTilesets: TilesetSnapshot[];
}

export class Tileset {
  readonly id: string;
  name: string;
  tileWidth: number;
  tileHeight: number;
  margin = 0;
  spacing = 0;
  /** Index 0 is reserved empty tile; editable tiles start at index 1. */
  tiles: PixelBuffer[];
  /** Parallel metadata array; index 0 is reserved dummy meta. */
  meta: TileMeta[];

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
    this.meta = [{ uid: "empty" }];
  }

  get count(): number {
    return Math.max(0, this.tiles.length - 1);
  }

  getTile(tileId: number): PixelBuffer | undefined {
    if (tileId <= 0 || tileId >= this.tiles.length) return undefined;
    return this.tiles[tileId];
  }

  getMeta(tileId: number): TileMeta | undefined {
    if (tileId <= 0 || tileId >= this.meta.length) return undefined;
    return this.meta[tileId];
  }

  setMeta(tileId: number, patch: Partial<TileMeta>): void {
    if (tileId <= 0 || tileId >= this.tiles.length) return;
    while (this.meta.length < this.tiles.length) {
      this.meta.push({ uid: nextTileUid() });
    }
    const cur = this.meta[tileId];
    this.meta[tileId] = {
      ...cur,
      ...patch,
      uid: patch.uid ?? cur.uid,
    };
  }

  addTile(initial?: PixelBuffer, meta?: Partial<TileMeta>): number {
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
    while (this.meta.length < this.tiles.length - 1) {
      this.meta.push({ uid: nextTileUid() });
    }
    this.meta.push({
      uid: meta?.uid ?? nextTileUid(),
      ...(meta ? cloneMeta({ uid: meta.uid ?? nextTileUid(), ...meta }) : {}),
    });
    return this.tiles.length - 1;
  }

  duplicateTile(tileId: number): number | null {
    const src = this.getTile(tileId);
    if (!src) return null;
    const srcMeta = this.getMeta(tileId);
    const cloned = srcMeta ? cloneMeta(srcMeta) : undefined;
    if (cloned) {
      cloned.uid = nextTileUid();
      if (cloned.name) cloned.name = `${cloned.name} Copy`;
    }
    return this.addTile(src, cloned);
  }

  deleteTile(tileId: number): boolean {
    return this.deleteTileWithRemap(tileId) !== null;
  }

  deleteTileWithRemap(tileId: number): Map<number, number> | null {
    if (tileId <= 0 || tileId >= this.tiles.length) return null;
    const oldCount = this.count;
    const remap = new Map<number, number>();
    for (let id = 1; id <= oldCount; id++) {
      if (id === tileId) {
        remap.set(id, 0);
      } else if (id > tileId) {
        remap.set(id, id - 1);
      } else {
        remap.set(id, id);
      }
    }
    this.tiles.splice(tileId, 1);
    if (tileId < this.meta.length) {
      this.meta.splice(tileId, 1);
    }
    this.remapAnimations(remap);
    return remap;
  }

  reorderTiles(newOrder: number[]): Map<number, number> | null {
    const n = this.count;
    if (newOrder.length !== n) return null;
    const seen = new Set<number>();
    for (const id of newOrder) {
      if (!Number.isInteger(id) || id < 1 || id > n || seen.has(id)) {
        return null;
      }
      seen.add(id);
    }

    while (this.meta.length < this.tiles.length) {
      this.meta.push({ uid: nextTileUid() });
    }

    const nextTiles: PixelBuffer[] = [this.tiles[0]];
    const nextMeta: TileMeta[] = [this.meta[0]];
    const remap = new Map<number, number>();

    for (let i = 0; i < newOrder.length; i++) {
      const oldId = newOrder[i];
      const newId = i + 1;
      nextTiles.push(this.tiles[oldId]);
      nextMeta.push(this.meta[oldId]);
      remap.set(oldId, newId);
    }

    this.tiles = nextTiles;
    this.meta = nextMeta;
    this.remapAnimations(remap);
    return remap;
  }

  remapAnimations(remap: Map<number, number>): void {
    for (let i = 1; i < this.meta.length; i++) {
      const anim = this.meta[i].animation;
      if (!anim) continue;
      const nextFrames: TileAnimationFrame[] = [];
      for (const frame of anim.frames) {
        const mapped = remap.get(frame.localId) ?? frame.localId;
        if (mapped > 0) {
          nextFrames.push({ localId: mapped, durationMs: frame.durationMs });
        }
      }
      if (nextFrames.length > 0) {
        this.meta[i] = { ...this.meta[i], animation: { frames: nextFrames } };
      } else {
        const copy = { ...this.meta[i] };
        delete copy.animation;
        this.meta[i] = copy;
      }
    }
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
    this.meta = [{ uid: "empty" }];

    // Tile 1: Grass Top
    const grassId = this.addTile(undefined, { name: "Grass Top" });
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
    const brickId = this.addTile(undefined, { name: "Brick Wall" });
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
    const stoneId = this.addTile(undefined, { name: "Stone Floor" });
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

  toSnapshot(): TilesetSnapshot {
    const tiles: string[] = [];
    for (let i = 1; i < this.tiles.length; i++) {
      tiles.push(bytesToBase64(this.tiles[i].data));
    }
    return {
      id: this.id,
      name: this.name,
      tileWidth: this.tileWidth,
      tileHeight: this.tileHeight,
      margin: this.margin,
      spacing: this.spacing,
      tiles,
      meta: this.meta.map((m) => cloneMeta(m)),
    };
  }

  static fromSnapshot(snap: TilesetSnapshot): Tileset {
    const ts = new Tileset(snap.id, snap.name, snap.tileWidth, snap.tileHeight);
    ts.margin = snap.margin ?? 0;
    ts.spacing = snap.spacing ?? 0;
    ts.tiles = [new PixelBuffer(ts.tileWidth, ts.tileHeight)];
    for (const b64 of snap.tiles) {
      const raw = base64ToBytes(b64);
      if (raw.length === ts.tileWidth * ts.tileHeight * 4) {
        ts.tiles.push(new PixelBuffer(ts.tileWidth, ts.tileHeight, raw));
      } else {
        ts.tiles.push(new PixelBuffer(ts.tileWidth, ts.tileHeight));
      }
    }
    ts.meta =
      snap.meta && snap.meta.length > 0
        ? snap.meta.map((m) => cloneMeta(m))
        : [{ uid: "empty" }];
    while (ts.meta.length < ts.tiles.length) {
      ts.meta.push({ uid: nextTileUid() });
    }
    return ts;
  }
}

export interface ResolvedCell {
  tileset: Tileset;
  tilesetIndex: number;
  localId: number;
  buf: PixelBuffer;
  meta: TileMeta;
  flags: CellFlags;
}

export class TilesetRegistry {
  tilesets: Tileset[];

  constructor() {
    this.tilesets = [new Tileset("tileset-default", "Main Tileset", 16, 16)];
  }

  get(index: number): Tileset | undefined {
    if (index < 0 || index >= this.tilesets.length) return undefined;
    return this.tilesets[index];
  }

  add(ts: Tileset): number {
    this.tilesets.push(ts);
    return this.tilesets.length - 1;
  }

  remove(index: number): boolean {
    if (this.tilesets.length <= 1) return false;
    if (index < 0 || index >= this.tilesets.length) return false;
    this.tilesets.splice(index, 1);
    return true;
  }

  resolve(cell: number): ResolvedCell | null {
    const unpacked = unpackCell(cell);
    if (unpacked.localId === 0) return null;
    const ts = this.get(unpacked.tilesetIndex);
    if (!ts) return null;
    const buf = ts.getTile(unpacked.localId);
    if (!buf) return null;
    const meta = ts.getMeta(unpacked.localId) ?? { uid: `tile-${unpacked.localId}` };
    return {
      tileset: ts,
      tilesetIndex: unpacked.tilesetIndex,
      localId: unpacked.localId,
      buf,
      meta,
      flags: {
        flipH: unpacked.flipH,
        flipV: unpacked.flipV,
        flipD: unpacked.flipD,
      },
    };
  }

  resetDefault(): void {
    this.tilesets = [new Tileset("tileset-default", "Main Tileset", 16, 16)];
  }

  toSnapshot(): TilesetRegistrySnapshot {
    return {
      tilesets: this.tilesets.map((ts) => ts.toSnapshot()),
    };
  }

  fromSnapshot(snap: TilesetRegistrySnapshot): void {
    if (!snap.tilesets || snap.tilesets.length === 0) {
      this.resetDefault();
      return;
    }
    this.tilesets = snap.tilesets.map((s) => Tileset.fromSnapshot(s));
  }

  toExtSnapshot(): TilesetRegistryExtSnapshot {
    const ts0 = this.tilesets[0];
    return {
      tileset0: {
        margin: ts0.margin,
        spacing: ts0.spacing,
        meta: ts0.meta.map((m) => cloneMeta(m)),
      },
      extraTilesets: this.tilesets.slice(1).map((ts) => ts.toSnapshot()),
    };
  }

  applyExtSnapshot(ext: TilesetRegistryExtSnapshot): void {
    const ts0 = this.tilesets[0];
    if (ext.tileset0) {
      ts0.margin = ext.tileset0.margin ?? 0;
      ts0.spacing = ext.tileset0.spacing ?? 0;
      if (Array.isArray(ext.tileset0.meta) && ext.tileset0.meta.length > 0) {
        ts0.meta = ext.tileset0.meta.map((m) => cloneMeta(m));
      }
      while (ts0.meta.length < ts0.tiles.length) {
        ts0.meta.push({ uid: nextTileUid() });
      }
    }
    this.tilesets = [ts0];
    if (Array.isArray(ext.extraTilesets)) {
      for (const snap of ext.extraTilesets) {
        this.tilesets.push(Tileset.fromSnapshot(snap));
      }
    }
  }
}

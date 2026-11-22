import { PixelBuffer } from "../document/PixelBuffer.ts";
import {
  type CellFlags,
  packCell,
  transformTileCoord,
  unpackCell,
} from "./cell.ts";
import { TilemapData } from "./TilemapEngine.ts";
import { type TileMeta, Tileset } from "./Tileset.ts";

export interface SliceOptions {
  tileWidth: number;
  tileHeight: number;
  margin?: number;
  spacing?: number;
  skipEmpty?: boolean;
  dedupe?: boolean;
  dedupeFlips?: boolean;
}

export function isBufferEmpty(buf: PixelBuffer): boolean {
  for (let i = 3; i < buf.data.length; i += 4) {
    if (buf.data[i] !== 0) return false;
  }
  return true;
}

export function computeBufferSignature(
  buf: PixelBuffer,
  flags?: CellFlags
): string {
  const f: CellFlags = flags ?? { flipH: false, flipV: false, flipD: false };
  const w = buf.width;
  const h = buf.height;
  const parts: number[] = [];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const { sx, sy } = transformTileCoord(x, y, w, h, f);
      const idx = (sy * w + sx) * 4;
      const a = buf.data[idx + 3];
      if (a === 0) {
        parts.push(0);
      } else {
        parts.push(
          ((buf.data[idx] << 24) |
            (buf.data[idx + 1] << 16) |
            (buf.data[idx + 2] << 8) |
            a) >>>
            0
        );
      }
    }
  }
  return `${w}x${h}:${parts.join(",")}`;
}

function extractSubBuffer(
  src: PixelBuffer,
  ox: number,
  oy: number,
  tw: number,
  th: number
): PixelBuffer {
  const out = new PixelBuffer(tw, th);
  const mw = Math.min(tw, src.width - ox);
  const mh = Math.min(th, src.height - oy);
  for (let y = 0; y < mh; y++) {
    if (oy + y < 0) continue;
    for (let x = 0; x < mw; x++) {
      if (ox + x < 0) continue;
      const [r, g, b, a] = src.getPixel(ox + x, oy + y);
      if (a > 0) out.setPixel(x, y, r, g, b, a);
    }
  }
  return out;
}

const ALL_FLAG_COMBOS: readonly CellFlags[] = [
  { flipH: false, flipV: false, flipD: false },
  { flipH: true, flipV: false, flipD: false },
  { flipH: false, flipV: true, flipD: false },
  { flipH: true, flipV: true, flipD: false },
  { flipH: false, flipV: false, flipD: true },
  { flipH: true, flipV: false, flipD: true },
  { flipH: false, flipV: true, flipD: true },
  { flipH: true, flipV: true, flipD: true },
];

export function sliceImageToTiles(
  src: PixelBuffer,
  opts: SliceOptions,
  id = `tileset-${Date.now().toString(36)}`,
  name = "Imported Tileset"
): { tileset: Tileset; totalCells: number; uniqueTiles: number } {
  const tw = Math.max(4, Math.min(64, Math.round(opts.tileWidth)));
  const th = Math.max(4, Math.min(64, Math.round(opts.tileHeight)));
  const margin = Math.max(0, Math.round(opts.margin ?? 0));
  const spacing = Math.max(0, Math.round(opts.spacing ?? 0));
  const skipEmpty = opts.skipEmpty ?? true;
  const dedupe = opts.dedupe ?? true;

  const ts = new Tileset(id, name, tw, th);
  ts.margin = margin;
  ts.spacing = spacing;

  const seen = new Set<string>();
  let totalCells = 0;

  for (let y = margin; y + th <= src.height; y += th + spacing) {
    for (let x = margin; x + tw <= src.width; x += tw + spacing) {
      totalCells++;
      const sub = extractSubBuffer(src, x, y, tw, th);
      if (skipEmpty && isBufferEmpty(sub)) continue;
      if (dedupe) {
        const sig = computeBufferSignature(sub);
        if (seen.has(sig)) continue;
        seen.add(sig);
      }
      ts.addTile(sub);
    }
  }

  return { tileset: ts, totalCells, uniqueTiles: ts.count };
}

export function sliceLayerToTilemap(
  src: PixelBuffer,
  opts: SliceOptions,
  tilesetIndex = 0,
  id = `tileset-${Date.now().toString(36)}`,
  name = "Sliced Tileset"
): {
  tileset: Tileset;
  tilemap: TilemapData;
  totalCells: number;
  uniqueTiles: number;
} {
  const tw = Math.max(4, Math.min(64, Math.round(opts.tileWidth)));
  const th = Math.max(4, Math.min(64, Math.round(opts.tileHeight)));
  const margin = Math.max(0, Math.round(opts.margin ?? 0));
  const spacing = Math.max(0, Math.round(opts.spacing ?? 0));
  const dedupeFlips = opts.dedupeFlips ?? true;
  const dedupe = opts.dedupe ?? true;

  const cols = Math.max(
    1,
    Math.floor((src.width - margin + spacing) / (tw + spacing))
  );
  const rows = Math.max(
    1,
    Math.floor((src.height - margin + spacing) / (th + spacing))
  );

  const ts = new Tileset(id, name, tw, th);
  const tm = new TilemapData(cols, rows);
  const sigMap = new Map<string, { localId: number; flags: CellFlags }>();
  let totalCells = 0;

  for (let r = 0; r < rows; r++) {
    const oy = margin + r * (th + spacing);
    for (let c = 0; c < cols; c++) {
      const ox = margin + c * (tw + spacing);
      totalCells++;
      const sub = extractSubBuffer(src, ox, oy, tw, th);
      if (isBufferEmpty(sub)) continue;

      const sig = computeBufferSignature(sub);
      const existing = dedupe ? sigMap.get(sig) : undefined;
      if (existing) {
        tm.setCell(c, r, packCell(tilesetIndex, existing.localId, existing.flags));
        continue;
      }

      const newId = ts.addTile(sub);
      if (dedupe) {
        const combos =
          dedupeFlips && tw === th
            ? ALL_FLAG_COMBOS
            : dedupeFlips
              ? ALL_FLAG_COMBOS.filter((f) => !f.flipD)
              : [ALL_FLAG_COMBOS[0]];
        for (const flags of combos) {
          const transformedSig = computeBufferSignature(sub, flags);
          if (!sigMap.has(transformedSig)) {
            sigMap.set(transformedSig, { localId: newId, flags });
          }
        }
      }
      tm.setCell(c, r, packCell(tilesetIndex, newId));
    }
  }

  return { tileset: ts, tilemap: tm, totalCells, uniqueTiles: ts.count };
}

export function resolveAnimatedTileId(
  tileset: Tileset,
  localId: number,
  elapsedMs: number
): number {
  const anim = tileset.getMeta(localId)?.animation;
  if (!anim || anim.frames.length === 0) return localId;
  let total = 0;
  for (const f of anim.frames) {
    total += Math.max(1, f.durationMs);
  }
  if (total <= 0) return localId;
  let t = ((elapsedMs % total) + total) % total;
  for (const f of anim.frames) {
    const d = Math.max(1, f.durationMs);
    if (t < d) return f.localId;
    t -= d;
  }
  return anim.frames[0].localId;
}

export function findUnusedTiles(
  tileset: Tileset,
  tilesetIndex: number,
  tilemaps: Iterable<TilemapData>
): number[] {
  const used = new Set<number>();
  for (const tm of tilemaps) {
    for (let i = 0; i < tm.grid.length; i++) {
      const u = unpackCell(tm.grid[i]);
      if (u.localId > 0 && u.tilesetIndex === tilesetIndex) {
        used.add(u.localId);
      }
    }
  }
  // Also mark animation frame targets as used if their base tile is used
  for (const id of Array.from(used)) {
    const anim = tileset.getMeta(id)?.animation;
    if (anim) {
      for (const f of anim.frames) used.add(f.localId);
    }
  }
  const unused: number[] = [];
  for (let id = 1; id <= tileset.count; id++) {
    if (!used.has(id)) unused.push(id);
  }
  return unused;
}

export function findDuplicateTiles(
  tileset: Tileset
): Array<{ keepId: number; duplicateIds: number[] }> {
  const firstBySig = new Map<string, number>();
  const groups = new Map<number, number[]>();

  for (let id = 1; id <= tileset.count; id++) {
    const buf = tileset.getTile(id);
    if (!buf) continue;
    const sig = computeBufferSignature(buf);
    const keepId = firstBySig.get(sig);
    if (keepId === undefined) {
      firstBySig.set(sig, id);
    } else {
      const arr = groups.get(keepId) ?? [];
      arr.push(id);
      groups.set(keepId, arr);
    }
  }

  return Array.from(groups.entries()).map(([keepId, duplicateIds]) => ({
    keepId,
    duplicateIds,
  }));
}

export function mergeDuplicateTiles(tileset: Tileset): {
  remap: Map<number, number>;
  mergedCount: number;
} {
  const groups = findDuplicateTiles(tileset);
  const dupToKeep = new Map<number, number>();
  for (const g of groups) {
    for (const d of g.duplicateIds) {
      dupToKeep.set(d, g.keepId);
    }
  }

  const oldCount = tileset.count;
  const remap = new Map<number, number>();
  if (dupToKeep.size === 0) {
    for (let id = 1; id <= oldCount; id++) remap.set(id, id);
    return { remap, mergedCount: 0 };
  }

  const nextTiles = [tileset.tiles[0]];
  const nextMeta = [tileset.meta[0] ?? { uid: "empty" }];
  const oldToNewKept = new Map<number, number>();

  for (let id = 1; id <= oldCount; id++) {
    if (dupToKeep.has(id)) continue;
    const newId = nextTiles.length;
    nextTiles.push(tileset.tiles[id]);
    nextMeta.push(tileset.meta[id] ?? { uid: `tile-${id}` });
    oldToNewKept.set(id, newId);
  }

  for (let id = 1; id <= oldCount; id++) {
    const target = dupToKeep.get(id) ?? id;
    remap.set(id, oldToNewKept.get(target) ?? 0);
  }

  tileset.tiles = nextTiles;
  tileset.meta = nextMeta;
  tileset.remapAnimations(remap);

  return { remap, mergedCount: dupToKeep.size };
}

export function computeUsageOrder(
  tileset: Tileset,
  tilesetIndex: number,
  tilemaps: Iterable<TilemapData>
): number[] {
  const counts = new Array<number>(tileset.count + 1).fill(0);
  for (const tm of tilemaps) {
    for (let i = 0; i < tm.grid.length; i++) {
      const u = unpackCell(tm.grid[i]);
      if (
        u.localId > 0 &&
        u.localId <= tileset.count &&
        u.tilesetIndex === tilesetIndex
      ) {
        counts[u.localId]++;
      }
    }
  }
  const ids = Array.from({ length: tileset.count }, (_, i) => i + 1);
  ids.sort((a, b) => counts[b] - counts[a] || a - b);
  return ids;
}

const VARIANT_PREFIX = "variant:";

export function getVariantBaseUid(meta?: TileMeta): string | null {
  if (!meta?.tags) return null;
  for (const tag of meta.tags) {
    if (tag.startsWith(VARIANT_PREFIX)) {
      return tag.slice(VARIANT_PREFIX.length);
    }
  }
  return null;
}

export function setTileVariantOf(
  tileset: Tileset,
  tileId: number,
  baseTileId: number | null
): void {
  const meta = tileset.getMeta(tileId);
  if (!meta) return;
  const filtered = (meta.tags ?? []).filter((t) => !t.startsWith(VARIANT_PREFIX));
  if (baseTileId !== null && baseTileId > 0 && baseTileId !== tileId) {
    const baseMeta = tileset.getMeta(baseTileId);
    if (baseMeta) {
      filtered.push(`${VARIANT_PREFIX}${baseMeta.uid}`);
    }
  }
  tileset.setMeta(tileId, { tags: filtered });
}

export function getVariantTileIds(
  tileset: Tileset,
  baseLocalId: number
): number[] {
  const baseMeta = tileset.getMeta(baseLocalId);
  if (!baseMeta) return [];
  const out = [baseLocalId];
  const tag = `${VARIANT_PREFIX}${baseMeta.uid}`;
  for (let id = 1; id <= tileset.count; id++) {
    if (id === baseLocalId) continue;
    if (tileset.getMeta(id)?.tags?.includes(tag)) {
      out.push(id);
    }
  }
  return out;
}

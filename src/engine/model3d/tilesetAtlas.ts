import { PixelBuffer } from "../document/PixelBuffer.ts";
import { Tileset } from "../tiles/Tileset.ts";
import type { Vec2 } from "./types.ts";
import { transformFaceCornerUvs } from "./uvOps.ts";

export interface PaddedTileEntry {
  tileId: number;
  uid: string;
  innerX: number;
  innerY: number;
  width: number;
  height: number;
}

export interface PaddedTilesetAtlas {
  tilesetId: string;
  columns: number;
  rows: number;
  width: number;
  height: number;
  buffer: PixelBuffer;
  byUid: Map<string, PaddedTileEntry>;
  byTileId: Map<number, PaddedTileEntry>;
}

/**
 * Packs `tileset.tiles[1..tileset.count]` into a deterministic RGBA atlas where each
 * `(tileWidth + 2) × (tileHeight + 2)` slot holds the inner tile pixels plus a 1px
 * extruded edge & 4-corner gutter to prevent UV bleeding under linear/grazing sampling.
 */
export function buildPaddedTilesetAtlas(tileset: Tileset): PaddedTilesetAtlas {
  const tw = Math.max(1, tileset.tileWidth);
  const th = Math.max(1, tileset.tileHeight);
  const slotW = tw + 2;
  const slotH = th + 2;

  const tileCount = Math.max(0, tileset.count);
  const columns = Math.max(1, Math.ceil(Math.sqrt(Math.max(1, tileCount))));
  const rows = tileCount === 0 ? 1 : Math.ceil(tileCount / columns);

  const width = columns * slotW;
  const height = rows * slotH;
  const buffer = new PixelBuffer(width, height);
  const byUid = new Map<string, PaddedTileEntry>();
  const byTileId = new Map<number, PaddedTileEntry>();

  for (let tileId = 1; tileId <= tileCount; tileId++) {
    const tileBuf = tileset.getTile(tileId);
    if (!tileBuf) continue;

    const meta = tileset.getMeta(tileId);
    const uid = meta?.uid ?? `tile-${tileId}`;

    const slotIndex = tileId - 1;
    const col = slotIndex % columns;
    const row = Math.floor(slotIndex / columns);
    const slotX = col * slotW;
    const slotY = row * slotH;
    const innerX = slotX + 1;
    const innerY = slotY + 1;

    // Copy inner pixels
    for (let y = 0; y < th; y++) {
      for (let x = 0; x < tw; x++) {
        const [r, g, b, a] = tileBuf.getPixel(x, y);
        if (a !== 0) {
          buffer.setPixel(innerX + x, innerY + y, r, g, b, a);
        }
      }
    }

    // Extrude top & bottom 1px edges
    for (let x = 0; x < tw; x++) {
      const [tr, tg, tb, ta] = tileBuf.getPixel(x, 0);
      if (ta !== 0) {
        buffer.setPixel(innerX + x, slotY, tr, tg, tb, ta);
      }
      const [br, bg, bb, ba] = tileBuf.getPixel(x, th - 1);
      if (ba !== 0) {
        buffer.setPixel(innerX + x, innerY + th, br, bg, bb, ba);
      }
    }

    // Extrude left & right 1px edges
    for (let y = 0; y < th; y++) {
      const [lr, lg, lb, la] = tileBuf.getPixel(0, y);
      if (la !== 0) {
        buffer.setPixel(slotX, innerY + y, lr, lg, lb, la);
      }
      const [rr, rg, rb, ra] = tileBuf.getPixel(tw - 1, y);
      if (ra !== 0) {
        buffer.setPixel(innerX + tw, innerY + y, rr, rg, rb, ra);
      }
    }

    // Extrude 4 corners
    const [tlr, tlg, tlb, tla] = tileBuf.getPixel(0, 0);
    if (tla !== 0) buffer.setPixel(slotX, slotY, tlr, tlg, tlb, tla);

    const [trr, trg, trb, tra] = tileBuf.getPixel(tw - 1, 0);
    if (tra !== 0) buffer.setPixel(innerX + tw, slotY, trr, trg, trb, tra);

    const [blr, blg, blb, bla] = tileBuf.getPixel(0, th - 1);
    if (bla !== 0) buffer.setPixel(slotX, innerY + th, blr, blg, blb, bla);

    const [brr, brg, brb, bra] = tileBuf.getPixel(tw - 1, th - 1);
    if (bra !== 0) {
      buffer.setPixel(innerX + tw, innerY + th, brr, brg, brb, bra);
    }

    const entry: PaddedTileEntry = {
      tileId,
      uid,
      innerX,
      innerY,
      width: tw,
      height: th,
    };
    byUid.set(uid, entry);
    byTileId.set(tileId, entry);
  }

  return {
    tilesetId: tileset.id,
    columns,
    rows,
    width,
    height,
    buffer,
    byUid,
    byTileId,
  };
}

/**
 * Resolves a tile entry in `atlas` by persistent `tileUid` first, falling back to `cachedTileId`.
 * When `elapsedMs` is provided and the resolved base tile defines `TileMeta.animation.frames`,
 * loops over the frame sequence and returns the active animation frame's `PaddedTileEntry`.
 */
export function resolveTileEntry(
  atlas: PaddedTilesetAtlas,
  tileset: Tileset,
  tileUid: string,
  cachedTileId: number,
  elapsedMs?: number
): PaddedTileEntry | undefined {
  const baseEntry =
    (tileUid ? atlas.byUid.get(tileUid) : undefined) ??
    atlas.byTileId.get(cachedTileId);
  if (!baseEntry) return undefined;

  if (elapsedMs === undefined) {
    return baseEntry;
  }

  const meta = tileset.getMeta(baseEntry.tileId);
  const frames = meta?.animation?.frames;
  if (!frames || frames.length === 0) {
    return baseEntry;
  }

  let totalDuration = 0;
  for (const frame of frames) {
    totalDuration += Math.max(1, frame.durationMs);
  }
  if (totalDuration <= 0) {
    return baseEntry;
  }

  let t = elapsedMs % totalDuration;
  if (t < 0) t += totalDuration;

  let accum = 0;
  let activeLocalId = frames[0].localId;
  for (const frame of frames) {
    const dur = Math.max(1, frame.durationMs);
    if (t < accum + dur) {
      activeLocalId = frame.localId;
      break;
    }
    accum += dur;
  }

  return atlas.byTileId.get(activeLocalId) ?? baseEntry;
}

/**
 * Returns the 4 pixel-space UV corners (`[bottomLeft, bottomRight, topRight, topLeft]`)
 * for the resolved tile's inner rect `[innerX, innerY]..[innerX + width, innerY + height]`
 * with `rotation`, `flipX`, and `flipY` applied.
 */
export function getTileQuadPixelUvs(
  atlas: PaddedTilesetAtlas,
  tileset: Tileset,
  tileUid: string,
  cachedTileId: number,
  rotation: 0 | 90 | 180 | 270,
  flipX: boolean,
  flipY: boolean,
  elapsedMs?: number
): [Vec2, Vec2, Vec2, Vec2] {
  const entry = resolveTileEntry(
    atlas,
    tileset,
    tileUid,
    cachedTileId,
    elapsedMs
  );
  if (!entry) {
    const fallbackW = Math.max(1, tileset.tileWidth);
    const fallbackH = Math.max(1, tileset.tileHeight);
    return [
      [0, fallbackH],
      [fallbackW, fallbackH],
      [fallbackW, 0],
      [0, 0],
    ];
  }

  const x0 = entry.innerX;
  const y0 = entry.innerY;
  const x1 = entry.innerX + entry.width;
  const y1 = entry.innerY + entry.height;

  const baseCorners: Vec2[] = [
    [x0, y1],
    [x1, y1],
    [x1, y0],
    [x0, y0],
  ];
  const transformed = transformFaceCornerUvs(baseCorners, rotation, flipX, flipY);
  return [transformed[0], transformed[1], transformed[2], transformed[3]];
}

import { TilemapData, Tileset } from "./TilemapEngine.ts";

export type AutoTileMode = "4bit" | "blob47";

export interface AutoTileRuleset {
  id: string;
  name: string;
  mode: AutoTileMode;
  fallbackTileId: number;
  maskToTile: Map<number, number>;
}

/**
 * Computes neighbor bitmask for `(col, row)` against `terrainTileIds`.
 * - `"4bit"`: N=1, E=2, S=4, W=8 (0..15)
 * - `"blob47"`: N=1, NE=2, E=4, SE=8, S=16, SW=32, W=64, NW=128
 *   with diagonals filtered so each corner requires both adjacent cardinals.
 */
export function computeAutoTileBitmask(
  tilemap: TilemapData,
  col: number,
  row: number,
  terrainTileIds: Set<number>,
  mode: AutoTileMode
): number {
  const has = (c: number, r: number) => terrainTileIds.has(tilemap.getCell(c, r));

  const n = has(col, row - 1);
  const e = has(col + 1, row);
  const s = has(col, row + 1);
  const w = has(col - 1, row);

  if (mode === "4bit") {
    let mask = 0;
    if (n) mask |= 1;
    if (e) mask |= 2;
    if (s) mask |= 4;
    if (w) mask |= 8;
    return mask;
  }

  let mask = 0;
  if (n) mask |= 1;
  if (n && e && has(col + 1, row - 1)) mask |= 2;
  if (e) mask |= 4;
  if (e && s && has(col + 1, row + 1)) mask |= 8;
  if (s) mask |= 16;
  if (s && w && has(col - 1, row + 1)) mask |= 32;
  if (w) mask |= 64;
  if (w && n && has(col - 1, row - 1)) mask |= 128;
  return mask;
}

function collapseBlobTo4Bit(blobMask: number): number {
  let m = 0;
  if (blobMask & 1) m |= 1; // N
  if (blobMask & 4) m |= 2; // E
  if (blobMask & 16) m |= 4; // S
  if (blobMask & 64) m |= 8; // W
  return m;
}

export function resolveAutoTileId(
  ruleset: AutoTileRuleset,
  mask: number,
  mode: AutoTileMode = ruleset.mode
): number {
  const direct = ruleset.maskToTile.get(mask);
  if (direct !== undefined) return direct;

  if (mode === "blob47") {
    const cardinal = collapseBlobTo4Bit(mask);
    const cardMatch = ruleset.maskToTile.get(cardinal);
    if (cardMatch !== undefined) return cardMatch;
  }

  return ruleset.fallbackTileId;
}

export function paintAutoTileCell(
  tilemap: TilemapData,
  col: number,
  row: number,
  ruleset: AutoTileRuleset,
  erase: boolean,
  modeOverride?: AutoTileMode
): number {
  if (col < 0 || row < 0 || col >= tilemap.cols || row >= tilemap.rows) {
    return 0;
  }

  const mode = modeOverride ?? ruleset.mode;
  const terrainIds = new Set<number>(ruleset.maskToTile.values());
  terrainIds.add(ruleset.fallbackTileId);

  let changed = 0;
  if (erase) {
    if (tilemap.setCell(col, row, 0)) changed++;
  } else if (!terrainIds.has(tilemap.getCell(col, row))) {
    if (tilemap.setCell(col, row, ruleset.fallbackTileId)) changed++;
  }

  // Recompute `(col, row)` and all 8 surrounding terrain cells
  const updates: Array<{ c: number; r: number; id: number }> = [];
  for (let dr = -1; dr <= 1; dr++) {
    for (let dc = -1; dc <= 1; dc++) {
      const nc = col + dc;
      const nr = row + dr;
      if (nc < 0 || nr < 0 || nc >= tilemap.cols || nr >= tilemap.rows) {
        continue;
      }
      if (erase && nc === col && nr === row) continue;
      const currentId = tilemap.getCell(nc, nr);
      if (nc === col && nr === row ? !erase : terrainIds.has(currentId)) {
        const mask = computeAutoTileBitmask(
          tilemap,
          nc,
          nr,
          terrainIds,
          mode
        );
        const resolved = resolveAutoTileId(ruleset, mask, mode);
        updates.push({ c: nc, r: nr, id: resolved });
      }
    }
  }

  for (const u of updates) {
    if (tilemap.setCell(u.c, u.r, u.id)) {
      changed++;
    }
  }

  return changed;
}

/**
 * Generates 16 crisp bordered terrain tiles (4-bit masks 0..15) in `tileset`
 * so auto-tiling can be tested immediately in 1 click.
 */
export function generate16TileAutoTileSet(tileset: Tileset): AutoTileRuleset {
  const maskToTile = new Map<number, number>();
  const w = tileset.tileWidth;
  const h = tileset.tileHeight;

  for (let mask = 0; mask < 16; mask++) {
    const tileId = tileset.addTile();
    const buf = tileset.getTile(tileId)!;
    const hasN = (mask & 1) !== 0;
    const hasE = (mask & 2) !== 0;
    const hasS = (mask & 4) !== 0;
    const hasW = (mask & 8) !== 0;

    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const edgeN = !hasN && y === 0;
        const edgeS = !hasS && y === h - 1;
        const edgeW = !hasW && x === 0;
        const edgeE = !hasE && x === w - 1;
        const rimN = !hasN && y === 1;
        const rimW = !hasW && x === 1;

        if (edgeN || edgeS || edgeW || edgeE) {
          buf.setPixel(x, y, 22, 34, 48, 255);
        } else if (rimN || rimW) {
          buf.setPixel(x, y, 146, 224, 118, 255);
        } else {
          const tex = (x * 5 + y * 9 + mask) % 13 === 0;
          buf.setPixel(
            x,
            y,
            tex ? 68 : 82,
            tex ? 156 : 176,
            tex ? 104 : 118,
            255
          );
        }
      }
    }
    maskToTile.set(mask, tileId);
  }

  return {
    id: "autotile-16",
    name: "Auto-Tile 16",
    mode: "4bit",
    fallbackTileId: maskToTile.get(0) ?? 1,
    maskToTile,
  };
}

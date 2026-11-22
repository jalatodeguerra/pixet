import { PixelBuffer } from "../document/PixelBuffer.ts";
import type { AutoTileRuleset } from "./autoTile.ts";
import { packCell, unpackCell } from "./cell.ts";
import { type CellChange, mulberry32 } from "./mapTools.ts";
import { TilemapData, Tileset } from "./TilemapEngine.ts";

/** Peering bit order: 0=N, 1=NE, 2=E, 3=SE, 4=S, 5=SW, 6=W, 7=NW */
export type PeeringBits = [
  string | null,
  string | null,
  string | null,
  string | null,
  string | null,
  string | null,
  string | null,
  string | null,
];

export type TerrainMode = "edges4" | "blob47" | "corners" | "edgesCorners";

export interface Terrain {
  id: string;
  name: string;
  color: string;
}

export interface TerrainSet {
  id: string;
  name: string;
  mode: TerrainMode;
  tilesetIndex: number;
  terrains: Terrain[];
  peering: Record<number, PeeringBits>;
}

export const BLOB47_MASKS: readonly number[] = (() => {
  const masks: number[] = [];
  for (let m = 0; m < 256; m++) {
    const n = (m & 1) !== 0;
    const ne = (m & 2) !== 0;
    const e = (m & 4) !== 0;
    const se = (m & 8) !== 0;
    const s = (m & 16) !== 0;
    const sw = (m & 32) !== 0;
    const w = (m & 64) !== 0;
    const nw = (m & 128) !== 0;
    if (ne && !(n && e)) continue;
    if (se && !(e && s)) continue;
    if (sw && !(s && w)) continue;
    if (nw && !(w && n)) continue;
    masks.push(m);
  }
  return masks;
})();

const DIR_OFFSETS: readonly [number, number][] = [
  [0, -1], // 0: N
  [1, -1], // 1: NE
  [1, 0], // 2: E
  [1, 1], // 3: SE
  [0, 1], // 4: S
  [-1, 1], // 5: SW
  [-1, 0], // 6: W
  [-1, -1], // 7: NW
];

export function getActivePeeringIndices(mode: TerrainMode): readonly number[] {
  if (mode === "edges4") return [0, 2, 4, 6];
  if (mode === "corners") return [1, 3, 5, 7];
  return [0, 1, 2, 3, 4, 5, 6, 7];
}

export function createEmptyPeering(): PeeringBits {
  return [null, null, null, null, null, null, null, null];
}

export function cloneTerrainSets(sets: readonly TerrainSet[]): TerrainSet[] {
  return sets.map((s) => ({
    id: s.id,
    name: s.name,
    mode: s.mode,
    tilesetIndex: s.tilesetIndex,
    terrains: s.terrains.map((t) => ({ ...t })),
    peering: Object.fromEntries(
      Object.entries(s.peering).map(([k, bits]) => [
        Number(k),
        [...bits] as PeeringBits,
      ])
    ),
  }));
}

export function peeringFromMask(
  mask: number,
  terrainId: string,
  mode: TerrainMode
): PeeringBits {
  const out = createEmptyPeering();
  if (mode === "edges4") {
    if (mask & 1) out[0] = terrainId;
    if (mask & 2) out[2] = terrainId;
    if (mask & 4) out[4] = terrainId;
    if (mask & 8) out[6] = terrainId;
    return out;
  }
  if (mode === "corners") {
    if (mask & 1) out[1] = terrainId;
    if (mask & 2) out[3] = terrainId;
    if (mask & 4) out[5] = terrainId;
    if (mask & 8) out[7] = terrainId;
    return out;
  }
  for (let bit = 0; bit < 8; bit++) {
    if ((mask & (1 << bit)) !== 0) {
      out[bit] = terrainId;
    }
  }
  return out;
}

export function maskFromPeering(
  bits: PeeringBits,
  terrainId: string,
  mode: TerrainMode
): number {
  if (mode === "edges4") {
    let m = 0;
    if (bits[0] === terrainId) m |= 1;
    if (bits[2] === terrainId) m |= 2;
    if (bits[4] === terrainId) m |= 4;
    if (bits[6] === terrainId) m |= 8;
    return m;
  }
  if (mode === "corners") {
    let m = 0;
    if (bits[1] === terrainId) m |= 1;
    if (bits[3] === terrainId) m |= 2;
    if (bits[5] === terrainId) m |= 4;
    if (bits[7] === terrainId) m |= 8;
    return m;
  }
  let m = 0;
  for (let bit = 0; bit < 8; bit++) {
    if (bits[bit] === terrainId) m |= 1 << bit;
  }
  return m;
}

export function getExpectedMasksForMode(mode: TerrainMode): readonly number[] {
  if (mode === "edges4" || mode === "corners") {
    return Array.from({ length: 16 }, (_, i) => i);
  }
  return BLOB47_MASKS;
}

export function getMissingTerrainMasks(
  set: TerrainSet,
  terrainId: string
): number[] {
  const present = new Set<number>();
  for (const bits of Object.values(set.peering)) {
    const hasTerrain = bits.some((b) => b === terrainId);
    if (!hasTerrain && set.mode !== "blob47") {
      // Allow mask 0 if at least one tile has an empty peering entry
      const allNull = bits.every((b) => b === null);
      if (allNull) present.add(0);
      continue;
    }
    present.add(maskFromPeering(bits, terrainId, set.mode));
  }
  const expected = getExpectedMasksForMode(set.mode);
  return expected.filter((m) => !present.has(m));
}

export function rulesetFromTerrainSet(
  set: TerrainSet,
  terrainId: string
): AutoTileRuleset {
  const maskToTile = new Map<number, number>();
  let fallbackTileId = 1;
  for (const [idStr, bits] of Object.entries(set.peering)) {
    const localId = Number(idStr);
    if (localId <= 0) continue;
    const mask = maskFromPeering(bits, terrainId, set.mode);
    if (!maskToTile.has(mask)) {
      maskToTile.set(mask, localId);
    }
    if (mask === 0) fallbackTileId = localId;
  }
  if (!maskToTile.has(0) && maskToTile.size > 0) {
    fallbackTileId = maskToTile.values().next().value ?? 1;
  }
  return {
    id: `${set.id}:${terrainId}`,
    name: set.name,
    mode: set.mode === "edges4" ? "4bit" : "blob47",
    fallbackTileId,
    maskToTile,
  };
}

export function remapTerrainSets(
  sets: TerrainSet[],
  tilesetIndex: number,
  remap: Map<number, number>
): void {
  for (const set of sets) {
    if (set.tilesetIndex !== tilesetIndex) continue;
    const nextPeering: Record<number, PeeringBits> = {};
    for (const [idStr, bits] of Object.entries(set.peering)) {
      const oldId = Number(idStr);
      const newId = remap.get(oldId) ?? oldId;
      if (newId > 0) {
        nextPeering[newId] = bits;
      }
    }
    set.peering = nextPeering;
  }
}

export function getCellTerrainId(set: TerrainSet, cell: number): string | null {
  const u = unpackCell(cell);
  if (u.localId === 0 || u.tilesetIndex !== set.tilesetIndex) return null;
  const bits = set.peering[u.localId];
  if (!bits) return null;
  const counts = new Map<string, number>();
  for (const b of bits) {
    if (b) counts.set(b, (counts.get(b) ?? 0) + 1);
  }
  let bestId: string | null = null;
  let bestCount = 0;
  for (const [tid, c] of counts.entries()) {
    if (c > bestCount) {
      bestCount = c;
      bestId = tid;
    }
  }
  return bestId ?? set.terrains[0]?.id ?? null;
}

export function resolveTerrainTile(
  set: TerrainSet,
  desired: PeeringBits,
  tileset?: Tileset,
  rng: () => number = Math.random
): number {
  const activeIndices = getActivePeeringIndices(set.mode);
  const candidates: Array<{ localId: number; score: number; exact: boolean }> =
    [];

  for (const [idStr, bits] of Object.entries(set.peering)) {
    const localId = Number(idStr);
    if (localId <= 0) continue;
    let score = 0;
    let exact = true;
    for (const idx of activeIndices) {
      if (bits[idx] === desired[idx]) {
        score += 2;
      } else {
        exact = false;
        // Slight penalty for mismatched non-null vs null
        if (bits[idx] !== null && desired[idx] !== null) {
          score -= 1;
        }
      }
    }
    candidates.push({ localId, score, exact });
  }

  if (candidates.length === 0) return 0;

  const exactMatches = candidates.filter((c) => c.exact);
  const pool =
    exactMatches.length > 0
      ? exactMatches
      : (() => {
          let maxScore = -Infinity;
          for (const c of candidates) {
            if (c.score > maxScore) maxScore = c.score;
          }
          return candidates.filter((c) => c.score === maxScore);
        })();

  if (pool.length === 1) return pool[0].localId;

  let totalWeight = 0;
  const weights = pool.map((c) => {
    const w = tileset?.getMeta(c.localId)?.probability ?? 1;
    const clamped = Math.max(0, w);
    totalWeight += clamped;
    return clamped;
  });
  if (totalWeight <= 0) return pool[0].localId;

  let t = rng() * totalWeight;
  for (let i = 0; i < pool.length; i++) {
    t -= weights[i];
    if (t <= 0) return pool[i].localId;
  }
  return pool[pool.length - 1].localId;
}

export function paintTerrainCell(
  tm: TilemapData,
  col: number,
  row: number,
  set: TerrainSet,
  terrainId: string | null,
  tileset?: Tileset,
  seed = 1
): CellChange[] {
  if (col < 0 || row < 0 || col >= tm.cols || row >= tm.rows) return [];

  // Track virtual terrain map so neighborhood re-solve sees the painted cell
  const virtualTerrain = new Map<string, string | null>();
  const radius = set.mode === "corners" ? 2 : 1;
  for (let dr = -radius - 1; dr <= radius + 1; dr++) {
    for (let dc = -radius - 1; dc <= radius + 1; dc++) {
      const nc = col + dc;
      const nr = row + dr;
      if (nc < 0 || nr < 0 || nc >= tm.cols || nr >= tm.rows) continue;
      virtualTerrain.set(`${nc},${nr}`, getCellTerrainId(set, tm.getCell(nc, nr)));
    }
  }
  virtualTerrain.set(`${col},${row}`, terrainId);

  const changes: CellChange[] = [];
  const activeIndices = getActivePeeringIndices(set.mode);

  for (let dr = -radius; dr <= radius; dr++) {
    for (let dc = -radius; dc <= radius; dc++) {
      const nc = col + dc;
      const nr = row + dr;
      if (nc < 0 || nr < 0 || nc >= tm.cols || nr >= tm.rows) continue;

      const before = tm.getCell(nc, nr);
      const cellTerrain = virtualTerrain.get(`${nc},${nr}`) ?? null;

      if (nc === col && nr === row && terrainId === null) {
        if (before !== 0) {
          changes.push({ col: nc, row: nr, before, after: 0 });
        }
        continue;
      }

      if (cellTerrain === null) continue;

      const desired = createEmptyPeering();
      for (const dirIdx of activeIndices) {
        const [ox, oy] = DIR_OFFSETS[dirIdx];
        const neighborTerrain = virtualTerrain.get(`${nc + ox},${nr + oy}`) ?? null;
        if (set.mode === "blob47" && (dirIdx === 1 || dirIdx === 3 || dirIdx === 5 || dirIdx === 7)) {
          // Canonical blob47 diagonal requires both adjacent cardinals to match
          const prevCard = (dirIdx + 7) % 8;
          const nextCard = (dirIdx + 1) % 8;
          const [px, py] = DIR_OFFSETS[prevCard];
          const [nx, ny] = DIR_OFFSETS[nextCard];
          const tPrev = virtualTerrain.get(`${nc + px},${nr + py}`) ?? null;
          const tNext = virtualTerrain.get(`${nc + nx},${nr + ny}`) ?? null;
          desired[dirIdx] =
            neighborTerrain === cellTerrain &&
            tPrev === cellTerrain &&
            tNext === cellTerrain
              ? cellTerrain
              : null;
        } else {
          desired[dirIdx] = neighborTerrain;
        }
      }

      const cellSeed =
        (seed ^ Math.imul(nc, 73856093) ^ Math.imul(nr, 19349663)) >>> 0;
      const resolvedId = resolveTerrainTile(
        set,
        desired,
        tileset,
        mulberry32(cellSeed)
      );
      if (resolvedId <= 0) continue;
      const after = packCell(set.tilesetIndex, resolvedId);
      if (before !== after) {
        changes.push({ col: nc, row: nr, before, after });
      }
    }
  }

  return changes;
}

export function applyTerrainTemplate(
  set: TerrainSet,
  template: "16tile" | "blob47" | "wangCorner" | "rpgMakerA2",
  terrainId: string,
  startLocalId = 1
): void {
  if (template === "16tile") {
    set.mode = "edges4";
    for (let m = 0; m < 16; m++) {
      set.peering[startLocalId + m] = peeringFromMask(m, terrainId, "edges4");
    }
    return;
  }
  if (template === "wangCorner") {
    set.mode = "corners";
    for (let m = 0; m < 16; m++) {
      set.peering[startLocalId + m] = peeringFromMask(m, terrainId, "corners");
    }
    return;
  }
  set.mode = "blob47";
  for (let i = 0; i < BLOB47_MASKS.length; i++) {
    set.peering[startLocalId + i] = peeringFromMask(
      BLOB47_MASKS[i],
      terrainId,
      "blob47"
    );
  }
}

export interface BlobPieces {
  center: PixelBuffer;
  outerCorner: PixelBuffer;
  innerCorner: PixelBuffer;
  edgeH: PixelBuffer;
  edgeV: PixelBuffer;
}

function blitQuarterPiece(
  dst: PixelBuffer,
  piece: PixelBuffer,
  dstX: number,
  dstY: number,
  qw: number,
  qh: number,
  flipX: boolean,
  flipY: boolean
): void {
  for (let y = 0; y < qh; y++) {
    const sy = flipY ? qh - 1 - y : y;
    for (let x = 0; x < qw; x++) {
      const sx = flipX ? qw - 1 - x : x;
      const [r, g, b, a] = piece.getPixel(
        Math.min(piece.width - 1, sx),
        Math.min(piece.height - 1, sy)
      );
      dst.setPixel(dstX + x, dstY + y, r, g, b, a);
    }
  }
}

function pickQuarterPiece(
  pieces: BlobPieces,
  hasH: boolean,
  hasV: boolean,
  hasDiag: boolean
): PixelBuffer {
  if (hasH && hasV) {
    return hasDiag ? pieces.center : pieces.innerCorner;
  }
  if (hasH && !hasV) return pieces.edgeH;
  if (!hasH && hasV) return pieces.edgeV;
  return pieces.outerCorner;
}

export function generateBlob47FromPieces(
  tileset: Tileset,
  pieces: BlobPieces,
  tilesetIndex = 0,
  terrainName = "Blob Terrain",
  color = "#55aa77"
): TerrainSet {
  const w = tileset.tileWidth;
  const h = tileset.tileHeight;
  const qw = Math.ceil(w / 2);
  const qh = Math.ceil(h / 2);
  const terrainId = "terrain-1";
  const peering: Record<number, PeeringBits> = {};

  for (let i = 0; i < BLOB47_MASKS.length; i++) {
    const mask = BLOB47_MASKS[i];
    const tileId = tileset.addTile(undefined, { name: `${terrainName} ${i}` });
    const buf = tileset.getTile(tileId)!;

    const n = (mask & 1) !== 0;
    const ne = (mask & 2) !== 0;
    const e = (mask & 4) !== 0;
    const se = (mask & 8) !== 0;
    const s = (mask & 16) !== 0;
    const sw = (mask & 32) !== 0;
    const wBit = (mask & 64) !== 0;
    const nw = (mask & 128) !== 0;

    // Top-Left (W, N, NW)
    blitQuarterPiece(
      buf,
      pickQuarterPiece(pieces, wBit, n, nw),
      0,
      0,
      qw,
      qh,
      false,
      false
    );
    // Top-Right (E, N, NE)
    blitQuarterPiece(
      buf,
      pickQuarterPiece(pieces, e, n, ne),
      w - qw,
      0,
      qw,
      qh,
      true,
      false
    );
    // Bottom-Left (W, S, SW)
    blitQuarterPiece(
      buf,
      pickQuarterPiece(pieces, wBit, s, sw),
      0,
      h - qh,
      qw,
      qh,
      false,
      true
    );
    // Bottom-Right (E, S, SE)
    blitQuarterPiece(
      buf,
      pickQuarterPiece(pieces, e, s, se),
      w - qw,
      h - qh,
      qw,
      qh,
      true,
      true
    );

    peering[tileId] = peeringFromMask(mask, terrainId, "blob47");
  }

  return {
    id: `tset-${Date.now().toString(36)}`,
    name: terrainName,
    mode: "blob47",
    tilesetIndex,
    terrains: [{ id: terrainId, name: terrainName, color }],
    peering,
  };
}

export function generateBlob47AutoTileSet(
  tileset: Tileset,
  tilesetIndex = 0
): TerrainSet {
  const qw = Math.ceil(tileset.tileWidth / 2);
  const qh = Math.ceil(tileset.tileHeight / 2);

  const fillBase = (buf: PixelBuffer) => {
    for (let y = 0; y < qh; y++) {
      for (let x = 0; x < qw; x++) {
        const tex = (x * 5 + y * 9) % 11 === 0;
        buf.setPixel(x, y, tex ? 68 : 82, tex ? 156 : 176, tex ? 104 : 118, 255);
      }
    }
  };

  const center = new PixelBuffer(qw, qh);
  fillBase(center);

  const outerCorner = new PixelBuffer(qw, qh);
  fillBase(outerCorner);
  for (let x = 0; x < qw; x++) outerCorner.setPixel(x, 0, 22, 34, 48, 255);
  for (let y = 0; y < qh; y++) outerCorner.setPixel(0, y, 22, 34, 48, 255);
  for (let x = 1; x < qw; x++) outerCorner.setPixel(x, 1, 146, 224, 118, 255);
  for (let y = 1; y < qh; y++) outerCorner.setPixel(1, y, 146, 224, 118, 255);

  const innerCorner = new PixelBuffer(qw, qh);
  fillBase(innerCorner);
  innerCorner.setPixel(0, 0, 22, 34, 48, 255);
  if (qw > 1) innerCorner.setPixel(1, 0, 146, 224, 118, 255);
  if (qh > 1) innerCorner.setPixel(0, 1, 146, 224, 118, 255);

  const edgeH = new PixelBuffer(qw, qh);
  fillBase(edgeH);
  for (let x = 0; x < qw; x++) {
    edgeH.setPixel(x, 0, 22, 34, 48, 255);
    if (qh > 1) edgeH.setPixel(x, 1, 146, 224, 118, 255);
  }

  const edgeV = new PixelBuffer(qw, qh);
  fillBase(edgeV);
  for (let y = 0; y < qh; y++) {
    edgeV.setPixel(0, y, 22, 34, 48, 255);
    if (qw > 1) edgeV.setPixel(1, y, 146, 224, 118, 255);
  }

  return generateBlob47FromPieces(
    tileset,
    { center, outerCorner, innerCorner, edgeH, edgeV },
    tilesetIndex
  );
}

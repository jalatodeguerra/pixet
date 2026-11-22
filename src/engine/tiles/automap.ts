import { unpackCell } from "./cell.ts";
import { type CellChange, mulberry32 } from "./mapTools.ts";
import { getCellTerrainId, type TerrainSet } from "./terrain.ts";
import { TilemapData } from "./TilemapEngine.ts";

export type CellMatcher =
  | { kind: "any" }
  | { kind: "empty" }
  | { kind: "tile"; localId: number; tilesetIndex?: number }
  | { kind: "terrain"; terrainSetId: string; terrainId: string }
  | { kind: "not"; inner: CellMatcher };

export interface AutoMapPatternCell {
  dx: number;
  dy: number;
  match: CellMatcher;
}

export interface AutoMapRule {
  id: string;
  name: string;
  enabled: boolean;
  match: AutoMapPatternCell[];
  output: {
    cols: number;
    rows: number;
    cells: number[];
  };
  probability: number;
  layerTarget?: string;
}

export function cloneAutoMapRules(rules: readonly AutoMapRule[]): AutoMapRule[] {
  return rules.map((r) => ({
    ...r,
    match: r.match.map((m) => ({ ...m })),
    output: { ...r.output, cells: [...r.output.cells] },
  }));
}

export function cellMatches(
  tm: TilemapData,
  col: number,
  row: number,
  matcher: CellMatcher,
  terrainSets: readonly TerrainSet[]
): boolean {
  if (matcher.kind === "any") return true;
  if (matcher.kind === "not") {
    return !cellMatches(tm, col, row, matcher.inner, terrainSets);
  }

  const inBounds = col >= 0 && row >= 0 && col < tm.cols && row < tm.rows;
  const cell = inBounds ? tm.getCell(col, row) : 0;
  const u = unpackCell(cell);

  if (matcher.kind === "empty") {
    return u.localId === 0;
  }
  if (matcher.kind === "tile") {
    if (u.localId !== matcher.localId) return false;
    if (
      matcher.tilesetIndex !== undefined &&
      u.tilesetIndex !== matcher.tilesetIndex
    ) {
      return false;
    }
    return true;
  }
  if (matcher.kind === "terrain") {
    const set = terrainSets.find((s) => s.id === matcher.terrainSetId);
    if (!set) return false;
    return getCellTerrainId(set, cell) === matcher.terrainId;
  }
  return false;
}

export function evaluateAutoMapRules(
  sourceTm: TilemapData,
  targetTm: TilemapData,
  rules: readonly AutoMapRule[],
  terrainSets: readonly TerrainSet[],
  options?: { region?: ReadonlySet<string>; seed?: number }
): CellChange[] {
  const seed = options?.seed ?? 1337;
  const region = options?.region;
  const pending = new Map<string, { col: number; row: number; after: number }>();

  for (const rule of rules) {
    if (!rule.enabled || rule.match.length === 0) continue;
    for (let r = 0; r < sourceTm.rows; r++) {
      for (let c = 0; c < sourceTm.cols; c++) {
        if (region && !region.has(`${c},${r}`)) continue;

        let ok = true;
        for (const p of rule.match) {
          if (!cellMatches(sourceTm, c + p.dx, r + p.dy, p.match, terrainSets)) {
            ok = false;
            break;
          }
        }
        if (!ok) continue;

        if (rule.probability < 1) {
          const cellSeed =
            (seed ^ Math.imul(c, 73856093) ^ Math.imul(r, 19349663)) >>> 0;
          if (mulberry32(cellSeed)() > rule.probability) continue;
        }

        for (let oy = 0; oy < rule.output.rows; oy++) {
          for (let ox = 0; ox < rule.output.cols; ox++) {
            const outCell = rule.output.cells[oy * rule.output.cols + ox] ?? 0;
            if (outCell === 0) continue;
            const tc = c + ox;
            const tr = r + oy;
            if (tc < 0 || tr < 0 || tc >= targetTm.cols || tr >= targetTm.rows) {
              continue;
            }
            pending.set(`${tc},${tr}`, { col: tc, row: tr, after: outCell >>> 0 });
          }
        }
      }
    }
  }

  const out: CellChange[] = [];
  for (const item of pending.values()) {
    const before = targetTm.getCell(item.col, item.row);
    if (before !== item.after) {
      out.push({ col: item.col, row: item.row, before, after: item.after });
    }
  }
  return out;
}

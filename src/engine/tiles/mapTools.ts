import { flipCellH, flipCellV, rotateCellCW } from "./cell.ts";
import { TilemapData } from "./TilemapEngine.ts";
import type { TilemapHistory } from "./TilemapHistory.ts";

export interface CellChange {
  col: number;
  row: number;
  before: number;
  after: number;
}

export interface TileBrush {
  cols: number;
  rows: number;
  cells: Uint32Array;
}

export type BrushAnchor = "topLeft" | "center";

export interface WeightedCell {
  cell: number;
  weight: number;
}

export function createSingleTileBrush(cell: number): TileBrush {
  return {
    cols: 1,
    rows: 1,
    cells: new Uint32Array([cell >>> 0]),
  };
}

export function flipBrushH(brush: TileBrush): TileBrush {
  const out = new Uint32Array(brush.cols * brush.rows);
  for (let r = 0; r < brush.rows; r++) {
    for (let c = 0; c < brush.cols; c++) {
      const val = brush.cells[r * brush.cols + c] >>> 0;
      const dstCol = brush.cols - 1 - c;
      out[r * brush.cols + dstCol] = val === 0 ? 0 : flipCellH(val);
    }
  }
  return { cols: brush.cols, rows: brush.rows, cells: out };
}

export function flipBrushV(brush: TileBrush): TileBrush {
  const out = new Uint32Array(brush.cols * brush.rows);
  for (let r = 0; r < brush.rows; r++) {
    const dstRow = brush.rows - 1 - r;
    for (let c = 0; c < brush.cols; c++) {
      const val = brush.cells[r * brush.cols + c] >>> 0;
      out[dstRow * brush.cols + c] = val === 0 ? 0 : flipCellV(val);
    }
  }
  return { cols: brush.cols, rows: brush.rows, cells: out };
}

export function rotateBrushCW(brush: TileBrush): TileBrush {
  const newCols = brush.rows;
  const newRows = brush.cols;
  const out = new Uint32Array(newCols * newRows);
  for (let r = 0; r < brush.rows; r++) {
    for (let c = 0; c < brush.cols; c++) {
      const val = brush.cells[r * brush.cols + c] >>> 0;
      const nc = brush.rows - 1 - r;
      const nr = c;
      out[nr * newCols + nc] = val === 0 ? 0 : rotateCellCW(val);
    }
  }
  return { cols: newCols, rows: newRows, cells: out };
}

export function anchorOffset(
  brush: TileBrush,
  anchor: BrushAnchor
): { ox: number; oy: number } {
  if (anchor === "center") {
    return {
      ox: Math.floor(brush.cols / 2),
      oy: Math.floor(brush.rows / 2),
    };
  }
  return { ox: 0, oy: 0 };
}

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function pickWeightedCell(
  pool: readonly WeightedCell[],
  rng: () => number
): number {
  let total = 0;
  for (const item of pool) {
    if (item.weight > 0) total += item.weight;
  }
  if (total <= 0) {
    return pool[0]?.cell ?? 0;
  }
  let target = rng() * total;
  for (const item of pool) {
    if (item.weight <= 0) continue;
    target -= item.weight;
    if (target <= 0) return item.cell >>> 0;
  }
  return pool[pool.length - 1]?.cell ?? 0;
}

export function snapCellLine45(
  c0: number,
  r0: number,
  c1: number,
  r1: number
): { col: number; row: number } {
  const dc = c1 - c0;
  const dr = r1 - r0;
  if (dc === 0 && dr === 0) return { col: c1, row: r1 };
  const angle = Math.atan2(dr, dc);
  const snapped = Math.round(angle / (Math.PI / 4)) * (Math.PI / 4);
  const dist = Math.max(Math.abs(dc), Math.abs(dr));
  const sx = Math.round(Math.cos(snapped));
  const sy = Math.round(Math.sin(snapped));
  return {
    col: c0 + sx * dist,
    row: r0 + sy * dist,
  };
}

export function plotCellLine(
  c0: number,
  r0: number,
  c1: number,
  r1: number
): Array<{ col: number; row: number }> {
  const pts: Array<{ col: number; row: number }> = [];
  let x0 = Math.round(c0);
  let y0 = Math.round(r0);
  const x1 = Math.round(c1);
  const y1 = Math.round(r1);
  const dx = Math.abs(x1 - x0);
  const dy = Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1;
  const sy = y0 < y1 ? 1 : -1;
  let err = dx - dy;

  for (;;) {
    pts.push({ col: x0, row: y0 });
    if (x0 === x1 && y0 === y1) break;
    const e2 = 2 * err;
    if (e2 > -dy) {
      err -= dy;
      x0 += sx;
    }
    if (e2 < dx) {
      err += dx;
      y0 += sy;
    }
  }
  return pts;
}

function posMod(n: number, m: number): number {
  return ((n % m) + m) % m;
}

function finalizeChanges(
  tm: TilemapData,
  pending: Map<string, { col: number; row: number; after: number }>
): CellChange[] {
  const out: CellChange[] = [];
  for (const item of pending.values()) {
    if (
      item.col < 0 ||
      item.row < 0 ||
      item.col >= tm.cols ||
      item.row >= tm.rows
    ) {
      continue;
    }
    const before = tm.getCell(item.col, item.row);
    const after = item.after >>> 0;
    if (before !== after) {
      out.push({ col: item.col, row: item.row, before, after });
    }
  }
  return out;
}

export function computeBrushStamp(
  tm: TilemapData,
  col: number,
  row: number,
  brush: TileBrush,
  anchor: BrushAnchor = "topLeft"
): CellChange[] {
  const { ox, oy } = anchorOffset(brush, anchor);
  const pending = new Map<string, { col: number; row: number; after: number }>();
  for (let br = 0; br < brush.rows; br++) {
    for (let bc = 0; bc < brush.cols; bc++) {
      const cell = brush.cells[br * brush.cols + bc] >>> 0;
      if (cell === 0) continue;
      const tc = col - ox + bc;
      const tr = row - oy + br;
      pending.set(`${tc},${tr}`, { col: tc, row: tr, after: cell });
    }
  }
  return finalizeChanges(tm, pending);
}

export function computeBrushStroke(
  tm: TilemapData,
  c0: number,
  r0: number,
  c1: number,
  r1: number,
  brush: TileBrush,
  anchor: BrushAnchor = "topLeft"
): CellChange[] {
  const { ox, oy } = anchorOffset(brush, anchor);
  const line = plotCellLine(c0, r0, c1, r1);
  const pending = new Map<string, { col: number; row: number; after: number }>();
  for (const pt of line) {
    for (let br = 0; br < brush.rows; br++) {
      for (let bc = 0; bc < brush.cols; bc++) {
        const cell = brush.cells[br * brush.cols + bc] >>> 0;
        if (cell === 0) continue;
        const tc = pt.col - ox + bc;
        const tr = pt.row - oy + br;
        pending.set(`${tc},${tr}`, { col: tc, row: tr, after: cell });
      }
    }
  }
  return finalizeChanges(tm, pending);
}

export function computeRectFill(
  tm: TilemapData,
  c0: number,
  r0: number,
  c1: number,
  r1: number,
  brush: TileBrush
): CellChange[] {
  const minC = Math.max(0, Math.min(c0, c1));
  const maxC = Math.min(tm.cols - 1, Math.max(c0, c1));
  const minR = Math.max(0, Math.min(r0, r1));
  const maxR = Math.min(tm.rows - 1, Math.max(r0, r1));
  const out: CellChange[] = [];

  for (let r = minR; r <= maxR; r++) {
    for (let c = minC; c <= maxC; c++) {
      const bc = (c - minC) % brush.cols;
      const br = (r - minR) % brush.rows;
      const after = brush.cells[br * brush.cols + bc] >>> 0;
      if (after === 0) continue;
      const before = tm.getCell(c, r);
      if (before !== after) {
        out.push({ col: c, row: r, before, after });
      }
    }
  }
  return out;
}

export function computeFloodFill(
  tm: TilemapData,
  startCol: number,
  startRow: number,
  brush: TileBrush,
  contiguous: boolean,
  maxCells = 1_000_000
): CellChange[] {
  if (
    startCol < 0 ||
    startRow < 0 ||
    startCol >= tm.cols ||
    startRow >= tm.rows
  ) {
    return [];
  }

  const target = tm.getCell(startCol, startRow);
  const out: CellChange[] = [];

  if (!contiguous) {
    let count = 0;
    for (let r = 0; r < tm.rows; r++) {
      for (let c = 0; c < tm.cols; c++) {
        if (tm.getCell(c, r) !== target) continue;
        const bc = posMod(c - startCol, brush.cols);
        const br = posMod(r - startRow, brush.rows);
        const after = brush.cells[br * brush.cols + bc] >>> 0;
        if (after !== target) {
          out.push({ col: c, row: r, before: target, after });
          count++;
          if (count >= maxCells) return out;
        }
      }
    }
    return out;
  }

  const visited = new Uint8Array(tm.cols * tm.rows);
  const queueCol: number[] = [startCol];
  const queueRow: number[] = [startRow];
  visited[startRow * tm.cols + startCol] = 1;
  let head = 0;

  while (head < queueCol.length && out.length < maxCells) {
    const c = queueCol[head];
    const r = queueRow[head];
    head++;

    const bc = posMod(c - startCol, brush.cols);
    const br = posMod(r - startRow, brush.rows);
    const after = brush.cells[br * brush.cols + bc] >>> 0;
    if (after !== target) {
      out.push({ col: c, row: r, before: target, after });
    }

    const neighbors: Array<[number, number]> = [
      [c + 1, r],
      [c - 1, r],
      [c, r + 1],
      [c, r - 1],
    ];
    for (const [nc, nr] of neighbors) {
      if (nc < 0 || nr < 0 || nc >= tm.cols || nr >= tm.rows) continue;
      const idx = nr * tm.cols + nc;
      if (visited[idx]) continue;
      if (tm.getCell(nc, nr) !== target) continue;
      visited[idx] = 1;
      queueCol.push(nc);
      queueRow.push(nr);
    }
  }

  return out;
}

export function computeLineStroke(
  tm: TilemapData,
  c0: number,
  r0: number,
  c1: number,
  r1: number,
  brush: TileBrush,
  snap45: boolean,
  anchor: BrushAnchor = "topLeft"
): CellChange[] {
  const end = snap45 ? snapCellLine45(c0, r0, c1, r1) : { col: c1, row: r1 };
  return computeBrushStroke(tm, c0, r0, end.col, end.row, brush, anchor);
}

export function computeEraserStamp(
  tm: TilemapData,
  col: number,
  row: number,
  size: number
): CellChange[] {
  const s = Math.max(1, Math.min(8, Math.round(size)));
  const ox = Math.floor(s / 2);
  const oy = Math.floor(s / 2);
  const pending = new Map<string, { col: number; row: number; after: number }>();
  for (let dr = 0; dr < s; dr++) {
    for (let dc = 0; dc < s; dc++) {
      const tc = col - ox + dc;
      const tr = row - oy + dr;
      pending.set(`${tc},${tr}`, { col: tc, row: tr, after: 0 });
    }
  }
  return finalizeChanges(tm, pending);
}

export function computeEraserStroke(
  tm: TilemapData,
  c0: number,
  r0: number,
  c1: number,
  r1: number,
  size: number
): CellChange[] {
  const s = Math.max(1, Math.min(8, Math.round(size)));
  const ox = Math.floor(s / 2);
  const oy = Math.floor(s / 2);
  const line = plotCellLine(c0, r0, c1, r1);
  const pending = new Map<string, { col: number; row: number; after: number }>();
  for (const pt of line) {
    for (let dr = 0; dr < s; dr++) {
      for (let dc = 0; dc < s; dc++) {
        const tc = pt.col - ox + dc;
        const tr = pt.row - oy + dr;
        pending.set(`${tc},${tr}`, { col: tc, row: tr, after: 0 });
      }
    }
  }
  return finalizeChanges(tm, pending);
}

export function computeRandomStroke(
  tm: TilemapData,
  cells: ReadonlyArray<{ col: number; row: number }>,
  pool: readonly WeightedCell[],
  seed: number
): CellChange[] {
  if (pool.length === 0) return [];
  const pending = new Map<string, { col: number; row: number; after: number }>();
  for (const pt of cells) {
    const cellSeed =
      (seed ^ Math.imul(pt.col, 73856093) ^ Math.imul(pt.row, 19349663)) >>> 0;
    const rng = mulberry32(cellSeed);
    const chosen = pickWeightedCell(pool, rng);
    pending.set(`${pt.col},${pt.row}`, {
      col: pt.col,
      row: pt.row,
      after: chosen,
    });
  }
  return finalizeChanges(tm, pending);
}

export function extractBrushFromRegion(
  tm: TilemapData,
  c0: number,
  r0: number,
  c1: number,
  r1: number
): TileBrush {
  const minC = Math.max(0, Math.min(c0, c1));
  const maxC = Math.min(tm.cols - 1, Math.max(c0, c1));
  const minR = Math.max(0, Math.min(r0, r1));
  const maxR = Math.min(tm.rows - 1, Math.max(r0, r1));
  const cols = Math.max(1, maxC - minC + 1);
  const rows = Math.max(1, maxR - minR + 1);
  const cells = new Uint32Array(cols * rows);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      cells[r * cols + c] = tm.getCell(minC + c, minR + r);
    }
  }
  return { cols, rows, cells };
}

export function computeSelectionClear(
  tm: TilemapData,
  selectedCells: ReadonlySet<string>
): CellChange[] {
  const out: CellChange[] = [];
  for (const key of selectedCells) {
    const [col, row] = key.split(",").map(Number);
    if (col < 0 || row < 0 || col >= tm.cols || row >= tm.rows) continue;
    const before = tm.getCell(col, row);
    if (before !== 0) {
      out.push({ col, row, before, after: 0 });
    }
  }
  return out;
}

export function computeSelectionMove(
  tm: TilemapData,
  selectedCells: ReadonlySet<string>,
  dCol: number,
  dRow: number
): CellChange[] {
  if (dCol === 0 && dRow === 0) return [];
  const pending = new Map<string, { col: number; row: number; after: number }>();

  for (const key of selectedCells) {
    const [col, row] = key.split(",").map(Number);
    if (col < 0 || row < 0 || col >= tm.cols || row >= tm.rows) continue;
    pending.set(key, { col, row, after: 0 });
  }

  for (const key of selectedCells) {
    const [col, row] = key.split(",").map(Number);
    if (col < 0 || row < 0 || col >= tm.cols || row >= tm.rows) continue;
    const val = tm.getCell(col, row);
    const tc = col + dCol;
    const tr = row + dRow;
    if (tc < 0 || tr < 0 || tc >= tm.cols || tr >= tm.rows) continue;
    pending.set(`${tc},${tr}`, { col: tc, row: tr, after: val });
  }

  return finalizeChanges(tm, pending);
}

export function applyCellChanges(
  tm: TilemapData,
  changes: readonly CellChange[],
  history?: TilemapHistory
): number {
  let count = 0;
  for (const ch of changes) {
    if (tm.setCell(ch.col, ch.row, ch.after)) {
      history?.recordCell(ch.col, ch.row, ch.before, ch.after);
      count++;
    }
  }
  return count;
}

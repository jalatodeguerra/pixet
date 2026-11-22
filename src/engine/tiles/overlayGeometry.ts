import type { CellFlags } from "./cell.ts";
import { getIsoOrigin, isoToScreen, screenToIso } from "./isometric.ts";

export function screenToTileCell(
  px: number,
  py: number,
  canvasW: number,
  tileW: number,
  tileH: number,
  projection: "orthogonal" | "isometric"
): { col: number; row: number } {
  if (projection === "isometric") {
    const isoTileH = Math.max(4, Math.floor(tileW / 2));
    const { originX, originY } = getIsoOrigin(canvasW, isoTileH);
    return screenToIso(px, py, tileW, isoTileH, originX, originY);
  }
  return {
    col: Math.floor(px / Math.max(1, tileW)),
    row: Math.floor(py / Math.max(1, tileH)),
  };
}

export type CellScreenOutline =
  | { kind: "rect"; x: number; y: number; w: number; h: number }
  | { kind: "polygon"; points: Array<{ x: number; y: number }> };

export function cellRectToScreen(
  col: number,
  row: number,
  cols: number,
  rows: number,
  tileW: number,
  tileH: number,
  canvasW: number,
  projection: "orthogonal" | "isometric"
): CellScreenOutline {
  const cSpan = Math.max(1, cols);
  const rSpan = Math.max(1, rows);

  if (projection === "isometric") {
    const isoTileH = Math.max(4, Math.floor(tileW / 2));
    const halfW = tileW / 2;
    const halfH = isoTileH / 2;
    const { originX, originY } = getIsoOrigin(canvasW, isoTileH);

    const topCenter = isoToScreen(col, row, tileW, isoTileH, originX, originY);
    const rightCenter = isoToScreen(
      col + cSpan - 1,
      row,
      tileW,
      isoTileH,
      originX,
      originY
    );
    const bottomCenter = isoToScreen(
      col + cSpan - 1,
      row + rSpan - 1,
      tileW,
      isoTileH,
      originX,
      originY
    );
    const leftCenter = isoToScreen(
      col,
      row + rSpan - 1,
      tileW,
      isoTileH,
      originX,
      originY
    );

    return {
      kind: "polygon",
      points: [
        { x: topCenter.x, y: topCenter.y - halfH },
        { x: rightCenter.x + halfW, y: rightCenter.y },
        { x: bottomCenter.x, y: bottomCenter.y + halfH },
        { x: leftCenter.x - halfW, y: leftCenter.y },
      ],
    };
  }

  return {
    kind: "rect",
    x: col * tileW,
    y: row * tileH,
    w: cSpan * tileW,
    h: rSpan * tileH,
  };
}

export function formatCellFlags(flags: CellFlags): string {
  const parts: string[] = [];
  if (flags.flipH) parts.push("H");
  if (flags.flipV) parts.push("V");
  if (flags.flipD) parts.push("D");
  return parts.join(" ");
}

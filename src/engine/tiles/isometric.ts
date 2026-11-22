import type { Point } from "../tools/pixelAlgos.ts";
import {
  type BlendModeName,
  blitTileTransformed,
  resolveTileFromSource,
  TilemapData,
  Tileset,
  TilesetRegistry,
} from "./TilemapEngine.ts";

export function isoToScreen(
  col: number,
  row: number,
  tileW: number,
  tileH: number,
  originX: number,
  originY: number
): Point {
  const halfW = tileW / 2;
  const halfH = tileH / 2;
  return {
    x: Math.round(originX + (col - row) * halfW),
    y: Math.round(originY + (col + row) * halfH),
  };
}

export function screenToIso(
  px: number,
  py: number,
  tileW: number,
  tileH: number,
  originX: number,
  originY: number
): { col: number; row: number } {
  const halfW = Math.max(1, tileW / 2);
  const halfH = Math.max(1, tileH / 2);
  const dx = px - originX;
  const dy = py - originY;
  const col = Math.round((dx / halfW + dy / halfH) / 2);
  const row = Math.round((dy / halfH - dx / halfW) / 2);
  return { col, row };
}

/**
 * Plots a pixel-art 2:1 isometric line snapped to ±2:±1 diagonal or vertical axis.
 */
export function plotIsoLine(
  x0: number,
  y0: number,
  x1: number,
  y1: number
): Point[] {
  const dx = x1 - x0;
  const dy = y1 - y0;
  if (dx === 0 && dy === 0) return [{ x: x0, y: y0 }];

  const points: Point[] = [];
  // Vertical snap when horizontal delta is negligible compared to vertical
  if (Math.abs(dx) * 2 < Math.abs(dy)) {
    const sy = dy >= 0 ? 1 : -1;
    const steps = Math.abs(dy);
    for (let i = 0; i <= steps; i++) {
      points.push({ x: x0, y: y0 + i * sy });
    }
    return points;
  }

  // 2:1 diagonal step: 2px horizontal per 1px vertical
  const sx = dx >= 0 ? 1 : -1;
  const sy = dy >= 0 ? 1 : -1;
  const vSteps = Math.max(1, Math.round(Math.max(Math.abs(dx) / 2, Math.abs(dy))));

  let cx = x0;
  let cy = y0;
  for (let i = 0; i < vSteps; i++) {
    points.push({ x: cx, y: cy });
    points.push({ x: cx + sx, y: cy });
    cx += 2 * sx;
    cy += sy;
  }
  points.push({ x: cx, y: cy });
  return points;
}

export function plotIsoDiamond(
  cx: number,
  cy: number,
  halfW: number,
  filled: boolean
): Point[] {
  const hh = Math.max(1, Math.round(halfW / 2));
  const points: Point[] = [];

  for (let dy = -hh; dy <= hh; dy++) {
    const rowHalf = (hh - Math.abs(dy)) * 2;
    if (filled) {
      for (let dx = -rowHalf; dx <= rowHalf; dx++) {
        points.push({ x: cx + dx, y: cy + dy });
      }
    } else if (rowHalf === 0) {
      points.push({ x: cx, y: cy + dy });
    } else {
      points.push({ x: cx - rowHalf, y: cy + dy });
      points.push({ x: cx - rowHalf + 1, y: cy + dy });
      points.push({ x: cx + rowHalf - 1, y: cy + dy });
      points.push({ x: cx + rowHalf, y: cy + dy });
    }
  }
  return points;
}

export function plotIsoBox(
  cx: number,
  cy: number,
  halfW: number,
  heightZ: number
): { top: Point[]; left: Point[]; right: Point[] } {
  const hh = Math.max(1, Math.round(halfW / 2));
  const hw = hh * 2;
  const hz = Math.max(1, Math.round(heightZ));

  const top = plotIsoDiamond(cx, cy - hz, hw, true);
  const left: Point[] = [];
  const right: Point[] = [];

  for (let x = cx - hw; x <= cx; x++) {
    const dx = x - (cx - hw);
    const topY = cy - hz + Math.floor(dx / 2);
    for (let y = topY + 1; y <= topY + hz; y++) {
      left.push({ x, y });
    }
  }

  for (let x = cx + 1; x <= cx + hw; x++) {
    const dx = cx + hw - x;
    const topY = cy - hz + Math.floor(dx / 2);
    for (let y = topY + 1; y <= topY + hz; y++) {
      right.push({ x, y });
    }
  }

  return { top, left, right };
}

export function getIsoOrigin(
  canvasW: number,
  isoTileH: number
): { originX: number; originY: number } {
  return {
    originX: Math.floor(canvasW / 2),
    originY: Math.floor(isoTileH / 2),
  };
}

export function buildIsoGridSvgPath(
  canvasW: number,
  canvasH: number,
  tileW: number,
  tileH: number
): string {
  const { originX, originY } = getIsoOrigin(canvasW, tileH);
  const halfW = tileW / 2;
  const halfH = tileH / 2;
  const maxSpan = Math.ceil((canvasW + canvasH) / Math.max(4, tileH)) + 2;

  const parts: string[] = [];
  for (let row = -maxSpan; row <= maxSpan; row++) {
    for (let col = -maxSpan; col <= maxSpan; col++) {
      const center = isoToScreen(col, row, tileW, tileH, originX, originY);
      if (
        center.x + halfW < 0 ||
        center.x - halfW > canvasW ||
        center.y + halfH < 0 ||
        center.y - halfH > canvasH
      ) {
        continue;
      }
      parts.push(
        `M${center.x} ${center.y - halfH}L${center.x + halfW} ${center.y}L${center.x} ${center.y + halfH}L${center.x - halfW} ${center.y}Z`
      );
    }
  }
  return parts.join("");
}

export function renderIsometricTilemapToBuffer(
  tilemap: TilemapData,
  tilesetOrRegistry: Tileset | TilesetRegistry,
  dst: Uint8ClampedArray,
  dstW: number,
  dstH: number,
  opacity: number,
  blendMode: BlendModeName,
  elapsedMs?: number
): void {
  const baseTs =
    tilesetOrRegistry instanceof TilesetRegistry
      ? tilesetOrRegistry.get(0)
      : tilesetOrRegistry;
  const tileW = baseTs?.tileWidth ?? 16;
  const isoTileH = Math.max(4, Math.floor(tileW / 2));
  const { originX, originY } = getIsoOrigin(dstW, isoTileH);

  // Painter's back-to-front Z-depth order (row then col)
  for (let row = 0; row < tilemap.rows; row++) {
    for (let col = 0; col < tilemap.cols; col++) {
      const cell = tilemap.getCell(col, row);
      if (cell === 0) continue;
      const resolved = resolveTileFromSource(tilesetOrRegistry, cell, elapsedMs);
      if (!resolved) continue;

      const center = isoToScreen(col, row, tileW, isoTileH, originX, originY);
      const offsetX = center.x - Math.floor(resolved.buf.width / 2);
      const offsetY = center.y - Math.floor(resolved.buf.height / 2);
      blitTileTransformed(
        dst,
        dstW,
        dstH,
        resolved.buf,
        offsetX,
        offsetY,
        resolved.flags,
        opacity,
        blendMode
      );
    }
  }
}

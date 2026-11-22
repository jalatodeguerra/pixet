export const CELL_FLIP_H = 0x80000000;
export const CELL_FLIP_V = 0x40000000;
export const CELL_FLIP_D = 0x20000000;
export const CELL_FLAGS_MASK = 0xe0000000;
export const CELL_TILESET_SHIFT = 20;
export const CELL_TILESET_MASK = 0x1ff00000;
export const CELL_LOCAL_MASK = 0x000fffff;

export interface CellFlags {
  flipH: boolean;
  flipV: boolean;
  flipD: boolean;
}

export interface UnpackedCell extends CellFlags {
  tilesetIndex: number;
  localId: number;
}

export function packCell(
  tilesetIndex: number,
  localId: number,
  flags?: Partial<CellFlags>
): number {
  const id = localId & CELL_LOCAL_MASK;
  if (id <= 0) return 0;
  const ts = (tilesetIndex & 0x1ff) << CELL_TILESET_SHIFT;
  let f = 0;
  if (flags?.flipH) f |= CELL_FLIP_H;
  if (flags?.flipV) f |= CELL_FLIP_V;
  if (flags?.flipD) f |= CELL_FLIP_D;
  return (f | ts | id) >>> 0;
}

export function unpackCell(cell: number): UnpackedCell {
  const u = cell >>> 0;
  const localId = u & CELL_LOCAL_MASK;
  if (localId === 0) {
    return {
      tilesetIndex: 0,
      localId: 0,
      flipH: false,
      flipV: false,
      flipD: false,
    };
  }
  return {
    tilesetIndex: (u & CELL_TILESET_MASK) >>> CELL_TILESET_SHIFT,
    localId,
    flipH: (u & CELL_FLIP_H) !== 0,
    flipV: (u & CELL_FLIP_V) !== 0,
    flipD: (u & CELL_FLIP_D) !== 0,
  };
}

export function flipCellH(cell: number): number {
  const u = cell >>> 0;
  if ((u & CELL_LOCAL_MASK) === 0) return 0;
  return (u ^ CELL_FLIP_H) >>> 0;
}

export function flipCellV(cell: number): number {
  const u = cell >>> 0;
  if ((u & CELL_LOCAL_MASK) === 0) return 0;
  return (u ^ CELL_FLIP_V) >>> 0;
}

export function rotateCellCW(cell: number): number {
  const { tilesetIndex, localId, flipH, flipV, flipD } = unpackCell(cell);
  if (localId === 0) return 0;
  return packCell(tilesetIndex, localId, {
    flipD: !flipD,
    flipH: !flipV,
    flipV: flipH,
  });
}

export function rotateCellCCW(cell: number): number {
  const { tilesetIndex, localId, flipH, flipV, flipD } = unpackCell(cell);
  if (localId === 0) return 0;
  return packCell(tilesetIndex, localId, {
    flipD: !flipD,
    flipH: flipV,
    flipV: !flipH,
  });
}

export function transformTileCoord(
  dx: number,
  dy: number,
  w: number,
  h: number,
  flags: CellFlags
): { sx: number; sy: number } {
  let x = flags.flipH ? w - 1 - dx : dx;
  let y = flags.flipV ? h - 1 - dy : dy;
  if (flags.flipD && w === h) {
    const t = x;
    x = y;
    y = t;
  }
  return { sx: x, sy: y };
}

export interface DirtyRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export function unionDirtyRect(
  a: DirtyRect | null,
  b: DirtyRect
): DirtyRect {
  if (b.width <= 0 || b.height <= 0) {
    return a ? { ...a } : { x: b.x, y: b.y, width: 0, height: 0 };
  }
  if (!a || a.width <= 0 || a.height <= 0) {
    return { x: b.x, y: b.y, width: b.width, height: b.height };
  }
  const minX = Math.min(a.x, b.x);
  const minY = Math.min(a.y, b.y);
  const maxX = Math.max(a.x + a.width, b.x + b.width);
  const maxY = Math.max(a.y + a.height, b.y + b.height);
  return {
    x: minX,
    y: minY,
    width: maxX - minX,
    height: maxY - minY,
  };
}

export function clampDirtyRect(
  rect: DirtyRect,
  maxW: number,
  maxH: number
): DirtyRect | null {
  if (maxW <= 0 || maxH <= 0 || rect.width <= 0 || rect.height <= 0) {
    return null;
  }
  const x0 = Math.max(0, Math.floor(rect.x));
  const y0 = Math.max(0, Math.floor(rect.y));
  const x1 = Math.min(maxW, Math.ceil(rect.x + rect.width));
  const y1 = Math.min(maxH, Math.ceil(rect.y + rect.height));
  if (x1 <= x0 || y1 <= y0) return null;
  return {
    x: x0,
    y: y0,
    width: x1 - x0,
    height: y1 - y0,
  };
}

export function expandDirtyRectPoint(
  rect: DirtyRect | null,
  x: number,
  y: number,
  pad = 0
): DirtyRect {
  const p = Math.max(0, Math.floor(pad));
  const pointRect: DirtyRect = {
    x: Math.floor(x) - p,
    y: Math.floor(y) - p,
    width: 1 + p * 2,
    height: 1 + p * 2,
  };
  return unionDirtyRect(rect, pointRect);
}

// Pure object-layer model (T5). Objects live in pixel coordinates of the
// canvas/map. A point has no w/h; a rect has both.

export type ObjectPropertyValue = string | number | boolean;

export interface TileObject {
  id: string;
  name: string;
  type: string;
  x: number;
  y: number;
  w?: number;
  h?: number;
  properties: Record<string, ObjectPropertyValue>;
}

/** Object layers keyed by layer id. */
export type ObjectLayerMap = Map<string, TileObject[]>;

/** JSON form stored in `document.tiles_ext.objectLayers`. */
export type ObjectLayersJson = Record<string, TileObject[]>;

export function isRectObject(o: TileObject): boolean {
  return o.w !== undefined && o.h !== undefined;
}

export function cloneObject(o: TileObject): TileObject {
  return {
    id: o.id,
    name: o.name,
    type: o.type,
    x: o.x,
    y: o.y,
    ...(o.w !== undefined ? { w: o.w } : {}),
    ...(o.h !== undefined ? { h: o.h } : {}),
    properties: { ...o.properties },
  };
}

export function cloneObjectLayers(map: ObjectLayerMap): ObjectLayerMap {
  const out: ObjectLayerMap = new Map();
  for (const [id, list] of map) out.set(id, list.map(cloneObject));
  return out;
}

export function objectLayersEqual(
  a: ObjectLayerMap,
  b: ObjectLayerMap
): boolean {
  return (
    JSON.stringify(serializeObjectLayers(a)) ===
    JSON.stringify(serializeObjectLayers(b))
  );
}

let objectCounter = 1;

export function nextObjectId(existing: ReadonlyArray<TileObject>): string {
  const used = new Set(existing.map((o) => o.id));
  let id: string;
  do {
    id = `obj-${Date.now().toString(36)}-${(objectCounter++).toString(36)}`;
  } while (used.has(id));
  return id;
}

/** Next free default name like "Point 3" / "Rect 2". */
export function defaultObjectName(
  existing: ReadonlyArray<TileObject>,
  rect: boolean
): string {
  const base = rect ? "Rect" : "Point";
  const names = new Set(existing.map((o) => o.name));
  let n = 1;
  while (names.has(`${base} ${n}`)) n++;
  return `${base} ${n}`;
}

export function createPointObject(
  existing: ReadonlyArray<TileObject>,
  x: number,
  y: number
): TileObject {
  return {
    id: nextObjectId(existing),
    name: defaultObjectName(existing, false),
    type: "",
    x,
    y,
    properties: {},
  };
}

export function createRectObject(
  existing: ReadonlyArray<TileObject>,
  x: number,
  y: number,
  w: number,
  h: number
): TileObject {
  return {
    id: nextObjectId(existing),
    name: defaultObjectName(existing, true),
    type: "",
    x,
    y,
    w,
    h,
    properties: {},
  };
}

/** Snap a coordinate to the nearest grid line. */
export function snapToGrid(v: number, size: number): number {
  const s = Math.max(1, size);
  return Math.round(v / s) * s;
}

/**
 * Rect between two pixel positions. With `snap` the rect is expanded to cover
 * whole cells (so a drag inside one cell is one cell); without it the exact
 * pixel span is used.
 */
export function rectFromDrag(
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  snap: { tileW: number; tileH: number } | null
): { x: number; y: number; w: number; h: number } {
  const minX = Math.min(x0, x1);
  const maxX = Math.max(x0, x1);
  const minY = Math.min(y0, y1);
  const maxY = Math.max(y0, y1);
  if (snap) {
    const sx = Math.floor(minX / snap.tileW) * snap.tileW;
    const sy = Math.floor(minY / snap.tileH) * snap.tileH;
    const ex = (Math.floor(maxX / snap.tileW) + 1) * snap.tileW;
    const ey = (Math.floor(maxY / snap.tileH) + 1) * snap.tileH;
    return { x: sx, y: sy, w: ex - sx, h: ey - sy };
  }
  return {
    x: Math.floor(minX),
    y: Math.floor(minY),
    w: Math.max(1, Math.ceil(maxX) - Math.floor(minX)),
    h: Math.max(1, Math.ceil(maxY) - Math.floor(minY)),
  };
}

/** Did a press-drag move far enough to count as a rect rather than a click? */
export function isRectDrag(
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  snap: { tileW: number; tileH: number } | null
): boolean {
  if (snap) {
    return (
      Math.floor(x0 / snap.tileW) !== Math.floor(x1 / snap.tileW) ||
      Math.floor(y0 / snap.tileH) !== Math.floor(y1 / snap.tileH)
    );
  }
  return Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0)) >= 2;
}

/**
 * Topmost object under a pixel position (later entries draw on top). Points
 * hit within `pointRadius` pixels; rects hit inside their bounds. Points win
 * over rects so they stay selectable inside areas.
 */
export function hitTestObjects(
  objects: ReadonlyArray<TileObject>,
  x: number,
  y: number,
  pointRadius = 3
): TileObject | null {
  for (let i = objects.length - 1; i >= 0; i--) {
    const o = objects[i];
    if (isRectObject(o)) continue;
    if (Math.abs(x - o.x) <= pointRadius && Math.abs(y - o.y) <= pointRadius) {
      return o;
    }
  }
  for (let i = objects.length - 1; i >= 0; i--) {
    const o = objects[i];
    if (!isRectObject(o)) continue;
    if (
      x >= o.x &&
      y >= o.y &&
      x < o.x + (o.w as number) &&
      y < o.y + (o.h as number)
    ) {
      return o;
    }
  }
  return null;
}

export function serializeObjectLayers(map: ObjectLayerMap): ObjectLayersJson {
  const out: ObjectLayersJson = {};
  for (const [id, list] of map) out[id] = list.map(cloneObject);
  return out;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function parseProps(v: unknown): Record<string, ObjectPropertyValue> {
  const out: Record<string, ObjectPropertyValue> = {};
  if (!isRecord(v)) return out;
  for (const [k, val] of Object.entries(v)) {
    if (
      typeof val === "string" ||
      typeof val === "boolean" ||
      (typeof val === "number" && Number.isFinite(val))
    ) {
      out[k] = val;
    }
  }
  return out;
}

/** Tolerant parser: drops malformed entries so old/hand-edited files load. */
export function deserializeObjectLayers(raw: unknown): ObjectLayerMap {
  const out: ObjectLayerMap = new Map();
  if (!isRecord(raw)) return out;
  for (const [layerId, list] of Object.entries(raw)) {
    if (!Array.isArray(list)) continue;
    const objects: TileObject[] = [];
    for (const item of list) {
      if (!isRecord(item)) continue;
      const { x, y, w, h } = item;
      if (typeof x !== "number" || typeof y !== "number") continue;
      if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
      const rect =
        typeof w === "number" &&
        typeof h === "number" &&
        Number.isFinite(w) &&
        Number.isFinite(h);
      objects.push({
        id: typeof item.id === "string" ? item.id : nextObjectId(objects),
        name: typeof item.name === "string" ? item.name : "",
        type: typeof item.type === "string" ? item.type : "",
        x,
        y,
        ...(rect ? { w: w as number, h: h as number } : {}),
        properties: parseProps(item.properties),
      });
    }
    out.set(layerId, objects);
  }
  return out;
}

/** Parse a property text field: booleans, numbers, otherwise a string. */
export function parsePropertyValue(text: string): ObjectPropertyValue {
  const t = text.trim();
  if (t === "true") return true;
  if (t === "false") return false;
  if (t !== "" && /^-?\d+(\.\d+)?$/.test(t)) return Number(t);
  return text;
}

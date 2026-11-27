// Pure types + helpers for the non-destructive modifier stack. This file has no
// runtime imports so Model3DEngine / serialization can use it without cycles.
// The evaluation algorithms live in modifiers.ts.

export type ModifierVec3 = [number, number, number];

export interface ModifierBase {
  id: string;
  name: string;
  /** Render / export toggle. */
  enabled: boolean;
  /** Viewport toggle (viewport context requires `enabled && showInViewport`). */
  showInViewport: boolean;
}

export interface MirrorModifier extends ModifierBase {
  type: "mirror";
  axes: { x: boolean; y: boolean; z: boolean };
  mergeSeam: boolean;
  mergeThresholdPx: number;
}

export interface ArrayModifier extends ModifierBase {
  type: "array";
  count: number; // >= 1
  relativeOffset: ModifierVec3; // multiples of the mesh bounds size
  constantOffsetPx: ModifierVec3;
  mergeAdjacent: boolean;
  mergeThresholdPx: number;
}

export interface SubdivideModifier extends ModifierBase {
  type: "subdivide";
  levels: number; // 1..3 (linear subdivision)
}

export interface SolidifyModifier extends ModifierBase {
  type: "solidify";
  thicknessPx: number;
  offset: number; // -1..1 (-1: shell grows inward, 1: outward, 0: centered)
  rim: boolean;
}

export interface BevelModifier extends ModifierBase {
  type: "bevel";
  widthPx: number;
  angleDeg: number; // edges sharper than this get beveled
}

export interface TriangulateModifier extends ModifierBase {
  type: "triangulate";
}

export type ModelModifier =
  | MirrorModifier
  | ArrayModifier
  | SubdivideModifier
  | SolidifyModifier
  | BevelModifier
  | TriangulateModifier;

export type ModifierType = ModelModifier["type"];

export const MODIFIER_TYPES: readonly ModifierType[] = [
  "mirror",
  "array",
  "subdivide",
  "solidify",
  "bevel",
  "triangulate",
];

export const MODIFIER_LABELS: Record<ModifierType, string> = {
  mirror: "Mirror",
  array: "Array",
  subdivide: "Subdivide",
  solidify: "Solidify",
  bevel: "Bevel",
  triangulate: "Triangulate",
};

export const MODIFIER_LIMITS = {
  maxArrayCount: 128,
  maxSubdivideLevels: 3,
  maxModifiersPerNode: 32,
} as const;

let modifierSeq = 0;
function newModifierId(): string {
  modifierSeq += 1;
  const rand = Math.floor(Math.random() * 0x7fffffff).toString(36);
  return `mod-${Date.now().toString(36)}-${modifierSeq.toString(36)}${rand}`;
}

export function createModifier(type: ModifierType): ModelModifier {
  const base = {
    id: newModifierId(),
    name: MODIFIER_LABELS[type],
    enabled: true,
    showInViewport: true,
  };
  switch (type) {
    case "mirror":
      return {
        ...base,
        type,
        axes: { x: true, y: false, z: false },
        mergeSeam: true,
        mergeThresholdPx: 0.01,
      };
    case "array":
      return {
        ...base,
        type,
        count: 2,
        relativeOffset: [1, 0, 0],
        constantOffsetPx: [0, 0, 0],
        mergeAdjacent: false,
        mergeThresholdPx: 0.01,
      };
    case "subdivide":
      return { ...base, type, levels: 1 };
    case "solidify":
      return { ...base, type, thicknessPx: 1, offset: -1, rim: true };
    case "bevel":
      return { ...base, type, widthPx: 1, angleDeg: 30 };
    case "triangulate":
      return { ...base, type };
  }
}

export function cloneModifier(m: ModelModifier): ModelModifier {
  switch (m.type) {
    case "mirror":
      return { ...m, axes: { ...m.axes } };
    case "array":
      return {
        ...m,
        relativeOffset: [...m.relativeOffset] as ModifierVec3,
        constantOffsetPx: [...m.constantOffsetPx] as ModifierVec3,
      };
    default:
      return { ...m };
  }
}

export function cloneModifiers(list: ReadonlyArray<ModelModifier>): ModelModifier[] {
  return list.map(cloneModifier);
}

function isRec(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}
function num(v: unknown, fb: number, min: number, max: number): number {
  const n = typeof v === "number" && Number.isFinite(v) ? v : fb;
  return Math.min(max, Math.max(min, n));
}
function bool(v: unknown, fb: boolean): boolean {
  return typeof v === "boolean" ? v : fb;
}
function vec3(v: unknown, fb: ModifierVec3, lim = 1e6): ModifierVec3 {
  const a = Array.isArray(v) ? v : [];
  return [num(a[0], fb[0], -lim, lim), num(a[1], fb[1], -lim, lim), num(a[2], fb[2], -lim, lim)];
}

/**
 * Validates untrusted data (project files, undo snapshots): drops unknown types,
 * clamps numeric params, fills missing fields from defaults, and guarantees unique ids.
 */
export function sanitizeModifiers(raw: unknown): ModelModifier[] {
  if (!Array.isArray(raw)) return [];
  const out: ModelModifier[] = [];
  const usedIds = new Set<string>();
  for (const item of raw) {
    if (out.length >= MODIFIER_LIMITS.maxModifiersPerNode) break;
    if (!isRec(item)) continue;
    const type = item.type;
    if (typeof type !== "string" || !(MODIFIER_TYPES as readonly string[]).includes(type)) continue;
    const def = createModifier(type as ModifierType);
    let id = typeof item.id === "string" && item.id.trim() ? item.id : def.id;
    while (usedIds.has(id)) id = `${id}-x`;
    usedIds.add(id);
    const base = {
      id,
      name: typeof item.name === "string" && item.name.trim() ? item.name : def.name,
      enabled: bool(item.enabled, true),
      showInViewport: bool(item.showInViewport, true),
    };
    switch (def.type) {
      case "mirror": {
        const ax = isRec(item.axes) ? item.axes : {};
        out.push({
          ...def,
          ...base,
          axes: { x: bool(ax.x, def.axes.x), y: bool(ax.y, def.axes.y), z: bool(ax.z, def.axes.z) },
          mergeSeam: bool(item.mergeSeam, def.mergeSeam),
          mergeThresholdPx: num(item.mergeThresholdPx, def.mergeThresholdPx, 0, 1000),
        });
        break;
      }
      case "array":
        out.push({
          ...def,
          ...base,
          count: Math.round(num(item.count, def.count, 1, MODIFIER_LIMITS.maxArrayCount)),
          relativeOffset: vec3(item.relativeOffset, def.relativeOffset, 1000),
          constantOffsetPx: vec3(item.constantOffsetPx, def.constantOffsetPx),
          mergeAdjacent: bool(item.mergeAdjacent, def.mergeAdjacent),
          mergeThresholdPx: num(item.mergeThresholdPx, def.mergeThresholdPx, 0, 1000),
        });
        break;
      case "subdivide":
        out.push({
          ...def,
          ...base,
          levels: Math.round(num(item.levels, def.levels, 1, MODIFIER_LIMITS.maxSubdivideLevels)),
        });
        break;
      case "solidify":
        out.push({
          ...def,
          ...base,
          thicknessPx: num(item.thicknessPx, def.thicknessPx, -10000, 10000),
          offset: num(item.offset, def.offset, -1, 1),
          rim: bool(item.rim, def.rim),
        });
        break;
      case "bevel":
        out.push({
          ...def,
          ...base,
          widthPx: num(item.widthPx, def.widthPx, 0, 10000),
          angleDeg: num(item.angleDeg, def.angleDeg, 0, 180),
        });
        break;
      case "triangulate":
        out.push({ ...def, ...base });
        break;
    }
  }
  return out;
}

// ---- small pure list helpers -------------------------------------------------

export function moveModifier(
  list: ReadonlyArray<ModelModifier>,
  id: string,
  delta: number
): ModelModifier[] {
  const next = list.slice();
  const from = next.findIndex((m) => m.id === id);
  if (from < 0) return next;
  const to = Math.max(0, Math.min(next.length - 1, from + Math.trunc(delta)));
  if (to === from) return next;
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}

export function removeModifier(
  list: ReadonlyArray<ModelModifier>,
  id: string
): ModelModifier[] {
  return list.filter((m) => m.id !== id);
}

/** Inserts a deep copy (new id, " Copy" name) right after the original. */
export function duplicateModifier(
  list: ReadonlyArray<ModelModifier>,
  id: string
): ModelModifier[] {
  const idx = list.findIndex((m) => m.id === id);
  if (idx < 0) return list.slice();
  const copy = cloneModifier(list[idx]);
  copy.id = createModifier(copy.type).id;
  copy.name = `${list[idx].name} Copy`;
  const next = list.slice();
  next.splice(idx + 1, 0, copy);
  return next;
}

/** Shallow-merges `patch` into the modifier with `id` (type and id cannot change). */
export function updateModifier(
  list: ReadonlyArray<ModelModifier>,
  id: string,
  patch: Record<string, unknown>
): ModelModifier[] {
  return list.map((m) =>
    m.id === id ? ({ ...cloneModifier(m), ...patch, id: m.id, type: m.type } as ModelModifier) : m
  );
}

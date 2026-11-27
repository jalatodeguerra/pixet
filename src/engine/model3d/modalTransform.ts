import { clonePolyMeshData } from "./Model3DEngine.ts";
import { vec3Add, vec3Cross, vec3Dot, vec3Length, vec3Normalize, vec3Scale, vec3Sub } from "./quatMath.ts";
import type { PolyMeshData, Vec2, Vec3 } from "./types.ts";

/**
 * Pure (React-free, three-free) math for Blender-style modal operators:
 * G (grab), R (rotate), S (scale), plus the scalar "distance" modals used by
 * inset and bevel. The viewport feeds in pointer positions and a camera basis;
 * this module returns a world-space operation that can then be applied to mesh
 * vertices (edit mode) or node transforms (object mode).
 */

export type ModalTransformKind = "grab" | "rotate" | "scale";
export type ModalAxis = "x" | "y" | "z";

export const MODAL_AXIS_VECTORS: Record<ModalAxis, Vec3> = {
  x: [1, 0, 0],
  y: [0, 1, 0],
  z: [0, 0, 1],
};

/** Camera basis in world space plus the world size of one screen pixel at the pivot depth. */
export interface ModalViewBasis {
  right: Vec3;
  up: Vec3;
  /** Direction the camera looks along (away from the viewer). */
  forward: Vec3;
  worldPerPixel: number;
}

export interface ModalResolveInput {
  kind: ModalTransformKind;
  /** Pivot position in viewport pixels. */
  pivotScreen: Vec2;
  /** Pointer position when the modal started (viewport pixels). */
  startPointer: Vec2;
  /** Current pointer position (viewport pixels). */
  pointer: Vec2;
  /** Unit world-space constraint axis, or null for free (view plane / view axis / uniform). */
  axis: Vec3 | null;
  /** Raw typed numeric buffer (see `appendTypedChar`). */
  typed: string;
  snap: boolean;
  /** Grab snap step in mesh pixels. */
  snapPx: number;
  /** Mesh pixels per world unit. */
  ppu: number;
  view: ModalViewBasis;
}

export type ResolvedModalOp =
  | {
      kind: "grab";
      /** World-space translation (world units). */
      translation: Vec3;
      /** Signed distance along the axis, or the in-plane magnitude when free (mesh px). */
      valuePx: number;
    }
  | {
      kind: "rotate";
      /** Unit world-space rotation axis. */
      axis: Vec3;
      angleRad: number;
    }
  | {
      kind: "scale";
      factor: number;
      /** When set, scale only along this world axis. */
      axis: Vec3 | null;
    };

export const ROTATE_SNAP_DEG = 15;
export const SCALE_SNAP_STEP = 0.1;
const MIN_SCALE_START_DIST_PX = 4;

// ---------------------------------------------------------------------------
// Typed numeric input
// ---------------------------------------------------------------------------

/**
 * Applies one keystroke to a typed-number buffer. Accepts digits, `.` (once),
 * `-` (toggles the sign) and Backspace. Returns the new buffer, or null when
 * the key is not a numeric-entry key.
 */
export function appendTypedChar(typed: string, key: string): string | null {
  if (key === "Backspace") return typed.slice(0, -1);
  if (key === "-") return typed.startsWith("-") ? typed.slice(1) : `-${typed}`;
  if (key === ".") return typed.includes(".") ? typed : `${typed}.`;
  if (key.length === 1 && key >= "0" && key <= "9") return typed + key;
  return null;
}

/** Parses the typed buffer; null while it is empty or incomplete (e.g. "-", "."). */
export function parseTypedNumber(typed: string): number | null {
  if (!/\d/.test(typed)) return null;
  const n = Number(typed);
  return Number.isFinite(n) ? n : null;
}

// ---------------------------------------------------------------------------
// Resolving pointer motion into an operation
// ---------------------------------------------------------------------------

function snapTo(value: number, step: number): number {
  return step > 0 ? Math.round(value / step) * step : value;
}

function screenAngle(pivot: Vec2, p: Vec2): number {
  return Math.atan2(p[1] - pivot[1], p[0] - pivot[0]);
}

function wrapAngle(a: number): number {
  let r = a;
  while (r > Math.PI) r -= Math.PI * 2;
  while (r < -Math.PI) r += Math.PI * 2;
  return r;
}

/** Screen-space (y down) direction of a world axis, in world-units-per-pixel-agnostic terms. */
function axisScreenDir(axis: Vec3, view: ModalViewBasis): Vec2 {
  return [vec3Dot(axis, view.right), -vec3Dot(axis, view.up)];
}

export function resolveModalOp(input: ModalResolveInput): ResolvedModalOp {
  const { kind, view, axis, typed, snap } = input;
  const typedValue = parseTypedNumber(typed);
  const ppu = Math.max(1e-6, input.ppu);

  if (kind === "grab") {
    if (typedValue !== null) {
      const dir = axis ?? MODAL_AXIS_VECTORS.x;
      return {
        kind: "grab",
        translation: vec3Scale(dir, typedValue / ppu),
        valuePx: typedValue,
      };
    }
    const dx = input.pointer[0] - input.startPointer[0];
    const dy = input.pointer[1] - input.startPointer[1];
    const wpp = view.worldPerPixel;
    const snapStep = snap ? Math.max(1e-6, input.snapPx) : 0;

    if (axis) {
      const s = axisScreenDir(axis, view);
      const sLenSq = Math.max(s[0] * s[0] + s[1] * s[1], 0.05);
      // Minimise |mouse - t * s / wpp|: t in world units along the axis.
      let t = (wpp * (dx * s[0] + dy * s[1])) / sLenSq;
      if (snapStep > 0) t = snapTo(t * ppu, snapStep) / ppu;
      return {
        kind: "grab",
        translation: vec3Scale(axis, t),
        valuePx: t * ppu,
      };
    }

    let u = dx * wpp;
    let v = -dy * wpp;
    if (snapStep > 0) {
      u = snapTo(u * ppu, snapStep) / ppu;
      v = snapTo(v * ppu, snapStep) / ppu;
    }
    const translation = vec3Add(vec3Scale(view.right, u), vec3Scale(view.up, v));
    return {
      kind: "grab",
      translation,
      valuePx: Math.hypot(u, v) * ppu,
    };
  }

  if (kind === "rotate") {
    // The rotation axis vector: the constraint axis, or the direction toward the viewer.
    const towardViewer = vec3Scale(view.forward, -1);
    const rotAxis = axis ?? towardViewer;
    if (typedValue !== null) {
      return { kind: "rotate", axis: rotAxis, angleRad: (typedValue * Math.PI) / 180 };
    }
    const startDist = Math.hypot(
      input.startPointer[0] - input.pivotScreen[0],
      input.startPointer[1] - input.pivotScreen[1]
    );
    const a0 = startDist < 1 ? screenAngle(input.pivotScreen, input.pointer) : screenAngle(input.pivotScreen, input.startPointer);
    const a1 = screenAngle(input.pivotScreen, input.pointer);
    // Screen y grows downward, so a growing screen angle is a clockwise sweep.
    const clockwise = wrapAngle(a1 - a0);
    // A positive angle about the viewer-facing vector is counter-clockwise on screen.
    const facing = vec3Dot(rotAxis, towardViewer);
    const sign = facing < 0 ? 1 : -1;
    let angle = sign * clockwise;
    if (snap) angle = snapTo(angle, (ROTATE_SNAP_DEG * Math.PI) / 180);
    return { kind: "rotate", axis: rotAxis, angleRad: angle };
  }

  // scale
  if (typedValue !== null) {
    return { kind: "scale", factor: typedValue, axis };
  }
  const startDist = Math.hypot(
    input.startPointer[0] - input.pivotScreen[0],
    input.startPointer[1] - input.pivotScreen[1]
  );
  const dist = Math.hypot(
    input.pointer[0] - input.pivotScreen[0],
    input.pointer[1] - input.pivotScreen[1]
  );
  let factor: number;
  if (startDist < MIN_SCALE_START_DIST_PX) {
    // Pointer began on top of the pivot: grow from 1 by 1 per 100px.
    factor = 1 + dist / 100;
  } else {
    factor = dist / startDist;
  }
  if (snap) factor = snapTo(factor, SCALE_SNAP_STEP);
  return { kind: "scale", factor, axis };
}

/**
 * Scalar modal value (inset / bevel width) in mesh px: the change in the
 * pointer's screen distance from the pivot, converted to mesh pixels.
 * A typed number overrides the mouse.
 */
export function resolveDistanceValue(input: {
  pivotScreen: Vec2;
  startPointer: Vec2;
  pointer: Vec2;
  typed: string;
  snap: boolean;
  snapPx: number;
  ppu: number;
  worldPerPixel: number;
}): number {
  const typedValue = parseTypedNumber(input.typed);
  if (typedValue !== null) return Math.max(0, typedValue);
  const d0 = Math.hypot(
    input.startPointer[0] - input.pivotScreen[0],
    input.startPointer[1] - input.pivotScreen[1]
  );
  const d1 = Math.hypot(
    input.pointer[0] - input.pivotScreen[0],
    input.pointer[1] - input.pivotScreen[1]
  );
  let value = Math.abs(d1 - d0) * input.worldPerPixel * input.ppu;
  if (input.snap) value = snapTo(value, Math.max(1e-6, input.snapPx));
  return Math.max(0, value);
}

// ---------------------------------------------------------------------------
// Applying an operation
// ---------------------------------------------------------------------------

/** Rotates `v` around unit `axis` by `angle` (Rodrigues). */
export function rotateAroundAxis(v: Vec3, axis: Vec3, angle: number): Vec3 {
  const k = vec3Normalize(axis);
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const kxv = vec3Cross(k, v);
  const kdv = vec3Dot(k, v) * (1 - c);
  return [
    v[0] * c + kxv[0] * s + k[0] * kdv,
    v[1] * c + kxv[1] * s + k[1] * kdv,
    v[2] * c + kxv[2] * s + k[2] * kdv,
  ];
}

/** Applies a resolved operation to a world-space point about `pivot`. */
export function applyOpToWorldPoint(op: ResolvedModalOp, pivot: Vec3, p: Vec3): Vec3 {
  if (op.kind === "grab") return vec3Add(p, op.translation);
  const rel = vec3Sub(p, pivot);
  if (op.kind === "rotate") {
    return vec3Add(pivot, rotateAroundAxis(rel, op.axis, op.angleRad));
  }
  if (op.axis) {
    const k = vec3Normalize(op.axis);
    const along = vec3Dot(rel, k);
    return vec3Add(pivot, vec3Add(rel, vec3Scale(k, (op.factor - 1) * along)));
  }
  return vec3Add(pivot, vec3Scale(rel, op.factor));
}

/** Column-major 4x4 affine matrix (same layout as THREE.Matrix4.elements). */
export type Mat4Array = ReadonlyArray<number>;

export function mat4MulPoint(m: Mat4Array, p: Vec3): Vec3 {
  return [
    m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12],
    m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13],
    m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14],
  ];
}

/** Transforms a direction (ignores translation). */
export function mat4MulDir(m: Mat4Array, d: Vec3): Vec3 {
  return [
    m[0] * d[0] + m[4] * d[1] + m[8] * d[2],
    m[1] * d[0] + m[5] * d[1] + m[9] * d[2],
    m[2] * d[0] + m[6] * d[1] + m[10] * d[2],
  ];
}

/** Describes how a mesh node's local pixel space maps into world space. */
export interface MeshWorldSpace {
  worldMatrix: Mat4Array;
  inverseWorldMatrix: Mat4Array;
  ppu: number;
  /** `node.transform.pivot` (local mesh px that maps to the object origin). */
  nodePivot: Vec3;
}

export function meshLocalToWorld(space: MeshWorldSpace, v: Vec3): Vec3 {
  const ppu = space.ppu;
  return mat4MulPoint(space.worldMatrix, [
    (v[0] - space.nodePivot[0]) / ppu,
    (v[1] - space.nodePivot[1]) / ppu,
    (v[2] - space.nodePivot[2]) / ppu,
  ]);
}

export function meshWorldToLocal(space: MeshWorldSpace, w: Vec3): Vec3 {
  const l = mat4MulPoint(space.inverseWorldMatrix, w);
  return [
    l[0] * space.ppu + space.nodePivot[0],
    l[1] * space.ppu + space.nodePivot[1],
    l[2] * space.ppu + space.nodePivot[2],
  ];
}

function clean(n: number): number {
  const r = Math.round(n * 1e5) / 1e5;
  return r === 0 ? 0 : r;
}

/**
 * Applies a world-space modal operation to a subset of mesh vertices.
 * The input mesh is not mutated; vertices outside `vertexIndices` are untouched.
 */
export function transformMeshVerticesByOp(
  mesh: PolyMeshData,
  vertexIndices: ReadonlyArray<number>,
  space: MeshWorldSpace,
  op: ResolvedModalOp,
  pivotWorld: Vec3
): PolyMeshData {
  const out = clonePolyMeshData(mesh);
  for (const vi of vertexIndices) {
    const v = out.vertices[vi];
    if (!v) continue;
    const w = meshLocalToWorld(space, v);
    const w2 = applyOpToWorldPoint(op, pivotWorld, w);
    const l = meshWorldToLocal(space, w2);
    out.vertices[vi] = [clean(l[0]), clean(l[1]), clean(l[2])];
  }
  return out;
}

// ---------------------------------------------------------------------------
// HUD text
// ---------------------------------------------------------------------------

export type ModalHudKind = ModalTransformKind | "inset" | "bevel" | "extrude";

const HUD_LABELS: Record<ModalHudKind, string> = {
  grab: "Grab",
  rotate: "Rotate",
  scale: "Scale",
  inset: "Inset",
  bevel: "Bevel",
  extrude: "Extrude",
};

function trimNumber(n: number, digits: number): string {
  const s = n.toFixed(digits);
  return s.includes(".") ? s.replace(/0+$/, "").replace(/\.$/, "") : s;
}

/** Operation name shown in the undo history and the HUD. */
export function modalLabel(kind: ModalHudKind): string {
  return HUD_LABELS[kind];
}

export function formatModalHud(args: {
  kind: ModalHudKind;
  axis: ModalAxis | null;
  /** True when a custom axis (extrude normal) is active and no X/Y/Z override is set. */
  normalAxis?: boolean;
  typed: string;
  op?: ResolvedModalOp;
  /** Scalar value for inset / bevel (mesh px). */
  value?: number;
  snap?: boolean;
}): string {
  const parts: string[] = [HUD_LABELS[args.kind]];
  const scalar = args.kind === "inset" || args.kind === "bevel";
  if (!scalar) {
    if (args.axis) parts.push(`${args.axis.toUpperCase()} axis`);
    else if (args.normalAxis) parts.push("Normal axis");
  }

  let valueText = "";
  if (args.typed) {
    const unit =
      args.kind === "rotate" ? "°" : args.kind === "scale" ? "×" : " px";
    valueText = `${args.typed}${unit}`;
  } else if (args.op) {
    if (args.op.kind === "grab") valueText = `${trimNumber(args.op.valuePx, 2)} px`;
    else if (args.op.kind === "rotate") valueText = `${trimNumber((args.op.angleRad * 180) / Math.PI, 1)}°`;
    else valueText = `${trimNumber(args.op.factor, 3)}×`;
  } else if (args.value !== undefined) {
    valueText = `${trimNumber(args.value, 2)} px`;
  }
  if (valueText) parts.push(valueText);
  if (args.snap) parts.push("snap");

  const tail = scalar
    ? "click/Enter confirm, Esc cancel, type a value, Ctrl snap"
    : "click/Enter confirm, Esc cancel, X/Y/Z axis, Ctrl snap";
  return `${parts.join(" · ")} — ${tail}`;
}

/** Axis color for the constraint line (hex). */
export const MODAL_AXIS_COLORS: Record<ModalAxis, number> = {
  x: 0xe5484d,
  y: 0x4cc38a,
  z: 0x4c8bf5,
};

/** Average of a list of vectors (null when empty). */
export function averageVec3(list: ReadonlyArray<Vec3>): Vec3 | null {
  if (list.length === 0) return null;
  let sx = 0;
  let sy = 0;
  let sz = 0;
  for (const v of list) {
    sx += v[0];
    sy += v[1];
    sz += v[2];
  }
  return [sx / list.length, sy / list.length, sz / list.length];
}

/** Normalises a vector, returning null for (near) zero length. */
export function safeNormalize(v: Vec3): Vec3 | null {
  return vec3Length(v) > 1e-9 ? vec3Normalize(v) : null;
}

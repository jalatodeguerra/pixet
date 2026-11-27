import test from "node:test";
import assert from "node:assert/strict";

import {
  appendTypedChar,
  applyOpToWorldPoint,
  formatModalHud,
  meshLocalToWorld,
  meshWorldToLocal,
  parseTypedNumber,
  resolveDistanceValue,
  resolveModalOp,
  transformMeshVerticesByOp,
  type MeshWorldSpace,
  type ModalResolveInput,
  type ModalViewBasis,
} from "../src/engine/model3d/modalTransform.ts";
import type { PolyMeshData, Vec3 } from "../src/engine/model3d/types.ts";

function near(actual: number, expected: number, eps = 1e-4, msg = "") {
  assert.ok(Math.abs(actual - expected) <= eps, `${msg} expected ${expected}, got ${actual}`);
}
function nearVec(a: readonly number[], b: readonly number[], eps = 1e-4) {
  for (let i = 0; i < 3; i++) near(a[i], b[i], eps, `component ${i}`);
}

// Camera looking down -Z: right = +X, up = +Y, forward = -Z. 1 screen px = 0.01 world units.
const VIEW: ModalViewBasis = {
  right: [1, 0, 0],
  up: [0, 1, 0],
  forward: [0, 0, -1],
  worldPerPixel: 0.01,
};

function input(partial: Partial<ModalResolveInput>): ModalResolveInput {
  return {
    kind: "grab",
    pivotScreen: [100, 100],
    startPointer: [150, 100],
    pointer: [150, 100],
    axis: null,
    typed: "",
    snap: false,
    snapPx: 1,
    ppu: 16,
    view: VIEW,
    ...partial,
  };
}

const IDENTITY = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
const IDENTITY_SPACE: MeshWorldSpace = {
  worldMatrix: IDENTITY,
  inverseWorldMatrix: IDENTITY,
  ppu: 16,
  nodePivot: [0, 0, 0],
};

test("typed numeric buffer: digits, dot, minus toggle, backspace, rejects others", () => {
  let t = "";
  for (const k of ["1", "2", ".", "5"]) t = appendTypedChar(t, k)!;
  assert.equal(t, "12.5");
  assert.equal(appendTypedChar(t, "."), "12.5", "second dot ignored");
  assert.equal(appendTypedChar(t, "-"), "-12.5");
  assert.equal(appendTypedChar("-12.5", "-"), "12.5");
  assert.equal(appendTypedChar(t, "Backspace"), "12.");
  assert.equal(appendTypedChar("", "Backspace"), "");
  assert.equal(appendTypedChar(t, "x"), null);
  assert.equal(parseTypedNumber("12.5"), 12.5);
  assert.equal(parseTypedNumber("-"), null);
  assert.equal(parseTypedNumber("."), null);
  assert.equal(parseTypedNumber(""), null);
  assert.equal(parseTypedNumber("-3"), -3);
});

test("grab: free move follows the pointer in the view plane (screen y is flipped)", () => {
  const op = resolveModalOp(input({ pointer: [250, 60] }));
  assert.equal(op.kind, "grab");
  if (op.kind !== "grab") return;
  // dx = +100px, dy = -40px (up) => (+1.0, +0.4, 0) world units
  nearVec(op.translation, [1, 0.4, 0]);
});

test("grab: axis constraint projects pointer motion onto the axis", () => {
  const x = resolveModalOp(input({ pointer: [250, 60], axis: [1, 0, 0] }));
  if (x.kind !== "grab") throw new Error("kind");
  nearVec(x.translation, [1, 0, 0]);
  near(x.valuePx, 16);

  const y = resolveModalOp(input({ pointer: [250, 60], axis: [0, 1, 0] }));
  if (y.kind !== "grab") throw new Error("kind");
  nearVec(y.translation, [0, 0.4, 0]);

  // Z points at the camera: no screen motion maps to it, so it does not move.
  const z = resolveModalOp(input({ pointer: [250, 60], axis: [0, 0, 1] }));
  if (z.kind !== "grab") throw new Error("kind");
  nearVec(z.translation, [0, 0, 0]);
});

test("grab: typed value (mesh px) overrides the mouse, along the axis or X when free", () => {
  const free = resolveModalOp(input({ pointer: [999, 999], typed: "32" }));
  if (free.kind !== "grab") throw new Error("kind");
  nearVec(free.translation, [2, 0, 0]); // 32px / 16 ppu
  const y = resolveModalOp(input({ typed: "-8", axis: [0, 1, 0] }));
  if (y.kind !== "grab") throw new Error("kind");
  nearVec(y.translation, [0, -0.5, 0]);
});

test("grab: Ctrl snap rounds to snapPx mesh pixels", () => {
  // 37px mouse => 0.37 units => 5.92 mesh px => snapped to 6 px with snapPx 2 => 0.375
  const op = resolveModalOp(input({ pointer: [187, 100], axis: [1, 0, 0], snap: true, snapPx: 2 }));
  if (op.kind !== "grab") throw new Error("kind");
  near(op.valuePx, 6);
  near(op.translation[0], 6 / 16);
  const free = resolveModalOp(input({ pointer: [187, 113], snap: true, snapPx: 4 }));
  if (free.kind !== "grab") throw new Error("kind");
  near((free.translation[0] * 16) % 4, 0);
  near((free.translation[1] * 16) % 4, 0);
});

test("grab: custom (normal) axis behaves like a constraint axis", () => {
  const diag: Vec3 = [Math.SQRT1_2, Math.SQRT1_2, 0];
  const op = resolveModalOp(input({ pointer: [250, 100], axis: diag }));
  if (op.kind !== "grab") throw new Error("kind");
  // screen dir of diag = (0.707, -0.707); mouse (100,0) => t = 0.01*70.7/1 = 0.707
  near(op.translation[0], 0.5);
  near(op.translation[1], 0.5);
});

test("rotate: screen angle about the pivot maps to the view axis; typed degrees override", () => {
  // Pointer sweeps a quarter turn counter-clockwise on screen (right -> up).
  const ccw = resolveModalOp(input({ kind: "rotate", startPointer: [200, 100], pointer: [100, 0] }));
  if (ccw.kind !== "rotate") throw new Error("kind");
  // CCW seen by the viewer = positive about the viewer-facing vector (+Z here).
  nearVec(ccw.axis, [0, 0, 1]);
  near(ccw.angleRad, Math.PI / 2);
  const rotated = applyOpToWorldPoint(ccw, [0, 0, 0], [1, 0, 0]);
  nearVec(rotated, [0, 1, 0]); // +X turns toward +Y, the same direction the pointer swept

  const cw = resolveModalOp(input({ kind: "rotate", startPointer: [200, 100], pointer: [100, 200] }));
  if (cw.kind !== "rotate") throw new Error("kind");
  near(cw.angleRad, -Math.PI / 2);

  const typed = resolveModalOp(input({ kind: "rotate", typed: "90", axis: [0, 1, 0] }));
  if (typed.kind !== "rotate") throw new Error("kind");
  near(typed.angleRad, Math.PI / 2);
  nearVec(applyOpToWorldPoint(typed, [0, 0, 0], [1, 0, 0]), [0, 0, -1]);
});

test("rotate: Ctrl snaps to 15 degrees; axis facing away from the viewer flips the sign", () => {
  const op = resolveModalOp(
    input({ kind: "rotate", startPointer: [200, 100], pointer: [200, 80], snap: true })
  );
  if (op.kind !== "rotate") throw new Error("kind");
  const deg = (op.angleRad * 180) / Math.PI;
  near(deg / 15, Math.round(deg / 15), 1e-6);

  // Constraint axis pointing away from the viewer (-Z): a CCW pointer sweep is a negative angle about it.
  const away = resolveModalOp(
    input({ kind: "rotate", startPointer: [200, 100], pointer: [100, 0], axis: [0, 0, -1] })
  );
  if (away.kind !== "rotate") throw new Error("kind");
  near(away.angleRad, -Math.PI / 2);
  // ... which is still +X turning toward +Y.
  nearVec(applyOpToWorldPoint(away, [0, 0, 0], [1, 0, 0]), [0, 1, 0]);
});

test("scale: ratio of pointer distance from the pivot; typed factor and snapping", () => {
  const grow = resolveModalOp(input({ kind: "scale", startPointer: [200, 100], pointer: [300, 100] }));
  if (grow.kind !== "scale") throw new Error("kind");
  near(grow.factor, 2);
  const shrink = resolveModalOp(input({ kind: "scale", startPointer: [200, 100], pointer: [150, 100] }));
  if (shrink.kind !== "scale") throw new Error("kind");
  near(shrink.factor, 0.5);

  const typed = resolveModalOp(input({ kind: "scale", typed: "3", pointer: [0, 0] }));
  if (typed.kind !== "scale") throw new Error("kind");
  near(typed.factor, 3);

  const snapped = resolveModalOp(
    input({ kind: "scale", startPointer: [200, 100], pointer: [283, 100], snap: true })
  );
  if (snapped.kind !== "scale") throw new Error("kind");
  near(snapped.factor, 1.8); // 183/100 = 1.83 -> 1.8

  // Pointer began on top of the pivot: stays finite and grows.
  const onPivot = resolveModalOp(
    input({ kind: "scale", startPointer: [100, 100], pointer: [150, 100] })
  );
  if (onPivot.kind !== "scale") throw new Error("kind");
  assert.ok(Number.isFinite(onPivot.factor) && onPivot.factor > 1);
});

test("scale: uniform vs axis-constrained application about the pivot", () => {
  const uniform = applyOpToWorldPoint({ kind: "scale", factor: 2, axis: null }, [1, 1, 1], [2, 3, 1]);
  nearVec(uniform, [3, 5, 1]);
  const alongX = applyOpToWorldPoint({ kind: "scale", factor: 2, axis: [1, 0, 0] }, [1, 1, 1], [2, 3, 1]);
  nearVec(alongX, [3, 3, 1]);
});

test("distance modal (inset/bevel): pointer distance change from pivot in mesh px; typed overrides", () => {
  const base = {
    pivotScreen: [100, 100] as [number, number],
    startPointer: [150, 100] as [number, number],
    typed: "",
    snap: false,
    snapPx: 1,
    ppu: 16,
    worldPerPixel: 0.01,
  };
  // 50px further from the pivot = 0.5 world = 8 mesh px
  near(resolveDistanceValue({ ...base, pointer: [200, 100] }), 8);
  // Moving the other way also changes the value (symmetric)
  near(resolveDistanceValue({ ...base, pointer: [100, 100] }), 8);
  assert.equal(resolveDistanceValue({ ...base, pointer: [150, 100] }), 0);
  assert.equal(resolveDistanceValue({ ...base, pointer: [900, 900], typed: "3.5" }), 3.5);
  assert.equal(resolveDistanceValue({ ...base, pointer: [900, 900], typed: "-3" }), 0);
  near(resolveDistanceValue({ ...base, pointer: [187, 100], snap: true, snapPx: 4 }), 4);
});

const TRI_MESH: PolyMeshData = {
  vertices: [
    [0, 0, 0],
    [16, 0, 0],
    [16, 16, 0],
    [100, 100, 100],
  ],
  faces: [{ id: "f", verts: [0, 1, 2], uvs: [[0, 0], [1, 0], [1, 1]], materialId: "m" }],
};

test("transformMeshVerticesByOp: translates only selected vertices; input untouched", () => {
  const op = resolveModalOp(input({ pointer: [250, 100] }));
  const out = transformMeshVerticesByOp(TRI_MESH, [0, 1], IDENTITY_SPACE, op, [0, 0, 0]);
  nearVec(out.vertices[0], [16, 0, 0]);
  nearVec(out.vertices[1], [32, 0, 0]);
  nearVec(out.vertices[2], TRI_MESH.vertices[2]);
  nearVec(out.vertices[3], TRI_MESH.vertices[3]);
  nearVec(TRI_MESH.vertices[0], [0, 0, 0]);
});

test("transformMeshVerticesByOp: node rotation/scale/pivot map world ops into local mesh px", () => {
  // Node rotated 90deg about Y (local +X -> world -Z), scaled x2, pivot (8,0,0), ppu 16.
  const c = Math.cos(Math.PI / 2);
  const s = Math.sin(Math.PI / 2);
  const r = [c, 0, -s, 0, 0, 1, 0, 0, s, 0, c, 0];
  const world = [2 * r[0], 2 * r[1], 2 * r[2], 0, 2 * r[4], 2 * r[5], 2 * r[6], 0, 2 * r[8], 2 * r[9], 2 * r[10], 0, 5, 0, 0, 1];
  // inverse of (T * R * S2) = S2^-1 * R^T * T^-1: linear part 0.5 * R^T, translation -(0.5 * R^T) * t
  const invM = [
    0.5 * c, 0, 0.5 * s, 0,
    0, 0.5, 0, 0,
    -0.5 * s, 0, 0.5 * c, 0,
    -2.5 * c, 0, -2.5 * s, 1,
  ];
  const space: MeshWorldSpace = {
    worldMatrix: world,
    inverseWorldMatrix: invM,
    ppu: 16,
    nodePivot: [8, 0, 0],
  };
  // Round trip local -> world -> local is the identity.
  const probe: Vec3 = [20, 5, -3];
  nearVec(meshWorldToLocal(space, meshLocalToWorld(space, probe)), probe, 1e-3);

  // Grab +1 world unit along world X on a vertex: mesh moves in local Z (local X maps to world -Z; local Z to world +X scaled 2x)
  const op = { kind: "grab", translation: [1, 0, 0] as Vec3, valuePx: 16 } as const;
  const out = transformMeshVerticesByOp(TRI_MESH, [0], space, op, [0, 0, 0]);
  const before = meshLocalToWorld(space, TRI_MESH.vertices[0]);
  const after = meshLocalToWorld(space, out.vertices[0]);
  nearVec([after[0] - before[0], after[1] - before[1], after[2] - before[2]], [1, 0, 0], 1e-3);
});

test("transformMeshVerticesByOp: rotate and scale about a world pivot", () => {
  const pivot: Vec3 = [16 / 16, 0, 0]; // world (1,0,0) == mesh (16,0,0)
  const rot = transformMeshVerticesByOp(
    TRI_MESH,
    [0, 1, 2],
    IDENTITY_SPACE,
    { kind: "rotate", axis: [0, 0, 1], angleRad: Math.PI / 2 },
    pivot
  );
  nearVec(rot.vertices[1], [16, 0, 0]); // pivot vertex stays
  nearVec(rot.vertices[0], [16, -16, 0]);
  nearVec(rot.vertices[2], [0, 0, 0]);

  const sc = transformMeshVerticesByOp(
    TRI_MESH,
    [0, 1, 2],
    IDENTITY_SPACE,
    { kind: "scale", factor: 0.5, axis: null },
    pivot
  );
  nearVec(sc.vertices[0], [8, 0, 0]);
  nearVec(sc.vertices[2], [16, 8, 0]);
});

test("HUD text reflects axis, value, typed input and snapping", () => {
  const op = resolveModalOp(input({ pointer: [250, 100], axis: [1, 0, 0] }));
  const hud = formatModalHud({ kind: "grab", axis: "x", typed: "", op });
  assert.match(hud, /^Grab · X axis · 16 px — click\/Enter confirm, Esc cancel, X\/Y\/Z axis, Ctrl snap$/);
  assert.match(formatModalHud({ kind: "rotate", axis: null, typed: "45" }), /^Rotate · 45°/);
  assert.match(formatModalHud({ kind: "scale", axis: "z", typed: "", op: { kind: "scale", factor: 1.5, axis: [0, 0, 1] }, snap: true }), /Scale · Z axis · 1\.5× · snap/);
  assert.match(formatModalHud({ kind: "extrude", axis: null, normalAxis: true, typed: "" }), /^Extrude · Normal axis/);
  assert.match(formatModalHud({ kind: "inset", axis: null, typed: "", value: 3 }), /^Inset · 3 px — click\/Enter confirm, Esc cancel, type a value/);
});

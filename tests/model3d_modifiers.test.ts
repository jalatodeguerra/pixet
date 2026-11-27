import test from "node:test";
import assert from "node:assert/strict";

import {
  cloneModelNode,
  createDefaultCuboidData,
  createDefaultTransform,
} from "../src/engine/model3d/Model3DEngine.ts";
import { computeFaceCentroid, computeFaceNormal, convertCuboidToMesh } from "../src/engine/model3d/meshOps.ts";
import {
  applyAllModifiers,
  applyModifier,
  createModifier,
  duplicateModifier,
  evaluateModifierStack,
  evaluateModifierStackDetailed,
  getEvaluatedMesh,
  moveModifier,
  removeModifier,
  updateModifier,
} from "../src/engine/model3d/modifiers.ts";
import type { ModelModifier } from "../src/engine/model3d/modifiers.ts";
import {
  deserializeModel3DScene,
  createEmptyModel3DSceneSnapshot,
  serializeModel3DScene,
} from "../src/engine/model3d/serialization.ts";
import type { ModelNode, PolyMeshData, Vec3 } from "../src/engine/model3d/types.ts";

function cube(from: Vec3 = [0, 0, 0], to: Vec3 = [8, 8, 8]): PolyMeshData {
  return convertCuboidToMesh(createDefaultCuboidData(from, to));
}

function bounds(mesh: PolyMeshData) {
  const min: Vec3 = [Infinity, Infinity, Infinity];
  const max: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (const v of mesh.vertices)
    for (let a = 0; a < 3; a++) {
      min[a] = Math.min(min[a], v[a]);
      max[a] = Math.max(max[a], v[a]);
    }
  return { min, max };
}

function assertOutward(mesh: PolyMeshData, center: Vec3) {
  for (const f of mesh.faces) {
    const n = computeFaceNormal(mesh.vertices, f);
    const c = computeFaceCentroid(mesh.vertices, f);
    const d = n[0] * (c[0] - center[0]) + n[1] * (c[1] - center[1]) + n[2] * (c[2] - center[2]);
    assert.ok(d > 0, `face ${f.id} points inward`);
  }
}

function assertValid(mesh: PolyMeshData) {
  const ids = new Set<string>();
  for (const f of mesh.faces) {
    assert.ok(!ids.has(f.id), `duplicate id ${f.id}`);
    ids.add(f.id);
    assert.ok(f.verts.length === 3 || f.verts.length === 4);
    assert.equal(f.uvs.length, f.verts.length);
    for (const v of f.verts) assert.ok(v >= 0 && v < mesh.vertices.length);
  }
}

function mod<T extends ModelModifier>(type: T["type"], patch: Partial<T> = {}): T {
  return { ...createModifier(type), ...patch } as T;
}

const OPTS = { context: "export" as const };

test("mirror: offset cube gets outward-facing mirrored copy", () => {
  const src = cube([2, 0, 0], [10, 8, 8]);
  const m = mod("mirror", { mergeSeam: false });
  const out = evaluateModifierStack(src, [m], OPTS);
  assert.equal(out.faces.length, 12);
  assert.equal(out.vertices.length, 16);
  assert.deepEqual(bounds(out).min, [-10, 0, 0]);
  assert.deepEqual(bounds(out).max, [10, 8, 8]);
  const half = out.faces.length / 2;
  assertOutward({ vertices: out.vertices, faces: out.faces.slice(0, half) }, [6, 4, 4]);
  assertOutward({ vertices: out.vertices, faces: out.faces.slice(half) }, [-6, 4, 4]);
  assertValid(out);
});

test("mirror: merge seam welds verts on the plane; pivot is the mirror origin", () => {
  const src = cube([0, 0, 0], [8, 8, 8]);
  const m = mod("mirror");
  const out = evaluateModifierStack(src, [m], OPTS);
  assert.equal(out.vertices.length, 12); // 8 + 8 - 4 seam
  assert.equal(out.faces.length, 12);
  assertValid(out);
  const shifted = evaluateModifierStack(src, [m], { ...OPTS, pivot: [4, 0, 0] });
  assert.deepEqual(bounds(shifted).min, [0, 0, 0]);
  assert.deepEqual(bounds(shifted).max, [8, 8, 8]);
  const far = evaluateModifierStack(src, [m], { ...OPTS, pivot: [-4, 0, 0] });
  assert.deepEqual(bounds(far).min, [-16, 0, 0]);
});

test("mirror: multiple axes multiply geometry", () => {
  const m = mod("mirror", { axes: { x: true, y: true, z: true }, mergeSeam: false });
  const out = evaluateModifierStack(cube([1, 1, 1], [3, 3, 3]), [m], OPTS);
  assert.equal(out.faces.length, 48);
  assert.deepEqual(bounds(out).min, [-3, -3, -3]);
  assertValid(out);
});

test("array: count 3 bounds and merge adjacent", () => {
  const a = mod("array", { count: 3, relativeOffset: [1, 0, 0], constantOffsetPx: [0, 0, 0] });
  const out = evaluateModifierStack(cube(), [a], OPTS);
  assert.equal(out.faces.length, 18);
  assert.equal(out.vertices.length, 24);
  assert.deepEqual(bounds(out).max, [24, 8, 8]);
  assertValid(out);
  const merged = evaluateModifierStack(cube(), [{ ...a, mergeAdjacent: true } as ModelModifier], OPTS);
  assert.equal(merged.vertices.length, 16);
  const spaced = evaluateModifierStack(
    cube(),
    [{ ...a, relativeOffset: [0, 0, 0], constantOffsetPx: [10, 0, 0] } as ModelModifier],
    OPTS
  );
  assert.deepEqual(bounds(spaced).max, [28, 8, 8]);
});

test("subdivide: face counts per level and bounds preserved", () => {
  for (const [levels, faces] of [[1, 24], [2, 96], [3, 384]] as const) {
    const out = evaluateModifierStack(cube(), [mod("subdivide", { levels })], OPTS);
    assert.equal(out.faces.length, faces);
    assert.deepEqual(bounds(out), bounds(cube()));
    assertValid(out);
    assertOutward(out, [4, 4, 4]);
  }
  // shared midpoints: watertight cube level 1 = 8 + 12 edges + 6 centers
  assert.equal(evaluateModifierStack(cube(), [mod("subdivide")], OPTS).vertices.length, 26);
});

test("subdivide: triangles handled", () => {
  const tri: PolyMeshData = {
    vertices: [[0, 0, 0], [4, 0, 0], [0, 4, 0]],
    faces: [{ id: "t", verts: [0, 1, 2], uvs: [[0, 0], [4, 0], [0, 4]], materialId: "m" }],
  };
  const out = evaluateModifierStack(tri, [mod("subdivide")], OPTS);
  assert.equal(out.faces.length, 4);
  assert.equal(out.vertices.length, 6);
  assertValid(out);
});

test("solidify: single quad plane", () => {
  const quad: PolyMeshData = {
    vertices: [[0, 0, 0], [4, 0, 0], [4, 4, 0], [0, 4, 0]],
    faces: [{ id: "q", verts: [0, 1, 2, 3], uvs: [[0, 0], [4, 0], [4, 4], [0, 4]], materialId: "m" }],
  };
  assert.equal(computeFaceNormal(quad.vertices, quad.faces[0])[2], 1);
  const out = evaluateModifierStack(quad, [mod("solidify", { thicknessPx: 2, offset: -1 })], OPTS);
  assert.equal(out.faces.length, 6); // outer + inner + 4 rim
  assert.equal(out.vertices.length, 8);
  assert.equal(bounds(out).min[2], -2);
  assert.equal(bounds(out).max[2], 0);
  assertOutward(out, [2, 2, -1]);
  assertValid(out);
  const noRim = evaluateModifierStack(quad, [mod("solidify", { thicknessPx: 2, rim: false })], OPTS);
  assert.equal(noRim.faces.length, 2);
  const centered = evaluateModifierStack(quad, [mod("solidify", { thicknessPx: 2, offset: 0 })], OPTS);
  assert.deepEqual([bounds(centered).min[2], bounds(centered).max[2]], [-1, 1]);
  const outward = evaluateModifierStack(quad, [mod("solidify", { thicknessPx: 2, offset: 1 })], OPTS);
  assert.deepEqual([bounds(outward).min[2], bounds(outward).max[2]], [0, 2]);
});

test("solidify: closed cube has no rim and normals stay consistent", () => {
  const out = evaluateModifierStack(cube([-4, -4, -4], [4, 4, 4]), [mod("solidify", { thicknessPx: 1 })], OPTS);
  assert.equal(out.faces.length, 12);
  assertValid(out);
});

test("bevel: sharp cube edges produce extra faces", () => {
  const out = evaluateModifierStack(cube(), [mod("bevel", { widthPx: 1 })], OPTS);
  assert.ok(out.faces.length > 6);
  assertValid(out);
  const flat = evaluateModifierStack(cube(), [mod("bevel", { angleDeg: 120 })], OPTS);
  assert.equal(flat.faces.length, 6);
  const zero = evaluateModifierStack(cube(), [mod("bevel", { widthPx: 0 })], OPTS);
  assert.equal(zero.faces.length, 6);
});

test("triangulate: quads split honoring triSplit", () => {
  const src = cube();
  src.faces[0].triSplit = "13";
  src.faces[1].triSplit = "02";
  const out = evaluateModifierStack(src, [mod("triangulate")], OPTS);
  assert.equal(out.faces.length, 12);
  assert.ok(out.faces.every((f) => f.verts.length === 3));
  const q = src.faces[0].verts;
  assert.deepEqual(out.faces[0].verts, [q[0], q[1], q[3]]);
  assert.deepEqual(out.faces[1].verts, [q[1], q[2], q[3]]);
  assertValid(out);
  assertOutward(out, [4, 4, 4]);
});

test("viewport vs export filtering", () => {
  const a = mod("triangulate", { enabled: true, showInViewport: false });
  const b = mod("triangulate", { enabled: false, showInViewport: true });
  assert.equal(evaluateModifierStack(cube(), [a, b], { context: "viewport" }).faces.length, 6);
  assert.equal(evaluateModifierStack(cube(), [a, b], { context: "export" }).faces.length, 12);
  const c = mod("array", { count: 2 });
  assert.equal(evaluateModifierStack(cube(), [c], { context: "viewport" }).faces.length, 12);
});

test("stack order matters: array then mirror vs mirror then array", () => {
  const arr = mod("array", { count: 2, relativeOffset: [1, 0, 0], mergeAdjacent: false });
  const mir = mod("mirror", { mergeSeam: false });
  const am = evaluateModifierStack(cube([1, 0, 0], [3, 2, 2]), [arr, mir], OPTS);
  const ma = evaluateModifierStack(cube([1, 0, 0], [3, 2, 2]), [mir, arr], OPTS);
  assert.equal(am.faces.length, ma.faces.length);
  assert.deepEqual(bounds(am).min, [-5, 0, 0]);
  assert.deepEqual(bounds(am).max, [5, 2, 2]);
  assert.deepEqual(bounds(ma).min, [-3, 0, 0]);
  assert.deepEqual(bounds(ma).max, [3 + 6, 2, 2]);
});

test("input mesh and modifiers are not mutated", () => {
  const src = cube();
  const mods = [mod("mirror"), mod("subdivide"), mod("solidify"), mod("bevel")];
  const before = JSON.stringify([src, mods]);
  evaluateModifierStack(src, mods, OPTS);
  evaluateModifierStack(src, [], OPTS);
  assert.equal(JSON.stringify([src, mods]), before);
  const same = evaluateModifierStack(src, [], OPTS);
  assert.notEqual(same, src);
  assert.notEqual(same.vertices[0], src.vertices[0]);
});

test("face cap truncates and reports", () => {
  const r = evaluateModifierStackDetailed(
    cube(),
    [mod("array", { count: 2 }), mod("subdivide", { levels: 3 }), mod("triangulate")],
    { context: "export", maxFaces: 100 }
  );
  assert.equal(r.truncated, true);
  assert.equal(r.mesh.faces.length, 12); // array applied, subdivide rejected, rest abandoned
  assert.equal(Object.keys(r.perModifierFaceCount).length, 1);
  const ok = evaluateModifierStackDetailed(cube(), [mod("subdivide")], OPTS);
  assert.equal(ok.truncated, false);
  assert.equal(Object.values(ok.perModifierFaceCount)[0], 24);
  const huge = evaluateModifierStackDetailed(cube(), [mod("array", { count: 128 }), mod("subdivide", { levels: 3 }), mod("subdivide", { levels: 3 })], OPTS);
  assert.ok(huge.mesh.faces.length <= 200_000);
  assert.equal(huge.truncated, true);
});

function meshNode(mods?: ModelModifier[]): ModelNode {
  return {
    id: "n1",
    name: "n",
    kind: "mesh",
    parentId: null,
    visible: true,
    locked: false,
    collider: "none",
    transform: createDefaultTransform(),
    mesh: cube(),
    modifiers: mods,
  };
}

test("applyModifier bakes prefix and removes it; applyAll bakes everything", () => {
  const a = mod("array", { count: 2 });
  const t = mod("triangulate");
  const s = mod("subdivide");
  const node = meshNode([a, t, s]);
  const first = applyModifier(node, a.id);
  assert.equal(first.mesh!.faces.length, 12);
  assert.deepEqual(first.modifiers!.map((m) => m.id), [t.id, s.id]);
  assert.equal(node.mesh!.faces.length, 6); // input untouched
  assert.equal(node.modifiers!.length, 3);
  const second = applyModifier(node, t.id);
  assert.equal(second.mesh!.faces.length, 24);
  assert.deepEqual(second.modifiers!.map((m) => m.id), [s.id]);
  const all = applyAllModifiers(node);
  assert.equal(all.mesh!.faces.length, 96);
  assert.equal(all.modifiers, undefined);
  assert.equal(applyModifier(node, "nope"), node);
});

test("getEvaluatedMesh: passthrough and cache", () => {
  const plain = meshNode();
  assert.equal(getEvaluatedMesh(plain, "viewport"), plain.mesh);
  const emptyNode = meshNode([]);
  assert.equal(getEvaluatedMesh(emptyNode, "export"), emptyNode.mesh);
  const node = meshNode([mod("array", { count: 2 })]);
  const a = getEvaluatedMesh(node, "viewport")!;
  assert.equal(a.faces.length, 12);
  assert.equal(getEvaluatedMesh(node, "viewport"), a);
  node.modifiers = updateModifier(node.modifiers!, node.modifiers![0].id, { count: 3 });
  const b = getEvaluatedMesh(node, "viewport")!;
  assert.notEqual(b, a);
  assert.equal(b.faces.length, 18);
  node.modifiers = updateModifier(node.modifiers!, node.modifiers![0].id, { showInViewport: false });
  assert.equal(getEvaluatedMesh(node, "viewport"), node.mesh);
  assert.equal(getEvaluatedMesh(node, "export")!.faces.length, 18);
  node.mesh!.vertices[0] = [-5, 0, 0];
  assert.notEqual(getEvaluatedMesh(node, "export"), b);
});

test("list helpers", () => {
  const a = createModifier("mirror");
  const b = createModifier("array");
  const c = createModifier("bevel");
  assert.notEqual(a.id, b.id);
  const list = [a, b, c];
  assert.deepEqual(moveModifier(list, c.id, -2).map((m) => m.id), [c.id, a.id, b.id]);
  assert.deepEqual(moveModifier(list, a.id, 99).map((m) => m.id), [b.id, c.id, a.id]);
  assert.deepEqual(removeModifier(list, b.id).map((m) => m.id), [a.id, c.id]);
  const dup = duplicateModifier(list, a.id);
  assert.equal(dup.length, 4);
  assert.notEqual(dup[1].id, a.id);
  assert.notEqual((dup[1] as typeof a).axes, (a as typeof a).axes);
  const upd = updateModifier(list, b.id, { count: 5, id: "hack", type: "mirror" });
  assert.equal((upd[1] as { count: number }).count, 5);
  assert.equal(upd[1].id, b.id);
  assert.equal(upd[1].type, "array");
  assert.equal((b as { count: number }).count, 2);
});

test("clone deep-copies modifiers", () => {
  const node = meshNode([mod("mirror"), mod("array")]);
  const copy = cloneModelNode(node);
  assert.deepEqual(copy.modifiers, node.modifiers);
  (copy.modifiers![0] as { axes: { x: boolean } }).axes.x = false;
  (copy.modifiers![1] as { relativeOffset: number[] }).relativeOffset[0] = 9;
  assert.equal((node.modifiers![0] as { axes: { x: boolean } }).axes.x, true);
  assert.equal((node.modifiers![1] as { relativeOffset: number[] }).relativeOffset[0], 1);
  assert.equal("modifiers" in cloneModelNode(meshNode()), false);
});

test("serialization round trip, legacy data, and sanitizing", () => {
  const mods = [mod("mirror"), mod("array", { count: 4 }), mod("solidify", { thicknessPx: 3 })];
  const snap = createEmptyModel3DSceneSnapshot();
  snap.nodes = [meshNode(mods)];
  const json = JSON.parse(JSON.stringify(serializeModel3DScene(snap)));
  const back = deserializeModel3DScene(json);
  assert.deepEqual(back.nodes[0].modifiers, mods);

  const legacy = JSON.parse(JSON.stringify(serializeModel3DScene({ ...snap, nodes: [meshNode()] })));
  delete legacy.nodes[0].modifiers;
  const old = deserializeModel3DScene(legacy);
  assert.equal(old.nodes[0].modifiers, undefined);
  assert.equal(old.nodes[0].mesh!.faces.length, 6);

  const dirty = JSON.parse(JSON.stringify(json));
  dirty.nodes[0].modifiers = [
    { type: "bogus", id: "x" },
    "junk",
    null,
    { type: "array", id: "dup", count: 99999, relativeOffset: ["a", 1e9, null], mergeThresholdPx: -5 },
    { type: "subdivide", id: "dup", levels: 17 },
    { type: "solidify", offset: 50, thicknessPx: "x" },
    { type: "mirror", axes: { x: "yes" }, enabled: "no" },
  ];
  const cleaned = deserializeModel3DScene(dirty).nodes[0].modifiers!;
  assert.deepEqual(cleaned.map((m) => m.type), ["array", "subdivide", "solidify", "mirror"]);
  assert.equal(new Set(cleaned.map((m) => m.id)).size, 4);
  const arr = cleaned[0] as { count: number; relativeOffset: number[]; mergeThresholdPx: number };
  assert.equal(arr.count, 128);
  assert.ok(arr.relativeOffset.every((n) => Number.isFinite(n) && Math.abs(n) <= 1000));
  assert.equal(arr.mergeThresholdPx, 0);
  assert.equal((cleaned[1] as { levels: number }).levels, 3);
  assert.equal((cleaned[2] as { offset: number }).offset, 1);
  assert.equal((cleaned[3] as { enabled: boolean }).enabled, true);

  const notArray = JSON.parse(JSON.stringify(json));
  notArray.nodes[0].modifiers = { foo: 1 };
  assert.equal(deserializeModel3DScene(notArray).nodes[0].modifiers, undefined);
});

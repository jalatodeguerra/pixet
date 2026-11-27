import test from "node:test";
import assert from "node:assert/strict";

import {
  boxSelectMode,
  collectUniqueEdges,
  combineSelection,
  invertSelection,
  normalizeRect,
  pointInRect,
  selectEdgesInRect,
  selectFacesInRect,
  selectNodesInRect,
  selectVerticesInRect,
  type ProjectedPoint,
} from "../src/engine/model3d/boxSelect.ts";
import { collectEdgeRing, loopCutEdges } from "../src/engine/model3d/loopCut.ts";
import { createDefaultCuboidData } from "../src/engine/model3d/Model3DEngine.ts";
import { convertCuboidToMesh } from "../src/engine/model3d/meshOps.ts";
import type { PolyMeshData } from "../src/engine/model3d/types.ts";

test("normalizeRect orders corners; pointInRect is inclusive and null-safe", () => {
  const r = normalizeRect(50, 80, 10, 20);
  assert.deepEqual(r, { x0: 10, y0: 20, x1: 50, y1: 80 });
  assert.equal(pointInRect([10, 20], r), true);
  assert.equal(pointInRect([50, 80], r), true);
  assert.equal(pointInRect([51, 50], r), false);
  assert.equal(pointInRect(null, r), false);
});

test("boxSelectMode: shift adds, ctrl subtracts (ctrl wins), default replaces", () => {
  assert.equal(boxSelectMode(false, false), "replace");
  assert.equal(boxSelectMode(true, false), "add");
  assert.equal(boxSelectMode(false, true), "subtract");
  assert.equal(boxSelectMode(true, true), "subtract");
});

const projected: ProjectedPoint[] = [
  [10, 10], // 0
  [20, 10], // 1
  [20, 20], // 2
  [10, 20], // 3
  [100, 100], // 4
  null, // 5 (behind camera)
];

test("vertex box select ignores points outside and unprojectable points", () => {
  const rect = normalizeRect(0, 0, 25, 25);
  assert.deepEqual(selectVerticesInRect(projected, rect), [0, 1, 2, 3]);
});

test("edge box select needs both endpoints inside; face box select uses the centroid", () => {
  const rect = normalizeRect(0, 0, 25, 25);
  const edges: Array<[number, number]> = [[0, 1], [1, 4], [2, 5], [3, 2]];
  assert.deepEqual(selectEdgesInRect(projected, edges, rect), [[0, 1], [2, 3]]);

  const faces = [
    { id: "a", verts: [0, 1, 2, 3] },
    { id: "b", verts: [1, 2, 4] }, // centroid (46.7, 43.3) outside
    { id: "c", verts: [0, 1, 5] }, // has an unprojectable corner
  ];
  assert.deepEqual(selectFacesInRect(projected, faces, rect), ["a"]);
  // A rect that covers only the centroid of a big face selects it though no corner is inside.
  const big = [{ id: "big", verts: [0, 4, 2] }];
  assert.deepEqual(selectFacesInRect(projected, big, normalizeRect(35, 35, 50, 50)), ["big"]);
});

test("node box select uses the projected anchor", () => {
  const nodes = [
    { id: "a", point: [5, 5] as ProjectedPoint },
    { id: "b", point: [500, 5] as ProjectedPoint },
    { id: "c", point: null },
  ];
  assert.deepEqual(selectNodesInRect(nodes, normalizeRect(0, 0, 50, 50)), ["a"]);
});

test("combineSelection replaces, adds without duplicates, and subtracts", () => {
  assert.deepEqual(combineSelection([1, 2], [3], "replace"), [3]);
  assert.deepEqual(combineSelection([1, 2], [2, 3], "add"), [1, 2, 3]);
  assert.deepEqual(combineSelection([1, 2, 3], [2], "subtract"), [1, 3]);
  const edgeKey = (e: [number, number]) => `${e[0]}:${e[1]}`;
  assert.deepEqual(
    combineSelection<[number, number]>([[0, 1]], [[0, 1], [1, 2]], "add", edgeKey),
    [[0, 1], [1, 2]]
  );
});

test("invertSelection returns the complement", () => {
  assert.deepEqual(invertSelection([0, 1, 2, 3], [1, 3]), [0, 2]);
  assert.deepEqual(invertSelection(["a", "b"], []), ["a", "b"]);
});

function cubeMesh(): PolyMeshData {
  return convertCuboidToMesh(createDefaultCuboidData([0, 0, 0], [16, 16, 16], "m"));
}

test("collectUniqueEdges: a cube has 12 edges", () => {
  assert.equal(collectUniqueEdges(cubeMesh()).length, 12);
});

test("loop cut: ring of a cube edge covers 4 quads; cutting adds 4 verts and 4 faces and stays watertight", () => {
  const cube = cubeMesh();
  const edge = collectUniqueEdges(cube)[0];
  const ring = collectEdgeRing(cube, edge);
  assert.equal(ring.length, 4);

  const res = loopCutEdges(cube, [edge]);
  assert.equal(res.cutFaceCount, 4);
  assert.equal(res.mesh.vertices.length, 8 + 4);
  assert.equal(res.mesh.faces.length, 6 + 4);
  assert.equal(res.newEdges.length, 4);

  // Closed manifold: every undirected edge is shared by exactly two faces.
  const counts = new Map<string, number>();
  for (const f of res.mesh.faces) {
    for (let i = 0; i < f.verts.length; i++) {
      const a = f.verts[i];
      const b = f.verts[(i + 1) % f.verts.length];
      const k = a < b ? `${a}:${b}` : `${b}:${a}`;
      counts.set(k, (counts.get(k) ?? 0) + 1);
    }
  }
  for (const [k, n] of counts) assert.equal(n, 2, `edge ${k} shared by ${n} faces`);

  // The input mesh is not mutated.
  assert.equal(cube.faces.length, 6);

  // New edges join two new midpoint vertices (indices >= 8).
  for (const [a, b] of res.newEdges) {
    assert.ok(a >= 8 && b >= 8);
  }
});

test("loop cut with no quad ring returns the mesh unchanged", () => {
  const tri: PolyMeshData = {
    vertices: [[0, 0, 0], [1, 0, 0], [0, 1, 0]],
    faces: [{ id: "t", verts: [0, 1, 2], uvs: [[0, 0], [1, 0], [0, 1]], materialId: "m" }],
  };
  const res = loopCutEdges(tri, [[0, 1]]);
  assert.equal(res.cutFaceCount, 0);
  assert.equal(res.mesh.faces.length, 1);
});

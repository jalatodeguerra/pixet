import test from "node:test";
import assert from "node:assert/strict";

import {
  createDefaultCuboidData,
  DEFAULT_MODEL3D_MATERIAL_ID,
  Model3DEngine,
} from "../src/engine/model3d/Model3DEngine.ts";
import {
  bevelEdges,
  bevelVertices,
  collectAffectedVertexIndices,
  computeFaceCentroid,
  computeFaceNormal,
  computeVerticesCentroid,
  convertCuboidToMesh,
  convertNodeCuboidToMesh,
  cullInternalCoplanarFaces,
  deleteSelectedElements,
  extrudeFaces,
  fillOrBridgeSelection,
  flipFaceNormals,
  flipQuadDiagonal,
  insetFaces,
  joinMeshNodes,
  mergeVertices,
  mirrorNode,
  recalculateOutwardNormals,
  selectEdgeLoop,
  separateSelectedFaces,
  subdivideFacesOrLoopCut,
  transformMeshVertices,
  weldVerticesByDistance,
} from "../src/engine/model3d/meshOps.ts";
import { vec3Dot, vec3Length, vec3Sub } from "../src/engine/model3d/quatMath.ts";
import type { ModelNode, PolyMeshData, Vec3 } from "../src/engine/model3d/types.ts";
import { computeBoxUvFaces, cuboidFaceUvToCorners } from "../src/engine/model3d/uvOps.ts";

function assertNear(actual: number, expected: number, eps = 1e-5, msg?: string) {
  assert.ok(
    Math.abs(actual - expected) <= eps,
    `${msg ? msg + ": " : ""}expected ${expected} ± ${eps}, got ${actual}`
  );
}

function computeMeshCentroid(mesh: PolyMeshData): Vec3 {
  let sx = 0;
  let sy = 0;
  let sz = 0;
  for (const v of mesh.vertices) {
    sx += v[0];
    sy += v[1];
    sz += v[2];
  }
  const n = Math.max(1, mesh.vertices.length);
  return [sx / n, sy / n, sz / n];
}

function assertClosedOutwardMesh(mesh: PolyMeshData, label: string): void {
  const centroid = computeMeshCentroid(mesh);
  for (const face of mesh.faces) {
    assert.ok(
      face.verts.length === 3 || face.verts.length === 4,
      `${label} face ${face.id}: expected 3 or 4 verts`
    );
    assert.equal(
      face.uvs.length,
      face.verts.length,
      `${label} face ${face.id}: UV count matches vert count`
    );
    assert.equal(
      new Set(face.verts).size,
      face.verts.length,
      `${label} face ${face.id}: distinct vertex indices`
    );
    const normal = computeFaceNormal(mesh.vertices, face);
    assertNear(vec3Length(normal), 1, 1e-4, `${label} face ${face.id} unit normal`);
    const fc = computeFaceCentroid(mesh.vertices, face);
    const dot = vec3Dot(normal, vec3Sub(fc, centroid));
    assert.ok(
      dot > 0,
      `${label} face ${face.id}: outward normal dot > 0, got ${dot}`
    );
  }
}

function makeTestCubeNode(
  id: string,
  from: Vec3,
  to: Vec3,
  materialId = DEFAULT_MODEL3D_MATERIAL_ID
): ModelNode {
  const cuboid = createDefaultCuboidData(from, to, materialId);
  cuboid.faces = computeBoxUvFaces(from, to, [0, 0], materialId);
  return {
    id,
    name: id,
    kind: "cuboid",
    parentId: null,
    visible: true,
    locked: false,
    collider: "none",
    transform: {
      position: [0, 0, 0],
      rotation: [0, 0, 0],
      scale: [1, 1, 1],
      pivot: [0, 0, 0],
    },
    cuboid,
  };
}

test("M4-A meshOps: convertCuboidToMesh & convertNodeCuboidToMesh preserve inflate, hidden faces, UVs, and outward CCW winding", () => {
  const cuboid = createDefaultCuboidData([-4, 0, -4], [4, 8, 4], "mat-armor");
  cuboid.inflate = 1.5;
  cuboid.faces = computeBoxUvFaces(cuboid.from, cuboid.to, [2, 4], "mat-armor");
  cuboid.faces.down.hidden = true;
  cuboid.faces.north.rotation = 90;
  cuboid.faces.east.flipX = true;

  const mesh = convertCuboidToMesh(cuboid);
  assert.equal(mesh.vertices.length, 8);
  assert.equal(mesh.faces.length, 5); // down skipped because hidden === true

  // Check inflate applied to vertex bounds: [-5.5..5.5, -1.5..9.5, -5.5..5.5]
  const xs = mesh.vertices.map((v) => v[0]);
  const ys = mesh.vertices.map((v) => v[1]);
  const zs = mesh.vertices.map((v) => v[2]);
  assertNear(Math.min(...xs), -5.5);
  assertNear(Math.max(...xs), 5.5);
  assertNear(Math.min(...ys), -1.5);
  assertNear(Math.max(...ys), 9.5);
  assertNear(Math.min(...zs), -5.5);
  assertNear(Math.max(...zs), 5.5);

  assertClosedOutwardMesh(mesh, "converted-cuboid");

  const northFace = mesh.faces.find((f) => f.id === "cuboid-north");
  const eastFace = mesh.faces.find((f) => f.id === "cuboid-east");
  const southFace = mesh.faces.find((f) => f.id === "cuboid-south");
  assert.ok(northFace && eastFace && southFace);
  assert.equal(northFace.materialId, "mat-armor");
  assert.deepEqual(northFace.uvs, cuboidFaceUvToCorners(cuboid.faces.north));
  assert.deepEqual(eastFace.uvs, cuboidFaceUvToCorners(cuboid.faces.east));
  assert.deepEqual(southFace.uvs, cuboidFaceUvToCorners(cuboid.faces.south));

  // Verify exact outward face normal directions
  assertNear(computeFaceNormal(mesh.vertices, northFace)[2], -1);
  assertNear(computeFaceNormal(mesh.vertices, southFace)[2], 1);
  assertNear(computeFaceNormal(mesh.vertices, eastFace)[0], 1);

  // Node conversion transitions kind "cuboid" -> "mesh"
  const cuboidNode = makeTestCubeNode("body", [0, 0, 0], [8, 8, 8], "mat-skin");
  cuboidNode.transform.pivot = [4, 0, 4];
  cuboidNode.collider = "box";
  const meshNode = convertNodeCuboidToMesh(cuboidNode);
  assert.equal(meshNode.kind, "mesh");
  assert.equal(meshNode.cuboid, undefined);
  assert.ok(meshNode.mesh);
  assert.equal(meshNode.mesh.vertices.length, 8);
  assert.equal(meshNode.mesh.faces.length, 6);
  assert.deepEqual(meshNode.transform.pivot, [4, 0, 4]);
  assert.equal(meshNode.collider, "box");
});

test("M4-A meshOps: extrudeFaces on single face (6 -> 10 faces) and 2-face region (no internal wall)", () => {
  const cube = convertCuboidToMesh(createDefaultCuboidData([0, 0, 0], [8, 8, 8]));
  assert.equal(cube.faces.length, 6);

  // 1. Single face extrude (+Z south face by 4px)
  const single = extrudeFaces(cube, ["cuboid-south"], 4);
  assert.equal(single.extrudedFaceIds.length, 1);
  assert.equal(single.sideFaceIds.length, 4);
  assert.equal(single.mesh.faces.length, 10);
  assert.equal(single.mesh.vertices.length, 12);
  assertClosedOutwardMesh(single.mesh, "extrude-single");

  const extrudedSouth = single.mesh.faces.find((f) => f.id === "cuboid-south")!;
  const southCenter = computeFaceCentroid(single.mesh.vertices, extrudedSouth);
  assertNear(southCenter[2], 12);

  // Side walls should have pixel-proportional UVs (edgeLen=8, dist=4)
  for (const sideId of single.sideFaceIds) {
    const sideFace = single.mesh.faces.find((f) => f.id === sideId)!;
    assert.deepEqual(sideFace.uvs, [
      [0, 4],
      [8, 4],
      [8, 0],
      [0, 0],
    ]);
  }

  // 2. Two-adjacent-faces region extrude (south + east share 1 edge -> 6 boundary edges, 0 internal walls)
  const region = extrudeFaces(cube, ["cuboid-south", "cuboid-east"], 4);
  assert.deepEqual(region.extrudedFaceIds, ["cuboid-south", "cuboid-east"]);
  assert.equal(region.sideFaceIds.length, 6);
  assert.equal(region.mesh.faces.length, 12);
  assertClosedOutwardMesh(region.mesh, "extrude-region");
});

test("M4-A meshOps: insetFaces clamps safely and creates frame quads + interpolated inner UVs", () => {
  const cube = convertCuboidToMesh(createDefaultCuboidData([0, 0, 0], [8, 8, 8]));
  const insetRes = insetFaces(cube, ["cuboid-up"], 2, -1);
  assert.deepEqual(insetRes.innerFaceIds, ["cuboid-up"]);
  // 5 untouched + 4 frame quads + 1 inner quad = 10 faces
  assert.equal(insetRes.mesh.faces.length, 10);
  assert.equal(insetRes.mesh.vertices.length, 12);

  const innerUp = insetRes.mesh.faces.find((f) => f.id === "cuboid-up")!;
  const innerCentroid = computeFaceCentroid(insetRes.mesh.vertices, innerUp);
  assertNear(innerCentroid[1], 7); // depth = -1 along +Y normal

  const innerXs = innerUp.verts.map((vi) => insetRes.mesh.vertices[vi][0]);
  const innerZs = innerUp.verts.map((vi) => insetRes.mesh.vertices[vi][2]);
  assert.ok(Math.max(...innerXs) - Math.min(...innerXs) > 0);
  assert.ok(Math.max(...innerXs) - Math.min(...innerXs) < 8);
  assert.ok(Math.max(...innerZs) - Math.min(...innerZs) > 0);
  assert.ok(Math.max(...innerZs) - Math.min(...innerZs) < 8);

  // Huge inset should clamp safely (t <= 0.95) and never invert winding
  const clamped = insetFaces(cube, ["cuboid-up"], 999);
  const clampedInner = clamped.mesh.faces.find((f) => f.id === "cuboid-up")!;
  const clampedNormal = computeFaceNormal(clamped.mesh.vertices, clampedInner);
  assertNear(clampedNormal[1], 1);
});

test("M4-A meshOps: subdivideFacesOrLoopCut ('u', 'v', 'both') shares midpoints & interpolates UVs", () => {
  // Two adjacent quads sharing edge (1, 2)
  const twoQuads: PolyMeshData = {
    vertices: [
      [0, 0, 0], // 0
      [8, 0, 0], // 1
      [8, 0, 8], // 2
      [0, 0, 8], // 3
      [16, 0, 0], // 4
      [16, 0, 8], // 5
    ],
    faces: [
      {
        id: "q-left",
        verts: [0, 3, 2, 1],
        uvs: [
          [0, 0],
          [0, 8],
          [8, 8],
          [8, 0],
        ],
        triSplit: "02",
        flatShading: true,
        materialId: "mat-1",
      },
      {
        id: "q-right",
        verts: [1, 2, 5, 4],
        uvs: [
          [8, 0],
          [8, 8],
          [16, 8],
          [16, 0],
        ],
        triSplit: "02",
        flatShading: true,
        materialId: "mat-1",
      },
    ],
  };

  // Axis "u" splits both quads across shared edge (1, 2) -> shared midpoint welded!
  const subU = subdivideFacesOrLoopCut(twoQuads, undefined, "u");
  assert.equal(subU.faces.length, 4);
  // 6 original + 3 Z-edges ((0,3), (1,2), (4,5)) = 9 vertices (shared edge welded!)
  assert.equal(subU.vertices.length, 9);
  for (const f of subU.faces) {
    assert.equal(f.verts.length, 4);
    assertNear(computeFaceNormal(subU.vertices, f)[1], 1);
  }

  // Axis "v" splits the 4 X-edges ((0,1), (3,2), (1,4), (2,5)) -> 6 + 4 = 10 vertices
  const subV = subdivideFacesOrLoopCut(twoQuads, undefined, "v");
  assert.equal(subV.faces.length, 4);
  assert.equal(subV.vertices.length, 10);

  // Axis "both" on all faces -> 2 * 4 = 8 quads; shared edge (1, 2) still welded
  const subBoth = subdivideFacesOrLoopCut(twoQuads, undefined, "both");
  assert.equal(subBoth.faces.length, 8);
  // 6 original + 7 unique edges + 2 face centers = 15 vertices
  assert.equal(subBoth.vertices.length, 15);
  for (const f of subBoth.faces) {
    assert.equal(f.verts.length, 4);
    assertNear(computeFaceNormal(subBoth.vertices, f)[1], 1);
  }
});

test("M4-A meshOps: mergeVertices & weldVerticesByDistance collapse quads to tris, drop degenerates, and compact vertices", () => {
  const mesh: PolyMeshData = {
    vertices: [
      [0, 0, 0], // 0
      [8, 0, 0], // 1
      [8, 8, 0], // 2
      [0, 8, 0], // 3
      [16, 0, 0], // 4 (duplicate-distance test target)
    ],
    faces: [
      {
        id: "front",
        verts: [0, 1, 2, 3],
        uvs: [
          [0, 8],
          [8, 8],
          [8, 0],
          [0, 0],
        ],
        triSplit: "02",
        flatShading: true,
        materialId: "mat-1",
      },
      {
        id: "degenerate-line",
        verts: [1, 2, 4],
        uvs: [
          [0, 0],
          [1, 0],
          [1, 1],
        ],
        flatShading: true,
        materialId: "mat-1",
      },
    ],
  };

  // Merge top edge (2 and 3) into center -> quad collapses to triangle, orphan vertex compacted
  const merged = mergeVertices(mesh, [2, 3], "center");
  assert.equal(merged.faces.length, 2);
  const frontTri = merged.faces.find((f) => f.id === "front")!;
  assert.equal(frontTri.verts.length, 3);
  assert.equal(frontTri.uvs.length, 3);
  assert.equal(frontTri.triSplit, undefined);
  assert.equal(merged.vertices.length, 4);
  assertNear(merged.vertices[2][0], 4);
  assertNear(merged.vertices[2][1], 8);
  assert.deepEqual(frontTri.uvs[2], [4, 0]);

  // Merging vertex 1 into 2 collapses degenerate-line [1, 2, 4] to <3 verts and drops it
  const mergedDrop = mergeVertices(mesh, [1, 2], "last");
  assert.equal(mergedDrop.faces.length, 1);
  assert.equal(mergedDrop.faces[0].id, "front");
  assert.equal(mergedDrop.faces[0].verts.length, 3);
  assert.equal(mergedDrop.vertices.length, 3); // vertex 4 unused -> compacted out!

  // Weld by distance on duplicate seam vertices
  const seamMesh: PolyMeshData = {
    vertices: [
      [0, 0, 0],
      [8, 0, 0],
      [8, 8, 0],
      [0, 8, 0],
      [8.0001, 0, 0], // within 1e-3 of vertex 1
      [8.0001, 8, 0], // within 1e-3 of vertex 2
      [16, 8, 0],
      [16, 0, 0],
    ],
    faces: [
      {
        id: "f1",
        verts: [0, 1, 2, 3],
        uvs: [
          [0, 8],
          [8, 8],
          [8, 0],
          [0, 0],
        ],
        materialId: "mat-1",
      },
      {
        id: "f2",
        verts: [4, 7, 6, 5],
        uvs: [
          [8, 8],
          [16, 8],
          [16, 0],
          [8, 0],
        ],
        materialId: "mat-1",
      },
    ],
  };

  const welded = weldVerticesByDistance(seamMesh, 1e-3);
  assert.equal(welded.weldedCount, 2);
  assert.equal(welded.mesh.vertices.length, 6);
  assert.equal(welded.mesh.faces.length, 2);
});

test("M4-A meshOps: flipQuadDiagonal, flipFaceNormals, and recalculateOutwardNormals", () => {
  const cube = convertCuboidToMesh(createDefaultCuboidData([0, 0, 0], [8, 8, 8]));
  const flippedDiag = flipQuadDiagonal(cube, ["cuboid-south", "cuboid-up"]);
  assert.equal(
    flippedDiag.faces.find((f) => f.id === "cuboid-south")?.triSplit,
    "13"
  );
  assert.equal(
    flippedDiag.faces.find((f) => f.id === "cuboid-up")?.triSplit,
    "13"
  );
  assert.equal(
    flippedDiag.faces.find((f) => f.id === "cuboid-north")?.triSplit,
    "02"
  );

  // Flip again toggles back to "02"
  const toggledBack = flipQuadDiagonal(flippedDiag, ["cuboid-south"]);
  assert.equal(
    toggledBack.faces.find((f) => f.id === "cuboid-south")?.triSplit,
    "02"
  );

  // flipFaceNormals reverses winding AND keeps vertex<->UV pairing in sync
  const southBefore = cube.faces.find((f) => f.id === "cuboid-south")!;
  const flippedNormals = flipFaceNormals(cube, ["cuboid-south", "cuboid-north"]);
  const southFlipped = flippedNormals.faces.find((f) => f.id === "cuboid-south")!;
  const northFlipped = flippedNormals.faces.find((f) => f.id === "cuboid-north")!;
  assertNear(computeFaceNormal(flippedNormals.vertices, southFlipped)[2], -1);
  assertNear(computeFaceNormal(flippedNormals.vertices, northFlipped)[2], 1);

  for (let i = 0; i < southFlipped.verts.length; i++) {
    const origIdx = southBefore.verts.indexOf(southFlipped.verts[i]);
    assert.ok(origIdx !== -1);
    assert.deepEqual(southFlipped.uvs[i], southBefore.uvs[origIdx]);
  }

  // recalculateOutwardNormals repairs inside-out faces
  const allInsideOut = flipFaceNormals(cube);
  const repaired = recalculateOutwardNormals(allInsideOut);
  assertClosedOutwardMesh(repaired, "recalculated-cube");
});

test("M4-A meshOps: cullInternalCoplanarFaces hides touching cuboid wall (culledCount === 2) and strips internal mesh faces", () => {
  // Two touching cuboids sharing the x=8 wall ([0..8, 0..8, 0..8] and [8..16, 0..8, 0..8])
  const leftCuboid = makeTestCubeNode("left", [0, 0, 0], [8, 8, 8]);
  const rightCuboid = makeTestCubeNode("right", [8, 0, 0], [16, 8, 8]);

  const culledCuboids = cullInternalCoplanarFaces([leftCuboid, rightCuboid]);
  assert.equal(culledCuboids.culledCount, 2);
  assert.equal(culledCuboids.nodes[0].cuboid?.faces.east.hidden, true);
  assert.equal(culledCuboids.nodes[1].cuboid?.faces.west.hidden, true);
  assert.equal(culledCuboids.nodes[0].cuboid?.faces.west.hidden, undefined);
  assert.equal(culledCuboids.nodes[1].cuboid?.faces.east.hidden, undefined);

  // Locked cuboid should not be modified/culled
  const lockedRight = makeTestCubeNode("right-locked", [8, 0, 0], [16, 8, 8]);
  lockedRight.locked = true;
  const skippedLocked = cullInternalCoplanarFaces([leftCuboid, lockedRight]);
  assert.equal(skippedLocked.culledCount, 0);

  // Two touching meshes sharing the same internal wall at x=8
  const leftMesh = convertNodeCuboidToMesh(leftCuboid);
  const rightMesh = convertNodeCuboidToMesh(rightCuboid);
  const culledMeshes = cullInternalCoplanarFaces([leftMesh, rightMesh]);
  assert.equal(culledMeshes.culledCount, 2);
  assert.equal(culledMeshes.nodes[0].mesh?.faces.length, 5);
  assert.equal(culledMeshes.nodes[1].mesh?.faces.length, 5);
});

test("M4-A meshOps: mirrorNode keeps normals outward on cuboids and meshes and supports shared vs offset UVs", () => {
  const engine = new Model3DEngine();
  const armNode = engine.addNode({
    kind: "cuboid",
    name: "Arm_L",
    transform: { pivot: [4, 8, 0], position: [0, 0, 0], rotation: [15, 20, -10] },
    cuboid: createDefaultCuboidData([4, 0, -2], [8, 8, 2]),
  });

  // Mirror cuboid across X with shared UV
  const mirroredCuboidShared = mirrorNode(armNode, "x", true);
  assert.deepEqual(mirroredCuboidShared.transform.pivot, [-4, 8, 0]);
  assert.deepEqual(mirroredCuboidShared.transform.rotation, [15, -20, 10]);
  assert.deepEqual(mirroredCuboidShared.cuboid?.from, [-8, 0, -2]);
  assert.deepEqual(mirroredCuboidShared.cuboid?.to, [-4, 8, 2]);
  assert.equal(mirroredCuboidShared.cuboid?.mirrorUvX, true);
  assert.equal(mirroredCuboidShared.cuboid?.faces.north.flipX, true);
  assert.deepEqual(
    mirroredCuboidShared.cuboid?.faces.north.uv,
    armNode.cuboid?.faces.north.uv
  );

  // Convert mirrored cuboid to mesh and verify outward normals
  assertClosedOutwardMesh(
    convertCuboidToMesh(mirroredCuboidShared.cuboid!),
    "mirrored-cuboid-as-mesh"
  );

  // Mirror cuboid across X with separate UV island
  const mirroredCuboidSeparate = mirrorNode(armNode, "x", false);
  assert.ok(
    mirroredCuboidSeparate.cuboid!.faces.north.uv[0] >
      armNode.cuboid!.faces.north.uv[0]
  );

  // Mirror a mesh node across X, Y, Z and verify outward normals stay positive
  const wedgeMeshNode: ModelNode = {
    id: "mesh-wedge",
    name: "Wedge",
    kind: "mesh",
    parentId: null,
    visible: true,
    locked: false,
    collider: "none",
    transform: {
      position: [2, 0, 0],
      rotation: [0, 0, 0],
      scale: [1, 1, 1],
      pivot: [4, 0, 0],
    },
    mesh: convertCuboidToMesh(createDefaultCuboidData([2, 0, -2], [6, 8, 2])),
  };

  for (const axis of ["x", "y", "z"] as const) {
    const mirroredMesh = mirrorNode(wedgeMeshNode, axis, true);
    assert.ok(mirroredMesh.mesh);
    assertClosedOutwardMesh(mirroredMesh.mesh, `mirrored-mesh-${axis}`);
  }

  const mirroredMeshOffset = mirrorNode(wedgeMeshNode, "x", false);
  assert.ok(mirroredMeshOffset.mesh);
  assertClosedOutwardMesh(mirroredMeshOffset.mesh, "mirrored-mesh-offset-uv");
  const origMaxU = Math.max(
    ...wedgeMeshNode.mesh!.faces.flatMap((f) => f.uvs.map(([u]) => u))
  );
  const newMinU = Math.min(
    ...mirroredMeshOffset.mesh.faces.flatMap((f) => f.uvs.map(([u]) => u))
  );
  assert.ok(newMinU >= origMaxU, "separate UV island should not overlap original UVs");
});

test("M4-G sub-element ops: transformMeshVertices, deleteSelectedElements, selectEdgeLoop", () => {
  const cube = convertCuboidToMesh(createDefaultCuboidData([-4, 0, -4], [4, 8, 4]));
  const topFace = cube.faces.find((f) => {
    const c = computeFaceCentroid(cube.vertices, f);
    return c[1] > 7.5;
  })!;
  assert.ok(topFace);

  const affected = collectAffectedVertexIndices(cube, "face", [], [], [topFace.id]);
  assert.equal(affected.length, 4);
  const centroid = computeVerticesCentroid(cube.vertices, affected)!;
  assertNear(centroid[0], 0);
  assertNear(centroid[1], 8);
  assertNear(centroid[2], 0);

  // Translate with snapPx=2
  const translated = transformMeshVertices(cube, affected, {
    translation: [1.2, 3.6, 0],
    snapPx: 2,
  });
  for (const vi of affected) {
    assertNear(translated.vertices[vi][1], 12);
  }

  // Scale 2x around centroid
  const scaled = transformMeshVertices(cube, affected, {
    scale: [2, 1, 2],
    pivot: centroid,
  });
  for (const vi of affected) {
    assertNear(Math.abs(scaled.vertices[vi][0]), 8);
    assertNear(Math.abs(scaled.vertices[vi][2]), 8);
  }

  // Rotate 90 deg around Y
  const sin45 = Math.SQRT1_2;
  const rotated = transformMeshVertices(cube, [affected[0]], {
    rotationQuat: [0, sin45, 0, sin45],
    pivot: centroid,
  });
  const orig = cube.vertices[affected[0]];
  assertNear(rotated.vertices[affected[0]][0], orig[2], 1e-4);
  assertNear(rotated.vertices[affected[0]][2], -orig[0], 1e-4);

  // Delete top face -> 5 faces remain, all 8 vertices still used
  const delFace = deleteSelectedElements(cube, "face", [], [], [topFace.id]);
  assert.equal(delFace.deletedFaceCount, 1);
  assert.equal(delFace.mesh.faces.length, 5);

  // Delete a vertex -> 3 incident faces deleted, unused vertex compacted
  const delVert = deleteSelectedElements(cube, "vertex", [0], [], []);
  assert.equal(delVert.deletedFaceCount, 3);
  assert.equal(delVert.mesh.faces.length, 3);
  assert.equal(delVert.mesh.vertices.length, 7);

  // Delete an edge -> 2 incident faces deleted
  const delEdge = deleteSelectedElements(cube, "edge", [], [[topFace.verts[0], topFace.verts[1]]], []);
  assert.equal(delEdge.deletedFaceCount, 2);
  assert.equal(delEdge.mesh.faces.length, 4);

  // Edge loop on a subdivided cube (4-quad ring around Y)
  const loop = selectEdgeLoop(cube, [topFace.verts[0], topFace.verts[1]]);
  assert.equal(loop.length, 4);
});

test("M4-H modeling ops: bevelEdges, bevelVertices, fillOrBridgeSelection, separate & join", () => {
  const cube = convertCuboidToMesh(createDefaultCuboidData([-4, 0, -4], [4, 8, 4]));
  const f0 = cube.faces[0];

  // Bevel one edge of a cube -> valid closed outward mesh with 1 new bevel quad
  const be = bevelEdges(cube, [[f0.verts[0], f0.verts[1]]], 1.5);
  assert.equal(be.bevelFaceIds.length, 1);
  assertClosedOutwardMesh(be.mesh, "bevel-edge");

  // Bevel one vertex of a cube -> valid closed outward mesh with corner cap
  const bv = bevelVertices(cube, [0], 1.5);
  assert.ok(bv.bevelFaceIds.length >= 1);
  assertClosedOutwardMesh(bv.mesh, "bevel-vertex");

  // Fill 3 vertices and bridge 2 edges
  const openMesh = deleteSelectedElements(cube, "face", [], [], [f0.id]).mesh;
  const filledTri = fillOrBridgeSelection(
    openMesh,
    "vertex",
    f0.verts.slice(0, 3),
    [],
    DEFAULT_MODEL3D_MATERIAL_ID
  );
  assert.equal(filledTri.createdFaceIds.length, 1);
  assert.equal(filledTri.mesh.faces.length, openMesh.faces.length + 1);

  const bridged = fillOrBridgeSelection(
    openMesh,
    "edge",
    [],
    [
      [f0.verts[0], f0.verts[1]],
      [f0.verts[3], f0.verts[2]],
    ],
    DEFAULT_MODEL3D_MATERIAL_ID
  );
  assert.equal(bridged.createdFaceIds.length, 1);
  assert.equal(bridged.mesh.faces[bridged.mesh.faces.length - 1].verts.length, 4);

  // Separate & Join with non-zero transform
  const nodeA: ModelNode = {
    id: "nA",
    name: "A",
    kind: "mesh",
    parentId: null,
    visible: true,
    locked: false,
    collider: "none",
    transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1], pivot: [0, 0, 0] },
    mesh: cube,
  };
  const sep = separateSelectedFaces(nodeA, [f0.id], "nA-part");
  assert.ok(sep.separated?.mesh);
  assert.equal(sep.remaining.mesh!.faces.length, 5);
  assert.equal(sep.separated.mesh.faces.length, 1);
  assert.equal(sep.separated.mesh.vertices.length, f0.verts.length);

  const nodeB = makeTestCubeNode("nB", [-2, 0, -2], [2, 4, 2]);
  nodeB.transform.position = [10, 0, 0];
  const joined = joinMeshNodes([nodeA, nodeB], "nA");
  assert.ok(joined?.mesh);
  assert.equal(joined.mesh.faces.length, 12);
  const maxJoinedX = Math.max(...joined.mesh.vertices.map((v) => v[0]));
  assertNear(maxJoinedX, 12);
});

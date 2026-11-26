import test from "node:test";
import assert from "node:assert/strict";

import { Model3DEngine } from "../src/engine/model3d/Model3DEngine.ts";
import {
  vec3Cross,
  vec3Dot,
  vec3Normalize,
  vec3Sub,
} from "../src/engine/model3d/quatMath.ts";
import {
  addOrWeldVertex,
  appendSubMesh,
  applyFloorContactAo,
  buildTileSlopeMesh,
  capturePrefabFromFaces,
  cycleTileCursorPlane,
  dragFillTilePlane,
  ensureStampTargetMeshNode,
  extrudeTileBlockOnMesh,
  flipTileCursor,
  getTileCursorQuadCorners,
  paintFaceCornerColors,
  rotateTileCursorCW,
  stampPrefabOntoMesh,
  stampTileQuadOnMesh,
  stepTileCursor,
} from "../src/engine/model3d/tileStamp.ts";
import type {
  PolyFace,
  PolyMeshData,
  TileCursor3D,
  Vec2,
  Vec3,
} from "../src/engine/model3d/types.ts";

const TILE_UVS: [Vec2, Vec2, Vec2, Vec2] = [
  [0, 16],
  [16, 16],
  [16, 0],
  [0, 0],
];

const ALT_UVS: [Vec2, Vec2, Vec2, Vec2] = [
  [16, 32],
  [32, 32],
  [32, 16],
  [16, 16],
];

function baseCursor(patch?: Partial<TileCursor3D>): TileCursor3D {
  return {
    position: [0, 0, 0],
    plane: "xz",
    stepPx: 16,
    rotation: 0,
    flipX: false,
    flipY: false,
    tilesetId: "ts-main",
    tileUid: "uid-brick",
    cachedTileId: 2,
    ...patch,
  };
}

function faceNormal(mesh: PolyMeshData, face: PolyFace): Vec3 {
  const a = mesh.vertices[face.verts[0]];
  const b = mesh.vertices[face.verts[1]];
  const c = mesh.vertices[face.verts[2]];
  return vec3Normalize(vec3Cross(vec3Sub(b, a), vec3Sub(c, a)));
}

function assertVec3Near(actual: Vec3, expected: Vec3, eps = 1e-4, label = "") {
  for (let i = 0; i < 3; i++) {
    assert.ok(
      Math.abs(actual[i] - expected[i]) <= eps,
      `${label}[${i}]: expected ${expected[i]}, got ${actual[i]}`
    );
  }
}

test("M3-A tileStamp: cursor stepping across xz/xy/zy planes, cycling, rotation & flipping", () => {
  let c = baseCursor();

  // XZ floor plane
  assert.deepEqual(stepTileCursor(c, "right").position, [16, 0, 0]);
  assert.deepEqual(stepTileCursor(c, "left").position, [-16, 0, 0]);
  assert.deepEqual(stepTileCursor(c, "forward").position, [0, 0, -16]);
  assert.deepEqual(stepTileCursor(c, "backward").position, [0, 0, 16]);
  assert.deepEqual(stepTileCursor(c, "up").position, [0, 16, 0]);
  assert.deepEqual(stepTileCursor(c, "down").position, [0, -16, 0]);

  // Plane cycling: xz -> xy -> zy -> xz
  c = cycleTileCursorPlane(c);
  assert.equal(c.plane, "xy");
  assert.deepEqual(stepTileCursor(c, "right").position, [16, 0, 0]);
  assert.deepEqual(stepTileCursor(c, "forward").position, [0, 16, 0]);
  assert.deepEqual(stepTileCursor(c, "up").position, [0, 0, 16]);

  c = cycleTileCursorPlane(c);
  assert.equal(c.plane, "zy");
  assert.deepEqual(stepTileCursor(c, "right").position, [0, 0, 16]);
  assert.deepEqual(stepTileCursor(c, "forward").position, [0, 16, 0]);
  assert.deepEqual(stepTileCursor(c, "up").position, [16, 0, 0]);

  c = cycleTileCursorPlane(c);
  assert.equal(c.plane, "xz");

  // Rotation 0 -> 90 -> 180 -> 270 -> 0
  c = rotateTileCursorCW(c);
  assert.equal(c.rotation, 90);
  c = rotateTileCursorCW(c);
  assert.equal(c.rotation, 180);
  c = rotateTileCursorCW(c);
  assert.equal(c.rotation, 270);
  c = rotateTileCursorCW(c);
  assert.equal(c.rotation, 0);

  // Flip X / Y
  c = flipTileCursor(c, "x");
  assert.equal(c.flipX, true);
  assert.equal(c.flipY, false);
  c = flipTileCursor(c, "y");
  assert.equal(c.flipX, true);
  assert.equal(c.flipY, true);
  c = flipTileCursor(c, "x");
  assert.equal(c.flipX, false);

  // Quad corners CCW normals on all 3 planes
  for (const plane of ["xz", "xy", "zy"] as const) {
    const corners = getTileCursorQuadCorners(baseCursor({ plane }), 16, 16, false);
    const n = vec3Normalize(
      vec3Cross(
        vec3Sub(corners[1], corners[0]),
        vec3Sub(corners[2], corners[0])
      )
    );
    const expectedNormal: Vec3 =
      plane === "xz" ? [0, 1, 0] : plane === "xy" ? [0, 0, 1] : [1, 0, 0];
    assertVec3Near(n, expectedNormal, 1e-5, `normal(${plane})`);

    const flipped = getTileCursorQuadCorners(baseCursor({ plane }), 16, 16, true);
    const nf = vec3Normalize(
      vec3Cross(
        vec3Sub(flipped[1], flipped[0]),
        vec3Sub(flipped[2], flipped[0])
      )
    );
    assertVec3Near(
      nf,
      [-expectedNormal[0], -expectedNormal[1], -expectedNormal[2]],
      1e-5,
      `flippedNormal(${plane})`
    );
  }
});

test("M3-A tileStamp: ensureStampTargetMeshNode, single stamp, coplanar replacement & dragFillTilePlane vertex welding", () => {
  const engine = new Model3DEngine();
  const lockedNode = engine.addNode({
    kind: "mesh",
    name: "Locked",
    locked: true,
  });

  // Locked node is not reused -> creates "Tile Scene"
  const tileNode = ensureStampTargetMeshNode(
    engine,
    "mat-draw-default",
    lockedNode.id
  );
  assert.equal(tileNode.name, "Tile Scene");
  assert.equal(tileNode.kind, "mesh");
  assert.equal(engine.activeNodeId, tileNode.id);

  // Subsequent call with unlocked node reuses it
  const reused = ensureStampTargetMeshNode(
    engine,
    "mat-draw-default",
    tileNode.id
  );
  assert.equal(reused.id, tileNode.id);

  const mesh = tileNode.mesh!;
  const cur1 = baseCursor({ position: [0, 0, 0], tileUid: "uid-grass", cachedTileId: 1 });
  const first = stampTileQuadOnMesh(mesh, cur1, {
    materialId: "mat-draw-default",
    uvs: TILE_UVS,
  });
  assert.equal(first.replaced, false);
  assert.equal(mesh.faces.length, 1);
  assert.equal(mesh.vertices.length, 4);
  assert.equal(mesh.faces[0].tileSource?.tileUid, "uid-grass");

  // Re-stamping same quad (even with flipped winding) replaces in-place without stacking Z-fighting quads
  const cur1Updated = baseCursor({
    position: [0, 0, 0],
    rotation: 90,
    flipX: true,
    tileUid: "uid-stone",
    cachedTileId: 3,
  });
  const second = stampTileQuadOnMesh(mesh, cur1Updated, {
    materialId: "mat-tileset",
    uvs: ALT_UVS,
    flipNormal: true,
  });
  assert.equal(second.replaced, true);
  assert.equal(second.faceId, first.faceId);
  assert.equal(mesh.faces.length, 1);
  assert.equal(mesh.vertices.length, 4);
  assert.equal(mesh.faces[0].materialId, "mat-tileset");
  assert.equal(mesh.faces[0].tileSource?.tileUid, "uid-stone");
  assert.equal(mesh.faces[0].tileSource?.rotation, 90);
  assert.deepEqual(mesh.faces[0].uvs, ALT_UVS);

  // Drag-fill 2x2 grid on fresh mesh -> 9 shared topological vertices and 4 faces!
  const gridMesh: PolyMeshData = { vertices: [], faces: [] };
  const stampedIds = dragFillTilePlane(
    gridMesh,
    baseCursor({ position: [0, 0, 0], stepPx: 16 }),
    [16, 0, 16],
    {
      materialId: "mat-draw-default",
      uvs: TILE_UVS,
      tileWidthPx: 16,
      tileHeightPx: 16,
    }
  );
  assert.equal(stampedIds.length, 4);
  assert.equal(gridMesh.faces.length, 4);
  assert.equal(gridMesh.vertices.length, 9);

  // Welding epsilon check
  const idxDup = addOrWeldVertex(gridMesh, [16.0004, 0, 16]);
  assert.ok(idxDup < 9);
  assert.equal(gridMesh.vertices.length, 9);
});

test("M3-A tileStamp: extrudeTileBlockOnMesh creates outward-facing closed prism", () => {
  const mesh: PolyMeshData = { vertices: [], faces: [] };
  const created = extrudeTileBlockOnMesh(
    mesh,
    baseCursor({ position: [0, 0, 0], plane: "xz", stepPx: 16 }),
    16,
    {
      materialId: "mat-draw-default",
      capUvs: TILE_UVS,
      sideUvs: ALT_UVS,
      includeBottomCap: true,
    }
  );

  // Top + Bottom + 4 sides = 6 faces, 8 welded vertices
  assert.equal(created.length, 6);
  assert.equal(mesh.faces.length, 6);
  assert.equal(mesh.vertices.length, 8);

  const center: Vec3 = [8, 8, 8];
  for (const face of mesh.faces) {
    const n = faceNormal(mesh, face);
    const v0 = mesh.vertices[face.verts[0]];
    const outwardDot = vec3Dot(n, vec3Sub(v0, center));
    assert.ok(outwardDot > 0, `Face ${face.id} normal should point outward`);
  }
});

test("M3-A tileStamp: buildTileSlopeMesh generates all 4 architectural variants with outward CCW normals", () => {
  const kinds = ["slope45", "cornerInner", "cornerOuter", "stair2"] as const;
  const cursor = baseCursor({ position: [0, 0, 0], plane: "xz", stepPx: 16 });

  for (const kind of kinds) {
    const slope = buildTileSlopeMesh(cursor, kind, {
      materialId: "mat-draw-default",
      uvs: TILE_UVS,
      sizePx: [16, 16, 16],
    });

    assert.ok(slope.vertices.length >= 6, `${kind} should have vertices`);
    assert.ok(slope.faces.length >= 5, `${kind} should have faces`);

    // Every vertex should lie cleanly in [0..16, 0..16, 0..16]
    for (const v of slope.vertices) {
      assert.ok(v[0] >= -1e-5 && v[0] <= 16 + 1e-5);
      assert.ok(v[1] >= -1e-5 && v[1] <= 16 + 1e-5);
      assert.ok(v[2] >= -1e-5 && v[2] <= 16 + 1e-5);
    }

    // Verify signed volume > 0 (outward CCW orientation across closed manifold shell)
    let signedVol6 = 0;
    for (const face of slope.faces) {
      assert.ok(face.tileSource, `${kind} face should retain tileSource`);
      assert.equal(face.uvs.length, face.verts.length);
      const tris: Array<[number, number, number]> =
        face.verts.length === 4
          ? [
              [face.verts[0], face.verts[1], face.verts[2]],
              [face.verts[0], face.verts[2], face.verts[3]],
            ]
          : [[face.verts[0], face.verts[1], face.verts[2]]];
      for (const [ia, ib, ic] of tris) {
        const a = slope.vertices[ia];
        const b = slope.vertices[ib];
        const c = slope.vertices[ic];
        signedVol6 += vec3Dot(a, vec3Cross(b, c));
      }
    }
    assert.ok(
      signedVol6 > 0,
      `${kind} closed mesh should have positive signed volume (outward CCW), got ${signedVol6}`
    );
  }

  // Test appendSubMesh with offset & welding
  const target: PolyMeshData = { vertices: [], faces: [] };
  const s1 = buildTileSlopeMesh(cursor, "slope45", {
    materialId: "mat-draw-default",
    uvs: TILE_UVS,
  });
  const appended1 = appendSubMesh(target, s1, [0, 0, 0], true);
  const appended2 = appendSubMesh(target, s1, [16, 0, 0], true);
  assert.equal(appended1.length, 5);
  assert.equal(appended2.length, 5);
  assert.equal(target.faces.length, 10);
  // Adjacent slope shares 3 edge vertices -> 6 + 6 - 3 = 9 vertices
  assert.equal(target.vertices.length, 9);
});

test("M3-A tileStamp: capturePrefabFromFaces & stampPrefabOntoMesh (with 90° Y rotation)", () => {
  const source: PolyMeshData = { vertices: [], faces: [] };
  const created = extrudeTileBlockOnMesh(
    source,
    baseCursor({ position: [32, 16, 48], stepPx: 16 }),
    8,
    {
      materialId: "mat-draw-default",
      capUvs: TILE_UVS,
      includeBottomCap: true,
    }
  );

  const prefab = capturePrefabFromFaces(source, created, "CrateHalf");
  assert.ok(prefab);
  assert.equal(prefab.name, "CrateHalf");
  assertVec3Near(prefab.sizePx, [16, 8, 16]);

  // Min bounds normalized to [0, 0, 0]
  let minX = Infinity;
  let minY = Infinity;
  let minZ = Infinity;
  for (const v of prefab.mesh.vertices) {
    if (v[0] < minX) minX = v[0];
    if (v[1] < minY) minY = v[1];
    if (v[2] < minZ) minZ = v[2];
  }
  assertVec3Near([minX, minY, minZ], [0, 0, 0]);

  // Empty selection returns null
  assert.equal(capturePrefabFromFaces(source, ["nonexistent"], "Empty"), null);

  // Stamp rotated 90° around Y at [100, 0, 100]: [16, 0, 0] -> [100, 0, 84]
  const scene: PolyMeshData = { vertices: [], faces: [] };
  const stamped = stampPrefabOntoMesh(scene, prefab, [100, 0, 100], 90, true);
  assert.equal(stamped.length, 6);
  assert.equal(scene.faces.length, 6);
  const hasRotatedCorner = scene.vertices.some(
    (v) =>
      Math.abs(v[0] - 100) < 1e-4 &&
      Math.abs(v[1] - 0) < 1e-4 &&
      Math.abs(v[2] - 84) < 1e-4
  );
  assert.equal(hasRotatedCorner, true);
});

test("M3-A tileStamp: paintFaceCornerColors & applyFloorContactAo", () => {
  const mesh: PolyMeshData = { vertices: [], faces: [] };
  extrudeTileBlockOnMesh(
    mesh,
    baseCursor({ position: [0, 0, 0], stepPx: 16 }),
    16,
    {
      materialId: "mat-draw-default",
      capUvs: TILE_UVS,
      includeBottomCap: true,
    }
  );

  // Single corner paint initializes other corners to #ffffff
  const firstFaceId = mesh.faces[0].id;
  assert.equal(paintFaceCornerColors(mesh, firstFaceId, "#ff4422", 2), true);
  assert.deepEqual(mesh.faces[0].colors, [
    "#ffffff",
    "#ffffff",
    "#ff4422",
    "#ffffff",
  ]);

  // Out-of-bounds corner or missing face returns false
  assert.equal(paintFaceCornerColors(mesh, firstFaceId, "#000000", 9), false);
  assert.equal(paintFaceCornerColors(mesh, "missing-face", "#000000"), false);

  // Paint all corners
  assert.equal(paintFaceCornerColors(mesh, firstFaceId, "#abcdef"), true);
  assert.deepEqual(mesh.faces[0].colors, [
    "#abcdef",
    "#abcdef",
    "#abcdef",
    "#abcdef",
  ]);

  // Apply floor contact AO at y <= 0.01
  const updatedCount = applyFloorContactAo(mesh, 0, "#7a7a88", "#ffffff");
  assert.equal(updatedCount, 6);

  const topFace = mesh.faces[0];
  assert.deepEqual(topFace.colors, ["#ffffff", "#ffffff", "#ffffff", "#ffffff"]);

  const bottomFace = mesh.faces[1];
  assert.deepEqual(bottomFace.colors, ["#7a7a88", "#7a7a88", "#7a7a88", "#7a7a88"]);

  // Side face has 2 bottom corners (shadow) and 2 top corners (base)
  const sideFace = mesh.faces[2];
  assert.deepEqual(sideFace.colors, ["#7a7a88", "#7a7a88", "#ffffff", "#ffffff"]);
});

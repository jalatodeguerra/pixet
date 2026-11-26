import test from "node:test";
import assert from "node:assert/strict";

import { PixelBuffer } from "../src/engine/document/PixelBuffer.ts";
import {
  createDefaultCuboidData,
  Model3DEngine,
} from "../src/engine/model3d/Model3DEngine.ts";
import {
  buildPaddedTilesetAtlas,
  getTileQuadPixelUvs,
  resolveTileEntry,
} from "../src/engine/model3d/tilesetAtlas.ts";
import type { CuboidFaceName, ModelNode, Vec2 } from "../src/engine/model3d/types.ts";
import {
  autoPackModelUvs,
  computeBoxUvFaces,
  cuboidFaceUvToCorners,
  normalizedUvToPixel,
  pixelUvToNormalized,
  rasterizeUvGuideToBuffer,
  resizeCuboidWithUvLock,
  transformFaceCornerUvs,
} from "../src/engine/model3d/uvOps.ts";
import { Tileset } from "../src/engine/tiles/Tileset.ts";

function assertNear(actual: number, expected: number, eps = 1e-6) {
  assert.ok(
    Math.abs(actual - expected) <= eps,
    `expected ${expected} ± ${eps}, got ${actual}`
  );
}

test("M2-A uvOps: computeBoxUvFaces standard Blockbench cross layout & mirrorX", () => {
  // dx = 4, dy = 8, dz = 2, origin = [10, 20]
  const faces = computeBoxUvFaces(
    [0, 0, 0],
    [4, 8, 2],
    [10, 20],
    "mat-1",
    false,
    {
      down: {
        uv: [0, 0, 1, 1],
        rotation: 0,
        materialId: "mat-1",
        hidden: true,
      },
    }
  );

  assert.deepEqual(faces.up.uv, [12, 20, 16, 22]);
  assert.deepEqual(faces.down.uv, [16, 20, 20, 22]);
  assert.equal(faces.down.hidden, true);
  assert.deepEqual(faces.west.uv, [10, 22, 12, 30]);
  assert.deepEqual(faces.north.uv, [12, 22, 16, 30]);
  assert.deepEqual(faces.east.uv, [16, 22, 18, 30]);
  assert.deepEqual(faces.south.uv, [18, 22, 22, 30]);
  assert.equal(faces.north.flipX, undefined);

  const mirrored = computeBoxUvFaces([0, 0, 0], [4, 8, 2], [10, 20], "mat-1", true);
  assert.deepEqual(mirrored.west.uv, faces.east.uv);
  assert.deepEqual(mirrored.east.uv, faces.west.uv);
  assert.deepEqual(mirrored.north.uv, faces.north.uv);
  assert.equal(mirrored.north.flipX, true);
  assert.equal(mirrored.east.flipX, true);
  assert.equal(mirrored.west.flipX, true);
});

test("M2-A uvOps: resizeCuboidWithUvLock respects uvLock and uvMode", () => {
  const base = createDefaultCuboidData([0, 0, 0], [4, 4, 4], "mat-a");
  base.boxUvOrigin = [4, 4];
  base.faces = computeBoxUvFaces(base.from, base.to, base.boxUvOrigin, "mat-a");
  base.faces.south.hidden = true;

  // uvLock = false, uvMode = "box" -> recomputes UVs while preserving hidden & materialId
  base.uvLock = false;
  const resizedAuto = resizeCuboidWithUvLock(base, [0, 0, 0], [8, 6, 4]);
  assert.deepEqual(resizedAuto.from, [0, 0, 0]);
  assert.deepEqual(resizedAuto.to, [8, 6, 4]);
  assert.deepEqual(resizedAuto.faces.north.uv, [8, 8, 16, 14]);
  assert.equal(resizedAuto.faces.south.hidden, true);

  // uvLock = true -> keeps original UV rects pinned
  base.uvLock = true;
  const resizedLocked = resizeCuboidWithUvLock(base, [0, 0, 0], [10, 12, 6]);
  assert.deepEqual(resizedLocked.from, [0, 0, 0]);
  assert.deepEqual(resizedLocked.to, [10, 12, 6]);
  assert.deepEqual(resizedLocked.faces.north.uv, base.faces.north.uv);
  assert.deepEqual(resizedLocked.faces.east.uv, base.faces.east.uv);

  // uvLock = false, uvMode = "per-face" -> keeps per-face UV rects pinned
  base.uvLock = false;
  base.uvMode = "per-face";
  const resizedPerFace = resizeCuboidWithUvLock(base, [0, 0, 0], [12, 12, 12]);
  assert.deepEqual(resizedPerFace.faces.north.uv, base.faces.north.uv);
});

test("M2-A uvOps: cuboidFaceUvToCorners & transformFaceCornerUvs", () => {
  const corners0 = cuboidFaceUvToCorners({
    uv: [2, 4, 6, 12],
    rotation: 0,
    materialId: "mat-1",
  });
  // [bottomLeft, bottomRight, topRight, topLeft]
  assert.deepEqual(corners0, [
    [2, 12],
    [6, 12],
    [6, 4],
    [2, 4],
  ]);

  const corners90 = cuboidFaceUvToCorners({
    uv: [2, 4, 6, 12],
    rotation: 90,
    materialId: "mat-1",
  });
  assert.deepEqual(corners90, [
    [6, 12],
    [6, 4],
    [2, 4],
    [2, 12],
  ]);

  const flippedX = transformFaceCornerUvs(corners0, 0, true, false);
  assert.deepEqual(flippedX, [
    [6, 12],
    [2, 12],
    [2, 4],
    [6, 4],
  ]);

  const tri: Vec2[] = [
    [0, 0],
    [4, 0],
    [2, 4],
  ];
  const triRot90 = transformFaceCornerUvs(tri, 90, false, false);
  assert.deepEqual(triRot90, [
    [0, 4],
    [0, 0],
    [4, 2],
  ]);
});

test("M2-A uvOps: pixelUvToNormalized <-> normalizedUvToPixel & micro-inset direction", () => {
  const texW = 32;
  const texH = 16;

  // Center of pixel (5, 3) is (5.5, 3.5)
  const [u, v] = pixelUvToNormalized(5.5, 3.5, texW, texH);
  assertNear(u, 5.5 / 32);
  assertNear(v, 1 - 3.5 / 16);
  assert.deepEqual(normalizedUvToPixel(u, v, texW, texH), [5, 3]);

  // Boundary clamping
  assert.deepEqual(normalizedUvToPixel(-0.5, 2.0, texW, texH), [0, 0]);
  assert.deepEqual(normalizedUvToPixel(1.5, -1.0, texW, texH), [31, 15]);

  // Micro-inset nudges strictly inward toward centroidPx
  const centroid: Vec2 = [12, 8];
  const [uInset, vInset] = pixelUvToNormalized(4, 4, texW, texH, centroid, 1e-4);
  const nudgedPxX = uInset * texW;
  const nudgedPxY = (1 - vInset) * texH;
  assert.ok(nudgedPxX > 4 && nudgedPxX < 4 + 1e-4);
  assert.ok(nudgedPxY > 4 && nudgedPxY < 4 + 1e-4);
});

test("M2-A uvOps: autoPackModelUvs deterministic shelf packing & overflow", () => {
  const engine = new Model3DEngine();
  const c1 = engine.addNode({
    kind: "cuboid",
    name: "Small",
    cuboid: createDefaultCuboidData([0, 0, 0], [2, 2, 2]),
  });
  const c2 = engine.addNode({
    kind: "cuboid",
    name: "Tall",
    cuboid: createDefaultCuboidData([0, 0, 0], [4, 8, 2]),
  });
  const m1 = engine.addNode({
    kind: "mesh",
    name: "Quad",
    mesh: {
      vertices: [
        [0, 0, 0],
        [6, 0, 0],
        [6, 6, 0],
        [0, 6, 0],
      ],
      faces: [
        {
          id: "q1",
          verts: [0, 1, 2, 3],
          uvs: [
            [10, 10],
            [16, 10],
            [16, 16],
            [10, 16],
          ],
          materialId: "mat-draw-default",
        },
      ],
    },
  });

  assert.ok(c1 && c2 && m1);
  const packed = autoPackModelUvs(engine.nodes, 32, 32, 1);
  assert.equal(packed.packedCount, 3);
  assert.equal(packed.overflowCount, 0);

  // Collect packed footprint bounding rects and assert zero overlap and >=1px padding
  const rects: Array<{ x0: number; y0: number; x1: number; y1: number }> = [];
  for (const node of packed.nodes) {
    if (node.cuboid) {
      const dx = Math.abs(node.cuboid.to[0] - node.cuboid.from[0]);
      const dy = Math.abs(node.cuboid.to[1] - node.cuboid.from[1]);
      const dz = Math.abs(node.cuboid.to[2] - node.cuboid.from[2]);
      const [ox, oy] = node.cuboid.boxUvOrigin;
      rects.push({ x0: ox, y0: oy, x1: ox + 2 * dz + 2 * dx, y1: oy + dz + dy });
    } else if (node.mesh) {
      const f = node.mesh.faces[0];
      const us = f.uvs.map(([u]) => u);
      const vs = f.uvs.map(([, v]) => v);
      rects.push({
        x0: Math.min(...us),
        y0: Math.min(...vs),
        x1: Math.max(...us),
        y1: Math.max(...vs),
      });
    }
  }

  for (let i = 0; i < rects.length; i++) {
    const a = rects[i];
    assert.ok(a.x0 >= 0 && a.y0 >= 0 && a.x1 <= 32 && a.y1 <= 32);
    for (let j = i + 1; j < rects.length; j++) {
      const b = rects[j];
      const separated =
        a.x1 + 1 <= b.x0 || b.x1 + 1 <= a.x0 || a.y1 + 1 <= b.y0 || b.y1 + 1 <= a.y0;
      assert.ok(separated, `Rects ${i} and ${j} overlap or lack 1px padding`);
    }
  }

  // Overflow detection on tiny 8x8 canvas
  const tiny = autoPackModelUvs(engine.nodes, 8, 8, 1);
  assert.ok(tiny.overflowCount >= 1);
});

test("M2-A uvOps: rasterizeUvGuideToBuffer renders cuboid & mesh UV islands", () => {
  const cuboid = createDefaultCuboidData([0, 0, 0], [4, 4, 4]);
  cuboid.faces = computeBoxUvFaces(cuboid.from, cuboid.to, [0, 0], "mat-draw-default");
  // Hide all faces except north ([4, 4, 8, 8]) to check exact pixel placement
  for (const name of ["south", "east", "west", "up", "down"] as CuboidFaceName[]) {
    cuboid.faces[name].hidden = true;
  }

  const nodes: ModelNode[] = [
    {
      id: "n1",
      name: "Box",
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
    },
  ];

  const guide = rasterizeUvGuideToBuffer(nodes, 16, 16);
  // Outside north rect should remain transparent
  assert.deepEqual(guide.getPixel(0, 0), [0, 0, 0, 0]);
  // Border pixel (4, 4) should have opaque border alpha 235
  assert.equal(guide.getPixel(4, 4)[3], 235);
  // Interior pixel (5, 5) should have translucent fill alpha 80
  assert.equal(guide.getPixel(5, 5)[3], 80);
});

test("M2-A tilesetAtlas: 1px border + 4 corners extrusion, tileUid remap resilience, and animations", () => {
  // Empty tileset still returns valid minimal atlas
  const emptyTs = new Tileset("ts-empty", "Empty", 8, 8);
  const emptyAtlas = buildPaddedTilesetAtlas(emptyTs);
  assert.equal(emptyAtlas.width, 10);
  assert.equal(emptyAtlas.height, 10);
  assert.equal(emptyAtlas.byUid.size, 0);

  const ts = new Tileset("ts-main", "Dungeon", 4, 4);
  const makeSolidTile = (r: number, g: number, b: number) => {
    const buf = new PixelBuffer(4, 4);
    for (let y = 0; y < 4; y++) {
      for (let x = 0; x < 4; x++) {
        // Distinct corners & edges to verify directional extrusion
        buf.setPixel(x, y, Math.min(255, r + x * 10), Math.min(255, g + y * 10), b, 255);
      }
    }
    return buf;
  };

  const id1 = ts.addTile(makeSolidTile(20, 40, 100), { name: "Tile1" });
  const id2 = ts.addTile(makeSolidTile(120, 30, 60), { name: "Tile2" });
  const id3 = ts.addTile(makeSolidTile(40, 140, 80), { name: "Tile3" });

  const uid2 = ts.getMeta(id2)!.uid;
  const uid3 = ts.getMeta(id3)!.uid;

  // Verify 1px extruded edges & 4 corners on tile 1
  const atlas1 = buildPaddedTilesetAtlas(ts);
  const entry1 = atlas1.byTileId.get(id1)!;
  assert.equal(entry1.innerX, 1);
  assert.equal(entry1.innerY, 1);
  assert.equal(entry1.width, 4);
  assert.equal(entry1.height, 4);

  const tile1Buf = ts.getTile(id1)!;
  // Top-left corner
  assert.deepEqual(
    atlas1.buffer.getPixel(entry1.innerX - 1, entry1.innerY - 1),
    tile1Buf.getPixel(0, 0)
  );
  // Top-right corner
  assert.deepEqual(
    atlas1.buffer.getPixel(entry1.innerX + 4, entry1.innerY - 1),
    tile1Buf.getPixel(3, 0)
  );
  // Bottom-left corner
  assert.deepEqual(
    atlas1.buffer.getPixel(entry1.innerX - 1, entry1.innerY + 4),
    tile1Buf.getPixel(0, 3)
  );
  // Bottom-right corner
  assert.deepEqual(
    atlas1.buffer.getPixel(entry1.innerX + 4, entry1.innerY + 4),
    tile1Buf.getPixel(3, 3)
  );
  // Top & bottom middle edges
  assert.deepEqual(
    atlas1.buffer.getPixel(entry1.innerX + 2, entry1.innerY - 1),
    tile1Buf.getPixel(2, 0)
  );
  assert.deepEqual(
    atlas1.buffer.getPixel(entry1.innerX + 2, entry1.innerY + 4),
    tile1Buf.getPixel(2, 3)
  );
  // Left & right middle edges
  assert.deepEqual(
    atlas1.buffer.getPixel(entry1.innerX - 1, entry1.innerY + 1),
    tile1Buf.getPixel(0, 1)
  );
  assert.deepEqual(
    atlas1.buffer.getPixel(entry1.innerX + 4, entry1.innerY + 1),
    tile1Buf.getPixel(3, 1)
  );

  // Set animation on tile 2: 100ms frame -> id2, 200ms frame -> id3
  ts.setMeta(id2, {
    animation: {
      frames: [
        { localId: id2, durationMs: 100 },
        { localId: id3, durationMs: 200 },
      ],
    },
  });

  // Delete tile 1 and reorder remaining tiles (id2 becomes 1, id3 becomes 2, then swap -> id3=1, id2=2)
  ts.deleteTileWithRemap(id1);
  ts.reorderTiles([2, 1]);

  const atlasAfterRemap = buildPaddedTilesetAtlas(ts);
  // Stale cachedTileId (e.g. 99) still resolves accurately via persistent tileUid!
  const resolvedBase = resolveTileEntry(atlasAfterRemap, ts, uid2, 99);
  assert.ok(resolvedBase);
  assert.equal(resolvedBase.uid, uid2);

  // At t=50ms -> first animation frame (uid2)
  const frameAt50 = resolveTileEntry(atlasAfterRemap, ts, uid2, 99, 50);
  assert.equal(frameAt50?.uid, uid2);

  // At t=150ms -> second animation frame (uid3)
  const frameAt150 = resolveTileEntry(atlasAfterRemap, ts, uid2, 99, 150);
  assert.equal(frameAt150?.uid, uid3);

  // At t=350ms (wraps 300ms loop -> 50ms) -> back to uid2
  const frameAt350 = resolveTileEntry(atlasAfterRemap, ts, uid2, 99, 350);
  assert.equal(frameAt350?.uid, uid2);

  // getTileQuadPixelUvs returns transformed inner coordinates for active frame
  const entryUid3 = atlasAfterRemap.byUid.get(uid3)!;
  const quad150 = getTileQuadPixelUvs(
    atlasAfterRemap,
    ts,
    uid2,
    99,
    0,
    false,
    false,
    150
  );
  assert.deepEqual(quad150, [
    [entryUid3.innerX, entryUid3.innerY + 4],
    [entryUid3.innerX + 4, entryUid3.innerY + 4],
    [entryUid3.innerX + 4, entryUid3.innerY],
    [entryUid3.innerX, entryUid3.innerY],
  ]);

  const quadRotated90 = getTileQuadPixelUvs(
    atlasAfterRemap,
    ts,
    uid2,
    99,
    90,
    true,
    false,
    50
  );
  assert.equal(quadRotated90.length, 4);
  assert.deepEqual(quadRotated90[0], [resolvedBase.innerX, resolvedBase.innerY + 4]);
});

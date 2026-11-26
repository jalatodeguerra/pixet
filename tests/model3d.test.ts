import test from "node:test";
import assert from "node:assert/strict";

import {
  jumpToHistoryIndexAction,
  performRedo,
  performUndo,
} from "../src/engine/document/historyActions.ts";
import { pixelEngine } from "../src/engine/document/PixelEngine.ts";
import { mutateModel3D } from "../src/engine/model3d/model3dActions.ts";
import { Model3DEngine } from "../src/engine/model3d/Model3DEngine.ts";
import { Model3DHistory } from "../src/engine/model3d/Model3DHistory.ts";
import {
  eulerDegToQuat,
  quatMultiply,
  quatNormalize,
  quatRotateVec3,
  quatSlerp,
  quatToEulerDeg,
  snapToGrid,
  vec3Add,
  vec3Cross,
  vec3Dot,
  vec3Length,
  vec3Normalize,
  vec3Scale,
  vec3Sub,
} from "../src/engine/model3d/quatMath.ts";
import {
  deserializeModel3DScene,
  serializeModel3DScene,
} from "../src/engine/model3d/serialization.ts";
import { useEditorStore } from "../src/store/editorStore.ts";

function assertNear(actual: number, expected: number, eps = 1e-4, msg?: string) {
  assert.ok(
    Math.abs(actual - expected) <= eps,
    `${msg ? msg + ": " : ""}expected ${expected} ± ${eps}, got ${actual}`
  );
}

test("M0 quatMath: vectors, Euler<->Quat round-trip, 90° rotations, SLERP & snapToGrid", () => {
  assert.deepEqual(vec3Add([1, 2, 3], [4, -1, 2]), [5, 1, 5]);
  assert.deepEqual(vec3Sub([5, 1, 5], [1, 2, 3]), [4, -1, 2]);
  assert.deepEqual(vec3Scale([1, -2, 3], 2), [2, -4, 6]);
  assert.equal(vec3Dot([1, 2, 3], [4, -5, 6]), 12);
  assert.deepEqual(vec3Cross([1, 0, 0], [0, 1, 0]), [0, 0, 1]);
  assertNear(vec3Length([3, 4, 0]), 5);
  assert.deepEqual(vec3Normalize([0, 0, 0]), [0, 0, 0]);
  assertNear(vec3Length(vec3Normalize([3, 4, 12])), 1);

  assert.equal(snapToGrid(3.6, 1), 4);
  assert.equal(snapToGrid(0.37, 0.25), 0.25);
  assert.equal(snapToGrid(0.38, 0.25), 0.5);
  assert.equal(snapToGrid(-0.1, 0.5), 0);

  // Identity
  const qId = eulerDegToQuat([0, 0, 0]);
  assertNear(qId[0], 0);
  assertNear(qId[1], 0);
  assertNear(qId[2], 0);
  assertNear(qId[3], 1);

  // 90° Y rotation maps +X -> -Z
  const qY90 = eulerDegToQuat([0, 90, 0]);
  const rotatedX = quatRotateVec3(qY90, [1, 0, 0]);
  assertNear(rotatedX[0], 0);
  assertNear(rotatedX[1], 0);
  assertNear(rotatedX[2], -1);

  // 90° Z rotation maps +X -> +Y
  const qZ90 = eulerDegToQuat([0, 0, 90]);
  const rotatedZ = quatRotateVec3(qZ90, [1, 0, 0]);
  assertNear(rotatedZ[0], 0);
  assertNear(rotatedZ[1], 1);
  assertNear(rotatedZ[2], 0);

  // Euler <-> Quat round-trip
  const euler: [number, number, number] = [25, -40, 65];
  const q = eulerDegToQuat(euler);
  const back = quatToEulerDeg(q);
  assertNear(back[0], euler[0], 1e-3);
  assertNear(back[1], euler[1], 1e-3);
  assertNear(back[2], euler[2], 1e-3);

  // Quaternion multiply: two 90° Y rotations = 180° Y rotation
  const qY180 = quatNormalize(quatMultiply(qY90, qY90));
  const v180 = quatRotateVec3(qY180, [1, 0, 0]);
  assertNear(v180[0], -1);
  assertNear(v180[2], 0);

  // SLERP midpoint between 0° and 90° Y = 45° Y
  const qMid = quatSlerp(qId, qY90, 0.5);
  const eulerMid = quatToEulerDeg(qMid);
  assertNear(eulerMid[1], 45, 1e-3);

  // SLERP shortest-path check when dot < 0 (negated hemisphere quaternion)
  const qY90Neg: [number, number, number, number] = [
    -qY90[0],
    -qY90[1],
    -qY90[2],
    -qY90[3],
  ];
  const qMidNeg = quatSlerp(qId, qY90Neg, 0.5);
  const eulerMidNeg = quatToEulerDeg(qMidNeg);
  assertNear(eulerMidNeg[1], 45, 1e-3);
});

test("M0 Model3DEngine: CRUD, subtree delete, duplicate remapping, reparent cycle guard, materials & tileCursor", () => {
  const engine = new Model3DEngine();
  assert.equal(engine.pixelsPerUnit, 16);
  assert.equal(engine.materials.length, 1);
  assert.equal(engine.materials[0].id, "mat-draw-default");

  const root = engine.addGroup({ name: "Root" });
  const torso = engine.addNode({
    kind: "cuboid",
    name: "Torso",
    parentId: root.id,
    collider: "box",
  });
  const head = engine.addNode({
    kind: "cuboid",
    name: "Head",
    parentId: torso.id,
  });

  // Cycle guard: cannot reparent root under its descendant head, or self
  assert.equal(engine.reparentNode(root.id, head.id), false);
  assert.equal(engine.reparentNode(root.id, root.id), false);
  assert.equal(engine.getNode(root.id)?.parentId, null);

  // Valid reparent: head under root
  assert.equal(engine.reparentNode(head.id, root.id), true);
  assert.equal(engine.getNode(head.id)?.parentId, root.id);

  // Duplicate subtree (root -> torso, head) remaps IDs & internal parent links
  const duped = engine.duplicateNodes([root.id]);
  assert.equal(duped.length, 3);
  const dupRoot = duped[0];
  const dupTorso = duped[1];
  const dupHead = duped[2];
  assert.notEqual(dupRoot.id, root.id);
  assert.equal(dupRoot.parentId, null);
  assert.equal(dupTorso.parentId, dupRoot.id);
  assert.equal(dupHead.parentId, dupRoot.id);

  // Delete original root removes entire subtree
  const deleted = engine.deleteNodes([root.id]);
  assert.equal(deleted.length, 3);
  assert.equal(engine.nodes.length, 3);

  // Material CRUD + fallback reassignment
  const tileMat = engine.addMaterial({
    name: "Tiles",
    source: { kind: "tileset", tilesetId: "ts-1" },
    doubleSided: true,
    alphaTest: 0.5,
    usePbrMaps: false,
  });
  assert.equal(engine.materials.length, 2);
  engine.updateNode(dupTorso.id, {
    cuboid: {
      ...dupTorso.cuboid!,
      faces: {
        ...dupTorso.cuboid!.faces,
        north: { ...dupTorso.cuboid!.faces.north, materialId: tileMat.id },
      },
    },
  });
  assert.equal(engine.removeMaterial(tileMat.id), true);
  assert.equal(
    engine.getNode(dupTorso.id)?.cuboid?.faces.north.materialId,
    "mat-draw-default"
  );
  // Cannot delete the last remaining material
  assert.equal(engine.removeMaterial("mat-draw-default"), false);

  // Tile cursor patching
  engine.patchTileCursor({
    position: [16, 0, 32],
    plane: "xy",
    rotation: 90,
    tileUid: "uid-42",
  });
  assert.deepEqual(engine.tileCursor.position, [16, 0, 32]);
  assert.equal(engine.tileCursor.plane, "xy");
  assert.equal(engine.tileCursor.rotation, 90);
  assert.equal(engine.tileCursor.tileUid, "uid-42");
});

test("M0 serialization: round-trip & defensive fallback on corrupt input", () => {
  const engine = new Model3DEngine();
  engine.setPixelsPerUnit(32);
  const grp = engine.addGroup({ name: "Props" });
  engine.addNode({
    kind: "mesh",
    name: "Ramp",
    parentId: grp.id,
    collider: "convex",
    mesh: {
      vertices: [
        [0, 0, 0],
        [16, 0, 0],
        [16, 16, 16],
        [0, 16, 16],
      ],
      faces: [
        {
          id: "f1",
          verts: [0, 1, 2, 3],
          uvs: [
            [0, 0],
            [16, 0],
            [16, 16],
            [0, 16],
          ],
          triSplit: "13",
          flatShading: true,
          materialId: "mat-draw-default",
          tileSource: {
            tilesetId: "ts-main",
            tileUid: "tile-abc",
            cachedTileId: 3,
            rotation: 180,
            flipX: true,
            flipY: false,
          },
        },
      ],
    },
  });
  engine.prefabs.push({
    id: "prefab-1",
    name: "Crate",
    sizePx: [16, 16, 16],
    mesh: { vertices: [[0, 0, 0]], faces: [] },
  });
  engine.clips.push({
    id: "clip-idle",
    name: "Idle",
    frameCount: 8,
    fps: 12,
    loop: true,
    keyframes: [
      {
        frame: 0,
        nodeId: grp.id,
        property: "rotY",
        value: 45,
        easing: "easeInOut",
      },
    ],
  });
  engine.activeClipId = "clip-idle";
  engine.patchTileCursor({ position: [8, 16, 24], tileUid: "tile-abc" });

  const encoded = serializeModel3DScene(engine.toSnapshot());
  const roundTripped = deserializeModel3DScene(
    JSON.parse(JSON.stringify(encoded))
  );

  assert.equal(roundTripped.version, 1);
  assert.equal(roundTripped.pixelsPerUnit, 32);
  assert.equal(roundTripped.nodes.length, 2);
  assert.equal(roundTripped.nodes[1].collider, "convex");
  assert.equal(roundTripped.nodes[1].mesh?.faces[0].tileSource?.tileUid, "tile-abc");
  assert.equal(roundTripped.prefabs.length, 1);
  assert.equal(roundTripped.clips.length, 1);
  assert.equal(roundTripped.clips[0].keyframes[0].value, 45);
  assert.equal(roundTripped.activeClipId, "clip-idle");
  assert.deepEqual(roundTripped.tileCursor.position, [8, 16, 24]);

  // Corrupt inputs must fall back cleanly without throwing
  for (const corrupt of [
    null,
    undefined,
    42,
    "bad",
    [],
    {
      version: 999,
      pixelsPerUnit: -10,
      nodes: [null, { id: "bad-node", kind: "unknown" }],
      materials: "not-an-array",
      clips: [{ keyframes: [{ property: "badProp" }] }],
    },
  ]) {
    const safe = deserializeModel3DScene(corrupt);
    assert.equal(safe.version, 1);
    assert.ok(safe.pixelsPerUnit >= 1);
    assert.ok(safe.materials.length >= 1);
  }
});

test("M0 Model3DHistory + interleaved UndoCoordinator chronological undo/redo", () => {
  // Unit test standalone Model3DHistory
  const standalone = new Model3DEngine();
  const history = new Model3DHistory();
  const snap0 = history.captureSnapshot(standalone);
  standalone.addNode({ kind: "cuboid", name: "Box1" });
  history.pushUndo(snap0, "Add Box1");
  assert.equal(standalone.nodes.length, 1);
  assert.equal(history.undo(standalone), "Add Box1");
  assert.equal(standalone.nodes.length, 0);
  assert.equal(history.redo(standalone), "Add Box1");
  assert.equal(standalone.nodes.length, 1);

  // Interleaved PixelEngine pixel edit -> Model3D edit -> PixelEngine pixel edit
  pixelEngine.resetForDocument(16, 16);
  useEditorStore.getState().loadProjectState({
    documentName: "interleave.pixet",
    filePath: null,
    canvasWidth: 16,
    canvasHeight: 16,
    colorMode: "RGBA",
    paletteName: "Test",
    palette: ["#000000", "#ffffff"],
    layers: [
      {
        id: "layer-1",
        name: "Layer 1",
        kind: "raster",
        visible: true,
        locked: false,
        opacity: 100,
        alphaLock: false,
        blendMode: "Normal",
        parentId: null,
        cels: {},
      },
    ],
    frames: [{ id: "frame-1", index: 0, durationMs: 100 }],
    tags: [],
  });

  // Step 1: Pixel edit #1
  const cel1 = pixelEngine.getOrCreateCel("layer-1", 0);
  pixelEngine.history.beginTransaction("layer-1", 0, "Paint Red");
  pixelEngine.history.capturePixelTile(cel1, 2, 2);
  cel1.setPixel(2, 2, 255, 0, 0, 255);
  pixelEngine.history.commitTransaction(cel1);

  // Step 2: Model3D edit
  mutateModel3D("Add Cuboid", (eng) => {
    eng.addNode({ kind: "cuboid", name: "HeroCube" });
  });

  // Step 3: Pixel edit #2
  pixelEngine.history.beginTransaction("layer-1", 0, "Paint Blue");
  pixelEngine.history.capturePixelTile(cel1, 4, 4);
  cel1.setPixel(4, 4, 0, 0, 255, 255);
  pixelEngine.history.commitTransaction(cel1);

  assert.deepEqual(
    pixelEngine.undoCoordinator.getHistoryEntries().map((e) => e.kind),
    ["pixels", "model3d", "pixels"]
  );
  assert.equal(pixelEngine.model3d.nodes.length, 1);
  assert.deepEqual(cel1.getPixel(2, 2), [255, 0, 0, 255]);
  assert.deepEqual(cel1.getPixel(4, 4), [0, 0, 255, 255]);

  // Undo 1 -> reverts Pixel edit #2 (Model3D intact)
  performUndo();
  assert.deepEqual(pixelEngine.getOrCreateCel("layer-1", 0).getPixel(4, 4), [0, 0, 0, 0]);
  assert.equal(pixelEngine.model3d.nodes.length, 1);
  assert.deepEqual(pixelEngine.getOrCreateCel("layer-1", 0).getPixel(2, 2), [255, 0, 0, 255]);

  // Undo 2 -> reverts Model3D edit (Pixel edit #1 intact)
  performUndo();
  assert.equal(pixelEngine.model3d.nodes.length, 0);
  assert.deepEqual(pixelEngine.getOrCreateCel("layer-1", 0).getPixel(2, 2), [255, 0, 0, 255]);

  // Undo 3 -> reverts Pixel edit #1
  performUndo();
  assert.deepEqual(pixelEngine.getOrCreateCel("layer-1", 0).getPixel(2, 2), [0, 0, 0, 0]);
  assert.equal(pixelEngine.model3d.nodes.length, 0);

  // Redo 1 -> restores Pixel edit #1
  performRedo();
  assert.deepEqual(pixelEngine.getOrCreateCel("layer-1", 0).getPixel(2, 2), [255, 0, 0, 255]);
  assert.equal(pixelEngine.model3d.nodes.length, 0);

  // Redo 2 -> restores Model3D edit
  performRedo();
  assert.equal(pixelEngine.model3d.nodes.length, 1);
  assert.equal(pixelEngine.model3d.nodes[0].name, "HeroCube");
  assert.deepEqual(pixelEngine.getOrCreateCel("layer-1", 0).getPixel(4, 4), [0, 0, 0, 0]);

  // Redo 3 -> restores Pixel edit #2
  performRedo();
  assert.deepEqual(pixelEngine.getOrCreateCel("layer-1", 0).getPixel(4, 4), [0, 0, 255, 255]);
  assert.equal(pixelEngine.model3d.nodes.length, 1);

  // Jump straight to index 1 (after Model3D edit, before Pixel edit #2) and back to -1
  jumpToHistoryIndexAction(1);
  assert.equal(pixelEngine.model3d.nodes.length, 1);
  assert.deepEqual(pixelEngine.getOrCreateCel("layer-1", 0).getPixel(2, 2), [255, 0, 0, 255]);
  assert.deepEqual(pixelEngine.getOrCreateCel("layer-1", 0).getPixel(4, 4), [0, 0, 0, 0]);

  jumpToHistoryIndexAction(-1);
  assert.equal(pixelEngine.model3d.nodes.length, 0);
  assert.deepEqual(pixelEngine.getOrCreateCel("layer-1", 0).getPixel(2, 2), [0, 0, 0, 0]);
});

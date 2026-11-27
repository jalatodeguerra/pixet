import test from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { registerHooks } from "node:module";
import { fileURLToPath } from "node:url";

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (
      (specifier.startsWith("./") || specifier.startsWith("../")) &&
      !/\.[a-zA-Z0-9]+$/.test(specifier) &&
      context.parentURL?.startsWith("file:")
    ) {
      const candidateTs = new URL(specifier + ".ts", context.parentURL);
      if (existsSync(fileURLToPath(candidateTs))) {
        return nextResolve(specifier + ".ts", context);
      }
      const candidateTsx = new URL(specifier + ".tsx", context.parentURL);
      if (existsSync(fileURLToPath(candidateTsx))) {
        return nextResolve(specifier + ".tsx", context);
      }
    }
    return nextResolve(specifier, context);
  },
});

import { Model3DEngine } from "../src/engine/model3d/Model3DEngine.ts";
import { convertNodeCuboidToMesh } from "../src/engine/model3d/meshOps.ts";
import {
  countMeshTriangles,
  createModifier,
  evaluatedNodeForExport,
  getEvaluatedMesh,
  isEvaluationTruncated,
} from "../src/engine/model3d/modifiers.ts";
import { createPrimitiveNode } from "../src/engine/model3d/primitives.ts";

const { exportModelToObj } = await import("../src/components/studio3d/three/modelExporter.ts");
const { syncModel3DScene } = await import("../src/components/studio3d/three/sceneSync.ts");

function buildEngine(): { engine: Model3DEngine; nodeId: string } {
  const engine = new Model3DEngine();
  engine.pixelsPerUnit = 16;
  const cube = createPrimitiveNode("cuboid", { name: "Cube", sizePx: [8, 8, 8], position: [8, 0, 0] });
  engine.addNode(convertNodeCuboidToMesh(cube));
  return { engine, nodeId: cube.id };
}

const objOpts = { layers: [], currentFrame: 0, canvasWidth: 32, canvasHeight: 32, triangulate: false };
const faceLines = (txt: string) => txt.split("\n").filter((l) => l.startsWith("f "));

test("OBJ export evaluates enabled modifiers (mirror doubles faces)", async () => {
  const { engine, nodeId } = buildEngine();
  const base = await exportModelToObj(engine, objOpts, "T");
  assert.equal(faceLines(base.objText).length, 6);

  const node = engine.getNode(nodeId)!;
  node.modifiers = [createModifier("mirror")];
  const mirrored = await exportModelToObj(engine, objOpts, "T");
  assert.equal(faceLines(mirrored.objText).length, 12);

  // showInViewport only hides it in the viewport; export still applies it.
  node.modifiers[0].showInViewport = false;
  assert.equal(faceLines((await exportModelToObj(engine, objOpts, "T")).objText).length, 12);

  // enabled=false removes it from export.
  node.modifiers[0].enabled = false;
  assert.equal(faceLines((await exportModelToObj(engine, objOpts, "T")).objText).length, 6);
});

test("syncModel3DScene: viewport vs export context and base-mesh cage picking", () => {
  const { engine, nodeId } = buildEngine();
  const node = engine.getNode(nodeId)!;
  node.modifiers = [createModifier("mirror")];
  const mk = (extra: object) => ({
    wireframeOverlay: false,
    materialById: new Map(),
    textureSizeByMaterialId: new Map(),
    defaultTextureWidth: 32,
    defaultTextureHeight: 32,
    ...extra,
  });

  const viewport = syncModel3DScene(engine, mk({}));
  assert.equal(viewport.triangleCount, 24); // 12 quads -> 24 tris
  // Object Mode: the evaluated mesh itself is pickable.
  assert.equal(viewport.pickableMeshes.length, 1);
  assert.ok(!viewport.pickableMeshes[0].userData.isModifierCagePick);

  node.modifiers[0].showInViewport = false;
  assert.equal(syncModel3DScene(engine, mk({})).triangleCount, 12);
  assert.equal(syncModel3DScene(engine, mk({ modifierContext: "export" })).triangleCount, 24);
  node.modifiers[0].showInViewport = true;

  // Edit Mode on the active node: pick the base cage (6 quads) and draw a wire cage.
  engine.selectNodes([nodeId], nodeId);
  engine.selectionGranularity = "vertex";
  const edit = syncModel3DScene(engine, mk({}));
  assert.equal(edit.triangleCount, 24);
  const pick = edit.pickableMeshes[0];
  assert.ok(pick.userData.isModifierCagePick);
  assert.equal(pick.userData.faceIds.length, 6);
  const parent = edit.nodeObjectById.get(nodeId)!;
  // The viewport's Edit Mode overlay draws the base-mesh wire, not sceneSync.
  assert.ok(!parent.children.some((c) => c.userData.isModifierCageWire));

  // Export never produces a cage even if a node were active.
  const exp = syncModel3DScene(engine, mk({ modifierContext: "export" }));
  assert.ok(!exp.pickableMeshes[0].userData.isModifierCagePick);
});

test("modifier stats and export helpers", () => {
  const { engine, nodeId } = buildEngine();
  const node = engine.getNode(nodeId)!;
  assert.equal(evaluatedNodeForExport(node), node);
  assert.equal(countMeshTriangles(node.mesh), 12);
  node.modifiers = [createModifier("array")];
  const ex = evaluatedNodeForExport(node);
  assert.notEqual(ex, node);
  assert.equal(ex.modifiers, undefined);
  assert.equal(ex.mesh!.faces.length, 12);
  assert.equal(countMeshTriangles(getEvaluatedMesh(node, "viewport")), 24);
  assert.equal(countMeshTriangles(undefined), 0);
  assert.equal(isEvaluationTruncated(node, "viewport"), false);

  const sub = createModifier("subdivide");
  if (sub.type === "subdivide") sub.levels = 3;
  node.modifiers = [sub, { ...createModifier("array"), count: 128 } as never, { ...createModifier("array"), count: 128 } as never];
  assert.equal(isEvaluationTruncated(node, "viewport"), true);
});

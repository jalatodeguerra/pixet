import test from "node:test";
import assert from "node:assert/strict";

import {
  formatHistoryStatus,
  jumpToHistoryIndexAction,
  performRedo,
  performUndo,
} from "../src/engine/document/historyActions.ts";
import { pixelEngine } from "../src/engine/document/PixelEngine.ts";
import { mutateModel3D } from "../src/engine/model3d/model3dActions.ts";
import { createEmptyGraph } from "../src/engine/nodes/NodeGraph.ts";
import { mutateRig, resetRigHistory, syncRigHistoryFlags } from "../src/engine/rig/rigActions.ts";
import { UndoCoordinator } from "../src/engine/history/UndoCoordinator.ts";
import { useEditorStore } from "../src/store/editorStore.ts";
import type { NodeGraph } from "../src/engine/nodes/types.ts";

function freshDoc(): void {
  pixelEngine.resetForDocument(16, 16);
  resetRigHistory();
  useEditorStore.getState().loadProjectState({
    documentName: "unified.pixet",
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
}

function paint(x: number, label: string): void {
  const cel = pixelEngine.getOrCreateCel("layer-1", 0);
  pixelEngine.history.beginTransaction("layer-1", 0, label);
  pixelEngine.history.capturePixelTile(cel, x, 0);
  cel.setPixel(x, 0, 255, 0, 0, 255);
  pixelEngine.history.commitTransaction(cel);
  syncRigHistoryFlags();
}

function addBone(name: string): void {
  mutateRig(`Add ${name}`, () =>
    pixelEngine.rig.addBone({
      name,
      parentId: null,
      localX: 1,
      localY: 1,
      length: 4,
      rotationDeg: 0,
    })
  );
}

function nodeEdit(graphId: string, label: string, scale: number): void {
  const cur = pixelEngine.nodes.graphs.find((g) => g.id === graphId);
  assert.ok(cur);
  const next: NodeGraph = { ...cur, name: `${cur.name}-${scale}` };
  pixelEngine.nodesHistory.push(cur, next, label);
  pixelEngine.nodes.replaceActiveGraph(next);
  syncRigHistoryFlags();
}

function setMode(mode: "draw" | "rig" | "nodes" | "tiles" | "studio3d"): void {
  useEditorStore.getState().setWorkspaceMode(mode);
}

function kinds(): string[] {
  return pixelEngine.undoCoordinator.getHistoryEntries().map((e) => e.kind);
}

test("one chronological timeline across pixels, rig, nodes, model3d and tiles", () => {
  freshDoc();
  const g = createEmptyGraph("G1", "material", 128, "g-a");
  pixelEngine.nodes.replaceActiveGraph(g);

  setMode("draw");
  paint(1, "Paint 1");
  setMode("rig");
  addBone("Hip");
  setMode("nodes");
  nodeEdit("g-a", "Rename graph", 1);
  setMode("studio3d");
  mutateModel3D("Add Cuboid", (eng) => {
    eng.addNode({ kind: "cuboid", name: "Cube" });
  });
  setMode("tiles");
  pixelEngine.tilemapHistory.beginCells("Stamp", "tm-1", 0);
  const tm = pixelEngine.getOrCreateTilemap("tm-1", 0);
  tm.setCell(0, 0, 3);
  pixelEngine.tilemapHistory.recordCell(0, 0, 0, 3);
  assert.equal(pixelEngine.tilemapHistory.commitCells(), true);

  assert.deepEqual(kinds(), ["pixels", "rig", "nodes", "model3d", "cells"]);

  // Undo in reverse order, independent of the workspace that is open.
  const order: Array<"draw" | "rig" | "nodes" | "tiles" | "studio3d"> = [
    "draw",
    "nodes",
    "rig",
    "studio3d",
    "tiles",
  ];
  const expectedStatus = [
    "Undo (Tiles): Stamp",
    "Undo (3D Studio): Add Cuboid",
    "Undo (Nodes): Rename graph",
    "Undo (Rig): Add Hip",
    "Undo (Draw): Paint 1",
  ];
  for (let i = 0; i < 5; i++) {
    setMode(order[i]);
    performUndo();
    assert.equal(useEditorStore.getState().statusMessage, expectedStatus[i]);
  }
  assert.equal(pixelEngine.rig.bones.length, 0);
  assert.equal(pixelEngine.model3d.nodes.length, 0);
  assert.equal(tm.getCell(0, 0), 0);
  assert.equal(pixelEngine.nodes.getActiveGraph()?.name, "G1");
  assert.deepEqual(pixelEngine.getOrCreateCel("layer-1", 0).getPixel(1, 0), [0, 0, 0, 0]);
  assert.equal(useEditorStore.getState().canUndo, false);
  assert.equal(useEditorStore.getState().canRedo, true);

  // Redo in forward order from yet another workspace.
  setMode("rig");
  performRedo();
  assert.equal(useEditorStore.getState().statusMessage, "Redo (Draw): Paint 1");
  performRedo();
  assert.equal(useEditorStore.getState().statusMessage, "Redo: Add Hip");
  assert.equal(pixelEngine.rig.bones.length, 1);
  performRedo();
  assert.equal(pixelEngine.nodes.getActiveGraph()?.name, "G1-1");
  performRedo();
  assert.equal(pixelEngine.model3d.nodes.length, 1);
  performRedo();
  assert.equal(tm.getCell(0, 0), 3);
  assert.equal(useEditorStore.getState().canRedo, false);
  assert.equal(useEditorStore.getState().canUndo, true);
});

test("rig edit then pixel workspace: Ctrl+Z undoes the rig edit first", () => {
  freshDoc();
  setMode("draw");
  paint(2, "Stroke");
  setMode("rig");
  addBone("Spine");
  setMode("draw");
  performUndo();
  assert.equal(pixelEngine.rig.bones.length, 0);
  assert.equal(
    pixelEngine.getOrCreateCel("layer-1", 0).getPixel(2, 0)[3],
    255
  );
  performUndo();
  assert.equal(pixelEngine.getOrCreateCel("layer-1", 0).getPixel(2, 0)[3], 0);
});

test("a new edit clears redo across every history", () => {
  freshDoc();
  addBone("A");
  addBone("B");
  performUndo();
  assert.equal(useEditorStore.getState().canRedo, true);
  paint(3, "New stroke");
  assert.equal(useEditorStore.getState().canRedo, false);
  assert.equal(pixelEngine.undoCoordinator.canRedo, false);
  performRedo();
  assert.equal(pixelEngine.rig.bones.length, 1);
  assert.deepEqual(kinds(), ["rig", "pixels"]);
  // Undo/redo of the surviving entries still lines up with their payloads.
  performUndo();
  performUndo();
  assert.equal(pixelEngine.rig.bones.length, 0);
  performRedo();
  assert.equal(pixelEngine.rig.bones.length, 1);
});

test("node undo targets the graph the entry was recorded for", () => {
  freshDoc();
  pixelEngine.nodes.replaceActiveGraph(createEmptyGraph("One", "material", 128, "g1"));
  pixelEngine.nodes.replaceActiveGraph(createEmptyGraph("Two", "material", 128, "g2"));
  nodeEdit("g1", "Edit One", 1);
  nodeEdit("g2", "Edit Two", 1);
  pixelEngine.nodes.setActiveGraph("g2");
  const entries = pixelEngine.undoCoordinator.getHistoryEntries();
  assert.deepEqual(entries.map((e) => e.ref), ["g1", "g2"]);

  performUndo();
  const byId = (id: string) => pixelEngine.nodes.graphs.find((x) => x.id === id);
  assert.equal(byId("g2")?.name, "Two");
  pixelEngine.nodes.setActiveGraph("g1");
  performUndo();
  assert.equal(byId("g1")?.name, "One");
  assert.equal(byId("g2")?.name, "Two");
  pixelEngine.nodes.setActiveGraph("g2");
  performRedo();
  assert.equal(byId("g1")?.name, "One-1");
  assert.equal(byId("g2")?.name, "Two");
});

test("undo of an entry whose graph was removed drops the orphan and continues", () => {
  freshDoc();
  addBone("Keep");
  pixelEngine.nodes.replaceActiveGraph(createEmptyGraph("Gone", "material", 128, "gx"));
  nodeEdit("gx", "Edit Gone", 1);
  pixelEngine.nodes.graphs = [];
  performUndo();
  assert.equal(pixelEngine.rig.bones.length, 0);
  assert.equal(pixelEngine.undoCoordinator.canUndo, false);
});

test("per-history caps never leave orphaned coordinator entries", () => {
  freshDoc();
  for (let i = 0; i < 105; i++) addBone(`B${i}`);
  const rigEntries = kinds().filter((k) => k === "rig").length;
  assert.equal(rigEntries, 100);
  // Interleave pixel edits so the oldest rig entries are not the stack bottom.
  for (let i = 0; i < 4; i++) paint(i, `P${i}`);
  let guard = 0;
  while (pixelEngine.undoCoordinator.canUndo && guard++ < 500) performUndo();
  assert.equal(pixelEngine.rig.bones.length, 5);
  assert.equal(pixelEngine.undoCoordinator.canUndo, false);
  assert.equal(pixelEngine.undoCoordinator.getHistoryEntries().length, 104);
});

test("coordinator group limits drop the oldest entry of that group only", () => {
  const c = new UndoCoordinator(10, [{ kinds: ["rig"], limit: 2 }]);
  c.record("rig", "r1");
  c.record("pixels", "p1");
  c.record("rig", "r2");
  c.record("rig", "r3");
  assert.deepEqual(
    c.getHistoryEntries().map((e) => e.label),
    ["p1", "r2", "r3"]
  );
  let cleared = 0;
  c.onRedoCleared(() => cleared++);
  c.record("pixels", "p2");
  assert.equal(cleared, 1);
});

test("history panel jump works across kinds; status prefix only for other workspaces", () => {
  freshDoc();
  setMode("draw");
  paint(5, "A");
  addBone("J");
  paint(6, "B");
  jumpToHistoryIndexAction(-1);
  assert.equal(pixelEngine.undoCoordinator.getCurrentIndex(), -1);
  assert.equal(pixelEngine.rig.bones.length, 0);
  jumpToHistoryIndexAction(1);
  assert.equal(pixelEngine.rig.bones.length, 1);
  assert.equal(formatHistoryStatus("Undo", "rig", "x", "rig"), "Undo: x");
  assert.equal(formatHistoryStatus("Redo", "nodes", "x", "draw"), "Redo (Nodes): x");
});


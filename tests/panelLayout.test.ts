import test from "node:test";
import assert from "node:assert/strict";

import {
  applyLayoutSnapshot,
  bringPanelToFrontState,
  clampFloatingRect,
  createDefaultPanelLayout,
  createLayoutSnapshot,
  DEFAULT_DOCKED_ORDER,
  deleteSavedLayout,
  deserializePanelLayout,
  deserializeSavedLayouts,
  detachPanelState,
  dockAllPanelsState,
  dockPanelState,
  getPanelSide,
  normalizeLayoutName,
  PANEL_WORKSPACE_MAP,
  placePanelState,
  reorderDockedPanelState,
  resetWorkspaceLayoutState,
  serializePanelLayout,
  serializeSavedLayouts,
  setPanelSideState,
  togglePanelHiddenState,
  upsertSavedLayout,
  workspaceHasDockedOnSide,
} from "../src/engine/ui/panelLayout.ts";

test("panelLayout detach, dock at index, dockAll, and bringToFront", () => {
  let state = createDefaultPanelLayout();
  state = detachPanelState(state, "rig-weights", { x: 40, y: 60, width: 280 });
  assert.ok(state.detachedPanels["rig-weights"]);
  assert.equal(state.detachedPanels["rig-weights"]?.x, 40);
  assert.equal(state.detachedPanels["rig-weights"]?.zOrder, 1);

  state = detachPanelState(state, "color-palette", { x: 100, y: 80 });
  assert.equal(state.detachedPanels["color-palette"]?.zOrder, 2);

  state = bringPanelToFrontState(state, "rig-weights");
  assert.equal(state.detachedPanels["rig-weights"]?.zOrder, 3);

  // Dock rig-weights at index 0 of rig order
  state = dockPanelState(state, "rig-weights", 0);
  assert.equal(state.detachedPanels["rig-weights"], undefined);
  assert.equal(state.dockedPanelOrder.rig[0], "rig-weights");

  // Dock all remaining
  state = dockAllPanelsState(state);
  assert.deepEqual(state.detachedPanels, {});
});

test("panelLayout reorderDockedPanelState forward and backward", () => {
  let state = createDefaultPanelLayout();
  const orig = [...DEFAULT_DOCKED_ORDER.tiles];
  assert.equal(orig[0], "tiles-browser");
  assert.equal(orig[2], "tiles-terrain");

  // Move tiles-browser (0) -> index 2
  state = reorderDockedPanelState(state, "tiles", "tiles-browser", 2);
  assert.equal(state.dockedPanelOrder.tiles[2], "tiles-browser");
  assert.equal(state.dockedPanelOrder.tiles[0], "tiles-props");

  // Move back to 0
  state = reorderDockedPanelState(state, "tiles", "tiles-browser", 0);
  assert.deepEqual(state.dockedPanelOrder.tiles, orig);
});

test("panelLayout clampFloatingRect and serialize/deserialize recovery", () => {
  const clamped = clampFloatingRect(
    {
      x: 900,
      y: 700,
      width: 600,
      height: 50,
      collapsed: false,
      pinned: true,
      zOrder: 4,
    },
    500,
    400
  );
  assert.equal(clamped.width, 480);
  assert.equal(clamped.height, 110);
  assert.equal(clamped.x, 20);
  assert.equal(clamped.y, 290);

  let state = createDefaultPanelLayout();
  state = detachPanelState(state, "layers", { x: 15, y: 25, width: 260 });
  const json = serializePanelLayout(state);
  const restored = deserializePanelLayout(json);
  assert.equal(restored.detachedPanels.layers?.x, 15);
  assert.deepEqual(restored.dockedPanelOrder.rig, DEFAULT_DOCKED_ORDER.rig);

  // Corrupt JSON falls back cleanly
  const fallback = deserializePanelLayout("{not-valid-json");
  assert.deepEqual(fallback, createDefaultPanelLayout());
});

test("panelLayout migrates legacy data workspace: game-data now lives in draw", () => {
  assert.deepEqual(DEFAULT_DOCKED_ORDER.draw, [
    "color-palette",
    "brush",
    "reference",
    "history",
    "layers",
    "game-data",
  ]);
  const legacy = JSON.stringify({
    detachedPanels: {},
    dockedPanelOrder: {
      draw: ["layers", "color-palette"],
      data: ["game-data", "color-palette", "layers"],
    },
  });
  const state = deserializePanelLayout(legacy);
  // Panels missing from the saved order slot in after their default predecessor.
  assert.deepEqual(state.dockedPanelOrder.draw, [
    "layers",
    "game-data",
    "color-palette",
    "brush",
    "reference",
    "history",
  ]);
  assert.deepEqual(state.dockedPanelOrder.data, []);
});

test("panelLayout: every panel id maps to a workspace and appears in its default order", () => {
  for (const [id, ws] of Object.entries(PANEL_WORKSPACE_MAP)) {
    assert.ok(
      (DEFAULT_DOCKED_ORDER[ws] as string[]).includes(id),
      `${id} missing from ${ws} default order`
    );
  }
});

test("panelLayout: old persisted format restores defaults for sides/hidden and keeps visual order", () => {
  const old = JSON.stringify({
    detachedPanels: {},
    dockedPanelOrder: {
      draw: ["color-palette", "layers", "game-data"],
      tiles: [...DEFAULT_DOCKED_ORDER.tiles],
      rig: [...DEFAULT_DOCKED_ORDER.rig],
    },
  });
  const state = deserializePanelLayout(old);
  assert.deepEqual(state.dockedPanelOrder.draw, DEFAULT_DOCKED_ORDER.draw);
  assert.deepEqual(state.panelSides, {});
  assert.deepEqual(state.hiddenPanels, {});
  assert.deepEqual(state, createDefaultPanelLayout());
});

test("panelLayout: deserialize restores orders for every workspace (nodes) and validates sides/hidden", () => {
  const raw = JSON.stringify({
    detachedPanels: {},
    dockedPanelOrder: { nodes: ["nodes-inspector", "nodes-preview"] },
    panelSides: { layers: "left", brush: "sideways", bogus: "left" },
    hiddenPanels: { history: true, reference: false, nope: true },
  });
  const state = deserializePanelLayout(raw);
  assert.deepEqual(state.dockedPanelOrder.nodes, ["nodes-inspector", "nodes-preview"]);
  assert.deepEqual(state.panelSides, { layers: "left" });
  assert.deepEqual(state.hiddenPanels, { history: true });
  const round = deserializePanelLayout(serializePanelLayout(state));
  assert.deepEqual(round, state);
});

test("panelLayout: set side, toggle hidden, and left-dock visibility", () => {
  let state = createDefaultPanelLayout();
  assert.equal(workspaceHasDockedOnSide(state, "draw", "left"), false);
  assert.equal(getPanelSide(state, "layers"), "right");

  state = setPanelSideState(state, "layers", "left");
  assert.equal(getPanelSide(state, "layers"), "left");
  assert.equal(workspaceHasDockedOnSide(state, "draw", "left"), true);
  assert.equal(workspaceHasDockedOnSide(state, "rig", "left"), false);

  // Hidden or floating panels do not count toward the left column.
  state = togglePanelHiddenState(state, "layers");
  assert.equal(state.hiddenPanels.layers, true);
  assert.equal(workspaceHasDockedOnSide(state, "draw", "left"), false);
  state = togglePanelHiddenState(state, "layers");
  assert.deepEqual(state.hiddenPanels, {});
  state = detachPanelState(state, "layers");
  assert.equal(workspaceHasDockedOnSide(state, "draw", "left"), false);

  // Setting back to right clears the entry.
  state = setPanelSideState(state, "layers", "right");
  assert.deepEqual(state.panelSides, {});
});

test("panelLayout: placePanelState docks floating/docked panels into a column at a position", () => {
  let state = createDefaultPanelLayout();
  state = detachPanelState(state, "history");
  state = placePanelState(state, "history", "left", null);
  assert.equal(state.detachedPanels.history, undefined);
  assert.equal(getPanelSide(state, "history"), "left");

  // Drop layers on the left, before history.
  state = placePanelState(state, "layers", "left", "history");
  const order = state.dockedPanelOrder.draw;
  assert.ok(order.indexOf("layers") < order.indexOf("history"));
  assert.equal(order.length, DEFAULT_DOCKED_ORDER.draw.length);

  // Dropping at the end of the right column goes after its last member only.
  state = placePanelState(state, "brush", "right", null);
  assert.equal(getPanelSide(state, "brush"), "right");
  assert.equal(new Set(state.dockedPanelOrder.draw).size, DEFAULT_DOCKED_ORDER.draw.length);
  const draw = state.dockedPanelOrder.draw;
  const lastRight = draw.filter((p) => getPanelSide(state, p) === "right").at(-1);
  assert.equal(lastRight, "brush");
});

test("panelLayout: resetWorkspaceLayoutState only touches that workspace", () => {
  let state = createDefaultPanelLayout();
  state = placePanelState(state, "layers", "left", null);
  state = togglePanelHiddenState(state, "brush");
  state = detachPanelState(state, "color-palette");
  state = setPanelSideState(state, "rig-weights", "left");
  state = reorderDockedPanelState(state, "rig", "rig-weights", 0);

  const next = resetWorkspaceLayoutState(state, "draw");
  assert.deepEqual(next.dockedPanelOrder.draw, DEFAULT_DOCKED_ORDER.draw);
  assert.equal(next.panelSides.layers, undefined);
  assert.equal(next.hiddenPanels.brush, undefined);
  assert.equal(next.detachedPanels["color-palette"], undefined);
  // Rig is untouched.
  assert.equal(next.panelSides["rig-weights"], "left");
  assert.equal(next.dockedPanelOrder.rig[0], "rig-weights");
});

test("panelLayout: layout snapshots round-trip, clamp sizes, and are independent copies", () => {
  let state = createDefaultPanelLayout();
  state = placePanelState(state, "layers", "left", null);
  const snap = createLayoutSnapshot(state, {
    rightPanelWidth: 9999,
    leftPanelWidth: 10,
    timelineHeight: 250,
  });
  assert.equal(snap.rightPanelWidth, 420);
  assert.equal(snap.leftPanelWidth, 230);
  assert.equal(snap.timelineHeight, 250);

  // Mutating the live state later does not change the snapshot.
  state = togglePanelHiddenState(state, "history");
  assert.deepEqual(snap.panelLayout.hiddenPanels, {});

  const applied = applyLayoutSnapshot(snap);
  assert.equal(getPanelSide(applied.panelLayout, "layers"), "left");
  assert.equal(applied.timelineHeight, 250);
});

test("panelLayout: saved layouts upsert, delete, serialize and validate", () => {
  const base = createLayoutSnapshot(createDefaultPanelLayout(), {
    rightPanelWidth: 276,
    leftPanelWidth: 276,
    timelineHeight: 204,
  });
  let list = upsertSavedLayout([], "  Animation   Work ", base, 1);
  assert.equal(list.length, 1);
  assert.equal(list[0].name, "Animation Work");
  assert.equal(normalizeLayoutName("   "), "");
  assert.equal(upsertSavedLayout(list, "   ", base, 2), list);

  // Same name (case-insensitive) replaces rather than duplicates.
  list = upsertSavedLayout(list, "animation work", base, 3);
  assert.equal(list.length, 1);
  assert.equal(list[0].savedAt, 3);
  list = upsertSavedLayout(list, "Painting", base, 4);
  assert.equal(list.length, 2);

  const restored = deserializeSavedLayouts(serializeSavedLayouts(list));
  assert.deepEqual(
    restored.map((l) => l.name),
    ["animation work", "Painting"]
  );
  assert.deepEqual(restored[0].snapshot, list[0].snapshot);

  assert.deepEqual(deserializeSavedLayouts("nope"), []);
  assert.deepEqual(deserializeSavedLayouts(JSON.stringify({ not: "array" })), []);
  assert.deepEqual(
    deserializeSavedLayouts(JSON.stringify([{ name: 5 }, null, { name: "x" }])),
    []
  );

  list = deleteSavedLayout(list, "PAINTING");
  assert.deepEqual(list.map((l) => l.name), ["animation work"]);
});

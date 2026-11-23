import test from "node:test";
import assert from "node:assert/strict";

import {
  bringPanelToFrontState,
  clampFloatingRect,
  createDefaultPanelLayout,
  DEFAULT_DOCKED_ORDER,
  deserializePanelLayout,
  detachPanelState,
  dockAllPanelsState,
  dockPanelState,
  reorderDockedPanelState,
  serializePanelLayout,
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

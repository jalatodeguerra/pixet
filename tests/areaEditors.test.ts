import test from "node:test";
import assert from "node:assert/strict";

import {
  availableEditors,
  createDefaultAreas,
  defaultAreaConfig,
  isTilesetDocked,
  joinBottomArea,
  sanitizeAreaConfig,
  setBottomEditor,
  setBottomSplitRatio,
  setSidebarEditor,
  setTilesetDocked,
  splitBottomArea,
  toggleBottomArea,
  visibleBottomEditors,
} from "../src/engine/ui/areaEditors.ts";
import {
  applyLayoutSnapshot,
  createDefaultPanelLayout,
  createLayoutSnapshot,
  deserializePanelLayout,
  deserializeSavedLayouts,
  resetWorkspaceLayoutState,
  serializePanelLayout,
  serializeSavedLayouts,
  upsertSavedLayout,
} from "../src/engine/ui/panelLayout.ts";

test("area defaults reproduce the pre-area layout", () => {
  const a = createDefaultAreas();
  for (const ws of ["draw", "tiles", "rig", "studio3d"] as const) {
    assert.deepEqual(a[ws].bottomEditors, ["timeline"]);
    assert.equal(a[ws].bottomVisible, true);
    assert.equal(a[ws].sidebarEditor, "panels");
  }
  assert.equal(a.nodes.bottomVisible, false);
  assert.equal(isTilesetDocked(a), false);
});

test("availability per workspace and slot", () => {
  const ids = (ws: any, slot: any) => availableEditors(ws, slot).map((e) => e.id);
  assert.deepEqual(ids("rig", "bottom"), ["timeline", "curves", "preview"]);
  assert.deepEqual(ids("draw", "bottom"), ["timeline", "preview"]);
  assert.ok(ids("tiles", "sidebar").includes("tileset"));
  assert.ok(!ids("draw", "sidebar").includes("tileset"));
  assert.ok(!ids("nodes", "bottom").includes("timeline"));
});

test("split, edit, swap and join bottom areas", () => {
  let a = createDefaultAreas();
  a = splitBottomArea(a, "rig");
  assert.deepEqual(a.rig.bottomEditors, ["timeline", "preview"]);
  assert.equal(splitBottomArea(a, "rig"), a, "max two areas");
  a = setBottomEditor(a, "rig", 1, "curves");
  assert.deepEqual(a.rig.bottomEditors, ["timeline", "curves"]);
  a = setBottomEditor(a, "rig", 0, "curves");
  assert.deepEqual(a.rig.bottomEditors, ["curves", "timeline"], "swaps with the other area");
  assert.equal(setBottomEditor(a, "draw", 0, "curves"), a, "curves unavailable in draw");
  a = joinBottomArea(a, "rig", 1);
  assert.deepEqual(a.rig.bottomEditors, ["curves"]);
  assert.equal(joinBottomArea(a, "rig"), a);
  a = setBottomSplitRatio(a, "rig", 5);
  assert.equal(a.rig.bottomSplitRatio, 0.8);
});

test("sidebar editor availability", () => {
  const a = createDefaultAreas();
  assert.equal(setSidebarEditor(a, "draw", "tileset"), a);
  assert.equal(setSidebarEditor(a, "draw", "preview").draw.sidebarEditor, "preview");
});

test("sanitize falls back to defaults for unavailable editors", () => {
  const cfg = sanitizeAreaConfig(
    {
      sidebarEditor: "timeline",
      bottomEditors: ["curves", "tileset", "preview", "preview", "bogus"],
      bottomSplitRatio: "x",
      bottomVisible: "yes",
    },
    "draw"
  );
  assert.equal(cfg.sidebarEditor, "panels");
  assert.deepEqual(cfg.bottomEditors, ["preview"]);
  assert.equal(cfg.bottomSplitRatio, 0.5);
  assert.equal(cfg.bottomVisible, true);
  assert.deepEqual(sanitizeAreaConfig({ bottomEditors: ["curves"] }, "draw").bottomEditors, ["timeline"]);
  assert.deepEqual(sanitizeAreaConfig(null, "nodes"), defaultAreaConfig("nodes"));
});

test("timeline suppression and Show Bottom Area toggle", () => {
  let a = createDefaultAreas();
  assert.deepEqual(visibleBottomEditors(a.studio3d, false), []);
  assert.deepEqual(visibleBottomEditors(a.draw, true), ["timeline"]);
  a = splitBottomArea(a, "studio3d");
  assert.deepEqual(visibleBottomEditors(a.studio3d, false), ["preview"]);

  // Nodes: opt in to the bottom area, gets a preview.
  a = toggleBottomArea(a, "nodes", false);
  assert.deepEqual(visibleBottomEditors(a.nodes, false), ["preview"]);
  a = toggleBottomArea(a, "nodes", false);
  assert.equal(a.nodes.bottomVisible, false);

  // 3D with the timeline suppressed: toggling on swaps in a preview.
  let b = createDefaultAreas();
  b = toggleBottomArea(b, "studio3d", false);
  assert.deepEqual(visibleBottomEditors(b.studio3d, false), ["preview"]);
});

test("tileset docked flag maps onto the tileset editor", () => {
  let a = createDefaultAreas();
  a = setTilesetDocked(a, true);
  assert.deepEqual(a.tiles.bottomEditors, ["tileset"]);
  assert.equal(isTilesetDocked(a), true);
  a = setTilesetDocked(a, false);
  assert.deepEqual(a.tiles.bottomEditors, ["timeline"]);
  assert.equal(isTilesetDocked(a), false);
});

test("panel layout serialization includes areas and accepts older formats", () => {
  let layout = createDefaultPanelLayout();
  layout = { ...layout, areas: splitBottomArea(layout.areas, "draw") };
  const round = deserializePanelLayout(serializePanelLayout(layout));
  assert.deepEqual(round.areas.draw.bottomEditors, ["timeline", "preview"]);

  // Part-1 format (no areas) and older (no sides/hidden).
  const part1 = JSON.stringify({
    detachedPanels: {},
    dockedPanelOrder: {},
    panelSides: { brush: "left" },
    hiddenPanels: {},
  });
  const old = deserializePanelLayout(part1);
  assert.deepEqual(old.areas, createDefaultAreas());
  assert.equal(old.panelSides.brush, "left");
  assert.deepEqual(
    deserializePanelLayout(JSON.stringify({ detachedPanels: {} })).areas,
    createDefaultAreas()
  );
  assert.deepEqual(deserializePanelLayout("{bad").areas, createDefaultAreas());
});

test("snapshots, saved layouts and workspace reset carry areas", () => {
  let layout = createDefaultPanelLayout();
  layout = { ...layout, areas: setSidebarEditor(layout.areas, "draw", "preview") };
  const snap = createLayoutSnapshot(layout, {
    rightPanelWidth: 276,
    leftPanelWidth: 276,
    timelineHeight: 204,
  });
  assert.equal(snap.panelLayout.areas.draw.sidebarEditor, "preview");
  assert.equal(applyLayoutSnapshot(snap).panelLayout.areas.draw.sidebarEditor, "preview");

  const saved = deserializeSavedLayouts(
    serializeSavedLayouts(upsertSavedLayout([], "mine", snap, 1))
  );
  assert.equal(saved[0].snapshot.panelLayout.areas.draw.sidebarEditor, "preview");

  const other = { ...layout, areas: splitBottomArea(layout.areas, "rig") };
  const reset = resetWorkspaceLayoutState(other, "draw");
  assert.equal(reset.areas.draw.sidebarEditor, "panels");
  assert.deepEqual(reset.areas.rig.bottomEditors, ["timeline", "preview"], "other workspaces untouched");
});

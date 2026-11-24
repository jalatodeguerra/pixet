import test from "node:test";
import assert from "node:assert/strict";

import {
  ALL_WORKSPACES,
  BUILT_IN_PRESET_META,
  addPanelToInspector,
  buildBuiltInPresetTree,
  clampSplitRatio,
  closeArea,
  computeAreaRects,
  countAreas,
  countViewportAreas,
  createDefaultWorkspaceLayouts,
  createDefaultWorkspaceTree,
  deserializeWorkspaceLayouts,
  equalizeSplit,
  findArea,
  findJoinableNeighbor,
  joinAreas,
  listAreas,
  moveAreaToTarget,
  movePanelToArea,
  removePanelFromInspector,
  resizeSplit,
  serializeWorkspaceLayouts,
  setAreaEditor,
  setInspectorMode,
  splitArea,
  swapAreas,
  swapSplitChildren,
} from "../src/engine/ui/workspaceLayout.ts";

test("default workspace layouts have valid structure and single viewport", () => {
  const state = createDefaultWorkspaceLayouts();
  for (const ws of ALL_WORKSPACES) {
    const tree = state.layouts[ws];
    assert.equal(countViewportAreas(tree), 1, `${ws} should have 1 viewport`);
    assert.equal(countAreas(tree), 3, `${ws} should have viewport + timeline + inspector`);
  }
});

test("splitArea enforces single viewport invariant and clamps ratio", () => {
  const tree = createDefaultWorkspaceTree("draw");
  // Splitting viewport without config creates a preview, never a 2nd viewport
  const split1 = splitArea(tree, "area-draw-viewport", "horizontal", 0.99);
  assert.equal(countAreas(split1), 4);
  assert.equal(countViewportAreas(split1), 1);

  const previews = listAreas(split1).filter((a) => a.editorType === "preview");
  assert.equal(previews.length, 1);

  // Even explicitly requesting viewport as newArea gets downgraded to preview
  const split2 = splitArea(tree, "area-draw-timeline", "vertical", 0.5, {
    editorType: "viewport",
  });
  assert.equal(countViewportAreas(split2), 1);

  // Ratio clamping
  assert.equal(clampSplitRatio(0.01), 0.08);
  assert.equal(clampSplitRatio(0.99), 0.92);
  assert.ok(clampSplitRatio(0.05, 500, 100) >= 0.2);
});

test("closeArea and joinAreas protect the only viewport", () => {
  const tree = createDefaultWorkspaceTree("draw");
  // Cannot close the only viewport
  const afterCloseVp = closeArea(tree, "area-draw-viewport");
  assert.equal(countAreas(afterCloseVp), 3);
  assert.equal(countViewportAreas(afterCloseVp), 1);

  // Closing timeline works
  const afterCloseTl = closeArea(tree, "area-draw-timeline");
  assert.equal(countAreas(afterCloseTl), 2);
  assert.equal(findArea(afterCloseTl, "area-draw-timeline"), null);

  // Cannot join (absorb) the only viewport into inspector
  const afterBadJoin = joinAreas(tree, "area-draw-inspector", "area-draw-viewport");
  assert.equal(countAreas(afterBadJoin), 3);

  // Viewport CAN absorb timeline
  const afterGoodJoin = joinAreas(tree, "area-draw-viewport", "area-draw-timeline");
  assert.equal(countAreas(afterGoodJoin), 2);
  assert.equal(findArea(afterGoodJoin, "area-draw-timeline"), null);
});

test("resizeSplit, equalizeSplit, swapSplitChildren, and swapAreas", () => {
  let tree = createDefaultWorkspaceTree("draw");
  tree = resizeSplit(tree, "split-draw-root", 0.6, 1000, 100);
  assert.equal(tree.kind, "split");
  assert.equal(tree.ratio, 0.6);

  tree = equalizeSplit(tree, "split-draw-root");
  assert.equal(tree.kind, "split");
  assert.equal(tree.ratio, 0.5);

  const swappedSplit = swapSplitChildren(tree, "split-draw-root");
  assert.equal(swappedSplit.kind, "split");
  assert.equal(swappedSplit.first.id, "area-draw-inspector");

  const swappedAreas = swapAreas(tree, "area-draw-timeline", "area-draw-inspector");
  assert.equal(findArea(swappedAreas, "area-draw-timeline")?.editorType, "inspector");
  assert.equal(findArea(swappedAreas, "area-draw-inspector")?.editorType, "timeline");
});

test("setAreaEditor switches editor and swaps viewport when needed", () => {
  const tree = createDefaultWorkspaceTree("draw");

  // Switching timeline -> preview works
  const withPreview = setAreaEditor(tree, "area-draw-timeline", "preview");
  assert.equal(findArea(withPreview, "area-draw-timeline")?.editorType, "preview");

  // Cannot convert only viewport directly to preview
  const blocked = setAreaEditor(tree, "area-draw-viewport", "preview");
  assert.equal(findArea(blocked, "area-draw-viewport")?.editorType, "viewport");

  // Switching inspector -> viewport swaps it with the existing viewport
  const swappedVp = setAreaEditor(tree, "area-draw-inspector", "viewport");
  assert.equal(countViewportAreas(swappedVp), 1);
  assert.equal(findArea(swappedVp, "area-draw-inspector")?.editorType, "viewport");
  assert.equal(findArea(swappedVp, "area-draw-viewport")?.editorType, "inspector");
});

test("computeAreaRects and findJoinableNeighbor detect adjacent areas", () => {
  const tree = createDefaultWorkspaceTree("draw");
  const bounds = { x: 0, y: 0, width: 1000, height: 800 };
  const rects = computeAreaRects(tree, bounds);

  assert.equal(Math.round(rects["area-draw-viewport"].width), 780);
  assert.equal(Math.round(rects["area-draw-inspector"].x), 780);
  assert.equal(Math.round(rects["area-draw-inspector"].width), 220);

  assert.equal(
    findJoinableNeighbor(tree, "area-draw-viewport", "bottom", bounds),
    "area-draw-timeline"
  );
  assert.equal(
    findJoinableNeighbor(tree, "area-draw-timeline", "top", bounds),
    "area-draw-viewport"
  );
  assert.equal(
    findJoinableNeighbor(tree, "area-draw-viewport", "right", bounds),
    "area-draw-inspector"
  );
  assert.equal(
    findJoinableNeighbor(tree, "area-draw-viewport", "left", bounds),
    null
  );
});

test("moveAreaToTarget swaps, merges inspectors, and edge-splits", () => {
  const tree = createDefaultWorkspaceTree("draw");

  // Move timeline to left of viewport
  const moved = moveAreaToTarget(tree, "area-draw-timeline", "area-draw-viewport", "left");
  assert.equal(countAreas(moved), 3);
  assert.equal(countViewportAreas(moved), 1);
  const rects = computeAreaRects(moved, { x: 0, y: 0, width: 1000, height: 800 });
  assert.ok(rects["area-draw-timeline"].x < rects["area-draw-viewport"].x);

  // Split inspector into 2 panels and merge them back via center drop
  let dual = buildBuiltInPresetTree("dual-sidebar", "draw");
  assert.equal(countAreas(dual), 4);
  dual = moveAreaToTarget(dual, "area-draw-ds-left", "area-draw-ds-right", "center");
  assert.equal(countAreas(dual), 3);
  const merged = findArea(dual, "area-draw-ds-right");
  assert.ok(merged?.panels?.includes("color-palette"));
  assert.ok(merged?.panels?.includes("layers"));
});

test("movePanelToArea reorders, splits onto edge, and closes empty source", () => {
  let tree = createDefaultWorkspaceTree("draw");

  // Reorder layers from end to index 0
  tree = movePanelToArea(
    tree,
    "layers",
    "area-draw-inspector",
    "area-draw-inspector",
    "center",
    0
  );
  assert.equal(findArea(tree, "area-draw-inspector")?.panels?.[0], "layers");

  // Drag layers onto left edge of viewport -> creates new inspector area
  tree = movePanelToArea(
    tree,
    "layers",
    "area-draw-inspector",
    "area-draw-viewport",
    "left"
  );
  assert.equal(countAreas(tree), 4);
  assert.ok(!findArea(tree, "area-draw-inspector")?.panels?.includes("layers"));

  // Find the newly created area holding only "layers" and move it back
  const newArea = listAreas(tree).find(
    (a) => a.id !== "area-draw-inspector" && a.panels?.includes("layers")
  );
  assert.ok(newArea);
  tree = movePanelToArea(tree, "layers", newArea.id, "area-draw-inspector", "center");
  assert.equal(countAreas(tree), 3);
  assert.ok(findArea(tree, "area-draw-inspector")?.panels?.includes("layers"));

  // Add/remove panel helpers and inspector mode
  tree = setInspectorMode(tree, "area-draw-inspector", "tabs");
  assert.equal(findArea(tree, "area-draw-inspector")?.inspectorMode, "tabs");
  tree = removePanelFromInspector(tree, "area-draw-inspector", "history");
  assert.ok(!findArea(tree, "area-draw-inspector")?.panels?.includes("history"));
  tree = addPanelToInspector(tree, "area-draw-inspector", "history");
  assert.ok(findArea(tree, "area-draw-inspector")?.panels?.includes("history"));
});

test("all built-in presets are valid and preserve single viewport", () => {
  for (const preset of BUILT_IN_PRESET_META) {
    for (const ws of ALL_WORKSPACES) {
      const tree = buildBuiltInPresetTree(preset.id, ws);
      assert.equal(
        countViewportAreas(tree),
        1,
        `preset ${preset.id} (${ws}) must have 1 viewport`
      );
      assert.ok(countAreas(tree) >= 2);
    }
  }
});

test("serializeWorkspaceLayouts and deserializeWorkspaceLayouts round-trip & recover", () => {
  const state = createDefaultWorkspaceLayouts();
  state.layouts.draw = buildBuiltInPresetTree("animation-studio", "draw");
  state.toolRailVisible = false;
  state.toolRailSide = "right";
  state.customPresets.push({
    id: "custom-1",
    name: "My Pixel Desk",
    tree: buildBuiltInPresetTree("dual-sidebar", "draw"),
  });

  const json = serializeWorkspaceLayouts(state);
  const restored = deserializeWorkspaceLayouts(json);
  assert.equal(restored.toolRailVisible, false);
  assert.equal(restored.toolRailSide, "right");
  assert.equal(restored.customPresets.length, 1);
  assert.equal(restored.customPresets[0].name, "My Pixel Desk");
  assert.equal(countAreas(restored.layouts.draw), 4);
  assert.equal(countViewportAreas(restored.layouts.draw), 1);

  // Corrupt JSON falls back safely
  const fallback = deserializeWorkspaceLayouts("{broken");
  assert.equal(countViewportAreas(fallback.layouts.draw), 1);

  // Duplicate viewport in stored JSON is sanitized to 1 viewport
  const dupJson = JSON.stringify({
    version: 1,
    layouts: {
      draw: {
        kind: "split",
        id: "s1",
        direction: "horizontal",
        ratio: 0.5,
        first: { kind: "area", id: "a1", editorType: "viewport" },
        second: { kind: "area", id: "a2", editorType: "viewport" },
      },
    },
  });
  const sanitized = deserializeWorkspaceLayouts(dupJson);
  assert.equal(countViewportAreas(sanitized.layouts.draw), 1);
});

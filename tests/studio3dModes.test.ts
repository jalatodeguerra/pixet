import test from "node:test";
import assert from "node:assert/strict";

import {
  STUDIO3D_FLAT_MODES,
  getStudio3DFlatMode,
  studio3DFlatModePatch,
  studio3DFlatModeShowsTimeline,
  type Studio3DModeFields,
} from "../src/engine/model3d/studio3dModes.ts";

const base: Studio3DModeFields = {
  workspaceKind: "sprite25d",
  mode: "extruded",
  subMode: "model",
};

test("every flat entry round-trips through patch and getter", () => {
  for (const e of STUDIO3D_FLAT_MODES) {
    const next = { ...base, ...studio3DFlatModePatch(e.id) };
    assert.equal(getStudio3DFlatMode(next), e.id);
  }
});

test("entry ids are unique and cover all sprite modes and sub-modes", () => {
  const ids = STUDIO3D_FLAT_MODES.map((e) => e.id);
  assert.equal(new Set(ids).size, ids.length);
  const subs = STUDIO3D_FLAT_MODES.filter((e) => e.subMode).map((e) => e.subMode);
  assert.deepEqual([...subs].sort(), ["animate", "bake", "model", "paint", "tile", "uv"]);
  const sprites = STUDIO3D_FLAT_MODES.filter((e) => e.spriteMode).map((e) => e.spriteMode);
  assert.deepEqual([...sprites].sort(), ["extruded", "rig", "stack"]);
});

test("legacy persisted state maps to expected entries", () => {
  assert.equal(getStudio3DFlatMode({ ...base, mode: "stack" }), "stack");
  assert.equal(getStudio3DFlatMode({ ...base, mode: "rig" }), "rigPreview");
  assert.equal(
    getStudio3DFlatMode({ workspaceKind: "lowpoly3d", mode: "stack", subMode: "uv" }),
    "uv"
  );
});

test("patches only touch the fields the mode owns", () => {
  assert.deepEqual(studio3DFlatModePatch("paint"), {
    workspaceKind: "lowpoly3d",
    subMode: "paint",
  });
  assert.deepEqual(studio3DFlatModePatch("stack"), {
    workspaceKind: "sprite25d",
    mode: "stack",
  });
});

test("timeline shows for sprite modes and low-poly Animate only", () => {
  for (const e of STUDIO3D_FLAT_MODES) {
    const expected = e.kind === "sprite25d" || e.id === "animate";
    assert.equal(studio3DFlatModeShowsTimeline(e.id), expected, e.id);
  }
});

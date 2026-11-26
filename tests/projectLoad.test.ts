import test from "node:test";
import assert from "node:assert/strict";

import { validateProjectTransfer } from "../src/engine/io/projectValidation.ts";

function good(): Record<string, unknown> {
  return {
    document: {
      schema_version: 1,
      name: "a.pixet",
      size: { width: 16, height: 8 },
      color_mode: "rgba",
      palette: { name: "p", colors: ["#000000"] },
      layers: [
        {
          id: "l1",
          name: "Layer 1",
          kind: "raster",
          visible: true,
          locked: false,
          opacity: 1,
          alpha_lock: false,
          blend_mode: "normal",
          parent_id: null,
          cels: [{ id: "c", frame_index: 0, linked_to: null }],
        },
      ],
      frames: [{ id: "f1", index: 0, duration_ms: 100 }],
      tags: [],
    },
    cels: { "l1:0": "AAAA" },
  };
}

/** Returns a good project with the value at a dotted path replaced (undefined deletes). */
function withPath(path: string, value: unknown): unknown {
  const x = good();
  const keys = path.split(".");
  let cur: Record<string, unknown> = x;
  for (const k of keys.slice(0, -1)) {
    const next = cur[k];
    cur = (Array.isArray(next) ? next[0] : next) as Record<string, unknown>;
  }
  const last = keys[keys.length - 1];
  if (value === undefined) delete cur[last];
  else cur[last] = value;
  return x;
}

test("accepts a minimal good project", () => {
  assert.equal(validateProjectTransfer(good()).ok, true);
});

test("accepts old files without optional ext fields and with unknown fields", () => {
  const x = withPath("document.future_field", { a: 1 });
  (x as Record<string, unknown>).extra = true;
  assert.equal(validateProjectTransfer(x).ok, true);
});

test("rejects non-objects and null", () => {
  for (const v of [null, 5, "x", [], undefined]) {
    assert.equal(validateProjectTransfer(v).ok, false);
  }
});

test("rejects missing document / size", () => {
  assert.equal(validateProjectTransfer({ cels: {} }).ok, false);
  const b = validateProjectTransfer(withPath("document.size", undefined));
  assert.equal(b.ok, false);
  if (!b.ok) assert.match(b.error, /size/);
});

test("rejects bad canvas sizes", () => {
  for (const [w, h] of [[-1, 8], [0, 8], [8, 2.5], ["8", 8], [99999, 8]]) {
    const r = validateProjectTransfer(withPath("document.size", { width: w, height: h }));
    assert.equal(r.ok, false, `${w}x${h}`);
  }
});

test("rejects wrong container types", () => {
  assert.equal(validateProjectTransfer(withPath("document.layers", {})).ok, false);
  assert.equal(validateProjectTransfer(withPath("document.frames", "x")).ok, false);
  assert.equal(validateProjectTransfer(withPath("cels", [])).ok, false);
  assert.equal(validateProjectTransfer(withPath("cels", { a: 5 })).ok, false);
  assert.equal(validateProjectTransfer(withPath("tiles", [1])).ok, false);
  assert.equal(validateProjectTransfer(withPath("document.layers.cels", null)).ok, false);
});

test("rejects bad optional fields", () => {
  assert.equal(
    validateProjectTransfer(withPath("document.tileset", { tile_width: 0, tile_height: 8 })).ok,
    false
  );
  assert.equal(validateProjectTransfer(withPath("document.tile_projection", "hex")).ok, false);
});

import test from "node:test";
import assert from "node:assert/strict";

import {
  computeFitZoom,
  panForZoomAtCursor,
  stepZoom,
  ZOOM_STOPS,
} from "../src/engine/ui/zoom.ts";

test("computeFitZoom fits 32x32 into 1100x700 viewport", () => {
  const z = computeFitZoom(32, 32, 900, 600, 32);
  assert.equal(z, 16);
  assert.ok(32 * z <= 600 - 64);
});

test("computeFitZoom is limited by the smaller axis", () => {
  assert.equal(computeFitZoom(256, 256, 1000, 700, 32), 2);
  assert.equal(computeFitZoom(100, 10, 500, 500, 0), 5);
});

test("computeFitZoom floors at 1 and caps at 64", () => {
  assert.equal(computeFitZoom(4096, 4096, 500, 500, 32), 1);
  assert.equal(computeFitZoom(1, 1, 5000, 5000, 32), 64);
  assert.equal(computeFitZoom(0, 0, 500, 500, 32), 1);
  assert.equal(computeFitZoom(32, 32, 10, 10, 32), 1);
});

test("computeFitZoom returns integers", () => {
  for (const w of [17, 33, 100, 250]) {
    assert.ok(Number.isInteger(computeFitZoom(w, w + 3, 913, 641, 32)));
  }
});

test("stepZoom walks the stops", () => {
  assert.equal(stepZoom(1, 1), 2);
  assert.equal(stepZoom(4, 1), 6);
  assert.equal(stepZoom(12, -1), 8);
  assert.equal(stepZoom(64, 1), 64);
  assert.equal(stepZoom(1, -1), 1);
});

test("stepZoom handles off-stop values", () => {
  assert.equal(stepZoom(5, 1), 6);
  assert.equal(stepZoom(5, -1), 4);
  assert.equal(stepZoom(100, -1), 64);
  assert.equal(stepZoom(0, 1), 1);
});

test("stepZoom stops are ascending", () => {
  for (let i = 1; i < ZOOM_STOPS.length; i++) {
    assert.ok(ZOOM_STOPS[i] > ZOOM_STOPS[i - 1]);
  }
});

test("panForZoomAtCursor keeps the point under the cursor fixed", () => {
  const pan = { x: 10, y: -5 };
  const dx = 70;
  const dy = 20;
  const next = panForZoomAtCursor(pan, dx, dy, 4, 8);
  // canvas-space point under cursor before: (d - pan)/zoom
  const before = { x: (dx - pan.x) / 4, y: (dy - pan.y) / 4 };
  const after = { x: (dx - next.x) / 8, y: (dy - next.y) / 8 };
  assert.ok(Math.abs(before.x - after.x) < 1e-9);
  assert.ok(Math.abs(before.y - after.y) < 1e-9);
});

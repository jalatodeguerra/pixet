import test from "node:test";
import assert from "node:assert/strict";

import {
  SAMPLES,
  generateGemSample,
  generateSlimeSample,
  type SampleDocument,
} from "../src/engine/document/samples.ts";
import {
  MAX_RECENT_FILES,
  addRecentPath,
  parseRecentPaths,
  removeRecentPath,
} from "../src/engine/io/recentFiles.ts";

function celsFor(doc: SampleDocument, layerId: string) {
  return doc.cels.filter((c) => c.layerId === layerId);
}

function opaqueCount(data: Uint8ClampedArray): number {
  let n = 0;
  for (let i = 3; i < data.length; i += 4) if (data[i] > 0) n++;
  return n;
}

test("slime sample: 32x32, 6 frames, 3 layers, idle/hop tags", () => {
  const s = generateSlimeSample();
  assert.equal(s.width, 32);
  assert.equal(s.height, 32);
  assert.equal(s.frames.length, 6);
  assert.deepEqual(
    s.layers.map((l) => l.name),
    ["Outline", "Shading", "Base"]
  );
  assert.deepEqual(
    s.tags.map((t) => t.name),
    ["idle", "hop"]
  );
  for (const t of s.tags) {
    assert.ok(t.fromFrame >= 0 && t.toFrame < s.frames.length);
    assert.ok(t.fromFrame <= t.toFrame);
  }
  assert.ok(new Set(s.frames.map((f) => f.durationMs)).size > 1, "varied durations");
  assert.ok(s.frames.every((f) => f.durationMs > 0));
});

test("slime sample: every layer has non-empty cels on every frame", () => {
  const s = generateSlimeSample();
  assert.equal(s.cels.length, s.layers.length * s.frames.length);
  for (const layer of s.layers) {
    const cels = celsFor(s, layer.id);
    assert.equal(cels.length, s.frames.length);
    for (const c of cels) {
      assert.equal(c.data.length, s.width * s.height * 4);
      assert.ok(opaqueCount(c.data) > 0, `${layer.id} frame ${c.frameIndex} empty`);
    }
  }
});

test("slime sample: squash and stretch change the silhouette", () => {
  const s = generateSlimeSample();
  const extent = (frame: number) => {
    let minX = 99, maxX = -1, minY = 99, maxY = -1;
    for (const c of s.cels.filter((x) => x.frameIndex === frame)) {
      for (let y = 0; y < s.height; y++) {
        for (let x = 0; x < s.width; x++) {
          if (c.data[(y * s.width + x) * 4 + 3] > 0) {
            minX = Math.min(minX, x); maxX = Math.max(maxX, x);
            minY = Math.min(minY, y); maxY = Math.max(maxY, y);
          }
        }
      }
    }
    return { w: maxX - minX + 1, h: maxY - minY + 1, maxY };
  };
  const rest = extent(0);
  const launch = extent(2);
  const land = extent(5);
  assert.ok(launch.h > rest.h, "stretches tall on launch");
  assert.ok(land.w > rest.w, "squashes wide on landing");
  assert.ok(extent(3).maxY < rest.maxY, "leaves the ground at the apex");
});

test("gem sample matches the starter document shape", () => {
  const g = generateGemSample();
  assert.equal(g.frames.length, 4);
  assert.equal(g.tags[0].name, "idle");
  assert.equal(g.cels.length, 12);
  for (const c of g.cels) assert.ok(opaqueCount(c.data) > 0);
});

test("SAMPLES registry generates every sample with unique ids", () => {
  assert.equal(new Set(SAMPLES.map((s) => s.id)).size, SAMPLES.length);
  for (const entry of SAMPLES) {
    const doc = entry.generate();
    assert.equal(doc.id, entry.id);
    assert.ok(doc.documentName.endsWith(".pixet"));
  }
});

test("recent files: most recent first, deduped", () => {
  let list: string[] = [];
  list = addRecentPath(list, "/a.pixet");
  list = addRecentPath(list, "/b.pixet");
  list = addRecentPath(list, "/a.pixet");
  assert.deepEqual(list, ["/a.pixet", "/b.pixet"]);
});

test("recent files: capped at 8 and ignores blanks", () => {
  let list: string[] = [];
  for (let i = 0; i < 12; i++) list = addRecentPath(list, `/f${i}.pixet`);
  assert.equal(list.length, MAX_RECENT_FILES);
  assert.equal(list[0], "/f11.pixet");
  assert.equal(list[7], "/f4.pixet");
  assert.deepEqual(addRecentPath(list, "   "), list);
});

test("recent files: remove and tolerant parse", () => {
  assert.deepEqual(removeRecentPath(["/a", "/b"], "/a"), ["/b"]);
  assert.deepEqual(parseRecentPaths(null), []);
  assert.deepEqual(parseRecentPaths("not json"), []);
  assert.deepEqual(parseRecentPaths('{"a":1}'), []);
  assert.deepEqual(parseRecentPaths('["/a", 3, "/a", "", "/b"]'), ["/a", "/b"]);
  const many = JSON.stringify(Array.from({ length: 20 }, (_, i) => `/p${i}`));
  assert.equal(parseRecentPaths(many).length, MAX_RECENT_FILES);
});

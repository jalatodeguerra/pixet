import test from "node:test";
import assert from "node:assert/strict";

import { encodeGif, gifDelayCentiseconds, lzwEncode } from "../src/engine/export/gif.ts";
import { crc32, createZip } from "../src/engine/export/zip.ts";
import {
  generateGodotSpriteFrames,
  generateSpritesheetJson,
  packSpritesheet,
  type SheetSourceFrame,
} from "../src/engine/export/packer.ts";
import { buildFrameSequence } from "../src/engine/export/sequence.ts";
import {
  flattenOnBackground,
  scaleRgbaNearest,
} from "../src/engine/export/raster.ts";

// ---------- LZW / GIF decoding helpers (test-only) ----------

function lzwDecode(data: Uint8Array, minCode: number, pixelCount: number): Uint8Array {
  const clear = 1 << minCode;
  const eoi = clear + 1;
  let size = minCode + 1;
  let table: number[][] = [];
  const reset = (): void => {
    table = [];
    for (let i = 0; i < clear; i++) table.push([i]);
    table.push([]);
    table.push([]);
    size = minCode + 1;
  };
  reset();
  const out: number[] = [];
  let bitPos = 0;
  let prev: number[] | null = null;
  const read = (): number => {
    let v = 0;
    for (let i = 0; i < size; i++) {
      const byte = data[bitPos >> 3];
      v |= ((byte >> (bitPos & 7)) & 1) << i;
      bitPos++;
    }
    return v;
  };
  while (bitPos + size <= data.length * 8) {
    const code = read();
    if (code === clear) {
      reset();
      prev = null;
      continue;
    }
    if (code === eoi) break;
    let entry: number[];
    if (code < table.length) entry = table[code];
    else if (prev) entry = [...prev, prev[0]];
    else throw new Error("bad LZW stream");
    out.push(...entry);
    if (prev) {
      table.push([...prev, entry[0]]);
      if (table.length === 1 << size && size < 12) size++;
    }
    prev = entry;
  }
  assert.equal(out.length, pixelCount);
  return Uint8Array.from(out);
}

interface ParsedFrame {
  delayCs: number;
  disposal: number;
  transparentIndex: number;
  rgba: Uint8Array;
  local: boolean;
}

function parseGif(bytes: Uint8Array) {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const header = String.fromCharCode(...bytes.subarray(0, 6));
  const width = dv.getUint16(6, true);
  const height = dv.getUint16(8, true);
  const packed = bytes[10];
  let pos = 13;
  let gct: Uint8Array | null = null;
  if (packed & 0x80) {
    const n = 2 << (packed & 7);
    gct = bytes.subarray(pos, pos + n * 3);
    pos += n * 3;
  }
  const frames: ParsedFrame[] = [];
  let loopCount: number | null = null;
  let hasNetscape = false;
  let gce = { delay: 0, disposal: 0, trans: -1 };
  for (;;) {
    const b = bytes[pos++];
    if (b === 0x3b) break;
    if (b === 0x21) {
      const label = bytes[pos++];
      if (label === 0xf9) {
        assert.equal(bytes[pos], 4);
        const flags = bytes[pos + 1];
        gce = {
          delay: dv.getUint16(pos + 2, true),
          disposal: (flags >> 2) & 7,
          trans: flags & 1 ? bytes[pos + 4] : -1,
        };
        pos += 6;
      } else if (label === 0xff) {
        const len = bytes[pos++];
        const id = String.fromCharCode(...bytes.subarray(pos, pos + len));
        pos += len;
        if (id === "NETSCAPE2.0") {
          hasNetscape = true;
          assert.equal(bytes[pos], 3);
          loopCount = dv.getUint16(pos + 2, true);
        }
        for (;;) {
          const n = bytes[pos++];
          if (n === 0) break;
          pos += n;
        }
      } else {
        for (;;) {
          const n = bytes[pos++];
          if (n === 0) break;
          pos += n;
        }
      }
    } else if (b === 0x2c) {
      const fw = dv.getUint16(pos + 4, true);
      const fh = dv.getUint16(pos + 6, true);
      const ip = bytes[pos + 8];
      pos += 9;
      let table = gct;
      const local = !!(ip & 0x80);
      if (local) {
        const n = 2 << (ip & 7);
        table = bytes.subarray(pos, pos + n * 3);
        pos += n * 3;
      }
      const minCode = bytes[pos++];
      const chunks: number[] = [];
      for (;;) {
        const n = bytes[pos++];
        if (n === 0) break;
        for (let i = 0; i < n; i++) chunks.push(bytes[pos + i]);
        pos += n;
      }
      const idx = lzwDecode(Uint8Array.from(chunks), minCode, fw * fh);
      const rgba = new Uint8Array(fw * fh * 4);
      for (let p = 0; p < idx.length; p++) {
        if (idx[p] === gce.trans) continue;
        rgba[p * 4] = table![idx[p] * 3];
        rgba[p * 4 + 1] = table![idx[p] * 3 + 1];
        rgba[p * 4 + 2] = table![idx[p] * 3 + 2];
        rgba[p * 4 + 3] = 255;
      }
      frames.push({
        delayCs: gce.delay,
        disposal: gce.disposal,
        transparentIndex: gce.trans,
        rgba,
        local,
      });
    } else {
      throw new Error(`unexpected block 0x${b.toString(16)} at ${pos - 1}`);
    }
  }
  assert.equal(pos, bytes.length, "trailer must be last byte");
  return { header, width, height, frames, hasNetscape, loopCount, hasGlobal: !!gct };
}

function solidFrame(w: number, h: number, px: number[][]): Uint8ClampedArray {
  const out = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) out.set(px[i % px.length], i * 4);
  return out;
}

// ---------- GIF ----------

test("gif: header, trailer, NETSCAPE2.0, frame count and delays", async () => {
  const w = 4;
  const h = 3;
  const frames = [
    { rgba: solidFrame(w, h, [[255, 0, 0, 255], [0, 0, 0, 0]]), delayMs: 100 },
    { rgba: solidFrame(w, h, [[0, 255, 0, 255], [0, 0, 255, 255]]), delayMs: 40 },
    { rgba: solidFrame(w, h, [[10, 20, 30, 255]]), delayMs: 5 },
  ];
  const res = await encodeGif({ width: w, height: h, frames });
  const b = res.bytes;
  assert.equal(String.fromCharCode(...b.subarray(0, 6)), "GIF89a");
  assert.equal(b[b.length - 1], 0x3b);
  assert.ok(Buffer.from(b).includes(Buffer.from("NETSCAPE2.0")));
  assert.equal(res.paletteMode, "global");
  assert.equal(res.colorsReduced, false);

  const g = parseGif(b);
  assert.equal(g.header, "GIF89a");
  assert.equal(g.width, w);
  assert.equal(g.height, h);
  assert.equal(g.frames.length, 3);
  assert.deepEqual(g.frames.map((f) => f.delayCs), [10, 4, 2]);
  assert.ok(g.frames.every((f) => f.disposal === 2));
  assert.equal(g.loopCount, 0);
  // Exact pixel round trip incl. transparency (alpha 0 -> transparent index)
  for (let i = 0; i < frames.length; i++) {
    const src = frames[i].rgba;
    for (let p = 0; p < w * h; p++) {
      const opaque = src[p * 4 + 3] >= 128;
      assert.equal(g.frames[i].rgba[p * 4 + 3], opaque ? 255 : 0);
      if (opaque) {
        assert.deepEqual(
          Array.from(g.frames[i].rgba.subarray(p * 4, p * 4 + 3)),
          Array.from(src.subarray(p * 4, p * 4 + 3))
        );
      }
    }
  }
});

test("gif: play once omits NETSCAPE, delay rounding", async () => {
  const f = { rgba: solidFrame(2, 2, [[1, 2, 3, 255]]), delayMs: 1000 };
  const res = await encodeGif({ width: 2, height: 2, frames: [f], loop: false });
  assert.ok(!Buffer.from(res.bytes).includes(Buffer.from("NETSCAPE2.0")));
  assert.equal(gifDelayCentiseconds(33), 3);
  assert.equal(gifDelayCentiseconds(0), 2);
  assert.equal(gifDelayCentiseconds(16), 2);
  assert.equal(gifDelayCentiseconds(1000), 100);
});

test("gif: alpha threshold 128", async () => {
  const f = {
    rgba: new Uint8ClampedArray([9, 9, 9, 127, 9, 9, 9, 128]),
    delayMs: 50,
  };
  const res = await encodeGif({ width: 2, height: 1, frames: [f] });
  const g = parseGif(res.bytes);
  assert.equal(g.frames[0].rgba[3], 0);
  assert.equal(g.frames[0].rgba[7], 255);
});

test("gif: >256 colours uses local palettes and reports reduction", async () => {
  const w = 32;
  const h = 32; // 1024 distinct colours
  const rgba = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    rgba.set([(i * 7) & 255, (i >> 2) & 255, (i * 13) & 255, 255], i * 4);
  }
  const res = await encodeGif({
    width: w,
    height: h,
    frames: [{ rgba, delayMs: 100 }, { rgba, delayMs: 100 }],
  });
  assert.equal(res.paletteMode, "local");
  assert.equal(res.colorsReduced, true);
  const g = parseGif(res.bytes);
  assert.equal(g.frames.length, 2);
  assert.ok(g.frames.every((f) => f.local));
  assert.equal(g.hasGlobal, false);
});

test("gif: per-frame local palettes stay exact when each frame fits", async () => {
  // 2 frames x 200 unique colours each, disjoint => 400 total (> 256 global)
  const mk = (off: number) => {
    const rgba = new Uint8ClampedArray(200 * 4);
    for (let i = 0; i < 200; i++) rgba.set([i, off, 0, 255], i * 4);
    return rgba;
  };
  const frames = [
    { rgba: mk(1), delayMs: 100 },
    { rgba: mk(2), delayMs: 100 },
  ];
  const res = await encodeGif({ width: 200, height: 1, frames });
  assert.equal(res.paletteMode, "local");
  assert.equal(res.colorsReduced, false);
  const g = parseGif(res.bytes);
  for (let f = 0; f < 2; f++) {
    for (let i = 0; i < 200; i++) {
      assert.deepEqual(
        Array.from(g.frames[f].rgba.subarray(i * 4, i * 4 + 4)),
        Array.from(frames[f].rgba.subarray(i * 4, i * 4 + 4))
      );
    }
  }
});

test("lzw: round trip across table resets and code-size growth", () => {
  let seed = 12345;
  const rnd = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed;
  };
  for (const bits of [2, 3, 5, 8]) {
    for (const len of [1, 2, 17, 5000, 70000]) {
      const idx = new Uint8Array(len);
      for (let i = 0; i < len; i++) {
        idx[i] = (rnd() >> 8) % (1 << bits);
      }
      const min = Math.max(2, bits);
      const enc = lzwEncode(idx, min);
      assert.deepEqual(Array.from(lzwDecode(enc, min, len)), Array.from(idx));
    }
  }
  // highly compressible
  const flat = new Uint8Array(100000).fill(1);
  assert.deepEqual(
    Array.from(lzwDecode(lzwEncode(flat, 2), 2, flat.length)),
    Array.from(flat)
  );
});

// ---------- ZIP ----------

test("zip: crc32 check value", () => {
  assert.equal(crc32(new TextEncoder().encode("123456789")), 0xcbf43926);
  assert.equal(crc32(new Uint8Array(0)), 0);
});

test("zip: structure, central directory count, stored data", () => {
  const entries = [
    { name: "a_0000.png", data: new Uint8Array([1, 2, 3, 4]) },
    { name: "a_0001.png", data: new Uint8Array([]) },
    { name: "dir/üñí.txt", data: new TextEncoder().encode("hello") },
  ];
  const zip = createZip(entries);
  const dv = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
  const eocd = zip.length - 22;
  assert.equal(dv.getUint32(eocd, true), 0x06054b50);
  assert.equal(dv.getUint16(eocd + 8, true), 3);
  assert.equal(dv.getUint16(eocd + 10, true), 3);
  const cdSize = dv.getUint32(eocd + 12, true);
  const cdOff = dv.getUint32(eocd + 16, true);
  assert.equal(cdOff + cdSize, eocd);

  let pos = cdOff;
  const seen: string[] = [];
  for (let i = 0; i < 3; i++) {
    assert.equal(dv.getUint32(pos, true), 0x02014b50);
    assert.equal(dv.getUint16(pos + 10, true), 0, "method = stored");
    const crc = dv.getUint32(pos + 16, true);
    const size = dv.getUint32(pos + 24, true);
    const nameLen = dv.getUint16(pos + 28, true);
    const lho = dv.getUint32(pos + 42, true);
    const name = new TextDecoder().decode(zip.subarray(pos + 46, pos + 46 + nameLen));
    seen.push(name);
    assert.equal(dv.getUint32(lho, true), 0x04034b50);
    const lnl = dv.getUint16(lho + 26, true);
    const data = zip.subarray(lho + 30 + lnl, lho + 30 + lnl + size);
    assert.equal(crc32(data), crc);
    assert.deepEqual(Array.from(data), Array.from(entries[i].data));
    pos += 46 + nameLen;
  }
  assert.deepEqual(seen, entries.map((e) => e.name));
  assert.equal(pos, eocd);
});

// ---------- sequence / raster ----------

test("sequence: tag ranges and directions", () => {
  assert.deepEqual(buildFrameSequence(4, null), [0, 1, 2, 3]);
  assert.deepEqual(buildFrameSequence(6, { fromFrame: 1, toFrame: 3 }), [1, 2, 3]);
  assert.deepEqual(
    buildFrameSequence(6, { fromFrame: 1, toFrame: 3, direction: "reverse" }),
    [3, 2, 1]
  );
  assert.deepEqual(
    buildFrameSequence(6, { fromFrame: 0, toFrame: 3, direction: "pingpong" }),
    [0, 1, 2, 3, 2, 1]
  );
  assert.deepEqual(buildFrameSequence(3, { fromFrame: 1, toFrame: 99 }), [1, 2]);
  assert.deepEqual(buildFrameSequence(0, null), []);
});

test("raster: nearest scale and background flatten", () => {
  const src = new Uint8ClampedArray([1, 2, 3, 255, 4, 5, 6, 255]);
  const s = scaleRgbaNearest(src, 2, 1, 3);
  assert.equal(s.length, 6 * 3 * 4);
  assert.deepEqual(Array.from(s.subarray(0, 4)), [1, 2, 3, 255]);
  assert.deepEqual(Array.from(s.subarray(5 * 4, 6 * 4)), [4, 5, 6, 255]);
  assert.deepEqual(Array.from(s.subarray(12 * 4 + 0, 12 * 4 + 4)), [1, 2, 3, 255]);
  const f = flattenOnBackground(new Uint8ClampedArray([0, 0, 0, 0, 255, 0, 0, 255]), {
    r: 10,
    g: 20,
    b: 30,
  });
  assert.deepEqual(Array.from(f), [10, 20, 30, 255, 255, 0, 0, 255]);
});

// ---------- packer parity with crates/pixet-core/src/export.rs tests ----------

// Mirrors make_sample_project(): 8x8, 4 frames, 2x2 block (91,140,255) at x=f, y=2.
function sampleFrames(): SheetSourceFrame[] {
  const out: SheetSourceFrame[] = [];
  for (let f = 0; f < 4; f++) {
    const rgba = new Uint8ClampedArray(8 * 8 * 4);
    for (let dy = 0; dy < 2; dy++) {
      for (let dx = 0; dx < 2; dx++) {
        const i = ((2 + dy) * 8 + (f + dx)) * 4;
        rgba.set([91, 140, 255, 255], i);
      }
    }
    out.push({ frameIndex: f, durationMs: 100, rgba });
  }
  return out;
}

const SAMPLE_TAGS = [{ name: "idle", fromFrame: 0, toFrame: 3, color: "#5b8cff" }];

test("packer: grid with extrude 1, padding 1 (Rust: 21x21)", () => {
  const grid = packSpritesheet(sampleFrames(), 8, 8, {
    pack: "grid",
    trim: false,
    extrude: 1,
    padding: 1,
  });
  assert.equal(grid.width, 21);
  assert.equal(grid.height, 21);
  assert.equal(grid.frames.length, 4);
  // Cells are 10px + 1px padding, content offset by extrude.
  assert.deepEqual(
    grid.frames.map((f) => [f.x, f.y]),
    [[1, 1], [12, 1], [1, 12], [12, 12]]
  );
  const f0 = grid.frames[0];
  const idx = ((f0.y + 2) * grid.width + (f0.x - 1)) * 4;
  assert.equal(grid.rgba[idx + 2], 255);
  assert.equal(grid.rgba[idx + 3], 255);
  // Corner extrusion: top-left source pixel is transparent, so stays 0
  assert.equal(grid.rgba[((f0.y - 1) * grid.width + (f0.x - 1)) * 4 + 3], 0);
});

test("packer: tight with trim (Rust: 2x2 trimmed, sheet <= 12)", () => {
  const tight = packSpritesheet(sampleFrames(), 8, 8, {
    pack: "tight",
    trim: true,
    extrude: 0,
    padding: 1,
  });
  assert.equal(tight.frames.length, 4);
  assert.ok(tight.frames.every((f) => f.trimmed && f.w === 2 && f.h === 2));
  assert.ok(tight.width <= 12 && tight.height <= 12);
  // Source offsets follow the painted block
  assert.deepEqual(
    tight.frames.map((f) => [f.sourceX, f.sourceY]),
    [[0, 2], [1, 2], [2, 2], [3, 2]]
  );
  // Items are 3x3 in an 8x8 bin; MaxRects best-short-side-fit result
  assert.deepEqual(
    tight.frames.map((f) => [f.x, f.y]),
    [[0, 0], [3, 0], [0, 3], [3, 3]]
  );
  assert.equal(tight.width, 5);
  assert.equal(tight.height, 5);
  // Pixels were blitted
  const f1 = tight.frames[1];
  assert.deepEqual(
    Array.from(tight.rgba.subarray((f1.y * tight.width + f1.x) * 4, (f1.y * tight.width + f1.x) * 4 + 4)),
    [91, 140, 255, 255]
  );
});

test("packer: tight with extrude and fully empty frame", () => {
  const frames = sampleFrames();
  frames[2] = { frameIndex: 2, durationMs: 100, rgba: new Uint8ClampedArray(8 * 8 * 4) };
  const sheet = packSpritesheet(frames, 8, 8, {
    pack: "tight",
    trim: true,
    extrude: 1,
    padding: 0,
  });
  const empty = sheet.frames[2];
  assert.equal(empty.w, 1);
  assert.equal(empty.h, 1);
  assert.equal(empty.trimmed, true);
  assert.equal(empty.sourceX, 0);
  // all rects stay in bounds and do not overlap
  const rects = sheet.frames.map((f) => ({
    x: f.x - 1,
    y: f.y - 1,
    w: f.w + 2,
    h: f.h + 2,
  }));
  for (const r of rects) {
    assert.ok(r.x >= 0 && r.y >= 0 && r.x + r.w <= sheet.width && r.y + r.h <= sheet.height);
  }
  for (let i = 0; i < rects.length; i++) {
    for (let j = i + 1; j < rects.length; j++) {
      const a = rects[i];
      const b = rects[j];
      const overlap = !(a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y);
      assert.equal(overlap, false);
    }
  }
});

test("packer: JSON metadata matches Rust shape (key order, tags, trimmed)", () => {
  const sheet = packSpritesheet(sampleFrames(), 8, 8, {
    pack: "tight",
    trim: true,
    extrude: 0,
    padding: 1,
  });
  const text = generateSpritesheetJson("hero.pixet", SAMPLE_TAGS, sheet, "hero.png");
  const parsed = JSON.parse(text);
  assert.equal(parsed.frames.length, 4);
  assert.equal(parsed.meta.image, "hero.png");
  assert.equal(parsed.meta.frameTags[0].name, "idle");
  assert.equal(parsed.meta.frameTags[0].direction, "forward");
  assert.equal(parsed.meta.app, "pixet");
  assert.equal(parsed.meta.format, "RGBA8888");
  assert.equal(parsed.meta.scale, "1");
  assert.equal(parsed.frames[1].filename, "hero_1.png");
  assert.deepEqual(parsed.frames[1].spriteSourceSize, { h: 2, w: 2, x: 1, y: 2 });
  assert.deepEqual(parsed.frames[1].sourceSize, { h: 8, w: 8 });
  assert.equal(parsed.frames[1].trimmed, true);
  assert.equal(parsed.frames[1].duration, 100);
  // serde_json (no preserve_order) writes keys alphabetically
  assert.deepEqual(Object.keys(parsed), ["frames", "meta"]);
  assert.deepEqual(Object.keys(parsed.frames[0]), [
    "duration", "filename", "frame", "rotated", "sourceSize", "spriteSourceSize", "trimmed",
  ]);
  assert.deepEqual(Object.keys(parsed.meta), [
    "app", "format", "frameTags", "image", "scale", "size", "version",
  ]);
  assert.ok(text.includes('"rotated": false'));
});

test("packer: Godot SpriteFrames text matches Rust output", () => {
  const sheet = packSpritesheet(sampleFrames(), 8, 8, {
    pack: "tight",
    trim: true,
    extrude: 0,
    padding: 1,
  });
  const tres = generateGodotSpriteFrames(SAMPLE_TAGS, sheet, "hero.png");
  assert.ok(tres.includes('[gd_resource type="SpriteFrames" load_steps=6 format=3]'));
  assert.ok(tres.includes('path="res://hero.png"'));
  assert.ok(tres.includes('[sub_resource type="AtlasTexture" id="AtlasTexture_0"]'));
  assert.ok(tres.includes('"name": &"idle"'));
  assert.ok(tres.includes("margin = Rect2(0, 2, 6, 6)"));
  assert.ok(tres.includes("region = Rect2(3, 0, 2, 2)"));
  assert.ok(tres.includes('"duration": 1.00'));
  assert.ok(tres.includes('"speed": 10.00'));
  assert.ok(tres.endsWith("]\n"));
  const noTags = generateGodotSpriteFrames([], sheet, "hero.png");
  assert.ok(noTags.includes('"name": &"default"'));
});

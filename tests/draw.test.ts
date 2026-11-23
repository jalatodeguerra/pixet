import test from "node:test";
import assert from "node:assert/strict";

import {
  getBrushFootprint,
  sampleStrokePoints,
  type BrushConfig,
  type CustomBrushData,
} from "../src/engine/tools/brush.ts";
import {
  buildFootprintOutlinePath,
  computeBrushOverlayFootprint,
} from "../src/engine/tools/drawOverlayGeometry.ts";
import { applyInkPixel } from "../src/engine/tools/ink.ts";
import { expandBrushFootprint, plotBresenhamLine } from "../src/engine/tools/pixelAlgos.ts";

function makeCfg(overrides: Partial<BrushConfig> = {}): BrushConfig {
  return {
    shape: "circle",
    size: 1,
    opacity: 100,
    pixelPerfect: false,
    spacing: 1,
    ...overrides,
  };
}

function coordsSet(points: ReadonlyArray<{ x: number; y: number }>): Set<string> {
  return new Set(points.map((p) => `${p.x},${p.y}`));
}

test("getBrushFootprint: circle matches expandBrushFootprint and clamps size 1..64", () => {
  for (const size of [1, 2, 3, 5]) {
    const fp = getBrushFootprint(10, 20, makeCfg({ shape: "circle", size, opacity: 50 }));
    const expected = expandBrushFootprint(10, 20, size);
    assert.equal(fp.length, expected.length);
    assert.deepEqual(coordsSet(fp), coordsSet(expected));
    for (const px of fp) {
      assert.equal(px.alpha, 0.5);
      assert.equal(px.rgba, undefined);
    }
  }

  // Size 1 = single pixel, size 2 = 2x2
  assert.deepEqual(
    getBrushFootprint(4, 7, makeCfg({ shape: "circle", size: 1 })),
    [{ x: 4, y: 7, alpha: 1 }]
  );
  assert.equal(
    getBrushFootprint(4, 7, makeCfg({ shape: "circle", size: 2 })).length,
    4
  );

  // Clamping: <= 0 clamps to 1, > 64 clamps to 64
  assert.deepEqual(
    getBrushFootprint(0, 0, makeCfg({ shape: "circle", size: 0 })),
    getBrushFootprint(0, 0, makeCfg({ shape: "circle", size: 1 }))
  );
  assert.deepEqual(
    getBrushFootprint(0, 0, makeCfg({ shape: "circle", size: -5 })),
    getBrushFootprint(0, 0, makeCfg({ shape: "circle", size: 1 }))
  );
  assert.equal(
    getBrushFootprint(0, 0, makeCfg({ shape: "circle", size: 100 })).length,
    getBrushFootprint(0, 0, makeCfg({ shape: "circle", size: 64 })).length
  );
});

test("getBrushFootprint: square produces size x size centered footprint", () => {
  for (const size of [1, 2, 3, 5]) {
    const fp = getBrushFootprint(5, 5, makeCfg({ shape: "square", size }));
    assert.equal(fp.length, size * size);
  }

  // Size 3 centered on (5, 5) spans 4..6 x 4..6
  const fp3 = getBrushFootprint(5, 5, makeCfg({ shape: "square", size: 3 }));
  const s3 = coordsSet(fp3);
  for (let y = 4; y <= 6; y++) {
    for (let x = 4; x <= 6; x++) {
      assert.ok(s3.has(`${x},${y}`), `missing (${x},${y})`);
    }
  }

  // Size 65 clamps to 64 -> 64*64
  const fpClamped = getBrushFootprint(0, 0, makeCfg({ shape: "square", size: 99 }));
  assert.equal(fpClamped.length, 64 * 64);
});

test("getBrushFootprint: diamond produces Manhattan-distance centered footprints", () => {
  // Size 1 -> 1 pixel
  assert.deepEqual(
    coordsSet(getBrushFootprint(10, 10, makeCfg({ shape: "diamond", size: 1 }))),
    new Set(["10,10"])
  );

  // Size 2 -> 2x2 (4 pixels)
  assert.deepEqual(
    coordsSet(getBrushFootprint(10, 10, makeCfg({ shape: "diamond", size: 2 }))),
    new Set(["10,10", "11,10", "10,11", "11,11"])
  );

  // Size 3 -> 5-pixel plus/diamond
  assert.deepEqual(
    coordsSet(getBrushFootprint(10, 10, makeCfg({ shape: "diamond", size: 3 }))),
    new Set(["10,10", "9,10", "11,10", "10,9", "10,11"])
  );

  // Size 5 -> 13-pixel diamond (1 + 4 + 8)
  const fp5 = getBrushFootprint(10, 10, makeCfg({ shape: "diamond", size: 5 }));
  assert.equal(fp5.length, 13);
  const s5 = coordsSet(fp5);
  assert.ok(!s5.has("8,8"));
  assert.ok(s5.has("8,10"));
  assert.ok(s5.has("12,10"));
  assert.ok(s5.has("10,8"));
  assert.ok(s5.has("10,12"));
  assert.ok(s5.has("9,9"));
  assert.ok(s5.has("11,11"));
});

test("getBrushFootprint: diagonalL and diagonalR footprints at sizes 1, 2, 3, 5", () => {
  // diagonalL '\'
  assert.deepEqual(
    coordsSet(getBrushFootprint(10, 10, makeCfg({ shape: "diagonalL", size: 1 }))),
    new Set(["10,10"])
  );
  assert.deepEqual(
    coordsSet(getBrushFootprint(10, 10, makeCfg({ shape: "diagonalL", size: 2 }))),
    new Set(["10,10", "11,11"])
  );
  assert.deepEqual(
    coordsSet(getBrushFootprint(10, 10, makeCfg({ shape: "diagonalL", size: 3 }))),
    new Set(["9,9", "10,10", "11,11"])
  );
  assert.deepEqual(
    coordsSet(getBrushFootprint(10, 10, makeCfg({ shape: "diagonalL", size: 5 }))),
    new Set(["8,8", "9,9", "10,10", "11,11", "12,12"])
  );

  // diagonalR '/'
  assert.deepEqual(
    coordsSet(getBrushFootprint(10, 10, makeCfg({ shape: "diagonalR", size: 1 }))),
    new Set(["10,10"])
  );
  assert.deepEqual(
    coordsSet(getBrushFootprint(10, 10, makeCfg({ shape: "diagonalR", size: 2 }))),
    new Set(["10,11", "11,10"])
  );
  assert.deepEqual(
    coordsSet(getBrushFootprint(10, 10, makeCfg({ shape: "diagonalR", size: 3 }))),
    new Set(["9,11", "10,10", "11,9"])
  );
  assert.deepEqual(
    coordsSet(getBrushFootprint(10, 10, makeCfg({ shape: "diagonalR", size: 5 }))),
    new Set(["8,12", "9,11", "10,10", "11,9", "12,8"])
  );
});

test("getBrushFootprint: custom rgba and mask brushes skip alpha=0 and compute alpha/rgba", () => {
  // 3x2 brush:
  // (0,0)=red opaque, (1,0)=transparent, (2,0)=green 128
  // (0,1)=transparent, (1,1)=blue opaque, (2,1)=transparent
  const pixels = new Uint8ClampedArray([
    255, 0, 0, 255,   0, 0, 0, 0,     0, 255, 0, 128,
    0, 0, 0, 0,       0, 0, 255, 255, 0, 0, 0, 0,
  ]);

  const rgbaBrush: CustomBrushData = {
    id: "b1",
    name: "RGBA Test",
    width: 3,
    height: 2,
    pixels,
    colorMode: "rgba",
  };

  // Centered around (10, 10): offsetX = -1, offsetY = 0
  const rgbaFp = getBrushFootprint(
    10,
    10,
    makeCfg({ shape: "custom", opacity: 80, customBrush: rgbaBrush })
  );
  assert.equal(rgbaFp.length, 3);
  assert.deepEqual(rgbaFp[0], {
    x: 9,
    y: 10,
    alpha: 0.8,
    rgba: [255, 0, 0, 255],
  });
  assert.equal(rgbaFp[1].x, 11);
  assert.equal(rgbaFp[1].y, 10);
  assert.ok(Math.abs(rgbaFp[1].alpha - (128 / 255) * 0.8) < 1e-6);
  assert.deepEqual(rgbaFp[1].rgba, [0, 255, 0, 128]);
  assert.deepEqual(rgbaFp[2], {
    x: 10,
    y: 11,
    alpha: 0.8,
    rgba: [0, 0, 255, 255],
  });

  const maskBrush: CustomBrushData = {
    ...rgbaBrush,
    id: "b2",
    colorMode: "mask",
  };
  const maskFp = getBrushFootprint(
    10,
    10,
    makeCfg({ shape: "custom", opacity: 50, customBrush: maskBrush })
  );
  assert.equal(maskFp.length, 3);
  for (const px of maskFp) {
    assert.equal(px.rgba, undefined);
  }
  assert.ok(Math.abs(maskFp[0].alpha - 0.5) < 1e-6);
  assert.ok(Math.abs(maskFp[1].alpha - (128 / 255) * 0.5) < 1e-6);
  assert.ok(Math.abs(maskFp[2].alpha - 0.5) < 1e-6);

  // Missing customBrush returns empty array
  assert.deepEqual(
    getBrushFootprint(0, 0, makeCfg({ shape: "custom", customBrush: null })),
    []
  );
});

test("sampleStrokePoints: spacing 1 matches Bresenham, spacing 3 samples with start and end", () => {
  const full = plotBresenhamLine(0, 0, 7, 2);
  const s1 = sampleStrokePoints(0, 0, 7, 2, 1);
  assert.deepEqual(s1, full);

  // Line length is 8 (indices 0..7); step 3 -> indices 0, 3, 6, plus end index 7
  const s3 = sampleStrokePoints(0, 0, 7, 2, 3);
  assert.deepEqual(s3, [full[0], full[3], full[6], full[7]]);

  // Exact multiple length: 0..6 (7 points) with spacing 3 -> indices 0, 3, 6 (no duplicate end)
  const fullExact = plotBresenhamLine(0, 0, 6, 0);
  const s3Exact = sampleStrokePoints(0, 0, 6, 0, 3);
  assert.deepEqual(s3Exact, [fullExact[0], fullExact[3], fullExact[6]]);

  // Zero-length stroke returns single point
  assert.deepEqual(sampleStrokePoints(3, 4, 3, 4, 3), [{ x: 3, y: 4 }]);
});

test("applyInkPixel: simple mode replaces RGBA, scales alpha by opacity, and skips identical", () => {
  assert.deepEqual(
    applyInkPixel([10, 20, 30, 255], [200, 100, 50, 255], 0, 0, "simple"),
    [200, 100, 50, 255]
  );

  assert.deepEqual(
    applyInkPixel([0, 0, 0, 0], [200, 100, 50, 200], 0, 0, "simple", { opacity: 50 }),
    [200, 100, 50, 100]
  );

  // Identical to dst -> null
  assert.equal(
    applyInkPixel([200, 100, 50, 255], [200, 100, 50, 255], 0, 0, "simple"),
    null
  );
});

test("applyInkPixel: alphaBlend performs Porter-Duff source-over blending", () => {
  // Opaque src over opaque dst
  assert.deepEqual(
    applyInkPixel([10, 20, 30, 255], [200, 100, 50, 255], 0, 0, "alphaBlend"),
    [200, 100, 50, 255]
  );

  // Semi-transparent src over transparent dst
  assert.deepEqual(
    applyInkPixel([0, 0, 0, 0], [200, 100, 50, 255], 0, 0, "alphaBlend", { opacity: 50 }),
    [200, 100, 50, 128]
  );

  // 50% opaque red (255,0,0) over 100% opaque blue (0,0,255) -> (128,0,128,255)
  assert.deepEqual(
    applyInkPixel([0, 0, 255, 255], [255, 0, 0, 255], 0, 0, "alphaBlend", { opacity: 50 }),
    [128, 0, 128, 255]
  );

  // Semi-transparent over semi-transparent:
  // src = (200, 0, 0, 255) at 50% opacity (sa = 0.5)
  // dst = (0, 200, 0, 128) (da = 128/255)
  const sa = 0.5;
  const da = 128 / 255;
  const outA = sa + da * (1 - sa);
  const expectedR = Math.round((200 * sa) / outA);
  const expectedG = Math.round((200 * da * (1 - sa)) / outA);
  const expectedA = Math.round(outA * 255);
  assert.deepEqual(
    applyInkPixel([0, 200, 0, 128], [200, 0, 0, 255], 0, 0, "alphaBlend", { opacity: 50 }),
    [expectedR, expectedG, 0, expectedA]
  );

  // Zero effective src alpha -> null
  assert.equal(
    applyInkPixel([10, 20, 30, 255], [200, 100, 50, 0], 0, 0, "alphaBlend"),
    null
  );
  assert.equal(
    applyInkPixel([10, 20, 30, 255], [200, 100, 50, 255], 0, 0, "alphaBlend", { opacity: 0 }),
    null
  );
});

test("applyInkPixel: shadingRamp steps along ramp, clamps at bounds, skips transparent dst", () => {
  const ramp: [number, number, number, number][] = [
    [20, 20, 40, 255],
    [80, 80, 120, 255],
    [160, 180, 210, 255],
  ];

  // Transparent dst -> null
  assert.equal(
    applyInkPixel([20, 20, 40, 0], [0, 0, 0, 255], 0, 0, "shadingRamp", {
      shadingRamp: ramp,
      shadingDirection: 1,
    }),
    null
  );

  // Step up (+1) from closest ramp entry, preserving dst alpha
  assert.deepEqual(
    applyInkPixel([25, 22, 42, 180], [0, 0, 0, 255], 0, 0, "shadingRamp", {
      shadingRamp: ramp,
      shadingDirection: 1,
    }),
    [80, 80, 120, 180]
  );

  // Clamp at top bound -> if dst already equals top ramp color, returns null
  assert.equal(
    applyInkPixel([160, 180, 210, 255], [0, 0, 0, 255], 0, 0, "shadingRamp", {
      shadingRamp: ramp,
      shadingDirection: 1,
    }),
    null
  );

  // Step down (-1)
  assert.deepEqual(
    applyInkPixel([160, 180, 210, 255], [0, 0, 0, 255], 0, 0, "shadingRamp", {
      shadingRamp: ramp,
      shadingDirection: -1,
    }),
    [80, 80, 120, 255]
  );

  // Clamp at bottom bound -> no-op null when already equal
  assert.equal(
    applyInkPixel([20, 20, 40, 255], [0, 0, 0, 255], 0, 0, "shadingRamp", {
      shadingRamp: ramp,
      shadingDirection: -1,
    }),
    null
  );
});

test("applyInkPixel: replaceColor writes only on exact secondaryRgba match", () => {
  const secondary: [number, number, number, number] = [10, 20, 30, 255];

  // Match -> write src
  assert.deepEqual(
    applyInkPixel([10, 20, 30, 255], [255, 0, 0, 255], 0, 0, "replaceColor", {
      secondaryRgba: secondary,
    }),
    [255, 0, 0, 255]
  );

  // Mismatch (even only alpha differs) -> null
  assert.equal(
    applyInkPixel([10, 20, 30, 254], [255, 0, 0, 255], 0, 0, "replaceColor", {
      secondaryRgba: secondary,
    }),
    null
  );
  assert.equal(
    applyInkPixel([11, 20, 30, 255], [255, 0, 0, 255], 0, 0, "replaceColor", {
      secondaryRgba: secondary,
    }),
    null
  );
});

test("applyInkPixel: lockAlpha preserves dst alpha and skips transparent dst", () => {
  // Transparent dst -> null
  assert.equal(
    applyInkPixel([10, 20, 30, 0], [255, 0, 0, 255], 0, 0, "lockAlpha"),
    null
  );

  // Opaque/semi-transparent dst keeps dst[3] while taking src RGB
  assert.deepEqual(
    applyInkPixel([10, 20, 30, 120], [255, 0, 0, 255], 0, 0, "lockAlpha"),
    [255, 0, 0, 120]
  );

  // Opacity < 100 blends RGB while keeping dst[3]
  assert.deepEqual(
    applyInkPixel([0, 0, 200, 100], [200, 0, 0, 255], 0, 0, "lockAlpha", {
      opacity: 50,
    }),
    [100, 0, 100, 100]
  );
});

test("applyInkPixel: dither uses 4x4 Bayer matrix threshold", () => {
  const dst: [number, number, number, number] = [0, 0, 0, 0];
  const src: [number, number, number, number] = [255, 255, 255, 255];

  // Threshold 0.5 produces exact 8-of-16 50% checkerboard pattern
  let hits = 0;
  const grid: number[][] = [];
  for (let y = 0; y < 4; y++) {
    const row: number[] = [];
    for (let x = 0; x < 4; x++) {
      const res = applyInkPixel(dst, src, x, y, "dither", { ditherThreshold: 0.5 });
      const plotted = res !== null ? 1 : 0;
      hits += plotted;
      row.push(plotted);
    }
    grid.push(row);
  }
  assert.equal(hits, 8);
  assert.deepEqual(grid, [
    [1, 0, 1, 0],
    [0, 1, 0, 1],
    [1, 0, 1, 0],
    [0, 1, 0, 1],
  ]);

  // Negative coordinates wrap cleanly via modulo 4
  assert.deepEqual(
    applyInkPixel(dst, src, -4, -4, "dither", { ditherThreshold: 0.5 }),
    src
  );
  assert.equal(
    applyInkPixel(dst, src, -3, -4, "dither", { ditherThreshold: 0.5 }),
    null
  );

  // Threshold 0 -> never plots; threshold 1 -> always plots
  assert.equal(
    applyInkPixel(dst, src, 0, 0, "dither", { ditherThreshold: 0 }),
    null
  );
  assert.deepEqual(
    applyInkPixel(dst, src, 0, 2, "dither", { ditherThreshold: 1 }),
    src
  );
});

test("drawOverlayGeometry: buildFootprintOutlinePath traces outer boundary without shared interior edges", () => {
  // Single pixel -> 4 outer edges
  assert.equal(
    buildFootprintOutlinePath([{ x: 2, y: 3 }]),
    "M2 3h1M2 4h1M2 3v1M3 3v1"
  );

  // Adjacent 2x1 horizontal pixels -> 6 outer edges (no interior vertical edge at x=3)
  const path2x1 = buildFootprintOutlinePath([
    { x: 2, y: 3 },
    { x: 3, y: 3 },
    { x: 2, y: 3 }, // duplicate ignored
  ]);
  assert.ok(!path2x1.includes("M3 3v1"));
  assert.equal(path2x1, "M2 3h1M2 4h1M2 3v1M3 3h1M3 4h1M4 3v1");
});

test("drawOverlayGeometry: computeBrushOverlayFootprint handles symmetry, clamping, and seamlessWrap", () => {
  // Symmetry X mirrors a 1x1 brush on an 8x8 canvas
  const sym = computeBrushOverlayFootprint(
    1,
    2,
    makeCfg({ shape: "square", size: 1 }),
    8,
    8,
    true,
    false,
    false
  );
  assert.deepEqual(coordsSet(sym.cells), new Set(["1,2", "6,2"]));
  assert.ok(sym.outlinePath.length > 0);

  // Without wrap, edge overhang is clipped to canvas bounds; with wrap, it wraps around
  const noWrap = computeBrushOverlayFootprint(
    0,
    0,
    makeCfg({ shape: "square", size: 3 }),
    8,
    8,
    false,
    false,
    false
  );
  assert.equal(noWrap.cells.length, 4); // (0,0),(1,0),(0,1),(1,1)

  const wrapped = computeBrushOverlayFootprint(
    0,
    0,
    makeCfg({ shape: "square", size: 3 }),
    8,
    8,
    false,
    false,
    true
  );
  assert.equal(wrapped.cells.length, 9);
  assert.ok(coordsSet(wrapped.cells).has("7,7"));
});

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
import {
  applyViewCheckFilter,
  mapFlippedPoint,
} from "../src/engine/tools/viewChecks.ts";
import {
  buildCustomGridLines,
  snapCoordToGuides,
  snapPointToGuides,
  type GuideLine,
} from "../src/engine/tools/guides.ts";
import {
  fuzzyMatchCommands,
  type CommandEntry,
} from "../src/engine/tools/commandMatcher.ts";
import { PixelBuffer, type RGBA } from "../src/engine/document/PixelBuffer.ts";
import { shouldPlotDither, type DitherPattern } from "../src/engine/tools/dither.ts";
import { renderGradientToBuffer } from "../src/engine/tools/gradient.ts";
import {
  plotCubicBezier,
  plotPolygon,
  plotQuadraticBezier,
} from "../src/engine/tools/curves.ts";
import { expandSymmetryV2, type SymmetryConfig } from "../src/engine/tools/symmetry.ts";
import {
  applyJumbleFootprint,
  captureCustomBrush,
  flipCustomBrushH,
  flipCustomBrushV,
  generateSprayPoints,
  rotateCustomBrushCW,
} from "../src/engine/tools/sprayJumble.ts";
import { expandSymmetry, floodFill } from "../src/engine/tools/pixelAlgos.ts";
import {
  combineSelectionMasks,
  createRectSelection,
  SelectionMask,
} from "../src/engine/tools/selection.ts";

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

test("viewChecks: mapFlippedPoint round-trips for all 4 (flipH, flipV) combinations", () => {
  const width = 32;
  const height = 24;
  const points = [
    { x: 0, y: 0 },
    { x: 31, y: 23 },
    { x: 7, y: 15 },
    { x: 16, y: 12 },
  ];

  const combos: Array<[boolean, boolean]> = [
    [false, false],
    [true, false],
    [false, true],
    [true, true],
  ];

  for (const [flipH, flipV] of combos) {
    for (const pt of points) {
      const mapped = mapFlippedPoint(pt, width, height, flipH, flipV);
      assert.deepEqual(mapped, {
        x: flipH ? width - 1 - pt.x : pt.x,
        y: flipV ? height - 1 - pt.y : pt.y,
      });
      const roundTrip = mapFlippedPoint(mapped, width, height, flipH, flipV);
      assert.deepEqual(roundTrip, pt);
    }
  }
});

test("viewChecks: applyViewCheckFilter handles grayscale, silhouette, precedence, alpha, and non-mutation", () => {
  // Pixels:
  // 0: opaque red-ish (200, 100, 50, 255)
  // 1: semi-transparent green (20, 180, 40, 128)
  // 2: fully transparent non-zero RGB (255, 255, 255, 0)
  const src = new Uint8ClampedArray([
    200, 100, 50, 255,
    20, 180, 40, 128,
    255, 255, 255, 0,
  ]);
  const snapshot = new Uint8ClampedArray(src);

  // Neither enabled -> returns distinct copy with identical bytes
  const noop = applyViewCheckFilter(src, { grayscale: false, silhouette: false });
  assert.notEqual(noop, src);
  assert.deepEqual(noop, src);
  noop[0] = 0;
  assert.deepEqual(src, snapshot);

  // Grayscale Rec. 709 luminance preserving alpha and skipping a=0
  const gray = applyViewCheckFilter(src, { grayscale: true, silhouette: false });
  const l0 = Math.round(0.2126 * 200 + 0.7152 * 100 + 0.0722 * 50);
  const l1 = Math.round(0.2126 * 20 + 0.7152 * 180 + 0.0722 * 40);
  assert.deepEqual(
    gray,
    new Uint8ClampedArray([
      l0, l0, l0, 255,
      l1, l1, l1, 128,
      255, 255, 255, 0,
    ])
  );
  assert.deepEqual(src, snapshot);

  // Silhouette default color [20, 20, 20] preserves alpha and ignores grayscale when both true
  const silDefault = applyViewCheckFilter(src, { grayscale: true, silhouette: true });
  assert.deepEqual(
    silDefault,
    new Uint8ClampedArray([
      20, 20, 20, 255,
      20, 20, 20, 128,
      255, 255, 255, 0,
    ])
  );
  assert.deepEqual(src, snapshot);

  // Custom silhouetteColor
  const silCustom = applyViewCheckFilter(src, {
    grayscale: false,
    silhouette: true,
    silhouetteColor: [250, 10, 90],
  });
  assert.deepEqual(
    silCustom,
    new Uint8ClampedArray([
      250, 10, 90, 255,
      250, 10, 90, 128,
      255, 255, 255, 0,
    ])
  );
});

test("guides: snapCoordToGuides & snapPointToGuides snap within threshold and choose nearest", () => {
  const guides: GuideLine[] = [
    { id: "gx1", axis: "x", pos: 10 },
    { id: "gx2", axis: "x", pos: 13 },
    { id: "gy1", axis: "y", pos: 20 },
    { id: "gx3", axis: "x", pos: 40 },
  ];

  // Within default threshold (2)
  assert.equal(snapCoordToGuides(8, "x", guides), 10);
  assert.equal(snapCoordToGuides(10, "x", guides), 10);

  // Outside threshold
  assert.equal(snapCoordToGuides(7, "x", guides), 7);
  assert.equal(snapCoordToGuides(16, "x", guides), 16);

  // Nearest guide choice: 12 is dist 2 from 10 and dist 1 from 13 -> picks 13
  assert.equal(snapCoordToGuides(12, "x", guides), 13);

  // Equal distance tie: 11.5 is 1.5 from 10 and 1.5 from 13 -> picks first encountered (10)
  assert.equal(snapCoordToGuides(11.5, "x", guides), 10);

  // Respects axis filtering
  assert.equal(snapCoordToGuides(20, "x", guides), 20);
  assert.equal(snapCoordToGuides(10, "y", guides), 10);
  assert.equal(snapCoordToGuides(19, "y", guides), 20);

  // Custom threshold
  assert.equal(snapCoordToGuides(36, "x", guides, 4), 40);
  assert.equal(snapCoordToGuides(35, "x", guides, 4), 35);

  // snapPointToGuides snaps both axes independently
  assert.deepEqual(snapPointToGuides({ x: 9, y: 21 }, guides), { x: 10, y: 20 });
  assert.deepEqual(snapPointToGuides({ x: 9, y: 5 }, guides), { x: 10, y: 5 });
});

test("guides: buildCustomGridLines handles default, positive/negative offsets, non-square, and clamping", () => {
  // Default offset on 16x12 with 4x4 grid
  assert.deepEqual(buildCustomGridLines(16, 12, 4, 4), {
    verticals: [4, 8, 12],
    horizontals: [4, 8],
  });

  // Non-square grid with positive offset
  assert.deepEqual(buildCustomGridLines(16, 10, 6, 3, 2, 1), {
    verticals: [2, 8, 14],
    horizontals: [1, 4, 7],
  });

  // Negative offset wraps cleanly in (0, size)
  assert.deepEqual(buildCustomGridLines(12, 8, 5, 4, -1, -2), {
    verticals: [4, 9],
    horizontals: [2, 6],
  });

  // Clamping gridW/gridH < 1 to 1
  assert.deepEqual(buildCustomGridLines(4, 3, 0, -5), {
    verticals: [1, 2, 3],
    horizontals: [1, 2],
  });
});

test("commandMatcher: fuzzyMatchCommands handles empty query, ranking, keywords, and no match", () => {
  const commands: CommandEntry[] = [
    { id: "1", label: "Canvas Flip Horizontal", category: "View", keywords: ["mirror"] },
    { id: "2", label: "Flip View Horizontal", category: "View", shortcut: "H" },
    { id: "3", label: "Filter: Gaussian Blur", category: "Filter" },
    { id: "4", label: "Pencil Tool", category: "Tools", keywords: ["draw", "brush"] },
    { id: "5", label: "Outline Selection", category: "Edit", keywords: ["stroke", "border"] },
    { id: "6", label: "Flatten All Layers", category: "Layer" },
  ];

  // Empty or whitespace query returns all items in original order
  assert.deepEqual(
    fuzzyMatchCommands("", commands).map((c) => c.id),
    ["1", "2", "3", "4", "5", "6"]
  );
  assert.deepEqual(
    fuzzyMatchCommands("   ", commands).map((c) => c.id),
    ["1", "2", "3", "4", "5", "6"]
  );

  // Prefix > word-boundary/substring > subsequence (case-insensitive)
  // "flip": id 2 starts with "Flip" (prefix), id 1 has word-boundary "Flip"
  const flipMatches = fuzzyMatchCommands("flip", commands);
  assert.deepEqual(
    flipMatches.map((c) => c.id),
    ["2", "1"]
  );

  // Substring vs subsequence: "flat" matches id 6 as prefix, "fl" matches id 2 (prefix), id 3 (subseq? no 'l' before 'f', wait 'FiLter'), id 6 (prefix)
  const fllMatches = fuzzyMatchCommands("fll", commands);
  // "fll" is ordered subsequence in "Flip View Horizontal" (F-l-l) and "Flatten All Layers" (F-l-l)
  assert.ok(fllMatches.some((c) => c.id === "2"));
  assert.ok(fllMatches.some((c) => c.id === "6"));

  // Keyword match
  const mirrorMatches = fuzzyMatchCommands("mirror", commands);
  assert.deepEqual(
    mirrorMatches.map((c) => c.id),
    ["1"]
  );
  const drawMatches = fuzzyMatchCommands("draw", commands);
  assert.deepEqual(
    drawMatches.map((c) => c.id),
    ["4"]
  );

  // Label match ranks ahead of category-only match
  const filterMatches = fuzzyMatchCommands("filter", commands);
  assert.equal(filterMatches[0].id, "3");

  // Subsequence match
  const ptMatches = fuzzyMatchCommands("ptl", commands);
  assert.ok(ptMatches.some((c) => c.id === "4")); // "Pencil TooL"

  // No match
  assert.deepEqual(fuzzyMatchCommands("zzzznope", commands), []);
});

test("dither: shouldPlotDither covers all patterns, threshold bounds, negative coords, and bayer8 monotonicity", () => {
  const patterns: DitherPattern[] = [
    "bayer2",
    "bayer4",
    "bayer8",
    "checker",
    "diagL",
    "diagR",
    "dots",
  ];

  for (const pat of patterns) {
    for (let y = -4; y < 8; y++) {
      for (let x = -4; x < 8; x++) {
        assert.equal(shouldPlotDither(x, y, 0, pat), false);
        assert.equal(shouldPlotDither(x, y, -0.5, pat), false);
        assert.equal(shouldPlotDither(x, y, 1, pat), true);
        assert.equal(shouldPlotDither(x, y, 1.5, pat), true);
      }
    }
  }

  // Negative coordinate periodicity check
  for (const pat of patterns) {
    for (let y = 0; y < 8; y++) {
      for (let x = 0; x < 8; x++) {
        assert.equal(
          shouldPlotDither(x - 8, y - 8, 0.5, pat),
          shouldPlotDither(x, y, 0.5, pat),
          `negative wrap mismatch for ${pat} at (${x},${y})`
        );
      }
    }
  }

  // bayer8 monotonicity: higher thresholds never remove previously plotted pixels and count strictly matches k/64
  let prevHits = 0;
  let prevMask = new Set<string>();
  for (let step = 0; step <= 64; step++) {
    const t = step / 64;
    let hits = 0;
    const curMask = new Set<string>();
    for (let y = 0; y < 8; y++) {
      for (let x = 0; x < 8; x++) {
        if (shouldPlotDither(x, y, t, "bayer8")) {
          hits++;
          curMask.add(`${x},${y}`);
        }
      }
    }
    assert.equal(hits, step);
    assert.ok(hits >= prevHits);
    for (const key of prevMask) {
      assert.ok(curMask.has(key), `bayer8 monotonicity violated at step ${step} for ${key}`);
    }
    prevHits = hits;
    prevMask = curMask;
  }

  // applyInkPixel delegates ditherPattern properly
  const checkerInk = applyInkPixel([0, 0, 0, 0], [255, 0, 0, 255], 1, 0, "dither", {
    ditherThreshold: 0.5,
    ditherPattern: "checker",
  });
  assert.equal(checkerInk, null);
  assert.deepEqual(
    applyInkPixel([0, 0, 0, 0], [255, 0, 0, 255], 0, 0, "dither", {
      ditherThreshold: 0.5,
      ditherPattern: "checker",
    }),
    [255, 0, 0, 255]
  );
});

test("gradient: renderGradientToBuffer handles linear, radial, bayer dither, paletteSnap, and selectionMask", () => {
  const start: RGBA = [0, 0, 0, 255];
  const end: RGBA = [200, 100, 50, 255];

  // Linear smooth gradient across x = 0..4
  const linBuf = new PixelBuffer(5, 2);
  const linCount = renderGradientToBuffer(
    linBuf,
    0,
    0,
    4,
    0,
    start,
    end,
    { mode: "linear", dither: "none" },
    false
  );
  assert.equal(linCount, 10);
  assert.deepEqual(linBuf.getPixel(0, 0), [0, 0, 0, 255]);
  assert.deepEqual(linBuf.getPixel(2, 0), [100, 50, 25, 255]);
  assert.deepEqual(linBuf.getPixel(4, 1), [200, 100, 50, 255]);

  // Bayer dither emits only start or end colors (no intermediate colors)
  const ditherBuf = new PixelBuffer(8, 4);
  renderGradientToBuffer(
    ditherBuf,
    0,
    0,
    7,
    0,
    start,
    end,
    { mode: "linear", dither: "bayer4" },
    false
  );
  for (let y = 0; y < 4; y++) {
    for (let x = 0; x < 8; x++) {
      const px = ditherBuf.getPixel(x, y);
      const isStart = px[0] === 0 && px[1] === 0 && px[2] === 0 && px[3] === 255;
      const isEnd = px[0] === 200 && px[1] === 100 && px[2] === 50 && px[3] === 255;
      assert.ok(isStart || isEnd);
    }
  }
  assert.deepEqual(ditherBuf.getPixel(0, 0), start);
  assert.deepEqual(ditherBuf.getPixel(7, 0), end);

  // Radial gradient + paletteSnap + selectionMask
  const palette: RGBA[] = [
    [10, 10, 10, 255],
    [120, 120, 120, 255],
    [240, 240, 240, 255],
  ];
  const mask = createRectSelection(7, 7, 1, 1, 5, 5);
  const radBuf = new PixelBuffer(7, 7);
  let beforeCallbacks = 0;
  renderGradientToBuffer(
    radBuf,
    3,
    3,
    6,
    3,
    [0, 0, 0, 255],
    [255, 255, 255, 255],
    { mode: "radial", dither: "none", paletteSnap: palette },
    false,
    () => {
      beforeCallbacks++;
    },
    mask
  );
  assert.equal(beforeCallbacks, 25); // 5x5 inside selection
  assert.deepEqual(radBuf.getPixel(0, 0), [0, 0, 0, 0]); // outside mask untouched
  assert.deepEqual(radBuf.getPixel(3, 3), palette[0]); // center is start
  assert.deepEqual(radBuf.getPixel(1, 1), palette[2]); // outer corner snapped to brightest
  for (let y = 1; y <= 5; y++) {
    for (let x = 1; x <= 5; x++) {
      const px = radBuf.getPixel(x, y);
      assert.ok(
        palette.some((p) => p[0] === px[0] && p[1] === px[1] && p[2] === px[2] && p[3] === px[3])
      );
    }
  }
});

test("curves: plotQuadraticBezier, plotCubicBezier, and plotPolygon rasterize cleanly", () => {
  // Quadratic bezier starts at p0, ends at p2, and has no consecutive duplicates
  const quad = plotQuadraticBezier({ x: 0, y: 0 }, { x: 5, y: 10 }, { x: 10, y: 0 });
  assert.deepEqual(quad[0], { x: 0, y: 0 });
  assert.deepEqual(quad[quad.length - 1], { x: 10, y: 0 });
  for (let i = 1; i < quad.length; i++) {
    assert.ok(quad[i].x !== quad[i - 1].x || quad[i].y !== quad[i - 1].y);
    assert.ok(Math.abs(quad[i].x - quad[i - 1].x) <= 1);
    assert.ok(Math.abs(quad[i].y - quad[i - 1].y) <= 1);
  }
  assert.ok(quad.some((p) => p.y >= 4));

  // Pixel-perfect quadratic bezier removes L-corners
  const quadPP = plotQuadraticBezier({ x: 0, y: 0 }, { x: 0, y: 8 }, { x: 8, y: 8 }, true);
  assert.ok(quadPP.length <= quad.length);

  // Cubic bezier endpoints and 8-connected continuity
  const cubic = plotCubicBezier(
    { x: 0, y: 0 },
    { x: 2, y: 12 },
    { x: 10, y: -4 },
    { x: 12, y: 8 }
  );
  assert.deepEqual(cubic[0], { x: 0, y: 0 });
  assert.deepEqual(cubic[cubic.length - 1], { x: 12, y: 8 });
  for (let i = 1; i < cubic.length; i++) {
    assert.ok(Math.abs(cubic[i].x - cubic[i - 1].x) <= 1);
    assert.ok(Math.abs(cubic[i].y - cubic[i - 1].y) <= 1);
  }

  // Open polyline (3 vertices, closed=false) does not connect last->first
  const openPoly = plotPolygon(
    [
      { x: 0, y: 0 },
      { x: 4, y: 0 },
      { x: 4, y: 4 },
    ],
    false,
    false
  );
  assert.equal(openPoly.length, 9);
  assert.ok(!openPoly.some((p) => p.x === 2 && p.y === 2));

  // Closed triangle outline connects last->first
  const closedTri = plotPolygon(
    [
      { x: 0, y: 0 },
      { x: 4, y: 0 },
      { x: 4, y: 4 },
    ],
    false,
    true
  );
  assert.ok(closedTri.some((p) => p.x === 2 && p.y === 2));

  // Filled square 0..3 x 0..3 => exact 16 unique points
  const filledSquare = plotPolygon(
    [
      { x: 0, y: 0 },
      { x: 3, y: 0 },
      { x: 3, y: 3 },
      { x: 0, y: 3 },
    ],
    true,
    true
  );
  assert.equal(filledSquare.length, 16);
  const sqSet = coordsSet(filledSquare);
  for (let y = 0; y <= 3; y++) {
    for (let x = 0; x <= 3; x++) {
      assert.ok(sqSet.has(`${x},${y}`));
    }
  }

  // Filled triangle contains interior points
  const filledTri = plotPolygon(
    [
      { x: 0, y: 0 },
      { x: 6, y: 0 },
      { x: 3, y: 6 },
    ],
    true
  );
  assert.ok(coordsSet(filledTri).has("3,2"));
});

test("symmetry: expandSymmetryV2 matches expandSymmetry at center and supports movable, diag45/135, and radial", () => {
  const baseCfg = (overrides: Partial<SymmetryConfig> = {}): SymmetryConfig => ({
    symX: false,
    symY: false,
    axisX: 16,
    axisY: 16,
    diag45: false,
    diag135: false,
    radialSegments: 1,
    radialCx: 16,
    radialCy: 16,
    ...overrides,
  });

  // Exact center parity with expandSymmetry for both even and odd dimensions
  for (const [w, h] of [
    [32, 32],
    [15, 11],
  ]) {
    const legacy = expandSymmetry({ x: 2, y: 3 }, w, h, true, true);
    const v2 = expandSymmetryV2(
      { x: 2, y: 3 },
      baseCfg({ symX: true, symY: true, axisX: w / 2, axisY: h / 2 })
    );
    assert.deepEqual(v2[0], { x: 2, y: 3 });
    assert.deepEqual(coordsSet(v2), coordsSet(legacy));
  }

  // Movable axisX = 10 mirrors x=3 -> 2*10 - 3 - 1 = 16
  const movable = expandSymmetryV2({ x: 3, y: 5 }, baseCfg({ symX: true, axisX: 10 }));
  assert.deepEqual(movable, [
    { x: 3, y: 5 },
    { x: 16, y: 5 },
  ]);

  // diag45 around (4, 4): (2, 1) -> reflected (1, 2)
  const d45 = expandSymmetryV2(
    { x: 2, y: 1 },
    baseCfg({ diag45: true, axisX: 4, axisY: 4 })
  );
  assert.deepEqual(coordsSet(d45), new Set(["2,1", "1,2"]));

  // diag135 around (4, 4): (2, 1): dx = -1.5, dy = -2.5 -> x = 4 - (-2.5) - 0.5 = 6, y = 4 - (-1.5) - 0.5 = 5
  const d135 = expandSymmetryV2(
    { x: 2, y: 1 },
    baseCfg({ diag135: true, axisX: 4, axisY: 4 })
  );
  assert.deepEqual(coordsSet(d135), new Set(["2,1", "6,5"]));

  // 4-fold radial around (10, 10)
  const rad4 = expandSymmetryV2(
    { x: 14, y: 11 },
    baseCfg({ radialSegments: 4, radialCx: 10, radialCy: 10 })
  );
  assert.deepEqual(rad4[0], { x: 14, y: 11 });
  assert.deepEqual(
    coordsSet(rad4),
    new Set(["14,11", "9,14", "6,9", "11,6"])
  );

  // 6-fold radial around (20, 20)
  const rad6 = expandSymmetryV2(
    { x: 28, y: 20 },
    baseCfg({ radialSegments: 6, radialCx: 20, radialCy: 20 })
  );
  assert.equal(rad6.length, 6);
  assert.deepEqual(rad6[0], { x: 28, y: 20 });
});

test("sprayJumble: generateSprayPoints determinism, applyJumbleFootprint conservation, captureCustomBrush & transforms", () => {
  // Deterministic spray points within radius
  const s1 = generateSprayPoints(10, 10, 5, 50, 12345);
  const s2 = generateSprayPoints(10, 10, 5, 50, 12345);
  const s3 = generateSprayPoints(10, 10, 5, 50, 54321);
  assert.deepEqual(s1, s2);
  assert.notDeepEqual(s1, s3);
  assert.ok(s1.length > 0);
  for (const pt of s1) {
    assert.ok(Math.hypot(pt.x - 10, pt.y - 10) <= 5.8);
  }

  // Jumble conserves exact pixel multiset
  const buf = new PixelBuffer(6, 6);
  const paletteColors: RGBA[] = [
    [255, 0, 0, 255],
    [0, 255, 0, 255],
    [0, 0, 255, 255],
    [255, 255, 0, 255],
  ];
  const colorKey = (rgba: RGBA) => rgba.join(",");
  const beforeHist = new Map<string, number>();
  for (let y = 0; y < 6; y++) {
    for (let x = 0; x < 6; x++) {
      const col = paletteColors[(x + y * 2) % paletteColors.length];
      buf.setPixel(x, y, col[0], col[1], col[2], col[3]);
      const k = colorKey(col);
      beforeHist.set(k, (beforeHist.get(k) ?? 0) + 1);
    }
  }
  const jumbled = applyJumbleFootprint(buf, 3, 3, 2, 777, false);
  assert.ok(jumbled > 0);
  const afterHist = new Map<string, number>();
  for (let y = 0; y < 6; y++) {
    for (let x = 0; x < 6; x++) {
      const k = colorKey(buf.getPixel(x, y));
      afterHist.set(k, (afterHist.get(k) ?? 0) + 1);
    }
  }
  assert.deepEqual(afterHist, beforeHist);

  // captureCustomBrush + flipH/flipV/rotateCW x4 identity
  const brushSrc = new PixelBuffer(4, 3);
  brushSrc.setPixel(1, 0, 255, 0, 0, 255);
  brushSrc.setPixel(2, 0, 0, 255, 0, 255);
  brushSrc.setPixel(1, 1, 0, 0, 255, 128);
  brushSrc.setPixel(3, 2, 255, 255, 255, 255);
  const sel = createRectSelection(4, 3, 1, 0, 3, 2);
  const captured = captureCustomBrush(
    brushSrc,
    {
      contains: (x, y) => sel.contains(x, y),
      getBounds: () => {
        const b = sel.getBounds();
        return b
          ? { minX: b.x, minY: b.y, maxX: b.x + b.w - 1, maxY: b.y + b.h - 1 }
          : null;
      },
    },
    "MyBrush",
    "rgba"
  );
  assert.ok(captured);
  assert.equal(captured.width, 3);
  assert.equal(captured.height, 3);
  assert.equal(captured.name, "MyBrush");

  const flipHH = flipCustomBrushH(flipCustomBrushH(captured));
  assert.deepEqual(flipHH.pixels, captured.pixels);
  const flipVV = flipCustomBrushV(flipCustomBrushV(captured));
  assert.deepEqual(flipVV.pixels, captured.pixels);

  let rot = captured;
  for (let i = 0; i < 4; i++) {
    rot = rotateCustomBrushCW(rot);
  }
  assert.equal(rot.width, captured.width);
  assert.equal(rot.height, captured.height);
  assert.deepEqual(rot.pixels, captured.pixels);
});

test("floodFill: supports tolerance, 8-connected diagonals, sampleBuffer, and ditherPattern", () => {
  const fillColor: RGBA = [0, 0, 255, 255];

  // Tolerance: fills near-red pixels within max channel diff <= 20, skips > 20
  const tolBuf = new PixelBuffer(4, 1);
  tolBuf.setPixel(0, 0, 200, 10, 10, 255);
  tolBuf.setPixel(1, 0, 215, 25, 10, 255); // diff 15 -> match
  tolBuf.setPixel(2, 0, 225, 10, 10, 255); // diff 25 -> barrier
  tolBuf.setPixel(3, 0, 200, 10, 10, 255); // blocked by barrier
  const tolWritten = floodFill(tolBuf, 0, 0, fillColor, true, false, undefined, null, {
    tolerance: 20,
  });
  assert.equal(tolWritten, 2);
  assert.deepEqual(tolBuf.getPixel(0, 0), fillColor);
  assert.deepEqual(tolBuf.getPixel(1, 0), fillColor);
  assert.deepEqual(tolBuf.getPixel(2, 0), [225, 10, 10, 255]);
  assert.deepEqual(tolBuf.getPixel(3, 0), [200, 10, 10, 255]);

  // 8-connected diagonal bridge vs 4-connected
  const diag4 = new PixelBuffer(3, 3);
  diag4.setPixel(0, 0, 10, 10, 10, 255);
  diag4.setPixel(1, 1, 10, 10, 10, 255);
  diag4.setPixel(2, 2, 10, 10, 10, 255);
  assert.equal(floodFill(diag4, 0, 0, fillColor, true, false), 1);

  const diag8 = new PixelBuffer(3, 3);
  diag8.setPixel(0, 0, 10, 10, 10, 255);
  diag8.setPixel(1, 1, 10, 10, 10, 255);
  diag8.setPixel(2, 2, 10, 10, 10, 255);
  assert.equal(
    floodFill(diag8, 0, 0, fillColor, true, false, undefined, null, {
      diagonal8: true,
    }),
    3
  );

  // sampleBuffer: barrier exists only on sampleBuffer
  const sampleBuf = new PixelBuffer(4, 1);
  sampleBuf.setPixel(2, 0, 255, 0, 0, 255);
  const targetBuf = new PixelBuffer(4, 1);
  const sampleWritten = floodFill(targetBuf, 0, 0, fillColor, true, false, undefined, null, {
    sampleBuffer: sampleBuf,
  });
  assert.equal(sampleWritten, 2);
  assert.deepEqual(targetBuf.getPixel(0, 0), fillColor);
  assert.deepEqual(targetBuf.getPixel(1, 0), fillColor);
  assert.deepEqual(targetBuf.getPixel(2, 0), [0, 0, 0, 0]);
  assert.deepEqual(targetBuf.getPixel(3, 0), [0, 0, 0, 0]);

  // ditherPattern: checker fills 50% of 4x4 region (8 pixels)
  const ditherBuf = new PixelBuffer(4, 4);
  const ditherWritten = floodFill(ditherBuf, 0, 0, fillColor, true, false, undefined, null, {
    ditherPattern: "checker",
  });
  assert.equal(ditherWritten, 8);
  assert.deepEqual(ditherBuf.getPixel(0, 0), fillColor);
  assert.deepEqual(ditherBuf.getPixel(1, 0), [0, 0, 0, 0]);
});

test("selection: fromEllipse, combineSelectionMasks (add/subtract/intersect), and fromFloodFill with tolerance & diagonal8", () => {
  // fromEllipse symmetric filled oval
  const ellipseMask = SelectionMask.fromEllipse(1, 1, 5, 5, 8, 8);
  assert.ok(ellipseMask.contains(3, 3));
  assert.ok(!ellipseMask.contains(0, 0));
  assert.ok(!ellipseMask.contains(7, 7));

  // combineSelectionMasks: add, subtract, intersect, replace
  const a = createRectSelection(6, 6, 0, 0, 2, 2); // 3x3 (9 px)
  const b = createRectSelection(6, 6, 1, 1, 3, 3); // 3x3 (9 px), overlap 2x2 (4 px)

  const added = combineSelectionMasks(a, b, "add");
  assert.ok(added.contains(0, 0));
  assert.ok(added.contains(3, 3));
  assert.equal(added.mask.reduce((acc, v) => acc + v, 0), 14);

  const sub = combineSelectionMasks(a, b, "subtract");
  assert.ok(sub.contains(0, 0));
  assert.ok(!sub.contains(1, 1));
  assert.equal(sub.mask.reduce((acc, v) => acc + v, 0), 5);

  const inter = combineSelectionMasks(a, b, "intersect");
  assert.deepEqual(inter.getBounds(), { x: 1, y: 1, w: 2, h: 2 });
  assert.equal(inter.mask.reduce((acc, v) => acc + v, 0), 4);

  const rep = combineSelectionMasks(a, b, "replace");
  assert.deepEqual(rep.getBounds(), { x: 1, y: 1, w: 3, h: 3 });

  // fromFloodFill with tolerance + diagonal8
  const wandBuf = new PixelBuffer(4, 3);
  wandBuf.setPixel(0, 0, 100, 100, 100, 255);
  wandBuf.setPixel(1, 1, 110, 105, 95, 255); // diagonal + within tol 10
  wandBuf.setPixel(2, 2, 108, 100, 100, 255); // diagonal + within tol 10
  wandBuf.setPixel(3, 2, 200, 100, 100, 255); // outside tol

  const wand4 = SelectionMask.fromFloodFill(wandBuf, 0, 0, true, 10, false);
  assert.ok(wand4.contains(0, 0));
  assert.ok(!wand4.contains(1, 1));

  const wand8 = SelectionMask.fromFloodFill(wandBuf, 0, 0, true, 10, true);
  assert.ok(wand8.contains(0, 0));
  assert.ok(wand8.contains(1, 1));
  assert.ok(wand8.contains(2, 2));
  assert.ok(!wand8.contains(3, 2));
});



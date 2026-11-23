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
  borderSelectionMask,
  combineSelectionMasks,
  computeSelectionStrokePoints,
  contractSelectionMask,
  createRectSelection,
  expandSelectionMask,
  invertSelectionMask,
  selectBufferNonTransparent,
  SelectionMask,
} from "../src/engine/tools/selection.ts";
import { rotSpriteRotate, scale2xEPX } from "../src/engine/tools/rotsprite.ts";
import {
  applyFreeTransform,
  computePivotTransformPatch,
  computeRotateTransformPatch,
  computeScaleTransformPatch,
  computeTransformGizmo,
  type TransformState,
} from "../src/engine/tools/transform.ts";
import {
  applyBrightnessContrast,
  applyColorReplace,
  applyDesaturateFilter,
  applyDropShadowFilter,
  applyHsvAdjust,
  applyInvertFilter,
  applyOutlineFilter,
  applyPixelCleanupFilter,
  applyQuantizeToPalette,
} from "../src/engine/tools/filters.ts";
import {
  computeTightBounds,
  cropBufferToBounds,
  offsetWrapBuffer,
  scaleBufferAlgorithm,
} from "../src/engine/tools/spriteOps.ts";
import { TileHistory } from "../src/engine/history/TileHistory.ts";
import { pixelEngine } from "../src/engine/document/PixelEngine.ts";
import {
  applyBufferFilterAction,
  autoCropSpriteAction,
  scaleSpriteAction,
} from "../src/engine/document/filterActions.ts";
import { performRedo, performUndo } from "../src/engine/document/historyActions.ts";
import { useEditorStore } from "../src/store/editorStore.ts";
import {
  ALL_BLEND_MODES,
  blendRgb,
  type BlendMode,
} from "../src/engine/document/blendModes.ts";
import {
  clearActiveCelAction,
  duplicateLayerAllFramesAction,
  flattenImageAction,
  mergeDownLayerAction,
  mergeVisibleLayersAction,
} from "../src/engine/document/layerActions.ts";
import {
  computeColorHarmonies,
  extractPaletteMedianCut,
  generateHueShiftedRamp,
  snapRgbaToPalette,
  sortPaletteColors,
} from "../src/engine/tools/paletteOps.ts";
import {
  computeNextPlaybackFrame,
  resolveOnionSkinFrames,
} from "../src/engine/tools/animationHelpers.ts";
import {
  bulkDeleteSelectedCelsAction,
  bulkSetFrameDurationAction,
  reverseFramesAction,
} from "../src/engine/document/timelineActions.ts";

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

test("rotsprite: scale2xEPX 2x dimensions and diagonal smoothing on a 3x3 pattern", () => {
  // 3x3 diagonal line:
  // . X .
  // X . .
  // . . .
  // At center (1,1): A=X, C=X, B=., D=. => P1=A=X (smooths diagonal corner)
  const src = new PixelBuffer(3, 3);
  const X: RGBA = [255, 40, 20, 255];
  src.setPixel(1, 0, X[0], X[1], X[2], X[3]);
  src.setPixel(0, 1, X[0], X[1], X[2], X[3]);

  const up = scale2xEPX(src);
  assert.equal(up.width, 6);
  assert.equal(up.height, 6);

  // Center pixel (1,1) maps to 2x2 block (2..3, 2..3); P1=(2,2) should become X
  assert.deepEqual(up.getPixel(2, 2), X);
  assert.deepEqual(up.getPixel(3, 2), [0, 0, 0, 0]);
  assert.deepEqual(up.getPixel(2, 3), [0, 0, 0, 0]);
  assert.deepEqual(up.getPixel(3, 3), [0, 0, 0, 0]);

  // Top-left (0,0): clamped neighbors A=(0,0)=., C=(0,0)=., B=(1,0)=X, D=(0,1)=X
  // Since B == D && B != A && D != C, P4=(1,1) becomes X!
  assert.deepEqual(up.getPixel(0, 0), [0, 0, 0, 0]);
  assert.deepEqual(up.getPixel(1, 1), X);
});

test("rotsprite: rotSpriteRotate 0deg identity, 90/180deg pixel conservation, and 45deg output", () => {
  const src = new PixelBuffer(4, 3);
  src.setPixel(0, 0, 255, 0, 0, 255);
  src.setPixel(1, 0, 0, 255, 0, 255);
  src.setPixel(2, 1, 0, 0, 255, 255);
  src.setPixel(3, 2, 255, 255, 0, 128);

  // 0° and 360° identity
  const rot0 = rotSpriteRotate(src, 0);
  assert.equal(rot0.width, 4);
  assert.equal(rot0.height, 3);
  assert.deepEqual(rot0.data, src.data);
  const rot360 = rotSpriteRotate(src, 360);
  assert.deepEqual(rot360.data, src.data);

  // 90° CW: dimensions swap (3x4) and opaque pixel multiset is conserved
  const rot90 = rotSpriteRotate(src, 90);
  assert.equal(rot90.width, 3);
  assert.equal(rot90.height, 4);
  assert.deepEqual(rot90.getPixel(2, 0), [255, 0, 0, 255]); // (0,0) -> (h-1-0, 0) = (2,0)
  assert.deepEqual(rot90.getPixel(0, 3), [255, 255, 0, 128]); // (3,2) -> (0,3)

  // 180°: dimensions preserved (4x3) and double 180° equals original
  const rot180 = rotSpriteRotate(src, 180);
  assert.equal(rot180.width, 4);
  assert.equal(rot180.height, 3);
  assert.deepEqual(rot180.getPixel(3, 2), [255, 0, 0, 255]);
  assert.deepEqual(rotSpriteRotate(rot180, 180).data, src.data);

  // 45° rotation on a 6x6 sprite produces non-empty expanded rotated output
  const block = new PixelBuffer(6, 6);
  for (let y = 1; y <= 4; y++) {
    for (let x = 1; x <= 4; x++) {
      block.setPixel(x, y, 100, 180, 240, 255);
    }
  }
  const rot45 = rotSpriteRotate(block, 45);
  assert.ok(rot45.width >= 8 && rot45.height >= 8);
  assert.ok(!rot45.isEmpty());
});

test("transform: applyFreeTransform covers identity, 2x scale, 90deg rotation, skew, and pivot", () => {
  const src = new PixelBuffer(4, 2);
  src.setPixel(0, 0, 255, 0, 0, 255);
  src.setPixel(3, 0, 0, 255, 0, 255);
  src.setPixel(0, 1, 0, 0, 255, 255);
  src.setPixel(3, 1, 255, 255, 0, 255);

  // Identity preserves pixels exactly and rounds offset
  const id = applyFreeTransform(src, {
    x: 5.4,
    y: -2.2,
    width: 4,
    height: 2,
    scaleX: 1,
    scaleY: 1,
    rotationDeg: 0,
    skewX: 0,
    skewY: 0,
    pivotX: 2,
    pivotY: 1,
    algorithm: "nearest",
  });
  assert.equal(id.offsetX, 5);
  assert.equal(id.offsetY, -2);
  assert.deepEqual(id.buffer.data, src.data);

  // 2x scale around pivot (0, 0) -> 8x4 buffer starting at offset (0, 0)
  const scaled = applyFreeTransform(src, {
    x: 0,
    y: 0,
    width: 8,
    height: 4,
    scaleX: 2,
    scaleY: 2,
    rotationDeg: 0,
    skewX: 0,
    skewY: 0,
    pivotX: 0,
    pivotY: 0,
    algorithm: "nearest",
  });
  assert.equal(scaled.offsetX, 0);
  assert.equal(scaled.offsetY, 0);
  assert.equal(scaled.buffer.width, 8);
  assert.equal(scaled.buffer.height, 4);
  assert.deepEqual(scaled.buffer.getPixel(0, 0), [255, 0, 0, 255]);
  assert.deepEqual(scaled.buffer.getPixel(1, 1), [255, 0, 0, 255]);
  assert.deepEqual(scaled.buffer.getPixel(7, 3), [255, 255, 0, 255]);

  // 90° rotation around pivot (0, 0): (x,y) -> (-y, x), so x in [-2..0], y in [0..4]
  const rot90 = applyFreeTransform(src, {
    x: 0,
    y: 0,
    width: 4,
    height: 2,
    scaleX: 1,
    scaleY: 1,
    rotationDeg: 90,
    skewX: 0,
    skewY: 0,
    pivotX: 0,
    pivotY: 0,
    algorithm: "rotsprite",
  });
  assert.equal(rot90.offsetX, -2);
  assert.equal(rot90.offsetY, 0);
  assert.equal(rot90.buffer.width, 2);
  assert.equal(rot90.buffer.height, 4);
  // (0,0) rotated 90° around (0,0) lands at world (-1, 0) -> buffer (1, 0)
  assert.deepEqual(rot90.buffer.getPixel(1, 0), [255, 0, 0, 255]);
  // (3,1) lands at world (-2, 3) -> buffer (0, 3)
  assert.deepEqual(rot90.buffer.getPixel(0, 3), [255, 255, 0, 255]);

  // Skew X=1 around pivot (0,0) shifts bottom row by +height*1
  const solid = new PixelBuffer(2, 2);
  solid.setPixel(0, 0, 200, 100, 50, 255);
  solid.setPixel(1, 0, 200, 100, 50, 255);
  solid.setPixel(0, 1, 200, 100, 50, 255);
  solid.setPixel(1, 1, 200, 100, 50, 255);
  const skewed = applyFreeTransform(solid, {
    x: 0,
    y: 0,
    width: 2,
    height: 2,
    scaleX: 1,
    scaleY: 1,
    rotationDeg: 0,
    skewX: 1,
    skewY: 0,
    pivotX: 0,
    pivotY: 0,
    algorithm: "scale2x",
  });
  assert.equal(skewed.buffer.width, 4);
  assert.equal(skewed.buffer.height, 2);
  assert.deepEqual(skewed.buffer.getPixel(0, 0), [200, 100, 50, 255]);
  assert.deepEqual(skewed.buffer.getPixel(2, 1), [200, 100, 50, 255]);

  // Pivot preservation: scaling 2x around pivot (2, 1) keeps pixel near pivot stationary in world space
  const piv = new PixelBuffer(5, 5);
  piv.setPixel(2, 2, 10, 200, 30, 255);
  const pivScaled = applyFreeTransform(piv, {
    x: 0,
    y: 0,
    width: 5,
    height: 5,
    scaleX: 2,
    scaleY: 2,
    rotationDeg: 0,
    skewX: 0,
    skewY: 0,
    pivotX: 2.5,
    pivotY: 2.5,
    algorithm: "nearest",
  });
  // Pixel at center (2,2) [center 2.5,2.5] stays at world (2,2)
  const localX = 2 - pivScaled.offsetX;
  const localY = 2 - pivScaled.offsetY;
  assert.deepEqual(pivScaled.buffer.getPixel(localX, localY), [10, 200, 30, 255]);
});

test("selection: invert, expand, contract, border, selectBufferNonTransparent, and computeSelectionStrokePoints", () => {
  const countSelected = (m: SelectionMask) =>
    m.mask.reduce((acc, v) => acc + (v !== 0 ? 1 : 0), 0);

  // 8x8 canvas with 4x4 square at [2..5, 2..5] (16 px)
  const sq = createRectSelection(8, 8, 2, 2, 5, 5);
  assert.equal(countSelected(sq), 16);

  // invertSelectionMask -> 64 - 16 = 48
  const inv = invertSelectionMask(sq);
  assert.equal(countSelected(inv), 48);
  assert.ok(inv.contains(0, 0));
  assert.ok(!inv.contains(3, 3));
  assert.deepEqual(invertSelectionMask(inv).mask, sq.mask);

  // expandSelectionMask radius=1 (4-neighborhood disk: dx^2+dy^2 <= 1) adds 4 sides of length 4 -> 16 + 16 = 32
  const exp1 = expandSelectionMask(sq, 1);
  assert.equal(countSelected(exp1), 32);
  assert.ok(exp1.contains(1, 2));
  assert.ok(!exp1.contains(1, 1)); // diagonal corner dist^2 = 2 > 1

  // contractSelectionMask radius=1 leaves inner 2x2 [3..4, 3..4] = 4 px
  const con1 = contractSelectionMask(sq, 1);
  assert.equal(countSelected(con1), 4);
  assert.deepEqual(con1.getBounds(), { x: 3, y: 3, w: 2, h: 2 });

  // contractSelectionMask treats canvas border as outside
  const edgeSq = createRectSelection(4, 4, 0, 0, 2, 2); // touches top/left border
  const edgeCon = contractSelectionMask(edgeSq, 1);
  assert.equal(countSelected(edgeCon), 1); // only (1,1) survives
  assert.ok(edgeCon.contains(1, 1));

  // borderSelectionMask width=1 removes 4 interior pixels -> 16 - 4 = 12 ring pixels
  const border1 = borderSelectionMask(sq, 1);
  assert.equal(countSelected(border1), 12);
  assert.ok(border1.contains(2, 2));
  assert.ok(!border1.contains(3, 3));

  // selectBufferNonTransparent
  const emptyBuf = new PixelBuffer(4, 4);
  assert.equal(selectBufferNonTransparent(emptyBuf), null);

  const sprite = new PixelBuffer(4, 4);
  sprite.setPixel(1, 1, 255, 0, 0, 10);
  sprite.setPixel(2, 3, 0, 255, 0, 255);
  const nonTrans = selectBufferNonTransparent(sprite);
  assert.ok(nonTrans);
  assert.equal(countSelected(nonTrans), 2);
  assert.ok(nonTrans.contains(1, 1));
  assert.ok(nonTrans.contains(2, 3));
  assert.ok(!nonTrans.contains(0, 0));

  // computeSelectionStrokePoints: inside / outside / center
  const strokeIn = computeSelectionStrokePoints(sq, 1, "inside");
  assert.equal(strokeIn.length, 12);
  assert.ok(strokeIn.every((p) => sq.contains(p.x, p.y)));

  const strokeOut = computeSelectionStrokePoints(sq, 1, "outside");
  assert.equal(strokeOut.length, 16); // expanded(32) - sq(16) = 16
  assert.ok(strokeOut.every((p) => !sq.contains(p.x, p.y)));

  // center width=2 -> innerR=1 (12 px) + outerR=1 (16 px) = 28 px
  const strokeCenter = computeSelectionStrokePoints(sq, 2, "center");
  assert.equal(strokeCenter.length, 28);
});

test("transform gizmo: geometry, corner/edge scale with aspect lock, 15deg snap rotation, and pivot drag", () => {
  const baseState: TransformState = {
    x: 4,
    y: 6,
    width: 10,
    height: 8,
    scaleX: 1,
    scaleY: 1,
    rotationDeg: 0,
    skewX: 0,
    skewY: 0,
    pivotX: 5,
    pivotY: 4,
    algorithm: "nearest",
  };

  const gizmo = computeTransformGizmo(10, 8, baseState, 2);
  assert.deepEqual(gizmo.corners[0], { x: 4, y: 6 }); // TL
  assert.deepEqual(gizmo.corners[1], { x: 14, y: 6 }); // TR
  assert.deepEqual(gizmo.corners[2], { x: 14, y: 14 }); // BR
  assert.deepEqual(gizmo.corners[3], { x: 4, y: 14 }); // BL
  assert.deepEqual(gizmo.pivot, { x: 9, y: 10 });
  assert.deepEqual(gizmo.rotStemStart, { x: 9, y: 6 });
  assert.deepEqual(gizmo.rotHandle, { x: 9, y: 4 });

  // Drag BR corner to (24, 22) -> 2x scale around TL (4, 6)
  const scaledBr = computeScaleTransformPatch(
    10,
    8,
    baseState,
    "br",
    { x: 24, y: 22 },
    false
  );
  assert.equal(scaledBr.scaleX, 2);
  assert.equal(scaledBr.scaleY, 2);
  assert.equal(scaledBr.width, 20);
  assert.equal(scaledBr.height, 16);

  // Drag BR corner with Shift aspect lock when pointer moves unevenly (24, 14)
  const locked = computeScaleTransformPatch(
    10,
    8,
    baseState,
    "br",
    { x: 24, y: 14 },
    true
  );
  assert.equal(locked.scaleX, 2);
  assert.equal(locked.scaleY, 2);

  // Rotate from top handle (9, 4) -> right side (15, 10) = +90deg with 15deg snap
  const rotSnap = computeRotateTransformPatch(
    10,
    8,
    baseState,
    { x: 9, y: 4 },
    { x: 15, y: 10 },
    true
  );
  assert.equal(rotSnap.rotationDeg, 90);

  // Rotate slightly (~14deg) with snap15 -> snaps to 15deg
  const rad14 = (14 * Math.PI) / 180;
  const rot15 = computeRotateTransformPatch(
    10,
    8,
    baseState,
    { x: 9, y: 4 },
    { x: 9 + Math.sin(rad14) * 6, y: 10 - Math.cos(rad14) * 6 },
    true
  );
  assert.equal(rot15.rotationDeg, 15);

  // Move pivot to (4, 6) = TL corner -> x,y adjust so box stays anchored when scale=1, rot=0
  const pivPatch = computePivotTransformPatch(10, 8, baseState, { x: 4, y: 6 });
  assert.equal(pivPatch.pivotX, 0);
  assert.equal(pivPatch.pivotY, 0);
  assert.equal(pivPatch.x, 4);
  assert.equal(pivPatch.y, 6);
});

test("D4 applyOutlineFilter: 4-way vs 8-way counts, inside vs outside, thickness, mask, and selective tinted outline", () => {
  const countOpaque = (buf: PixelBuffer): number => {
    let n = 0;
    for (let i = 3; i < buf.data.length; i += 4) {
      if (buf.data[i] > 0) n++;
    }
    return n;
  };

  // Single bright warm pixel at center of 7x7 canvas
  const single = new PixelBuffer(7, 7);
  single.setPixel(3, 3, 240, 120, 60, 255);
  const singleBefore = new Uint8ClampedArray(single.data);

  const out4 = applyOutlineFilter(single, {
    thickness: 1,
    connectivity: 4,
    placement: "outside",
    mode: "solid",
    color: [0, 0, 0, 255],
  });
  // Input buffer must never be mutated
  assert.deepEqual(single.data, singleBefore);
  // 1 center + 4 cardinal = 5
  assert.equal(countOpaque(out4), 5);
  assert.deepEqual(out4.getPixel(3, 2), [0, 0, 0, 255]);
  assert.deepEqual(out4.getPixel(2, 2), [0, 0, 0, 0]);

  const out8 = applyOutlineFilter(single, {
    thickness: 1,
    connectivity: 8,
    placement: "outside",
    mode: "solid",
    color: [0, 0, 0, 255],
  });
  // 1 center + 8 surrounding = 9
  assert.equal(countOpaque(out8), 9);
  assert.deepEqual(out8.getPixel(2, 2), [0, 0, 0, 255]);

  // Thickness 2 with 4-way: 1 + 4 + 8 = 13
  const out4t2 = applyOutlineFilter(single, {
    thickness: 2,
    connectivity: 4,
    placement: "outside",
    mode: "solid",
    color: [10, 20, 30, 255],
  });
  assert.equal(countOpaque(out4t2), 13);

  // Selective outline produces opaque border pixels darker than adjacent interior pixel
  const sel = applyOutlineFilter(single, {
    thickness: 1,
    connectivity: 4,
    placement: "outside",
    mode: "selective",
    color: [0, 0, 0, 255],
  });
  const neighbor = single.getPixel(3, 3);
  const border = sel.getPixel(3, 2);
  assert.equal(border[3], 255);
  const luma = (c: RGBA) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  assert.ok(luma(border) < luma(neighbor));
  assert.ok(border[2] > 0); // cool shadow shift retains blue component

  // Inside outline on a 4x4 solid square inside a 6x6 canvas
  const sq = new PixelBuffer(6, 6);
  for (let y = 1; y <= 4; y++) {
    for (let x = 1; x <= 4; x++) {
      sq.setPixel(x, y, 200, 180, 100, 255);
    }
  }
  const inside4 = applyOutlineFilter(sq, {
    thickness: 1,
    connectivity: 4,
    placement: "inside",
    mode: "solid",
    color: [15, 15, 25, 255],
  });
  assert.equal(countOpaque(inside4), 16);
  // Perimeter of 4x4 (12 px) receives outline color, inner 2x2 (4 px) stays original
  assert.deepEqual(inside4.getPixel(1, 1), [15, 15, 25, 255]);
  assert.deepEqual(inside4.getPixel(2, 2), [200, 180, 100, 255]);

  // Mask restricts outside outline writes
  const mask = createRectSelection(7, 7, 3, 2, 3, 2);
  const masked = applyOutlineFilter(
    single,
    {
      thickness: 1,
      connectivity: 4,
      placement: "outside",
      mode: "solid",
      color: [255, 0, 0, 255],
    },
    mask
  );
  assert.equal(countOpaque(masked), 2);
  assert.deepEqual(masked.getPixel(3, 2), [255, 0, 0, 255]);
  assert.deepEqual(masked.getPixel(4, 3), [0, 0, 0, 0]);
});

test("D4 applyDropShadowFilter: renders shadow at offset without overwriting foreground", () => {
  const src = new PixelBuffer(6, 6);
  src.setPixel(1, 1, 255, 0, 0, 255);
  src.setPixel(2, 1, 0, 255, 0, 255);

  const out = applyDropShadowFilter(src, {
    offsetX: 1,
    offsetY: 2,
    color: [10, 20, 40, 255],
    opacity: 50,
  });

  // Foreground stays crisp on top (even if shadow overlaps another foreground pixel)
  assert.deepEqual(out.getPixel(1, 1), [255, 0, 0, 255]);
  assert.deepEqual(out.getPixel(2, 1), [0, 255, 0, 255]);
  // Shadow appears at (1+1, 1+2) = (2, 3) and (2+1, 1+2) = (3, 3)
  const s1 = out.getPixel(2, 3);
  assert.equal(s1[0], 10);
  assert.equal(s1[1], 20);
  assert.equal(s1[2], 40);
  assert.ok(s1[3] >= 127 && s1[3] <= 128);
  assert.deepEqual(out.getPixel(3, 3), s1);

  // Overlapping shadow behind opaque foreground pixel does not alter foreground
  const overlap = applyDropShadowFilter(src, {
    offsetX: 1,
    offsetY: 0,
    color: [0, 0, 0, 255],
    opacity: 100,
  });
  assert.deepEqual(overlap.getPixel(2, 1), [0, 255, 0, 255]);
  assert.deepEqual(overlap.getPixel(3, 1), [0, 0, 0, 255]);
});

test("D4 applyHsvAdjust & applyBrightnessContrast: identity at 0, hue shift, brightness, and alpha preservation", () => {
  const src = new PixelBuffer(3, 1);
  src.setPixel(0, 0, 255, 0, 0, 200);
  src.setPixel(1, 0, 100, 150, 200, 128);
  src.setPixel(2, 0, 0, 0, 0, 0);

  const hsvId = applyHsvAdjust(src, { hueDeg: 0, satDelta: 0, valDelta: 0 });
  assert.deepEqual(hsvId.data, src.data);

  // +120 deg hue shift turns pure red (255,0,0) into pure green (0,255,0) preserving alpha
  const hueShifted = applyHsvAdjust(src, { hueDeg: 120, satDelta: 0, valDelta: 0 });
  assert.deepEqual(hueShifted.getPixel(0, 0), [0, 255, 0, 200]);
  assert.deepEqual(hueShifted.getPixel(2, 0), [0, 0, 0, 0]);

  const bcId = applyBrightnessContrast(src, { brightness: 0, contrast: 0 });
  assert.deepEqual(bcId.data, src.data);

  const brighter = applyBrightnessContrast(src, { brightness: 20, contrast: 0 });
  assert.ok(brighter.getPixel(1, 0)[0] > 100);
  assert.ok(brighter.getPixel(1, 0)[1] > 150);
  assert.ok(brighter.getPixel(1, 0)[2] > 200);
  assert.equal(brighter.getPixel(1, 0)[3], 128);
  assert.deepEqual(brighter.getPixel(2, 0), [0, 0, 0, 0]);
});

test("D4 applyColorReplace: exact and tolerance-based replacement", () => {
  const src = new PixelBuffer(4, 1);
  src.setPixel(0, 0, 100, 100, 100, 255);
  src.setPixel(1, 0, 105, 96, 102, 255);
  src.setPixel(2, 0, 120, 100, 100, 255);
  src.setPixel(3, 0, 100, 100, 100, 0);

  const exact = applyColorReplace(src, {
    fromRgba: [100, 100, 100, 255],
    toRgba: [10, 20, 30, 255],
    tolerance: 0,
  });
  assert.deepEqual(exact.getPixel(0, 0), [10, 20, 30, 255]);
  assert.deepEqual(exact.getPixel(1, 0), [105, 96, 102, 255]);
  assert.deepEqual(exact.getPixel(3, 0), [100, 100, 100, 0]);

  const tol10 = applyColorReplace(src, {
    fromRgba: [100, 100, 100, 255],
    toRgba: [10, 20, 30, 255],
    tolerance: 10,
  });
  assert.deepEqual(tol10.getPixel(0, 0), [10, 20, 30, 255]);
  assert.deepEqual(tol10.getPixel(1, 0), [10, 20, 30, 255]); // max diff is 5 <= 10
  assert.deepEqual(tol10.getPixel(2, 0), [120, 100, 100, 255]); // diff is 20 > 10
});

test("D4 applyQuantizeToPalette: none, bayer4, and floydSteinberg emit only palette colors", () => {
  const palette: RGBA[] = [
    [0, 0, 0, 255],
    [255, 255, 255, 255],
    [255, 0, 0, 255],
    [0, 0, 255, 255],
  ];
  const src = new PixelBuffer(8, 4);
  for (let y = 0; y < 4; y++) {
    for (let x = 0; x < 8; x++) {
      if (x === 7 && y === 3) continue; // keep one transparent pixel
      src.setPixel(x, y, Math.round((x / 7) * 255), Math.round((y / 3) * 128), 110, 200);
    }
  }

  const paletteSet = new Set(palette.map((c) => `${c[0]},${c[1]},${c[2]}`));

  for (const dither of ["none", "bayer4", "floydSteinberg"] as const) {
    const q = applyQuantizeToPalette(src, { palette, dither });
    assert.deepEqual(q.getPixel(7, 3), [0, 0, 0, 0]);
    for (let y = 0; y < 4; y++) {
      for (let x = 0; x < 8; x++) {
        if (x === 7 && y === 3) continue;
        const p = q.getPixel(x, y);
        assert.equal(p[3], 200);
        assert.ok(paletteSet.has(`${p[0]},${p[1]},${p[2]}`), `${dither} emitted non-palette color`);
      }
    }
  }

  // Empty palette returns clone
  const emptyPal = applyQuantizeToPalette(src, { palette: [], dither: "floydSteinberg" });
  assert.deepEqual(emptyPal.data, src.data);
});

test("D4 applyInvertFilter, applyDesaturateFilter, and applyPixelCleanupFilter", () => {
  const src = new PixelBuffer(7, 7);
  // 3x3 ring around (3,3) hole
  for (let y = 2; y <= 4; y++) {
    for (let x = 2; x <= 4; x++) {
      if (x === 3 && y === 3) continue;
      src.setPixel(x, y, 200, 100, 40, 180);
    }
  }
  // True orphan pixel at (0, 0) with 0 opaque 8-neighbors
  src.setPixel(0, 0, 10, 20, 30, 255);

  const inv = applyInvertFilter(src);
  assert.deepEqual(inv.getPixel(0, 0), [245, 235, 225, 255]);
  assert.deepEqual(inv.getPixel(2, 2), [55, 155, 215, 180]);
  assert.deepEqual(inv.getPixel(3, 3), [0, 0, 0, 0]);

  const desat = applyDesaturateFilter(src);
  const expectedLuma = Math.round(0.2126 * 200 + 0.7152 * 100 + 0.0722 * 40);
  assert.deepEqual(desat.getPixel(2, 2), [expectedLuma, expectedLuma, expectedLuma, 180]);
  assert.deepEqual(desat.getPixel(3, 3), [0, 0, 0, 0]);

  const cleaned = applyPixelCleanupFilter(src, {
    removeOrphans: true,
    fillHoles: true,
  });
  assert.deepEqual(cleaned.getPixel(0, 0), [0, 0, 0, 0]);
  assert.deepEqual(cleaned.getPixel(3, 3), [200, 100, 40, 180]);
});

test("D4 spriteOps: computeTightBounds, cropBufferToBounds, offsetWrapBuffer, and scaleBufferAlgorithm", () => {
  const emptyA = new PixelBuffer(8, 8);
  const emptyB = new PixelBuffer(8, 8);
  assert.equal(computeTightBounds([emptyA, emptyB]), null);

  const bufA = new PixelBuffer(8, 8);
  bufA.setPixel(2, 3, 255, 0, 0, 255);
  const bufB = new PixelBuffer(8, 8);
  bufB.setPixel(5, 6, 0, 255, 0, 255);

  const bounds = computeTightBounds([bufA, bufB]);
  assert.deepEqual(bounds, { x: 2, y: 3, width: 4, height: 4 });

  const cropped = cropBufferToBounds(bufA, bounds!);
  assert.equal(cropped.width, 4);
  assert.equal(cropped.height, 4);
  assert.deepEqual(cropped.getPixel(0, 0), [255, 0, 0, 255]);
  assert.deepEqual(cropped.getPixel(3, 3), [0, 0, 0, 0]);

  // offsetWrapBuffer round-trip (+dx, +dy) then (-dx, -dy) === exact identity
  const pat = new PixelBuffer(6, 5);
  for (let y = 0; y < 5; y++) {
    for (let x = 0; x < 6; x++) {
      pat.setPixel(x, y, x * 40, y * 50, (x + y) * 20, 255);
    }
  }
  const shifted = offsetWrapBuffer(pat, 4, -3);
  assert.deepEqual(shifted.getPixel(4, 2), pat.getPixel(0, 0));
  const roundTrip = offsetWrapBuffer(shifted, -4, 3);
  assert.deepEqual(roundTrip.data, pat.data);

  // Masked offsetWrapBuffer only shifts inside mask bounds
  const subMask = createRectSelection(6, 5, 1, 1, 3, 2); // 3x2 box
  const maskedShift = offsetWrapBuffer(pat, 1, 0, subMask);
  assert.deepEqual(maskedShift.getPixel(0, 0), pat.getPixel(0, 0));
  assert.deepEqual(maskedShift.getPixel(2, 1), pat.getPixel(1, 1));
  assert.deepEqual(maskedShift.getPixel(1, 1), pat.getPixel(3, 1));

  // scaleBufferAlgorithm: clamping and upscaling via nearest / scale2x / rotsprite
  const small = new PixelBuffer(2, 2);
  small.setPixel(0, 0, 255, 0, 0, 255);
  small.setPixel(1, 0, 0, 255, 0, 255);
  small.setPixel(0, 1, 0, 0, 255, 255);
  small.setPixel(1, 1, 255, 255, 0, 255);

  const clampedMin = scaleBufferAlgorithm(small, 0, -5, "nearest");
  assert.equal(clampedMin.width, 1);
  assert.equal(clampedMin.height, 1);

  const clampedMax = scaleBufferAlgorithm(small, 9999, 4, "nearest");
  assert.equal(clampedMax.width, 2048);
  assert.equal(clampedMax.height, 4);

  const upNearest = scaleBufferAlgorithm(small, 4, 4, "nearest");
  assert.deepEqual(upNearest.getPixel(0, 0), [255, 0, 0, 255]);
  assert.deepEqual(upNearest.getPixel(3, 3), [255, 255, 0, 255]);

  const upScale2x = scaleBufferAlgorithm(small, 4, 4, "scale2x");
  assert.equal(upScale2x.width, 4);
  assert.equal(upScale2x.height, 4);
  assert.deepEqual(upScale2x.getPixel(0, 0), [255, 0, 0, 255]);

  const upRotsprite = scaleBufferAlgorithm(small, 6, 6, "rotsprite");
  assert.equal(upRotsprite.width, 6);
  assert.equal(upRotsprite.height, 6);
  assert.deepEqual(upRotsprite.getPixel(5, 5), [255, 255, 0, 255]);
});

test("D4-UI: TileHistory multi-cel atomic undo/redo and filterActions scope/auto-crop/scale", () => {
  const hist = new TileHistory(20);
  const celA = new PixelBuffer(8, 8);
  const celB = new PixelBuffer(8, 8);
  celA.setPixel(1, 1, 10, 20, 30, 255);
  celB.setPixel(2, 2, 40, 50, 60, 255);

  hist.beginMultiCelTransaction("Batch Invert");
  hist.captureMultiCel("layer-a", 0, celA);
  hist.captureMultiCel("layer-a", 1, celB);
  celA.setPixel(1, 1, 245, 235, 225, 255);
  celB.setPixel(2, 2, 215, 205, 195, 255);
  assert.equal(hist.commitMultiCelTransaction(), true);

  const undone = hist.undo((_layerId, frame) => (frame === 0 ? celA : celB));
  assert.ok(undone);
  assert.deepEqual(celA.getPixel(1, 1), [10, 20, 30, 255]);
  assert.deepEqual(celB.getPixel(2, 2), [40, 50, 60, 255]);

  const redone = hist.redo((_layerId, frame) => (frame === 0 ? celA : celB));
  assert.ok(redone);
  assert.deepEqual(celA.getPixel(1, 1), [245, 235, 225, 255]);
  assert.deepEqual(celB.getPixel(2, 2), [215, 205, 195, 255]);

  // Test applyBufferFilterAction across "layer" scope with single-step performUndo/performRedo
  pixelEngine.resetForDocument(16, 16);
  useEditorStore.getState().loadProjectState({
    documentName: "filter-test.pixet",
    filePath: null,
    canvasWidth: 16,
    canvasHeight: 16,
    colorMode: "RGBA",
    paletteName: "Default",
    palette: ["#000000", "#ffffff"],
    layers: [
      {
        id: "layer-1",
        name: "Layer 1",
        kind: "raster",
        visible: true,
        locked: false,
        opacity: 100,
        alphaLock: false,
        blendMode: "Normal",
        parentId: null,
        cels: { 0: true, 1: true },
      },
    ],
    frames: [
      { id: "f0", index: 0, durationMs: 100 },
      { id: "f1", index: 1, durationMs: 100 },
    ],
    tags: [],
  });

  const f0 = pixelEngine.getOrCreateCel("layer-1", 0);
  const f1 = pixelEngine.getOrCreateCel("layer-1", 1);
  f0.setPixel(4, 5, 10, 20, 30, 255);
  f1.setPixel(8, 9, 100, 120, 140, 255);

  const ok = applyBufferFilterAction("Invert Colors", "layer", (buf, mask) =>
    applyInvertFilter(buf, mask)
  );
  assert.equal(ok, true);
  assert.deepEqual(f0.getPixel(4, 5), [245, 235, 225, 255]);
  assert.deepEqual(f1.getPixel(8, 9), [155, 135, 115, 255]);
  assert.equal(useEditorStore.getState().canUndo, true);

  performUndo();
  assert.deepEqual(f0.getPixel(4, 5), [10, 20, 30, 255]);
  assert.deepEqual(f1.getPixel(8, 9), [100, 120, 140, 255]);

  performRedo();
  assert.deepEqual(f0.getPixel(4, 5), [245, 235, 225, 255]);
  assert.deepEqual(f1.getPixel(8, 9), [155, 135, 115, 255]);

  // Test autoCropSpriteAction and scaleSpriteAction
  const croppedOk = autoCropSpriteAction();
  assert.equal(croppedOk, true);
  assert.equal(pixelEngine.width, 5);
  assert.equal(pixelEngine.height, 5);
  assert.equal(useEditorStore.getState().canvasWidth, 5);
  assert.equal(useEditorStore.getState().canvasHeight, 5);

  const scaledOk = scaleSpriteAction(10, 10, "nearest");
  assert.equal(scaledOk, true);
  assert.equal(pixelEngine.width, 10);
  assert.equal(pixelEngine.height, 10);
  assert.equal(useEditorStore.getState().canvasWidth, 10);
  assert.equal(useEditorStore.getState().canvasHeight, 10);

  // Store filterModal state check
  useEditorStore.getState().setFilterModalOpen(true, "dropShadow");
  assert.equal(useEditorStore.getState().filterModalOpen, true);
  assert.equal(useEditorStore.getState().filterModalTab, "dropShadow");
  useEditorStore.getState().setFilterModalOpen(false);
  assert.equal(useEditorStore.getState().filterModalOpen, false);
});

test("D5 paletteOps: computeColorHarmonies produces exact lowercase harmony angles", () => {
  const redHarmonies = computeColorHarmonies("#FF0000");
  assert.deepEqual(redHarmonies, {
    complementary: ["#00ffff"],
    analogous: ["#ff0080", "#ff8000"],
    triadic: ["#00ff00", "#0000ff"],
    splitComplementary: ["#00ff80", "#0080ff"],
  });

  // Cyan (h=180) wraps around 360 cleanly: 180-30=150 (#00ff80), 180+30=210 (#0080ff)
  const cyanHarmonies = computeColorHarmonies("#00ffff");
  assert.deepEqual(cyanHarmonies, {
    complementary: ["#ff0000"],
    analogous: ["#00ff80", "#0080ff"],
    triadic: ["#ff00ff", "#ffff00"],
    splitComplementary: ["#ff0080", "#ff8000"],
  });

  // Achromatic color preserves saturation/value
  const grayHarmonies = computeColorHarmonies("#808080");
  assert.deepEqual(grayHarmonies, {
    complementary: ["#808080"],
    analogous: ["#808080", "#808080"],
    triadic: ["#808080", "#808080"],
    splitComplementary: ["#808080", "#808080"],
  });
});

test("D5 paletteOps: sortPaletteColors sorts by hue, luminance, and saturation without mutating input", () => {
  const input = ["#0000ff", "#ffffff", "#ff0000", "#00ff00", "#000000", "#804040"];
  const snapshot = [...input];

  const byHue = sortPaletteColors(input, "hue");
  assert.deepEqual(input, snapshot);
  // Chromatic colors by hue: #804040 (0, sat 0.5), #ff0000 (0, sat 1), #00ff00 (120), #0000ff (240),
  // followed by achromatic colors sorted by luminance: #000000, #ffffff.
  assert.deepEqual(byHue, [
    "#804040",
    "#ff0000",
    "#00ff00",
    "#0000ff",
    "#000000",
    "#ffffff",
  ]);

  const byLum = sortPaletteColors(input, "luminance");
  assert.deepEqual(input, snapshot);
  // Rec. 709 luminance order: black (0) < blue (18.4) < red (54.2) < #804040 (77.6) < green (182.4) < white (255)
  assert.deepEqual(byLum, [
    "#000000",
    "#0000ff",
    "#ff0000",
    "#804040",
    "#00ff00",
    "#ffffff",
  ]);

  const bySat = sortPaletteColors(input, "saturation");
  assert.deepEqual(input, snapshot);
  // Saturation: 0 (#000000, #ffffff), 0.5 (#804040), 1 (#0000ff, #ff0000, #00ff00)
  assert.deepEqual(bySat.slice(0, 3), ["#000000", "#ffffff", "#804040"]);
  assert.equal(new Set(bySat.slice(3)).size, 3);
});

test("D5 paletteOps: extractPaletteMedianCut handles empty, exact unique <= N, and quantized > N", () => {
  const empty = new PixelBuffer(4, 4);
  assert.deepEqual(extractPaletteMedianCut([empty], 8), []);

  // Buffer with 3 opaque colors + 1 transparent pixel with non-zero RGB
  const exactBuf = new PixelBuffer(2, 2);
  exactBuf.setPixel(0, 0, 255, 0, 0, 255);
  exactBuf.setPixel(1, 0, 0, 255, 0, 255);
  exactBuf.setPixel(0, 1, 0, 0, 255, 255);
  exactBuf.setPixel(1, 1, 200, 200, 200, 0); // transparent, must be ignored

  // Unique count (3) <= maxColors (8) -> exact unique colors sorted by Rec. 709 luminance
  assert.deepEqual(extractPaletteMedianCut([exactBuf], 8), [
    "#0000ff",
    "#ff0000",
    "#00ff00",
  ]);

  // Multi-buffer quantized case: 16 distinct colors -> clamped/quantized to <= 4
  const multiA = new PixelBuffer(4, 2);
  const multiB = new PixelBuffer(4, 2);
  for (let i = 0; i < 8; i++) {
    multiA.setPixel(i % 4, Math.floor(i / 4), i * 32, 0, 0, 255);
    multiB.setPixel(i % 4, Math.floor(i / 4), 0, i * 32, 255 - i * 32, 255);
  }
  const quantized4 = extractPaletteMedianCut([multiA, multiB], 4);
  assert.ok(quantized4.length >= 2 && quantized4.length <= 4);
  for (const hex of quantized4) {
    assert.match(hex, /^#[0-9a-f]{6}$/);
  }

  // maxColors < 2 clamps to 2
  const clampedMin = extractPaletteMedianCut([exactBuf], 1);
  assert.ok(clampedMin.length >= 1 && clampedMin.length <= 2);
});

test("D5 paletteOps: generateHueShiftedRamp preserves endpoints, clamps steps, and stays monotonic in luminance", () => {
  const ramp = generateHueShiftedRamp("#1a1030", "#f8e8a0", 5, -20);
  assert.equal(ramp.length, 5);
  assert.equal(ramp[0], "#1a1030");
  assert.equal(ramp[4], "#f8e8a0");

  const lum = (hex: string) => {
    const clean = hex.slice(1);
    const r = parseInt(clean.slice(0, 2), 16);
    const g = parseInt(clean.slice(2, 4), 16);
    const b = parseInt(clean.slice(4, 6), 16);
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  for (let i = 1; i < ramp.length; i++) {
    assert.ok(
      lum(ramp[i]) >= lum(ramp[i - 1]),
      `expected monotonic luminance at index ${i}: ${ramp[i - 1]} -> ${ramp[i]}`
    );
  }

  // Midpoint differs when hueShiftDeg != 0 vs 0
  const unshifted = generateHueShiftedRamp("#203080", "#d0e0ff", 5, 0);
  const shifted = generateHueShiftedRamp("#203080", "#d0e0ff", 5, 45);
  assert.equal(unshifted[0], shifted[0]);
  assert.equal(unshifted[4], shifted[4]);
  assert.notEqual(unshifted[2], shifted[2]);

  // Step clamping 2..16
  assert.equal(generateHueShiftedRamp("#000000", "#ffffff", 1).length, 2);
  assert.equal(generateHueShiftedRamp("#000000", "#ffffff", 99).length, 16);
});

test("D5 paletteOps: snapRgbaToPalette matches exact/nearest colors, preserves alpha, and handles empty palette", () => {
  const palette: RGBA[] = [
    [0, 0, 0, 255],
    [255, 0, 0, 255],
    [0, 255, 0, 255],
    [255, 255, 255, 255],
  ];

  // Exact match
  assert.deepEqual(snapRgbaToPalette([255, 0, 0, 255], palette), [255, 0, 0, 255]);

  // Nearest match + alpha preserved
  assert.deepEqual(snapRgbaToPalette([230, 20, 15, 128], palette), [255, 0, 0, 128]);
  assert.deepEqual(snapRgbaToPalette([10, 240, 25, 200], palette), [0, 255, 0, 200]);

  // Transparent pixel returned unchanged (new tuple)
  const transparent: RGBA = [123, 45, 67, 0];
  const snappedTransparent = snapRgbaToPalette(transparent, palette);
  assert.deepEqual(snappedTransparent, [123, 45, 67, 0]);
  assert.notEqual(snappedTransparent, transparent);

  // Empty palette safe (returns copy of input)
  const opaque: RGBA = [12, 34, 56, 255];
  const snappedEmpty = snapRgbaToPalette(opaque, []);
  assert.deepEqual(snappedEmpty, [12, 34, 56, 255]);
  assert.notEqual(snappedEmpty, opaque);
});

test("D5-UI: editorStore color & palette actions (alpha, paletteLock, recentColors, pickerMode, palette CRUD)", () => {
  const store = useEditorStore.getState();

  // primaryAlpha clamps 0..255
  assert.equal(store.primaryAlpha, 255);
  store.setPrimaryAlpha(128);
  assert.equal(useEditorStore.getState().primaryAlpha, 128);
  store.setPrimaryAlpha(-20);
  assert.equal(useEditorStore.getState().primaryAlpha, 0);
  store.setPrimaryAlpha(999);
  assert.equal(useEditorStore.getState().primaryAlpha, 255);

  // paletteLock toggle
  const initialLock = useEditorStore.getState().paletteLock;
  store.togglePaletteLock();
  assert.equal(useEditorStore.getState().paletteLock, !initialLock);
  store.togglePaletteLock();
  assert.equal(useEditorStore.getState().paletteLock, initialLock);

  // colorPickerMode
  assert.equal(useEditorStore.getState().colorPickerMode, "square");
  store.setColorPickerMode("wheel");
  assert.equal(useEditorStore.getState().colorPickerMode, "wheel");
  store.setColorPickerMode("square");

  // recentColors auto-pushed on setPrimaryColor, deduplicated & capped at 16
  for (let i = 0; i < 20; i++) {
    const hex = `#${i.toString(16).padStart(2, "0")}0000`;
    store.setPrimaryColor(hex);
  }
  const recents = useEditorStore.getState().recentColors;
  assert.equal(recents.length, 16);
  assert.equal(recents[0], "#130000");

  // Pushing an existing color moves it to index 0 without duplicating
  store.pushRecentColor("#0a0000");
  const afterPush = useEditorStore.getState().recentColors;
  assert.equal(afterPush.length, 16);
  assert.equal(afterPush[0], "#0a0000");

  // Palette CRUD: set, reorder, replace, duplicate, remove, append
  store.setPalette("Test", ["#111111", "#222222", "#333333"]);
  store.reorderPalette(0, 2);
  assert.deepEqual(useEditorStore.getState().palette, [
    "#222222",
    "#333333",
    "#111111",
  ]);
  store.replacePaletteColor(1, "#ABCDEF");
  assert.deepEqual(useEditorStore.getState().palette, [
    "#222222",
    "#abcdef",
    "#111111",
  ]);
  store.duplicatePaletteColor(0);
  assert.deepEqual(useEditorStore.getState().palette, [
    "#222222",
    "#222222",
    "#abcdef",
    "#111111",
  ]);
  store.removePaletteColor(1);
  assert.deepEqual(useEditorStore.getState().palette, [
    "#222222",
    "#abcdef",
    "#111111",
  ]);
  store.appendPaletteColors(["#222222", "#444444", "#ABCDEF", "#555555"]);
  assert.deepEqual(useEditorStore.getState().palette, [
    "#222222",
    "#abcdef",
    "#111111",
    "#444444",
    "#555555",
  ]);
});

test("D6 blendModes: all 16 W3C blend modes match reference formulas", () => {
  assert.equal(ALL_BLEND_MODES.length, 16);

  const approx = (actual: [number, number, number], expected: [number, number, number], label: string) => {
    for (let i = 0; i < 3; i++) {
      assert.ok(
        Math.abs(actual[i] - expected[i]) < 1e-5,
        `${label} channel ${i}: expected ${expected[i]}, got ${actual[i]}`
      );
    }
  };

  // Separable modes on distinct midtone inputs
  approx(blendRgb(0.4, 0.6, 0.8, 0.2, 0.8, 0.5, "Normal"), [0.2, 0.8, 0.5], "Normal");
  approx(blendRgb(0.4, 0.6, 0.8, 0.2, 0.8, 0.5, "Multiply"), [0.08, 0.48, 0.4], "Multiply");
  approx(
    blendRgb(0.4, 0.6, 0.8, 0.2, 0.8, 0.5, "Screen"),
    [1 - 0.6 * 0.8, 1 - 0.4 * 0.2, 1 - 0.2 * 0.5],
    "Screen"
  );
  approx(
    blendRgb(0.25, 0.75, 0.5, 0.6, 0.4, 0.8, "Overlay"),
    [2 * 0.25 * 0.6, 1 - 2 * 0.25 * 0.6, 0.8],
    "Overlay"
  );
  approx(blendRgb(0.4, 0.6, 0.8, 0.2, 0.8, 0.5, "Add"), [0.6, 1, 1], "Add");
  approx(blendRgb(0.4, 0.6, 0.8, 0.2, 0.8, 0.5, "Darken"), [0.2, 0.6, 0.5], "Darken");
  approx(blendRgb(0.4, 0.6, 0.8, 0.2, 0.8, 0.5, "Lighten"), [0.4, 0.8, 0.8], "Lighten");
  approx(
    blendRgb(0, 0.4, 0.8, 0.5, 1, 0.5, "ColorDodge"),
    [0, 1, 1],
    "ColorDodge edge"
  );
  approx(
    blendRgb(0.3, 0.5, 0.2, 0.5, 0.2, 0.6, "ColorDodge"),
    [0.6, 0.625, 0.5],
    "ColorDodge mid"
  );
  approx(
    blendRgb(1, 0.5, 0.8, 0.3, 0, 0.5, "ColorBurn"),
    [1, 0, 0.6],
    "ColorBurn"
  );
  approx(
    blendRgb(0.6, 0.4, 0.8, 0.25, 0.75, 0.5, "HardLight"),
    [2 * 0.6 * 0.25, 1 - 2 * 0.6 * 0.25, 0.8],
    "HardLight"
  );
  approx(
    blendRgb(0.16, 0.64, 0.5, 0.25, 0.75, 0.5, "SoftLight"),
    [
      0.16 - (1 - 0.5) * 0.16 * 0.84,
      0.64 + (1.5 - 1) * (Math.sqrt(0.64) - 0.64),
      0.5,
    ],
    "SoftLight"
  );
  approx(
    blendRgb(0.4, 0.6, 0.8, 0.7, 0.2, 0.8, "Difference"),
    [0.3, 0.4, 0],
    "Difference"
  );

  // Non-separable W3C HSL modes
  // dst = (0.8, 0.2, 0.2) -> lum = 0.38, sat = 0.6 (red hue)
  // src = (0.2, 0.4, 0.9) -> lum = 0.395, sat = 0.7 (blue-ish hue)
  const lumFn = (c: [number, number, number]) => 0.3 * c[0] + 0.59 * c[1] + 0.11 * c[2];
  const satFn = (c: [number, number, number]) => Math.max(...c) - Math.min(...c);

  const hueOut = blendRgb(0.8, 0.2, 0.2, 0.2, 0.4, 0.9, "Hue");
  assert.ok(Math.abs(lumFn(hueOut) - lumFn([0.8, 0.2, 0.2])) < 1e-5);
  assert.ok(hueOut[2] > hueOut[1] && hueOut[1] > hueOut[0]);

  const satOut = blendRgb(0.8, 0.2, 0.2, 0.2, 0.4, 0.9, "Saturation");
  assert.ok(Math.abs(lumFn(satOut) - lumFn([0.8, 0.2, 0.2])) < 1e-5);
  assert.ok(satOut[0] > satOut[1] && Math.abs(satOut[1] - satOut[2]) < 1e-5);
  assert.ok(Math.abs(satFn(satOut) - 0.7) < 1e-5);

  const colorOut = blendRgb(0.8, 0.2, 0.2, 0.2, 0.4, 0.9, "Color");
  assert.ok(Math.abs(lumFn(colorOut) - lumFn([0.8, 0.2, 0.2])) < 1e-5);
  assert.ok(colorOut[2] > colorOut[1] && colorOut[1] > colorOut[0]);

  const lumOut = blendRgb(0.8, 0.2, 0.2, 0.2, 0.4, 0.9, "Luminosity");
  assert.ok(Math.abs(lumFn(lumOut) - lumFn([0.2, 0.4, 0.9])) < 1e-5);
  assert.ok(lumOut[0] > lumOut[1] && Math.abs(lumOut[1] - lumOut[2]) < 1e-5);
});

test("D6 PixelEngine: clipping masks (single, stacked, semi-transparent base, orphan clipped, and blend modes)", () => {
  pixelEngine.resetForDocument(4, 1);

  const base = pixelEngine.getOrCreateCel("base", 0);
  // px0: opaque blue; px1: ~50% alpha blue; px2: transparent; px3: opaque blue
  base.setPixel(0, 0, 0, 0, 255, 255);
  base.setPixel(1, 0, 0, 0, 255, 128);
  base.setPixel(3, 0, 0, 0, 255, 255);

  // Stacked clipped layers cover all 4 pixels with solid colors
  const clip1 = pixelEngine.getOrCreateCel("clip1", 0);
  const clip2 = pixelEngine.getOrCreateCel("clip2", 0);
  for (let x = 0; x < 4; x++) {
    clip1.setPixel(x, 0, 255, 0, 0, 255);
    clip2.setPixel(x, 0, 0, 255, 0, 128);
  }

  // Layers are ordered top-to-bottom
  const singleLayers = [
    {
      id: "clip1",
      kind: "raster",
      visible: true,
      opacity: 100,
      blendMode: "Normal" as BlendMode,
      parentId: null,
      clipped: true,
    },
    {
      id: "base",
      kind: "raster",
      visible: true,
      opacity: 100,
      blendMode: "Normal" as BlendMode,
      parentId: null,
      clipped: false,
    },
  ];

  const singleOut = pixelEngine.compositeFrame(singleLayers, 0);
  // px0: clipped fully onto opaque base -> red
  assert.deepEqual(Array.from(singleOut.slice(0, 4)), [255, 0, 0, 255]);
  // px1: clip1 alpha is 128/255 over base alpha 128/255
  assert.equal(singleOut[6], 85); // blue contribution ~ 1/3
  assert.equal(singleOut[4], 170); // red contribution ~ 2/3
  assert.equal(singleOut[7], 192); // outA = 0.502 + 0.502*(1-0.502) = 0.752 -> 192
  // px2: base is transparent -> clipped pixel remains transparent
  assert.deepEqual(Array.from(singleOut.slice(8, 12)), [0, 0, 0, 0]);

  // Stacked clipping masks share the same base alpha
  const stackedLayers = [
    {
      id: "clip2",
      kind: "raster",
      visible: true,
      opacity: 100,
      blendMode: "Lighten" as BlendMode,
      parentId: null,
      clipped: true,
    },
    ...singleLayers,
  ];
  const stackedOut = pixelEngine.compositeFrame(stackedLayers, 0);
  // px2 still transparent across both stacked clipped layers
  assert.deepEqual(Array.from(stackedOut.slice(8, 12)), [0, 0, 0, 0]);
  // px0: clip1 was (255,0,0,255), clip2 Lighten with (0,255,0) -> (255,255,0) blended at ~50% alpha -> (255,128,0,255)
  assert.deepEqual(Array.from(stackedOut.slice(0, 4)), [255, 128, 0, 255]);

  // Clipped layer with no visible non-clipped base beneath it renders nothing
  const orphanLayers = [
    {
      id: "clip1",
      kind: "raster",
      visible: true,
      opacity: 100,
      blendMode: "Normal" as BlendMode,
      parentId: null,
      clipped: true,
    },
    {
      id: "base",
      kind: "raster",
      visible: false,
      opacity: 100,
      blendMode: "Normal" as BlendMode,
      parentId: null,
      clipped: false,
    },
  ];
  const orphanOut = pixelEngine.compositeFrame(orphanLayers, 0);
  assert.ok(orphanOut.every((v) => v === 0));

  // Store actions: toggleLayerClipped & setLayerColorTag
  const store = useEditorStore.getState();
  const targetId = store.layers[0].id;
  const wasClipped = Boolean(store.layers[0].clipped);
  store.toggleLayerClipped(targetId);
  assert.equal(useEditorStore.getState().layers[0].clipped, !wasClipped);
  store.toggleLayerClipped(targetId);
  assert.equal(Boolean(useEditorStore.getState().layers[0].clipped), wasClipped);

  store.setLayerColorTag(targetId, "#d95763");
  assert.equal(useEditorStore.getState().layers[0].colorTag, "#d95763");
  store.setLayerColorTag(targetId, null);
  assert.equal(useEditorStore.getState().layers[0].colorTag, null);
});

test("D6-UI: soloLayer toggles solo visibility and restores snapshot (with group ancestors)", () => {
  useEditorStore.setState({
    layers: [
      {
        id: "grp-1",
        name: "Group",
        kind: "group",
        visible: true,
        locked: false,
        opacity: 100,
        alphaLock: false,
        blendMode: "Normal",
        parentId: null,
        expanded: true,
        cels: {},
      },
      {
        id: "l-child",
        name: "Child",
        kind: "raster",
        visible: false,
        locked: false,
        opacity: 100,
        alphaLock: false,
        blendMode: "Normal",
        parentId: "grp-1",
        cels: { 0: false },
      },
      {
        id: "l-other",
        name: "Other",
        kind: "raster",
        visible: true,
        locked: false,
        opacity: 100,
        alphaLock: false,
        blendMode: "Normal",
        parentId: null,
        cels: { 0: false },
      },
    ],
    activeLayerId: "l-child",
    selectedLayerIds: ["l-child"],
    soloVisibilitySnapshot: null,
  });

  // First call: solos l-child and its parent grp-1, hides l-other, saves original visibility
  useEditorStore.getState().soloLayer("l-child");
  let st = useEditorStore.getState();
  assert.deepEqual(st.soloVisibilitySnapshot, {
    "grp-1": true,
    "l-child": false,
    "l-other": true,
  });
  assert.equal(st.layers.find((l) => l.id === "grp-1")?.visible, true);
  assert.equal(st.layers.find((l) => l.id === "l-child")?.visible, true);
  assert.equal(st.layers.find((l) => l.id === "l-other")?.visible, false);

  // Second call on same layer: restores original snapshot and clears snapshot
  useEditorStore.getState().soloLayer("l-child");
  st = useEditorStore.getState();
  assert.equal(st.soloVisibilitySnapshot, null);
  assert.equal(st.layers.find((l) => l.id === "grp-1")?.visible, true);
  assert.equal(st.layers.find((l) => l.id === "l-child")?.visible, false);
  assert.equal(st.layers.find((l) => l.id === "l-other")?.visible, true);
});

test("D6-UI: layerActions mergeDown, mergeVisible, flattenImage, clearActiveCel (undoable), and duplicateLayerAllFrames", () => {
  pixelEngine.resetForDocument(2, 2);
  useEditorStore.setState({
    layers: [
      {
        id: "top",
        name: "Top",
        kind: "raster",
        visible: true,
        locked: false,
        opacity: 100,
        alphaLock: false,
        blendMode: "Normal",
        parentId: null,
        clipped: true,
        cels: { 0: true, 1: true },
      },
      {
        id: "mid",
        name: "Mid",
        kind: "raster",
        visible: true,
        locked: false,
        opacity: 100,
        alphaLock: false,
        blendMode: "Normal",
        parentId: null,
        clipped: false,
        cels: { 0: true, 1: true },
      },
      {
        id: "hidden",
        name: "Hidden",
        kind: "raster",
        visible: false,
        locked: false,
        opacity: 100,
        alphaLock: false,
        blendMode: "Normal",
        parentId: null,
        cels: { 0: true, 1: true },
      },
    ],
    frames: [
      { id: "f1", index: 0, durationMs: 100 },
      { id: "f2", index: 1, durationMs: 100 },
    ],
    currentFrame: 0,
    activeLayerId: "top",
    selectedLayerIds: ["top"],
    soloVisibilitySnapshot: null,
  });

  // Frame 0: mid has opaque blue at (0,0), transparent at (1,0); top (clipped) has red at both
  const mid0 = pixelEngine.getOrCreateCel("mid", 0);
  mid0.setPixel(0, 0, 0, 0, 255, 255);
  const top0 = pixelEngine.getOrCreateCel("top", 0);
  top0.setPixel(0, 0, 255, 0, 0, 255);
  top0.setPixel(1, 0, 255, 0, 0, 255);

  // Frame 1: mid has green at (1,1); top has blue at (1,1)
  const mid1 = pixelEngine.getOrCreateCel("mid", 1);
  mid1.setPixel(1, 1, 0, 255, 0, 255);
  const top1 = pixelEngine.getOrCreateCel("top", 1);
  top1.setPixel(1, 1, 0, 0, 255, 255);

  // Hidden layer has white at (0,1)
  const hid0 = pixelEngine.getOrCreateCel("hidden", 0);
  hid0.setPixel(0, 1, 255, 255, 255, 255);

  // 1. Merge Down: top (clipped) merges into mid across all frames
  assert.equal(mergeDownLayerAction(), true);
  let st = useEditorStore.getState();
  assert.equal(st.layers.length, 2);
  assert.equal(st.activeLayerId, "mid");
  assert.deepEqual(pixelEngine.getCel("mid", 0)?.getPixel(0, 0), [255, 0, 0, 255]);
  // Clipped (1,0) over transparent mid remains transparent
  assert.deepEqual(pixelEngine.getCel("mid", 0)?.getPixel(1, 0), [0, 0, 0, 0]);
  assert.deepEqual(pixelEngine.getCel("mid", 1)?.getPixel(1, 1), [0, 0, 255, 255]);

  // 2. Duplicate Across All Frames
  assert.equal(duplicateLayerAllFramesAction("mid"), true);
  st = useEditorStore.getState();
  assert.equal(st.layers.length, 3);
  const dupId = st.activeLayerId;
  assert.notEqual(dupId, "mid");
  assert.deepEqual(pixelEngine.getCel(dupId, 0)?.getPixel(0, 0), [255, 0, 0, 255]);
  assert.deepEqual(pixelEngine.getCel(dupId, 1)?.getPixel(1, 1), [0, 0, 255, 255]);

  // 3. Clear Cel (undoable via TileHistory)
  assert.equal(clearActiveCelAction(), true);
  assert.equal(pixelEngine.getCel(dupId, 0)?.isEmpty(), true);
  assert.equal(useEditorStore.getState().canUndo, true);
  performUndo();
  assert.deepEqual(pixelEngine.getCel(dupId, 0)?.getPixel(0, 0), [255, 0, 0, 255]);
  performRedo();
  assert.equal(pixelEngine.getCel(dupId, 0)?.isEmpty(), true);

  // 4. Merge Visible (2 visible raster layers: dupId + mid; hidden stays untouched)
  assert.equal(mergeVisibleLayersAction(), true);
  st = useEditorStore.getState();
  assert.equal(st.layers.length, 2);
  assert.ok(st.layers.some((l) => l.id === "hidden"));
  const mergedId = st.activeLayerId;
  assert.deepEqual(pixelEngine.getCel(mergedId, 0)?.getPixel(0, 0), [255, 0, 0, 255]);

  // 5. Flatten Image -> single "Background" layer
  assert.equal(flattenImageAction(), true);
  st = useEditorStore.getState();
  assert.equal(st.layers.length, 1);
  assert.equal(st.layers[0].name, "Background");
  assert.deepEqual(pixelEngine.getCel(st.layers[0].id, 0)?.getPixel(0, 0), [255, 0, 0, 255]);
  // Hidden layer is excluded from flattened output
  assert.deepEqual(pixelEngine.getCel(st.layers[0].id, 0)?.getPixel(0, 1), [0, 0, 0, 0]);
});

test("D7 animationHelpers: computeNextPlaybackFrame forward, reverse, pingpong, single-frame, and non-loop stop", () => {
  // Single-frame range
  assert.deepEqual(computeNextPlaybackFrame(2, 2, 2, "forward", 1, true), {
    nextFrame: 2,
    nextPingPongDir: 1,
    stop: false,
  });
  assert.deepEqual(computeNextPlaybackFrame(2, 2, 2, "pingpong", 1, false), {
    nextFrame: 2,
    nextPingPongDir: 1,
    stop: true,
  });

  // Forward loop & non-loop stop
  assert.deepEqual(computeNextPlaybackFrame(1, 1, 3, "forward", 1, true), {
    nextFrame: 2,
    nextPingPongDir: 1,
    stop: false,
  });
  assert.deepEqual(computeNextPlaybackFrame(3, 1, 3, "forward", 1, true), {
    nextFrame: 1,
    nextPingPongDir: 1,
    stop: false,
  });
  assert.deepEqual(computeNextPlaybackFrame(3, 1, 3, "forward", 1, false), {
    nextFrame: 3,
    nextPingPongDir: 1,
    stop: true,
  });

  // Reverse loop & non-loop stop
  assert.deepEqual(computeNextPlaybackFrame(3, 1, 3, "reverse", -1, true), {
    nextFrame: 2,
    nextPingPongDir: -1,
    stop: false,
  });
  assert.deepEqual(computeNextPlaybackFrame(1, 1, 3, "reverse", -1, true), {
    nextFrame: 3,
    nextPingPongDir: -1,
    stop: false,
  });
  assert.deepEqual(computeNextPlaybackFrame(1, 1, 3, "reverse", -1, false), {
    nextFrame: 1,
    nextPingPongDir: -1,
    stop: true,
  });

  // Ping-pong over 0..3: 0 -> 1 -> 2 -> 3 -> 2 -> 1 -> 0 -> 1 ... without duplicating endpoints
  const seq: number[] = [0];
  let cur = 0;
  let dir: 1 | -1 = 1;
  for (let i = 0; i < 8; i++) {
    const step = computeNextPlaybackFrame(cur, 0, 3, "pingpong", dir, true);
    assert.equal(step.stop, false);
    cur = step.nextFrame;
    dir = step.nextPingPongDir;
    seq.push(cur);
  }
  assert.deepEqual(seq, [0, 1, 2, 3, 2, 1, 0, 1, 2]);

  // Ping-pong non-loop stops cleanly back at start
  let nonLoopCur = 0;
  let nonLoopDir: 1 | -1 = 1;
  const nonLoopSeq: number[] = [0];
  let stopped = false;
  for (let i = 0; i < 10; i++) {
    const step = computeNextPlaybackFrame(
      nonLoopCur,
      0,
      2,
      "pingpong",
      nonLoopDir,
      false
    );
    nonLoopCur = step.nextFrame;
    nonLoopDir = step.nextPingPongDir;
    nonLoopSeq.push(nonLoopCur);
    if (step.stop) {
      stopped = true;
      break;
    }
  }
  assert.equal(stopped, true);
  assert.deepEqual(nonLoopSeq, [0, 1, 2, 1, 0]);
});

test("D7 animationHelpers: resolveOnionSkinFrames linear falloff and loopWrap", () => {
  // Without loopWrap at frame 0 (no prev frames)
  const noWrapStart = resolveOnionSkinFrames(0, 4, 2, 2, false, 0.4);
  assert.equal(noWrapStart.length, 2);
  assert.deepEqual(
    noWrapStart.map((e) => [e.frame, e.kind]),
    [
      [2, "next"],
      [1, "next"],
    ]
  );
  assert.ok(Math.abs(noWrapStart[0].opacity - 0.4 * (1 - 1 / 2.5)) < 1e-6);
  assert.ok(Math.abs(noWrapStart[1].opacity - 0.4) < 1e-6);

  // With loopWrap at frame 0 of 4: prev 2 wraps to frames 2, 3; next 2 -> 2, 1
  const wrapStart = resolveOnionSkinFrames(0, 4, 2, 2, true, 0.35);
  assert.deepEqual(
    wrapStart.map((e) => [e.frame, e.kind]),
    [
      [2, "prev"],
      [3, "prev"],
      [2, "next"],
      [1, "next"],
    ]
  );

  // With loopWrap at last frame (3 of 4): next 2 wraps to 1, 0; skips frame === current on 2-frame loop
  const wrapEnd = resolveOnionSkinFrames(3, 4, 1, 2, true, 0.35);
  assert.deepEqual(
    wrapEnd.map((e) => [e.frame, e.kind]),
    [
      [2, "prev"],
      [1, "next"],
      [0, "next"],
    ]
  );

  // When totalFrames === 2 and prevCount === 2 with loopWrap, step 2 wraps to current and is skipped
  const skipSelf = resolveOnionSkinFrames(1, 2, 2, 1, true, 0.5);
  assert.deepEqual(
    skipSelf.map((e) => [e.frame, e.kind]),
    [
      [0, "prev"],
      [0, "next"],
    ]
  );

  // PixelEngine compositeOnionSkin original-color vs tinted & loopWrap
  pixelEngine.resetForDocument(2, 1);
  pixelEngine.getOrCreateCel("l1", 0).setPixel(0, 0, 20, 220, 40, 255);
  pixelEngine.getOrCreateCel("l1", 1).setPixel(0, 0, 255, 255, 255, 255);
  pixelEngine.getOrCreateCel("l1", 2).setPixel(0, 0, 40, 200, 240, 255);
  const compLayers = [
    {
      id: "l1",
      kind: "raster",
      visible: true,
      opacity: 100,
      blendMode: "Normal" as BlendMode,
      parentId: null,
    },
  ];
  const origOnion = pixelEngine.compositeOnionSkin(
    compLayers,
    0,
    3,
    1,
    0,
    0.5,
    { tint: false, baseOpacity: 0.5, loopWrap: true }
  );
  // Wraps to frame 2 with original green/cyan color (40, 200, 240) at ~50% alpha
  assert.equal(origOnion[0], 40);
  assert.equal(origOnion[1], 200);
  assert.equal(origOnion[2], 240);
  assert.equal(origOnion[3], 128);
});

test("D7 timelineActions: reverseFramesAction & bulkDeleteSelectedCelsAction (single-step undo)", () => {
  pixelEngine.resetForDocument(2, 2);
  useEditorStore.setState({
    layers: [
      {
        id: "l1",
        name: "Layer 1",
        kind: "raster",
        visible: true,
        locked: false,
        opacity: 100,
        alphaLock: false,
        blendMode: "Normal",
        parentId: null,
        cels: { 0: true, 1: true, 2: true },
      },
      {
        id: "l2",
        name: "Layer 2",
        kind: "raster",
        visible: true,
        locked: false,
        opacity: 100,
        alphaLock: false,
        blendMode: "Normal",
        parentId: null,
        cels: { 0: true, 1: true, 2: true },
      },
    ],
    frames: [
      { id: "f0", index: 0, durationMs: 80 },
      { id: "f1", index: 1, durationMs: 120 },
      { id: "f2", index: 2, durationMs: 200 },
    ],
    currentFrame: 0,
    activeLayerId: "l1",
    selectedLayerIds: ["l1"],
    tags: [],
    activeTagId: null,
    selectedCels: [],
  });

  pixelEngine.getOrCreateCel("l1", 0).setPixel(0, 0, 10, 0, 0, 255);
  pixelEngine.getOrCreateCel("l1", 1).setPixel(0, 0, 20, 0, 0, 255);
  pixelEngine.getOrCreateCel("l1", 2).setPixel(0, 0, 30, 0, 0, 255);
  pixelEngine.getOrCreateCel("l2", 0).setPixel(1, 1, 0, 100, 0, 255);
  pixelEngine.getOrCreateCel("l2", 1).setPixel(1, 1, 0, 200, 0, 255);

  // Reverse frames 0..2
  assert.equal(reverseFramesAction(0, 2), true);
  let st = useEditorStore.getState();
  assert.deepEqual(
    st.frames.map((f) => f.durationMs),
    [200, 120, 80]
  );
  assert.equal(st.currentFrame, 2);
  assert.deepEqual(pixelEngine.getCel("l1", 0)?.getPixel(0, 0), [30, 0, 0, 255]);
  assert.deepEqual(pixelEngine.getCel("l1", 2)?.getPixel(0, 0), [10, 0, 0, 255]);

  // Bulk set frame duration
  bulkSetFrameDurationAction([0, 2], 150);
  assert.deepEqual(
    useEditorStore.getState().frames.map((f) => f.durationMs),
    [150, 120, 150]
  );

  // Multi-cel bulk delete with single-step undo/redo
  useEditorStore.getState().setSelectedCels([
    { layerId: "l1", frame: 0 },
    { layerId: "l1", frame: 2 },
    { layerId: "l2", frame: 1 },
  ]);
  assert.equal(bulkDeleteSelectedCelsAction(), true);
  assert.equal(pixelEngine.getCel("l1", 0)?.isEmpty(), true);
  assert.equal(pixelEngine.getCel("l1", 2)?.isEmpty(), true);
  assert.equal(pixelEngine.getCel("l2", 1)?.isEmpty(), true);

  // Single undo restores all 3 cels at once
  assert.equal(useEditorStore.getState().canUndo, true);
  performUndo();
  assert.deepEqual(pixelEngine.getCel("l1", 0)?.getPixel(0, 0), [30, 0, 0, 255]);
  assert.deepEqual(pixelEngine.getCel("l1", 2)?.getPixel(0, 0), [10, 0, 0, 255]);
  assert.deepEqual(pixelEngine.getCel("l2", 1)?.getPixel(1, 1), [0, 200, 0, 255]);
  assert.equal(useEditorStore.getState().canUndo, false);

  // Single redo clears all 3 cels again
  performRedo();
  assert.equal(pixelEngine.getCel("l1", 0)?.isEmpty(), true);
  assert.equal(pixelEngine.getCel("l1", 2)?.isEmpty(), true);
  assert.equal(pixelEngine.getCel("l2", 1)?.isEmpty(), true);
});







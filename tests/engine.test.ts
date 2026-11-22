import test from "node:test";
import assert from "node:assert/strict";

import { PixelBuffer, hexToRgba } from "../src/engine/document/PixelBuffer.ts";
import { PixelEngine } from "../src/engine/document/PixelEngine.ts";
import { TileHistory } from "../src/engine/history/TileHistory.ts";
import {
  applyPixelPerfectFilter,
  constrainAngle,
  expandBrushFootprint,
  expandSymmetry,
  floodFill,
  plotBresenhamLine,
  plotEllipse,
  plotRect,
} from "../src/engine/tools/pixelAlgos.ts";
import {
  buildSelectionSvgPath,
  clearMaskedRegion,
  createLassoSelection,
  createMagicWandSelection,
  createRectSelection,
  extractMaskedRegion,
  flipBufferHorizontal,
  flipBufferVertical,
  rotateBuffer90CCW,
  rotateBuffer90CW,
  stampFloatingPixels,
} from "../src/engine/tools/selection.ts";
import { hexToHsv, hsvToHex } from "../src/utils/color.ts";
import { parseGplPalette, parseHexPalette } from "../src/utils/paletteParser.ts";
import { TilemapData, Tileset } from "../src/engine/tiles/TilemapEngine.ts";
import {
  computeAutoTileBitmask,
  generate16TileAutoTileSet,
  paintAutoTileCell,
} from "../src/engine/tiles/autoTile.ts";
import {
  isoToScreen,
  plotIsoBox,
  plotIsoDiamond,
  plotIsoLine,
  screenToIso,
} from "../src/engine/tiles/isometric.ts";
import {
  applyPixelOutline,
  bakeTurntableFrames,
  render25DSprite,
  renderSpriteStack,
} from "../src/engine/tools/rotate3d.ts";
import {
  cubicBezierEase,
  evaluateEasing,
  lerpAngleDeg,
  masksToBoneWeights,
  renderBoneInfluenceOverlay,
  RigState,
  solveTwoBoneIK,
  warpLayerByBone,
  type RigConstraint,
} from "../src/engine/rig/RigEngine.ts";
import { RigHistory } from "../src/engine/rig/RigHistory.ts";
import {
  autoAssignWeights,
  buildBoneTransformMap,
  influenceSum,
  paintWeightBrush,
  skinLayerPixels,
  type AutoWeightBone,
} from "../src/engine/rig/skinning.ts";
import {
  createAutoGridMesh,
  createGridMesh,
  renderRigMesh,
  sampleMeshOffsets,
  upsertMeshKeyframe,
} from "../src/engine/rig/mesh.ts";
import {
  applyPixelCleanup,
  collectPalette,
  fillSinglePixelHoles,
  packRgba,
  removeOrphanPixels,
  snapToPalette,
} from "../src/engine/rig/pixelCleanup.ts";
import {
  extractPaletteFromBuffer,
  isSupportedImageFile,
  placeBufferCentered,
  resizePixelBufferNearest,
  sliceSpritesheet,
} from "../src/engine/io/imageImport.ts";
import { GameDataState } from "../src/engine/gamedev/GameDataEngine.ts";
import {
  apply2DLighting,
  applyPaletteSwapLut,
  generateAutoNormalMap,
} from "../src/engine/gamedev/shaderPreview.ts";

test("plotBresenhamLine produces connected endpoints", () => {
  const pts = plotBresenhamLine(0, 0, 4, 2);
  assert.deepEqual(pts[0], { x: 0, y: 0 });
  assert.deepEqual(pts[pts.length - 1], { x: 4, y: 2 });
  assert.equal(pts.length, 5);

  const snapped = constrainAngle(0, 0, 10, 2);
  assert.equal(snapped.y, 0);
});

test("plotRect outline and filled", () => {
  const outline = plotRect(1, 1, 4, 3, false);
  // 4x3 perimeter = 4 + 4 + 1 + 1 = 10 pixels
  assert.equal(outline.length, 10);

  const filled = plotRect(1, 1, 4, 3, true);
  assert.equal(filled.length, 12);
});

test("plotEllipse outline and filled are symmetric", () => {
  const outline = plotEllipse(0, 0, 6, 6, false);
  assert.ok(outline.length > 0);
  // Check mirror symmetry across x = 3 and y = 3
  const has = (x: number, y: number) =>
    outline.some((p) => p.x === x && p.y === y);
  for (const pt of outline) {
    assert.ok(has(6 - pt.x, pt.y));
    assert.ok(has(pt.x, 6 - pt.y));
  }

  const filled = plotEllipse(0, 0, 5, 5, true);
  assert.ok(filled.length >= 20 && filled.length <= 36);
});

test("applyPixelPerfectFilter removes L-shaped corners", () => {
  const raw = [
    { x: 0, y: 0 },
    { x: 1, y: 0 },
    { x: 1, y: 1 },
    { x: 2, y: 1 },
    { x: 2, y: 2 },
  ];
  const filtered = applyPixelPerfectFilter(raw);
  assert.deepEqual(filtered, [
    { x: 0, y: 0 },
    { x: 1, y: 1 },
    { x: 2, y: 2 },
  ]);
});

test("expandBrushFootprint and expandSymmetry", () => {
  assert.deepEqual(expandBrushFootprint(5, 5, 1), [{ x: 5, y: 5 }]);
  assert.equal(expandBrushFootprint(5, 5, 2).length, 4);

  const symBoth = expandSymmetry({ x: 2, y: 3 }, 32, 32, true, true);
  assert.equal(symBoth.length, 4);
  assert.ok(symBoth.some((p) => p.x === 29 && p.y === 3));
  assert.ok(symBoth.some((p) => p.x === 2 && p.y === 28));
  assert.ok(symBoth.some((p) => p.x === 29 && p.y === 28));

  // Odd width center deduplicates
  const symCenter = expandSymmetry({ x: 2, y: 2 }, 5, 5, true, true);
  assert.equal(symCenter.length, 1);
});

test("floodFill contiguous and global modes", () => {
  const buf = new PixelBuffer(6, 6);
  const red = hexToRgba("#ff0000");
  const blue = hexToRgba("#0000ff");
  const green = hexToRgba("#00ff00");

  // Draw vertical divider at x = 3
  for (let y = 0; y < 6; y++) {
    buf.setPixel(3, y, red[0], red[1], red[2], red[3]);
  }

  // Contiguous fill at (0,0) stops at x = 3
  const countContiguous = floodFill(buf, 0, 0, blue, true, false);
  assert.equal(countContiguous, 18); // 3 * 6
  assert.deepEqual(buf.getPixel(4, 0), [0, 0, 0, 0]);

  // Global fill of remaining transparent pixels on right half
  const countGlobal = floodFill(buf, 4, 0, green, false, false);
  assert.equal(countGlobal, 12); // 2 * 6
  assert.deepEqual(buf.getPixel(5, 5), green);
});

test("TileHistory 64x64 tile undo and redo round-trip", () => {
  const buf = new PixelBuffer(128, 128);
  const history = new TileHistory(50);

  // Paint a pixel in tile (0,0) and a pixel in tile (1,1)
  buf.setPixel(10, 10, 10, 20, 30, 255);

  history.beginTransaction("layer-base", 0, "MultiTileStroke");
  history.capturePixelTile(buf, 10, 10);
  history.capturePixelTile(buf, 70, 70);

  assert.deepEqual(history.getOriginalPixel(10, 10), [10, 20, 30, 255]);

  buf.setPixel(10, 10, 200, 100, 50, 255);
  buf.setPixel(70, 70, 255, 255, 255, 255);

  const committed = history.commitTransaction(buf);
  assert.equal(committed, true);
  assert.equal(history.canUndo, true);
  assert.equal(history.canRedo, false);

  const undone = history.undo(() => buf);
  assert.ok(undone);
  assert.deepEqual(buf.getPixel(10, 10), [10, 20, 30, 255]);
  assert.deepEqual(buf.getPixel(70, 70), [0, 0, 0, 0]);
  assert.equal(history.canUndo, false);
  assert.equal(history.canRedo, true);

  const redone = history.redo(() => buf);
  assert.ok(redone);
  assert.deepEqual(buf.getPixel(10, 10), [200, 100, 50, 255]);
  assert.deepEqual(buf.getPixel(70, 70), [255, 255, 255, 255]);
});

test("PixelEngine composites layers bottom-to-top and samples composited pixel", () => {
  const engine = new PixelEngine(8, 8);
  const bottom = engine.getOrCreateCel("bottom", 0);
  const top = engine.getOrCreateCel("top", 0);

  bottom.setPixel(2, 2, 100, 0, 0, 255);
  top.setPixel(2, 2, 0, 200, 0, 255);

  const layers = [
    {
      id: "top",
      kind: "raster",
      visible: true,
      opacity: 100,
      blendMode: "Normal" as const,
    },
    {
      id: "bottom",
      kind: "raster",
      visible: true,
      opacity: 100,
      blendMode: "Normal" as const,
    },
  ];

  engine.compositeFrame(layers, 0);
  assert.deepEqual(engine.sampleCompositedPixel(2, 2), [0, 200, 0, 255]);

  // Hide top layer -> reveals bottom layer
  layers[0].visible = false;
  engine.compositeFrame(layers, 0);
  assert.deepEqual(engine.sampleCompositedPixel(2, 2), [100, 0, 0, 255]);
});

test("selection builders: Rect, Lasso, Magic Wand & SVG boundary path", () => {
  const rectMask = createRectSelection(8, 8, 1, 1, 2, 2);
  assert.deepEqual(rectMask.getBounds(), { x: 1, y: 1, w: 2, h: 2 });
  assert.equal(rectMask.contains(1, 1), true);
  assert.equal(rectMask.contains(3, 3), false);

  const path = buildSelectionSvgPath(rectMask);
  assert.ok(path.includes("M1 1h2"));
  assert.ok(path.includes("M1 3h2"));

  // Triangle lasso covering center
  const lasso = createLassoSelection(10, 10, [
    { x: 1, y: 1 },
    { x: 7, y: 1 },
    { x: 4, y: 7 },
  ]);
  assert.equal(lasso.contains(4, 3), true);
  assert.equal(lasso.contains(0, 0), false);

  // Magic wand contiguous vs global
  const buf = new PixelBuffer(6, 6);
  buf.setPixel(0, 0, 255, 0, 0, 255);
  buf.setPixel(1, 0, 255, 0, 0, 255);
  buf.setPixel(4, 4, 255, 0, 0, 255);

  const wandContig = createMagicWandSelection(buf, 0, 0, true);
  assert.equal(wandContig.contains(1, 0), true);
  assert.equal(wandContig.contains(4, 4), false);

  const wandGlobal = createMagicWandSelection(buf, 0, 0, false);
  assert.equal(wandGlobal.contains(1, 0), true);
  assert.equal(wandGlobal.contains(4, 4), true);
});

test("extractMaskedRegion, stampFloatingPixels, Flip & Rotate 90", () => {
  const buf = new PixelBuffer(4, 4);
  // L-shape in 2x3 region (x: 0..1, y: 0..2)
  buf.setPixel(0, 0, 255, 0, 0, 255);
  buf.setPixel(0, 1, 255, 0, 0, 255);
  buf.setPixel(1, 1, 0, 255, 0, 255);

  const mask = createRectSelection(4, 4, 0, 0, 1, 1);
  const extracted = extractMaskedRegion(buf, mask);
  assert.ok(extracted);
  assert.equal(extracted.pixels.width, 2);
  assert.equal(extracted.pixels.height, 2);

  const flippedH = flipBufferHorizontal(extracted.pixels);
  assert.deepEqual(flippedH.getPixel(1, 0), [255, 0, 0, 255]);
  assert.deepEqual(flippedH.getPixel(0, 1), [0, 255, 0, 255]);

  const flippedV = flipBufferVertical(extracted.pixels);
  assert.deepEqual(flippedV.getPixel(0, 1), [255, 0, 0, 255]);
  assert.deepEqual(flippedV.getPixel(1, 0), [0, 255, 0, 255]);

  const rotCW = rotateBuffer90CW(extracted.pixels);
  // (0,0) -> (1,0), (1,1) -> (0,1)
  assert.deepEqual(rotCW.getPixel(1, 0), [255, 0, 0, 255]);
  assert.deepEqual(rotCW.getPixel(0, 1), [0, 255, 0, 255]);

  const rotCCW = rotateBuffer90CCW(rotCW);
  assert.deepEqual(rotCCW.getPixel(0, 0), [255, 0, 0, 255]);
  assert.deepEqual(rotCCW.getPixel(1, 1), [0, 255, 0, 255]);

  const target = new PixelBuffer(4, 4);
  stampFloatingPixels(target, extracted.pixels, 2, 2);
  assert.deepEqual(target.getPixel(2, 2), [255, 0, 0, 255]);
  assert.deepEqual(target.getPixel(3, 3), [0, 255, 0, 255]);
});

test("Group visibility & opacity cascade in PixelEngine.compositeFrame", () => {
  const engine = new PixelEngine(4, 4);
  const childCel = engine.getOrCreateCel("child", 0);
  childCel.setPixel(1, 1, 200, 100, 50, 255);

  const layers = [
    {
      id: "grp",
      kind: "group",
      visible: true,
      opacity: 50,
      blendMode: "Normal" as const,
      parentId: null,
    },
    {
      id: "child",
      kind: "raster",
      visible: true,
      opacity: 100,
      blendMode: "Normal" as const,
      parentId: "grp",
    },
  ];

  engine.compositeFrame(layers, 0);
  const [, , , alphaHalf] = engine.sampleCompositedPixel(1, 1);
  assert.ok(alphaHalf >= 127 && alphaHalf <= 128);

  layers[0].visible = false;
  engine.compositeFrame(layers, 0);
  assert.deepEqual(engine.sampleCompositedPixel(1, 1), [0, 0, 0, 0]);
});

test("parseHexPalette, parseGplPalette and HSV round-trip", () => {
  const hexColors = parseHexPalette("#ff004d\n00e436\n// comment\n#FF004D\n");
  assert.deepEqual(hexColors, ["#ff004d", "#00e436"]);

  const gpl = parseGplPalette(
    "GIMP Palette\nName: Mini\nColumns: 4\n#\n255   0 128 Magenta\n  0 255 255 Cyan\n"
  );
  assert.equal(gpl.name, "Mini");
  assert.deepEqual(gpl.colors, ["#ff0080", "#00ffff"]);

  const hsv = hexToHsv("#5b8cff");
  const back = hsvToHex(hsv.h, hsv.s, hsv.v);
  assert.ok(back.startsWith("#") && back.length === 7);
});

test("linked cels share pixel buffers, unlink cleanly, and promote on delete", () => {
  const engine = new PixelEngine(4, 4);
  const f0 = engine.getOrCreateCel("layer-a", 0);
  f0.setPixel(1, 1, 255, 128, 0, 255);

  assert.equal(engine.linkCel("layer-a", 1, 0), true);
  assert.equal(engine.isCelLinked("layer-a", 1), true);

  // Painting on linked frame 1 updates owner frame 0
  const f1 = engine.getOrCreateCel("layer-a", 1);
  f1.setPixel(2, 2, 0, 200, 255, 255);
  assert.deepEqual(engine.getCel("layer-a", 0)?.getPixel(2, 2), [0, 200, 255, 255]);

  // Link frame 2 to frame 1 (resolves to canonical owner 0), then delete frame 0 -> promotes frame 1
  assert.equal(engine.linkCel("layer-a", 2, 1), true);
  engine.deleteFrame(0, 3);
  assert.equal(engine.isCelLinked("layer-a", 0), false); // old frame 1 promoted to index 0
  assert.equal(engine.isCelLinked("layer-a", 1), true); // old frame 2 now linked to index 0
  assert.deepEqual(engine.getCel("layer-a", 0)?.getPixel(1, 1), [255, 128, 0, 255]);
  assert.deepEqual(engine.getCel("layer-a", 1)?.getPixel(2, 2), [0, 200, 255, 255]);

  // Unlink frame 1 -> edits become isolated
  assert.equal(engine.unlinkCel("layer-a", 1), true);
  assert.equal(engine.isCelLinked("layer-a", 1), false);
  engine.getOrCreateCel("layer-a", 1).setPixel(0, 0, 10, 20, 30, 255);
  assert.deepEqual(engine.getCel("layer-a", 0)?.getPixel(0, 0), [0, 0, 0, 0]);
});

test("frame duplicate, reorder, and delete preserve layer data", () => {
  const engine = new PixelEngine(4, 4);
  engine.getOrCreateCel("layer-a", 0).setPixel(0, 0, 11, 0, 0, 255);
  engine.getOrCreateCel("layer-a", 1).setPixel(0, 0, 22, 0, 0, 255);

  engine.duplicateFrame(0, 2);
  // Frames are now: [old0 (11), dup0 (11), old1 (22)]
  assert.equal(engine.getCel("layer-a", 0)?.getPixel(0, 0)[0], 11);
  assert.equal(engine.getCel("layer-a", 1)?.getPixel(0, 0)[0], 11);
  assert.equal(engine.getCel("layer-a", 2)?.getPixel(0, 0)[0], 22);

  // Modify duplicated frame 1, then reorder frame 2 -> index 0
  engine.getOrCreateCel("layer-a", 1).setPixel(0, 0, 33, 0, 0, 255);
  engine.reorderFrame(2, 0, 3);
  // Frames are now: [22, 11, 33]
  assert.equal(engine.getCel("layer-a", 0)?.getPixel(0, 0)[0], 22);
  assert.equal(engine.getCel("layer-a", 1)?.getPixel(0, 0)[0], 11);
  assert.equal(engine.getCel("layer-a", 2)?.getPixel(0, 0)[0], 33);

  engine.deleteFrame(1, 3);
  // Frames are now: [22, 33]
  assert.equal(engine.getCel("layer-a", 0)?.getPixel(0, 0)[0], 22);
  assert.equal(engine.getCel("layer-a", 1)?.getPixel(0, 0)[0], 33);
});

test("PixelEngine.compositeOnionSkin tints previous and next frames", () => {
  const engine = new PixelEngine(4, 4);
  engine.getOrCreateCel("layer-a", 0).setPixel(0, 0, 255, 255, 255, 255);
  engine.getOrCreateCel("layer-a", 2).setPixel(2, 2, 255, 255, 255, 255);

  const layers = [
    {
      id: "layer-a",
      kind: "raster",
      visible: true,
      opacity: 100,
      blendMode: "Normal" as const,
      parentId: null,
    },
  ];

  const onion = engine.compositeOnionSkin(layers, 1, 3, 1, 1, 0.5);
  // Frame 0 at (0,0) -> red/magenta tint (R > B)
  const idxPrev = 0;
  assert.ok(onion[idxPrev] > onion[idxPrev + 2]);
  assert.ok(onion[idxPrev + 3] > 0);

  // Frame 2 at (2,2) -> cyan/blue tint (B > R)
  const idxNext = (2 * 4 + 2) * 4;
  assert.ok(onion[idxNext + 2] > onion[idxNext]);
  assert.ok(onion[idxNext + 3] > 0);

  // Empty pixel (3,3) stays transparent
  const idxEmpty = (3 * 4 + 3) * 4;
  assert.equal(onion[idxEmpty + 3], 0);
});

test("Tileset and TilemapData operations and resize", () => {
  const ts = new Tileset("ts", "Test", 8, 8);
  const id1 = ts.addTile();
  const id2 = ts.addTile();
  assert.equal(id1, 1);
  assert.equal(id2, 2);

  ts.getTile(id1)!.setPixel(1, 1, 255, 0, 0, 255);
  const dupId = ts.duplicateTile(id1);
  assert.equal(dupId, 3);
  assert.deepEqual(ts.getTile(3)?.getPixel(1, 1), [255, 0, 0, 255]);

  ts.resizeTiles(16, 16);
  assert.equal(ts.tileWidth, 16);
  assert.deepEqual(ts.getTile(1)?.getPixel(1, 1), [255, 0, 0, 255]);

  const tm = new TilemapData(2, 2);
  tm.setCell(0, 0, 1);
  tm.setCell(1, 0, 3);
  tm.replaceTileId(1); // Tile 1 removed -> tile 1 becomes 0, tile 3 shifts to 2
  assert.equal(tm.getCell(0, 0), 0);
  assert.equal(tm.getCell(1, 0), 2);

  tm.resize(4, 3);
  assert.equal(tm.cols, 4);
  assert.equal(tm.getCell(1, 0), 2);
});

test("PixelEngine live-linked TilemapLayer editing and tile deletion", () => {
  const engine = new PixelEngine(32, 16);
  const layers = [
    {
      id: "tilemap-1",
      kind: "tilemap",
      visible: true,
      opacity: 100,
      blendMode: "Normal" as const,
      parentId: null,
    },
  ];

  // Stamp tile 1 at both (0,0) and (1,0)
  engine.setTilemapCell("tilemap-1", 0, 0, 0, 1);
  engine.setTilemapCell("tilemap-1", 0, 1, 0, 1);

  // Edit pixel (2,2) on cell (0,0) -> should update both (2,2) and (18,2)
  const res = engine.editTilePixelAtCanvasCoord(
    "tilemap-1",
    0,
    2,
    2,
    [255, 64, 128, 255],
    false,
    1
  );
  assert.equal(res.tileId, 1);
  assert.equal(res.changed, true);

  engine.compositeFrame(layers, 0);
  assert.deepEqual(engine.sampleCompositedPixel(2, 2), [255, 64, 128, 255]);
  assert.deepEqual(engine.sampleCompositedPixel(18, 2), [255, 64, 128, 255]);

  // Stamp tile 2 at (1,0), then delete tile 1 -> cell (0,0) clears to 0, cell (1,0) shifts to 1
  engine.setTilemapCell("tilemap-1", 0, 1, 0, 2);
  assert.equal(engine.deleteTileFromTileset(1), true);
  const tm = engine.getTilemap("tilemap-1", 0)!;
  assert.equal(tm.getCell(0, 0), 0);
  assert.equal(tm.getCell(1, 0), 1);
});

test("computeAutoTileBitmask 4-bit and blob47 corner filtering + paintAutoTileCell", () => {
  const tm = new TilemapData(4, 4);
  const terrain = new Set([1]);
  // Center at (1,1); set N=(1,0), E=(2,1), NE=(2,0), and isolated SE=(2,2) without S=(1,2)
  tm.setCell(1, 1, 1);
  tm.setCell(1, 0, 1);
  tm.setCell(2, 1, 1);
  tm.setCell(2, 0, 1);
  tm.setCell(2, 2, 1);

  // 4-bit: N(1) + E(2) = 3
  assert.equal(computeAutoTileBitmask(tm, 1, 1, terrain, "4bit"), 3);

  // blob47: N(1) + NE(2, valid since N && E) + E(4) = 7; SE(8) must be filtered out because S is absent!
  assert.equal(computeAutoTileBitmask(tm, 1, 1, terrain, "blob47"), 7);

  // Generate 16-tile ruleset & test live neighbor updates via paintAutoTileCell
  const ts = new Tileset("ts", "Auto", 8, 8);
  const ruleset = generate16TileAutoTileSet(ts);
  const map = new TilemapData(4, 4);

  paintAutoTileCell(map, 1, 1, ruleset, false);
  // Isolated cell has mask 0
  assert.equal(map.getCell(1, 1), ruleset.maskToTile.get(0));

  // Paint East neighbor (2,1) -> (1,1) gets E(2), (2,1) gets W(8)
  paintAutoTileCell(map, 2, 1, ruleset, false);
  assert.equal(map.getCell(1, 1), ruleset.maskToTile.get(2));
  assert.equal(map.getCell(2, 1), ruleset.maskToTile.get(8));

  // Erase (2,1) -> (1,1) reverts to mask 0
  paintAutoTileCell(map, 2, 1, ruleset, true);
  assert.equal(map.getCell(2, 1), 0);
  assert.equal(map.getCell(1, 1), ruleset.maskToTile.get(0));
});

test("isometric coordinates, 2:1 iso line, diamond, and shaded box", () => {
  const pt = isoToScreen(2, 1, 16, 8, 16, 4);
  assert.deepEqual(pt, { x: 24, y: 16 });
  const cell = screenToIso(pt.x, pt.y, 16, 8, 16, 4);
  assert.deepEqual(cell, { col: 2, row: 1 });

  // 2:1 diagonal line: 2 horizontal steps per 1 vertical step
  const isoLine = plotIsoLine(0, 0, 6, 3);
  assert.equal(isoLine[0].x, 0);
  assert.equal(isoLine[0].y, 0);
  assert.equal(isoLine[isoLine.length - 1].x, 6);
  assert.equal(isoLine[isoLine.length - 1].y, 3);

  const diamond = plotIsoDiamond(10, 10, 4, true);
  assert.ok(diamond.some((p) => p.x === 10 && p.y === 10));
  assert.ok(diamond.some((p) => p.x === 6 && p.y === 10));

  const box = plotIsoBox(16, 20, 4, 6);
  assert.ok(box.top.length > 0);
  assert.ok(box.left.length > 0);
  assert.ok(box.right.length > 0);
});

function countOpaquePixels(buf: PixelBuffer): number {
  let count = 0;
  for (let i = 3; i < buf.data.length; i += 4) {
    if (buf.data[i] > 0) count++;
  }
  return count;
}

test("render25DSprite preserves identity and expands extruded depth silhouette", () => {
  const src = new PixelBuffer(16, 16);
  for (let y = 5; y <= 10; y++) {
    for (let x = 5; x <= 10; x++) {
      src.setPixel(x, y, 220, 90, 60, 255);
    }
  }

  const identity = render25DSprite(src, {
    pitchDeg: 0,
    yawDeg: 0,
    rollDeg: 0,
    extrudeDepth: 0,
    perspective: 0,
    shadeDepth: true,
    supersample: false,
    outlineColor: null,
  });
  assert.deepEqual(identity.data, src.data);

  const flatRotated = render25DSprite(src, {
    pitchDeg: 15,
    yawDeg: 35,
    rollDeg: 0,
    extrudeDepth: 0,
    perspective: 0.35,
    shadeDepth: true,
    supersample: true,
    outlineColor: null,
  });
  const extruded = render25DSprite(src, {
    pitchDeg: 15,
    yawDeg: 35,
    rollDeg: 0,
    extrudeDepth: 6,
    perspective: 0.35,
    shadeDepth: true,
    supersample: true,
    outlineColor: null,
  });

  assert.ok(countOpaquePixels(flatRotated) > 0);
  assert.ok(countOpaquePixels(extruded) > countOpaquePixels(flatRotated));
});

test("applyPixelOutline adds 4-connected border around sprite", () => {
  const src = new PixelBuffer(8, 8);
  src.setPixel(3, 3, 255, 255, 255, 255);
  src.setPixel(4, 3, 255, 255, 255, 255);
  src.setPixel(3, 4, 255, 255, 255, 255);
  src.setPixel(4, 4, 255, 255, 255, 255);

  const outlined = applyPixelOutline(src, [0, 0, 0, 255]);
  // 2x2 center (4) + 8 4-neighbor perimeter pixels = 12 opaque pixels
  assert.equal(countOpaquePixels(outlined), 12);
  assert.deepEqual(outlined.getPixel(2, 3), [0, 0, 0, 255]);
  assert.deepEqual(outlined.getPixel(2, 2), [0, 0, 0, 0]);
});

test("renderSpriteStack shifts upper layers upward and bakeTurntableFrames produces N frames", () => {
  const makeLayer = (r: number, g: number, b: number) => {
    const buf = new PixelBuffer(16, 16);
    buf.setPixel(8, 8, r, g, b, 255);
    return buf;
  };

  const bottom = makeLayer(200, 40, 40);
  const middle = makeLayer(40, 200, 40);
  const top = makeLayer(40, 40, 220);

  const stacked = renderSpriteStack([bottom, middle, top], {
    yawDeg: 0,
    pitchDeg: 45,
    sliceSpacing: 2,
    depthShading: true,
    outlineColor: null,
  });

  let minRedY = 16;
  let minBlueY = 16;
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) {
      const [r, , b, a] = stacked.getPixel(x, y);
      if (a > 0 && r > 100 && y < minRedY) minRedY = y;
      if (a > 0 && b > 100 && y < minBlueY) minBlueY = y;
    }
  }
  // Top blue layer should appear above (smaller Y) than bottom red layer
  assert.ok(minBlueY < minRedY);

  const baked25d = bakeTurntableFrames({
    mode: "extruded",
    frameCount: 8,
    spinAxis: "yaw",
    source: bottom,
    opts25d: {
      pitchDeg: 15,
      yawDeg: 0,
      rollDeg: 0,
      extrudeDepth: 4,
      perspective: 0.3,
      shadeDepth: true,
      supersample: true,
      outlineColor: null,
    },
    optsStack: {
      yawDeg: 0,
      pitchDeg: 45,
      sliceSpacing: 2,
      depthShading: true,
      outlineColor: null,
    },
  });
  assert.equal(baked25d.length, 8);

  const bakedStack = bakeTurntableFrames({
    mode: "stack",
    frameCount: 6,
    spinAxis: "yaw",
    slices: [bottom, middle, top],
    opts25d: {
      pitchDeg: 0,
      yawDeg: 0,
      rollDeg: 0,
      extrudeDepth: 0,
      perspective: 0,
      shadeDepth: true,
      supersample: true,
      outlineColor: null,
    },
    optsStack: {
      yawDeg: 0,
      pitchDeg: 45,
      sliceSpacing: 2,
      depthShading: true,
      outlineColor: null,
    },
  });
  assert.equal(bakedStack.length, 6);
});

test("RigState forward kinematics propagates parent transforms to child bones", () => {
  const rig = new RigState();
  const root = rig.addBone({
    name: "Root",
    parentId: null,
    localX: 10,
    localY: 10,
    length: 8,
    rotationDeg: 0,
  });
  const child = rig.addBone({
    name: "Child",
    parentId: root.id,
    localX: 8,
    localY: 0,
    length: 6,
    rotationDeg: 0,
  });

  // Rotate root 90 degrees downward -> root tip is at (10, 18), child tip at (10, 24)
  rig.setPoseOverride(root.id, { rotationDeg: 90 }, 0);
  const world = rig.computeWorldTransforms(0, "pose", true);
  const rw = world.get(root.id)!;
  const cw = world.get(child.id)!;

  assert.ok(Math.abs(rw.tipX - 10) < 1e-6);
  assert.ok(Math.abs(rw.tipY - 18) < 1e-6);
  assert.ok(Math.abs(cw.x - 10) < 1e-6);
  assert.ok(Math.abs(cw.y - 18) < 1e-6);
  assert.ok(Math.abs(cw.tipX - 10) < 1e-6);
  assert.ok(Math.abs(cw.tipY - 24) < 1e-6);
});

test("solveTwoBoneIK reaches interior targets accurately and clamps beyond max reach", () => {
  const ik = solveTwoBoneIK(0, 0, 10, 10, 10, 10, 1);
  const rad1 = (ik.rootWorldDeg * Math.PI) / 180;
  const rad2 = ((ik.rootWorldDeg + ik.childLocalDeg) * Math.PI) / 180;
  const endX = Math.cos(rad1) * 10 + Math.cos(rad2) * 10;
  const endY = Math.sin(rad1) * 10 + Math.sin(rad2) * 10;

  assert.ok(Math.abs(endX - 10) < 0.05);
  assert.ok(Math.abs(endY - 10) < 0.05);

  // Far out-of-reach target should clamp without NaN
  const far = solveTwoBoneIK(0, 0, 10, 10, 100, 0, 1);
  assert.ok(Number.isFinite(far.rootWorldDeg));
  assert.ok(Number.isFinite(far.childLocalDeg));
});

test("RigState keyframe interpolation uses shortest arc and step easing", () => {
  assert.ok(Math.abs(lerpAngleDeg(170, -170, 0.5) - 180) < 1e-6 || Math.abs(lerpAngleDeg(170, -170, 0.5) + 180) < 1e-6);
  assert.ok(Math.abs(lerpAngleDeg(-10, 10, 0.5) - 0) < 1e-6);

  const rig = new RigState();
  const root = rig.addBone({
    name: "Arm",
    parentId: null,
    localX: 16,
    localY: 16,
    length: 8,
    rotationDeg: 0,
  });

  rig.setPoseOverride(root.id, { rotationDeg: -10 }, 0);
  rig.setKeyframe(root.id, 0, "linear");
  rig.setPoseOverride(root.id, { rotationDeg: 10 }, 2);
  rig.setKeyframe(root.id, 2, "step");
  rig.setPoseOverride(root.id, { rotationDeg: 90 }, 4);
  rig.setKeyframe(root.id, 4, "linear");
  rig.clearPoseOverrides();

  const midLinear = rig.getBonePoseAtFrame(root.id, 1, false);
  assert.ok(Math.abs(midLinear.rotationDeg - 0) < 1e-6);

  const midStep = rig.getBonePoseAtFrame(root.id, 3, false);
  assert.ok(Math.abs(midStep.rotationDeg - 10) < 1e-6);
});

test("warpLayerByBone deforms pixel cel with RotSprite & serializes rig JSON", () => {
  const cel = new PixelBuffer(16, 16);
  for (let y = 4; y <= 8; y++) {
    for (let x = 7; x <= 9; x++) {
      cel.setPixel(x, y, 80, 200, 120, 255);
    }
  }

  const rig = new RigState();
  const bone = rig.addBone({
    name: "Limb",
    parentId: null,
    localX: 8,
    localY: 8,
    length: 6,
    rotationDeg: -90,
  });

  const rest = rig.computeWorldTransforms(0, "rest", false).get(bone.id)!;
  rig.setPoseOverride(bone.id, { rotationDeg: -45 }, 0);
  const posed = rig.computeWorldTransforms(0, "pose", true).get(bone.id)!;

  const warped = warpLayerByBone(cel, rest, posed, {
    pixelSnap: true,
    rotSprite: true,
  });
  assert.ok(countOpaquePixels(warped) > 0);

  const json = JSON.parse(rig.serializeRuntimeJson(16, 16));
  assert.equal(json.schema, "pixet-rig-v1");
  assert.equal(json.bones.length, 1);
  assert.equal(json.bones[0].name, "Limb");
});

test("imageImport resizes nearest-neighbor, centers, slices spritesheets, and extracts palettes", () => {
  assert.equal(isSupportedImageFile({ name: "hero.PNG", type: "" }), true);
  assert.equal(isSupportedImageFile({ name: "notes.txt", type: "text/plain" }), false);

  // Nearest-neighbor resize 2x2 -> 4x4
  const tiny = new PixelBuffer(2, 2);
  tiny.setPixel(0, 0, 255, 0, 0, 255);
  tiny.setPixel(1, 0, 0, 255, 0, 255);
  tiny.setPixel(0, 1, 0, 0, 255, 255);
  tiny.setPixel(1, 1, 255, 255, 0, 255);
  const scaled = resizePixelBufferNearest(tiny, 4, 4);
  assert.deepEqual(scaled.getPixel(0, 0), [255, 0, 0, 255]);
  assert.deepEqual(scaled.getPixel(1, 1), [255, 0, 0, 255]);
  assert.deepEqual(scaled.getPixel(3, 3), [255, 255, 0, 255]);

  // placeBufferCentered fits oversized image & centers smaller image
  const centered = placeBufferCentered(tiny, 6, 6, false);
  assert.deepEqual(centered.getPixel(2, 2), [255, 0, 0, 255]);
  const shrunk = placeBufferCentered(scaled, 2, 2, true);
  assert.equal(shrunk.width, 2);
  assert.equal(shrunk.height, 2);

  // sliceSpritesheet splits 16x8 into two 8x8 frames and skips empty second frame
  const sheet = new PixelBuffer(16, 8);
  sheet.setPixel(2, 2, 10, 20, 30, 255);
  sheet.setPixel(3, 2, 10, 20, 30, 255);
  sheet.setPixel(4, 2, 200, 100, 50, 255);
  const nonEmptyOnly = sliceSpritesheet(sheet, 8, 8, true);
  assert.equal(nonEmptyOnly.length, 1);
  assert.deepEqual(nonEmptyOnly[0].getPixel(2, 2), [10, 20, 30, 255]);
  const allCells = sliceSpritesheet(sheet, 8, 8, false);
  assert.equal(allCells.length, 2);

  // extractPaletteFromBuffer orders by descending frequency
  const pal = extractPaletteFromBuffer(sheet, 8);
  assert.deepEqual(pal, ["#0a141e", "#c86432"]);
});

test("RigState bone influence painting, auto-weighting, overlay & partial layer warp", () => {
  const engine = new PixelEngine(16, 16);
  const cel = engine.getOrCreateCel("layer-body", 0);
  // Paint top block around (8, 3) and bottom block around (8, 12)
  cel.setPixel(8, 3, 255, 0, 0, 255);
  cel.setPixel(8, 12, 0, 255, 0, 255);

  const topBone = engine.rig.addBone({
    name: "Top",
    parentId: null,
    localX: 8,
    localY: 5,
    length: 4,
    rotationDeg: -90,
  });
  const botBone = engine.rig.addBone({
    name: "Bottom",
    parentId: null,
    localX: 8,
    localY: 14,
    length: 4,
    rotationDeg: -90,
  });

  // Exclusive painting overrides other bones
  engine.rig.paintBoneMask(botBone.id, 16, 16, 8, 3, 1, false, true);
  assert.equal(engine.rig.getBoneMask(botBone.id)!.data[3 * 16 + 8], 1);
  engine.rig.paintBoneMask(topBone.id, 16, 16, 8, 3, 1, false, true);
  assert.equal(engine.rig.getBoneMask(topBone.id)!.data[3 * 16 + 8], 1);
  assert.equal(engine.rig.getBoneMask(botBone.id)!.data[3 * 16 + 8], 0);

  // Erasing clears pixel
  engine.rig.paintBoneMask(topBone.id, 16, 16, 8, 3, 1, true, true);
  assert.equal(engine.rig.getBoneMask(topBone.id)!.data[3 * 16 + 8], 0);

  // Auto-weight assigns each opaque pixel to closest bone
  engine.rig.autoAssignBoneMasks(cel, 0);
  assert.equal(engine.rig.getBoneMask(topBone.id)!.data[3 * 16 + 8], 1);
  assert.equal(engine.rig.getBoneMask(botBone.id)!.data[12 * 16 + 8], 1);

  // Overlay renders higher alpha for selected bone than unselected
  const overlay = new PixelBuffer(16, 16);
  renderBoneInfluenceOverlay(engine.rig, overlay, topBone.id);
  assert.equal(overlay.getPixel(8, 3)[3], 145);
  assert.equal(overlay.getPixel(8, 12)[3], 65);

  // Rotating only topBone moves (8,3) while bottom unmasked/other pixel (8,12) stays at (8,12)
  engine.rig.clearBoneMask(botBone.id);
  engine.rig.setPoseOverride(topBone.id, { rotationDeg: 0 }, 0);
  engine.compositeRigFrame(
    [
      {
        id: "layer-body",
        kind: "raster",
        visible: true,
        opacity: 100,
        blendMode: "Normal",
      },
    ],
    0,
    { pixelSnap: true, rotSprite: false },
    true
  );

  // Bottom pixel stays stationary at (8,12)
  assert.deepEqual(engine.sampleCompositedPixel(8, 12), [0, 255, 0, 255]);
  // Top pixel moved from (8,3) to (10,5) after +90 deg around pivot (8,5)
  assert.deepEqual(engine.sampleCompositedPixel(8, 3), [0, 0, 0, 0]);
  assert.deepEqual(engine.sampleCompositedPixel(10, 5), [255, 0, 0, 255]);
});

test("cut selection to new layer preserves exact pixel offsets and layer reorder math is exact", () => {
  const src = new PixelBuffer(8, 8);
  src.setPixel(5, 6, 120, 45, 210, 255);
  src.setPixel(1, 1, 10, 20, 30, 255);

  const mask = createRectSelection(8, 8, 4, 5, 6, 7);
  const extracted = extractMaskedRegion(src, mask)!;
  assert.equal(extracted.x, 4);
  assert.equal(extracted.y, 5);
  const clearedCount = clearMaskedRegion(src, mask);
  assert.equal(clearedCount, 1);
  assert.deepEqual(src.getPixel(5, 6), [0, 0, 0, 0]);
  assert.deepEqual(src.getPixel(1, 1), [10, 20, 30, 255]);

  const newLayerCel = new PixelBuffer(8, 8);
  stampFloatingPixels(newLayerCel, extracted.pixels, extracted.x, extracted.y);
  assert.deepEqual(newLayerCel.getPixel(5, 6), [120, 45, 210, 255]);
  assert.deepEqual(newLayerCel.getPixel(1, 1), [0, 0, 0, 0]);

  // Verify splice moveLayer index math for before/after drops
  const reorder = (arr: string[], fromIdx: number, index: number, pos: "before" | "after") => {
    const rawTo =
      pos === "before"
        ? fromIdx < index
          ? index - 1
          : index
        : fromIdx < index
          ? index
          : index + 1;
    const toIdx = Math.max(0, Math.min(arr.length - 1, rawTo));
    const copy = arr.slice();
    const [moved] = copy.splice(fromIdx, 1);
    copy.splice(toIdx, 0, moved);
    return copy;
  };

  assert.deepEqual(reorder(["A", "B", "C"], 0, 2, "before"), ["B", "A", "C"]);
  assert.deepEqual(reorder(["A", "B", "C"], 0, 2, "after"), ["B", "C", "A"]);
  assert.deepEqual(reorder(["A", "B", "C"], 2, 0, "before"), ["C", "A", "B"]);
  assert.deepEqual(reorder(["A", "B", "C"], 2, 0, "after"), ["A", "C", "B"]);
});

test("PixelEngine.resizeCanvas expands centered and crops anchored cleanly", () => {
  const engine = new PixelEngine(4, 4);
  const cel = engine.getOrCreateCel("layer-1", 0);
  cel.setPixel(1, 1, 200, 100, 50, 255);
  cel.setPixel(0, 0, 10, 20, 30, 255);

  // Center-anchored expand 4x4 -> 8x8 shifts pixels by (+2, +2)
  engine.resizeCanvas(8, 8, 1, 1);
  assert.equal(engine.width, 8);
  assert.equal(engine.height, 8);
  const expanded = engine.getCel("layer-1", 0)!;
  assert.deepEqual(expanded.getPixel(3, 3), [200, 100, 50, 255]);
  assert.deepEqual(expanded.getPixel(2, 2), [10, 20, 30, 255]);

  // Top-left anchored crop 8x8 -> 4x4 keeps (0..3, 0..3)
  engine.resizeCanvas(4, 4, 0, 0);
  const cropped = engine.getCel("layer-1", 0)!;
  assert.equal(cropped.width, 4);
  assert.equal(cropped.height, 4);
  assert.deepEqual(cropped.getPixel(3, 3), [200, 100, 50, 255]);
});

test("GameDataState tracks boxes, sockets, events, frame copy, and JSON export", () => {
  const gd = new GameDataState();
  const box = gd.addBox({
    frame: 0,
    kind: "hitbox",
    name: "sword_slash",
    x: 4,
    y: 6,
    w: 12,
    h: 8,
  });
  const sock = gd.addSocket({
    frame: 0,
    name: "muzzle",
    x: 16,
    y: 10,
  });
  const evt = gd.addEvent(1, "spawn_vfx", "spark");

  assert.equal(gd.getBoxesAtFrame(0).length, 1);
  assert.equal(gd.getSocketsAtFrame(0).length, 1);
  assert.equal(gd.getEventsAtFrame(1).length, 1);
  assert.equal(evt?.name, "spawn_vfx");

  gd.updateBox(box.id, { w: 14 });
  assert.equal(gd.getBoxesAtFrame(0)[0].w, 14);
  gd.updateSocket(sock.id, { y: 12 });
  assert.equal(gd.getSocketsAtFrame(0)[0].y, 12);

  // Copy frame 0 boxes & sockets to frame 1
  const copied = gd.copyFrameMetadata(0, 1);
  assert.equal(copied, 2);
  assert.equal(gd.getBoxesAtFrame(1).length, 1);
  assert.equal(gd.getSocketsAtFrame(1).length, 1);

  const parsed = JSON.parse(gd.serializeGameDataJson("hero.pixet", 32, 32, 4));
  assert.equal(parsed.schema, "pixet-gamedata-v1");
  assert.equal(parsed.boxes.length, 2);
  assert.equal(parsed.sockets.length, 2);
  assert.equal(parsed.events.length, 1);

  // Snapshot round-trip for .pixet persistence
  const snap = gd.toSnapshot();
  const restored = new GameDataState();
  restored.fromSnapshot(JSON.parse(JSON.stringify(snap)));
  assert.equal(restored.boxes.length, 2);
  assert.equal(restored.sockets.length, 2);
  assert.equal(restored.events.length, 1);
  // Adding another box should advance ID without colliding
  const nextBox = restored.addBox({
    frame: 2,
    kind: "hurtbox",
    name: "body",
    x: 0,
    y: 0,
    w: 4,
    h: 4,
  });
  assert.ok(!restored.boxes.slice(0, -1).some((b) => b.id === nextBox.id));
});

test("RigState.toSnapshot and fromSnapshot round-trip bones, keyframes, and boneMasks", () => {
  const rig = new RigState();
  const root = rig.addBone({
    name: "Spine",
    parentId: null,
    localX: 8,
    localY: 12,
    length: 6,
    rotationDeg: -90,
  });
  const child = rig.addBone({
    name: "Head",
    parentId: root.id,
    localX: 6,
    localY: 0,
    length: 4,
    rotationDeg: 10,
  });
  rig.setPoseOverride(root.id, { rotationDeg: -75 }, 1);
  rig.setKeyframe(root.id, 1, "easeInOut");
  rig.paintBoneMask(root.id, 16, 16, 8, 10, 2, false, true);
  rig.paintBoneMask(child.id, 16, 16, 8, 4, 1, false, true);

  const snap = rig.toSnapshot();
  const clonedSnap = JSON.parse(JSON.stringify(snap));

  const restored = new RigState();
  restored.fromSnapshot(clonedSnap);

  assert.equal(restored.bones.length, 2);
  assert.equal(restored.bones[0].name, "Spine");
  assert.equal(restored.bones[1].parentId, root.id);
  assert.equal(restored.hasKeyframe(root.id, 1), true);
  assert.equal(restored.hasKeyframe(root.id, 0), false);
  assert.equal(restored.getBoneMask(root.id)?.data[10 * 16 + 8], 1);
  assert.equal(restored.getBoneMask(child.id)?.data[4 * 16 + 8], 1);

  // Adding a new bone after restore should generate a fresh non-colliding ID
  const extra = restored.addBone({
    name: "Arm",
    parentId: root.id,
    localX: 3,
    localY: 0,
    length: 4,
    rotationDeg: 45,
  });
  assert.equal(extra.id, "bone-3");
});

test("evaluateEasing supports easeIn/easeOut/step and cubic bezier curves", () => {
  assert.equal(evaluateEasing(0.5, "step"), 0);
  assert.equal(evaluateEasing(1, "step"), 1);
  assert.ok(Math.abs(evaluateEasing(0.5, "easeIn") - 0.25) < 1e-9);
  assert.ok(Math.abs(evaluateEasing(0.5, "easeOut") - 0.75) < 1e-9);
  assert.ok(Math.abs(evaluateEasing(0.5, "easeInOut") - 0.5) < 1e-9);

  assert.equal(cubicBezierEase(0), 0);
  assert.equal(cubicBezierEase(1), 1);
  assert.ok(Math.abs(cubicBezierEase(0.5, [0, 0, 1, 1]) - 0.5) < 1e-6);
  let previous = 0;
  for (let i = 0; i <= 20; i++) {
    const value = cubicBezierEase(i / 20, [0.42, 0, 0.58, 1]);
    assert.ok(value >= previous - 1e-9);
    previous = value;
  }
  assert.ok(Math.abs(evaluateEasing(0.5, "bezier", [0, 0, 1, 1]) - 0.5) < 1e-6);
});

test("masksToBoneWeights migrates hard masks and caps influences at four", () => {
  assert.equal(masksToBoneWeights(new Map()), null);

  const masks = new Map<string, { width: number; height: number; data: Uint8Array }>();
  for (let i = 0; i < 6; i++) {
    const data = new Uint8Array(16);
    data[0] = 1;
    masks.set(`bone-${i + 1}`, { width: 4, height: 4, data });
  }
  const weights = masksToBoneWeights(masks);
  assert.ok(weights);
  assert.equal(weights.width, 4);
  assert.equal(weights.height, 4);
  assert.equal(weights.entries.get(0)?.length, 4);
  assert.ok(weights.entries.get(0)?.every((influence) => influence.w === 1));
});

test("RigState migrates v1 snapshots to v2 with hard weights and keeps masks", () => {
  const rig = new RigState();
  rig.fromSnapshot({
    bones: [
      {
        id: "bone-1",
        name: "Root",
        parentId: null,
        localX: 4,
        localY: 4,
        length: 6,
        rotationDeg: 0,
        boundLayerId: null,
      },
      {
        id: "bone-2",
        name: "Tip",
        parentId: "bone-1",
        localX: 6,
        localY: 0,
        length: 4,
        rotationDeg: 15,
        boundLayerId: null,
      },
    ],
    clips: [{ id: "clip-idle", name: "idle", frameCount: 4, tracks: {} }],
    activeClipId: "clip-idle",
    // no version field: legacy v1 payload
    masks: [
      { boneId: "bone-1", width: 8, height: 8, indices: [0, 1] },
      { boneId: "bone-2", width: 8, height: 8, indices: [1, 2] },
    ],
  });

  assert.equal(rig.bones.length, 2);
  assert.equal(rig.getBoneMask("bone-1")?.data[1], 1);
  assert.equal(rig.getBoneMask("bone-2")?.data[2], 1);

  const snap = rig.toSnapshot();
  assert.equal(snap.version, 2);
  assert.deepEqual(snap.constraints, []);
  assert.deepEqual(snap.slots, []);
  assert.deepEqual(snap.poses, []);
  assert.ok(snap.weights);
  assert.equal(snap.weights.width, 8);
  assert.equal(snap.weights.height, 8);
  assert.deepEqual(
    snap.weights.entries.find((entry) => entry.i === 1)?.b,
    [
      ["bone-1", 1],
      ["bone-2", 1],
    ]
  );

  const weights = rig.getBoneWeights();
  assert.equal(weights?.entries.get(0)?.[0]?.boneId, "bone-1");
  assert.equal(weights?.entries.get(0)?.[0]?.w, 1);

  const restored = new RigState();
  restored.fromSnapshot(JSON.parse(JSON.stringify(snap)));
  assert.equal(restored.getBoneMask("bone-2")?.data[2], 1);
  assert.equal(restored.getBoneWeights()?.entries.get(0)?.[0]?.w, 1);
});

test("RigState forward kinematics includes scale in tips and child joints", () => {
  const rig = new RigState();
  const root = rig.addBone({
    name: "Root",
    parentId: null,
    localX: 0,
    localY: 0,
    length: 10,
    rotationDeg: 0,
    scaleX: 2,
    scaleY: 1,
  });
  const child = rig.addBone({
    name: "Child",
    parentId: root.id,
    localX: 10,
    localY: 0,
    length: 5,
    rotationDeg: 0,
  });

  const world = rig.computeWorldTransforms(0, "pose", false);
  const rootWorld = world.get(root.id)!;
  const childWorld = world.get(child.id)!;
  assert.ok(Math.abs(rootWorld.tipX - 20) < 1e-6);
  assert.equal(rootWorld.worldScaleX, 2);
  assert.ok(Math.abs(childWorld.x - 20) < 1e-6);
  assert.equal(childWorld.worldScaleX, 2);
  assert.ok(Math.abs(childWorld.tipX - 30) < 1e-6);

  // Keyframed scale interpolates and rest poses keep the bind scale
  rig.setPoseOverride(root.id, { scaleX: 1, attachment: "closed" }, 0);
  rig.setKeyframe(root.id, 0);
  rig.setPoseOverride(root.id, { scaleX: 3, attachment: "open" }, 2);
  rig.setKeyframe(root.id, 2);
  rig.clearPoseOverrides();
  const midway = rig.getBonePoseAtFrame(root.id, 1, false);
  assert.ok(Math.abs(midway.scaleX - 2) < 1e-6);
  assert.equal(midway.attachment, "closed");
  assert.equal(rig.getBonePoseAtFrame(root.id, 2, false).attachment, "open");
  assert.equal(rig.computeWorldTransforms(2, "rest", false).get(root.id)?.worldScaleX, 2);
});

test("RigState.evaluate matches computeWorldTransforms for unconstrained rigs", () => {
  const rig = new RigState();
  const root = rig.addBone({
    name: "Root",
    parentId: null,
    localX: 5,
    localY: 5,
    length: 8,
    rotationDeg: 10,
  });
  const child = rig.addBone({
    name: "Child",
    parentId: root.id,
    localX: 8,
    localY: 0,
    length: 6,
    rotationDeg: -20,
  });
  rig.addBone({
    name: "Grand",
    parentId: child.id,
    localX: 6,
    localY: 0,
    length: 4,
    rotationDeg: 30,
  });

  rig.setPoseOverride(root.id, { rotationDeg: -10, scaleX: 1.5 }, 0);
  rig.setKeyframe(root.id, 0, "linear");
  rig.setPoseOverride(root.id, { rotationDeg: 20, scaleX: 2 }, 4);
  rig.setKeyframe(root.id, 4, "easeInOut");
  rig.setPoseOverride(child.id, { localX: 9, rotationDeg: 15 }, 2);
  rig.clearPoseOverrides();

  for (let frame = 0; frame <= 4; frame++) {
    for (const useOverrides of [true, false]) {
      const evaluated = rig.evaluate(frame, { useOverrides });
      const wrapped = rig.computeWorldTransforms(frame, "pose", useOverrides);
      assert.equal(evaluated.size, wrapped.size);
      for (const [boneId, expected] of wrapped.entries()) {
        const actual = evaluated.get(boneId);
        assert.ok(actual);
        assert.ok(Math.abs(actual.x - expected.x) < 1e-9);
        assert.ok(Math.abs(actual.y - expected.y) < 1e-9);
        assert.ok(Math.abs(actual.tipX - expected.tipX) < 1e-9);
        assert.ok(Math.abs(actual.tipY - expected.tipY) < 1e-9);
        assert.ok(
          Math.abs(actual.worldRotationDeg - expected.worldRotationDeg) < 1e-9
        );
        assert.ok(Math.abs(actual.worldScaleX - expected.worldScaleX) < 1e-9);
        assert.ok(Math.abs(actual.worldScaleY - expected.worldScaleY) < 1e-9);
      }
    }
  }

  // Linear keyframe segment: -10 deg at F0 -> 20 deg at F4, so F2 is 5 deg.
  const mid = rig.evaluate(2).get(root.id)!;
  assert.ok(Math.abs(mid.worldRotationDeg - 5) < 1e-6);
  // Rest is pure bind FK and ignores pose overrides/keyframes.
  const rest = rig.computeWorldTransforms(4, "rest", false).get(root.id)!;
  assert.equal(rest.worldRotationDeg, root.rotationDeg);
  assert.equal(rest.worldScaleX, 1);
});

test("RigState.evaluate applies aim, copyRotation, copyTransform and rotation limits", () => {
  const rig = new RigState();
  const target = rig.addBone({
    name: "Aim",
    parentId: null,
    localX: 0,
    localY: 0,
    length: 10,
    rotationDeg: 0,
  });

  const aim: RigConstraint = {
    id: "aim-1",
    type: "aim",
    name: "Aim",
    enabled: true,
    boneId: target.id,
    targetX: 0,
    targetY: 10,
    offsetDeg: 0,
    mix: 1,
  };
  rig.constraints = [aim];
  assert.ok(
    Math.abs(rig.evaluate(0).get(target.id)!.worldRotationDeg - 90) < 1e-6
  );
  assert.ok(
    Math.abs(
      rig.evaluate(0, { applyConstraints: false }).get(target.id)!
        .worldRotationDeg - 0
    ) < 1e-6
  );
  rig.constraints = [{ ...aim, mix: 0.5 }];
  assert.ok(
    Math.abs(rig.evaluate(0).get(target.id)!.worldRotationDeg - 45) < 1e-6
  );
  rig.constraints = [{ ...aim, enabled: false }];
  assert.ok(
    Math.abs(rig.evaluate(0).get(target.id)!.worldRotationDeg - 0) < 1e-6
  );

  const limited = rig.addBone({
    name: "Limited",
    parentId: null,
    localX: 0,
    localY: 0,
    length: 10,
    rotationDeg: 0,
    maxAngleDeg: 45,
  });
  rig.constraints = [{ ...aim, id: "aim-limited", boneId: limited.id }];
  assert.ok(
    Math.abs(rig.evaluate(0).get(limited.id)!.worldRotationDeg - 45) < 1e-6
  );

  const source = rig.addBone({
    name: "Source",
    parentId: null,
    localX: 20,
    localY: 20,
    length: 5,
    rotationDeg: 30,
  });
  const copyRotation: RigConstraint = {
    id: "copy-rot",
    type: "copyRotation",
    name: "Copy Rotation",
    enabled: true,
    boneId: target.id,
    sourceBoneId: source.id,
    mix: 1,
  };
  rig.constraints = [copyRotation];
  assert.ok(
    Math.abs(rig.evaluate(0).get(target.id)!.worldRotationDeg - 30) < 1e-6
  );

  const transformSource = rig.addBone({
    name: "TransformSource",
    parentId: null,
    localX: 7,
    localY: 3,
    length: 5,
    rotationDeg: 20,
    scaleX: 2,
    scaleY: 3,
  });
  const transformTarget = rig.addBone({
    name: "TransformTarget",
    parentId: null,
    localX: 0,
    localY: 0,
    length: 5,
    rotationDeg: 0,
  });
  const copyTransform: RigConstraint = {
    id: "copy-xf",
    type: "copyTransform",
    name: "Copy Transform",
    enabled: true,
    boneId: transformTarget.id,
    sourceBoneId: transformSource.id,
    mix: 1,
  };
  rig.constraints = [copyTransform];
  const copied = rig.evaluate(0).get(transformTarget.id)!;
  assert.ok(Math.abs(copied.x - 7) < 1e-9);
  assert.ok(Math.abs(copied.y - 3) < 1e-9);
  assert.ok(Math.abs(copied.worldRotationDeg - 20) < 1e-9);
  assert.ok(Math.abs(copied.worldScaleX - 2) < 1e-9);
  assert.ok(Math.abs(copied.worldScaleY - 3) < 1e-9);

  rig.constraints = [{ ...copyTransform, mix: 0.5 }];
  const halfCopied = rig.evaluate(0).get(transformTarget.id)!;
  assert.ok(Math.abs(halfCopied.x - 3.5) < 1e-9);
  assert.ok(Math.abs(halfCopied.worldRotationDeg - 10) < 1e-9);
  assert.ok(Math.abs(halfCopied.worldScaleX - 1.5) < 1e-9);

  // Constraints run in list order: the last one wins at mix = 1.
  rig.constraints = [copyRotation, aim];
  assert.ok(
    Math.abs(rig.evaluate(0).get(target.id)!.worldRotationDeg - 90) < 1e-6
  );
  rig.constraints = [aim, copyRotation];
  assert.ok(
    Math.abs(rig.evaluate(0).get(target.id)!.worldRotationDeg - 30) < 1e-6
  );
});

test("RigState IK constraint reaches a reachable target and keyed targets interpolate", () => {
  const rig = new RigState();
  const root = rig.addBone({
    name: "Root",
    parentId: null,
    localX: 0,
    localY: 0,
    length: 10,
    rotationDeg: 0,
  });
  const child = rig.addBone({
    name: "Child",
    parentId: root.id,
    localX: 10,
    localY: 0,
    length: 10,
    rotationDeg: 0,
  });
  const ik: RigConstraint = {
    id: "ik-1",
    type: "ik",
    name: "IK",
    enabled: true,
    boneIds: [root.id, child.id],
    targetX: 10,
    targetY: 10,
    bendSign: 1,
    mix: 1,
  };
  rig.constraints = [ik];
  const solved = rig.evaluate(0).get(child.id)!;
  assert.ok(Math.abs(solved.tipX - 10) < 0.05);
  assert.ok(Math.abs(solved.tipY - 10) < 0.05);

  const aim: RigConstraint = {
    id: "aim-keyed",
    type: "aim",
    name: "Keyed Aim",
    enabled: true,
    boneId: root.id,
    targetX: 0,
    targetY: 10,
    offsetDeg: 0,
    mix: 1,
  };
  rig.constraints = [aim];
  rig.getActiveClip().constraintTracks = {
    "aim-keyed": [
      { frame: 0, targetX: 0, targetY: 10, easing: "linear" },
      { frame: 2, targetX: 10, targetY: 0, easing: "linear" },
    ],
  };
  assert.deepEqual(rig.getConstraintTargetAtFrame("aim-keyed", 1), {
    x: 5,
    y: 5,
  });
  assert.ok(
    Math.abs(rig.evaluate(1).get(root.id)!.worldRotationDeg - 45) < 1e-6
  );
  assert.ok(
    Math.abs(rig.evaluate(0).get(root.id)!.worldRotationDeg - 90) < 1e-6
  );
  assert.equal(rig.getConstraintTargetAtFrame("missing", 0), null);
});

test("RigState spring constraint is deterministic and settles toward its target", () => {
  const build = () => {
    const rig = new RigState();
    const bone = rig.addBone({
      name: "Tail",
      parentId: null,
      localX: 0,
      localY: 0,
      length: 10,
      rotationDeg: 0,
    });
    rig.setPoseOverride(bone.id, { rotationDeg: 0 }, 0);
    rig.setKeyframe(bone.id, 0);
    rig.setPoseOverride(bone.id, { rotationDeg: 40 }, 1);
    rig.setKeyframe(bone.id, 1);
    rig.clearPoseOverrides();
    const spring: RigConstraint = {
      id: "spring-1",
      type: "spring",
      name: "Spring",
      enabled: true,
      boneId: bone.id,
      stiffness: 0.2,
      damping: 0.4,
      gravity: 0,
      mix: 1,
    };
    rig.constraints = [spring];
    return { rig, bone };
  };

  const first = build();
  const atTwenty = first.rig.evaluate(20).get(first.bone.id)!.worldRotationDeg;
  const again = first.rig.evaluate(20).get(first.bone.id)!.worldRotationDeg;
  assert.equal(again, atTwenty);
  assert.notEqual(
    first.rig.evaluate(5).get(first.bone.id)!.worldRotationDeg,
    atTwenty
  );

  // Scrubbing in a different order must produce the same trajectory.
  const second = build();
  assert.equal(
    Math.abs(second.rig.evaluate(20).get(second.bone.id)!.worldRotationDeg - atTwenty) <
      1e-9,
    true
  );
  const settled = first.rig.evaluate(300).get(first.bone.id)!.worldRotationDeg;
  assert.ok(Math.abs(settled - 40) < 1);

  // Direct constraint edits require invalidating the per-version cache.
  const atFive = first.rig.evaluate(5).get(first.bone.id)!.worldRotationDeg;
  const cachedSpring = first.rig.constraints[0];
  if (cachedSpring.type === "spring") {
    cachedSpring.stiffness = 0.05;
  }
  first.rig.invalidateEvaluation();
  assert.notEqual(
    first.rig.evaluate(5).get(first.bone.id)!.worldRotationDeg,
    atFive
  );
});

test("RigState v2 snapshot round-trips constraints, slots, poses and clip metadata", () => {
  const rig = new RigState();
  const root = rig.addBone({
    name: "Root",
    parentId: null,
    localX: 4,
    localY: 4,
    length: 6,
    rotationDeg: 0,
  });
  const aim: RigConstraint = {
    id: "aim-1",
    type: "aim",
    name: "Aim",
    enabled: true,
    boneId: root.id,
    targetX: 0,
    targetY: 10,
    offsetDeg: 0,
    mix: 1,
  };
  rig.constraints = [aim];
  rig.slots = [
    {
      id: "slot-hand",
      name: "Hand",
      boneId: root.id,
      layerId: "layer-hand",
      attachments: { open: { layerId: "layer-hand", frame: 2 } },
      defaultAttachment: "open",
    },
  ];
  rig.poses = [
    {
      id: "pose-wave",
      name: "Wave",
      bones: {
        [root.id]: {
          rotationDeg: 12,
          localX: 4,
          localY: 4,
          scaleX: 1,
          scaleY: 1,
        },
      },
    },
  ];
  const clip = rig.getActiveClip();
  clip.loop = true;
  clip.constraintTracks = {
    "aim-1": [
      { frame: 0, targetX: 0, targetY: 10, easing: "linear" },
      { frame: 2, targetX: 10, targetY: 0, easing: "linear" },
    ],
  };

  const snap = rig.toSnapshot();
  assert.equal(snap.version, 2);
  const restored = new RigState();
  restored.fromSnapshot(JSON.parse(JSON.stringify(snap)));

  assert.deepEqual(restored.constraints, rig.constraints);
  assert.deepEqual(restored.slots, rig.slots);
  assert.deepEqual(restored.poses, rig.poses);
  assert.equal(restored.getActiveClip().loop, true);
  assert.deepEqual(restored.getConstraintTargetAtFrame("aim-1", 1), {
    x: 5,
    y: 5,
  });
  assert.ok(
    Math.abs(restored.evaluate(1).get(root.id)!.worldRotationDeg - 45) < 1e-6
  );
});

test("RigHistory undo/redo round-trip, redo clearing and 100-entry cap", () => {
  const rig = new RigState();
  const bone = rig.addBone({
    name: "Root",
    parentId: null,
    localX: 4,
    localY: 4,
    length: 6,
    rotationDeg: 0,
  });
  const history = new RigHistory();
  assert.equal(history.canUndo, false);
  assert.equal(history.canRedo, false);
  assert.equal(history.undo(rig), null);
  assert.equal(history.redo(rig), null);

  history.push(rig, "Rename bone");
  rig.updateBone(bone.id, { name: "Renamed" });
  assert.equal(history.canUndo, true);
  assert.equal(history.undo(rig), "Rename bone");
  assert.equal(rig.bones[0].name, "Root");
  assert.equal(history.canRedo, true);
  assert.equal(history.redo(rig), "Rename bone");
  assert.equal(rig.bones[0].name, "Renamed");

  history.undo(rig);
  history.push(rig, "Add bone");
  rig.addBone({
    name: "Child",
    parentId: bone.id,
    localX: 6,
    localY: 0,
    length: 4,
    rotationDeg: 0,
  });
  assert.equal(history.canRedo, false);

  const capRig = new RigState();
  const capBone = capRig.addBone({
    name: "Cap",
    parentId: null,
    localX: 0,
    localY: 0,
    length: 6,
    rotationDeg: 0,
  });
  const capped = new RigHistory(100);
  for (let i = 0; i < 105; i++) {
    capped.push(capRig, `Edit ${i}`);
    capRig.updateBone(capBone.id, { localX: i + 1 });
  }
  let undone = 0;
  while (capped.undo(capRig) !== null) undone++;
  assert.equal(undone, 100);
  assert.equal(capped.canUndo, false);
  capped.clear();
  assert.equal(capped.canRedo, false);
});

test("shaderPreview: generateAutoNormalMap, apply2DLighting, and applyPaletteSwapLut", () => {
  const albedo = new PixelBuffer(8, 8);
  for (let y = 2; y <= 5; y++) {
    for (let x = 2; x <= 5; x++) {
      albedo.setPixel(x, y, 180, 180, 180, 255);
    }
  }

  // 1. Auto normal map produces valid tangent normals on opaque pixels
  const normals = generateAutoNormalMap(albedo, 2.0);
  const centerN = normals.getPixel(3, 3);
  assert.equal(centerN[3], 255);
  assert.ok(centerN[2] > 200); // Flat interior faces +Z
  assert.equal(normals.getPixel(0, 0)[3], 0); // Transparent outside stays transparent
  // Top rim (x=3, y=2) faces upward (+Y in OpenGL normal space -> G > 128)
  assert.ok(normals.getPixel(3, 2)[1] > 140);

  // 2. 2D lighting with top light illuminates top rim brighter than bottom rim, and adds emission
  const emission = new PixelBuffer(8, 8);
  emission.setPixel(4, 4, 255, 60, 0, 255);

  const lit = apply2DLighting(
    albedo.data,
    normals.data,
    emission.data,
    8,
    8,
    {
      enabled: true,
      lightX: 0.5,
      lightY: 0.05,
      lightZ: 0.25,
      lightColor: "#ffffff",
      intensity: 1.8,
      ambient: 0.15,
      emissionStrength: 1.0,
    }
  );
  const topR = lit[(2 * 8 + 3) * 4];
  const botR = lit[(5 * 8 + 3) * 4];
  assert.ok(topR > botR);
  // Emissive pixel at (4,4) gets bright red emission boost
  const emIdx = (4 * 8 + 4) * 4;
  assert.equal(lit[emIdx], 255);

  // 3. Palette-Swap LUT remaps source palette colors to target palette preserving alpha
  const swBuf = new Uint8ClampedArray([
    10, 20, 30, 255,
    40, 50, 60, 128,
    0, 0, 0, 0,
  ]);
  const swapped = applyPaletteSwapLut(
    swBuf,
    ["#0a141e", "#28323c"],
    ["#ff0000", "#00ff00"]
  );
  assert.deepEqual(Array.from(swapped), [
    255, 0, 0, 255,
    0, 255, 0, 128,
    0, 0, 0, 0,
  ]);
});

// ---------------------------------------------------------------------------
// R6 — smooth weights, mesh deformation & pixel cleanup
// ---------------------------------------------------------------------------

const R6_BONES: AutoWeightBone[] = [
  { id: "bone-1", x: 8, y: 0, tipX: 8, tipY: 8 },
  { id: "bone-2", x: 8, y: 8, tipX: 8, tipY: 16 },
];

function makeR6Sprite(size = 16): PixelBuffer {
  const buf = new PixelBuffer(size, size);
  for (let y = 2; y < size - 2; y++) {
    for (let x = 4; x < size - 4; x++) {
      buf.setPixel(x, y, 40 + x * 3, 90 + y * 2, 160, 255);
    }
  }
  buf.setPixel(6, 6, 255, 0, 0, 255);
  buf.setPixel(9, 9, 0, 255, 0, 255);
  return buf;
}

test("R6 auto weights keep <=4 influences per pixel and normalize to 1", () => {
  const src = makeR6Sprite(16);
  const weights = autoAssignWeights(src, R6_BONES);
  assert.ok(weights);
  assert.ok(weights.entries.size > 0);

  let softPixels = 0;
  for (const influences of weights.entries.values()) {
    assert.ok(influences.length <= 4);
    assert.ok(Math.abs(influenceSum(influences) - 1) < 1e-9);
    if (influences.some((influence) => influence.w < 0.99)) softPixels++;
  }
  assert.ok(softPixels > 0, "auto weights should produce soft blends");

  // Every brush mode keeps the map normalized and capped at 4.
  for (const mode of ["add", "subtract", "smooth", "replace"] as const) {
    paintWeightBrush(weights, "bone-1", {
      cx: 8,
      cy: 8,
      radius: 4,
      strength: 0.7,
      mode,
      falloff: "linear",
    });
    for (const influences of weights.entries.values()) {
      assert.ok(influences.length <= 4);
      assert.ok(Math.abs(influenceSum(influences) - 1) < 1e-9);
      assert.ok(influences.every((influence) => influence.w > 0));
    }
  }
});

test("R6 RigState soft weight painting normalizes and survives snapshot round-trip", () => {
  const src = makeR6Sprite(16);
  const rig = new RigState();
  rig.addBone({
    name: "Upper",
    parentId: null,
    localX: 8,
    localY: 0,
    length: 8,
    rotationDeg: 90,
  });
  rig.addBone({
    name: "Lower",
    parentId: null,
    localX: 8,
    localY: 8,
    length: 8,
    rotationDeg: 90,
  });
  rig.autoAssignBoneWeights(src, 0);
  rig.paintBoneWeights("bone-1", 16, 16, 8, 8, 4, {
    strength: 0.6,
    mode: "add",
    falloff: "linear",
  });

  const weights = rig.getBoneWeights();
  assert.ok(weights);
  for (const influences of weights.entries.values()) {
    assert.ok(Math.abs(influenceSum(influences) - 1) < 1e-9);
  }

  // The legacy hard-mask brush keeps the soft map normalized too.
  rig.paintBoneMask("bone-1", 16, 16, 8, 8, 2, false, true);
  for (const influences of rig.getBoneWeights()!.entries.values()) {
    assert.ok(Math.abs(influenceSum(influences) - 1) < 1e-9);
  }
  assert.equal(rig.hasAnyBoneMask(), true);

  // Selected-bone weight heatmap uses weight-proportional alpha.
  const heat = new PixelBuffer(16, 16);
  renderBoneInfluenceOverlay(rig, heat, "bone-1", { mode: "heatmap" });
  assert.ok(heat.getPixel(8, 8)[3] > 0);

  const mesh = createAutoGridMesh(src, {
    id: "mesh-1",
    name: "Body Mesh",
    layerId: "layer-body",
    cellSize: 4,
  });
  assert.ok(mesh);
  rig.addMesh(mesh);
  rig.setMeshVertexOffset("mesh-1", 0, 1, -2);
  rig.setMeshKeyframe(
    "mesh-1",
    2,
    mesh.vertices.map(() => [0.5, 0.5] as [number, number])
  );

  const snapped = rig.toSnapshot();
  assert.equal(snapped.version, 2);
  assert.ok(snapped.weights);
  assert.equal(snapped.meshes.length, 1);
  assert.ok(snapped.clips[0].meshTracks?.["mesh-1"]);

  const restored = new RigState();
  restored.fromSnapshot(JSON.parse(JSON.stringify(snapped)));
  const restoredWeights = restored.getBoneWeights();
  assert.ok(restoredWeights);
  assert.ok(
    Array.from(restoredWeights.entries.values()).some((influences) =>
      influences.some((influence) => influence.w < 0.99)
    ),
    "soft weights must not collapse to hard masks after reload"
  );
  assert.equal(restored.meshes.length, 1);
  assert.equal(restored.meshes[0].vertices[0].offsetX, 1);
  assert.equal(restored.getActiveClip().meshTracks?.["mesh-1"]?.length, 1);
});

test("R6 inverse-triangle sampler maps an identity mesh to an identical image", () => {
  const src = makeR6Sprite(12);
  const mesh = createGridMesh({
    id: "mesh-identity",
    bounds: { x: 0, y: 0, width: 12, height: 12 },
    cellSize: 4,
  });
  const out = renderRigMesh(src, mesh);
  assert.deepEqual(Array.from(out.data), Array.from(src.data));

  // A pure FFD translation shifts the pixels by exactly one cell pixel.
  const offsets = mesh.vertices.map(() => [1, 0] as [number, number]);
  const shifted = renderRigMesh(src, mesh, { offsets, pixelSnap: true });
  assert.deepEqual(shifted.getPixel(7, 6), [255, 0, 0, 255]);
  // The pixel formerly at (6,6) now samples its left neighbour.
  assert.deepEqual(shifted.getPixel(6, 6), [55, 102, 160, 255]);
});

test("R6 mesh FFD offsets interpolate between keyframes", () => {
  const mesh = createGridMesh({
    id: "mesh-anim",
    bounds: { x: 0, y: 0, width: 8, height: 8 },
    cellSize: 4,
  });
  const zeros = mesh.vertices.map(() => [0, 0] as [number, number]);
  const ones = mesh.vertices.map(() => [2, -2] as [number, number]);
  let track = upsertMeshKeyframe([], mesh, 0, zeros);
  track = upsertMeshKeyframe(track, mesh, 2, ones);
  const mid = sampleMeshOffsets(mesh, track, 1);
  assert.deepEqual(mid[0], [1, -1]);
  assert.deepEqual(mid[mid.length - 1], [1, -1]);
});

test("R6 skinLayerPixels stays hole-free and palette-preserving under LBS", () => {
  const src = makeR6Sprite(16);
  const weights = autoAssignWeights(src, R6_BONES);
  assert.ok(weights);

  const rest = new Map([
    [
      "bone-1",
      {
        id: "bone-1",
        x: 8,
        y: 0,
        tipX: 8,
        tipY: 8,
        worldRotationDeg: 90,
        length: 8,
        worldScaleX: 1,
        worldScaleY: 1,
      },
    ],
    [
      "bone-2",
      {
        id: "bone-2",
        x: 8,
        y: 8,
        tipX: 8,
        tipY: 16,
        worldRotationDeg: 90,
        length: 8,
        worldScaleX: 1,
        worldScaleY: 1,
      },
    ],
  ]);
  const identity = buildBoneTransformMap(rest, rest);
  const identical = skinLayerPixels(src, weights, identity, { pixelSnap: true });
  assert.deepEqual(Array.from(identical.data), Array.from(src.data));

  const posed = new Map(rest);
  posed.set("bone-1", {
    ...rest.get("bone-1")!,
    worldRotationDeg: 60,
  });
  const deform = buildBoneTransformMap(rest, posed);
  const bent = skinLayerPixels(src, weights, deform, { pixelSnap: true });
  assert.notDeepEqual(Array.from(bent.data), Array.from(src.data));

  const palette = new Set(
    collectPalette(src).map((color) =>
      packRgba(color[0], color[1], color[2], color[3])
    )
  );
  let opaque = 0;
  for (let i = 0; i < bent.data.length; i += 4) {
    if (bent.data[i + 3] === 0) continue;
    opaque++;
    const packed = packRgba(
      bent.data[i],
      bent.data[i + 1],
      bent.data[i + 2],
      bent.data[i + 3]
    );
    assert.ok(palette.has(packed), "LBS must only sample existing colors");
  }
  assert.ok(opaque > 0);
});

test("R6 hole fill fixes a known 1-px gap and orphan removal drops isolated pixels", () => {
  const gap = new PixelBuffer(5, 5);
  for (let y = 1; y <= 3; y++) {
    for (let x = 1; x <= 3; x++) {
      if (x === 2 && y === 2) continue;
      gap.setPixel(x, y, 20, 40, 60, 255);
    }
  }
  const filled = fillSinglePixelHoles(gap);
  assert.deepEqual(filled.getPixel(2, 2), [20, 40, 60, 255]);

  const isolated = new PixelBuffer(5, 5);
  isolated.setPixel(2, 2, 255, 0, 0, 255);
  isolated.setPixel(0, 0, 0, 255, 0, 255);
  isolated.setPixel(1, 0, 0, 255, 0, 255);
  const cleaned = removeOrphanPixels(isolated);
  assert.deepEqual(cleaned.getPixel(2, 2), [0, 0, 0, 0]);
  assert.deepEqual(cleaned.getPixel(0, 0), [0, 255, 0, 255]);
});

test("R6 palette lock never introduces colors outside the source cel", () => {
  const source = new PixelBuffer(8, 8);
  source.setPixel(0, 0, 10, 20, 30, 255);
  source.setPixel(1, 0, 200, 100, 50, 255);
  source.setPixel(2, 0, 90, 90, 220, 255);
  const palette = collectPalette(source);
  const known = new Set(
    palette.map((color) => packRgba(color[0], color[1], color[2], color[3]))
  );

  const deformed = new PixelBuffer(8, 8);
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) {
      deformed.setPixel(x, y, (x * 31) % 256, (y * 47) % 256, (x + y) * 9, 255);
    }
  }

  const locked = snapToPalette(deformed, palette);
  for (let i = 0; i < locked.data.length; i += 4) {
    if (locked.data[i + 3] === 0) continue;
    const packed = packRgba(
      locked.data[i],
      locked.data[i + 1],
      locked.data[i + 2],
      locked.data[i + 3]
    );
    assert.ok(known.has(packed), "palette lock introduced a new color");
  }

  // The full cleanup pass (outline + palette lock) also stays in-palette.
  const cleaned = applyPixelCleanup(
    deformed,
    {
      removeOrphans: false,
      fillHoles: true,
      paletteLock: true,
      preserveOutline: true,
    },
    { palette }
  );
  for (let i = 0; i < cleaned.data.length; i += 4) {
    if (cleaned.data[i + 3] === 0) continue;
    const packed = packRgba(
      cleaned.data[i],
      cleaned.data[i + 1],
      cleaned.data[i + 2],
      cleaned.data[i + 3]
    );
    assert.ok(known.has(packed), "cleanup introduced a new color");
  }
});

test("R6 compositeRigFrame uses LBS for soft weights and keeps image colors", () => {
  const engine = new PixelEngine(16, 16);
  const cel = engine.getOrCreateCel("layer-body", 0);
  cel.data.set(makeR6Sprite(16).data);
  cel.markAllDirty();
  for (let i = 0; i < 2; i++) {
    engine.rig.addBone({
      name: `Bone ${i + 1}`,
      parentId: null,
      localX: 8,
      localY: i * 8,
      length: 8,
      rotationDeg: 90,
    });
  }
  engine.rig.autoAssignBoneWeights(cel, 0);
  engine.rig.setPoseOverride("bone-1", { rotationDeg: 70 }, 0);

  const output = engine.compositeRigFrame(
    [
      {
        id: "layer-body",
        kind: "raster",
        visible: true,
        opacity: 100,
        blendMode: "Normal",
      },
    ],
    0,
    { pixelSnap: true, rotSprite: true },
    true
  );
  const palette = new Set(
    collectPalette(cel).map((color) =>
      packRgba(color[0], color[1], color[2], color[3])
    )
  );
  let opaque = 0;
  for (let i = 0; i < output.length; i += 4) {
    if (output[i + 3] === 0) continue;
    opaque++;
    const packed = packRgba(output[i], output[i + 1], output[i + 2], output[i + 3]);
    assert.ok(palette.has(packed));
  }
  assert.ok(opaque > 0);
});

test("R6 rig skinning benchmark 128x128 with 10 bones (logs timing only)", () => {
  const engine = new PixelEngine(128, 128);
  const cel = engine.getOrCreateCel("layer-body", 0);
  for (let y = 16; y < 112; y++) {
    for (let x = 32; x < 96; x++) {
      cel.setPixel(x, y, 60 + ((x * 7) % 150), 80 + ((y * 5) % 140), 190, 255);
    }
  }

  const boneIds: string[] = [];
  let parentId: string | null = null;
  for (let i = 0; i < 10; i++) {
    const bone = engine.rig.addBone({
      name: `Chain ${i + 1}`,
      parentId,
      localX: i === 0 ? 64 : 8,
      localY: i === 0 ? 16 : 0,
      length: 9.6,
      rotationDeg: i === 0 ? 90 : 0,
    });
    boneIds.push(bone.id);
    parentId = bone.id;
  }
  engine.rig.autoAssignBoneWeights(cel, 0);

  const layers = [
    {
      id: "layer-body",
      kind: "raster",
      visible: true,
      opacity: 100,
      blendMode: "Normal" as const,
    },
  ];

  const coldTimes: number[] = [];
  for (let i = 0; i < 12; i++) {
    engine.rig.setPoseOverride(boneIds[5], { rotationDeg: 6 + i * 2 }, 0);
    const start = performance.now();
    engine.compositeRigFrame(layers, 0, { pixelSnap: true, rotSprite: true }, true);
    coldTimes.push(performance.now() - start);
  }

  const warmTimes: number[] = [];
  for (let i = 0; i < 8; i++) {
    const start = performance.now();
    engine.compositeRigFrame(layers, 0, { pixelSnap: true, rotSprite: true }, true);
    warmTimes.push(performance.now() - start);
  }

  const average = (values: number[]): number =>
    values.reduce((sum, value) => sum + value, 0) / values.length;
  const coldAvg = average(coldTimes);
  const warmAvg = average(warmTimes);
  const coldMin = Math.min(...coldTimes);
  const warmMin = Math.min(...warmTimes);
  console.log(
    `[R6 benchmark] 128x128 soft LBS, 10 bones: cold avg ${coldAvg.toFixed(2)} ms ` +
      `(min ${coldMin.toFixed(2)} ms), cached avg ${warmAvg.toFixed(2)} ms ` +
      `(min ${warmMin.toFixed(2)} ms), target < 8 ms`
  );

  // Never fail CI on timing — only assert the frame was produced.
  assert.equal(
    engine.compositeRigFrame(layers, 0, { pixelSnap: true, rotSprite: true }, true)
      .length,
    128 * 128 * 4
  );
});

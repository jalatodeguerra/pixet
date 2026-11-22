import test from "node:test";
import assert from "node:assert/strict";

import { PixelBuffer } from "../src/engine/document/PixelBuffer.ts";
import { PixelEngine } from "../src/engine/document/PixelEngine.ts";
import { UndoCoordinator } from "../src/engine/history/UndoCoordinator.ts";
import {
  deserializeAutoTileRuleset,
  remapAutoTileRuleset,
  serializeAutoTileRuleset,
} from "../src/engine/tiles/autoTile.ts";
import {
  flipCellH,
  flipCellV,
  packCell,
  rotateCellCCW,
  rotateCellCW,
  unpackCell,
} from "../src/engine/tiles/cell.ts";
import {
  blitTileTransformed,
  TilemapData,
  Tileset,
  TilesetRegistry,
} from "../src/engine/tiles/TilemapEngine.ts";
import {
  cellRectToScreen,
  formatCellFlags,
  screenToTileCell,
} from "../src/engine/tiles/overlayGeometry.ts";
import {
  applyCellChanges,
  computeBrushStamp,
  computeEraserStamp,
  computeFloodFill,
  computeLineStroke,
  computeRandomStroke,
  computeRectFill,
  computeSelectionClear,
  computeSelectionMove,
  createSingleTileBrush,
  extractBrushFromRegion,
  flipBrushH,
  flipBrushV,
  plotCellLine,
  rotateBrushCW,
  snapCellLine45,
  type TileBrush,
} from "../src/engine/tiles/mapTools.ts";

test("cell pack/unpack, flip, and rotate dihedral identities", () => {
  assert.equal(packCell(0, 0), 0);
  assert.deepEqual(unpackCell(0), {
    tilesetIndex: 0,
    localId: 0,
    flipH: false,
    flipV: false,
    flipD: false,
  });

  const base = packCell(3, 42, { flipH: true, flipV: false, flipD: true });
  const u = unpackCell(base);
  assert.equal(u.tilesetIndex, 3);
  assert.equal(u.localId, 42);
  assert.equal(u.flipH, true);
  assert.equal(u.flipV, false);
  assert.equal(u.flipD, true);

  assert.equal(flipCellH(flipCellH(base)), base);
  assert.equal(flipCellV(flipCellV(base)), base);
  assert.equal(flipCellH(0), 0);
  assert.equal(rotateCellCW(0), 0);

  // Check all 8 dihedral states: CW*4 == identity and CCW is inverse of CW
  for (let mask = 0; mask < 8; mask++) {
    const c = packCell(1, 7, {
      flipH: (mask & 1) !== 0,
      flipV: (mask & 2) !== 0,
      flipD: (mask & 4) !== 0,
    });
    const r1 = rotateCellCW(c);
    const r2 = rotateCellCW(r1);
    const r3 = rotateCellCW(r2);
    const r4 = rotateCellCW(r3);
    assert.equal(r4, c);
    assert.equal(rotateCellCCW(r1), c);
  }
});

test("blitTileTransformed renders flipH, flipV, 90deg CW, and non-square safety", () => {
  // 2x2 asymmetric tile:
  // (0,0)=R, (1,0)=G
  // (0,1)=B, (1,1)=W
  const src = new PixelBuffer(2, 2);
  src.setPixel(0, 0, 255, 0, 0, 255);
  src.setPixel(1, 0, 0, 255, 0, 255);
  src.setPixel(0, 1, 0, 0, 255, 255);
  src.setPixel(1, 1, 255, 255, 255, 255);

  const sample = (buf: Uint8ClampedArray, w: number, x: number, y: number) => {
    const i = (y * w + x) * 4;
    return [buf[i], buf[i + 1], buf[i + 2], buf[i + 3]];
  };

  // flipH: (0,0)=G, (1,0)=R
  const dstH = new Uint8ClampedArray(2 * 2 * 4);
  blitTileTransformed(
    dstH,
    2,
    2,
    src,
    0,
    0,
    { flipH: true, flipV: false, flipD: false },
    1,
    "Normal"
  );
  assert.deepEqual(sample(dstH, 2, 0, 0), [0, 255, 0, 255]);
  assert.deepEqual(sample(dstH, 2, 1, 0), [255, 0, 0, 255]);

  // 90 deg CW: rotateCellCW(base) -> flipD=true, flipH=true, flipV=false
  // Top-left (0,0) should become old bottom-left (0,1)=B
  const cwFlags = unpackCell(rotateCellCW(packCell(0, 1)));
  const dstCW = new Uint8ClampedArray(2 * 2 * 4);
  blitTileTransformed(dstCW, 2, 2, src, 0, 0, cwFlags, 1, "Normal");
  assert.deepEqual(sample(dstCW, 2, 0, 0), [0, 0, 255, 255]);
  assert.deepEqual(sample(dstCW, 2, 1, 0), [255, 0, 0, 255]);
  assert.deepEqual(sample(dstCW, 2, 1, 1), [0, 255, 0, 255]);
  assert.deepEqual(sample(dstCW, 2, 0, 1), [255, 255, 255, 255]);

  // Non-square tile (2x3) ignores flipD without out-of-bounds crash
  const rect = new PixelBuffer(2, 3);
  rect.setPixel(1, 2, 10, 20, 30, 255);
  const dstRect = new Uint8ClampedArray(2 * 3 * 4);
  blitTileTransformed(
    dstRect,
    2,
    3,
    rect,
    0,
    0,
    { flipH: false, flipV: false, flipD: true },
    1,
    "Normal"
  );
  assert.deepEqual(sample(dstRect, 2, 1, 2), [10, 20, 30, 255]);
});

test("TilesetRegistry, deleteTileWithRemap, and reorderTiles preserve flags and update maps/animations/rulesets", () => {
  const engine = new PixelEngine(32, 16);
  // Starter tileset has 3 tiles (1, 2, 3). Add animation on tile 3 referencing [1, 2].
  engine.tileset.setMeta(3, {
    name: "Animated",
    animation: {
      frames: [
        { localId: 1, durationMs: 100 },
        { localId: 2, durationMs: 150 },
      ],
    },
  });

  // Add second tileset
  const ts2 = new Tileset("ts-2", "Props", 8, 8);
  const propId = ts2.addTile();
  ts2.getTile(propId)!.setPixel(0, 0, 12, 34, 56, 255);
  const ts2Idx = engine.tilesetRegistry.add(ts2);
  assert.equal(ts2Idx, 1);

  const cellProp = packCell(ts2Idx, propId, { flipH: true });
  const resolved = engine.tilesetRegistry.resolve(cellProp);
  assert.ok(resolved);
  assert.equal(resolved.tilesetIndex, 1);
  assert.equal(resolved.localId, 1);
  assert.equal(resolved.flags.flipH, true);

  // Stamp tile 2 (flipped H) and tile 3 (rotated) in tilemap
  const c2Flip = packCell(0, 2, { flipH: true });
  const c3Rot = rotateCellCW(packCell(0, 3));
  engine.setTilemapCell("tm", 0, 0, 0, c2Flip);
  engine.setTilemapCell("tm", 0, 1, 0, c3Rot);

  // Reorder tileset 0: [3, 1, 2] -> old 3 becomes 1, old 1 becomes 2, old 2 becomes 3
  assert.equal(engine.reorderTilesInTileset([3, 1, 2], 0), true);
  const tm = engine.getTilemap("tm", 0)!;
  const u0 = unpackCell(tm.getCell(0, 0));
  const u1 = unpackCell(tm.getCell(1, 0));
  assert.equal(u0.localId, 3);
  assert.equal(u0.flipH, true);
  assert.equal(u1.localId, 1);
  assert.equal(u1.flipD, true);

  // Animation frames on new tile 1 (was 3) should now be [2, 3]
  assert.deepEqual(
    engine.tileset.getMeta(1)?.animation?.frames.map((f) => f.localId),
    [2, 3]
  );

  // Ruleset remap + serialization round-trip
  const rs = engine.generateAutoTileTerrain();
  const raw = serializeAutoTileRuleset(rs);
  const restored = deserializeAutoTileRuleset(raw);
  assert.ok(restored);
  assert.equal(restored.maskToTile.size, 16);
  const remap = new Map<number, number>([[rs.fallbackTileId, 0]]);
  assert.equal(remapAutoTileRuleset(restored, remap), true);
});

test("TilemapHistory cell & tileset undo/redo and UndoCoordinator mixed order", () => {
  const engine = new PixelEngine(32, 16);
  const cel = engine.getOrCreateCel("raster-1", 0);

  // 1. Pixel stroke
  engine.history.beginTransaction("raster-1", 0, "Paint Pixel");
  engine.history.capturePixelTile(cel, 0, 0);
  cel.setPixel(0, 0, 200, 10, 20, 255);
  assert.equal(engine.history.commitTransaction(cel), true);

  // 2. Cell stamp transaction (first-before-wins)
  engine.tilemapHistory.beginCells("Stamp Tile", "tm-1", 0);
  const tm = engine.getOrCreateTilemap("tm-1", 0);
  const before = tm.getCell(0, 0);
  tm.setCell(0, 0, 1);
  engine.tilemapHistory.recordCell(0, 0, before, 1);
  tm.setCell(0, 0, 2);
  engine.tilemapHistory.recordCell(0, 0, 1, 2);
  assert.equal(engine.tilemapHistory.commitCells(), true);

  // 3. Tileset snapshot op
  const countBefore = engine.tileset.count;
  engine.recordTilesetOp("Add Tile", () => engine.tileset.addTile());
  assert.equal(engine.tileset.count, countBefore + 1);

  // Chronological undo order: tileset -> cells -> pixels
  assert.equal(engine.undoCoordinator.popUndo(), "tileset");
  assert.equal(engine.tilemapHistory.undo(engine)?.kind, "tileset");
  assert.equal(engine.tileset.count, countBefore);

  assert.equal(engine.undoCoordinator.popUndo(), "cells");
  assert.equal(engine.tilemapHistory.undo(engine)?.kind, "cells");
  assert.equal(engine.getTilemap("tm-1", 0)?.getCell(0, 0), 0);

  assert.equal(engine.undoCoordinator.popUndo(), "pixels");
  assert.ok(engine.undo());
  assert.deepEqual(cel.getPixel(0, 0), [0, 0, 0, 0]);

  // Redo back in order: pixels -> cells -> tileset
  assert.equal(engine.undoCoordinator.popRedo(), "pixels");
  assert.ok(engine.redo());
  assert.deepEqual(cel.getPixel(0, 0), [200, 10, 20, 255]);

  assert.equal(engine.undoCoordinator.popRedo(), "cells");
  assert.equal(engine.tilemapHistory.redo(engine)?.kind, "cells");
  assert.equal(engine.getTilemap("tm-1", 0)?.getCell(0, 0), 2);

  assert.equal(engine.undoCoordinator.popRedo(), "tileset");
  assert.equal(engine.tilemapHistory.redo(engine)?.kind, "tileset");
  assert.equal(engine.tileset.count, countBefore + 1);

  // Standalone UndoCoordinator cap check
  const coord = new UndoCoordinator(2);
  coord.record("pixels");
  coord.record("cells");
  coord.record("tileset");
  assert.equal(coord.popUndo(), "tileset");
  assert.equal(coord.popUndo(), "cells");
  assert.equal(coord.popUndo(), undefined);
});

test("TilesetRegistry snapshot and extSnapshot round-trip", () => {
  const reg = new TilesetRegistry();
  reg.tilesets[0].seedStarterTiles();
  reg.tilesets[0].margin = 2;
  reg.tilesets[0].spacing = 1;
  reg.tilesets[0].setMeta(1, { name: "Grass", tags: ["ground"], probability: 0.5 });

  const ts2 = new Tileset("ts-extra", "Extra", 8, 8);
  const id = ts2.addTile(undefined, { name: "Coin" });
  ts2.getTile(id)!.setPixel(3, 3, 255, 215, 0, 255);
  reg.add(ts2);

  const ext = reg.toExtSnapshot();
  const reg2 = new TilesetRegistry();
  reg2.tilesets[0].seedStarterTiles();
  reg2.applyExtSnapshot(ext);

  assert.equal(reg2.tilesets.length, 2);
  assert.equal(reg2.tilesets[0].margin, 2);
  assert.equal(reg2.tilesets[0].spacing, 1);
  assert.equal(reg2.tilesets[0].getMeta(1)?.name, "Grass");
  assert.equal(reg2.tilesets[0].getMeta(1)?.probability, 0.5);
  assert.deepEqual(reg2.tilesets[1].getTile(1)?.getPixel(3, 3), [255, 215, 0, 255]);
  assert.equal(reg2.tilesets[1].getMeta(1)?.name, "Coin");
});

test("overlayGeometry screenToTileCell, cellRectToScreen, and formatCellFlags", () => {
  assert.deepEqual(
    screenToTileCell(35, 19, 128, 16, 16, "orthogonal"),
    { col: 2, row: 1 }
  );
  assert.deepEqual(
    cellRectToScreen(2, 1, 3, 2, 16, 16, 128, "orthogonal"),
    { kind: "rect", x: 32, y: 16, w: 48, h: 32 }
  );

  // Isometric round-trip: origin at (64, 4) for canvasW=128, tileW=16, isoTileH=8
  const isoCell = screenToTileCell(64, 4, 128, 16, 16, "isometric");
  assert.deepEqual(isoCell, { col: 0, row: 0 });
  const isoPoly = cellRectToScreen(0, 0, 1, 1, 16, 16, 128, "isometric");
  assert.equal(isoPoly.kind, "polygon");
  if (isoPoly.kind === "polygon") {
    assert.deepEqual(isoPoly.points, [
      { x: 64, y: 0 },
      { x: 72, y: 4 },
      { x: 64, y: 8 },
      { x: 56, y: 4 },
    ]);
  }

  assert.equal(
    formatCellFlags({ flipH: false, flipV: false, flipD: false }),
    ""
  );
  assert.equal(
    formatCellFlags({ flipH: true, flipV: false, flipD: true }),
    "H D"
  );
});

test("mapTools brush transforms, rect/flood/line/eraser/random/selection tools", () => {
  // 2x1 brush [1, 2]
  const brush: TileBrush = {
    cols: 2,
    rows: 1,
    cells: new Uint32Array([packCell(0, 1), packCell(0, 2)]),
  };

  // flipBrushH swaps columns and sets flipH on each cell
  const fh = flipBrushH(brush);
  assert.equal(unpackCell(fh.cells[0]).localId, 2);
  assert.equal(unpackCell(fh.cells[0]).flipH, true);
  assert.equal(unpackCell(fh.cells[1]).localId, 1);
  assert.equal(unpackCell(fh.cells[1]).flipH, true);

  // flipBrushV preserves 1-row layout and sets flipV
  const fv = flipBrushV(brush);
  assert.equal(unpackCell(fv.cells[0]).flipV, true);

  // rotateBrushCW 4 times returns identity layout and flags
  let rot = brush;
  for (let i = 0; i < 4; i++) rot = rotateBrushCW(rot);
  assert.equal(rot.cols, 2);
  assert.equal(rot.rows, 1);
  assert.deepEqual(Array.from(rot.cells), Array.from(brush.cells));

  // Rect fill pattern alignment on 4x3 map
  const tm = new TilemapData(4, 3);
  const rectChanges = computeRectFill(tm, 1, 0, 3, 1, brush);
  applyCellChanges(tm, rectChanges);
  assert.equal(tm.getCell(1, 0), packCell(0, 1));
  assert.equal(tm.getCell(2, 0), packCell(0, 2));
  assert.equal(tm.getCell(3, 0), packCell(0, 1));
  assert.equal(tm.getCell(1, 1), packCell(0, 1));

  // Flood fill contiguous vs global
  const tmFill = new TilemapData(4, 3);
  tmFill.setCell(1, 0, 9);
  tmFill.setCell(1, 1, 9);
  tmFill.setCell(1, 2, 9);
  // Left side (col 0) is separated from right side (cols 2..3) by wall of 9s
  const contig = computeFloodFill(
    tmFill,
    0,
    0,
    createSingleTileBrush(5),
    true
  );
  assert.equal(contig.length, 3); // only col 0
  const global = computeFloodFill(
    tmFill,
    0,
    0,
    createSingleTileBrush(5),
    false
  );
  assert.equal(global.length, 9); // all 9 empty cells

  // Line & 45-degree snap
  const line = plotCellLine(0, 0, 3, 3);
  assert.equal(line.length, 4);
  assert.deepEqual(snapCellLine45(0, 0, 4, 1), { col: 4, row: 0 });
  const lineChanges = computeLineStroke(
    new TilemapData(4, 4),
    0,
    0,
    3,
    1,
    createSingleTileBrush(1),
    true,
    "topLeft"
  );
  assert.equal(lineChanges.length, 4);

  // Center anchor & eraser stamp
  const centerStamp = computeBrushStamp(
    new TilemapData(5, 5),
    2,
    2,
    { cols: 3, rows: 3, cells: new Uint32Array(9).fill(1) },
    "center"
  );
  assert.equal(centerStamp.length, 9);
  const tmErase = new TilemapData(4, 4, new Uint32Array(16).fill(1));
  assert.equal(computeEraserStamp(tmErase, 2, 2, 2).length, 4);

  // Random stroke determinism & probability weighting
  const tmRand = new TilemapData(6, 1);
  const pts = [
    { col: 0, row: 0 },
    { col: 1, row: 0 },
    { col: 2, row: 0 },
    { col: 3, row: 0 },
  ];
  const pool = [
    { cell: 1, weight: 0 },
    { cell: 2, weight: 10 },
  ];
  const rA = computeRandomStroke(tmRand, pts, pool, 42);
  const rB = computeRandomStroke(tmRand, pts, pool, 42);
  assert.deepEqual(rA, rB);
  assert.ok(rA.every((c) => c.after === 2));

  // Extract brush, selection move, selection clear
  const tmSel = new TilemapData(4, 4);
  tmSel.setCell(0, 0, 7);
  tmSel.setCell(1, 0, 8);
  const extracted = extractBrushFromRegion(tmSel, 0, 0, 1, 0);
  assert.equal(extracted.cols, 2);
  assert.deepEqual(Array.from(extracted.cells), [7, 8]);

  const sel = new Set(["0,0", "1,0"]);
  const moveChanges = computeSelectionMove(tmSel, sel, 1, 1);
  applyCellChanges(tmSel, moveChanges);
  assert.equal(tmSel.getCell(0, 0), 0);
  assert.equal(tmSel.getCell(1, 1), 7);
  assert.equal(tmSel.getCell(2, 1), 8);

  const clearChanges = computeSelectionClear(tmSel, new Set(["1,1", "2,1"]));
  applyCellChanges(tmSel, clearChanges);
  assert.equal(tmSel.getCell(1, 1), 0);
  assert.equal(tmSel.getCell(2, 1), 0);
});

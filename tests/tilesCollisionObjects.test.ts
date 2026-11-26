import test from "node:test";
import assert from "node:assert/strict";

import { PixelBuffer } from "../src/engine/document/PixelBuffer.ts";
import { PixelEngine } from "../src/engine/document/PixelEngine.ts";
import { pixelEngine } from "../src/engine/document/PixelEngine.ts";
import {
  hydrateProjectTransfer,
  serializeProjectTransfer,
} from "../src/engine/io/projectBridge.ts";
import { validateProjectTransfer } from "../src/engine/io/projectValidation.ts";
import { type CellFlags, packCell } from "../src/engine/tiles/cell.ts";
import {
  collisionPolygons,
  type CollisionPreset,
  getCollisionPreset,
  pointInPolygon,
  polygonArea,
  presetToPolygon,
  shapeToPolygon,
  transformShape,
} from "../src/engine/tiles/collision.ts";
import {
  createPointObject,
  createRectObject,
  deserializeObjectLayers,
  hitTestObjects,
  isRectDrag,
  parsePropertyValue,
  rectFromDrag,
  serializeObjectLayers,
  snapToGrid,
  type TileObject,
} from "../src/engine/tiles/objects.ts";
import { blitTileTransformed } from "../src/engine/tiles/TilemapEngine.ts";
import type { CollisionShape } from "../src/engine/tiles/Tileset.ts";
import {
  collectGodotTilemapFiles,
  renderTilemapPng,
} from "../src/engine/export/tilemapExport.ts";
import {
  buildTileAtlas,
  encodeTileMapData,
  generateGodotScene,
  generateGodotTileSet,
  godotAlternative,
  GODOT_FLIP_H,
  GODOT_FLIP_V,
  GODOT_TRANSPOSE,
} from "../src/engine/export/godotTilemap.ts";
import { useEditorStore } from "../src/store/editorStore.ts";

const ALL_FLAGS: CellFlags[] = [];
for (const flipH of [false, true]) {
  for (const flipV of [false, true]) {
    for (const flipD of [false, true]) {
      ALL_FLAGS.push({ flipH, flipV, flipD });
    }
  }
}
const label = (f: CellFlags) =>
  `${f.flipH ? "H" : "-"}${f.flipV ? "V" : "-"}${f.flipD ? "D" : "-"}`;

function sortedPts(pts: ReadonlyArray<[number, number]>): string {
  return pts
    .map(([x, y]) => `${x},${y}`)
    .sort()
    .join(" ");
}

// ------------------------------------------------------------ collision ----

test("preset polygons for a 16x16 and a non-square tile", () => {
  assert.deepEqual(presetToPolygon("full", 16, 16), [
    [0, 0],
    [16, 0],
    [16, 16],
    [0, 16],
  ]);
  assert.deepEqual(presetToPolygon("halfTop", 16, 16), [
    [0, 0],
    [16, 0],
    [16, 8],
    [0, 8],
  ]);
  assert.deepEqual(presetToPolygon("halfBottom", 16, 16), [
    [0, 8],
    [16, 8],
    [16, 16],
    [0, 16],
  ]);
  assert.deepEqual(presetToPolygon("slopeR", 16, 16), [
    [16, 0],
    [16, 16],
    [0, 16],
  ]);
  assert.deepEqual(presetToPolygon("slopeL", 16, 16), [
    [0, 0],
    [16, 16],
    [0, 16],
  ]);
  assert.deepEqual(presetToPolygon("full", 16, 8), [
    [0, 0],
    [16, 0],
    [16, 8],
    [0, 8],
  ]);
  // every preset stays inside the tile
  const all: CollisionPreset[] = [
    "full",
    "halfTop",
    "halfBottom",
    "slopeL",
    "slopeR",
    "slopeL2a",
    "slopeL2b",
    "slopeR2a",
    "slopeR2b",
  ];
  for (const p of all) {
    for (const [x, y] of presetToPolygon(p, 16, 8)) {
      assert.ok(x >= 0 && x <= 16 && y >= 0 && y <= 8, p);
    }
  }
});

test("transformShape: rect matches the pixel renderer for every flag combo", () => {
  const size = 8;
  const rect: CollisionShape = { kind: "rect", x: 1, y: 0, w: 3, h: 2 };
  const src = new PixelBuffer(size, size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (pointInPolygon(x + 0.5, y + 0.5, shapeToPolygon(rect, size, size))) {
        src.setPixel(x, y, 255, 0, 0, 255);
      }
    }
  }
  for (const flags of ALL_FLAGS) {
    const dst = new Uint8ClampedArray(size * size * 4);
    blitTileTransformed(dst, size, size, src, 0, 0, flags, 1, "Normal");
    const t = transformShape(rect, flags, size, size);
    assert.equal(t.kind, "rect", label(flags));
    const poly = shapeToPolygon(t, size, size);
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const filled = dst[(y * size + x) * 4 + 3] > 0;
        assert.equal(
          pointInPolygon(x + 0.5, y + 0.5, poly),
          filled,
          `${label(flags)} (${x},${y})`
        );
      }
    }
  }
});

test("transformShape: asymmetric polygon matches the renderer for every flag combo", () => {
  const size = 8;
  // L-shaped polygon, axis aligned so pixel centres are never on an edge.
  const poly: CollisionShape = {
    kind: "polygon",
    points: [
      [0, 0],
      [5, 0],
      [5, 2],
      [2, 2],
      [2, 7],
      [0, 7],
    ],
  };
  const src = new PixelBuffer(size, size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (pointInPolygon(x + 0.5, y + 0.5, shapeToPolygon(poly, size, size))) {
        src.setPixel(x, y, 0, 255, 0, 255);
      }
    }
  }
  for (const flags of ALL_FLAGS) {
    const dst = new Uint8ClampedArray(size * size * 4);
    blitTileTransformed(dst, size, size, src, 0, 0, flags, 1, "Normal");
    const t = shapeToPolygon(transformShape(poly, flags, size, size), size, size);
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        assert.equal(
          pointInPolygon(x + 0.5, y + 0.5, t),
          dst[(y * size + x) * 4 + 3] > 0,
          `${label(flags)} (${x},${y})`
        );
      }
    }
  }
});

test("transformShape: slope presets map to the expected vertices and keep winding", () => {
  const w = 16;
  const slopeR = presetToPolygon("slopeR", w, w);
  const none = { flipH: false, flipV: false, flipD: false };
  const baseArea = polygonArea(slopeR);
  for (const flags of ALL_FLAGS) {
    const t = transformShape({ kind: "preset", preset: "slopeR" }, flags, w, w);
    assert.equal(t.kind, "polygon");
    const pts = shapeToPolygon(t, w, w);
    assert.equal(pts.length, 3, label(flags));
    assert.equal(Math.sign(polygonArea(pts)), Math.sign(baseArea), label(flags));
    assert.equal(Math.abs(polygonArea(pts)), Math.abs(baseArea));
  }
  const h = shapeToPolygon(
    transformShape({ kind: "preset", preset: "slopeR" }, { ...none, flipH: true }, w, w),
    w,
    w
  );
  assert.equal(sortedPts(h), sortedPts(presetToPolygon("slopeL", w, w)));
  const v = shapeToPolygon(
    transformShape({ kind: "preset", preset: "slopeR" }, { ...none, flipV: true }, w, w),
    w,
    w
  );
  assert.equal(sortedPts(v), sortedPts([[16, 16], [16, 0], [0, 0]]));
  // transpose of a slope with the diagonal on the anti-diagonal is itself
  const d = shapeToPolygon(
    transformShape({ kind: "preset", preset: "slopeR" }, { ...none, flipD: true }, w, w),
    w,
    w
  );
  assert.equal(sortedPts(d), sortedPts(slopeR));
  // 90 degree rotation CW (flipD + flipH... = rotateCellCW of identity) of halfTop
  const rot = shapeToPolygon(
    transformShape({ kind: "preset", preset: "halfTop" }, { flipH: false, flipV: true, flipD: true }, w, w),
    w,
    w
  );
  assert.equal(rot.length, 4);
});

test("transformShape ignores the transpose flag on non-square tiles like the renderer", () => {
  const rect: CollisionShape = { kind: "rect", x: 0, y: 0, w: 8, h: 4 };
  const t = transformShape(rect, { flipH: false, flipV: false, flipD: true }, 16, 8);
  assert.deepEqual(t, rect);
});

test("collisionPolygons returns transformed polygons and getCollisionPreset reads presets", () => {
  const shapes: CollisionShape[] = [{ kind: "preset", preset: "halfTop" }];
  const flat = collisionPolygons(shapes, { flipH: false, flipV: true, flipD: false }, 16, 16);
  assert.equal(flat.length, 1);
  assert.equal(sortedPts(flat[0]), sortedPts(presetToPolygon("halfBottom", 16, 16)));
  assert.equal(getCollisionPreset(shapes), "halfTop");
  assert.equal(getCollisionPreset(undefined), null);
  assert.equal(getCollisionPreset([{ kind: "rect", x: 0, y: 0, w: 1, h: 1 }]), null);
  assert.deepEqual(collisionPolygons(undefined, ALL_FLAGS[0], 16, 16), []);
});

test("collision metadata persists through the tileset ext snapshot", () => {
  const engine = new PixelEngine(32, 32);
  const ts = engine.tilesetRegistry.get(0)!;
  ts.setMeta(1, { collision: [{ kind: "preset", preset: "slopeR" }], oneWay: true });
  const ext = JSON.parse(JSON.stringify(engine.tilesetRegistry.toExtSnapshot()));
  const engine2 = new PixelEngine(32, 32);
  engine2.tilesetRegistry.get(0)!.seedStarterTiles();
  engine2.tilesetRegistry.applyExtSnapshot(ext);
  const meta = engine2.tilesetRegistry.get(0)!.getMeta(1)!;
  assert.deepEqual(meta.collision, [{ kind: "preset", preset: "slopeR" }]);
  assert.equal(meta.oneWay, true);
  // an old file without collision keeps loading
  const legacy = new PixelEngine(32, 32);
  assert.equal(legacy.tilesetRegistry.get(0)!.getMeta(1)?.collision, undefined);
});

// -------------------------------------------------------------- objects ----

function sampleObjects(): TileObject[] {
  const list: TileObject[] = [];
  const area = createRectObject(list, 16, 16, 32, 32);
  list.push(area);
  const spawn = createPointObject(list, 24, 24);
  spawn.name = "Spawn";
  spawn.type = "player_start";
  spawn.properties = { hp: 3, boss: false, label: "hi" };
  list.push(spawn);
  return list;
}

test("object hit-testing: points win over rects, topmost first, misses return null", () => {
  const list = sampleObjects();
  const [area, spawn] = list;
  assert.equal(hitTestObjects(list, 24, 24)?.id, spawn.id, "point inside rect");
  assert.equal(hitTestObjects(list, 26, 24)?.id, spawn.id, "within radius");
  assert.equal(hitTestObjects(list, 40, 40)?.id, area.id, "inside rect only");
  assert.equal(hitTestObjects(list, 48, 48), null, "rect edge is exclusive");
  assert.equal(hitTestObjects(list, 15, 20), null);
  assert.equal(hitTestObjects(list, 16, 16)?.id, area.id, "rect edge is inclusive at origin");
  const dupe = createRectObject(list, 16, 16, 32, 32);
  assert.equal(hitTestObjects([area, dupe], 40, 40)?.id, dupe.id, "later = on top");
});

test("object creation helpers: snapping, drag detection and rects", () => {
  assert.equal(snapToGrid(7, 16), 0);
  assert.equal(snapToGrid(8, 16), 16);
  assert.equal(snapToGrid(23, 16), 16);
  const snap = { tileW: 16, tileH: 16 };
  assert.equal(isRectDrag(3, 3, 10, 10, snap), false, "same cell = click");
  assert.equal(isRectDrag(3, 3, 17, 3, snap), true);
  assert.equal(isRectDrag(3, 3, 4, 3, null), false);
  assert.equal(isRectDrag(3, 3, 5, 3, null), true);
  assert.deepEqual(rectFromDrag(3, 3, 20, 5, snap), { x: 0, y: 0, w: 32, h: 16 });
  assert.deepEqual(rectFromDrag(40, 20, 17, 2, snap), { x: 16, y: 0, w: 32, h: 32 });
  assert.deepEqual(rectFromDrag(3, 3, 9, 7, null), { x: 3, y: 3, w: 6, h: 4 });
  assert.equal(createPointObject([], 1, 2).w, undefined);
  assert.equal(createPointObject([], 1, 2).name, "Point 1");
  assert.equal(createRectObject([], 0, 0, 4, 4).name, "Rect 1");
  assert.equal(parsePropertyValue("12"), 12);
  assert.equal(parsePropertyValue("true"), true);
  assert.equal(parsePropertyValue("1.5"), 1.5);
  assert.equal(parsePropertyValue("abc"), "abc");
});

test("object layers: pure (de)serializer round-trip and tolerant parsing", () => {
  const map = new Map([["object-1", sampleObjects()]]);
  const json = JSON.parse(JSON.stringify(serializeObjectLayers(map)));
  const back = deserializeObjectLayers(json);
  assert.deepEqual(back.get("object-1"), map.get("object-1"));
  const messy = deserializeObjectLayers({
    a: [{ x: 1 }, { x: 1, y: 2, w: 5 }, "junk", { x: "1", y: 2 }, { x: 4, y: 5, properties: { k: { nested: 1 }, ok: 1 } }],
    b: "nope",
  });
  assert.deepEqual(messy.get("a")?.length, 2);
  assert.equal(messy.get("a")?.[0].w, undefined, "w without h is a point");
  assert.deepEqual(messy.get("a")?.[1].properties, { ok: 1 });
  assert.equal(messy.has("b"), false);
  assert.equal(deserializeObjectLayers(undefined).size, 0);
});

test("object layer round-trips through serializeProjectTransfer / hydrateProjectTransfer", () => {
  const store = useEditorStore.getState();
  store.addObjectLayer();
  const layerId = useEditorStore.getState().activeLayerId;
  assert.equal(
    useEditorStore.getState().layers.find((l) => l.id === layerId)?.kind,
    "object"
  );
  const objects = sampleObjects();
  pixelEngine.objectLayers.set(layerId, objects);
  // objects of a layer that no longer exists are dropped on save
  pixelEngine.objectLayers.set("ghost-layer", sampleObjects());

  const transfer = serializeProjectTransfer({ commitFloating: false });
  const layer = transfer.document.layers.find((l) => l.id === layerId);
  assert.equal(layer?.kind, "object");
  assert.deepEqual(layer?.cels, []);
  assert.deepEqual(Object.keys(transfer.document.tiles_ext?.objectLayers ?? {}), [layerId]);

  const wire = JSON.parse(JSON.stringify(transfer));
  const checked = validateProjectTransfer(wire);
  assert.equal(checked.ok, true);
  pixelEngine.objectLayers = new Map();
  hydrateProjectTransfer(wire, null);
  assert.deepEqual(pixelEngine.getObjects(layerId), objects);
  assert.equal(
    useEditorStore.getState().layers.find((l) => l.id === layerId)?.kind,
    "object"
  );
  assert.equal(pixelEngine.objectLayers.has("ghost-layer"), false);

  // a file saved before object layers existed loads with no objects
  const legacy = JSON.parse(JSON.stringify(transfer));
  delete legacy.document.tiles_ext.objectLayers;
  legacy.document.layers = legacy.document.layers.filter(
    (l: { kind: string }) => l.kind !== "object"
  );
  hydrateProjectTransfer(legacy, null);
  assert.equal(pixelEngine.objectLayers.size, 0);
});

test("object edits go through tilemapHistory undo/redo", () => {
  const engine = new PixelEngine(32, 32);
  const [a, b] = sampleObjects();
  engine.recordObjectOp("Add Object", () => engine.objectLayers.set("l1", [a]));
  engine.recordObjectOp("Add Object", () => engine.objectLayers.set("l1", [a, b]));
  assert.equal(engine.getObjects("l1").length, 2);
  assert.equal(engine.undoCoordinator.peekUndo(), "tileset");
  engine.undoCoordinator.popUndo();
  assert.equal(engine.tilemapHistory.undo(engine)?.label, "Add Object");
  assert.equal(engine.getObjects("l1").length, 1);
  engine.undoCoordinator.popUndo();
  engine.tilemapHistory.undo(engine);
  assert.equal(engine.getObjects("l1").length, 0);
  engine.undoCoordinator.popRedo();
  engine.tilemapHistory.redo(engine);
  assert.deepEqual(engine.getObjects("l1"), [a]);
  // a no-op edit records nothing
  const before = engine.tilemapHistory.canUndo;
  engine.recordObjectOp("Nothing", () => undefined);
  assert.equal(engine.tilemapHistory.canUndo, before);
  // resetting for a new document clears objects
  engine.resetForDocument(16, 16);
  assert.equal(engine.objectLayers.size, 0);
});

// ---------------------------------------------------------- godot export ----

test("godotAlternative maps flip flags onto Godot's transform bits", () => {
  assert.equal(GODOT_FLIP_H, 4096);
  assert.equal(GODOT_FLIP_V, 8192);
  assert.equal(GODOT_TRANSPOSE, 16384);
  assert.equal(godotAlternative({ flipH: false, flipV: false, flipD: false }), 0);
  assert.equal(godotAlternative({ flipH: true, flipV: false, flipD: false }), 4096);
  assert.equal(godotAlternative({ flipH: false, flipV: true, flipD: false }), 8192);
  assert.equal(godotAlternative({ flipH: false, flipV: false, flipD: true }), 16384);
  assert.equal(godotAlternative({ flipH: true, flipV: true, flipD: true }), 28672);
});

test("tile_map_data byte layout for a 3x3 map", () => {
  const cells = [
    { x: 0, y: 0, sourceId: 0, atlasX: 0, atlasY: 0, alternative: 0 },
    { x: 2, y: 1, sourceId: 1, atlasX: 3, atlasY: 2, alternative: 4096 },
    { x: -1, y: 2, sourceId: 0, atlasX: 1, atlasY: 0, alternative: 28672 },
  ];
  const bytes = encodeTileMapData(cells);
  assert.equal(bytes.length, 2 + 3 * 12);
  assert.deepEqual(Array.from(bytes.slice(0, 2)), [0, 0], "format header");
  assert.deepEqual(
    Array.from(bytes.slice(2, 14)),
    [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]
  );
  // x=2,y=1,source=1,atlas=(3,2),alt=4096 (0x1000) little-endian
  assert.deepEqual(
    Array.from(bytes.slice(14, 26)),
    [2, 0, 1, 0, 1, 0, 3, 0, 2, 0, 0x00, 0x10]
  );
  // x=-1 is int16 0xFFFF; alt 28672 = 0x7000
  assert.deepEqual(
    Array.from(bytes.slice(26, 38)),
    [0xff, 0xff, 2, 0, 0, 0, 1, 0, 0, 0, 0x00, 0x70]
  );

  // Full 3x3 map through the scene generator: 9 painted cells.
  const scene = generateGodotScene({
    rootName: "Level",
    tileSetFile: "level_tileset.tres",
    sources: [{ sourceId: 0, cols: 2, tileCount: 3 }],
    layers: [
      {
        kind: "tilemap",
        name: "Ground",
        visible: true,
        opacity: 1,
        cols: 3,
        rows: 3,
        cells: [1, 2, 3, 1, 2, 3, packCell(0, 3, { flipH: true }), 0, packCell(0, 2)],
      },
    ],
  });
  const m = /tile_map_data = PackedByteArray\(([^)]*)\)/.exec(scene);
  assert.ok(m, scene);
  const arr = m[1].split(", ").map(Number);
  assert.equal(arr.length, 2 + 8 * 12, "8 non-empty cells");
  // third tile (local id 3) -> atlas index 2 -> (0,1) on a 2-column atlas
  const cell3 = arr.slice(2 + 2 * 12, 2 + 3 * 12);
  assert.deepEqual(cell3, [2, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0]);
  // flipped cell at (0,2): local id 3, FLIP_H = 4096
  const flipped = arr.slice(2 + 6 * 12, 2 + 7 * 12);
  assert.deepEqual(flipped, [0, 0, 2, 0, 0, 0, 0, 0, 1, 0, 0x00, 0x10]);
});

const GOLDEN_TILESET =
  '[gd_resource type="TileSet" load_steps=3 format=3]\n\n' +
  '[ext_resource type="Texture2D" path="res://terrain_tileset.png" id="1_tex"]\n\n' +
  '[sub_resource type="TileSetAtlasSource" id="TileSetAtlasSource_1"]\n' +
  'texture = ExtResource("1_tex")\n' +
  "texture_region_size = Vector2i(8, 8)\n" +
  "0:0/0 = 0\n" +
  "1:0/0 = 0\n\n" +
  "[resource]\n" +
  "tile_size = Vector2i(8, 8)\n" +
  'sources/0 = SubResource("TileSetAtlasSource_1")\n';

test("TileSet .tres matches the Rust generator byte-for-byte (no collision)", () => {
  const out = generateGodotTileSet({
    isometric: false,
    sources: [
      {
        sourceId: 0,
        pngFile: "terrain_tileset.png",
        tileWidth: 8,
        tileHeight: 8,
        tileCount: 2,
        cols: 2,
        extrude: 0,
        padding: 0,
        tiles: [],
      },
    ],
  });
  assert.equal(out, GOLDEN_TILESET);
});

test("TileSet .tres adds physics layer, centred polygons and one_way", () => {
  const out = generateGodotTileSet({
    isometric: false,
    sources: [
      {
        sourceId: 0,
        pngFile: "t.png",
        tileWidth: 16,
        tileHeight: 16,
        tileCount: 2,
        cols: 2,
        extrude: 0,
        padding: 0,
        tiles: [
          { collision: [presetToPolygon("full", 16, 16)], oneWay: false },
          { collision: [presetToPolygon("halfTop", 16, 16)], oneWay: true },
        ],
      },
    ],
  });
  assert.match(out, /physics_layer_0\/collision_layer = 1/);
  assert.match(
    out,
    /0:0\/0\/physics_layer_0\/polygon_0\/points = PackedVector2Array\(-8, -8, 8, -8, 8, 8, -8, 8\)/
  );
  assert.doesNotMatch(out, /0:0\/0\/physics_layer_0\/polygon_0\/one_way/);
  assert.match(
    out,
    /1:0\/0\/physics_layer_0\/polygon_0\/points = PackedVector2Array\(-8, -8, 8, -8, 8, 0, -8, 0\)/
  );
  assert.match(out, /1:0\/0\/physics_layer_0\/polygon_0\/one_way = true/);
  // physics layer comes before sources, inside [resource]
  assert.ok(out.indexOf("physics_layer_0/collision_layer") < out.indexOf("sources/0"));
});

test("atlas builder mirrors the Rust layout (square-ish grid, extrude)", () => {
  const red = new Uint8ClampedArray(4 * 4 * 4);
  for (let i = 0; i < red.length; i += 4) {
    red[i] = 255;
    red[i + 3] = 255;
  }
  const atlas = buildTileAtlas([red, red, red], 4, 4, 0, 0);
  assert.equal(atlas.cols, 2);
  assert.equal(atlas.rows, 2);
  assert.equal(atlas.width, 8);
  assert.equal(atlas.rgba[(0 * 8 + 4) * 4], 255, "tile 1 at (4,0)");
  assert.equal(atlas.rgba[(4 * 8 + 4) * 4 + 3], 0, "slot 4 is empty");
  const ex = buildTileAtlas([red], 4, 4, 1, 1);
  assert.equal(ex.width, 6);
  assert.equal(ex.rgba[0 * 4 + 3], 255, "corner extrusion");
});

function buildEngineWithMap(): { engine: PixelEngine; layers: ReturnType<typeof useEditorStore.getState>["layers"] } {
  const engine = new PixelEngine(48, 48);
  const ts = engine.tilesetRegistry.get(0)!;
  ts.seedStarterTiles(); // 3 tiles, 16x16
  ts.setMeta(1, { collision: [{ kind: "preset", preset: "full" }] });
  ts.setMeta(2, { collision: [{ kind: "preset", preset: "slopeR" }], oneWay: true });
  const tm = engine.getOrCreateTilemap("tm-1", 0);
  tm.setCell(0, 0, packCell(0, 1));
  tm.setCell(1, 0, packCell(0, 2));
  tm.setCell(2, 0, packCell(0, 3, { flipH: true, flipD: true }));
  tm.setCell(0, 2, packCell(0, 1));
  engine.objectLayers.set("obj-1", [
    { id: "p", name: "Spawn", type: "player_start", x: 16, y: 32, properties: { hp: 3, boss: false, tag: 'say "hi"' } },
    { id: "r", name: "Door", type: "door", x: 32, y: 0, w: 16, h: 32, properties: { locked: true } },
    { id: "r2", name: "Door", type: "", x: 0, y: 0, w: 16, h: 32, properties: {} },
  ]);
  const base = { visible: true, locked: false, opacity: 100, alphaLock: false, blendMode: "Normal" as const, parentId: null, cels: {} };
  const layers = [
    { ...base, id: "obj-1", name: "Objects", kind: "object" as const },
    { ...base, id: "tm-1", name: "Ground", kind: "tilemap" as const },
  ];
  return { engine, layers };
}

test(".tscn contains TileMapLayer, Marker2D and Area2D + RectangleShape2D with metadata", () => {
  const { engine, layers } = buildEngineWithMap();
  const files = collectGodotTilemapFiles(engine, layers, {
    name: "level",
    format: "godot",
    layerIds: ["tm-1", "obj-1"],
    frameIndex: 0,
  });
  assert.equal(files.sceneName, "level.tscn");
  assert.equal(files.tileSetName, "level_tileset.tres");
  assert.equal(files.atlases.length, 1);
  assert.equal(files.atlases[0].name, "level_tileset.png");
  const s = files.sceneText;
  assert.match(s, /^\[gd_scene load_steps=3 format=3\]/);
  assert.match(s, /\[ext_resource type="TileSet" path="res:\/\/level_tileset.tres" id="1_tileset"\]/);
  assert.match(s, /\[sub_resource type="RectangleShape2D" id="RectangleShape2D_1"\]\nsize = Vector2\(16, 32\)/);
  assert.match(s, /\[node name="level" type="Node2D"\]/);
  assert.match(s, /\[node name="Ground" type="TileMapLayer" parent="\."\]/);
  assert.match(s, /tile_set = ExtResource\("1_tileset"\)/);
  assert.match(s, /\[node name="Objects" type="Node2D" parent="\."\]/);
  assert.match(s, /\[node name="Spawn" type="Marker2D" parent="Objects"\]\nposition = Vector2\(16, 32\)\nmetadata\/type = "player_start"\nmetadata\/hp = 3\nmetadata\/boss = false\nmetadata\/tag = "say \\"hi\\""/);
  assert.match(s, /\[node name="Door" type="Area2D" parent="Objects"\]\nposition = Vector2\(32, 0\)\nmetadata\/type = "door"\nmetadata\/locked = true/);
  assert.match(s, /\[node name="CollisionShape2D" type="CollisionShape2D" parent="Objects\/Door"\]\nposition = Vector2\(8, 16\)\nshape = SubResource\("RectangleShape2D_1"\)/);
  // duplicate object names are made unique, and the same size shares one shape
  assert.match(s, /\[node name="Door_2" type="Area2D" parent="Objects"\]/);
  assert.match(s, /parent="Objects\/Door_2"/);
  assert.equal((s.match(/\[sub_resource/g) ?? []).length, 1);
  // ground (bottom) is written before objects (top)
  assert.ok(s.indexOf('name="Ground"') < s.indexOf('name="Objects"'));
  // the TileSet references collision for tiles 1 and 2 with one-way on tile 2
  assert.match(files.tileSetText, /0:0\/0\/physics_layer_0\/polygon_0\/points = PackedVector2Array\(-8, -8, 8, -8, 8, 8, -8, 8\)/);
  assert.match(files.tileSetText, /1:0\/0\/physics_layer_0\/polygon_0\/one_way = true/);
  assert.doesNotMatch(files.tileSetText, /0:0\/0\/physics_layer_0\/polygon_0\/one_way/);
  // 4 painted cells: header + 4*12
  const m = /tile_map_data = PackedByteArray\(([^)]*)\)/.exec(s);
  assert.equal(m![1].split(", ").length, 2 + 4 * 12);
  // layer selection: leaving the object layer out drops its nodes
  const noObjects = collectGodotTilemapFiles(engine, layers, {
    name: "level",
    format: "godot",
    layerIds: ["tm-1"],
    frameIndex: 0,
  });
  assert.doesNotMatch(noObjects.sceneText, /Marker2D|Area2D/);
});

test("Map as PNG flattens visible selected tilemap layers at 1x and skips objects", () => {
  const { engine, layers } = buildEngineWithMap();
  const img = renderTilemapPng(engine, layers, {
    name: "level",
    format: "png",
    layerIds: ["tm-1", "obj-1"],
    frameIndex: 0,
  });
  assert.ok(img);
  assert.equal(img.name, "level_map.png");
  assert.equal(img.width, 48);
  assert.equal(img.height, 48);
  const alphaAt = (x: number, y: number) => img.rgba[(y * img.width + x) * 4 + 3];
  assert.equal(alphaAt(2, 2), 255, "tile (0,0)");
  assert.equal(alphaAt(20, 1), 255, "tile (1,0)");
  assert.equal(alphaAt(20, 20), 0, "empty cell");
  assert.equal(alphaAt(2, 34), 255, "tile (0,2)");
  const hidden = renderTilemapPng(
    engine,
    layers.map((l) => (l.id === "tm-1" ? { ...l, visible: false } : l)),
    { name: "level", format: "png", layerIds: ["tm-1"], frameIndex: 0 }
  );
  assert.equal(hidden, null);
});

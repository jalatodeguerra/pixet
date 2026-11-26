// Godot 4 tilemap export (pure, React-free): TileSet .tres with physics,
// TileMapLayer .tscn scene, object layers as Marker2D / Area2D nodes.
//
// The TileSet generator is a TypeScript port of `generate_godot_tileset` in
// crates/pixet-core/src/export.rs. For a project without collision shapes the
// output is byte-identical (see tests/tilesCollisionObjects.test.ts and the
// matching golden test in export.rs). Physics layer 0 is the TS-only addition.
//
// ---------------------------------------------------------------------------
// Assumptions about Godot 4.3+ formats (written from knowledge of the engine
// source/docs, NOT verified against a running editor in this PR):
//
// 1. TileMapLayer.tile_map_data is a PackedByteArray:
//      uint16  format header (0)
//      per cell, 12 bytes, all little-endian:
//        int16  cell x
//        int16  cell y
//        uint16 source_id
//        uint16 atlas_coords.x
//        uint16 atlas_coords.y
//        uint16 alternative_tile
//    The header is 0 in files written by Godot 4.3. The file is emitted as a
//    decimal `PackedByteArray(0, 0, ...)` literal, which Godot parses the same
//    as its base64 string form.
// 2. Flips/rotation use Godot's per-cell transform flags OR-ed into the
//    alternative tile id (documented on TileSetAtlasSource.TRANSFORM_*):
//      FLIP_H = 4096, FLIP_V = 8192, TRANSPOSE = 16384
//    so no alternative tiles need to exist in the TileSet. Pixet's cell
//    convention (flip applied after the diagonal transpose) is the same as
//    Tiled's GID flags, which map 1:1 onto these Godot flags.
// 3. TileSet physics polygons are stored relative to the tile centre, and
//    `polygon_N/one_way = true` marks a one-way platform.
// 4. Isometric projections only emit `tile_shape = 1` (as the Rust generator
//    does); cell coordinates are written as plain (col,row).
// ---------------------------------------------------------------------------

import type { CellFlags } from "../tiles/cell.ts";
import type { TileObject } from "../tiles/objects.ts";
import { isRectObject } from "../tiles/objects.ts";
import type { Point } from "../tiles/collision.ts";

export const GODOT_FLIP_H = 4096;
export const GODOT_FLIP_V = 8192;
export const GODOT_TRANSPOSE = 16384;

/** Godot `alternative_tile` value for a Pixet cell's flip flags. */
export function godotAlternative(flags: CellFlags): number {
  return (
    (flags.flipH ? GODOT_FLIP_H : 0) |
    (flags.flipV ? GODOT_FLIP_V : 0) |
    (flags.flipD ? GODOT_TRANSPOSE : 0)
  );
}

// ---------------------------------------------------------------- atlas ----

export interface TileAtlas {
  width: number;
  height: number;
  cols: number;
  rows: number;
  tileWidth: number;
  tileHeight: number;
  tileCount: number;
  extrude: number;
  padding: number;
  rgba: Uint8ClampedArray;
}

/** Port of `build_tileset_atlas` (square-ish grid, optional extrude). */
export function buildTileAtlas(
  tiles: ReadonlyArray<Uint8ClampedArray>,
  tileWidth: number,
  tileHeight: number,
  padding = 0,
  extrude = 0
): TileAtlas {
  const n = tiles.length;
  const cols = Math.max(1, Math.ceil(Math.sqrt(n)));
  const rows = Math.max(1, Math.ceil(n / cols));
  const cellW = tileWidth + 2 * extrude;
  const cellH = tileHeight + 2 * extrude;
  const width = cols * cellW + Math.max(0, cols - 1) * padding;
  const height = rows * cellH + Math.max(0, rows - 1) * padding;
  const rgba = new Uint8ClampedArray(width * height * 4);

  const put = (x: number, y: number, src: Uint8ClampedArray, si: number) => {
    const di = (y * width + x) * 4;
    rgba[di] = src[si];
    rgba[di + 1] = src[si + 1];
    rgba[di + 2] = src[si + 2];
    rgba[di + 3] = src[si + 3];
  };

  tiles.forEach((tile, i) => {
    if (tile.length !== tileWidth * tileHeight * 4) return;
    const dx = (i % cols) * (cellW + padding) + extrude;
    const dy = Math.floor(i / cols) * (cellH + padding) + extrude;
    for (let sy = 0; sy < tileHeight; sy++) {
      for (let sx = 0; sx < tileWidth; sx++) {
        put(dx + sx, dy + sy, tile, (sy * tileWidth + sx) * 4);
      }
    }
    const px = (sx: number, sy: number) => (sy * tileWidth + sx) * 4;
    for (let e = 1; e <= extrude; e++) {
      for (let sx = 0; sx < tileWidth; sx++) {
        put(dx + sx, dy - e, tile, px(sx, 0));
        put(dx + sx, dy + tileHeight - 1 + e, tile, px(sx, tileHeight - 1));
      }
      for (let sy = 0; sy < tileHeight; sy++) {
        put(dx - e, dy + sy, tile, px(0, sy));
        put(dx + tileWidth - 1 + e, dy + sy, tile, px(tileWidth - 1, sy));
      }
    }
    for (let ey = 1; ey <= extrude; ey++) {
      for (let ex = 1; ex <= extrude; ex++) {
        put(dx - ex, dy - ey, tile, px(0, 0));
        put(dx + tileWidth - 1 + ex, dy - ey, tile, px(tileWidth - 1, 0));
        put(dx - ex, dy + tileHeight - 1 + ey, tile, px(0, tileHeight - 1));
        put(dx + tileWidth - 1 + ex, dy + tileHeight - 1 + ey, tile, px(tileWidth - 1, tileHeight - 1));
      }
    }
  });

  return {
    width,
    height,
    cols,
    rows,
    tileWidth,
    tileHeight,
    tileCount: n,
    extrude,
    padding,
    rgba,
  };
}

// --------------------------------------------------------------- tileset ----

export interface GodotTileInfo {
  /** Collision polygons in tile-local pixels (top-left origin), unflipped. */
  collision: Point[][];
  oneWay: boolean;
}

export interface GodotTileSource {
  /** Godot source id; equals the Pixet tileset index. */
  sourceId: number;
  pngFile: string;
  tileWidth: number;
  tileHeight: number;
  tileCount: number;
  cols: number;
  extrude: number;
  padding: number;
  /** One entry per tile (local id 1..tileCount). May be shorter / empty. */
  tiles: ReadonlyArray<GodotTileInfo | undefined>;
}

export interface GodotTileSetInput {
  sources: ReadonlyArray<GodotTileSource>;
  isometric: boolean;
}

/** Godot-style number: integers bare, floats trimmed. */
export function fmtNum(v: number): string {
  if (Number.isInteger(v)) return String(v);
  return String(Number(v.toFixed(4)));
}

function packedVector2Array(points: ReadonlyArray<Point>, w: number, h: number): string {
  const hw = w / 2;
  const hh = h / 2;
  const flat: string[] = [];
  for (const [x, y] of points) {
    flat.push(fmtNum(x - hw), fmtNum(y - hh));
  }
  return `PackedVector2Array(${flat.join(", ")})`;
}

export function generateGodotTileSet(input: GodotTileSetInput): string {
  const { sources, isometric } = input;
  const subCount = sources.length;
  const loadSteps = 2 * subCount + 1;
  let out = `[gd_resource type="TileSet" load_steps=${loadSteps} format=3]\n\n`;
  sources.forEach((src, i) => {
    out += `[ext_resource type="Texture2D" path="res://${src.pngFile}" id="${i + 1}_tex"]\n`;
  });
  out += "\n";

  let anyPhysics = false;
  sources.forEach((src, i) => {
    out += `[sub_resource type="TileSetAtlasSource" id="TileSetAtlasSource_${i + 1}"]\n`;
    out += `texture = ExtResource("${i + 1}_tex")\n`;
    if (src.extrude > 0) {
      out += `margins = Vector2i(${src.extrude}, ${src.extrude})\n`;
    }
    const sep = src.padding + 2 * src.extrude;
    if (sep > 0) out += `separation = Vector2i(${sep}, ${sep})\n`;
    out += `texture_region_size = Vector2i(${src.tileWidth}, ${src.tileHeight})\n`;
    for (let t = 0; t < src.tileCount; t++) {
      const col = t % src.cols;
      const row = Math.floor(t / src.cols);
      out += `${col}:${row}/0 = 0\n`;
      const info = src.tiles[t];
      if (info && info.collision.length > 0) {
        anyPhysics = true;
        info.collision.forEach((poly, p) => {
          out += `${col}:${row}/0/physics_layer_0/polygon_${p}/points = ${packedVector2Array(poly, src.tileWidth, src.tileHeight)}\n`;
          if (info.oneWay) {
            out += `${col}:${row}/0/physics_layer_0/polygon_${p}/one_way = true\n`;
          }
        });
      }
    }
    out += "\n";
  });

  out += "[resource]\n";
  const first = sources[0];
  const baseW = first?.tileWidth ?? 16;
  const baseH = first?.tileHeight ?? 16;
  let effectiveH = baseH;
  if (isometric) {
    out += "tile_shape = 1\n";
    effectiveH = Math.max(4, Math.floor(baseW / 2));
  }
  out += `tile_size = Vector2i(${baseW}, ${effectiveH})\n`;
  if (anyPhysics) out += "physics_layer_0/collision_layer = 1\n";
  sources.forEach((src, i) => {
    out += `sources/${src.sourceId} = SubResource("TileSetAtlasSource_${i + 1}")\n`;
  });
  return out;
}

// ----------------------------------------------------------- tile_map_data --

export interface GodotCell {
  x: number;
  y: number;
  sourceId: number;
  atlasX: number;
  atlasY: number;
  alternative: number;
}

/** Encode cells as TileMapLayer.tile_map_data (see header comment). */
export function encodeTileMapData(cells: ReadonlyArray<GodotCell>): Uint8Array {
  const bytes = new Uint8Array(2 + cells.length * 12);
  const view = new DataView(bytes.buffer);
  view.setUint16(0, 0, true);
  let o = 2;
  for (const c of cells) {
    view.setInt16(o, c.x, true);
    view.setInt16(o + 2, c.y, true);
    view.setUint16(o + 4, c.sourceId, true);
    view.setUint16(o + 6, c.atlasX, true);
    view.setUint16(o + 8, c.atlasY, true);
    view.setUint16(o + 10, c.alternative, true);
    o += 12;
  }
  return bytes;
}

export function packedByteArrayLiteral(bytes: Uint8Array): string {
  return `PackedByteArray(${Array.from(bytes).join(", ")})`;
}

// ------------------------------------------------------------------ scene ----

export interface GodotSourceLayout {
  sourceId: number;
  cols: number;
  tileCount: number;
}

export interface GodotTilemapLayerInput {
  kind: "tilemap";
  name: string;
  visible: boolean;
  /** 0..1 */
  opacity: number;
  cols: number;
  rows: number;
  /** Packed Pixet cells (flags | tileset << 20 | local id). */
  cells: ArrayLike<number>;
}

export interface GodotObjectLayerInput {
  kind: "object";
  name: string;
  visible: boolean;
  objects: ReadonlyArray<TileObject>;
}

export type GodotLayerInput = GodotTilemapLayerInput | GodotObjectLayerInput;

export interface GodotSceneInput {
  rootName: string;
  /** File name of the TileSet resource, e.g. "level_tileset.tres". */
  tileSetFile: string;
  sources: ReadonlyArray<GodotSourceLayout>;
  /** Bottom-most first (Godot draws later siblings on top). */
  layers: ReadonlyArray<GodotLayerInput>;
}

/** Make a unique, Godot-legal node name. */
export function sanitizeNodeName(name: string, used: Set<string>, fallback: string): string {
  let base = name.replace(/[.:@/"%\\\r\n\t]+/g, "_").trim();
  if (base === "") base = fallback;
  let candidate = base;
  let n = 2;
  while (used.has(candidate)) candidate = `${base}_${n++}`;
  used.add(candidate);
  return candidate;
}

export function gdString(s: string): string {
  return `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\r?\n/g, "\\n")}"`;
}

function sanitizeMetaKey(key: string): string {
  const k = key.replace(/[^A-Za-z0-9_]+/g, "_").replace(/^_+|_+$/g, "");
  return k === "" ? "prop" : k;
}

function metadataLines(o: TileObject): string[] {
  const lines: string[] = [];
  const seen = new Set<string>();
  const emit = (key: string, v: string | number | boolean) => {
    const k = sanitizeMetaKey(key);
    if (seen.has(k)) return;
    seen.add(k);
    const val =
      typeof v === "string" ? gdString(v) : typeof v === "number" ? fmtNum(v) : String(v);
    lines.push(`metadata/${k} = ${val}`);
  };
  if (o.type !== "") emit("type", o.type);
  for (const [k, v] of Object.entries(o.properties)) emit(k, v);
  return lines;
}

export function generateGodotScene(input: GodotSceneInput): string {
  const layoutBySource = new Map(input.sources.map((s) => [s.sourceId, s]));
  const hasTilemaps = input.layers.some((l) => l.kind === "tilemap");

  // Shared rectangle shapes (deduped by size).
  const rectShapes = new Map<string, { id: string; w: number; h: number }>();
  for (const l of input.layers) {
    if (l.kind !== "object") continue;
    for (const o of l.objects) {
      if (!isRectObject(o)) continue;
      const w = o.w as number;
      const h = o.h as number;
      const key = `${w}x${h}`;
      if (!rectShapes.has(key)) {
        rectShapes.set(key, { id: `RectangleShape2D_${rectShapes.size + 1}`, w, h });
      }
    }
  }

  const extCount = hasTilemaps ? 1 : 0;
  const loadSteps = 1 + extCount + rectShapes.size;
  let out = `[gd_scene load_steps=${loadSteps} format=3]\n\n`;
  if (hasTilemaps) {
    out += `[ext_resource type="TileSet" path="res://${input.tileSetFile}" id="1_tileset"]\n\n`;
  }
  for (const s of rectShapes.values()) {
    out += `[sub_resource type="RectangleShape2D" id="${s.id}"]\n`;
    out += `size = Vector2(${fmtNum(s.w)}, ${fmtNum(s.h)})\n\n`;
  }

  const used = new Set<string>();
  const rootName = sanitizeNodeName(input.rootName, new Set(), "Map");
  out += `[node name=${gdString(rootName)} type="Node2D"]\n`;

  for (const layer of input.layers) {
    const nodeName = sanitizeNodeName(
      layer.name,
      used,
      layer.kind === "tilemap" ? "TileMapLayer" : "Objects"
    );
    if (layer.kind === "tilemap") {
      const cells: GodotCell[] = [];
      for (let row = 0; row < layer.rows; row++) {
        for (let col = 0; col < layer.cols; col++) {
          const raw = layer.cells[row * layer.cols + col] >>> 0;
          const localId = raw & 0x000fffff;
          if (localId === 0) continue;
          const sourceId = (raw & 0x1ff00000) >>> 20;
          const src = layoutBySource.get(sourceId);
          if (!src || localId > src.tileCount) continue;
          const idx = localId - 1;
          cells.push({
            x: col,
            y: row,
            sourceId,
            atlasX: idx % src.cols,
            atlasY: Math.floor(idx / src.cols),
            alternative: godotAlternative({
              flipH: (raw & 0x80000000) !== 0,
              flipV: (raw & 0x40000000) !== 0,
              flipD: (raw & 0x20000000) !== 0,
            }),
          });
        }
      }
      out += `\n[node name=${gdString(nodeName)} type="TileMapLayer" parent="."]\n`;
      if (!layer.visible) out += "visible = false\n";
      if (layer.opacity < 1) {
        out += `modulate = Color(1, 1, 1, ${fmtNum(Math.max(0, layer.opacity))})\n`;
      }
      out += `tile_map_data = ${packedByteArrayLiteral(encodeTileMapData(cells))}\n`;
      out += `tile_set = ExtResource("1_tileset")\n`;
      continue;
    }

    out += `\n[node name=${gdString(nodeName)} type="Node2D" parent="."]\n`;
    if (!layer.visible) out += "visible = false\n";
    const childNames = new Set<string>();
    layer.objects.forEach((o, i) => {
      const name = sanitizeNodeName(o.name, childNames, `Object${i + 1}`);
      const rect = isRectObject(o);
      out += `\n[node name=${gdString(name)} type="${rect ? "Area2D" : "Marker2D"}" parent=${gdString(nodeName)}]\n`;
      out += `position = Vector2(${fmtNum(o.x)}, ${fmtNum(o.y)})\n`;
      for (const line of metadataLines(o)) out += `${line}\n`;
      if (rect) {
        const w = o.w as number;
        const h = o.h as number;
        const shape = rectShapes.get(`${w}x${h}`);
        out += `\n[node name="CollisionShape2D" type="CollisionShape2D" parent=${gdString(`${nodeName}/${name}`)}]\n`;
        out += `position = Vector2(${fmtNum(w / 2)}, ${fmtNum(h / 2)})\n`;
        out += `shape = SubResource("${shape?.id ?? ""}")\n`;
      }
    });
  }
  return out;
}

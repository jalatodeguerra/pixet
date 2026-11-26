// Tilemap export (T8): gathers the project's tile layers/objects into Godot 4
// files or a flattened PNG. Pure of DOM/Tauri; PNG encoding and delivery live
// in exportActions.ts so these functions are testable under node.

import type { PixelEngine } from "../document/PixelEngine.ts";
import type { LayerItem } from "../../store/editorStore.ts";
import { collisionPolygons } from "../tiles/collision.ts";
import { renderIsometricTilemapToBuffer } from "../tiles/isometric.ts";
import { renderTilemapToBuffer } from "../tiles/TilemapEngine.ts";
import {
  buildTileAtlas,
  generateGodotScene,
  generateGodotTileSet,
  type GodotLayerInput,
  type GodotSourceLayout,
  type GodotTileInfo,
  type GodotTileSource,
} from "./godotTilemap.ts";

export type TilemapExportFormat = "godot" | "png";

export interface TilemapExportOptions {
  name: string;
  format: TilemapExportFormat;
  /** Layer ids to include (tilemap and, for Godot, object layers). */
  layerIds: ReadonlyArray<string>;
  frameIndex: number;
}

export interface RgbaImage {
  name: string;
  width: number;
  height: number;
  rgba: Uint8ClampedArray;
}

export interface GodotTilemapFiles {
  tileSetName: string;
  tileSetText: string;
  sceneName: string;
  sceneText: string;
  atlases: RgbaImage[];
}

const NO_FLAGS = { flipH: false, flipV: false, flipD: false };

export function safeFileName(name: string, fallback: string): string {
  const cleaned = name
    .trim()
    .replace(/[\\/:*?"<>|]+/g, "_")
    .replace(/\.\.+/g, "_");
  return cleaned || fallback;
}

export function collectGodotTilemapFiles(
  engine: PixelEngine,
  layers: ReadonlyArray<LayerItem>,
  opts: TilemapExportOptions
): GodotTilemapFiles {
  const name = safeFileName(opts.name, "map");
  const wanted = new Set(opts.layerIds);
  const registry = engine.tilesetRegistry;

  const sources: GodotTileSource[] = [];
  const layouts: GodotSourceLayout[] = [];
  const atlases: RgbaImage[] = [];
  registry.tilesets.forEach((ts, index) => {
    if (ts.count === 0) return;
    const tiles: Uint8ClampedArray[] = [];
    const infos: GodotTileInfo[] = [];
    for (let id = 1; id <= ts.count; id++) {
      tiles.push(ts.tiles[id].data);
      const meta = ts.getMeta(id);
      infos.push({
        collision: collisionPolygons(
          meta?.collision,
          NO_FLAGS,
          ts.tileWidth,
          ts.tileHeight
        ),
        oneWay: meta?.oneWay === true,
      });
    }
    const atlas = buildTileAtlas(tiles, ts.tileWidth, ts.tileHeight, 0, 0);
    const pngFile =
      index === 0 ? `${name}_tileset.png` : `${name}_tileset_${index}.png`;
    atlases.push({
      name: pngFile,
      width: atlas.width,
      height: atlas.height,
      rgba: atlas.rgba,
    });
    sources.push({
      sourceId: index,
      pngFile,
      tileWidth: ts.tileWidth,
      tileHeight: ts.tileHeight,
      tileCount: ts.count,
      cols: atlas.cols,
      extrude: 0,
      padding: 0,
      tiles: infos,
    });
    layouts.push({ sourceId: index, cols: atlas.cols, tileCount: ts.count });
  });

  const tileSetName = `${name}_tileset.tres`;
  const tileSetText = generateGodotTileSet({
    sources,
    isometric: engine.tileProjection === "isometric",
  });

  // Store order is top-most first; Godot draws later siblings on top.
  const inputs: GodotLayerInput[] = [];
  for (const layer of [...layers].reverse()) {
    if (!wanted.has(layer.id)) continue;
    if (layer.kind === "tilemap") {
      const tm = engine.getTilemap(layer.id, opts.frameIndex);
      if (!tm) continue;
      inputs.push({
        kind: "tilemap",
        name: layer.name,
        visible: layer.visible,
        opacity: layer.opacity / 100,
        cols: tm.cols,
        rows: tm.rows,
        cells: tm.grid,
      });
    } else if (layer.kind === "object") {
      inputs.push({
        kind: "object",
        name: layer.name,
        visible: layer.visible,
        objects: engine.getObjects(layer.id),
      });
    }
  }

  const sceneName = `${name}.tscn`;
  const sceneText = generateGodotScene({
    rootName: name,
    tileSetFile: tileSetName,
    sources: layouts,
    layers: inputs,
  });
  return { tileSetName, tileSetText, sceneName, sceneText, atlases };
}

/** Flatten the selected visible tilemap layers at 1x. Object layers are never drawn. */
export function renderTilemapPng(
  engine: PixelEngine,
  layers: ReadonlyArray<LayerItem>,
  opts: TilemapExportOptions
): RgbaImage | null {
  const wanted = new Set(opts.layerIds);
  const selected = [...layers]
    .reverse()
    .filter((l) => l.kind === "tilemap" && l.visible && wanted.has(l.id));
  const baseTs = engine.tilesetRegistry.get(0);
  const baseW = baseTs?.tileWidth ?? 16;
  const baseH = baseTs?.tileHeight ?? 16;
  const iso = engine.tileProjection === "isometric";

  let width = iso ? engine.width : 1;
  let height = iso ? engine.height : 1;
  const maps = selected.flatMap((l) => {
    const tm = engine.getTilemap(l.id, opts.frameIndex);
    return tm ? [{ layer: l, tm }] : [];
  });
  if (maps.length === 0) return null;
  if (!iso) {
    for (const { tm } of maps) {
      width = Math.max(width, tm.cols * baseW);
      height = Math.max(height, tm.rows * baseH);
    }
  }

  const rgba = new Uint8ClampedArray(width * height * 4);
  for (const { layer, tm } of maps) {
    if (iso) {
      renderIsometricTilemapToBuffer(
        tm,
        engine.tilesetRegistry,
        rgba,
        width,
        height,
        layer.opacity / 100,
        "Normal"
      );
    } else {
      renderTilemapToBuffer(
        tm,
        engine.tilesetRegistry,
        rgba,
        width,
        height,
        layer.opacity / 100,
        "Normal"
      );
    }
  }
  return {
    name: `${safeFileName(opts.name, "map")}_map.png`,
    width,
    height,
    rgba,
  };
}

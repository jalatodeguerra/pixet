import { invoke } from "@tauri-apps/api/core";
import { open, save } from "@tauri-apps/plugin-dialog";
import {
  type BlendMode,
  type LayerItem,
  type LayerKind,
  type LayerMapRole,
  useEditorStore,
} from "../../store/editorStore.ts";
import { PixelBuffer } from "../document/PixelBuffer.ts";
import { pixelEngine } from "../document/PixelEngine.ts";
import { commitFloatingSelection } from "../document/selectionActions.ts";
import { syncTimelineCels } from "../document/timelineActions.ts";
import { resetRigHistory } from "../rig/rigActions.ts";
import {
  deserializeAutoTileRuleset,
  serializeAutoTileRuleset,
} from "../tiles/autoTile.ts";
import {
  TilemapData,
  type TilesetRegistryExtSnapshot,
} from "../tiles/TilemapEngine.ts";

export type ExportFormat = "json" | "godot" | "godot_tileset" | "tiled";
export type PackMode = "grid" | "tight";

export interface ExportOptionsDto {
  format: ExportFormat;
  pack: PackMode;
  trim: boolean;
  extrude: number;
  padding: number;
  sheetName: string;
}

export interface ExportResultDto {
  pngPath: string;
  metadataPath: string;
  sheetWidth: number;
  sheetHeight: number;
  frameCount: number;
}

interface RustCel {
  id: string;
  frame_index: number;
  linked_to: string | null;
  linked_frame?: number | null;
}

interface RustTilemapGrid {
  cols: number;
  rows: number;
  cells: number[];
}

interface RustTilesetMeta {
  id: string;
  name: string;
  tile_width: number;
  tile_height: number;
  tile_count: number;
}

interface RustLayer {
  id: string;
  name: string;
  kind: "raster" | "group" | "tilemap" | "rig" | "data";
  visible: boolean;
  locked: boolean;
  opacity: number;
  alpha_lock: boolean;
  blend_mode: "normal" | "multiply" | "screen" | "overlay" | "add";
  parent_id: string | null;
  cels: RustCel[];
  tilemaps?: Record<string, RustTilemapGrid>;
  map_role?: string | null;
}

interface RustDocument {
  schema_version: number;
  name: string;
  size: { width: number; height: number };
  color_mode: "rgba" | "indexed";
  palette: { name: string; colors: string[] };
  layers: RustLayer[];
  frames: { id: string; index: number; duration_ms: number }[];
  tags: {
    id: string;
    name: string;
    from_frame: number;
    to_frame: number;
    color: string;
  }[];
  tileset?: RustTilesetMeta | null;
  tile_projection?: "orthogonal" | "isometric";
  tiles_version?: number;
  tiles_ext?: {
    registry?: TilesetRegistryExtSnapshot;
    autoTileRuleset?: unknown;
  };
  rig?: unknown;
  game_data?: unknown;
}

export interface ProjectTransfer {
  document: RustDocument;
  cels: Record<string, string>;
  tiles?: string[];
}

export function isTauriRuntime(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

function bytesToBase64(bytes: Uint8ClampedArray): string {
  const chunkSize = 8192;
  let binary = "";
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const slice = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...slice);
  }
  return btoa(binary);
}

function base64ToBytes(b64: string): Uint8ClampedArray {
  const binary = atob(b64);
  const out = new Uint8ClampedArray(binary.length);
  for (let i = 0; i < binary.length; i++) {
    out[i] = binary.charCodeAt(i);
  }
  return out;
}

function toRustBlend(
  mode: BlendMode
): "normal" | "multiply" | "screen" | "overlay" | "add" {
  switch (mode) {
    case "Multiply":
      return "multiply";
    case "Screen":
      return "screen";
    case "Overlay":
      return "overlay";
    case "Add":
      return "add";
    case "Normal":
    default:
      return "normal";
  }
}

function fromRustBlend(
  mode: RustLayer["blend_mode"]
): BlendMode {
  switch (mode) {
    case "multiply":
      return "Multiply";
    case "screen":
      return "Screen";
    case "overlay":
      return "Overlay";
    case "add":
      return "Add";
    case "normal":
    default:
      return "Normal";
  }
}

function extractBasename(path: string): string {
  const parts = path.split(/[\\/]/);
  return parts[parts.length - 1] || "untitled.pixet";
}

export function serializeProjectTransfer(): ProjectTransfer {
  commitFloatingSelection();
  const state = useEditorStore.getState();

  const celsMap: Record<string, string> = {};
  const layers: RustLayer[] = state.layers.map((layer) => {
    const rustCels: RustCel[] = [];
    const tilemaps: Record<string, RustTilemapGrid> = {};

    if (layer.kind === "tilemap") {
      for (const frame of state.frames) {
        const key = `${layer.id}:${frame.index}`;
        const tm = pixelEngine.tilemaps.get(key);
        if (tm) {
          tilemaps[String(frame.index)] = {
            cols: tm.cols,
            rows: tm.rows,
            cells: Array.from(tm.grid),
          };
        }
      }
    } else if (layer.kind !== "group") {
      for (const frame of state.frames) {
        const key = `${layer.id}:${frame.index}`;
        const linkedTarget = pixelEngine.celLinks.get(key);
        if (linkedTarget !== undefined) {
          rustCels.push({
            id: `${layer.id}-cel-${frame.index + 1}`,
            frame_index: frame.index,
            linked_to: `${layer.id}-cel-${linkedTarget + 1}`,
            linked_frame: linkedTarget,
          });
          continue;
        }

        const buf = pixelEngine.cels.get(key);
        if (buf && !buf.isEmpty()) {
          celsMap[key] = bytesToBase64(buf.data);
          rustCels.push({
            id: `${layer.id}-cel-${frame.index + 1}`,
            frame_index: frame.index,
            linked_to: null,
            linked_frame: null,
          });
        }
      }
    }

    return {
      id: layer.id,
      name: layer.name,
      kind: layer.kind,
      visible: layer.visible,
      locked: layer.locked,
      opacity: layer.opacity / 100,
      alpha_lock: layer.alphaLock,
      blend_mode: toRustBlend(layer.blendMode),
      parent_id: layer.parentId,
      cels: rustCels,
      tilemaps,
      map_role:
        layer.mapRole && layer.mapRole !== "albedo"
          ? layer.mapRole
          : undefined,
    };
  });

  const tiles: string[] = [];
  for (let i = 1; i < pixelEngine.tileset.tiles.length; i++) {
    tiles.push(bytesToBase64(pixelEngine.tileset.tiles[i].data));
  }

  const document: RustDocument = {
    schema_version: 1,
    name: state.documentName,
    size: { width: state.canvasWidth, height: state.canvasHeight },
    color_mode: state.colorMode === "Indexed" ? "indexed" : "rgba",
    palette: {
      name: state.paletteName,
      colors: state.palette,
    },
    layers,
    frames: state.frames.map((f) => ({
      id: f.id,
      index: f.index,
      duration_ms: f.durationMs,
    })),
    tags: state.tags.map((t) => ({
      id: t.id,
      name: t.name,
      from_frame: t.fromFrame,
      to_frame: t.toFrame,
      color: t.color,
    })),
    tileset: {
      id: pixelEngine.tileset.id,
      name: pixelEngine.tileset.name,
      tile_width: pixelEngine.tileset.tileWidth,
      tile_height: pixelEngine.tileset.tileHeight,
      tile_count: tiles.length,
    },
    tile_projection: pixelEngine.tileProjection,
    tiles_version: 2,
    tiles_ext: {
      registry: pixelEngine.tilesetRegistry.toExtSnapshot(),
      autoTileRuleset: serializeAutoTileRuleset(pixelEngine.autoTileRuleset),
    },
    rig:
      pixelEngine.rig.bones.length > 0
        ? pixelEngine.rig.toSnapshot()
        : undefined,
    game_data:
      pixelEngine.gameData.boxes.length > 0 ||
      pixelEngine.gameData.sockets.length > 0 ||
      pixelEngine.gameData.events.length > 0
        ? pixelEngine.gameData.toSnapshot()
        : undefined,
  };

  return { document, cels: celsMap, tiles };
}

export function hydrateProjectTransfer(
  transfer: ProjectTransfer,
  filePath: string | null
): void {
  const doc = transfer.document;
  const w = doc.size.width;
  const h = doc.size.height;

  pixelEngine.resetForDocument(w, h);

  if (doc.rig !== undefined) {
    pixelEngine.rig.fromSnapshot(doc.rig);
  }
  if (doc.game_data !== undefined) {
    pixelEngine.gameData.fromSnapshot(doc.game_data);
  }

  for (const [key, b64] of Object.entries(transfer.cels)) {
    const raw = base64ToBytes(b64);
    if (raw.length === w * h * 4) {
      pixelEngine.cels.set(key, new PixelBuffer(w, h, raw));
    }
  }

  if (doc.tileset) {
    const tw = doc.tileset.tile_width;
    const th = doc.tileset.tile_height;
    pixelEngine.tileset.name = doc.tileset.name;
    pixelEngine.tileset.tileWidth = tw;
    pixelEngine.tileset.tileHeight = th;
    pixelEngine.tileset.tiles = [new PixelBuffer(tw, th)];
    if (transfer.tiles && transfer.tiles.length > 0) {
      for (const b64 of transfer.tiles) {
        const raw = base64ToBytes(b64);
        if (raw.length === tw * th * 4) {
          pixelEngine.tileset.tiles.push(new PixelBuffer(tw, th, raw));
        }
      }
    }
    useEditorStore.getState().setTileSize(tw, th);
  }

  if ((doc.tiles_version ?? 1) >= 2 && doc.tiles_ext) {
    if (doc.tiles_ext.registry) {
      pixelEngine.tilesetRegistry.applyExtSnapshot(doc.tiles_ext.registry);
    }
    if (doc.tiles_ext.autoTileRuleset !== undefined) {
      pixelEngine.autoTileRuleset = deserializeAutoTileRuleset(
        doc.tiles_ext.autoTileRuleset
      );
    }
  }

  const proj = doc.tile_projection ?? "orthogonal";
  pixelEngine.tileProjection = proj;
  useEditorStore.getState().setTileProjection(proj);

  for (const layer of doc.layers) {
    for (const cel of layer.cels) {
      if (cel.linked_frame !== undefined && cel.linked_frame !== null) {
        pixelEngine.celLinks.set(
          `${layer.id}:${cel.frame_index}`,
          cel.linked_frame
        );
      }
    }
    if (layer.tilemaps) {
      for (const [frameStr, grid] of Object.entries(layer.tilemaps)) {
        pixelEngine.tilemaps.set(
          `${layer.id}:${frameStr}`,
          new TilemapData(grid.cols, grid.rows, new Uint32Array(grid.cells))
        );
      }
    }
  }

  const layers: LayerItem[] = doc.layers.map((l) => ({
    id: l.id,
    name: l.name,
    kind: l.kind as LayerKind,
    visible: l.visible,
    locked: l.locked,
    opacity: Math.round(l.opacity * 100),
    alphaLock: l.alpha_lock,
    blendMode: fromRustBlend(l.blend_mode),
    parentId: l.parent_id,
    mapRole: (l.map_role as LayerMapRole | undefined) ?? undefined,
    expanded: true,
    cels: {},
  }));

  useEditorStore.getState().loadProjectState({
    documentName: filePath ? extractBasename(filePath) : doc.name,
    filePath,
    canvasWidth: w,
    canvasHeight: h,
    colorMode: doc.color_mode === "indexed" ? "Indexed" : "RGBA",
    paletteName: doc.palette.name,
    palette: doc.palette.colors,
    layers,
    frames: doc.frames.map((f) => ({
      id: f.id,
      index: f.index,
      durationMs: f.duration_ms,
    })),
    tags: doc.tags.map((t) => ({
      id: t.id,
      name: t.name,
      fromFrame: t.from_frame,
      toFrame: t.to_frame,
      color: t.color,
    })),
  });

  syncTimelineCels();
  resetRigHistory();
  useEditorStore.getState().bumpTilesetVersion();
  useEditorStore.getState().bumpRigVersion();
  useEditorStore.getState().bumpGameDataVersion();
  pixelEngine.emitChange();
}

function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export async function saveProjectAction(saveAs = false): Promise<void> {
  const state = useEditorStore.getState();
  const payload = serializeProjectTransfer();

  if (!isTauriRuntime()) {
    const jsonName = state.documentName.replace(/\.pixet$/i, "") + ".pixet.json";
    downloadBlob(
      new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" }),
      jsonName
    );
    state.setStatusMessage(`Downloaded ${jsonName} (browser mode)`);
    return;
  }

  let targetPath = saveAs ? null : state.currentFilePath;
  if (!targetPath) {
    const selected = await save({
      title: "Save Pixet Project",
      defaultPath: state.currentFilePath ?? state.documentName,
      filters: [{ name: "Pixet Project", extensions: ["pixet"] }],
    });
    if (!selected) return;
    targetPath = selected;
  }

  const fileName = extractBasename(targetPath);
  payload.document.name = fileName;

  try {
    await invoke("save_project", { path: targetPath, payload });
    state.setCurrentFilePath(targetPath);
    state.setDocumentName(fileName);
    state.setStatusMessage(`Saved ${fileName}`);
  } catch (err) {
    state.setStatusMessage(`Save failed: ${String(err)}`);
  }
}

export async function openProjectAction(): Promise<void> {
  const state = useEditorStore.getState();

  if (!isTauriRuntime()) {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".json,.pixet.json";
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      try {
        const text = await file.text();
        const transfer = JSON.parse(text) as ProjectTransfer;
        hydrateProjectTransfer(transfer, null);
        useEditorStore.getState().setStatusMessage(`Opened ${file.name}`);
      } catch (err) {
        useEditorStore.getState().setStatusMessage(`Open failed: ${String(err)}`);
      }
    };
    input.click();
    return;
  }

  const selected = await open({
    title: "Open Pixet Project",
    multiple: false,
    filters: [{ name: "Pixet Project", extensions: ["pixet"] }],
  });
  if (!selected || typeof selected !== "string") return;

  try {
    const transfer = await invoke<ProjectTransfer>("open_project", {
      path: selected,
    });
    hydrateProjectTransfer(transfer, selected);
    useEditorStore
      .getState()
      .setStatusMessage(`Opened ${extractBasename(selected)}`);
  } catch (err) {
    state.setStatusMessage(`Open failed: ${String(err)}`);
  }
}

export async function importAsepriteAction(): Promise<void> {
  const state = useEditorStore.getState();

  if (!isTauriRuntime()) {
    state.setStatusMessage(
      "Aseprite binary import requires the desktop Tauri runtime"
    );
    return;
  }

  const selected = await open({
    title: "Import Aseprite Sprite (.ase / .aseprite)",
    multiple: false,
    filters: [{ name: "Aseprite", extensions: ["ase", "aseprite"] }],
  });
  if (!selected || typeof selected !== "string") return;

  try {
    const transfer = await invoke<ProjectTransfer>("import_aseprite", {
      path: selected,
    });
    hydrateProjectTransfer(transfer, null);
    useEditorStore
      .getState()
      .setStatusMessage(`Imported ${extractBasename(selected)}`);
  } catch (err) {
    state.setStatusMessage(`Aseprite import failed: ${String(err)}`);
  }
}

export async function exportSpritesheetAction(
  options: ExportOptionsDto
): Promise<boolean> {
  const state = useEditorStore.getState();
  const payload = serializeProjectTransfer();

  if (!isTauriRuntime()) {
    // Browser fallback: render horizontal spritesheet PNG + JSON/TRES
    const w = state.canvasWidth;
    const h = state.canvasHeight;
    const n = state.frames.length;
    const sheetCanvas = document.createElement("canvas");
    sheetCanvas.width = w * n;
    sheetCanvas.height = h;
    const ctx = sheetCanvas.getContext("2d");
    if (!ctx) return false;

    for (let i = 0; i < n; i++) {
      const rgba = pixelEngine.compositeFrame(state.layers, i);
      const img = new ImageData(new Uint8ClampedArray(rgba), w, h);
      ctx.putImageData(img, i * w, 0);
    }

    const pngName = `${options.sheetName}.png`;
    sheetCanvas.toBlob((blob) => {
      if (blob) downloadBlob(blob, pngName);
    }, "image/png");

    if (options.format === "json") {
      const jsonMeta = {
        frames: state.frames.map((f, idx) => ({
          filename: `${options.sheetName}_${idx}.png`,
          frame: { x: idx * w, y: 0, w, h },
          rotated: false,
          trimmed: false,
          spriteSourceSize: { x: 0, y: 0, w, h },
          sourceSize: { w, h },
          duration: f.durationMs,
        })),
        meta: {
          app: "pixet",
          image: pngName,
          format: "RGBA8888",
          size: { w: w * n, h },
          scale: "1",
        },
      };
      downloadBlob(
        new Blob([JSON.stringify(jsonMeta, null, 2)], {
          type: "application/json",
        }),
        `${options.sheetName}.json`
      );
    }
    state.setStatusMessage(`Downloaded ${pngName} (browser preview export)`);
    return true;
  }

  const outDir = await open({
    directory: true,
    multiple: false,
    title: "Select Export Folder",
  });
  if (!outDir || typeof outDir !== "string") return false;

  try {
    const res = await invoke<ExportResultDto>("export_spritesheet", {
      outDir,
      payload,
      options,
    });
    state.setStatusMessage(
      `Exported ${res.frameCount}f (${res.sheetWidth}×${res.sheetHeight}) -> ${extractBasename(res.metadataPath)}`
    );
    return true;
  } catch (err) {
    state.setStatusMessage(`Export failed: ${String(err)}`);
    return false;
  }
}

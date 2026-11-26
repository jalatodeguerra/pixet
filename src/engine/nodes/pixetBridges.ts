import { PixelBuffer } from "../document/PixelBuffer.ts";
import { pixelEngine } from "../document/PixelEngine.ts";
import { syncHistoryAndCelState } from "../document/historyActions.ts";
import { mutateModel3D } from "../model3d/model3dActions.ts";
import type { ModelMaterial } from "../model3d/types.ts";
import { nodeRegistry } from "./NodeRegistry.ts";
import { ensureActiveNodeGraph, getNodeEvaluator } from "./nodeActions.ts";
import type { NodeGraph } from "./types.ts";
import { useEditorStore } from "../../store/editorStore.ts";

export interface NodeGraphMaterialSnapshot {
  graphId: string;
  version: number;
  width: number;
  height: number;
  albedo: Uint8ClampedArray;
  normal: Uint8ClampedArray;
  heightMap: Uint8ClampedArray;
  roughness: Uint8ClampedArray;
  metallic: Uint8ClampedArray;
  ao: Uint8ClampedArray;
  emissive: Uint8ClampedArray;
}

const snapshotCache = new Map<string, NodeGraphMaterialSnapshot>();

export function buildOrmPackedRgba(
  ao: Uint8ClampedArray,
  roughness: Uint8ClampedArray,
  metallic: Uint8ClampedArray
): Uint8ClampedArray {
  const len = ao.length;
  const out = new Uint8ClampedArray(len);
  for (let i = 0; i < len; i += 4) {
    out[i] = ao[i];
    out[i + 1] = roughness[i];
    out[i + 2] = metallic[i];
    out[i + 3] = 255;
  }
  return out;
}

export function buildGodotStandardMaterialTres(
  materialName: string,
  files: {
    albedoFile: string;
    normalFile: string;
    ormFile: string;
  }
): string {
  return `[gd_resource type="StandardMaterial3D" load_steps=4 format=3]

[ext_resource type="Texture2D" path="res://${files.albedoFile}" id="1_albedo"]
[ext_resource type="Texture2D" path="res://${files.normalFile}" id="2_normal"]
[ext_resource type="Texture2D" path="res://${files.ormFile}" id="3_orm"]

[resource]
resource_name = "${materialName}"
albedo_texture = ExtResource("1_albedo")
normal_enabled = true
normal_texture = ExtResource("2_normal")
roughness_texture = ExtResource("3_orm")
roughness_texture_channel = 1
metallic = 1.0
metallic_texture = ExtResource("3_orm")
metallic_texture_channel = 2
ao_enabled = true
ao_texture = ExtResource("3_orm")
ao_texture_channel = 0
texture_filter = 0
`;
}

export function resolveNodeGraphMaterialSnapshot(
  graphId: string
): NodeGraphMaterialSnapshot | null {
  const graph = pixelEngine.nodes.graphs.find((g) => g.id === graphId);
  if (!graph) return null;

  const cached = snapshotCache.get(graphId);
  if (cached && cached.version === pixelEngine.nodes.version) {
    return cached;
  }

  const evaluator = getNodeEvaluator();
  if (!evaluator.isAvailable()) return null;

  const store = useEditorStore.getState();
  evaluator.evaluateGraph(graph, nodeRegistry, {
    paletteColors: store.palette,
    renderThumbnails: false,
  });

  const matOut = graph.nodes.find((n) => n.type === "output.material");
  const targetNode = matOut ?? graph.nodes.find((n) => nodeRegistry.get(n.type)?.isSink);
  if (!targetNode) return null;

  const channels = evaluator.readMaterialChannelsRgba(graph, nodeRegistry, targetNode.id);
  if (!channels) return null;

  const snap: NodeGraphMaterialSnapshot = {
    graphId,
    version: pixelEngine.nodes.version,
    ...channels,
  };
  snapshotCache.set(graphId, snap);
  return snap;
}

export function assignGraphToModel3DMaterial(
  graphId: string,
  graphName: string
): void {
  mutateModel3D(`Assign ${graphName} to 3D Material`, (engine) => {
    const existing = engine.materials.find(
      (m) => m.source.kind === "node-graph" && m.source.graphId === graphId
    );
    if (existing) {
      existing.name = graphName;
      existing.usePbrMaps = true;
      return;
    }
    const newMat: ModelMaterial = {
      id: `mat-graph-${graphId}`,
      name: graphName,
      source: { kind: "node-graph", graphId },
      doubleSided: false,
      alphaTest: 0.5,
      usePbrMaps: true,
    };
    engine.addMaterial(newMat);
  });
  useEditorStore
    .getState()
    .setStatusMessage(`Assigned "${graphName}" to Low-Poly 3D Material`);
}

export function bakeNodeOutputToDrawLayer(
  nodeId: string,
  socketId: string,
  layerName = "Node Bake"
): void {
  const evaluator = getNodeEvaluator();
  const res = evaluator.readOutputRgba(nodeId, socketId);
  if (!res) return;

  const store = useEditorStore.getState();
  const frame = store.currentFrame;
  const w = pixelEngine.width;
  const h = pixelEngine.height;

  const buf = new PixelBuffer(w, h);
  for (let y = 0; y < h; y++) {
    const sy = Math.min(res.height - 1, Math.floor((y / h) * res.height));
    for (let x = 0; x < w; x++) {
      const sx = Math.min(res.width - 1, Math.floor((x / w) * res.width));
      const sp = (sy * res.width + sx) * 4;
      const dp = (y * w + x) * 4;
      buf.data[dp] = res.data[sp];
      buf.data[dp + 1] = res.data[sp + 1];
      buf.data[dp + 2] = res.data[sp + 2];
      buf.data[dp + 3] = res.data[sp + 3];
    }
  }

  let targetLayer = store.layers.find((l) => l.name === layerName && l.kind === "raster");
  if (!targetLayer) {
    store.addLayer();
    const created = useEditorStore.getState().layers.find((l) => l.id === useEditorStore.getState().activeLayerId);
    if (created) {
      store.renameLayer(created.id, layerName);
      targetLayer = useEditorStore.getState().layers.find((l) => l.id === created.id);
    }
  }
  if (!targetLayer) return;

  const cel = pixelEngine.getOrCreateCel(targetLayer.id, frame);
  pixelEngine.history.beginTransaction(targetLayer.id, frame, "Bake Node Output");
  pixelEngine.history.captureAllTiles(cel);
  cel.data.set(buf.data);
  pixelEngine.history.commitTransaction(cel);
  pixelEngine.emitChange();
  syncHistoryAndCelState(targetLayer.id, frame);
  store.setStatusMessage(`Baked to Draw layer "${layerName}"`);
}

type MaterialSnapChannel = "albedo" | "normal" | "heightMap" | "ao" | "emissive";

export function bakeMaterialToDrawMapRoleStack(materialNodeId: string): void {
  const graph = ensureActiveNodeGraph();
  const evaluator = getNodeEvaluator();
  const channels = evaluator.readMaterialChannelsRgba(graph, nodeRegistry, materialNodeId);
  if (!channels) return;

  const roles: Array<{ key: MaterialSnapChannel; role: "albedo" | "normal" | "height" | "depth" | "emission"; label: string }> = [
    { key: "albedo", role: "albedo", label: "Node Albedo" },
    { key: "normal", role: "normal", label: "Node Normal" },
    { key: "heightMap", role: "height", label: "Node Height" },
    { key: "ao", role: "depth", label: "Node AO" },
    { key: "emissive", role: "emission", label: "Node Emissive" },
  ];

  const store = useEditorStore.getState();
  const frame = store.currentFrame;
  const w = pixelEngine.width;
  const h = pixelEngine.height;

  for (const item of roles) {
    const src = channels[item.key];
    let layer = store.layers.find((l) => l.name === item.label && l.kind === "raster");
    if (!layer) {
      store.addLayer();
      const createdId = useEditorStore.getState().activeLayerId;
      store.renameLayer(createdId, item.label);
      layer = useEditorStore.getState().layers.find((l) => l.id === createdId);
    }
    if (!layer) continue;
    store.setLayerMapRole(layer.id, item.role);

    const cel = pixelEngine.getOrCreateCel(layer.id, frame);
    pixelEngine.history.beginTransaction(layer.id, frame, `Bake ${item.label}`);
    pixelEngine.history.captureAllTiles(cel);
    for (let y = 0; y < h; y++) {
      const sy = Math.min(channels.height - 1, Math.floor((y / h) * channels.height));
      for (let x = 0; x < w; x++) {
        const sx = Math.min(channels.width - 1, Math.floor((x / w) * channels.width));
        const sp = (sy * channels.width + sx) * 4;
        const dp = (y * w + x) * 4;
        cel.data[dp] = src[sp];
        cel.data[dp + 1] = src[sp + 1];
        cel.data[dp + 2] = src[sp + 2];
        cel.data[dp + 3] = src[sp + 3];
      }
    }
    pixelEngine.history.commitTransaction(cel);
  }
  pixelEngine.emitChange();
  store.setStatusMessage("Baked PBR Map-Role stack to Draw layers");
}

export function bakeNodeOutputToTilesetSlot(
  nodeId: string,
  socketId: string,
  tilesetIndex = 0,
  tileId = 0
): void {
  const evaluator = getNodeEvaluator();
  const res = evaluator.readOutputRgba(nodeId, socketId);
  if (!res) return;

  const ts = pixelEngine.tilesetRegistry.tilesets[tilesetIndex] ?? pixelEngine.tileset;
  const tw = ts.tileWidth;
  const th = ts.tileHeight;
  const tile = new PixelBuffer(tw, th);
  for (let y = 0; y < th; y++) {
    const sy = Math.min(res.height - 1, Math.floor((y / th) * res.height));
    for (let x = 0; x < tw; x++) {
      const sx = Math.min(res.width - 1, Math.floor((x / tw) * res.width));
      const sp = (sy * res.width + sx) * 4;
      const dp = (y * tw + x) * 4;
      tile.data[dp] = res.data[sp];
      tile.data[dp + 1] = res.data[sp + 1];
      tile.data[dp + 2] = res.data[sp + 2];
      tile.data[dp + 3] = res.data[sp + 3];
    }
  }
  const existingTile = ts.getTile(tileId);
  if (existingTile) {
    existingTile.data.set(tile.data);
  } else {
    ts.addTile(tile, { name: `Node Tile ${tileId}` });
  }
  pixelEngine.emitChange();
  useEditorStore.getState().bumpTilesetVersion();
  useEditorStore.getState().setStatusMessage(`Baked to Tileset #${tilesetIndex} Tile ${tileId}`);
}

export function bakeAutoTileSetFromGraph(
  graph: NodeGraph,
  materialNodeId: string,
  tilesetIndex = 0
): void {
  const evaluator = getNodeEvaluator();
  const maskNode = graph.nodes.find((n) => n.type === "gen.autotileMask");
  if (!maskNode) {
    useEditorStore.getState().setStatusMessage("Add an Auto-Tile Mask node to bake a 16-tile set");
    return;
  }

  const ts = pixelEngine.tilesetRegistry.tilesets[tilesetIndex] ?? pixelEngine.tileset;
  const origBitmask = maskNode.params.bitmask;
  const store = useEditorStore.getState();

  for (let mask = 0; mask < 16; mask++) {
    maskNode.params.bitmask = mask;
    evaluator.markNodeDirty(graph, maskNode.id);
    evaluator.evaluateGraph(graph, nodeRegistry, { paletteColors: store.palette });
    const channels = evaluator.readMaterialChannelsRgba(graph, nodeRegistry, materialNodeId);
    if (!channels) continue;

    const tw = ts.tileWidth;
    const th = ts.tileHeight;
    const tile = new PixelBuffer(tw, th);
    for (let y = 0; y < th; y++) {
      const sy = Math.min(channels.height - 1, Math.floor((y / th) * channels.height));
      for (let x = 0; x < tw; x++) {
        const sx = Math.min(channels.width - 1, Math.floor((x / tw) * channels.width));
        const sp = (sy * channels.width + sx) * 4;
        const dp = (y * tw + x) * 4;
        tile.data[dp] = channels.albedo[sp];
        tile.data[dp + 1] = channels.albedo[sp + 1];
        tile.data[dp + 2] = channels.albedo[sp + 2];
        tile.data[dp + 3] = channels.albedo[sp + 3];
      }
    }
    const existingTile = ts.getTile(mask);
    if (existingTile) {
      existingTile.data.set(tile.data);
    } else {
      ts.addTile(tile, { name: `AutoTile ${mask}` });
    }
  }

  maskNode.params.bitmask = origBitmask;
  evaluator.markNodeDirty(graph, maskNode.id);
  pixelEngine.emitChange();
  store.bumpTilesetVersion();
  store.setStatusMessage("Baked 16-tile Auto-Tile Set to Tileset");
}

function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function rgbaToPngBlob(rgba: Uint8ClampedArray, w: number, h: number): Promise<Blob | null> {
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) return Promise.resolve(null);
  const img = ctx.createImageData(w, h);
  img.data.set(rgba);
  ctx.putImageData(img, 0, 0);
  return new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
}

export async function exportPbrOrmAndGodotPack(materialNodeId: string): Promise<void> {
  const graph = ensureActiveNodeGraph();
  const evaluator = getNodeEvaluator();
  const channels = evaluator.readMaterialChannelsRgba(graph, nodeRegistry, materialNodeId);
  if (!channels) return;

  const base = graph.name.toLowerCase().replace(/[^a-z0-9_-]+/g, "_") || "material";
  const orm = buildOrmPackedRgba(channels.ao, channels.roughness, channels.metallic);

  const albedoBlob = await rgbaToPngBlob(channels.albedo, channels.width, channels.height);
  const normalBlob = await rgbaToPngBlob(channels.normal, channels.width, channels.height);
  const ormBlob = await rgbaToPngBlob(orm, channels.width, channels.height);

  if (albedoBlob) downloadBlob(albedoBlob, `${base}_albedo.png`);
  if (normalBlob) downloadBlob(normalBlob, `${base}_normal.png`);
  if (ormBlob) downloadBlob(ormBlob, `${base}_orm.png`);

  const tres = buildGodotStandardMaterialTres(graph.name, {
    albedoFile: `${base}_albedo.png`,
    normalFile: `${base}_normal.png`,
    ormFile: `${base}_orm.png`,
  });
  downloadBlob(new Blob([tres], { type: "text/plain" }), `${base}.tres`);
  useEditorStore.getState().setStatusMessage(`Exported ${base} PBR + ORM + Godot .tres`);
}

export function bakeAnimationToDrawFrames(
  nodeId: string,
  socketId: string,
  isMaterial: boolean,
  layerName = "Node Anim"
): void {
  const graph = ensureActiveNodeGraph();
  const evaluator = getNodeEvaluator();
  const store = useEditorStore.getState();
  const frameCount = Math.max(1, store.frames.length);
  const fps = Math.max(1, store.fps);
  const w = pixelEngine.width;
  const h = pixelEngine.height;

  let targetLayer = store.layers.find((l) => l.name === layerName && l.kind === "raster");
  if (!targetLayer) {
    store.addLayer();
    const createdId = useEditorStore.getState().activeLayerId;
    store.renameLayer(createdId, layerName);
    targetLayer = useEditorStore.getState().layers.find((l) => l.id === createdId);
  }
  if (!targetLayer) return;

  for (let f = 0; f < frameCount; f++) {
    evaluator.evaluateGraph(graph, nodeRegistry, {
      pinnedNodeId: nodeId,
      paletteColors: store.palette,
      frame: f,
      time: f / fps,
      progress: f / frameCount,
      renderThumbnails: false,
    });

    let srcData: Uint8ClampedArray | null = null;
    let srcW = w;
    let srcH = h;
    if (isMaterial) {
      const ch = evaluator.readMaterialChannelsRgba(graph, nodeRegistry, nodeId);
      if (ch) {
        srcData = ch.albedo;
        srcW = ch.width;
        srcH = ch.height;
      }
    } else {
      const out = evaluator.readOutputRgba(nodeId, socketId);
      if (out) {
        srcData = out.data;
        srcW = out.width;
        srcH = out.height;
      }
    }
    if (!srcData) continue;

    const cel = pixelEngine.getOrCreateCel(targetLayer.id, f);
    pixelEngine.history.beginTransaction(targetLayer.id, f, `Bake Anim F${f + 1}`);
    pixelEngine.history.captureAllTiles(cel);
    for (let y = 0; y < h; y++) {
      const sy = Math.min(srcH - 1, Math.floor((y / h) * srcH));
      for (let x = 0; x < w; x++) {
        const sx = Math.min(srcW - 1, Math.floor((x / w) * srcW));
        const sp = (sy * srcW + sx) * 4;
        const dp = (y * w + x) * 4;
        cel.data[dp] = srcData[sp];
        cel.data[dp + 1] = srcData[sp + 1];
        cel.data[dp + 2] = srcData[sp + 2];
        cel.data[dp + 3] = srcData[sp + 3];
      }
    }
    pixelEngine.history.commitTransaction(cel);
  }

  pixelEngine.emitChange();
  syncHistoryAndCelState(targetLayer.id, store.currentFrame);
  store.setStatusMessage(`Baked ${frameCount} animated frames to "${layerName}"`);
}

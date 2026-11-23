import {
  isLayerEffectivelyLocked,
  type LayerItem,
  useEditorStore,
} from "../../store/editorStore.ts";
import { PixelBuffer } from "./PixelBuffer.ts";
import { pixelEngine, type LayerCompositingInfo } from "./PixelEngine.ts";
import { syncHistoryAndCelState } from "./historyActions.ts";
import { commitFloatingSelection } from "./selectionActions.ts";
import { syncTimelineCels } from "./timelineActions.ts";

function toCompositingInfo(
  layer: LayerItem,
  override?: Partial<LayerCompositingInfo>
): LayerCompositingInfo {
  return {
    id: layer.id,
    kind: layer.kind,
    visible: layer.visible,
    opacity: layer.opacity,
    blendMode: layer.blendMode,
    parentId: layer.parentId,
    clipped: layer.clipped,
    mapRole: layer.mapRole,
    ...override,
  };
}

function isLayerEffectivelyVisible(
  layers: readonly LayerItem[],
  layer: LayerItem
): boolean {
  if (!layer.visible) return false;
  const byId = new Map(layers.map((l) => [l.id, l]));
  const visited = new Set<string>([layer.id]);
  let parentId = layer.parentId;
  while (parentId && !visited.has(parentId)) {
    visited.add(parentId);
    const parent = byId.get(parentId);
    if (!parent) break;
    if (!parent.visible) return false;
    parentId = parent.parentId;
  }
  return true;
}

function deleteLayerCelsAndLinks(layerId: string): void {
  const prefix = `${layerId}:`;
  for (const key of Array.from(pixelEngine.cels.keys())) {
    if (key.startsWith(prefix)) {
      pixelEngine.cels.delete(key);
    }
  }
  for (const key of Array.from(pixelEngine.celLinks.keys())) {
    if (key.startsWith(prefix)) {
      pixelEngine.celLinks.delete(key);
    }
  }
}

function writeMergedFrameToLayer(
  layerId: string,
  frameIndex: number,
  composited: Uint8ClampedArray
): void {
  const buf = new PixelBuffer(pixelEngine.width, pixelEngine.height);
  buf.data.set(composited);
  buf.markAllDirty();
  pixelEngine.cels.set(`${layerId}:${frameIndex}`, buf);
  pixelEngine.celLinks.delete(`${layerId}:${frameIndex}`);
}

function resolveGroupChain(
  layers: readonly LayerItem[],
  layer: LayerItem
): LayerCompositingInfo[] {
  const ancestors: LayerCompositingInfo[] = [];
  const byId = new Map(layers.map((l) => [l.id, l]));
  const visited = new Set<string>([layer.id]);
  let parentId = layer.parentId;
  while (parentId && !visited.has(parentId)) {
    visited.add(parentId);
    const parent = byId.get(parentId);
    if (!parent) break;
    ancestors.push(toCompositingInfo(parent));
    parentId = parent.parentId;
  }
  return ancestors;
}

function createSnapshotLayerId(prefix = "layer-merged"): string {
  const existing = new Set(useEditorStore.getState().layers.map((l) => l.id));
  let idx = 1;
  while (existing.has(`${prefix}-${idx}`)) {
    idx++;
  }
  return `${prefix}-${idx}`;
}

export function mergeDownLayerAction(): boolean {
  commitFloatingSelection();
  const state = useEditorStore.getState();
  const upperIdx = state.layers.findIndex((l) => l.id === state.activeLayerId);
  if (upperIdx < 0) return false;

  const upper = state.layers[upperIdx];
  if (upper.kind !== "raster") {
    state.setStatusMessage("Select a raster layer to merge down");
    return false;
  }

  let targetIdx = -1;
  for (let i = upperIdx + 1; i < state.layers.length; i++) {
    if (state.layers[i].kind === "raster") {
      targetIdx = i;
      break;
    }
  }
  if (targetIdx < 0) {
    state.setStatusMessage("No raster layer beneath to merge down into");
    return false;
  }

  const lower = state.layers[targetIdx];
  if (
    isLayerEffectivelyLocked(state.layers, upper.id) ||
    isLayerEffectivelyLocked(state.layers, lower.id)
  ) {
    state.setStatusMessage("Cannot merge locked layers");
    return false;
  }

  const frameCount = Math.max(1, state.frames.length);
  const ancestorInfos = new Map<string, LayerCompositingInfo>();
  for (const anc of resolveGroupChain(state.layers, upper)) {
    ancestorInfos.set(anc.id, anc);
  }
  for (const anc of resolveGroupChain(state.layers, lower)) {
    ancestorInfos.set(anc.id, anc);
  }

  // Respect upper blendMode, opacity, and clipped state while keeping lower at 100% Normal
  // for the pixel merge so target layer retains its own layer opacity/blend or merges cleanly.
  // Actually, prompt says: "respecting blend mode, opacity, and clipped state across all frames,
  // using `pixelEngine.compositeFrame` on just those two layers per frame".
  const upperInfo = toCompositingInfo(upper, {
    visible: upper.visible,
  });
  const lowerInfo = toCompositingInfo(lower, {
    visible: lower.visible,
    opacity: lower.opacity,
    blendMode: "Normal",
    clipped: false,
  });

  const pairLayers: LayerCompositingInfo[] = [
    upperInfo,
    lowerInfo,
    ...Array.from(ancestorInfos.values()).map((a) => ({ ...a, opacity: 100 })),
  ];

  const mergedPerFrame: Uint8ClampedArray[] = [];
  for (let f = 0; f < frameCount; f++) {
    const comp = pixelEngine.compositeFrame(pairLayers, f);
    mergedPerFrame.push(new Uint8ClampedArray(comp));
  }

  for (let f = 0; f < frameCount; f++) {
    writeMergedFrameToLayer(lower.id, f, mergedPerFrame[f]);
  }
  deleteLayerCelsAndLinks(upper.id);

  const nextLayers = state.layers
    .filter((l) => l.id !== upper.id)
    .map((l) =>
      l.id === lower.id
        ? { ...l, opacity: 100, visible: upper.visible || lower.visible }
        : l
    );

  useEditorStore.setState({
    layers: nextLayers,
    activeLayerId: lower.id,
    selectedLayerIds: [lower.id],
  });

  pixelEngine.history.clear();
  pixelEngine.undoCoordinator.clear();
  useEditorStore.getState().setHistoryFlags(false, false);
  syncTimelineCels();
  pixelEngine.emitChange();
  useEditorStore
    .getState()
    .setStatusMessage(`Merged "${upper.name}" into "${lower.name}"`);
  return true;
}

export function mergeVisibleLayersAction(): boolean {
  commitFloatingSelection();
  const state = useEditorStore.getState();
  const visibleRasters = state.layers.filter(
    (l) => l.kind === "raster" && isLayerEffectivelyVisible(state.layers, l)
  );

  if (visibleRasters.length < 2) {
    state.setStatusMessage("Need at least 2 visible raster layers to merge");
    return false;
  }

  for (const l of visibleRasters) {
    if (isLayerEffectivelyLocked(state.layers, l.id)) {
      state.setStatusMessage(`Layer "${l.name}" is locked`);
      return false;
    }
  }

  const visibleRasterIds = new Set(visibleRasters.map((l) => l.id));
  const target = visibleRasters[visibleRasters.length - 1];
  const frameCount = Math.max(1, state.frames.length);

  // Only composite visible raster layers (plus their group parents for effective visibility/opacity).
  const compositeInput = state.layers
    .filter((l) => l.kind === "group" || visibleRasterIds.has(l.id))
    .map((l) => toCompositingInfo(l));

  const mergedPerFrame: Uint8ClampedArray[] = [];
  for (let f = 0; f < frameCount; f++) {
    const comp = pixelEngine.compositeFrame(compositeInput, f);
    mergedPerFrame.push(new Uint8ClampedArray(comp));
  }

  const newId = createSnapshotLayerId("layer-visible");
  for (let f = 0; f < frameCount; f++) {
    writeMergedFrameToLayer(newId, f, mergedPerFrame[f]);
  }
  for (const id of visibleRasterIds) {
    deleteLayerCelsAndLinks(id);
  }

  const mergedLayer: LayerItem = {
    id: newId,
    name: target.name,
    kind: "raster",
    visible: true,
    locked: false,
    opacity: 100,
    alphaLock: false,
    blendMode: "Normal",
    parentId: target.parentId,
    clipped: false,
    cels: {},
  };

  let inserted = false;
  const nextLayers: LayerItem[] = [];
  for (const l of state.layers) {
    if (visibleRasterIds.has(l.id)) {
      if (l.id === target.id && !inserted) {
        nextLayers.push(mergedLayer);
        inserted = true;
      }
      continue;
    }
    nextLayers.push(l);
  }
  if (!inserted) {
    nextLayers.push(mergedLayer);
  }

  useEditorStore.setState({
    layers: nextLayers,
    activeLayerId: newId,
    selectedLayerIds: [newId],
  });

  pixelEngine.history.clear();
  pixelEngine.undoCoordinator.clear();
  useEditorStore.getState().setHistoryFlags(false, false);
  syncTimelineCels();
  pixelEngine.emitChange();
  useEditorStore
    .getState()
    .setStatusMessage(`Merged ${visibleRasters.length} visible layers`);
  return true;
}

export function flattenImageAction(): boolean {
  commitFloatingSelection();
  const state = useEditorStore.getState();
  if (state.layers.length === 0) return false;

  const frameCount = Math.max(1, state.frames.length);
  const compLayers = state.layers.map((l) => toCompositingInfo(l));

  const flattenedFrames: Uint8ClampedArray[] = [];
  for (let f = 0; f < frameCount; f++) {
    const comp = pixelEngine.compositeFrame(compLayers, f);
    flattenedFrames.push(new Uint8ClampedArray(comp));
  }

  pixelEngine.cels.clear();
  pixelEngine.celLinks.clear();
  pixelEngine.tilemaps.clear();

  const bgId = "layer-background";
  for (let f = 0; f < frameCount; f++) {
    writeMergedFrameToLayer(bgId, f, flattenedFrames[f]);
  }

  const bgLayer: LayerItem = {
    id: bgId,
    name: "Background",
    kind: "raster",
    visible: true,
    locked: false,
    opacity: 100,
    alphaLock: false,
    blendMode: "Normal",
    parentId: null,
    clipped: false,
    cels: {},
  };

  useEditorStore.setState({
    layers: [bgLayer],
    activeLayerId: bgId,
    selectedLayerIds: [bgId],
    soloVisibilitySnapshot: null,
  });

  pixelEngine.history.clear();
  pixelEngine.undoCoordinator.clear();
  useEditorStore.getState().setHistoryFlags(false, false);
  syncTimelineCels();
  pixelEngine.emitChange();
  useEditorStore.getState().setStatusMessage("Flattened image");
  return true;
}

export function clearActiveCelAction(): boolean {
  commitFloatingSelection();
  const state = useEditorStore.getState();
  const layer = state.layers.find((l) => l.id === state.activeLayerId);
  if (!layer || layer.kind !== "raster") {
    state.setStatusMessage("Select a raster layer to clear cel");
    return false;
  }
  if (isLayerEffectivelyLocked(state.layers, layer.id)) {
    state.setStatusMessage(`Layer "${layer.name}" is locked`);
    return false;
  }

  const frameIndex = state.currentFrame;
  const cel = pixelEngine.getCel(layer.id, frameIndex);
  if (!cel || cel.isEmpty()) {
    state.setStatusMessage("Cel is already empty");
    return false;
  }

  pixelEngine.history.beginTransaction(layer.id, frameIndex, "Clear Cel");
  pixelEngine.history.captureAllTiles(cel);
  cel.clear();
  if (pixelEngine.history.commitTransaction(cel)) {
    syncHistoryAndCelState(layer.id, frameIndex);
    pixelEngine.emitChange();
    state.setStatusMessage(`Cleared "${layer.name}" cel`);
    return true;
  }

  pixelEngine.history.cancelTransaction();
  return false;
}

export function duplicateLayerAllFramesAction(layerId?: string): boolean {
  commitFloatingSelection();
  const state = useEditorStore.getState();
  const targetId = layerId ?? state.activeLayerId;
  const idx = state.layers.findIndex((l) => l.id === targetId);
  if (idx < 0) return false;

  const source = state.layers[idx];
  if (source.kind !== "raster") {
    state.setStatusMessage("Select a raster layer to duplicate");
    return false;
  }

  const prevActive = state.activeLayerId;
  if (prevActive !== source.id) {
    state.selectLayer(source.id);
  }
  const dup = useEditorStore.getState().duplicateActiveLayer();
  if (!dup) return false;

  pixelEngine.duplicateLayerCels(dup.sourceId, dup.newId);
  syncTimelineCels();
  pixelEngine.emitChange();
  useEditorStore
    .getState()
    .setStatusMessage(`Duplicated "${source.name}" across all frames`);
  return true;
}

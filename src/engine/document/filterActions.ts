import {
  isLayerEffectivelyLocked,
  useEditorStore,
} from "../../store/editorStore.ts";
import { PixelBuffer } from "./PixelBuffer.ts";
import { pixelEngine } from "./PixelEngine.ts";
import { syncHistoryAndCelState } from "./historyActions.ts";
import { commitFloatingSelection } from "./selectionActions.ts";
import { syncTimelineCels } from "./timelineActions.ts";
import type { SelectionMask } from "../tools/selection.ts";
import {
  computeTightBounds,
  cropBufferToBounds,
  scaleBufferAlgorithm,
  type ScaleSpriteAlgorithm,
} from "../tools/spriteOps.ts";

export type FilterScope = "cel" | "layer" | "sprite";

interface TargetCelEntry {
  layerId: string;
  frameIndex: number;
  cel: PixelBuffer;
}

function collectTargetCels(scope: FilterScope): TargetCelEntry[] {
  const state = useEditorStore.getState();
  const frameCount = Math.max(1, state.frames.length);
  const targets: TargetCelEntry[] = [];
  const seenBuffers = new Set<PixelBuffer>();

  if (scope === "cel") {
    const layer = state.layers.find((l) => l.id === state.activeLayerId);
    if (!layer || layer.kind !== "raster") {
      state.setStatusMessage("Select a raster layer to apply filter");
      return [];
    }
    if (isLayerEffectivelyLocked(state.layers, layer.id)) {
      state.setStatusMessage(`Layer "${layer.name}" is locked`);
      return [];
    }
    const ownerFrame = pixelEngine.resolveCelFrame(layer.id, state.currentFrame);
    const cel = pixelEngine.getOrCreateCel(layer.id, ownerFrame);
    targets.push({ layerId: layer.id, frameIndex: ownerFrame, cel });
    return targets;
  }

  if (scope === "layer") {
    const layer = state.layers.find((l) => l.id === state.activeLayerId);
    if (!layer || layer.kind !== "raster") {
      state.setStatusMessage("Select a raster layer to apply filter");
      return [];
    }
    if (isLayerEffectivelyLocked(state.layers, layer.id)) {
      state.setStatusMessage(`Layer "${layer.name}" is locked`);
      return [];
    }
    for (let f = 0; f < frameCount; f++) {
      const ownerFrame = pixelEngine.resolveCelFrame(layer.id, f);
      const cel = pixelEngine.getCel(layer.id, ownerFrame);
      if (!cel || seenBuffers.has(cel)) continue;
      seenBuffers.add(cel);
      targets.push({ layerId: layer.id, frameIndex: ownerFrame, cel });
    }
    return targets;
  }

  // scope === "sprite": all visible, unlocked raster layers across all frames
  for (const layer of state.layers) {
    if (layer.kind !== "raster" || !layer.visible) continue;
    if (isLayerEffectivelyLocked(state.layers, layer.id)) continue;
    for (let f = 0; f < frameCount; f++) {
      const ownerFrame = pixelEngine.resolveCelFrame(layer.id, f);
      const cel = pixelEngine.getCel(layer.id, ownerFrame);
      if (!cel || seenBuffers.has(cel)) continue;
      seenBuffers.add(cel);
      targets.push({ layerId: layer.id, frameIndex: ownerFrame, cel });
    }
  }
  return targets;
}

export function applyBufferFilterAction(
  label: string,
  scope: FilterScope,
  fn: (buf: PixelBuffer, mask: SelectionMask | null) => PixelBuffer
): boolean {
  commitFloatingSelection();
  const state = useEditorStore.getState();
  const targets = collectTargetCels(scope);
  if (targets.length === 0) {
    if (!useEditorStore.getState().statusMessage) {
      state.setStatusMessage(`No unlocked raster cels to apply ${label}`);
    }
    return false;
  }

  const mask: SelectionMask | null =
    scope === "cel" &&
    pixelEngine.selection &&
    !pixelEngine.selection.isEmpty()
      ? pixelEngine.selection
      : null;

  if (targets.length === 1) {
    const { layerId, frameIndex, cel } = targets[0];
    const next = fn(cel, mask);
    pixelEngine.history.beginTransaction(layerId, frameIndex, label);
    pixelEngine.history.captureAllTiles(cel);
    cel.data.set(next.data);
    cel.markAllDirty();
    if (pixelEngine.history.commitTransaction(cel)) {
      syncHistoryAndCelState(layerId, frameIndex);
      pixelEngine.emitChange();
      state.setStatusMessage(`Applied ${label}`);
      return true;
    }
    pixelEngine.history.cancelTransaction();
    state.setStatusMessage(`${label}: no changes`);
    return false;
  }

  pixelEngine.history.beginMultiCelTransaction(label);
  for (const target of targets) {
    pixelEngine.history.captureMultiCel(
      target.layerId,
      target.frameIndex,
      target.cel
    );
    const next = fn(target.cel, null);
    target.cel.data.set(next.data);
    target.cel.markAllDirty();
  }

  if (pixelEngine.history.commitMultiCelTransaction()) {
    syncHistoryAndCelState(state.activeLayerId, state.currentFrame);
    pixelEngine.emitChange();
    state.setStatusMessage(`Applied ${label} (${targets.length} cels)`);
    return true;
  }

  pixelEngine.history.cancelMultiCelTransaction();
  state.setStatusMessage(`${label}: no changes`);
  return false;
}

export function autoCropSpriteAction(): boolean {
  commitFloatingSelection();
  const state = useEditorStore.getState();
  const rasterIds = new Set(
    state.layers.filter((l) => l.kind === "raster").map((l) => l.id)
  );
  const allBuffers: PixelBuffer[] = [];
  for (const [key, buf] of pixelEngine.cels.entries()) {
    const sep = key.lastIndexOf(":");
    const layerId = key.slice(0, sep);
    if (rasterIds.has(layerId)) {
      allBuffers.push(buf);
    }
  }

  const bounds = computeTightBounds(allBuffers);
  if (!bounds) {
    state.setStatusMessage("Auto-Crop: sprite has no opaque pixels");
    return false;
  }

  if (
    bounds.x === 0 &&
    bounds.y === 0 &&
    bounds.width === pixelEngine.width &&
    bounds.height === pixelEngine.height
  ) {
    state.setStatusMessage("Auto-Crop: canvas is already tightly cropped");
    return false;
  }

  for (const [key, buf] of Array.from(pixelEngine.cels.entries())) {
    pixelEngine.cels.set(key, cropBufferToBounds(buf, bounds));
  }

  pixelEngine.applyResizedCanvasDimensions(bounds.width, bounds.height);
  state.setCanvasSize(bounds.width, bounds.height);
  state.setHasSelection(false);
  state.setHistoryFlags(false, false);
  syncTimelineCels();
  state.setStatusMessage(`Auto-cropped sprite to ${bounds.width}×${bounds.height}`);
  return true;
}

export function scaleSpriteAction(
  targetW: number,
  targetH: number,
  algorithm: ScaleSpriteAlgorithm
): boolean {
  commitFloatingSelection();
  const state = useEditorStore.getState();
  const dstW = Math.max(1, Math.min(2048, Math.round(targetW) || pixelEngine.width));
  const dstH = Math.max(1, Math.min(2048, Math.round(targetH) || pixelEngine.height));

  if (dstW === pixelEngine.width && dstH === pixelEngine.height) {
    state.setStatusMessage("Scale Sprite: dimensions unchanged");
    return false;
  }

  for (const [key, buf] of Array.from(pixelEngine.cels.entries())) {
    pixelEngine.cels.set(key, scaleBufferAlgorithm(buf, dstW, dstH, algorithm));
  }

  pixelEngine.applyResizedCanvasDimensions(dstW, dstH);
  state.setCanvasSize(dstW, dstH);
  state.setHasSelection(false);
  state.setHistoryFlags(false, false);
  syncTimelineCels();
  state.setStatusMessage(`Scaled sprite to ${dstW}×${dstH} (${algorithm})`);
  return true;
}

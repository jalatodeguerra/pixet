import {
  isLayerEffectivelyLocked,
  useEditorStore,
} from "../../store/editorStore.ts";
import { PixelBuffer } from "./PixelBuffer.ts";
import { pixelEngine } from "./PixelEngine.ts";
import { syncHistoryAndCelState } from "./historyActions.ts";
import { syncTimelineCels } from "./timelineActions.ts";
import {
  clearMaskedRegion,
  createFullSelection,
  extractMaskedRegion,
  flipBufferHorizontal,
  flipBufferVertical,
  rotateBuffer90CCW,
  rotateBuffer90CW,
  SelectionMask,
  stampFloatingPixels,
} from "../tools/selection.ts";

export type TransformOp = "flipH" | "flipV" | "rotateCW" | "rotateCCW";

function buildMaskForBuffer(
  canvasW: number,
  canvasH: number,
  buf: PixelBuffer,
  offsetX: number,
  offsetY: number
): SelectionMask {
  const mask = new SelectionMask(canvasW, canvasH);
  for (let y = 0; y < buf.height; y++) {
    for (let x = 0; x < buf.width; x++) {
      const [, , , a] = buf.getPixel(x, y);
      if (a > 0) {
        mask.set(offsetX + x, offsetY + y, true);
      }
    }
  }
  if (mask.isEmpty()) {
    for (let y = 0; y < buf.height; y++) {
      for (let x = 0; x < buf.width; x++) {
        mask.set(offsetX + x, offsetY + y, true);
      }
    }
  }
  return mask;
}

function getTightBoundsMask(cel: PixelBuffer): SelectionMask {
  const mask = new SelectionMask(cel.width, cel.height);
  let minX = cel.width;
  let minY = cel.height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < cel.height; y++) {
    for (let x = 0; x < cel.width; x++) {
      const [, , , a] = cel.getPixel(x, y);
      if (a > 0) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX >= minX && maxY >= minY) {
    for (let y = minY; y <= maxY; y++) {
      for (let x = minX; x <= maxX; x++) {
        mask.set(x, y, true);
      }
    }
  }
  return mask;
}

function applyTransform(buf: PixelBuffer, op: TransformOp): PixelBuffer {
  switch (op) {
    case "flipH":
      return flipBufferHorizontal(buf);
    case "flipV":
      return flipBufferVertical(buf);
    case "rotateCW":
      return rotateBuffer90CW(buf);
    case "rotateCCW":
      return rotateBuffer90CCW(buf);
  }
}

export function commitFloatingSelection(): boolean {
  const fl = pixelEngine.floating;
  if (!fl) return false;

  const cel = pixelEngine.getOrCreateCel(fl.sourceLayerId, fl.sourceFrameIndex);
  if (!pixelEngine.history.hasActiveTransaction) {
    pixelEngine.history.beginTransaction(
      fl.sourceLayerId,
      fl.sourceFrameIndex,
      "Commit Selection"
    );
  }

  stampFloatingPixels(cel, fl.pixels, fl.offsetX, fl.offsetY, (cx, cy) =>
    pixelEngine.history.capturePixelTile(cel, cx, cy)
  );

  if (!pixelEngine.history.commitTransaction(cel)) {
    pixelEngine.history.cancelTransaction();
  }

  pixelEngine.floating = null;
  const nextMask = buildMaskForBuffer(
    pixelEngine.width,
    pixelEngine.height,
    fl.pixels,
    fl.offsetX,
    fl.offsetY
  );
  pixelEngine.selection = nextMask.isEmpty() ? null : nextMask;
  syncHistoryAndCelState(fl.sourceLayerId, fl.sourceFrameIndex);
  useEditorStore.getState().setHasSelection(Boolean(pixelEngine.selection));
  pixelEngine.emitChange();
  return true;
}

export function cancelFloatingSelection(): void {
  if (pixelEngine.floating) {
    commitFloatingSelection();
  }
  pixelEngine.selection = null;
  useEditorStore.getState().setHasSelection(false);
  pixelEngine.emitChange();
}

export function liftSelectionForMove(
  layerId: string,
  frameIndex: number
): boolean {
  if (pixelEngine.floating) return true;

  const state = useEditorStore.getState();
  const layer = state.layers.find((l) => l.id === layerId);
  if (!layer || layer.kind === "group") {
    state.setStatusMessage("Select a raster layer to move");
    return false;
  }
  if (isLayerEffectivelyLocked(state.layers, layerId)) {
    state.setStatusMessage(`Layer "${layer.name}" is locked`);
    return false;
  }

  const cel = pixelEngine.getOrCreateCel(layerId, frameIndex);
  let mask = pixelEngine.selection;

  if (!mask || mask.isEmpty()) {
    if (cel.isEmpty()) return false;
    mask = getTightBoundsMask(cel);
    if (mask.isEmpty()) return false;
    pixelEngine.selection = mask;
    state.setHasSelection(true);
  }

  const extracted = extractMaskedRegion(cel, mask);
  if (!extracted) return false;

  pixelEngine.history.beginTransaction(layerId, frameIndex, "Move Selection");
  clearMaskedRegion(cel, mask, (cx, cy) =>
    pixelEngine.history.capturePixelTile(cel, cx, cy)
  );

  pixelEngine.floating = {
    pixels: extracted.pixels,
    offsetX: extracted.x,
    offsetY: extracted.y,
    sourceLayerId: layerId,
    sourceFrameIndex: frameIndex,
    liftedFromCel: true,
  };
  pixelEngine.emitChange();
  return true;
}

export function copySelection(): boolean {
  const state = useEditorStore.getState();
  if (pixelEngine.floating) {
    pixelEngine.clipboard = pixelEngine.floating.pixels.clone();
    state.setStatusMessage("Copied selection");
    return true;
  }

  const cel = pixelEngine.getCel(state.activeLayerId, state.currentFrame);
  if (!cel) return false;

  if (pixelEngine.selection && !pixelEngine.selection.isEmpty()) {
    const extracted = extractMaskedRegion(cel, pixelEngine.selection);
    if (!extracted) return false;
    pixelEngine.clipboard = extracted.pixels;
    state.setStatusMessage("Copied selection");
    return true;
  }

  if (cel.isEmpty()) return false;
  pixelEngine.clipboard = cel.clone();
  state.setStatusMessage("Copied layer");
  return true;
}

export function cutSelection(): boolean {
  const state = useEditorStore.getState();
  if (!copySelection()) return false;

  const layer = state.layers.find((l) => l.id === state.activeLayerId);
  if (
    !layer ||
    layer.kind === "group" ||
    isLayerEffectivelyLocked(state.layers, layer.id)
  ) {
    state.setStatusMessage("Layer is locked");
    return false;
  }

  if (pixelEngine.floating) {
    const fl = pixelEngine.floating;
    pixelEngine.floating = null;
    const cel = pixelEngine.getOrCreateCel(fl.sourceLayerId, fl.sourceFrameIndex);
    if (fl.liftedFromCel && pixelEngine.history.hasActiveTransaction) {
      if (!pixelEngine.history.commitTransaction(cel)) {
        pixelEngine.history.cancelTransaction();
      }
      syncHistoryAndCelState(fl.sourceLayerId, fl.sourceFrameIndex);
    }
    pixelEngine.selection = null;
    state.setHasSelection(false);
    state.setStatusMessage("Cut selection");
    pixelEngine.emitChange();
    return true;
  }

  const cel = pixelEngine.getOrCreateCel(layer.id, state.currentFrame);
  const mask =
    pixelEngine.selection && !pixelEngine.selection.isEmpty()
      ? pixelEngine.selection
      : createFullSelection(cel.width, cel.height);

  pixelEngine.history.beginTransaction(layer.id, state.currentFrame, "Cut");
  const cleared = clearMaskedRegion(cel, mask, (cx, cy) =>
    pixelEngine.history.capturePixelTile(cel, cx, cy)
  );
  if (cleared > 0 && pixelEngine.history.commitTransaction(cel)) {
    syncHistoryAndCelState(layer.id, state.currentFrame);
  } else {
    pixelEngine.history.cancelTransaction();
  }
  pixelEngine.selection = null;
  state.setHasSelection(false);
  state.setStatusMessage("Cut selection");
  pixelEngine.emitChange();
  return true;
}

export function pasteClipboard(): boolean {
  if (!pixelEngine.clipboard) return false;
  const state = useEditorStore.getState();
  const layer = state.layers.find((l) => l.id === state.activeLayerId);
  if (!layer || layer.kind === "group") {
    state.setStatusMessage("Select a raster layer to paste");
    return false;
  }
  if (isLayerEffectivelyLocked(state.layers, layer.id)) {
    state.setStatusMessage(`Layer "${layer.name}" is locked`);
    return false;
  }

  commitFloatingSelection();

  const pasted = pixelEngine.clipboard.clone();
  const offsetX = Math.floor((pixelEngine.width - pasted.width) / 2);
  const offsetY = Math.floor((pixelEngine.height - pasted.height) / 2);

  pixelEngine.floating = {
    pixels: pasted,
    offsetX,
    offsetY,
    sourceLayerId: layer.id,
    sourceFrameIndex: state.currentFrame,
    liftedFromCel: false,
  };
  pixelEngine.selection = buildMaskForBuffer(
    pixelEngine.width,
    pixelEngine.height,
    pasted,
    offsetX,
    offsetY
  );
  state.setHasSelection(true);
  state.setActiveTool("move");
  state.setStatusMessage("Pasted as floating selection");
  pixelEngine.emitChange();
  return true;
}

export function copySelectionToNewLayer(): boolean {
  const state = useEditorStore.getState();
  const layer = state.layers.find((l) => l.id === state.activeLayerId);
  if (!layer || layer.kind === "group") {
    state.setStatusMessage("Select a raster layer first");
    return false;
  }

  let pixels: PixelBuffer | null = null;
  let offsetX = 0;
  let offsetY = 0;

  if (pixelEngine.floating) {
    pixels = pixelEngine.floating.pixels.clone();
    offsetX = pixelEngine.floating.offsetX;
    offsetY = pixelEngine.floating.offsetY;
  } else {
    const cel = pixelEngine.getCel(layer.id, state.currentFrame);
    if (!cel || cel.isEmpty()) return false;
    if (pixelEngine.selection && !pixelEngine.selection.isEmpty()) {
      const extracted = extractMaskedRegion(cel, pixelEngine.selection);
      if (!extracted) return false;
      pixels = extracted.pixels;
      offsetX = extracted.x;
      offsetY = extracted.y;
    } else {
      pixels = cel.clone();
    }
  }

  const frameIndex = state.currentFrame;
  const newLayerId = state.addNamedLayer(`${layer.name} (Copy)`);
  const dstCel = pixelEngine.getOrCreateCel(newLayerId, frameIndex);
  stampFloatingPixels(dstCel, pixels, offsetX, offsetY);
  syncTimelineCels();
  pixelEngine.emitChange();
  state.setStatusMessage("Copied to new layer");
  return true;
}

export function cutSelectionToNewLayer(): boolean {
  const state = useEditorStore.getState();
  const layer = state.layers.find((l) => l.id === state.activeLayerId);
  if (
    !layer ||
    layer.kind === "group" ||
    isLayerEffectivelyLocked(state.layers, layer.id)
  ) {
    state.setStatusMessage("Select an unlocked raster layer to cut");
    return false;
  }

  const frameIndex = state.currentFrame;
  let pixels: PixelBuffer | null = null;
  let offsetX = 0;
  let offsetY = 0;

  if (pixelEngine.floating) {
    const fl = pixelEngine.floating;
    pixels = fl.pixels.clone();
    offsetX = fl.offsetX;
    offsetY = fl.offsetY;
    pixelEngine.floating = null;
    const srcCel = pixelEngine.getOrCreateCel(
      fl.sourceLayerId,
      fl.sourceFrameIndex
    );
    if (fl.liftedFromCel && pixelEngine.history.hasActiveTransaction) {
      if (!pixelEngine.history.commitTransaction(srcCel)) {
        pixelEngine.history.cancelTransaction();
      }
      syncHistoryAndCelState(fl.sourceLayerId, fl.sourceFrameIndex);
    }
  } else {
    const srcCel = pixelEngine.getOrCreateCel(layer.id, frameIndex);
    if (srcCel.isEmpty()) return false;
    const mask =
      pixelEngine.selection && !pixelEngine.selection.isEmpty()
        ? pixelEngine.selection
        : createFullSelection(srcCel.width, srcCel.height);
    const extracted = extractMaskedRegion(srcCel, mask);
    if (!extracted) return false;
    pixels = extracted.pixels;
    offsetX = extracted.x;
    offsetY = extracted.y;

    pixelEngine.history.beginTransaction(
      layer.id,
      frameIndex,
      "Cut to New Layer"
    );
    const cleared = clearMaskedRegion(srcCel, mask, (cx, cy) =>
      pixelEngine.history.capturePixelTile(srcCel, cx, cy)
    );
    if (cleared > 0 && pixelEngine.history.commitTransaction(srcCel)) {
      syncHistoryAndCelState(layer.id, frameIndex);
    } else {
      pixelEngine.history.cancelTransaction();
    }
  }

  const newLayerId = state.addNamedLayer(`${layer.name} (Cut)`);
  const dstCel = pixelEngine.getOrCreateCel(newLayerId, frameIndex);
  stampFloatingPixels(dstCel, pixels, offsetX, offsetY);

  pixelEngine.selection = null;
  state.setHasSelection(false);
  syncTimelineCels();
  pixelEngine.emitChange();
  state.setStatusMessage("Cut to new layer");
  return true;
}

export function deleteSelection(): boolean {
  const state = useEditorStore.getState();
  const layer = state.layers.find((l) => l.id === state.activeLayerId);
  if (
    !layer ||
    layer.kind === "group" ||
    isLayerEffectivelyLocked(state.layers, layer.id)
  ) {
    return false;
  }

  if (pixelEngine.floating) {
    const fl = pixelEngine.floating;
    pixelEngine.floating = null;
    const cel = pixelEngine.getOrCreateCel(fl.sourceLayerId, fl.sourceFrameIndex);
    if (fl.liftedFromCel && pixelEngine.history.hasActiveTransaction) {
      if (!pixelEngine.history.commitTransaction(cel)) {
        pixelEngine.history.cancelTransaction();
      }
      syncHistoryAndCelState(fl.sourceLayerId, fl.sourceFrameIndex);
    }
    pixelEngine.selection = null;
    state.setHasSelection(false);
    pixelEngine.emitChange();
    return true;
  }

  if (!pixelEngine.selection || pixelEngine.selection.isEmpty()) return false;
  const cel = pixelEngine.getOrCreateCel(layer.id, state.currentFrame);
  pixelEngine.history.beginTransaction(
    layer.id,
    state.currentFrame,
    "Delete Selection"
  );
  const cleared = clearMaskedRegion(cel, pixelEngine.selection, (cx, cy) =>
    pixelEngine.history.capturePixelTile(cel, cx, cy)
  );
  if (cleared > 0 && pixelEngine.history.commitTransaction(cel)) {
    syncHistoryAndCelState(layer.id, state.currentFrame);
  } else {
    pixelEngine.history.cancelTransaction();
  }
  pixelEngine.emitChange();
  return true;
}

export function selectAllCanvas(): void {
  commitFloatingSelection();
  pixelEngine.selection = createFullSelection(
    pixelEngine.width,
    pixelEngine.height
  );
  useEditorStore.getState().setHasSelection(true);
  pixelEngine.emitChange();
}

export function deselectAll(): void {
  if (pixelEngine.floating) {
    commitFloatingSelection();
  }
  pixelEngine.selection = null;
  useEditorStore.getState().setHasSelection(false);
  pixelEngine.emitChange();
}

export function transformSelectionOrCel(op: TransformOp): void {
  const state = useEditorStore.getState();
  const layer = state.layers.find((l) => l.id === state.activeLayerId);
  if (!layer || layer.kind === "group") {
    state.setStatusMessage("Select a raster layer to transform");
    return;
  }
  if (isLayerEffectivelyLocked(state.layers, layer.id)) {
    state.setStatusMessage(`Layer "${layer.name}" is locked`);
    return;
  }

  const opLabel =
    op === "flipH"
      ? "Flip Horizontal"
      : op === "flipV"
        ? "Flip Vertical"
        : op === "rotateCW"
          ? "Rotate 90° CW"
          : "Rotate 90° CCW";

  if (
    pixelEngine.floating ||
    (pixelEngine.selection && !pixelEngine.selection.isEmpty())
  ) {
    if (!pixelEngine.floating) {
      if (!liftSelectionForMove(layer.id, state.currentFrame)) return;
    }
    const fl = pixelEngine.floating!;
    const oldW = fl.pixels.width;
    const oldH = fl.pixels.height;
    const transformed = applyTransform(fl.pixels, op);

    if (op === "rotateCW" || op === "rotateCCW") {
      const cx = fl.offsetX + oldW / 2;
      const cy = fl.offsetY + oldH / 2;
      fl.offsetX = Math.round(cx - transformed.width / 2);
      fl.offsetY = Math.round(cy - transformed.height / 2);
    }

    fl.pixels = transformed;
    pixelEngine.selection = buildMaskForBuffer(
      pixelEngine.width,
      pixelEngine.height,
      transformed,
      fl.offsetX,
      fl.offsetY
    );
    state.setHasSelection(true);
    state.setStatusMessage(opLabel);
    pixelEngine.emitChange();
    return;
  }

  const cel = pixelEngine.getOrCreateCel(layer.id, state.currentFrame);
  if (cel.isEmpty()) return;

  const transformed = applyTransform(cel, op);
  pixelEngine.history.beginTransaction(layer.id, state.currentFrame, opLabel);
  pixelEngine.history.captureAllTiles(cel);
  cel.data.set(transformed.data);
  cel.markAllDirty();
  if (pixelEngine.history.commitTransaction(cel)) {
    syncHistoryAndCelState(layer.id, state.currentFrame);
    state.setStatusMessage(opLabel);
    pixelEngine.emitChange();
  } else {
    pixelEngine.history.cancelTransaction();
  }
}

import {
  isLayerEffectivelyLocked,
  useEditorStore,
} from "../../store/editorStore.ts";
import { hexToRgba, PixelBuffer } from "./PixelBuffer.ts";
import { pixelEngine } from "./PixelEngine.ts";
import { syncHistoryAndCelState } from "./historyActions.ts";
import { syncTimelineCels } from "./timelineActions.ts";
import {
  commitFreeTransformAction,
  getFreeTransformSession,
} from "./transformActions.ts";
import {
  borderSelectionMask,
  clearMaskedRegion,
  computeSelectionStrokePoints,
  contractSelectionMask,
  createFullSelection,
  expandSelectionMask,
  extractMaskedRegion,
  flipBufferHorizontal,
  flipBufferVertical,
  invertSelectionMask,
  rotateBuffer90CCW,
  rotateBuffer90CW,
  selectBufferNonTransparent,
  SelectionMask,
  stampFloatingPixels,
} from "../tools/selection.ts";
import { captureCustomBrush } from "../tools/sprayJumble.ts";

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
  if (getFreeTransformSession()) {
    return commitFreeTransformAction();
  }
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

export function captureCustomBrushFromSelectionAction(): boolean {
  const state = useEditorStore.getState();
  const layer = state.layers.find((l) => l.id === state.activeLayerId);
  if (!layer || layer.kind === "group") {
    state.setStatusMessage("Select a raster layer to capture brush");
    return false;
  }

  let sourceBuf: PixelBuffer | null = null;
  let mask: SelectionMask | null = null;

  if (pixelEngine.floating) {
    sourceBuf = new PixelBuffer(pixelEngine.width, pixelEngine.height);
    stampFloatingPixels(
      sourceBuf,
      pixelEngine.floating.pixels,
      pixelEngine.floating.offsetX,
      pixelEngine.floating.offsetY
    );
    mask = buildMaskForBuffer(
      pixelEngine.width,
      pixelEngine.height,
      pixelEngine.floating.pixels,
      pixelEngine.floating.offsetX,
      pixelEngine.floating.offsetY
    );
  } else if (pixelEngine.selection && !pixelEngine.selection.isEmpty()) {
    sourceBuf = pixelEngine.getCel(layer.id, state.currentFrame) ?? null;
    mask = pixelEngine.selection;
  }

  if (!sourceBuf || !mask || mask.isEmpty()) {
    state.setStatusMessage("Make a selection over pixels to capture a brush");
    return false;
  }

  const brushName = `Custom ${state.savedCustomBrushes.length + 1}`;
  const captured = captureCustomBrush(
    sourceBuf,
    {
      contains: (x, y) => mask!.contains(x, y),
      getBounds: () => {
        const b = mask!.getBounds();
        return b
          ? { minX: b.x, minY: b.y, maxX: b.x + b.w - 1, maxY: b.y + b.h - 1 }
          : null;
      },
    },
    brushName,
    "rgba"
  );

  if (!captured) {
    state.setStatusMessage("Selection has no opaque pixels to capture");
    return false;
  }

  state.setCustomBrush(captured);
  state.addSavedCustomBrush(captured);
  state.setBrushShape("custom");
  state.setActiveTool("pencil");
  state.setStatusMessage(
    `Captured brush "${captured.name}" (${captured.width}×${captured.height})`
  );
  return true;
}

export function invertSelectionAction(): boolean {
  commitFloatingSelection();
  const state = useEditorStore.getState();
  const next =
    pixelEngine.selection && !pixelEngine.selection.isEmpty()
      ? invertSelectionMask(pixelEngine.selection)
      : createFullSelection(pixelEngine.width, pixelEngine.height);
  pixelEngine.setSelection(next);
  const hasSel = Boolean(pixelEngine.selection && !pixelEngine.selection.isEmpty());
  state.setHasSelection(hasSel);
  state.setStatusMessage(hasSel ? "Inverted selection" : "Selection cleared");
  return hasSel;
}

export function expandSelectionAction(px = 1): boolean {
  commitFloatingSelection();
  const state = useEditorStore.getState();
  if (!pixelEngine.selection || pixelEngine.selection.isEmpty()) {
    state.setStatusMessage("No active selection to expand");
    return false;
  }
  const next = expandSelectionMask(pixelEngine.selection, px);
  pixelEngine.setSelection(next);
  state.setHasSelection(Boolean(pixelEngine.selection));
  state.setStatusMessage(`Expanded selection by ${px}px`);
  return true;
}

export function contractSelectionAction(px = 1): boolean {
  commitFloatingSelection();
  const state = useEditorStore.getState();
  if (!pixelEngine.selection || pixelEngine.selection.isEmpty()) {
    state.setStatusMessage("No active selection to contract");
    return false;
  }
  const next = contractSelectionMask(pixelEngine.selection, px);
  pixelEngine.setSelection(next);
  const hasSel = Boolean(pixelEngine.selection && !pixelEngine.selection.isEmpty());
  state.setHasSelection(hasSel);
  state.setStatusMessage(
    hasSel ? `Contracted selection by ${px}px` : "Selection contracted to empty"
  );
  return hasSel;
}

export function borderSelectionAction(px = 1): boolean {
  commitFloatingSelection();
  const state = useEditorStore.getState();
  if (!pixelEngine.selection || pixelEngine.selection.isEmpty()) {
    state.setStatusMessage("No active selection for border");
    return false;
  }
  const next = borderSelectionMask(pixelEngine.selection, px);
  pixelEngine.setSelection(next);
  const hasSel = Boolean(pixelEngine.selection && !pixelEngine.selection.isEmpty());
  state.setHasSelection(hasSel);
  state.setStatusMessage(
    hasSel ? `Converted selection to ${px}px border` : "Selection border is empty"
  );
  return hasSel;
}

export function selectLayerContentAction(layerId?: string): boolean {
  commitFloatingSelection();
  const state = useEditorStore.getState();
  const targetId = layerId ?? state.activeLayerId;
  const layer = state.layers.find((l) => l.id === targetId);
  if (!layer || layer.kind === "group") {
    state.setStatusMessage("Select a raster layer to select content");
    return false;
  }
  const cel = pixelEngine.getCel(targetId, state.currentFrame);
  if (!cel || cel.isEmpty()) {
    pixelEngine.setSelection(null);
    state.setHasSelection(false);
    state.setStatusMessage(`Layer "${layer.name}" has no pixels on this frame`);
    return false;
  }
  const mask = selectBufferNonTransparent(cel);
  pixelEngine.setSelection(mask);
  const hasSel = Boolean(mask && !mask.isEmpty());
  state.setHasSelection(hasSel);
  state.setStatusMessage(
    hasSel ? `Selected content of "${layer.name}"` : "No opaque pixels found"
  );
  return hasSel;
}

export function strokeSelectionAction(
  width = 1,
  align: "inside" | "center" | "outside" = "outside"
): boolean {
  commitFloatingSelection();
  const state = useEditorStore.getState();
  if (!pixelEngine.selection || pixelEngine.selection.isEmpty()) {
    state.setStatusMessage("Make a selection before stroking");
    return false;
  }
  const layer = state.layers.find((l) => l.id === state.activeLayerId);
  if (!layer || layer.kind === "group" || layer.kind === "tilemap") {
    state.setStatusMessage("Select a raster layer to stroke selection");
    return false;
  }
  if (isLayerEffectivelyLocked(state.layers, layer.id)) {
    state.setStatusMessage(`Layer "${layer.name}" is locked`);
    return false;
  }

  const pts = computeSelectionStrokePoints(pixelEngine.selection, width, align);
  if (pts.length === 0) {
    state.setStatusMessage("No stroke pixels generated");
    return false;
  }

  const cel = pixelEngine.getOrCreateCel(layer.id, state.currentFrame);
  const rgba = hexToRgba(state.primaryColor, 255);
  pixelEngine.history.beginTransaction(
    layer.id,
    state.currentFrame,
    "Stroke Selection"
  );
  let changed = 0;
  for (const pt of pts) {
    pixelEngine.history.capturePixelTile(cel, pt.x, pt.y);
    if (
      cel.setPixel(
        pt.x,
        pt.y,
        rgba[0],
        rgba[1],
        rgba[2],
        rgba[3],
        layer.alphaLock
      )
    ) {
      changed++;
    }
  }
  if (changed > 0 && pixelEngine.history.commitTransaction(cel)) {
    syncHistoryAndCelState(layer.id, state.currentFrame);
    pixelEngine.emitChange();
  } else {
    pixelEngine.history.cancelTransaction();
  }
  state.setStatusMessage(`Stroked selection (${width}px ${align})`);
  return true;
}

export function fillSelectionAction(useSecondary = false): boolean {
  commitFloatingSelection();
  const state = useEditorStore.getState();
  const layer = state.layers.find((l) => l.id === state.activeLayerId);
  if (!layer || layer.kind === "group" || layer.kind === "tilemap") {
    state.setStatusMessage("Select a raster layer to fill");
    return false;
  }
  if (isLayerEffectivelyLocked(state.layers, layer.id)) {
    state.setStatusMessage(`Layer "${layer.name}" is locked`);
    return false;
  }

  const mask =
    pixelEngine.selection && !pixelEngine.selection.isEmpty()
      ? pixelEngine.selection
      : createFullSelection(pixelEngine.width, pixelEngine.height);
  const bounds = mask.getBounds();
  if (!bounds) return false;

  const cel = pixelEngine.getOrCreateCel(layer.id, state.currentFrame);
  const hex = useSecondary ? state.secondaryColor : state.primaryColor;
  const rgba = hexToRgba(hex, 255);

  pixelEngine.history.beginTransaction(
    layer.id,
    state.currentFrame,
    useSecondary ? "Fill Selection (BG)" : "Fill Selection (FG)"
  );
  let changed = 0;
  for (let y = bounds.y; y < bounds.y + bounds.h; y++) {
    for (let x = bounds.x; x < bounds.x + bounds.w; x++) {
      if (!mask.contains(x, y)) continue;
      pixelEngine.history.capturePixelTile(cel, x, y);
      if (cel.setPixel(x, y, rgba[0], rgba[1], rgba[2], rgba[3], layer.alphaLock)) {
        changed++;
      }
    }
  }

  if (changed > 0 && pixelEngine.history.commitTransaction(cel)) {
    syncHistoryAndCelState(layer.id, state.currentFrame);
    pixelEngine.emitChange();
  } else {
    pixelEngine.history.cancelTransaction();
  }
  state.setStatusMessage(
    useSecondary ? "Filled selection with BG color" : "Filled selection with FG color"
  );
  return true;
}


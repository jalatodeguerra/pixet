import {
  isLayerEffectivelyLocked,
  useEditorStore,
} from "../../store/editorStore.ts";
import { PixelBuffer } from "./PixelBuffer.ts";
import { pixelEngine } from "./PixelEngine.ts";
import { syncHistoryAndCelState } from "./historyActions.ts";
import {
  clearMaskedRegion,
  extractMaskedRegion,
  SelectionMask,
  stampFloatingPixels,
  type FloatingSelection,
} from "../tools/selection.ts";
import {
  applyFreeTransform,
  type TransformState,
} from "../tools/transform.ts";

export interface FreeTransformSession {
  sourceBuffer: PixelBuffer;
  layerId: string;
  frame: number;
  hadSelection: boolean;
  originalMask: SelectionMask | null;
  originalCelData: Uint8ClampedArray;
  restoredFloating: FloatingSelection | null;
  state: TransformState;
}

let activeSession: FreeTransformSession | null = null;

function buildMaskFromBuffer(
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

export function getFreeTransformSession(): FreeTransformSession | null {
  return activeSession;
}

export function getFreeTransformSourceSize(): {
  width: number;
  height: number;
} | null {
  if (!activeSession) return null;
  return {
    width: activeSession.sourceBuffer.width,
    height: activeSession.sourceBuffer.height,
  };
}

export function beginFreeTransformAction(): boolean {
  if (activeSession) return true;

  const store = useEditorStore.getState();
  if (store.workspaceMode !== "draw") {
    store.setStatusMessage("Free Transform is available in Draw mode");
    return false;
  }

  const existingFloating = pixelEngine.floating;
  if (existingFloating) {
    const layer = store.layers.find(
      (l) => l.id === existingFloating.sourceLayerId
    );
    if (
      !layer ||
      layer.kind === "group" ||
      layer.kind === "tilemap" ||
      isLayerEffectivelyLocked(store.layers, layer.id)
    ) {
      store.setStatusMessage("Active layer is locked or cannot be transformed");
      return false;
    }

    const cel = pixelEngine.getOrCreateCel(
      existingFloating.sourceLayerId,
      existingFloating.sourceFrameIndex
    );
    const sourceBuffer = existingFloating.pixels.clone();
    const initialState: TransformState = {
      x: existingFloating.offsetX,
      y: existingFloating.offsetY,
      width: sourceBuffer.width,
      height: sourceBuffer.height,
      scaleX: 1,
      scaleY: 1,
      rotationDeg: 0,
      skewX: 0,
      skewY: 0,
      pivotX: sourceBuffer.width / 2,
      pivotY: sourceBuffer.height / 2,
      algorithm: "nearest",
    };

    activeSession = {
      sourceBuffer,
      layerId: existingFloating.sourceLayerId,
      frame: existingFloating.sourceFrameIndex,
      hadSelection: Boolean(
        pixelEngine.selection && !pixelEngine.selection.isEmpty()
      ),
      originalMask: pixelEngine.selection ? pixelEngine.selection.clone() : null,
      originalCelData: cel.data.slice(),
      restoredFloating: {
        ...existingFloating,
        pixels: existingFloating.pixels.clone(),
      },
      state: initialState,
    };

    const transformed = applyFreeTransform(sourceBuffer, initialState);
    pixelEngine.floating = {
      pixels: transformed.buffer,
      offsetX: transformed.offsetX,
      offsetY: transformed.offsetY,
      sourceLayerId: existingFloating.sourceLayerId,
      sourceFrameIndex: existingFloating.sourceFrameIndex,
      liftedFromCel: existingFloating.liftedFromCel,
    };
    pixelEngine.selection = null;
    store.setHasSelection(false);
    store.setFreeTransformActive(true);
    store.setFreeTransformState(initialState);
    store.setStatusMessage("Free Transform (Enter to apply, Esc to cancel)");
    pixelEngine.emitChange();
    return true;
  }

  const layer = store.layers.find((l) => l.id === store.activeLayerId);
  if (!layer || layer.kind === "group" || layer.kind === "tilemap") {
    store.setStatusMessage("Select a raster layer to transform");
    return false;
  }
  if (isLayerEffectivelyLocked(store.layers, layer.id)) {
    store.setStatusMessage(`Layer "${layer.name}" is locked`);
    return false;
  }

  const cel = pixelEngine.getOrCreateCel(layer.id, store.currentFrame);
  const hadSelection = Boolean(
    pixelEngine.selection && !pixelEngine.selection.isEmpty()
  );
  const originalMask = hadSelection ? pixelEngine.selection!.clone() : null;

  let liftMask: SelectionMask;
  if (originalMask) {
    liftMask = originalMask;
  } else {
    if (cel.isEmpty()) {
      store.setStatusMessage("Layer has no pixels to transform");
      return false;
    }
    liftMask = getTightBoundsMask(cel);
    if (liftMask.isEmpty()) {
      store.setStatusMessage("Layer has no pixels to transform");
      return false;
    }
  }

  const extracted = extractMaskedRegion(cel, liftMask);
  if (!extracted || extracted.pixels.isEmpty()) {
    store.setStatusMessage("Selection has no opaque pixels to transform");
    return false;
  }

  const originalCelData = cel.data.slice();
  pixelEngine.history.beginTransaction(
    layer.id,
    store.currentFrame,
    "Free Transform"
  );
  clearMaskedRegion(cel, liftMask, (cx, cy) =>
    pixelEngine.history.capturePixelTile(cel, cx, cy)
  );

  const sourceBuffer = extracted.pixels.clone();
  const initialState: TransformState = {
    x: extracted.x,
    y: extracted.y,
    width: sourceBuffer.width,
    height: sourceBuffer.height,
    scaleX: 1,
    scaleY: 1,
    rotationDeg: 0,
    skewX: 0,
    skewY: 0,
    pivotX: sourceBuffer.width / 2,
    pivotY: sourceBuffer.height / 2,
    algorithm: "nearest",
  };

  activeSession = {
    sourceBuffer,
    layerId: layer.id,
    frame: store.currentFrame,
    hadSelection,
    originalMask,
    originalCelData,
    restoredFloating: null,
    state: initialState,
  };

  const transformed = applyFreeTransform(sourceBuffer, initialState);
  pixelEngine.floating = {
    pixels: transformed.buffer,
    offsetX: transformed.offsetX,
    offsetY: transformed.offsetY,
    sourceLayerId: layer.id,
    sourceFrameIndex: store.currentFrame,
    liftedFromCel: true,
  };
  pixelEngine.selection = null;
  store.setHasSelection(false);
  store.setFreeTransformActive(true);
  store.setFreeTransformState(initialState);
  store.setStatusMessage("Free Transform (Enter to apply, Esc to cancel)");
  pixelEngine.emitChange();
  return true;
}

export function updateFreeTransformAction(
  patch: Partial<TransformState>
): boolean {
  if (!activeSession) return false;

  const nextState: TransformState = {
    ...activeSession.state,
    ...patch,
  };
  activeSession.state = nextState;

  const transformed = applyFreeTransform(activeSession.sourceBuffer, nextState);
  pixelEngine.floating = {
    pixels: transformed.buffer,
    offsetX: transformed.offsetX,
    offsetY: transformed.offsetY,
    sourceLayerId: activeSession.layerId,
    sourceFrameIndex: activeSession.frame,
    liftedFromCel: activeSession.restoredFloating
      ? activeSession.restoredFloating.liftedFromCel
      : true,
  };

  useEditorStore.getState().setFreeTransformState(nextState);
  pixelEngine.emitChange();
  return true;
}

export function commitFreeTransformAction(): boolean {
  const session = activeSession;
  if (!session) return false;
  activeSession = null;

  const store = useEditorStore.getState();
  const cel = pixelEngine.getOrCreateCel(session.layerId, session.frame);
  const transformed = applyFreeTransform(session.sourceBuffer, session.state);

  if (!pixelEngine.history.hasActiveTransaction) {
    pixelEngine.history.beginTransaction(
      session.layerId,
      session.frame,
      "Free Transform"
    );
  }

  stampFloatingPixels(
    cel,
    transformed.buffer,
    transformed.offsetX,
    transformed.offsetY,
    (cx, cy) => pixelEngine.history.capturePixelTile(cel, cx, cy)
  );

  if (pixelEngine.history.commitTransaction(cel)) {
    syncHistoryAndCelState(session.layerId, session.frame);
  } else {
    pixelEngine.history.cancelTransaction();
  }

  pixelEngine.floating = null;
  if (session.hadSelection) {
    const nextMask = buildMaskFromBuffer(
      pixelEngine.width,
      pixelEngine.height,
      transformed.buffer,
      transformed.offsetX,
      transformed.offsetY
    );
    pixelEngine.selection = nextMask.isEmpty() ? null : nextMask;
  } else {
    pixelEngine.selection = null;
  }

  store.setHasSelection(Boolean(pixelEngine.selection));
  store.setFreeTransformActive(false);
  store.setFreeTransformState(null);
  store.setStatusMessage("Applied Free Transform");
  pixelEngine.emitChange();
  return true;
}

export function cancelFreeTransformAction(): boolean {
  const session = activeSession;
  if (!session) return false;
  activeSession = null;

  const store = useEditorStore.getState();

  if (session.restoredFloating) {
    pixelEngine.floating = {
      ...session.restoredFloating,
      pixels: session.restoredFloating.pixels.clone(),
    };
  } else {
    const cel = pixelEngine.getOrCreateCel(session.layerId, session.frame);
    cel.data.set(session.originalCelData);
    cel.markAllDirty();
    pixelEngine.history.cancelTransaction();
    pixelEngine.floating = null;
  }

  pixelEngine.selection = session.originalMask
    ? session.originalMask.clone()
    : null;
  store.setHasSelection(Boolean(pixelEngine.selection));
  store.setFreeTransformActive(false);
  store.setFreeTransformState(null);
  store.setStatusMessage("Canceled Free Transform");
  pixelEngine.emitChange();
  return true;
}

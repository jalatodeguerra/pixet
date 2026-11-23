import { isLayerEffectivelyLocked, useEditorStore } from "../../store/editorStore.ts";
import { pixelEngine } from "./PixelEngine.ts";
import { syncHistoryAndCelState } from "./historyActions.ts";
import { commitFloatingSelection } from "./selectionActions.ts";

export function syncTimelineCels(): void {
  useEditorStore.getState().syncCelMetadata((layerId, frameIndex) => {
    const cel = pixelEngine.getCel(layerId, frameIndex);
    return {
      populated: cel ? !cel.isEmpty() : false,
      linked: pixelEngine.isCelLinked(layerId, frameIndex),
    };
  });
}

function resetHistoryAfterTopologyChange(): void {
  pixelEngine.history.clear();
  pixelEngine.undoCoordinator.clear();
  useEditorStore.getState().setHistoryFlags(false, false);
}

export function addEmptyFrameAction(): void {
  commitFloatingSelection();
  const state = useEditorStore.getState();
  const count = state.frames.length;
  pixelEngine.insertEmptyFrame(count, count);
  state.insertFrameMetadata(count);
  resetHistoryAfterTopologyChange();
  syncTimelineCels();
  pixelEngine.emitChange();
}

export function duplicateCurrentFrameAction(): void {
  commitFloatingSelection();
  const state = useEditorStore.getState();
  const count = state.frames.length;
  const idx = state.currentFrame;
  const duration = state.frames[idx]?.durationMs ?? Math.round(1000 / state.fps);
  pixelEngine.duplicateFrame(idx, count);
  state.insertFrameMetadata(idx + 1, duration);
  resetHistoryAfterTopologyChange();
  syncTimelineCels();
  pixelEngine.emitChange();
}

export function deleteCurrentFrameAction(): void {
  commitFloatingSelection();
  const state = useEditorStore.getState();
  const count = state.frames.length;
  if (count <= 1) {
    state.setStatusMessage("Cannot delete the last remaining frame");
    return;
  }
  const idx = state.currentFrame;
  pixelEngine.deleteFrame(idx, count);
  state.deleteFrameMetadata(idx);
  resetHistoryAfterTopologyChange();
  syncTimelineCels();
  pixelEngine.emitChange();
}

export function reorderFrameAction(fromIndex: number, toIndex: number): void {
  if (fromIndex === toIndex) return;
  commitFloatingSelection();
  const state = useEditorStore.getState();
  pixelEngine.reorderFrame(fromIndex, toIndex, state.frames.length);
  state.moveFrameMetadata(fromIndex, toIndex);
  resetHistoryAfterTopologyChange();
  syncTimelineCels();
  pixelEngine.emitChange();
}

export function toggleLinkCelAction(layerId: string, frameIndex: number): void {
  commitFloatingSelection();
  const state = useEditorStore.getState();
  const layer = state.layers.find((l) => l.id === layerId);
  if (!layer || layer.kind === "group") return;

  if (pixelEngine.isCelLinked(layerId, frameIndex)) {
    pixelEngine.unlinkCel(layerId, frameIndex);
    state.setStatusMessage(`Unlinked ${layer.name} frame ${frameIndex + 1}`);
  } else {
    if (frameIndex <= 0) {
      state.setStatusMessage("Select frame 2+ to link to the previous frame");
      return;
    }
    pixelEngine.linkCel(layerId, frameIndex, frameIndex - 1);
    state.setStatusMessage(
      `Linked ${layer.name} frame ${frameIndex + 1} to previous`
    );
  }
  resetHistoryAfterTopologyChange();
  syncTimelineCels();
  pixelEngine.emitChange();
}

export function reverseFramesAction(
  fromFrame?: number,
  toFrame?: number
): boolean {
  commitFloatingSelection();
  const state = useEditorStore.getState();
  const total = state.frames.length;
  if (total <= 1) {
    state.setStatusMessage("Need at least 2 frames to reverse");
    return false;
  }

  let lo: number;
  let hi: number;
  if (fromFrame !== undefined && toFrame !== undefined) {
    lo = Math.max(0, Math.min(total - 1, Math.min(fromFrame, toFrame)));
    hi = Math.max(0, Math.min(total - 1, Math.max(fromFrame, toFrame)));
  } else if (state.activeTagId) {
    const tag = state.tags.find((t) => t.id === state.activeTagId);
    if (tag) {
      lo = Math.max(0, Math.min(total - 1, Math.min(tag.fromFrame, tag.toFrame)));
      hi = Math.max(0, Math.min(total - 1, Math.max(tag.fromFrame, tag.toFrame)));
    } else {
      lo = 0;
      hi = total - 1;
    }
  } else {
    lo = 0;
    hi = total - 1;
  }

  if (lo >= hi) {
    state.setStatusMessage("Select at least 2 frames to reverse");
    return false;
  }

  pixelEngine.reverseFrameRange(lo, hi, total);

  const nextFrames = state.frames.slice();
  const slice = nextFrames.slice(lo, hi + 1).reverse();
  for (let i = 0; i < slice.length; i++) {
    nextFrames[lo + i] = slice[i];
  }
  const reindexed = nextFrames.map((f, idx) => ({ ...f, index: idx }));
  const nextCurrent =
    state.currentFrame >= lo && state.currentFrame <= hi
      ? hi - (state.currentFrame - lo)
      : state.currentFrame;

  useEditorStore.setState({
    frames: reindexed,
    currentFrame: nextCurrent,
    selectedCels: [],
  });

  resetHistoryAfterTopologyChange();
  syncTimelineCels();
  pixelEngine.emitChange();
  useEditorStore
    .getState()
    .setStatusMessage(`Reversed frames ${lo + 1}..${hi + 1}`);
  return true;
}

export function bulkDeleteSelectedCelsAction(): boolean {
  commitFloatingSelection();
  const state = useEditorStore.getState();
  if (state.selectedCels.length === 0) return false;

  const seen = new Set<string>();
  const targets: Array<{ layerId: string; frame: number }> = [];
  for (const item of state.selectedCels) {
    const layer = state.layers.find((l) => l.id === item.layerId);
    if (!layer || layer.kind !== "raster") continue;
    if (isLayerEffectivelyLocked(state.layers, layer.id)) continue;
    if (item.frame < 0 || item.frame >= state.frames.length) continue;

    // Resolve linked owner so linked cels don't double-capture the same buffer
    const ownerFrame = pixelEngine.resolveCelFrame(item.layerId, item.frame);
    const key = `${item.layerId}:${ownerFrame}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const cel = pixelEngine.getCel(item.layerId, item.frame);
    if (!cel || cel.isEmpty()) continue;
    targets.push({ layerId: item.layerId, frame: ownerFrame });
  }

  if (targets.length === 0) {
    state.setStatusMessage("No populated unlocked cels in selection");
    return false;
  }

  pixelEngine.history.beginMultiCelTransaction("Clear Selected Cels");
  for (const target of targets) {
    const cel = pixelEngine.getOrCreateCel(target.layerId, target.frame);
    pixelEngine.history.captureMultiCel(target.layerId, target.frame, cel);
    cel.clear();
  }

  if (pixelEngine.history.commitMultiCelTransaction()) {
    syncHistoryAndCelState(state.activeLayerId, state.currentFrame);
    syncTimelineCels();
    pixelEngine.emitChange();
    state.setStatusMessage(`Cleared ${targets.length} selected cel(s)`);
    return true;
  }

  pixelEngine.history.cancelMultiCelTransaction();
  return false;
}

export function bulkSetFrameDurationAction(
  frameIndices: number[],
  durationMs: number
): void {
  const state = useEditorStore.getState();
  const clamped = Math.max(16, Math.min(5000, Math.round(durationMs) || 16));
  const indexSet = new Set(frameIndices);
  if (indexSet.size === 0) return;

  useEditorStore.setState((s) => ({
    frames: s.frames.map((f) =>
      indexSet.has(f.index) ? { ...f, durationMs: clamped } : f
    ),
  }));
  state.setStatusMessage(
    `Set duration ${clamped}ms on ${indexSet.size} frame(s)`
  );
}

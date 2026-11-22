import { useEditorStore } from "../../store/editorStore.ts";
import { pixelEngine } from "./PixelEngine.ts";
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

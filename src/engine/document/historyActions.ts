import { pixelEngine } from "./PixelEngine.ts";
import { commitFloatingSelection } from "./selectionActions.ts";
import { useEditorStore } from "../../store/editorStore.ts";

export function syncHistoryAndCelState(
  layerId?: string,
  frameIndex?: number
): void {
  const store = useEditorStore.getState();
  store.setHistoryFlags(pixelEngine.history.canUndo, pixelEngine.history.canRedo);
  if (layerId !== undefined && frameIndex !== undefined) {
    store.syncCelMetadata((lId, fIdx) => {
      const cel = pixelEngine.getCel(lId, fIdx);
      return {
        populated: cel ? !cel.isEmpty() : false,
        linked: pixelEngine.isCelLinked(lId, fIdx),
      };
    });
  }
}

export function performUndo(): void {
  commitFloatingSelection();
  const res = pixelEngine.undo();
  const store = useEditorStore.getState();
  if (!res) {
    store.setHistoryFlags(pixelEngine.history.canUndo, pixelEngine.history.canRedo);
    return;
  }
  store.selectLayer(res.layerId);
  store.setCurrentFrame(res.frameIndex);
  syncHistoryAndCelState(res.layerId, res.frameIndex);
  store.setStatusMessage(`Undo: ${res.label}`);
}

export function performRedo(): void {
  commitFloatingSelection();
  const res = pixelEngine.redo();
  const store = useEditorStore.getState();
  if (!res) {
    store.setHistoryFlags(pixelEngine.history.canUndo, pixelEngine.history.canRedo);
    return;
  }
  store.selectLayer(res.layerId);
  store.setCurrentFrame(res.frameIndex);
  syncHistoryAndCelState(res.layerId, res.frameIndex);
  store.setStatusMessage(`Redo: ${res.label}`);
}

import { pixelEngine } from "./PixelEngine.ts";
import { commitFloatingSelection } from "./selectionActions.ts";
import { useEditorStore } from "../../store/editorStore.ts";
import { rigHistory, syncRigHistoryFlags } from "../rig/rigActions.ts";

export function syncHistoryAndCelState(
  layerId?: string,
  frameIndex?: number
): void {
  const store = useEditorStore.getState();
  syncRigHistoryFlags();
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

function keepRigSelectionValid(): void {
  const store = useEditorStore.getState();
  const selectedBoneId = store.selectedBoneId;
  if (
    selectedBoneId &&
    !pixelEngine.rig.bones.some((bone) => bone.id === selectedBoneId)
  ) {
    store.setSelectedBoneId(pixelEngine.rig.bones[0]?.id ?? null);
  }
}

export function performUndo(): void {
  commitFloatingSelection();
  const store = useEditorStore.getState();
  if (store.workspaceMode === "rig") {
    const label = rigHistory.undo(pixelEngine.rig);
    if (label !== null) {
      keepRigSelectionValid();
      store.bumpRigVersion();
      pixelEngine.emitChange();
      syncRigHistoryFlags();
      store.setStatusMessage(`Undo: ${label}`);
      return;
    }
  }
  const res = pixelEngine.undo();
  if (!res) {
    syncRigHistoryFlags();
    return;
  }
  store.selectLayer(res.layerId);
  store.setCurrentFrame(res.frameIndex);
  syncHistoryAndCelState(res.layerId, res.frameIndex);
  store.setStatusMessage(`Undo: ${res.label}`);
}

export function performRedo(): void {
  commitFloatingSelection();
  const store = useEditorStore.getState();
  if (store.workspaceMode === "rig") {
    const label = rigHistory.redo(pixelEngine.rig);
    if (label !== null) {
      keepRigSelectionValid();
      store.bumpRigVersion();
      pixelEngine.emitChange();
      syncRigHistoryFlags();
      store.setStatusMessage(`Redo: ${label}`);
      return;
    }
  }
  const res = pixelEngine.redo();
  if (!res) {
    syncRigHistoryFlags();
    return;
  }
  store.selectLayer(res.layerId);
  store.setCurrentFrame(res.frameIndex);
  syncHistoryAndCelState(res.layerId, res.frameIndex);
  store.setStatusMessage(`Redo: ${res.label}`);
}

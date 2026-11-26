import { pixelEngine } from "./PixelEngine.ts";
import { commitFloatingSelection } from "./selectionActions.ts";
import { useEditorStore } from "../../store/editorStore.ts";
import {
  undoKindWorkspace,
  type UndoEntryInfo,
  type UndoHistoryEntry,
  type UndoKind,
  type UndoWorkspace,
} from "../history/UndoCoordinator.ts";
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

const WORKSPACE_NAMES: Record<UndoWorkspace, string> = {
  draw: "Draw",
  tiles: "Tiles",
  rig: "Rig",
  studio3d: "3D Studio",
  nodes: "Nodes",
};

/** "Undo: Label" in the entry's own workspace, "Undo (Rig): Label" elsewhere. */
export function formatHistoryStatus(
  verb: "Undo" | "Redo",
  kind: UndoKind,
  label: string,
  workspaceMode: string
): string {
  const ws = undoKindWorkspace(kind);
  if (ws === workspaceMode) return `${verb}: ${label}`;
  return `${verb} (${WORKSPACE_NAMES[ws]}): ${label}`;
}

type Direction = "undo" | "redo";

/**
 * Applies one coordinator entry to the domain history it belongs to. Returns
 * the label on success or null when the payload no longer exists (orphan).
 */
function applyEntry(dir: Direction, entry: UndoEntryInfo): string | null {
  const store = useEditorStore.getState();
  switch (entry.kind) {
    case "rig": {
      const label =
        dir === "undo"
          ? rigHistory.undo(pixelEngine.rig)
          : rigHistory.redo(pixelEngine.rig);
      if (label === null) return null;
      keepRigSelectionValid();
      store.bumpRigVersion();
      pixelEngine.emitChange();
      return label;
    }
    case "nodes": {
      const hist = pixelEngine.nodesHistory;
      const graphId =
        entry.ref ??
        (dir === "undo" ? hist.peekUndoGraphId() : hist.peekRedoGraphId());
      const target = pixelEngine.nodes.graphs.find((g) => g.id === graphId);
      if (!target) {
        hist.discardTop(dir);
        return null;
      }
      const res = dir === "undo" ? hist.undo(target) : hist.redo(target);
      if (!res) return null;
      // Replaces the graph recorded for this entry, not just the active one.
      pixelEngine.nodes.replaceActiveGraph(res.graph);
      store.bumpNodesVersion();
      return res.label;
    }
    case "model3d": {
      const label =
        dir === "undo"
          ? pixelEngine.model3dHistory.undo(pixelEngine.model3d)
          : pixelEngine.model3dHistory.redo(pixelEngine.model3d);
      if (label === null) return null;
      store.bumpModel3DVersion();
      pixelEngine.emitChange();
      return label;
    }
    case "cells":
    case "tileset": {
      const res =
        dir === "undo"
          ? pixelEngine.tilemapHistory.undo(pixelEngine)
          : pixelEngine.tilemapHistory.redo(pixelEngine);
      if (!res) return null;
      if (res.layerId !== undefined) store.selectLayer(res.layerId);
      if (res.frameIndex !== undefined) store.setCurrentFrame(res.frameIndex);
      store.bumpTilesetVersion();
      pixelEngine.emitChange();
      return res.label;
    }
    case "pixels": {
      const res = dir === "undo" ? pixelEngine.undo() : pixelEngine.redo();
      if (!res) return null;
      store.selectLayer(res.layerId);
      store.setCurrentFrame(res.frameIndex);
      syncHistoryAndCelState(res.layerId, res.frameIndex);
      return res.label;
    }
  }
}

function step(dir: Direction): void {
  commitFloatingSelection();
  const coordinator = pixelEngine.undoCoordinator;
  const store = useEditorStore.getState();
  for (;;) {
    const entry =
      dir === "undo" ? coordinator.peekUndoEntry() : coordinator.peekRedoEntry();
    if (!entry) break;
    const label = applyEntry(dir, entry);
    if (label === null) {
      // The domain history no longer holds this step: drop the orphan, go on.
      if (dir === "undo") coordinator.popUndoEntry(true);
      else coordinator.popRedoEntry(true);
      continue;
    }
    if (dir === "undo") coordinator.popUndoEntry();
    else coordinator.popRedoEntry();
    syncHistoryAndCelState();
    store.setStatusMessage(
      formatHistoryStatus(
        dir === "undo" ? "Undo" : "Redo",
        entry.kind,
        label,
        store.workspaceMode
      )
    );
    return;
  }
  syncRigHistoryFlags();
}

/**
 * Undoes the newest step of the single chronological timeline, whichever
 * workspace it belongs to. The user stays in the current workspace.
 */
export function performUndo(): void {
  step("undo");
}

export function performRedo(): void {
  step("redo");
}

export function getHistorySnapshot(): {
  entries: UndoHistoryEntry[];
  currentIndex: number;
} {
  return {
    entries: pixelEngine.undoCoordinator.getHistoryEntries(),
    currentIndex: pixelEngine.undoCoordinator.getCurrentIndex(),
  };
}

export function jumpToHistoryIndexAction(targetIndex: number): void {
  commitFloatingSelection();
  const entries = pixelEngine.undoCoordinator.getHistoryEntries();
  const clamped = Math.max(
    -1,
    Math.min(entries.length - 1, Math.round(targetIndex))
  );
  let cur = pixelEngine.undoCoordinator.getCurrentIndex();
  if (cur === clamped) return;

  let guard = Math.abs(clamped - cur) + 2;
  while (cur > clamped && guard-- > 0) {
    if (!pixelEngine.undoCoordinator.canUndo) break;
    performUndo();
    const next = pixelEngine.undoCoordinator.getCurrentIndex();
    if (next === cur) break;
    cur = next;
  }
  while (cur < clamped && guard-- > 0) {
    if (!pixelEngine.undoCoordinator.canRedo) break;
    performRedo();
    const next = pixelEngine.undoCoordinator.getCurrentIndex();
    if (next === cur) break;
    cur = next;
  }
}

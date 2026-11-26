import { pixelEngine } from "../document/PixelEngine.ts";
import { useEditorStore } from "../../store/editorStore.ts";
import { RigHistory } from "./RigHistory.ts";

/** Singleton rig undo stack, shared by every UI entry point. */
export const rigHistory = new RigHistory(100);

// Every real rig undo step is mirrored into the unified undo timeline.
rigHistory.onCommit = (label) => pixelEngine.undoCoordinator.record("rig", label);
pixelEngine.undoCoordinator.onRedoCleared(() => rigHistory.clearRedo());

let gestureDepth = 0;

function pushSnapshot(label: string): void {
  rigHistory.push(pixelEngine.rig, label);
}

/**
 * Refreshes the toolbar/menu undo flags from the unified undo timeline, so
 * they are identical in every workspace.
 */
export function syncRigHistoryFlags(): void {
  const coordinator = pixelEngine.undoCoordinator;
  useEditorStore
    .getState()
    .setHistoryFlags(coordinator.canUndo, coordinator.canRedo);
}

/**
 * Starts a continuous rig interaction (drag, slider, text typing). Only the
 * state at the start of the gesture is recorded, so one drag is one undo step.
 */
export function beginRigGesture(label: string): void {
  if (gestureDepth === 0) {
    pushSnapshot(label);
  }
  gestureDepth++;
}

export function endRigGesture(): void {
  if (gestureDepth === 0) return;
  gestureDepth--;
}

/** Aborts a gesture without recording anything else (e.g. panel unmount). */
export function cancelRigGesture(): void {
  gestureDepth = 0;
}

/**
 * Runs a UI rig mutation: records a snapshot first (unless a gesture is
 * already recording), then bumps the rig version and re-renders.
 */
export function mutateRig<T>(label: string, fn: () => T): T {
  if (gestureDepth === 0) {
    pushSnapshot(label);
  }
  const result = fn();
  const store = useEditorStore.getState();
  store.bumpRigVersion();
  pixelEngine.emitChange();
  syncRigHistoryFlags();
  return result;
}

/** Clears rig history when a different document is loaded or created. */
export function resetRigHistory(): void {
  rigHistory.clear();
  gestureDepth = 0;
  syncRigHistoryFlags();
}

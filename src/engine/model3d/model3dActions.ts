import { useEditorStore } from "../../store/editorStore.ts";
import { syncHistoryAndCelState } from "../document/historyActions.ts";
import { pixelEngine } from "../document/PixelEngine.ts";
import type { Model3DEngine } from "./Model3DEngine.ts";
import { deserializeModel3DScene } from "./serialization.ts";

/**
 * Pushes one chronological cross-engine undo step for a Model3D edit whose
 * "before" snapshot was captured earlier (e.g. at the start of a live drag or
 * modal operator). Skips the history entry when nothing changed. Always bumps
 * the model version so the viewport re-syncs.
 * @returns true when an undo step was recorded.
 */
export function commitModel3DUndoStep(beforeSnap: string, label: string): boolean {
  const afterSnap = pixelEngine.model3dHistory.captureSnapshot(pixelEngine.model3d);
  const changed = afterSnap !== beforeSnap;
  if (changed) {
    pixelEngine.model3dHistory.pushUndo(beforeSnap, label);
    pixelEngine.undoCoordinator.record("model3d", label);
  }
  useEditorStore.getState().bumpModel3DVersion();
  pixelEngine.emitChange();
  syncHistoryAndCelState();
  return changed;
}

/** Restores the engine to a snapshot string from `captureSnapshot` without touching history. */
export function restoreModel3DSnapshot(snapshot: string): void {
  pixelEngine.model3d.loadSnapshot(
    deserializeModel3DScene(JSON.parse(snapshot) as unknown)
  );
  useEditorStore.getState().bumpModel3DVersion();
}

/**
 * Runs a Model3D mutation inside a chronological cross-engine undo step:
 * captures before-snapshot, runs fn, pushes onto model3dHistory, records "model3d"
 * in pixelEngine.undoCoordinator, bumps editorStore.model3dVersion, and syncs history flags.
 */
export function mutateModel3D<T>(
  label: string,
  fn: (engine: Model3DEngine) => T
): T {
  const beforeSnap = pixelEngine.model3dHistory.captureSnapshot(
    pixelEngine.model3d
  );
  const result = fn(pixelEngine.model3d);
  commitModel3DUndoStep(beforeSnap, label);
  return result;
}

import { useEditorStore } from "../../store/editorStore.ts";
import { syncHistoryAndCelState } from "../document/historyActions.ts";
import { pixelEngine } from "../document/PixelEngine.ts";
import type { Model3DEngine } from "./Model3DEngine.ts";

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
  const afterSnap = pixelEngine.model3dHistory.captureSnapshot(
    pixelEngine.model3d
  );
  if (afterSnap !== beforeSnap) {
    pixelEngine.model3dHistory.pushUndo(beforeSnap, label);
    pixelEngine.undoCoordinator.record("model3d", label);
  }
  const store = useEditorStore.getState();
  store.bumpModel3DVersion();
  pixelEngine.emitChange();
  syncHistoryAndCelState();
  return result;
}

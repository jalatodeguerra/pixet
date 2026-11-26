import type { Model3DEngine } from "./Model3DEngine.ts";
import { deserializeModel3DScene } from "./serialization.ts";
import type { Model3DSceneSnapshot } from "./types.ts";

interface Model3DHistoryEntry {
  label: string;
  snapshot: string;
}

export const DEFAULT_MODEL3D_HISTORY_LIMIT = 100;

/**
 * Snapshot-based undo stack for Low-Poly 3D edits, coordinated chronologically
 * with PixelEngine & TilemapHistory via UndoCoordinator ("model3d").
 */
export class Model3DHistory {
  readonly limit: number;
  private undoEntries: Model3DHistoryEntry[] = [];
  private redoEntries: Model3DHistoryEntry[] = [];

  constructor(limit = DEFAULT_MODEL3D_HISTORY_LIMIT) {
    this.limit = Math.max(1, Math.floor(limit));
  }

  get canUndo(): boolean {
    return this.undoEntries.length > 0;
  }

  get canRedo(): boolean {
    return this.redoEntries.length > 0;
  }

  captureSnapshot(engine: Pick<Model3DEngine, "toSnapshot">): string {
    return JSON.stringify(engine.toSnapshot());
  }

  pushUndo(beforeSnap: string | Model3DSceneSnapshot, label: string): void {
    const serialized =
      typeof beforeSnap === "string" ? beforeSnap : JSON.stringify(beforeSnap);
    this.undoEntries.push({
      label: label.trim() || "3D Model Edit",
      snapshot: serialized,
    });
    while (this.undoEntries.length > this.limit) {
      this.undoEntries.shift();
    }
    this.redoEntries = [];
  }

  undo(engine: Model3DEngine): string | null {
    const entry = this.undoEntries.pop();
    if (!entry) return null;

    this.redoEntries.push({
      label: entry.label,
      snapshot: this.captureSnapshot(engine),
    });
    while (this.redoEntries.length > this.limit) {
      this.redoEntries.shift();
    }

    const parsed = deserializeModel3DScene(JSON.parse(entry.snapshot) as unknown);
    engine.loadSnapshot(parsed);
    return entry.label;
  }

  redo(engine: Model3DEngine): string | null {
    const entry = this.redoEntries.pop();
    if (!entry) return null;

    this.undoEntries.push({
      label: entry.label,
      snapshot: this.captureSnapshot(engine),
    });
    while (this.undoEntries.length > this.limit) {
      this.undoEntries.shift();
    }

    const parsed = deserializeModel3DScene(JSON.parse(entry.snapshot) as unknown);
    engine.loadSnapshot(parsed);
    return entry.label;
  }

  clear(): void {
    this.undoEntries = [];
    this.redoEntries = [];
  }
}

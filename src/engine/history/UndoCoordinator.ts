export type UndoKind = "pixels" | "cells" | "tileset" | "model3d";

export interface UndoHistoryEntry {
  index: number;
  label: string;
  kind: UndoKind;
}

interface StoredUndoItem {
  kind: UndoKind;
  label: string;
}

function defaultLabelForKind(kind: UndoKind): string {
  switch (kind) {
    case "pixels":
      return "Pixel Edit";
    case "cells":
      return "Tilemap Edit";
    case "tileset":
      return "Tileset Edit";
    case "model3d":
      return "3D Model Edit";
  }
}

export class UndoCoordinator {
  private undoStack: StoredUndoItem[] = [];
  private redoStack: StoredUndoItem[] = [];
  private readonly maxEntries: number;

  constructor(maxEntries = 200) {
    this.maxEntries = maxEntries;
  }

  get canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  get canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  record(kind: UndoKind, label?: string): void {
    const trimmed = label?.trim();
    this.undoStack.push({
      kind,
      label: trimmed && trimmed.length > 0 ? trimmed : defaultLabelForKind(kind),
    });
    if (this.undoStack.length > this.maxEntries) {
      this.undoStack.shift();
    }
    this.redoStack.length = 0;
  }

  peekUndo(): UndoKind | undefined {
    return this.undoStack[this.undoStack.length - 1]?.kind;
  }

  popUndo(): UndoKind | undefined {
    const item = this.undoStack.pop();
    if (item !== undefined) {
      this.redoStack.push(item);
      return item.kind;
    }
    return undefined;
  }

  peekRedo(): UndoKind | undefined {
    return this.redoStack[this.redoStack.length - 1]?.kind;
  }

  popRedo(): UndoKind | undefined {
    const item = this.redoStack.pop();
    if (item !== undefined) {
      this.undoStack.push(item);
      return item.kind;
    }
    return undefined;
  }

  getCurrentIndex(): number {
    return this.undoStack.length - 1;
  }

  getHistoryEntries(): UndoHistoryEntry[] {
    const entries: UndoHistoryEntry[] = [];
    for (let i = 0; i < this.undoStack.length; i++) {
      const item = this.undoStack[i];
      entries.push({
        index: i,
        label: item.label,
        kind: item.kind,
      });
    }
    for (let i = this.redoStack.length - 1; i >= 0; i--) {
      const item = this.redoStack[i];
      entries.push({
        index: entries.length,
        label: item.label,
        kind: item.kind,
      });
    }
    return entries;
  }

  clear(): void {
    this.undoStack.length = 0;
    this.redoStack.length = 0;
  }
}

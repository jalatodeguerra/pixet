export type UndoKind =
  | "pixels"
  | "cells"
  | "tileset"
  | "model3d"
  | "rig"
  | "nodes";

export type UndoWorkspace = "draw" | "tiles" | "studio3d" | "rig" | "nodes";

/** Workspace an undo kind belongs to (used for status text and History tags). */
export function undoKindWorkspace(kind: UndoKind): UndoWorkspace {
  switch (kind) {
    case "pixels":
      return "draw";
    case "cells":
    case "tileset":
      return "tiles";
    case "model3d":
      return "studio3d";
    case "rig":
      return "rig";
    case "nodes":
      return "nodes";
  }
}

/**
 * Kinds that share one per-domain history stack, with that stack's capacity.
 * When the coordinator holds more entries for a group than the domain history
 * can restore, the oldest entry of the group is dropped so it never points at
 * a payload that no longer exists.
 */
export interface UndoGroupLimit {
  kinds: readonly UndoKind[];
  limit: number;
}
import { markDirty } from "../io/documentState.ts";

export interface UndoHistoryEntry {
  index: number;
  label: string;
  kind: UndoKind;
  /** Extra target info, e.g. the node graph id a "nodes" entry belongs to. */
  ref?: string;
}

export interface UndoEntryInfo {
  kind: UndoKind;
  label: string;
  ref?: string;
}

interface StoredUndoItem {
  kind: UndoKind;
  label: string;
  ref?: string;
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
    case "rig":
      return "Rig Edit";
    case "nodes":
      return "Node Edit";
  }
}

export class UndoCoordinator {
  private undoStack: StoredUndoItem[] = [];
  private redoStack: StoredUndoItem[] = [];
  private readonly maxEntries: number;
  private readonly groupLimits: readonly UndoGroupLimit[];
  private readonly redoClearListeners = new Set<() => void>();

  constructor(maxEntries = 200, groupLimits: readonly UndoGroupLimit[] = []) {
    this.maxEntries = maxEntries;
    this.groupLimits = groupLimits;
  }

  /** Called whenever a new record discards the redo stack. */
  onRedoCleared(listener: () => void): () => void {
    this.redoClearListeners.add(listener);
    return () => {
      this.redoClearListeners.delete(listener);
    };
  }

  get canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  get canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  record(kind: UndoKind, label?: string, ref?: string): void {
    const trimmed = label?.trim();
    markDirty();
    this.undoStack.push({
      kind,
      label: trimmed && trimmed.length > 0 ? trimmed : defaultLabelForKind(kind),
      ref,
    });
    if (this.undoStack.length > this.maxEntries) {
      this.undoStack.shift();
    }
    this.enforceGroupLimit(kind);
    if (this.redoStack.length > 0) {
      this.redoStack.length = 0;
    }
    for (const listener of this.redoClearListeners) listener();
  }

  private enforceGroupLimit(kind: UndoKind): void {
    const group = this.groupLimits.find((g) => g.kinds.includes(kind));
    if (!group) return;
    let count = 0;
    for (const item of this.undoStack) {
      if (group.kinds.includes(item.kind)) count++;
    }
    while (count > group.limit) {
      const idx = this.undoStack.findIndex((it) => group.kinds.includes(it.kind));
      if (idx < 0) break;
      this.undoStack.splice(idx, 1);
      count--;
    }
  }

  peekUndoEntry(): UndoEntryInfo | undefined {
    const item = this.undoStack[this.undoStack.length - 1];
    return item ? { ...item } : undefined;
  }

  peekRedoEntry(): UndoEntryInfo | undefined {
    const item = this.redoStack[this.redoStack.length - 1];
    return item ? { ...item } : undefined;
  }

  /** Pops the newest undo entry onto redo; `discard` drops it instead (orphan). */
  popUndoEntry(discard = false): UndoEntryInfo | undefined {
    const item = this.undoStack.pop();
    if (!item) return undefined;
    markDirty();
    if (!discard) this.redoStack.push(item);
    return { ...item };
  }

  /** Pops the newest redo entry back onto undo; `discard` drops it instead. */
  popRedoEntry(discard = false): UndoEntryInfo | undefined {
    const item = this.redoStack.pop();
    if (!item) return undefined;
    markDirty();
    if (!discard) this.undoStack.push(item);
    return { ...item };
  }

  peekUndo(): UndoKind | undefined {
    return this.undoStack[this.undoStack.length - 1]?.kind;
  }

  popUndo(): UndoKind | undefined {
    const item = this.undoStack.pop();
    if (item !== undefined) {
      markDirty();
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
      markDirty();
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
        ...(item.ref !== undefined ? { ref: item.ref } : {}),
      });
    }
    for (let i = this.redoStack.length - 1; i >= 0; i--) {
      const item = this.redoStack[i];
      entries.push({
        index: entries.length,
        label: item.label,
        kind: item.kind,
        ...(item.ref !== undefined ? { ref: item.ref } : {}),
      });
    }
    return entries;
  }

  clear(): void {
    this.undoStack.length = 0;
    this.redoStack.length = 0;
  }
}

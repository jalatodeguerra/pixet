export type UndoKind = "pixels" | "cells" | "tileset";

export class UndoCoordinator {
  private undoStack: UndoKind[] = [];
  private redoStack: UndoKind[] = [];
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

  record(kind: UndoKind): void {
    this.undoStack.push(kind);
    if (this.undoStack.length > this.maxEntries) {
      this.undoStack.shift();
    }
    this.redoStack.length = 0;
  }

  peekUndo(): UndoKind | undefined {
    return this.undoStack[this.undoStack.length - 1];
  }

  popUndo(): UndoKind | undefined {
    const kind = this.undoStack.pop();
    if (kind !== undefined) {
      this.redoStack.push(kind);
    }
    return kind;
  }

  peekRedo(): UndoKind | undefined {
    return this.redoStack[this.redoStack.length - 1];
  }

  popRedo(): UndoKind | undefined {
    const kind = this.redoStack.pop();
    if (kind !== undefined) {
      this.undoStack.push(kind);
    }
    return kind;
  }

  clear(): void {
    this.undoStack.length = 0;
    this.redoStack.length = 0;
  }
}

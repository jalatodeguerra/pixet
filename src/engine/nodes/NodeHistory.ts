import { cloneGraph } from "./NodeGraph.ts";
import type { NodeGraph } from "./types.ts";

interface HistoryEntry {
  before: NodeGraph;
  after: NodeGraph;
  label: string;
}

interface PendingTransaction {
  before: NodeGraph;
  beforeJson: string;
  label: string;
}

export class NodeHistory {
  private readonly undoStack: HistoryEntry[] = [];
  private readonly redoStack: HistoryEntry[] = [];
  private readonly maxEntries: number;
  private pending: PendingTransaction | null = null;

  constructor(maxEntries = 100) {
    this.maxEntries = maxEntries;
  }

  push(before: NodeGraph, after: NodeGraph, label: string): void {
    if (JSON.stringify(before) === JSON.stringify(after)) return;
    this.undoStack.push({
      before: cloneGraph(before),
      after: cloneGraph(after),
      label,
    });
    if (this.undoStack.length > this.maxEntries) {
      this.undoStack.shift();
    }
    this.redoStack.length = 0;
  }

  beginTransaction(before: NodeGraph, label: string): void {
    this.pending = {
      before: cloneGraph(before),
      beforeJson: JSON.stringify(before),
      label,
    };
  }

  commitTransaction(after: NodeGraph): boolean {
    if (!this.pending) return false;
    const tx = this.pending;
    this.pending = null;
    if (JSON.stringify(after) === tx.beforeJson) {
      return false;
    }
    this.undoStack.push({
      before: tx.before,
      after: cloneGraph(after),
      label: tx.label,
    });
    if (this.undoStack.length > this.maxEntries) {
      this.undoStack.shift();
    }
    this.redoStack.length = 0;
    return true;
  }

  cancelTransaction(): void {
    this.pending = null;
  }

  hasPendingTransaction(): boolean {
    return this.pending !== null;
  }

  undo(current: NodeGraph): { graph: NodeGraph; label: string } | null {
    const entry = this.undoStack.pop();
    if (!entry) return null;
    this.redoStack.push({
      before: cloneGraph(entry.before),
      after: cloneGraph(current),
      label: entry.label,
    });
    return { graph: cloneGraph(entry.before), label: entry.label };
  }

  redo(current: NodeGraph): { graph: NodeGraph; label: string } | null {
    const entry = this.redoStack.pop();
    if (!entry) return null;
    this.undoStack.push({
      before: cloneGraph(current),
      after: cloneGraph(entry.after),
      label: entry.label,
    });
    return { graph: cloneGraph(entry.after), label: entry.label };
  }

  canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  clear(): void {
    this.undoStack.length = 0;
    this.redoStack.length = 0;
    this.pending = null;
  }
}

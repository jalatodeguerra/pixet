import { cloneGraph } from "./NodeGraph.ts";
import type { NodeGraph } from "./types.ts";
import { markDirty } from "../io/documentState.ts";

interface HistoryEntry {
  graphId: string;
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
  /** Fired after a new undo step was recorded, with the graph it belongs to. */
  onCommit?: (label: string, graphId: string) => void;

  constructor(maxEntries = 100) {
    this.maxEntries = maxEntries;
  }

  push(before: NodeGraph, after: NodeGraph, label: string): void {
    if (JSON.stringify(before) === JSON.stringify(after)) return;
    markDirty();
    this.undoStack.push({
      graphId: after.id,
      before: cloneGraph(before),
      after: cloneGraph(after),
      label,
    });
    if (this.undoStack.length > this.maxEntries) {
      this.undoStack.shift();
    }
    this.redoStack.length = 0;
    this.onCommit?.(label, after.id);
  }

  clearRedo(): void {
    this.redoStack.length = 0;
  }

  /** Graph id the next undo step targets. */
  peekUndoGraphId(): string | undefined {
    return this.undoStack[this.undoStack.length - 1]?.graphId;
  }

  /** Graph id the next redo step targets. */
  peekRedoGraphId(): string | undefined {
    return this.redoStack[this.redoStack.length - 1]?.graphId;
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
    markDirty();
    this.undoStack.push({
      graphId: after.id,
      before: tx.before,
      after: cloneGraph(after),
      label: tx.label,
    });
    if (this.undoStack.length > this.maxEntries) {
      this.undoStack.shift();
    }
    this.redoStack.length = 0;
    this.onCommit?.(tx.label, after.id);
    return true;
  }

  cancelTransaction(): void {
    this.pending = null;
  }

  hasPendingTransaction(): boolean {
    return this.pending !== null;
  }

  /** Discards the newest undo/redo step without applying it (target graph gone). */
  discardTop(which: "undo" | "redo"): void {
    const entry = which === "undo" ? this.undoStack.pop() : this.redoStack.pop();
    if (entry) markDirty();
  }

  undo(current: NodeGraph): { graph: NodeGraph; label: string } | null {
    const entry = this.undoStack.pop();
    if (!entry) return null;
    markDirty();
    this.redoStack.push({
      graphId: entry.graphId,
      before: cloneGraph(entry.before),
      after: cloneGraph(current),
      label: entry.label,
    });
    return { graph: cloneGraph(entry.before), label: entry.label };
  }

  redo(current: NodeGraph): { graph: NodeGraph; label: string } | null {
    const entry = this.redoStack.pop();
    if (!entry) return null;
    markDirty();
    this.undoStack.push({
      graphId: entry.graphId,
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

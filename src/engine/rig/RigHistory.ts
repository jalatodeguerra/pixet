import type { RigSnapshot } from "./RigEngine.ts";
import { markDirty } from "../io/documentState.ts";

export interface RigHistoryHost {
  toSnapshot(): RigSnapshot;
  fromSnapshot(snapshot: unknown): void;
}

interface RigHistoryEntry {
  label: string;
  snapshot: string;
}

export const DEFAULT_RIG_HISTORY_LIMIT = 100;

/**
 * Snapshot-based undo stack for rig edits. Snapshots are stored as JSON
 * strings so entries are immutable and cheap to compare/serialize.
 */
export class RigHistory {
  readonly limit: number;
  private undoEntries: RigHistoryEntry[] = [];
  private redoEntries: RigHistoryEntry[] = [];
  /** Fired after a new undo step was actually recorded (not for no-op pushes). */
  onCommit?: (label: string) => void;

  constructor(limit = DEFAULT_RIG_HISTORY_LIMIT) {
    this.limit = Math.max(1, Math.floor(limit));
  }

  get canUndo(): boolean {
    return this.undoEntries.length > 0;
  }

  get canRedo(): boolean {
    return this.redoEntries.length > 0;
  }

  /** Records the rig as it is right now, before a mutation happens. */
  push(rig: RigHistoryHost, label: string): void {
    const snapshot = this.capture(rig);
    const top = this.undoEntries[this.undoEntries.length - 1];
    if (top && top.snapshot === snapshot) return;
    markDirty();
    this.undoEntries.push({ label, snapshot });
    while (this.undoEntries.length > this.limit) {
      this.undoEntries.shift();
    }
    this.redoEntries = [];
    this.onCommit?.(label);
  }

  /** Drops redo steps (a newer edit elsewhere in the unified timeline). */
  clearRedo(): void {
    this.redoEntries = [];
  }

  /** Restores the previous snapshot and moves the current one to redo. */
  undo(rig: RigHistoryHost): string | null {
    const entry = this.undoEntries.pop();
    if (!entry) return null;
    markDirty();
    this.redoEntries.push({ label: entry.label, snapshot: this.capture(rig) });
    while (this.redoEntries.length > this.limit) {
      this.redoEntries.shift();
    }
    this.restore(rig, entry.snapshot);
    return entry.label;
  }

  /** Re-applies the last undone snapshot. */
  redo(rig: RigHistoryHost): string | null {
    const entry = this.redoEntries.pop();
    if (!entry) return null;
    markDirty();
    this.undoEntries.push({ label: entry.label, snapshot: this.capture(rig) });
    while (this.undoEntries.length > this.limit) {
      this.undoEntries.shift();
    }
    this.restore(rig, entry.snapshot);
    return entry.label;
  }

  clear(): void {
    this.undoEntries = [];
    this.redoEntries = [];
  }

  private capture(rig: RigHistoryHost): string {
    return JSON.stringify(rig.toSnapshot());
  }

  private restore(rig: RigHistoryHost, snapshot: string): void {
    rig.fromSnapshot(JSON.parse(snapshot) as unknown);
  }
}

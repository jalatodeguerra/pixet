import {
  type AutoTileRuleset,
  deserializeAutoTileRuleset,
  type SerializedAutoTileRuleset,
  serializeAutoTileRuleset,
} from "./autoTile.ts";
import { type AutoMapRule, cloneAutoMapRules } from "./automap.ts";
import { cloneTerrainSets, type TerrainSet } from "./terrain.ts";
import { TilemapData } from "./TilemapEngine.ts";
import {
  TilesetRegistry,
  type TilesetRegistrySnapshot,
} from "./Tileset.ts";

export interface CellDelta {
  col: number;
  row: number;
  before: number;
  after: number;
}

export interface CellHistoryEntry {
  kind: "cells";
  label: string;
  layerId: string;
  frameIndex: number;
  deltas: CellDelta[];
}

export interface TilemapHistorySnapshot {
  registry: TilesetRegistrySnapshot;
  tilemaps: Array<{
    key: string;
    cols: number;
    rows: number;
    cells: number[];
  }>;
  autoTileRuleset: SerializedAutoTileRuleset | null;
  terrainSets: TerrainSet[];
  autoMapRules: AutoMapRule[];
}

export interface TilesetSnapshotEntry {
  kind: "tileset";
  label: string;
  before: TilemapHistorySnapshot;
  after: TilemapHistorySnapshot;
}

export type TilemapHistoryEntry = CellHistoryEntry | TilesetSnapshotEntry;

export interface TilemapHistoryTarget {
  readonly tilesetRegistry: TilesetRegistry;
  readonly tilemaps: Map<string, TilemapData>;
  autoTileRuleset: AutoTileRuleset | null;
  terrainSets: TerrainSet[];
  autoMapRules: AutoMapRule[];
  getOrCreateTilemap(layerId: string, frameIndex: number): TilemapData;
}

export function captureTilemapHistorySnapshot(
  target: TilemapHistoryTarget
): TilemapHistorySnapshot {
  const tilemaps: TilemapHistorySnapshot["tilemaps"] = [];
  for (const [key, tm] of target.tilemaps.entries()) {
    tilemaps.push({
      key,
      cols: tm.cols,
      rows: tm.rows,
      cells: Array.from(tm.grid),
    });
  }
  return {
    registry: target.tilesetRegistry.toSnapshot(),
    tilemaps,
    autoTileRuleset: serializeAutoTileRuleset(target.autoTileRuleset),
    terrainSets: cloneTerrainSets(target.terrainSets),
    autoMapRules: cloneAutoMapRules(target.autoMapRules),
  };
}

export function restoreTilemapHistorySnapshot(
  target: TilemapHistoryTarget,
  snap: TilemapHistorySnapshot
): void {
  target.tilesetRegistry.fromSnapshot(snap.registry);
  target.tilemaps.clear();
  for (const item of snap.tilemaps) {
    target.tilemaps.set(
      item.key,
      new TilemapData(item.cols, item.rows, new Uint32Array(item.cells))
    );
  }
  target.autoTileRuleset = deserializeAutoTileRuleset(snap.autoTileRuleset);
  target.terrainSets = cloneTerrainSets(snap.terrainSets ?? []);
  target.autoMapRules = cloneAutoMapRules(snap.autoMapRules ?? []);
}

interface ActiveCellTransaction {
  label: string;
  layerId: string;
  frameIndex: number;
  deltas: Map<string, CellDelta>;
}

export class TilemapHistory {
  private undoStack: TilemapHistoryEntry[] = [];
  private redoStack: TilemapHistoryEntry[] = [];
  private activeTx: ActiveCellTransaction | null = null;
  private readonly maxCellEntries: number;
  private readonly maxTilesetEntries: number;
  onCommit?: (kind: "cells" | "tileset") => void;

  constructor(maxCellEntries = 100, maxTilesetEntries = 50) {
    this.maxCellEntries = maxCellEntries;
    this.maxTilesetEntries = maxTilesetEntries;
  }

  get canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  get canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  beginCells(label: string, layerId: string, frameIndex: number): void {
    this.activeTx = {
      label,
      layerId,
      frameIndex,
      deltas: new Map(),
    };
  }

  recordCell(col: number, row: number, before: number, after: number): void {
    if (!this.activeTx) return;
    const key = `${col},${row}`;
    const existing = this.activeTx.deltas.get(key);
    if (existing) {
      existing.after = after >>> 0;
      return;
    }
    this.activeTx.deltas.set(key, {
      col,
      row,
      before: before >>> 0,
      after: after >>> 0,
    });
  }

  commitCells(): boolean {
    if (!this.activeTx) return false;
    const tx = this.activeTx;
    this.activeTx = null;

    const changed: CellDelta[] = [];
    for (const d of tx.deltas.values()) {
      if (d.before !== d.after) {
        changed.push(d);
      }
    }
    if (changed.length === 0) return false;

    this.pushEntry({
      kind: "cells",
      label: tx.label,
      layerId: tx.layerId,
      frameIndex: tx.frameIndex,
      deltas: changed,
    });
    this.onCommit?.("cells");
    return true;
  }

  cancelCells(): void {
    this.activeTx = null;
  }

  pushTilesetSnapshot(
    label: string,
    before: TilemapHistorySnapshot,
    after: TilemapHistorySnapshot
  ): void {
    this.pushEntry({
      kind: "tileset",
      label,
      before,
      after,
    });
    this.onCommit?.("tileset");
  }

  private pushEntry(entry: TilemapHistoryEntry): void {
    this.undoStack.push(entry);
    this.redoStack.length = 0;

    let cellCount = 0;
    let tilesetCount = 0;
    for (const e of this.undoStack) {
      if (e.kind === "cells") cellCount++;
      else tilesetCount++;
    }
    while (cellCount > this.maxCellEntries) {
      const idx = this.undoStack.findIndex((e) => e.kind === "cells");
      if (idx === -1) break;
      this.undoStack.splice(idx, 1);
      cellCount--;
    }
    while (tilesetCount > this.maxTilesetEntries) {
      const idx = this.undoStack.findIndex((e) => e.kind === "tileset");
      if (idx === -1) break;
      this.undoStack.splice(idx, 1);
      tilesetCount--;
    }
  }

  undo(
    target: TilemapHistoryTarget
  ): {
    kind: "cells" | "tileset";
    label: string;
    layerId?: string;
    frameIndex?: number;
  } | null {
    const entry = this.undoStack.pop();
    if (!entry) return null;

    if (entry.kind === "cells") {
      const tm = target.getOrCreateTilemap(entry.layerId, entry.frameIndex);
      for (const d of entry.deltas) {
        tm.setCell(d.col, d.row, d.before);
      }
      this.redoStack.push(entry);
      return {
        kind: "cells",
        label: entry.label,
        layerId: entry.layerId,
        frameIndex: entry.frameIndex,
      };
    }

    restoreTilemapHistorySnapshot(target, entry.before);
    this.redoStack.push(entry);
    return { kind: "tileset", label: entry.label };
  }

  redo(
    target: TilemapHistoryTarget
  ): {
    kind: "cells" | "tileset";
    label: string;
    layerId?: string;
    frameIndex?: number;
  } | null {
    const entry = this.redoStack.pop();
    if (!entry) return null;

    if (entry.kind === "cells") {
      const tm = target.getOrCreateTilemap(entry.layerId, entry.frameIndex);
      for (const d of entry.deltas) {
        tm.setCell(d.col, d.row, d.after);
      }
      this.undoStack.push(entry);
      return {
        kind: "cells",
        label: entry.label,
        layerId: entry.layerId,
        frameIndex: entry.frameIndex,
      };
    }

    restoreTilemapHistorySnapshot(target, entry.after);
    this.undoStack.push(entry);
    return { kind: "tileset", label: entry.label };
  }

  clear(): void {
    this.undoStack.length = 0;
    this.redoStack.length = 0;
    this.activeTx = null;
  }
}

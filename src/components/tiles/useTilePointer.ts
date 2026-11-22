import { useRef } from "react";
import { syncHistoryAndCelState } from "../../engine/document/historyActions";
import { pixelEngine } from "../../engine/document/PixelEngine";
import { commitFloatingSelection } from "../../engine/document/selectionActions";
import { packCell, unpackCell } from "../../engine/tiles/cell";
import {
  applyCellChanges,
  computeBrushStroke,
  computeEraserStroke,
  computeFloodFill,
  computeLineStroke,
  computeRandomStroke,
  computeRectFill,
  computeSelectionMove,
  createSingleTileBrush,
  extractBrushFromRegion,
  plotCellLine,
  type TileBrush,
  type WeightedCell,
} from "../../engine/tiles/mapTools";
import { screenToTileCell } from "../../engine/tiles/overlayGeometry";
import { paintTerrainCell } from "../../engine/tiles/terrain";
import { useEditorStore } from "../../store/editorStore";

interface UseTilePointerOptions {
  getPixelCoords: (e: React.PointerEvent<HTMLCanvasElement>) => {
    x: number;
    y: number;
  };
}

type TileStrokeKind =
  | "brush"
  | "eraser"
  | "rect"
  | "line"
  | "random"
  | "pick"
  | "selectMarquee"
  | "selectMove"
  | "terrain";

interface TileStrokeState {
  kind: TileStrokeKind;
  layerId: string;
  frameIndex: number;
  startCol: number;
  startRow: number;
  lastCol: number;
  lastRow: number;
  erase: boolean;
  shiftKey: boolean;
  altKey: boolean;
  brush: TileBrush;
  randomPool: WeightedCell[];
}

export function isTilePointerModeActive(): boolean {
  const s = useEditorStore.getState();
  return (
    (s.workspaceMode === "tiles" && s.tilesMode === "map") ||
    s.activeTool === "tileStamp"
  );
}

function resolveActiveBrush(): TileBrush {
  const state = useEditorStore.getState();
  if (state.tileBrush && state.tileBrush.cells.length > 0) {
    return {
      cols: state.tileBrush.cols,
      rows: state.tileBrush.rows,
      cells: new Uint32Array(state.tileBrush.cells),
    };
  }
  const cell = packCell(
    state.activeTilesetIndex,
    state.activeTileId,
    state.tileBrushFlags
  );
  return createSingleTileBrush(cell);
}

function buildRandomPool(): WeightedCell[] {
  const state = useEditorStore.getState();
  const ts =
    pixelEngine.tilesetRegistry.get(state.activeTilesetIndex) ??
    pixelEngine.tileset;
  const pool: WeightedCell[] = [];

  if (state.tileBrush && state.tileBrush.cells.length > 0) {
    for (const c of state.tileBrush.cells) {
      if (c === 0) continue;
      const u = unpackCell(c);
      const weight = ts.getMeta(u.localId)?.probability ?? 1;
      pool.push({
        cell: packCell(u.tilesetIndex, u.localId, state.tileBrushFlags),
        weight,
      });
    }
    if (pool.length > 0) return pool;
  }

  for (let id = 1; id <= ts.count; id++) {
    const weight = ts.getMeta(id)?.probability ?? 1;
    if (weight > 0) {
      pool.push({
        cell: packCell(state.activeTilesetIndex, id, state.tileBrushFlags),
        weight,
      });
    }
  }
  return pool;
}

export function useTilePointer({ getPixelCoords }: UseTilePointerOptions) {
  const strokeRef = useRef<TileStrokeState | null>(null);

  const paintTerrainAt = (
    layerId: string,
    frameIndex: number,
    col: number,
    row: number,
    erase: boolean
  ) => {
    const state = useEditorStore.getState();
    const tm = pixelEngine.getOrCreateTilemap(layerId, frameIndex);

    const activeSet =
      pixelEngine.terrainSets.find((s) => s.id === state.activeTerrainSetId) ??
      pixelEngine.terrainSets[0];
    if (activeSet) {
      const terrainId = erase
        ? null
        : (state.activeTerrainId ?? activeSet.terrains[0]?.id ?? null);
      const ts = pixelEngine.tilesetRegistry.get(activeSet.tilesetIndex);
      const changes = paintTerrainCell(
        tm,
        col,
        row,
        activeSet,
        terrainId,
        ts,
        state.tileRandomSeed
      );
      applyCellChanges(tm, changes, pixelEngine.tilemapHistory);
      return;
    }

    const before = new Map<string, number>();
    for (let dr = -1; dr <= 1; dr++) {
      for (let dc = -1; dc <= 1; dc++) {
        const nc = col + dc;
        const nr = row + dr;
        if (nc >= 0 && nr >= 0 && nc < tm.cols && nr < tm.rows) {
          before.set(`${nc},${nr}`, tm.getCell(nc, nr));
        }
      }
    }
    pixelEngine.paintAutoTileAtCell(
      layerId,
      frameIndex,
      col,
      row,
      erase,
      state.autoTileMode
    );
    for (const [k, oldVal] of before.entries()) {
      const [nc, nr] = k.split(",").map(Number);
      const newVal = tm.getCell(nc, nr);
      if (oldVal !== newVal) {
        pixelEngine.tilemapHistory.recordCell(nc, nr, oldVal, newVal);
      }
    }
  };

  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>): boolean => {
    if (!isTilePointerModeActive()) return false;
    commitFloatingSelection();

    const state = useEditorStore.getState();
    const { x: px, y: py } = getPixelCoords(e);
    const { col, row } = screenToTileCell(
      px,
      py,
      state.canvasWidth,
      state.tileWidth,
      state.tileHeight,
      state.tileProjection
    );
    state.setHoveredTileCell({ col, row });

    const activeLayer = state.layers.find((l) => l.id === state.activeLayerId);
    if (!activeLayer || activeLayer.kind !== "tilemap") {
      state.setStatusMessage("Add or select a Tilemap layer to edit tiles");
      return true;
    }

    const tool = state.workspaceMode === "tiles" ? state.tileTool : "stamp";
    const isSecondary = e.button === 2;

    if (e.altKey || tool === "picker") {
      e.currentTarget.setPointerCapture(e.pointerId);
      state.setTileMarqueeRect({
        c0: col,
        r0: row,
        c1: col,
        r1: row,
        kind: "pick",
      });
      strokeRef.current = {
        kind: "pick",
        layerId: activeLayer.id,
        frameIndex: state.currentFrame,
        startCol: col,
        startRow: row,
        lastCol: col,
        lastRow: row,
        erase: false,
        shiftKey: e.shiftKey,
        altKey: e.altKey,
        brush: createSingleTileBrush(0),
        randomPool: [],
      };
      return true;
    }

    if (tool === "select") {
      e.currentTarget.setPointerCapture(e.pointerId);
      const key = `${col},${row}`;
      const selectedSet = new Set(state.tileSelection);
      if (selectedSet.has(key) && !e.shiftKey && !e.altKey) {
        strokeRef.current = {
          kind: "selectMove",
          layerId: activeLayer.id,
          frameIndex: state.currentFrame,
          startCol: col,
          startRow: row,
          lastCol: col,
          lastRow: row,
          erase: false,
          shiftKey: false,
          altKey: false,
          brush: createSingleTileBrush(0),
          randomPool: [],
        };
      } else {
        state.setTileMarqueeRect({
          c0: col,
          r0: row,
          c1: col,
          r1: row,
          kind: "select",
        });
        strokeRef.current = {
          kind: "selectMarquee",
          layerId: activeLayer.id,
          frameIndex: state.currentFrame,
          startCol: col,
          startRow: row,
          lastCol: col,
          lastRow: row,
          erase: false,
          shiftKey: e.shiftKey,
          altKey: e.altKey,
          brush: createSingleTileBrush(0),
          randomPool: [],
        };
      }
      return true;
    }

    const erase = isSecondary || tool === "eraser" || state.activeTileId === 0;
    const brush = erase ? createSingleTileBrush(0) : resolveActiveBrush();
    const tm = pixelEngine.getOrCreateTilemap(activeLayer.id, state.currentFrame);

    if (tool === "fill") {
      const fillBrush = isSecondary ? createSingleTileBrush(0) : brush;
      const changes = computeFloodFill(
        tm,
        col,
        row,
        fillBrush,
        state.tileFillContiguous
      );
      if (changes.length > 0) {
        pixelEngine.tilemapHistory.beginCells(
          "Flood Fill Tiles",
          activeLayer.id,
          state.currentFrame
        );
        applyCellChanges(tm, changes, pixelEngine.tilemapHistory);
        pixelEngine.tilemapHistory.commitCells();
        syncHistoryAndCelState(activeLayer.id, state.currentFrame);
        pixelEngine.emitChange();
      }
      return true;
    }

    e.currentTarget.setPointerCapture(e.pointerId);

    if (tool === "rect" || tool === "line") {
      const preview =
        tool === "rect"
          ? computeRectFill(tm, col, row, col, row, brush)
          : computeLineStroke(
              tm,
              col,
              row,
              col,
              row,
              brush,
              e.shiftKey,
              state.tileBrushAnchor
            );
      state.setTilePreviewChanges(
        preview.map((c) => ({ col: c.col, row: c.row, cell: c.after }))
      );
      strokeRef.current = {
        kind: tool,
        layerId: activeLayer.id,
        frameIndex: state.currentFrame,
        startCol: col,
        startRow: row,
        lastCol: col,
        lastRow: row,
        erase,
        shiftKey: e.shiftKey,
        altKey: e.altKey,
        brush,
        randomPool: [],
      };
      return true;
    }

    const useAutoTile =
      tool === "terrain" ||
      (state.autoTileEnabled &&
        (pixelEngine.terrainSets.length > 0 ||
          pixelEngine.autoTileRuleset !== null) &&
        !erase);

    if (
      useAutoTile &&
      (pixelEngine.terrainSets.length > 0 || pixelEngine.autoTileRuleset)
    ) {
      pixelEngine.tilemapHistory.beginCells(
        "Paint Terrain",
        activeLayer.id,
        state.currentFrame
      );
      paintTerrainAt(activeLayer.id, state.currentFrame, col, row, erase);
      strokeRef.current = {
        kind: "terrain",
        layerId: activeLayer.id,
        frameIndex: state.currentFrame,
        startCol: col,
        startRow: row,
        lastCol: col,
        lastRow: row,
        erase,
        shiftKey: e.shiftKey,
        altKey: e.altKey,
        brush,
        randomPool: [],
      };
      pixelEngine.emitChange();
      return true;
    }

    if (tool === "random" && !erase) {
      const pool = buildRandomPool();
      pixelEngine.tilemapHistory.beginCells(
        "Random Tile Brush",
        activeLayer.id,
        state.currentFrame
      );
      const changes = computeRandomStroke(
        tm,
        [{ col, row }],
        pool,
        state.tileRandomSeed
      );
      applyCellChanges(tm, changes, pixelEngine.tilemapHistory);
      strokeRef.current = {
        kind: "random",
        layerId: activeLayer.id,
        frameIndex: state.currentFrame,
        startCol: col,
        startRow: row,
        lastCol: col,
        lastRow: row,
        erase: false,
        shiftKey: e.shiftKey,
        altKey: e.altKey,
        brush,
        randomPool: pool,
      };
      pixelEngine.emitChange();
      return true;
    }

    if (erase && tool === "eraser") {
      pixelEngine.tilemapHistory.beginCells(
        "Erase Tiles",
        activeLayer.id,
        state.currentFrame
      );
      const changes = computeEraserStroke(
        tm,
        col,
        row,
        col,
        row,
        state.tileEraserSize
      );
      applyCellChanges(tm, changes, pixelEngine.tilemapHistory);
      strokeRef.current = {
        kind: "eraser",
        layerId: activeLayer.id,
        frameIndex: state.currentFrame,
        startCol: col,
        startRow: row,
        lastCol: col,
        lastRow: row,
        erase: true,
        shiftKey: e.shiftKey,
        altKey: e.altKey,
        brush,
        randomPool: [],
      };
      pixelEngine.emitChange();
      return true;
    }

    pixelEngine.tilemapHistory.beginCells(
      erase ? "Erase Tile" : "Stamp Tile",
      activeLayer.id,
      state.currentFrame
    );
    const changes = computeBrushStroke(
      tm,
      col,
      row,
      col,
      row,
      brush,
      state.tileBrushAnchor
    );
    applyCellChanges(tm, changes, pixelEngine.tilemapHistory);
    strokeRef.current = {
      kind: "brush",
      layerId: activeLayer.id,
      frameIndex: state.currentFrame,
      startCol: col,
      startRow: row,
      lastCol: col,
      lastRow: row,
      erase,
      shiftKey: e.shiftKey,
      altKey: e.altKey,
      brush,
      randomPool: [],
    };
    pixelEngine.emitChange();
    return true;
  };

  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>): boolean => {
    if (!isTilePointerModeActive()) return false;
    const state = useEditorStore.getState();
    const { x: px, y: py } = getPixelCoords(e);
    const { col, row } = screenToTileCell(
      px,
      py,
      state.canvasWidth,
      state.tileWidth,
      state.tileHeight,
      state.tileProjection
    );
    state.setHoveredTileCell({ col, row });

    const stroke = strokeRef.current;
    if (!stroke) return true;

    const tm = pixelEngine.getOrCreateTilemap(stroke.layerId, stroke.frameIndex);

    if (stroke.kind === "pick" || stroke.kind === "selectMarquee") {
      stroke.lastCol = col;
      stroke.lastRow = row;
      state.setTileMarqueeRect({
        c0: stroke.startCol,
        r0: stroke.startRow,
        c1: col,
        r1: row,
        kind: stroke.kind === "pick" ? "pick" : "select",
      });
      return true;
    }

    if (stroke.kind === "selectMove") {
      stroke.lastCol = col;
      stroke.lastRow = row;
      const dCol = col - stroke.startCol;
      const dRow = row - stroke.startRow;
      const changes = computeSelectionMove(
        tm,
        new Set(state.tileSelection),
        dCol,
        dRow
      );
      state.setTilePreviewChanges(
        changes.map((c) => ({ col: c.col, row: c.row, cell: c.after }))
      );
      return true;
    }

    if (stroke.kind === "rect") {
      stroke.lastCol = col;
      stroke.lastRow = row;
      const preview = computeRectFill(
        tm,
        stroke.startCol,
        stroke.startRow,
        col,
        row,
        stroke.brush
      );
      state.setTilePreviewChanges(
        preview.map((c) => ({ col: c.col, row: c.row, cell: c.after }))
      );
      return true;
    }

    if (stroke.kind === "line") {
      stroke.lastCol = col;
      stroke.lastRow = row;
      stroke.shiftKey = e.shiftKey;
      const preview = computeLineStroke(
        tm,
        stroke.startCol,
        stroke.startRow,
        col,
        row,
        stroke.brush,
        e.shiftKey,
        state.tileBrushAnchor
      );
      state.setTilePreviewChanges(
        preview.map((c) => ({ col: c.col, row: c.row, cell: c.after }))
      );
      return true;
    }

    if (col === stroke.lastCol && row === stroke.lastRow) return true;

    if (stroke.kind === "terrain") {
      const pts = plotCellLine(stroke.lastCol, stroke.lastRow, col, row);
      for (const pt of pts) {
        paintTerrainAt(
          stroke.layerId,
          stroke.frameIndex,
          pt.col,
          pt.row,
          stroke.erase
        );
      }
      stroke.lastCol = col;
      stroke.lastRow = row;
      pixelEngine.emitChange();
      return true;
    }

    if (stroke.kind === "random") {
      const pts = plotCellLine(stroke.lastCol, stroke.lastRow, col, row);
      const changes = computeRandomStroke(
        tm,
        pts,
        stroke.randomPool,
        state.tileRandomSeed
      );
      applyCellChanges(tm, changes, pixelEngine.tilemapHistory);
      stroke.lastCol = col;
      stroke.lastRow = row;
      pixelEngine.emitChange();
      return true;
    }

    if (stroke.kind === "eraser") {
      const changes = computeEraserStroke(
        tm,
        stroke.lastCol,
        stroke.lastRow,
        col,
        row,
        state.tileEraserSize
      );
      applyCellChanges(tm, changes, pixelEngine.tilemapHistory);
      stroke.lastCol = col;
      stroke.lastRow = row;
      pixelEngine.emitChange();
      return true;
    }

    const changes = computeBrushStroke(
      tm,
      stroke.lastCol,
      stroke.lastRow,
      col,
      row,
      stroke.brush,
      state.tileBrushAnchor
    );
    applyCellChanges(tm, changes, pixelEngine.tilemapHistory);
    stroke.lastCol = col;
    stroke.lastRow = row;
    pixelEngine.emitChange();
    return true;
  };

  const onPointerUp = (e: React.PointerEvent<HTMLCanvasElement>): boolean => {
    const stroke = strokeRef.current;
    if (!stroke) return isTilePointerModeActive();
    strokeRef.current = null;

    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }

    const state = useEditorStore.getState();
    const tm = pixelEngine.getOrCreateTilemap(stroke.layerId, stroke.frameIndex);

    if (stroke.kind === "pick") {
      state.setTileMarqueeRect(null);
      if (
        stroke.startCol === stroke.lastCol &&
        stroke.startRow === stroke.lastRow
      ) {
        const cell = tm.getCell(stroke.startCol, stroke.startRow);
        const u = unpackCell(cell);
        state.setTileBrush(null);
        if (u.localId === 0) {
          state.setActiveTileId(0);
          state.setStatusMessage(
            `Picked Empty cell (${stroke.startCol}, ${stroke.startRow})`
          );
        } else {
          state.setActiveTilesetIndex(u.tilesetIndex);
          state.setActiveTileId(u.localId);
          state.setTileBrushFlags({
            flipH: u.flipH,
            flipV: u.flipV,
            flipD: u.flipD,
          });
          state.setStatusMessage(
            `Picked Tile #${u.localId} at (${stroke.startCol}, ${stroke.startRow})`
          );
        }
      } else {
        const brush = extractBrushFromRegion(
          tm,
          stroke.startCol,
          stroke.startRow,
          stroke.lastCol,
          stroke.lastRow
        );
        state.setTileBrush({
          tilesetIndex: state.activeTilesetIndex,
          cols: brush.cols,
          rows: brush.rows,
          cells: Array.from(brush.cells),
        });
        state.setTileBrushFlags({ flipH: false, flipV: false, flipD: false });
        state.setTileTool("stamp");
        state.setStatusMessage(`Picked ${brush.cols}×${brush.rows} brush`);
      }
      return true;
    }

    if (stroke.kind === "selectMarquee") {
      state.setTileMarqueeRect(null);
      const minC = Math.max(0, Math.min(stroke.startCol, stroke.lastCol));
      const maxC = Math.min(
        tm.cols - 1,
        Math.max(stroke.startCol, stroke.lastCol)
      );
      const minR = Math.max(0, Math.min(stroke.startRow, stroke.lastRow));
      const maxR = Math.min(
        tm.rows - 1,
        Math.max(stroke.startRow, stroke.lastRow)
      );

      const nextSet = stroke.shiftKey || stroke.altKey
        ? new Set(state.tileSelection)
        : new Set<string>();
      for (let r = minR; r <= maxR; r++) {
        for (let c = minC; c <= maxC; c++) {
          const k = `${c},${r}`;
          if (stroke.altKey) nextSet.delete(k);
          else nextSet.add(k);
        }
      }
      state.setTileSelection(Array.from(nextSet));
      return true;
    }

    if (stroke.kind === "selectMove") {
      state.setTilePreviewChanges([]);
      const dCol = stroke.lastCol - stroke.startCol;
      const dRow = stroke.lastRow - stroke.startRow;
      if (dCol !== 0 || dRow !== 0) {
        const changes = computeSelectionMove(
          tm,
          new Set(state.tileSelection),
          dCol,
          dRow
        );
        if (changes.length > 0) {
          pixelEngine.tilemapHistory.beginCells(
            "Move Tiles",
            stroke.layerId,
            stroke.frameIndex
          );
          applyCellChanges(tm, changes, pixelEngine.tilemapHistory);
          pixelEngine.tilemapHistory.commitCells();
          syncHistoryAndCelState(stroke.layerId, stroke.frameIndex);
        }
        const shifted: string[] = [];
        for (const k of state.tileSelection) {
          const [c, r] = k.split(",").map(Number);
          const nc = c + dCol;
          const nr = r + dRow;
          if (nc >= 0 && nr >= 0 && nc < tm.cols && nr < tm.rows) {
            shifted.push(`${nc},${nr}`);
          }
        }
        state.setTileSelection(shifted);
        pixelEngine.emitChange();
      }
      return true;
    }

    if (stroke.kind === "rect" || stroke.kind === "line") {
      state.setTilePreviewChanges([]);
      const changes =
        stroke.kind === "rect"
          ? computeRectFill(
              tm,
              stroke.startCol,
              stroke.startRow,
              stroke.lastCol,
              stroke.lastRow,
              stroke.brush
            )
          : computeLineStroke(
              tm,
              stroke.startCol,
              stroke.startRow,
              stroke.lastCol,
              stroke.lastRow,
              stroke.brush,
              stroke.shiftKey,
              state.tileBrushAnchor
            );
      if (changes.length > 0) {
        pixelEngine.tilemapHistory.beginCells(
          stroke.kind === "rect" ? "Tile Rect" : "Tile Line",
          stroke.layerId,
          stroke.frameIndex
        );
        applyCellChanges(tm, changes, pixelEngine.tilemapHistory);
        pixelEngine.tilemapHistory.commitCells();
        syncHistoryAndCelState(stroke.layerId, stroke.frameIndex);
        pixelEngine.emitChange();
      }
      return true;
    }

    if (stroke.kind === "random") {
      state.setTileRandomSeed((state.tileRandomSeed + 1) >>> 0);
    }

    if (pixelEngine.tilemapHistory.commitCells()) {
      syncHistoryAndCelState(stroke.layerId, stroke.frameIndex);
    }
    pixelEngine.emitChange();
    return true;
  };

  const onPointerLeave = () => {
    useEditorStore.getState().setHoveredTileCell(null);
  };

  return {
    onPointerDown,
    onPointerMove,
    onPointerUp,
    onPointerLeave,
  };
}

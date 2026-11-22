import { useRef } from "react";
import { syncHistoryAndCelState } from "../../engine/document/historyActions";
import { pixelEngine } from "../../engine/document/PixelEngine";
import { commitFloatingSelection } from "../../engine/document/selectionActions";
import { packCell, unpackCell } from "../../engine/tiles/cell";
import { screenToTileCell } from "../../engine/tiles/overlayGeometry";
import { useEditorStore } from "../../store/editorStore";

interface UseTilePointerOptions {
  getPixelCoords: (e: React.PointerEvent<HTMLCanvasElement>) => {
    x: number;
    y: number;
  };
}

interface TileStrokeState {
  layerId: string;
  frameIndex: number;
  erase: boolean;
  useAutoTile: boolean;
  paintedCells: Set<string>;
}

export function isTilePointerModeActive(): boolean {
  const s = useEditorStore.getState();
  return (
    (s.workspaceMode === "tiles" && s.tilesMode === "map") ||
    s.activeTool === "tileStamp"
  );
}

export function useTilePointer({ getPixelCoords }: UseTilePointerOptions) {
  const strokeRef = useRef<TileStrokeState | null>(null);

  const stampAt = (
    layerId: string,
    frameIndex: number,
    col: number,
    row: number,
    erase: boolean,
    useAutoTile: boolean
  ) => {
    const state = useEditorStore.getState();
    const tm = pixelEngine.getOrCreateTilemap(layerId, frameIndex);

    if (useAutoTile && pixelEngine.autoTileRuleset) {
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
      return;
    }

    if (!erase && state.tileBrush && state.tileBrush.cells.length > 0) {
      for (let br = 0; br < state.tileBrush.rows; br++) {
        for (let bc = 0; bc < state.tileBrush.cols; bc++) {
          const raw = state.tileBrush.cells[br * state.tileBrush.cols + bc];
          if (raw === 0) continue;
          const u = unpackCell(raw);
          const packed = packCell(
            state.tileBrush.tilesetIndex,
            u.localId,
            state.tileBrushFlags
          );
          const tc = col + bc;
          const tr = row + br;
          const prev = tm.getCell(tc, tr);
          if (tm.setCell(tc, tr, packed)) {
            pixelEngine.tilemapHistory.recordCell(tc, tr, prev, packed);
          }
        }
      }
      return;
    }

    const cellValue = erase
      ? 0
      : packCell(
          state.activeTilesetIndex,
          state.activeTileId,
          state.tileBrushFlags
        );
    const prev = tm.getCell(col, row);
    if (tm.setCell(col, row, cellValue)) {
      pixelEngine.tilemapHistory.recordCell(col, row, prev, cellValue);
    }
  };

  const pickAt = (col: number, row: number) => {
    const state = useEditorStore.getState();
    const tm = pixelEngine.getTilemap(state.activeLayerId, state.currentFrame);
    if (!tm) return;
    const cell = tm.getCell(col, row);
    const u = unpackCell(cell);
    state.setTileBrush(null);
    if (u.localId === 0) {
      state.setActiveTileId(0);
      state.setStatusMessage(`Picked Empty cell (${col}, ${row})`);
      return;
    }
    state.setActiveTilesetIndex(u.tilesetIndex);
    state.setActiveTileId(u.localId);
    state.setTileBrushFlags({ flipH: u.flipH, flipV: u.flipV, flipD: u.flipD });
    state.setStatusMessage(`Picked Tile #${u.localId} at (${col}, ${row})`);
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

    if (e.altKey || (state.workspaceMode === "tiles" && state.tileTool === "picker")) {
      pickAt(col, row);
      return true;
    }

    const isSecondary = e.button === 2;
    const isEraserTool =
      state.workspaceMode === "tiles" && state.tileTool === "eraser";
    const erase = isSecondary || isEraserTool || state.activeTileId === 0;
    const useAutoTile =
      (state.workspaceMode === "tiles" && state.tileTool === "terrain") ||
      (state.autoTileEnabled && pixelEngine.autoTileRuleset !== null);

    e.currentTarget.setPointerCapture(e.pointerId);
    pixelEngine.tilemapHistory.beginCells(
      erase ? "Erase Tile" : useAutoTile ? "Paint Terrain" : "Stamp Tile",
      activeLayer.id,
      state.currentFrame
    );

    stampAt(activeLayer.id, state.currentFrame, col, row, erase, useAutoTile);
    strokeRef.current = {
      layerId: activeLayer.id,
      frameIndex: state.currentFrame,
      erase,
      useAutoTile,
      paintedCells: new Set([`${col},${row}`]),
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

    const key = `${col},${row}`;
    if (!stroke.paintedCells.has(key)) {
      stroke.paintedCells.add(key);
      stampAt(
        stroke.layerId,
        stroke.frameIndex,
        col,
        row,
        stroke.erase,
        stroke.useAutoTile
      );
      pixelEngine.emitChange();
    }
    return true;
  };

  const onPointerUp = (e: React.PointerEvent<HTMLCanvasElement>): boolean => {
    const stroke = strokeRef.current;
    if (!stroke) return isTilePointerModeActive();
    strokeRef.current = null;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
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

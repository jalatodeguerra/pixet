import {
  Copy,
  Dices,
  Grid2x2,
  Redo2,
  Scissors,
  Trash2,
  Undo2,
  X,
} from "lucide-react";
import {
  performRedo,
  performUndo,
  syncHistoryAndCelState,
} from "../../engine/document/historyActions";
import { pixelEngine } from "../../engine/document/PixelEngine";
import {
  applyCellChanges,
  computeSelectionClear,
  extractBrushFromRegion,
} from "../../engine/tiles/mapTools";
import { useEditorStore } from "../../store/editorStore";

export function copyTileSelectionToClipboard(cut: boolean): void {
  const state = useEditorStore.getState();
  if (state.tileSelection.length === 0) return;
  const tm = pixelEngine.getTilemap(state.activeLayerId, state.currentFrame);
  if (!tm) return;

  let minC = Infinity;
  let maxC = -Infinity;
  let minR = Infinity;
  let maxR = -Infinity;
  const selectedSet = new Set(state.tileSelection);

  for (const key of selectedSet) {
    const [c, r] = key.split(",").map(Number);
    if (c < minC) minC = c;
    if (c > maxC) maxC = c;
    if (r < minR) minR = r;
    if (r > maxR) maxR = r;
  }
  if (!Number.isFinite(minC)) return;

  const extracted = extractBrushFromRegion(tm, minC, minR, maxC, maxR);
  // Mask out unselected cells within the bounding box
  for (let r = minR; r <= maxR; r++) {
    for (let c = minC; c <= maxC; c++) {
      if (!selectedSet.has(`${c},${r}`)) {
        extracted.cells[(r - minR) * extracted.cols + (c - minC)] = 0;
      }
    }
  }

  const clip = {
    tilesetIndex: state.activeTilesetIndex,
    cols: extracted.cols,
    rows: extracted.rows,
    cells: Array.from(extracted.cells),
  };
  state.setTileClipboard(clip);
  state.setTileBrush(clip);

  if (cut) {
    const changes = computeSelectionClear(tm, selectedSet);
    if (changes.length > 0) {
      pixelEngine.tilemapHistory.beginCells(
        "Cut Tiles",
        state.activeLayerId,
        state.currentFrame
      );
      applyCellChanges(tm, changes, pixelEngine.tilemapHistory);
      pixelEngine.tilemapHistory.commitCells();
      syncHistoryAndCelState(state.activeLayerId, state.currentFrame);
      pixelEngine.emitChange();
    }
  }
  state.setStatusMessage(
    `${cut ? "Cut" : "Copied"} ${extracted.cols}×${extracted.rows} tile region`
  );
}

export function deleteTileSelectionCells(): void {
  const state = useEditorStore.getState();
  if (state.tileSelection.length === 0) return;
  const tm = pixelEngine.getTilemap(state.activeLayerId, state.currentFrame);
  if (!tm) return;
  const changes = computeSelectionClear(tm, new Set(state.tileSelection));
  if (changes.length === 0) return;

  pixelEngine.tilemapHistory.beginCells(
    "Delete Tiles",
    state.activeLayerId,
    state.currentFrame
  );
  applyCellChanges(tm, changes, pixelEngine.tilemapHistory);
  pixelEngine.tilemapHistory.commitCells();
  syncHistoryAndCelState(state.activeLayerId, state.currentFrame);
  pixelEngine.emitChange();
}

export function TileToolOptionsBar() {
  const canUndo = useEditorStore((s) => s.canUndo);
  const canRedo = useEditorStore((s) => s.canRedo);
  const tileTool = useEditorStore((s) => s.tileTool);
  const tileBrushAnchor = useEditorStore((s) => s.tileBrushAnchor);
  const setTileBrushAnchor = useEditorStore((s) => s.setTileBrushAnchor);
  const tileEraserSize = useEditorStore((s) => s.tileEraserSize);
  const setTileEraserSize = useEditorStore((s) => s.setTileEraserSize);
  const tileFillContiguous = useEditorStore((s) => s.tileFillContiguous);
  const toggleTileFillContiguous = useEditorStore(
    (s) => s.toggleTileFillContiguous
  );
  const setTileRandomSeed = useEditorStore((s) => s.setTileRandomSeed);
  const tileSelection = useEditorStore((s) => s.tileSelection);
  const setTileSelection = useEditorStore((s) => s.setTileSelection);
  const showTileGrid = useEditorStore((s) => s.showTileGrid);
  const toggleShowTileGrid = useEditorStore((s) => s.toggleShowTileGrid);
  const showIsoGrid = useEditorStore((s) => s.showIsoGrid);
  const toggleShowIsoGrid = useEditorStore((s) => s.toggleShowIsoGrid);

  return (
    <div className="tool-options-bar">
      <div className="options-group">
        <button
          type="button"
          className="icon-action-btn"
          style={{ width: 24, height: 24 }}
          title="Undo (Ctrl+Z)"
          disabled={!canUndo}
          onClick={performUndo}
        >
          <Undo2 size={13} />
        </button>
        <button
          type="button"
          className="icon-action-btn"
          style={{ width: 24, height: 24 }}
          title="Redo (Ctrl+Shift+Z)"
          disabled={!canRedo}
          onClick={performRedo}
        >
          <Redo2 size={13} />
        </button>
      </div>

      <div className="options-sep" />

      <div className="options-group">
        <span className="options-label">Anchor</span>
        <button
          type="button"
          className={`toggle-chip ${tileBrushAnchor === "topLeft" ? "active" : ""}`}
          onClick={() => setTileBrushAnchor("topLeft")}
        >
          Top-Left
        </button>
        <button
          type="button"
          className={`toggle-chip ${tileBrushAnchor === "center" ? "active" : ""}`}
          onClick={() => setTileBrushAnchor("center")}
        >
          Center
        </button>
      </div>

      {tileTool === "eraser" && (
        <>
          <div className="options-sep" />
          <div className="options-group">
            <span className="options-label">Eraser</span>
            {[1, 2, 3, 4, 6, 8].map((s) => (
              <button
                key={s}
                type="button"
                className={`toggle-chip ${tileEraserSize === s ? "active" : ""}`}
                onClick={() => setTileEraserSize(s)}
              >
                {s}
              </button>
            ))}
          </div>
        </>
      )}

      {tileTool === "fill" && (
        <>
          <div className="options-sep" />
          <div className="options-group">
            <button
              type="button"
              className={`toggle-chip ${tileFillContiguous ? "active" : ""}`}
              onClick={toggleTileFillContiguous}
            >
              {tileFillContiguous ? "Contiguous" : "Global Replace"}
            </button>
          </div>
        </>
      )}

      {tileTool === "random" && (
        <>
          <div className="options-sep" />
          <div className="options-group">
            <button
              type="button"
              className="toggle-chip"
              onClick={() =>
                setTileRandomSeed(Math.floor(Math.random() * 0x7fffffff))
              }
            >
              <Dices size={12} />
              <span>Re-Seed</span>
            </button>
          </div>
        </>
      )}

      {tileSelection.length > 0 && (
        <>
          <div className="options-sep" />
          <div className="options-group">
            <span className="options-label">{tileSelection.length} cells</span>
            <button
              type="button"
              className="toggle-chip"
              title="Copy Selection (Ctrl+C)"
              onClick={() => copyTileSelectionToClipboard(false)}
            >
              <Copy size={11} />
              <span>Copy</span>
            </button>
            <button
              type="button"
              className="toggle-chip"
              title="Cut Selection (Ctrl+X)"
              onClick={() => copyTileSelectionToClipboard(true)}
            >
              <Scissors size={11} />
              <span>Cut</span>
            </button>
            <button
              type="button"
              className="toggle-chip"
              title="Delete Selected Cells (Del)"
              onClick={deleteTileSelectionCells}
            >
              <Trash2 size={11} />
              <span>Delete</span>
            </button>
            <button
              type="button"
              className="toggle-chip"
              title="Clear Selection (Esc)"
              onClick={() => setTileSelection([])}
            >
              <X size={11} />
              <span>Clear</span>
            </button>
          </div>
        </>
      )}

      <div style={{ marginLeft: "auto" }} className="options-group">
        <button
          type="button"
          className={`toggle-chip ${showTileGrid ? "active" : ""}`}
          onClick={toggleShowTileGrid}
        >
          <Grid2x2 size={11} />
          <span>Tile Grid</span>
        </button>
        <button
          type="button"
          className={`toggle-chip ${showIsoGrid ? "active" : ""}`}
          onClick={toggleShowIsoGrid}
        >
          <span>Iso Grid</span>
        </button>
      </div>
    </div>
  );
}

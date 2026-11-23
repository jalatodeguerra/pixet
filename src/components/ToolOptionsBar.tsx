import {
  Box,
  FlipHorizontal2,
  FlipVertical2,
  Grid2x2,
  Grid3x3,
  Infinity as InfinityIcon,
  Redo2,
  RotateCcw,
  RotateCw,
  Sparkles,
  Square,
  Undo2,
  X,
} from "lucide-react";
import { performRedo, performUndo } from "../engine/document/historyActions";
import {
  deselectAll,
  transformSelectionOrCel,
} from "../engine/document/selectionActions";
import {
  useEditorStore,
  type BrushShape,
  type InkMode,
} from "../store/editorStore";
import { RigToolOptionsBar } from "./rig/RigToolOptionsBar";
import { TileToolOptionsBar } from "./tiles/TileToolOptionsBar";

export function ToolOptionsBar() {
  const workspaceMode = useEditorStore((s) => s.workspaceMode);
  const tilesMode = useEditorStore((s) => s.tilesMode);
  const activeTool = useEditorStore((s) => s.activeTool);
  const brushSize = useEditorStore((s) => s.brushSize);
  const setBrushSize = useEditorStore((s) => s.setBrushSize);
  const brushShape = useEditorStore((s) => s.brushShape);
  const setBrushShape = useEditorStore((s) => s.setBrushShape);
  const brushOpacity = useEditorStore((s) => s.brushOpacity);
  const setBrushOpacity = useEditorStore((s) => s.setBrushOpacity);
  const inkMode = useEditorStore((s) => s.inkMode);
  const setInkMode = useEditorStore((s) => s.setInkMode);
  const customBrush = useEditorStore((s) => s.customBrush);
  const pixelPerfect = useEditorStore((s) => s.pixelPerfect);
  const togglePixelPerfect = useEditorStore((s) => s.togglePixelPerfect);
  const shapeFilled = useEditorStore((s) => s.shapeFilled);
  const toggleShapeFilled = useEditorStore((s) => s.toggleShapeFilled);
  const fillContiguous = useEditorStore((s) => s.fillContiguous);
  const toggleFillContiguous = useEditorStore((s) => s.toggleFillContiguous);
  const symmetryX = useEditorStore((s) => s.symmetryX);
  const toggleSymmetryX = useEditorStore((s) => s.toggleSymmetryX);
  const symmetryY = useEditorStore((s) => s.symmetryY);
  const toggleSymmetryY = useEditorStore((s) => s.toggleSymmetryY);
  const showGrid = useEditorStore((s) => s.showGrid);
  const toggleShowGrid = useEditorStore((s) => s.toggleShowGrid);
  const seamlessWrap = useEditorStore((s) => s.seamlessWrap);
  const toggleSeamlessWrap = useEditorStore((s) => s.toggleSeamlessWrap);
  const showTileGrid = useEditorStore((s) => s.showTileGrid);
  const toggleShowTileGrid = useEditorStore((s) => s.toggleShowTileGrid);
  const showIsoGrid = useEditorStore((s) => s.showIsoGrid);
  const toggleShowIsoGrid = useEditorStore((s) => s.toggleShowIsoGrid);
  const isoBoxHeight = useEditorStore((s) => s.isoBoxHeight);
  const setIsoBoxHeight = useEditorStore((s) => s.setIsoBoxHeight);
  const layers = useEditorStore((s) => s.layers);
  const activeLayerId = useEditorStore((s) => s.activeLayerId);
  const canUndo = useEditorStore((s) => s.canUndo);
  const canRedo = useEditorStore((s) => s.canRedo);
  const hasSelection = useEditorStore((s) => s.hasSelection);

  const activeLayer = layers.find((l) => l.id === activeLayerId);
  const showTileControls =
    workspaceMode === "tiles" || activeLayer?.kind === "tilemap";

  const showBrushShape =
    activeTool === "pencil" ||
    activeTool === "eraser" ||
    activeTool === "fillBrush";
  const showInkControls =
    activeTool === "pencil" || activeTool === "fillBrush";

  const showShapeFillToggle =
    activeTool === "rect" || activeTool === "ellipse";
  const showSelectionControls =
    hasSelection ||
    activeTool === "marquee" ||
    activeTool === "lasso" ||
    activeTool === "wand" ||
    activeTool === "move";

  if (workspaceMode === "rig") {
    return <RigToolOptionsBar />;
  }

  if (workspaceMode === "tiles" && tilesMode === "map") {
    return <TileToolOptionsBar />;
  }

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

        <div className="option-divider" />

        <span
          className="option-label"
          style={{ textTransform: "capitalize", fontWeight: 600, color: "var(--text-primary)" }}
        >
          {activeTool}
        </span>

        <div className="option-divider" />

        <label className="option-label">
          <span>Size</span>
          <input
            type="range"
            className="compact-range"
            min={1}
            max={64}
            value={brushSize}
            onChange={(e) => setBrushSize(Number(e.target.value))}
          />
          <span className="mono-value">{brushSize}px</span>
        </label>

        {showBrushShape && (
          <label className="option-label">
            <span>Shape</span>
            <select
              className="palette-select"
              style={{ flex: "0 0 auto", width: "auto" }}
              value={brushShape}
              onChange={(e) => setBrushShape(e.target.value as BrushShape)}
              title="Brush footprint shape"
            >
              <option value="circle">Circle</option>
              <option value="square">Square</option>
              <option value="diamond">Diamond</option>
              <option value="diagonalL">Diag \</option>
              <option value="diagonalR">Diag /</option>
              {customBrush && <option value="custom">Custom</option>}
            </select>
          </label>
        )}

        {showInkControls && (
          <>
            <label className="option-label">
              <span>Opacity</span>
              <input
                type="range"
                className="compact-range"
                style={{ width: 64 }}
                min={1}
                max={100}
                value={brushOpacity}
                onChange={(e) => setBrushOpacity(Number(e.target.value))}
              />
              <span className="mono-value">{brushOpacity}%</span>
            </label>

            <label className="option-label">
              <span>Ink</span>
              <select
                className="palette-select"
                style={{ flex: "0 0 auto", width: "auto" }}
                value={inkMode}
                onChange={(e) => setInkMode(e.target.value as InkMode)}
                title="Ink blending mode"
              >
                <option value="simple">Simple</option>
                <option value="alphaBlend">Alpha</option>
                <option value="shadingRamp">Shading</option>
                <option value="replaceColor">Replace</option>
                <option value="lockAlpha">Lock α</option>
                <option value="dither">Dither</option>
              </select>
            </label>
          </>
        )}

        <button
          type="button"
          className={`toggle-chip ${pixelPerfect ? "active" : ""}`}
          onClick={togglePixelPerfect}
          title="Prevent L-shaped pixel corners while drawing"
        >
          <Sparkles size={12} />
          <span>Pixel-Perfect</span>
        </button>

        {showShapeFillToggle && (
          <button
            type="button"
            className={`toggle-chip ${shapeFilled ? "active" : ""}`}
            onClick={toggleShapeFilled}
            title="Toggle between Outline and Filled shape"
          >
            <Square size={12} fill={shapeFilled ? "currentColor" : "none"} />
            <span>{shapeFilled ? "Filled" : "Outline"}</span>
          </button>
        )}

        {(activeTool === "fill" || activeTool === "wand") && (
          <button
            type="button"
            className={`toggle-chip ${fillContiguous ? "active" : ""}`}
            onClick={toggleFillContiguous}
            title="Contiguous region vs global color match"
          >
            <span>{fillContiguous ? "Contiguous" : "Global"}</span>
          </button>
        )}

        {showSelectionControls && (
          <>
            <div className="option-divider" />
            <button
              type="button"
              className="icon-action-btn"
              style={{ width: 24, height: 24 }}
              title="Flip Horizontal"
              onClick={() => transformSelectionOrCel("flipH")}
            >
              <FlipHorizontal2 size={13} />
            </button>
            <button
              type="button"
              className="icon-action-btn"
              style={{ width: 24, height: 24 }}
              title="Flip Vertical"
              onClick={() => transformSelectionOrCel("flipV")}
            >
              <FlipVertical2 size={13} />
            </button>
            <button
              type="button"
              className="icon-action-btn"
              style={{ width: 24, height: 24 }}
              title="Rotate 90° CCW"
              onClick={() => transformSelectionOrCel("rotateCCW")}
            >
              <RotateCcw size={13} />
            </button>
            <button
              type="button"
              className="icon-action-btn"
              style={{ width: 24, height: 24 }}
              title="Rotate 90° CW"
              onClick={() => transformSelectionOrCel("rotateCW")}
            >
              <RotateCw size={13} />
            </button>
            {hasSelection && (
              <button
                type="button"
                className="toggle-chip"
                onClick={deselectAll}
                title="Deselect (Ctrl+D)"
              >
                <X size={12} />
                <span>Deselect</span>
              </button>
            )}
          </>
        )}

        <div className="option-divider" />

        <span className="option-label">Symmetry</span>
        <button
          type="button"
          className={`toggle-chip ${symmetryX ? "active" : ""}`}
          onClick={toggleSymmetryX}
          title="Mirror horizontally across center axis"
        >
          <FlipHorizontal2 size={12} />
          <span>X</span>
        </button>
        <button
          type="button"
          className={`toggle-chip ${symmetryY ? "active" : ""}`}
          onClick={toggleSymmetryY}
          title="Mirror vertically across center axis"
        >
          <FlipVertical2 size={12} />
          <span>Y</span>
        </button>

        <div className="option-divider" />

        <button
          type="button"
          className={`toggle-chip ${showGrid ? "active" : ""}`}
          onClick={toggleShowGrid}
          title="Toggle pixel grid overlay"
        >
          <Grid3x3 size={12} />
          <span>Pixel Grid</span>
        </button>

        <button
          type="button"
          className={`toggle-chip ${seamlessWrap ? "active" : ""}`}
          onClick={toggleSeamlessWrap}
          title="Seamless Wrap Mode (tile canvas 3×3 & wrap strokes)"
        >
          <InfinityIcon size={12} />
          <span>Wrap</span>
        </button>

        {showTileControls && (
          <button
            type="button"
            className={`toggle-chip ${showTileGrid ? "active" : ""}`}
            onClick={toggleShowTileGrid}
            title="Toggle tile grid overlay"
          >
            <Grid2x2 size={12} />
            <span>Tile Grid</span>
          </button>
        )}

        <button
          type="button"
          className={`toggle-chip ${showIsoGrid ? "active" : ""}`}
          onClick={toggleShowIsoGrid}
          title="Toggle 2:1 Isometric Grid (Shift+Line snaps to 2:1 iso axis)"
        >
          <Box size={12} />
          <span>Iso Grid</span>
        </button>

        {activeTool === "isoBox" && (
          <label className="option-label">
            <span>Height Z</span>
            <input
              type="range"
              className="compact-range"
              style={{ width: 64 }}
              min={2}
              max={24}
              value={isoBoxHeight}
              onChange={(e) => setIsoBoxHeight(Number(e.target.value))}
            />
            <span className="mono-value">{isoBoxHeight}px</span>
          </label>
        )}
      </div>

      <div className="mode-hint">
        {workspaceMode === "tiles" &&
          "Tiles Mode · Stamp tiles (T) or live-edit instances with Pencil (B)"}
        {workspaceMode === "draw" &&
          "Draw Mode · Scroll to zoom · Space+Drag to pan"}
      </div>
    </div>
  );
}

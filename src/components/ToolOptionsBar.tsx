import {
  Box,
  Brush,
  Check,
  Contrast,
  EyeOff,
  FlipHorizontal2,
  FlipVertical2,
  Grid2x2,
  Grid3x3,
  Infinity as InfinityIcon,
  LayoutGrid,
  Redo2,
  RotateCcw,
  RotateCw,
  Ruler,
  Sparkles,
  Square,
  Undo2,
  X,
} from "lucide-react";
import { performRedo, performUndo } from "../engine/document/historyActions";
import {
  captureCustomBrushFromSelectionAction,
  deselectAll,
  transformSelectionOrCel,
} from "../engine/document/selectionActions";
import {
  cancelFreeTransformAction,
  commitFreeTransformAction,
  getFreeTransformSourceSize,
  updateFreeTransformAction,
} from "../engine/document/transformActions";
import {
  useEditorStore,
  type BrushShape,
  type DitherPattern,
  type GradientMode,
  type InkMode,
  type TransformAlgorithm,
} from "../store/editorStore";
import { RigToolOptionsBar } from "./rig/RigToolOptionsBar";
import { TileToolOptionsBar } from "./tiles/TileToolOptionsBar";

const DITHER_PATTERNS: Array<{ id: DitherPattern; label: string }> = [
  { id: "bayer2", label: "Bayer 2×2" },
  { id: "bayer4", label: "Bayer 4×4" },
  { id: "bayer8", label: "Bayer 8×8" },
  { id: "checker", label: "Checker" },
  { id: "diagL", label: "Diag \\" },
  { id: "diagR", label: "Diag /" },
  { id: "dots", label: "Dots" },
];

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
  const ditherPattern = useEditorStore((s) => s.ditherPattern);
  const setDitherPattern = useEditorStore((s) => s.setDitherPattern);
  const gradientMode = useEditorStore((s) => s.gradientMode);
  const setGradientMode = useEditorStore((s) => s.setGradientMode);
  const gradientDither = useEditorStore((s) => s.gradientDither);
  const setGradientDither = useEditorStore((s) => s.setGradientDither);
  const gradientPaletteSnap = useEditorStore((s) => s.gradientPaletteSnap);
  const toggleGradientPaletteSnap = useEditorStore(
    (s) => s.toggleGradientPaletteSnap
  );
  const fillTolerance = useEditorStore((s) => s.fillTolerance);
  const setFillTolerance = useEditorStore((s) => s.setFillTolerance);
  const fillDiagonal8 = useEditorStore((s) => s.fillDiagonal8);
  const toggleFillDiagonal8 = useEditorStore((s) => s.toggleFillDiagonal8);
  const fillSampleAllLayers = useEditorStore((s) => s.fillSampleAllLayers);
  const toggleFillSampleAllLayers = useEditorStore(
    (s) => s.toggleFillSampleAllLayers
  );
  const fillDitherPattern = useEditorStore((s) => s.fillDitherPattern);
  const setFillDitherPattern = useEditorStore((s) => s.setFillDitherPattern);
  const sprayRadius = useEditorStore((s) => s.sprayRadius);
  const setSprayRadius = useEditorStore((s) => s.setSprayRadius);
  const sprayDensity = useEditorStore((s) => s.sprayDensity);
  const setSprayDensity = useEditorStore((s) => s.setSprayDensity);
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
  const symmetryAxisX = useEditorStore((s) => s.symmetryAxisX);
  const setSymmetryAxisX = useEditorStore((s) => s.setSymmetryAxisX);
  const symmetryAxisY = useEditorStore((s) => s.symmetryAxisY);
  const setSymmetryAxisY = useEditorStore((s) => s.setSymmetryAxisY);
  const symmetryDiag45 = useEditorStore((s) => s.symmetryDiag45);
  const toggleSymmetryDiag45 = useEditorStore((s) => s.toggleSymmetryDiag45);
  const symmetryDiag135 = useEditorStore((s) => s.symmetryDiag135);
  const toggleSymmetryDiag135 = useEditorStore((s) => s.toggleSymmetryDiag135);
  const symmetryRadial = useEditorStore((s) => s.symmetryRadial);
  const setSymmetryRadial = useEditorStore((s) => s.setSymmetryRadial);
  const canvasWidth = useEditorStore((s) => s.canvasWidth);
  const canvasHeight = useEditorStore((s) => s.canvasHeight);
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
  const viewFlipH = useEditorStore((s) => s.viewFlipH);
  const toggleViewFlipH = useEditorStore((s) => s.toggleViewFlipH);
  const viewGrayscale = useEditorStore((s) => s.viewGrayscale);
  const toggleViewGrayscale = useEditorStore((s) => s.toggleViewGrayscale);
  const viewSilhouette = useEditorStore((s) => s.viewSilhouette);
  const toggleViewSilhouette = useEditorStore((s) => s.toggleViewSilhouette);
  const showRulers = useEditorStore((s) => s.showRulers);
  const toggleShowRulers = useEditorStore((s) => s.toggleShowRulers);
  const showCustomGrid = useEditorStore((s) => s.showCustomGrid);
  const toggleShowCustomGrid = useEditorStore((s) => s.toggleShowCustomGrid);
  const layers = useEditorStore((s) => s.layers);
  const activeLayerId = useEditorStore((s) => s.activeLayerId);
  const canUndo = useEditorStore((s) => s.canUndo);
  const canRedo = useEditorStore((s) => s.canRedo);
  const hasSelection = useEditorStore((s) => s.hasSelection);
  const freeTransformActive = useEditorStore((s) => s.freeTransformActive);
  const freeTransformState = useEditorStore((s) => s.freeTransformState);

  const activeLayer = layers.find((l) => l.id === activeLayerId);
  const showTileControls =
    workspaceMode === "tiles" || activeLayer?.kind === "tilemap";

  const showBrushShape =
    activeTool === "pencil" ||
    activeTool === "eraser" ||
    activeTool === "fillBrush" ||
    activeTool === "ditherBrush" ||
    activeTool === "shading";
  const showInkControls =
    activeTool === "pencil" ||
    activeTool === "fillBrush" ||
    activeTool === "ditherBrush";
  const showDitherSelector =
    activeTool === "ditherBrush" ||
    (showInkControls && inkMode === "dither");

  const showShapeFillToggle =
    activeTool === "rect" ||
    activeTool === "ellipse" ||
    activeTool === "polygon";
  const showSelectionControls =
    hasSelection ||
    activeTool === "marquee" ||
    activeTool === "ellipseMarquee" ||
    activeTool === "lasso" ||
    activeTool === "polyLasso" ||
    activeTool === "wand" ||
    activeTool === "move";

  const symCenterX = canvasWidth / 2;
  const symCenterY = canvasHeight / 2;
  const effectiveAxisX = symmetryAxisX ?? symCenterX;
  const effectiveAxisY = symmetryAxisY ?? symCenterY;
  const symAxisShifted =
    symmetryAxisX !== null || symmetryAxisY !== null;

  if (workspaceMode === "rig") {
    return <RigToolOptionsBar />;
  }

  if (workspaceMode === "tiles" && tilesMode === "map") {
    return <TileToolOptionsBar />;
  }

  if (workspaceMode === "draw" && freeTransformActive && freeTransformState) {
    const srcSize = getFreeTransformSourceSize();
    const srcW = srcSize?.width ?? Math.max(1, freeTransformState.width);
    const srcH = srcSize?.height ?? Math.max(1, freeTransformState.height);
    return (
      <div className="tool-options-bar">
        <div className="options-group">
          <span
            className="option-label"
            style={{ fontWeight: 600, color: "var(--text-primary)" }}
          >
            Free Transform
          </span>
          <div className="option-divider" />

          <label className="option-label" title="Offset X">
            <span>X</span>
            <input
              type="number"
              className="draw-axis-input"
              step={1}
              value={Math.round(freeTransformState.x)}
              onChange={(e) => {
                const v = Number(e.target.value);
                if (Number.isFinite(v)) updateFreeTransformAction({ x: v });
              }}
            />
          </label>

          <label className="option-label" title="Offset Y">
            <span>Y</span>
            <input
              type="number"
              className="draw-axis-input"
              step={1}
              value={Math.round(freeTransformState.y)}
              onChange={(e) => {
                const v = Number(e.target.value);
                if (Number.isFinite(v)) updateFreeTransformAction({ y: v });
              }}
            />
          </label>

          <label className="option-label" title="Horizontal scale factor">
            <span>ScaleX</span>
            <input
              type="number"
              className="draw-axis-input"
              step={0.1}
              value={Number(freeTransformState.scaleX.toFixed(2))}
              onChange={(e) => {
                const v = Number(e.target.value);
                if (Number.isFinite(v) && Math.abs(v) >= 0.05) {
                  updateFreeTransformAction({
                    scaleX: v,
                    width: Math.max(1, Math.round(srcW * Math.abs(v))),
                  });
                }
              }}
            />
          </label>

          <label className="option-label" title="Vertical scale factor">
            <span>ScaleY</span>
            <input
              type="number"
              className="draw-axis-input"
              step={0.1}
              value={Number(freeTransformState.scaleY.toFixed(2))}
              onChange={(e) => {
                const v = Number(e.target.value);
                if (Number.isFinite(v) && Math.abs(v) >= 0.05) {
                  updateFreeTransformAction({
                    scaleY: v,
                    height: Math.max(1, Math.round(srcH * Math.abs(v))),
                  });
                }
              }}
            />
          </label>

          <label className="option-label" title="Rotation angle in degrees">
            <span>Angle°</span>
            <input
              type="number"
              className="draw-axis-input"
              step={1}
              value={Number(freeTransformState.rotationDeg.toFixed(1))}
              onChange={(e) => {
                const v = Number(e.target.value);
                if (Number.isFinite(v)) {
                  updateFreeTransformAction({ rotationDeg: v });
                }
              }}
            />
          </label>

          <label className="option-label" title="Resampling algorithm">
            <span>Resample</span>
            <select
              className="palette-select"
              style={{ flex: "0 0 auto", width: "auto" }}
              value={freeTransformState.algorithm}
              onChange={(e) =>
                updateFreeTransformAction({
                  algorithm: e.target.value as TransformAlgorithm,
                })
              }
            >
              <option value="nearest">Nearest</option>
              <option value="rotsprite">RotSprite</option>
              <option value="scale2x">Scale2x</option>
            </select>
          </label>

          <div className="option-divider" />

          <button
            type="button"
            className="toggle-chip active"
            onClick={() => commitFreeTransformAction()}
            title="Apply Free Transform (Enter)"
          >
            <Check size={12} />
            <span>Apply (Enter)</span>
          </button>

          <button
            type="button"
            className="toggle-chip"
            onClick={() => cancelFreeTransformAction()}
            title="Cancel Free Transform (Esc)"
          >
            <X size={12} />
            <span>Cancel (Esc)</span>
          </button>
        </div>

        <div className="mode-hint">
          Shift+Corner locks aspect · Shift+Rotate snaps 15° · Drag crosshair to move pivot
        </div>
      </div>
    );
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

        {activeTool !== "spray" && activeTool !== "gradient" && (
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
        )}

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

            {activeTool !== "ditherBrush" && (
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
            )}
          </>
        )}

        {showDitherSelector && (
          <label className="option-label">
            <span>Dither</span>
            <select
              className="palette-select"
              style={{ flex: "0 0 auto", width: "auto" }}
              value={ditherPattern}
              onChange={(e) =>
                setDitherPattern(e.target.value as DitherPattern)
              }
              title="Ordered dither pattern"
            >
              {DITHER_PATTERNS.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </select>
          </label>
        )}

        {activeTool === "spray" && (
          <>
            <label className="option-label">
              <span>Radius</span>
              <input
                type="range"
                className="compact-range"
                style={{ width: 64 }}
                min={1}
                max={32}
                value={sprayRadius}
                onChange={(e) => setSprayRadius(Number(e.target.value))}
              />
              <span className="mono-value">{sprayRadius}px</span>
            </label>
            <label className="option-label">
              <span>Density</span>
              <input
                type="range"
                className="compact-range"
                style={{ width: 64 }}
                min={1}
                max={100}
                value={sprayDensity}
                onChange={(e) => setSprayDensity(Number(e.target.value))}
              />
              <span className="mono-value">{sprayDensity}%</span>
            </label>
          </>
        )}

        {activeTool === "gradient" && (
          <>
            <label className="option-label">
              <span>Mode</span>
              <select
                className="palette-select"
                style={{ flex: "0 0 auto", width: "auto" }}
                value={gradientMode}
                onChange={(e) =>
                  setGradientMode(e.target.value as GradientMode)
                }
              >
                <option value="linear">Linear</option>
                <option value="radial">Radial</option>
              </select>
            </label>
            <label className="option-label">
              <span>Dither</span>
              <select
                className="palette-select"
                style={{ flex: "0 0 auto", width: "auto" }}
                value={gradientDither}
                onChange={(e) =>
                  setGradientDither(e.target.value as DitherPattern | "none")
                }
              >
                <option value="none">Smooth</option>
                {DITHER_PATTERNS.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.label}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="button"
              className={`toggle-chip ${gradientPaletteSnap ? "active" : ""}`}
              onClick={toggleGradientPaletteSnap}
              title="Snap gradient colors to active palette"
            >
              <span>Palette Snap</span>
            </button>
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
          <>
            <button
              type="button"
              className={`toggle-chip ${fillContiguous ? "active" : ""}`}
              onClick={toggleFillContiguous}
              title="Contiguous region vs global color match"
            >
              <span>{fillContiguous ? "Contiguous" : "Global"}</span>
            </button>
            <label className="option-label">
              <span>Tol</span>
              <input
                type="range"
                className="compact-range"
                style={{ width: 56 }}
                min={0}
                max={255}
                value={fillTolerance}
                onChange={(e) => setFillTolerance(Number(e.target.value))}
              />
              <span className="mono-value">{fillTolerance}</span>
            </label>
            <button
              type="button"
              className={`toggle-chip ${fillDiagonal8 ? "active" : ""}`}
              onClick={toggleFillDiagonal8}
              title="Include diagonal neighbors (8-way flood)"
            >
              <span>8-Way</span>
            </button>
            <button
              type="button"
              className={`toggle-chip ${fillSampleAllLayers ? "active" : ""}`}
              onClick={toggleFillSampleAllLayers}
              title="Sample composited visible layers instead of active cel only"
            >
              <span>All Layers</span>
            </button>
            {activeTool === "fill" && (
              <label className="option-label">
                <span>Dither</span>
                <select
                  className="palette-select"
                  style={{ flex: "0 0 auto", width: "auto" }}
                  value={fillDitherPattern}
                  onChange={(e) =>
                    setFillDitherPattern(
                      e.target.value as DitherPattern | "none"
                    )
                  }
                >
                  <option value="none">Solid</option>
                  {DITHER_PATTERNS.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.label}
                    </option>
                  ))}
                </select>
              </label>
            )}
          </>
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
              <>
                <button
                  type="button"
                  className="toggle-chip"
                  onClick={() => captureCustomBrushFromSelectionAction()}
                  title="Capture selection as Custom Brush (Ctrl+B)"
                >
                  <Brush size={12} />
                  <span>Capture Brush (Ctrl+B)</span>
                </button>
                <button
                  type="button"
                  className="toggle-chip"
                  onClick={deselectAll}
                  title="Deselect (Ctrl+D)"
                >
                  <X size={12} />
                  <span>Deselect</span>
                </button>
              </>
            )}
          </>
        )}

        <div className="option-divider" />

        <span className="option-label">Symmetry</span>
        <button
          type="button"
          className={`toggle-chip ${symmetryX ? "active" : ""}`}
          onClick={toggleSymmetryX}
          title="Mirror horizontally across symmetry X axis"
        >
          <FlipHorizontal2 size={12} />
          <span>X</span>
        </button>
        <button
          type="button"
          className={`toggle-chip ${symmetryY ? "active" : ""}`}
          onClick={toggleSymmetryY}
          title="Mirror vertically across symmetry Y axis"
        >
          <FlipVertical2 size={12} />
          <span>Y</span>
        </button>
        <button
          type="button"
          className={`toggle-chip ${symmetryDiag45 ? "active" : ""}`}
          onClick={toggleSymmetryDiag45}
          title="Diagonal 45° symmetry (\)"
        >
          <span>Diag \</span>
        </button>
        <button
          type="button"
          className={`toggle-chip ${symmetryDiag135 ? "active" : ""}`}
          onClick={toggleSymmetryDiag135}
          title="Diagonal 135° symmetry (/)"
        >
          <span>Diag /</span>
        </button>
        <label className="option-label" title="Radial symmetry segments">
          <span>Radial</span>
          <select
            className="palette-select"
            style={{ flex: "0 0 auto", width: "auto" }}
            value={symmetryRadial}
            onChange={(e) => setSymmetryRadial(Number(e.target.value))}
          >
            <option value={0}>Off</option>
            {Array.from({ length: 11 }, (_, i) => i + 2).map((n) => (
              <option key={n} value={n}>
                {n}×
              </option>
            ))}
          </select>
        </label>
        {(symmetryX ||
          symmetryY ||
          symmetryDiag45 ||
          symmetryDiag135 ||
          symmetryRadial >= 2) && (
          <>
            <label className="option-label" title="Symmetry X axis">
              <span>AX</span>
              <input
                type="number"
                className="draw-axis-input"
                step={0.5}
                value={effectiveAxisX}
                onChange={(e) => {
                  const v = Number(e.target.value);
                  if (Number.isFinite(v)) setSymmetryAxisX(v);
                }}
              />
            </label>
            <label className="option-label" title="Symmetry Y axis">
              <span>AY</span>
              <input
                type="number"
                className="draw-axis-input"
                step={0.5}
                value={effectiveAxisY}
                onChange={(e) => {
                  const v = Number(e.target.value);
                  if (Number.isFinite(v)) setSymmetryAxisY(v);
                }}
              />
            </label>
            {symAxisShifted && (
              <button
                type="button"
                className="toggle-chip"
                onClick={() => {
                  setSymmetryAxisX(null);
                  setSymmetryAxisY(null);
                }}
                title="Reset symmetry axes to canvas center"
              >
                <span>Center</span>
              </button>
            )}
          </>
        )}

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

        {workspaceMode === "draw" && (
          <>
            <div className="option-divider" />
            <button
              type="button"
              className={`toggle-chip ${viewFlipH ? "active" : ""}`}
              onClick={toggleViewFlipH}
              title="Non-destructive Flip View Horizontal (H)"
            >
              <FlipHorizontal2 size={12} />
              <span>Flip H</span>
            </button>
            <button
              type="button"
              className={`toggle-chip ${viewGrayscale ? "active" : ""}`}
              onClick={toggleViewGrayscale}
              title="Non-destructive Grayscale Value Check"
            >
              <Contrast size={12} />
              <span>Gray</span>
            </button>
            <button
              type="button"
              className={`toggle-chip ${viewSilhouette ? "active" : ""}`}
              onClick={toggleViewSilhouette}
              title="Non-destructive Silhouette Check"
            >
              <EyeOff size={12} />
              <span>Silh</span>
            </button>
            <button
              type="button"
              className={`toggle-chip ${showRulers ? "active" : ""}`}
              onClick={toggleShowRulers}
              title="Toggle Pixel Rulers & Guides"
            >
              <Ruler size={12} />
              <span>Rulers</span>
            </button>
            <button
              type="button"
              className={`toggle-chip ${showCustomGrid ? "active" : ""}`}
              onClick={toggleShowCustomGrid}
              title="Toggle Custom Grid Overlay"
            >
              <LayoutGrid size={12} />
              <span>C-Grid</span>
            </button>
          </>
        )}

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

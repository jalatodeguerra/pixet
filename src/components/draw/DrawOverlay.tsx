import { useMemo } from "react";
import {
  buildFootprintOutlinePath,
  computeBrushOverlayFootprint,
  type FootprintOutlineResult,
} from "../../engine/tools/drawOverlayGeometry";
import { buildCustomGridLines } from "../../engine/tools/guides";
import { useEditorStore } from "../../store/editorStore";
import {
  getSymmetryConfigFromState,
  type DrawDragPreview,
} from "./useDrawPointer";

export {
  buildFootprintOutlinePath,
  computeBrushOverlayFootprint,
  type FootprintOutlineResult,
};

export function DrawOverlay({
  isStrokeActive,
  dragPreview,
}: {
  isStrokeActive?: boolean;
  dragPreview?: DrawDragPreview;
}) {
  const workspaceMode = useEditorStore((s) => s.workspaceMode);
  const tilesMode = useEditorStore((s) => s.tilesMode);
  const activeTool = useEditorStore((s) => s.activeTool);
  const cursorPos = useEditorStore((s) => s.cursorPos);
  const canvasWidth = useEditorStore((s) => s.canvasWidth);
  const canvasHeight = useEditorStore((s) => s.canvasHeight);
  const brushSize = useEditorStore((s) => s.brushSize);
  const brushShape = useEditorStore((s) => s.brushShape);
  const brushOpacity = useEditorStore((s) => s.brushOpacity);
  const brushSpacing = useEditorStore((s) => s.brushSpacing);
  const pixelPerfect = useEditorStore((s) => s.pixelPerfect);
  const customBrush = useEditorStore((s) => s.customBrush);
  const sprayRadius = useEditorStore((s) => s.sprayRadius);
  const symmetryX = useEditorStore((s) => s.symmetryX);
  const symmetryY = useEditorStore((s) => s.symmetryY);
  const symmetryAxisX = useEditorStore((s) => s.symmetryAxisX);
  const symmetryAxisY = useEditorStore((s) => s.symmetryAxisY);
  const symmetryDiag45 = useEditorStore((s) => s.symmetryDiag45);
  const symmetryDiag135 = useEditorStore((s) => s.symmetryDiag135);
  const symmetryRadial = useEditorStore((s) => s.symmetryRadial);
  const seamlessWrap = useEditorStore((s) => s.seamlessWrap);
  const guides = useEditorStore((s) => s.guides);
  const showCustomGrid = useEditorStore((s) => s.showCustomGrid);
  const customGridW = useEditorStore((s) => s.customGridW);
  const customGridH = useEditorStore((s) => s.customGridH);
  const customGridOffsetX = useEditorStore((s) => s.customGridOffsetX);
  const customGridOffsetY = useEditorStore((s) => s.customGridOffsetY);

  const isTilesMap = workspaceMode === "tiles" && tilesMode === "map";
  const isFootprintTool =
    activeTool === "pencil" ||
    activeTool === "eraser" ||
    activeTool === "fillBrush" ||
    activeTool === "ditherBrush" ||
    activeTool === "shading";
  const footprintEnabled =
    workspaceMode !== "rig" &&
    workspaceMode !== "data" &&
    !isTilesMap &&
    isFootprintTool &&
    !isStrokeActive &&
    cursorPos !== null;

  const symCfg = useMemo(
    () =>
      getSymmetryConfigFromState({
        canvasWidth,
        canvasHeight,
        symmetryX,
        symmetryY,
        symmetryAxisX,
        symmetryAxisY,
        symmetryDiag45,
        symmetryDiag135,
        symmetryRadial,
      }),
    [
      canvasWidth,
      canvasHeight,
      symmetryX,
      symmetryY,
      symmetryAxisX,
      symmetryAxisY,
      symmetryDiag45,
      symmetryDiag135,
      symmetryRadial,
    ]
  );

  const overlay = useMemo(() => {
    if (!footprintEnabled || !cursorPos) return null;
    return computeBrushOverlayFootprint(
      cursorPos.x,
      cursorPos.y,
      {
        shape: brushShape,
        size: activeTool === "fillBrush" ? 1 : brushSize,
        opacity: brushOpacity,
        pixelPerfect,
        spacing: brushSpacing,
        customBrush,
      },
      canvasWidth,
      canvasHeight,
      symmetryX,
      symmetryY,
      seamlessWrap,
      symCfg
    );
  }, [
    footprintEnabled,
    cursorPos,
    brushShape,
    activeTool,
    brushSize,
    brushOpacity,
    pixelPerfect,
    brushSpacing,
    customBrush,
    canvasWidth,
    canvasHeight,
    symmetryX,
    symmetryY,
    seamlessWrap,
    symCfg,
  ]);

  const customGrid = useMemo(() => {
    if (workspaceMode !== "draw" || !showCustomGrid) return null;
    return buildCustomGridLines(
      canvasWidth,
      canvasHeight,
      customGridW,
      customGridH,
      customGridOffsetX,
      customGridOffsetY
    );
  }, [
    workspaceMode,
    showCustomGrid,
    canvasWidth,
    canvasHeight,
    customGridW,
    customGridH,
    customGridOffsetX,
    customGridOffsetY,
  ]);

  const showSymmetryOverlay =
    workspaceMode === "draw" &&
    (symmetryX ||
      symmetryY ||
      symmetryDiag45 ||
      symmetryDiag135 ||
      symmetryRadial >= 2);
  const showGuides = workspaceMode === "draw" && guides.length > 0;
  const hasFootprint = Boolean(overlay && overlay.cells.length > 0);
  const hasCustomGrid = Boolean(
    customGrid &&
      (customGrid.verticals.length > 0 || customGrid.horizontals.length > 0)
  );
  const showSprayRing =
    workspaceMode === "draw" && activeTool === "spray" && cursorPos !== null;
  const hasToolPreview = Boolean(
    dragPreview &&
      (dragPreview.kind === "gradient" ||
        dragPreview.kind === "curve" ||
        dragPreview.kind === "polygon")
  );

  if (
    !hasFootprint &&
    !showGuides &&
    !hasCustomGrid &&
    !showSymmetryOverlay &&
    !showSprayRing &&
    !hasToolPreview
  ) {
    return null;
  }

  const isEraser = activeTool === "eraser";
  const axisX = symCfg.axisX;
  const axisY = symCfg.axisY;
  const maxSpan = Math.max(canvasWidth, canvasHeight) * 2;

  return (
    <svg
      className="draw-overlay-svg"
      viewBox={`0 0 ${canvasWidth} ${canvasHeight}`}
      preserveAspectRatio="none"
    >
      {hasCustomGrid && customGrid && (
        <g className="draw-custom-grid-group">
          {customGrid.verticals.map((x) => (
            <line
              key={`cg-v-${x}`}
              className="draw-custom-grid-line"
              x1={x}
              y1={0}
              x2={x}
              y2={canvasHeight}
            />
          ))}
          {customGrid.horizontals.map((y) => (
            <line
              key={`cg-h-${y}`}
              className="draw-custom-grid-line"
              x1={0}
              y1={y}
              x2={canvasWidth}
              y2={y}
            />
          ))}
        </g>
      )}

      {showGuides &&
        guides.map((g) =>
          g.axis === "x" ? (
            <line
              key={g.id}
              className="draw-guide-line"
              x1={g.pos}
              y1={0}
              x2={g.pos}
              y2={canvasHeight}
            />
          ) : (
            <line
              key={g.id}
              className="draw-guide-line"
              x1={0}
              y1={g.pos}
              x2={canvasWidth}
              y2={g.pos}
            />
          )
        )}

      {showSymmetryOverlay && (
        <g className="draw-symmetry-group">
          {symmetryX && (
            <line
              className="draw-symmetry-axis"
              x1={axisX}
              y1={0}
              x2={axisX}
              y2={canvasHeight}
            />
          )}
          {symmetryY && (
            <line
              className="draw-symmetry-axis"
              x1={0}
              y1={axisY}
              x2={canvasWidth}
              y2={axisY}
            />
          )}
          {symmetryDiag45 && (
            <line
              className="draw-symmetry-axis diag"
              x1={axisX - maxSpan}
              y1={axisY - maxSpan}
              x2={axisX + maxSpan}
              y2={axisY + maxSpan}
            />
          )}
          {symmetryDiag135 && (
            <line
              className="draw-symmetry-axis diag"
              x1={axisX - maxSpan}
              y1={axisY + maxSpan}
              x2={axisX + maxSpan}
              y2={axisY - maxSpan}
            />
          )}
          {symmetryRadial >= 2 && (
            <g className="draw-symmetry-radial">
              {Array.from({ length: symmetryRadial }, (_, i) => {
                const angle = (2 * Math.PI * i) / symmetryRadial;
                return (
                  <line
                    key={`rad-${i}`}
                    className="draw-symmetry-axis radial"
                    x1={axisX}
                    y1={axisY}
                    x2={axisX + Math.cos(angle) * maxSpan}
                    y2={axisY + Math.sin(angle) * maxSpan}
                  />
                );
              })}
              <circle
                className="draw-symmetry-center"
                cx={axisX}
                cy={axisY}
                r={0.5}
              />
            </g>
          )}
        </g>
      )}

      {showSprayRing && cursorPos && (
        <circle
          className="draw-spray-ring"
          cx={cursorPos.x + 0.5}
          cy={cursorPos.y + 0.5}
          r={sprayRadius}
        />
      )}

      {dragPreview?.kind === "gradient" && (
        <g className="draw-tool-preview">
          <line
            className="draw-preview-line"
            x1={dragPreview.x0 + 0.5}
            y1={dragPreview.y0 + 0.5}
            x2={dragPreview.x1 + 0.5}
            y2={dragPreview.y1 + 0.5}
          />
          <circle
            className="draw-preview-handle"
            cx={dragPreview.x0 + 0.5}
            cy={dragPreview.y0 + 0.5}
            r={0.6}
          />
          <circle
            className="draw-preview-handle end"
            cx={dragPreview.x1 + 0.5}
            cy={dragPreview.y1 + 0.5}
            r={0.6}
          />
        </g>
      )}

      {dragPreview?.kind === "curve" && (
        <g className="draw-tool-preview">
          <line
            className="draw-preview-guide"
            x1={dragPreview.p0.x + 0.5}
            y1={dragPreview.p0.y + 0.5}
            x2={dragPreview.p1.x + 0.5}
            y2={dragPreview.p1.y + 0.5}
          />
          <line
            className="draw-preview-guide"
            x1={dragPreview.p1.x + 0.5}
            y1={dragPreview.p1.y + 0.5}
            x2={dragPreview.p2.x + 0.5}
            y2={dragPreview.p2.y + 0.5}
          />
          <circle
            className="draw-preview-handle"
            cx={dragPreview.p0.x + 0.5}
            cy={dragPreview.p0.y + 0.5}
            r={0.5}
          />
          <circle
            className="draw-preview-handle end"
            cx={dragPreview.p1.x + 0.5}
            cy={dragPreview.p1.y + 0.5}
            r={0.6}
          />
          <circle
            className="draw-preview-handle"
            cx={dragPreview.p2.x + 0.5}
            cy={dragPreview.p2.y + 0.5}
            r={0.5}
          />
        </g>
      )}

      {dragPreview?.kind === "polygon" && dragPreview.points.length > 0 && (
        <g className="draw-tool-preview">
          <polyline
            className="draw-preview-guide"
            points={[...dragPreview.points, dragPreview.cursor]
              .map((p) => `${p.x + 0.5},${p.y + 0.5}`)
              .join(" ")}
          />
          {dragPreview.points.map((p, idx) => (
            <circle
              key={`poly-v-${idx}`}
              className={
                idx === 0 ? "draw-preview-handle end" : "draw-preview-handle"
              }
              cx={p.x + 0.5}
              cy={p.y + 0.5}
              r={idx === 0 ? 0.6 : 0.4}
            />
          ))}
        </g>
      )}

      {hasFootprint &&
        overlay &&
        overlay.cells.map((c) => (
          <rect
            key={`${c.x},${c.y}`}
            className={isEraser ? "draw-footprint-cell eraser" : "draw-footprint-cell"}
            x={c.x}
            y={c.y}
            width={1}
            height={1}
          />
        ))}
      {hasFootprint && overlay?.outlinePath && (
        <path
          className={
            isEraser ? "draw-footprint-outline eraser" : "draw-footprint-outline"
          }
          d={overlay.outlinePath}
        />
      )}
    </svg>
  );
}

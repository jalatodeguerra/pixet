import { useMemo } from "react";
import {
  buildFootprintOutlinePath,
  computeBrushOverlayFootprint,
  type FootprintOutlineResult,
} from "../../engine/tools/drawOverlayGeometry";
import { buildCustomGridLines } from "../../engine/tools/guides";
import { useEditorStore } from "../../store/editorStore";

export {
  buildFootprintOutlinePath,
  computeBrushOverlayFootprint,
  type FootprintOutlineResult,
};

export function DrawOverlay({
  isStrokeActive,
}: {
  isStrokeActive?: boolean;
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
  const symmetryX = useEditorStore((s) => s.symmetryX);
  const symmetryY = useEditorStore((s) => s.symmetryY);
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
    activeTool === "fillBrush";
  const footprintEnabled =
    workspaceMode !== "rig" &&
    workspaceMode !== "data" &&
    !isTilesMap &&
    isFootprintTool &&
    !isStrokeActive &&
    cursorPos !== null;

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
      seamlessWrap
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

  const showGuides = workspaceMode === "draw" && guides.length > 0;
  const hasFootprint = Boolean(overlay && overlay.cells.length > 0);
  const hasCustomGrid = Boolean(
    customGrid &&
      (customGrid.verticals.length > 0 || customGrid.horizontals.length > 0)
  );

  if (!hasFootprint && !showGuides && !hasCustomGrid) return null;

  const isEraser = activeTool === "eraser";

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

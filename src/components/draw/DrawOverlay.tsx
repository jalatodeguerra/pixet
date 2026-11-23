import { useMemo } from "react";
import {
  buildFootprintOutlinePath,
  computeBrushOverlayFootprint,
  type FootprintOutlineResult,
} from "../../engine/tools/drawOverlayGeometry";
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

  const isTilesMap = workspaceMode === "tiles" && tilesMode === "map";
  const isFootprintTool =
    activeTool === "pencil" ||
    activeTool === "eraser" ||
    activeTool === "fillBrush";
  const enabled =
    workspaceMode !== "rig" &&
    workspaceMode !== "data" &&
    !isTilesMap &&
    isFootprintTool &&
    !isStrokeActive &&
    cursorPos !== null;

  const overlay = useMemo(() => {
    if (!enabled || !cursorPos) return null;
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
    enabled,
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

  if (!overlay || overlay.cells.length === 0) return null;

  const isEraser = activeTool === "eraser";

  return (
    <svg
      className="draw-overlay-svg"
      viewBox={`0 0 ${canvasWidth} ${canvasHeight}`}
      preserveAspectRatio="none"
    >
      {overlay.cells.map((c) => (
        <rect
          key={`${c.x},${c.y}`}
          className={isEraser ? "draw-footprint-cell eraser" : "draw-footprint-cell"}
          x={c.x}
          y={c.y}
          width={1}
          height={1}
        />
      ))}
      {overlay.outlinePath && (
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

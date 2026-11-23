import { useMemo, useRef } from "react";
import {
  getFreeTransformSourceSize,
  updateFreeTransformAction,
} from "../../engine/document/transformActions";
import {
  buildFootprintOutlinePath,
  computeBrushOverlayFootprint,
  type FootprintOutlineResult,
} from "../../engine/tools/drawOverlayGeometry";
import { buildCustomGridLines } from "../../engine/tools/guides";
import {
  computePivotTransformPatch,
  computeRotateTransformPatch,
  computeScaleTransformPatch,
  computeTransformGizmo,
  type TransformHandleId,
  type TransformPoint,
  type TransformState,
} from "../../engine/tools/transform";
import { mapFlippedPoint } from "../../engine/tools/viewChecks";
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

type GizmoDragMode =
  | {
      kind: "move";
      startState: TransformState;
      startPt: TransformPoint;
    }
  | {
      kind: "scale";
      handle: TransformHandleId;
      startState: TransformState;
      srcW: number;
      srcH: number;
    }
  | {
      kind: "rotate";
      startState: TransformState;
      srcW: number;
      srcH: number;
      startPt: TransformPoint;
    }
  | {
      kind: "pivot";
      startState: TransformState;
      srcW: number;
      srcH: number;
    };

const HANDLE_IDS: TransformHandleId[] = [
  "tl",
  "tr",
  "br",
  "bl",
  "t",
  "r",
  "b",
  "l",
];

const HANDLE_CURSORS: Record<TransformHandleId, string> = {
  tl: "nwse-resize",
  br: "nwse-resize",
  tr: "nesw-resize",
  bl: "nesw-resize",
  t: "ns-resize",
  b: "ns-resize",
  l: "ew-resize",
  r: "ew-resize",
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
  const zoom = useEditorStore((s) => s.zoom);
  const viewFlipH = useEditorStore((s) => s.viewFlipH);
  const viewFlipV = useEditorStore((s) => s.viewFlipV);
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
  const freeTransformActive = useEditorStore((s) => s.freeTransformActive);
  const freeTransformState = useEditorStore((s) => s.freeTransformState);

  const svgRef = useRef<SVGSVGElement>(null);
  const gizmoDragRef = useRef<GizmoDragMode | null>(null);

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
    !freeTransformActive &&
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

  const ftSrcSize = freeTransformActive ? getFreeTransformSourceSize() : null;
  const ftGizmo = useMemo(() => {
    if (!freeTransformActive || !freeTransformState || workspaceMode !== "draw") {
      return null;
    }
    const srcW = ftSrcSize?.width ?? freeTransformState.width;
    const srcH = ftSrcSize?.height ?? freeTransformState.height;
    const stemDist = Math.max(1.2, 16 / Math.max(1, zoom));
    return {
      srcW,
      srcH,
      ...computeTransformGizmo(srcW, srcH, freeTransformState, stemDist),
    };
  }, [
    freeTransformActive,
    freeTransformState,
    workspaceMode,
    ftSrcSize?.width,
    ftSrcSize?.height,
    zoom,
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
    workspaceMode === "draw" &&
    !freeTransformActive &&
    activeTool === "spray" &&
    cursorPos !== null;
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
    !hasToolPreview &&
    !ftGizmo
  ) {
    return null;
  }

  const getCanvasFloatPoint = (
    e: React.PointerEvent<Element>
  ): TransformPoint => {
    const svg = svgRef.current;
    if (!svg) return { x: 0, y: 0 };
    const rect = svg.getBoundingClientRect();
    const rawX = (e.clientX - rect.left) / Math.max(1, zoom);
    const rawY = (e.clientY - rect.top) / Math.max(1, zoom);
    if (viewFlipH || viewFlipV) {
      const flipped = mapFlippedPoint(
        { x: Math.floor(rawX), y: Math.floor(rawY) },
        canvasWidth,
        canvasHeight,
        viewFlipH,
        viewFlipV
      );
      const fracX = rawX - Math.floor(rawX);
      const fracY = rawY - Math.floor(rawY);
      return {
        x: viewFlipH ? flipped.x + (1 - fracX) : rawX,
        y: viewFlipV ? flipped.y + (1 - fracY) : rawY,
      };
    }
    return { x: rawX, y: rawY };
  };

  const beginGizmoDrag = (
    e: React.PointerEvent<SVGElement>,
    mode: GizmoDragMode
  ) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    gizmoDragRef.current = mode;
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const handleGizmoPointerMove = (e: React.PointerEvent<SVGElement>) => {
    const drag = gizmoDragRef.current;
    if (!drag) return;
    e.preventDefault();
    e.stopPropagation();
    const pt = getCanvasFloatPoint(e);

    if (drag.kind === "move") {
      const dx = Math.round(pt.x - drag.startPt.x);
      const dy = Math.round(pt.y - drag.startPt.y);
      updateFreeTransformAction({
        x: drag.startState.x + dx,
        y: drag.startState.y + dy,
      });
      return;
    }

    if (drag.kind === "scale") {
      const patch = computeScaleTransformPatch(
        drag.srcW,
        drag.srcH,
        drag.startState,
        drag.handle,
        pt,
        e.shiftKey,
        e.altKey
      );
      updateFreeTransformAction(patch);
      return;
    }

    if (drag.kind === "rotate") {
      const patch = computeRotateTransformPatch(
        drag.srcW,
        drag.srcH,
        drag.startState,
        drag.startPt,
        pt,
        e.shiftKey
      );
      updateFreeTransformAction(patch);
      return;
    }

    if (drag.kind === "pivot") {
      const patch = computePivotTransformPatch(
        drag.srcW,
        drag.srcH,
        drag.startState,
        pt
      );
      updateFreeTransformAction(patch);
    }
  };

  const endGizmoDrag = (e: React.PointerEvent<SVGElement>) => {
    if (!gizmoDragRef.current) return;
    e.preventDefault();
    e.stopPropagation();
    gizmoDragRef.current = null;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
  };

  const isEraser = activeTool === "eraser";
  const axisX = symCfg.axisX;
  const axisY = symCfg.axisY;
  const maxSpan = Math.max(canvasWidth, canvasHeight) * 2;
  const handleUnit = 6 / Math.max(1, zoom);
  const halfHandle = handleUnit / 2;
  const pivotArm = 4 / Math.max(1, zoom);
  const pivotRadius = 3 / Math.max(1, zoom);

  return (
    <svg
      ref={svgRef}
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

      {ftGizmo && freeTransformState && (
        <g className="draw-ft-gizmo">
          <polygon
            className="draw-ft-box"
            points={ftGizmo.corners.map((p) => `${p.x},${p.y}`).join(" ")}
            onPointerDown={(e) =>
              beginGizmoDrag(e, {
                kind: "move",
                startState: freeTransformState,
                startPt: getCanvasFloatPoint(e),
              })
            }
            onPointerMove={handleGizmoPointerMove}
            onPointerUp={endGizmoDrag}
            onPointerCancel={endGizmoDrag}
          />
          <line
            className="draw-ft-rot-stem"
            x1={ftGizmo.rotStemStart.x}
            y1={ftGizmo.rotStemStart.y}
            x2={ftGizmo.rotHandle.x}
            y2={ftGizmo.rotHandle.y}
          />
          <rect
            className="draw-ft-rot-handle"
            x={ftGizmo.rotHandle.x - halfHandle}
            y={ftGizmo.rotHandle.y - halfHandle}
            width={handleUnit}
            height={handleUnit}
            onPointerDown={(e) =>
              beginGizmoDrag(e, {
                kind: "rotate",
                startState: freeTransformState,
                srcW: ftGizmo.srcW,
                srcH: ftGizmo.srcH,
                startPt: getCanvasFloatPoint(e),
              })
            }
            onPointerMove={handleGizmoPointerMove}
            onPointerUp={endGizmoDrag}
            onPointerCancel={endGizmoDrag}
          />
          {[...ftGizmo.corners, ...ftGizmo.midpoints].map((pt, idx) => {
            const handleId = HANDLE_IDS[idx];
            return (
              <rect
                key={`ft-h-${handleId}`}
                className="draw-ft-handle"
                style={{ cursor: HANDLE_CURSORS[handleId] }}
                x={pt.x - halfHandle}
                y={pt.y - halfHandle}
                width={handleUnit}
                height={handleUnit}
                onPointerDown={(e) =>
                  beginGizmoDrag(e, {
                    kind: "scale",
                    handle: handleId,
                    startState: freeTransformState,
                    srcW: ftGizmo.srcW,
                    srcH: ftGizmo.srcH,
                  })
                }
                onPointerMove={handleGizmoPointerMove}
                onPointerUp={endGizmoDrag}
                onPointerCancel={endGizmoDrag}
              />
            );
          })}
          <g
            className="draw-ft-pivot"
            onPointerDown={(e) =>
              beginGizmoDrag(e, {
                kind: "pivot",
                startState: freeTransformState,
                srcW: ftGizmo.srcW,
                srcH: ftGizmo.srcH,
              })
            }
            onPointerMove={handleGizmoPointerMove}
            onPointerUp={endGizmoDrag}
            onPointerCancel={endGizmoDrag}
          >
            <circle
              className="draw-ft-pivot-hit"
              cx={ftGizmo.pivot.x}
              cy={ftGizmo.pivot.y}
              r={pivotArm * 1.4}
            />
            <circle
              className="draw-ft-pivot-ring"
              cx={ftGizmo.pivot.x}
              cy={ftGizmo.pivot.y}
              r={pivotRadius}
            />
            <line
              className="draw-ft-pivot-line"
              x1={ftGizmo.pivot.x - pivotArm}
              y1={ftGizmo.pivot.y}
              x2={ftGizmo.pivot.x + pivotArm}
              y2={ftGizmo.pivot.y}
            />
            <line
              className="draw-ft-pivot-line"
              x1={ftGizmo.pivot.x}
              y1={ftGizmo.pivot.y - pivotArm}
              x2={ftGizmo.pivot.x}
              y2={ftGizmo.pivot.y + pivotArm}
            />
          </g>
        </g>
      )}
    </svg>
  );
}

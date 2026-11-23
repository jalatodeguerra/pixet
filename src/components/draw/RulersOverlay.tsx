import { useRef } from "react";
import { useEditorStore, type GuideAxis } from "../../store/editorStore";

interface RulersOverlayProps {
  stageRef: React.RefObject<HTMLDivElement | null>;
  canvasFrameRef: React.RefObject<HTMLDivElement | null>;
  canvasWidth: number;
  canvasHeight: number;
  zoom: number;
  viewFlipH: boolean;
  viewFlipV: boolean;
}

const RULER_SIZE = 18;

function getTickStep(zoom: number): number {
  const minLabelPx = 28;
  const raw = minLabelPx / Math.max(1, zoom);
  const candidates = [1, 2, 4, 8, 16, 32, 64, 128];
  for (const c of candidates) {
    if (c >= raw) return c;
  }
  return 128;
}

export function RulersOverlay({
  stageRef,
  canvasFrameRef,
  canvasWidth,
  canvasHeight,
  zoom,
  viewFlipH,
  viewFlipV,
}: RulersOverlayProps) {
  const showRulers = useEditorStore((s) => s.showRulers);
  const workspaceMode = useEditorStore((s) => s.workspaceMode);
  const guides = useEditorStore((s) => s.guides);
  const addGuide = useEditorStore((s) => s.addGuide);
  const moveGuide = useEditorStore((s) => s.moveGuide);
  const removeGuide = useEditorStore((s) => s.removeGuide);

  const activeDragRef = useRef<{
    axis: GuideAxis;
    guideId: string | null;
  } | null>(null);

  if (!showRulers || workspaceMode !== "draw") {
    return null;
  }

  const stageEl = stageRef.current;
  const frameEl = canvasFrameRef.current;
  const stageRect = stageEl?.getBoundingClientRect();
  const frameRect = frameEl?.getBoundingClientRect();

  const frameLeft =
    stageRect && frameRect ? frameRect.left - stageRect.left : 0;
  const frameTop = stageRect && frameRect ? frameRect.top - stageRect.top : 0;
  const frameWidth = frameRect ? frameRect.width : canvasWidth * zoom;
  const frameHeight = frameRect ? frameRect.height : canvasHeight * zoom;

  const clientToDocPos = (clientX: number, clientY: number, axis: GuideAxis): number => {
    const rect = canvasFrameRef.current?.getBoundingClientRect();
    if (!rect || rect.width <= 0 || rect.height <= 0) return 0;
    if (axis === "x") {
      const raw = Math.floor((clientX - rect.left) / zoom);
      return viewFlipH ? canvasWidth - 1 - raw : raw;
    }
    const raw = Math.floor((clientY - rect.top) / zoom);
    return viewFlipV ? canvasHeight - 1 - raw : raw;
  };

  const isOffCanvas = (pos: number, axis: GuideAxis): boolean => {
    const limit = axis === "x" ? canvasWidth : canvasHeight;
    return pos < 0 || pos > limit;
  };

  const handleRulerPointerDown = (
    axis: GuideAxis,
    e: React.PointerEvent<HTMLDivElement>
  ) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();

    const pos = Math.max(
      0,
      Math.min(
        axis === "x" ? canvasWidth : canvasHeight,
        clientToDocPos(e.clientX, e.clientY, axis)
      )
    );
    const prevCount = useEditorStore.getState().guides.length;
    addGuide(axis, pos);
    const nextGuides = useEditorStore.getState().guides;
    const created =
      nextGuides.length > prevCount ? nextGuides[nextGuides.length - 1] : null;
    activeDragRef.current = {
      axis,
      guideId: created?.id ?? null,
    };
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const handleRulerPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const drag = activeDragRef.current;
    if (!drag || !drag.guideId) return;
    const pos = clientToDocPos(e.clientX, e.clientY, drag.axis);
    moveGuide(drag.guideId, pos);
  };

  const handleRulerPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    const drag = activeDragRef.current;
    if (!drag) return;
    activeDragRef.current = null;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
    if (!drag.guideId) return;
    const pos = clientToDocPos(e.clientX, e.clientY, drag.axis);
    if (isOffCanvas(pos, drag.axis)) {
      removeGuide(drag.guideId);
    } else {
      moveGuide(drag.guideId, pos);
    }
  };

  const step = getTickStep(zoom);
  const hTicks: number[] = [];
  for (let x = 0; x <= canvasWidth; x += step) {
    hTicks.push(x);
  }
  const vTicks: number[] = [];
  for (let y = 0; y <= canvasHeight; y += step) {
    vTicks.push(y);
  }

  return (
    <div className="draw-rulers-layer" aria-hidden="true">
      <div
        className="draw-ruler-corner"
        style={{ width: RULER_SIZE, height: RULER_SIZE }}
        title="Rulers (click/drag ruler to add guide)"
      />

      <div
        className="draw-ruler-top"
        style={{ left: RULER_SIZE, height: RULER_SIZE }}
        title="Click or drag down to add horizontal guide"
        onPointerDown={(e) => handleRulerPointerDown("y", e)}
        onPointerMove={handleRulerPointerMove}
        onPointerUp={handleRulerPointerUp}
        onPointerCancel={handleRulerPointerUp}
      >
        {hTicks.map((x) => {
          const visualX = viewFlipH ? canvasWidth - x : x;
          const leftPx = frameLeft - RULER_SIZE + visualX * zoom;
          return (
            <div
              key={x}
              className="draw-ruler-tick-h"
              style={{ left: leftPx }}
            >
              <span>{x}</span>
            </div>
          );
        })}
        {guides
          .filter((g) => g.axis === "x")
          .map((g) => {
            const visualX = viewFlipH ? canvasWidth - g.pos : g.pos;
            const leftPx = frameLeft - RULER_SIZE + visualX * zoom;
            return (
              <div
                key={g.id}
                className="draw-ruler-guide-mark-h"
                style={{ left: leftPx }}
              />
            );
          })}
      </div>

      <div
        className="draw-ruler-left"
        style={{ top: RULER_SIZE, width: RULER_SIZE }}
        title="Click or drag right to add vertical guide"
        onPointerDown={(e) => handleRulerPointerDown("x", e)}
        onPointerMove={handleRulerPointerMove}
        onPointerUp={handleRulerPointerUp}
        onPointerCancel={handleRulerPointerUp}
      >
        {vTicks.map((y) => {
          const visualY = viewFlipV ? canvasHeight - y : y;
          const topPx = frameTop - RULER_SIZE + visualY * zoom;
          return (
            <div
              key={y}
              className="draw-ruler-tick-v"
              style={{ top: topPx }}
            >
              <span>{y}</span>
            </div>
          );
        })}
        {guides
          .filter((g) => g.axis === "y")
          .map((g) => {
            const visualY = viewFlipV ? canvasHeight - g.pos : g.pos;
            const topPx = frameTop - RULER_SIZE + visualY * zoom;
            return (
              <div
                key={g.id}
                className="draw-ruler-guide-mark-v"
                style={{ top: topPx }}
              />
            );
          })}
      </div>

      {/* Subtle frame-edge alignment markers */}
      <div
        className="draw-ruler-span-h"
        style={{ left: frameLeft, width: frameWidth, top: RULER_SIZE - 2 }}
      />
      <div
        className="draw-ruler-span-v"
        style={{ top: frameTop, height: frameHeight, left: RULER_SIZE - 2 }}
      />
    </div>
  );
}

import { useRef, useState } from "react";
import {
  hexToRgba,
  PixelBuffer,
  rgbaToHex,
  type RGBA,
} from "../../engine/document/PixelBuffer";
import { pixelEngine } from "../../engine/document/PixelEngine";
import { syncHistoryAndCelState } from "../../engine/document/historyActions";
import {
  commitFloatingSelection,
  deselectAll,
  liftSelectionForMove,
} from "../../engine/document/selectionActions";
import { plotIsoBox, plotIsoLine } from "../../engine/tiles/isometric";
import {
  getBrushFootprint,
  sampleStrokePoints,
  type BrushConfig,
} from "../../engine/tools/brush";
import { applyInkPixel, type InkContext, type InkMode } from "../../engine/tools/ink";
import {
  applyPixelPerfectFilter,
  constrainAngle,
  constrainSquareBounds,
  expandSymmetry,
  floodFill,
  plotBresenhamLine,
  plotEllipse,
  plotRect,
  type Point,
} from "../../engine/tools/pixelAlgos";
import {
  createLassoSelection,
  createMagicWandSelection,
  createRectSelection,
  type SelectionMask,
} from "../../engine/tools/selection";
import {
  isLayerEffectivelyLocked,
  useEditorStore,
  type ToolId,
} from "../../store/editorStore";
import { buildShadingRamp } from "../../utils/color";

export type DrawDragPreview =
  | { kind: "marquee"; x: number; y: number; w: number; h: number }
  | { kind: "lasso"; points: Point[] }
  | null;

interface ActiveDrawStroke {
  kind:
    | "freehand"
    | "fillBrush"
    | "shape"
    | "marquee"
    | "lasso"
    | "move"
    | "tileEdit"
    | "isoBox";
  tool: ToolId;
  layerId: string;
  frameIndex: number;
  alphaLock: boolean;
  isEraser: boolean;
  rgba: RGBA;
  brushCfg: BrushConfig;
  inkMode: InkMode;
  inkCtx: InkContext;
  rawPoints: Point[];
  paintedSet: Set<string>;
  visitedPixels: Set<string>;
  usePixelPerfect: boolean;
  startX: number;
  startY: number;
  lastPt: Point;
  origOffsetX: number;
  origOffsetY: number;
  origMask: SelectionMask | null;
  stampTileId: number;
}

export interface UseDrawPointerOptions {
  getPixelCoords: (e: React.PointerEvent<HTMLCanvasElement>) => Point;
  renderOverlayOnly: () => void;
}

export function wrapCoord(v: number, size: number): number {
  return ((v % size) + size) % size;
}

export function wrapPoint(
  pt: Point,
  w: number,
  h: number,
  enabled: boolean
): Point {
  if (!enabled) return pt;
  return { x: wrapCoord(pt.x, w), y: wrapCoord(pt.y, h) };
}

export function canWriteAt(x: number, y: number): boolean {
  const sel = pixelEngine.selection;
  if (!sel || sel.isEmpty()) return true;
  return sel.contains(x, y);
}

export function getFillBrushPoints(
  rawPoints: readonly Point[],
  w: number,
  h: number
): Point[] {
  const seen = new Set<string>();
  const pts: Point[] = [];
  const push = (x: number, y: number) => {
    if (x < 0 || y < 0 || x >= w || y >= h) return;
    const key = `${x},${y}`;
    if (seen.has(key)) return;
    seen.add(key);
    pts.push({ x, y });
  };
  for (const p of rawPoints) {
    push(p.x, p.y);
  }
  if (rawPoints.length >= 3) {
    const mask = createLassoSelection(w, h, rawPoints.slice());
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (mask.contains(x, y)) push(x, y);
      }
    }
  }
  return pts;
}

export function getShapePoints(
  tool: ToolId,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  filled: boolean,
  shiftKey: boolean,
  isoLineSnap = false
): Point[] {
  if (tool === "line") {
    if (shiftKey && isoLineSnap) {
      return plotIsoLine(x0, y0, x1, y1);
    }
    const end = shiftKey ? constrainAngle(x0, y0, x1, y1) : { x: x1, y: y1 };
    return plotBresenhamLine(x0, y0, end.x, end.y);
  }
  const end = shiftKey
    ? constrainSquareBounds(x0, y0, x1, y1)
    : { x: x1, y: y1 };
  if (tool === "rect") {
    return plotRect(x0, y0, end.x, end.y, filled);
  }
  return plotEllipse(x0, y0, end.x, end.y, filled);
}

export interface StampBrushOptions {
  brushCfg: BrushConfig;
  rgba: RGBA;
  isEraser?: boolean;
  alphaLock: boolean;
  symX: boolean;
  symY: boolean;
  seamlessWrap: boolean;
  inkMode?: InkMode;
  inkCtx?: InkContext;
  visitedPixels?: Set<string>;
}

export function stampBrushPoint(
  pt: Point,
  cel: PixelBuffer,
  opts: StampBrushOptions
): void {
  const footprint = getBrushFootprint(pt.x, pt.y, opts.brushCfg);
  const mode: InkMode = opts.inkMode ?? "simple";
  const trackVisited =
    opts.visitedPixels !== undefined &&
    (mode === "shadingRamp" || mode === "alphaBlend");

  for (const fp of footprint) {
    const syms = expandSymmetry(
      { x: fp.x, y: fp.y },
      cel.width,
      cel.height,
      opts.symX,
      opts.symY
    );
    for (const rawSp of syms) {
      const sp = wrapPoint(rawSp, cel.width, cel.height, opts.seamlessWrap);
      if (sp.x < 0 || sp.y < 0 || sp.x >= cel.width || sp.y >= cel.height) {
        continue;
      }
      if (!canWriteAt(sp.x, sp.y)) continue;

      const key = `${sp.x},${sp.y}`;
      if (trackVisited && opts.visitedPixels!.has(key)) {
        continue;
      }

      if (opts.isEraser) {
        pixelEngine.history.capturePixelTile(cel, sp.x, sp.y);
        cel.setPixel(sp.x, sp.y, 0, 0, 0, 0, opts.alphaLock);
        if (trackVisited) opts.visitedPixels!.add(key);
        continue;
      }

      const baseSrc: RGBA = fp.rgba ? fp.rgba : opts.rgba;
      const effectiveOpacity = Math.max(
        0,
        Math.min(100, Math.round(fp.alpha * 100))
      );
      const dst = cel.getPixel(sp.x, sp.y);
      const next = applyInkPixel(dst, baseSrc, sp.x, sp.y, mode, {
        ...opts.inkCtx,
        opacity: effectiveOpacity,
      });

      if (trackVisited) {
        opts.visitedPixels!.add(key);
      }
      if (!next) continue;

      pixelEngine.history.capturePixelTile(cel, sp.x, sp.y);
      cel.setPixel(
        sp.x,
        sp.y,
        next[0],
        next[1],
        next[2],
        next[3],
        opts.alphaLock
      );
    }
  }
}

function paintTilemapBrushPoint(
  pt: Point,
  brushCfg: BrushConfig,
  rgba: RGBA,
  alphaLock: boolean,
  symX: boolean,
  symY: boolean,
  seamlessWrapEnabled: boolean,
  layerId: string,
  frameIndex: number,
  activeTileId: number
): void {
  const footprint = getBrushFootprint(pt.x, pt.y, brushCfg);
  for (const fp of footprint) {
    const syms = expandSymmetry(
      { x: fp.x, y: fp.y },
      pixelEngine.width,
      pixelEngine.height,
      symX,
      symY
    );
    for (const rawSp of syms) {
      const sp = wrapPoint(
        rawSp,
        pixelEngine.width,
        pixelEngine.height,
        seamlessWrapEnabled
      );
      if (!canWriteAt(sp.x, sp.y)) continue;
      pixelEngine.editTilePixelAtCanvasCoord(
        layerId,
        frameIndex,
        sp.x,
        sp.y,
        rgba,
        alphaLock,
        activeTileId
      );
    }
  }
}

export function buildInkContextForDraw(
  primaryHex: string,
  secondaryHex: string,
  brushOpacity: number,
  shadingDirection: 1 | -1
): InkContext {
  const rampHexes = buildShadingRamp(primaryHex);
  const shadingRamp = rampHexes.map((h) => hexToRgba(h, 255));
  return {
    opacity: brushOpacity,
    secondaryRgba: hexToRgba(secondaryHex, 255),
    shadingRamp,
    shadingDirection,
    ditherThreshold: Math.max(0, Math.min(1, brushOpacity / 100)),
  };
}

export function isDrawRightClickPaintTool(tool: ToolId): boolean {
  return tool === "pencil" || tool === "eraser" || tool === "fillBrush";
}

export function useDrawPointer({
  getPixelCoords,
  renderOverlayOnly,
}: UseDrawPointerOptions) {
  const strokeRef = useRef<ActiveDrawStroke | null>(null);
  const lastStrokeEndRef = useRef<Map<string, Point>>(new Map());
  const suppressContextMenuRef = useRef(false);
  const [dragPreview, setDragPreview] = useState<DrawDragPreview>(null);

  const sampleColorAt = (px: number, py: number, isSecondary: boolean) => {
    const state = useEditorStore.getState();
    pixelEngine.compositeFrame(state.layers, state.currentFrame);
    const [r, g, b, a] = pixelEngine.sampleCompositedPixel(px, py);
    if (a === 0) return;
    const hex = rgbaToHex(r, g, b);
    if (isSecondary) {
      state.setSecondaryColor(hex);
    } else {
      state.setPrimaryColor(hex);
    }
    state.setStatusMessage(`Picked ${hex.toUpperCase()}`);
  };

  const hasActiveStroke = () => strokeRef.current !== null;

  const consumeSuppressContextMenu = (): boolean => {
    if (!suppressContextMenuRef.current) return false;
    suppressContextMenuRef.current = false;
    return true;
  };

  const updateDrawHoverOverlay = (px: number, py: number) => {
    const state = useEditorStore.getState();
    pixelEngine.clearOverlay();
    if (
      state.workspaceMode === "data" ||
      px < 0 ||
      py < 0 ||
      px >= state.canvasWidth ||
      py >= state.canvasHeight
    ) {
      renderOverlayOnly();
      return;
    }

    const tool = state.activeTool;
    // Brush footprints for pencil/eraser/fillBrush are rendered by DrawOverlay.tsx
    if (tool === "pencil" || tool === "eraser" || tool === "fillBrush") {
      renderOverlayOnly();
      return;
    }

    const isShapeHoverTool =
      tool === "line" ||
      ((tool === "rect" || tool === "ellipse") && !state.shapeFilled);
    const previewColor: RGBA =
      tool === "line" || tool === "rect" || tool === "ellipse"
        ? hexToRgba(state.primaryColor, 175)
        : [255, 255, 255, 140];

    const footprint = isShapeHoverTool
      ? getBrushFootprint(px, py, {
          shape: state.brushShape,
          size: state.brushSize,
          opacity: 100,
          pixelPerfect: false,
          spacing: 1,
          customBrush: state.customBrush,
        })
      : [{ x: px, y: py, alpha: 1 }];

    for (const fpt of footprint) {
      const symPts = expandSymmetry(
        { x: fpt.x, y: fpt.y },
        state.canvasWidth,
        state.canvasHeight,
        state.symmetryX,
        state.symmetryY
      );
      for (const rawSp of symPts) {
        const sp = wrapPoint(
          rawSp,
          state.canvasWidth,
          state.canvasHeight,
          state.seamlessWrap
        );
        pixelEngine.overlayBuffer.setPixel(
          sp.x,
          sp.y,
          previewColor[0],
          previewColor[1],
          previewColor[2],
          previewColor[3]
        );
      }
    }
    renderOverlayOnly();
  };

  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>): boolean => {
    const state = useEditorStore.getState();
    const { x: px, y: py } = getPixelCoords(e);
    const isRightButton = e.button === 2;

    if (e.altKey || state.activeTool === "eyedropper") {
      if (isRightButton) {
        suppressContextMenuRef.current = true;
      }
      sampleColorAt(px, py, isRightButton);
      return true;
    }

    const tool = state.activeTool;

    if (isRightButton) {
      if (!isDrawRightClickPaintTool(tool)) {
        return false;
      }
      suppressContextMenuRef.current = true;
      if (state.rightClickMode === "eyedropper") {
        sampleColorAt(px, py, true);
        return true;
      }
    } else if (e.button !== 0) {
      return false;
    }

    if (tool === "marquee") {
      commitFloatingSelection();
      e.currentTarget.setPointerCapture(e.pointerId);
      const cx = Math.max(0, Math.min(state.canvasWidth - 1, px));
      const cy = Math.max(0, Math.min(state.canvasHeight - 1, py));
      strokeRef.current = {
        kind: "marquee",
        tool,
        layerId: state.activeLayerId,
        frameIndex: state.currentFrame,
        alphaLock: false,
        isEraser: false,
        rgba: [0, 0, 0, 0],
        brushCfg: {
          shape: state.brushShape,
          size: state.brushSize,
          opacity: state.brushOpacity,
          pixelPerfect: state.pixelPerfect,
          spacing: state.brushSpacing,
          customBrush: state.customBrush,
        },
        inkMode: state.inkMode,
        inkCtx: {},
        rawPoints: [],
        paintedSet: new Set(),
        visitedPixels: new Set(),
        usePixelPerfect: false,
        startX: cx,
        startY: cy,
        lastPt: { x: cx, y: cy },
        origOffsetX: 0,
        origOffsetY: 0,
        origMask: null,
        stampTileId: 0,
      };
      setDragPreview({ kind: "marquee", x: cx, y: cy, w: 1, h: 1 });
      return true;
    }

    if (tool === "lasso") {
      commitFloatingSelection();
      e.currentTarget.setPointerCapture(e.pointerId);
      const pt = {
        x: Math.max(0, Math.min(state.canvasWidth - 1, px)),
        y: Math.max(0, Math.min(state.canvasHeight - 1, py)),
      };
      strokeRef.current = {
        kind: "lasso",
        tool,
        layerId: state.activeLayerId,
        frameIndex: state.currentFrame,
        alphaLock: false,
        isEraser: false,
        rgba: [0, 0, 0, 0],
        brushCfg: {
          shape: state.brushShape,
          size: state.brushSize,
          opacity: state.brushOpacity,
          pixelPerfect: state.pixelPerfect,
          spacing: state.brushSpacing,
          customBrush: state.customBrush,
        },
        inkMode: state.inkMode,
        inkCtx: {},
        rawPoints: [pt],
        paintedSet: new Set(),
        visitedPixels: new Set(),
        usePixelPerfect: false,
        startX: pt.x,
        startY: pt.y,
        lastPt: pt,
        origOffsetX: 0,
        origOffsetY: 0,
        origMask: null,
        stampTileId: 0,
      };
      setDragPreview({ kind: "lasso", points: [pt] });
      return true;
    }

    if (tool === "wand") {
      commitFloatingSelection();
      const cel = pixelEngine.getOrCreateCel(
        state.activeLayerId,
        state.currentFrame
      );
      const mask = createMagicWandSelection(cel, px, py, state.fillContiguous);
      pixelEngine.setSelection(mask);
      state.setHasSelection(!mask.isEmpty());
      return true;
    }

    if (tool === "move") {
      if (!liftSelectionForMove(state.activeLayerId, state.currentFrame)) {
        return true;
      }
      const fl = pixelEngine.floating;
      if (!fl) return true;
      e.currentTarget.setPointerCapture(e.pointerId);
      strokeRef.current = {
        kind: "move",
        tool,
        layerId: fl.sourceLayerId,
        frameIndex: fl.sourceFrameIndex,
        alphaLock: false,
        isEraser: false,
        rgba: [0, 0, 0, 0],
        brushCfg: {
          shape: state.brushShape,
          size: state.brushSize,
          opacity: state.brushOpacity,
          pixelPerfect: state.pixelPerfect,
          spacing: state.brushSpacing,
          customBrush: state.customBrush,
        },
        inkMode: state.inkMode,
        inkCtx: {},
        rawPoints: [],
        paintedSet: new Set(),
        visitedPixels: new Set(),
        usePixelPerfect: false,
        startX: px,
        startY: py,
        lastPt: { x: px, y: py },
        origOffsetX: fl.offsetX,
        origOffsetY: fl.offsetY,
        origMask: pixelEngine.selection?.clone() ?? null,
        stampTileId: 0,
      };
      return true;
    }

    // Drawing / tile tools commit any floating selection before writing
    commitFloatingSelection();

    const activeLayer = state.layers.find((l) => l.id === state.activeLayerId);
    if (!activeLayer || activeLayer.kind === "group") {
      state.setStatusMessage("Select a raster or tilemap layer to draw");
      return true;
    }
    if (isLayerEffectivelyLocked(state.layers, activeLayer.id)) {
      state.setStatusMessage(`Layer "${activeLayer.name}" is locked`);
      return true;
    }

    const rmbErase = isRightButton && state.rightClickMode === "erase";
    const rmbSecondary = isRightButton && state.rightClickMode === "secondaryColor";
    const isEraser = tool === "eraser" || rmbErase;
    const chosenHex = rmbSecondary ? state.secondaryColor : state.primaryColor;
    const rgba: RGBA = isEraser ? [0, 0, 0, 0] : hexToRgba(chosenHex, 255);
    const brushCfg: BrushConfig = {
      shape: state.brushShape,
      size: state.brushSize,
      opacity: state.brushOpacity,
      pixelPerfect: state.pixelPerfect,
      spacing: state.brushSpacing,
      customBrush: state.customBrush,
    };
    const inkMode: InkMode = isEraser ? "simple" : state.inkMode;
    const shadingDirection: 1 | -1 = isRightButton ? -1 : 1;
    const inkCtx = buildInkContextForDraw(
      chosenHex,
      rmbSecondary ? state.primaryColor : state.secondaryColor,
      state.brushOpacity,
      shadingDirection
    );

    if (activeLayer.kind === "tilemap") {
      if (tool !== "pencil" && tool !== "eraser") {
        state.setStatusMessage(
          "Use Tile Stamp (T) or Pencil/Eraser on Tilemap layers"
        );
        return true;
      }
      e.currentTarget.setPointerCapture(e.pointerId);
      pixelEngine.clearOverlay();
      const startPt = { x: px, y: py };
      paintTilemapBrushPoint(
        startPt,
        brushCfg,
        rgba,
        activeLayer.alphaLock,
        state.symmetryX,
        state.symmetryY,
        state.seamlessWrap,
        activeLayer.id,
        state.currentFrame,
        state.activeTileId
      );
      strokeRef.current = {
        kind: "tileEdit",
        tool,
        layerId: activeLayer.id,
        frameIndex: state.currentFrame,
        alphaLock: activeLayer.alphaLock,
        isEraser,
        rgba,
        brushCfg,
        inkMode,
        inkCtx,
        rawPoints: [startPt],
        paintedSet: new Set(),
        visitedPixels: new Set(),
        usePixelPerfect: false,
        startX: px,
        startY: py,
        lastPt: startPt,
        origOffsetX: 0,
        origOffsetY: 0,
        origMask: null,
        stampTileId: state.activeTileId,
      };
      pixelEngine.emitChange();
      return true;
    }

    if (tool === "fill") {
      const cel = pixelEngine.getOrCreateCel(activeLayer.id, state.currentFrame);
      pixelEngine.history.beginTransaction(
        activeLayer.id,
        state.currentFrame,
        "Paint Bucket"
      );
      const count = floodFill(
        cel,
        px,
        py,
        rgba,
        state.fillContiguous,
        activeLayer.alphaLock,
        (cx, cy) => pixelEngine.history.capturePixelTile(cel, cx, cy),
        pixelEngine.selection
      );
      if (count > 0 && pixelEngine.history.commitTransaction(cel)) {
        syncHistoryAndCelState(activeLayer.id, state.currentFrame);
        pixelEngine.emitChange();
      } else {
        pixelEngine.history.cancelTransaction();
      }
      return true;
    }

    if (tool === "fillBrush") {
      e.currentTarget.setPointerCapture(e.pointerId);
      pixelEngine.clearOverlay();
      const startPt = { x: px, y: py };
      pixelEngine.overlayBuffer.setPixel(
        px,
        py,
        rgba[0],
        rgba[1],
        rgba[2],
        isEraser ? 160 : Math.round((state.brushOpacity / 100) * 255)
      );
      renderOverlayOnly();
      strokeRef.current = {
        kind: "fillBrush",
        tool,
        layerId: activeLayer.id,
        frameIndex: state.currentFrame,
        alphaLock: activeLayer.alphaLock,
        isEraser,
        rgba,
        brushCfg,
        inkMode,
        inkCtx,
        rawPoints: [startPt],
        paintedSet: new Set(),
        visitedPixels: new Set(),
        usePixelPerfect: false,
        startX: px,
        startY: py,
        lastPt: startPt,
        origOffsetX: 0,
        origOffsetY: 0,
        origMask: null,
        stampTileId: 0,
      };
      return true;
    }

    if (tool === "pencil" || tool === "eraser") {
      e.currentTarget.setPointerCapture(e.pointerId);
      pixelEngine.clearOverlay();
      const cel = pixelEngine.getOrCreateCel(activeLayer.id, state.currentFrame);
      pixelEngine.history.beginTransaction(
        activeLayer.id,
        state.currentFrame,
        isEraser ? "Eraser" : "Pencil"
      );

      const usePixelPerfect =
        state.pixelPerfect &&
        state.brushSize === 1 &&
        state.brushShape !== "custom" &&
        inkMode === "simple" &&
        !isEraser;
      const startPt = { x: px, y: py };
      const paintedSet = new Set<string>();
      const visitedPixels = new Set<string>();
      const celKey = `${activeLayer.id}:${state.currentFrame}`;
      const prevEndpoint = lastStrokeEndRef.current.get(celKey);

      if (e.shiftKey && prevEndpoint) {
        const linePts = sampleStrokePoints(
          prevEndpoint.x,
          prevEndpoint.y,
          startPt.x,
          startPt.y,
          brushCfg.spacing
        );
        for (const pt of linePts) {
          stampBrushPoint(pt, cel, {
            brushCfg,
            rgba,
            isEraser,
            alphaLock: activeLayer.alphaLock,
            symX: state.symmetryX,
            symY: state.symmetryY,
            seamlessWrap: state.seamlessWrap,
            inkMode,
            inkCtx,
            visitedPixels,
          });
        }
      } else if (usePixelPerfect) {
        const syms = expandSymmetry(
          startPt,
          cel.width,
          cel.height,
          state.symmetryX,
          state.symmetryY
        );
        for (const rawSp of syms) {
          const sp = wrapPoint(rawSp, cel.width, cel.height, state.seamlessWrap);
          if (!canWriteAt(sp.x, sp.y)) continue;
          pixelEngine.history.capturePixelTile(cel, sp.x, sp.y);
          cel.setPixel(
            sp.x,
            sp.y,
            rgba[0],
            rgba[1],
            rgba[2],
            rgba[3],
            activeLayer.alphaLock
          );
        }
        paintedSet.add(`${px},${py}`);
      } else {
        stampBrushPoint(startPt, cel, {
          brushCfg,
          rgba,
          isEraser,
          alphaLock: activeLayer.alphaLock,
          symX: state.symmetryX,
          symY: state.symmetryY,
          seamlessWrap: state.seamlessWrap,
          inkMode,
          inkCtx,
          visitedPixels,
        });
      }

      lastStrokeEndRef.current.set(celKey, startPt);

      strokeRef.current = {
        kind: "freehand",
        tool,
        layerId: activeLayer.id,
        frameIndex: state.currentFrame,
        alphaLock: activeLayer.alphaLock,
        isEraser,
        rgba,
        brushCfg,
        inkMode,
        inkCtx,
        rawPoints: [startPt],
        paintedSet,
        visitedPixels,
        usePixelPerfect,
        startX: px,
        startY: py,
        lastPt: startPt,
        origOffsetX: 0,
        origOffsetY: 0,
        origMask: null,
        stampTileId: 0,
      };
      pixelEngine.emitChange();
      return true;
    }

    if (tool === "isoBox") {
      e.currentTarget.setPointerCapture(e.pointerId);
      strokeRef.current = {
        kind: "isoBox",
        tool,
        layerId: activeLayer.id,
        frameIndex: state.currentFrame,
        alphaLock: activeLayer.alphaLock,
        isEraser: false,
        rgba,
        brushCfg,
        inkMode: "simple",
        inkCtx: {},
        rawPoints: [],
        paintedSet: new Set(),
        visitedPixels: new Set(),
        usePixelPerfect: false,
        startX: px,
        startY: py,
        lastPt: { x: px, y: py },
        origOffsetX: 0,
        origOffsetY: 0,
        origMask: null,
        stampTileId: 0,
      };
      pixelEngine.clearOverlay();
      const box = plotIsoBox(px, py, 4, state.isoBoxHeight);
      const ramp = buildShadingRamp(chosenHex);
      const topRgba = hexToRgba(ramp[3], 255);
      const leftRgba = hexToRgba(ramp[2], 255);
      const rightRgba = hexToRgba(ramp[0], 255);
      for (const p of box.top) {
        pixelEngine.overlayBuffer.setPixel(p.x, p.y, ...topRgba);
      }
      for (const p of box.left) {
        pixelEngine.overlayBuffer.setPixel(p.x, p.y, ...leftRgba);
      }
      for (const p of box.right) {
        pixelEngine.overlayBuffer.setPixel(p.x, p.y, ...rightRgba);
      }
      renderOverlayOnly();
      return true;
    }

    if (tool === "line" || tool === "rect" || tool === "ellipse") {
      e.currentTarget.setPointerCapture(e.pointerId);
      strokeRef.current = {
        kind: "shape",
        tool,
        layerId: activeLayer.id,
        frameIndex: state.currentFrame,
        alphaLock: activeLayer.alphaLock,
        isEraser: false,
        rgba,
        brushCfg,
        inkMode: "simple",
        inkCtx: {},
        rawPoints: [],
        paintedSet: new Set(),
        visitedPixels: new Set(),
        usePixelPerfect: false,
        startX: px,
        startY: py,
        lastPt: { x: px, y: py },
        origOffsetX: 0,
        origOffsetY: 0,
        origMask: null,
        stampTileId: 0,
      };
      pixelEngine.clearOverlay();
      const previewPts = getShapePoints(
        tool,
        px,
        py,
        px,
        py,
        state.shapeFilled,
        e.shiftKey,
        state.showIsoGrid
      );
      const stampSize =
        tool === "line" || !state.shapeFilled ? state.brushSize : 1;
      const shapeBrushCfg: BrushConfig = {
        ...brushCfg,
        shape:
          tool === "line" || !state.shapeFilled ? brushCfg.shape : "circle",
        size: stampSize,
      };
      for (const pt of previewPts) {
        for (const fp of getBrushFootprint(pt.x, pt.y, shapeBrushCfg)) {
          for (const rawSp of expandSymmetry(
            { x: fp.x, y: fp.y },
            state.canvasWidth,
            state.canvasHeight,
            state.symmetryX,
            state.symmetryY
          )) {
            const sp = wrapPoint(
              rawSp,
              state.canvasWidth,
              state.canvasHeight,
              state.seamlessWrap
            );
            if (!canWriteAt(sp.x, sp.y)) continue;
            pixelEngine.overlayBuffer.setPixel(
              sp.x,
              sp.y,
              rgba[0],
              rgba[1],
              rgba[2],
              rgba[3]
            );
          }
        }
      }
      renderOverlayOnly();
      return true;
    }

    return false;
  };

  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>): boolean => {
    const stroke = strokeRef.current;
    if (!stroke) return false;

    const state = useEditorStore.getState();
    const { x: px, y: py } = getPixelCoords(e);

    if (stroke.kind === "marquee") {
      const clampedX = Math.max(0, Math.min(state.canvasWidth - 1, px));
      const clampedY = Math.max(0, Math.min(state.canvasHeight - 1, py));
      const end = e.shiftKey
        ? constrainSquareBounds(stroke.startX, stroke.startY, clampedX, clampedY)
        : { x: clampedX, y: clampedY };
      const minX = Math.max(0, Math.min(stroke.startX, end.x));
      const minY = Math.max(0, Math.min(stroke.startY, end.y));
      const maxX = Math.min(
        state.canvasWidth - 1,
        Math.max(stroke.startX, end.x)
      );
      const maxY = Math.min(
        state.canvasHeight - 1,
        Math.max(stroke.startY, end.y)
      );
      setDragPreview({
        kind: "marquee",
        x: minX,
        y: minY,
        w: maxX - minX + 1,
        h: maxY - minY + 1,
      });
      return true;
    }

    if (stroke.kind === "lasso") {
      const clampedX = Math.max(0, Math.min(state.canvasWidth - 1, px));
      const clampedY = Math.max(0, Math.min(state.canvasHeight - 1, py));
      const last = stroke.rawPoints[stroke.rawPoints.length - 1];
      if (!last || last.x !== clampedX || last.y !== clampedY) {
        stroke.rawPoints.push({ x: clampedX, y: clampedY });
        setDragPreview({ kind: "lasso", points: stroke.rawPoints.slice() });
      }
      return true;
    }

    if (stroke.kind === "move") {
      const fl = pixelEngine.floating;
      if (!fl) return true;
      const dx = px - stroke.startX;
      const dy = py - stroke.startY;
      fl.offsetX = stroke.origOffsetX + dx;
      fl.offsetY = stroke.origOffsetY + dy;
      if (stroke.origMask) {
        pixelEngine.selection = stroke.origMask.translate(dx, dy);
      }
      pixelEngine.emitChange();
      return true;
    }

    if (stroke.kind === "isoBox") {
      pixelEngine.clearOverlay();
      const halfW = Math.max(2, Math.abs(px - stroke.startX));
      const box = plotIsoBox(
        stroke.startX,
        stroke.startY,
        halfW,
        state.isoBoxHeight
      );
      const ramp = buildShadingRamp(
        rgbaToHex(stroke.rgba[0], stroke.rgba[1], stroke.rgba[2])
      );
      const faces: Array<[Point[], RGBA]> = [
        [box.top, hexToRgba(ramp[3], 255)],
        [box.left, hexToRgba(ramp[2], 255)],
        [box.right, hexToRgba(ramp[0], 255)],
      ];
      for (const [pts, faceRgba] of faces) {
        for (const pt of pts) {
          const sp = wrapPoint(
            pt,
            state.canvasWidth,
            state.canvasHeight,
            state.seamlessWrap
          );
          if (!canWriteAt(sp.x, sp.y)) continue;
          pixelEngine.overlayBuffer.setPixel(sp.x, sp.y, ...faceRgba);
        }
      }
      renderOverlayOnly();
      return true;
    }

    if (stroke.kind === "fillBrush") {
      const last = stroke.rawPoints[stroke.rawPoints.length - 1];
      if (last.x === px && last.y === py) return true;
      const segment = plotBresenhamLine(last.x, last.y, px, py);
      for (let i = 1; i < segment.length; i++) {
        stroke.rawPoints.push(segment[i]);
      }

      pixelEngine.clearOverlay();
      const fillPts = getFillBrushPoints(
        stroke.rawPoints,
        state.canvasWidth,
        state.canvasHeight
      );
      const previewAlpha = stroke.isEraser
        ? 160
        : Math.round((state.brushOpacity / 100) * 255);
      for (const pt of fillPts) {
        for (const rawSp of expandSymmetry(
          pt,
          state.canvasWidth,
          state.canvasHeight,
          state.symmetryX,
          state.symmetryY
        )) {
          const sp = wrapPoint(
            rawSp,
            state.canvasWidth,
            state.canvasHeight,
            state.seamlessWrap
          );
          if (!canWriteAt(sp.x, sp.y)) continue;
          pixelEngine.overlayBuffer.setPixel(
            sp.x,
            sp.y,
            stroke.rgba[0],
            stroke.rgba[1],
            stroke.rgba[2],
            previewAlpha
          );
        }
      }
      renderOverlayOnly();
      return true;
    }

    if (stroke.kind === "tileEdit") {
      const last = stroke.rawPoints[stroke.rawPoints.length - 1];
      if (last.x === px && last.y === py) return true;
      const segment = plotBresenhamLine(last.x, last.y, px, py);
      for (let i = 1; i < segment.length; i++) {
        stroke.rawPoints.push(segment[i]);
        paintTilemapBrushPoint(
          segment[i],
          stroke.brushCfg,
          stroke.rgba,
          stroke.alphaLock,
          state.symmetryX,
          state.symmetryY,
          state.seamlessWrap,
          stroke.layerId,
          stroke.frameIndex,
          stroke.stampTileId
        );
      }
      pixelEngine.emitChange();
      return true;
    }

    if (stroke.kind === "freehand") {
      const last = stroke.lastPt;
      if (last.x === px && last.y === py) return true;

      const cel = pixelEngine.getOrCreateCel(stroke.layerId, stroke.frameIndex);

      if (stroke.usePixelPerfect) {
        const segment = plotBresenhamLine(last.x, last.y, px, py);
        for (let i = 1; i < segment.length; i++) {
          stroke.rawPoints.push(segment[i]);
        }
        stroke.lastPt = { x: px, y: py };
        lastStrokeEndRef.current.set(
          `${stroke.layerId}:${stroke.frameIndex}`,
          stroke.lastPt
        );

        const nextFiltered = applyPixelPerfectFilter(stroke.rawPoints);
        const nextSet = new Set(nextFiltered.map((p) => `${p.x},${p.y}`));

        for (const prevKey of stroke.paintedSet) {
          if (nextSet.has(prevKey)) continue;
          const [rx, ry] = prevKey.split(",").map(Number);
          const syms = expandSymmetry(
            { x: rx, y: ry },
            cel.width,
            cel.height,
            state.symmetryX,
            state.symmetryY
          );
          for (const rawSp of syms) {
            const sp = wrapPoint(rawSp, cel.width, cel.height, state.seamlessWrap);
            if (!canWriteAt(sp.x, sp.y)) continue;
            const orig = pixelEngine.history.getOriginalPixel(sp.x, sp.y);
            if (orig) {
              cel.setPixel(sp.x, sp.y, orig[0], orig[1], orig[2], orig[3], false);
            }
          }
        }

        for (const pt of nextFiltered) {
          const key = `${pt.x},${pt.y}`;
          if (stroke.paintedSet.has(key)) continue;
          const syms = expandSymmetry(
            pt,
            cel.width,
            cel.height,
            state.symmetryX,
            state.symmetryY
          );
          for (const rawSp of syms) {
            const sp = wrapPoint(rawSp, cel.width, cel.height, state.seamlessWrap);
            if (!canWriteAt(sp.x, sp.y)) continue;
            pixelEngine.history.capturePixelTile(cel, sp.x, sp.y);
            cel.setPixel(
              sp.x,
              sp.y,
              stroke.rgba[0],
              stroke.rgba[1],
              stroke.rgba[2],
              stroke.rgba[3],
              stroke.alphaLock
            );
          }
        }

        stroke.paintedSet = nextSet;
      } else {
        const segment = sampleStrokePoints(
          last.x,
          last.y,
          px,
          py,
          stroke.brushCfg.spacing
        );
        for (let i = 1; i < segment.length; i++) {
          stroke.rawPoints.push(segment[i]);
          stampBrushPoint(segment[i], cel, {
            brushCfg: stroke.brushCfg,
            rgba: stroke.rgba,
            isEraser: stroke.isEraser,
            alphaLock: stroke.alphaLock,
            symX: state.symmetryX,
            symY: state.symmetryY,
            seamlessWrap: state.seamlessWrap,
            inkMode: stroke.inkMode,
            inkCtx: stroke.inkCtx,
            visitedPixels: stroke.visitedPixels,
          });
        }
        stroke.lastPt = { x: px, y: py };
        lastStrokeEndRef.current.set(
          `${stroke.layerId}:${stroke.frameIndex}`,
          stroke.lastPt
        );
      }

      pixelEngine.emitChange();
      return true;
    }

    // Live shape preview on overlayBuffer
    pixelEngine.clearOverlay();
    const pts = getShapePoints(
      stroke.tool,
      stroke.startX,
      stroke.startY,
      px,
      py,
      state.shapeFilled,
      e.shiftKey,
      state.showIsoGrid
    );
    const stampSize =
      stroke.tool === "line" || !state.shapeFilled ? state.brushSize : 1;
    const shapeBrushCfg: BrushConfig = {
      ...stroke.brushCfg,
      shape:
        stroke.tool === "line" || !state.shapeFilled
          ? stroke.brushCfg.shape
          : "circle",
      size: stampSize,
    };

    for (const pt of pts) {
      for (const fp of getBrushFootprint(pt.x, pt.y, shapeBrushCfg)) {
        for (const rawSp of expandSymmetry(
          { x: fp.x, y: fp.y },
          state.canvasWidth,
          state.canvasHeight,
          state.symmetryX,
          state.symmetryY
        )) {
          const sp = wrapPoint(
            rawSp,
            state.canvasWidth,
            state.canvasHeight,
            state.seamlessWrap
          );
          if (!canWriteAt(sp.x, sp.y)) continue;
          pixelEngine.overlayBuffer.setPixel(
            sp.x,
            sp.y,
            stroke.rgba[0],
            stroke.rgba[1],
            stroke.rgba[2],
            stroke.rgba[3]
          );
        }
      }
    }
    renderOverlayOnly();
    return true;
  };

  const onPointerUp = (e: React.PointerEvent<HTMLCanvasElement>): boolean => {
    const stroke = strokeRef.current;
    if (!stroke) return false;
    strokeRef.current = null;

    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }

    const state = useEditorStore.getState();
    const { x: px, y: py } = getPixelCoords(e);

    if (stroke.kind === "marquee") {
      setDragPreview(null);
      const clampedX = Math.max(0, Math.min(state.canvasWidth - 1, px));
      const clampedY = Math.max(0, Math.min(state.canvasHeight - 1, py));
      const end = e.shiftKey
        ? constrainSquareBounds(stroke.startX, stroke.startY, clampedX, clampedY)
        : { x: clampedX, y: clampedY };
      if (end.x === stroke.startX && end.y === stroke.startY) {
        deselectAll();
        return true;
      }
      const mask = createRectSelection(
        state.canvasWidth,
        state.canvasHeight,
        stroke.startX,
        stroke.startY,
        end.x,
        end.y
      );
      pixelEngine.setSelection(mask);
      state.setHasSelection(!mask.isEmpty());
      return true;
    }

    if (stroke.kind === "lasso") {
      setDragPreview(null);
      if (stroke.rawPoints.length < 3) {
        deselectAll();
        return true;
      }
      const mask = createLassoSelection(
        state.canvasWidth,
        state.canvasHeight,
        stroke.rawPoints
      );
      pixelEngine.setSelection(mask);
      state.setHasSelection(!mask.isEmpty());
      return true;
    }

    if (stroke.kind === "move") {
      pixelEngine.emitChange();
      return true;
    }

    if (stroke.kind === "tileEdit") {
      state.bumpTilesetVersion();
      pixelEngine.emitChange();
      return true;
    }

    const cel = pixelEngine.getOrCreateCel(stroke.layerId, stroke.frameIndex);

    if (stroke.kind === "isoBox") {
      pixelEngine.clearOverlay();
      const halfW = Math.max(2, Math.abs(px - stroke.startX));
      const box = plotIsoBox(
        stroke.startX,
        stroke.startY,
        halfW,
        state.isoBoxHeight
      );
      const ramp = buildShadingRamp(
        rgbaToHex(stroke.rgba[0], stroke.rgba[1], stroke.rgba[2])
      );
      const faces: Array<[Point[], RGBA]> = [
        [box.top, hexToRgba(ramp[3], 255)],
        [box.left, hexToRgba(ramp[2], 255)],
        [box.right, hexToRgba(ramp[0], 255)],
      ];
      pixelEngine.history.beginTransaction(
        stroke.layerId,
        stroke.frameIndex,
        "Iso Box"
      );
      for (const [pts, faceRgba] of faces) {
        for (const pt of pts) {
          const sp = wrapPoint(
            pt,
            cel.width,
            cel.height,
            state.seamlessWrap
          );
          if (!canWriteAt(sp.x, sp.y)) continue;
          pixelEngine.history.capturePixelTile(cel, sp.x, sp.y);
          cel.setPixel(
            sp.x,
            sp.y,
            faceRgba[0],
            faceRgba[1],
            faceRgba[2],
            faceRgba[3],
            stroke.alphaLock
          );
        }
      }
      if (pixelEngine.history.commitTransaction(cel)) {
        syncHistoryAndCelState(stroke.layerId, stroke.frameIndex);
      } else {
        pixelEngine.history.cancelTransaction();
      }
      pixelEngine.emitChange();
      return true;
    }

    if (stroke.kind === "fillBrush") {
      pixelEngine.clearOverlay();
      pixelEngine.history.beginTransaction(
        stroke.layerId,
        stroke.frameIndex,
        stroke.isEraser ? "Erase Fill Brush" : "Fill Brush"
      );
      const fillPts = getFillBrushPoints(
        stroke.rawPoints,
        cel.width,
        cel.height
      );
      const fillBrushCfg: BrushConfig = {
        ...stroke.brushCfg,
        shape: "circle",
        size: 1,
      };
      const visited = new Set<string>();
      for (const pt of fillPts) {
        stampBrushPoint(pt, cel, {
          brushCfg: fillBrushCfg,
          rgba: stroke.rgba,
          isEraser: stroke.isEraser,
          alphaLock: stroke.alphaLock,
          symX: state.symmetryX,
          symY: state.symmetryY,
          seamlessWrap: state.seamlessWrap,
          inkMode: stroke.inkMode,
          inkCtx: stroke.inkCtx,
          visitedPixels: visited,
        });
      }
      if (pixelEngine.history.commitTransaction(cel)) {
        syncHistoryAndCelState(stroke.layerId, stroke.frameIndex);
      } else {
        pixelEngine.history.cancelTransaction();
      }
      pixelEngine.emitChange();
      return true;
    }

    if (stroke.kind === "shape") {
      pixelEngine.clearOverlay();
      const label =
        stroke.tool === "line"
          ? "Line"
          : stroke.tool === "rect"
            ? "Rectangle"
            : "Ellipse";
      pixelEngine.history.beginTransaction(
        stroke.layerId,
        stroke.frameIndex,
        label
      );
      const pts = getShapePoints(
        stroke.tool,
        stroke.startX,
        stroke.startY,
        px,
        py,
        state.shapeFilled,
        e.shiftKey,
        state.showIsoGrid
      );
      const stampSize =
        stroke.tool === "line" || !state.shapeFilled ? state.brushSize : 1;
      const shapeBrushCfg: BrushConfig = {
        ...stroke.brushCfg,
        shape:
          stroke.tool === "line" || !state.shapeFilled
            ? stroke.brushCfg.shape
            : "circle",
        size: stampSize,
      };
      for (const pt of pts) {
        stampBrushPoint(pt, cel, {
          brushCfg: shapeBrushCfg,
          rgba: stroke.rgba,
          isEraser: false,
          alphaLock: stroke.alphaLock,
          symX: state.symmetryX,
          symY: state.symmetryY,
          seamlessWrap: state.seamlessWrap,
          inkMode: "simple",
          inkCtx: {},
        });
      }
      if (pixelEngine.history.commitTransaction(cel)) {
        syncHistoryAndCelState(stroke.layerId, stroke.frameIndex);
      } else {
        pixelEngine.history.cancelTransaction();
      }
      pixelEngine.emitChange();
      return true;
    }

    if (pixelEngine.history.commitTransaction(cel)) {
      syncHistoryAndCelState(stroke.layerId, stroke.frameIndex);
    } else {
      pixelEngine.history.cancelTransaction();
    }
    pixelEngine.emitChange();
    return true;
  };

  return {
    dragPreview,
    hasActiveStroke,
    consumeSuppressContextMenu,
    updateDrawHoverOverlay,
    onPointerDown,
    onPointerMove,
    onPointerUp,
  };
}

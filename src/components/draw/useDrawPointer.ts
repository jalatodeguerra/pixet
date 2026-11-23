import { useEffect, useRef, useState } from "react";
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
import {
  plotPolygon,
  plotQuadraticBezier,
} from "../../engine/tools/curves";
import { type DitherPattern } from "../../engine/tools/dither";
import { renderGradientToBuffer } from "../../engine/tools/gradient";
import { snapPointToGuides } from "../../engine/tools/guides";
import { applyInkPixel, type InkContext, type InkMode } from "../../engine/tools/ink";
import {
  applyPixelPerfectFilter,
  constrainAngle,
  constrainSquareBounds,
  floodFill,
  plotBresenhamLine,
  plotEllipse,
  plotRect,
  type Point,
} from "../../engine/tools/pixelAlgos";
import {
  combineSelectionMasks,
  createLassoSelection,
  createMagicWandSelection,
  createRectSelection,
  SelectionMask,
  type SelectionCombineMode,
} from "../../engine/tools/selection";
import {
  applyJumbleFootprint,
  generateSprayPoints,
} from "../../engine/tools/sprayJumble";
import { expandSymmetryV2, type SymmetryConfig } from "../../engine/tools/symmetry";
import {
  isLayerEffectivelyLocked,
  useEditorStore,
  type ToolId,
} from "../../store/editorStore";
import { buildShadingRamp } from "../../utils/color";

export type DrawDragPreview =
  | { kind: "marquee"; x: number; y: number; w: number; h: number }
  | { kind: "ellipseMarquee"; x: number; y: number; w: number; h: number }
  | { kind: "lasso"; points: Point[] }
  | { kind: "polyLasso"; points: Point[]; cursor: Point }
  | { kind: "gradient"; x0: number; y0: number; x1: number; y1: number }
  | {
      kind: "curve";
      p0: Point;
      p1: Point;
      p2: Point;
      stage: "endpoints" | "control";
    }
  | { kind: "polygon"; points: Point[]; cursor: Point }
  | null;

interface ActiveDrawStroke {
  kind:
    | "freehand"
    | "fillBrush"
    | "spray"
    | "jumble"
    | "gradient"
    | "shape"
    | "marquee"
    | "ellipseMarquee"
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
  secondaryRgba: RGBA;
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
  combineMode: SelectionCombineMode;
  sprayCounter: number;
}

interface PendingCurveState {
  stage: "endpoints" | "control";
  layerId: string;
  frameIndex: number;
  alphaLock: boolean;
  rgba: RGBA;
  brushCfg: BrushConfig;
  p0: Point;
  p1: Point;
  p2: Point;
}

interface PendingPolygonState {
  layerId: string;
  frameIndex: number;
  alphaLock: boolean;
  rgba: RGBA;
  brushCfg: BrushConfig;
  points: Point[];
  cursor: Point;
  lastClickTime: number;
}

interface PendingPolyLassoState {
  points: Point[];
  cursor: Point;
  combineMode: SelectionCombineMode;
  lastClickTime: number;
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

export function getSelectionCombineMode(e: {
  shiftKey: boolean;
  altKey: boolean;
}): SelectionCombineMode {
  if (e.shiftKey && e.altKey) return "intersect";
  if (e.shiftKey) return "add";
  if (e.altKey) return "subtract";
  return "replace";
}

export function getSymmetryConfigFromState(state: {
  canvasWidth: number;
  canvasHeight: number;
  symmetryX: boolean;
  symmetryY: boolean;
  symmetryAxisX: number | null;
  symmetryAxisY: number | null;
  symmetryDiag45: boolean;
  symmetryDiag135: boolean;
  symmetryRadial: number;
}): SymmetryConfig {
  const axisX = state.symmetryAxisX ?? state.canvasWidth / 2;
  const axisY = state.symmetryAxisY ?? state.canvasHeight / 2;
  return {
    symX: state.symmetryX,
    symY: state.symmetryY,
    axisX,
    axisY,
    diag45: state.symmetryDiag45,
    diag135: state.symmetryDiag135,
    radialSegments: state.symmetryRadial,
    radialCx: axisX - 0.5,
    radialCy: axisY - 0.5,
  };
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
  symX?: boolean;
  symY?: boolean;
  symmetry?: SymmetryConfig;
  seamlessWrap: boolean;
  inkMode?: InkMode;
  inkCtx?: InkContext;
  visitedPixels?: Set<string>;
}

function resolveSymmetry(celWidth: number, celHeight: number, opts: StampBrushOptions): SymmetryConfig {
  if (opts.symmetry) return opts.symmetry;
  return {
    symX: Boolean(opts.symX),
    symY: Boolean(opts.symY),
    axisX: celWidth / 2,
    axisY: celHeight / 2,
    diag45: false,
    diag135: false,
    radialSegments: 0,
    radialCx: celWidth / 2 - 0.5,
    radialCy: celHeight / 2 - 0.5,
  };
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
  const symCfg = resolveSymmetry(cel.width, cel.height, opts);

  for (const fp of footprint) {
    const syms = expandSymmetryV2({ x: fp.x, y: fp.y }, symCfg);
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
  symCfg: SymmetryConfig,
  seamlessWrapEnabled: boolean,
  layerId: string,
  frameIndex: number,
  activeTileId: number
): void {
  const footprint = getBrushFootprint(pt.x, pt.y, brushCfg);
  for (const fp of footprint) {
    const syms = expandSymmetryV2({ x: fp.x, y: fp.y }, symCfg);
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
  shadingDirection: 1 | -1,
  ditherPattern: DitherPattern = "bayer4"
): InkContext {
  const rampHexes = buildShadingRamp(primaryHex);
  const shadingRamp = rampHexes.map((h) => hexToRgba(h, 255));
  return {
    opacity: brushOpacity,
    secondaryRgba: hexToRgba(secondaryHex, 255),
    shadingRamp,
    shadingDirection,
    ditherThreshold: Math.max(0, Math.min(1, brushOpacity / 100)),
    ditherPattern,
  };
}

export function isDrawRightClickPaintTool(tool: ToolId): boolean {
  return (
    tool === "pencil" ||
    tool === "eraser" ||
    tool === "fillBrush" ||
    tool === "ditherBrush" ||
    tool === "shading"
  );
}

function makeSelectionPreviewForTool(
  tool: "marquee" | "ellipseMarquee",
  startX: number,
  startY: number,
  endX: number,
  endY: number
): DrawDragPreview {
  const minX = Math.min(startX, endX);
  const minY = Math.min(startY, endY);
  const w = Math.abs(endX - startX) + 1;
  const h = Math.abs(endY - startY) + 1;
  return tool === "ellipseMarquee"
    ? { kind: "ellipseMarquee", x: minX, y: minY, w, h }
    : { kind: "marquee", x: minX, y: minY, w, h };
}

function applySelectionMaskWithMode(
  nextMask: SelectionMask,
  mode: SelectionCombineMode
): void {
  const state = useEditorStore.getState();
  const combined = combineSelectionMasks(pixelEngine.selection, nextMask, mode);
  pixelEngine.setSelection(combined);
  state.setHasSelection(!combined.isEmpty());
}

export function useDrawPointer({
  getPixelCoords,
  renderOverlayOnly,
}: UseDrawPointerOptions) {
  const strokeRef = useRef<ActiveDrawStroke | null>(null);
  const curveRef = useRef<PendingCurveState | null>(null);
  const polygonRef = useRef<PendingPolygonState | null>(null);
  const polyLassoRef = useRef<PendingPolyLassoState | null>(null);
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

  const hasActiveStroke = () =>
    strokeRef.current !== null ||
    curveRef.current !== null ||
    polygonRef.current !== null ||
    polyLassoRef.current !== null;

  const consumeSuppressContextMenu = (): boolean => {
    if (!suppressContextMenuRef.current) return false;
    suppressContextMenuRef.current = false;
    return true;
  };

  const renderCurveToOverlay = (curve: PendingCurveState) => {
    const state = useEditorStore.getState();
    const symCfg = getSymmetryConfigFromState(state);
    pixelEngine.clearOverlay();
    const pts = plotQuadraticBezier(
      curve.p0,
      curve.p1,
      curve.p2,
      state.pixelPerfect
    );
    const shapeBrushCfg: BrushConfig = {
      ...curve.brushCfg,
      size: state.brushSize,
    };
    for (const pt of pts) {
      for (const fp of getBrushFootprint(pt.x, pt.y, shapeBrushCfg)) {
        for (const rawSp of expandSymmetryV2({ x: fp.x, y: fp.y }, symCfg)) {
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
            curve.rgba[0],
            curve.rgba[1],
            curve.rgba[2],
            curve.rgba[3]
          );
        }
      }
    }
    renderOverlayOnly();
  };

  const renderPolygonToOverlay = (poly: PendingPolygonState) => {
    const state = useEditorStore.getState();
    const symCfg = getSymmetryConfigFromState(state);
    pixelEngine.clearOverlay();
    const previewVerts = [...poly.points, poly.cursor];
    const pts = plotPolygon(previewVerts, state.shapeFilled, false);
    const stampSize = state.shapeFilled ? 1 : state.brushSize;
    const shapeBrushCfg: BrushConfig = {
      ...poly.brushCfg,
      shape: state.shapeFilled ? "circle" : poly.brushCfg.shape,
      size: stampSize,
    };
    for (const pt of pts) {
      for (const fp of getBrushFootprint(pt.x, pt.y, shapeBrushCfg)) {
        for (const rawSp of expandSymmetryV2({ x: fp.x, y: fp.y }, symCfg)) {
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
            poly.rgba[0],
            poly.rgba[1],
            poly.rgba[2],
            poly.rgba[3]
          );
        }
      }
    }
    renderOverlayOnly();
  };

  const commitCurve = (): boolean => {
    const curve = curveRef.current;
    if (!curve) return false;
    curveRef.current = null;
    setDragPreview(null);
    pixelEngine.clearOverlay();

    const state = useEditorStore.getState();
    const symCfg = getSymmetryConfigFromState(state);
    const cel = pixelEngine.getOrCreateCel(curve.layerId, curve.frameIndex);
    pixelEngine.history.beginTransaction(
      curve.layerId,
      curve.frameIndex,
      "Bezier Curve"
    );
    const pts = plotQuadraticBezier(
      curve.p0,
      curve.p1,
      curve.p2,
      state.pixelPerfect
    );
    const shapeBrushCfg: BrushConfig = {
      ...curve.brushCfg,
      size: state.brushSize,
    };
    for (const pt of pts) {
      stampBrushPoint(pt, cel, {
        brushCfg: shapeBrushCfg,
        rgba: curve.rgba,
        isEraser: false,
        alphaLock: curve.alphaLock,
        symmetry: symCfg,
        seamlessWrap: state.seamlessWrap,
        inkMode: "simple",
        inkCtx: {},
      });
    }
    if (pixelEngine.history.commitTransaction(cel)) {
      syncHistoryAndCelState(curve.layerId, curve.frameIndex);
    } else {
      pixelEngine.history.cancelTransaction();
    }
    pixelEngine.emitChange();
    return true;
  };

  const commitPolygon = (): boolean => {
    const poly = polygonRef.current;
    if (!poly) return false;
    polygonRef.current = null;
    setDragPreview(null);
    pixelEngine.clearOverlay();

    if (poly.points.length < 2) {
      renderOverlayOnly();
      return true;
    }

    const state = useEditorStore.getState();
    const symCfg = getSymmetryConfigFromState(state);
    const cel = pixelEngine.getOrCreateCel(poly.layerId, poly.frameIndex);
    pixelEngine.history.beginTransaction(
      poly.layerId,
      poly.frameIndex,
      "Polygon"
    );
    const pts = plotPolygon(poly.points, state.shapeFilled, poly.points.length >= 3);
    const stampSize = state.shapeFilled ? 1 : state.brushSize;
    const shapeBrushCfg: BrushConfig = {
      ...poly.brushCfg,
      shape: state.shapeFilled ? "circle" : poly.brushCfg.shape,
      size: stampSize,
    };
    for (const pt of pts) {
      stampBrushPoint(pt, cel, {
        brushCfg: shapeBrushCfg,
        rgba: poly.rgba,
        isEraser: false,
        alphaLock: poly.alphaLock,
        symmetry: symCfg,
        seamlessWrap: state.seamlessWrap,
        inkMode: "simple",
        inkCtx: {},
      });
    }
    if (pixelEngine.history.commitTransaction(cel)) {
      syncHistoryAndCelState(poly.layerId, poly.frameIndex);
    } else {
      pixelEngine.history.cancelTransaction();
    }
    pixelEngine.emitChange();
    return true;
  };

  const commitPolyLasso = (): boolean => {
    const pl = polyLassoRef.current;
    if (!pl) return false;
    polyLassoRef.current = null;
    setDragPreview(null);

    const state = useEditorStore.getState();
    if (pl.points.length < 3) {
      if (pl.combineMode === "replace") {
        deselectAll();
      }
      return true;
    }
    const mask = createLassoSelection(
      state.canvasWidth,
      state.canvasHeight,
      pl.points
    );
    applySelectionMaskWithMode(mask, pl.combineMode);
    return true;
  };

  const cancelPendingMultiStep = (): boolean => {
    let canceled = false;
    if (curveRef.current) {
      curveRef.current = null;
      canceled = true;
    }
    if (polygonRef.current) {
      polygonRef.current = null;
      canceled = true;
    }
    if (polyLassoRef.current) {
      polyLassoRef.current = null;
      canceled = true;
    }
    if (canceled) {
      setDragPreview(null);
      pixelEngine.clearOverlay();
      renderOverlayOnly();
    }
    return canceled;
  };

  const commitPendingMultiStep = (): boolean => {
    if (curveRef.current && curveRef.current.stage === "control") {
      return commitCurve();
    }
    if (polygonRef.current) {
      return commitPolygon();
    }
    if (polyLassoRef.current) {
      return commitPolyLasso();
    }
    return false;
  };

  useEffect(() => {
    const st = useEditorStore.getState();
    if (curveRef.current && st.activeTool !== "curve") {
      curveRef.current = null;
      setDragPreview(null);
      pixelEngine.clearOverlay();
      renderOverlayOnly();
    }
    if (polygonRef.current && st.activeTool !== "polygon") {
      polygonRef.current = null;
      setDragPreview(null);
      pixelEngine.clearOverlay();
      renderOverlayOnly();
    }
    if (polyLassoRef.current && st.activeTool !== "polyLasso") {
      polyLassoRef.current = null;
      setDragPreview(null);
    }
  });

  const stampSprayAt = (
    cx: number,
    cy: number,
    cel: PixelBuffer,
    radius: number,
    density: number,
    seed: number,
    rgba: RGBA,
    alphaLock: boolean,
    symCfg: SymmetryConfig,
    seamlessWrap: boolean,
    inkMode: InkMode,
    inkCtx: InkContext
  ) => {
    const sprayPts = generateSprayPoints(cx, cy, radius, density, seed);
    const singleCfg: BrushConfig = {
      shape: "circle",
      size: 1,
      opacity: 100,
      pixelPerfect: false,
      spacing: 1,
    };
    for (const pt of sprayPts) {
      stampBrushPoint(pt, cel, {
        brushCfg: singleCfg,
        rgba,
        isEraser: false,
        alphaLock,
        symmetry: symCfg,
        seamlessWrap,
        inkMode,
        inkCtx,
      });
    }
  };

  const updateDrawHoverOverlay = (px: number, py: number) => {
    const state = useEditorStore.getState();
    if (curveRef.current) {
      if (curveRef.current.stage === "control") {
        curveRef.current.p1 = { x: px, y: py };
        setDragPreview({
          kind: "curve",
          p0: curveRef.current.p0,
          p1: curveRef.current.p1,
          p2: curveRef.current.p2,
          stage: "control",
        });
        renderCurveToOverlay(curveRef.current);
      }
      return;
    }

    if (polygonRef.current) {
      const snapped =
        state.snapToGuides && state.guides.length > 0
          ? snapPointToGuides({ x: px, y: py }, state.guides)
          : { x: px, y: py };
      polygonRef.current.cursor = snapped;
      setDragPreview({
        kind: "polygon",
        points: polygonRef.current.points.slice(),
        cursor: snapped,
      });
      renderPolygonToOverlay(polygonRef.current);
      return;
    }

    if (polyLassoRef.current) {
      const clamped = {
        x: Math.max(0, Math.min(state.canvasWidth - 1, px)),
        y: Math.max(0, Math.min(state.canvasHeight - 1, py)),
      };
      polyLassoRef.current.cursor = clamped;
      setDragPreview({
        kind: "polyLasso",
        points: polyLassoRef.current.points.slice(),
        cursor: clamped,
      });
      return;
    }

    if (state.freeTransformActive) {
      pixelEngine.clearOverlay();
      renderOverlayOnly();
      return;
    }

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
    // Brush footprints for pencil/eraser/fillBrush/ditherBrush/shading are rendered by DrawOverlay.tsx
    if (
      tool === "pencil" ||
      tool === "eraser" ||
      tool === "fillBrush" ||
      tool === "ditherBrush" ||
      tool === "shading"
    ) {
      renderOverlayOnly();
      return;
    }

    const isShapeHoverTool =
      tool === "line" ||
      tool === "curve" ||
      tool === "polygon" ||
      ((tool === "rect" || tool === "ellipse") && !state.shapeFilled);
    const previewColor: RGBA =
      tool === "line" ||
      tool === "curve" ||
      tool === "polygon" ||
      tool === "rect" ||
      tool === "ellipse"
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

    const symCfg = getSymmetryConfigFromState(state);
    for (const fpt of footprint) {
      const symPts = expandSymmetryV2({ x: fpt.x, y: fpt.y }, symCfg);
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
    if (state.freeTransformActive) {
      return true;
    }
    const { x: px, y: py } = getPixelCoords(e);
    const isRightButton = e.button === 2;
    const tool = state.activeTool;

    const isSelectionTool =
      tool === "marquee" ||
      tool === "ellipseMarquee" ||
      tool === "lasso" ||
      tool === "polyLasso" ||
      tool === "wand";

    if ((e.altKey && !isSelectionTool) || tool === "eyedropper") {
      if (isRightButton) {
        suppressContextMenuRef.current = true;
      }
      sampleColorAt(px, py, isRightButton);
      return true;
    }

    if (isRightButton) {
      if (tool === "polygon" && polygonRef.current) {
        suppressContextMenuRef.current = true;
        commitPolygon();
        return true;
      }
      if (tool === "polyLasso" && polyLassoRef.current) {
        suppressContextMenuRef.current = true;
        commitPolyLasso();
        return true;
      }
      if (!isDrawRightClickPaintTool(tool)) {
        return false;
      }
      suppressContextMenuRef.current = true;
      if (tool !== "shading" && state.rightClickMode === "eyedropper") {
        sampleColorAt(px, py, true);
        return true;
      }
    } else if (e.button !== 0) {
      return false;
    }

    if (tool === "marquee" || tool === "ellipseMarquee") {
      commitFloatingSelection();
      e.currentTarget.setPointerCapture(e.pointerId);
      const rawX = Math.max(0, Math.min(state.canvasWidth - 1, px));
      const rawY = Math.max(0, Math.min(state.canvasHeight - 1, py));
      const snapped =
        state.snapToGuides && state.guides.length > 0
          ? snapPointToGuides({ x: rawX, y: rawY }, state.guides)
          : { x: rawX, y: rawY };
      const cx = Math.max(0, Math.min(state.canvasWidth - 1, snapped.x));
      const cy = Math.max(0, Math.min(state.canvasHeight - 1, snapped.y));
      const kind = tool === "ellipseMarquee" ? "ellipseMarquee" : "marquee";
      strokeRef.current = {
        kind,
        tool,
        layerId: state.activeLayerId,
        frameIndex: state.currentFrame,
        alphaLock: false,
        isEraser: false,
        rgba: [0, 0, 0, 0],
        secondaryRgba: [0, 0, 0, 0],
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
        combineMode: getSelectionCombineMode(e),
        sprayCounter: 0,
      };
      setDragPreview(makeSelectionPreviewForTool(kind, cx, cy, cx, cy));
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
        secondaryRgba: [0, 0, 0, 0],
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
        combineMode: getSelectionCombineMode(e),
        sprayCounter: 0,
      };
      setDragPreview({ kind: "lasso", points: [pt] });
      return true;
    }

    if (tool === "polyLasso") {
      commitFloatingSelection();
      const pt = {
        x: Math.max(0, Math.min(state.canvasWidth - 1, px)),
        y: Math.max(0, Math.min(state.canvasHeight - 1, py)),
      };
      const now = performance.now();
      const pl = polyLassoRef.current;
      if (!pl) {
        polyLassoRef.current = {
          points: [pt],
          cursor: pt,
          combineMode: getSelectionCombineMode(e),
          lastClickTime: now,
        };
        setDragPreview({ kind: "polyLasso", points: [pt], cursor: pt });
        return true;
      }

      const first = pl.points[0];
      const nearFirst =
        pl.points.length >= 3 && Math.hypot(pt.x - first.x, pt.y - first.y) <= 2;
      const isDoubleClick = now - pl.lastClickTime < 300 && pl.points.length >= 3;

      if (nearFirst || isDoubleClick) {
        commitPolyLasso();
        return true;
      }

      pl.points.push(pt);
      pl.cursor = pt;
      pl.lastClickTime = now;
      setDragPreview({
        kind: "polyLasso",
        points: pl.points.slice(),
        cursor: pt,
      });
      return true;
    }

    if (tool === "wand") {
      commitFloatingSelection();
      const cel = pixelEngine.getOrCreateCel(
        state.activeLayerId,
        state.currentFrame
      );
      let sampleBuf = cel;
      if (state.fillSampleAllLayers) {
        const composited = pixelEngine.compositeFrame(
          state.layers,
          state.currentFrame
        );
        sampleBuf = new PixelBuffer(
          state.canvasWidth,
          state.canvasHeight,
          composited
        );
      }
      const mask = createMagicWandSelection(
        sampleBuf,
        px,
        py,
        state.fillContiguous,
        state.fillTolerance,
        state.fillDiagonal8
      );
      applySelectionMaskWithMode(mask, getSelectionCombineMode(e));
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
        secondaryRgba: [0, 0, 0, 0],
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
        combineMode: "replace",
        sprayCounter: 0,
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

    const rmbErase =
      isRightButton && tool !== "shading" && state.rightClickMode === "erase";
    const rmbSecondary =
      isRightButton &&
      tool !== "shading" &&
      state.rightClickMode === "secondaryColor";
    const isEraser = tool === "eraser" || rmbErase;
    const chosenHex = rmbSecondary ? state.secondaryColor : state.primaryColor;
    const secondaryHex = rmbSecondary ? state.primaryColor : state.secondaryColor;
    const rgba: RGBA = isEraser ? [0, 0, 0, 0] : hexToRgba(chosenHex, 255);
    const secondaryRgba: RGBA = hexToRgba(secondaryHex, 255);
    const brushCfg: BrushConfig = {
      shape: state.brushShape,
      size: state.brushSize,
      opacity: state.brushOpacity,
      pixelPerfect: state.pixelPerfect,
      spacing: state.brushSpacing,
      customBrush: state.customBrush,
    };
    const effectiveInkMode: InkMode = isEraser
      ? "simple"
      : tool === "ditherBrush"
        ? "dither"
        : tool === "shading"
          ? "shadingRamp"
          : state.inkMode;
    const shadingDirection: 1 | -1 = isRightButton ? -1 : 1;
    const inkCtx = buildInkContextForDraw(
      chosenHex,
      secondaryHex,
      state.brushOpacity,
      shadingDirection,
      state.ditherPattern
    );
    const symCfg = getSymmetryConfigFromState(state);

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
        symCfg,
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
        secondaryRgba,
        brushCfg,
        inkMode: effectiveInkMode,
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
        combineMode: "replace",
        sprayCounter: 0,
      };
      pixelEngine.emitChange();
      return true;
    }

    if (tool === "fill") {
      const cel = pixelEngine.getOrCreateCel(activeLayer.id, state.currentFrame);
      let sampleBuffer: PixelBuffer | undefined;
      if (state.fillSampleAllLayers) {
        const composited = pixelEngine.compositeFrame(
          state.layers,
          state.currentFrame
        );
        sampleBuffer = new PixelBuffer(
          state.canvasWidth,
          state.canvasHeight,
          composited
        );
      }
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
        pixelEngine.selection,
        {
          tolerance: state.fillTolerance,
          diagonal8: state.fillDiagonal8,
          ditherPattern: state.fillDitherPattern,
          sampleBuffer,
        }
      );
      if (count > 0 && pixelEngine.history.commitTransaction(cel)) {
        syncHistoryAndCelState(activeLayer.id, state.currentFrame);
        pixelEngine.emitChange();
      } else {
        pixelEngine.history.cancelTransaction();
      }
      return true;
    }

    if (tool === "gradient") {
      e.currentTarget.setPointerCapture(e.pointerId);
      const startPt =
        state.snapToGuides && state.guides.length > 0
          ? snapPointToGuides({ x: px, y: py }, state.guides)
          : { x: px, y: py };
      strokeRef.current = {
        kind: "gradient",
        tool,
        layerId: activeLayer.id,
        frameIndex: state.currentFrame,
        alphaLock: activeLayer.alphaLock,
        isEraser: false,
        rgba,
        secondaryRgba,
        brushCfg,
        inkMode: "simple",
        inkCtx: {},
        rawPoints: [],
        paintedSet: new Set(),
        visitedPixels: new Set(),
        usePixelPerfect: false,
        startX: startPt.x,
        startY: startPt.y,
        lastPt: startPt,
        origOffsetX: 0,
        origOffsetY: 0,
        origMask: null,
        stampTileId: 0,
        combineMode: "replace",
        sprayCounter: 0,
      };
      setDragPreview({
        kind: "gradient",
        x0: startPt.x,
        y0: startPt.y,
        x1: startPt.x,
        y1: startPt.y,
      });
      return true;
    }

    if (tool === "curve") {
      const snapped =
        state.snapToGuides && state.guides.length > 0
          ? snapPointToGuides({ x: px, y: py }, state.guides)
          : { x: px, y: py };
      if (!curveRef.current) {
        e.currentTarget.setPointerCapture(e.pointerId);
        const curve: PendingCurveState = {
          stage: "endpoints",
          layerId: activeLayer.id,
          frameIndex: state.currentFrame,
          alphaLock: activeLayer.alphaLock,
          rgba,
          brushCfg,
          p0: snapped,
          p1: snapped,
          p2: snapped,
        };
        curveRef.current = curve;
        setDragPreview({
          kind: "curve",
          p0: curve.p0,
          p1: curve.p1,
          p2: curve.p2,
          stage: "endpoints",
        });
        renderCurveToOverlay(curve);
        return true;
      }

      if (curveRef.current.stage === "control") {
        curveRef.current.p1 = snapped;
        commitCurve();
        return true;
      }
      return true;
    }

    if (tool === "polygon") {
      const snapped =
        state.snapToGuides && state.guides.length > 0
          ? snapPointToGuides({ x: px, y: py }, state.guides)
          : { x: px, y: py };
      const now = performance.now();
      const poly = polygonRef.current;
      if (!poly) {
        const nextPoly: PendingPolygonState = {
          layerId: activeLayer.id,
          frameIndex: state.currentFrame,
          alphaLock: activeLayer.alphaLock,
          rgba,
          brushCfg,
          points: [snapped],
          cursor: snapped,
          lastClickTime: now,
        };
        polygonRef.current = nextPoly;
        setDragPreview({
          kind: "polygon",
          points: [snapped],
          cursor: snapped,
        });
        renderPolygonToOverlay(nextPoly);
        return true;
      }

      const prevPt = poly.points[poly.points.length - 1];
      const nextPt =
        e.shiftKey && prevPt
          ? state.showIsoGrid
            ? (() => {
                const isoPts = plotIsoLine(prevPt.x, prevPt.y, snapped.x, snapped.y);
                return isoPts[isoPts.length - 1] ?? snapped;
              })()
            : constrainAngle(prevPt.x, prevPt.y, snapped.x, snapped.y)
          : snapped;

      const first = poly.points[0];
      const nearFirst =
        poly.points.length >= 3 &&
        Math.hypot(nextPt.x - first.x, nextPt.y - first.y) <= 2;
      const isDoubleClick = now - poly.lastClickTime < 300 && poly.points.length >= 2;

      if (nearFirst || isDoubleClick) {
        commitPolygon();
        return true;
      }

      poly.points.push(nextPt);
      poly.cursor = nextPt;
      poly.lastClickTime = now;
      setDragPreview({
        kind: "polygon",
        points: poly.points.slice(),
        cursor: nextPt,
      });
      renderPolygonToOverlay(poly);
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
        secondaryRgba,
        brushCfg,
        inkMode: effectiveInkMode,
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
        combineMode: "replace",
        sprayCounter: 0,
      };
      return true;
    }

    if (tool === "spray") {
      e.currentTarget.setPointerCapture(e.pointerId);
      pixelEngine.clearOverlay();
      const cel = pixelEngine.getOrCreateCel(activeLayer.id, state.currentFrame);
      pixelEngine.history.beginTransaction(
        activeLayer.id,
        state.currentFrame,
        "Spray"
      );
      const startPt = { x: px, y: py };
      const seed = (Date.now() ^ (px * 73856093) ^ (py * 19349663)) >>> 0;
      stampSprayAt(
        px,
        py,
        cel,
        state.sprayRadius,
        state.sprayDensity,
        seed,
        rgba,
        activeLayer.alphaLock,
        symCfg,
        state.seamlessWrap,
        state.inkMode,
        inkCtx
      );
      strokeRef.current = {
        kind: "spray",
        tool,
        layerId: activeLayer.id,
        frameIndex: state.currentFrame,
        alphaLock: activeLayer.alphaLock,
        isEraser: false,
        rgba,
        secondaryRgba,
        brushCfg,
        inkMode: state.inkMode,
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
        combineMode: "replace",
        sprayCounter: seed + 1,
      };
      pixelEngine.emitChange();
      return true;
    }

    if (tool === "jumble") {
      e.currentTarget.setPointerCapture(e.pointerId);
      pixelEngine.clearOverlay();
      const cel = pixelEngine.getOrCreateCel(activeLayer.id, state.currentFrame);
      pixelEngine.history.beginTransaction(
        activeLayer.id,
        state.currentFrame,
        "Jumble"
      );
      const startPt = { x: px, y: py };
      const radius = Math.max(1, Math.ceil(state.brushSize / 2));
      const seed = (Date.now() ^ (px * 83492791) ^ (py * 2971215073)) >>> 0;
      applyJumbleFootprint(
        cel,
        px,
        py,
        radius,
        seed,
        activeLayer.alphaLock,
        (cx, cy) => pixelEngine.history.capturePixelTile(cel, cx, cy),
        pixelEngine.selection
      );
      strokeRef.current = {
        kind: "jumble",
        tool,
        layerId: activeLayer.id,
        frameIndex: state.currentFrame,
        alphaLock: activeLayer.alphaLock,
        isEraser: false,
        rgba,
        secondaryRgba,
        brushCfg,
        inkMode: "simple",
        inkCtx: {},
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
        combineMode: "replace",
        sprayCounter: seed + 1,
      };
      pixelEngine.emitChange();
      return true;
    }

    if (
      tool === "pencil" ||
      tool === "eraser" ||
      tool === "ditherBrush" ||
      tool === "shading"
    ) {
      e.currentTarget.setPointerCapture(e.pointerId);
      pixelEngine.clearOverlay();
      const cel = pixelEngine.getOrCreateCel(activeLayer.id, state.currentFrame);
      const txLabel =
        tool === "ditherBrush"
          ? "Dither Brush"
          : tool === "shading"
            ? isRightButton
              ? "Darken"
              : "Lighten"
            : isEraser
              ? "Eraser"
              : "Pencil";
      pixelEngine.history.beginTransaction(
        activeLayer.id,
        state.currentFrame,
        txLabel
      );

      const usePixelPerfect =
        tool === "pencil" &&
        state.pixelPerfect &&
        state.brushSize === 1 &&
        state.brushShape !== "custom" &&
        effectiveInkMode === "simple" &&
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
            symmetry: symCfg,
            seamlessWrap: state.seamlessWrap,
            inkMode: effectiveInkMode,
            inkCtx,
            visitedPixels,
          });
        }
      } else if (usePixelPerfect) {
        const syms = expandSymmetryV2(startPt, symCfg);
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
          symmetry: symCfg,
          seamlessWrap: state.seamlessWrap,
          inkMode: effectiveInkMode,
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
        secondaryRgba,
        brushCfg,
        inkMode: effectiveInkMode,
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
        combineMode: "replace",
        sprayCounter: 0,
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
        secondaryRgba,
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
        combineMode: "replace",
        sprayCounter: 0,
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
      const startPt =
        state.snapToGuides && state.guides.length > 0
          ? snapPointToGuides({ x: px, y: py }, state.guides)
          : { x: px, y: py };
      strokeRef.current = {
        kind: "shape",
        tool,
        layerId: activeLayer.id,
        frameIndex: state.currentFrame,
        alphaLock: activeLayer.alphaLock,
        isEraser: false,
        rgba,
        secondaryRgba,
        brushCfg,
        inkMode: "simple",
        inkCtx: {},
        rawPoints: [],
        paintedSet: new Set(),
        visitedPixels: new Set(),
        usePixelPerfect: false,
        startX: startPt.x,
        startY: startPt.y,
        lastPt: { x: startPt.x, y: startPt.y },
        origOffsetX: 0,
        origOffsetY: 0,
        origMask: null,
        stampTileId: 0,
        combineMode: "replace",
        sprayCounter: 0,
      };
      pixelEngine.clearOverlay();
      const previewPts = getShapePoints(
        tool,
        startPt.x,
        startPt.y,
        startPt.x,
        startPt.y,
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
          for (const rawSp of expandSymmetryV2({ x: fp.x, y: fp.y }, symCfg)) {
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
    const state = useEditorStore.getState();
    const { x: px, y: py } = getPixelCoords(e);

    if (curveRef.current && curveRef.current.stage === "endpoints" && !strokeRef.current) {
      const snapped =
        state.snapToGuides && state.guides.length > 0
          ? snapPointToGuides({ x: px, y: py }, state.guides)
          : { x: px, y: py };
      curveRef.current.p2 = snapped;
      curveRef.current.p1 = {
        x: Math.round((curveRef.current.p0.x + snapped.x) / 2),
        y: Math.round((curveRef.current.p0.y + snapped.y) / 2),
      };
      setDragPreview({
        kind: "curve",
        p0: curveRef.current.p0,
        p1: curveRef.current.p1,
        p2: curveRef.current.p2,
        stage: "endpoints",
      });
      renderCurveToOverlay(curveRef.current);
      return true;
    }

    const stroke = strokeRef.current;
    if (!stroke) return false;

    const symCfg = getSymmetryConfigFromState(state);

    if (stroke.kind === "marquee" || stroke.kind === "ellipseMarquee") {
      const rawX = Math.max(0, Math.min(state.canvasWidth - 1, px));
      const rawY = Math.max(0, Math.min(state.canvasHeight - 1, py));
      const snapped =
        state.snapToGuides && state.guides.length > 0
          ? snapPointToGuides({ x: rawX, y: rawY }, state.guides)
          : { x: rawX, y: rawY };
      const clampedX = Math.max(0, Math.min(state.canvasWidth - 1, snapped.x));
      const clampedY = Math.max(0, Math.min(state.canvasHeight - 1, snapped.y));
      const end = e.shiftKey && stroke.combineMode === "replace"
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
      setDragPreview(
        makeSelectionPreviewForTool(stroke.kind, minX, minY, maxX, maxY)
      );
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

    if (stroke.kind === "gradient") {
      const snapped =
        state.snapToGuides && state.guides.length > 0
          ? snapPointToGuides({ x: px, y: py }, state.guides)
          : { x: px, y: py };
      const endPt = e.shiftKey
        ? constrainAngle(stroke.startX, stroke.startY, snapped.x, snapped.y)
        : snapped;
      stroke.lastPt = endPt;
      setDragPreview({
        kind: "gradient",
        x0: stroke.startX,
        y0: stroke.startY,
        x1: endPt.x,
        y1: endPt.y,
      });
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
        for (const rawSp of expandSymmetryV2(pt, symCfg)) {
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
          symCfg,
          state.seamlessWrap,
          stroke.layerId,
          stroke.frameIndex,
          stroke.stampTileId
        );
      }
      pixelEngine.emitChange();
      return true;
    }

    if (stroke.kind === "spray") {
      const last = stroke.lastPt;
      if (last.x === px && last.y === py) return true;
      const cel = pixelEngine.getOrCreateCel(stroke.layerId, stroke.frameIndex);
      const segment = sampleStrokePoints(last.x, last.y, px, py, 2);
      for (let i = 1; i < segment.length; i++) {
        const pt = segment[i];
        stampSprayAt(
          pt.x,
          pt.y,
          cel,
          state.sprayRadius,
          state.sprayDensity,
          stroke.sprayCounter++,
          stroke.rgba,
          stroke.alphaLock,
          symCfg,
          state.seamlessWrap,
          stroke.inkMode,
          stroke.inkCtx
        );
      }
      stroke.lastPt = { x: px, y: py };
      pixelEngine.emitChange();
      return true;
    }

    if (stroke.kind === "jumble") {
      const last = stroke.lastPt;
      if (last.x === px && last.y === py) return true;
      const cel = pixelEngine.getOrCreateCel(stroke.layerId, stroke.frameIndex);
      const radius = Math.max(1, Math.ceil(state.brushSize / 2));
      const segment = plotBresenhamLine(last.x, last.y, px, py);
      for (let i = 1; i < segment.length; i++) {
        const pt = segment[i];
        applyJumbleFootprint(
          cel,
          pt.x,
          pt.y,
          radius,
          stroke.sprayCounter++,
          stroke.alphaLock,
          (cx, cy) => pixelEngine.history.capturePixelTile(cel, cx, cy),
          pixelEngine.selection
        );
      }
      stroke.lastPt = { x: px, y: py };
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
          const syms = expandSymmetryV2({ x: rx, y: ry }, symCfg);
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
          const syms = expandSymmetryV2(pt, symCfg);
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
            symmetry: symCfg,
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
    const shapeEnd =
      state.snapToGuides && state.guides.length > 0
        ? snapPointToGuides({ x: px, y: py }, state.guides)
        : { x: px, y: py };
    const pts = getShapePoints(
      stroke.tool,
      stroke.startX,
      stroke.startY,
      shapeEnd.x,
      shapeEnd.y,
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
        for (const rawSp of expandSymmetryV2({ x: fp.x, y: fp.y }, symCfg)) {
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
    const state = useEditorStore.getState();
    const { x: px, y: py } = getPixelCoords(e);

    if (curveRef.current && curveRef.current.stage === "endpoints" && !strokeRef.current) {
      if (e.currentTarget.hasPointerCapture(e.pointerId)) {
        e.currentTarget.releasePointerCapture(e.pointerId);
      }
      const snapped =
        state.snapToGuides && state.guides.length > 0
          ? snapPointToGuides({ x: px, y: py }, state.guides)
          : { x: px, y: py };
      curveRef.current.p2 = snapped;
      curveRef.current.p1 = {
        x: Math.round((curveRef.current.p0.x + snapped.x) / 2),
        y: Math.round((curveRef.current.p0.y + snapped.y) / 2),
      };
      curveRef.current.stage = "control";
      setDragPreview({
        kind: "curve",
        p0: curveRef.current.p0,
        p1: curveRef.current.p1,
        p2: curveRef.current.p2,
        stage: "control",
      });
      renderCurveToOverlay(curveRef.current);
      state.setStatusMessage("Click to place curve control point (Enter to commit, Esc to cancel)");
      return true;
    }

    const stroke = strokeRef.current;
    if (!stroke) return false;
    strokeRef.current = null;

    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }

    const symCfg = getSymmetryConfigFromState(state);

    if (stroke.kind === "marquee" || stroke.kind === "ellipseMarquee") {
      setDragPreview(null);
      const rawX = Math.max(0, Math.min(state.canvasWidth - 1, px));
      const rawY = Math.max(0, Math.min(state.canvasHeight - 1, py));
      const snapped =
        state.snapToGuides && state.guides.length > 0
          ? snapPointToGuides({ x: rawX, y: rawY }, state.guides)
          : { x: rawX, y: rawY };
      const clampedX = Math.max(0, Math.min(state.canvasWidth - 1, snapped.x));
      const clampedY = Math.max(0, Math.min(state.canvasHeight - 1, snapped.y));
      const end = e.shiftKey && stroke.combineMode === "replace"
        ? constrainSquareBounds(stroke.startX, stroke.startY, clampedX, clampedY)
        : { x: clampedX, y: clampedY };
      if (end.x === stroke.startX && end.y === stroke.startY) {
        if (stroke.combineMode === "replace") {
          deselectAll();
        }
        return true;
      }
      const mask =
        stroke.kind === "ellipseMarquee"
          ? SelectionMask.fromEllipse(
              stroke.startX,
              stroke.startY,
              end.x,
              end.y,
              state.canvasWidth,
              state.canvasHeight
            )
          : createRectSelection(
              state.canvasWidth,
              state.canvasHeight,
              stroke.startX,
              stroke.startY,
              end.x,
              end.y
            );
      applySelectionMaskWithMode(mask, stroke.combineMode);
      return true;
    }

    if (stroke.kind === "lasso") {
      setDragPreview(null);
      if (stroke.rawPoints.length < 3) {
        if (stroke.combineMode === "replace") {
          deselectAll();
        }
        return true;
      }
      const mask = createLassoSelection(
        state.canvasWidth,
        state.canvasHeight,
        stroke.rawPoints
      );
      applySelectionMaskWithMode(mask, stroke.combineMode);
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

    if (stroke.kind === "gradient") {
      setDragPreview(null);
      const snapped =
        state.snapToGuides && state.guides.length > 0
          ? snapPointToGuides({ x: px, y: py }, state.guides)
          : { x: px, y: py };
      const endPt = e.shiftKey
        ? constrainAngle(stroke.startX, stroke.startY, snapped.x, snapped.y)
        : snapped;
      const paletteSnap = state.gradientPaletteSnap
        ? state.palette.map((hex) => hexToRgba(hex, 255))
        : undefined;
      pixelEngine.history.beginTransaction(
        stroke.layerId,
        stroke.frameIndex,
        "Gradient"
      );
      const modified = renderGradientToBuffer(
        cel,
        stroke.startX,
        stroke.startY,
        endPt.x,
        endPt.y,
        stroke.rgba,
        stroke.secondaryRgba,
        {
          mode: state.gradientMode,
          dither: state.gradientDither,
          paletteSnap,
        },
        stroke.alphaLock,
        (cx, cy) => pixelEngine.history.capturePixelTile(cel, cx, cy),
        pixelEngine.selection
      );
      if (modified > 0 && pixelEngine.history.commitTransaction(cel)) {
        syncHistoryAndCelState(stroke.layerId, stroke.frameIndex);
      } else {
        pixelEngine.history.cancelTransaction();
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
          symmetry: symCfg,
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
      const shapeEnd =
        state.snapToGuides && state.guides.length > 0
          ? snapPointToGuides({ x: px, y: py }, state.guides)
          : { x: px, y: py };
      const pts = getShapePoints(
        stroke.tool,
        stroke.startX,
        stroke.startY,
        shapeEnd.x,
        shapeEnd.y,
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
          symmetry: symCfg,
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
    commitPendingMultiStep,
    cancelPendingMultiStep,
    onPointerDown,
    onPointerMove,
    onPointerUp,
  };
}

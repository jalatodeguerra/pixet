import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Minus, Plus } from "lucide-react";
import {
  hexToRgba,
  type RGBA,
  rgbaToHex,
} from "../engine/document/PixelBuffer";
import { pixelEngine } from "../engine/document/PixelEngine";
import { syncHistoryAndCelState } from "../engine/document/historyActions";
import {
  commitFloatingSelection,
  deselectAll,
  liftSelectionForMove,
} from "../engine/document/selectionActions";
import { WebGL2Renderer } from "../engine/renderer/WebGL2Renderer";
import {
  buildIsoGridSvgPath,
  getIsoOrigin,
  plotIsoBox,
  plotIsoLine,
  screenToIso,
} from "../engine/tiles/isometric";
import {
  applyPixelPerfectFilter,
  constrainAngle,
  constrainSquareBounds,
  expandBrushFootprint,
  expandSymmetry,
  floodFill,
  plotBresenhamLine,
  plotEllipse,
  plotRect,
  type Point,
} from "../engine/tools/pixelAlgos";
import {
  buildSelectionSvgPath,
  createLassoSelection,
  createMagicWandSelection,
  createRectSelection,
  type SelectionMask,
} from "../engine/tools/selection";
import {
  isLayerEffectivelyLocked,
  type ToolId,
  useEditorStore,
} from "../store/editorStore";
import { buildShadingRamp } from "../utils/color";

interface ActiveStroke {
  kind:
    | "freehand"
    | "shape"
    | "marquee"
    | "lasso"
    | "move"
    | "tileStamp"
    | "tileEdit"
    | "isoBox";
  tool: ToolId;
  layerId: string;
  frameIndex: number;
  alphaLock: boolean;
  rgba: RGBA;
  rawPoints: Point[];
  paintedSet: Set<string>;
  usePixelPerfect: boolean;
  startX: number;
  startY: number;
  origOffsetX: number;
  origOffsetY: number;
  origMask: SelectionMask | null;
  stampTileId: number;
}

function wrapCoord(v: number, size: number): number {
  return ((v % size) + size) % size;
}

function wrapPoint(pt: Point, w: number, h: number, enabled: boolean): Point {
  if (!enabled) return pt;
  return { x: wrapCoord(pt.x, w), y: wrapCoord(pt.y, h) };
}

type DragPreview =
  | { kind: "marquee"; x: number; y: number; w: number; h: number }
  | { kind: "lasso"; points: Point[] }
  | null;

function getShapePoints(
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

function getTileCellCoords(
  px: number,
  py: number,
  canvasW: number,
  tileW: number,
  tileH: number,
  projection: "orthogonal" | "isometric"
): { col: number; row: number } {
  if (projection === "isometric") {
    const isoTileH = Math.max(4, Math.floor(tileW / 2));
    const { originX, originY } = getIsoOrigin(canvasW, isoTileH);
    return screenToIso(px, py, tileW, isoTileH, originX, originY);
  }
  return {
    col: Math.floor(px / tileW),
    row: Math.floor(py / tileH),
  };
}

export function Viewport() {
  const documentName = useEditorStore((s) => s.documentName);
  const canvasWidth = useEditorStore((s) => s.canvasWidth);
  const canvasHeight = useEditorStore((s) => s.canvasHeight);
  const zoom = useEditorStore((s) => s.zoom);
  const setZoom = useEditorStore((s) => s.setZoom);
  const showGrid = useEditorStore((s) => s.showGrid);
  const symmetryX = useEditorStore((s) => s.symmetryX);
  const symmetryY = useEditorStore((s) => s.symmetryY);
  const setCursorPos = useEditorStore((s) => s.setCursorPos);
  const activeTool = useEditorStore((s) => s.activeTool);
  const activeLayerId = useEditorStore((s) => s.activeLayerId);
  const currentFrame = useEditorStore((s) => s.currentFrame);
  const layers = useEditorStore((s) => s.layers);
  const workspaceMode = useEditorStore((s) => s.workspaceMode);
  const seamlessWrap = useEditorStore((s) => s.seamlessWrap);
  const showTileGrid = useEditorStore((s) => s.showTileGrid);
  const showIsoGrid = useEditorStore((s) => s.showIsoGrid);
  const tileWidth = useEditorStore((s) => s.tileWidth);
  const tileHeight = useEditorStore((s) => s.tileHeight);
  const onionSkin = useEditorStore((s) => s.onionSkin);
  const onionPrevFrames = useEditorStore((s) => s.onionPrevFrames);
  const onionNextFrames = useEditorStore((s) => s.onionNextFrames);
  const onionOpacity = useEditorStore((s) => s.onionOpacity);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapGhostRef = useRef<HTMLCanvasElement>(null);
  const wrapScratchRef = useRef<HTMLCanvasElement | null>(null);
  const rendererRef = useRef<WebGL2Renderer | null>(null);
  const strokeRef = useRef<ActiveStroke | null>(null);

  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [spacePressed, setSpacePressed] = useState(false);
  const [selectionPath, setSelectionPath] = useState("");
  const [dragPreview, setDragPreview] = useState<DragPreview>(null);

  const panDragRef = useRef<{
    active: boolean;
    startX: number;
    startY: number;
    originX: number;
    originY: number;
  }>({ active: false, startX: 0, startY: 0, originX: 0, originY: 0 });

  const renderCanvas = useCallback(() => {
    const renderer = rendererRef.current;
    if (renderer) {
      const state = useEditorStore.getState();
      if (state.onionSkin) {
        const onion = pixelEngine.compositeOnionSkin(
          state.layers,
          state.currentFrame,
          state.frames.length,
          state.onionPrevFrames,
          state.onionNextFrames,
          state.onionOpacity
        );
        renderer.uploadOnion(pixelEngine.width, pixelEngine.height, onion);
        renderer.setShowOnion(true);
      } else {
        renderer.setShowOnion(false);
      }
      const composite = pixelEngine.compositeFrame(
        state.layers,
        state.currentFrame
      );
      renderer.uploadFrame(pixelEngine.width, pixelEngine.height, composite);
      renderer.uploadOverlay(
        pixelEngine.width,
        pixelEngine.height,
        pixelEngine.overlayBuffer.data
      );
      renderer.render(pixelEngine.width, pixelEngine.height);

      if (state.seamlessWrap && wrapGhostRef.current) {
        const ghost = wrapGhostRef.current;
        const gctx = ghost.getContext("2d");
        if (gctx) {
          if (!wrapScratchRef.current) {
            wrapScratchRef.current = document.createElement("canvas");
          }
          const scratch = wrapScratchRef.current;
          scratch.width = pixelEngine.width;
          scratch.height = pixelEngine.height;
          const sctx = scratch.getContext("2d");
          if (sctx) {
            sctx.putImageData(
              new ImageData(
                new Uint8ClampedArray(composite),
                pixelEngine.width,
                pixelEngine.height
              ),
              0,
              0
            );
            gctx.clearRect(0, 0, ghost.width, ghost.height);
            gctx.imageSmoothingEnabled = false;
            for (let gy = 0; gy < 3; gy++) {
              for (let gx = 0; gx < 3; gx++) {
                if (gx === 1 && gy === 1) continue;
                gctx.drawImage(
                  scratch,
                  gx * pixelEngine.width,
                  gy * pixelEngine.height
                );
              }
            }
          }
        }
      }
    }

    const nextPath = pixelEngine.selection
      ? buildSelectionSvgPath(pixelEngine.selection)
      : "";
    setSelectionPath((prev) => (prev === nextPath ? prev : nextPath));
  }, []);

  const renderOverlayOnly = useCallback(() => {
    const renderer = rendererRef.current;
    if (!renderer) return;
    renderer.uploadOverlay(
      pixelEngine.width,
      pixelEngine.height,
      pixelEngine.overlayBuffer.data
    );
    renderer.render(pixelEngine.width, pixelEngine.height);
  }, []);

  // Initialize WebGL2Renderer once
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const renderer = new WebGL2Renderer(canvas);
    rendererRef.current = renderer;
    const state = useEditorStore.getState();
    renderer.resize(
      state.canvasWidth * state.zoom,
      state.canvasHeight * state.zoom,
      window.devicePixelRatio || 1
    );
    renderCanvas();

    const unsub = pixelEngine.subscribe(renderCanvas);
    return () => {
      unsub();
      renderer.dispose();
      rendererRef.current = null;
    };
  }, [renderCanvas]);

  // Resize WebGL2 viewport when zoom or canvas size changes
  useEffect(() => {
    const renderer = rendererRef.current;
    if (!renderer) return;
    renderer.resize(
      canvasWidth * zoom,
      canvasHeight * zoom,
      window.devicePixelRatio || 1
    );
    renderCanvas();
  }, [canvasWidth, canvasHeight, zoom, renderCanvas]);

  // Auto-commit floating selection if user switches layers or frames
  useEffect(() => {
    const fl = pixelEngine.floating;
    if (
      fl &&
      (fl.sourceLayerId !== activeLayerId ||
        fl.sourceFrameIndex !== currentFrame)
    ) {
      commitFloatingSelection();
    }
  }, [activeLayerId, currentFrame]);

  // Auto-commit floating selection when switching away from Move tool
  useEffect(() => {
    if (activeTool !== "move" && pixelEngine.floating) {
      commitFloatingSelection();
    }
  }, [activeTool]);

  // Re-composite when layers, active frame, wrap, or onion skin settings change
  useEffect(() => {
    renderCanvas();
  }, [
    layers,
    currentFrame,
    seamlessWrap,
    onionSkin,
    onionPrevFrames,
    onionNextFrames,
    onionOpacity,
    renderCanvas,
  ]);

  useEffect(() => {
    const isEditable = (target: EventTarget | null) =>
      target instanceof HTMLElement &&
      (target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.tagName === "SELECT");

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.code === "Space" && !isEditable(e.target)) {
        e.preventDefault();
        setSpacePressed(true);
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code === "Space") {
        setSpacePressed(false);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
    };
  }, []);

  const getPixelCoords = (e: React.PointerEvent<HTMLCanvasElement>): Point => {
    const rect = e.currentTarget.getBoundingClientRect();
    return {
      x: Math.floor((e.clientX - rect.left) / zoom),
      y: Math.floor((e.clientY - rect.top) / zoom),
    };
  };

  const updateHoverOverlay = (px: number, py: number) => {
    const state = useEditorStore.getState();
    pixelEngine.clearOverlay();
    if (
      px < 0 ||
      py < 0 ||
      px >= state.canvasWidth ||
      py >= state.canvasHeight
    ) {
      renderOverlayOnly();
      return;
    }

    const tool = state.activeTool;
    const isBrushTool =
      tool === "pencil" ||
      tool === "eraser" ||
      tool === "line" ||
      ((tool === "rect" || tool === "ellipse") && !state.shapeFilled);

    const previewColor: RGBA =
      tool === "eraser"
        ? [255, 255, 255, 110]
        : tool === "pencil" ||
            tool === "line" ||
            tool === "rect" ||
            tool === "ellipse"
          ? hexToRgba(state.primaryColor, 175)
          : [255, 255, 255, 140];

    const footprint = isBrushTool
      ? expandBrushFootprint(px, py, state.brushSize)
      : [{ x: px, y: py }];

    for (const fpt of footprint) {
      const symPts = expandSymmetry(
        fpt,
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

  const canWriteAt = (x: number, y: number): boolean => {
    const sel = pixelEngine.selection;
    if (!sel || sel.isEmpty()) return true;
    return sel.contains(x, y);
  };

  const stampBrushPoint = (
    pt: Point,
    brushSize: number,
    rgba: RGBA,
    alphaLock: boolean,
    symX: boolean,
    symY: boolean,
    seamlessWrapEnabled: boolean,
    cel: ReturnType<typeof pixelEngine.getOrCreateCel>
  ) => {
    const footprint = expandBrushFootprint(pt.x, pt.y, brushSize);
    for (const fp of footprint) {
      const syms = expandSymmetry(fp, cel.width, cel.height, symX, symY);
      for (const rawSp of syms) {
        const sp = wrapPoint(rawSp, cel.width, cel.height, seamlessWrapEnabled);
        if (!canWriteAt(sp.x, sp.y)) continue;
        pixelEngine.history.capturePixelTile(cel, sp.x, sp.y);
        cel.setPixel(
          sp.x,
          sp.y,
          rgba[0],
          rgba[1],
          rgba[2],
          rgba[3],
          alphaLock
        );
      }
    }
  };

  const paintTilemapBrushPoint = (
    pt: Point,
    brushSize: number,
    rgba: RGBA,
    alphaLock: boolean,
    symX: boolean,
    symY: boolean,
    seamlessWrapEnabled: boolean,
    layerId: string,
    frameIndex: number,
    activeTileId: number
  ) => {
    const footprint = expandBrushFootprint(pt.x, pt.y, brushSize);
    for (const fp of footprint) {
      const syms = expandSymmetry(
        fp,
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
  };

  const handleWheel = (e: React.WheelEvent<HTMLDivElement>) => {
    e.preventDefault();
    const delta = e.deltaY < 0 ? 1 : -1;
    const step = zoom >= 16 ? 2 : 1;
    setZoom(zoom + delta * step);
  };

  const handleStageMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.button === 1 || (e.button === 0 && spacePressed)) {
      e.preventDefault();
      panDragRef.current = {
        active: true,
        startX: e.clientX,
        startY: e.clientY,
        originX: pan.x,
        originY: pan.y,
      };
    }
  };

  const handleStageMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (panDragRef.current.active) {
      setPan({
        x: panDragRef.current.originX + (e.clientX - panDragRef.current.startX),
        y: panDragRef.current.originY + (e.clientY - panDragRef.current.startY),
      });
    }
  };

  const handleStageMouseUp = () => {
    panDragRef.current.active = false;
  };

  const handleCanvasPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (spacePressed || e.button === 1) return;
    if (e.button !== 0 && e.button !== 2) return;

    e.preventDefault();
    const state = useEditorStore.getState();
    const { x: px, y: py } = getPixelCoords(e);
    const isSecondary = e.button === 2;

    if (e.altKey || state.activeTool === "eyedropper") {
      sampleColorAt(px, py, isSecondary);
      return;
    }

    const tool = state.activeTool;

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
        rgba: [0, 0, 0, 0],
        rawPoints: [],
        paintedSet: new Set(),
        usePixelPerfect: false,
        startX: cx,
        startY: cy,
        origOffsetX: 0,
        origOffsetY: 0,
        origMask: null,
        stampTileId: 0,
      };
      setDragPreview({ kind: "marquee", x: cx, y: cy, w: 1, h: 1 });
      return;
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
        rgba: [0, 0, 0, 0],
        rawPoints: [pt],
        paintedSet: new Set(),
        usePixelPerfect: false,
        startX: pt.x,
        startY: pt.y,
        origOffsetX: 0,
        origOffsetY: 0,
        origMask: null,
        stampTileId: 0,
      };
      setDragPreview({ kind: "lasso", points: [pt] });
      return;
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
      return;
    }

    if (tool === "move") {
      if (!liftSelectionForMove(state.activeLayerId, state.currentFrame)) {
        return;
      }
      const fl = pixelEngine.floating;
      if (!fl) return;
      e.currentTarget.setPointerCapture(e.pointerId);
      strokeRef.current = {
        kind: "move",
        tool,
        layerId: fl.sourceLayerId,
        frameIndex: fl.sourceFrameIndex,
        alphaLock: false,
        rgba: [0, 0, 0, 0],
        rawPoints: [],
        paintedSet: new Set(),
        usePixelPerfect: false,
        startX: px,
        startY: py,
        origOffsetX: fl.offsetX,
        origOffsetY: fl.offsetY,
        origMask: pixelEngine.selection?.clone() ?? null,
        stampTileId: 0,
      };
      return;
    }

    // Drawing / tile tools commit any floating selection before writing
    commitFloatingSelection();

    const activeLayer = state.layers.find((l) => l.id === state.activeLayerId);
    if (!activeLayer || activeLayer.kind === "group") {
      state.setStatusMessage("Select a raster or tilemap layer to draw");
      return;
    }
    if (isLayerEffectivelyLocked(state.layers, activeLayer.id)) {
      state.setStatusMessage(`Layer "${activeLayer.name}" is locked`);
      return;
    }

    if (tool === "tileStamp") {
      if (activeLayer.kind !== "tilemap") {
        state.setStatusMessage("Add or select a Tilemap layer to stamp tiles");
        return;
      }
      e.currentTarget.setPointerCapture(e.pointerId);
      const stampTileId = isSecondary ? 0 : state.activeTileId;
      const { col, row } = getTileCellCoords(
        px,
        py,
        state.canvasWidth,
        state.tileWidth,
        state.tileHeight,
        state.tileProjection
      );
      if (state.autoTileEnabled && pixelEngine.autoTileRuleset) {
        pixelEngine.paintAutoTileAtCell(
          activeLayer.id,
          state.currentFrame,
          col,
          row,
          stampTileId === 0,
          state.autoTileMode
        );
      } else {
        pixelEngine.setTilemapCell(
          activeLayer.id,
          state.currentFrame,
          col,
          row,
          stampTileId
        );
      }
      strokeRef.current = {
        kind: "tileStamp",
        tool,
        layerId: activeLayer.id,
        frameIndex: state.currentFrame,
        alphaLock: false,
        rgba: [0, 0, 0, 0],
        rawPoints: [{ x: col, y: row }],
        paintedSet: new Set([`${col},${row}`]),
        usePixelPerfect: false,
        startX: col,
        startY: row,
        origOffsetX: 0,
        origOffsetY: 0,
        origMask: null,
        stampTileId,
      };
      pixelEngine.emitChange();
      return;
    }

    const chosenHex = isSecondary ? state.secondaryColor : state.primaryColor;
    const rgba: RGBA =
      tool === "eraser" ? [0, 0, 0, 0] : hexToRgba(chosenHex, 255);

    if (activeLayer.kind === "tilemap") {
      if (tool !== "pencil" && tool !== "eraser") {
        state.setStatusMessage(
          "Use Tile Stamp (T) or Pencil/Eraser on Tilemap layers"
        );
        return;
      }
      e.currentTarget.setPointerCapture(e.pointerId);
      pixelEngine.clearOverlay();
      const startPt = { x: px, y: py };
      paintTilemapBrushPoint(
        startPt,
        state.brushSize,
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
        rgba,
        rawPoints: [startPt],
        paintedSet: new Set(),
        usePixelPerfect: false,
        startX: px,
        startY: py,
        origOffsetX: 0,
        origOffsetY: 0,
        origMask: null,
        stampTileId: state.activeTileId,
      };
      pixelEngine.emitChange();
      return;
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
      return;
    }

    if (tool === "pencil" || tool === "eraser") {
      e.currentTarget.setPointerCapture(e.pointerId);
      pixelEngine.clearOverlay();
      const cel = pixelEngine.getOrCreateCel(activeLayer.id, state.currentFrame);
      pixelEngine.history.beginTransaction(
        activeLayer.id,
        state.currentFrame,
        tool === "eraser" ? "Eraser" : "Pencil"
      );

      const usePixelPerfect = state.pixelPerfect && state.brushSize === 1;
      const startPt = { x: px, y: py };
      const paintedSet = new Set<string>();

      if (usePixelPerfect) {
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
        stampBrushPoint(
          startPt,
          state.brushSize,
          rgba,
          activeLayer.alphaLock,
          state.symmetryX,
          state.symmetryY,
          state.seamlessWrap,
          cel
        );
      }

      strokeRef.current = {
        kind: "freehand",
        tool,
        layerId: activeLayer.id,
        frameIndex: state.currentFrame,
        alphaLock: activeLayer.alphaLock,
        rgba,
        rawPoints: [startPt],
        paintedSet,
        usePixelPerfect,
        startX: px,
        startY: py,
        origOffsetX: 0,
        origOffsetY: 0,
        origMask: null,
        stampTileId: 0,
      };
      pixelEngine.emitChange();
      return;
    }

    if (tool === "isoBox") {
      e.currentTarget.setPointerCapture(e.pointerId);
      strokeRef.current = {
        kind: "isoBox",
        tool,
        layerId: activeLayer.id,
        frameIndex: state.currentFrame,
        alphaLock: activeLayer.alphaLock,
        rgba,
        rawPoints: [],
        paintedSet: new Set(),
        usePixelPerfect: false,
        startX: px,
        startY: py,
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
      return;
    }

    if (tool === "line" || tool === "rect" || tool === "ellipse") {
      e.currentTarget.setPointerCapture(e.pointerId);
      strokeRef.current = {
        kind: "shape",
        tool,
        layerId: activeLayer.id,
        frameIndex: state.currentFrame,
        alphaLock: activeLayer.alphaLock,
        rgba,
        rawPoints: [],
        paintedSet: new Set(),
        usePixelPerfect: false,
        startX: px,
        startY: py,
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
      for (const pt of previewPts) {
        for (const fp of expandBrushFootprint(pt.x, pt.y, stampSize)) {
          for (const rawSp of expandSymmetry(
            fp,
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
    }
  };

  const handleCanvasPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const state = useEditorStore.getState();
    const { x: px, y: py } = getPixelCoords(e);

    if (
      px >= 0 &&
      py >= 0 &&
      px < state.canvasWidth &&
      py < state.canvasHeight
    ) {
      setCursorPos({ x: px, y: py });
    } else {
      setCursorPos(null);
    }

    const stroke = strokeRef.current;
    if (!stroke) {
      if (!spacePressed) {
        updateHoverOverlay(px, py);
      }
      return;
    }

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
      return;
    }

    if (stroke.kind === "lasso") {
      const clampedX = Math.max(0, Math.min(state.canvasWidth - 1, px));
      const clampedY = Math.max(0, Math.min(state.canvasHeight - 1, py));
      const last = stroke.rawPoints[stroke.rawPoints.length - 1];
      if (!last || last.x !== clampedX || last.y !== clampedY) {
        stroke.rawPoints.push({ x: clampedX, y: clampedY });
        setDragPreview({ kind: "lasso", points: stroke.rawPoints.slice() });
      }
      return;
    }

    if (stroke.kind === "move") {
      const fl = pixelEngine.floating;
      if (!fl) return;
      const dx = px - stroke.startX;
      const dy = py - stroke.startY;
      fl.offsetX = stroke.origOffsetX + dx;
      fl.offsetY = stroke.origOffsetY + dy;
      if (stroke.origMask) {
        pixelEngine.selection = stroke.origMask.translate(dx, dy);
      }
      pixelEngine.emitChange();
      return;
    }

    if (stroke.kind === "tileStamp") {
      const { col, row } = getTileCellCoords(
        px,
        py,
        state.canvasWidth,
        state.tileWidth,
        state.tileHeight,
        state.tileProjection
      );
      const key = `${col},${row}`;
      if (!stroke.paintedSet.has(key)) {
        stroke.paintedSet.add(key);
        if (state.autoTileEnabled && pixelEngine.autoTileRuleset) {
          pixelEngine.paintAutoTileAtCell(
            stroke.layerId,
            stroke.frameIndex,
            col,
            row,
            stroke.stampTileId === 0,
            state.autoTileMode
          );
        } else {
          pixelEngine.setTilemapCell(
            stroke.layerId,
            stroke.frameIndex,
            col,
            row,
            stroke.stampTileId
          );
        }
        pixelEngine.emitChange();
      }
      return;
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
      return;
    }

    if (stroke.kind === "tileEdit") {
      const last = stroke.rawPoints[stroke.rawPoints.length - 1];
      if (last.x === px && last.y === py) return;
      const segment = plotBresenhamLine(last.x, last.y, px, py);
      for (let i = 1; i < segment.length; i++) {
        stroke.rawPoints.push(segment[i]);
        paintTilemapBrushPoint(
          segment[i],
          state.brushSize,
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
      return;
    }

    if (stroke.kind === "freehand") {
      const last = stroke.rawPoints[stroke.rawPoints.length - 1];
      if (last.x === px && last.y === py) return;

      const cel = pixelEngine.getOrCreateCel(stroke.layerId, stroke.frameIndex);
      const segment = plotBresenhamLine(last.x, last.y, px, py);

      if (stroke.usePixelPerfect) {
        for (let i = 1; i < segment.length; i++) {
          stroke.rawPoints.push(segment[i]);
        }
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
        for (let i = 1; i < segment.length; i++) {
          stroke.rawPoints.push(segment[i]);
          stampBrushPoint(
            segment[i],
            state.brushSize,
            stroke.rgba,
            stroke.alphaLock,
            state.symmetryX,
            state.symmetryY,
            state.seamlessWrap,
            cel
          );
        }
      }

      pixelEngine.emitChange();
      return;
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

    for (const pt of pts) {
      for (const fp of expandBrushFootprint(pt.x, pt.y, stampSize)) {
        for (const rawSp of expandSymmetry(
          fp,
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
  };

  const finishStroke = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const stroke = strokeRef.current;
    if (!stroke) return;
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
        return;
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
      return;
    }

    if (stroke.kind === "lasso") {
      setDragPreview(null);
      if (stroke.rawPoints.length < 3) {
        deselectAll();
        return;
      }
      const mask = createLassoSelection(
        state.canvasWidth,
        state.canvasHeight,
        stroke.rawPoints
      );
      pixelEngine.setSelection(mask);
      state.setHasSelection(!mask.isEmpty());
      return;
    }

    if (stroke.kind === "move") {
      pixelEngine.emitChange();
      return;
    }

    if (stroke.kind === "tileStamp") {
      pixelEngine.emitChange();
      return;
    }

    if (stroke.kind === "tileEdit") {
      state.bumpTilesetVersion();
      pixelEngine.emitChange();
      return;
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
      return;
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
      for (const pt of pts) {
        stampBrushPoint(
          pt,
          stampSize,
          stroke.rgba,
          stroke.alphaLock,
          state.symmetryX,
          state.symmetryY,
          state.seamlessWrap,
          cel
        );
      }
      if (pixelEngine.history.commitTransaction(cel)) {
        syncHistoryAndCelState(stroke.layerId, stroke.frameIndex);
      } else {
        pixelEngine.history.cancelTransaction();
      }
      pixelEngine.emitChange();
      return;
    }

    if (pixelEngine.history.commitTransaction(cel)) {
      syncHistoryAndCelState(stroke.layerId, stroke.frameIndex);
    } else {
      pixelEngine.history.cancelTransaction();
    }
    pixelEngine.emitChange();
  };

  const handleCanvasPointerLeave = () => {
    setCursorPos(null);
    if (!strokeRef.current) {
      pixelEngine.clearOverlay();
      renderOverlayOnly();
    }
  };

  const cursorStyle = spacePressed
    ? "grab"
    : activeTool === "move"
      ? "move"
      : "crosshair";

  const activeLayerObj = layers.find((l) => l.id === activeLayerId);
  const showTileGridOverlay =
    (workspaceMode === "tiles" || activeLayerObj?.kind === "tilemap") &&
    showTileGrid;
  const isoGridPath = useMemo(() => {
    if (!showIsoGrid) return "";
    const isoTileH = Math.max(4, Math.floor(tileWidth / 2));
    return buildIsoGridSvgPath(canvasWidth, canvasHeight, tileWidth, isoTileH);
  }, [showIsoGrid, canvasWidth, canvasHeight, tileWidth]);

  return (
    <section className="viewport-container" aria-label="Canvas Viewport">
      <div className="document-tabs">
        <div className="doc-tab">
          <span className="doc-tab-dot" />
          <span>{documentName}</span>
          <span
            style={{ color: "var(--text-muted)", fontFamily: "var(--font-mono)" }}
          >
            {canvasWidth}×{canvasHeight}
          </span>
        </div>
      </div>

      <div
        className="viewport-stage"
        style={{ cursor: spacePressed ? "grab" : undefined }}
        onWheel={handleWheel}
        onMouseDown={handleStageMouseDown}
        onMouseMove={handleStageMouseMove}
        onMouseUp={handleStageMouseUp}
        onMouseLeave={handleStageMouseUp}
      >
        <div
          className="viewport-canvas-frame"
          style={{
            width: canvasWidth * zoom,
            height: canvasHeight * zoom,
            transform: `translate(${pan.x}px, ${pan.y}px)`,
          }}
        >
          {seamlessWrap && (
            <canvas
              ref={wrapGhostRef}
              width={canvasWidth * 3}
              height={canvasHeight * 3}
              className="viewport-wrap-ghost"
              style={{
                left: -(canvasWidth * zoom),
                top: -(canvasHeight * zoom),
                width: canvasWidth * zoom * 3,
                height: canvasHeight * zoom * 3,
              }}
            />
          )}

          <canvas
            ref={canvasRef}
            className="viewport-canvas"
            style={{ cursor: cursorStyle }}
            onContextMenu={(e) => e.preventDefault()}
            onPointerDown={handleCanvasPointerDown}
            onPointerMove={handleCanvasPointerMove}
            onPointerUp={finishStroke}
            onPointerCancel={finishStroke}
            onPointerLeave={handleCanvasPointerLeave}
          />

          {showGrid && zoom >= 4 && (
            <div
              className="viewport-pixel-grid"
              style={{ backgroundSize: `${zoom}px ${zoom}px` }}
            />
          )}

          {showTileGridOverlay && (
            <div
              className="viewport-tile-grid"
              style={{
                backgroundSize: `${tileWidth * zoom}px ${tileHeight * zoom}px`,
              }}
            />
          )}

          {showIsoGrid && isoGridPath && (
            <svg
              className="viewport-iso-grid-svg"
              viewBox={`0 0 ${canvasWidth} ${canvasHeight}`}
              preserveAspectRatio="none"
            >
              <path className="iso-grid-path" d={isoGridPath} />
            </svg>
          )}

          {(selectionPath || dragPreview) && (
            <svg
              className="viewport-selection-svg"
              viewBox={`0 0 ${canvasWidth} ${canvasHeight}`}
              preserveAspectRatio="none"
            >
              {selectionPath && (
                <>
                  <path className="marching-ants-bg" d={selectionPath} />
                  <path className="marching-ants-fg" d={selectionPath} />
                </>
              )}
              {dragPreview?.kind === "marquee" && (
                <rect
                  className="selection-preview-shape"
                  x={dragPreview.x}
                  y={dragPreview.y}
                  width={dragPreview.w}
                  height={dragPreview.h}
                />
              )}
              {dragPreview?.kind === "lasso" && dragPreview.points.length > 1 && (
                <polyline
                  className="selection-preview-shape"
                  points={dragPreview.points
                    .map((p) => `${p.x + 0.5},${p.y + 0.5}`)
                    .join(" ")}
                />
              )}
            </svg>
          )}

          {symmetryX && <div className="viewport-symmetry-x" />}
          {symmetryY && <div className="viewport-symmetry-y" />}
        </div>

        <div className="viewport-overlay-pill">
          <button
            type="button"
            className="icon-action-btn"
            style={{ width: 20, height: 20 }}
            title="Zoom Out (-)"
            onClick={() => setZoom(zoom - 1)}
          >
            <Minus size={12} />
          </button>
          <span className="mono-value">{zoom * 100}%</span>
          <button
            type="button"
            className="icon-action-btn"
            style={{ width: 20, height: 20 }}
            title="Zoom In (+)"
            onClick={() => setZoom(zoom + 1)}
          >
            <Plus size={12} />
          </button>
          {(pan.x !== 0 || pan.y !== 0) && (
            <button
              type="button"
              className="menu-btn"
              style={{ padding: "1px 5px", fontSize: 10 }}
              onClick={() => setPan({ x: 0, y: 0 })}
            >
              Center
            </button>
          )}
        </div>
      </div>
    </section>
  );
}

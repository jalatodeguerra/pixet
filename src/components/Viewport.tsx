import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Eye, Minus, Plus } from "lucide-react";
import { FloatingPreview } from "./FloatingPreview";
import { pixelEngine } from "../engine/document/PixelEngine";
import {
  commitFloatingSelection,
  copySelection,
  copySelectionToNewLayer,
  cutSelection,
  cutSelectionToNewLayer,
  deleteSelection,
  deselectAll,
  pasteClipboard,
  selectAllCanvas,
  transformSelectionOrCel,
} from "../engine/document/selectionActions";
import {
  resolveRendererBackdrop,
  WebGL2Renderer,
} from "../engine/renderer/WebGL2Renderer";
import { renderBoneInfluenceOverlay } from "../engine/rig/RigEngine";
import { buildIsoGridSvgPath } from "../engine/tiles/isometric";
import { expandBrushFootprint, type Point } from "../engine/tools/pixelAlgos";
import { buildSelectionSvgPath } from "../engine/tools/selection";
import {
  applyViewCheckFilter,
  mapFlippedPoint,
} from "../engine/tools/viewChecks";
import { useEditorStore } from "../store/editorStore";
import { PALETTE_PRESETS } from "../utils/paletteParser";
import { DrawOverlay } from "./draw/DrawOverlay";
import { RulersOverlay } from "./draw/RulersOverlay";
import { useDrawPointer } from "./draw/useDrawPointer";
import { RigOverlay } from "./rig/RigOverlay";
import { useRigPointer } from "./rig/useRigPointer";
import { TileEditViewport } from "./tiles/TileEditViewport";
import { TileOverlay } from "./tiles/TileOverlay";
import { useTilePointer } from "./tiles/useTilePointer";

export function Viewport() {
  const documentName = useEditorStore((s) => s.documentName);
  const canvasWidth = useEditorStore((s) => s.canvasWidth);
  const canvasHeight = useEditorStore((s) => s.canvasHeight);
  const zoom = useEditorStore((s) => s.zoom);
  const setZoom = useEditorStore((s) => s.setZoom);
  const showGrid = useEditorStore((s) => s.showGrid);
  const setCursorPos = useEditorStore((s) => s.setCursorPos);
  const activeTool = useEditorStore((s) => s.activeTool);
  const activeLayerId = useEditorStore((s) => s.activeLayerId);
  const currentFrame = useEditorStore((s) => s.currentFrame);
  const layers = useEditorStore((s) => s.layers);
  const workspaceMode = useEditorStore((s) => s.workspaceMode);
  const tilesMode = useEditorStore((s) => s.tilesMode);
  const animateTilesPreview = useEditorStore((s) => s.animateTilesPreview);
  const seamlessWrap = useEditorStore((s) => s.seamlessWrap);
  const showTileGrid = useEditorStore((s) => s.showTileGrid);
  const showIsoGrid = useEditorStore((s) => s.showIsoGrid);
  const tileWidth = useEditorStore((s) => s.tileWidth);
  const tileHeight = useEditorStore((s) => s.tileHeight);
  const viewFlipH = useEditorStore((s) => s.viewFlipH);
  const viewFlipV = useEditorStore((s) => s.viewFlipV);
  const viewGrayscale = useEditorStore((s) => s.viewGrayscale);
  const viewSilhouette = useEditorStore((s) => s.viewSilhouette);
  const canvasBackdrop = useEditorStore((s) => s.canvasBackdrop);
  const canvasBackdropColor = useEditorStore((s) => s.canvasBackdropColor);
  const showRulers = useEditorStore((s) => s.showRulers);
  const referenceImage = useEditorStore((s) => s.referenceImage);
  const onionSkin = useEditorStore((s) => s.onionSkin);
  const onionPrevFrames = useEditorStore((s) => s.onionPrevFrames);
  const onionNextFrames = useEditorStore((s) => s.onionNextFrames);
  const onionOpacity = useEditorStore((s) => s.onionOpacity);
  const onionSkinTint = useEditorStore((s) => s.onionSkinTint);
  const onionSkinOpacity = useEditorStore((s) => s.onionSkinOpacity);
  const onionSkinInFront = useEditorStore((s) => s.onionSkinInFront);
  const onionSkinLoopWrap = useEditorStore((s) => s.onionSkinLoopWrap);
  const rigTool = useEditorStore((s) => s.rigTool);
  const rigMode = useEditorStore((s) => s.rigMode);
  const selectedBoneId = useEditorStore((s) => s.selectedBoneId);
  const rigPixelSnap = useEditorStore((s) => s.rigPixelSnap);
  const rigRotSprite = useEditorStore((s) => s.rigRotSprite);
  const rigShowBones = useEditorStore((s) => s.rigShowBones);
  const rigShowInfluence = useEditorStore((s) => s.rigShowInfluence);
  const rigVersion = useEditorStore((s) => s.rigVersion);
  const rigWeightOverlay = useEditorStore((s) => s.rigWeightOverlay);
  const rigCleanupOrphans = useEditorStore((s) => s.rigCleanupOrphans);
  const rigCleanupHoles = useEditorStore((s) => s.rigCleanupHoles);
  const rigCleanupPaletteLock = useEditorStore((s) => s.rigCleanupPaletteLock);
  const rigCleanupOutline = useEditorStore((s) => s.rigCleanupOutline);
  const rigAutoZSort = useEditorStore((s) => s.rigAutoZSort);
  const rigDirectionalLighting = useEditorStore(
    (s) => s.rigDirectionalLighting
  );
  const rigPerspective3d = useEditorStore((s) => s.rigPerspective3d);
  const showFloatingPreview = useEditorStore((s) => s.showFloatingPreview);
  const toggleFloatingPreview = useEditorStore((s) => s.toggleFloatingPreview);
  const showGameDataOverlay = useEditorStore((s) => s.showGameDataOverlay);
  const gameDataVersion = useEditorStore((s) => s.gameDataVersion);
  const light2dEnabled = useEditorStore((s) => s.light2dEnabled);
  const light2dX = useEditorStore((s) => s.light2dX);
  const light2dY = useEditorStore((s) => s.light2dY);
  const light2dZ = useEditorStore((s) => s.light2dZ);
  const light2dColor = useEditorStore((s) => s.light2dColor);
  const light2dIntensity = useEditorStore((s) => s.light2dIntensity);
  const light2dAmbient = useEditorStore((s) => s.light2dAmbient);
  const light2dEmission = useEditorStore((s) => s.light2dEmission);
  const light2dType = useEditorStore((s) => s.light2dType);
  const light2dAmbientColor = useEditorStore((s) => s.light2dAmbientColor);
  const light2dSpecular = useEditorStore((s) => s.light2dSpecular);
  const light2dShininess = useEditorStore((s) => s.light2dShininess);
  const light2dHeightScale = useEditorStore((s) => s.light2dHeightScale);
  const light2dAo = useEditorStore((s) => s.light2dAo);
  const light2dCelSteps = useEditorStore((s) => s.light2dCelSteps);
  const light2dAutoNormal = useEditorStore((s) => s.light2dAutoNormal);
  const paletteLutEnabled = useEditorStore((s) => s.paletteLutEnabled);
  const paletteLutPresetName = useEditorStore((s) => s.paletteLutPresetName);
  const palette = useEditorStore((s) => s.palette);

  const stageRef = useRef<HTMLDivElement>(null);
  const canvasFrameRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapGhostRef = useRef<HTMLCanvasElement>(null);
  const wrapScratchRef = useRef<HTMLCanvasElement | null>(null);
  const rendererRef = useRef<WebGL2Renderer | null>(null);
  const dataDragRef = useRef<{
    kind: "hitbox" | "hurtbox" | "collision";
    startX: number;
    startY: number;
    curX: number;
    curY: number;
  } | null>(null);
  const [dataDraftBox, setDataDraftBox] = useState<{
    kind: "hitbox" | "hurtbox" | "collision";
    x: number;
    y: number;
    w: number;
    h: number;
  } | null>(null);

  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [spacePressed, setSpacePressed] = useState(false);
  const [selectionPath, setSelectionPath] = useState("");

  const panDragRef = useRef<{
    active: boolean;
    startX: number;
    startY: number;
    originX: number;
    originY: number;
  }>({ active: false, startX: 0, startY: 0, originX: 0, originY: 0 });

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

  const getPixelCoords = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>): Point => {
      const rect = e.currentTarget.getBoundingClientRect();
      const rawPt: Point = {
        x: Math.floor((e.clientX - rect.left) / zoom),
        y: Math.floor((e.clientY - rect.top) / zoom),
      };
      const st = useEditorStore.getState();
      if (st.workspaceMode === "draw" && (st.viewFlipH || st.viewFlipV)) {
        return mapFlippedPoint(
          rawPt,
          st.canvasWidth,
          st.canvasHeight,
          st.viewFlipH,
          st.viewFlipV
        );
      }
      return rawPt;
    },
    [zoom]
  );

  const drawPointer = useDrawPointer({
    getPixelCoords,
    renderOverlayOnly,
  });
  const hasActiveDrawStrokeRef = useRef(drawPointer.hasActiveStroke);
  hasActiveDrawStrokeRef.current = drawPointer.hasActiveStroke;

  const renderCanvas = useCallback(() => {
    const renderer = rendererRef.current;
    if (renderer) {
      const state = useEditorStore.getState();
      renderer.setBackdrop(
        resolveRendererBackdrop(state.canvasBackdrop, state.canvasBackdropColor)
      );
      if (state.onionSkin) {
        const baseOpacity = state.onionSkinOpacity / 100;
        const onion = pixelEngine.compositeOnionSkin(
          state.layers,
          state.currentFrame,
          state.frames.length,
          state.onionPrevFrames,
          state.onionNextFrames,
          baseOpacity,
          {
            tint: state.onionSkinTint,
            baseOpacity,
            inFront: state.onionSkinInFront,
            loopWrap: state.onionSkinLoopWrap,
          }
        );
        renderer.uploadOnion(pixelEngine.width, pixelEngine.height, onion);
        renderer.setOnionInFront(state.onionSkinInFront);
        renderer.setShowOnion(true);
      } else {
        renderer.setShowOnion(false);
        renderer.setOnionInFront(false);
      }
      const targetPalette =
        PALETTE_PRESETS.find((p) => p.name === state.paletteLutPresetName)
          ?.colors ?? [];
      const rawComposite = pixelEngine.compositeFrameWithShaderPreview(
        state.layers,
        state.currentFrame,
        {
          useRig: state.workspaceMode === "rig",
          rigOpts: {
            pixelSnap: state.rigPixelSnap,
            rotSprite: state.rigRotSprite,
            mode: state.rigMode === "setup" ? "rest" : "pose",
            cleanup: {
              removeOrphans: state.rigCleanupOrphans,
              fillHoles: state.rigCleanupHoles,
              paletteLock: state.rigCleanupPaletteLock,
              preserveOutline: state.rigCleanupOutline,
            },
            autoZSort: state.rigAutoZSort,
            directionalLighting: state.rigDirectionalLighting,
            perspective3d: state.rigPerspective3d,
          },
          light2d: {
            enabled: state.light2dEnabled,
            lightX: state.light2dX,
            lightY: state.light2dY,
            lightZ: state.light2dZ,
            lightColor: state.light2dColor,
            intensity: state.light2dIntensity,
            ambient: state.light2dAmbient,
            emissionStrength: state.light2dEmission,
            lightType: state.light2dType,
            ambientColor: state.light2dAmbientColor,
            specularStrength: state.light2dSpecular,
            shininess: state.light2dShininess,
            heightScale: state.light2dHeightScale,
            aoStrength: state.light2dAo,
            celSteps: state.light2dCelSteps,
            autoNormalIfMissing: state.light2dAutoNormal,
          },
          paletteLut: {
            enabled: state.paletteLutEnabled,
            sourcePalette: state.palette,
            targetPalette,
          },
        }
      );
      const composite =
        state.workspaceMode === "draw" &&
        (state.viewGrayscale || state.viewSilhouette)
          ? applyViewCheckFilter(rawComposite, {
              grayscale: state.viewGrayscale,
              silhouette: state.viewSilhouette,
            })
          : rawComposite;
      let combinedDirty: {
        x: number;
        y: number;
        width: number;
        height: number;
      } | null = null;
      for (const layer of state.layers) {
        if (layer.kind !== "raster") continue;
        const cel = pixelEngine.getCel(layer.id, state.currentFrame);
        if (!cel) continue;
        const d = cel.consumeDirtyRect();
        if (!d) continue;
        const converted = { x: d.x, y: d.y, width: d.w, height: d.h };
        if (!combinedDirty) {
          combinedDirty = converted;
        } else {
          const minX = Math.min(combinedDirty.x, converted.x);
          const minY = Math.min(combinedDirty.y, converted.y);
          const maxX = Math.max(
            combinedDirty.x + combinedDirty.width,
            converted.x + converted.width
          );
          const maxY = Math.max(
            combinedDirty.y + combinedDirty.height,
            converted.y + converted.height
          );
          combinedDirty = {
            x: minX,
            y: minY,
            width: maxX - minX,
            height: maxY - minY,
          };
        }
      }
      if (
        combinedDirty &&
        state.workspaceMode === "draw" &&
        !state.light2dEnabled &&
        !state.paletteLutEnabled
      ) {
        renderer.uploadMainRegion(
          composite,
          pixelEngine.width,
          pixelEngine.height,
          combinedDirty
        );
      } else {
        renderer.uploadFrame(pixelEngine.width, pixelEngine.height, composite);
      }
      if (
        state.workspaceMode === "rig" &&
        (state.rigShowInfluence || state.rigTool === "weightPaint") &&
        pixelEngine.rig.hasAnyBoneMask()
      ) {
        pixelEngine.clearOverlay();
        renderBoneInfluenceOverlay(
          pixelEngine.rig,
          pixelEngine.overlayBuffer,
          state.selectedBoneId,
          {
            mode: state.rigWeightOverlay,
            rigMode: state.rigMode,
            frame: state.currentFrame,
            pixelSnap: state.rigPixelSnap,
            sourceAlpha:
              state.rigWeightOverlay === "unweighted"
                ? pixelEngine.compositeBuffer
                : null,
          }
        );
      } else if (!hasActiveDrawStrokeRef.current()) {
        pixelEngine.clearOverlay();
      }
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

  // Auto-commit floating selection when switching away from Move tool (unless Free Transform is active)
  useEffect(() => {
    const st = useEditorStore.getState();
    if (
      activeTool !== "move" &&
      pixelEngine.floating &&
      !st.freeTransformActive
    ) {
      commitFloatingSelection();
    }
  }, [activeTool]);

  // Auto-commit Free Transform when leaving Draw mode
  useEffect(() => {
    const st = useEditorStore.getState();
    if (workspaceMode !== "draw" && st.freeTransformActive) {
      commitFloatingSelection();
    }
  }, [workspaceMode]);

  // Clear unsaved rig pose overrides when changing frames
  useEffect(() => {
    pixelEngine.rig.clearPoseOverrides();
  }, [currentFrame]);

  // Re-composite when layers, active frame, wrap, onion skin, or view checks change
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
    onionSkinTint,
    onionSkinOpacity,
    onionSkinInFront,
    onionSkinLoopWrap,
    workspaceMode,
    viewFlipH,
    viewFlipV,
    viewGrayscale,
    viewSilhouette,
    canvasBackdrop,
    canvasBackdropColor,
    rigVersion,
    rigMode,
    rigPixelSnap,
    rigRotSprite,
    rigShowInfluence,
    rigWeightOverlay,
    rigCleanupOrphans,
    rigCleanupHoles,
    rigCleanupPaletteLock,
    rigCleanupOutline,
    rigAutoZSort,
    rigDirectionalLighting,
    rigPerspective3d,
    selectedBoneId,
    rigTool,
    light2dEnabled,
    light2dX,
    light2dY,
    light2dZ,
    light2dColor,
    light2dIntensity,
    light2dAmbient,
    light2dEmission,
    light2dType,
    light2dAmbientColor,
    light2dSpecular,
    light2dShininess,
    light2dHeightScale,
    light2dAo,
    light2dCelSteps,
    light2dAutoNormal,
    paletteLutEnabled,
    paletteLutPresetName,
    palette,
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
        return;
      }
      if (!isEditable(e.target)) {
        if (e.key === "Enter" && drawPointer.commitPendingMultiStep()) {
          e.preventDefault();
          e.stopPropagation();
        } else if (e.key === "Escape" && drawPointer.cancelPendingMultiStep()) {
          e.preventDefault();
          e.stopPropagation();
        }
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code === "Space") {
        setSpacePressed(false);
      }
    };
    window.addEventListener("keydown", onKeyDown, true);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKeyDown, true);
      window.removeEventListener("keyup", onKeyUp);
    };
  }, []);

  const updateHoverOverlay = (px: number, py: number) => {
    const state = useEditorStore.getState();
    if (state.workspaceMode === "rig") {
      pixelEngine.clearOverlay();
      if (
        (state.rigShowInfluence || state.rigTool === "weightPaint") &&
        pixelEngine.rig.hasAnyBoneMask()
      ) {
        renderBoneInfluenceOverlay(
          pixelEngine.rig,
          pixelEngine.overlayBuffer,
          state.selectedBoneId,
          {
            mode: state.rigWeightOverlay,
            rigMode: state.rigMode,
            frame: state.currentFrame,
            pixelSnap: state.rigPixelSnap,
            sourceAlpha:
              state.rigWeightOverlay === "unweighted"
                ? pixelEngine.compositeBuffer
                : null,
          }
        );
      }
      if (
        state.rigTool === "weightPaint" &&
        px >= 0 &&
        py >= 0 &&
        px < state.canvasWidth &&
        py < state.canvasHeight
      ) {
        for (const fp of expandBrushFootprint(px, py, state.rigBrushSize)) {
          pixelEngine.overlayBuffer.setPixel(fp.x, fp.y, 255, 255, 255, 165);
        }
      }
      renderOverlayOnly();
      return;
    }

    drawPointer.updateDrawHoverOverlay(px, py);
  };

  const rigPointer = useRigPointer({
    onHoverPixels: (px, py) => updateHoverOverlay(px, py),
  });
  const tilePointer = useTilePointer({ getPixelCoords });

  useEffect(() => {
    if (!animateTilesPreview) {
      pixelEngine.tileAnimationElapsedMs = undefined;
      pixelEngine.emitChange();
      return;
    }
    const start = performance.now();
    const id = window.setInterval(() => {
      if (!pixelEngine.hasAnimatedTiles()) return;
      pixelEngine.tileAnimationElapsedMs = performance.now() - start;
      pixelEngine.emitChange();
    }, 100);
    return () => window.clearInterval(id);
  }, [animateTilesPreview]);

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

    if (state.workspaceMode === "rig") {
      rigPointer.onPointerDown(e);
      return;
    }

    if (tilePointer.onPointerDown(e)) {
      return;
    }

    if (state.workspaceMode === "data") {
      if (e.button !== 0) return;
      const { x: px, y: py } = getPixelCoords(e);
      const clampedX = Math.max(0, Math.min(state.canvasWidth - 1, px));
      const clampedY = Math.max(0, Math.min(state.canvasHeight - 1, py));
      if (state.dataTool === "socket") {
        const created = pixelEngine.gameData.addSocket({
          frame: state.currentFrame,
          name: `socket_${pixelEngine.gameData.getSocketsAtFrame(state.currentFrame).length + 1}`,
          x: clampedX,
          y: clampedY,
        });
        state.bumpGameDataVersion();
        state.setStatusMessage(
          `Placed socket "${created.name}" at (${created.x}, ${created.y})`
        );
        return;
      }
      e.currentTarget.setPointerCapture(e.pointerId);
      dataDragRef.current = {
        kind: state.dataTool,
        startX: clampedX,
        startY: clampedY,
        curX: clampedX,
        curY: clampedY,
      };
      setDataDraftBox({
        kind: state.dataTool,
        x: clampedX,
        y: clampedY,
        w: 1,
        h: 1,
      });
      return;
    }

    drawPointer.onPointerDown(e);
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

    if (state.workspaceMode === "rig") {
      rigPointer.onPointerMove(e);
      return;
    }

    if (tilePointer.onPointerMove(e)) {
      return;
    }

    const dataDrag = dataDragRef.current;
    if (dataDrag) {
      const clampedX = Math.max(0, Math.min(state.canvasWidth - 1, px));
      const clampedY = Math.max(0, Math.min(state.canvasHeight - 1, py));
      dataDrag.curX = clampedX;
      dataDrag.curY = clampedY;
      const minX = Math.min(dataDrag.startX, clampedX);
      const minY = Math.min(dataDrag.startY, clampedY);
      const w = Math.abs(clampedX - dataDrag.startX) + 1;
      const h = Math.abs(clampedY - dataDrag.startY) + 1;
      setDataDraftBox({ kind: dataDrag.kind, x: minX, y: minY, w, h });
      return;
    }

    if (drawPointer.onPointerMove(e)) {
      return;
    }

    if (!spacePressed) {
      updateHoverOverlay(px, py);
    }
  };

  const finishStroke = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (useEditorStore.getState().workspaceMode === "rig") {
      rigPointer.onPointerUp(e);
      return;
    }

    if (tilePointer.onPointerUp(e)) {
      return;
    }

    const dataDrag = dataDragRef.current;
    if (dataDrag) {
      dataDragRef.current = null;
      setDataDraftBox(null);
      if (e.currentTarget.hasPointerCapture(e.pointerId)) {
        e.currentTarget.releasePointerCapture(e.pointerId);
      }
      const st = useEditorStore.getState();
      const minX = Math.min(dataDrag.startX, dataDrag.curX);
      const minY = Math.min(dataDrag.startY, dataDrag.curY);
      const w = Math.abs(dataDrag.curX - dataDrag.startX) + 1;
      const h = Math.abs(dataDrag.curY - dataDrag.startY) + 1;
      const created = pixelEngine.gameData.addBox({
        frame: st.currentFrame,
        kind: dataDrag.kind,
        name: `${dataDrag.kind}_${pixelEngine.gameData.getBoxesAtFrame(st.currentFrame).length + 1}`,
        x: minX,
        y: minY,
        w,
        h,
      });
      st.bumpGameDataVersion();
      st.setStatusMessage(
        `Added ${created.kind} (${created.w}×${created.h} at ${created.x},${created.y})`
      );
      return;
    }

    drawPointer.onPointerUp(e);
  };

  const handleCanvasPointerLeave = () => {
    rigPointer.onPointerLeave();
    tilePointer.onPointerLeave();
    setCursorPos(null);
    if (!drawPointer.hasActiveStroke()) {
      const state = useEditorStore.getState();
      pixelEngine.clearOverlay();
      if (
        state.workspaceMode === "rig" &&
        (state.rigShowInfluence || state.rigTool === "weightPaint") &&
        pixelEngine.rig.hasAnyBoneMask()
      ) {
        renderBoneInfluenceOverlay(
          pixelEngine.rig,
          pixelEngine.overlayBuffer,
          state.selectedBoneId,
          {
            mode: state.rigWeightOverlay,
            rigMode: state.rigMode,
            frame: state.currentFrame,
            pixelSnap: state.rigPixelSnap,
            sourceAlpha:
              state.rigWeightOverlay === "unweighted"
                ? pixelEngine.compositeBuffer
                : null,
          }
        );
      }
      renderOverlayOnly();
    }
  };

  const handleCanvasContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const state = useEditorStore.getState();
    if (state.workspaceMode === "rig") {
      rigPointer.onContextMenu(e, canvasRef.current);
      return;
    }
    if (drawPointer.consumeSuppressContextMenu()) {
      return;
    }
    const hasClip = Boolean(pixelEngine.clipboard);
    const hasSel = Boolean(
      pixelEngine.floating ||
        (pixelEngine.selection && !pixelEngine.selection.isEmpty())
    );
    state.openContextMenu(e.clientX, e.clientY, [
      { kind: "item", label: "Cut", shortcut: "Ctrl+X", action: () => { cutSelection(); } },
      { kind: "item", label: "Copy", shortcut: "Ctrl+C", action: () => { copySelection(); } },
      { kind: "item", label: "Paste", shortcut: "Ctrl+V", disabled: !hasClip, action: () => { pasteClipboard(); } },
      { kind: "separator" },
      { kind: "item", label: "Cut to New Layer", shortcut: "Ctrl+Shift+X", action: () => { cutSelectionToNewLayer(); } },
      { kind: "item", label: "Copy to New Layer", shortcut: "Ctrl+J", action: () => { copySelectionToNewLayer(); } },
      { kind: "item", label: "Delete Selection", shortcut: "Del", disabled: !hasSel, danger: true, action: () => { deleteSelection(); } },
      { kind: "separator" },
      { kind: "item", label: "Select All", shortcut: "Ctrl+A", action: () => selectAllCanvas() },
      { kind: "item", label: "Deselect", shortcut: "Ctrl+D", disabled: !hasSel, action: () => deselectAll() },
      { kind: "separator" },
      { kind: "item", label: "Flip Horizontal", action: () => transformSelectionOrCel("flipH") },
      { kind: "item", label: "Flip Vertical", action: () => transformSelectionOrCel("flipV") },
      { kind: "item", label: "Rotate 90° CW", action: () => transformSelectionOrCel("rotateCW") },
      { kind: "item", label: "3D Rotate & Turntable...", shortcut: "Ctrl+3", action: () => state.setRotate3dModalOpen(true) },
    ]);
  };

  const cursorStyle = spacePressed
    ? "grab"
    : workspaceMode === "rig"
      ? rigTool === "select"
        ? "default"
        : rigTool === "translate" || rigTool === "scale"
          ? "move"
          : "crosshair"
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

  const gameDataOverlay = useMemo(() => {
    void gameDataVersion;
    if (workspaceMode !== "data" && !showGameDataOverlay) {
      return { boxes: [], sockets: [] };
    }
    return {
      boxes: pixelEngine.gameData.getBoxesAtFrame(currentFrame),
      sockets: pixelEngine.gameData.getSocketsAtFrame(currentFrame),
    };
  }, [workspaceMode, showGameDataOverlay, currentFrame, gameDataVersion]);

  const isTilesMap = workspaceMode === "tiles" && tilesMode === "map";
  const dragPreview = drawPointer.dragPreview;

  const isDrawMode = workspaceMode === "draw";
  const flipScaleX = isDrawMode && viewFlipH ? -1 : 1;
  const flipScaleY = isDrawMode && viewFlipV ? -1 : 1;
  const frameTransform =
    flipScaleX === -1 || flipScaleY === -1
      ? `translate(${pan.x}px, ${pan.y}px) scale(${flipScaleX}, ${flipScaleY})`
      : `translate(${pan.x}px, ${pan.y}px)`;

  const showRefOverlay = Boolean(isDrawMode && referenceImage && referenceImage.visible);
  const refImgElement = showRefOverlay && referenceImage && (
    <img
      src={referenceImage.dataUrl}
      alt="Reference"
      className="viewport-reference-img"
      style={{
        width: referenceImage.width * zoom * (referenceImage.scale / 100),
        height: referenceImage.height * zoom * (referenceImage.scale / 100),
        left: referenceImage.offsetX * zoom,
        top: referenceImage.offsetY * zoom,
        opacity: referenceImage.opacity / 100,
        pointerEvents: "none",
        imageRendering: "pixelated",
      }}
    />
  );

  const frameBackdropClass = `backdrop-${canvasBackdrop}`;
  const frameBackdropStyle =
    canvasBackdrop === "custom"
      ? { backgroundColor: canvasBackdropColor }
      : undefined;

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
        ref={stageRef}
        className={`viewport-stage ${workspaceMode === "rig" ? `rig-mode-${rigMode}` : workspaceMode === "tiles" ? `tiles-mode-${tilesMode}` : ""}`}
        style={{ cursor: spacePressed ? "grab" : undefined }}
        onWheel={workspaceMode === "tiles" && tilesMode === "tile" ? undefined : handleWheel}
        onContextMenu={handleCanvasContextMenu}
        onMouseDown={workspaceMode === "tiles" && tilesMode === "tile" ? undefined : handleStageMouseDown}
        onMouseMove={workspaceMode === "tiles" && tilesMode === "tile" ? undefined : handleStageMouseMove}
        onMouseUp={workspaceMode === "tiles" && tilesMode === "tile" ? undefined : handleStageMouseUp}
        onMouseLeave={workspaceMode === "tiles" && tilesMode === "tile" ? undefined : handleStageMouseUp}
      >
        {workspaceMode === "tiles" && tilesMode === "tile" ? (
          <TileEditViewport />
        ) : (
        <div
          ref={canvasFrameRef}
          className={`viewport-canvas-frame ${frameBackdropClass}`}
          style={{
            ...frameBackdropStyle,
            width: canvasWidth * zoom,
            height: canvasHeight * zoom,
            transform: frameTransform,
          }}
        >
          {referenceImage?.behindCanvas && refImgElement}

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
            style={{
              cursor: cursorStyle,
              opacity:
                showRefOverlay && referenceImage?.behindCanvas
                  ? 0.96
                  : 1,
            }}
            onContextMenu={handleCanvasContextMenu}
            onPointerDown={handleCanvasPointerDown}
            onPointerMove={handleCanvasPointerMove}
            onPointerUp={finishStroke}
            onPointerCancel={finishStroke}
            onPointerLeave={handleCanvasPointerLeave}
          />

          {!referenceImage?.behindCanvas && refImgElement}

          {showGrid && zoom >= 4 && (
            <div
              className="viewport-pixel-grid"
              style={{
                backgroundSize: `${zoom}px ${zoom}px`,
                opacity: zoom < 6 ? 0.5 : 1,
              }}
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

          <TileOverlay />

          {workspaceMode !== "rig" && !isTilesMap && (
            <DrawOverlay
              isStrokeActive={drawPointer.hasActiveStroke()}
              dragPreview={dragPreview}
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

          {(selectionPath ||
            dragPreview?.kind === "marquee" ||
            dragPreview?.kind === "ellipseMarquee" ||
            dragPreview?.kind === "lasso" ||
            dragPreview?.kind === "polyLasso") && (
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
              {dragPreview?.kind === "ellipseMarquee" && (
                <ellipse
                  className="selection-preview-shape"
                  cx={dragPreview.x + dragPreview.w / 2}
                  cy={dragPreview.y + dragPreview.h / 2}
                  rx={dragPreview.w / 2}
                  ry={dragPreview.h / 2}
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
              {dragPreview?.kind === "polyLasso" &&
                dragPreview.points.length > 0 && (
                  <polyline
                    className="selection-preview-shape"
                    points={[...dragPreview.points, dragPreview.cursor]
                      .map((p) => `${p.x + 0.5},${p.y + 0.5}`)
                      .join(" ")}
                  />
                )}
            </svg>
          )}

          {workspaceMode === "rig" &&
            (rigShowBones || rigTool === "weightPaint") && (
              <RigOverlay
                draftBone={rigPointer.draftBone}
                draftGradient={rigPointer.draftGradient}
                hoveredBoneId={rigPointer.hoveredBoneId}
              />
            )}

          {(workspaceMode === "data" || showGameDataOverlay) &&
            (gameDataOverlay.boxes.length > 0 ||
              gameDataOverlay.sockets.length > 0 ||
              dataDraftBox) && (
              <svg
                className="viewport-gamedata-svg"
                viewBox={`0 0 ${canvasWidth} ${canvasHeight}`}
                preserveAspectRatio="none"
              >
                {gameDataOverlay.boxes.map((b) => (
                  <rect
                    key={b.id}
                    className={`gamedata-box ${b.kind}`}
                    x={b.x}
                    y={b.y}
                    width={b.w}
                    height={b.h}
                  />
                ))}
                {dataDraftBox && (
                  <rect
                    className={`gamedata-box ${dataDraftBox.kind} draft`}
                    x={dataDraftBox.x}
                    y={dataDraftBox.y}
                    width={dataDraftBox.w}
                    height={dataDraftBox.h}
                  />
                )}
                {gameDataOverlay.sockets.map((s) => (
                  <g key={s.id} className="gamedata-socket">
                    <line x1={s.x - 1} y1={s.y + 0.5} x2={s.x + 2} y2={s.y + 0.5} />
                    <line x1={s.x + 0.5} y1={s.y - 1} x2={s.x + 0.5} y2={s.y + 2} />
                    <rect x={s.x} y={s.y} width={1} height={1} />
                  </g>
                ))}
              </svg>
            )}
        </div>
        )}

        {isDrawMode && showRulers && (
          <RulersOverlay
            stageRef={stageRef}
            canvasFrameRef={canvasFrameRef}
            canvasWidth={canvasWidth}
            canvasHeight={canvasHeight}
            zoom={zoom}
            viewFlipH={viewFlipH}
            viewFlipV={viewFlipV}
          />
        )}

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
          <div className="option-divider" style={{ height: 14, margin: "0 2px" }} />
          <button
            type="button"
            className={`toggle-chip ${showFloatingPreview ? "active" : ""}`}
            style={{ padding: "1px 5px", fontSize: 10 }}
            title="Toggle Floating Preview"
            onClick={toggleFloatingPreview}
          >
            <Eye size={11} />
            <span>Preview</span>
          </button>
        </div>

        <FloatingPreview />
      </div>
    </section>
  );
}

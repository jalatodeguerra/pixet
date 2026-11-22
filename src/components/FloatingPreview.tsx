import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronDown, ChevronRight, GripVertical, Pause, Play, X } from "lucide-react";
import { pixelEngine } from "../engine/document/PixelEngine";
import { useEditorStore } from "../store/editorStore";
import { PALETTE_PRESETS } from "../utils/paletteParser";

export function FloatingPreview() {
  const show = useEditorStore((s) => s.showFloatingPreview);
  const setShow = useEditorStore((s) => s.setShowFloatingPreview);
  const canvasWidth = useEditorStore((s) => s.canvasWidth);
  const canvasHeight = useEditorStore((s) => s.canvasHeight);
  const currentFrame = useEditorStore((s) => s.currentFrame);
  const layers = useEditorStore((s) => s.layers);
  const isPlaying = useEditorStore((s) => s.isPlaying);
  const togglePlaying = useEditorStore((s) => s.togglePlaying);
  const previewScale = useEditorStore((s) => s.previewScale);
  const setPreviewScale = useEditorStore((s) => s.setPreviewScale);
  const tags = useEditorStore((s) => s.tags);
  const activeTagId = useEditorStore((s) => s.activeTagId);
  const setActiveTagId = useEditorStore((s) => s.setActiveTagId);
  const workspaceMode = useEditorStore((s) => s.workspaceMode);
  const rigVersion = useEditorStore((s) => s.rigVersion);
  const rigPixelSnap = useEditorStore((s) => s.rigPixelSnap);
  const rigRotSprite = useEditorStore((s) => s.rigRotSprite);
  const light2dEnabled = useEditorStore((s) => s.light2dEnabled);
  const light2dX = useEditorStore((s) => s.light2dX);
  const light2dY = useEditorStore((s) => s.light2dY);
  const light2dZ = useEditorStore((s) => s.light2dZ);
  const light2dColor = useEditorStore((s) => s.light2dColor);
  const light2dIntensity = useEditorStore((s) => s.light2dIntensity);
  const light2dAmbient = useEditorStore((s) => s.light2dAmbient);
  const light2dEmission = useEditorStore((s) => s.light2dEmission);
  const paletteLutEnabled = useEditorStore((s) => s.paletteLutEnabled);
  const paletteLutPresetName = useEditorStore((s) => s.paletteLutPresetName);
  const palette = useEditorStore((s) => s.palette);

  const [collapsed, setCollapsed] = useState(false);
  const [pos, setPos] = useState<{ left: number | null; top: number }>({
    left: null,
    top: 12,
  });

  const panelRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const dragRef = useRef<{
    startX: number;
    startY: number;
    origLeft: number;
    origTop: number;
  } | null>(null);

  const drawPreview = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const state = useEditorStore.getState();
    const targetPalette =
      PALETTE_PRESETS.find((p) => p.name === state.paletteLutPresetName)
        ?.colors ?? [];
    const composite = pixelEngine.compositeFrameWithShaderPreview(
      state.layers,
      state.currentFrame,
      {
        useRig: state.workspaceMode === "rig",
        rigOpts: {
          pixelSnap: state.rigPixelSnap,
          rotSprite: state.rigRotSprite,
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
        },
        paletteLut: {
          enabled: state.paletteLutEnabled,
          sourcePalette: state.palette,
          targetPalette,
        },
      }
    );

    const img = new ImageData(
      new Uint8ClampedArray(composite),
      pixelEngine.width,
      pixelEngine.height
    );
    ctx.putImageData(img, 0, 0);
  }, []);

  useEffect(() => {
    if (!show || collapsed) return;
    drawPreview();
  }, [
    show,
    collapsed,
    canvasWidth,
    canvasHeight,
    currentFrame,
    layers,
    workspaceMode,
    rigVersion,
    rigPixelSnap,
    rigRotSprite,
    light2dEnabled,
    light2dX,
    light2dY,
    light2dZ,
    light2dColor,
    light2dIntensity,
    light2dAmbient,
    light2dEmission,
    paletteLutEnabled,
    paletteLutPresetName,
    palette,
    drawPreview,
  ]);

  useEffect(() => {
    if (!show || collapsed) return;
    return pixelEngine.subscribe(drawPreview);
  }, [show, collapsed, drawPreview]);

  useEffect(() => {
    const onMouseMove = (e: MouseEvent) => {
      const drag = dragRef.current;
      const panel = panelRef.current;
      const parent = panel?.parentElement;
      if (!drag || !panel || !parent) return;

      const maxLeft = Math.max(0, parent.clientWidth - panel.offsetWidth);
      const maxTop = Math.max(0, parent.clientHeight - panel.offsetHeight);
      const nextLeft = Math.max(
        0,
        Math.min(maxLeft, drag.origLeft + (e.clientX - drag.startX))
      );
      const nextTop = Math.max(
        0,
        Math.min(maxTop, drag.origTop + (e.clientY - drag.startY))
      );
      setPos({ left: nextLeft, top: nextTop });
    };

    const onMouseUp = () => {
      dragRef.current = null;
    };

    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
    return () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };
  }, []);

  if (!show) return null;

  const startDrag = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    if ((e.target as HTMLElement).closest("button, select")) return;
    e.stopPropagation();
    const panel = panelRef.current;
    const parent = panel?.parentElement;
    if (!panel || !parent) return;

    const currentLeft =
      pos.left ?? Math.max(8, parent.clientWidth - panel.offsetWidth - 12);
    dragRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      origLeft: currentLeft,
      origTop: pos.top,
    };
  };

  return (
    <div
      ref={panelRef}
      className="floating-preview"
      style={
        pos.left !== null
          ? { left: pos.left, top: pos.top }
          : { right: 12, top: pos.top }
      }
      onMouseDown={(e) => {
        e.stopPropagation();
        startDrag(e);
      }}
      onPointerDown={(e) => e.stopPropagation()}
      onWheel={(e) => e.stopPropagation()}
      onContextMenu={(e) => e.stopPropagation()}
      aria-label="Floating Animation Preview"
    >
      <div className="floating-preview-header">
        <button
          type="button"
          className="icon-action-btn"
          style={{ width: 18, height: 18 }}
          title={collapsed ? "Expand Preview" : "Collapse Preview"}
          onClick={() => setCollapsed((c) => !c)}
        >
          {collapsed ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
        </button>

        <div className="floating-preview-drag-handle" title="Drag to move preview">
          <GripVertical size={11} />
          <span>Preview</span>
        </div>

        <div className="panel-header-actions">
          <select
            className="palette-select"
            style={{ maxWidth: 68, padding: "1px 3px", fontSize: 10 }}
            aria-label="Preview Tag Filter"
            value={activeTagId ?? ""}
            onChange={(e) => setActiveTagId(e.target.value || null)}
          >
            <option value="">All</option>
            {tags.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
          <button
            type="button"
            className={`toggle-chip ${previewScale === 1 ? "active" : ""}`}
            style={{ padding: "1px 4px", fontSize: 10 }}
            onClick={() => setPreviewScale(1)}
          >
            1×
          </button>
          <button
            type="button"
            className={`toggle-chip ${previewScale === 2 ? "active" : ""}`}
            style={{ padding: "1px 4px", fontSize: 10 }}
            onClick={() => setPreviewScale(2)}
          >
            2×
          </button>
          <button
            type="button"
            className={`toggle-chip ${previewScale === 4 ? "active" : ""}`}
            style={{ padding: "1px 4px", fontSize: 10 }}
            onClick={() => setPreviewScale(4)}
          >
            4×
          </button>
          <button
            type="button"
            className="icon-action-btn"
            style={{ width: 20, height: 20 }}
            title={isPlaying ? "Pause Preview" : "Play Preview"}
            onClick={togglePlaying}
          >
            {isPlaying ? <Pause size={11} /> : <Play size={11} />}
          </button>
          <button
            type="button"
            className="icon-action-btn"
            style={{ width: 20, height: 20 }}
            title="Hide Floating Preview"
            onClick={() => setShow(false)}
          >
            <X size={11} />
          </button>
        </div>
      </div>

      {!collapsed && (
        <div className="floating-preview-body">
          <div className="preview-stage">
            <canvas
              ref={canvasRef}
              width={canvasWidth}
              height={canvasHeight}
              className="preview-canvas"
              style={{
                width: canvasWidth * previewScale,
                height: canvasHeight * previewScale,
              }}
            />
          </div>
        </div>
      )}
    </div>
  );
}

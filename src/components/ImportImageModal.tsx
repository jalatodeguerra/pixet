import { useEffect, useMemo, useRef, useState } from "react";
import { Image as ImageIcon, Layers, LayoutGrid, X } from "lucide-react";
import { pixelEngine } from "../engine/document/PixelEngine";
import { commitFloatingSelection } from "../engine/document/selectionActions";
import { syncTimelineCels } from "../engine/document/timelineActions";
import {
  extractPaletteFromBuffer,
  placeBufferCentered,
  resizePixelBufferNearest,
  sliceSpritesheet,
} from "../engine/io/imageImport";
import { type FrameItem, useEditorStore } from "../store/editorStore";

type ImportMode = "sprite" | "layer" | "spritesheet";

export function ImportImageModal() {
  const pending = useEditorStore((s) => s.pendingImportImage);
  const setPending = useEditorStore((s) => s.setPendingImportImage);
  const canvasWidth = useEditorStore((s) => s.canvasWidth);
  const canvasHeight = useEditorStore((s) => s.canvasHeight);
  const currentFrame = useEditorStore((s) => s.currentFrame);

  const [mode, setMode] = useState<ImportMode>("sprite");
  const [targetW, setTargetW] = useState(32);
  const [targetH, setTargetH] = useState(32);
  const [fitToCanvas, setFitToCanvas] = useState(true);
  const [frameW, setFrameW] = useState(32);
  const [frameH, setFrameH] = useState(32);
  const [skipEmpty, setSkipEmpty] = useState(true);
  const [extractPal, setExtractPal] = useState(true);

  const previewCanvasRef = useRef<HTMLCanvasElement>(null);

  // Initialize sensible defaults whenever a new image is dropped/picked
  useEffect(() => {
    if (!pending) return;
    const w = pending.buffer.width;
    const h = pending.buffer.height;
    setTargetW(w);
    setTargetH(h);
    setFitToCanvas(w > canvasWidth || h > canvasHeight);

    if (w > h && w % h === 0) {
      setFrameW(h);
      setFrameH(h);
    } else {
      setFrameW(Math.min(32, w));
      setFrameH(Math.min(32, h));
    }
    setMode("sprite");
  }, [pending, canvasWidth, canvasHeight]);

  // Escape key closes modal
  useEffect(() => {
    if (!pending) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setPending(null);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [pending, setPending]);

  // Draw crisp preview onto canvas
  useEffect(() => {
    if (!pending) return;
    const canvas = previewCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const img = new ImageData(
      new Uint8ClampedArray(pending.buffer.data),
      pending.buffer.width,
      pending.buffer.height
    );
    ctx.putImageData(img, 0, 0);
  }, [pending]);

  const sheetCols = pending
    ? Math.max(1, Math.floor(pending.buffer.width / Math.max(1, frameW)))
    : 1;
  const sheetRows = pending
    ? Math.max(1, Math.floor(pending.buffer.height / Math.max(1, frameH)))
    : 1;

  const detectedFrameCount = useMemo(() => {
    if (!pending || mode !== "spritesheet") return 0;
    return sliceSpritesheet(pending.buffer, frameW, frameH, skipEmpty).length;
  }, [pending, mode, frameW, frameH, skipEmpty]);

  if (!pending) return null;

  const srcW = pending.buffer.width;
  const srcH = pending.buffer.height;
  const baseName = pending.name.replace(/\.[^.]+$/, "") || "imported";

  const previewScale = Math.min(220 / srcW, 220 / srcH);
  const displayW = Math.max(24, Math.round(srcW * previewScale));
  const displayH = Math.max(24, Math.round(srcH * previewScale));

  const applyScalePreset = (preset: "100" | "50" | "32" | "64") => {
    if (preset === "100") {
      setTargetW(srcW);
      setTargetH(srcH);
    } else if (preset === "50") {
      setTargetW(Math.max(1, Math.round(srcW / 2)));
      setTargetH(Math.max(1, Math.round(srcH / 2)));
    } else {
      const maxEdge = preset === "32" ? 32 : 64;
      const scale = maxEdge / Math.max(srcW, srcH);
      setTargetW(Math.max(1, Math.round(srcW * scale)));
      setTargetH(Math.max(1, Math.round(srcH * scale)));
    }
  };

  const handleImport = () => {
    commitFloatingSelection();
    const state = useEditorStore.getState();

    if (mode === "layer") {
      const placed = placeBufferCentered(
        pending.buffer,
        state.canvasWidth,
        state.canvasHeight,
        fitToCanvas
      );
      const layerId = state.addNamedLayer(baseName);
      const cel = pixelEngine.getOrCreateCel(layerId, currentFrame);
      pixelEngine.history.beginTransaction(
        layerId,
        currentFrame,
        "Import Layer"
      );
      pixelEngine.history.captureAllTiles(cel);
      cel.data.set(placed.data);
      cel.markAllDirty();
      pixelEngine.history.commitTransaction(cel);
      state.setHistoryFlags(
        pixelEngine.history.canUndo,
        pixelEngine.history.canRedo
      );
      syncTimelineCels();
      pixelEngine.emitChange();
      state.setStatusMessage(
        `Imported "${pending.name}" onto layer "${baseName}"`
      );
      setPending(null);
      return;
    }

    if (mode === "spritesheet") {
      const fw = Math.max(1, Math.min(srcW, Math.round(frameW)));
      const fh = Math.max(1, Math.min(srcH, Math.round(frameH)));
      const sliced = sliceSpritesheet(pending.buffer, fw, fh, skipEmpty);

      pixelEngine.resetForDocument(fw, fh);
      const celsMap: Record<number, boolean> = {};
      const nextFrames: FrameItem[] = [];
      const dur = Math.round(1000 / state.fps);

      for (let i = 0; i < sliced.length; i++) {
        const cel = pixelEngine.getOrCreateCel("layer-sheet", i);
        cel.data.set(sliced[i].data);
        cel.markAllDirty();
        celsMap[i] = !cel.isEmpty();
        nextFrames.push({
          id: `frame-imp-${i + 1}`,
          index: i,
          durationMs: dur,
        });
      }

      const extracted = extractPal
        ? extractPaletteFromBuffer(pending.buffer, 32)
        : [];
      state.loadProjectState({
        documentName: `${baseName}.pixet`,
        filePath: null,
        canvasWidth: fw,
        canvasHeight: fh,
        colorMode: "RGBA",
        paletteName:
          extracted.length > 0
            ? `${baseName} (${extracted.length})`
            : state.paletteName,
        palette: extracted.length > 0 ? extracted : state.palette,
        layers: [
          {
            id: "layer-sheet",
            name: baseName,
            kind: "raster",
            visible: true,
            locked: false,
            opacity: 100,
            alphaLock: false,
            blendMode: "Normal",
            parentId: null,
            cels: celsMap,
          },
        ],
        frames: nextFrames,
        tags: [],
      });
      state.setZoom(Math.max(1, Math.min(16, Math.floor(384 / Math.max(fw, fh)))));
      syncTimelineCels();
      pixelEngine.emitChange();
      state.setStatusMessage(
        `Sliced "${pending.name}" into ${sliced.length} frames (${fw}×${fh})`
      );
      setPending(null);
      return;
    }

    // mode === "sprite"
    const w = Math.max(1, Math.min(1024, Math.round(targetW)));
    const h = Math.max(1, Math.min(1024, Math.round(targetH)));
    const resized = resizePixelBufferNearest(pending.buffer, w, h);

    pixelEngine.resetForDocument(w, h);
    const cel = pixelEngine.getOrCreateCel("layer-import", 0);
    cel.data.set(resized.data);
    cel.markAllDirty();

    const extracted = extractPal ? extractPaletteFromBuffer(resized, 32) : [];
    state.loadProjectState({
      documentName: `${baseName}.pixet`,
      filePath: null,
      canvasWidth: w,
      canvasHeight: h,
      colorMode: "RGBA",
      paletteName:
        extracted.length > 0
          ? `${baseName} (${extracted.length})`
          : state.paletteName,
      palette: extracted.length > 0 ? extracted : state.palette,
      layers: [
        {
          id: "layer-import",
          name: "Imported",
          kind: "raster",
          visible: true,
          locked: false,
          opacity: 100,
          alphaLock: false,
          blendMode: "Normal",
          parentId: null,
          cels: { 0: !cel.isEmpty() },
        },
      ],
      frames: [
        { id: "frame-imp-1", index: 0, durationMs: Math.round(1000 / state.fps) },
      ],
      tags: [],
    });
    state.setZoom(Math.max(1, Math.min(16, Math.floor(384 / Math.max(w, h)))));
    syncTimelineCels();
    pixelEngine.emitChange();
    state.setStatusMessage(`Opened "${pending.name}" (${w}×${h})`);
    setPending(null);
  };

  return (
    <div
      className="modal-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) setPending(null);
      }}
    >
      <div
        className="modal-card import-modal-card"
        role="dialog"
        aria-label="Import Image"
      >
        <div className="modal-header">
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <ImageIcon size={14} />
            <span>Import Image — {pending.name}</span>
          </div>
          <button
            type="button"
            className="icon-action-btn"
            style={{ width: 22, height: 22 }}
            onClick={() => setPending(null)}
          >
            <X size={13} />
          </button>
        </div>

        <div className="modal-body">
          <div className="import-mode-tabs" role="tablist">
            <button
              type="button"
              role="tab"
              aria-selected={mode === "sprite"}
              className={`rotate3d-tab ${mode === "sprite" ? "active" : ""}`}
              onClick={() => setMode("sprite")}
            >
              <ImageIcon size={12} />
              <span>New Sprite</span>
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={mode === "layer"}
              className={`rotate3d-tab ${mode === "layer" ? "active" : ""}`}
              onClick={() => setMode("layer")}
            >
              <Layers size={12} />
              <span>Add as Layer</span>
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={mode === "spritesheet"}
              className={`rotate3d-tab ${mode === "spritesheet" ? "active" : ""}`}
              onClick={() => setMode("spritesheet")}
            >
              <LayoutGrid size={12} />
              <span>Spritesheet</span>
            </button>
          </div>

          <div className="import-layout">
            <div className="import-preview-wrap">
              <div
                className="import-preview-box"
                style={{ width: displayW, height: displayH }}
              >
                <canvas
                  ref={previewCanvasRef}
                  width={srcW}
                  height={srcH}
                  className="rotate3d-canvas"
                  style={{ width: displayW, height: displayH }}
                />
                {mode === "spritesheet" && (
                  <svg
                    className="import-slice-svg"
                    viewBox={`0 0 ${srcW} ${srcH}`}
                    preserveAspectRatio="none"
                  >
                    {Array.from({ length: sheetCols + 1 }, (_, c) => {
                      const x = c * Math.max(1, frameW);
                      if (x > srcW) return null;
                      return (
                        <line
                          key={`vc-${c}`}
                          x1={x}
                          y1={0}
                          x2={x}
                          y2={sheetRows * Math.max(1, frameH)}
                        />
                      );
                    })}
                    {Array.from({ length: sheetRows + 1 }, (_, r) => {
                      const y = r * Math.max(1, frameH);
                      if (y > srcH) return null;
                      return (
                        <line
                          key={`hr-${r}`}
                          x1={0}
                          y1={y}
                          x2={sheetCols * Math.max(1, frameW)}
                          y2={y}
                        />
                      );
                    })}
                  </svg>
                )}
              </div>
              <span className="rotate3d-hint">
                Source: {srcW}×{srcH} px
              </span>
            </div>

            <div className="rotate3d-controls">
              {mode === "sprite" && (
                <>
                  <div className="modal-grid-2">
                    <label className="modal-field">
                      <span>Width</span>
                      <input
                        type="number"
                        min={1}
                        max={1024}
                        className="palette-select"
                        value={targetW}
                        onChange={(e) =>
                          setTargetW(Math.max(1, Number(e.target.value) || 1))
                        }
                      />
                    </label>
                    <label className="modal-field">
                      <span>Height</span>
                      <input
                        type="number"
                        min={1}
                        max={1024}
                        className="palette-select"
                        value={targetH}
                        onChange={(e) =>
                          setTargetH(Math.max(1, Number(e.target.value) || 1))
                        }
                      />
                    </label>
                  </div>

                  <div className="rotate3d-presets">
                    <button
                      type="button"
                      className="mini-btn"
                      onClick={() => applyScalePreset("100")}
                    >
                      100%
                    </button>
                    <button
                      type="button"
                      className="mini-btn"
                      onClick={() => applyScalePreset("50")}
                    >
                      50%
                    </button>
                    <button
                      type="button"
                      className="mini-btn"
                      onClick={() => applyScalePreset("32")}
                    >
                      Fit 32px
                    </button>
                    <button
                      type="button"
                      className="mini-btn"
                      onClick={() => applyScalePreset("64")}
                    >
                      Fit 64px
                    </button>
                  </div>

                  <label className="modal-checkbox">
                    <input
                      type="checkbox"
                      checked={extractPal}
                      onChange={(e) => setExtractPal(e.target.checked)}
                    />
                    <span>Extract Palette (up to 32 colors)</span>
                  </label>
                </>
              )}

              {mode === "layer" && (
                <>
                  <div className="rotate3d-stack-note">
                    Places the image onto a new raster layer at Frame{" "}
                    {currentFrame + 1} centered in the {canvasWidth}×
                    {canvasHeight} canvas.
                  </div>
                  <label className="modal-checkbox">
                    <input
                      type="checkbox"
                      checked={fitToCanvas}
                      onChange={(e) => setFitToCanvas(e.target.checked)}
                    />
                    <span>Fit to Canvas (Nearest-Neighbor)</span>
                  </label>
                </>
              )}

              {mode === "spritesheet" && (
                <>
                  <div className="modal-grid-2">
                    <label className="modal-field">
                      <span>Frame W</span>
                      <input
                        type="number"
                        min={1}
                        max={srcW}
                        className="palette-select"
                        value={frameW}
                        onChange={(e) =>
                          setFrameW(
                            Math.max(1, Math.min(srcW, Number(e.target.value) || 1))
                          )
                        }
                      />
                    </label>
                    <label className="modal-field">
                      <span>Frame H</span>
                      <input
                        type="number"
                        min={1}
                        max={srcH}
                        className="palette-select"
                        value={frameH}
                        onChange={(e) =>
                          setFrameH(
                            Math.max(1, Math.min(srcH, Number(e.target.value) || 1))
                          )
                        }
                      />
                    </label>
                  </div>

                  <div className="rotate3d-stack-note">
                    Grid: {sheetCols}×{sheetRows} →{" "}
                    <strong>{detectedFrameCount}</strong> frame
                    {detectedFrameCount === 1 ? "" : "s"}
                  </div>

                  <label className="modal-checkbox">
                    <input
                      type="checkbox"
                      checked={skipEmpty}
                      onChange={(e) => setSkipEmpty(e.target.checked)}
                    />
                    <span>Skip Empty Frames</span>
                  </label>

                  <label className="modal-checkbox">
                    <input
                      type="checkbox"
                      checked={extractPal}
                      onChange={(e) => setExtractPal(e.target.checked)}
                    />
                    <span>Extract Palette</span>
                  </label>
                </>
              )}
            </div>
          </div>

          <div className="modal-footer">
            <button
              type="button"
              className="mini-btn"
              onClick={() => setPending(null)}
            >
              Cancel
            </button>
            <button
              type="button"
              className="export-cta"
              onClick={handleImport}
            >
              <span>
                {mode === "layer"
                  ? "Add Layer"
                  : mode === "spritesheet"
                    ? `Import ${detectedFrameCount} Frames`
                    : "Open Sprite"}
              </span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

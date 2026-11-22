import { useEffect, useMemo, useRef, useState } from "react";
import { Image as ImageIcon, Layers, LayoutGrid, Plus, Trash2, X } from "lucide-react";
import { pixelEngine } from "../engine/document/PixelEngine";
import { commitFloatingSelection } from "../engine/document/selectionActions";
import { syncTimelineCels } from "../engine/document/timelineActions";
import {
  extractPaletteFromBuffer,
  placeBufferCentered,
  resizePixelBufferNearest,
  sliceSpritesheet,
} from "../engine/io/imageImport";
import {
  type FrameItem,
  type LayerItem,
  useEditorStore,
} from "../store/editorStore";

type ImportMode = "sprite" | "layer" | "spritesheet";

interface SheetLayerDef {
  id: string;
  name: string;
  cellIndices: number[];
  color: string;
}

const SHEET_LAYER_COLORS = [
  "#5b8cff",
  "#ef6461",
  "#4ecd82",
  "#fbc531",
  "#bd6bed",
  "#45d6e0",
];

function summarizeCells(indices: readonly number[]): string {
  if (indices.length === 0) return "0f";
  if (indices.length === 1) return `#${indices[0] + 1}`;
  const isContiguous = indices.every(
    (v, i) => i === 0 || v === indices[i - 1] + 1
  );
  if (isContiguous) {
    return `${indices.length}f: #${indices[0] + 1}–${indices[indices.length - 1] + 1}`;
  }
  return `${indices.length}f: #${indices
    .slice(0, 3)
    .map((v) => v + 1)
    .join(",")}${indices.length > 3 ? "…" : ""}`;
}

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

  const [selectedCells, setSelectedCells] = useState<Set<number>>(new Set());
  const [lastClickedCell, setLastClickedCell] = useState<number | null>(null);
  const [sheetLayers, setSheetLayers] = useState<SheetLayerDef[]>([]);
  const layerSeqRef = useRef(1);

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
    setSelectedCells(new Set());
    setLastClickedCell(null);
    setSheetLayers([]);
    layerSeqRef.current = 1;
  }, [pending, canvasWidth, canvasHeight]);

  // Reset cell selection & sheet layers when slice frame dimensions change
  useEffect(() => {
    setSelectedCells(new Set());
    setLastClickedCell(null);
    setSheetLayers([]);
  }, [frameW, frameH]);

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

  const safeFrameW = pending
    ? Math.max(1, Math.min(pending.buffer.width, Math.round(frameW) || 1))
    : 1;
  const safeFrameH = pending
    ? Math.max(1, Math.min(pending.buffer.height, Math.round(frameH) || 1))
    : 1;
  const sheetCols = pending
    ? Math.max(1, Math.floor(pending.buffer.width / safeFrameW))
    : 1;
  const sheetRows = pending
    ? Math.max(1, Math.floor(pending.buffer.height / safeFrameH))
    : 1;

  const allGridCells = useMemo(() => {
    if (!pending || mode !== "spritesheet") return [];
    return sliceSpritesheet(pending.buffer, safeFrameW, safeFrameH, false);
  }, [pending, mode, safeFrameW, safeFrameH]);

  const cellEmptyFlags = useMemo(
    () => allGridCells.map((c) => c.isEmpty()),
    [allGridCells]
  );

  const cellAssignedColor = useMemo(() => {
    const map = new Map<number, string>();
    for (const sl of sheetLayers) {
      for (const idx of sl.cellIndices) {
        map.set(idx, sl.color);
      }
    }
    return map;
  }, [sheetLayers]);

  const detectedFrameCount = useMemo(() => {
    if (!pending || mode !== "spritesheet") return 0;
    if (sheetLayers.length > 0) {
      return Math.max(1, ...sheetLayers.map((l) => l.cellIndices.length));
    }
    if (selectedCells.size > 0) {
      return selectedCells.size;
    }
    return sliceSpritesheet(pending.buffer, safeFrameW, safeFrameH, skipEmpty)
      .length;
  }, [
    pending,
    mode,
    safeFrameW,
    safeFrameH,
    skipEmpty,
    sheetLayers,
    selectedCells,
  ]);

  if (!pending) return null;

  const srcW = pending.buffer.width;
  const srcH = pending.buffer.height;
  const baseName = pending.name.replace(/\.[^.]+$/, "") || "imported";

  const previewScale = Math.min(240 / srcW, 240 / srcH);
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

  const handleCellClick = (idx: number, shiftKey: boolean) => {
    setSelectedCells((prev) => {
      const next = new Set(prev);
      if (shiftKey && lastClickedCell !== null) {
        const lo = Math.min(lastClickedCell, idx);
        const hi = Math.max(lastClickedCell, idx);
        for (let i = lo; i <= hi; i++) {
          next.add(i);
        }
      } else if (next.has(idx)) {
        next.delete(idx);
      } else {
        next.add(idx);
      }
      return next;
    });
    setLastClickedCell(idx);
  };

  const selectAllCells = () => {
    const next = new Set<number>();
    for (let i = 0; i < allGridCells.length; i++) next.add(i);
    setSelectedCells(next);
  };

  const selectNonEmptyCells = () => {
    const next = new Set<number>();
    for (let i = 0; i < cellEmptyFlags.length; i++) {
      if (!cellEmptyFlags[i]) next.add(i);
    }
    setSelectedCells(next);
  };

  const createLayerFromSelection = () => {
    if (selectedCells.size === 0) return;
    const sorted = Array.from(selectedCells).sort((a, b) => a - b);
    const seq = layerSeqRef.current++;
    setSheetLayers((prev) => [
      ...prev,
      {
        id: `sl-${seq}`,
        name: `Layer ${seq}`,
        cellIndices: sorted,
        color: SHEET_LAYER_COLORS[(seq - 1) % SHEET_LAYER_COLORS.length],
      },
    ]);
    setSelectedCells(new Set());
  };

  const splitSelectionToLayers = () => {
    if (selectedCells.size === 0) return;
    const sorted = Array.from(selectedCells).sort((a, b) => a - b);
    const additions: SheetLayerDef[] = sorted.map((cellIdx) => {
      const seq = layerSeqRef.current++;
      return {
        id: `sl-${seq}`,
        name: `Part ${seq} (#${cellIdx + 1})`,
        cellIndices: [cellIdx],
        color: SHEET_LAYER_COLORS[(seq - 1) % SHEET_LAYER_COLORS.length],
      };
    });
    setSheetLayers((prev) => [...prev, ...additions]);
    setSelectedCells(new Set());
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
      const fw = safeFrameW;
      const fh = safeFrameH;
      const extracted = extractPal
        ? extractPaletteFromBuffer(pending.buffer, 32)
        : [];
      const dur = Math.round(1000 / state.fps);

      if (sheetLayers.length > 0) {
        const maxFrames = Math.max(
          1,
          ...sheetLayers.map((l) => l.cellIndices.length)
        );
        pixelEngine.resetForDocument(fw, fh);

        const nextLayers: LayerItem[] = sheetLayers.map((sl, li) => {
          const layerId = `layer-sheet-${li + 1}`;
          const celsMap: Record<number, boolean> = {};
          for (let fi = 0; fi < sl.cellIndices.length; fi++) {
            const cellBuf = allGridCells[sl.cellIndices[fi]];
            if (!cellBuf) continue;
            const cel = pixelEngine.getOrCreateCel(layerId, fi);
            cel.data.set(cellBuf.data);
            cel.markAllDirty();
            celsMap[fi] = !cel.isEmpty();
          }
          return {
            id: layerId,
            name: sl.name.trim() || `Layer ${li + 1}`,
            kind: "raster",
            visible: true,
            locked: false,
            opacity: 100,
            alphaLock: false,
            blendMode: "Normal",
            parentId: null,
            cels: celsMap,
          };
        });

        const nextFrames: FrameItem[] = Array.from(
          { length: maxFrames },
          (_, i) => ({
            id: `frame-imp-${i + 1}`,
            index: i,
            durationMs: dur,
          })
        );

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
          layers: nextLayers,
          frames: nextFrames,
          tags: [],
        });
        state.setZoom(
          Math.max(1, Math.min(16, Math.floor(384 / Math.max(fw, fh))))
        );
        syncTimelineCels();
        pixelEngine.emitChange();
        state.setStatusMessage(
          `Imported ${nextLayers.length} layers (${maxFrames} frames, ${fw}×${fh})`
        );
        setPending(null);
        return;
      }

      // Single-layer import: either selected cells or full auto-slice
      const sliced =
        selectedCells.size > 0
          ? Array.from(selectedCells)
              .sort((a, b) => a - b)
              .map((idx) => allGridCells[idx])
              .filter(Boolean)
          : sliceSpritesheet(pending.buffer, fw, fh, skipEmpty);

      pixelEngine.resetForDocument(fw, fh);
      const celsMap: Record<number, boolean> = {};
      const nextFrames: FrameItem[] = [];

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
                    className="import-slice-svg interactive"
                    viewBox={`0 0 ${srcW} ${srcH}`}
                    preserveAspectRatio="none"
                  >
                    {Array.from({ length: sheetRows }, (_, row) =>
                      Array.from({ length: sheetCols }, (_, col) => {
                        const idx = row * sheetCols + col;
                        const isSelected = selectedCells.has(idx);
                        const isEmpty = cellEmptyFlags[idx] ?? false;
                        const assignedColor = cellAssignedColor.get(idx);
                        return (
                          <rect
                            key={`cell-${idx}`}
                            x={col * safeFrameW}
                            y={row * safeFrameH}
                            width={safeFrameW}
                            height={safeFrameH}
                            className={`import-slice-cell ${isSelected ? "selected" : ""} ${isEmpty ? "empty" : ""}`}
                            style={
                              isSelected
                                ? undefined
                                : assignedColor
                                  ? {
                                      fill: assignedColor,
                                      fillOpacity: 0.24,
                                      stroke: assignedColor,
                                    }
                                  : undefined
                            }
                            onClick={(e) => handleCellClick(idx, e.shiftKey)}
                          >
                            <title>
                              Frame #{idx + 1} ({col + 1}, {row + 1})
                              {isEmpty ? " [empty]" : ""} — Click or Shift+Click
                            </title>
                          </rect>
                        );
                      })
                    )}
                  </svg>
                )}
              </div>
              <span className="rotate3d-hint">
                {mode === "spritesheet"
                  ? "Click / Shift+Click frames to group into layers"
                  : `Source: ${srcW}×${srcH} px`}
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

                  <div className="import-select-bar">
                    <span className="rotate3d-hint">
                      {sheetCols}×{sheetRows} ({selectedCells.size} sel)
                    </span>
                    <div style={{ display: "flex", gap: 4 }}>
                      <button
                        type="button"
                        className="mini-btn"
                        onClick={selectAllCells}
                      >
                        All
                      </button>
                      <button
                        type="button"
                        className="mini-btn"
                        onClick={selectNonEmptyCells}
                      >
                        Non-Empty
                      </button>
                      {selectedCells.size > 0 && (
                        <button
                          type="button"
                          className="mini-btn"
                          onClick={() => setSelectedCells(new Set())}
                        >
                          Clear
                        </button>
                      )}
                    </div>
                  </div>

                  {selectedCells.size > 0 && (
                    <div className="import-layer-creators">
                      <button
                        type="button"
                        className="mini-btn active"
                        onClick={createLayerFromSelection}
                      >
                        <Plus size={11} />
                        <span>Layer ({selectedCells.size}f)</span>
                      </button>
                      <button
                        type="button"
                        className="mini-btn"
                        title="Create one separate layer per selected cell"
                        onClick={splitSelectionToLayers}
                      >
                        <Layers size={11} />
                        <span>Split to {selectedCells.size} Layers</span>
                      </button>
                    </div>
                  )}

                  {sheetLayers.length > 0 && (
                    <div className="import-sheet-layers">
                      {sheetLayers.map((sl) => (
                        <div key={sl.id} className="import-sheet-layer-row">
                          <span
                            className="rig-influence-swatch"
                            style={{ backgroundColor: sl.color }}
                          />
                          <input
                            className="rig-text-input"
                            style={{ minWidth: 0 }}
                            value={sl.name}
                            onChange={(e) =>
                              setSheetLayers((prev) =>
                                prev.map((item) =>
                                  item.id === sl.id
                                    ? { ...item, name: e.target.value }
                                    : item
                                )
                              )
                            }
                          />
                          <span className="import-sheet-summary">
                            {summarizeCells(sl.cellIndices)}
                          </span>
                          <button
                            type="button"
                            className="icon-action-btn"
                            style={{ width: 18, height: 18 }}
                            title="Remove layer group"
                            onClick={() =>
                              setSheetLayers((prev) =>
                                prev.filter((item) => item.id !== sl.id)
                              )
                            }
                          >
                            <Trash2 size={11} />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}

                  {sheetLayers.length === 0 && (
                    <label className="modal-checkbox">
                      <input
                        type="checkbox"
                        checked={skipEmpty}
                        onChange={(e) => setSkipEmpty(e.target.checked)}
                      />
                      <span>Skip Empty Frames</span>
                    </label>
                  )}

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
                    ? sheetLayers.length > 0
                      ? `Import ${sheetLayers.length} Layers (${detectedFrameCount}f)`
                      : `Import ${detectedFrameCount} Frames`
                    : "Open Sprite"}
              </span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

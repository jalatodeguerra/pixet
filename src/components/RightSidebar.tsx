import { useEffect, useRef, useState } from "react";
import {
  ArrowDown,
  ArrowLeftRight,
  ArrowUp,
  ChevronDown,
  ChevronRight,
  Copy,
  Eye,
  EyeOff,
  Folder,
  FolderPlus,
  Grid2x2,
  GripVertical,
  Lock,
  Plus,
  Trash2,
  Unlock,
  Upload,
} from "lucide-react";
import { GameDataPanel } from "./GameDataPanel";
import { RigPanel } from "./RigPanel";
import { TilesetPanel } from "./TilesetPanel";
import { PixelBuffer } from "../engine/document/PixelBuffer";
import { pixelEngine } from "../engine/document/PixelEngine";
import { renderIsometricTilemapToBuffer } from "../engine/tiles/isometric";
import { renderTilemapToBuffer } from "../engine/tiles/TilemapEngine";
import {
  copySelection,
  copySelectionToNewLayer,
  cutSelection,
  cutSelectionToNewLayer,
  pasteClipboard,
} from "../engine/document/selectionActions";
import {
  BlendMode,
  getLayerDepth,
  isLayerHiddenByCollapsedGroup,
  useEditorStore,
} from "../store/editorStore";
import {
  buildShadingRamp,
  hexToHsv,
  hsvToHex,
  isValidHex,
} from "../utils/color";
import { PALETTE_PRESETS, parsePaletteFile } from "../utils/paletteParser";

const BLEND_MODES: BlendMode[] = [
  "Normal",
  "Multiply",
  "Screen",
  "Overlay",
  "Add",
];

function LayerThumbnail({
  layerId,
  layerKind,
  frameIndex,
  canvasWidth,
  canvasHeight,
  tilesetVersion,
  tileProjection,
}: {
  layerId: string;
  layerKind: string;
  frameIndex: number;
  canvasWidth: number;
  canvasHeight: number;
  tilesetVersion: number;
  tileProjection: "orthogonal" | "isometric";
}) {
  const thumbRef = useRef<HTMLCanvasElement>(null);
  const scratchRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const drawThumb = () => {
      const thumb = thumbRef.current;
      if (!thumb) return;
      const tctx = thumb.getContext("2d");
      if (!tctx) return;
      tctx.clearRect(0, 0, thumb.width, thumb.height);

      let buf: PixelBuffer | undefined;
      if (layerKind === "tilemap") {
        const tm = pixelEngine.getTilemap(layerId, frameIndex);
        if (tm) {
          buf = new PixelBuffer(pixelEngine.width, pixelEngine.height);
          if (tileProjection === "isometric") {
            renderIsometricTilemapToBuffer(
              tm,
              pixelEngine.tileset,
              buf.data,
              buf.width,
              buf.height,
              1,
              "Normal"
            );
          } else {
            renderTilemapToBuffer(
              tm,
              pixelEngine.tileset,
              buf.data,
              buf.width,
              buf.height,
              1,
              "Normal"
            );
          }
        }
      } else {
        buf = pixelEngine.getCel(layerId, frameIndex);
      }

      if (!buf || buf.isEmpty()) return;

      if (!scratchRef.current) {
        scratchRef.current = document.createElement("canvas");
      }
      const scratch = scratchRef.current;
      scratch.width = buf.width;
      scratch.height = buf.height;
      const sctx = scratch.getContext("2d");
      if (!sctx) return;

      sctx.putImageData(
        new ImageData(
          new Uint8ClampedArray(buf.data),
          buf.width,
          buf.height
        ),
        0,
        0
      );

      const scale = Math.min(thumb.width / buf.width, thumb.height / buf.height);
      const dw = Math.max(1, Math.round(buf.width * scale));
      const dh = Math.max(1, Math.round(buf.height * scale));
      const dx = Math.floor((thumb.width - dw) / 2);
      const dy = Math.floor((thumb.height - dh) / 2);
      tctx.imageSmoothingEnabled = false;
      tctx.drawImage(scratch, dx, dy, dw, dh);
    };

    drawThumb();
    return pixelEngine.subscribe(drawThumb);
  }, [
    layerId,
    layerKind,
    frameIndex,
    canvasWidth,
    canvasHeight,
    tilesetVersion,
    tileProjection,
  ]);

  return (
    <span className="layer-thumb-wrap">
      <canvas
        ref={thumbRef}
        width={22}
        height={22}
        className="layer-thumb-canvas"
      />
    </span>
  );
}

export function RightSidebar() {
  const rightPanelWidth = useEditorStore((s) => s.rightPanelWidth);
  const workspaceMode = useEditorStore((s) => s.workspaceMode);

  const canvasWidth = useEditorStore((s) => s.canvasWidth);
  const canvasHeight = useEditorStore((s) => s.canvasHeight);
  const currentFrame = useEditorStore((s) => s.currentFrame);
  const tilesetVersion = useEditorStore((s) => s.tilesetVersion);
  const tileProjection = useEditorStore((s) => s.tileProjection);

  const primaryColor = useEditorStore((s) => s.primaryColor);
  const secondaryColor = useEditorStore((s) => s.secondaryColor);
  const setPrimaryColor = useEditorStore((s) => s.setPrimaryColor);
  const setSecondaryColor = useEditorStore((s) => s.setSecondaryColor);
  const swapColors = useEditorStore((s) => s.swapColors);
  const palette = useEditorStore((s) => s.palette);
  const paletteName = useEditorStore((s) => s.paletteName);
  const setPalette = useEditorStore((s) => s.setPalette);
  const addColorToPalette = useEditorStore((s) => s.addColorToPalette);
  const setStatusMessage = useEditorStore((s) => s.setStatusMessage);

  const layers = useEditorStore((s) => s.layers);
  const activeLayerId = useEditorStore((s) => s.activeLayerId);
  const selectedLayerIds = useEditorStore((s) => s.selectedLayerIds);
  const selectLayer = useEditorStore((s) => s.selectLayer);
  const selectLayerRange = useEditorStore((s) => s.selectLayerRange);
  const toggleSelectLayer = useEditorStore((s) => s.toggleSelectLayer);
  const groupSelectedLayers = useEditorStore((s) => s.groupSelectedLayers);
  const ungroupLayer = useEditorStore((s) => s.ungroupLayer);
  const toggleLayerVisible = useEditorStore((s) => s.toggleLayerVisible);
  const toggleLayerLocked = useEditorStore((s) => s.toggleLayerLocked);
  const setLayerOpacity = useEditorStore((s) => s.setLayerOpacity);
  const setLayerBlendMode = useEditorStore((s) => s.setLayerBlendMode);
  const addLayer = useEditorStore((s) => s.addLayer);
  const addGroupLayer = useEditorStore((s) => s.addGroupLayer);
  const addTilemapLayer = useEditorStore((s) => s.addTilemapLayer);
  const deleteActiveLayer = useEditorStore((s) => s.deleteActiveLayer);
  const renameLayer = useEditorStore((s) => s.renameLayer);
  const duplicateActiveLayer = useEditorStore((s) => s.duplicateActiveLayer);
  const moveLayer = useEditorStore((s) => s.moveLayer);
  const toggleGroupExpanded = useEditorStore((s) => s.toggleGroupExpanded);
  const setLayerParent = useEditorStore((s) => s.setLayerParent);
  const openContextMenu = useEditorStore((s) => s.openContextMenu);

  const [colorOpen, setColorOpen] = useState(true);
  const [layersOpen, setLayersOpen] = useState(true);
  const [hexInput, setHexInput] = useState(primaryColor);
  const [editingLayerId, setEditingLayerId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState("");
  const [draggedLayerId, setDraggedLayerId] = useState<string | null>(null);
  const [layerDropTarget, setLayerDropTarget] = useState<{
    id: string;
    pos: "before" | "after" | "inside";
  } | null>(null);

  const paletteFileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setHexInput(primaryColor);
  }, [primaryColor]);

  const activeLayer =
    layers.find((l) => l.id === activeLayerId) ?? layers[0];
  const activeLayerIdx = layers.findIndex((l) => l.id === activeLayerId);
  const shadingRamp = buildShadingRamp(primaryColor);
  const hsv = hexToHsv(primaryColor);

  const handleHexChange = (val: string) => {
    const normalized = val.startsWith("#") ? val : `#${val}`;
    setHexInput(normalized);
    if (isValidHex(normalized)) {
      setPrimaryColor(normalized.toLowerCase());
    }
  };

  const handlePaletteImport = async (
    e: React.ChangeEvent<HTMLInputElement>
  ) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    const content = await file.text();
    const parsed = parsePaletteFile(file.name, content);
    if (parsed.colors.length === 0) {
      setStatusMessage(`No valid colors found in ${file.name}`);
      return;
    }
    setPalette(parsed.name, parsed.colors);
    setStatusMessage(
      `Imported "${parsed.name}" (${parsed.colors.length} colors)`
    );
  };

  const handleDuplicateLayer = () => {
    const res = duplicateActiveLayer();
    if (res) {
      pixelEngine.duplicateLayerCels(res.sourceId, res.newId);
    }
  };

  const commitRename = () => {
    if (editingLayerId) {
      renameLayer(editingLayerId, editingName);
      setEditingLayerId(null);
    }
  };

  const isPresetMatch = PALETTE_PRESETS.some((p) => p.name === paletteName);

  return (
    <aside
      className="right-sidebar"
      style={{ width: rightPanelWidth }}
      aria-label="Inspector Sidebar"
    >
      {/* Tileset Inspector in Tiles Mode */}
      {workspaceMode === "tiles" && <TilesetPanel />}

      {/* 2D Rig Inspector in Rig Mode */}
      {workspaceMode === "rig" && <RigPanel />}

      {/* Game Data Inspector in Data Mode */}
      {workspaceMode === "data" && <GameDataPanel />}

      {/* Color & Palette */}
      <section className="panel-section">
        <div className="panel-header">
          <button
            type="button"
            className="panel-collapse-btn"
            onClick={() => setColorOpen((v) => !v)}
          >
            {colorOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
            <span>Color &amp; Palette</span>
          </button>
          <span
            className="mono-value"
            style={{ fontSize: 10, color: "var(--text-muted)" }}
          >
            {palette.length} Swatches
          </span>
        </div>
        {colorOpen && <div className="panel-body">
          <div className="color-top-row">
            <div className="fg-bg-stack">
              <div
                className="swatch-bg"
                style={{ backgroundColor: secondaryColor }}
                title="Background Color"
              >
                <input
                  type="color"
                  className="swatch-native-input"
                  value={secondaryColor}
                  aria-label="Background Color"
                  onChange={(e) => setSecondaryColor(e.target.value)}
                />
              </div>
              <div
                className="swatch-fg"
                style={{ backgroundColor: primaryColor }}
                title="Foreground Color"
              >
                <input
                  type="color"
                  className="swatch-native-input"
                  value={primaryColor}
                  aria-label="Foreground Color"
                  onChange={(e) => setPrimaryColor(e.target.value)}
                />
              </div>
              <button
                type="button"
                className="swap-colors-btn"
                title="Swap FG / BG (X)"
                onClick={swapColors}
              >
                <ArrowLeftRight size={10} />
              </button>
            </div>

            <div className="color-meta">
              <div className="hex-row">
                <span style={{ color: "var(--text-muted)", fontSize: 10 }}>
                  HEX
                </span>
                <input
                  type="text"
                  className="hex-input"
                  value={hexInput}
                  maxLength={7}
                  aria-label="Primary Hex Color"
                  onChange={(e) => handleHexChange(e.target.value)}
                />
              </div>
              <div className="shading-ramp" title="Hue-shifted shading ramp">
                {shadingRamp.map((stepHex, i) => (
                  <button
                    key={`${stepHex}-${i}`}
                    type="button"
                    className="ramp-step"
                    style={{ backgroundColor: stepHex }}
                    title={`Ramp ${i + 1}: ${stepHex}`}
                    onClick={() => setPrimaryColor(stepHex)}
                  />
                ))}
              </div>
            </div>
          </div>

          <div className="hsv-sliders">
            <label className="hsv-row">
              <span className="hsv-label">H</span>
              <input
                type="range"
                className="hsv-range"
                min={0}
                max={359}
                value={hsv.h}
                onChange={(e) =>
                  setPrimaryColor(
                    hsvToHex(Number(e.target.value), hsv.s, hsv.v)
                  )
                }
              />
              <span className="hsv-val">{hsv.h}°</span>
            </label>
            <label className="hsv-row">
              <span className="hsv-label">S</span>
              <input
                type="range"
                className="hsv-range"
                min={0}
                max={100}
                value={hsv.s}
                onChange={(e) =>
                  setPrimaryColor(
                    hsvToHex(hsv.h, Number(e.target.value), hsv.v)
                  )
                }
              />
              <span className="hsv-val">{hsv.s}%</span>
            </label>
            <label className="hsv-row">
              <span className="hsv-label">V</span>
              <input
                type="range"
                className="hsv-range"
                min={0}
                max={100}
                value={hsv.v}
                onChange={(e) =>
                  setPrimaryColor(
                    hsvToHex(hsv.h, hsv.s, Number(e.target.value))
                  )
                }
              />
              <span className="hsv-val">{hsv.v}%</span>
            </label>
          </div>

          <div className="palette-toolbar">
            <select
              className="palette-select"
              aria-label="Palette Preset"
              value={paletteName}
              onChange={(e) => {
                const preset = PALETTE_PRESETS.find(
                  (p) => p.name === e.target.value
                );
                if (preset) setPalette(preset.name, preset.colors);
              }}
            >
              {!isPresetMatch && (
                <option value={paletteName}>{paletteName}</option>
              )}
              {PALETTE_PRESETS.map((p) => (
                <option key={p.name} value={p.name}>
                  {p.name}
                </option>
              ))}
            </select>

            <input
              ref={paletteFileRef}
              type="file"
              accept=".hex,.gpl,.txt"
              style={{ display: "none" }}
              onChange={handlePaletteImport}
            />
            <button
              type="button"
              className="icon-action-btn"
              style={{ width: 22, height: 22 }}
              title="Import .hex / .gpl Palette"
              onClick={() => paletteFileRef.current?.click()}
            >
              <Upload size={12} />
            </button>
            <button
              type="button"
              className="icon-action-btn"
              style={{ width: 22, height: 22 }}
              title="Add Current Color to Palette"
              onClick={() => addColorToPalette(primaryColor)}
            >
              <Plus size={12} />
            </button>
          </div>

          <div
            className="palette-grid"
            title="Left-click: FG · Right-click: BG"
          >
            {palette.map((swatch) => {
              const active =
                swatch.toLowerCase() === primaryColor.toLowerCase();
              return (
                <button
                  key={swatch}
                  type="button"
                  className={`palette-swatch ${active ? "active" : ""}`}
                  style={{ backgroundColor: swatch }}
                  title={swatch}
                  onClick={() => setPrimaryColor(swatch)}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    setSecondaryColor(swatch);
                  }}
                />
              );
            })}
          </div>
        </div>}
      </section>

      {/* Layers */}
      <section
        className="panel-section"
        style={layersOpen ? { flex: 1, borderBottom: "none" } : undefined}
      >
        <div className="panel-header">
          <button
            type="button"
            className="panel-collapse-btn"
            onClick={() => setLayersOpen((v) => !v)}
          >
            {layersOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
            <span>Layers</span>
          </button>
          <div className="panel-header-actions">
            <button
              type="button"
              className="icon-action-btn"
              style={{ width: 22, height: 22 }}
              title="New Layer"
              onClick={addLayer}
            >
              <Plus size={13} />
            </button>
            <button
              type="button"
              className="icon-action-btn"
              style={{ width: 22, height: 22 }}
              title="New Layer Group"
              onClick={addGroupLayer}
            >
              <FolderPlus size={13} />
            </button>
            <button
              type="button"
              className="icon-action-btn"
              style={{ width: 22, height: 22 }}
              title="New Tilemap Layer"
              onClick={addTilemapLayer}
            >
              <Grid2x2 size={12} />
            </button>
            <button
              type="button"
              className="icon-action-btn"
              style={{ width: 22, height: 22 }}
              title="Duplicate Active Layer"
              onClick={handleDuplicateLayer}
            >
              <Copy size={12} />
            </button>
            <button
              type="button"
              className="icon-action-btn"
              style={{ width: 22, height: 22 }}
              title="Move Layer Up"
              disabled={activeLayerIdx <= 0}
              onClick={() => moveLayer(activeLayerIdx, activeLayerIdx - 1)}
            >
              <ArrowUp size={12} />
            </button>
            <button
              type="button"
              className="icon-action-btn"
              style={{ width: 22, height: 22 }}
              title="Move Layer Down"
              disabled={
                activeLayerIdx < 0 || activeLayerIdx >= layers.length - 1
              }
              onClick={() => moveLayer(activeLayerIdx, activeLayerIdx + 1)}
            >
              <ArrowDown size={12} />
            </button>
            <button
              type="button"
              className="icon-action-btn"
              style={{ width: 22, height: 22 }}
              title="Delete Active Layer"
              disabled={layers.length <= 1}
              onClick={deleteActiveLayer}
            >
              <Trash2 size={12} />
            </button>
          </div>
        </div>

        {layersOpen && <div className="panel-body">
          {activeLayer && (
            <div className="layers-controls">
              <select
                className="blend-select"
                aria-label="Layer Blend Mode"
                value={activeLayer.blendMode}
                onChange={(e) =>
                  setLayerBlendMode(activeLayer.id, e.target.value as BlendMode)
                }
              >
                {BLEND_MODES.map((mode) => (
                  <option key={mode} value={mode}>
                    {mode}
                  </option>
                ))}
              </select>

              <label className="option-label">
                <input
                  type="range"
                  className="compact-range"
                  style={{ width: 66 }}
                  min={0}
                  max={100}
                  value={activeLayer.opacity}
                  onChange={(e) =>
                    setLayerOpacity(activeLayer.id, Number(e.target.value))
                  }
                />
                <span
                  className="mono-value"
                  style={{ width: 32, textAlign: "right" }}
                >
                  {activeLayer.opacity}%
                </span>
              </label>
            </div>
          )}

          <div className="layers-list">
            {layers.map((layer, index) => {
              if (isLayerHiddenByCollapsedGroup(layers, layer)) {
                return null;
              }
              const active = layer.id === activeLayerId;
              const isSelected = selectedLayerIds.includes(layer.id);
              const depth = getLayerDepth(layers, layer);
              const isEditing = editingLayerId === layer.id;
              const dropPos =
                layerDropTarget?.id === layer.id &&
                draggedLayerId !== layer.id
                  ? layerDropTarget.pos
                  : null;
              const dropClass = dropPos ? `drag-over-${dropPos}` : "";
              const isDraggingThis = draggedLayerId === layer.id;

              return (
                <div
                  key={layer.id}
                  draggable={!isEditing}
                  className={`layer-row ${isSelected ? "selected" : ""} ${active ? "active" : ""} ${isDraggingThis ? "dragging" : ""} ${dropClass}`}
                  style={{ paddingLeft: 5 + depth * 14 }}
                  onClick={(e) => {
                    if (e.shiftKey) {
                      selectLayerRange(layer.id);
                    } else if (e.ctrlKey || e.metaKey) {
                      toggleSelectLayer(layer.id);
                    } else {
                      selectLayer(layer.id);
                    }
                  }}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    const targetIds = selectedLayerIds.includes(layer.id)
                      ? selectedLayerIds
                      : [layer.id];
                    if (!selectedLayerIds.includes(layer.id)) {
                      selectLayer(layer.id);
                    }
                    const hasNestedTarget = targetIds.some((id) =>
                      Boolean(layers.find((l) => l.id === id)?.parentId)
                    );
                    const hasClip = Boolean(pixelEngine.clipboard);
                    openContextMenu(e.clientX, e.clientY, [
                      { kind: "item", label: "New Layer", action: () => addLayer() },
                      { kind: "item", label: "New Group", action: () => addGroupLayer() },
                      {
                        kind: "item",
                        label:
                          targetIds.length > 1
                            ? `Group Selected (${targetIds.length})`
                            : "Group Layer",
                        action: () => groupSelectedLayers(targetIds),
                      },
                      ...(hasNestedTarget
                        ? [
                            {
                              kind: "item" as const,
                              label: "Remove from Group",
                              action: () => {
                                for (const id of targetIds) {
                                  setLayerParent(id, null);
                                }
                              },
                            },
                          ]
                        : []),
                      ...(layer.kind === "group"
                        ? [
                            {
                              kind: "item" as const,
                              label: "Ungroup",
                              action: () => ungroupLayer(layer.id),
                            },
                          ]
                        : []),
                      { kind: "item", label: "New Tilemap Layer", action: () => addTilemapLayer() },
                      { kind: "separator" },
                      { kind: "item", label: "Duplicate Layer", action: () => handleDuplicateLayer() },
                      {
                        kind: "item",
                        label: "Rename Layer",
                        action: () => {
                          setEditingLayerId(layer.id);
                          setEditingName(layer.name);
                        },
                      },
                      { kind: "separator" },
                      { kind: "item", label: "Cut", shortcut: "Ctrl+X", action: () => { cutSelection(); } },
                      { kind: "item", label: "Copy", shortcut: "Ctrl+C", action: () => { copySelection(); } },
                      { kind: "item", label: "Paste", shortcut: "Ctrl+V", disabled: !hasClip, action: () => { pasteClipboard(); } },
                      { kind: "item", label: "Cut to New Layer", shortcut: "Ctrl+Shift+X", action: () => { cutSelectionToNewLayer(); } },
                      { kind: "item", label: "Copy to New Layer", shortcut: "Ctrl+J", action: () => { copySelectionToNewLayer(); } },
                      { kind: "separator" },
                      {
                        kind: "item",
                        label: "Move Up",
                        disabled: index <= 0,
                        action: () => moveLayer(index, index - 1),
                      },
                      {
                        kind: "item",
                        label: "Move Down",
                        disabled: index >= layers.length - 1,
                        action: () => moveLayer(index, index + 1),
                      },
                      {
                        kind: "item",
                        label: layer.visible ? "Hide Layer" : "Show Layer",
                        action: () => toggleLayerVisible(layer.id),
                      },
                      {
                        kind: "item",
                        label: layer.locked ? "Unlock Layer" : "Lock Layer",
                        action: () => toggleLayerLocked(layer.id),
                      },
                      { kind: "separator" },
                      {
                        kind: "item",
                        label: "Delete Layer",
                        disabled: layers.length <= 1,
                        danger: true,
                        action: () => deleteActiveLayer(),
                      },
                    ]);
                  }}
                  onDragStart={(e) => {
                    e.dataTransfer.setData("text/plain", layer.id);
                    e.dataTransfer.effectAllowed = "move";
                    setDraggedLayerId(layer.id);
                  }}
                  onDragOver={(e) => {
                    e.preventDefault();
                    e.dataTransfer.dropEffect = "move";
                    const rect = e.currentTarget.getBoundingClientRect();
                    const ratio =
                      (e.clientY - rect.top) / Math.max(1, rect.height);
                    let pos: "before" | "after" | "inside";
                    if (layer.kind === "group") {
                      pos =
                        ratio < 0.28
                          ? "before"
                          : ratio > 0.72
                            ? "after"
                            : "inside";
                    } else {
                      pos = ratio < 0.5 ? "before" : "after";
                    }
                    setLayerDropTarget({ id: layer.id, pos });
                  }}
                  onDragLeave={(e) => {
                    if (
                      !e.currentTarget.contains(e.relatedTarget as Node | null) &&
                      layerDropTarget?.id === layer.id
                    ) {
                      setLayerDropTarget(null);
                    }
                  }}
                  onDrop={(e) => {
                    e.preventDefault();
                    const pos = layerDropTarget?.pos ?? "before";
                    setLayerDropTarget(null);
                    const sourceId =
                      draggedLayerId || e.dataTransfer.getData("text/plain");
                    setDraggedLayerId(null);
                    if (!sourceId || sourceId === layer.id) return;

                    const fromIdx = layers.findIndex((l) => l.id === sourceId);
                    if (fromIdx < 0) return;

                    if (pos === "inside" && layer.kind === "group") {
                      setLayerParent(sourceId, layer.id);
                    } else {
                      setLayerParent(sourceId, layer.parentId);
                    }

                    const rawTo =
                      pos === "before"
                        ? fromIdx < index
                          ? index - 1
                          : index
                        : fromIdx < index
                          ? index
                          : index + 1;
                    const toIdx = Math.max(0, Math.min(layers.length - 1, rawTo));
                    moveLayer(fromIdx, toIdx);
                  }}
                  onDragEnd={() => {
                    setDraggedLayerId(null);
                    setLayerDropTarget(null);
                  }}
                >
                  <GripVertical size={11} className="layer-drag-handle" />
                  <button
                    type="button"
                    className="icon-action-btn"
                    style={{ width: 20, height: 20 }}
                    title={layer.visible ? "Hide Layer" : "Show Layer"}
                    onClick={(e) => {
                      e.stopPropagation();
                      toggleLayerVisible(layer.id);
                    }}
                  >
                    {layer.visible ? <Eye size={13} /> : <EyeOff size={13} />}
                  </button>

                  {layer.kind === "group" && (
                    <>
                      <button
                        type="button"
                        className="icon-action-btn"
                        style={{ width: 16, height: 16 }}
                        title="Expand / Collapse Group"
                        onClick={(e) => {
                          e.stopPropagation();
                          toggleGroupExpanded(layer.id);
                        }}
                      >
                        {layer.expanded === false ? (
                          <ChevronRight size={12} />
                        ) : (
                          <ChevronDown size={12} />
                        )}
                      </button>
                      <Folder size={13} color="var(--text-secondary)" />
                    </>
                  )}

                  {layer.kind === "tilemap" && (
                    <Grid2x2 size={12} color="var(--accent)" />
                  )}

                  {layer.kind !== "group" && (
                    <LayerThumbnail
                      layerId={layer.id}
                      layerKind={layer.kind}
                      frameIndex={currentFrame}
                      canvasWidth={canvasWidth}
                      canvasHeight={canvasHeight}
                      tilesetVersion={tilesetVersion}
                      tileProjection={tileProjection}
                    />
                  )}

                  {isEditing ? (
                    <input
                      type="text"
                      className="layer-rename-input"
                      autoFocus
                      value={editingName}
                      onClick={(e) => e.stopPropagation()}
                      onChange={(e) => setEditingName(e.target.value)}
                      onBlur={commitRename}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") commitRename();
                        if (e.key === "Escape") setEditingLayerId(null);
                      }}
                    />
                  ) : (
                    <span
                      className="layer-name"
                      title="Double-click to rename"
                      onDoubleClick={(e) => {
                        e.stopPropagation();
                        setEditingLayerId(layer.id);
                        setEditingName(layer.name);
                      }}
                    >
                      {layer.name}
                    </span>
                  )}

                  {layer.blendMode !== "Normal" && (
                    <span className="layer-meta-badge">
                      {layer.blendMode.slice(0, 3)}
                    </span>
                  )}

                  <button
                    type="button"
                    className={`icon-action-btn ${layer.locked ? "active" : ""}`}
                    style={{ width: 20, height: 20 }}
                    title={layer.locked ? "Unlock Layer" : "Lock Layer"}
                    onClick={(e) => {
                      e.stopPropagation();
                      toggleLayerLocked(layer.id);
                    }}
                  >
                    {layer.locked ? <Lock size={12} /> : <Unlock size={12} />}
                  </button>
                </div>
              );
            })}
          </div>
        </div>}
      </section>
    </aside>
  );
}

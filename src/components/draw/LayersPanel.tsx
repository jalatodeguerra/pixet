import { useEffect, useRef, useState } from "react";
import {
  ArrowDown,
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
} from "lucide-react";
import { PixelBuffer } from "../../engine/document/PixelBuffer";
import { pixelEngine } from "../../engine/document/PixelEngine";
import { renderIsometricTilemapToBuffer } from "../../engine/tiles/isometric";
import { renderTilemapToBuffer } from "../../engine/tiles/TilemapEngine";
import {
  copySelection,
  copySelectionToNewLayer,
  cutSelection,
  cutSelectionToNewLayer,
  pasteClipboard,
} from "../../engine/document/selectionActions";
import {
  BlendMode,
  getLayerDepth,
  isLayerHiddenByCollapsedGroup,
  useEditorStore,
} from "../../store/editorStore";

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

export function LayersPanel() {
  const canvasWidth = useEditorStore((s) => s.canvasWidth);
  const canvasHeight = useEditorStore((s) => s.canvasHeight);
  const currentFrame = useEditorStore((s) => s.currentFrame);
  const tilesetVersion = useEditorStore((s) => s.tilesetVersion);
  const tileProjection = useEditorStore((s) => s.tileProjection);

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
  const toggleLayerAlphaLock = useEditorStore((s) => s.toggleLayerAlphaLock);
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
  const setLayerMapRole = useEditorStore((s) => s.setLayerMapRole);
  const openContextMenu = useEditorStore((s) => s.openContextMenu);

  const [layersOpen, setLayersOpen] = useState(true);
  const [editingLayerId, setEditingLayerId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState("");
  const [draggedLayerId, setDraggedLayerId] = useState<string | null>(null);
  const [layerDropTarget, setLayerDropTarget] = useState<{
    id: string;
    pos: "before" | "after" | "inside";
  } | null>(null);

  const activeLayer =
    layers.find((l) => l.id === activeLayerId) ?? layers[0];
  const activeLayerIdx = layers.findIndex((l) => l.id === activeLayerId);

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

  return (
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

      {layersOpen && (
        <div className="panel-body">
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

              {activeLayer.kind === "raster" && (
                <button
                  type="button"
                  className={`toggle-chip ${activeLayer.alphaLock ? "active" : ""}`}
                  style={{ padding: "2px 6px" }}
                  title="Lock Layer Alpha (only paint on existing non-transparent pixels)"
                  onClick={() => toggleLayerAlphaLock(activeLayer.id)}
                >
                  α
                </button>
              )}
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
                      ...(layer.kind === "raster"
                        ? [
                            { kind: "separator" as const },
                            {
                              kind: "item" as const,
                              label: "Role: Albedo",
                              action: () => setLayerMapRole(layer.id, "albedo"),
                            },
                            {
                              kind: "item" as const,
                              label: "Role: Normal Map",
                              action: () => setLayerMapRole(layer.id, "normal"),
                            },
                            {
                              kind: "item" as const,
                              label: "Role: Emission Map",
                              action: () =>
                                setLayerMapRole(layer.id, "emission"),
                            },
                            {
                              kind: "item" as const,
                              label: layer.alphaLock
                                ? "Unlock Alpha"
                                : "Lock Alpha",
                              action: () => toggleLayerAlphaLock(layer.id),
                            },
                          ]
                        : []),
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

                  {layer.mapRole === "normal" && (
                    <span className="layer-role-badge normal" title="Normal Map">
                      N
                    </span>
                  )}
                  {layer.mapRole === "emission" && (
                    <span
                      className="layer-role-badge emission"
                      title="Emission Map"
                    >
                      E
                    </span>
                  )}

                  {layer.alphaLock && (
                    <span className="layer-meta-badge" title="Alpha Locked">
                      α
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
        </div>
      )}
    </section>
  );
}

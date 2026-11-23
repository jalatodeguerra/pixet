import { useEffect, useRef, useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  Copy,
  Eraser,
  Grid2x2,
  PanelBottom,
  PanelRight,
  Plus,
  Scissors,
  Trash2,
  Upload,
} from "lucide-react";
import { syncHistoryAndCelState } from "../../engine/document/historyActions";
import { pixelEngine } from "../../engine/document/PixelEngine";
import { packCell } from "../../engine/tiles/cell";
import {
  createEmptyPeering,
  getActivePeeringIndices,
} from "../../engine/tiles/terrain";
import {
  computeUsageOrder,
  findUnusedTiles,
  sliceLayerToTilemap,
} from "../../engine/tiles/tileAuthoring";
import { Tileset } from "../../engine/tiles/Tileset";
import { useEditorStore } from "../../store/editorStore";
import { DockablePanelSection } from "../DockablePanelSection";

// 3x3 cell index -> peering bit index (-1 = center)
const GRID_TO_PEERING_BIT = [7, 0, 1, 6, -1, 2, 5, 4, 3] as const;

function TileThumbnail({
  tilesetIndex,
  tileId,
  tileWidth,
  tileHeight,
  scale,
  tilesetVersion,
}: {
  tilesetIndex: number;
  tileId: number;
  tileWidth: number;
  tileHeight: number;
  scale: number;
  tilesetVersion: number;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctx.clearRect(0, 0, tileWidth, tileHeight);
    const ts = pixelEngine.tilesetRegistry.get(tilesetIndex);
    const tileBuf = ts?.getTile(tileId);
    if (!tileBuf) return;

    const img = new ImageData(
      new Uint8ClampedArray(tileBuf.data),
      tileBuf.width,
      tileBuf.height
    );
    ctx.putImageData(img, 0, 0);
  }, [tilesetIndex, tileId, tileWidth, tileHeight, tilesetVersion]);

  return (
    <canvas
      ref={canvasRef}
      width={tileWidth}
      height={tileHeight}
      className="tileset-thumb-canvas"
      style={{
        width: tileWidth * scale,
        height: tileHeight * scale,
      }}
    />
  );
}

export function TilesetBrowserPanel({ docked = false }: { docked?: boolean }) {
  const activeTileId = useEditorStore((s) => s.activeTileId);
  const setActiveTileId = useEditorStore((s) => s.setActiveTileId);
  const activeTilesetIndex = useEditorStore((s) => s.activeTilesetIndex);
  const setActiveTilesetIndex = useEditorStore((s) => s.setActiveTilesetIndex);
  const setTileSize = useEditorStore((s) => s.setTileSize);
  const tilesetVersion = useEditorStore((s) => s.tilesetVersion);
  const bumpTilesetVersion = useEditorStore((s) => s.bumpTilesetVersion);
  const addTilemapLayer = useEditorStore((s) => s.addTilemapLayer);
  const setTileTool = useEditorStore((s) => s.setTileTool);
  const setStatusMessage = useEditorStore((s) => s.setStatusMessage);
  const tilesetBrowserZoom = useEditorStore((s) => s.tilesetBrowserZoom);
  const setTilesetBrowserZoom = useEditorStore((s) => s.setTilesetBrowserZoom);
  const tilesetBrowserDocked = useEditorStore((s) => s.tilesetBrowserDocked);
  const toggleTilesetBrowserDocked = useEditorStore(
    (s) => s.toggleTilesetBrowserDocked
  );
  const tileBrush = useEditorStore((s) => s.tileBrush);
  const setTileBrush = useEditorStore((s) => s.setTileBrush);
  const terrainEditMode = useEditorStore((s) => s.terrainEditMode);
  const activeTerrainSetId = useEditorStore((s) => s.activeTerrainSetId);
  const activeTerrainId = useEditorStore((s) => s.activeTerrainId);
  const tileSearchQuery = useEditorStore((s) => s.tileSearchQuery);
  const setTileSearchQuery = useEditorStore((s) => s.setTileSearchQuery);
  const setTileImportModalOpen = useEditorStore((s) => s.setTileImportModalOpen);
  const activeLayerId = useEditorStore((s) => s.activeLayerId);
  const currentFrame = useEditorStore((s) => s.currentFrame);

  const [collapsed, setCollapsed] = useState(false);
  const [draggedTileId, setDraggedTileId] = useState<number | null>(null);
  const [anchorTileId, setAnchorTileId] = useState<number | null>(null);
  const gridRef = useRef<HTMLDivElement>(null);

  void tilesetVersion;
  const tilesets = pixelEngine.tilesetRegistry.tilesets;
  const ts =
    pixelEngine.tilesetRegistry.get(activeTilesetIndex) ??
    pixelEngine.tileset;
  const safeTsIndex = pixelEngine.tilesetRegistry.get(activeTilesetIndex)
    ? activeTilesetIndex
    : 0;
  const tileCount = ts.count;
  const tileIds = Array.from({ length: tileCount }, (_, i) => i + 1);
  const tileW = ts.tileWidth;
  const tileH = ts.tileHeight;

  const colsPerRow = docked ? 12 : Math.max(3, Math.floor(210 / (tileW * tilesetBrowserZoom + 4)));

  const handleAddTileset = () => {
    const idx = pixelEngine.recordTilesetOp("Add Tileset", () => {
      const next = new Tileset(
        `tileset-${Date.now().toString(36)}`,
        `Tileset ${pixelEngine.tilesetRegistry.tilesets.length + 1}`,
        tileW,
        tileH
      );
      next.addTile();
      return pixelEngine.tilesetRegistry.add(next);
    });
    setActiveTilesetIndex(idx);
    setActiveTileId(1);
    bumpTilesetVersion();
    syncHistoryAndCelState();
    pixelEngine.emitChange();
  };

  const handleAddTile = () => {
    const newId = pixelEngine.recordTilesetOp("Add Tile", () => ts.addTile());
    setActiveTileId(newId);
    setTileBrush(null);
    bumpTilesetVersion();
    syncHistoryAndCelState();
    pixelEngine.emitChange();
  };

  const handleDuplicateTile = () => {
    const newId = pixelEngine.recordTilesetOp("Duplicate Tile", () =>
      ts.duplicateTile(activeTileId)
    );
    if (newId !== null) {
      setActiveTileId(newId);
      setTileBrush(null);
      bumpTilesetVersion();
      syncHistoryAndCelState();
      pixelEngine.emitChange();
    }
  };

  const handleDeleteTile = () => {
    if (activeTileId <= 0 || tileCount <= 1) return;
    const deleted = pixelEngine.recordTilesetOp("Delete Tile", () =>
      pixelEngine.deleteTileFromTileset(activeTileId, safeTsIndex)
    );
    if (deleted) {
      const nextId = Math.min(activeTileId, ts.count);
      setActiveTileId(nextId);
      setTileBrush(null);
      bumpTilesetVersion();
      syncHistoryAndCelState();
    }
  };

  const handleResizeTileset = (newW: number, newH: number) => {
    const w = Math.max(4, Math.min(64, Math.round(newW)));
    const h = Math.max(4, Math.min(64, Math.round(newH)));
    pixelEngine.recordTilesetOp("Resize Tileset", () => {
      if (safeTsIndex === 0) {
        pixelEngine.resizeTileset(w, h);
      } else {
        ts.resizeTiles(w, h);
      }
    });
    if (safeTsIndex === 0) {
      setTileSize(w, h);
    }
    bumpTilesetVersion();
    syncHistoryAndCelState();
  };

  const handleSliceActiveLayer = () => {
    const cel = pixelEngine.getCel(activeLayerId, currentFrame);
    if (!cel) {
      setStatusMessage("Select a populated raster layer to slice into tiles");
      return;
    }
    const nextIdx = pixelEngine.tilesetRegistry.tilesets.length;
    const sliced = sliceLayerToTilemap(
      cel,
      { tileWidth: tileW, tileHeight: tileH, dedupe: true, dedupeFlips: true },
      nextIdx,
      `tileset-${Date.now().toString(36)}`,
      `Sliced ${tileW}×${tileH}`
    );
    if (sliced.uniqueTiles === 0) {
      setStatusMessage("Active layer is empty");
      return;
    }
    pixelEngine.recordTilesetOp("Slice Layer to Tileset", () => {
      pixelEngine.tilesetRegistry.add(sliced.tileset);
    });
    addTilemapLayer();
    const newLayerId = useEditorStore.getState().activeLayerId;
    pixelEngine.tilemaps.set(`${newLayerId}:${currentFrame}`, sliced.tilemap);
    setActiveTilesetIndex(nextIdx);
    setActiveTileId(1);
    bumpTilesetVersion();
    syncHistoryAndCelState(newLayerId, currentFrame);
    pixelEngine.emitChange();
    setStatusMessage(
      `${sliced.uniqueTiles} unique tiles from ${sliced.totalCells} cells`
    );
  };

  const handleDedupeTiles = () => {
    const merged = pixelEngine.recordTilesetOp("Dedupe Tiles", () =>
      pixelEngine.mergeDuplicateTilesInTileset(safeTsIndex)
    );
    bumpTilesetVersion();
    syncHistoryAndCelState();
    setStatusMessage(
      merged > 0 ? `Merged ${merged} duplicate tiles` : "No duplicate tiles"
    );
  };

  const handleSortByUsage = () => {
    const order = computeUsageOrder(ts, safeTsIndex, pixelEngine.tilemaps.values());
    const ok = pixelEngine.recordTilesetOp("Sort Tiles by Usage", () =>
      pixelEngine.reorderTilesInTileset(order, safeTsIndex)
    );
    if (ok) {
      setActiveTileId(1);
      bumpTilesetVersion();
      syncHistoryAndCelState();
      setStatusMessage("Sorted tiles by map usage");
    }
  };

  const handleSwatchClick = (id: number, shiftKey: boolean) => {
    if (shiftKey && anchorTileId && anchorTileId > 0 && id > 0) {
      const aIdx = anchorTileId - 1;
      const bIdx = id - 1;
      const aCol = aIdx % colsPerRow;
      const aRow = Math.floor(aIdx / colsPerRow);
      const bCol = bIdx % colsPerRow;
      const bRow = Math.floor(bIdx / colsPerRow);
      const minC = Math.min(aCol, bCol);
      const maxC = Math.max(aCol, bCol);
      const minR = Math.min(aRow, bRow);
      const maxR = Math.max(aRow, bRow);
      const cols = maxC - minC + 1;
      const rows = maxR - minR + 1;
      const cells: number[] = [];
      for (let r = minR; r <= maxR; r++) {
        for (let c = minC; c <= maxC; c++) {
          const tid = r * colsPerRow + c + 1;
          cells.push(tid <= tileCount ? packCell(safeTsIndex, tid) : 0);
        }
      }
      setActiveTileId(id);
      setTileBrush({ tilesetIndex: safeTsIndex, cols, rows, cells });
      setTileTool("stamp");
      return;
    }

    setAnchorTileId(id);
    setActiveTileId(id);
    setTileBrush(null);
    setTileTool("stamp");
  };

  const handleReorderDrop = (targetId: number) => {
    if (
      draggedTileId === null ||
      draggedTileId === targetId ||
      draggedTileId <= 0 ||
      targetId <= 0
    ) {
      setDraggedTileId(null);
      return;
    }
    const order = tileIds.filter((id) => id !== draggedTileId);
    const insertAt = order.indexOf(targetId);
    order.splice(insertAt >= 0 ? insertAt : order.length, 0, draggedTileId);

    const ok = pixelEngine.recordTilesetOp("Reorder Tiles", () =>
      pixelEngine.reorderTilesInTileset(order, safeTsIndex)
    );
    setDraggedTileId(null);
    if (ok) {
      const newSelected = order.indexOf(draggedTileId) + 1;
      setActiveTileId(newSelected > 0 ? newSelected : 1);
      setTileBrush(null);
      bumpTilesetVersion();
      syncHistoryAndCelState();
    }
  };

  const handleGridKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (
      e.key !== "ArrowLeft" &&
      e.key !== "ArrowRight" &&
      e.key !== "ArrowUp" &&
      e.key !== "ArrowDown"
    ) {
      return;
    }
    e.preventDefault();
    const cur = Math.max(1, activeTileId);
    let next = cur;
    if (e.key === "ArrowLeft") next = Math.max(1, cur - 1);
    if (e.key === "ArrowRight") next = Math.min(tileCount, cur + 1);
    if (e.key === "ArrowUp") next = Math.max(1, cur - colsPerRow);
    if (e.key === "ArrowDown") next = Math.min(tileCount, cur + colsPerRow);
    setActiveTileId(next);
    setAnchorTileId(next);
    setTileBrush(null);
  };

  const brushSelectedIds = new Set<number>();
  if (tileBrush && tileBrush.tilesetIndex === safeTsIndex) {
    for (const c of tileBrush.cells) {
      if (c > 0) brushSelectedIds.add(c & 0x000fffff);
    }
  }

  const activeTerrainSet = terrainEditMode
    ? (pixelEngine.terrainSets.find((s) => s.id === activeTerrainSetId) ??
      pixelEngine.terrainSets[0] ??
      null)
    : null;
  const showPeeringOverlay =
    terrainEditMode &&
    activeTerrainSet !== null &&
    activeTerrainSet.tilesetIndex === safeTsIndex;
  const editingTerrainId =
    activeTerrainId ?? activeTerrainSet?.terrains[0]?.id ?? null;
  const activePeeringSet = activeTerrainSet
    ? new Set(getActivePeeringIndices(activeTerrainSet.mode))
    : null;

  const togglePeeringBit = (tileId: number, bitIdx: number) => {
    if (!activeTerrainSet || !editingTerrainId || bitIdx < 0) return;
    pixelEngine.recordTilesetOp("Edit Terrain Peering", () => {
      const cur = activeTerrainSet.peering[tileId] ?? createEmptyPeering();
      const next = [...cur] as typeof cur;
      next[bitIdx] = next[bitIdx] === editingTerrainId ? null : editingTerrainId;
      activeTerrainSet.peering[tileId] = next;
    });
    bumpTilesetVersion();
    syncHistoryAndCelState();
  };

  const unusedCount = findUnusedTiles(
    ts,
    safeTsIndex,
    pixelEngine.tilemaps.values()
  ).length;

  const query = tileSearchQuery.trim().toLowerCase();
  const visibleTileIds = query
    ? tileIds.filter((id) => {
        if (String(id) === query) return true;
        const m = ts.getMeta(id);
        if (m?.name?.toLowerCase().includes(query)) return true;
        return m?.tags?.some((t) => t.toLowerCase().includes(query)) ?? false;
      })
    : tileIds;

  const headerActions = (
    <>
      <select
        className="palette-select"
        style={{ width: 62, padding: "1px 4px", fontSize: 10 }}
        aria-label="Tile Size Preset"
        value={`${tileW}x${tileH}`}
        onChange={(e) => {
          const [w, h] = e.target.value.split("x").map(Number);
          if (w && h) handleResizeTileset(w, h);
        }}
      >
        <option value="8x8">8×8</option>
        <option value="16x16">16×16</option>
        <option value="16x24">16×24</option>
        <option value="32x32">32×32</option>
        {!["8x8", "16x16", "16x24", "32x32"].includes(`${tileW}x${tileH}`) && (
          <option value={`${tileW}x${tileH}`}>{tileW}×{tileH}</option>
        )}
      </select>
      <button
        type="button"
        className="mini-btn"
        style={{ padding: "1px 5px", fontSize: 10 }}
        title="Cycle Browser Zoom (1x–4x)"
        onClick={() =>
          setTilesetBrowserZoom(
            tilesetBrowserZoom >= 4 ? 1 : tilesetBrowserZoom + 1
          )
        }
      >
        {tilesetBrowserZoom}×
      </button>
      <button
        type="button"
        className={`icon-action-btn ${tilesetBrowserDocked ? "active" : ""}`}
        style={{ width: 22, height: 22 }}
        title={
          tilesetBrowserDocked
            ? "Dock Tileset in Sidebar"
            : "Dock Tileset at Bottom"
        }
        onClick={toggleTilesetBrowserDocked}
      >
        {tilesetBrowserDocked ? (
          <PanelRight size={12} />
        ) : (
          <PanelBottom size={12} />
        )}
      </button>
      <button
        type="button"
        className="icon-action-btn"
        style={{ width: 22, height: 22 }}
        title="New Tilemap Layer"
        onClick={() => {
          addTilemapLayer();
          setTileTool("stamp");
          setStatusMessage("Created Tilemap layer · Stamp tiles with T");
        }}
      >
        <Grid2x2 size={12} />
      </button>
      <button
        type="button"
        className="icon-action-btn"
        style={{ width: 22, height: 22 }}
        title="Add Empty Tile"
        onClick={handleAddTile}
      >
        <Plus size={13} />
      </button>
      <button
        type="button"
        className="icon-action-btn"
        style={{ width: 22, height: 22 }}
        title="Duplicate Selected Tile"
        disabled={activeTileId <= 0}
        onClick={handleDuplicateTile}
      >
        <Copy size={12} />
      </button>
      <button
        type="button"
        className="icon-action-btn"
        style={{ width: 22, height: 22 }}
        title="Delete Selected Tile"
        disabled={activeTileId <= 0 || tileCount <= 1}
        onClick={handleDeleteTile}
      >
        <Trash2 size={12} />
      </button>
    </>
  );

  const browserBody = (
    <>
          <div className="tiles-tabs-row">
            {tilesets.map((set, idx) => (
              <button
                key={set.id}
                type="button"
                className={`tiles-tab ${idx === safeTsIndex ? "active" : ""}`}
                onClick={() => {
                  setActiveTilesetIndex(idx);
                  setActiveTileId(1);
                }}
              >
                {set.name}
              </button>
            ))}
            <button
              type="button"
              className="tiles-tab"
              title="New Tileset"
              onClick={handleAddTileset}
            >
              +
            </button>
          </div>

          <div className="tiles-search-row">
            <input
              type="text"
              className="tiles-text-input"
              placeholder="Filter name / tag / #id..."
              value={tileSearchQuery}
              onChange={(e) => setTileSearchQuery(e.target.value)}
            />
            <button
              type="button"
              className="mini-btn"
              style={{ fontSize: 10 }}
              title="Import Tileset PNG"
              onClick={() => setTileImportModalOpen(true)}
            >
              <Upload size={10} />
            </button>
            <button
              type="button"
              className="mini-btn"
              style={{ fontSize: 10 }}
              title="Slice Active Raster Layer into Tileset + Tilemap"
              onClick={handleSliceActiveLayer}
            >
              <Scissors size={10} />
            </button>
          </div>

          <div className="tileset-controls-row" style={{ marginBottom: 6 }}>
            <button
              type="button"
              className="mini-btn"
              style={{ fontSize: 10 }}
              onClick={handleDedupeTiles}
            >
              Dedupe
            </button>
            <button
              type="button"
              className="mini-btn"
              style={{ fontSize: 10 }}
              onClick={handleSortByUsage}
            >
              Sort Used
            </button>
            <span
              className="mono-value"
              style={{ marginLeft: "auto", fontSize: 10, color: "var(--text-muted)" }}
            >
              Unused: {unusedCount}
            </span>
          </div>

          <div
            ref={gridRef}
            tabIndex={0}
            onKeyDown={handleGridKeyDown}
            className={`tileset-grid ${docked ? "tiles-grid-docked" : ""}`}
            style={{
              gridTemplateColumns: docked
                ? `repeat(auto-fill, minmax(${tileW * tilesetBrowserZoom + 6}px, 1fr))`
                : `repeat(auto-fill, minmax(${tileW * tilesetBrowserZoom + 6}px, 1fr))`,
            }}
          >
            <button
              type="button"
              className={`tileset-swatch ${activeTileId === 0 ? "active" : ""}`}
              style={{
                width: tileW * tilesetBrowserZoom + 6,
                height: tileH * tilesetBrowserZoom + 6,
              }}
              title="Tile 0: Empty / Erase Cell"
              onClick={() => {
                setActiveTileId(0);
                setTileBrush(null);
                setTileTool("eraser");
              }}
            >
              <Eraser size={14} color="var(--text-muted)" />
            </button>

            {visibleTileIds.map((id) => {
              const isSelected =
                activeTileId === id || brushSelectedIds.has(id);
              return (
                <button
                  key={id}
                  type="button"
                  draggable
                  onDragStart={() => setDraggedTileId(id)}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={() => handleReorderDrop(id)}
                  className={`tileset-swatch ${isSelected ? "active" : ""}`}
                  style={{
                    width: tileW * tilesetBrowserZoom + 6,
                    height: tileH * tilesetBrowserZoom + 6,
                  }}
                  title={`Tile #${id}${ts.getMeta(id)?.name ? ` · ${ts.getMeta(id)?.name}` : ""} (Shift+Click multi-select, drag to reorder)`}
                  onClick={(e) => handleSwatchClick(id, e.shiftKey)}
                >
                  <TileThumbnail
                    tilesetIndex={safeTsIndex}
                    tileId={id}
                    tileWidth={tileW}
                    tileHeight={tileH}
                    scale={tilesetBrowserZoom}
                    tilesetVersion={tilesetVersion}
                  />
                  {showPeeringOverlay && activeTerrainSet && activePeeringSet && (
                    <div
                      className="tiles-peering-grid"
                      onClick={(e) => e.stopPropagation()}
                    >
                      {GRID_TO_PEERING_BIT.map((bitIdx, cellIdx) => {
                        const idx: number = bitIdx;
                        if (idx < 0 || !activePeeringSet.has(idx)) {
                          return <span key={cellIdx} className="tiles-peering-empty" />;
                        }
                        const tid = activeTerrainSet.peering[id]?.[idx] ?? null;
                        const tColor = tid
                          ? activeTerrainSet.terrains.find((t) => t.id === tid)?.color
                          : undefined;
                        return (
                          <span
                            key={cellIdx}
                            className="tiles-peering-cell"
                            style={{
                              backgroundColor: tColor ?? "transparent",
                            }}
                            onClick={(e) => {
                              e.stopPropagation();
                              togglePeeringBit(id, idx);
                            }}
                          />
                        );
                      })}
                    </div>
                  )}
                  <span className="tileset-id-badge">{id}</span>
                </button>
              );
            })}
          </div>
    </>
  );

  if (!docked) {
    return (
      <DockablePanelSection
        id="tiles-browser"
        title={`Tileset (${tileCount})`}
        actions={headerActions}
      >
        {browserBody}
      </DockablePanelSection>
    );
  }

  return (
    <section className="panel-section">
      <div className="panel-header">
        <button
          type="button"
          className="panel-collapse-btn"
          onClick={() => setCollapsed((v) => !v)}
        >
          {collapsed ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
          <span>Tileset ({tileCount})</span>
        </button>
        <div className="panel-header-actions">{headerActions}</div>
      </div>
      {!collapsed && <div className="panel-body">{browserBody}</div>}
    </section>
  );
}

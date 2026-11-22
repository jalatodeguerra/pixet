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
  Trash2,
} from "lucide-react";
import { syncHistoryAndCelState } from "../../engine/document/historyActions";
import { pixelEngine } from "../../engine/document/PixelEngine";
import { packCell } from "../../engine/tiles/cell";
import { Tileset } from "../../engine/tiles/Tileset";
import { useEditorStore } from "../../store/editorStore";

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

  const handleResizeTileset = (size: number) => {
    pixelEngine.recordTilesetOp("Resize Tileset", () => {
      if (safeTsIndex === 0) {
        pixelEngine.resizeTileset(size, size);
      } else {
        ts.resizeTiles(size, size);
      }
    });
    if (safeTsIndex === 0) {
      setTileSize(size, size);
    }
    bumpTilesetVersion();
    syncHistoryAndCelState();
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
        <div className="panel-header-actions">
          <select
            className="palette-select"
            style={{ width: 56, padding: "1px 4px", fontSize: 10 }}
            aria-label="Tile Size"
            value={tileW}
            onChange={(e) => handleResizeTileset(Number(e.target.value))}
          >
            <option value={8}>8×8</option>
            <option value={16}>16×16</option>
            <option value={32}>32×32</option>
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
        </div>
      </div>

      {!collapsed && (
        <div className="panel-body">
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

            {tileIds.map((id) => {
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
                  <span className="tileset-id-badge">{id}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </section>
  );
}

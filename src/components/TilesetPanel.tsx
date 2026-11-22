import { useEffect, useRef } from "react";
import { Copy, Eraser, Grid2x2, Plus, Sparkles, Trash2 } from "lucide-react";
import { pixelEngine } from "../engine/document/PixelEngine";
import type { AutoTileMode } from "../engine/tiles/autoTile";
import { useEditorStore } from "../store/editorStore";

function TileThumbnail({
  tileId,
  tileWidth,
  tileHeight,
  tilesetVersion,
}: {
  tileId: number;
  tileWidth: number;
  tileHeight: number;
  tilesetVersion: number;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctx.clearRect(0, 0, tileWidth, tileHeight);
    const tileBuf = pixelEngine.tileset.getTile(tileId);
    if (!tileBuf) return;

    const img = new ImageData(
      new Uint8ClampedArray(tileBuf.data),
      tileBuf.width,
      tileBuf.height
    );
    ctx.putImageData(img, 0, 0);
  }, [tileId, tileWidth, tileHeight, tilesetVersion]);

  return (
    <canvas
      ref={canvasRef}
      width={tileWidth}
      height={tileHeight}
      className="tileset-thumb-canvas"
    />
  );
}

export function TilesetPanel() {
  const activeTileId = useEditorStore((s) => s.activeTileId);
  const setActiveTileId = useEditorStore((s) => s.setActiveTileId);
  const tileWidth = useEditorStore((s) => s.tileWidth);
  const tileHeight = useEditorStore((s) => s.tileHeight);
  const setTileSize = useEditorStore((s) => s.setTileSize);
  const tilesetVersion = useEditorStore((s) => s.tilesetVersion);
  const bumpTilesetVersion = useEditorStore((s) => s.bumpTilesetVersion);
  const addTilemapLayer = useEditorStore((s) => s.addTilemapLayer);
  const setActiveTool = useEditorStore((s) => s.setActiveTool);
  const setStatusMessage = useEditorStore((s) => s.setStatusMessage);
  const autoTileEnabled = useEditorStore((s) => s.autoTileEnabled);
  const toggleAutoTile = useEditorStore((s) => s.toggleAutoTile);
  const setAutoTileEnabled = useEditorStore((s) => s.setAutoTileEnabled);
  const autoTileMode = useEditorStore((s) => s.autoTileMode);
  const setAutoTileMode = useEditorStore((s) => s.setAutoTileMode);
  const tileProjection = useEditorStore((s) => s.tileProjection);
  const setTileProjection = useEditorStore((s) => s.setTileProjection);
  const showIsoGrid = useEditorStore((s) => s.showIsoGrid);
  const toggleShowIsoGrid = useEditorStore((s) => s.toggleShowIsoGrid);

  const tileCount = pixelEngine.tileset.count;
  const tileIds = Array.from({ length: tileCount }, (_, i) => i + 1);

  const handleAddTile = () => {
    const newId = pixelEngine.tileset.addTile();
    setActiveTileId(newId);
    bumpTilesetVersion();
    pixelEngine.emitChange();
  };

  const handleDuplicateTile = () => {
    const newId = pixelEngine.tileset.duplicateTile(activeTileId);
    if (newId !== null) {
      setActiveTileId(newId);
      bumpTilesetVersion();
      pixelEngine.emitChange();
    }
  };

  const handleDeleteTile = () => {
    if (activeTileId <= 0 || tileCount <= 1) return;
    if (pixelEngine.deleteTileFromTileset(activeTileId)) {
      const nextId = Math.min(activeTileId, pixelEngine.tileset.count);
      setActiveTileId(nextId);
      bumpTilesetVersion();
    }
  };

  const handleResizeTileset = (size: number) => {
    pixelEngine.resizeTileset(size, size);
    setTileSize(size, size);
    bumpTilesetVersion();
  };

  const handleGenerateAutoTile = () => {
    const ruleset = pixelEngine.generateAutoTileTerrain();
    setActiveTileId(ruleset.fallbackTileId);
    setAutoTileEnabled(true);
    bumpTilesetVersion();
    setActiveTool("tileStamp");
    setStatusMessage("Generated 16-tile auto-tile set · Stamp on a Tilemap layer");
  };

  const handleToggleAutoTile = () => {
    if (!autoTileEnabled && !pixelEngine.autoTileRuleset) {
      handleGenerateAutoTile();
      return;
    }
    toggleAutoTile();
  };

  const handleProjectionChange = (proj: "orthogonal" | "isometric") => {
    pixelEngine.setTileProjection(proj);
    setTileProjection(proj);
    if (proj === "isometric" && !showIsoGrid) {
      toggleShowIsoGrid();
    }
  };

  return (
    <section className="panel-section">
      <div className="panel-header">
        <span>Tileset ({tileCount})</span>
        <div className="panel-header-actions">
          <select
            className="palette-select"
            style={{ width: 62, padding: "1px 4px", fontSize: 10 }}
            aria-label="Tile Size"
            value={tileWidth}
            onChange={(e) => handleResizeTileset(Number(e.target.value))}
          >
            <option value={8}>8×8</option>
            <option value={16}>16×16</option>
            <option value={32}>32×32</option>
          </select>
          <button
            type="button"
            className="icon-action-btn"
            style={{ width: 22, height: 22 }}
            title="New Tilemap Layer"
            onClick={() => {
              addTilemapLayer();
              setActiveTool("tileStamp");
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

      <div className="panel-body">
        <div className="tileset-grid">
          <button
            type="button"
            className={`tileset-swatch ${activeTileId === 0 ? "active" : ""}`}
            title="Tile 0: Empty / Erase Cell"
            onClick={() => {
              setActiveTileId(0);
              setActiveTool("tileStamp");
            }}
          >
            <Eraser size={14} color="var(--text-muted)" />
          </button>

          {tileIds.map((id) => (
            <button
              key={id}
              type="button"
              className={`tileset-swatch ${activeTileId === id ? "active" : ""}`}
              title={`Tile #${id}`}
              onClick={() => {
                setActiveTileId(id);
                setActiveTool("tileStamp");
              }}
            >
              <TileThumbnail
                tileId={id}
                tileWidth={tileWidth}
                tileHeight={tileHeight}
                tilesetVersion={tilesetVersion}
              />
              <span className="tileset-id-badge">{id}</span>
            </button>
          ))}
        </div>

        <div className="tileset-controls-row">
          <button
            type="button"
            className={`toggle-chip ${autoTileEnabled ? "active" : ""}`}
            onClick={handleToggleAutoTile}
            title="Enable neighbor-aware auto-tile stamping"
          >
            <span>Auto-Tile</span>
          </button>
          <select
            className="palette-select"
            style={{ fontSize: 10, padding: "2px 4px" }}
            aria-label="Auto-Tile Mode"
            value={autoTileMode}
            onChange={(e) => setAutoTileMode(e.target.value as AutoTileMode)}
          >
            <option value="4bit">16-Tile</option>
            <option value="blob47">47-Blob</option>
          </select>
          <button
            type="button"
            className="toggle-chip"
            onClick={handleGenerateAutoTile}
            title="Generate 16 bordered terrain tiles and bind ruleset"
          >
            <Sparkles size={11} />
            <span>Gen 16-Tile</span>
          </button>
        </div>

        <div className="tileset-controls-row">
          <span style={{ color: "var(--text-muted)", fontSize: 10 }}>
            Projection
          </span>
          <div style={{ display: "flex", gap: 4 }}>
            <button
              type="button"
              className={`toggle-chip ${tileProjection === "orthogonal" ? "active" : ""}`}
              style={{ padding: "2px 7px", fontSize: 10 }}
              onClick={() => handleProjectionChange("orthogonal")}
            >
              Ortho
            </button>
            <button
              type="button"
              className={`toggle-chip ${tileProjection === "isometric" ? "active" : ""}`}
              style={{ padding: "2px 7px", fontSize: 10 }}
              onClick={() => handleProjectionChange("isometric")}
            >
              Iso 2:1
            </button>
          </div>
        </div>

        <div className="mode-hint">
          Stamp tiles with <code>T</code>, or paint with Pencil <code>B</code> on
          a Tilemap layer to live-edit all instances.
        </div>
      </div>
    </section>
  );
}

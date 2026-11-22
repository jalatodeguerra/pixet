import { useState } from "react";
import { ChevronDown, ChevronRight, FlipHorizontal2, FlipVertical2, RotateCw } from "lucide-react";
import { pixelEngine } from "../../engine/document/PixelEngine";
import { packCell, rotateCellCW, unpackCell } from "../../engine/tiles/cell";
import { useEditorStore } from "../../store/editorStore";

export function TilePropertiesPanel() {
  const activeTileId = useEditorStore((s) => s.activeTileId);
  const activeTilesetIndex = useEditorStore((s) => s.activeTilesetIndex);
  const tilesetVersion = useEditorStore((s) => s.tilesetVersion);
  const bumpTilesetVersion = useEditorStore((s) => s.bumpTilesetVersion);
  const tileBrushFlags = useEditorStore((s) => s.tileBrushFlags);
  const setTileBrushFlags = useEditorStore((s) => s.setTileBrushFlags);
  const [collapsed, setCollapsed] = useState(false);

  void tilesetVersion;
  const ts =
    pixelEngine.tilesetRegistry.get(activeTilesetIndex) ??
    pixelEngine.tileset;
  const meta = activeTileId > 0 ? ts.getMeta(activeTileId) : undefined;

  const rotateFlagsCW = () => {
    const packed = packCell(0, 1, tileBrushFlags);
    const rotated = unpackCell(rotateCellCW(packed));
    setTileBrushFlags({
      flipH: rotated.flipH,
      flipV: rotated.flipV,
      flipD: rotated.flipD,
    });
  };

  return (
    <section className="panel-section">
      <div className="panel-header">
        <button
          type="button"
          className="panel-collapse-btn"
          onClick={() => setCollapsed((v) => !v)}
        >
          {collapsed ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
          <span>Tile Properties</span>
        </button>
        <span className="mono-value" style={{ fontSize: 10, color: "var(--text-muted)" }}>
          {activeTileId > 0 ? `#${activeTileId}` : "Empty"}
        </span>
      </div>

      {!collapsed && (
        <div className="panel-body">
          {meta && activeTileId > 0 ? (
            <>
              <div className="tiles-prop-row">
                <label className="tiles-prop-label" htmlFor="tile-name-input">
                  Name
                </label>
                <input
                  id="tile-name-input"
                  type="text"
                  className="tiles-text-input"
                  value={meta.name ?? ""}
                  placeholder={`Tile ${activeTileId}`}
                  onChange={(e) => {
                    ts.setMeta(activeTileId, { name: e.target.value });
                    bumpTilesetVersion();
                  }}
                />
              </div>
              <div className="tiles-prop-row">
                <label className="tiles-prop-label" htmlFor="tile-prob-input">
                  Weight
                </label>
                <input
                  id="tile-prob-input"
                  type="number"
                  min={0}
                  max={100}
                  step={0.1}
                  className="tiles-text-input"
                  value={meta.probability ?? 1}
                  onChange={(e) => {
                    const val = Math.max(0, Number(e.target.value) || 0);
                    ts.setMeta(activeTileId, { probability: val });
                    bumpTilesetVersion();
                  }}
                />
              </div>
            </>
          ) : (
            <div className="mode-hint">Select a tile to edit metadata.</div>
          )}

          <div className="tiles-flag-row">
            <button
              type="button"
              className={`toggle-chip ${tileBrushFlags.flipH ? "active" : ""}`}
              title="Flip Brush Horizontal (X)"
              onClick={() =>
                setTileBrushFlags({
                  ...tileBrushFlags,
                  flipH: !tileBrushFlags.flipH,
                })
              }
            >
              <FlipHorizontal2 size={11} />
              <span>X</span>
            </button>
            <button
              type="button"
              className={`toggle-chip ${tileBrushFlags.flipV ? "active" : ""}`}
              title="Flip Brush Vertical (Y)"
              onClick={() =>
                setTileBrushFlags({
                  ...tileBrushFlags,
                  flipV: !tileBrushFlags.flipV,
                })
              }
            >
              <FlipVertical2 size={11} />
              <span>Y</span>
            </button>
            <button
              type="button"
              className={`toggle-chip ${tileBrushFlags.flipD ? "active" : ""}`}
              title="Rotate Brush 90° CW (Z)"
              onClick={rotateFlagsCW}
            >
              <RotateCw size={11} />
              <span>Z</span>
            </button>
            <button
              type="button"
              className="mini-btn"
              style={{ marginLeft: "auto", fontSize: 10 }}
              onClick={() =>
                setTileBrushFlags({ flipH: false, flipV: false, flipD: false })
              }
            >
              Reset
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

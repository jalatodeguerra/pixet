import { useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { pixelEngine } from "../../engine/document/PixelEngine";
import { useEditorStore } from "../../store/editorStore";

export function MapPropertiesPanel() {
  const tileProjection = useEditorStore((s) => s.tileProjection);
  const setTileProjection = useEditorStore((s) => s.setTileProjection);
  const showTileGrid = useEditorStore((s) => s.showTileGrid);
  const toggleShowTileGrid = useEditorStore((s) => s.toggleShowTileGrid);
  const showIsoGrid = useEditorStore((s) => s.showIsoGrid);
  const toggleShowIsoGrid = useEditorStore((s) => s.toggleShowIsoGrid);
  const canvasWidth = useEditorStore((s) => s.canvasWidth);
  const canvasHeight = useEditorStore((s) => s.canvasHeight);
  const tileWidth = useEditorStore((s) => s.tileWidth);
  const tileHeight = useEditorStore((s) => s.tileHeight);
  const [collapsed, setCollapsed] = useState(false);

  const mapCols = Math.max(1, Math.ceil(canvasWidth / Math.max(1, tileWidth)));
  const mapRows = Math.max(1, Math.ceil(canvasHeight / Math.max(1, tileHeight)));

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
        <button
          type="button"
          className="panel-collapse-btn"
          onClick={() => setCollapsed((v) => !v)}
        >
          {collapsed ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
          <span>Map Properties</span>
        </button>
        <span className="mono-value" style={{ fontSize: 10, color: "var(--text-muted)" }}>
          {mapCols}×{mapRows}
        </span>
      </div>

      {!collapsed && (
        <div className="panel-body">
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

          <div className="tileset-controls-row">
            <button
              type="button"
              className={`toggle-chip ${showTileGrid ? "active" : ""}`}
              onClick={toggleShowTileGrid}
            >
              Tile Grid
            </button>
            <button
              type="button"
              className={`toggle-chip ${showIsoGrid ? "active" : ""}`}
              onClick={toggleShowIsoGrid}
            >
              Iso Grid
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

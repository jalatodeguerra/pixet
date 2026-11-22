import { useState } from "react";
import { ChevronDown, ChevronRight, Sparkles } from "lucide-react";
import { syncHistoryAndCelState } from "../../engine/document/historyActions";
import { pixelEngine } from "../../engine/document/PixelEngine";
import type { AutoTileMode } from "../../engine/tiles/autoTile";
import { useEditorStore } from "../../store/editorStore";

export function TerrainPanel() {
  const autoTileEnabled = useEditorStore((s) => s.autoTileEnabled);
  const toggleAutoTile = useEditorStore((s) => s.toggleAutoTile);
  const setAutoTileEnabled = useEditorStore((s) => s.setAutoTileEnabled);
  const autoTileMode = useEditorStore((s) => s.autoTileMode);
  const setAutoTileMode = useEditorStore((s) => s.setAutoTileMode);
  const setActiveTileId = useEditorStore((s) => s.setActiveTileId);
  const bumpTilesetVersion = useEditorStore((s) => s.bumpTilesetVersion);
  const setTileTool = useEditorStore((s) => s.setTileTool);
  const setStatusMessage = useEditorStore((s) => s.setStatusMessage);
  const [collapsed, setCollapsed] = useState(false);

  const handleGenerateAutoTile = () => {
    const ruleset = pixelEngine.recordTilesetOp(
      "Generate 16-Tile Auto-Tile",
      () => pixelEngine.generateAutoTileTerrain()
    );
    setActiveTileId(ruleset.fallbackTileId);
    setAutoTileEnabled(true);
    bumpTilesetVersion();
    syncHistoryAndCelState();
    setTileTool("terrain");
    setStatusMessage("Generated 16-tile auto-tile set · Paint with Terrain (A)");
  };

  const handleToggleAutoTile = () => {
    if (!autoTileEnabled && !pixelEngine.autoTileRuleset) {
      handleGenerateAutoTile();
      return;
    }
    toggleAutoTile();
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
          <span>Terrains &amp; Auto-Tile</span>
        </button>
      </div>

      {!collapsed && (
        <div className="panel-body">
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
        </div>
      )}
    </section>
  );
}

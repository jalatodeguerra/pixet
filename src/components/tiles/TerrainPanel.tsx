import { Play, Plus, Sparkles } from "lucide-react";
import { DockablePanelSection } from "../DockablePanelSection";
import { syncHistoryAndCelState } from "../../engine/document/historyActions";
import { pixelEngine } from "../../engine/document/PixelEngine";
import type { AutoTileMode } from "../../engine/tiles/autoTile";
import { evaluateAutoMapRules } from "../../engine/tiles/automap";
import { applyCellChanges } from "../../engine/tiles/mapTools";
import {
  applyTerrainTemplate,
  getExpectedMasksForMode,
  getMissingTerrainMasks,
  type TerrainMode,
  type TerrainSet,
} from "../../engine/tiles/terrain";
import { useEditorStore } from "../../store/editorStore";

const TERRAIN_PALETTE = ["#4c8bf5", "#22c55e", "#eab308", "#ef4444", "#a855f7"];

export function TerrainPanel() {
  const autoTileEnabled = useEditorStore((s) => s.autoTileEnabled);
  const toggleAutoTile = useEditorStore((s) => s.toggleAutoTile);
  const setAutoTileEnabled = useEditorStore((s) => s.setAutoTileEnabled);
  const autoTileMode = useEditorStore((s) => s.autoTileMode);
  const setAutoTileMode = useEditorStore((s) => s.setAutoTileMode);
  const setActiveTileId = useEditorStore((s) => s.setActiveTileId);
  const activeTilesetIndex = useEditorStore((s) => s.activeTilesetIndex);
  const tilesetVersion = useEditorStore((s) => s.tilesetVersion);
  const bumpTilesetVersion = useEditorStore((s) => s.bumpTilesetVersion);
  const setTileTool = useEditorStore((s) => s.setTileTool);
  const setStatusMessage = useEditorStore((s) => s.setStatusMessage);
  const activeTerrainSetId = useEditorStore((s) => s.activeTerrainSetId);
  const setActiveTerrainSetId = useEditorStore((s) => s.setActiveTerrainSetId);
  const activeTerrainId = useEditorStore((s) => s.activeTerrainId);
  const setActiveTerrainId = useEditorStore((s) => s.setActiveTerrainId);
  const terrainEditMode = useEditorStore((s) => s.terrainEditMode);
  const toggleTerrainEditMode = useEditorStore((s) => s.toggleTerrainEditMode);
  const activeLayerId = useEditorStore((s) => s.activeLayerId);
  const currentFrame = useEditorStore((s) => s.currentFrame);
  const tileSelection = useEditorStore((s) => s.tileSelection);

  void tilesetVersion;
  const sets = pixelEngine.terrainSets;
  const activeSet: TerrainSet | null =
    sets.find((s) => s.id === activeTerrainSetId) ?? sets[0] ?? null;
  const activeTerrain =
    activeSet?.terrains.find((t) => t.id === activeTerrainId) ??
    activeSet?.terrains[0] ??
    null;

  const missingCount =
    activeSet && activeTerrain
      ? getMissingTerrainMasks(activeSet, activeTerrain.id).length
      : 0;
  const expectedCount = activeSet
    ? getExpectedMasksForMode(activeSet.mode).length
    : 0;

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

  const handleGenerateBlob47 = () => {
    const set = pixelEngine.recordTilesetOp("Generate 47-Blob Terrain", () =>
      pixelEngine.generateBlob47Terrain(activeTilesetIndex)
    );
    setActiveTerrainSetId(set.id);
    setActiveTerrainId(set.terrains[0]?.id ?? null);
    setAutoTileEnabled(true);
    bumpTilesetVersion();
    syncHistoryAndCelState();
    setTileTool("terrain");
    setStatusMessage("Generated 47-blob terrain set · Paint with Terrain (A)");
  };

  const handleAddTerrainSet = () => {
    const created = pixelEngine.recordTilesetOp("Add Terrain Set", () => {
      const id = `tset-${Date.now().toString(36)}`;
      const tId = "terrain-1";
      const next: TerrainSet = {
        id,
        name: `Terrain Set ${pixelEngine.terrainSets.length + 1}`,
        mode: "blob47",
        tilesetIndex: activeTilesetIndex,
        terrains: [{ id: tId, name: "Ground", color: TERRAIN_PALETTE[0] }],
        peering: {},
      };
      pixelEngine.terrainSets.push(next);
      return next;
    });
    setActiveTerrainSetId(created.id);
    setActiveTerrainId(created.terrains[0].id);
    bumpTilesetVersion();
    syncHistoryAndCelState();
  };

  const handleAddTerrain = () => {
    if (!activeSet) return;
    const newId = pixelEngine.recordTilesetOp("Add Terrain", () => {
      const idx = activeSet.terrains.length;
      const tid = `terrain-${idx + 1}`;
      activeSet.terrains.push({
        id: tid,
        name: `Terrain ${idx + 1}`,
        color: TERRAIN_PALETTE[idx % TERRAIN_PALETTE.length],
      });
      return tid;
    });
    setActiveTerrainId(newId);
    bumpTilesetVersion();
    syncHistoryAndCelState();
  };

  const handleApplyTemplate = (
    template: "16tile" | "blob47" | "wangCorner" | "rpgMakerA2"
  ) => {
    if (!activeSet || !activeTerrain) return;
    pixelEngine.recordTilesetOp(`Apply ${template} Template`, () => {
      applyTerrainTemplate(activeSet, template, activeTerrain.id, 1);
    });
    bumpTilesetVersion();
    syncHistoryAndCelState();
    setStatusMessage(`Applied ${template} template to ${activeTerrain.name}`);
  };

  const handleAddShadowRule = () => {
    pixelEngine.recordTilesetOp("Add Auto-Map Rule", () => {
      pixelEngine.autoMapRules.push({
        id: `rule-${Date.now().toString(36)}`,
        name: "Shadow Under Tile #2",
        enabled: true,
        match: [
          { dx: 0, dy: -1, match: { kind: "tile", localId: 2 } },
          { dx: 0, dy: 0, match: { kind: "empty" } },
        ],
        output: { cols: 1, rows: 1, cells: [3] },
        probability: 1,
      });
    });
    bumpTilesetVersion();
    syncHistoryAndCelState();
  };

  const handleRunAutoMap = () => {
    const tm = pixelEngine.getTilemap(activeLayerId, currentFrame);
    if (!tm) {
      setStatusMessage("Select a Tilemap layer first");
      return;
    }
    const region =
      tileSelection.length > 0 ? new Set(tileSelection) : undefined;
    const changes = evaluateAutoMapRules(
      tm,
      tm,
      pixelEngine.autoMapRules,
      pixelEngine.terrainSets,
      { region }
    );
    if (changes.length === 0) {
      setStatusMessage("Auto-Map: no matching cells");
      return;
    }
    pixelEngine.tilemapHistory.beginCells(
      "Run Auto-Map Rules",
      activeLayerId,
      currentFrame
    );
    applyCellChanges(tm, changes, pixelEngine.tilemapHistory);
    pixelEngine.tilemapHistory.commitCells();
    syncHistoryAndCelState(activeLayerId, currentFrame);
    pixelEngine.emitChange();
    setStatusMessage(`Auto-Map updated ${changes.length} cells`);
  };

  return (
    <DockablePanelSection
      id="tiles-terrain"
      title="Terrains & Auto-Tile"
      actions={
        <button
          type="button"
          className="icon-action-btn"
          style={{ width: 22, height: 22 }}
          title="New Terrain Set"
          onClick={handleAddTerrainSet}
        >
          <Plus size={12} />
        </button>
      }
    >
      <div className="tileset-controls-row">
            <button
              type="button"
              className={`toggle-chip ${autoTileEnabled ? "active" : ""}`}
              onClick={toggleAutoTile}
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
              title="Generate 16 bordered terrain tiles"
            >
              <Sparkles size={11} />
              <span>16</span>
            </button>
            <button
              type="button"
              className="toggle-chip"
              onClick={handleGenerateBlob47}
              title="Generate 47-blob terrain tiles from quarter pieces"
            >
              <Sparkles size={11} />
              <span>47</span>
            </button>
          </div>

          {activeSet && (
            <>
              <div className="tiles-prop-row" style={{ marginTop: 6 }}>
                <select
                  className="palette-select"
                  style={{ flex: 1, fontSize: 10, padding: "2px 4px" }}
                  value={activeSet.id}
                  onChange={(e) => {
                    const next = sets.find((s) => s.id === e.target.value);
                    setActiveTerrainSetId(next?.id ?? null);
                    setActiveTerrainId(next?.terrains[0]?.id ?? null);
                  }}
                >
                  {sets.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
                <select
                  className="palette-select"
                  style={{ width: 88, fontSize: 10, padding: "2px 4px" }}
                  value={activeSet.mode}
                  onChange={(e) => {
                    const mode = e.target.value as TerrainMode;
                    pixelEngine.recordTilesetOp("Change Terrain Mode", () => {
                      activeSet.mode = mode;
                    });
                    bumpTilesetVersion();
                    syncHistoryAndCelState();
                  }}
                >
                  <option value="edges4">Edges 4</option>
                  <option value="blob47">Blob 47</option>
                  <option value="corners">Corners</option>
                  <option value="edgesCorners">Edges+Corners</option>
                </select>
              </div>

              <div className="tiles-terrain-list">
                {activeSet.terrains.map((t) => {
                  const active = activeTerrain?.id === t.id;
                  return (
                    <button
                      key={t.id}
                      type="button"
                      className={`tiles-terrain-chip ${active ? "active" : ""}`}
                      onClick={() => setActiveTerrainId(t.id)}
                    >
                      <span
                        className="tiles-terrain-swatch"
                        style={{ backgroundColor: t.color }}
                      />
                      <span>{t.name}</span>
                    </button>
                  );
                })}
                <button
                  type="button"
                  className="mini-btn"
                  style={{ fontSize: 10, padding: "2px 6px" }}
                  onClick={handleAddTerrain}
                >
                  + Terrain
                </button>
              </div>

              <div className="tileset-controls-row" style={{ marginTop: 4 }}>
                <button
                  type="button"
                  className={`toggle-chip ${terrainEditMode ? "active" : ""}`}
                  onClick={toggleTerrainEditMode}
                  title="Click 3×3 peering bits over tiles in the browser"
                >
                  Edit Peering
                </button>
                <span
                  className="mono-value"
                  style={{ fontSize: 10, color: "var(--text-muted)" }}
                >
                  Missing: {missingCount}/{expectedCount}
                </span>
              </div>

              <div className="tileset-controls-row" style={{ marginTop: 4 }}>
                <button
                  type="button"
                  className="mini-btn"
                  style={{ fontSize: 10 }}
                  onClick={() => handleApplyTemplate("16tile")}
                >
                  16-Tile
                </button>
                <button
                  type="button"
                  className="mini-btn"
                  style={{ fontSize: 10 }}
                  onClick={() => handleApplyTemplate("blob47")}
                >
                  47-Blob
                </button>
                <button
                  type="button"
                  className="mini-btn"
                  style={{ fontSize: 10 }}
                  onClick={() => handleApplyTemplate("wangCorner")}
                >
                  Wang
                </button>
                <button
                  type="button"
                  className="mini-btn"
                  style={{ fontSize: 10 }}
                  onClick={() => handleApplyTemplate("rpgMakerA2")}
                >
                  A2
                </button>
              </div>
            </>
          )}

          <div
            className="tileset-controls-row"
            style={{ marginTop: 8, paddingTop: 6, borderTop: "1px solid var(--border-subtle)" }}
          >
            <span style={{ fontSize: 10, color: "var(--text-muted)" }}>
              Auto-Map ({pixelEngine.autoMapRules.length})
            </span>
            <button
              type="button"
              className="mini-btn"
              style={{ fontSize: 10 }}
              onClick={handleAddShadowRule}
            >
              + Rule
            </button>
            <button
              type="button"
              className="toggle-chip"
              onClick={handleRunAutoMap}
              title="Run enabled auto-map rules on active tilemap"
            >
              <Play size={10} />
              <span>Run</span>
            </button>
          </div>
    </DockablePanelSection>
  );
}

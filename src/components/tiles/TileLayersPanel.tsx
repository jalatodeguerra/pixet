import { Box, Eye, EyeOff, Plus } from "lucide-react";
import { useEditorStore } from "../../store/editorStore";
import { DockablePanelSection } from "../DockablePanelSection";

export function TileLayersPanel() {
  const layers = useEditorStore((s) => s.layers);
  const activeLayerId = useEditorStore((s) => s.activeLayerId);
  const selectLayer = useEditorStore((s) => s.selectLayer);
  const toggleLayerVisible = useEditorStore((s) => s.toggleLayerVisible);
  const addTilemapLayer = useEditorStore((s) => s.addTilemapLayer);
  const addObjectLayer = useEditorStore((s) => s.addObjectLayer);
  const setStatusMessage = useEditorStore((s) => s.setStatusMessage);

  const tilemapLayers = layers.filter(
    (l) => l.kind === "tilemap" || l.kind === "object"
  );

  return (
    <DockablePanelSection
      id="tiles-layers"
      title={`Map Layers (${tilemapLayers.length})`}
      actions={
        <>
        <button
          type="button"
          className="icon-action-btn"
          style={{ width: 22, height: 22 }}
          title="New Object Layer"
          onClick={() => {
            addObjectLayer();
            setStatusMessage("Created Object layer");
          }}
        >
          <Box size={12} />
        </button>
        <button
          type="button"
          className="icon-action-btn"
          style={{ width: 22, height: 22 }}
          title="New Tilemap Layer"
          onClick={() => {
            addTilemapLayer();
            setStatusMessage("Created Tilemap layer");
          }}
        >
          <Plus size={12} />
        </button>
        </>
      }
    >
      {tilemapLayers.length === 0 ? (
        <div className="mode-hint">
          No tilemap layers yet. Click + to add one.
        </div>
      ) : (
        <div className="tiles-layer-list">
          {tilemapLayers.map((layer) => {
            const active = layer.id === activeLayerId;
            return (
              <div
                key={layer.id}
                className={`tiles-layer-row ${active ? "active" : ""}`}
                onClick={() => selectLayer(layer.id)}
              >
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
                  {layer.visible ? <Eye size={11} /> : <EyeOff size={11} />}
                </button>
                {layer.kind === "object" && <Box size={11} />}
                <span className="tiles-layer-name">{layer.name}</span>
              </div>
            );
          })}
        </div>
      )}
    </DockablePanelSection>
  );
}
